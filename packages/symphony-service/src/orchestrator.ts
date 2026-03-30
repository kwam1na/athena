import type { NormalizedIssue } from "./issue";
import { calculateContinuationDelay, calculateFailureRetryDelay } from "./retry";
import { isIssueDispatchEligible, sortIssuesForDispatch } from "./scheduler";

export interface RetryEntry {
  issueId: string;
  identifier: string;
  attempt: number;
  dueAtMs: number;
  error: string;
}

export interface RunningEntry {
  issue: NormalizedIssue;
  startedAtMs: number;
  lastCodexTimestampMs: number | null;
  retryAttempt: number;
  turnCount: number;
}

export interface OrchestratorState {
  claimed: Set<string>;
  running: Map<string, RunningEntry>;
  retryAttempts: Map<string, RetryEntry>;
  completed: Set<string>;
}

export interface RetryScheduleInput {
  issueId: string;
  identifier: string;
  attempt: number;
  nowMs: number;
  maxRetryBackoffMs: number;
  mode: "continuation" | "failure";
  error: string;
  continuationDelayMs?: number;
}

export interface ReconcileAction {
  issueId: string;
  identifier: string;
  action: "terminate_cleanup" | "terminate_keep" | "update_snapshot";
}

export function createOrchestratorState(): OrchestratorState {
  return {
    claimed: new Set(),
    running: new Map(),
    retryAttempts: new Map(),
    completed: new Set(),
  };
}

export function markIssueRunning(
  state: OrchestratorState,
  issue: NormalizedIssue,
  nowMs: number,
  attempt: number | null,
): void {
  state.claimed.add(issue.id);
  state.retryAttempts.delete(issue.id);
  state.running.set(issue.id, {
    issue,
    startedAtMs: nowMs,
    lastCodexTimestampMs: null,
    retryAttempt: normalizeRetryAttempt(attempt),
    turnCount: 0,
  });
}

export function getAvailableGlobalSlots(state: OrchestratorState, maxConcurrentAgents: number): number {
  return Math.max(maxConcurrentAgents - state.running.size, 0);
}

export function getRunningCountByState(state: OrchestratorState): Record<string, number> {
  const counts: Record<string, number> = {};

  for (const running of state.running.values()) {
    const key = running.issue.state.toLowerCase();
    counts[key] = (counts[key] ?? 0) + 1;
  }

  return counts;
}

export function selectDispatchCandidates(input: {
  candidates: NormalizedIssue[];
  state: OrchestratorState;
  activeStates: string[];
  terminalStates: string[];
  maxConcurrentAgents: number;
  maxConcurrentAgentsByState: Record<string, number>;
}): NormalizedIssue[] {
  const sorted = sortIssuesForDispatch(input.candidates);
  const availableGlobalSlots = getAvailableGlobalSlots(input.state, input.maxConcurrentAgents);

  if (availableGlobalSlots <= 0) {
    return [];
  }

  const activeStates = new Set(input.activeStates);
  const terminalStates = new Set(input.terminalStates);
  const claimed = new Set(input.state.claimed);
  const running = new Set(input.state.running.keys());
  const runningByState = getRunningCountByState(input.state);

  const selected: NormalizedIssue[] = [];

  for (const issue of sorted) {
    if (selected.length >= availableGlobalSlots) {
      break;
    }

    const eligible = isIssueDispatchEligible(issue, {
      activeStates,
      terminalStates,
      claimedIssueIds: claimed,
      runningIssueIds: running,
    });

    if (!eligible) {
      continue;
    }

    const stateKey = issue.state.toLowerCase();
    const stateLimit = input.maxConcurrentAgentsByState[stateKey];
    if (typeof stateLimit === "number" && stateLimit > 0) {
      const used = runningByState[stateKey] ?? 0;
      if (used >= stateLimit) {
        continue;
      }
    }

    selected.push(issue);
    claimed.add(issue.id);
    running.add(issue.id);
    runningByState[stateKey] = (runningByState[stateKey] ?? 0) + 1;
  }

  return selected;
}

