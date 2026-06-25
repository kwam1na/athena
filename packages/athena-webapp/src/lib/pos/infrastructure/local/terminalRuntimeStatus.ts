import type { FunctionArgs } from "convex/server";

import { api } from "~/convex/_generated/api";
import type { Id } from "~/convex/_generated/dataModel";
import { isNonBlockingRegisterLifecycleReviewEvent } from "~/shared/registerSessionLifecyclePolicy";

import {
  POS_LOCAL_STORE_SCHEMA_VERSION,
  type PosDrawerAuthorityState,
  type PosLocalEventRecord,
  type PosLocalStaffAuthorityReadiness,
  type PosTerminalIntegrityState,
  type PosProvisionedTerminalSeed,
} from "./posLocalStore";
import { derivePosLocalSyncStatus } from "./syncStatus";
import {
  isSyncablePosLocalEvent,
  isUploadDeferredByValidation,
} from "./syncContract";
import type { PosLocalSyncTrigger } from "./syncScheduler";

type ReportTerminalRuntimeStatusArgs = FunctionArgs<
  typeof api.pos.public.terminals.reportTerminalRuntimeStatus
>;
type ReportTerminalRuntimeStatusPayload =
  ReportTerminalRuntimeStatusArgs["status"];

export type PosTerminalRuntimeAppSessionRecoveryStatus =
  | "idle"
  | "validating"
  | "retrying"
  | "waiting_for_network"
  | "recoverable"
  | "blocked";

export type PosTerminalRuntimeAppSessionRecoveryBlockReason =
  | "missing_terminal_proof"
  | "terminal_not_available"
  | "invalid_terminal_proof"
  | "store_mismatch"
  | "terminal_revoked"
  | "app_account_disabled"
  | "app_account_not_pos_scoped"
  | "unsupported_route_scope"
  | "retry_exhausted"
  | "stale_assertion";

export type PosTerminalRuntimeAppSessionRecoveryInput = {
  assertion?: "present" | null;
  reason?: PosTerminalRuntimeAppSessionRecoveryBlockReason | null;
  status: PosTerminalRuntimeAppSessionRecoveryStatus;
};

export type PosTerminalRuntimeAppSessionRecoveryLabel =
  | "ready"
  | "recovering"
  | "retrying"
  | "waiting_for_network"
  | "blocked_terminal"
  | "blocked_app_account"
  | "blocked_store_mismatch"
  | "retry_exhausted"
  | "stale_assertion";

export type PosTerminalRuntimeAppSessionRecoveryDiagnostics = {
  status: PosTerminalRuntimeAppSessionRecoveryLabel;
};

export type PosTerminalRuntimeStatusSource =
  ReportTerminalRuntimeStatusArgs["status"]["source"];
export type PosTerminalRuntimeStatusPayload =
  ReportTerminalRuntimeStatusPayload & {
    activeRegisterSession?: PosTerminalRuntimeActiveRegisterSessionDiagnostics;
    appShell?: PosTerminalRuntimeAppShellDiagnostics;
    appUpdate?: PosTerminalRuntimeAppUpdateDiagnostics;
    appSessionRecovery?: PosTerminalRuntimeAppSessionRecoveryDiagnostics;
  };
export type PosTerminalRuntimeStatusSyncStatus =
  ReportTerminalRuntimeStatusPayload["sync"]["status"];
export type PosTerminalRuntimeStaffAuthorityStatus =
  ReportTerminalRuntimeStatusPayload["staffAuthority"]["status"];

export type PosTerminalRuntimeSyncDebugInput = {
  failedEventCount?: number;
  lastFailure?: string | null;
  lastTrigger?: PosLocalSyncTrigger;
  localOnlyEventCount?: number;
  nextPendingUploadSequence?: number;
  oldestPendingEventAt?: number;
  pendingUploadEventCount?: number;
  reviewEvents?: PosTerminalRuntimeDiagnosticsEvent[];
  reviewEventCount?: number;
  schedulerRunning?: boolean;
};

export type PosTerminalRuntimeBrowserInfo = NonNullable<
  PosTerminalRuntimeStatusPayload["browserInfo"]
>;

export type PosTerminalRuntimeSnapshotReadiness = {
  availabilityRefreshedAt?: number;
  catalogRefreshedAt?: number;
  registerReadModelRefreshedAt?: number;
  serviceCatalogRefreshedAt?: number;
};

