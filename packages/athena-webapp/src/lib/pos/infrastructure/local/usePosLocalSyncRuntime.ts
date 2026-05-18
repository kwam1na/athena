import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation } from "convex/react";
import type { FunctionArgs } from "convex/server";

import { api } from "~/convex/_generated/api";
import type { Id } from "~/convex/_generated/dataModel";
import {
  createIndexedDbPosLocalStorageAdapter,
  createPosLocalStore,
  type PosLocalCloudMapping,
  type PosLocalEventRecord,
  type PosLocalStoreResult,
} from "./posLocalStore";
import {
  buildPosLocalSyncUploadEvents,
  isSyncablePosLocalEvent,
  type PosLocalUploadEvent,
} from "./syncContract";
import {
  createPosLocalSyncScheduler,
  type PosLocalSyncTrigger,
} from "./syncScheduler";
import { derivePosLocalSyncStatus } from "./syncStatus";
import { readScopedPosLocalEvents } from "./localRegisterReader";
import {
  isPosLocalEventInTerminalScope,
  resolvePosLocalTerminalScope,
} from "./terminalScope";

export type PosLocalRuntimeSyncStatusSource = {
  debug?: PosLocalRuntimeSyncDebug;
  description?: string | null;
  label?: string | null;
  onRetrySync?: (() => void) | null;
  pendingEventCount?: number | null;
  status?: string | null;
};

export type PosLocalRuntimeSyncDebug = {
  failureCount?: number;
  failedEventCount?: number;
  lastBatchEventCount?: number;
  lastFailure?: string | null;
  lastHeldEventCount?: number;
  lastReviewEventCount?: number;
  lastTrigger?: PosLocalSyncTrigger;
  lastTriggerAt?: number;
  lastTriggerPriority?: "high" | "normal";
  localOnlyEventCount?: number;
  mode?: PosLocalSyncRuntimeMode;
  oldestPendingEventAt?: number;
  oldestPendingEventId?: string;
  oldestPendingEventSequence?: number;
  oldestPendingUploadSequence?: number;
  nextPendingUploadSequence?: number;
  pendingUploadEventCount?: number;
  reviewEventCount?: number;
  schedulerBackoffUntil?: number | null;
  schedulerRunning?: boolean;
  schedulerScheduled?: boolean;
};

export type PosLocalSyncRuntimeMode = "drain-enabled" | "status-only";

type PosLocalRuntimeStore = ReturnType<typeof createPosLocalStore>;
type IngestLocalEventsArgs = FunctionArgs<
  typeof api.pos.public.sync.ingestLocalEvents
>;

