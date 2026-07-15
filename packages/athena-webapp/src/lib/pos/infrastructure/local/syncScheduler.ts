export type PosLocalSyncTrigger =
  | "app-boot"
  | "route-entry"
  | "event-appended"
  | "foreground-interval"
  | "online"
  | "visibility"
  | "manual-retry"
  | "closeout";

export interface PosLocalPendingEvent {
  id: string;
  terminalId: string;
  syncScope?: "pos" | "expense";
  localRegisterSessionId: string;
  localExpenseSessionId?: string;
  createdAt: number;
  sequence: number;
  uploadSequence?: number;
}

export interface PosLocalSyncStatus {
  running: boolean;
  scheduled: boolean;
  backoffUntil: number | null;
  failureCount: number;
  lastFailure: string | null;
  lastTrigger: PosLocalSyncTrigger | null;
  /**
   * A batch was entirely `held` behind an unadvanced cursor with no forward
   * progress this drain. Distinguishes a stuck-precursor gap (which needs
   * escalation) from an ordinary transient failure, so it is never a silent
   * indefinite wedge.
   */
  heldWithoutProgress: boolean;
}

export interface PosLocalSyncScheduler {
  trigger(
    trigger: PosLocalSyncTrigger,
    options?: { priority?: "normal" | "high" },
  ): void;
  startForegroundTriggers(): () => void;
  getStatus(): PosLocalSyncStatus;
  stop(): void;
}

export interface CreatePosLocalSyncSchedulerOptions {
  loadPendingEvents(): Promise<PosLocalPendingEvent[]>;
  uploadBatch(
    events: PosLocalPendingEvent[],
    metadata: { trigger: PosLocalSyncTrigger },
  ): Promise<{
    heldEventIds?: string[];
    rejectedEventIds?: string[];
    reviewEventIds?: string[];
    syncedEventIds: string[];
  }>;
  markRejected?(eventIds: string[]): Promise<void>;
  markNeedsReview?(eventIds: string[]): Promise<void>;
  markSynced(eventIds: string[]): Promise<void>;
  isOnline(): boolean;
  now?: () => number;
  debounceMs?: number;
  foregroundIntervalMs?: number;
  baseBackoffMs?: number;
  maxBackoffMs?: number;
  maxBatchSize?: number;
  windowTarget?: Pick<EventTarget, "addEventListener" | "removeEventListener">;
  documentTarget?:
    | (Pick<EventTarget, "addEventListener" | "removeEventListener"> & {
        visibilityState?: DocumentVisibilityState;
      })
    | null;
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
  setIntervalFn?: typeof setInterval;
  clearIntervalFn?: typeof clearInterval;
  onStatusChange?(status: PosLocalSyncStatus): void;
  /**
   * Invoked when a drain makes no forward progress because every event in the
   * batch is `held` behind an unadvanced cursor (typically a stuck
   * `needs_review` precursor). Lets the runtime escalate — e.g. drive a
   * review-inclusive drain — instead of looping the same held gap silently.
   */
  onHeldWithoutProgress?(
    heldEventIds: string[],
    context: { consecutiveCount: number },
  ): void;
}