export type PosTerminalRuntimeActiveRegisterSessionInput = {
  cloudRegisterSessionId?: string;
  localRegisterSessionId: string;
  openedAt?: number;
  registerNumber?: string;
  status: "open" | "active" | "closing" | "closeout_rejected" | "closed";
};

export type PosTerminalRuntimeActiveRegisterSessionDiagnostics =
  PosTerminalRuntimeActiveRegisterSessionInput & {
    observedAt: number;
  };

export type PosTerminalRuntimeAppShellInput = {
  ready: boolean;
};

export type PosTerminalRuntimeAppShellDiagnostics =
  PosTerminalRuntimeAppShellInput & {
    observedAt: number;
  };

export type PosTerminalRuntimeAppUpdateStatus =
  | "current"
  | "checking"
  | "update_ready"
  | "update_ready_unstaged"
  | "blocked"
  | "applying"
  | "detector_failed"
  | "unknown";

export type PosTerminalRuntimeAppUpdateStagingStatus =
  | "staged"
  | "unstaged"
  | "unknown";

export type PosTerminalRuntimeAppUpdateStagingReason =
  | "asset-staging-failed"
  | "no-entry-html"
  | "no-static-assets"
  | "cache-storage-unavailable"
  | "service-worker-unavailable"
  | "service-worker-timeout"
  | "service-worker-error"
  | "unknown";

export type PosTerminalRuntimeAppUpdateDetectorStatus =
  | "ok"
  | "failed"
  | "unknown";

export type PosTerminalRuntimeAppUpdateBlockerCode =
  | "active_sale"
  | "active_command"
  | "resume_required"
  | "unknown";

export type PosTerminalRuntimeAppUpdateCommandCorrelation = {
  executionId?: string;
  issuedAt?: number;
  nonce?: string;
};

export type PosTerminalRuntimeAppUpdateInput = {
  canApply: boolean;
  command?: PosTerminalRuntimeAppUpdateCommandCorrelation | null;
  commandExecutionId?: string;
  commandId?: string;
  commandIssuedAt?: number;
  commandNonce?: string;
  currentBuildId?: string;
  detectorStatus: PosTerminalRuntimeAppUpdateDetectorStatus;
  pendingBuildId?: string;
  selectedBlockerCode?: PosTerminalRuntimeAppUpdateBlockerCode;
  stagingAssetCount?: number;
  stagingFailedAssetCount?: number;
  stagingReason?: PosTerminalRuntimeAppUpdateStagingReason;
  stagingRejectedAssetCount?: number;
  stagingStatus?: PosTerminalRuntimeAppUpdateStagingStatus;
  status: PosTerminalRuntimeAppUpdateStatus;
};

export type PosTerminalRuntimeAppUpdateDiagnostics =
  PosTerminalRuntimeAppUpdateInput & {
    command?: PosTerminalRuntimeAppUpdateCommandCorrelation;
    observedAt: number;
  };

export type PosTerminalRuntimeStatusInput = {
  activeRegisterSession?: PosTerminalRuntimeActiveRegisterSessionInput | null;
  appShell?: PosTerminalRuntimeAppShellInput | null;
  appUpdate?: PosTerminalRuntimeAppUpdateInput | null;
  appVersion?: string;
  appSessionRecovery?: PosTerminalRuntimeAppSessionRecoveryInput | null;
  browserInfo?: PosTerminalRuntimeBrowserInfo;
  buildSha?: string;
  clock?: () => number;
  events: PosLocalEventRecord[];
  localStoreFailureMessage?: string | null;
  drawerAuthority?: PosDrawerAuthorityState | null;
  snapshots?: PosTerminalRuntimeSnapshotReadiness;
  source: PosTerminalRuntimeStatusSource;
  staffAuthorityExpiresAt?: number;
  staffAuthorityStatus?: PosLocalStaffAuthorityReadiness | "unknown";
  staffProfileId?: string | null;
  syncDebug?: PosTerminalRuntimeSyncDebugInput;
  terminalIntegrity?: PosTerminalIntegrityState | null;
  terminalSeed?: PosProvisionedTerminalSeed | null;
};

