import type { FSWatcher } from "node:fs";
import { resolveEffectiveConfig } from "./config";
import { CodexAppServerClient } from "./codex/client";
import { toErrorMessage } from "./errors";
import type { TrackerClient } from "./issue";
import { createOrchestratorState, onWorkerExit, type ReconcileAction } from "./orchestrator";
import { processDueRetries, runOrchestratorTick, type DispatchInput } from "./runtime";
import { cleanupTerminalIssueWorkspaces } from "./startup";
import { LinearTrackerClient } from "./tracker/linear";
import type { EffectiveConfig, WorkflowDocument } from "./types";
import { validateDispatchPreflight } from "./validate";
import { removeWorkspace, resolveWorkspaceLocation } from "./workspace";
import { loadWorkflowFile, watchWorkflowFile } from "./workflow";
import { runIssueAttempt, type WorkerCodexClient } from "./worker";

const RELOAD_DEBOUNCE_MS = 100;
type IntervalHandle = ReturnType<typeof setInterval>;
type TimeoutHandle = ReturnType<typeof setTimeout>;

export interface ServiceLogEntry {
  level: "info" | "warn" | "error";
  message: string;
  details?: Record<string, unknown>;
}

interface ActiveWorker {
  identifier: string;
  stop: () => void;
}

interface ServiceDependencies {
  loadWorkflowFile: (path: string) => Promise<WorkflowDocument>;
  watchWorkflowFile: (path: string, onReloadRequested: () => void) => FSWatcher;
  resolveEffectiveConfig: (config: WorkflowDocument["config"]) => EffectiveConfig;
  validateDispatchPreflight: (config: EffectiveConfig) => void;
  createTracker: (config: EffectiveConfig) => TrackerClient;
  createCodexClient: (config: EffectiveConfig) => WorkerCodexClient;
  runIssueAttempt: typeof runIssueAttempt;
  processDueRetries: typeof processDueRetries;
  runOrchestratorTick: typeof runOrchestratorTick;
  cleanupTerminalIssueWorkspaces: typeof cleanupTerminalIssueWorkspaces;
  nowMs: () => number;
  setIntervalFn: (callback: () => void, intervalMs: number) => IntervalHandle;
  clearIntervalFn: (handle: IntervalHandle) => void;
  setTimeoutFn: (callback: () => void, timeoutMs: number) => TimeoutHandle;
  clearTimeoutFn: (handle: TimeoutHandle) => void;
  onLog: (entry: ServiceLogEntry) => void;
}

export interface CreateSymphonyServiceOptions {
  workflowPath: string;
  watch?: boolean;
  printEffectiveConfig?: boolean;
  deps?: Partial<ServiceDependencies>;
}

export interface SymphonyServiceSnapshot {
  workflowPath: string | null;
  pollIntervalMs: number | null;
  runningCount: number;
  retryCount: number;
}

export interface SymphonyService {
  start(): Promise<void>;
  stop(): Promise<void>;
  reloadWorkflow(): Promise<boolean>;
  runTickOnce(): Promise<void>;
  getSnapshot(): SymphonyServiceSnapshot;
}

export function formatServiceLogLine(entry: ServiceLogEntry): string {
  const parts = [`level=${entry.level}`, entry.message];

  if (entry.details) {
    const detailEntries = Object.entries(entry.details).filter(([, value]) => value !== undefined);
    detailEntries.sort(([a], [b]) => a.localeCompare(b));

    for (const [key, value] of detailEntries) {
      parts.push(`${key}=${formatLogValue(value)}`);
    }
  }

  return parts.join(" ");
}

