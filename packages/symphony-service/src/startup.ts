import type { TrackerClient } from "./issue";
import { toErrorMessage } from "./errors";
import { removeWorkspace, resolveWorkspaceLocation, type WorkspaceConfig } from "./workspace";

export interface StartupLogEntry {
  level: "info" | "warn" | "error";
  message: string;
  details?: Record<string, unknown>;
}

export interface StartupCleanupResult {
  removed: number;
  failed: number;
  warnings: string[];
}

export interface CleanupTerminalIssueWorkspacesInput {
  tracker: TrackerClient;
  terminalStates: string[];
  workspace: WorkspaceConfig;
  onLog?: (entry: StartupLogEntry) => void;
}

export async function cleanupTerminalIssueWorkspaces(
  input: CleanupTerminalIssueWorkspacesInput,
): Promise<StartupCleanupResult> {
  const result: StartupCleanupResult = {
    removed: 0,
    failed: 0,
    warnings: [],
  };

  let terminalIssues;
  try {
    terminalIssues = await input.tracker.fetchIssuesByStates(input.terminalStates);
  } catch (error) {
    const message = `failed to fetch terminal issues during startup cleanup: ${toErrorMessage(error)}`;
    result.warnings.push(message);
    input.onLog?.({
      level: "warn",
      message,
      details: {
        terminal_states: input.terminalStates,
      },
    });
    return result;
  }

  for (const issue of terminalIssues) {
    const location = resolveWorkspaceLocation(input.workspace.root, issue.identifier);

    try {
      await removeWorkspace(input.workspace, location.path);
      result.removed += 1;
      input.onLog?.({
        level: "info",
        message: "removed terminal issue workspace",
        details: {
          issue_id: issue.id,
          issue_identifier: issue.identifier,
          workspace_path: location.path,
        },
      });
    } catch (error) {
      result.failed += 1;
      const message = `failed to remove terminal issue workspace for ${issue.identifier}: ${toErrorMessage(error)}`;
      result.warnings.push(message);
      input.onLog?.({
        level: "warn",
        message,
        details: {
          issue_id: issue.id,
          issue_identifier: issue.identifier,
          workspace_path: location.path,
        },
      });
    }
  }

  return result;
}
