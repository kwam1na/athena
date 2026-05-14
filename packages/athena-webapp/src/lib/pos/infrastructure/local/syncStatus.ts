import type { PosLocalEventRecord } from "./posLocalStore";

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

export function derivePosLocalSyncStatus(input: {
  events: PosLocalEventRecord[];
  lastSyncedSequence?: number;
  isOnline: boolean;
}): PosLocalSyncStatus {
  const orderedEvents = [...input.events].sort(
    (left, right) => left.sequence - right.sequence,
  );
  const unsyncedEvents = orderedEvents.filter(
    (event) => event.sync.status !== "synced",
  );
  const pendingCount = orderedEvents.filter((event) =>
    event.sync.status === "pending" || event.sync.status === "syncing",
  ).length;
  const needsReviewCount = orderedEvents.filter(
    (event) => event.sync.status === "needs_review",
  ).length;
  const failedCount = orderedEvents.filter(
    (event) => event.sync.status === "failed",
  ).length;
  const lastLocalSequence = orderedEvents.at(-1)?.sequence ?? 0;
  const lastSyncedSequence =
    input.lastSyncedSequence ?? getContiguousSyncedSequence(orderedEvents);
  const nextPendingSequence = unsyncedEvents[0]?.sequence ?? null;

  return {
    state: getSyncState({
      hasUnsyncedEvents: unsyncedEvents.length > 0,
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
    if (event.sync.status !== "synced") break;
    lastSyncedSequence = event.sequence;
  }
  return lastSyncedSequence;
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