export function scheduleRetry(state: OrchestratorState, input: RetryScheduleInput): RetryEntry {
  const delayMs =
    input.mode === "continuation"
      ? calculateContinuationDelay(input.continuationDelayMs ?? 1_000)
      : calculateFailureRetryDelay(input.attempt, input.maxRetryBackoffMs);

  const entry: RetryEntry = {
    issueId: input.issueId,
    identifier: input.identifier,
    attempt: input.attempt,
    dueAtMs: input.nowMs + delayMs,
    error: input.error,
  };

  state.retryAttempts.set(input.issueId, entry);
  return entry;
}

export function onWorkerExit(
  state: OrchestratorState,
  input: {
    issueId: string;
    nowMs: number;
    reason: "normal" | "failure";
    maxRetryBackoffMs: number;
    error?: string;
    allowContinuation?: boolean;
    continuationDelayMs?: number;
    continuationAttempt?: number;
  },
): RetryEntry | null {
  const running = state.running.get(input.issueId);
  if (!running) {
    return null;
  }

  state.running.delete(input.issueId);

  if (input.reason === "normal") {
    state.completed.add(input.issueId);

    if (input.allowContinuation === false) {
      return null;
    }

    return scheduleRetry(state, {
      issueId: input.issueId,
      identifier: running.issue.identifier,
      attempt: input.continuationAttempt ?? Math.max(running.retryAttempt + 1, 1),
      nowMs: input.nowMs,
      maxRetryBackoffMs: input.maxRetryBackoffMs,
      mode: "continuation",
      error: "continuation_retry",
      continuationDelayMs: input.continuationDelayMs,
    });
  }

  const nextAttempt = running.retryAttempt + 1;
  return scheduleRetry(state, {
    issueId: input.issueId,
    identifier: running.issue.identifier,
    attempt: nextAttempt,
    nowMs: input.nowMs,
    maxRetryBackoffMs: input.maxRetryBackoffMs,
    mode: "failure",
    error: input.error ?? "worker_failed",
  });
}

export function getStalledIssueIds(
  state: OrchestratorState,
  input: {
    nowMs: number;
    stallTimeoutMs: number;
  },
): string[] {
  if (input.stallTimeoutMs <= 0) {
    return [];
  }

  const stalled: string[] = [];

  for (const [issueId, running] of state.running.entries()) {
    const baseline = running.lastCodexTimestampMs ?? running.startedAtMs;
    const elapsedMs = input.nowMs - baseline;
    if (elapsedMs > input.stallTimeoutMs) {
      stalled.push(issueId);
    }
  }

  return stalled;
}

export function reconcileRunningIssueStates(
  state: OrchestratorState,
  input: {
    refreshed: NormalizedIssue[];
    activeStates: string[];
    terminalStates: string[];
  },
): ReconcileAction[] {
  const active = new Set(input.activeStates);
  const terminal = new Set(input.terminalStates);
  const byId = new Map(input.refreshed.map((issue) => [issue.id, issue]));

  const actions: ReconcileAction[] = [];

  for (const [issueId, running] of state.running.entries()) {
    const refreshed = byId.get(issueId);
    if (!refreshed) {
      continue;
    }

    if (terminal.has(refreshed.state)) {
      actions.push({
        issueId,
        identifier: refreshed.identifier,
        action: "terminate_cleanup",
      });
      continue;
    }

    if (!active.has(refreshed.state)) {
      actions.push({
        issueId,
        identifier: refreshed.identifier,
        action: "terminate_keep",
      });
      continue;
    }

    state.running.set(issueId, {
      ...running,
      issue: refreshed,
    });

    actions.push({
      issueId,
      identifier: refreshed.identifier,
      action: "update_snapshot",
    });
  }

  return actions;
}

function normalizeRetryAttempt(value: number | null): number {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.trunc(value);
  }

  return 0;
}