export function usePosLocalSyncRuntimeStatus(input: {
  storeId?: string | null;
  terminalId?: string | null;
  drainOnAppend?: boolean;
  eventAppendToken?: number;
  mode?: PosLocalSyncRuntimeMode;
  onLocalEventsChanged?: (() => void) | null;
  onRetrySync?: (() => void) | null;
  staffProfileId?: string | null;
  storeFactory?: (() => PosLocalRuntimeStore) | null;
}): PosLocalRuntimeSyncStatusSource | null {
  const ingestLocalEvents = useMutation(api.pos.public.sync.ingestLocalEvents);
  const [events, setEvents] = useState<PosLocalEventRecord[]>([]);
  const [readError, setReadError] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const [manualRetryToken, setManualRetryToken] = useState(0);
  const [debug, setDebug] = useState<PosLocalRuntimeSyncDebug>({});
  const [isOnline, setIsOnline] = useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine,
  );
  const lastEventAppendTokenRef = useRef(0);
  const lastManualRetryTokenRef = useRef(0);
  const { storeFactory, storeId, terminalId } = input;
  const drainOnAppend = input.drainOnAppend ?? false;
  const eventAppendToken = input.eventAppendToken ?? 0;
  const mode = input.mode ?? "drain-enabled";
  const onLocalEventsChanged = input.onLocalEventsChanged;
  const onRetrySync = input.onRetrySync;
  const staffProfileId = input.staffProfileId;
  const requestRetry = useCallback(() => {
    setRefreshToken((current) => current + 1);
    setManualRetryToken((current) => current + 1);
    onRetrySync?.();
  }, [onRetrySync]);

  useEffect(() => {
    const updateOnlineState = () => {
      setIsOnline(typeof navigator === "undefined" ? true : navigator.onLine);
    };
    const win = globalThis.window;

    win?.addEventListener?.("online", updateOnlineState);
    win?.addEventListener?.("offline", updateOnlineState);

    return () => {
      win?.removeEventListener?.("online", updateOnlineState);
      win?.removeEventListener?.("offline", updateOnlineState);
    };
  }, []);

  useEffect(() => {
    if (!storeId || (!storeFactory && typeof indexedDB === "undefined")) {
      setEvents([]);
      setReadError(null);
      return;
    }

    let cancelled = false;
    const store =
      storeFactory?.() ??
      createPosLocalStore({
        adapter: createIndexedDbPosLocalStorageAdapter(),
      });
    const stopSchedulers: Array<() => void> = [];

    void (async () => {
      const shouldStop = () => cancelled;
      const seed = await store.readProvisionedTerminalSeed();
      if (!seed.ok) {
        if (!cancelled) {
          setEvents([]);
          setReadError(seed.error.message);
        }
        return;
      }
      const scope = resolvePosLocalTerminalScope({
        storeId,
        terminalId,
        terminalSeed: seed.value,
      });
      if (shouldStop()) {
        return;
      }
      const provisionedSeed = scope.provisionedSeed;
      const cloudTerminalId = provisionedSeed?.cloudTerminalId ?? terminalId;
      if (scope.terminalIds.size === 0 || !cloudTerminalId) {
        setEvents([]);
        setReadError(null);
        return;
      }
      const trigger: PosLocalSyncTrigger =
        manualRetryToken !== lastManualRetryTokenRef.current
          ? "manual-retry"
          : eventAppendToken !== lastEventAppendTokenRef.current
            ? "event-appended"
            : "route-entry";
      const triggerPriority = trigger === "event-appended" ? "high" : "normal";
      lastManualRetryTokenRef.current = manualRetryToken;
      lastEventAppendTokenRef.current = eventAppendToken;
      const eventsResult = await readScopedPosLocalEvents({
        store,
        storeId,
        terminalId,
      });
      if (!eventsResult.ok || cancelled) {
        if (!cancelled) {
          setEvents([]);
          setReadError(eventsResult.ok ? null : eventsResult.error.message);
        }
        return;
      }
      const refreshEvents = async () => {
        const refreshedEvents = await readScopedPosLocalEvents({
          store,
          storeId,
          terminalId,
        });
        if (shouldStop()) {
          return false;
        }
        if (!refreshedEvents.ok || cancelled) {
          if (!cancelled) {
            setReadError(refreshedEvents.ok ? null : refreshedEvents.error.message);
          }
          return false;
        }
        setReadError(null);
        setEvents(refreshedEvents.value.events);
        setDebug((current) => ({
          ...current,
          ...buildRuntimeSyncDebug(refreshedEvents.value.events, mode),
        }));
        return true;
      };
      setEvents(eventsResult.value.events);
      setReadError(null);
      setDebug((current) => ({
        ...current,
        ...buildRuntimeSyncDebug(eventsResult.value.events, mode),
        lastTrigger: trigger,
        lastTriggerAt: Date.now(),
        lastTriggerPriority: triggerPriority,
      }));

      const createDrainScheduler = (
        syncSeed: NonNullable<typeof provisionedSeed>,
      ) => createPosLocalSyncScheduler({
        isOnline: () =>
          typeof navigator === "undefined" ? true : navigator.onLine,
        loadPendingEvents: async () => {
          const pending = await readScopedPosLocalUploadEvents({
            store,
            storeId,
            terminalId,
          });
          if (shouldStop()) {
            return [];
          }
          if (!pending.ok) {
            setReadError(pending.error.message);
            throw new Error(pending.error.message);
          }
          const uploadableEvents = pending.value.events
            .filter(
              (event) =>
                event.sync.status === "pending" ||
                  event.sync.status === "syncing" ||
                  event.sync.status === "failed",
            )
            .filter((event) => isSyncablePosLocalEvent(event));
          if (!shouldStop()) {
            setDebug((current) => ({
              ...current,
              ...buildRuntimeSyncDebug(pending.value.events, mode),
            }));
          }
          return uploadableEvents.map((event) => ({
            id: event.localEventId,
            terminalId: event.terminalId,
            localRegisterSessionId: event.localRegisterSessionId ?? "",
            createdAt: event.createdAt,
            sequence: event.sequence,
          }));
        },
        onStatusChange: (status) => {
          if (shouldStop()) {
            return;
          }
          setDebug((current) => ({
            ...current,
            failureCount: status.failureCount,
            lastFailure: status.lastFailure,
            schedulerBackoffUntil: status.backoffUntil,
            schedulerRunning: status.running,
            schedulerScheduled: status.scheduled,
          }));
        },
        markSynced: async (eventIds) => {
          if (eventIds.length === 0) return;
          const result = await store.markEventsSynced(eventIds, {
            uploaded: true,
          });
          if (shouldStop()) {
            return;
          }
          assertPosLocalStoreOk(result);
          if (!(await refreshEvents())) {
            return;
          }
          if (shouldStop()) {
            return;
          }
          onLocalEventsChanged?.();
        },
        uploadBatch: async (pendingEvents) => {
          const latestEvents = await readScopedPosLocalUploadEvents({
            store,
            storeId,
            terminalId,
          });
          if (shouldStop()) {
            return { syncedEventIds: [] };
          }
          if (!latestEvents.ok) {
            setReadError(latestEvents.error.message);
            throw new Error(latestEvents.error.message);
          }
          const pendingEventIds = new Set(
            pendingEvents.map((event) => event.id),
          );
          const eventsToUpload = latestEvents.value.events.filter((event) =>
            pendingEventIds.has(event.localEventId),
          );
          const uploadedEvents = buildPosLocalSyncUploadEvents(
            eventsToUpload,
            latestEvents.value.events,
          );
          setDebug((current) => ({
            ...current,
            lastBatchEventCount: uploadedEvents.length,
          }));
          if (uploadedEvents.length === 0) return { syncedEventIds: [] };

          const result = await ingestLocalEvents(
            toIngestLocalEventsArgs({
              events: uploadedEvents,
              storeId: syncSeed.storeId,
              syncSecretHash: syncSeed.syncSecretHash,
              terminalId: cloudTerminalId,
            }),
          );
          if (shouldStop()) {
            return { syncedEventIds: [] };
          }
          if (result.kind !== "ok") {
            setDebug((current) => ({
              ...current,
              lastReviewEventCount: uploadedEvents.length,
            }));
            return {
              syncedEventIds: [],
              reviewEventIds: collectReviewLocalEventIds(
                latestEvents.value.events,
                uploadedEvents.map((event) => event.localEventId),
              ),
            };
          }

          const mappingWrite = await writeReturnedLocalCloudMappings(
            store,
            result.data.mappings,
          );
          if (shouldStop()) {
            return { syncedEventIds: [] };
          }
          if (!mappingWrite.ok) {
            setReadError(mappingWrite.message);
            setDebug((current) => ({
              ...current,
              lastReviewEventCount: uploadedEvents.length,
            }));
            return {
              syncedEventIds: [],
              reviewEventIds: collectReviewLocalEventIds(
                latestEvents.value.events,
                uploadedEvents.map((event) => event.localEventId),
              ),
            };
          }
          const reviewEventIds = collectServerReviewLocalEventIds(
            result.data.accepted,
          );
          setDebug((current) => ({
            ...current,
            lastHeldEventCount: result.data.held.length,
            lastReviewEventCount: reviewEventIds.length,
          }));

          return {
            heldEventIds: collectServerHeldLocalEventIds(result.data.held),
            syncedEventIds: collectSyncedLocalEventIds(
              latestEvents.value.events,
              collectServerSyncedLocalEventIds(result.data.accepted),
            ),
            reviewEventIds: collectReviewLocalEventIds(
              latestEvents.value.events,
              reviewEventIds,
            ),
          };
        },
        markNeedsReview: async (eventIds) => {
          if (eventIds.length === 0) return;
          const result = await store.markEventsNeedsReview(
            eventIds,
            "Cloud sync needs review before this local event can finish.",
            { uploaded: true },
          );
          if (shouldStop()) {
            return;
          }
          assertPosLocalStoreOk(result);
          if (!(await refreshEvents())) {
            return;
          }
          if (shouldStop()) {
            return;
          }
          onLocalEventsChanged?.();
        },
      });

      if (mode === "status-only") {
        stopSchedulers.push(
          startStatusOnlyRuntimeTriggers(() => {
            setIsOnline(
              typeof navigator === "undefined" ? true : navigator.onLine,
            );
            setRefreshToken((current) => current + 1);
          }),
        );

        if (
          drainOnAppend &&
          trigger === "event-appended" &&
          provisionedSeed &&
          provisionedSeed.syncSecretHash &&
          provisionedSeed.cloudTerminalId === cloudTerminalId
        ) {
          const scheduler = createDrainScheduler(provisionedSeed);
          stopSchedulers.push(() => scheduler.stop());
          scheduler.trigger("event-appended", { priority: "high" });
        }
        return;
      }

      if (
        !provisionedSeed ||
        !provisionedSeed.syncSecretHash ||
        provisionedSeed.cloudTerminalId !== cloudTerminalId
      ) {
        return;
      }

      const scheduler = createDrainScheduler(provisionedSeed);
      stopSchedulers.push(scheduler.startForegroundTriggers());
      scheduler.trigger(trigger, { priority: "high" });
    })();

    return () => {
      cancelled = true;
      for (const stopScheduler of stopSchedulers) {
        stopScheduler();
      }
    };
  }, [
    drainOnAppend,
    ingestLocalEvents,
    eventAppendToken,
    manualRetryToken,
    mode,
    onLocalEventsChanged,
    storeFactory,
    storeId,
    terminalId,
    refreshToken,
  ]);

  return useMemo(() => {
    if (readError) {
      return {
        description:
          "Local register activity could not be read. Check this terminal before continuing.",
        debug,
        label: "Local sync unavailable",
        onRetrySync: requestRetry,
        pendingEventCount: 1,
        status: "needs_review",
      };
    }

    const source = derivePosLocalRuntimeSyncStatus(events, {
      isOnline,
      onRetrySync: requestRetry,
      staffProfileId,
    });
    if (source) return { ...source, debug };

    return debug.lastTrigger
      ? {
          debug,
          onRetrySync: requestRetry,
        }
      : null;
  }, [debug, events, isOnline, readError, requestRetry, staffProfileId]);
}

