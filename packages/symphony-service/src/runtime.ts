import { toErrorMessage } from "./errors";
import type { NormalizedIssue, TrackerClient } from "./issue";
import {
  getStalledIssueIds,
  markIssueRunning,
  onWorkerExit,
  type RetryEntry,
  reconcileRunningIssueStates,
  selectDispatchCandidates,
  type OrchestratorState,
  type ReconcileAction,
  scheduleRetry,
} from "./orchestrator";
import type { EffectiveConfig } from "./types";
import { validateDispatchPreflight } from "./validate";

export interface DispatchInput {
  issue: NormalizedIssue;
  attempt: number;
}

export interface RunOrchestratorTickInput {
  state: OrchestratorState;
  tracker: TrackerClient;
  config: EffectiveConfig;
  nowMs: number;
  dispatchIssue: (input: DispatchInput) => Promise<void>;
  validatePreflight?: () => void;
  onReconcileAction?: (action: ReconcileAction) => void | Promise<void>;
  onStalledIssue?: (issueId: string) => void | Promise<void>;
}

export interface RunOrchestratorTickResult {
  skippedDispatch: boolean;
  selectedIssueIds: string[];
  dispatchedIssueIds: string[];
  dispatchErrors: Array<{ issueId: string; error: string }>;
  reconcileActions: ReconcileAction[];
  stalledIssueIds: string[];
  preflightError?: string;
}

export interface ProcessDueRetriesInput {
  state: OrchestratorState;
  tracker: TrackerClient;
  config: EffectiveConfig;
  nowMs: number;
  dispatchIssue: (input: DispatchInput) => Promise<void>;
}

export interface ProcessDueRetriesResult {
  processedIssueIds: string[];
  dispatchedIssueIds: string[];
  requeuedIssueIds: string[];
  releasedIssueIds: string[];
}

export async function runOrchestratorTick(input: RunOrchestratorTickInput): Promise<RunOrchestratorTickResult> {
  const stalledIssueIds = getStalledIssueIds(input.state, {
    nowMs: input.nowMs,
    stallTimeoutMs: input.config.codex.stallTimeoutMs,
  });

  for (const issueId of stalledIssueIds) {
    await input.onStalledIssue?.(issueId);
    onWorkerExit(input.state, {
      issueId,
      nowMs: input.nowMs,
      reason: "failure",
      maxRetryBackoffMs: input.config.agent.maxRetryBackoffMs,
      error: "stall_timeout",
    });
  }

  const reconcileActions = await reconcileRunningIssues(input);

  try {
    if (input.validatePreflight) {
      input.validatePreflight();
    } else {
      validateDispatchPreflight(input.config);
    }
  } catch (error) {
    return {
      skippedDispatch: true,
      selectedIssueIds: [],
      dispatchedIssueIds: [],
      dispatchErrors: [],
      reconcileActions,
      stalledIssueIds,
      preflightError: toErrorMessage(error),
    };
  }

  const candidates = await input.tracker.fetchCandidateIssues();

  const selected = selectDispatchCandidates({
    candidates,
    state: input.state,
    activeStates: input.config.tracker.activeStates,
    terminalStates: input.config.tracker.terminalStates,
    maxConcurrentAgents: input.config.agent.maxConcurrentAgents,
    maxConcurrentAgentsByState: input.config.agent.maxConcurrentAgentsByState,
  });

  const selectedIssueIds = selected.map((issue) => issue.id);
  const dispatchedIssueIds: string[] = [];
  const dispatchErrors: Array<{ issueId: string; error: string }> = [];

  for (const issue of selected) {
    const existingRetryAttempt = input.state.retryAttempts.get(issue.id)?.attempt ?? null;
    const dispatchAttempt = normalizeDispatchAttempt(existingRetryAttempt);

    try {
      await input.dispatchIssue({
        issue,
        attempt: dispatchAttempt,
      });

      markIssueRunning(input.state, issue, input.nowMs, existingRetryAttempt);
      dispatchedIssueIds.push(issue.id);
    } catch (error) {
      const message = toErrorMessage(error);
      dispatchErrors.push({
        issueId: issue.id,
        error: message,
      });

      if (isGuardrailBlockedError(error)) {
        continue;
      }

      scheduleRetry(input.state, {
        issueId: issue.id,
        identifier: issue.identifier,
        attempt: nextRetryAttempt(existingRetryAttempt),
        nowMs: input.nowMs,
        maxRetryBackoffMs: input.config.agent.maxRetryBackoffMs,
        mode: "failure",
        error: message,
      });
    }
  }

  return {
    skippedDispatch: false,
    selectedIssueIds,
    dispatchedIssueIds,
    dispatchErrors,
    reconcileActions,
    stalledIssueIds,
  };
}

function isGuardrailBlockedError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  return (error as { code?: unknown }).code === "guardrail_blocked";
}

