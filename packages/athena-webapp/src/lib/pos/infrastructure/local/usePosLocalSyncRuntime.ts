import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import type { FunctionArgs } from "convex/server";

import { api } from "~/convex/_generated/api";
import type { Id } from "~/convex/_generated/dataModel";
import {
  getInitialRuntimeBuildMetadata,
  type AthenaWebappRuntimeBuildMetadata,
} from "@/lib/runtimeBuildMetadata";
import { isLocalPinVerifierMetadata } from "@/lib/security/localPinVerifier";
import { isNonBlockingRegisterLifecycleReviewEvent } from "~/shared/registerSessionLifecyclePolicy";
import {
  createIndexedDbPosLocalStorageAdapter,
  createPosLocalStore,
  type PosDrawerAuthorityState,
  type PosLocalCloudMapping,
  type PosLocalEventRecord,
  type PosLocalStaffAuthorityRecord,
  type PosLocalStaffAuthorityReadiness,
  type PosLocalStoreResult,
  type PosTerminalIntegrityState,
  type PosProvisionedTerminalSeed,
} from "./posLocalStore";
import { createLocalCommandGateway } from "./localCommandGateway";
import {
  clearRecoverableDrawerAuthorityForSyncedEvents,
  clearSupersededRecoverableDrawerAuthorityBlocks,
  isDrawerAuthorityLifecycleEvent,
  persistDrawerAuthorityBlockForReviewEvents,
} from "./drawerAuthorityReconciliation";
import {
  buildPosLocalSyncUploadEvents,
  isSyncablePosLocalEvent,
  type PosLocalUploadEvent,
  type PosLocalSyncUploadSupport,
} from "./syncContract";
import {
  canReportPosRegisterSessionLocalActivityType,
  sanitizePosRegisterSessionLocalActivity,
  type PosRegisterSessionLocalActivitySummary,
} from "../../../../../shared/posRegisterSessionActivityContract";
import {
  createPosLocalSyncScheduler,
  type PosLocalSyncTrigger,
} from "./syncScheduler";
import {
  derivePosLocalSyncStatus,
  mapServerSettlementOutcomeToLocalState,
} from "./syncStatus";
import { readScopedPosLocalEvents } from "./localRegisterReader";
import {
  isPosLocalEventInTerminalScope,
  resolvePosLocalTerminalScope,
} from "./terminalScope";
import {
  emptyPosTerminalRuntimeReadiness,
  refreshTerminalRuntimeReadiness,
  type PosTerminalRuntimeReadiness,
} from "./runtimeReadiness";
import {
  buildRuntimeSyncDebug,
  getRuntimeUploadTrigger,
  startStatusOnlyRuntimeTriggers,
} from "./localSyncDrainCoordinator";
import { refreshAndStoreTerminalStaffAuthority } from "./terminalStaffAuthorityRefresh";
import {
  getRuntimeStatusPublishMaterialSignature,
  getRuntimeBrowserInfo,
  getRuntimeCheckInNotReadyReason,
  getRuntimeStatusPublishSignature,
  shouldPublishRuntimeStatus,
  startRuntimeStatusFreshnessHeartbeat,
  withRuntimeCheckInPublishDebug as withCheckInPublishDebug,
} from "./runtimeStatusPublisher";
import {
  buildPosTerminalRuntimeCopyDiagnostics,
  buildPosTerminalRuntimeStatus,
  toPosTerminalRuntimeDiagnosticsEvent,
  toReportablePosTerminalRuntimeStatus,
  type PosTerminalRuntimeAppUpdateInput,
  type PosTerminalRuntimeAppSessionRecoveryInput,
  type PosTerminalRuntimeCopyDiagnostics,
  type PosTerminalRuntimeDiagnosticsEvent,
  type PosTerminalRuntimeStatusPayload,
  type PosTerminalRuntimeStatusSource,
  type PosTerminalRuntimeSyncDebugInput,
} from "./terminalRuntimeStatus";
import {
  executeTerminalRecoveryCommand,
  type PosAppUpdateCoordinatorAdapter,
  type PosTerminalRecoveryCommandResult,
} from "./terminalRecoveryCommands";

export { getRuntimeStatusSignature } from "./runtimeStatusPublisher";

const APP_UPDATE_COMMAND_CORRELATION_STORAGE_KEY =
  "athena-pos-app-update-command-correlation";

type AppUpdateCommandCorrelation = {
  commandExecutionId: string;
  commandId?: string;
  commandIssuedAt?: number;
};

export type PosLocalRuntimeDrainOptions = {
  includeReviewEvents?: boolean;
  includeUploadedReviewEvents?: boolean;
  onlyReviewEvents?: boolean;
  onlyUploadedRegisterOpenReviewEvents?: boolean;
  onlyUploadedReviewEvents?: boolean;
};

export type PosLocalRuntimeSyncStatusSource = {
  copyDiagnostics?: PosTerminalRuntimeCopyDiagnostics;
  debug?: PosLocalRuntimeSyncDebug;
  description?: string | null;
  label?: string | null;
  localEvents?: PosLocalRuntimeDiagnosticsEvent[];
  onRetrySync?: (() => void) | null;
  pendingEventCount?: number | null;
  runtimeStatus?: PosTerminalRuntimeStatusPayload;
  status?: string | null;
};

export type PosLocalRuntimeDiagnosticsEvent =
  PosTerminalRuntimeDiagnosticsEvent & {
    syncUploadable?: boolean;
  };

export type PosLocalRuntimeSyncDebug = {
  activeRegisterSessionRepair?: {
    directive?: RuntimeActiveRegisterSessionDirective;
    observedAt: number;
    seedResult:
      | "gateway_rejected"
      | "missing_directive"
      | "missing_staff_identity"
      | "not_attempted"
      | "seeded";
  };
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
    | "pending"
    | "precondition_failed";
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
  reviewEvents?: PosTerminalRuntimeSyncDebugInput["reviewEvents"];
  reviewEventCount?: number;
  schedulerBackoffUntil?: number | null;
  schedulerRunning?: boolean;
  schedulerScheduled?: boolean;
};

export type PosLocalSyncRuntimeMode = "drain-enabled" | "status-only";

type PosLocalRuntimeStore = ReturnType<typeof createPosLocalStore>;

type RuntimeDrawerAuthorityDirective = Omit<
  PosDrawerAuthorityState,
  "storeId" | "terminalId"
>;
export type RuntimeActiveRegisterSessionDirective = {
  cloudRegisterSessionId: string;
  expectedCash: number;
  localRegisterSessionId: string;
  observedAt: number;
  openedAt: number;
  openingFloat: number;
  registerNumber?: string;
  staffProfileId?: string;
  status: "active";
};
type IngestLocalEventsArgs = FunctionArgs<
  typeof api.pos.public.sync.ingestLocalEvents