export type PosTerminalRuntimeCopyDiagnostics = {
  counts: {
    appSessionUnverifiedEventCount: number;
    cloudValidationUncertainEventCount: number;
    deferredUploadEventCount: number;
    failedEventCount: number;
    localOnlyEventCount: number;
    pendingEventCount: number;
    reviewEventCount: number;
    totalEventCount: number;
    uploadableEventCount: number;
  };
  events: PosTerminalRuntimeDiagnosticsEvent[];
  failures: {
    localStore?: string;
    sync?: string;
  };
  labels: {
    appSessionRecovery?: PosTerminalRuntimeAppSessionRecoveryLabel;
    drawerAuthority: "blocked" | "healthy" | "unknown";
    localStore: "available" | "unavailable";
    staffAuthority: PosTerminalRuntimeStaffAuthorityStatus;
    sync: PosTerminalRuntimeStatusSyncStatus;
    terminalIntegrity: "blocked" | "healthy" | "repairing" | "unknown";
  };
  reportedAt: number;
  sequences: {
    lastLocalSequence: number;
    lastSyncedSequence?: number;
    nextPendingSequence?: number | null;
    nextPendingUploadSequence?: number;
    oldestPendingUploadSequence?: number;
  };
  source: PosTerminalRuntimeStatusSource;
  terminal: {
    cloudTerminalId?: string;
    displayName?: string;
    localTerminalId?: string;
    registerNumber?: string;
    storeId?: string;
  };
  appSessionRecovery?: PosTerminalRuntimeAppSessionRecoveryDiagnostics;
  authority: {
    drawer?: {
      cloudRegisterSessionId?: string;
      localRegisterSessionId: string;
      reason?: string;
      registerNumber?: string;
      status: PosDrawerAuthorityState["status"];
    };
    terminal?: {
      reason?: string;
      registerNumber?: string;
      status: PosTerminalIntegrityState["status"];
    };
  };
  timestamps: {
    availabilitySnapshotRefreshedAt?: number;
    catalogSnapshotRefreshedAt?: number;
    oldestPendingEventAt?: number;
    registerReadModelRefreshedAt?: number;
    serviceCatalogSnapshotRefreshedAt?: number;
  };
};

export type PosTerminalRuntimeDiagnosticsEvent = {
  createdAt: number;
  localEventId: string;
  localPosSessionId?: string;
  localRegisterSessionId?: string;
  localTransactionId?: string;
  sequence: number;
  staffProfileId?: string;
  status: PosLocalEventRecord["sync"]["status"];
  type: PosLocalEventRecord["type"];
  uploaded?: boolean;
  uploadSequence?: number;
};

type PosTerminalRuntimeSyncMetrics = {
  failedEventCount: number;
  lastLocalSequence: number;
  lastSyncedSequence: number;
  localOnlyEventCount: number;
  nextPendingSequence: number | null;
  nextPendingUploadSequence?: number;
  oldestPendingEventAt?: number;
  oldestPendingUploadSequence?: number;
  pendingEventCount: number;
  reviewEventCount: number;
  status: PosTerminalRuntimeStatusSyncStatus;
  uploadableEventCount: number;
};

const appUpdateStatuses = new Set<PosTerminalRuntimeAppUpdateStatus>([
  "current",
  "checking",
  "update_ready",
  "update_ready_unstaged",
  "blocked",
  "applying",
  "detector_failed",
  "unknown",
]);

const appUpdateStagingStatuses = new Set<
  PosTerminalRuntimeAppUpdateStagingStatus | undefined
>(["staged", "unstaged", "unknown", undefined]);

const appUpdateStagingReasons = new Set<
  PosTerminalRuntimeAppUpdateStagingReason | undefined
>([
  "asset-staging-failed",
  "no-entry-html",
  "no-static-assets",
  "cache-storage-unavailable",
  "service-worker-unavailable",
  "service-worker-timeout",
  "service-worker-error",
  "unknown",
  undefined,
]);

const appUpdateDetectorStatuses =
  new Set<PosTerminalRuntimeAppUpdateDetectorStatus>([
    "ok",
    "failed",
    "unknown",
  ]);

const appUpdateBlockerCodes = new Set<
  PosTerminalRuntimeAppUpdateBlockerCode | undefined
>(["active_sale", "active_command", "resume_required", "unknown", undefined]);

