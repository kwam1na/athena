import { toErrorMessage } from "./errors";
import type { NormalizedIssue, TrackerClient } from "./issue";
import {
  getStalledIssueIds,
  markIssueRunning,
  onWorkerExit,
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
