import { describe, expect, it } from "vitest";
import type { EffectiveConfig } from "../src/types";
import type { NormalizedIssue, TrackerClient } from "../src/issue";
import { createOrchestratorState, markIssueRunning, scheduleRetry } from "../src/orchestrator";
import { processDueRetries, runOrchestratorTick } from "../src/runtime";

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

class FakeTracker implements TrackerClient {
  constructor(
    private readonly candidates: NormalizedIssue[],
    private readonly refreshed: NormalizedIssue[] = [],
  ) {}

  async fetchCandidateIssues(): Promise<NormalizedIssue[]> {
    return this.candidates;
  }

  async fetchIssuesByStates(): Promise<NormalizedIssue[]> {
    return [];
  }

  async fetchIssueStatesByIds(): Promise<NormalizedIssue[]> {
    return this.refreshed;
  }
}

function config(partial?: Partial<EffectiveConfig>): EffectiveConfig {
  return {
    tracker: {
      kind: partial?.tracker?.kind ?? "linear",
      endpoint: partial?.tracker?.endpoint ?? "https://api.linear.app/graphql",
      apiKey: partial?.tracker?.apiKey ?? "key",
      projectSlug: partial?.tracker?.projectSlug ?? "ATH",
      activeStates: partial?.tracker?.activeStates ?? ["Todo", "In Progress"],
      terminalStates: partial?.tracker?.terminalStates ?? ["Done", "Closed"],
    },
    polling: {
      intervalMs: partial?.polling?.intervalMs ?? 30_000,
    },
    workspace: {
      root: partial?.workspace?.root ?? "/tmp/symphony",
    },
    hooks: {
      afterCreate: partial?.hooks?.afterCreate,
      beforeRun: partial?.hooks?.beforeRun,
      afterRun: partial?.hooks?.afterRun,
      beforeRemove: partial?.hooks?.beforeRemove,
      timeoutMs: partial?.hooks?.timeoutMs ?? 60_000,
    },
    agent: {
      maxConcurrentAgents: partial?.agent?.maxConcurrentAgents ?? 2,
      maxRetryBackoffMs: partial?.agent?.maxRetryBackoffMs ?? 300_000,
      maxTurns: partial?.agent?.maxTurns ?? 20,
      maxConcurrentAgentsByState: partial?.agent?.maxConcurrentAgentsByState ?? {},
    },
    codex: {
      command: partial?.codex?.command ?? "codex app-server",
      clientName: partial?.codex?.clientName ?? "symphony",
      clientVersion: partial?.codex?.clientVersion ?? "test",
      clientCapabilities: partial?.codex?.clientCapabilities ?? {},
      approvalPolicy: partial?.codex?.approvalPolicy,
      threadSandbox: partial?.codex?.threadSandbox,
      turnSandboxPolicy: partial?.codex?.turnSandboxPolicy,
      turnTimeoutMs: partial?.codex?.turnTimeoutMs ?? 3_600_000,
      readTimeoutMs: partial?.codex?.readTimeoutMs ?? 5_000,
      stallTimeoutMs: partial?.codex?.stallTimeoutMs ?? 300_000,
    },
  };
}