export function buildPosTerminalRuntimeStatus(
  input: PosTerminalRuntimeStatusInput,
): PosTerminalRuntimeStatusPayload {
  const now = input.clock?.() ?? Date.now();
  const sync = buildSyncMetrics(input);
  const failureMessage = toSafeFailureMessage(input.localStoreFailureMessage);
  const lastFailureMessage = toSafeFailureMessage(input.syncDebug?.lastFailure);
  const staffAuthorityStatus = normalizeStaffAuthorityStatus(
    input.staffAuthorityStatus,
  );
  const appSessionRecovery = toSafeAppSessionRecoveryDiagnostics(
    input.appSessionRecovery,
  );
  const appUpdate = toSafeAppUpdateDiagnostics(input.appUpdate, now);

  return {
    ...(input.appVersion ? { appVersion: input.appVersion } : {}),
    ...(input.buildSha ? { buildSha: input.buildSha } : {}),
    ...(input.browserInfo ? { browserInfo: input.browserInfo } : {}),
    ...(appSessionRecovery ? { appSessionRecovery } : {}),
    ...(appUpdate ? { appUpdate } : {}),
    ...(input.appShell
      ? {
          appShell: {
            observedAt: now,
            ready: input.appShell.ready,
          },
        }
      : {}),
    ...(input.activeRegisterSession
      ? {
          activeRegisterSession: {
            ...(input.activeRegisterSession.cloudRegisterSessionId
              ? {
                  cloudRegisterSessionId:
                    input.activeRegisterSession.cloudRegisterSessionId,
                }
              : {}),
            localRegisterSessionId:
              input.activeRegisterSession.localRegisterSessionId,
            observedAt: now,
            ...(input.activeRegisterSession.openedAt
              ? { openedAt: input.activeRegisterSession.openedAt }
              : {}),
            ...(input.activeRegisterSession.registerNumber
              ? { registerNumber: input.activeRegisterSession.registerNumber }
              : {}),
            status: input.activeRegisterSession.status,
          },
        }
      : {}),
    localStore: {
      available: !failureMessage,
      schemaVersion:
        input.terminalSeed?.schemaVersion ?? POS_LOCAL_STORE_SCHEMA_VERSION,
      terminalSeedReady: Boolean(input.terminalSeed),
      ...(failureMessage ? { failureMessage } : {}),
    },
    reportedAt: now,
    snapshots: snapshotAges(input.snapshots, now),
    source: input.source,
    staffAuthority: {
      ...(input.staffAuthorityExpiresAt
        ? { expiresAt: input.staffAuthorityExpiresAt }
        : {}),
      ...(input.staffProfileId
        ? { staffProfileId: input.staffProfileId as Id<"staffProfile"> }
        : {}),
      status: staffAuthorityStatus,
    },
    ...(isSaleAuthorityReady({
      failureMessage,
      staffAuthorityStatus,
      terminalSeed: input.terminalSeed,
    })
      ? {
          saleAuthority: {
            observedAt: now,
            ...(input.staffProfileId
              ? { staffProfileId: input.staffProfileId as Id<"staffProfile"> }
              : {}),
            status: "ready" as const,
            transactionMode: "products_and_services" as const,
          },
        }
      : {}),
    sync: {
      failedEventCount: sync.failedEventCount,
      localOnlyEventCount: sync.localOnlyEventCount,
      pendingEventCount: sync.pendingEventCount,
      reviewEventCount: sync.reviewEventCount,
      reviewEvents:
        input.syncDebug?.reviewEvents ?? getReviewDiagnosticsEvents(input.events),
      status: sync.status,
      uploadableEventCount: sync.uploadableEventCount,
      lastSyncedSequence: sync.lastSyncedSequence,
      ...(lastFailureMessage ? { lastFailureMessage } : {}),
      ...(input.syncDebug?.lastTrigger
        ? { lastTrigger: input.syncDebug.lastTrigger }
        : {}),
      ...(sync.nextPendingUploadSequence !== undefined
        ? { nextPendingUploadSequence: sync.nextPendingUploadSequence }
        : {}),
      ...(sync.oldestPendingEventAt !== undefined
        ? { oldestPendingEventAt: sync.oldestPendingEventAt }
        : {}),
    },
    ...(input.terminalIntegrity && input.terminalIntegrity.status !== "healthy"
      ? {
          terminalIntegrity: {
            observedAt: input.terminalIntegrity.observedAt,
            ...(input.terminalIntegrity.reason
              ? { reason: input.terminalIntegrity.reason }
              : {}),
            status: input.terminalIntegrity.status,
          },
        }
      : {}),
    ...(input.drawerAuthority && input.drawerAuthority.status === "blocked"
      ? {
          drawerAuthority: {
            localRegisterSessionId:
              input.drawerAuthority.localRegisterSessionId,
            observedAt: input.drawerAuthority.observedAt,
            ...(input.drawerAuthority.cloudRegisterSessionId
              ? {
                  cloudRegisterSessionId:
                    input.drawerAuthority.cloudRegisterSessionId,
                }
              : {}),
            ...(input.drawerAuthority.reason
              ? { reason: input.drawerAuthority.reason }
              : {}),
            status: input.drawerAuthority.status,
          },
        }
      : {}),
  };
}

