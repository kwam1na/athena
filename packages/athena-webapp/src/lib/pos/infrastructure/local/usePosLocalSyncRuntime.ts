import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import type { FunctionArgs } from "convex/server";

import { api } from "~/convex/_generated/api";
import type { Id } from "~/convex/_generated/dataModel";
import {
  createIndexedDbPosLocalStorageAdapter,
  createPosLocalStore,
  type PosLocalCloudMapping,
  type PosDrawerAuthorityState,
  type PosLocalEventRecord,
  type PosLocalStaffAuthorityReadiness,
  type PosLocalStoreResult,
  type PosTerminalIntegrityState,
  type PosProvisionedTerminalSeed,
} from "./posLocalStore";
import {
  buildPosLocalSyncUploadEvents,
  isSyncablePosLocalEvent,
  isUploadDeferredByValidation,
  type PosLocalUploadEvent,
  type PosLocalSyncUploadSupport,
} from "./syncContract";
import {
  createPosLocalSyncScheduler,
  type PosLocalSyncTrigger,
} from "./syncScheduler";
import { derivePosLocalSyncStatus } from "./syncStatus";
import {
  readProjectedLocalRegisterModel,
  readScopedPosLocalEvents,
} from "./localRegisterReader";
import {
  isPosLocalEventInTerminalScope,
  resolvePosLocalTerminalScope,
} from "./terminalScope";
import {
  buildPosTerminalRuntimeCopyDiagnostics,
  buildPosTerminalRuntimeStatus,
  toReportablePosTerminalRuntimeStatus,
  type PosTerminalRuntimeAppSessionRecoveryInput,
  type PosTerminalRuntimeCopyDiagnostics,
  type PosTerminalRuntimeSnapshotReadiness,
  type PosTerminalRuntimeStatusPayload,
  type PosTerminalRuntimeStatusSource,
  type PosTerminalRuntimeSyncDebugInput,
} from "./terminalRuntimeStatus";
import {
  executeTerminalRecoveryCommand,
  type PosTerminalRecoveryCommandResult,
} from "./terminalRecoveryCommands";

export type PosLocalRuntimeSyncStatusSource = {
  copyDiagnostics?: PosTerminalRuntimeCopyDiagnostics;
  debug?: PosLocalRuntimeSyncDebug;
  description?: string | null;
  label?: string | null;
  onRetrySync?: (() => void) | null;
  pendingEventCount?: number | null;
  runtimeStatus?: PosTerminalRuntimeStatusPayload;
  status?: string | null;
};

