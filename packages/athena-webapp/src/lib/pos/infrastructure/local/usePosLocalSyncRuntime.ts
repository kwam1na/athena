import { useEffect, useMemo, useState } from "react";
import { useMutation } from "convex/react";
import type { FunctionArgs } from "convex/server";

import { api } from "~/convex/_generated/api";
import type { Id } from "~/convex/_generated/dataModel";
import {
  createIndexedDbPosLocalStorageAdapter,
  createPosLocalStore,
  type PosLocalEventRecord,
  type PosLocalStoreResult,
} from "./posLocalStore";
import {
  buildPosLocalSyncUploadEvents,
  isSyncablePosLocalEvent,
  type PosLocalUploadEvent,
} from "./syncContract";
import { createPosLocalSyncScheduler } from "./syncScheduler";
import { derivePosLocalSyncStatus } from "./syncStatus";

export type PosLocalRuntimeSyncStatusSource = {
  description?: string | null;
  label?: string | null;
  onRetrySync?: (() => void) | null;
  pendingEventCount?: number | null;
  status?: string | null;
};

type PosLocalRuntimeStore = ReturnType<typeof createPosLocalStore>;
type IngestLocalEventsArgs = FunctionArgs<
  typeof api.pos.public.sync.ingestLocalEvents
>;

