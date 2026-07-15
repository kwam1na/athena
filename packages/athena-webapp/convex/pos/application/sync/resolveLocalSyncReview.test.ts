import { describe, expect, it } from "vitest";

import { resolveLocalSyncReview } from "./resolveLocalSyncReview";
import type { Id } from "../../../_generated/dataModel";

type ConflictRow = {
  localEventId: string;
  status: "needs_review" | "resolved";
  resolvedAt?: number;
  resolvedByStaffProfileId?: Id<"staffProfile">;
  resolvedByUserId?: Id<"athenaUser">;
};

function createFakeRepository(initial: ConflictRow[]) {
  const conflicts = initial.map((conflict) => ({ ...conflict }));
  return {
    conflicts,
    resolveCalls: [] as string[],
    async resolveConflictsForEvent(args: {
      storeId: Id<"store">;
      terminalId: Id<"posTerminal">;
      localEventId: string;
      resolvedAt: number;
      resolvedByStaffProfileId?: Id<"staffProfile">;
      resolvedByUserId?: Id<"athenaUser">;
    }) {
      this.resolveCalls.push(args.localEventId);
      let resolved = 0;
      for (const conflict of conflicts) {
        if (
          conflict.localEventId === args.localEventId &&
          conflict.status === "needs_review"
        ) {
          conflict.status = "resolved";
          conflict.resolvedAt = args.resolvedAt;
          conflict.resolvedByStaffProfileId = args.resolvedByStaffProfileId;
          conflict.resolvedByUserId = args.resolvedByUserId;
          resolved += 1;
        }
      }
      return resolved;
    },
  };
}

const STORE_ID = "store-1" as Id<"store">;
const TERMINAL_ID = "terminal-1" as Id<"posTerminal">;
const USER_ID = "athena-user-1" as Id<"athenaUser">;

describe("resolveLocalSyncReview", () => {
  it("transitions an open conflict to resolved with who/when attribution", async () => {
    const repository = createFakeRepository([
      { localEventId: "event-1", status: "needs_review" },
    ]);

    const result = await resolveLocalSyncReview(repository, {
      storeId: STORE_ID,
      terminalId: TERMINAL_ID,
      localEventIds: ["event-1"],
      resolvedByUserId: USER_ID,
      now: 1_000,
    });

    expect(result).toEqual({
      resolvedEventIds: ["event-1"],
      resolvedConflictCount: 1,
    });
    expect(repository.conflicts[0]).toMatchObject({
      status: "resolved",
      resolvedAt: 1_000,
      resolvedByUserId: USER_ID,
    });
  });

  it("is a safe no-op for an already-resolved conflict (idempotent)", async () => {
    const repository = createFakeRepository([
      { localEventId: "event-1", status: "resolved", resolvedAt: 500 },
    ]);

    const result = await resolveLocalSyncReview(repository, {
      storeId: STORE_ID,
      terminalId: TERMINAL_ID,
      localEventIds: ["event-1"],
      resolvedByUserId: USER_ID,
      now: 1_000,
    });

    expect(result.resolvedConflictCount).toBe(0);
    // The already-resolved row keeps its original resolution timestamp.
    expect(repository.conflicts[0]).toMatchObject({
      status: "resolved",
      resolvedAt: 500,
    });
  });

  it("deduplicates event ids and drops blank ids before resolving", async () => {
    const repository = createFakeRepository([
      { localEventId: "event-1", status: "needs_review" },
    ]);

    const result = await resolveLocalSyncReview(repository, {
      storeId: STORE_ID,
      terminalId: TERMINAL_ID,
      localEventIds: ["event-1", "event-1", "   "],
      resolvedByUserId: USER_ID,
      now: 1_000,
    });

    expect(repository.resolveCalls).toEqual(["event-1"]);
    expect(result.resolvedEventIds).toEqual(["event-1"]);
    expect(result.resolvedConflictCount).toBe(1);
  });
});