function startStatusOnlyRuntimeTriggers(refresh: () => void) {
  const win = globalThis.window;
  const doc = globalThis.document;
  const interval = setInterval(refresh, 30_000);

  const handleOnlineStateChange = () => refresh();
  const handleVisibility = () => {
    if (!doc || doc.visibilityState === "hidden") return;
    refresh();
  };

  win?.addEventListener?.("online", handleOnlineStateChange);
  win?.addEventListener?.("offline", handleOnlineStateChange);
  doc?.addEventListener?.("visibilitychange", handleVisibility);

  return () => {
    clearInterval(interval);
    win?.removeEventListener?.("online", handleOnlineStateChange);
    win?.removeEventListener?.("offline", handleOnlineStateChange);
    doc?.removeEventListener?.("visibilitychange", handleVisibility);
  };
}

function toIngestLocalEventsArgs(input: {
  events: PosLocalUploadEvent[];
  storeId: string;
  syncSecretHash: string;
  terminalId: string;
}): IngestLocalEventsArgs {
  return {
    storeId: input.storeId as Id<"store">,
    terminalId: input.terminalId as Id<"posTerminal">,
    syncSecretHash: input.syncSecretHash,
    events: input.events.map(toIngestLocalEventArg),
  };
}

function toIngestLocalEventArg(
  event: PosLocalUploadEvent,
): IngestLocalEventsArgs["events"][number] {
  return {
    ...event,
    staffProfileId: event.staffProfileId as Id<"staffProfile">,
  };
}