export type PosLocalRuntimeSyncDebug = {
  checkInPublishAttemptedAt?: number;
  checkInPublishCompletedAt?: number;
  checkInPublishMessage?: string;
  checkInPublishReason?:
    | "authorization_failed"
    | "missing_store"
    | "missing_sync_secret"
    | "missing_terminal"
    | "not_ready"
    | "rejected"
    | "unavailable";
  checkInPublishStatus?:
    | "accepted"
    | "failed"
  | "not_ready"
  | "pending"
  | "rejected";
  terminalRecoveryCommandAttemptedAt?: number;
  terminalRecoveryCommandCompletedAt?: number;
  terminalRecoveryCommandMessage?: string;
  terminalRecoveryCommandStatus?:
    | "completed"
    | "failed"
    | "ignored"
    | "pending";
  appSessionUnverifiedEventCount?: number;
  cloudValidationUncertainEventCount?: number;
  deferredUploadEventCount?: number;
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
type ListTerminalRecoveryCommandsArgs = FunctionArgs<
  typeof api.pos.public.terminals.listTerminalRecoveryCommands
>;
type IngestLocalEventsUploadArgs = Omit<IngestLocalEventsArgs, "events"> & {
  events: PosLocalUploadEvent[];
};

export function usePosLocalSyncRuntimeStatus(input: {
  appSessionRecovery?: PosTerminalRuntimeAppSessionRecoveryInput | null;
  storeId?: string | null;
  terminalId?: string | null;
  drainOnAppend?: boolean;
  eventAppendToken?: number;
  mode?: PosLocalSyncRuntimeMode;
  onLocalEventsChanged?: (() => void) | null;
  onRetrySync?: (() => void) | null;
  source?: PosTerminalRuntimeStatusSource;
  staffProfileId?: string | null;
  staffAuthorityStatus?: PosLocalStaffAuthorityReadiness | "unknown";
  storeFactory?: (() => PosLocalRuntimeStore) | null;
}): PosLocalRuntimeSyncStatusSource | null {
  const ingestLocalEvents = useMutation(api.pos.public.sync.ingestLocalEvents);
  const reportTerminalRuntimeStatus = useMutation(
    api.pos.public.terminals.reportTerminalRuntimeStatus,
  );
  const claimTerminalRecoveryCommand = useMutation(
    api.pos.public.terminals.claimTerminalRecoveryCommand,
  );
  const acknowledgeTerminalRecoveryCommand = useMutation(
    api.pos.public.terminals.acknowledgeTerminalRecoveryCommand,
  );
  const [events, setEvents] = useState<PosLocalEventRecord[]>([]);
  const [runtimeReadiness, setRuntimeReadiness] =
    useState<PosTerminalRuntimeReadiness>({
      drawerAuthority: null,
      snapshots: {},
      staffAuthorityStatus: "unknown",
      terminalIntegrity: null,
      terminalSeed: null,
    });
  const [readError, setReadError] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const [manualRetryToken, setManualRetryToken] = useState(0);
  const [runtimeStatusObservationToken, setRuntimeStatusObservationToken] =
    useState(0);
  const [recoveryCommandRetryToken, setRecoveryCommandRetryToken] = useState(0);
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
  const source = input.source ?? "sync-runtime";
  const staffProfileId = input.staffProfileId;
  const uploadSupport = useMemo(
    () => getAppSessionUploadSupport(input.appSessionRecovery),
    [input.appSessionRecovery],
  );
  const lastRuntimeStatusSignatureRef = useRef<string | null>(null);
  const observedRecoveryCommandIdsRef = useRef<Set<string>>(new Set());
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
        setRuntimeReadiness({
          drawerAuthority: null,
          snapshots: {},
          staffAuthorityStatus: "unknown",
          terminalIntegrity: null,
          terminalSeed: null,
        });
        return;
      }
      setRuntimeReadiness((current) => ({
        ...current,
        terminalSeed: provisionedSeed,
      }));
      void refreshTerminalRuntimeReadiness({
        store,
        storeId,
        terminalId: cloudTerminalId,
        terminalSeed: provisionedSeed,
      }).then((readiness) => {
        if (shouldStop()) return;
        setRuntimeReadiness(readiness);
        setRuntimeStatusObservationToken((current) => current + 1);
      });
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
        setRuntimeStatusObservationToken((current) => current + 1);
        setDebug((current) => ({
          ...current,
          ...buildRuntimeSyncDebug(
            refreshedEvents.value.events,
            mode,
            uploadSupport,
          ),
        }));
        return true;
      };
      setEvents(eventsResult.value.events);
      setReadError(null);
      setRuntimeStatusObservationToken((current) => current + 1);
      setDebug((current) => ({
        ...current,
        ...buildRuntimeSyncDebug(eventsResult.value.events, mode, uploadSupport),
        lastTrigger: trigger,
        lastTriggerAt: Date.now(),
        lastTriggerPriority: triggerPriority,
      }));

      const createDrainScheduler = (
        syncSeed: NonNullable<typeof provisionedSeed>,
        options: {
          includeUploadedReviewEvents?: boolean;
          onlyUploadedReviewEvents?: boolean;
        } = {},
      ) => createPosLocalSyncScheduler({
        isOnline: () =>
          typeof navigator === "undefined" ? true : navigator.onLine,
        loadPendingEvents: async () => {
          const readTerminalIntegrityState = (
            store as {
              readTerminalIntegrityState?: PosLocalRuntimeStore["readTerminalIntegrityState"];
            }
          ).readTerminalIntegrityState;
          if (readTerminalIntegrityState) {
            const terminalIntegrity = await readTerminalIntegrityState({
              storeId: syncSeed.storeId,
              terminalId: syncSeed.cloudTerminalId,
            });
            assertPosLocalStoreOk(terminalIntegrity);
            if (
              terminalIntegrity.value &&
              terminalIntegrity.value.status !== "healthy"
            ) {
              return [];
            }
          }

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
            .filter((event) => {
              const isUploadedReviewEvent =
                options.includeUploadedReviewEvents === true &&
                event.sync.status === "needs_review" &&
                event.sync.uploaded;
              if (options.onlyUploadedReviewEvents === true) {
                return isUploadedReviewEvent;
              }

              return (
                event.sync.status === "pending" ||
                event.sync.status === "syncing" ||
                event.sync.status === "failed" ||
                isUploadedReviewEvent
              );
            })
            .filter((event) => isSyncablePosLocalEvent(event, uploadSupport));
          if (!shouldStop()) {
            setDebug((current) => ({
              ...current,
              ...buildRuntimeSyncDebug(
                pending.value.events,
                mode,
                uploadSupport,
              ),
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
            uploadSupport,
          );
          const locallySettledEventIds = collectLocallySettledSkippedReviewEventIds(
            eventsToUpload,
            uploadedEvents,
          );
          setDebug((current) => ({
            ...current,
            lastBatchEventCount: uploadedEvents.length,
          }));
          if (uploadedEvents.length === 0) {
            return { syncedEventIds: locallySettledEventIds };
          }

          const result = await ingestLocalEvents(
            toIngestLocalEventsArgs({
              events: uploadedEvents,
              storeId: syncSeed.storeId,
              syncSecretHash: syncSeed.syncSecretHash,
              terminalId: cloudTerminalId,
            }) as IngestLocalEventsArgs,
          );
          if (shouldStop()) {
            return { syncedEventIds: [] };
          }
          if (result.kind !== "ok") {
            if (isTerminalAuthorizationFailure(result)) {
              await persistTerminalAuthorizationFailure({
                message: result.error.message,
                store,
                syncSeed,
              });
              if (!(await refreshEvents())) {
                return { syncedEventIds: [] };
              }
              if (shouldStop()) {
                return { syncedEventIds: [] };
              }
              onLocalEventsChanged?.();
              return { syncedEventIds: [] };
            }
            if (isRetryableSyncAuthorizationFailure(result)) {
              throw new Error(result.error.message);
            }
            setDebug((current) => ({
              ...current,
              lastReviewEventCount: uploadedEvents.length,
            }));
            const reviewEventIds = collectReviewLocalEventIds(
              latestEvents.value.events,
              uploadedEvents.map((event) => event.localEventId),
            );
            const localReviewEventIds = withoutEventIds(
              reviewEventIds,
              locallySettledEventIds,
            );
            await persistDrawerAuthorityBlockForReviewEvents({
              events: latestEvents.value.events,
              reason: "lifecycle_rejected",
              reviewEventIds: localReviewEventIds,
              store,
            });
            return {
              syncedEventIds: locallySettledEventIds,
              reviewEventIds: localReviewEventIds,
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
            const reviewEventIds = collectReviewLocalEventIds(
              latestEvents.value.events,
              uploadedEvents.map((event) => event.localEventId),
            );
            const localReviewEventIds = withoutEventIds(
              reviewEventIds,
              locallySettledEventIds,
            );
            await persistDrawerAuthorityBlockForReviewEvents({
              events: latestEvents.value.events,
              reason: "authority_unknown",
              reviewEventIds: localReviewEventIds,
              store,
            });
            return {
              syncedEventIds: locallySettledEventIds,
              reviewEventIds: localReviewEventIds,
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
          const localReviewEventIds = collectReviewLocalEventIds(
            latestEvents.value.events,
            reviewEventIds,
          );
          await persistDrawerAuthorityBlockForReviewEvents({
            events: latestEvents.value.events,
            reason: "lifecycle_rejected",
            reviewEventIds: localReviewEventIds,
            store,
          });
          const syncedEventIds = collectSyncedLocalEventIds(
            latestEvents.value.events,
            collectServerSettledLocalEventIds(result.data.accepted),
          );
          const localSyncedEventIds = mergeEventIds(
            locallySettledEventIds,
            syncedEventIds,
          );
          await clearSupersededRecoverableDrawerAuthorityBlocks({
            acceptedEvents: result.data.accepted,
            events: latestEvents.value.events,
            returnedMappings: result.data.mappings,
            store,
          });
          await clearRecoverableDrawerAuthorityForSyncedEvents({
            events: latestEvents.value.events,
            reviewEventIds: localReviewEventIds,
            store,
            syncedEventIds: localSyncedEventIds,
          });

          return {
            heldEventIds: collectServerHeldLocalEventIds(result.data.held),
            syncedEventIds: localSyncedEventIds,
            reviewEventIds: withoutEventIds(
              localReviewEventIds,
              locallySettledEventIds,
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
          provisionedSeed &&
          provisionedSeed.syncSecretHash &&
          provisionedSeed.cloudTerminalId === cloudTerminalId
        ) {
          if (drainOnAppend && trigger === "event-appended") {
            const scheduler = createDrainScheduler(provisionedSeed);
            stopSchedulers.push(() => scheduler.stop());
            scheduler.trigger("event-appended", { priority: "high" });
          }

          if (trigger === "manual-retry") {
            const scheduler = createDrainScheduler(provisionedSeed, {
              includeUploadedReviewEvents: true,
              onlyUploadedReviewEvents: true,
            });
            stopSchedulers.push(() => scheduler.stop());
            scheduler.trigger("manual-retry", { priority: "high" });
          }
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

      const foregroundScheduler = createDrainScheduler(provisionedSeed);
      stopSchedulers.push(foregroundScheduler.startForegroundTriggers());

      if (trigger === "manual-retry") {
        const manualRetryScheduler = createDrainScheduler(provisionedSeed, {
          includeUploadedReviewEvents: true,
        });
        stopSchedulers.push(() => manualRetryScheduler.stop());
        manualRetryScheduler.trigger("manual-retry", { priority: "high" });
        return;
      }

      foregroundScheduler.trigger(trigger, { priority: "high" });
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
    input.appSessionRecovery,
    storeFactory,
    storeId,
    terminalId,
    refreshToken,
    uploadSupport,
  ]);

  const runtimeStatusSyncDebug = useMemo<PosTerminalRuntimeSyncDebugInput>(
    () => ({
      failedEventCount: debug.failedEventCount,
      lastFailure: debug.lastFailure,
      lastTrigger: debug.lastTrigger,
      localOnlyEventCount: debug.localOnlyEventCount,
      nextPendingUploadSequence: debug.nextPendingUploadSequence,
      oldestPendingEventAt: debug.oldestPendingEventAt,
      pendingUploadEventCount: debug.pendingUploadEventCount,
      reviewEventCount: debug.reviewEventCount,
      schedulerRunning: debug.schedulerRunning,
    }),
    [
      debug.failedEventCount,
      debug.lastFailure,
      debug.lastTrigger,
      debug.localOnlyEventCount,
      debug.nextPendingUploadSequence,
      debug.oldestPendingEventAt,
      debug.pendingUploadEventCount,
      debug.reviewEventCount,
      debug.schedulerRunning,
    ],
  );

  const runtimeStatusInput = useMemo(
    () => ({
      appSessionRecovery: input.appSessionRecovery,
      browserInfo: getRuntimeBrowserInfo(isOnline),
      events,
      localStoreFailureMessage: readError,
      snapshots: runtimeReadiness.snapshots,
      source,
      drawerAuthority: runtimeReadiness.drawerAuthority,
      staffAuthorityStatus:
        input.staffAuthorityStatus ?? runtimeReadiness.staffAuthorityStatus,
      staffProfileId,
      syncDebug: runtimeStatusSyncDebug,
      terminalIntegrity: runtimeReadiness.terminalIntegrity,
      terminalSeed: runtimeReadiness.terminalSeed,
    }),
    [
      events,
      input.appSessionRecovery,
      input.staffAuthorityStatus,
      isOnline,
      readError,
      runtimeReadiness.drawerAuthority,
      runtimeReadiness.snapshots,
      runtimeReadiness.staffAuthorityStatus,
      runtimeReadiness.terminalIntegrity,
      runtimeReadiness.terminalSeed,
      runtimeStatusSyncDebug,
      source,
      staffProfileId,
    ],
  );
  const runtimeStatus = useMemo(
    () => buildPosTerminalRuntimeStatus(runtimeStatusInput),
    [runtimeStatusInput],
  );
  const copyDiagnostics = useMemo(
    () => buildPosTerminalRuntimeCopyDiagnostics(runtimeStatusInput),
    [runtimeStatusInput],
  );
  const runtimeStatusTerminalId =
    runtimeReadiness.terminalSeed?.cloudTerminalId ?? terminalId ?? null;
  const runtimeStatusSyncSecretHash =
    runtimeReadiness.terminalSeed?.syncSecretHash ?? null;
  const recoveryCommandArgs = useMemo(() => {
    if (!storeId || !runtimeStatusTerminalId || !runtimeStatusSyncSecretHash) {
      return "skip" as const;
    }
    return {
      storeId: storeId as Id<"store">,
      syncSecretHash: runtimeStatusSyncSecretHash,
      terminalId: runtimeStatusTerminalId as Id<"posTerminal">,
    } satisfies ListTerminalRecoveryCommandsArgs;
  }, [runtimeStatusSyncSecretHash, runtimeStatusTerminalId, storeId]);
  const recoveryCommands = useQuery(
    api.pos.public.terminals.listTerminalRecoveryCommands,
    recoveryCommandArgs,
  );

  useEffect(() => {
    const notReadyReason = getRuntimeCheckInNotReadyReason({
      storeId,
      syncSecretHash: runtimeStatusSyncSecretHash,
      terminalId: runtimeStatusTerminalId,
    });
    if (notReadyReason) {
      setDebug((current) =>
        withCheckInPublishDebug(current, {
          checkInPublishReason: notReadyReason,
          checkInPublishStatus: "not_ready",
        }),
      );
      return;
    }
    if (
      !runtimeReadiness.terminalSeed &&
      !readError &&
      events.length === 0
    ) {
      setDebug((current) =>
        withCheckInPublishDebug(current, {
          checkInPublishReason: "not_ready",
          checkInPublishStatus: "not_ready",
        }),
      );
      return;
    }

    const checkInStoreId = storeId as string;
    const checkInTerminalId = runtimeStatusTerminalId as string;
    const checkInSyncSecretHash = runtimeStatusSyncSecretHash as string;
    const signature = getRuntimeStatusPublishSignature({
      observationToken: runtimeStatusObservationToken,
      runtimeStatus,
      storeId: checkInStoreId,
      terminalId: checkInTerminalId,
    });
    if (signature === lastRuntimeStatusSignatureRef.current) return;
    lastRuntimeStatusSignatureRef.current = signature;

    const attemptedAt = Date.now();
    setDebug((current) =>
      withCheckInPublishDebug(current, {
        checkInPublishAttemptedAt: attemptedAt,
        checkInPublishCompletedAt: undefined,
        checkInPublishMessage: undefined,
        checkInPublishReason: undefined,
        checkInPublishStatus: "pending",
      }),
    );

    let isStale = false;
    const isCurrentPublishScope = () => !isStale;

    void reportTerminalRuntimeStatus({
      storeId: checkInStoreId as Id<"store">,
      terminalId: checkInTerminalId as Id<"posTerminal">,
      syncSecretHash: checkInSyncSecretHash,
      status: toReportablePosTerminalRuntimeStatus(runtimeStatus),
    })
      .then(async (result) => {
        if (!isCurrentPublishScope()) return;

        if (result.kind === "ok") {
          if (runtimeReadiness.terminalSeed) {
            const authorityStore =
              storeFactory?.() ??
              (typeof indexedDB === "undefined"
                ? null
                : createPosLocalStore({
                    adapter: createIndexedDbPosLocalStorageAdapter(),
                  }));

            if (authorityStore) {
              const cleared = await clearAcceptedTerminalIntegrityState({
                checkInTerminalId,
                store: authorityStore,
                storeId: checkInStoreId,
                terminalSeed: runtimeReadiness.terminalSeed,
              });
              if (!isCurrentPublishScope()) return;

              if (cleared) {
                setRuntimeReadiness((current) => ({
                  ...current,
                  terminalIntegrity: null,
                }));
                setRuntimeStatusObservationToken((current) => current + 1);
                onLocalEventsChanged?.();
              }
            }
          }

          setDebug((current) =>
            withCheckInPublishDebug(current, {
              checkInPublishCompletedAt: Date.now(),
              checkInPublishMessage: undefined,
              checkInPublishReason: undefined,
              checkInPublishStatus: "accepted",
            }),
          );
          return;
        }

        const error = result.kind === "user_error" ? result.error : null;
        const terminalAuthorizationRejected =
          isTerminalAuthorizationUserError(error);
        if (terminalAuthorizationRejected) {
          const authorityStore =
            storeFactory?.() ??
            (typeof indexedDB === "undefined"
              ? null
              : createPosLocalStore({
                  adapter: createIndexedDbPosLocalStorageAdapter(),
                }));
          if (
            authorityStore &&
            runtimeReadiness.terminalSeed &&
            typeof authorityStore.writeTerminalIntegrityState === "function"
          ) {
            try {
              const terminalIntegrity =
                await persistTerminalAuthorizationFailure({
                  message: error?.message,
                  store: authorityStore,
                  syncSeed: runtimeReadiness.terminalSeed,
                });
              if (!isCurrentPublishScope()) return;

              lastRuntimeStatusSignatureRef.current =
                getRuntimeStatusPublishSignature({
                  observationToken: runtimeStatusObservationToken,
                  runtimeStatus: buildPosTerminalRuntimeStatus({
                    ...runtimeStatusInput,
                    terminalIntegrity,
                  }),
                  storeId: checkInStoreId,
                  terminalId: checkInTerminalId,
                });
              setRuntimeReadiness((current) => ({
                ...current,
                terminalIntegrity,
              }));
            } catch {
              if (!isCurrentPublishScope()) return;

              setReadError(
                "Terminal setup needs repair before POS can continue.",
              );
            }
          }
        }
        if (!isCurrentPublishScope()) return;

        setDebug((current) =>
          withCheckInPublishDebug(current, {
            checkInPublishCompletedAt: Date.now(),
            checkInPublishMessage: error?.message ?? "Check-in was rejected.",
            checkInPublishReason:
              terminalAuthorizationRejected
                ? "authorization_failed"
                : "rejected",
            checkInPublishStatus: "rejected",
          }),
        );
      })
      .catch(() => {
        if (!isCurrentPublishScope()) return;

        setDebug((current) =>
          withCheckInPublishDebug(current, {
            checkInPublishCompletedAt: Date.now(),
            checkInPublishMessage: "Check-in could not reach the server.",
            checkInPublishReason: "unavailable",
            checkInPublishStatus: "failed",
          }),
        );
      });

    return () => {
      isStale = true;
    };
  }, [
    reportTerminalRuntimeStatus,
    events.length,
    readError,
    runtimeStatus,
    runtimeStatusObservationToken,
    runtimeReadiness.terminalIntegrity,
    runtimeReadiness.terminalSeed,
    runtimeStatusInput,
    runtimeStatusSyncSecretHash,
    runtimeStatusTerminalId,
    onLocalEventsChanged,
    storeFactory,
    storeId,
  ]);

  useEffect(() => {
    if (
      !runtimeReadiness.terminalSeed ||
      !storeId ||
      !runtimeStatusTerminalId ||
      !runtimeStatusSyncSecretHash ||
      !recoveryCommands ||
      recoveryCommands.kind !== "ok" ||
      recoveryCommands.data.length === 0
    ) {
      return;
    }

    const store =
      storeFactory?.() ??
      (typeof indexedDB === "undefined"
        ? null
        : createPosLocalStore({
            adapter: createIndexedDbPosLocalStorageAdapter(),
          }));
    if (!store) return;

    let isStale = false;
    const command = recoveryCommands.data.find(
      (candidate) => !observedRecoveryCommandIdsRef.current.has(candidate._id),
    );
    if (!command) return;
    observedRecoveryCommandIdsRef.current.add(command._id);

    const attemptedAt = Date.now();
    setDebug((current) => ({
      ...current,
      terminalRecoveryCommandAttemptedAt: attemptedAt,
      terminalRecoveryCommandCompletedAt: undefined,
      terminalRecoveryCommandMessage: undefined,
      terminalRecoveryCommandStatus: "pending",
    }));

    void claimTerminalRecoveryCommand({
      commandId: command._id,
      storeId: storeId as Id<"store">,
      syncSecretHash: runtimeStatusSyncSecretHash,
      terminalId: runtimeStatusTerminalId as Id<"posTerminal">,
    }).then(async (claimResult) => {
      if (claimResult.kind !== "ok") {
        observedRecoveryCommandIdsRef.current.delete(command._id);
        if (!isStale) {
          setDebug((current) => ({
            ...current,
            terminalRecoveryCommandCompletedAt: Date.now(),
            terminalRecoveryCommandMessage:
              claimResult.kind === "user_error"
                ? claimResult.error.message
                : "Recovery command could not be claimed.",
            terminalRecoveryCommandStatus: "failed",
          }));
          setRecoveryCommandRetryToken((current) => current + 1);
        }
        return;
      }

      const localResult = await executeTerminalRecoveryCommand({
        command: claimResult.data,
        onRetrySync: requestRetry,
        store,
        storeId,
        terminalId: runtimeStatusTerminalId,
        terminalSeed: runtimeReadiness.terminalSeed,
      });

      if (localResult.status === "ignored") {
        observedRecoveryCommandIdsRef.current.delete(command._id);
        if (!isStale) {
          setDebug((current) => ({
            ...current,
            terminalRecoveryCommandCompletedAt: Date.now(),
            terminalRecoveryCommandMessage: localResult.message,
            terminalRecoveryCommandStatus: "ignored",
          }));
          setRecoveryCommandRetryToken((current) => current + 1);
        }
        return;
      }

      const ackResult = toTerminalRecoveryCommandAckResult(localResult);
      const acknowledged = await acknowledgeTerminalRecoveryCommand({
        commandId: claimResult.data._id,
        message: localResult.message,
        result: ackResult,
        storeId: storeId as Id<"store">,
        syncSecretHash: runtimeStatusSyncSecretHash,
        terminalId: runtimeStatusTerminalId as Id<"posTerminal">,
      });
      if (acknowledged.kind !== "ok") {
        observedRecoveryCommandIdsRef.current.delete(command._id);
        if (!isStale) {
          setRecoveryCommandRetryToken((current) => current + 1);
        }
      }
      if (isStale) return;

      setDebug((current) => ({
        ...current,
        terminalRecoveryCommandCompletedAt: Date.now(),
        terminalRecoveryCommandMessage:
          acknowledged.kind === "ok"
            ? localResult.message
            : acknowledged.kind === "user_error"
              ? acknowledged.error.message
              : "Recovery command acknowledgement failed.",
        terminalRecoveryCommandStatus:
          acknowledged.kind === "ok" ? localResult.status : "failed",
      }));
      setRefreshToken((current) => current + 1);
      setRuntimeStatusObservationToken((current) => current + 1);
      onLocalEventsChanged?.();
    }).catch(() => {
      observedRecoveryCommandIdsRef.current.delete(command._id);
      if (isStale) return;

      setDebug((current) => ({
        ...current,
        terminalRecoveryCommandCompletedAt: Date.now(),
        terminalRecoveryCommandMessage:
          "Recovery command could not reach the server.",
        terminalRecoveryCommandStatus: "failed",
      }));
      setRecoveryCommandRetryToken((current) => current + 1);
    });

    return () => {
      isStale = true;
    };
  }, [
    acknowledgeTerminalRecoveryCommand,
    claimTerminalRecoveryCommand,
    onLocalEventsChanged,
    recoveryCommandRetryToken,
    recoveryCommands,
    requestRetry,
    runtimeReadiness.terminalSeed,
    runtimeStatusSyncSecretHash,
    runtimeStatusTerminalId,
    storeFactory,
    storeId,
  ]);

  return useMemo(() => {
    if (readError) {
      return {
        copyDiagnostics,
        description:
          "Local register activity could not be read. Check this terminal before continuing.",
        debug,
        label: "Local sync unavailable",
        onRetrySync: requestRetry,
        pendingEventCount: 1,
        runtimeStatus,
        status: "needs_review",
      };
    }

    const source = derivePosLocalRuntimeSyncStatus(events, {
      isOnline,
      onRetrySync: requestRetry,
      staffProfileId,
    });
    if (source) {
      return { ...source, copyDiagnostics, debug, runtimeStatus };
    }

    return debug.lastTrigger
      ? {
          copyDiagnostics,
          debug,
          onRetrySync: requestRetry,
          runtimeStatus,
        }
      : null;
  }, [
    copyDiagnostics,
    debug,
    events,
    isOnline,
    readError,
    requestRetry,
    runtimeStatus,
    staffProfileId,
  ]);
}

type PosTerminalRuntimeReadiness = {
  drawerAuthority: PosDrawerAuthorityState | null;
  snapshots: PosTerminalRuntimeSnapshotReadiness;
  staffAuthorityStatus: PosLocalStaffAuthorityReadiness | "unknown";
  terminalIntegrity: PosTerminalIntegrityState | null;
  terminalSeed: PosProvisionedTerminalSeed | null;
};

async function refreshTerminalRuntimeReadiness(input: {
  store: PosLocalRuntimeStore;
  storeId: string;
  terminalId?: string | null;
  terminalSeed: PosProvisionedTerminalSeed | null;
}): Promise<PosTerminalRuntimeReadiness> {
  const store = input.store as PosLocalRuntimeStore &
    Partial<{
      getStaffAuthorityReadiness: PosLocalRuntimeStore["getStaffAuthorityReadiness"];
      readTerminalIntegrityState: PosLocalRuntimeStore["readTerminalIntegrityState"];
      readRegisterAvailabilitySnapshot: PosLocalRuntimeStore["readRegisterAvailabilitySnapshot"];
      readRegisterCatalogSnapshot: PosLocalRuntimeStore["readRegisterCatalogSnapshot"];
      readRegisterServiceCatalogSnapshot: PosLocalRuntimeStore["readRegisterServiceCatalogSnapshot"];
    }>;
  const readDrawerAuthorityState = (
    input.store as {
      readDrawerAuthorityState?: PosLocalRuntimeStore["readDrawerAuthorityState"];
    }
  ).readDrawerAuthorityState;
  const scope = resolvePosLocalTerminalScope({
    storeId: input.storeId,
    terminalId: input.terminalId,
    terminalSeed: input.terminalSeed,
  });
  const [
    catalog,
    serviceCatalog,
    availability,
    staffAuthority,
    terminalIntegrity,
  ] = await Promise.all([
    store.readRegisterCatalogSnapshot
      ? store.readRegisterCatalogSnapshot({ storeId: input.storeId })
      : Promise.resolve({ ok: true as const, value: null }),
    store.readRegisterServiceCatalogSnapshot
      ? store.readRegisterServiceCatalogSnapshot({ storeId: input.storeId })
      : Promise.resolve({ ok: true as const, value: null }),
    store.readRegisterAvailabilitySnapshot
      ? store.readRegisterAvailabilitySnapshot({ storeId: input.storeId })
      : Promise.resolve({ ok: true as const, value: null }),
    input.terminalId && store.getStaffAuthorityReadiness
      ? store.getStaffAuthorityReadiness({
          storeId: input.storeId,
          terminalId: input.terminalId,
        })
      : Promise.resolve({ ok: true as const, value: "unknown" as const }),
    input.terminalId && store.readTerminalIntegrityState
      ? store.readTerminalIntegrityState({
          storeId: input.storeId,
          terminalId: input.terminalId,
        })
      : Promise.resolve({ ok: true as const, value: null }),
  ]);
  const localRegisterModel =
    input.terminalId && readDrawerAuthorityState
      ? await readProjectedLocalRegisterModel({
          store,
          storeId: input.storeId,
          terminalId: input.terminalId,
          isOnline:
            typeof navigator === "undefined" ? true : navigator.onLine,
        })
      : ({ ok: true, value: null } as const);
  const activeLocalRegisterSessionId =
    localRegisterModel.ok
      ? localRegisterModel.value?.activeRegisterSession?.localRegisterSessionId
      : undefined;
  let drawerAuthority =
    activeLocalRegisterSessionId && readDrawerAuthorityState
      ? await readLatestRuntimeDrawerAuthorityState({
          localRegisterSessionId: activeLocalRegisterSessionId,
          readDrawerAuthorityState,
          storeId: input.storeId,
          terminalIds: scope.terminalIds,
        })
      : ({ ok: true, value: null } as const);
  if (drawerAuthority.ok && drawerAuthority.value && localRegisterModel.ok) {
    const clearResult = await clearSettledRecoverableDrawerAuthorityBlock({
      drawerAuthority: drawerAuthority.value,
      events: localRegisterModel.value?.sourceEvents ?? [],
      store: input.store,
    });
    if (clearResult.ok && clearResult.value) {
      drawerAuthority = { ok: true, value: null };
    }
  }

  return {
    drawerAuthority: drawerAuthority.ok ? drawerAuthority.value : null,
    snapshots: {
      ...(catalog.ok && catalog.value
        ? { catalogRefreshedAt: catalog.value.refreshedAt }
        : {}),
      ...(serviceCatalog.ok && serviceCatalog.value
        ? { serviceCatalogRefreshedAt: serviceCatalog.value.refreshedAt }
        : {}),
      ...(availability.ok && availability.value
        ? { availabilityRefreshedAt: availability.value.refreshedAt }
        : {}),
    },
    staffAuthorityStatus: staffAuthority.ok ? staffAuthority.value : "unknown",
    terminalIntegrity: terminalIntegrity.ok ? terminalIntegrity.value : null,
    terminalSeed: input.terminalSeed,
  };
}

async function clearAcceptedTerminalIntegrityState(input: {
  checkInTerminalId: string;
  store: PosLocalRuntimeStore;
  storeId: string;
  terminalSeed: PosProvisionedTerminalSeed;
}): Promise<boolean> {
  if (
    typeof input.store.readTerminalIntegrityState !== "function" ||
    typeof input.store.clearTerminalIntegrityState !== "function"
  ) {
    return false;
  }

  const terminalIds = Array.from(
    new Set(
      [
        input.checkInTerminalId,
        input.terminalSeed.cloudTerminalId,
        input.terminalSeed.terminalId,
      ].filter((value): value is string => Boolean(value)),
    ),
  );
  let hasIntegrityBlock = false;
  for (const terminalId of terminalIds) {
    const state = await input.store.readTerminalIntegrityState({
      storeId: input.storeId,
      terminalId,
    });
    assertPosLocalStoreOk(state);
    if (state.value && state.value.status !== "healthy") {
      hasIntegrityBlock = true;
      break;
    }
  }

  if (!hasIntegrityBlock) {
    return false;
  }

  for (const terminalId of terminalIds) {
    const clearResult = await input.store.clearTerminalIntegrityState({
      storeId: input.storeId,
      terminalId,
    });
    assertPosLocalStoreOk(clearResult);
  }

  return true;
}

async function persistTerminalAuthorizationFailure(input: {
  message?: string;
  store: PosLocalRuntimeStore;
  syncSeed: PosProvisionedTerminalSeed;
}): Promise<PosTerminalIntegrityState> {
  const state: PosTerminalIntegrityState = {
    cloudTerminalId: input.syncSeed.cloudTerminalId,
    message: input.message,
    observedAt: Date.now(),
    reason: "authorization_failed",
    registerNumber: input.syncSeed.registerNumber,
    status: "requires_reprovision",
    storeId: input.syncSeed.storeId,
    terminalId: input.syncSeed.terminalId,
  };
  const result = await input.store.writeTerminalIntegrityState(state);
  assertPosLocalStoreOk(result);
  return state;
}

function isTerminalAuthorizationFailure(
  result: { kind: string; error?: { code?: string; metadata?: Record<string, unknown> } },
): result is {
  kind: "user_error";
  error: {
    code: "authorization_failed";
    message: string;
    metadata: { terminalAuthorizationFailure: true };
  };
} {
  return (
    result.kind === "user_error" &&
    isTerminalAuthorizationUserError(result.error)
  );
}

function isRetryableSyncAuthorizationFailure(result: {
  kind: string;
  error?: { code?: string; message?: string; metadata?: Record<string, unknown> };
}): result is {
  kind: "user_error";
  error: { code: "authorization_failed"; message: string };
} {
  return (
    result.kind === "user_error" &&
    result.error?.code === "authorization_failed" &&
    !isTerminalAuthorizationUserError(result.error)
  );
}

function isTerminalAuthorizationUserError(
  error: { code?: string; metadata?: Record<string, unknown> } | null | undefined,
) {
  return (
    error?.code === "authorization_failed" &&
    error.metadata?.terminalAuthorizationFailure === true
  );
}

function toTerminalRecoveryCommandAckResult(
  result: PosTerminalRecoveryCommandResult,
) {
  if (result.status === "completed") return "completed" as const;
  if (result.reason === "precondition_failed") {
    return "precondition_failed" as const;
  }
  return "failed" as const;
}

async function persistDrawerAuthorityBlockForReviewEvents(input: {
  events: PosLocalEventRecord[];
  reason: NonNullable<PosDrawerAuthorityState["reason"]>;
  reviewEventIds: string[];
  store: PosLocalRuntimeStore;
}) {
  const writeDrawerAuthorityState = (
    input.store as {
      writeDrawerAuthorityState?: PosLocalRuntimeStore["writeDrawerAuthorityState"];
    }
  ).writeDrawerAuthorityState;
  if (
    input.reviewEventIds.length === 0 ||
    !writeDrawerAuthorityState
  ) {
    return;
  }

  const reviewEventIds = new Set(input.reviewEventIds);
  const event = input.events.find(
    (candidate) =>
      reviewEventIds.has(candidate.localEventId) &&
      isDrawerAuthorityLifecycleEvent(candidate) &&
      candidate.localRegisterSessionId,
  );
  if (!event?.localRegisterSessionId) return;

  const mappings = await input.store.listLocalCloudMappings?.();
  if (mappings && !mappings.ok) return;
  const cloudRegisterSessionId = mappings?.value.find(
    (mapping) =>
      mapping.entity === "registerSession" &&
      mapping.localId === event.localRegisterSessionId,
  )?.cloudId;

  const result = await writeDrawerAuthorityState({
    ...(cloudRegisterSessionId ? { cloudRegisterSessionId } : {}),
    localRegisterSessionId: event.localRegisterSessionId,
    message:
      "Cloud sync needs review before this local drawer can continue.",
    observedAt: Date.now(),
    reason: input.reason,
    registerNumber: event.registerNumber,
    status: "blocked",
    storeId: event.storeId,
    terminalId: event.terminalId,
  });
  assertPosLocalStoreOk(result);
}

async function clearRecoverableDrawerAuthorityForSyncedEvents(input: {
  events: PosLocalEventRecord[];
  reviewEventIds: string[];
  store: PosLocalRuntimeStore;
  syncedEventIds: string[];
}) {
  const clearDrawerAuthorityState = (
    input.store as {
      clearDrawerAuthorityState?: PosLocalRuntimeStore["clearDrawerAuthorityState"];
    }
  ).clearDrawerAuthorityState;
  const readDrawerAuthorityState = (
    input.store as {
      readDrawerAuthorityState?: PosLocalRuntimeStore["readDrawerAuthorityState"];
    }
  ).readDrawerAuthorityState;
  if (
    !clearDrawerAuthorityState ||
    !readDrawerAuthorityState ||
    input.syncedEventIds.length === 0
  ) {
    return;
  }

  const syncedEventIds = new Set(input.syncedEventIds);
  const reviewEventIds = new Set(input.reviewEventIds);
  const remainingReviewDrawers = new Set(
    input.events
      .filter(
        (event) =>
          ((event.sync.status === "needs_review" && event.sync.uploaded) ||
            reviewEventIds.has(event.localEventId)) &&
          !syncedEventIds.has(event.localEventId) &&
          event.localRegisterSessionId &&
          isDrawerAuthorityLifecycleEvent(event),
      )
      .map((event) =>
        drawerAuthorityEventKey({
          localRegisterSessionId: event.localRegisterSessionId!,
          storeId: event.storeId,
          terminalId: event.terminalId,
        }),
      ),
  );
  const cleared = new Set<string>();
  for (const event of input.events) {
    if (
      !syncedEventIds.has(event.localEventId) ||
      !event.localRegisterSessionId ||
      !isDrawerAuthorityLifecycleEvent(event)
    ) {
      continue;
    }

    const key = drawerAuthorityEventKey({
      localRegisterSessionId: event.localRegisterSessionId,
      storeId: event.storeId,
      terminalId: event.terminalId,
    });
    if (remainingReviewDrawers.has(key)) continue;
    if (cleared.has(key)) continue;
    cleared.add(key);

    const drawerAuthority = await readDrawerAuthorityState({
      localRegisterSessionId: event.localRegisterSessionId,
      storeId: event.storeId,
      terminalId: event.terminalId,
    });
    assertPosLocalStoreOk(drawerAuthority);
    if (!isRecoverableDrawerAuthorityReason(drawerAuthority.value?.reason)) {
      continue;
    }

    const result: PosLocalStoreResult<null> = await clearDrawerAuthorityState({
      localRegisterSessionId: event.localRegisterSessionId,
      storeId: event.storeId,
      terminalId: event.terminalId,
    });
    assertPosLocalStoreOk(result);
  }
}

function isRecoverableDrawerAuthorityReason(
  reason: PosDrawerAuthorityState["reason"] | undefined,
) {
  return reason === "lifecycle_rejected" || reason === "authority_unknown";
}

async function clearSupersededRecoverableDrawerAuthorityBlocks(input: {
  acceptedEvents: Array<{
    localEventId: string;
    status: string;
  }>;
  events: PosLocalEventRecord[];
  returnedMappings: Array<{
    cloudId: string;
    localId: string;
    localIdKind: string;
  }>;
  store: PosLocalRuntimeStore;
}) {
  const clearDrawerAuthorityState:
    | PosLocalRuntimeStore["clearDrawerAuthorityState"]
    | undefined = (
    input.store as {
      clearDrawerAuthorityState?: PosLocalRuntimeStore["clearDrawerAuthorityState"];
    }
  ).clearDrawerAuthorityState;
  const readDrawerAuthorityState:
    | PosLocalRuntimeStore["readDrawerAuthorityState"]
    | undefined = (
    input.store as {
      readDrawerAuthorityState?: PosLocalRuntimeStore["readDrawerAuthorityState"];
    }
  ).readDrawerAuthorityState;
  const listLocalCloudMappings:
    | PosLocalRuntimeStore["listLocalCloudMappings"]
    | undefined = (
    input.store as {
      listLocalCloudMappings?: PosLocalRuntimeStore["listLocalCloudMappings"];
    }
  ).listLocalCloudMappings;
  if (
    !clearDrawerAuthorityState ||
    !readDrawerAuthorityState ||
    !listLocalCloudMappings
  ) {
    return;
  }

  const acceptedProjectedEventIds = new Set(
    input.acceptedEvents
      .filter((event) => event.status === "projected")
      .map((event) => event.localEventId),
  );
  const replacementDrawerOpenings = input.returnedMappings
    .filter((mapping) => mapping.localIdKind === "registerSession")
    .map((mapping) => {
      const event = input.events.find(
        (candidate) =>
          candidate.type === "register.opened" &&
          candidate.localRegisterSessionId === mapping.localId &&
          acceptedProjectedEventIds.has(candidate.localEventId),
      );
      return event
        ? {
            cloudRegisterSessionId: mapping.cloudId,
            event,
          }
        : null;
    })
    .filter((entry): entry is {
      cloudRegisterSessionId: string;
      event: PosLocalEventRecord;
    } => Boolean(entry));
  if (replacementDrawerOpenings.length === 0) {
    return;
  }

  const mappings = await listLocalCloudMappings();
  assertPosLocalStoreOk(mappings);

  for (const replacement of replacementDrawerOpenings) {
    const supersededRegisterSessionIds = mappings.value
      .filter(
        (mapping) =>
          mapping.entity === "registerSession" &&
          mapping.cloudId === replacement.cloudRegisterSessionId &&
          mapping.localId !== replacement.event.localRegisterSessionId,
      )
      .map((mapping) => mapping.localId);
    const uniqueSupersededRegisterSessionIds = [
      ...new Set(supersededRegisterSessionIds),
    ];

    for (const localRegisterSessionId of uniqueSupersededRegisterSessionIds) {
      const terminalIds = [
        ...new Set(
          input.events
            .filter(
              (event) =>
                event.storeId === replacement.event.storeId &&
                event.localRegisterSessionId === localRegisterSessionId,
            )
            .map((event) => event.terminalId),
        ),
      ];
      for (const terminalId of terminalIds) {
        const drawerAuthority: PosLocalStoreResult<PosDrawerAuthorityState | null> =
          await readDrawerAuthorityState({
          localRegisterSessionId,
          storeId: replacement.event.storeId,
          terminalId,
        });
        assertPosLocalStoreOk(drawerAuthority);
        if (
          drawerAuthority.value?.status !== "blocked" ||
          !isRecoverableDrawerAuthorityReason(drawerAuthority.value.reason) ||
          drawerAuthority.value.observedAt > replacement.event.createdAt ||
          (drawerAuthority.value.cloudRegisterSessionId &&
            drawerAuthority.value.cloudRegisterSessionId !==
              replacement.cloudRegisterSessionId)
        ) {
          continue;
        }

        const result: PosLocalStoreResult<null> = await clearDrawerAuthorityState({
          localRegisterSessionId,
          storeId: replacement.event.storeId,
          terminalId,
        });
        assertPosLocalStoreOk(result);
      }
    }
  }
}

async function clearSettledRecoverableDrawerAuthorityBlock(input: {
  drawerAuthority: PosDrawerAuthorityState;
  events: PosLocalEventRecord[];
  store: PosLocalRuntimeStore;
}): Promise<PosLocalStoreResult<boolean>> {
  const clearDrawerAuthorityState = (
    input.store as {
      clearDrawerAuthorityState?: PosLocalRuntimeStore["clearDrawerAuthorityState"];
    }
  ).clearDrawerAuthorityState;
  if (
    !clearDrawerAuthorityState ||
    input.drawerAuthority.status !== "blocked" ||
    !isRecoverableDrawerAuthorityReason(input.drawerAuthority.reason)
  ) {
    return { ok: true, value: false };
  }

  const drawerLifecycleEvents = input.events.filter(
    (event) =>
      event.localRegisterSessionId ===
        input.drawerAuthority.localRegisterSessionId &&
      event.storeId === input.drawerAuthority.storeId &&
      event.terminalId === input.drawerAuthority.terminalId &&
      isDrawerAuthorityLifecycleEvent(event),
  );
  if (drawerLifecycleEvents.length === 0) {
    return { ok: true, value: false };
  }

  const hasUnsettledLifecycleEvent = drawerLifecycleEvents.some(
    (event) => event.sync.status !== "synced",
  );
  if (hasUnsettledLifecycleEvent) {
    return { ok: true, value: false };
  }

  const hasRemainingLifecycleReview = drawerLifecycleEvents.some(
    (event) =>
      event.sync.status === "needs_review" &&
      event.sync.uploaded,
  );
  if (hasRemainingLifecycleReview) {
    return { ok: true, value: false };
  }

  const result = await clearDrawerAuthorityState({
    localRegisterSessionId: input.drawerAuthority.localRegisterSessionId,
    storeId: input.drawerAuthority.storeId,
    terminalId: input.drawerAuthority.terminalId,
  });
  if (!result.ok) return result;

  return { ok: true, value: true };
}

async function readLatestRuntimeDrawerAuthorityState(input: {
  localRegisterSessionId: string;
  readDrawerAuthorityState: NonNullable<
    PosLocalRuntimeStore["readDrawerAuthorityState"]
  >;
  storeId: string;
  terminalIds: Set<string>;
}): Promise<PosLocalStoreResult<PosDrawerAuthorityState | null>> {
  if (input.terminalIds.size === 0) {
    return { ok: true, value: null };
  }

  const states: PosDrawerAuthorityState[] = [];
  for (const terminalId of input.terminalIds) {
    const result = await input.readDrawerAuthorityState({
      localRegisterSessionId: input.localRegisterSessionId,
      storeId: input.storeId,
      terminalId,
    });
    if (!result.ok) return result;
    if (result.value) states.push(result.value);
  }

  return {
    ok: true,
    value:
      states.sort((left, right) => right.observedAt - left.observedAt).at(0) ??
      null,
  };
}

function drawerAuthorityEventKey(input: {
  localRegisterSessionId: string;
  storeId: string;
  terminalId: string;
}) {
  return `${input.storeId}:${input.terminalId}:${input.localRegisterSessionId}`;
}

function isDrawerAuthorityLifecycleEvent(event: PosLocalEventRecord) {
  return (
    event.type === "register.opened" ||
    event.type === "register.closeout_started" ||
    event.type === "register.reopened"
  );
}

function getRuntimeBrowserInfo(isOnline: boolean) {
  const navigatorRef = globalThis.navigator;
  return {
    language: navigatorRef?.language,
    online: isOnline,
    platform: navigatorRef?.platform,
    userAgent: navigatorRef?.userAgent,
  };
}

export function getRuntimeStatusSignature(input: {
  runtimeStatus: PosTerminalRuntimeStatusPayload;
  storeId: string;
  terminalId: string;
}) {
  return JSON.stringify({
    runtimeStatus: input.runtimeStatus,
    storeId: input.storeId,
    terminalId: input.terminalId,
  });
}

export function getRuntimeStatusPublishSignature(input: {
  observationToken: number;
  runtimeStatus: PosTerminalRuntimeStatusPayload;
  storeId: string;
  terminalId: string;
}) {
  const stableStatus: Partial<PosTerminalRuntimeStatusPayload> = {
    ...input.runtimeStatus,
  };
  delete stableStatus.reportedAt;
  delete stableStatus.snapshots;

  return JSON.stringify({
    observationToken: input.observationToken,
    runtimeStatus: stableStatus,
    storeId: input.storeId,
    terminalId: input.terminalId,
  });
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

function getRuntimeCheckInNotReadyReason(input: {
  storeId?: string | null;
  syncSecretHash?: string | null;
  terminalId?: string | null;
}): PosLocalRuntimeSyncDebug["checkInPublishReason"] | null {
  if (!input.storeId) return "missing_store";
  if (!input.terminalId) return "missing_terminal";
  if (!input.syncSecretHash) return "missing_sync_secret";
  return null;
}

function withCheckInPublishDebug(
  current: PosLocalRuntimeSyncDebug,
  patch: Pick<
    PosLocalRuntimeSyncDebug,
    | "checkInPublishAttemptedAt"
    | "checkInPublishCompletedAt"
    | "checkInPublishMessage"
    | "checkInPublishReason"
    | "checkInPublishStatus"
  >,
) {
  const next = {
    ...current,
    ...patch,
  };

  if (
    current.checkInPublishAttemptedAt === next.checkInPublishAttemptedAt &&
    current.checkInPublishCompletedAt === next.checkInPublishCompletedAt &&
    current.checkInPublishMessage === next.checkInPublishMessage &&
    current.checkInPublishReason === next.checkInPublishReason &&
    current.checkInPublishStatus === next.checkInPublishStatus
  ) {
    return current;
  }

  return next;
}

function toIngestLocalEventsArgs(input: {
  events: PosLocalUploadEvent[];
  storeId: string;
  syncSecretHash: string;
  terminalId: string;
}): IngestLocalEventsUploadArgs {
  return {
    storeId: input.storeId as Id<"store">,
    terminalId: input.terminalId as Id<"posTerminal">,
    syncSecretHash: input.syncSecretHash,
    events: input.events.map(toIngestLocalEventArg),
  };
}

function toIngestLocalEventArg(
  event: PosLocalUploadEvent,
): IngestLocalEventsUploadArgs["events"][number] {
  return {
    ...event,
    staffProfileId: event.staffProfileId as Id<"staffProfile">,
  };
}

export function assertPosLocalStoreOk<T>(
  result: PosLocalStoreResult<T>,
): asserts result is { ok: true; value: T } {
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
  uploadSupport: PosLocalSyncUploadSupport = {},
): PosLocalRuntimeSyncDebug {
  const pendingUploadCandidates = events.filter(isPendingUploadCandidate);
  const pendingUploadableEvents = pendingUploadCandidates.filter(
    (event) => isSyncablePosLocalEvent(event, uploadSupport),
  );
  const deferredUploadEvents = pendingUploadCandidates.filter((event) =>
    isUploadDeferredByValidation(event, uploadSupport),
  );
  const nextPendingUploadableEvent = [...pendingUploadableEvents]
    .sort(compareUploadableEventOrder)
    .at(0);
  const localOnlyEvents = pendingUploadCandidates.filter(
    (event) => !isSyncablePosLocalEvent(event, uploadSupport),
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
    appSessionUnverifiedEventCount: events.filter((event) =>
      event.validationMetadata?.flags.includes("app-session-unverified"),
    ).length,
    cloudValidationUncertainEventCount: events.filter((event) =>
      event.validationMetadata?.flags.includes("cloud-validation-uncertain"),
    ).length,
    deferredUploadEventCount: deferredUploadEvents.length,
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

function getAppSessionUploadSupport(
  recovery?: PosTerminalRuntimeAppSessionRecoveryInput | null,
): PosLocalSyncUploadSupport {
  if (!recovery) {
    return { appSessionValidation: "supported" };
  }

  return {
    appSessionValidation:
      recovery.status === "idle" || recovery.status === "recoverable"
        ? "supported"
        : "unverified",
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
    event.sync.status === "failed" ||
    (event.sync.status === "needs_review" && event.sync.uploaded)
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

export function collectServerSettledLocalEventIds(
  acceptedEvents: Array<{
    localEventId: string;
    status: string;
  }>,
) {
  return acceptedEvents
    .filter(
      (event) => event.status === "projected" || event.status === "rejected",
    )
    .map((event) => event.localEventId);
}

export function collectServerReviewLocalEventIds(
  acceptedEvents: Array<{
    localEventId: string;
    status: string;
  }>,
) {
  return acceptedEvents
    .filter((event) => event.status === "conflicted")
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

export function collectLocallySettledSkippedReviewEventIds(
  eventsToUpload: PosLocalEventRecord[],
  uploadedEvents: PosLocalUploadEvent[],
) {
  const uploadedEventIds = new Set(
    uploadedEvents.map((event) => event.localEventId),
  );

  return eventsToUpload
    .filter(
      (event) =>
        event.type === "cart.cleared" &&
        event.sync.status === "needs_review" &&
        event.sync.uploaded &&
        !uploadedEventIds.has(event.localEventId) &&
        hasLaterLocalCompletedSale(
          event,
          eventsToUpload,
          event.localPosSessionId ??
            stringValueFromPayload(event.payload, "localPosSessionId"),
        ),
    )
    .map((event) => event.localEventId);
}

function hasLaterLocalCompletedSale(
  event: PosLocalEventRecord,
  events: PosLocalEventRecord[],
  localPosSessionId: string,
) {
  if (!localPosSessionId) return false;

  return events.some(
    (candidate) =>
      candidate.sequence > event.sequence &&
      candidate.type === "transaction.completed" &&
      (candidate.localPosSessionId ??
        stringValueFromPayload(candidate.payload, "localPosSessionId")) ===
        localPosSessionId,
  );
}

function stringValueFromPayload(payload: unknown, key: string) {
  if (!payload || typeof payload !== "object") return "";
  const value = (payload as Record<string, unknown>)[key];
  return typeof value === "string" ? value : "";
}

function mergeEventIds(left: string[], right: string[]) {
  return Array.from(new Set([...left, ...right]));
}

function withoutEventIds(eventIds: string[], excludedEventIds: string[]) {
  if (excludedEventIds.length === 0) return eventIds;
  const excluded = new Set(excludedEventIds);
  return eventIds.filter((eventId) => !excluded.has(eventId));
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
  const terminalBlockingReviewEvents =
    options.staffProfileId === undefined
      ? []
      : events.filter(
          (event) =>
            event.staffProfileId !== options.staffProfileId &&
            event.sync.status === "needs_review" &&
            event.sync.uploaded &&
            isDrawerAuthorityLifecycleEvent(event),
        );
  const relevantEvents = collectRuntimeRelevantEvents(scopedEvents);
  const relevantEventIds = new Set(
    relevantEvents.map((event) => event.localEventId),
  );
  const terminalBlockingRelevantEvents = terminalBlockingReviewEvents.filter(
    (event) => !relevantEventIds.has(event.localEventId),
  );
  const statusEvents = [
    ...relevantEvents,
    ...terminalBlockingRelevantEvents,
  ];
  const status = derivePosLocalSyncStatus({
    events: statusEvents.map((event) =>
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
        : hasPendingLocalCloseout(statusEvents)
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