>;
type IngestRegisterSessionActivityArgs = FunctionArgs<
  typeof api.pos.public.sync.ingestRegisterSessionActivity
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
  appUpdateCoordinator?: PosAppUpdateCoordinatorAdapter | null;
  staffProfileId?: string | null;
  staffAuthorityStatus?: PosLocalStaffAuthorityReadiness | "unknown";
  staffProofToken?: string | null;
  storeFactory?: (() => PosLocalRuntimeStore) | null;
}): PosLocalRuntimeSyncStatusSource | null {
  const ingestLocalEvents = useMutation(api.pos.public.sync.ingestLocalEvents);
  const ingestRegisterSessionActivity = useMutation(
    api.pos.public.sync.ingestRegisterSessionActivity,
  );
  const reportTerminalRuntimeStatus = useMutation(
    api.pos.public.terminals.reportTerminalRuntimeStatus,
  );
  const claimTerminalRecoveryCommand = useMutation(
    api.pos.public.terminals.claimTerminalRecoveryCommand,
  );
  const acknowledgeTerminalRecoveryCommand = useMutation(
    api.pos.public.terminals.acknowledgeTerminalRecoveryCommand,
  );
  const refreshTerminalStaffAuthority = useMutation(
    api.operations.staffCredentials.refreshTerminalStaffAuthority,
  );
  const [events, setEvents] = useState<PosLocalEventRecord[]>([]);
  const [runtimeReadiness, setRuntimeReadiness] =
    useState<PosTerminalRuntimeReadiness>(emptyPosTerminalRuntimeReadiness);
  const [readError, setReadError] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const [manualRetryToken, setManualRetryToken] = useState(0);
  const [runtimeStatusObservationToken, setRuntimeStatusObservationToken] =
    useState(0);
  const [appUpdateCommandCorrelation, setAppUpdateCommandCorrelation] =
    useState<AppUpdateCommandCorrelation | null>(() =>
      readStoredAppUpdateCommandCorrelation(),
    );
  const [runtimeBuildMetadata] = useState(
    getInitialRuntimeBuildMetadata,
  );
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
  const appUpdateCoordinator = input.appUpdateCoordinator;
  const onLocalEventsChanged = input.onLocalEventsChanged;
  const onRetrySync = input.onRetrySync;
  const source = input.source ?? "sync-runtime";
  const staffProfileId = input.staffProfileId;
  const staffProofToken = input.staffProofToken;
  const uploadSupport = useMemo(
    () => getAppSessionUploadSupport(input.appSessionRecovery),
    [input.appSessionRecovery],
  );
  const lastRuntimeStatusSignatureRef = useRef<string | null>(null);
  const lastRuntimeStatusMaterialSignatureRef = useRef<string | null>(null);
  const lastRuntimeStatusPublishedAtRef = useRef<number | null>(null);
  const runtimeStatusPublishInFlightRef = useRef(false);
  const queuedRuntimeStatusSignatureRef = useRef<string | null>(null);
  const forceNextRuntimeStatusPublishRef = useRef(false);
  const isRuntimeStatusPublisherMountedRef = useRef(true);
  const observedRecoveryCommandIdsRef = useRef<Set<string>>(new Set());
  const requestRetry = useCallback(() => {
    setRefreshToken((current) => current + 1);
    setManualRetryToken((current) => current + 1);
    onRetrySync?.();
  }, [onRetrySync]);

  useEffect(
    () => () => {
      isRuntimeStatusPublisherMountedRef.current = false;
    },
    [],
  );

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
        setRuntimeReadiness(emptyPosTerminalRuntimeReadiness());
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
      const trigger = getRuntimeUploadTrigger({
        eventAppendToken,
        lastEventAppendToken: lastEventAppendTokenRef.current,
        lastManualRetryToken: lastManualRetryTokenRef.current,
        manualRetryToken,
      });
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
            setReadError(
              refreshedEvents.ok ? null : refreshedEvents.error.message,
            );
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
        ...buildRuntimeSyncDebug(
          eventsResult.value.events,
          mode,
          uploadSupport,
        ),
        lastTrigger: trigger,
        lastTriggerAt: Date.now(),
        lastTriggerPriority: triggerPriority,
      }));

      const createDrainScheduler = (
        syncSeed: NonNullable<typeof provisionedSeed>,
        options: PosLocalRuntimeDrainOptions = {},
      ) =>
        createPosLocalSyncScheduler({
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
            const uploadableEvents = pending.value.events.filter((event) =>
              isPosLocalRuntimeDrainCandidate(event, options, uploadSupport) ||
              isPosLocalRuntimeActivityReportCandidate(event),
            );
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
              syncScope:
                event.type === "expense.completed"
                  ? ("expense" as const)
                  : ("pos" as const),
              localRegisterSessionId: event.localRegisterSessionId ?? "",
              localExpenseSessionId: event.localExpenseSessionId,
              createdAt: event.createdAt,
              sequence: event.sequence,
              uploadSequence: event.uploadSequence,
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
            const locallySettledEventIds =
              collectLocallySettledSkippedReviewEventIds(
                eventsToUpload,
                uploadedEvents,
              );
            setDebug((current) => ({
              ...current,
              lastBatchEventCount: uploadedEvents.length,
            }));
            if (uploadedEvents.length === 0) {
              await reportRegisterSessionActivityForEvents({
                cloudTerminalId,
                events: eventsToUpload,
                ingestRegisterSessionActivity,
                store,
                syncSeed,
              });
              return { syncedEventIds: locallySettledEventIds };
            }

            void reportRegisterSessionActivityForEvents({
              cloudTerminalId,
              events: eventsToUpload,
              ingestRegisterSessionActivity,
              store,
              syncSeed,
            }).catch(() => undefined);

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
              result.data.mappings,
              result.data.conflicts,
            );
            const rejectedEventIds = collectServerRejectedLocalEventIds(
              result.data.accepted,
            );
            setDebug((current) => ({
              ...current,
              lastHeldEventCount: result.data.held.length,
              lastReviewEventCount:
                reviewEventIds.length + rejectedEventIds.length,
            }));
            const localReviewEventIds = collectReviewLocalEventIds(
              latestEvents.value.events,
              reviewEventIds,
            );
            const localRejectedEventIds = collectReviewLocalEventIds(
              latestEvents.value.events,
              rejectedEventIds,
            );
            await persistDrawerAuthorityBlockForReviewEvents({
              events: latestEvents.value.events,
              reason: "lifecycle_rejected",
              reviewConflicts: result.data.conflicts,
              reviewEventIds: localReviewEventIds,
              store,
            });
            const syncedEventIds = collectSyncedLocalEventIds(
              latestEvents.value.events,
              collectServerSettledLocalEventIds(
                result.data.accepted,
                result.data.mappings,
                result.data.conflicts,
              ),
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
              rejectedEventIds: withoutEventIds(
                localRejectedEventIds,
                locallySettledEventIds,
              ),
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
          markRejected: async (eventIds) => {
            if (eventIds.length === 0) return;
            const result = await store.markEventsNeedsReview(
              eventIds,
              mapServerSettlementOutcomeToLocalState("rejected").label,
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
          const shouldDrainPendingExpenseEvents =
            drainOnAppend &&
            trigger !== "manual-retry" &&
            hasPendingSyncableExpenseEvents(
              eventsResult.value.events,
              uploadSupport,
            );
          if (
            drainOnAppend &&
            (trigger === "event-appended" || shouldDrainPendingExpenseEvents)
          ) {
            const scheduler = createDrainScheduler(provisionedSeed);
            stopSchedulers.push(() => scheduler.stop());
            scheduler.trigger(trigger, { priority: "high" });
          }

          if (
            trigger !== "manual-retry" &&
            hasUploadedRegisterOpenReviewEvents(eventsResult.value.events)
          ) {
            const scheduler = createDrainScheduler(provisionedSeed, {
              includeUploadedReviewEvents: true,
              onlyUploadedRegisterOpenReviewEvents: true,
            });
            stopSchedulers.push(() => scheduler.stop());
            scheduler.trigger("manual-retry", { priority: "high" });
          }

          if (trigger === "manual-retry") {
            const scheduler = createDrainScheduler(provisionedSeed, {
              includeReviewEvents: true,
              onlyReviewEvents: true,
            });
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
          includeReviewEvents: true,
        });
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
    ingestRegisterSessionActivity,
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
      reviewEvents: debug.reviewEvents,
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
      debug.reviewEvents,
      debug.reviewEventCount,
      debug.schedulerRunning,
    ],
  );
  const runtimeAppUpdate = useMemo(
    () =>
      buildRuntimeAppUpdateInput({
        appUpdateCoordinator,
        commandCorrelation: appUpdateCommandCorrelation,
        runtimeBuildMetadata,
      }),
    [appUpdateCommandCorrelation, appUpdateCoordinator, runtimeBuildMetadata],
  );

  const runtimeStatusInput = useMemo(
    () => ({
      activeRegisterSession: runtimeReadiness.activeRegisterSession,
      appShell: runtimeReadiness.appShell,
      appSessionRecovery: input.appSessionRecovery,
      appUpdate: runtimeAppUpdate,
      appVersion: runtimeBuildMetadata.appVersion,
      buildSha: runtimeBuildMetadata.buildSha,
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
      runtimeAppUpdate,
      runtimeReadiness.activeRegisterSession,
      runtimeReadiness.appShell,
      runtimeBuildMetadata.appVersion,
      runtimeBuildMetadata.buildSha,
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
  const localDiagnosticsEvents = useMemo(
    () =>
      events
        .slice()
        .sort((left, right) => left.sequence - right.sequence)
        .map((event) => toLocalRuntimeDiagnosticsEvent(event, uploadSupport)),
    [events, uploadSupport],
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
    if (!storeId || !runtimeStatusTerminalId || !runtimeStatusSyncSecretHash) {
      return;
    }

    return startRuntimeStatusFreshnessHeartbeat(() => {
      setRuntimeStatusObservationToken((current) => current + 1);
    });
  }, [runtimeStatusSyncSecretHash, runtimeStatusTerminalId, storeId]);

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
    if (!runtimeReadiness.terminalSeed && !readError && events.length === 0) {
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
    const publishState = getRuntimeStatusPublishState({
      storeId: checkInStoreId,
      terminalId: checkInTerminalId,
    });
    const signature = getRuntimeStatusPublishSignature({
      observationToken: runtimeStatusObservationToken,
      runtimeStatus,
      storeId: checkInStoreId,
      terminalId: checkInTerminalId,
    });
    const materialSignature = getRuntimeStatusPublishMaterialSignature({
      runtimeStatus,
      storeId: checkInStoreId,
      terminalId: checkInTerminalId,
    });
    if (
      runtimeStatusPublishInFlightRef.current ||
      publishState.inFlight === true
    ) {
      queuedRuntimeStatusSignatureRef.current = signature;
      publishState.queuedSignature = signature;
      return;
    }
    const forcePublish =
      forceNextRuntimeStatusPublishRef.current || publishState.forceNextPublish;
    if (
      !forcePublish &&
      !shouldPublishRuntimeStatus({
        lastMaterialSignature: publishState.lastMaterialSignature,
        lastPublishedAt: publishState.lastPublishedAt,
        lastPublishSignature: publishState.lastSignature,
        materialSignature,
        now: Date.now(),
        publishSignature: signature,
      })
    ) {
      return;
    }
    forceNextRuntimeStatusPublishRef.current = false;
    publishState.forceNextPublish = false;
    lastRuntimeStatusSignatureRef.current = signature;
    lastRuntimeStatusMaterialSignatureRef.current = materialSignature;
    publishState.lastSignature = signature;
    publishState.lastMaterialSignature = materialSignature;
    runtimeStatusPublishInFlightRef.current = true;
    publishState.inFlight = true;

    const attemptedAt = Date.now();
    lastRuntimeStatusPublishedAtRef.current = attemptedAt;
    publishState.lastPublishedAt = attemptedAt;
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

    void Promise.resolve(
      reportTerminalRuntimeStatus({
        storeId: checkInStoreId as Id<"store">,
        terminalId: checkInTerminalId as Id<"posTerminal">,
        syncSecretHash: checkInSyncSecretHash,
        status: toReportablePosTerminalRuntimeStatus(runtimeStatus),
      }),
    )
      .then(async (result) => {
        if (!isCurrentPublishScope()) return;

        if (result?.kind === "ok") {
          if (appUpdateCommandCorrelation) {
            clearStoredAppUpdateCommandCorrelation();
            setAppUpdateCommandCorrelation(null);
          }
          if (runtimeReadiness.terminalSeed) {
            const authorityStore =
              storeFactory?.() ??
              (typeof indexedDB === "undefined"
                ? null
                : createPosLocalStore({
                    adapter: createIndexedDbPosLocalStorageAdapter(),
                  }));

            if (authorityStore) {
              const drawerAuthorityUpdated =
                await persistRuntimeDrawerAuthorityDirective({
                  directive: readRuntimeDrawerAuthorityDirective(result.data),
                  store: authorityStore,
                  storeId: checkInStoreId,
                  terminalSeed: runtimeReadiness.terminalSeed,
                });
              if (!isCurrentPublishScope()) return;
              const activeRegisterSessionDirective =
                readRuntimeActiveRegisterSessionDirective(result.data);
              const activeRegisterSessionSeed =
                await seedRuntimeActiveRegisterSessionDirective({
                  directive: activeRegisterSessionDirective,
                  staffProfileId,
                  staffProofToken,
                  store: authorityStore,
                  storeId: checkInStoreId,
                  terminalId: checkInTerminalId,
                });
              if (!isCurrentPublishScope()) return;

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
              if (drawerAuthorityUpdated) {
                setRuntimeStatusObservationToken((current) => current + 1);
                onLocalEventsChanged?.();
              }
              if (activeRegisterSessionSeed.seeded) {
                const readiness = await refreshTerminalRuntimeReadiness({
                  store: authorityStore,
                  storeId: checkInStoreId,
                  terminalId: checkInTerminalId,
                  terminalSeed: runtimeReadiness.terminalSeed,
                });
                if (!isCurrentPublishScope()) return;
                setRuntimeReadiness(readiness);
                setRefreshToken((current) => current + 1);
                setRuntimeStatusObservationToken((current) => current + 1);
                onLocalEventsChanged?.();
              }
              setDebug((current) => ({
                ...current,
                activeRegisterSessionRepair: {
                  ...(activeRegisterSessionDirective
                    ? { directive: activeRegisterSessionDirective }
                    : {}),
                  observedAt: Date.now(),
                  seedResult: activeRegisterSessionSeed.seedResult,
                },
              }));
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
              publishState.lastSignature =
                lastRuntimeStatusSignatureRef.current;
              lastRuntimeStatusMaterialSignatureRef.current =
                getRuntimeStatusPublishMaterialSignature({
                  runtimeStatus: buildPosTerminalRuntimeStatus({
                    ...runtimeStatusInput,
                    terminalIntegrity,
                  }),
                  storeId: checkInStoreId,
                  terminalId: checkInTerminalId,
                });
              publishState.lastMaterialSignature =
                lastRuntimeStatusMaterialSignatureRef.current;
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
            checkInPublishReason: terminalAuthorizationRejected
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
      })
      .finally(() => {
        runtimeStatusPublishInFlightRef.current = false;
        publishState.inFlight = false;
        const queuedSignature = queuedRuntimeStatusSignatureRef.current;
        const queuedScopeSignature = publishState.queuedSignature;
        queuedRuntimeStatusSignatureRef.current = null;
        publishState.queuedSignature = null;
        const nextQueuedSignature = queuedSignature ?? queuedScopeSignature;
        if (
          ((nextQueuedSignature &&
            nextQueuedSignature !== publishState.lastSignature) ||
            isStale) &&
          isRuntimeStatusPublisherMountedRef.current
        ) {
          forceNextRuntimeStatusPublishRef.current = true;
          publishState.forceNextPublish = true;
          setRuntimeStatusObservationToken((current) => current + 1);
        }
      });

    return () => {
      isStale = true;
    };
  }, [
    reportTerminalRuntimeStatus,
    events.length,
    readError,
    appUpdateCommandCorrelation,
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
    staffProfileId,
    staffProofToken,
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
    })
      .then(async (claimResult) => {
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
          appUpdateCoordinator,
          onRetrySync: requestRetry,
          refreshStaffAuthority: async ({ storeId, terminalId }) => {
            if (typeof store.replaceStaffAuthoritySnapshot !== "function") {
              throw new Error("Local staff authority storage is unavailable.");
            }

            const result = await refreshAndStoreTerminalStaffAuthority({
              localStore: store,
              refreshTerminalStaffAuthority:
                refreshTerminalStaffAuthority as Parameters<
                  typeof refreshAndStoreTerminalStaffAuthority
                >[0]["refreshTerminalStaffAuthority"],
              storeId: storeId as Id<"store">,
              terminalId: terminalId as Id<"posTerminal">,
              mapRecords: (records) =>
                records.flatMap((record) => {
                  if (
                    record.status !== "active" &&
                    record.status !== "revoked"
                  ) {
                    return [];
                  }
                  const verifier = record.verifier;
                  if (!isLocalPinVerifierMetadata(verifier)) {
                    return [];
                  }

                  const localRecord: PosLocalStaffAuthorityRecord = {
                    ...record,
                    status: record.status,
                    verifier,
                  };
                  return [localRecord];
                }),
            });
            if (result.status === "preserved") {
              throw new Error(
                result.message ?? "Staff authority refresh failed.",
              );
            }
            if (result.status === "write_failed") {
              throw new Error(result.message);
            }

            return {
              message: "Staff authority refreshed.",
              refreshedAt: Date.now(),
              status: "ready",
            };
          },
          store,
          storeId,
          terminalId: runtimeStatusTerminalId,
          terminalSeed: runtimeReadiness.terminalSeed,
        });
        const updateAppCorrelation = buildAppUpdateCommandCorrelation(
          claimResult.data,
        );
        if (updateAppCorrelation) {
          setAppUpdateCommandCorrelation(updateAppCorrelation);
        }

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
        const executionId =
          typeof claimResult.data.executionId === "string"
            ? claimResult.data.executionId
            : undefined;
        const persistedReloadCorrelation = updateAppCorrelation
          ? storeAppUpdateCommandCorrelation(updateAppCorrelation)
          : true;
        if (!persistedReloadCorrelation) {
          localResult.onAcknowledgeFailed?.();
          clearStoredAppUpdateCommandCorrelation();
          setAppUpdateCommandCorrelation(null);
          observedRecoveryCommandIdsRef.current.delete(command._id);
          if (!isStale) {
            setDebug((current) => ({
              ...current,
              terminalRecoveryCommandCompletedAt: Date.now(),
              terminalRecoveryCommandMessage:
                "App update was accepted, but refresh evidence could not be saved.",
              terminalRecoveryCommandStatus: "failed",
            }));
            setRecoveryCommandRetryToken((current) => current + 1);
          }
          return;
        }
        const acknowledged = await acknowledgeTerminalRecoveryCommand({
          commandId: claimResult.data._id,
          clearedLocalReviewEventIds: localResult.clearedLocalReviewEventIds,
          ...(executionId ? { executionId } : {}),
          message: localResult.message,
          localReviewEvents: localResult.localReviewEvents,
          result: ackResult,
          storeId: storeId as Id<"store">,
          syncSecretHash: runtimeStatusSyncSecretHash,
          terminalId: runtimeStatusTerminalId as Id<"posTerminal">,
        });
        if (acknowledged.kind !== "ok") {
          localResult.onAcknowledgeFailed?.();
          if (updateAppCorrelation) {
            clearStoredAppUpdateCommandCorrelation();
            setAppUpdateCommandCorrelation(null);
          }
          observedRecoveryCommandIdsRef.current.delete(command._id);
          if (!isStale) {
            setRecoveryCommandRetryToken((current) => current + 1);
          }
        }
        let postAcknowledgeMessage: string | undefined;
        if (acknowledged.kind === "ok") {
          const postAcknowledgeResult = await localResult.postAcknowledge?.();
          postAcknowledgeMessage = postAcknowledgeResult?.message;
          if (postAcknowledgeResult?.applied === false) {
            clearStoredAppUpdateCommandCorrelation();
          }
          if (isStale) return;

          const readiness = await refreshTerminalRuntimeReadiness({
            store,
            storeId,
            terminalId: runtimeStatusTerminalId,
            terminalSeed: runtimeReadiness.terminalSeed,
          });
          if (isStale) return;

          setRuntimeReadiness(readiness);
        }

        setDebug((current) => ({
          ...current,
          terminalRecoveryCommandCompletedAt: Date.now(),
          terminalRecoveryCommandMessage:
            acknowledged.kind === "ok"
              ? (postAcknowledgeMessage ?? localResult.message)
              : acknowledged.kind === "user_error"
                ? acknowledged.error.message
                : "Recovery command acknowledgement failed.",
          terminalRecoveryCommandStatus:
            acknowledged.kind === "ok" ? localResult.status : "failed",
        }));
        setRefreshToken((current) => current + 1);
        setRuntimeStatusObservationToken((current) => current + 1);
        onLocalEventsChanged?.();
      })
      .catch(() => {
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
    appUpdateCoordinator,
    onLocalEventsChanged,
    recoveryCommandRetryToken,
    recoveryCommands,
    refreshTerminalStaffAuthority,
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
        localEvents: localDiagnosticsEvents,
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
      return {
        ...source,
        copyDiagnostics,
        debug,
        localEvents: localDiagnosticsEvents,
        runtimeStatus,
      };
    }

    return debug.lastTrigger
      ? {
          copyDiagnostics,
          debug,
          localEvents: localDiagnosticsEvents,
          onRetrySync: requestRetry,
          runtimeStatus,
        }
      : null;
  }, [
    copyDiagnostics,
    debug,
    events,
    isOnline,
    localDiagnosticsEvents,
    readError,
    requestRetry,
    runtimeStatus,
    staffProfileId,
  ]);
}

type RuntimeStatusPublishState = {
  forceNextPublish: boolean;
  inFlight: boolean;
  lastMaterialSignature: string | null;
  lastPublishedAt: number | null;
  lastSignature: string | null;
  queuedSignature: string | null;
};

const runtimeStatusPublishStates = new Map<string, RuntimeStatusPublishState>();

export function resetRuntimeStatusPublishStateForTests() {
  runtimeStatusPublishStates.clear();
}

function getRuntimeStatusPublishState(input: {
  storeId: string;
  terminalId: string;
}) {
  const key = `${input.storeId}:${input.terminalId}`;
  const existing = runtimeStatusPublishStates.get(key);
  if (existing) return existing;

  const state: RuntimeStatusPublishState = {
    forceNextPublish: false,
    inFlight: false,
    lastMaterialSignature: null,
    lastPublishedAt: null,
    lastSignature: null,
    queuedSignature: null,
  };
  runtimeStatusPublishStates.set(key, state);
  return state;
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

function readRuntimeDrawerAuthorityDirective(
  data: unknown,
): RuntimeDrawerAuthorityDirective | null {
  if (!data || typeof data !== "object") return null;
  const directive = (data as { drawerAuthorityDirective?: unknown })
    .drawerAuthorityDirective;
  if (!directive || typeof directive !== "object") return null;
  const candidate = directive as Partial<RuntimeDrawerAuthorityDirective>;
  if (
    typeof candidate.localRegisterSessionId !== "string" ||
    candidate.localRegisterSessionId.length === 0 ||
    candidate.status !== "blocked" ||
    candidate.reason !== "cloud_closed"
  ) {
    return null;
  }

  return {
    ...(typeof candidate.cloudRegisterSessionId === "string"
      ? { cloudRegisterSessionId: candidate.cloudRegisterSessionId }
      : {}),
    localRegisterSessionId: candidate.localRegisterSessionId,
    ...(typeof candidate.message === "string"
      ? { message: candidate.message }
      : {}),
    observedAt:
      typeof candidate.observedAt === "number" ? candidate.observedAt : Date.now(),
    reason: "cloud_closed",
    ...(typeof candidate.registerNumber === "string"
      ? { registerNumber: candidate.registerNumber }
      : {}),
    status: "blocked",
  };
}

function readRuntimeActiveRegisterSessionDirective(
  data: unknown,
): RuntimeActiveRegisterSessionDirective | null {
  if (!data || typeof data !== "object") return null;
  const directive = (
    data as { activeRegisterSessionDirective?: unknown }
  ).activeRegisterSessionDirective;
  if (!directive || typeof directive !== "object") return null;
  const candidate =
    directive as Partial<RuntimeActiveRegisterSessionDirective>;
  if (
    typeof candidate.cloudRegisterSessionId !== "string" ||
    candidate.cloudRegisterSessionId.length === 0 ||
    typeof candidate.localRegisterSessionId !== "string" ||
    candidate.localRegisterSessionId.length === 0 ||
    typeof candidate.expectedCash !== "number" ||
    typeof candidate.openedAt !== "number" ||
    typeof candidate.openingFloat !== "number" ||
    candidate.status !== "active"
  ) {
    return null;
  }

  return {
    cloudRegisterSessionId: candidate.cloudRegisterSessionId,
    expectedCash: candidate.expectedCash,
    localRegisterSessionId: candidate.localRegisterSessionId,
    observedAt:
      typeof candidate.observedAt === "number" ? candidate.observedAt : Date.now(),
    openedAt: candidate.openedAt,
    openingFloat: candidate.openingFloat,
    ...(typeof candidate.registerNumber === "string"
      ? { registerNumber: candidate.registerNumber }
      : {}),
    ...(typeof candidate.staffProfileId === "string"
      ? { staffProfileId: candidate.staffProfileId }
      : {}),
    status: "active",
  };
}

async function seedRuntimeActiveRegisterSessionDirective(input: {
  directive: RuntimeActiveRegisterSessionDirective | null;
  staffProfileId?: string | null;
  staffProofToken?: string | null;
  store: PosLocalRuntimeStore;
  storeId: string;
  terminalId: string;
}): Promise<{
  seeded: boolean;
  seedResult: NonNullable<
    PosLocalRuntimeSyncDebug["activeRegisterSessionRepair"]
  >["seedResult"];
}> {
  if (!input.directive) {
    return { seeded: false, seedResult: "missing_directive" };
  }
  const staffProfileId =
    input.staffProfileId ?? input.directive.staffProfileId ?? null;
  if (!staffProfileId) {
    return { seeded: false, seedResult: "missing_staff_identity" };
  }

  const gateway = createLocalCommandGateway({
    allowExplicitRegisterSessionWithoutProjection: true,
    allowRegisterSessionSeedAfterSettledHistory: true,
    allowRegisterSessionSeedFromRuntimeDirective: true,
    staffProofToken:
      staffProfileId === input.staffProfileId
        ? (input.staffProofToken ?? undefined)
        : undefined,
    store: input.store,
  });

  const seeded = await gateway.seedRegisterSession({
    cloudRegisterSessionId: input.directive.cloudRegisterSessionId,
    expectedCash: input.directive.expectedCash,
    localRegisterSessionId: input.directive.localRegisterSessionId,
    openingFloat: input.directive.openingFloat,
    registerNumber: input.directive.registerNumber,
    staffProfileId,
    storeId: input.storeId,
    terminalId: input.terminalId,
    validationMetadata: {
      flags: ["cloud-validation-uncertain"],
      observedAt: input.directive.observedAt,
    },
    runtimeDirectiveRepair: true,
    status: input.directive.status,
  });
  return {
    seeded,
    seedResult: seeded ? "seeded" : "gateway_rejected",
  };
}

async function persistRuntimeDrawerAuthorityDirective(input: {
  directive: RuntimeDrawerAuthorityDirective | null;
  store: PosLocalRuntimeStore;
  storeId: string;
  terminalSeed: PosProvisionedTerminalSeed;
}): Promise<boolean> {
  if (
    !input.directive ||
    typeof input.store.writeDrawerAuthorityState !== "function"
  ) {
    return false;
  }

  const state: PosDrawerAuthorityState = {
    ...input.directive,
    storeId: input.storeId,
    terminalId: input.terminalSeed.terminalId,
  };
  if (typeof input.store.readDrawerAuthorityState === "function") {
    const current = await input.store.readDrawerAuthorityState({
      localRegisterSessionId: state.localRegisterSessionId,
      storeId: state.storeId,
      terminalId: state.terminalId,
    });
    assertPosLocalStoreOk(current);
    if (
      current.value?.status === state.status &&
      current.value.reason === state.reason &&
      current.value.cloudRegisterSessionId === state.cloudRegisterSessionId
    ) {
      return false;
    }
  }

  const result = await input.store.writeDrawerAuthorityState(state);
  assertPosLocalStoreOk(result);
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

function isTerminalAuthorizationFailure(result: {
  kind: string;
  error?: { code?: string; metadata?: Record<string, unknown> };
}): result is {
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
  error?: {
    code?: string;
    message?: string;
    metadata?: Record<string, unknown>;
  };
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
  error:
    | { code?: string; metadata?: Record<string, unknown> }
    | null
    | undefined,
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
  if (
    result.status === "precondition_failed" ||
    result.reason === "precondition_failed"
  ) {
    return "precondition_failed" as const;
  }
  return "failed" as const;
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

function toLocalRuntimeDiagnosticsEvent(
  event: PosLocalEventRecord,
  uploadSupport: PosLocalSyncUploadSupport,
): PosLocalRuntimeDiagnosticsEvent {
  return {
    ...toPosTerminalRuntimeDiagnosticsEvent(event),
    ...(isRuntimeUploadableDiagnosticsEvent(event, uploadSupport)
      ? { syncUploadable: true }
      : {}),
  };
}

function isRuntimeUploadableDiagnosticsEvent(
  event: PosLocalEventRecord,
  uploadSupport: PosLocalSyncUploadSupport,
) {
  return (
    isPendingUploadCandidate(event) &&
    isSyncablePosLocalEvent(event, uploadSupport)
  );
}

function isPendingUploadCandidate(event: PosLocalEventRecord) {
  return (
    event.sync.status === "pending" ||
    event.sync.status === "syncing" ||
    event.sync.status === "failed" ||
    (event.sync.status === "needs_review" && event.sync.uploaded)
  );
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

export function isPosLocalRuntimeDrainCandidate(
  event: PosLocalEventRecord,
  options: PosLocalRuntimeDrainOptions = {},
  uploadSupport: PosLocalSyncUploadSupport = {},
) {
  const isReviewEvent = event.sync.status === "needs_review";
  const isUploadedReviewEvent =
    isReviewEvent && event.sync.uploaded === true;
  const isIncludedReviewEvent =
    options.includeReviewEvents === true
      ? isReviewEvent
      : options.includeUploadedReviewEvents === true && isUploadedReviewEvent;
  const isUploadedRegisterOpenReviewEvent =
    isIncludedReviewEvent && event.type === "register.opened";

  if (options.onlyUploadedRegisterOpenReviewEvents === true) {
    return (
      isUploadedRegisterOpenReviewEvent &&
      isSyncablePosLocalEvent(event, uploadSupport)
    );
  }

  if (
    options.onlyReviewEvents === true ||
    options.onlyUploadedReviewEvents === true
  ) {
    return isIncludedReviewEvent && isSyncablePosLocalEvent(event, uploadSupport);
  }

  return (
    (event.sync.status === "pending" ||
      event.sync.status === "syncing" ||
      event.sync.status === "failed" ||
      isIncludedReviewEvent) &&
    isSyncablePosLocalEvent(event, uploadSupport)
  );
}

export function isPosLocalRuntimeActivityReportCandidate(
  event: PosLocalEventRecord,
) {
  if (!canReportPosRegisterSessionLocalActivityType(event.type)) {
    return false;
  }

  if (event.activity?.status === "pending") {
    return true;
  }

  return (
    event.activity?.status === "failed" &&
    (event.activity.reasonCode === "network_error" ||
      event.activity.reasonCode === "unknown")
  );
}

async function reportRegisterSessionActivityForEvents(input: {
  cloudTerminalId: string;
  events: PosLocalEventRecord[];
  ingestRegisterSessionActivity: (
    args: IngestRegisterSessionActivityArgs,
  ) => Promise<unknown>;
  store: PosLocalRuntimeStore;
  syncSeed: PosProvisionedTerminalSeed;
}) {
  const candidates = input.events.filter(isPosLocalRuntimeActivityReportCandidate);
  if (candidates.length === 0) return;

  const groups = groupRegisterSessionActivityCandidates(candidates);
  for (const events of groups.values()) {
    const reportableEvents: Array<{
      event: PosLocalEventRecord;
      activity: PosRegisterSessionLocalActivitySummary;
    }> = [];
    const failedEventIds: string[] = [];
    const failedReasonCodes = new Map<string, Parameters<
      PosLocalRuntimeStore["markEventsActivityFailed"]
    >[1]["reasonCode"]>();

    for (const event of events) {
      const sanitized = sanitizePosRegisterSessionLocalActivity({
        createdAt: event.createdAt,
        localEventId: event.localEventId,
        localExpenseSessionId: event.localExpenseSessionId,
        localPosSessionId: event.localPosSessionId,
        localRegisterSessionId: event.localRegisterSessionId,
        localTransactionId: event.localTransactionId,
        payload: event.payload,
        registerNumber: event.registerNumber,
        sequence: event.sequence,
        staffProfileId: event.staffProfileId,
        storeId: input.syncSeed.storeId,
        terminalId: input.cloudTerminalId,
        type: event.type,
        uploadSequence: event.uploadSequence,
      });

      if (!sanitized.ok) {
        failedEventIds.push(event.localEventId);
        failedReasonCodes.set(event.localEventId, sanitized.reasonCode);
        continue;
      }

      reportableEvents.push({ event, activity: sanitized.value });
    }

    for (const failedEventId of failedEventIds) {
      const failed = await input.store.markEventsActivityFailed(
        [failedEventId],
        {
          reasonCode: failedReasonCodes.get(failedEventId) ?? "unknown",
        },
      );
      assertPosLocalStoreOk(failed);
    }

    if (reportableEvents.length === 0) continue;

    const localRegisterSessionId =
      reportableEvents[0]?.activity.localRegisterSessionId;
    if (!localRegisterSessionId) continue;

    try {
      const result = await input.ingestRegisterSessionActivity({
        activities: reportableEvents.map(({ activity }) => ({
          category: activity.category,
          eventType: activity.localEventType,
          localEventId: activity.localEventId,
          localExpenseSessionId: activity.localExpenseSessionId,
          metadata: activity.metadata,
          occurredAt: activity.createdAt,
          registerNumber: activity.registerNumber,
          sequence: activity.sequence,
          staffProfileId: activity.staffProfileId as Id<"staffProfile"> | undefined,
          uploadSequence: activity.uploadSequence,
        })),
        localRegisterSessionId,
        registerNumber: reportableEvents[0]?.activity.registerNumber,
        reportedThroughOccurredAt: Math.max(
          ...reportableEvents.map(({ activity }) => activity.createdAt),
        ),
        reportedThroughSequence: Math.max(
          ...reportableEvents.map(({ activity }) => activity.sequence),
        ),
        storeId: input.syncSeed.storeId as Id<"store">,
        submittedAt: Date.now(),
        syncSecretHash: input.syncSeed.syncSecretHash,
        terminalId: input.cloudTerminalId as Id<"posTerminal">,
      } satisfies IngestRegisterSessionActivityArgs);

      if (!isCommandOk(result)) {
        await markActivityReportFailed(input.store, reportableEvents, "server_rejected");
        continue;
      }

      const acceptedIds = new Set(
        result.data.accepted.map((activity) => activity.localEventId),
      );
      const mappingPendingAcceptedIds = new Set(
        result.data.accepted
          .filter((accepted) => accepted.status === "mapping_pending")
          .map((accepted) => accepted.localEventId),
      );
      const skippedIds = new Set(
        result.data.skipped
          .map((activity) => activity.localEventId)
          .filter((localEventId): localEventId is string => Boolean(localEventId)),
      );
      const reportedIds = reportableEvents
        .filter(
          ({ activity }) =>
            acceptedIds.has(activity.localEventId) &&
            !mappingPendingAcceptedIds.has(activity.localEventId),
        )
        .map(({ activity }) => activity.localEventId);
      const mappingPendingIds = reportableEvents
        .filter(({ activity }) =>
          mappingPendingAcceptedIds.has(activity.localEventId),
        )
        .map(({ activity }) => activity.localEventId);
      const skippedReportable = reportableEvents.filter(({ activity }) =>
        skippedIds.has(activity.localEventId),
      );

      if (reportedIds.length > 0) {
        const reported = await input.store.markEventsActivityReported(
          reportedIds,
          {
            reportedAt: Date.now(),
            status: "reported",
          },
        );
        assertPosLocalStoreOk(reported);
      }
      if (mappingPendingIds.length > 0) {
        const mappingPending = await input.store.markEventsActivityReported(
          mappingPendingIds,
          {
            reportedAt: Date.now(),
            status: "mapping_pending",
          },
        );
        assertPosLocalStoreOk(mappingPending);
      }
      if (skippedReportable.length > 0) {
        await markActivityReportFailed(
          input.store,
          skippedReportable,
          "server_rejected",
        );
      }
    } catch {
      await markActivityReportFailed(input.store, reportableEvents, "network_error");
    }
  }
}

function groupRegisterSessionActivityCandidates(events: PosLocalEventRecord[]) {
  const groups = new Map<string, PosLocalEventRecord[]>();
  for (const event of [...events].sort(
    (left, right) => left.sequence - right.sequence,
  )) {
    const key = event.localRegisterSessionId;
    if (!key) {
      const missingKey = `missing:${event.localEventId}`;
      groups.set(missingKey, [event]);
      continue;
    }
    groups.set(key, [...(groups.get(key) ?? []), event]);
  }
  return groups;
}

async function markActivityReportFailed(
  store: PosLocalRuntimeStore,
  reportableEvents: Array<{ activity: { localEventId: string } }>,
  reasonCode: Parameters<
    PosLocalRuntimeStore["markEventsActivityFailed"]
  >[1]["reasonCode"],
) {
  const failed = await store.markEventsActivityFailed(
    reportableEvents.map(({ activity }) => activity.localEventId),
    { reasonCode },
  );
  assertPosLocalStoreOk(failed);
}

function isCommandOk(
  result: unknown,
): result is {
  kind: "ok";
  data: {
    accepted: Array<{
      localEventId: string;
      sequence: number;
      status: "terminal_reported" | "mapping_pending";
    }>;
    skipped: Array<{
      localEventId?: string;
      sequence?: number;
      code: string;
    }>;
  };
} {
  return (
    typeof result === "object" &&
    result !== null &&
    (result as { kind?: unknown }).kind === "ok" &&
    typeof (result as { data?: unknown }).data === "object" &&
    (result as { data?: unknown }).data !== null &&
    Array.isArray(
      (result as { data: { accepted?: unknown } }).data.accepted,
    ) &&
    Array.isArray((result as { data: { skipped?: unknown } }).data.skipped)
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
  mappings: Array<{
    cloudTable: string;
    localEventId: string;
    localIdKind: string;
  }> = [],
  conflicts: Array<{
    conflictType: string;
    localEventId: string;
    status: string;
  }> = [],
) {
  return acceptedEvents
    .filter(
      (event) =>
        event.status === "projected" ||
        isServerOwnedInventoryReviewSettlement(
          event.localEventId,
          mappings,
          conflicts,
        ),
    )
    .map((event) => event.localEventId);
}

export function collectServerReviewLocalEventIds(
  acceptedEvents: Array<{
    localEventId: string;
    status: string;
  }>,
  mappings: Array<{
    cloudTable: string;
    localEventId: string;
    localIdKind: string;
  }> = [],
  conflicts: Array<{
    conflictType: string;
    localEventId: string;
    status: string;
  }> = [],
) {
  return acceptedEvents
    .filter(
      (event) =>
        event.status === "conflicted" &&
        !isServerOwnedInventoryReviewSettlement(
          event.localEventId,
          mappings,
          conflicts,
        ),
    )
    .map((event) => event.localEventId);
}

function isServerOwnedInventoryReviewSettlement(
  localEventId: string,
  mappings: Array<{
    cloudTable: string;
    localEventId: string;
    localIdKind: string;
  }>,
  conflicts: Array<{
    conflictType: string;
    localEventId: string;
    status: string;
  }>,
) {
  const hasOpenInventoryReviewConflict = conflicts.some(
    (conflict) =>
      conflict.localEventId === localEventId &&
      conflict.conflictType === "inventory" &&
      conflict.status === "needs_review",
  );
  if (!hasOpenInventoryReviewConflict) {
    return false;
  }

  const localMappings = mappings.filter(
    (mapping) => mapping.localEventId === localEventId,
  );
  const hasProjectedTransaction = localMappings.some(
    (mapping) =>
      mapping.localIdKind === "transaction" &&
      mapping.cloudTable === "posTransaction",
  );
  const hasInventoryReviewWork = localMappings.some(
    (mapping) =>
      mapping.localIdKind === "inventoryReviewWorkItem" &&
      mapping.cloudTable === "operationalWorkItem",
  );

  return hasProjectedTransaction && hasInventoryReviewWork;
}

export function collectServerRejectedLocalEventIds(
  acceptedEvents: Array<{
    localEventId: string;
    status: string;
  }>,
) {
  return acceptedEvents
    .filter((event) => event.status === "rejected")
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
    if (!result.ok)
      return { ok: false as const, message: result.error.message };
  }

  return { ok: true as const };
}

function toLocalCloudMappingEntity(
  kind: string,
): PosLocalCloudMapping["entity"] | null {
  if (kind === "registerSession") return "registerSession";
  if (kind === "posSession") return "posSession";
  if (kind === "transaction") return "posTransaction";
  if (kind === "expenseSession") return "expenseSession";
  if (kind === "expenseTransaction") return "expenseTransaction";
  if (kind === "pendingCheckoutItem") return "pendingCheckoutItem";
  return null;
}

export function collectSyncedLocalEventIds(
  events: PosLocalEventRecord[],
  acceptedUploadEventIds: string[],
) {
  return collectAcceptedEventIdsWithLocalPrecursors(
    events,
    acceptedUploadEventIds,
  );
}

function collectReviewLocalEventIds(
  events: PosLocalEventRecord[],
  acceptedReviewEventIds: string[],
) {
  return collectAcceptedEventIdsWithLocalPrecursors(
    events,
    acceptedReviewEventIds,
  );
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
    if (
      event.type !== "transaction.completed" &&
      event.type !== "cart.cleared"
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
        ? events.filter(
            (event) => event.staffProfileId === options.staffProfileId,
          )
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
  const statusEvents = [...relevantEvents, ...terminalBlockingRelevantEvents];
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
    status:
      status.state === "failed" || status.state === "needs_review"
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
      (event.type !== "transaction.completed" &&
        event.type !== "cart.cleared") ||
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
  if (isNonBlockingRegisterLifecycleReviewEvent(event)) {
    return false;
  }

  return (
    isSyncablePosLocalEvent(event) ||
    event.type === "register.opened" ||
    event.type === "transaction.completed" ||
    event.type === "cart.cleared" ||
    event.type === "register.closeout_started" ||
    event.type === "register.reopened"
  );
}

function hasPendingSyncableExpenseEvents(
  events: PosLocalEventRecord[],
  uploadSupport: PosLocalSyncUploadSupport,
) {
  return events.some(
    (event) =>
      event.type === "expense.completed" &&
      (event.sync.status === "pending" ||
        event.sync.status === "syncing" ||
        event.sync.status === "failed") &&
      isSyncablePosLocalEvent(event, uploadSupport),
  );
}

function hasUploadedRegisterOpenReviewEvents(events: PosLocalEventRecord[]) {
  return events.some(
    (event) =>
      event.type === "register.opened" &&
      event.sync.status === "needs_review" &&
      event.sync.uploaded === true,
  );
}

function buildRuntimeAppUpdateInput({
  appUpdateCoordinator,
  commandCorrelation,
  runtimeBuildMetadata,
}: {
  appUpdateCoordinator?: PosAppUpdateCoordinatorAdapter | null;
  commandCorrelation?: AppUpdateCommandCorrelation | null;
  runtimeBuildMetadata: AthenaWebappRuntimeBuildMetadata;
}): PosTerminalRuntimeAppUpdateInput | null {
  if (!appUpdateCoordinator) return null;

  try {
    const snapshot = appUpdateCoordinator.getSnapshot();
    if (isPendingSnapshotAlreadyRunning(snapshot, runtimeBuildMetadata)) {
      return {
        canApply: false,
        commandExecutionId: commandCorrelation?.commandExecutionId,
        commandId: commandCorrelation?.commandId,
        commandIssuedAt: commandCorrelation?.commandIssuedAt,
        currentBuildId: snapshot.pendingBuildId,
        detectorStatus: "ok",
        stagingStatus: "unknown",
        status: "current",
      };
    }

    return {
      canApply: snapshot.canApply,
      commandExecutionId: commandCorrelation?.commandExecutionId,
      commandId: commandCorrelation?.commandId,
      commandIssuedAt: commandCorrelation?.commandIssuedAt,
      currentBuildId: snapshot.currentBuildId,
      detectorStatus: snapshot.status === "detector-failed" ? "failed" : "ok",
      pendingBuildId: snapshot.pendingBuildId,
      selectedBlockerCode: toRuntimeAppUpdateBlockerCode(
        snapshot.selectedBlocker?.priority,
      ),
      stagingAssetCount: snapshot.staging?.assetCount,
      stagingFailedAssetCount: snapshot.staging?.failedAssetCount,
      stagingReason: snapshot.staging?.reason,
      stagingRejectedAssetCount: snapshot.staging?.rejectedAssetCount,
      stagingStatus:
        snapshot.status === "ready"
          ? "staged"
          : snapshot.status === "ready-unstaged"
            ? "unstaged"
            : "unknown",
      status: toRuntimeAppUpdateStatus(snapshot),
    };
  } catch {
    return {
      canApply: false,
      commandExecutionId: commandCorrelation?.commandExecutionId,
      commandId: commandCorrelation?.commandId,
      commandIssuedAt: commandCorrelation?.commandIssuedAt,
      detectorStatus: "failed",
      stagingStatus: "unknown",
      status: "detector_failed",
    };
  }
}

function isPendingSnapshotAlreadyRunning(
  snapshot: ReturnType<PosAppUpdateCoordinatorAdapter["getSnapshot"]>,
  runtimeBuildMetadata: AthenaWebappRuntimeBuildMetadata,
) {
  if (
    snapshot.status !== "ready" &&
    snapshot.status !== "ready-unstaged" &&
    snapshot.status !== "blocked"
  ) {
    return false;
  }

  const pendingBuildId = normalizeBuildIdentity(snapshot.pendingBuildId);
  if (!pendingBuildId) {
    return false;
  }

  return (
    normalizeBuildIdentity(runtimeBuildMetadata.buildSha) === pendingBuildId ||
    normalizeBuildIdentity(runtimeBuildMetadata.appVersion) === pendingBuildId
  );
}

function normalizeBuildIdentity(value?: string | null) {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function toRuntimeAppUpdateStatus(
  snapshot: ReturnType<PosAppUpdateCoordinatorAdapter["getSnapshot"]>,
): PosTerminalRuntimeAppUpdateInput["status"] {
  const { status } = snapshot;
  if (status === "ready") return "update_ready";
  if (status === "ready-unstaged") {
    return snapshot.canApply ? "update_ready" : "update_ready_unstaged";
  }
  if (status === "detector-failed") return "detector_failed";
  return status;
}

function toRuntimeAppUpdateBlockerCode(
  priority?: "critical-workflow" | "active-command" | "resume-required",
): PosTerminalRuntimeAppUpdateInput["selectedBlockerCode"] {
  if (priority === "critical-workflow") return "active_sale";
  if (priority === "active-command") return "active_command";
  if (priority === "resume-required") return "resume_required";
  return undefined;
}

function buildAppUpdateCommandCorrelation(command: {
  _id?: unknown;
  commandId?: unknown;
  commandType?: unknown;
  executionId?: unknown;
  issuedAt?: unknown;
  type?: unknown;
}): AppUpdateCommandCorrelation | null {
  const commandType = command.type ?? command.commandType;
  if (commandType !== "update_app" || typeof command.executionId !== "string") {
    return null;
  }

  return {
    commandExecutionId: command.executionId,
    commandId:
      typeof command.commandId === "string"
        ? command.commandId
        : typeof command._id === "string"
          ? command._id
          : undefined,
    commandIssuedAt:
      typeof command.issuedAt === "number" && Number.isFinite(command.issuedAt)
        ? command.issuedAt
        : undefined,
  };
}

function readStoredAppUpdateCommandCorrelation() {
  if (typeof sessionStorage === "undefined") return null;

  try {
    const stored = sessionStorage.getItem(
      APP_UPDATE_COMMAND_CORRELATION_STORAGE_KEY,
    );
    if (!stored) return null;

    const parsed = JSON.parse(stored) as Partial<AppUpdateCommandCorrelation>;
    return typeof parsed.commandExecutionId === "string" &&
      parsed.commandExecutionId.length > 0
      ? {
          commandExecutionId: parsed.commandExecutionId,
          ...(typeof parsed.commandId === "string"
            ? { commandId: parsed.commandId }
            : {}),
          ...(typeof parsed.commandIssuedAt === "number" &&
          Number.isFinite(parsed.commandIssuedAt)
            ? { commandIssuedAt: parsed.commandIssuedAt }
            : {}),
        }
      : null;
  } catch {
    return null;
  }
}

function storeAppUpdateCommandCorrelation(
  correlation: AppUpdateCommandCorrelation,
) {
  if (typeof sessionStorage === "undefined") return false;

  try {
    sessionStorage.setItem(
      APP_UPDATE_COMMAND_CORRELATION_STORAGE_KEY,
      JSON.stringify(correlation),
    );
    return true;
  } catch {
    return false;
  }
}

function clearStoredAppUpdateCommandCorrelation() {
  if (typeof sessionStorage === "undefined") return;

  try {
    sessionStorage.removeItem(APP_UPDATE_COMMAND_CORRELATION_STORAGE_KEY);
  } catch {
    // Best effort only.
  }
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