function isSaleAuthorityReady(input: {
  failureMessage?: string;
  staffAuthorityStatus: PosTerminalRuntimeStaffAuthorityStatus;
  terminalSeed?: PosProvisionedTerminalSeed | null;
}) {
  return Boolean(
    !input.failureMessage &&
      input.terminalSeed &&
      input.staffAuthorityStatus === "ready",
  );
}

export function buildPosTerminalRuntimeCopyDiagnostics(
  input: PosTerminalRuntimeStatusInput,
): PosTerminalRuntimeCopyDiagnostics {
  const now = input.clock?.() ?? Date.now();
  const sync = buildSyncMetrics(input);
  const validation = buildValidationMetadataMetrics(input.events);
  const localStoreFailure = toSafeFailureMessage(
    input.localStoreFailureMessage,
  );
  const syncFailure = toSafeFailureMessage(input.syncDebug?.lastFailure);
  const staffAuthorityStatus = normalizeStaffAuthorityStatus(
    input.staffAuthorityStatus,
  );
  const appSessionRecovery = toSafeAppSessionRecoveryDiagnostics(
    input.appSessionRecovery,
  );

  return {
    ...(appSessionRecovery ? { appSessionRecovery } : {}),
    counts: {
      appSessionUnverifiedEventCount: validation.appSessionUnverifiedEventCount,
      cloudValidationUncertainEventCount:
        validation.cloudValidationUncertainEventCount,
      deferredUploadEventCount: validation.deferredUploadEventCount,
      failedEventCount: sync.failedEventCount,
      localOnlyEventCount: sync.localOnlyEventCount,
      pendingEventCount: sync.pendingEventCount,
      reviewEventCount: sync.reviewEventCount,
      totalEventCount: input.events.length,
      uploadableEventCount: sync.uploadableEventCount,
    },
    events: input.events
      .slice()
      .sort((left, right) => left.sequence - right.sequence)
      .slice(-20)
      .map(toDiagnosticsEvent),
    failures: {
      ...(localStoreFailure ? { localStore: localStoreFailure } : {}),
      ...(syncFailure ? { sync: syncFailure } : {}),
    },
    labels: {
      ...(appSessionRecovery
        ? { appSessionRecovery: appSessionRecovery.status }
        : {}),
      drawerAuthority: input.drawerAuthority
        ? input.drawerAuthority.status
        : "unknown",
      localStore: localStoreFailure ? "unavailable" : "available",
      staffAuthority: staffAuthorityStatus,
      sync: sync.status,
      terminalIntegrity: getTerminalIntegrityLabel(input.terminalIntegrity),
    },
    reportedAt: now,
    sequences: {
      lastLocalSequence: sync.lastLocalSequence,
      lastSyncedSequence: sync.lastSyncedSequence,
      nextPendingSequence: sync.nextPendingSequence,
      nextPendingUploadSequence: sync.nextPendingUploadSequence,
      oldestPendingUploadSequence: sync.oldestPendingUploadSequence,
    },
    source: input.source,
    terminal: {
      ...(input.terminalSeed?.cloudTerminalId
        ? { cloudTerminalId: input.terminalSeed.cloudTerminalId }
        : {}),
      ...(input.terminalSeed?.displayName
        ? { displayName: input.terminalSeed.displayName }
        : {}),
      ...(input.terminalSeed?.terminalId
        ? { localTerminalId: input.terminalSeed.terminalId }
        : {}),
      ...(input.terminalSeed?.registerNumber
        ? { registerNumber: input.terminalSeed.registerNumber }
        : {}),
      ...(input.terminalSeed?.storeId
        ? { storeId: input.terminalSeed.storeId }
        : {}),
    },
    authority: {
      ...(input.drawerAuthority
        ? {
            drawer: {
              ...(input.drawerAuthority.cloudRegisterSessionId
                ? {
                    cloudRegisterSessionId:
                      input.drawerAuthority.cloudRegisterSessionId,
                  }
                : {}),
              localRegisterSessionId:
                input.drawerAuthority.localRegisterSessionId,
              ...(input.drawerAuthority.reason
                ? { reason: input.drawerAuthority.reason }
                : {}),
              ...(input.drawerAuthority.registerNumber
                ? { registerNumber: input.drawerAuthority.registerNumber }
                : {}),
              status: input.drawerAuthority.status,
            },
          }
        : {}),
      ...(input.terminalIntegrity
        ? {
            terminal: {
              ...(input.terminalIntegrity.reason
                ? { reason: input.terminalIntegrity.reason }
                : {}),
              ...(input.terminalIntegrity.registerNumber
                ? { registerNumber: input.terminalIntegrity.registerNumber }
                : {}),
              status: input.terminalIntegrity.status,
            },
          }
        : {}),
    },
    timestamps: {
      ...(input.snapshots?.availabilityRefreshedAt
        ? {
            availabilitySnapshotRefreshedAt:
              input.snapshots.availabilityRefreshedAt,
          }
        : {}),
      ...(input.snapshots?.catalogRefreshedAt
        ? { catalogSnapshotRefreshedAt: input.snapshots.catalogRefreshedAt }
        : {}),
      ...(input.snapshots?.serviceCatalogRefreshedAt
        ? {
            serviceCatalogSnapshotRefreshedAt:
              input.snapshots.serviceCatalogRefreshedAt,
          }
        : {}),
      ...(sync.oldestPendingEventAt
        ? { oldestPendingEventAt: sync.oldestPendingEventAt }
        : {}),
      ...(input.snapshots?.registerReadModelRefreshedAt
        ? {
            registerReadModelRefreshedAt:
              input.snapshots.registerReadModelRefreshedAt,
          }
        : {}),
    },
  };
}

