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
  const uploadBlockingEvents = orderedEvents.filter(
    (event) =>
      typeof event.uploadSequence === "number" &&
      event.sync.status !== "synced",
  );
  const pendingCount = uploadBlockingEvents.filter((event) =>
    event.sync.status === "pending" || event.sync.status === "syncing",
  ).length;
  const needsReviewCount = uploadBlockingEvents.filter(
    (event) => event.sync.status === "needs_review",
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
