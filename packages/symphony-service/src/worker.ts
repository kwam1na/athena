import type { TurnOutcome } from "./codex/client";
import { SymphonyError, toErrorMessage } from "./errors";
import type { NormalizedIssue, TrackerClient } from "./issue";
import { buildIssuePrompt } from "./template";
import type { EffectiveConfig, IssueTemplateInput } from "./types";
import { ensureWorkspaceForIssue, runAfterRunHook, runBeforeRunHook, type WorkspaceConfig } from "./workspace";

export interface WorkerCodexClient {
  startSession(input: { cwd: string }): Promise<{ threadId: string }>;
  runTurn(input: {
    threadId: string;
    cwd: string;
    title: string;
    prompt: string;
  }): Promise<{ turnId: string; sessionId: string; outcome: TurnOutcome }>;
  stop(): void;
}

export interface RunIssueAttemptInput {
  issue: NormalizedIssue;
  attempt: number;
  workflowTemplate: string;
  config: EffectiveConfig;
  tracker: TrackerClient;
  createCodexClient: () => WorkerCodexClient;
}

export interface RunIssueAttemptResult {
  exit: "normal";
  turnCount: number;
  workspacePath: string;
  issue: NormalizedIssue;
}

export async function runIssueAttempt(input: RunIssueAttemptInput): Promise<RunIssueAttemptResult> {
  const workspaceConfig = toWorkspaceConfig(input.config);
  const workspace = await ensureWorkspaceForIssue(workspaceConfig, input.issue.identifier);
  await runBeforeRunHook(workspaceConfig, workspace.path);

  const codex = input.createCodexClient();
  let shouldStopClient = true;
  let turnCount = 0;
  let currentIssue = input.issue;

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

      if (turn.outcome !== "completed") {
        throw new SymphonyError("worker_turn_failed", `codex turn ended with non-completed outcome: ${turn.outcome}`, {
          details: {
            issue_id: currentIssue.id,
            issue_identifier: currentIssue.identifier,
            outcome: turn.outcome,
          },
        });
      }

      const refreshed = await input.tracker.fetchIssueStatesByIds([currentIssue.id]);
      if (Array.isArray(refreshed) && refreshed[0]) {
        currentIssue = refreshed[0];
      }
    }

    return {
      exit: "normal",
      turnCount,
      workspacePath: workspace.path,
      issue: currentIssue,
    };
  } catch (error) {
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
  }
}

function shouldContinueTurns(issue: NormalizedIssue, turnCount: number, config: EffectiveConfig): boolean {
  if (turnCount >= config.agent.maxTurns) {
    return false;
  }

  return config.tracker.activeStates.includes(issue.state);
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
