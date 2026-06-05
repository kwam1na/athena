import type { FunctionArgs } from "convex/server";

import { api } from "~/convex/_generated/api";
import type { Id } from "~/convex/_generated/dataModel";

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

export type PosTerminalRuntimeStatusInput = {
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

  return {
    ...(input.appVersion ? { appVersion: input.appVersion } : {}),
    ...(input.buildSha ? { buildSha: input.buildSha } : {}),
    ...(input.browserInfo ? { browserInfo: input.browserInfo } : {}),
    ...(appSessionRecovery ? { appSessionRecovery } : {}),
    localStore: {
      available: !failureMessage,
      schemaVersion: input.terminalSeed?.schemaVersion ?? POS_LOCAL_STORE_SCHEMA_VERSION,
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
    sync: {
      failedEventCount: sync.failedEventCount,
      localOnlyEventCount: sync.localOnlyEventCount,
      pendingEventCount: sync.pendingEventCount,
      reviewEventCount: sync.reviewEventCount,
      reviewEvents: getReviewDiagnosticsEvents(input.events),
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
    ...(input.terminalIntegrity &&
    input.terminalIntegrity.status !== "healthy"
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

export function buildPosTerminalRuntimeCopyDiagnostics(
  input: PosTerminalRuntimeStatusInput,
): PosTerminalRuntimeCopyDiagnostics {
  const now = input.clock?.() ?? Date.now();
  const sync = buildSyncMetrics(input);
  const validation = buildValidationMetadataMetrics(input.events);
  const localStoreFailure = toSafeFailureMessage(input.localStoreFailureMessage);
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
      appSessionUnverifiedEventCount:
        validation.appSessionUnverifiedEventCount,
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
      ...(input.terminalSeed?.storeId ? { storeId: input.terminalSeed.storeId } : {}),
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
        ? { availabilitySnapshotRefreshedAt: input.snapshots.availabilityRefreshedAt }
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
        ? { registerReadModelRefreshedAt: input.snapshots.registerReadModelRefreshedAt }
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
    (event) => event.sync.status !== "synced" && !isSyncablePosLocalEvent(event),
  );
  const failedEventCount =
    input.syncDebug?.failedEventCount ??
    input.events.filter((event) => event.sync.status === "failed").length;
  const reviewEventCount =
    input.syncDebug?.reviewEventCount ??
    input.events.filter((event) => event.sync.status === "needs_review").length;
  const localOnlyEventCount =
    input.syncDebug?.localOnlyEventCount ?? localOnlyEvents.length;
  const uploadableEventCount =
    input.syncDebug?.pendingUploadEventCount ?? uploadableEvents.length;
  const status = derivePosLocalSyncStatus({
    events: input.events,
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
          hasEvents: input.events.length > 0,
          localStoreFailureMessage: input.localStoreFailureMessage,
          reviewEventCount,
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

function snapshotAges(
  snapshots: PosTerminalRuntimeSnapshotReadiness | undefined,
  now: number,
): PosTerminalRuntimeStatusPayload["snapshots"] {
  return {
    ...(snapshots?.availabilityRefreshedAt
      ? { availabilityAgeMs: Math.max(0, now - snapshots.availabilityRefreshedAt) }
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
    ...(event.sync.uploaded !== undefined ? { uploaded: event.sync.uploaded } : {}),
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
      /\b(staffProofToken|syncSecretHash|syncSecret|staff proof|sync secret|verifier|credential|credentials|token)\b(?:\s+[^.,;]*)?/gi,
      (match) => `${match.split(/\s+/)[0]} [redacted]`,
    )
    .replace(/[A-Za-z0-9_-]{24,}/g, "[redacted]")
    .slice(0, 240);
}