export function assertPosLocalStoreOk<T>(result: PosLocalStoreResult<T>) {
  if (!result.ok) {
    throw new Error(result.error.message);
  }
}

async function readScopedPosLocalUploadEvents(input: {
  store: PosLocalRuntimeStore;
  storeId?: string | null;
  terminalId?: string | null;
}) {
  const [events, terminalSeed] = await Promise.all([
    input.store.listEventsForUpload
      ? input.store.listEventsForUpload()
      : input.store.listEvents(),
    input.store.readProvisionedTerminalSeed(),
  ]);
  if (!events.ok) return events;
  if (!terminalSeed.ok) return terminalSeed;

  const scope = resolvePosLocalTerminalScope({
    storeId: input.storeId,
    terminalId: input.terminalId,
    terminalSeed: terminalSeed.value,
  });

  return {
    ok: true as const,
    value: {
      events: events.value.filter((event) =>
        isPosLocalEventInTerminalScope(event, scope),
      ),
      terminalSeed: scope.provisionedSeed,
    },
  };
}

function buildRuntimeSyncDebug(
  events: PosLocalEventRecord[],
  mode: PosLocalSyncRuntimeMode,
): PosLocalRuntimeSyncDebug {
  const pendingUploadCandidates = events.filter(isPendingUploadCandidate);
  const pendingUploadableEvents = pendingUploadCandidates.filter(
    isSyncablePosLocalEvent,
  );
  const nextPendingUploadableEvent = [...pendingUploadableEvents]
    .sort(compareUploadableEventOrder)
    .at(0);
  const localOnlyEvents = pendingUploadCandidates.filter(
    (event) => !isSyncablePosLocalEvent(event),
  );
  const reviewEvents = events.filter(
    (event) => event.sync.status === "needs_review",
  );
  const failedEvents = events.filter((event) => event.sync.status === "failed");
  const oldestPendingEvent = [...events]
    .filter((event) => event.sync.status !== "synced")
    .sort((left, right) => left.createdAt - right.createdAt)
    .at(0);

  return {
    failedEventCount: failedEvents.length,
    localOnlyEventCount: localOnlyEvents.length,
    mode,
    oldestPendingEventAt: oldestPendingEvent?.createdAt,
    oldestPendingEventId: oldestPendingEvent?.localEventId,
    oldestPendingEventSequence: oldestPendingEvent?.sequence,
    oldestPendingUploadSequence: oldestPendingEvent?.uploadSequence,
    nextPendingUploadSequence: nextPendingUploadableEvent?.uploadSequence,
    pendingUploadEventCount: pendingUploadableEvents.length,
    reviewEventCount: reviewEvents.length,
  };
}