function buildValidationMetadataMetrics(events: PosLocalEventRecord[]) {
  return {
    appSessionUnverifiedEventCount: events.filter((event) =>
      event.validationMetadata?.flags.includes("app-session-unverified"),
    ).length,
    cloudValidationUncertainEventCount: events.filter((event) =>
      event.validationMetadata?.flags.includes("cloud-validation-uncertain"),
    ).length,
    deferredUploadEventCount: events.filter((event) =>
      isUploadDeferredByValidation(event),
    ).length,
  };
}

export function toReportablePosTerminalRuntimeStatus(
  status: PosTerminalRuntimeStatusPayload,
): ReportTerminalRuntimeStatusPayload {
  return status;
}

function buildSyncMetrics(
  input: PosTerminalRuntimeStatusInput,
): PosTerminalRuntimeSyncMetrics {
  const uploadableEvents = input.events.filter(
    (event) => event.sync.status !== "synced" && isSyncablePosLocalEvent(event),
  );
  const localOnlyEvents = input.events.filter(
    (event) =>
      event.sync.status !== "synced" && !isSyncablePosLocalEvent(event),
  );
  const failedEventCount =
    input.syncDebug?.failedEventCount ??
    input.events.filter((event) => event.sync.status === "failed").length;
  const statusEvents = input.events.filter(
    (event) => !isNonBlockingRegisterLifecycleReviewEvent(event),
  );
  const reviewEventCount =
    input.syncDebug?.reviewEventCount ??
    input.events.filter((event) => event.sync.status === "needs_review").length;
  const actionableReviewEventCount = statusEvents.filter(
    (event) => event.sync.status === "needs_review",
  ).length;
  const localOnlyEventCount =
    input.syncDebug?.localOnlyEventCount ?? localOnlyEvents.length;
  const uploadableEventCount =
    input.syncDebug?.pendingUploadEventCount ?? uploadableEvents.length;
  const status = derivePosLocalSyncStatus({
    events: statusEvents,
    isOnline: input.browserInfo?.online ?? true,
  });
  const oldestPendingEvent = input.events
    .filter((event) => event.sync.status !== "synced")
    .sort((left, right) => left.createdAt - right.createdAt)
    .at(0);
  const nextUploadableEvent = uploadableEvents
    .slice()
    .sort(compareUploadableEventOrder)
    .at(0);

  return {
    failedEventCount,
    lastLocalSequence: status.lastLocalSequence,
    lastSyncedSequence: status.lastSyncedSequence,
    localOnlyEventCount,
    nextPendingSequence: status.nextPendingSequence,
    nextPendingUploadSequence:
      input.syncDebug?.nextPendingUploadSequence ??
      nextUploadableEvent?.uploadSequence,
    oldestPendingEventAt:
      input.syncDebug?.oldestPendingEventAt ?? oldestPendingEvent?.createdAt,
    oldestPendingUploadSequence: oldestPendingEvent?.uploadSequence,
    pendingEventCount: status.pendingCount + status.failedCount,
    reviewEventCount,
    status: input.syncDebug?.schedulerRunning
      ? "syncing"
      : mapSyncStatus(status.state, {
          failedEventCount,
          hasEvents: statusEvents.length > 0,
          localStoreFailureMessage: input.localStoreFailureMessage,
          reviewEventCount: actionableReviewEventCount,
        }),
    uploadableEventCount,
  };
}

