import { describe, expect, it } from "vitest";
import type { NormalizedIssue } from "../src/issue";
import {
  createOrchestratorState,
  getAvailableGlobalSlots,
  getStalledIssueIds,
  markIssueRunning,
  onWorkerExit,
  reconcileRunningIssueStates,
  scheduleRetry,
  selectDispatchCandidates,
} from "../src/orchestrator";

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

describe("orchestrator state", () => {
  it("creates empty state", () => {
    const state = createOrchestratorState();
    expect(state.running.size).toBe(0);
    expect(state.claimed.size).toBe(0);
    expect(state.retryAttempts.size).toBe(0);
  });

  it("marks issue running and calculates global slots", () => {
    const state = createOrchestratorState();
    markIssueRunning(state, issue({ id: "a" }), 1000, null);

    expect(state.running.has("a")).toBe(true);
    expect(state.claimed.has("a")).toBe(true);
    expect(getAvailableGlobalSlots(state, 2)).toBe(1);
  });
});

describe("dispatch selection", () => {
  it("respects global and per-state concurrency limits", () => {
    const state = createOrchestratorState();
    markIssueRunning(state, issue({ id: "inprog-1", identifier: "ATH-10", state: "In Progress" }), 0, null);

    const selected = selectDispatchCandidates({
      candidates: [
        issue({ id: "todo-1", identifier: "ATH-1", state: "Todo", priority: 1 }),
        issue({ id: "inprog-2", identifier: "ATH-2", state: "In Progress", priority: 1 }),
        issue({ id: "todo-2", identifier: "ATH-3", state: "Todo", priority: 2 }),
      ],
      state,
      activeStates: ["Todo", "In Progress"],
      terminalStates: ["Done", "Closed"],
      maxConcurrentAgents: 3,
      maxConcurrentAgentsByState: {
        "in progress": 1,
      },
    });

    expect(selected.map((item) => item.id)).toEqual(["todo-1", "todo-2"]);
  });

  it("skips blocked Todo issues when blockers are non-terminal", () => {
    const state = createOrchestratorState();

    const selected = selectDispatchCandidates({
      candidates: [
        issue({
          id: "todo-blocked",
          blocked_by: [{ id: "x", identifier: "ATH-X", state: "In Progress" }],
        }),
      ],
      state,
      activeStates: ["Todo", "In Progress"],
      terminalStates: ["Done", "Closed"],
      maxConcurrentAgents: 2,
      maxConcurrentAgentsByState: {},
    });

    expect(selected).toHaveLength(0);
  });
});

describe("retry scheduling", () => {
  it("schedules continuation retry after normal worker exit", () => {
    const state = createOrchestratorState();
    markIssueRunning(state, issue({ id: "a", identifier: "ATH-1" }), 0, 3);

    const retry = onWorkerExit(state, {
      issueId: "a",
      nowMs: 2000,
      reason: "normal",
      maxRetryBackoffMs: 300000,
    });

    expect(retry?.attempt).toBe(1);
    expect(retry?.dueAtMs).toBe(3000);
    expect(state.completed.has("a")).toBe(true);
  });

  it("schedules exponential backoff retry after failure", () => {
    const state = createOrchestratorState();
    markIssueRunning(state, issue({ id: "b", identifier: "ATH-2" }), 0, 2);

    const retry = onWorkerExit(state, {
      issueId: "b",
      nowMs: 1000,
      reason: "failure",
      maxRetryBackoffMs: 300000,
      error: "turn_failed",
    });

    expect(retry?.attempt).toBe(3);
    expect(retry?.dueAtMs).toBe(41000);
    expect(retry?.error).toBe("turn_failed");
  });

  it("replaces existing retry entry for same issue", () => {
    const state = createOrchestratorState();

    scheduleRetry(state, {
      issueId: "x",
      identifier: "ATH-X",
      attempt: 1,
      nowMs: 0,
      maxRetryBackoffMs: 300000,
      mode: "failure",
      error: "old",
    });

    scheduleRetry(state, {
      issueId: "x",
      identifier: "ATH-X",
      attempt: 2,
      nowMs: 0,
      maxRetryBackoffMs: 300000,
      mode: "failure",
      error: "new",
    });

    expect(state.retryAttempts.get("x")?.attempt).toBe(2);
    expect(state.retryAttempts.get("x")?.error).toBe("new");
  });
});

describe("reconciliation", () => {
  it("flags terminal and non-active issues for termination and updates active snapshots", () => {
    const state = createOrchestratorState();
    markIssueRunning(state, issue({ id: "a", identifier: "ATH-1", state: "In Progress" }), 0, null);
    markIssueRunning(state, issue({ id: "b", identifier: "ATH-2", state: "In Progress" }), 0, null);
    markIssueRunning(state, issue({ id: "c", identifier: "ATH-3", state: "In Progress" }), 0, null);

    const actions = reconcileRunningIssueStates(state, {
      refreshed: [
        issue({ id: "a", identifier: "ATH-1", state: "Done" }),
        issue({ id: "b", identifier: "ATH-2", state: "Backlog" }),
        issue({ id: "c", identifier: "ATH-3", state: "In Progress", title: "Updated" }),
      ],
      activeStates: ["Todo", "In Progress"],
      terminalStates: ["Done", "Closed"],
    });

    expect(actions).toEqual([
      { issueId: "a", identifier: "ATH-1", action: "terminate_cleanup" },
      { issueId: "b", identifier: "ATH-2", action: "terminate_keep" },
      { issueId: "c", identifier: "ATH-3", action: "update_snapshot" },
    ]);

    expect(state.running.get("c")?.issue.title).toBe("Updated");
  });

  it("detects stalled sessions based on last codex activity", () => {
    const state = createOrchestratorState();
    markIssueRunning(state, issue({ id: "a" }), 1000, null);
    markIssueRunning(state, issue({ id: "b" }), 1000, null);

    const b = state.running.get("b");
    if (b) {
      b.lastCodexTimestampMs = 4900;
      state.running.set("b", b);
    }

    const stalled = getStalledIssueIds(state, {
      nowMs: 7000,
      stallTimeoutMs: 3000,
    });

    expect(stalled).toEqual(["a"]);
    expect(getStalledIssueIds(state, { nowMs: 7000, stallTimeoutMs: 0 })).toEqual([]);
  });
});
