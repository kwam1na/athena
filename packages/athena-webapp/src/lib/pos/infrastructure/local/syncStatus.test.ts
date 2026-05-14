import { describe, expect, it } from "vitest";

import { derivePosLocalSyncStatus } from "./syncStatus";
import type { PosLocalEventRecord } from "./posLocalStore";

function event(
  sequence: number,
  status: PosLocalEventRecord["sync"]["status"],
): PosLocalEventRecord {
  return {
    localEventId: `local-event-${sequence}`,
    schemaVersion: 1,
    sequence,
    type: "cart.item_added",
    terminalId: "local-terminal-1",
    storeId: "store_cloud_1",
    localRegisterSessionId: "local-register-session-1",
    localPosSessionId: "local-pos-session-1",
    staffProfileId: "staff_cloud_1",
    payload: {},
    createdAt: sequence,
    sync: { status },
  };
}

describe("derivePosLocalSyncStatus", () => {
  it("reports synced when there are no pending or failed local events", () => {
    expect(
      derivePosLocalSyncStatus({
        events: [event(1, "synced"), event(2, "synced")],
        lastSyncedSequence: 2,
        isOnline: true,
      }),
    ).toEqual({
      state: "synced",
      pendingCount: 0,
      failedCount: 0,
      lastLocalSequence: 2,
      lastSyncedSequence: 2,
      nextPendingSequence: null,
    });
  });

  it("reports pending local work and the next pending sequence", () => {
    expect(
      derivePosLocalSyncStatus({
        events: [event(1, "synced"), event(2, "pending"), event(3, "pending")],
        lastSyncedSequence: 1,
        isOnline: true,
      }),
    ).toMatchObject({
      state: "pending",
      pendingCount: 2,
      failedCount: 0,
      lastLocalSequence: 3,
      lastSyncedSequence: 1,
      nextPendingSequence: 2,
    });
  });

  it("prioritizes failed status over pending status", () => {
    expect(
      derivePosLocalSyncStatus({
        events: [event(1, "failed"), event(2, "pending")],
        lastSyncedSequence: 0,
        isOnline: true,
      }),
    ).toMatchObject({
      state: "failed",
      pendingCount: 1,
      failedCount: 1,
      nextPendingSequence: 1,
    });
  });

  it("reports server-acknowledged conflict events as needing review", () => {
    expect(
      derivePosLocalSyncStatus({
        events: [event(1, "needs_review"), event(2, "synced")],
        lastSyncedSequence: 0,
        isOnline: true,
      }),
    ).toMatchObject({
      state: "needs_review",
      pendingCount: 0,
      failedCount: 0,
      lastSyncedSequence: 0,
      nextPendingSequence: 1,
    });
  });

  it("reports synced-through progress only up to the first review gap", () => {
    expect(
      derivePosLocalSyncStatus({
        events: [event(1, "synced"), event(2, "needs_review"), event(3, "synced")],
        isOnline: true,
      }),
    ).toMatchObject({
      state: "needs_review",
      lastSyncedSequence: 1,
      nextPendingSequence: 2,
    });
  });

  it("marks unsynced work as offline when the browser is offline", () => {
    expect(
      derivePosLocalSyncStatus({
        events: [event(1, "pending")],
        lastSyncedSequence: 0,
        isOnline: false,
      }),
    ).toMatchObject({
      state: "offline",
      pendingCount: 1,
      failedCount: 0,
      nextPendingSequence: 1,
    });
  });
});