function compareUploadableEventOrder(
  left: PosLocalEventRecord,
  right: PosLocalEventRecord,
) {
  const leftUploadSequence = left.uploadSequence ?? Number.POSITIVE_INFINITY;
  const rightUploadSequence = right.uploadSequence ?? Number.POSITIVE_INFINITY;
  if (leftUploadSequence !== rightUploadSequence) {
    return leftUploadSequence - rightUploadSequence;
  }

  return left.sequence - right.sequence;
}

function isPendingUploadCandidate(event: PosLocalEventRecord) {
  return (
    event.sync.status === "pending" ||
    event.sync.status === "syncing" ||
    event.sync.status === "failed"
  );
}

export function collectServerSyncedLocalEventIds(
  acceptedEvents: Array<{
    localEventId: string;
    status: string;
  }>,
) {
  return acceptedEvents
    .filter((event) => event.status === "projected")
    .map((event) => event.localEventId);
}

export function collectServerReviewLocalEventIds(
  acceptedEvents: Array<{
    localEventId: string;
    status: string;
  }>,
) {
  return acceptedEvents
    .filter(
      (event) => event.status === "conflicted" || event.status === "rejected",
    )
    .map((event) => event.localEventId);
}

export function collectServerHeldLocalEventIds(
  heldEvents: Array<{
    localEventId: string;
  }>,
) {
  return heldEvents.map((event) => event.localEventId);
}

export async function writeReturnedLocalCloudMappings(
  store: PosLocalRuntimeStore,
  mappings: Array<{
    cloudId: string;
    localId: string;
    localIdKind: string;
    createdAt: number;
  }>,
) {
  for (const mapping of mappings) {
    const entity = toLocalCloudMappingEntity(mapping.localIdKind);
    if (!entity) continue;

    const result = await store.writeLocalCloudMapping({
      entity,
      localId: mapping.localId,
      cloudId: mapping.cloudId,
      mappedAt: mapping.createdAt,
    });
    if (!result.ok) return { ok: false as const, message: result.error.message };
  }

  return { ok: true as const };
}

function toLocalCloudMappingEntity(
  kind: string,
): PosLocalCloudMapping["entity"] | null {
  if (kind === "registerSession") return "registerSession";
  if (kind === "posSession") return "posSession";
  if (kind === "transaction") return "posTransaction";
  return null;
}

export function collectSyncedLocalEventIds(
  events: PosLocalEventRecord[],
  acceptedUploadEventIds: string[],
) {
  return collectAcceptedEventIdsWithLocalPrecursors(events, acceptedUploadEventIds);
}