function mapSyncStatus(
  state: ReturnType<typeof derivePosLocalSyncStatus>["state"],
  context: {
    failedEventCount: number;
    hasEvents: boolean;
    localStoreFailureMessage?: string | null;
    reviewEventCount: number;
  },
): PosTerminalRuntimeStatusSyncStatus {
  if (context.localStoreFailureMessage && !context.hasEvents) {
    return "unavailable";
  }
  if (context.failedEventCount > 0 || state === "failed") return "failed";
  if (context.reviewEventCount > 0 || state === "needs_review") {
    return "needs_review";
  }
  if (state === "synced") return "idle";
  if (state === "pending" || state === "offline") return "pending";
  return "unknown";
}

function normalizeStaffAuthorityStatus(
  status?: PosLocalStaffAuthorityReadiness | "unknown",
): PosTerminalRuntimeStaffAuthorityStatus {
  if (status === "ready" || status === "missing" || status === "expired") {
    return status;
  }
  return "unknown";
}

function getTerminalIntegrityLabel(
  state?: PosTerminalIntegrityState | null,
): "blocked" | "healthy" | "repairing" | "unknown" {
  if (!state) return "unknown";
  if (state.status === "healthy") return "healthy";
  if (state.status === "repairing") return "repairing";
  return "blocked";
}

function toSafeAppSessionRecoveryDiagnostics(
  recovery?: PosTerminalRuntimeAppSessionRecoveryInput | null,
): PosTerminalRuntimeAppSessionRecoveryDiagnostics | undefined {
  if (!recovery) return undefined;

  return { status: toSafeAppSessionRecoveryLabel(recovery) };
}

function toSafeAppSessionRecoveryLabel(
  recovery: PosTerminalRuntimeAppSessionRecoveryInput,
): PosTerminalRuntimeAppSessionRecoveryLabel {
  if (recovery.status === "idle" || recovery.status === "recoverable") {
    return "ready";
  }
  if (recovery.status === "validating") return "recovering";
  if (recovery.status === "retrying") return "retrying";
  if (recovery.status === "waiting_for_network") {
    return "waiting_for_network";
  }

  if (recovery.reason === "retry_exhausted") return "retry_exhausted";
  if (recovery.reason === "stale_assertion") return "stale_assertion";
  if (recovery.reason === "store_mismatch") return "blocked_store_mismatch";
  if (
    recovery.reason === "app_account_disabled" ||
    recovery.reason === "app_account_not_pos_scoped"
  ) {
    return "blocked_app_account";
  }

  return "blocked_terminal";
}

function toSafeAppUpdateDiagnostics(
  appUpdate: PosTerminalRuntimeAppUpdateInput | null | undefined,
  observedAt: number,
): PosTerminalRuntimeAppUpdateDiagnostics | undefined {
  if (!appUpdate) return undefined;

  return omitUndefined({
    canApply: appUpdate.canApply === true,
    blockerSummary: appUpdateBlockerCodes.has(appUpdate.selectedBlockerCode)
      ? appUpdate.selectedBlockerCode
      : undefined,
    commandExecutionId: toSafeRuntimeString(
      appUpdate.commandExecutionId ?? appUpdate.command?.executionId,
      120,
    ),
    commandId: toSafeRuntimeString(appUpdate.commandId, 120),
    commandIssuedAt:
      positiveRuntimeTimestamp(appUpdate.commandIssuedAt) ??
      positiveRuntimeTimestamp(appUpdate.command?.issuedAt),
    commandNonce: toSafeRuntimeString(
      appUpdate.commandNonce ?? appUpdate.command?.nonce,
      120,
    ),
    currentBuildId: toSafeBuildId(appUpdate.currentBuildId),
    detectorStatus: appUpdateDetectorStatuses.has(appUpdate.detectorStatus)
      ? appUpdate.detectorStatus
      : "unknown",
    observedAt,
    pendingBuildId: toSafeBuildId(appUpdate.pendingBuildId),
    selectedBlockerCode: appUpdateBlockerCodes.has(
      appUpdate.selectedBlockerCode,
    )
      ? appUpdate.selectedBlockerCode
      : undefined,
    stagingStatus: appUpdateStagingStatuses.has(appUpdate.stagingStatus)
      ? appUpdate.stagingStatus
      : undefined,
    stagingReason: appUpdateStagingReasons.has(appUpdate.stagingReason)
      ? appUpdate.stagingReason
      : undefined,
    stagingAssetCount: positiveRuntimeCount(appUpdate.stagingAssetCount),
    stagingFailedAssetCount: positiveRuntimeCount(
      appUpdate.stagingFailedAssetCount,
    ),
    stagingRejectedAssetCount: positiveRuntimeCount(
      appUpdate.stagingRejectedAssetCount,
    ),
    status: appUpdateStatuses.has(appUpdate.status)
      ? appUpdate.status
      : "unknown",
  });
}

