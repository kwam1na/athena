import type { FSWatcher } from "node:fs";
import { resolveEffectiveConfig } from "./config";
import { CodexAppServerClient, type CodexRuntimeEvent } from "./codex/client";
import { SymphonyError, toErrorMessage } from "./errors";
import type { NormalizedIssue, TrackerClient } from "./issue";
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
const REQUIRED_PACKAGE_LABELS = new Set([
  "pkg:athena-webapp",
  "pkg:storefront-webapp",
  "pkg:symphony-service",
  "pkg:valkey-proxy-server",
]);
const REQUIRED_PACKAGE_SUFFIXES = new Set(Array.from(REQUIRED_PACKAGE_LABELS).map((label) => label.replace(/^pkg:/, "")));
const MIN_DESCRIPTION_LENGTH = 24;
type IntervalHandle = ReturnType<typeof setInterval>;
type TimeoutHandle = ReturnType<typeof setTimeout>;

export interface ServiceLogEntry {
  level: "info" | "warn" | "error";
  message: string;
  details?: Record<string, unknown>;
}

interface ActiveWorker {
  issueId: string;
  identifier: string;
  startedAtMs: number;
  retryAttempt: number;
  sessionId: string | null;
  turnCount: number;
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  lastCodexTimestampMs: number | null;
  latestRateLimits: Record<string, unknown> | null;
  stop: () => void;
}

interface ServiceDependencies {
  loadWorkflowFile: (path: string) => Promise<WorkflowDocument>;
  watchWorkflowFile: (path: string, onReloadRequested: () => void) => FSWatcher;
  resolveEffectiveConfig: (config: WorkflowDocument["config"]) => EffectiveConfig;
  validateDispatchPreflight: (config: EffectiveConfig) => void;
  createTracker: (config: EffectiveConfig) => TrackerClient;
  createCodexClient: (config: EffectiveConfig, onEvent?: (event: CodexRuntimeEvent) => void) => WorkerCodexClient;
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

export interface RuntimeSnapshotRunningRow {
  issue_id: string;
  issue_identifier: string;
  state: string;
  session_id: string | null;
  turn_count: number;
  retry_attempt: number;
  started_at_ms: number;
  last_codex_timestamp_ms: number | null;
  codex_input_tokens: number;
  codex_output_tokens: number;
  codex_total_tokens: number;
}

export interface RuntimeSnapshotRetryRow {
  issue_id: string;
  issue_identifier: string;
  attempt: number;
  due_at_ms: number;
  error: string;
}

export interface RuntimeSnapshot {
  running: RuntimeSnapshotRunningRow[];
  retrying: RuntimeSnapshotRetryRow[];
  codex_totals: {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
    seconds_running: number;
  };
  rate_limits: Record<string, unknown> | null;
}

export interface SymphonyService {
  start(): Promise<void>;
  stop(): Promise<void>;
  reloadWorkflow(): Promise<boolean>;
  runTickOnce(): Promise<void>;
  getSnapshot(): SymphonyServiceSnapshot;
  getRuntimeSnapshot(): RuntimeSnapshot;
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
  const guardrailNotifiedIssueIds = new Set<string>();
  let completedInputTokens = 0;
  let completedOutputTokens = 0;
  let completedTotalTokens = 0;
  let completedSecondsRunning = 0;
  let latestRateLimits: Record<string, unknown> | null = null;

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

  function evaluateGuardrails(issue: NormalizedIssue): string[] {
    const problems: string[] = [];

    if (!hasRecognizedPackageLabel(issue.labels)) {
      problems.push(
        "Missing package routing label. Add one of: pkg:athena-webapp, pkg:storefront-webapp, pkg:symphony-service, pkg:valkey-proxy-server.",
      );
    }

    const trimmedDescription = (issue.description ?? "").trim();
    if (trimmedDescription.length < MIN_DESCRIPTION_LENGTH) {
      problems.push(
        `Issue description is too short (${trimmedDescription.length} chars). Add concrete scope and acceptance criteria.`,
      );
    }

    return problems;
  }