describe("runOrchestratorTick", () => {
  it("reconciles before dispatch preflight and skips dispatch on validation failure", async () => {
    const state = createOrchestratorState();
    markIssueRunning(
      state,
      issue({
        id: "running-1",
        identifier: "ATH-11",
        state: "In Progress",
      }),
      1000,
      null,
    );

    const actions: string[] = [];
    const result = await runOrchestratorTick({
      state,
      tracker: new FakeTracker(
        [issue({ id: "todo-1", identifier: "ATH-1", state: "Todo" })],
        [issue({ id: "running-1", identifier: "ATH-11", state: "Done" })],
      ),
      config: config(),
      nowMs: 2000,
      validatePreflight: () => {
        throw new Error("invalid config");
      },
      onReconcileAction: (action) => {
        actions.push(action.action);
      },
      dispatchIssue: async () => {
        throw new Error("dispatch should not run");
      },
    });

    expect(actions).toEqual(["terminate_cleanup"]);
    expect(result.skippedDispatch).toBe(true);
    expect(result.selectedIssueIds).toEqual([]);
    expect(result.dispatchedIssueIds).toEqual([]);
  });

  it("dispatches selected issues and marks them running", async () => {
    const state = createOrchestratorState();
    const dispatched: string[] = [];

    const result = await runOrchestratorTick({
      state,
      tracker: new FakeTracker([
        issue({ id: "todo-1", identifier: "ATH-1", state: "Todo", priority: 1 }),
        issue({ id: "todo-2", identifier: "ATH-2", state: "Todo", priority: 2 }),
      ]),
      config: config(),
      nowMs: 100,
      dispatchIssue: async (input) => {
        dispatched.push(input.issue.id);
      },
    });

    expect(result.selectedIssueIds).toEqual(["todo-1", "todo-2"]);
    expect(result.dispatchedIssueIds).toEqual(["todo-1", "todo-2"]);
    expect(dispatched).toEqual(["todo-1", "todo-2"]);
    expect(state.running.has("todo-1")).toBe(true);
    expect(state.running.has("todo-2")).toBe(true);
    expect(state.retryAttempts.size).toBe(0);
  });

  it("schedules retry when dispatch fails", async () => {
    const state = createOrchestratorState();

    await runOrchestratorTick({
      state,
      tracker: new FakeTracker([issue({ id: "todo-1", identifier: "ATH-1", state: "Todo" })]),
      config: config(),
      nowMs: 500,
      dispatchIssue: async () => {
        throw new Error("spawn failed");
      },
    });

    const retry = state.retryAttempts.get("todo-1");
    expect(retry?.attempt).toBe(1);
    expect(retry?.error).toContain("spawn failed");
    expect(state.running.has("todo-1")).toBe(false);
  });

  it("queues failure retry for stalled running issues", async () => {
    const state = createOrchestratorState();
    markIssueRunning(
      state,
      issue({
        id: "running-stalled",
        identifier: "ATH-20",
        state: "In Progress",
      }),
      1000,
      null,
    );

    const terminated: string[] = [];

    await runOrchestratorTick({
      state,
      tracker: new FakeTracker([]),
      config: config({
        codex: {
          command: "codex app-server",
          clientName: "symphony",
          clientVersion: "test",
          clientCapabilities: {},
          turnTimeoutMs: 3_600_000,
          readTimeoutMs: 5_000,
          stallTimeoutMs: 2000,
        },
      }),
      nowMs: 6000,
      dispatchIssue: async () => {},
      onStalledIssue: (issueId) => {
        terminated.push(issueId);
      },
    });

    expect(terminated).toEqual(["running-stalled"]);
    expect(state.running.has("running-stalled")).toBe(false);
    expect(state.retryAttempts.get("running-stalled")?.attempt).toBe(1);
    expect(state.retryAttempts.get("running-stalled")?.error).toBe("stall_timeout");
  });
});

describe("processDueRetries", () => {
  it("dispatches due retry when issue is found and slot is available", async () => {
    const state = createOrchestratorState();

    scheduleRetry(state, {
      issueId: "todo-1",
      identifier: "ATH-1",
      attempt: 2,
      nowMs: 0,
      maxRetryBackoffMs: 300_000,
      mode: "continuation",
      error: "retry",
    });

    const dispatched: string[] = [];

    const result = await processDueRetries({
      state,
      tracker: new FakeTracker([issue({ id: "todo-1", identifier: "ATH-1", state: "Todo" })]),
      config: config(),
      nowMs: 1000,
      dispatchIssue: async (input) => {
        dispatched.push(`${input.issue.id}:${input.attempt}`);
      },
    });

    expect(result.processedIssueIds).toEqual(["todo-1"]);
    expect(result.dispatchedIssueIds).toEqual(["todo-1"]);
    expect(dispatched).toEqual(["todo-1:2"]);
    expect(state.running.has("todo-1")).toBe(true);
    expect(state.retryAttempts.has("todo-1")).toBe(false);
  });

  it("releases claim when due retry issue is no longer active", async () => {
    const state = createOrchestratorState();
    state.claimed.add("todo-2");
    scheduleRetry(state, {
      issueId: "todo-2",
      identifier: "ATH-2",
      attempt: 1,
      nowMs: 0,
      maxRetryBackoffMs: 300_000,
      mode: "continuation",
      error: "retry",
    });

    const result = await processDueRetries({
      state,
      tracker: new FakeTracker([]),
      config: config(),
      nowMs: 1000,
      dispatchIssue: async () => {},
    });

    expect(result.releasedIssueIds).toEqual(["todo-2"]);
    expect(state.claimed.has("todo-2")).toBe(false);
    expect(state.retryAttempts.has("todo-2")).toBe(false);
  });

  it("requeues due retry when no slots are available", async () => {
    const state = createOrchestratorState();
    markIssueRunning(state, issue({ id: "running", state: "In Progress" }), 0, null);
    scheduleRetry(state, {
      issueId: "todo-3",
      identifier: "ATH-3",
      attempt: 1,
      nowMs: 0,
      maxRetryBackoffMs: 300_000,
      mode: "continuation",
      error: "retry",
    });

    const result = await processDueRetries({
      state,
      tracker: new FakeTracker([issue({ id: "todo-3", identifier: "ATH-3", state: "Todo" })]),
      config: config({
        agent: {
          maxConcurrentAgents: 1,
          maxRetryBackoffMs: 300_000,
          maxTurns: 20,
          maxConcurrentAgentsByState: {},
        },
      }),
      nowMs: 1000,
      dispatchIssue: async () => {},
    });

    expect(result.requeuedIssueIds).toEqual(["todo-3"]);
    expect(state.retryAttempts.get("todo-3")?.attempt).toBe(1);
    expect(state.retryAttempts.get("todo-3")?.error).toBe("no available orchestrator slots");
  });
});