export function createSymphonyService(options: CreateSymphonyServiceOptions): SymphonyService {
  const deps = resolveDependencies(options.deps);

  const state = createOrchestratorState();

  let workflow: WorkflowDocument | null = null;
  let config: EffectiveConfig | null = null;
  let tracker: TrackerClient | null = null;
  let pollTimer: IntervalHandle | null = null;
  let reloadTimer: TimeoutHandle | null = null;
  let watcher: FSWatcher | null = null;
  let tickInFlight: Promise<void> | null = null;
  let started = false;

  const activeWorkers = new Map<string, ActiveWorker>();
  const workerTasks = new Set<Promise<void>>();

  function emitLog(entry: ServiceLogEntry): void {
    try {
      deps.onLog(entry);
      return;
    } catch (error) {
      const fallback: ServiceLogEntry = {
        level: "warn",
        message: "action=log_sink outcome=failed",
        details: {
          sink_error: toErrorMessage(error),
          original_level: entry.level,
          original_message: entry.message,
        },
      };

      try {
        process.stderr.write(`[symphony] ${formatServiceLogLine(fallback)}\n`);
      } catch {
        // Last-resort logging path failed; continue orchestration without throwing.
      }
    }
  }

  async function start(): Promise<void> {
    if (started) {
      return;
    }

    await applyWorkflow({ mode: "startup" });
    started = true;

    if (!config || !tracker) {
      throw new Error("service missing runtime config after startup");
    }

    await deps.cleanupTerminalIssueWorkspaces({
      tracker,
      terminalStates: config.tracker.terminalStates,
      workspace: {
        root: config.workspace.root,
        hooks: {
          afterCreate: config.hooks.afterCreate,
          beforeRun: config.hooks.beforeRun,
          afterRun: config.hooks.afterRun,
          beforeRemove: config.hooks.beforeRemove,
          timeoutMs: config.hooks.timeoutMs,
        },
      },
      onLog: emitLog,
    });

    await runTickOnce();
    schedulePolling();

    if (options.watch && workflow) {
      watcher = deps.watchWorkflowFile(workflow.path, () => {
        if (reloadTimer) {
          deps.clearTimeoutFn(reloadTimer);
        }

        reloadTimer = deps.setTimeoutFn(() => {
          void reloadWorkflow();
        }, RELOAD_DEBOUNCE_MS);
      });

      emitLog({
        level: "info",
        message: "action=watch outcome=started",
        details: {
          workflow_path: workflow.path,
        },
      });
    }
  }

  async function stop(): Promise<void> {
    if (pollTimer) {
      deps.clearIntervalFn(pollTimer);
      pollTimer = null;
    }

    if (reloadTimer) {
      deps.clearTimeoutFn(reloadTimer);
      reloadTimer = null;
    }

    if (watcher) {
      watcher.close();
      watcher = null;
    }

    for (const worker of activeWorkers.values()) {
      worker.stop();
    }

    await Promise.allSettled(Array.from(workerTasks));
    started = false;
  }

  async function reloadWorkflow(): Promise<boolean> {
    const loaded = await applyWorkflow({ mode: "reload" });
    if (loaded && started) {
      schedulePolling();
    }

    return loaded;
  }

  async function runTickOnce(): Promise<void> {
    if (!config || !tracker) {
      return;
    }

    if (tickInFlight) {
      return await tickInFlight;
    }

    tickInFlight = (async () => {
      const nowMs = deps.nowMs();

      await deps.processDueRetries({
        state,
        tracker,
        config,
        nowMs,
        dispatchIssue: (input) => dispatchIssue(input),
      });

      await deps.runOrchestratorTick({
        state,
        tracker,
        config,
        nowMs,
        dispatchIssue: (input) => dispatchIssue(input),
        onStalledIssue: async (issueId) => {
          terminateRunningIssue(issueId);
        },
        onReconcileAction: async (action) => {
          await onReconcileAction(action);
        },
      });
    })().finally(() => {
      tickInFlight = null;
    });

    return await tickInFlight;
  }

  async function onReconcileAction(action: ReconcileAction): Promise<void> {
    if (action.action === "update_snapshot") {
      return;
    }

    terminateRunningIssue(action.issueId);

    state.running.delete(action.issueId);
    state.claimed.delete(action.issueId);
    state.retryAttempts.delete(action.issueId);

    if (action.action === "terminate_cleanup" && config) {
      const workspace = resolveWorkspaceLocation(config.workspace.root, action.identifier);
      await removeWorkspace(
        {
          root: config.workspace.root,
          hooks: {
            afterCreate: config.hooks.afterCreate,
            beforeRun: config.hooks.beforeRun,
            afterRun: config.hooks.afterRun,
            beforeRemove: config.hooks.beforeRemove,
            timeoutMs: config.hooks.timeoutMs,
          },
        },
        workspace.path,
      );
    }
  }

  function terminateRunningIssue(issueId: string): void {
    const worker = activeWorkers.get(issueId);
    if (!worker) {
      return;
    }

    worker.stop();
    activeWorkers.delete(issueId);
  }

  async function dispatchIssue(input: DispatchInput): Promise<void> {
    if (!config || !tracker || !workflow) {
      throw new Error("service runtime is not initialized");
    }

    if (activeWorkers.has(input.issue.id)) {
      throw new Error(`worker already active for issue: ${input.issue.id}`);
    }

    const runtimeConfig = config;
    const runtimeTracker = tracker;
    const runtimeWorkflow = workflow;

    const codexClient = deps.createCodexClient(runtimeConfig);
    activeWorkers.set(input.issue.id, {
      identifier: input.issue.identifier,
      stop: () => codexClient.stop(),
    });

    const task = deps
      .runIssueAttempt({
        issue: input.issue,
        attempt: input.attempt,
        workflowTemplate: runtimeWorkflow.promptTemplate,
        config: runtimeConfig,
        tracker: runtimeTracker,
        createCodexClient: () => codexClient,
        onLog: (entry) => {
          emitLog({
            level: entry.message.includes("outcome=failed") ? "warn" : "info",
            message: entry.message,
            details: entry.details,
          });
        },
      })
      .then(() => {
        onWorkerExit(state, {
          issueId: input.issue.id,
          nowMs: deps.nowMs(),
          reason: "normal",
          maxRetryBackoffMs: runtimeConfig.agent.maxRetryBackoffMs,
        });
      })
      .catch((error) => {
        onWorkerExit(state, {
          issueId: input.issue.id,
          nowMs: deps.nowMs(),
          reason: "failure",
          maxRetryBackoffMs: runtimeConfig.agent.maxRetryBackoffMs,
          error: toErrorMessage(error),
        });
      })
      .finally(() => {
        activeWorkers.delete(input.issue.id);
        workerTasks.delete(task);
      });

    workerTasks.add(task);
  }

  async function applyWorkflow(input: { mode: "startup" | "reload" }): Promise<boolean> {
    try {
      const loaded = await deps.loadWorkflowFile(options.workflowPath);
      const nextConfig = deps.resolveEffectiveConfig(loaded.config);
      deps.validateDispatchPreflight(nextConfig);
      const nextTracker = deps.createTracker(nextConfig);

      workflow = loaded;
      config = nextConfig;
      tracker = nextTracker;

      emitLog({
        level: "info",
        message: "action=config_validate outcome=completed",
        details: {
          tracker_kind: config.tracker.kind,
          project_slug: config.tracker.projectSlug,
          poll_interval_ms: config.polling.intervalMs,
        },
      });

      if (options.printEffectiveConfig) {
        emitLog({
          level: "info",
          message: JSON.stringify(config, null, 2),
        });
      }

      return true;
    } catch (error) {
      if (input.mode === "startup") {
        throw error;
      }

      emitLog({
        level: "warn",
        message: "action=config_reload outcome=failed reason=reload_failed",
        details: {
          error: toErrorMessage(error),
        },
      });
      return false;
    }
  }

  function schedulePolling(): void {
    if (!config) {
      return;
    }

    if (pollTimer) {
      deps.clearIntervalFn(pollTimer);
      pollTimer = null;
    }

    pollTimer = deps.setIntervalFn(() => {
      void runTickOnce().catch((error) => {
        emitLog({
          level: "warn",
          message: "action=tick outcome=failed",
          details: {
            error: toErrorMessage(error),
          },
        });
      });
    }, config.polling.intervalMs);
  }

  function getSnapshot(): SymphonyServiceSnapshot {
    return {
      workflowPath: workflow?.path ?? null,
      pollIntervalMs: config?.polling.intervalMs ?? null,
      runningCount: state.running.size,
      retryCount: state.retryAttempts.size,
    };
  }

  return {
    start,
    stop,
    reloadWorkflow,
    runTickOnce,
    getSnapshot,
  };
}

