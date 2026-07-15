import type { PosLocalEventRecord } from "@/lib/pos/application/posLocalStoreTypes";

export type PosLocalDerivedSyncState =
  | "synced"
  | "pending"
  | "offline"
  | "needs_review"
  | "failed";

export interface PosLocalSyncStatus {
  state: PosLocalDerivedSyncState;
  pendingCount: number;
  failedCount: number;
  lastLocalSequence: number;
  lastSyncedSequence: number;
  nextPendingSequence: number | null;
}

export type PosLocalServerSettlementOutcome =
  | "projected"
  | "conflicted"
  | "held"
  | "rejected";

export type PosLocalSettlementState = Pick<
  PosLocalSyncStatus,
  "state"
> & {
  label: string;
  settlesLocalPrecursors: boolean;
};

export function mapServerSettlementOutcomeToLocalState(
  outcome: PosLocalServerSettlementOutcome,
): PosLocalSettlementState {
  if (outcome === "projected") {
    return {
      state: "synced",
      label: "Synced",
      settlesLocalPrecursors: true,
    };
  }

  if (outcome === "conflicted") {
    return {
      state: "needs_review",
      label: "Needs manager review",
      settlesLocalPrecursors: false,
    };
  }

  if (outcome === "held") {
    return {
      state: "pending",
      label: "Waiting for earlier POS history",
      settlesLocalPrecursors: false,
    };
  }

  return {
    state: "needs_review",
    label: "Sync rejected; review required",
    settlesLocalPrecursors: false,
  };
}

export function derivePosLocalSyncStatus(input: {
  events: PosLocalEventRecord[];
  lastSyncedSequence?: number;
  isOnline: boolean;
}): PosLocalSyncStatus {
  const orderedEvents = [...input.events].sort(
    (left, right) => left.sequence - right.sequence,
  );
  const uploadBlockingEvents = orderedEvents.filter(
    (event) =>
      typeof event.uploadSequence === "number" &&
      !isServerConvergedSyncEvent(event),
  );
  const pendingCount = uploadBlockingEvents.filter((event) =>
    event.sync.status === "pending" || event.sync.status === "syncing",
  ).length;
  const needsReviewCount = uploadBlockingEvents.filter(
    (event) =>
      event.sync.status === "needs_review" ||
      // A locally-cleared review that the server has not yet confirmed is not
      // silently settled — it must still read as needing attention so the
      // terminal never shows "synced" while a server conflict stays open.
      (event.sync.status === "locally_resolved" &&
        !isServerConfirmedLocalResolution(event)),
  ).length;
  const failedCount = uploadBlockingEvents.filter(
    (event) => event.sync.status === "failed",
  ).length;
  const lastLocalSequence = orderedEvents.at(-1)?.sequence ?? 0;
  const lastSyncedSequence =
    input.lastSyncedSequence ?? getContiguousSyncedSequence(orderedEvents);
  const nextPendingSequence = uploadBlockingEvents[0]?.sequence ?? null;

  return {
    state: getSyncState({
      hasUnsyncedEvents: uploadBlockingEvents.length > 0,
      failedCount,
      isOnline: input.isOnline,
      needsReviewCount,
    }),
    pendingCount,
    failedCount,
    lastLocalSequence,
    lastSyncedSequence,
    nextPendingSequence,
  };
}

function getContiguousSyncedSequence(events: PosLocalEventRecord[]) {
  let lastSyncedSequence = 0;
  for (const event of events) {
    if (typeof event.uploadSequence !== "number") {
      lastSyncedSequence = event.sequence;
      continue;
    }
    if (!isServerConvergedSyncEvent(event)) break;
    lastSyncedSequence = event.sequence;
  }
  return lastSyncedSequence;
}

export function isLocallySettledSyncStatus(
  status: PosLocalEventRecord["sync"]["status"],
) {
  return status === "synced" || status === "locally_resolved";
}

/**
 * Whether a locally-cleared review has been acknowledged as resolved by the
 * server. Until then, terminal and server have not converged, so the event is
 * not treated as fully settled by the chip-facing status derivation.
 */
export function isServerConfirmedLocalResolution(
  event: PosLocalEventRecord,
): boolean {
  return typeof event.sync.localResolution?.serverConfirmedAt === "number";
}

/**
 * Settlement for the sync-status surface: a `synced` event, or a
 * `locally_resolved` event the server has already confirmed. An unconfirmed
 * local resolution is deliberately excluded so an outstanding review renders
 * truthfully instead of masquerading as "synced".
 */
export function isServerConvergedSyncEvent(event: PosLocalEventRecord): boolean {
  if (event.sync.status === "synced") return true;
  if (event.sync.status === "locally_resolved") {
    return isServerConfirmedLocalResolution(event);
  }
  return false;
}

function getSyncState(input: {
  hasUnsyncedEvents: boolean;
  failedCount: number;
  isOnline: boolean;
  needsReviewCount: number;
}): PosLocalDerivedSyncState {
  if (input.failedCount > 0) return "failed";
  if (input.needsReviewCount > 0) return "needs_review";
  if (!input.hasUnsyncedEvents) return "synced";
  if (!input.isOnline) return "offline";
  return "pending";
}