async function reconcileRunningIssues(input: RunOrchestratorTickInput): Promise<ReconcileAction[]> {
  if (input.state.running.size === 0) {
    return [];
  }

  const runningIds = Array.from(input.state.running.keys());

  try {
    const refreshed = await input.tracker.fetchIssueStatesByIds(runningIds);
    const actions = reconcileRunningIssueStates(input.state, {
      refreshed,
      activeStates: input.config.tracker.activeStates,
      terminalStates: input.config.tracker.terminalStates,
    });

    for (const action of actions) {
      await input.onReconcileAction?.(action);
    }

    return actions;
  } catch {
    return [];
  }
}

function normalizeDispatchAttempt(retryAttempt: number | null): number {
  if (typeof retryAttempt === "number" && Number.isFinite(retryAttempt) && retryAttempt > 0) {
    return Math.trunc(retryAttempt);
  }

  return 1;
}

function nextRetryAttempt(retryAttempt: number | null): number {
  if (typeof retryAttempt === "number" && Number.isFinite(retryAttempt) && retryAttempt > 0) {
    return Math.trunc(retryAttempt) + 1;
  }

  return 1;
}

export async function processDueRetries(input: ProcessDueRetriesInput): Promise<ProcessDueRetriesResult> {
  const dueEntries = Array.from(input.state.retryAttempts.values())
    .filter((entry) => entry.dueAtMs <= input.nowMs)
    .sort((a, b) => a.dueAtMs - b.dueAtMs);

  if (dueEntries.length === 0) {
    return {
      processedIssueIds: [],
      dispatchedIssueIds: [],
      requeuedIssueIds: [],
      releasedIssueIds: [],
    };
  }

  const processedIssueIds: string[] = [];
  const dispatchedIssueIds: string[] = [];
  const requeuedIssueIds: string[] = [];
  const releasedIssueIds: string[] = [];

  for (const entry of dueEntries) {
    input.state.retryAttempts.delete(entry.issueId);
    processedIssueIds.push(entry.issueId);
  }

  let candidates: NormalizedIssue[];
  try {
    candidates = await input.tracker.fetchCandidateIssues();
  } catch (error) {
    const message = `retry poll failed: ${toErrorMessage(error)}`;
    for (const entry of dueEntries) {
      requeueRetryEntry(input, entry, {
        attempt: entry.attempt + 1,
        mode: "failure",
        error: message,
      });
      requeuedIssueIds.push(entry.issueId);
    }

    return {
      processedIssueIds,
      dispatchedIssueIds,
      requeuedIssueIds,
      releasedIssueIds,
    };
  }

  const activeStates = new Set(input.config.tracker.activeStates);
  const terminalStates = new Set(input.config.tracker.terminalStates);
  const candidatesById = new Map(candidates.map((issue) => [issue.id, issue]));

  for (const entry of dueEntries) {
    const issue = candidatesById.get(entry.issueId);
    if (!issue) {
      input.state.claimed.delete(entry.issueId);
      releasedIssueIds.push(entry.issueId);
      continue;
    }

    if (!activeStates.has(issue.state) || terminalStates.has(issue.state)) {
      input.state.claimed.delete(entry.issueId);
      releasedIssueIds.push(entry.issueId);
      continue;
    }

    if (!canDispatchRetryIssue(issue, input.state, input.config)) {
      requeueRetryEntry(input, entry, {
        attempt: entry.attempt,
        mode: "continuation",
        error: "no available orchestrator slots",
      });
      requeuedIssueIds.push(entry.issueId);
      continue;
    }

    try {
      await input.dispatchIssue({
        issue,
        attempt: normalizeDispatchAttempt(entry.attempt),
      });

      markIssueRunning(input.state, issue, input.nowMs, entry.attempt);
      dispatchedIssueIds.push(entry.issueId);
    } catch (error) {
      requeueRetryEntry(input, entry, {
        attempt: entry.attempt + 1,
        mode: "failure",
        error: toErrorMessage(error),
      });
      requeuedIssueIds.push(entry.issueId);
    }
  }

  return {
    processedIssueIds,
    dispatchedIssueIds,
    requeuedIssueIds,
    releasedIssueIds,
  };
}

function canDispatchRetryIssue(issue: NormalizedIssue, state: OrchestratorState, config: EffectiveConfig): boolean {
  const tempState: OrchestratorState = {
    claimed: new Set(state.claimed),
    running: state.running,
    retryAttempts: state.retryAttempts,
    completed: state.completed,
  };

  tempState.claimed.delete(issue.id);

  const selected = selectDispatchCandidates({
    candidates: [issue],
    state: tempState,
    activeStates: config.tracker.activeStates,
    terminalStates: config.tracker.terminalStates,
    maxConcurrentAgents: config.agent.maxConcurrentAgents,
    maxConcurrentAgentsByState: config.agent.maxConcurrentAgentsByState,
  });

  return selected.length > 0;
}

function requeueRetryEntry(
  input: ProcessDueRetriesInput,
  entry: RetryEntry,
  options: {
    attempt: number;
    mode: "continuation" | "failure";
    error: string;
  },
): void {
  scheduleRetry(input.state, {
    issueId: entry.issueId,
    identifier: entry.identifier,
    attempt: options.attempt,
    nowMs: input.nowMs,
    maxRetryBackoffMs: input.config.agent.maxRetryBackoffMs,
    mode: options.mode,
    error: options.error,
  });
}
