import { describe, expect, it, vi } from "vitest";
import type { SymphonyService } from "../src/service";
import { startStatusServer } from "../src/httpServer";

function makeService(overrides?: Partial<SymphonyService>): SymphonyService {
  return {
    async start() {},
    async stop() {},
    async reloadWorkflow() {
      return true;
    },
    async runTickOnce() {},
    getSnapshot() {
      return {
        workflowPath: "/tmp/WORKFLOW.md",
        pollIntervalMs: 1000,
        runningCount: 1,
        retryCount: 1,
      };
    },
    getRuntimeSnapshot() {
      return {
        running: [
          {
            issue_id: "issue-1",
            issue_identifier: "ATH-100",
            state: "In Progress",
            session_id: "thread-1-turn-1",
            turn_count: 3,
            retry_attempt: 1,
            started_at_ms: 1_700_000_000_000,
            last_codex_timestamp_ms: 1_700_000_000_500,
            codex_input_tokens: 10,
            codex_output_tokens: 4,
            codex_total_tokens: 14,
          },
        ],
        retrying: [
          {
            issue_id: "issue-2",
            issue_identifier: "ATH-101",
            attempt: 2,
            due_at_ms: 1_700_000_010_000,
            error: "no available orchestrator slots",
          },
        ],
        completed: [
          {
            issue_id: "issue-3",
            issue_identifier: "ATH-102",
            state: "Human Review",
            attempt: 1,
            observed_at_ms: 1_700_000_020_000,
            done: true,
          },
        ],
        codex_totals: {
          input_tokens: 30,
          output_tokens: 12,
          total_tokens: 42,
          seconds_running: 180,
        },
        rate_limits: {
          rpm: {
            remaining: 900,
          },
        },
      };
    },
    getRuntimeIssueSnapshot(issueIdentifier: string) {
      if (issueIdentifier === "ATH-101") {
        return {
          issue_identifier: "ATH-101",
          issue_id: "issue-2",
          status: "retrying",
          running: null,
          retry: {
            issue_id: "issue-2",
            issue_identifier: "ATH-101",
            attempt: 2,
            due_at_ms: 1_700_000_010_000,
            error: "no available orchestrator slots",
          },
          codex_totals: {
            input_tokens: 30,
            output_tokens: 12,
            total_tokens: 42,
            seconds_running: 180,
          },
          rate_limits: {
            rpm: {
              remaining: 900,
            },
          },
          events: [],
          events_count: 0,
          events_limit: 200,
          events_truncated: false,
        };
      }

      if (issueIdentifier === "ATH-102") {
        return {
          issue_identifier: "ATH-102",
          issue_id: "issue-3",
          status: "completed",
          running: null,
          retry: null,
          completed: {
            issue_id: "issue-3",
            issue_identifier: "ATH-102",
            state: "Human Review",
            attempt: 1,
            observed_at_ms: 1_700_000_020_000,
            done: true,
          },
          codex_totals: {
            input_tokens: 30,
            output_tokens: 12,
            total_tokens: 42,
            seconds_running: 180,
          },
          rate_limits: {
            rpm: {
              remaining: 900,
            },
          },
          events: [],
          events_count: 0,
          events_limit: 200,
          events_truncated: false,
        };
      }

      if (issueIdentifier !== "ATH-100") {
        return null;
      }

      return {
        issue_identifier: "ATH-100",
        issue_id: "issue-1",
        status: "running",
        running: {
          state: "In Progress",
          session_id: "thread-1-turn-1",
          turn_count: 3,
          retry_attempt: 1,
          started_at_ms: 1_700_000_000_000,
          last_codex_timestamp_ms: 1_700_000_000_500,
          codex_input_tokens: 10,
          codex_output_tokens: 4,
          codex_total_tokens: 14,
        },
        retry: null,
        completed: null,
        codex_totals: {
          input_tokens: 30,
          output_tokens: 12,
          total_tokens: 42,
          seconds_running: 180,
        },
        rate_limits: {
          rpm: {
            remaining: 900,
          },
        },
        events: [
          {
            seq: 1,
            timestamp: "2026-03-30T00:00:00.000Z",
            source: "service",
            kind: "dispatch_started",
            message: "Dispatch started for ATH-100",
            session_id: null,
            turn_count: 0,
            retry_attempt: 1,
          },
          {
            seq: 2,
            timestamp: "2026-03-30T00:00:01.000Z",
            source: "codex",
            kind: "codex_notification",
            message: "Codex notification received",
            session_id: "thread-1-turn-1",
            turn_count: 0,
            retry_attempt: 1,
            usage: {
              input_tokens: 10,
              output_tokens: 4,
              total_tokens: 14,
            },
          },
        ],
        events_count: 2,
        events_limit: 200,
        events_truncated: false,
      };
    },
    ...overrides,
  } as SymphonyService;
}

