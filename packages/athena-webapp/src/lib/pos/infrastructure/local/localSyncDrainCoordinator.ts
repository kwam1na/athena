import {
  isSyncablePosLocalEvent,
  isUploadDeferredByValidation,
  type PosLocalSyncUploadSupport,
} from "./syncContract";
import type { PosLocalSyncTrigger } from "./syncScheduler";
import type { PosLocalEventRecord } from "./posLocalStore";
import type { PosTerminalRuntimeDiagnosticsEvent } from "./terminalRuntimeStatus";

export type PosLocalRuntimeSyncDebugSnapshot = {
  appSessionUnverifiedEventCount?: number;
  cloudValidationUncertainEventCount?: number;
  deferredUploadEventCount?: number;
  failedEventCount?: number;
  localOnlyEventCount?: number;
  mode?: "drain-enabled" | "status-only";
  oldestPendingEventAt?: number;
  oldestPendingEventId?: string;
  oldestPendingEventSequence?: number;
  oldestPendingUploadSequence?: number;
  nextPendingUploadSequence?: number;
  pendingUploadEventCount?: number;
  reviewEvents?: PosTerminalRuntimeDiagnosticsEvent[];
  reviewEventCount?: number;
};

export function startStatusOnlyRuntimeTriggers(refresh: () => void) {
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

export function buildRuntimeSyncDebug(
  events: PosLocalEventRecord[],
  mode: "drain-enabled" | "status-only",
  uploadSupport: PosLocalSyncUploadSupport = {},
): PosLocalRuntimeSyncDebugSnapshot {
  const pendingUploadCandidates = events.filter(isPendingUploadCandidate);
  const pendingUploadableEvents = pendingUploadCandidates.filter((event) =>
    isSyncablePosLocalEvent(event, uploadSupport),
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
    .filter(
      (event) =>
        event.sync.status !== "synced" &&
        event.sync.status !== "locally_resolved",
    )
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
    reviewEvents: getReviewDiagnosticsEvents(reviewEvents),
    reviewEventCount: reviewEvents.length,
  };
}

export function getRuntimeUploadTrigger(input: {
  eventAppendToken: number;
  lastEventAppendToken: number;
  lastManualRetryToken: number;
  manualRetryToken: number;
}): PosLocalSyncTrigger {
  if (input.manualRetryToken !== input.lastManualRetryToken) {
    return "manual-retry";
  }
  if (input.eventAppendToken !== input.lastEventAppendToken) {
    return "event-appended";
  }
  return "route-entry";
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

function getReviewDiagnosticsEvents(
  events: PosLocalEventRecord[],
): PosTerminalRuntimeDiagnosticsEvent[] {
  return events
    .slice()
    .sort(compareUploadableEventOrder)
    .slice(0, 100)
    .map((event) => ({
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
    }));
}

function isPendingUploadCandidate(event: PosLocalEventRecord) {
  return (
    event.sync.status === "pending" ||
    event.sync.status === "syncing" ||
    event.sync.status === "failed" ||
    (event.sync.status === "needs_review" && event.sync.uploaded)
  );
}