export function createPosLocalSyncScheduler(
  options: CreatePosLocalSyncSchedulerOptions,
): PosLocalSyncScheduler {
  const now = options.now ?? (() => Date.now());
  const debounceMs = options.debounceMs ?? 250;
  const foregroundIntervalMs = options.foregroundIntervalMs ?? 30_000;
  const baseBackoffMs = options.baseBackoffMs ?? 5_000;
  const maxBackoffMs = options.maxBackoffMs ?? 120_000;
  const maxBatchSize = options.maxBatchSize ?? 100;
  const setTimeoutFn = options.setTimeoutFn ?? setTimeout;
  const clearTimeoutFn = options.clearTimeoutFn ?? clearTimeout;
  const setIntervalFn = options.setIntervalFn ?? setInterval;
  const clearIntervalFn = options.clearIntervalFn ?? clearInterval;

  let running = false;
  let scheduled = false;
  let rerunRequested = false;
  let rerunPriority: "normal" | "high" = "normal";
  let timer: ReturnType<typeof setTimeout> | null = null;
  let foregroundInterval: ReturnType<typeof setInterval> | null = null;
  let backoffUntil: number | null = null;
  let failureCount = 0;
  let lastFailure: string | null = null;
  let lastTrigger: PosLocalSyncTrigger | null = null;
  let heldWithoutProgress = false;
  let heldWithoutProgressCount = 0;

  const status = (): PosLocalSyncStatus => ({
    running,
    scheduled,
    backoffUntil,
    failureCount,
    lastFailure,
    lastTrigger,
    heldWithoutProgress,
  });
  const notifyStatusChange = () => {
    options.onStatusChange?.(status());
  };

  const clearScheduledTimer = () => {
    if (timer) {
      clearTimeoutFn(timer);
      timer = null;
    }
    scheduled = false;
    notifyStatusChange();
  };

  const schedule = (
    trigger: PosLocalSyncTrigger,
    delayMs: number,
    forceImmediate = false,
  ) => {
    lastTrigger = trigger;

    if (running) {
      rerunRequested = true;
      if (forceImmediate) {
        rerunPriority = "high";
      }
      notifyStatusChange();
      return;
    }

    if (forceImmediate) {
      clearScheduledTimer();
    } else if (scheduled) {
      return;
    }

    scheduled = true;
    notifyStatusChange();
    timer = setTimeoutFn(() => {
      timer = null;
      scheduled = false;
      notifyStatusChange();
      void run(trigger);
    }, delayMs);
  };

  const run = async (trigger: PosLocalSyncTrigger): Promise<void> => {
    if (running) {
      rerunRequested = true;
      notifyStatusChange();
      return;
    }

    if (!options.isOnline()) {
      notifyStatusChange();
      return;
    }

    running = true;
    notifyStatusChange();

    try {
      const pendingEvents = await options.loadPendingEvents();
      const batches = selectOrderedBatches(pendingEvents, maxBatchSize);

      if (batches.length === 0) {
        lastFailure = null;
        backoffUntil = null;
        failureCount = 0;
        notifyStatusChange();
        return;
      }

      for (const batch of batches) {
        const result = await options.uploadBatch(batch, { trigger });
        if (result.reviewEventIds?.length) {
          await options.markNeedsReview?.(result.reviewEventIds);
        }
        if (result.rejectedEventIds?.length) {
          await options.markRejected?.(result.rejectedEventIds);
        }
        if (result.syncedEventIds.length) {
          await options.markSynced(result.syncedEventIds);
        }
        if (result.heldEventIds?.length) {
          if (
            result.syncedEventIds.length > 0 ||
            (result.reviewEventIds?.length ?? 0) > 0 ||
            (result.rejectedEventIds?.length ?? 0) > 0
          ) {
            // Forward progress was made, so the held gap is expected to close
            // on the immediate rerun — not a stuck-precursor wedge.
            heldWithoutProgress = false;
            heldWithoutProgressCount = 0;
            rerunRequested = true;
            return;
          }
          // No forward progress: the batch is entirely held behind an
          // unadvanced cursor (typically a stuck needs_review precursor).
          // Surface it as an escalation signal so it is never a silent
          // indefinite wedge, then back off as before.
          heldWithoutProgress = true;
          heldWithoutProgressCount += 1;
          options.onHeldWithoutProgress?.([...result.heldEventIds], {
            consecutiveCount: heldWithoutProgressCount,
          });
          throw new Error("Earlier POS history must sync before this event.");
        }
      }

      lastFailure = null;
      backoffUntil = null;
      failureCount = 0;
      heldWithoutProgress = false;
      heldWithoutProgressCount = 0;
      notifyStatusChange();
    } catch (error) {
      failureCount += 1;
      lastFailure = getErrorMessage(error);
      backoffUntil =
        now() +
        Math.min(
          maxBackoffMs,
            baseBackoffMs * Math.max(1, 2 ** (failureCount - 1)),
        );
      notifyStatusChange();
    } finally {
      running = false;
      notifyStatusChange();

      if (rerunRequested) {
        const priority = rerunPriority;
        rerunRequested = false;
        rerunPriority = "normal";
        const delay =
          priority === "high" ? 0 : getCurrentBackoffDelay(now(), backoffUntil);
        schedule(lastTrigger ?? trigger, delay, true);
      }
    }
  };

  return {
    trigger(trigger, triggerOptions = {}) {
      lastTrigger = trigger;

      if (trigger === "manual-retry") {
        backoffUntil = null;
      }

      if (!options.isOnline()) {
        notifyStatusChange();
        return;
      }

      const highPriority =
        triggerOptions.priority === "high" || trigger === "closeout";
      const backoffDelay =
        trigger === "manual-retry" || highPriority
          ? 0
          : getCurrentBackoffDelay(now(), backoffUntil);
      const delay =
        highPriority || trigger === "manual-retry"
          ? 0
          : Math.max(debounceMs, backoffDelay);

      schedule(trigger, delay, highPriority || trigger === "manual-retry");
    },

    startForegroundTriggers() {
      const win = options.windowTarget ?? globalThis.window;
      const doc = options.documentTarget ?? globalThis.document;

      const handleOnline = () => this.trigger("online");
      const handleVisibility = () => {
        if (!doc || doc.visibilityState === "hidden") return;
        this.trigger("visibility");
      };

      win?.addEventListener?.("online", handleOnline);
      doc?.addEventListener?.("visibilitychange", handleVisibility);
      foregroundInterval = setIntervalFn(
        () => this.trigger("foreground-interval"),
        foregroundIntervalMs,
      );

      return () => {
        win?.removeEventListener?.("online", handleOnline);
        doc?.removeEventListener?.("visibilitychange", handleVisibility);
        if (foregroundInterval) {
          clearIntervalFn(foregroundInterval);
          foregroundInterval = null;
        }
        clearScheduledTimer();
      };
    },

    getStatus: status,

    stop() {
      clearScheduledTimer();
    },
  };
}

