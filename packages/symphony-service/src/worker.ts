import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { TurnOutcome } from "./codex/client";
import { SymphonyError, toErrorMessage } from "./errors";
import type { NormalizedIssue, TrackerClient } from "./issue";
import { buildIssuePrompt } from "./template";
import type { EffectiveConfig, IssueTemplateInput } from "./types";
import { ensureWorkspaceForIssue, runAfterRunHook, runBeforeRunHook, type WorkspaceConfig } from "./workspace";

const NO_PROGRESS_WINDOW = 3;
const execFileAsync = promisify(execFile);

export interface WorkerCodexClient {
  startSession(input: { cwd: string }): Promise<{ threadId: string }>;
  runTurn(input: {
    threadId: string;
    cwd: string;
    title: string;
    prompt: string;
  }): Promise<{ turnId: string; sessionId: string; outcome: TurnOutcome; usage?: Record<string, number> }>;
  stop(): void;
}

export interface RunIssueAttemptInput {
  issue: NormalizedIssue;
  attempt: number;
  workflowTemplate: string;
  config: EffectiveConfig;
  tracker: TrackerClient;
  createCodexClient: () => WorkerCodexClient;
  onLog?: (entry: { message: string; details?: Record<string, unknown> }) => void;
}

export interface RunIssueAttemptResult {
  exit: "normal" | "guardrail_stop";
  turnCount: number;
  workspacePath: string;
  issue: NormalizedIssue;
  guardrail_reason?: "attempt_input_budget_exceeded" | "no_progress_window_exceeded";
}

