import { describe, expect, it, vi } from "vitest";
import type { FSWatcher } from "node:fs";
import type { WorkflowDocument } from "../src/types";
import type { NormalizedIssue, TrackerClient } from "../src/issue";
import { createSymphonyService, formatServiceLogLine } from "../src/service";

class FakeTracker implements TrackerClient {
  async fetchCandidateIssues() {
    return [];
  }

  async fetchIssuesByStates() {
    return [];
  }

  async fetchIssueStatesByIds() {
    return [];
  }
}

function issue(partial: Partial<NormalizedIssue>): NormalizedIssue {
  return {
    id: partial.id ?? "1",
    identifier: partial.identifier ?? "ATH-1",
    title: partial.title ?? "Issue",
    state: partial.state ?? "Todo",
    priority: partial.priority ?? 1,
    created_at: partial.created_at ?? "2026-01-01T00:00:00.000Z",
    updated_at: partial.updated_at ?? "2026-01-01T00:00:00.000Z",
    labels: partial.labels ?? [],
    blocked_by: partial.blocked_by ?? [],
  };
}

function workflow(pollMs: number): WorkflowDocument {
  return {
    path: "/tmp/WORKFLOW.md",
    config: {
      tracker: {
        kind: "linear",
        api_key: "key",
        project_slug: "ATH",
      },
      polling: {
        interval_ms: pollMs,
      },
      codex: {
        command: "codex app-server",
      },
    },
    promptTemplate: "Issue {{ issue.identifier }}",
  };
}