function collectReviewLocalEventIds(
  events: PosLocalEventRecord[],
  acceptedReviewEventIds: string[],
) {
  return collectAcceptedEventIdsWithLocalPrecursors(events, acceptedReviewEventIds);
}

function collectAcceptedEventIdsWithLocalPrecursors(
  events: PosLocalEventRecord[],
  acceptedEventIds: string[],
) {
  const accepted = new Set(acceptedEventIds);
  const eventIds = new Set(acceptedEventIds);

  for (const event of events) {
    if (!accepted.has(event.localEventId)) continue;
    if (event.type !== "transaction.completed" && event.type !== "cart.cleared") {
      continue;
    }

    for (const candidate of events) {
      if (
        candidate.sequence < event.sequence &&
        candidate.localRegisterSessionId === event.localRegisterSessionId &&
        candidate.localPosSessionId === event.localPosSessionId &&
        (candidate.type === "session.started" ||
          candidate.type === "session.payments_updated" ||
          candidate.type === "cart.cleared" ||
          candidate.type === "cart.item_added")
      ) {
        eventIds.add(candidate.localEventId);
      }
    }
  }

  return Array.from(eventIds);
}

export function derivePosLocalRuntimeSyncStatus(
  events: PosLocalEventRecord[],
  options: {
    isOnline: boolean;
    onRetrySync?: (() => void) | null;
    staffProfileId?: string | null;
  },
): PosLocalRuntimeSyncStatusSource | null {
  const scopedEvents =
    options.staffProfileId === undefined
      ? events
      : options.staffProfileId
        ? events.filter((event) => event.staffProfileId === options.staffProfileId)
        : [];
  const relevantEvents = collectRuntimeRelevantEvents(scopedEvents);
  const status = derivePosLocalSyncStatus({
    events: relevantEvents.map((event) =>
      typeof event.uploadSequence === "number"
        ? event
        : { ...event, uploadSequence: event.sequence },
    ),
    isOnline: options.isOnline,
  });

  if (status.state === "synced") {
    return null;
  }

  return {
    onRetrySync: options.onRetrySync ?? null,
    pendingEventCount: status.pendingCount + status.failedCount,
    status: status.state === "failed" || status.state === "needs_review"
        ? "needs_review"
        : hasPendingLocalCloseout(relevantEvents)
          ? "locally_closed_pending_sync"
          : status.state,
  };
}

function collectRuntimeRelevantEvents(events: PosLocalEventRecord[]) {
  const relevantIds = new Set<string>();

  for (const event of events) {
    if (isRuntimeRelevantLocalEvent(event)) {
      relevantIds.add(event.localEventId);
    }
  }

  for (const event of events) {
    if (
      (event.type !== "transaction.completed" && event.type !== "cart.cleared") ||
      event.sync.status === "synced"
    ) {
      continue;
    }

    for (const candidate of events) {
      if (
        candidate.sequence < event.sequence &&
        candidate.localRegisterSessionId === event.localRegisterSessionId &&
        candidate.localPosSessionId === event.localPosSessionId &&
        (candidate.type === "session.started" ||
          candidate.type === "session.payments_updated" ||
          candidate.type === "cart.cleared" ||
          candidate.type === "cart.item_added")
      ) {
        relevantIds.add(candidate.localEventId);
      }
    }
  }

  return events.filter((event) => relevantIds.has(event.localEventId));
}

function isRuntimeRelevantLocalEvent(event: PosLocalEventRecord) {
  return (
    isSyncablePosLocalEvent(event) ||
    event.type === "register.opened" ||
    event.type === "transaction.completed" ||
    event.type === "cart.cleared" ||
    event.type === "register.closeout_started" ||
    event.type === "register.reopened"
  );
}

function hasPendingLocalCloseout(events: PosLocalEventRecord[]) {
  const latestRegisterEventsBySession = new Map<string, PosLocalEventRecord>();

  for (const event of [...events].sort(
    (left, right) => left.sequence - right.sequence,
  )) {
    if (
      !event.localRegisterSessionId ||
      (event.type !== "register.closeout_started" &&
        event.type !== "register.reopened")
    ) {
      continue;
    }

    latestRegisterEventsBySession.set(event.localRegisterSessionId, event);
  }

  return Array.from(latestRegisterEventsBySession.values()).some(
    (event) =>
      event.type === "register.closeout_started" &&
      event.sync.status !== "synced",
  );
}
