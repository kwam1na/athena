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
  localRegisterSessionId: string;
  createdAt: number;
  sequence: number;
}

export interface PosLocalSyncStatus {
  running: boolean;
  scheduled: boolean;
  backoffUntil: number | null;
  failureCount: number;
  lastFailure: string | null;
  lastTrigger: PosLocalSyncTrigger | null;
}

export interface PosLocalSyncScheduler {
  trigger(
    trigger: PosLocalSyncTrigger,
    options?: { priority?: "normal" | "high" },
  ): void;
  startForegroundTriggers(): () => void;
  getStatus(): PosLocalSyncStatus;
}

export interface CreatePosLocalSyncSchedulerOptions {
  loadPendingEvents(): Promise<PosLocalPendingEvent[]>;
  uploadBatch(
    events: PosLocalPendingEvent[],
    metadata: { trigger: PosLocalSyncTrigger },
  ): Promise<{
    heldEventIds?: string[];
    reviewEventIds?: string[];
    syncedEventIds: string[];
  }>;
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
  let timer: ReturnType<typeof setTimeout> | null = null;
  let foregroundInterval: ReturnType<typeof setInterval> | null = null;
  let backoffUntil: number | null = null;
  let failureCount = 0;
  let lastFailure: string | null = null;
  let lastTrigger: PosLocalSyncTrigger | null = null;

  const status = (): PosLocalSyncStatus => ({
    running,
    scheduled,
    backoffUntil,
    failureCount,
    lastFailure,
    lastTrigger,
  });

  const clearScheduledTimer = () => {
    if (timer) {
      clearTimeoutFn(timer);
      timer = null;
    }
    scheduled = false;
  };

  const schedule = (
    trigger: PosLocalSyncTrigger,
    delayMs: number,
    forceImmediate = false,
  ) => {
    lastTrigger = trigger;

    if (running) {
      rerunRequested = true;
      return;
    }

    if (forceImmediate) {
      clearScheduledTimer();
    } else if (scheduled) {
      return;
    }

    scheduled = true;
    timer = setTimeoutFn(() => {
      timer = null;
      scheduled = false;
      void run(trigger);
    }, delayMs);
  };

  const run = async (trigger: PosLocalSyncTrigger): Promise<void> => {
    if (running) {
      rerunRequested = true;
      return;
    }

    if (!options.isOnline()) {
      return;
    }

    running = true;

    try {
      const pendingEvents = await options.loadPendingEvents();
      const batches = selectOrderedBatches(pendingEvents, maxBatchSize);

      if (batches.length === 0) {
        lastFailure = null;
        backoffUntil = null;
        failureCount = 0;
        return;
      }

      for (const batch of batches) {
        const result = await options.uploadBatch(batch, { trigger });
        if (result.reviewEventIds?.length) {
          await options.markNeedsReview?.(result.reviewEventIds);
        }
        if (result.syncedEventIds.length) {
          await options.markSynced(result.syncedEventIds);
        }
        if (result.heldEventIds?.length) {
          throw new Error("Earlier POS history must sync before this event.");
        }
      }

      lastFailure = null;
      backoffUntil = null;
      failureCount = 0;
    } catch (error) {
      failureCount += 1;
      lastFailure = getErrorMessage(error);
      backoffUntil =
        now() +
        Math.min(
          maxBackoffMs,
          baseBackoffMs * Math.max(1, 2 ** (failureCount - 1)),
        );
    } finally {
      running = false;

      if (rerunRequested) {
        rerunRequested = false;
        const delay = getCurrentBackoffDelay(now(), backoffUntil);
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
          event.localRegisterSessionId === first.localRegisterSessionId,
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
  if (left.createdAt !== right.createdAt) {
    return left.createdAt - right.createdAt;
  }

  if (left.sequence !== right.sequence) {
    return left.sequence - right.sequence;
  }

  return left.id.localeCompare(right.id);
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