describe("createSymphonyService", () => {
  it("runs startup cleanup, immediate tick, and schedules polling", async () => {
    const intervalCalls: number[] = [];
    const clearCalls: unknown[] = [];
    let intervalId = 0;
    const runTickCalls: number[] = [];
    const dueRetryCalls: number[] = [];
    const cleanupCalls: number[] = [];

    const service = createSymphonyService({
      workflowPath: "/tmp/WORKFLOW.md",
      deps: {
        loadWorkflowFile: async () => workflow(1234),
        createTracker: () => new FakeTracker(),
        cleanupTerminalIssueWorkspaces: async () => {
          cleanupCalls.push(1);
          return { removed: 0, failed: 0, warnings: [] };
        },
        processDueRetries: async () => {
          dueRetryCalls.push(1);
          return {
            processedIssueIds: [],
            dispatchedIssueIds: [],
            requeuedIssueIds: [],
            releasedIssueIds: [],
          };
        },
        runOrchestratorTick: async () => {
          runTickCalls.push(1);
          return {
            skippedDispatch: false,
            selectedIssueIds: [],
            dispatchedIssueIds: [],
            dispatchErrors: [],
            reconcileActions: [],
            stalledIssueIds: [],
          };
        },
        setIntervalFn: (fn: () => void, ms: number) => {
          intervalCalls.push(ms);
          void fn;
          intervalId += 1;
          return intervalId as unknown as ReturnType<typeof setInterval>;
        },
        clearIntervalFn: (id: ReturnType<typeof setInterval>) => {
          clearCalls.push(id);
        },
      },
    });

    await service.start();

    expect(cleanupCalls).toHaveLength(1);
    expect(dueRetryCalls).toHaveLength(1);
    expect(runTickCalls).toHaveLength(1);
    expect(intervalCalls).toEqual([1234]);
    expect(service.getSnapshot().pollIntervalMs).toBe(1234);

    await service.stop();
    expect(clearCalls).toHaveLength(1);
  });

  it("reloads workflow and updates poll interval while keeping last-known-good on reload failure", async () => {
    const workflows = [workflow(1000), workflow(2500)];
    const intervalCalls: number[] = [];
    const clearCalls: number[] = [];
    const warnings: string[] = [];
    let intervalId = 0;

    const service = createSymphonyService({
      workflowPath: "/tmp/WORKFLOW.md",
      deps: {
        loadWorkflowFile: async () => {
          const next = workflows.shift();
          if (!next) {
            throw new Error("reload parse failed");
          }
          return next;
        },
        createTracker: () => new FakeTracker(),
        cleanupTerminalIssueWorkspaces: async () => ({ removed: 0, failed: 0, warnings: [] }),
        processDueRetries: async () => ({
          processedIssueIds: [],
          dispatchedIssueIds: [],
          requeuedIssueIds: [],
          releasedIssueIds: [],
        }),
        runOrchestratorTick: async () => ({
          skippedDispatch: false,
          selectedIssueIds: [],
          dispatchedIssueIds: [],
          dispatchErrors: [],
          reconcileActions: [],
          stalledIssueIds: [],
        }),
        setIntervalFn: (_fn: () => void, ms: number) => {
          intervalCalls.push(ms);
          intervalId += 1;
          return intervalId as unknown as ReturnType<typeof setInterval>;
        },
        clearIntervalFn: (_id: ReturnType<typeof setInterval>) => {
          clearCalls.push(1);
        },
        onLog: (entry) => {
          if (entry.level === "warn") {
            warnings.push(entry.message);
          }
        },
      },
    });

    await service.start();
    expect(service.getSnapshot().pollIntervalMs).toBe(1000);

    await service.reloadWorkflow();
    expect(service.getSnapshot().pollIntervalMs).toBe(2500);
    expect(intervalCalls).toEqual([1000, 2500]);
    expect(clearCalls.length).toBeGreaterThanOrEqual(1);

    await service.reloadWorkflow();
    expect(service.getSnapshot().pollIntervalMs).toBe(2500);
    expect(warnings.some((msg) => msg.includes("action=config_reload outcome=failed"))).toBe(true);

    await service.stop();
  });

  it("debounces watch-triggered reloads", async () => {
    vi.useFakeTimers();

    const watchCallbacks: Array<() => void> = [];
    let loadCount = 0;

    const service = createSymphonyService({
      workflowPath: "/tmp/WORKFLOW.md",
      watch: true,
      deps: {
        loadWorkflowFile: async () => {
          loadCount += 1;
          return workflow(1000);
        },
        createTracker: () => new FakeTracker(),
        cleanupTerminalIssueWorkspaces: async () => ({ removed: 0, failed: 0, warnings: [] }),
        processDueRetries: async () => ({
          processedIssueIds: [],
          dispatchedIssueIds: [],
          requeuedIssueIds: [],
          releasedIssueIds: [],
        }),
        runOrchestratorTick: async () => ({
          skippedDispatch: false,
          selectedIssueIds: [],
          dispatchedIssueIds: [],
          dispatchErrors: [],
          reconcileActions: [],
          stalledIssueIds: [],
        }),
        watchWorkflowFile: (_path: string, cb: () => void) => {
          watchCallbacks.push(cb);
          return {
            close: () => {},
          } as FSWatcher;
        },
      },
    });

    await service.start();
    expect(loadCount).toBe(1);

    const triggerWatchReload = watchCallbacks[0];
    if (!triggerWatchReload) {
      throw new Error("expected watch callback to be registered");
    }

    triggerWatchReload();
    triggerWatchReload();
    triggerWatchReload();
    await vi.advanceTimersByTimeAsync(99);
    expect(loadCount).toBe(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(loadCount).toBe(2);

    await service.stop();
    vi.useRealTimers();
  });

  it("forwards worker lifecycle logs with issue and session context", async () => {
    const logs: Array<{ level: string; message: string; details?: Record<string, unknown> }> = [];

    const service = createSymphonyService({
      workflowPath: "/tmp/WORKFLOW.md",
      deps: {
        loadWorkflowFile: async () => workflow(1000),
        createTracker: () => new FakeTracker(),
        cleanupTerminalIssueWorkspaces: async () => ({ removed: 0, failed: 0, warnings: [] }),
        processDueRetries: async () => ({
          processedIssueIds: [],
          dispatchedIssueIds: [],
          requeuedIssueIds: [],
          releasedIssueIds: [],
        }),
        runOrchestratorTick: async ({ dispatchIssue }) => {
          await dispatchIssue({
            issue: issue({ id: "iss-1", identifier: "ATH-200", state: "Todo" }),
            attempt: 1,
          });
          return {
            skippedDispatch: false,
            selectedIssueIds: ["iss-1"],
            dispatchedIssueIds: ["iss-1"],
            dispatchErrors: [],
            reconcileActions: [],
            stalledIssueIds: [],
          };
        },
        runIssueAttempt: async (input) => {
          input.onLog?.({
            message: "action=turn outcome=completed",
            details: {
              issue_id: input.issue.id,
              issue_identifier: input.issue.identifier,
              session_id: "thread-xyz-turn-1",
            },
          });

          return {
            exit: "normal",
            turnCount: 1,
            workspacePath: "/tmp/fake",
            issue: input.issue,
          };
        },
        onLog: (entry) => {
          logs.push(entry as { level: string; message: string; details?: Record<string, unknown> });
        },
      },
    });

    await service.start();
    await service.stop();

    expect(
      logs.some(
        (entry) =>
          entry.message.includes("action=turn outcome=completed") &&
          entry.details?.issue_id === "iss-1" &&
          entry.details?.issue_identifier === "ATH-200" &&
          entry.details?.session_id === "thread-xyz-turn-1",
      ),
    ).toBe(true);
  });
});

describe("formatServiceLogLine", () => {
  it("renders stable key=value output including details", () => {
    const line = formatServiceLogLine({
      level: "info",
      message: "action=dispatch outcome=completed",
      details: {
        issue_identifier: "ATH-1",
        issue_id: "abc",
        session_id: "thread-1-turn-2",
      },
    });

    expect(line).toContain("level=info");
    expect(line).toContain("action=dispatch outcome=completed");
    expect(line).toContain("issue_id=abc");
    expect(line).toContain("issue_identifier=ATH-1");
    expect(line).toContain("session_id=thread-1-turn-2");
  });
});