function positiveRuntimeTimestamp(value: number | undefined) {
  return Number.isFinite(value) && value !== undefined && value > 0
    ? value
    : undefined;
}

function positiveRuntimeCount(value: number | undefined) {
  return Number.isFinite(value) && value !== undefined && value >= 0
    ? Math.floor(value)
    : undefined;
}

function toSafeBuildId(value: string | undefined) {
  return toSafeRuntimeString(value, 120);
}

function toSafeRuntimeString(value: string | undefined, maxLength: number) {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, maxLength);
}

function snapshotAges(
  snapshots: PosTerminalRuntimeSnapshotReadiness | undefined,
  now: number,
): PosTerminalRuntimeStatusPayload["snapshots"] {
  return {
    ...(snapshots?.availabilityRefreshedAt
      ? {
          availabilityAgeMs: Math.max(
            0,
            now - snapshots.availabilityRefreshedAt,
          ),
        }
      : {}),
    ...(snapshots?.catalogRefreshedAt
      ? { catalogAgeMs: Math.max(0, now - snapshots.catalogRefreshedAt) }
      : {}),
    ...(snapshots?.serviceCatalogRefreshedAt
      ? {
          serviceCatalogAgeMs: Math.max(
            0,
            now - snapshots.serviceCatalogRefreshedAt,
          ),
        }
      : {}),
    ...(snapshots?.registerReadModelRefreshedAt
      ? {
          registerReadModelAgeMs: Math.max(
            0,
            now - snapshots.registerReadModelRefreshedAt,
          ),
        }
      : {}),
  };
}

function toDiagnosticsEvent(
  event: PosLocalEventRecord,
): PosTerminalRuntimeDiagnosticsEvent {
  return {
    createdAt: event.createdAt,
    localEventId: event.localEventId,
    ...(event.localPosSessionId
      ? { localPosSessionId: event.localPosSessionId }
      : {}),
    ...(event.localRegisterSessionId
      ? { localRegisterSessionId: event.localRegisterSessionId }
      : {}),
    ...(event.localTransactionId
      ? { localTransactionId: event.localTransactionId }
      : {}),
    sequence: event.sequence,
    ...(event.staffProfileId ? { staffProfileId: event.staffProfileId } : {}),
    status: event.sync.status,
    type: event.type,
    ...(event.sync.uploaded !== undefined
      ? { uploaded: event.sync.uploaded }
      : {}),
    ...(typeof event.uploadSequence === "number"
      ? { uploadSequence: event.uploadSequence }
      : {}),
  };
}

function getReviewDiagnosticsEvents(
  events: PosLocalEventRecord[],
): PosTerminalRuntimeDiagnosticsEvent[] {
  return events
    .filter((event) => event.sync.status === "needs_review")
    .slice()
    .sort(compareUploadableEventOrder)
    .slice(0, 10)
    .map(toDiagnosticsEvent);
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

function toSafeFailureMessage(message?: string | null) {
  if (!message) return undefined;

  const collapsed = message.replace(/\s+/g, " ").trim();
  if (!collapsed) return undefined;

  return collapsed
    .replace(
      /\b(staffProofToken|syncSecretHash|syncSecret|staff proof|sync secret|verifier|credential|credentials|token|PIN|pin|rawPayload|raw payload|payload)\b(?:\s+[^.,;]*)?/gi,
      (match) => `${match.split(/\s+/)[0]} [redacted]`,
    )
    .replace(/[A-Za-z0-9_-]{24,}/g, "[redacted]")
    .slice(0, 240);
}

function omitUndefined<T extends Record<string, unknown>>(input: T) {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  ) as {
    [Key in keyof T as undefined extends T[Key] ? Key : Key]: Exclude<
      T[Key],
      undefined
    >;
  };
}