  async function publishGuardrailComment(trackerClient: TrackerClient, issue: NormalizedIssue, reasons: string[]): Promise<void> {
    if (!trackerClient.createIssueComment) {
      return;
    }

    const reasonLines = reasons.map((reason) => `- ${reason}`).join("\n");
    const body = [
      "Symphony paused automatic execution for this issue because intake guardrails are not met.",
      "",
      reasonLines,
      "",
      "After updating the issue details, trigger a refresh to resume scheduling.",
    ].join("\n");

    await safeTrackerWrite("guardrail_comment", issue, async () => {
      await trackerClient.createIssueComment?.({
        issueId: issue.id,
        body,
      });
    });
  }

  async function moveIssueToInProgress(trackerClient: TrackerClient, issue: NormalizedIssue): Promise<void> {
    if (!trackerClient.updateIssueStateByName) {
      return;
    }

    await safeTrackerWrite("state_transition", issue, async () => {
      const changed = await trackerClient.updateIssueStateByName?.({
        issue,
        stateName: "In Progress",
      });

      if (changed) {
        emitLog({
          level: "info",
          message: "action=tracker_write outcome=completed kind=state_transition",
          details: {
            issue_id: issue.id,
            issue_identifier: issue.identifier,
            next_state: "In Progress",
          },
        });
      }
    });
  }

  async function publishRunComment(
    trackerClient: TrackerClient,
    issue: NormalizedIssue,
    input: {
      kind: "started" | "completed" | "failed";
      attempt: number;
      error?: string;
    },
  ): Promise<void> {
    if (!trackerClient.createIssueComment) {
      return;
    }

    const body = buildRunCommentBody(input);
    await safeTrackerWrite(`run_${input.kind}`, issue, async () => {
      await trackerClient.createIssueComment?.({
        issueId: issue.id,
        body,
      });
    });
  }

  async function safeTrackerWrite(kind: string, issue: NormalizedIssue, writer: () => Promise<void>): Promise<void> {
    try {
      await writer();
    } catch (error) {
      emitLog({
        level: "warn",
        message: "action=tracker_write outcome=failed",
        details: {
          kind,
          issue_id: issue.id,
          issue_identifier: issue.identifier,
          error: toErrorMessage(error),
        },
      });
    }
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
    const guardrailProblems = evaluateGuardrails(input.issue);

    if (guardrailProblems.length > 0) {
      if (!guardrailNotifiedIssueIds.has(input.issue.id)) {
        await publishGuardrailComment(runtimeTracker, input.issue, guardrailProblems);
        guardrailNotifiedIssueIds.add(input.issue.id);
      }

      throw new SymphonyError("guardrail_blocked", `issue failed intake guardrails: ${guardrailProblems.join(" | ")}`);
    }

    guardrailNotifiedIssueIds.delete(input.issue.id);
    await moveIssueToInProgress(runtimeTracker, input.issue);
    await publishRunComment(runtimeTracker, input.issue, {
      kind: "started",
      attempt: input.attempt,
    });

    const startedAtMs = deps.nowMs();
    const worker: ActiveWorker = {
      issueId: input.issue.id,
      identifier: input.issue.identifier,
      startedAtMs,
      retryAttempt: input.attempt,
      sessionId: null,
      turnCount: 0,
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
      },
      lastCodexTimestampMs: null,
      latestRateLimits: null,
      stop: () => {},
    };
    activeWorkers.set(input.issue.id, worker);

    const codexClient = deps.createCodexClient(runtimeConfig, (event) => {
      onWorkerCodexEvent(input.issue.id, event);
    });
    worker.stop = () => codexClient.stop();
    activeWorkers.set(input.issue.id, worker);