export function selectNextOrderedBatch(
  pendingEvents: PosLocalPendingEvent[],
  maxBatchSize: number,
): PosLocalPendingEvent[] {
  return selectOrderedBatches(pendingEvents, maxBatchSize)[0] ?? [];
}

export function selectOrderedBatches(
  pendingEvents: PosLocalPendingEvent[],
  maxBatchSize: number,
): PosLocalPendingEvent[][] {
  const sorted = [...pendingEvents].sort(comparePendingEvents);
  const batches: PosLocalPendingEvent[][] = [];

  while (sorted.length > 0) {
    const first = sorted[0];

    if (!first) break;

    const batch = sorted
      .filter(
        (event) =>
          event.terminalId === first.terminalId &&
          getPendingEventCursorKey(event) === getPendingEventCursorKey(first),
      )
      .slice(0, maxBatchSize);
    batches.push(batch);

    const batchIds = new Set(batch.map((event) => event.id));
    for (let index = sorted.length - 1; index >= 0; index -= 1) {
      const event = sorted[index];
      if (event && batchIds.has(event.id)) {
        sorted.splice(index, 1);
      }
    }
  }

  return batches;
}

function comparePendingEvents(
  left: PosLocalPendingEvent,
  right: PosLocalPendingEvent,
): number {
  const leftUploadSequence = getPendingEventUploadSequence(left);
  const rightUploadSequence = getPendingEventUploadSequence(right);
  if (leftUploadSequence !== rightUploadSequence) {
    return leftUploadSequence - rightUploadSequence;
  }

  if (left.createdAt !== right.createdAt) {
    return left.createdAt - right.createdAt;
  }

  if (left.sequence !== right.sequence) {
    return left.sequence - right.sequence;
  }

  return left.id.localeCompare(right.id);
}

function getPendingEventCursorKey(event: PosLocalPendingEvent): string {
  const scope = event.syncScope === "expense" ? "expense" : "pos";
  const cursorId =
    scope === "expense"
      ? event.localExpenseSessionId || event.localRegisterSessionId
      : event.localRegisterSessionId;

  return `${event.terminalId}:${scope}:${cursorId}`;
}

function getPendingEventUploadSequence(event: PosLocalPendingEvent): number {
  return typeof event.uploadSequence === "number"
    ? event.uploadSequence
    : event.sequence;
}

function getCurrentBackoffDelay(nowMs: number, until: number | null): number {
  if (until === null) {
    return 0;
  }

  return Math.max(0, until - nowMs);
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