export async function runIssueAttempt(input: RunIssueAttemptInput): Promise<RunIssueAttemptResult> {
  const workspaceConfig = toWorkspaceConfig(input.config);
  const workspace = await ensureWorkspaceForIssue(workspaceConfig, input.issue.identifier);
  await runBeforeRunHook(workspaceConfig, workspace.path);

  const codex = input.createCodexClient();
  let shouldStopClient = true;
  let turnCount = 0;
  let cumulativeInputTokens = 0;
  let currentIssue = input.issue;
  let sessionId: string | null = null;
  let previousFingerprint: string | null = null;
  let unchangedFingerprintTurns = 0;

  try {
    const session = await codex.startSession({
      cwd: workspace.path,
    });

    while (shouldContinueTurns(currentIssue, turnCount, input.config)) {
      const prompt = await buildIssuePrompt(input.workflowTemplate, {
        issue: toTemplateIssue(currentIssue),
        attempt: input.attempt,
      });

      const turn = await codex.runTurn({
        threadId: session.threadId,
        cwd: workspace.path,
        title: `${currentIssue.identifier}: ${currentIssue.title}`,
        prompt,
      });
      turnCount += 1;
      sessionId = turn.sessionId;

      const baseDetails = {
        issue_id: currentIssue.id,
        issue_identifier: currentIssue.identifier,
        session_id: turn.sessionId,
        turn_id: turn.turnId,
      };

      if (turn.outcome !== "completed") {
        input.onLog?.({
          message: `action=turn outcome=failed reason=${turn.outcome}`,
          details: baseDetails,
        });

        throw new SymphonyError("worker_turn_failed", `codex turn ended with non-completed outcome: ${turn.outcome}`, {
          details: {
            ...baseDetails,
            outcome: turn.outcome,
          },
        });
      }

      const turnInputTokens = asNumber(turn.usage?.input_tokens ?? turn.usage?.inputTokens) ?? 0;
      cumulativeInputTokens += turnInputTokens;

      input.onLog?.({
        message: "action=turn outcome=completed",
        details: {
          ...baseDetails,
          turn_input_tokens: turnInputTokens,
          cumulative_input_tokens: cumulativeInputTokens,
        },
      });

      const refreshed = await input.tracker.fetchIssueStatesByIds([currentIssue.id]);
      if (Array.isArray(refreshed) && refreshed[0]) {
        currentIssue = refreshed[0];
      }

      if (!shouldContinueTurns(currentIssue, turnCount, input.config)) {
        continue;
      }

      if (cumulativeInputTokens >= input.config.agent.maxInputTokensPerAttempt) {
        input.onLog?.({
          message: "action=worker outcome=guardrail_stop reason=attempt_input_budget_exceeded",
          details: {
            issue_id: currentIssue.id,
            issue_identifier: currentIssue.identifier,
            session_id: sessionId ?? undefined,
            turn_count: turnCount,
            cumulative_input_tokens: cumulativeInputTokens,
            max_input_tokens_per_attempt: input.config.agent.maxInputTokensPerAttempt,
          },
        });

        return {
          exit: "guardrail_stop",
          guardrail_reason: "attempt_input_budget_exceeded",
          turnCount,
          workspacePath: workspace.path,
          issue: currentIssue,
        };
      }

      const fingerprint = await getWorkspaceFingerprint(workspace.path);
      if (fingerprint !== null) {
        if (fingerprint === previousFingerprint) {
          unchangedFingerprintTurns += 1;
        } else {
          previousFingerprint = fingerprint;
          unchangedFingerprintTurns = 1;
        }

        if (unchangedFingerprintTurns >= NO_PROGRESS_WINDOW) {
          input.onLog?.({
            message: "action=worker outcome=guardrail_stop reason=no_progress_window_exceeded",
            details: {
              issue_id: currentIssue.id,
              issue_identifier: currentIssue.identifier,
              session_id: sessionId ?? undefined,
              turn_count: turnCount,
              no_progress_window: NO_PROGRESS_WINDOW,
            },
          });

          return {
            exit: "guardrail_stop",
            guardrail_reason: "no_progress_window_exceeded",
            turnCount,
            workspacePath: workspace.path,
            issue: currentIssue,
          };
        }
      } else {
        previousFingerprint = null;
        unchangedFingerprintTurns = 0;
      }
    }

    input.onLog?.({
      message: "action=worker outcome=completed",
      details: {
        issue_id: currentIssue.id,
        issue_identifier: currentIssue.identifier,
        session_id: sessionId ?? undefined,
        turn_count: turnCount,
      },
    });

    return {
      exit: "normal",
      turnCount,
      workspacePath: workspace.path,
      issue: currentIssue,
    };
  } catch (error) {
    input.onLog?.({
      message: `action=worker outcome=failed reason=${error instanceof SymphonyError ? error.code : "worker_attempt_failed"}`,
      details: {
        issue_id: currentIssue.id,
        issue_identifier: currentIssue.identifier,
        session_id: sessionId ?? undefined,
      },
    });

    if (error instanceof SymphonyError) {
      throw error;
    }

    throw new SymphonyError("worker_attempt_failed", `worker attempt failed: ${toErrorMessage(error)}`, {
      cause: error,
      details: {
        issue_id: currentIssue.id,
        issue_identifier: currentIssue.identifier,
      },
    });
  } finally {
    if (shouldStopClient) {
      codex.stop();
    }

    await runAfterRunHook(workspaceConfig, workspace.path);

    if (sessionId) {
      input.onLog?.({
        message: "action=session outcome=stopped",
        details: {
          issue_id: currentIssue.id,
          issue_identifier: currentIssue.identifier,
          session_id: sessionId,
        },
      });
    }
  }
}

function shouldContinueTurns(issue: NormalizedIssue, turnCount: number, config: EffectiveConfig): boolean {
  if (turnCount >= config.agent.maxTurns) {
    return false;
  }

  return config.tracker.activeStates.includes(issue.state);
}

async function getWorkspaceFingerprint(workspacePath: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("git", ["-C", workspacePath, "status", "--porcelain"], {
      timeout: 5000,
      maxBuffer: 1024 * 1024,
    });
    return stdout.trim();
  } catch {
    return null;
  }
}

function toWorkspaceConfig(config: EffectiveConfig): WorkspaceConfig {
  return {
    root: config.workspace.root,
    hooks: {
      afterCreate: config.hooks.afterCreate,
      beforeRun: config.hooks.beforeRun,
      afterRun: config.hooks.afterRun,
      beforeRemove: config.hooks.beforeRemove,
      timeoutMs: config.hooks.timeoutMs,
    },
  };
}

function toTemplateIssue(issue: NormalizedIssue): IssueTemplateInput {
  return {
    id: issue.id,
    identifier: issue.identifier,
    title: issue.title,
    state: issue.state,
    priority: issue.priority,
    labels: issue.labels,
    blocked_by: issue.blocked_by.map((blocker) => blocker.identifier),
    created_at: issue.created_at,
    updated_at: issue.updated_at,
  };
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  return null;
}