export function usePosLocalSyncRuntimeStatus(input: {
  storeId?: string | null;
  terminalId?: string | null;
  onRetrySync?: (() => void) | null;
  storeFactory?: (() => PosLocalRuntimeStore) | null;
}): PosLocalRuntimeSyncStatusSource | null {
  const ingestLocalEvents = useMutation(api.pos.public.sync.ingestLocalEvents);
  const [events, setEvents] = useState<PosLocalEventRecord[]>([]);
  const [refreshToken, setRefreshToken] = useState(0);
  const { storeFactory, storeId, terminalId } = input;
  const onRetrySync = input.onRetrySync;
  const isOnline = typeof navigator === "undefined" ? true : navigator.onLine;

  useEffect(() => {
    if (!storeId || (!storeFactory && typeof indexedDB === "undefined")) {
      setEvents([]);
      return;
    }

    let cancelled = false;
    const store =
      storeFactory?.() ??
      createPosLocalStore({
        adapter: createIndexedDbPosLocalStorageAdapter(),
      });
    let stopScheduler: (() => void) | null = null;

    void (async () => {
      const seed = await store.readProvisionedTerminalSeed();
      const localTerminalId =
        seed.ok &&
        seed.value !== null &&
        (!terminalId || seed.value.cloudTerminalId === terminalId)
          ? seed.value.terminalId
          : terminalId;
      const cloudTerminalId =
        seed.ok && seed.value !== null ? seed.value.cloudTerminalId : terminalId;
      if (!localTerminalId || !cloudTerminalId) {
        setEvents([]);
        return;
      }
      const eventsResult = await store.listEvents();
      if (!eventsResult.ok || cancelled) return;
      const refreshEvents = async () => {
        const refreshedEvents = await store.listEvents();
        if (!refreshedEvents.ok || cancelled) return;
        setEvents(
          refreshedEvents.value.filter(
            (event) =>
              event.storeId === storeId &&
              (event.terminalId === cloudTerminalId ||
                event.terminalId === localTerminalId),
          ),
        );
      };
      setEvents(
        eventsResult.value.filter(
          (event) =>
            event.storeId === storeId &&
            (event.terminalId === cloudTerminalId ||
              event.terminalId === localTerminalId),
        ),
      );

      if (
        !seed.ok ||
        seed.value === null ||
        !seed.value.syncSecretHash ||
        seed.value.cloudTerminalId !== cloudTerminalId
      ) {
        return;
      }
      const provisionedSeed = seed.value;

      const scheduler = createPosLocalSyncScheduler({
        isOnline: () =>
          typeof navigator === "undefined" ? true : navigator.onLine,
        loadPendingEvents: async () => {
          const pending = await store.listEvents();
          if (!pending.ok) return [];
          return pending.value
            .filter(
              (event) =>
                event.storeId === storeId &&
                (event.terminalId === cloudTerminalId ||
                  event.terminalId === localTerminalId) &&
                (event.sync.status === "pending" ||
                  event.sync.status === "syncing" ||
                  event.sync.status === "failed"),
            )
            .filter((event) => isSyncablePosLocalEvent(event))
            .map((event) => ({
              id: event.localEventId,
              terminalId: event.terminalId,
              localRegisterSessionId: event.localRegisterSessionId ?? "",
              createdAt: event.createdAt,
              sequence: event.sequence,
            }));
        },
        markSynced: async (eventIds) => {
          if (eventIds.length === 0) return;
          const result = await store.markEventsSynced(eventIds, {
            uploaded: true,
          });
          assertPosLocalStoreOk(result);
          await refreshEvents();
        },
        uploadBatch: async (pendingEvents) => {
          const latestEvents = await store.listEvents();
          if (!latestEvents.ok) return { syncedEventIds: [] };
          const pendingEventIds = new Set(
            pendingEvents.map((event) => event.id),
          );
          const eventsToUpload = latestEvents.value.filter((event) =>
            pendingEventIds.has(event.localEventId),
          );
          const uploadedEvents = buildPosLocalSyncUploadEvents(
            eventsToUpload,
            latestEvents.value,
          );
          if (uploadedEvents.length === 0) return { syncedEventIds: [] };

          const result = await ingestLocalEvents(
            toIngestLocalEventsArgs({
              events: uploadedEvents,
              storeId: provisionedSeed.storeId,
              syncSecretHash: provisionedSeed.syncSecretHash,
              terminalId: cloudTerminalId,
            }),
          );
          if (result.kind !== "ok") {
            throw new Error(result.error.message);
          }

          return {
            heldEventIds: collectServerHeldLocalEventIds(result.data.held),
            syncedEventIds: collectSyncedLocalEventIds(
              latestEvents.value,
              collectServerSyncedLocalEventIds(result.data.accepted),
            ),
            reviewEventIds: collectReviewLocalEventIds(
              latestEvents.value,
              collectServerReviewLocalEventIds(result.data.accepted),
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
          assertPosLocalStoreOk(result);
          await refreshEvents();
        },
      });
      stopScheduler = scheduler.startForegroundTriggers();
      scheduler.trigger("route-entry");
    })();

    return () => {
      cancelled = true;
      stopScheduler?.();
    };
  }, [
    ingestLocalEvents,
    storeFactory,
    storeId,
    terminalId,
    refreshToken,
  ]);

  return useMemo(() => {
    return derivePosLocalRuntimeSyncStatus(events, {
      isOnline,
      onRetrySync: () => {
        setRefreshToken((current) => current + 1);
        onRetrySync?.();
      },
    });
  }, [events, isOnline, onRetrySync]);
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

function collectSyncedLocalEventIds(
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
    if (event.type !== "transaction.completed") continue;

    for (const candidate of events) {
      if (
        candidate.sequence < event.sequence &&
        candidate.localRegisterSessionId === event.localRegisterSessionId &&
        candidate.localPosSessionId === event.localPosSessionId &&
        (candidate.type === "session.started" ||
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
  },
): PosLocalRuntimeSyncStatusSource | null {
  const relevantEvents = collectRuntimeRelevantEvents(events);
  const status = derivePosLocalSyncStatus({
    events: relevantEvents,
    isOnline: options.isOnline,
  });

  if (status.state === "synced") {
    return null;
  }

  return {
    onRetrySync: options.onRetrySync ?? null,
    pendingEventCount: status.pendingCount + status.failedCount,
    status: hasPendingLocalCloseout(relevantEvents)
      ? "locally_closed_pending_sync"
      : status.state === "failed"
        ? "needs_review"
        : status.state,
  };
}

function collectRuntimeRelevantEvents(events: PosLocalEventRecord[]) {
  const relevantIds = new Set<string>();

  for (const event of events) {
    if (isSyncablePosLocalEvent(event)) {
      relevantIds.add(event.localEventId);
    }
  }

  for (const event of events) {
    if (
      event.type !== "transaction.completed" ||
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
          candidate.type === "cart.item_added")
      ) {
        relevantIds.add(candidate.localEventId);
      }
    }
  }

  return events.filter((event) => relevantIds.has(event.localEventId));
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
