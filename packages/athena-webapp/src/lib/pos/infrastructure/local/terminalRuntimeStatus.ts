import type { FunctionArgs } from "convex/server";

import { api } from "~/convex/_generated/api";
import type { Id } from "~/convex/_generated/dataModel";

import {
  POS_LOCAL_STORE_SCHEMA_VERSION,
  type PosLocalEventRecord,
  type PosLocalStaffAuthorityReadiness,
  type PosProvisionedTerminalSeed,
} from "./posLocalStore";
import { derivePosLocalSyncStatus } from "./syncStatus";
import { isSyncablePosLocalEvent } from "./syncContract";
import type { PosLocalSyncTrigger } from "./syncScheduler";

type ReportTerminalRuntimeStatusArgs = FunctionArgs<
  typeof api.pos.public.terminals.reportTerminalRuntimeStatus
>;

export type PosTerminalRuntimeStatusSource =
  ReportTerminalRuntimeStatusArgs["status"]["source"];
export type PosTerminalRuntimeStatusPayload =
  ReportTerminalRuntimeStatusArgs["status"];
export type PosTerminalRuntimeStatusSyncStatus =
  PosTerminalRuntimeStatusPayload["sync"]["status"];
export type PosTerminalRuntimeStaffAuthorityStatus =
  PosTerminalRuntimeStatusPayload["staffAuthority"]["status"];

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
};

export type PosTerminalRuntimeStatusInput = {
  appVersion?: string;
  browserInfo?: PosTerminalRuntimeBrowserInfo;
  buildSha?: string;
  clock?: () => number;
  events: PosLocalEventRecord[];
  localStoreFailureMessage?: string | null;
  snapshots?: PosTerminalRuntimeSnapshotReadiness;
  source: PosTerminalRuntimeStatusSource;
  staffAuthorityExpiresAt?: number;
  staffAuthorityStatus?: PosLocalStaffAuthorityReadiness | "unknown";
  staffProfileId?: string | null;
  syncDebug?: PosTerminalRuntimeSyncDebugInput;
  terminalSeed?: PosProvisionedTerminalSeed | null;
};

export type PosTerminalRuntimeCopyDiagnostics = {
  counts: {
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
    localStore: "available" | "unavailable";
    staffAuthority: PosTerminalRuntimeStaffAuthorityStatus;
    sync: PosTerminalRuntimeStatusSyncStatus;
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
  timestamps: {
    availabilitySnapshotRefreshedAt?: number;
    catalogSnapshotRefreshedAt?: number;
    oldestPendingEventAt?: number;
    registerReadModelRefreshedAt?: number;
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

  return {
    ...(input.appVersion ? { appVersion: input.appVersion } : {}),
    ...(input.buildSha ? { buildSha: input.buildSha } : {}),
    ...(input.browserInfo ? { browserInfo: input.browserInfo } : {}),
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
  };
}

export function buildPosTerminalRuntimeCopyDiagnostics(
  input: PosTerminalRuntimeStatusInput,
): PosTerminalRuntimeCopyDiagnostics {
  const now = input.clock?.() ?? Date.now();
  const sync = buildSyncMetrics(input);
  const localStoreFailure = toSafeFailureMessage(input.localStoreFailureMessage);
  const syncFailure = toSafeFailureMessage(input.syncDebug?.lastFailure);
  const staffAuthorityStatus = normalizeStaffAuthorityStatus(
    input.staffAuthorityStatus,
  );

  return {
    counts: {
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
      localStore: localStoreFailure ? "unavailable" : "available",
      staffAuthority: staffAuthorityStatus,
      sync: sync.status,
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
    timestamps: {
      ...(input.snapshots?.availabilityRefreshedAt
        ? { availabilitySnapshotRefreshedAt: input.snapshots.availabilityRefreshedAt }
        : {}),
      ...(input.snapshots?.catalogRefreshedAt
        ? { catalogSnapshotRefreshedAt: input.snapshots.catalogRefreshedAt }
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
    ...(typeof event.uploadSequence === "number"
      ? { uploadSequence: event.uploadSequence }
      : {}),
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