function resolveDependencies(overrides: Partial<ServiceDependencies> | undefined): ServiceDependencies {
  return {
    loadWorkflowFile,
    watchWorkflowFile,
    resolveEffectiveConfig,
    validateDispatchPreflight,
    createTracker: (config) => {
      if (config.tracker.kind !== "linear" || !config.tracker.apiKey || !config.tracker.projectSlug) {
        throw new Error("unsupported or invalid tracker config");
      }

      return new LinearTrackerClient({
        endpoint: config.tracker.endpoint,
        apiKey: config.tracker.apiKey,
        projectSlug: config.tracker.projectSlug,
        activeStates: config.tracker.activeStates,
      });
    },
    createCodexClient: (config) => {
      return new CodexAppServerClient({
        command: config.codex.command,
        clientName: config.codex.clientName,
        clientVersion: config.codex.clientVersion,
        clientCapabilities: config.codex.clientCapabilities,
        approvalPolicy: config.codex.approvalPolicy,
        threadSandbox: config.codex.threadSandbox,
        turnSandboxPolicy: config.codex.turnSandboxPolicy,
        readTimeoutMs: config.codex.readTimeoutMs,
        turnTimeoutMs: config.codex.turnTimeoutMs,
      });
    },
    runIssueAttempt,
    processDueRetries,
    runOrchestratorTick,
    cleanupTerminalIssueWorkspaces,
    nowMs: () => Date.now(),
    setIntervalFn: setInterval,
    clearIntervalFn: clearInterval,
    setTimeoutFn: setTimeout,
    clearTimeoutFn: clearTimeout,
    onLog: (entry) => {
      const line = `[symphony] ${formatServiceLogLine(entry)}\n`;
      if (entry.level === "warn" || entry.level === "error") {
        process.stderr.write(line);
      } else {
        process.stdout.write(line);
      }
    },
    ...overrides,
  };
}

function formatLogValue(value: unknown): string {
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (typeof value === "string") {
    if (/^[A-Za-z0-9._:/-]+$/.test(value)) {
      return value;
    }

    return JSON.stringify(value);
  }

  return JSON.stringify(value);
}
