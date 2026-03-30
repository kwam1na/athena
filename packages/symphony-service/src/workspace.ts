import { spawn } from "node:child_process";
import { mkdir, rm, stat } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { SymphonyError, toErrorMessage } from "./errors";

export interface WorkspaceHooksConfig {
  afterCreate?: string;
  beforeRun?: string;
  afterRun?: string;
  beforeRemove?: string;
  timeoutMs: number;
}

export interface WorkspaceConfig {
  root: string;
  hooks: WorkspaceHooksConfig;
}

export interface WorkspaceLocation {
  root: string;
  key: string;
  path: string;
}

export async function ensureWorkspaceForIssue(
  config: WorkspaceConfig,
  issueIdentifier: string,
): Promise<WorkspaceLocation & { createdNow: boolean }> {
  const location = resolveWorkspaceLocation(config.root, issueIdentifier);
  await mkdir(location.root, { recursive: true });

  const existed = await pathExists(location.path);
  await mkdir(location.path, { recursive: true });

  const createdNow = !existed;
  const missingGitMetadata = !(await pathExists(join(location.path, ".git")));
  if ((createdNow || missingGitMetadata) && config.hooks.afterCreate?.trim()) {
    await runRequiredHook(config, location.path, "after_create", config.hooks.afterCreate);
  }

  return {
    ...location,
    createdNow,
  };
}

export async function runBeforeRunHook(config: WorkspaceConfig, workspacePath: string): Promise<void> {
  if (!config.hooks.beforeRun?.trim()) {
    return;
  }

  await runRequiredHook(config, workspacePath, "before_run", config.hooks.beforeRun);
}

export async function runAfterRunHook(config: WorkspaceConfig, workspacePath: string): Promise<void> {
  if (!config.hooks.afterRun?.trim()) {
    return;
  }

  await runBestEffortHook(config, workspacePath, "after_run", config.hooks.afterRun);
}

export async function removeWorkspace(config: WorkspaceConfig, workspacePath: string): Promise<void> {
  assertWorkspacePathSafety(config.root, workspacePath);

  if (config.hooks.beforeRemove?.trim()) {
    await runBestEffortHook(config, workspacePath, "before_remove", config.hooks.beforeRemove);
  }

  await rm(workspacePath, { recursive: true, force: true });
}

export function resolveWorkspaceLocation(root: string, issueIdentifier: string): WorkspaceLocation {
  const resolvedRoot = resolve(root);
  const key = sanitizeWorkspaceKey(issueIdentifier);
  const resolvedWorkspacePath = resolve(resolvedRoot, key);

  assertWorkspacePathSafety(resolvedRoot, resolvedWorkspacePath);

  return {
    root: resolvedRoot,
    key,
    path: resolvedWorkspacePath,
  };
}

export function sanitizeWorkspaceKey(issueIdentifier: string): string {
  const raw = issueIdentifier.replace(/[^A-Za-z0-9._-]/g, "_");
  const normalized = raw.length === 0 ? "_" : raw;

  if (normalized === "." || normalized === "..") {
    return normalized.replace(/\./g, "_");
  }

  return normalized;
}

export function assertWorkspacePathSafety(workspaceRoot: string, workspacePath: string): void {
  const rootAbs = resolve(workspaceRoot);
  const pathAbs = resolve(workspacePath);

  if (pathAbs === rootAbs) {
    return;
  }

  const rootWithSeparator = rootAbs.endsWith(sep) ? rootAbs : `${rootAbs}${sep}`;
  if (!pathAbs.startsWith(rootWithSeparator)) {
    throw new SymphonyError("invalid_workspace_path", "workspace path must stay inside workspace.root", {
      details: {
        workspace_root: rootAbs,
        workspace_path: pathAbs,
      },
    });
  }
}

async function runRequiredHook(
  config: WorkspaceConfig,
  workspacePath: string,
  hookName: "after_create" | "before_run",
  script: string,
): Promise<void> {
  assertWorkspacePathSafety(config.root, workspacePath);
  await runHookScript(workspacePath, script, config.hooks.timeoutMs, hookName);
}

async function runBestEffortHook(
  config: WorkspaceConfig,
  workspacePath: string,
  hookName: "after_run" | "before_remove",
  script: string,
): Promise<void> {
  assertWorkspacePathSafety(config.root, workspacePath);

  try {
    await runHookScript(workspacePath, script, config.hooks.timeoutMs, hookName);
  } catch {
    // best effort hooks are intentionally ignored after logging in caller layers
  }
}

async function runHookScript(
  workspacePath: string,
  script: string,
  timeoutMs: number,
  hookName: "after_create" | "before_run" | "after_run" | "before_remove",
): Promise<void> {
  await new Promise<void>((resolveHook, rejectHook) => {
    const proc = spawn("bash", ["-lc", script], {
      cwd: workspacePath,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let finished = false;
    let timedOut = false;
    let stderr = "";

    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill("SIGTERM");
    }, timeoutMs);

    proc.stderr.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    proc.on("error", (error) => {
      if (finished) {
        return;
      }

      finished = true;
      clearTimeout(timer);
      rejectHook(
        new SymphonyError("hook_failed", `workspace hook failed to start: ${hookName}`, {
          cause: error,
          details: { hook: hookName, cwd: workspacePath },
        }),
      );
    });

    proc.on("close", (code, signal) => {
      if (finished) {
        return;
      }

      finished = true;
      clearTimeout(timer);

      if (timedOut) {
        rejectHook(
          new SymphonyError("hook_timeout", `workspace hook timed out: ${hookName}`, {
            details: { hook: hookName, cwd: workspacePath, timeout_ms: timeoutMs },
          }),
        );
        return;
      }

      if (code === 0) {
        resolveHook();
        return;
      }

      rejectHook(
        new SymphonyError("hook_failed", `workspace hook failed: ${hookName}`, {
          details: {
            hook: hookName,
            cwd: workspacePath,
            exit_code: code,
            signal,
            stderr: stderr.trim() || undefined,
          },
        }),
      );
    });
  });
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (isMissingPathError(error)) {
      return false;
    }

    throw error;
  }
}

function isMissingPathError(error: unknown): boolean {
  if (error && typeof error === "object") {
    const maybeNodeError = error as { code?: unknown; errno?: unknown; message?: unknown };
    if (maybeNodeError.code === "ENOENT") {
      return true;
    }
    if (maybeNodeError.errno === -2) {
      return true;
    }
  }

  const message = toErrorMessage(error).toLowerCase();
  return message.includes("enoent") || message.includes("no such file or directory");
}
