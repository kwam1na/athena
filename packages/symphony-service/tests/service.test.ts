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
    description:
      partial.description ?? "Implement the requested change with clear acceptance criteria and validation details.",
    state: partial.state ?? "Todo",
    team_id: partial.team_id,
    priority: partial.priority ?? 1,
    created_at: partial.created_at ?? "2026-01-01T00:00:00.000Z",
    updated_at: partial.updated_at ?? "2026-01-01T00:00:00.000Z",
    labels: partial.labels ?? ["pkg:symphony-service"],
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

  it("continues running when configured log sink throws", async () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    let logCalls = 0;

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
        runOrchestratorTick: async () => ({
          skippedDispatch: false,
          selectedIssueIds: [],
          dispatchedIssueIds: [],
          dispatchErrors: [],
          reconcileActions: [],
          stalledIssueIds: [],
        }),
        onLog: () => {
          logCalls += 1;
          throw new Error("sink broke");
        },
      },
    });

    await service.start();
    await service.stop();

    expect(logCalls).toBeGreaterThan(0);
    expect(
      stderrSpy.mock.calls.some(
        (call) => String(call[0]).includes("action=log_sink outcome=failed"),
      ),
    ).toBe(true);

    stderrSpy.mockRestore();
  });

  it("exposes runtime snapshot for running sessions with codex totals and rate limits", async () => {
    let nowMs = 1_000;
    let releaseWorker: (() => void) | null = null;
    const candidates = [issue({ id: "run-1", identifier: "ATH-301", state: "In Progress" })];

    const service = createSymphonyService({
      workflowPath: "/tmp/WORKFLOW.md",
      deps: {
        nowMs: () => nowMs,
        loadWorkflowFile: async () => workflow(1000),
        createTracker: () => ({
          async fetchCandidateIssues() {
            return candidates.splice(0, candidates.length);
          },
          async fetchIssuesByStates() {
            return [];
          },
          async fetchIssueStatesByIds() {
            return [];
          },
        }),
        cleanupTerminalIssueWorkspaces: async () => ({ removed: 0, failed: 0, warnings: [] }),
        processDueRetries: async () => ({
          processedIssueIds: [],
          dispatchedIssueIds: [],
          requeuedIssueIds: [],
          releasedIssueIds: [],
        }),
        setIntervalFn: () => {
          return 1 as unknown as ReturnType<typeof setInterval>;
        },
        clearIntervalFn: () => {
          return;
        },
        createCodexClient: (_config, onEvent) => {
          onEvent?.({
            event: "notification",
            timestamp: new Date(nowMs).toISOString(),
            session_id: "thread-301-turn-1",
            usage: {
              input_tokens: 12,
              output_tokens: 5,
              total_tokens: 17,
            },
            rate_limits: {
              remaining: 9,
            },
          });

          return {
            async startSession() {
              return { threadId: "thread-301" };
            },
            async runTurn() {
              return { turnId: "turn-1", sessionId: "thread-301-turn-1", outcome: "completed" as const };
            },
            stop() {
              releaseWorker?.();
            },
          };
        },
        runIssueAttempt: async (input) => {
          input.onLog?.({
            message: "action=turn outcome=completed",
            details: {
              issue_id: input.issue.id,
              issue_identifier: input.issue.identifier,
              session_id: "thread-301-turn-1",
            },
          });

          await new Promise<void>((resolve) => {
            releaseWorker = resolve;
          });

          return {
            exit: "normal" as const,
            turnCount: 1,
            workspacePath: "/tmp/fake",
            issue: input.issue,
          };
        },
      },
    });

    await service.start();
    nowMs = 6_000;

    const snapshot = service.getRuntimeSnapshot();
    expect(snapshot.running).toHaveLength(1);
    expect(snapshot.running[0]).toMatchObject({
      issue_id: "run-1",
      issue_identifier: "ATH-301",
      session_id: "thread-301-turn-1",
      turn_count: 1,
      retry_attempt: 1,
      codex_input_tokens: 12,
      codex_output_tokens: 5,
      codex_total_tokens: 17,
    });
    expect(snapshot.codex_totals.input_tokens).toBe(12);
    expect(snapshot.codex_totals.output_tokens).toBe(5);
    expect(snapshot.codex_totals.total_tokens).toBe(17);
    expect(snapshot.codex_totals.seconds_running).toBe(5);
    expect(snapshot.rate_limits).toEqual({ remaining: 9 });
    expect(snapshot.completed).toEqual([]);

    await service.stop();
  });

  it("exposes per-issue runtime snapshot with structured timeline events", async () => {
    let nowMs = 50_000;
    let releaseWorker: (() => void) | null = null;
    const candidates = [issue({ id: "timeline-1", identifier: "ATH-550", state: "In Progress" })];

    const service = createSymphonyService({
      workflowPath: "/tmp/WORKFLOW.md",
      deps: {
        nowMs: () => nowMs,
        loadWorkflowFile: async () => workflow(1000),
        createTracker: () => ({
          async fetchCandidateIssues() {
            return candidates.splice(0, candidates.length);
          },
          async fetchIssuesByStates() {
            return [];
          },
          async fetchIssueStatesByIds() {
            return [];
          },
        }),
        cleanupTerminalIssueWorkspaces: async () => ({ removed: 0, failed: 0, warnings: [] }),
        processDueRetries: async () => ({
          processedIssueIds: [],
          dispatchedIssueIds: [],
          requeuedIssueIds: [],
          releasedIssueIds: [],
        }),
        setIntervalFn: () => {
          return 1 as unknown as ReturnType<typeof setInterval>;
        },
        clearIntervalFn: () => {
          return;
        },
        createCodexClient: (_config, onEvent) => {
          onEvent?.({
            event: "notification",
            timestamp: new Date(nowMs).toISOString(),
            session_id: "thread-550-turn-1",
            usage: {
              input_tokens: 22,
              output_tokens: 8,
              total_tokens: 30,
            },
            rate_limits: {
              remaining: 5,
            },
          });

          return {
            async startSession() {
              return { threadId: "thread-550" };
            },
            async runTurn() {
              return { turnId: "turn-1", sessionId: "thread-550-turn-1", outcome: "completed" as const };
            },
            stop() {
              releaseWorker?.();
            },
          };
        },
        runIssueAttempt: async (input) => {
          input.onLog?.({
            message: "action=turn outcome=completed",
            details: {
              issue_id: input.issue.id,
              issue_identifier: input.issue.identifier,
              session_id: "thread-550-turn-1",
            },
          });

          await new Promise<void>((resolve) => {
            releaseWorker = resolve;
          });

          return {
            exit: "normal" as const,
            turnCount: 1,
            workspacePath: "/tmp/fake",
            issue: input.issue,
          };
        },
      },
    });

    await service.start();

    const issueSnapshot = (service as any).getRuntimeIssueSnapshot("ATH-550");
    expect(issueSnapshot).not.toBeNull();
    expect(issueSnapshot.status).toBe("running");
    expect(issueSnapshot.events_count).toBeGreaterThan(0);
    expect(issueSnapshot.events_limit).toBe(200);
    expect(issueSnapshot.events_truncated).toBe(false);

    const seqs = issueSnapshot.events.map((event: { seq: number }) => event.seq);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(issueSnapshot.events.some((event: { kind: string }) => event.kind === "dispatch_started")).toBe(true);
    expect(issueSnapshot.events.some((event: { kind: string }) => event.kind === "worker_log")).toBe(true);
    expect(issueSnapshot.events.some((event: { kind: string }) => event.kind === "codex_notification")).toBe(true);
    expect(
      issueSnapshot.events.some(
        (event: { kind: string; usage?: { total_tokens: number } }) =>
          event.kind === "codex_notification" && event.usage?.total_tokens === 30,
      ),
    ).toBe(true);

    await service.stop();
  });

  it("caps per-issue timeline event history with truncation metadata", async () => {
    const candidates = [issue({ id: "timeline-cap-1", identifier: "ATH-551", state: "In Progress" })];

    const service = createSymphonyService({
      workflowPath: "/tmp/WORKFLOW.md",
      deps: {
        loadWorkflowFile: async () => workflow(1000),
        createTracker: () => ({
          async fetchCandidateIssues() {
            return candidates.splice(0, candidates.length);
          },
          async fetchIssuesByStates() {
            return [];
          },
          async fetchIssueStatesByIds() {
            return [];
          },
        }),
        cleanupTerminalIssueWorkspaces: async () => ({ removed: 0, failed: 0, warnings: [] }),
        processDueRetries: async () => ({
          processedIssueIds: [],
          dispatchedIssueIds: [],
          requeuedIssueIds: [],
          releasedIssueIds: [],
        }),
        setIntervalFn: () => {
          return 1 as unknown as ReturnType<typeof setInterval>;
        },
        clearIntervalFn: () => {
          return;
        },
        createCodexClient: (_config, onEvent) => {
          for (let i = 0; i < 260; i += 1) {
            onEvent?.({
              event: "notification",
              timestamp: new Date(60_000 + i).toISOString(),
              session_id: "thread-551-turn-1",
              usage: {
                total_tokens: i + 1,
              },
            });
          }

          return {
            async startSession() {
              return { threadId: "thread-551" };
            },
            async runTurn() {
              return { turnId: "turn-1", sessionId: "thread-551-turn-1", outcome: "completed" as const };
            },
            stop() {},
          };
        },
        runIssueAttempt: async (input) => {
          input.onLog?.({
            message: "action=turn outcome=completed",
            details: {
              issue_id: input.issue.id,
              issue_identifier: input.issue.identifier,
              session_id: "thread-551-turn-1",
            },
          });

          return {
            exit: "normal" as const,
            turnCount: 1,
            workspacePath: "/tmp/fake",
            issue: input.issue,
          };
        },
      },
    });

    await service.start();
    await Promise.resolve();
    await Promise.resolve();

    const issueSnapshot = (service as any).getRuntimeIssueSnapshot("ATH-551");
    expect(issueSnapshot).not.toBeNull();
    expect(issueSnapshot.events_count).toBe(200);
    expect(issueSnapshot.events_limit).toBe(200);
    expect(issueSnapshot.events_truncated).toBe(true);
    expect(issueSnapshot.events[0].seq).toBeGreaterThan(1);

    await service.stop();
  });

  it("includes retry queue rows in runtime snapshot after worker failure", async () => {
    let nowMs = 10_000;
    const candidates = [issue({ id: "retry-1", identifier: "ATH-401", state: "Todo" })];

    const service = createSymphonyService({
      workflowPath: "/tmp/WORKFLOW.md",
      deps: {
        nowMs: () => nowMs,
        loadWorkflowFile: async () => workflow(1000),
        createTracker: () => ({
          async fetchCandidateIssues() {
            return candidates.splice(0, candidates.length);
          },
          async fetchIssuesByStates() {
            return [];
          },
          async fetchIssueStatesByIds() {
            return [];
          },
        }),
        cleanupTerminalIssueWorkspaces: async () => ({ removed: 0, failed: 0, warnings: [] }),
        processDueRetries: async () => ({
          processedIssueIds: [],
          dispatchedIssueIds: [],
          requeuedIssueIds: [],
          releasedIssueIds: [],
        }),
        setIntervalFn: () => {
          return 1 as unknown as ReturnType<typeof setInterval>;
        },
        clearIntervalFn: () => {
          return;
        },
        runIssueAttempt: async () => {
          throw new Error("boom");
        },
      },
    });

    await service.start();
    await Promise.resolve();
    await Promise.resolve();

    const snapshot = service.getRuntimeSnapshot();
    expect(snapshot.running).toHaveLength(0);
    expect(snapshot.retrying).toHaveLength(1);
    expect(snapshot.retrying[0]).toMatchObject({
      issue_id: "retry-1",
      issue_identifier: "ATH-401",
      attempt: 1,
      error: "boom",
    });
    expect(snapshot.retrying[0]!.due_at_ms).toBe(nowMs + 10_000);
    expect(snapshot.completed).toEqual([]);

    await service.stop();
  });

  it("writes back tracker comments and moves issue to In Progress on dispatch", async () => {
    const comments: string[] = [];
    const transitioned: string[] = [];
    const candidates = [
      issue({
        id: "writeback-1",
        identifier: "ATH-777",
        state: "Todo",
        labels: ["pkg:storefront-webapp"],
        description: "Implement product search with clear acceptance criteria and validation steps.",
        team_id: "team-1",
      }),
    ];

    const service = createSymphonyService({
      workflowPath: "/tmp/WORKFLOW.md",
      deps: {
        loadWorkflowFile: async () => workflow(1000),
        createTracker: () => ({
          async fetchCandidateIssues() {
            return candidates.splice(0, candidates.length);
          },
          async fetchIssuesByStates() {
            return [];
          },
          async fetchIssueStatesByIds() {
            return [];
          },
          async createIssueComment(input) {
            comments.push(input.body);
          },
          async updateIssueStateByName(input) {
            transitioned.push(`${input.issue.identifier}:${input.stateName}`);
            return true;
          },
        }),
        cleanupTerminalIssueWorkspaces: async () => ({ removed: 0, failed: 0, warnings: [] }),
        processDueRetries: async () => ({
          processedIssueIds: [],
          dispatchedIssueIds: [],
          requeuedIssueIds: [],
          releasedIssueIds: [],
        }),
        setIntervalFn: () => 1 as unknown as ReturnType<typeof setInterval>,
        clearIntervalFn: () => {},
        runIssueAttempt: async (input) => ({
          exit: "normal" as const,
          turnCount: 1,
          workspacePath: "/tmp/fake",
          issue: input.issue,
        }),
      },
    });

    await service.start();
    await Promise.resolve();
    await Promise.resolve();

    expect(transitioned).toEqual(["ATH-777:In Progress"]);
    expect(comments.some((entry) => entry.includes("started work"))).toBe(true);
    expect(comments.some((entry) => entry.includes("finished a run"))).toBe(true);
    expect(comments.some((entry) => entry.includes("delivery complete signal"))).toBe(false);

    await service.stop();
  });

  it("records completion signal and emits delivery comment when issue reaches handoff state", async () => {
    const comments: string[] = [];
    const candidates = [
      issue({
        id: "handoff-1",
        identifier: "ATH-900",
        state: "Todo",
        labels: ["pkg:symphony-service"],
        description: "Implement orchestration with clear acceptance criteria and validation steps.",
        team_id: "team-1",
      }),
    ];

    const service = createSymphonyService({
      workflowPath: "/tmp/WORKFLOW.md",
      deps: {
        loadWorkflowFile: async () => ({
          path: "/tmp/WORKFLOW.md",
          config: {
            tracker: {
              kind: "linear",
              api_key: "key",
              project_slug: "ATH",
              handoff_state: "Human Review",
            },
            polling: {
              interval_ms: 1000,
            },
            codex: {
              command: "codex app-server",
            },
          },
          promptTemplate: "Issue {{ issue.identifier }}",
        }),
        createTracker: () => ({
          async fetchCandidateIssues() {
            return candidates.splice(0, candidates.length);
          },
          async fetchIssuesByStates() {
            return [];
          },
          async fetchIssueStatesByIds() {
            return [];
          },
          async createIssueComment(input) {
            comments.push(input.body);
          },
          async updateIssueStateByName() {
            return true;
          },
        }),
        cleanupTerminalIssueWorkspaces: async () => ({ removed: 0, failed: 0, warnings: [] }),
        processDueRetries: async () => ({
          processedIssueIds: [],
          dispatchedIssueIds: [],
          requeuedIssueIds: [],
          releasedIssueIds: [],
        }),
        setIntervalFn: () => 1 as unknown as ReturnType<typeof setInterval>,
        clearIntervalFn: () => {},
        runIssueAttempt: async (input) => ({
          exit: "normal" as const,
          turnCount: 2,
          workspacePath: "/tmp/fake",
          issue: {
            ...input.issue,
            state: "Human Review",
          },
        }),
      },
    });

    await service.start();
    await Promise.resolve();
    await Promise.resolve();

    const snapshot = service.getRuntimeSnapshot();
    expect(snapshot.completed).toHaveLength(1);
    expect(snapshot.completed[0]).toMatchObject({
      issue_id: "handoff-1",
      issue_identifier: "ATH-900",
      state: "Human Review",
      done: true,
    });
    expect(comments.some((entry) => entry.includes("delivery complete signal"))).toBe(true);

    await service.stop();
  });

  it("moves issue to handoff and blocks continuation when attempt guardrail stops run", async () => {
    const comments: string[] = [];
    const transitioned: string[] = [];
    const candidates = [
      issue({
        id: "guardrail-stop-1",
        identifier: "ATH-901",
        state: "Todo",
        labels: ["pkg:symphony-service"],
        description: "Implement guardrails with clear acceptance criteria and validation details.",
        team_id: "team-1",
      }),
    ];

    const service = createSymphonyService({
      workflowPath: "/tmp/WORKFLOW.md",
      deps: {
        loadWorkflowFile: async () => workflow(1000),
        createTracker: () => ({
          async fetchCandidateIssues() {
            return candidates.splice(0, candidates.length);
          },
          async fetchIssuesByStates() {
            return [];
          },
          async fetchIssueStatesByIds() {
            return [];
          },
          async createIssueComment(input) {
            comments.push(input.body);
          },
          async updateIssueStateByName(input) {
            transitioned.push(`${input.issue.identifier}:${input.stateName}`);
            return true;
          },
        }),
        cleanupTerminalIssueWorkspaces: async () => ({ removed: 0, failed: 0, warnings: [] }),
        processDueRetries: async () => ({
          processedIssueIds: [],
          dispatchedIssueIds: [],
          requeuedIssueIds: [],
          releasedIssueIds: [],
        }),
        setIntervalFn: () => 1 as unknown as ReturnType<typeof setInterval>,
        clearIntervalFn: () => {},
        runIssueAttempt: async (input) => ({
          exit: "guardrail_stop" as const,
          guardrail_reason: "attempt_input_budget_exceeded" as const,
          turnCount: 3,
          workspacePath: "/tmp/fake",
          issue: input.issue,
        }),
      },
    });

    await service.start();
    await Promise.resolve();
    await Promise.resolve();

    const snapshot = service.getRuntimeSnapshot();
    expect(snapshot.retrying).toHaveLength(0);
    expect(transitioned).toEqual(["ATH-901:In Progress", "ATH-901:Human Review"]);
    expect(comments.some((entry) => entry.includes("guardrail"))).toBe(true);

    await service.stop();
  });

  it("moves issue to handoff and blocks retry when in-flight attempt input budget is exceeded", async () => {
    const comments: string[] = [];
    const transitioned: string[] = [];
    let releaseWorker: (() => void) | null = null;
    let stopCalled = false;
    let stopRequested = false;
    const candidates = [
      issue({
        id: "inflight-guardrail-1",
        identifier: "ATH-902",
        state: "Todo",
        labels: ["pkg:symphony-service"],
        description: "Harden runtime behavior with clear acceptance criteria and validation details.",
        team_id: "team-1",
      }),
    ];

    const service = createSymphonyService({
      workflowPath: "/tmp/WORKFLOW.md",
      deps: {
        loadWorkflowFile: async () => workflow(1000),
        createTracker: () => ({
          async fetchCandidateIssues() {
            return candidates.splice(0, candidates.length);
          },
          async fetchIssuesByStates() {
            return [];
          },
          async fetchIssueStatesByIds() {
            return [];
          },
          async createIssueComment(input) {
            comments.push(input.body);
          },
          async updateIssueStateByName(input) {
            transitioned.push(`${input.issue.identifier}:${input.stateName}`);
            return true;
          },
        }),
        createCodexClient: (_config, onEvent) => {
          onEvent?.({
            event: "notification",
            timestamp: new Date().toISOString(),
            session_id: "thread-902-turn-1",
            usage: {
              input_tokens: 175_000,
              output_tokens: 22,
              total_tokens: 175_022,
            },
          });

          return {
            async startSession() {
              return { threadId: "thread-902" };
            },
            async runTurn() {
              return { turnId: "turn-1", sessionId: "thread-902-turn-1", outcome: "completed" as const };
            },
            stop() {
              stopCalled = true;
              stopRequested = true;
              releaseWorker?.();
            },
          };
        },
        cleanupTerminalIssueWorkspaces: async () => ({ removed: 0, failed: 0, warnings: [] }),
        processDueRetries: async () => ({
          processedIssueIds: [],
          dispatchedIssueIds: [],
          requeuedIssueIds: [],
          releasedIssueIds: [],
        }),
        setIntervalFn: () => 1 as unknown as ReturnType<typeof setInterval>,
        clearIntervalFn: () => {},
        runIssueAttempt: async () => {
          if (stopRequested) {
            throw new Error("codex turn ended with non-completed outcome: port_exit");
          }

          await new Promise<void>((resolve) => {
            releaseWorker = resolve;
          });

          throw new Error("codex turn ended with non-completed outcome: port_exit");
        },
      },
    });

    await service.start();
    await Promise.resolve();
    await Promise.resolve();

    await service.runTickOnce();
    for (let index = 0; index < 20 && !transitioned.includes("ATH-902:Human Review"); index += 1) {
      await Promise.resolve();
    }

    const snapshot = service.getRuntimeSnapshot();
    expect(stopCalled).toBe(true);
    expect(snapshot.retrying).toHaveLength(0);
    expect(transitioned).toEqual(["ATH-902:In Progress", "ATH-902:Human Review"]);
    expect(comments.some((entry) => entry.includes("paused automatic continuation"))).toBe(true);
    expect(comments.some((entry) => entry.includes("attempt input token budget exceeded"))).toBe(true);

    await service.stop();
  });

  it("blocks issues that fail intake guardrails and comments once", async () => {
    const comments: string[] = [];
    const runIssueAttempt = vi.fn(async (input: any) => ({
      exit: "normal" as const,
      turnCount: 0,
      workspacePath: "/tmp/fake",
      issue: input.issue,
    }));

    const candidateIssue = issue({
      id: "guardrail-1",
      identifier: "ATH-778",
      state: "Todo",
      labels: [],
      description: "short",
    });

    const service = createSymphonyService({
      workflowPath: "/tmp/WORKFLOW.md",
      deps: {
        loadWorkflowFile: async () => workflow(1000),
        createTracker: () => ({
          async fetchCandidateIssues() {
            return [candidateIssue];
          },
          async fetchIssuesByStates() {
            return [];
          },
          async fetchIssueStatesByIds() {
            return [];
          },
          async createIssueComment(input) {
            comments.push(input.body);
          },
        }),
        cleanupTerminalIssueWorkspaces: async () => ({ removed: 0, failed: 0, warnings: [] }),
        processDueRetries: async () => ({
          processedIssueIds: [],
          dispatchedIssueIds: [],
          requeuedIssueIds: [],
          releasedIssueIds: [],
        }),
        setIntervalFn: () => 1 as unknown as ReturnType<typeof setInterval>,
        clearIntervalFn: () => {},
        runIssueAttempt: runIssueAttempt as any,
      },
    });

    await service.start();
    await service.runTickOnce();

    expect(runIssueAttempt).not.toHaveBeenCalled();
    expect(comments).toHaveLength(1);
    expect(comments[0]).toContain("guardrails");
    expect(service.getRuntimeSnapshot().retrying).toHaveLength(0);

    await service.stop();
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