describe("status server", () => {
  it("serves dashboard and state API", async () => {
    const statusServer = await startStatusServer({
      service: makeService(),
      port: 0,
    });

    try {
      const rootResponse = await fetch(`http://${statusServer.host}:${statusServer.port}/`);
      expect(rootResponse.status).toBe(200);
      const rootBody = await rootResponse.text();
      expect(rootBody).toContain("Symphony Runtime Status");
      expect(rootBody).toContain("Issue Activity");

      const stateResponse = await fetch(`http://${statusServer.host}:${statusServer.port}/api/v1/state`);
      expect(stateResponse.status).toBe(200);
      const stateBody = (await stateResponse.json()) as Record<string, any>;
      expect(stateBody.counts).toEqual({
        running: 1,
        retrying: 1,
        completed: 1,
      });
      expect(stateBody.running[0].issue_identifier).toBe("ATH-100");
      expect(stateBody.retrying[0].issue_identifier).toBe("ATH-101");
      expect(stateBody.completed[0].issue_identifier).toBe("ATH-102");
    } finally {
      await statusServer.stop();
    }
  });

  it("serves per-issue API and returns 404 for unknown issue", async () => {
    const statusServer = await startStatusServer({
      service: makeService(),
      port: 0,
    });

    try {
      const runningResponse = await fetch(`http://${statusServer.host}:${statusServer.port}/api/v1/ATH-100`);
      expect(runningResponse.status).toBe(200);
      const runningBody = (await runningResponse.json()) as Record<string, any>;
      expect(runningBody.status).toBe("running");
      expect(runningBody.issue_id).toBe("issue-1");
      expect(runningBody.events_count).toBe(2);
      expect(runningBody.events_limit).toBe(200);
      expect(runningBody.events_truncated).toBe(false);
      expect(runningBody.events[0].kind).toBe("dispatch_started");
      expect(runningBody.events[1].kind).toBe("codex_notification");

      const retryResponse = await fetch(`http://${statusServer.host}:${statusServer.port}/api/v1/ATH-101`);
      expect(retryResponse.status).toBe(200);
      const retryBody = (await retryResponse.json()) as Record<string, any>;
      expect(retryBody.status).toBe("retrying");
      expect(retryBody.retry.attempt).toBe(2);

      const missingResponse = await fetch(`http://${statusServer.host}:${statusServer.port}/api/v1/ATH-999`);
      expect(missingResponse.status).toBe(404);
      const missingBody = (await missingResponse.json()) as Record<string, any>;
      expect(missingBody.error.code).toBe("issue_not_found");

      const completedResponse = await fetch(`http://${statusServer.host}:${statusServer.port}/api/v1/ATH-102`);
      expect(completedResponse.status).toBe(200);
      const completedBody = (await completedResponse.json()) as Record<string, any>;
      expect(completedBody.status).toBe("completed");
      expect(completedBody.completed.state).toBe("Human Review");
    } finally {
      await statusServer.stop();
    }
  });

  it("handles refresh trigger and method checks", async () => {
    const runTickOnce = vi.fn(async () => {
      await Promise.resolve();
    });
    const onRefreshError = vi.fn();

    const statusServer = await startStatusServer({
      service: makeService({ runTickOnce }),
      port: 0,
      onRefreshError,
    });

    try {
      const refreshResponse = await fetch(`http://${statusServer.host}:${statusServer.port}/api/v1/refresh`, {
        method: "POST",
      });
      expect(refreshResponse.status).toBe(202);
      const refreshBody = (await refreshResponse.json()) as Record<string, any>;
      expect(refreshBody.queued).toBe(true);
      expect(refreshBody.operations).toEqual(["poll", "reconcile"]);

      await Promise.resolve();
      await Promise.resolve();
      expect(runTickOnce).toHaveBeenCalledTimes(1);
      expect(onRefreshError).not.toHaveBeenCalled();

      const methodResponse = await fetch(`http://${statusServer.host}:${statusServer.port}/api/v1/refresh`, {
        method: "GET",
      });
      expect(methodResponse.status).toBe(405);
      const methodBody = (await methodResponse.json()) as Record<string, any>;
      expect(methodBody.error.code).toBe("method_not_allowed");
    } finally {
      await statusServer.stop();
    }
  });
});