    const task = deps
      .runIssueAttempt({
        issue: input.issue,
        attempt: input.attempt,
        workflowTemplate: runtimeWorkflow.promptTemplate,
        config: runtimeConfig,
        tracker: runtimeTracker,
        createCodexClient: () => codexClient,
        onLog: (entry) => {
          onWorkerLifecycleLog(input.issue.id, entry);
          emitLog({
            level: entry.message.includes("outcome=failed") ? "warn" : "info",
            message: entry.message,
            details: entry.details,
          });
        },
      })
      .then(async () => {
        onWorkerExit(state, {
          issueId: input.issue.id,
          nowMs: deps.nowMs(),
          reason: "normal",
          maxRetryBackoffMs: runtimeConfig.agent.maxRetryBackoffMs,
        });

        await publishRunComment(runtimeTracker, input.issue, {
          kind: "completed",
          attempt: input.attempt,
        });
      })
      .catch(async (error) => {
        onWorkerExit(state, {
          issueId: input.issue.id,
          nowMs: deps.nowMs(),
          reason: "failure",
          maxRetryBackoffMs: runtimeConfig.agent.maxRetryBackoffMs,
          error: toErrorMessage(error),
        });

        await publishRunComment(runtimeTracker, input.issue, {
          kind: "failed",
          attempt: input.attempt,
          error: toErrorMessage(error),
        });
      })
      .finally(() => {
        finalizeWorkerMetrics(input.issue.id);
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

  function getRuntimeSnapshot(): RuntimeSnapshot {
    const nowMs = deps.nowMs();
    const running: RuntimeSnapshotRunningRow[] = [];

    for (const [issueId, runningEntry] of state.running.entries()) {
      const worker = activeWorkers.get(issueId);
      running.push({
        issue_id: runningEntry.issue.id,
        issue_identifier: runningEntry.issue.identifier,
        state: runningEntry.issue.state,
        session_id: worker?.sessionId ?? null,
        turn_count: worker?.turnCount ?? runningEntry.turnCount,
        retry_attempt: worker?.retryAttempt ?? runningEntry.retryAttempt,
        started_at_ms: runningEntry.startedAtMs,
        last_codex_timestamp_ms: worker?.lastCodexTimestampMs ?? runningEntry.lastCodexTimestampMs ?? null,
        codex_input_tokens: worker?.usage.inputTokens ?? 0,
        codex_output_tokens: worker?.usage.outputTokens ?? 0,
        codex_total_tokens: worker?.usage.totalTokens ?? 0,
      });
    }

    running.sort((a, b) => a.issue_identifier.localeCompare(b.issue_identifier));

    const retrying: RuntimeSnapshotRetryRow[] = Array.from(state.retryAttempts.values())
      .map((entry) => ({
        issue_id: entry.issueId,
        issue_identifier: entry.identifier,
        attempt: entry.attempt,
        due_at_ms: entry.dueAtMs,
        error: entry.error,
      }))
      .sort((a, b) => a.due_at_ms - b.due_at_ms);

    let activeInputTokens = 0;
    let activeOutputTokens = 0;
    let activeTotalTokens = 0;
    let activeSecondsRunning = 0;

    for (const worker of activeWorkers.values()) {
      activeInputTokens += worker.usage.inputTokens;
      activeOutputTokens += worker.usage.outputTokens;
      activeTotalTokens += worker.usage.totalTokens;
      activeSecondsRunning += Math.max(nowMs - worker.startedAtMs, 0) / 1000;
    }

    return {
      running,
      retrying,
      codex_totals: {
        input_tokens: completedInputTokens + activeInputTokens,
        output_tokens: completedOutputTokens + activeOutputTokens,
        total_tokens: completedTotalTokens + activeTotalTokens,
        seconds_running: completedSecondsRunning + activeSecondsRunning,
      },
      rate_limits: latestRateLimits,
    };
  }

  function onWorkerLifecycleLog(
    issueId: string,
    entry: {
      message: string;
      details?: Record<string, unknown>;
    },
  ): void {
    const worker = activeWorkers.get(issueId);
    if (!worker) {
      return;
    }

    const nowMs = deps.nowMs();
    worker.lastCodexTimestampMs = nowMs;

    const runningEntry = state.running.get(issueId);
    if (runningEntry) {
      runningEntry.lastCodexTimestampMs = nowMs;
      state.running.set(issueId, runningEntry);
    }

    const sessionId = asString(entry.details?.session_id);
    if (sessionId) {
      worker.sessionId = sessionId;
    }

    if (entry.message.includes("action=turn outcome=completed")) {
      worker.turnCount += 1;
      if (runningEntry) {
        runningEntry.turnCount = worker.turnCount;
        state.running.set(issueId, runningEntry);
      }
    }
  }

  function onWorkerCodexEvent(issueId: string, event: CodexRuntimeEvent): void {
    const worker = activeWorkers.get(issueId);
    if (!worker) {
      return;
    }

    const parsedTimestampMs = Date.parse(event.timestamp);
    const timestampMs = Number.isFinite(parsedTimestampMs) ? parsedTimestampMs : deps.nowMs();
    worker.lastCodexTimestampMs = timestampMs;

    const runningEntry = state.running.get(issueId);
    if (runningEntry) {
      runningEntry.lastCodexTimestampMs = timestampMs;
      state.running.set(issueId, runningEntry);
    }

    if (event.session_id) {
      worker.sessionId = event.session_id;
    }

    const usage = event.usage ?? null;
    if (usage) {
      const nextInput = asNumber(usage.input_tokens ?? usage.inputTokens);
      const nextOutput = asNumber(usage.output_tokens ?? usage.outputTokens);
      const nextTotal = asNumber(usage.total_tokens ?? usage.totalTokens);

      if (nextInput !== null) {
        worker.usage.inputTokens = nextInput;
      }
      if (nextOutput !== null) {
        worker.usage.outputTokens = nextOutput;
      }
      if (nextTotal !== null) {
        worker.usage.totalTokens = nextTotal;
      }
    }

    if (event.rate_limits && typeof event.rate_limits === "object") {
      worker.latestRateLimits = event.rate_limits;
      latestRateLimits = event.rate_limits;
    }
  }

  function finalizeWorkerMetrics(issueId: string): void {
    const worker = activeWorkers.get(issueId);
    if (!worker) {
      return;
    }

    completedInputTokens += worker.usage.inputTokens;
    completedOutputTokens += worker.usage.outputTokens;
    completedTotalTokens += worker.usage.totalTokens;
    completedSecondsRunning += Math.max(deps.nowMs() - worker.startedAtMs, 0) / 1000;

    if (worker.latestRateLimits) {
      latestRateLimits = worker.latestRateLimits;
    }

    activeWorkers.delete(issueId);
  }

  return {
    start,
    stop,
    reloadWorkflow,
    runTickOnce,
    getSnapshot,
    getRuntimeSnapshot,
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
    createCodexClient: (config, onEvent) => {
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
      }, onEvent);
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

function hasRecognizedPackageLabel(labels: string[]): boolean {
  for (const label of labels) {
    const normalized = label.trim().toLowerCase();
    if (!normalized) {
      continue;
    }

    if (REQUIRED_PACKAGE_LABELS.has(normalized)) {
      return true;
    }

    if (REQUIRED_PACKAGE_SUFFIXES.has(normalized)) {
      return true;
    }
  }

  return false;
}

function buildRunCommentBody(input: { kind: "started" | "completed" | "failed"; attempt: number; error?: string }): string {
  const timestamp = new Date().toISOString();
  const attemptText = `attempt ${input.attempt}`;

  if (input.kind === "started") {
    return [
      `Symphony started work on this issue (${attemptText}).`,
      "",
      `Timestamp: ${timestamp}`,
    ].join("\n");
  }

  if (input.kind === "completed") {
    return [
      `Symphony finished a run for this issue (${attemptText}).`,
      "",
      `Timestamp: ${timestamp}`,
    ].join("\n");
  }

  return [
    `Symphony run failed for this issue (${attemptText}).`,
    "",
    `Error: ${input.error ?? "unknown failure"}`,
    `Timestamp: ${timestamp}`,
  ].join("\n");
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

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  return null;
}
