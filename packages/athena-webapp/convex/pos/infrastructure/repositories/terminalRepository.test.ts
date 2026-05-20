import { describe, expect, it, vi } from "vitest";

import type { Doc, Id } from "../../../_generated/dataModel";
import {
  getTerminalSyncEvidence,
  upsertLatestRuntimeStatus,
} from "./terminalRepository";

describe("terminalRepository runtime status", () => {
  it("patches the existing latest runtime status for a terminal", async () => {
    const ctx = buildCtx({
      posTerminalRuntimeStatus: [
        buildRuntimeStatus({
          _id: "other-store-status" as Id<"posTerminalRuntimeStatus">,
          storeId: "store-2" as Id<"store">,
        }),
        buildRuntimeStatus({
          _id: "other-terminal-status" as Id<"posTerminalRuntimeStatus">,
          terminalId: "terminal-2" as Id<"posTerminal">,
        }),
        buildRuntimeStatus(),
      ],
    });
    const input = {
      ...buildRuntimeStatus(),
      reportedAt: 250,
      receivedAt: 260,
    };

    const result = await upsertLatestRuntimeStatus(ctx as never, input);

    expect(result).toBe("runtime-status-1");
    expect(ctx.db.patch).toHaveBeenCalledWith(
      "posTerminalRuntimeStatus",
      "runtime-status-1",
      input,
    );
    expect(ctx.db.insert).not.toHaveBeenCalled();
  });

  it("inserts runtime status when no status exists for the terminal", async () => {
    const ctx = buildCtx();
    const input = buildRuntimeStatus();

    const result = await upsertLatestRuntimeStatus(ctx as never, input);

    expect(result).toBe("runtime-status-new");
    expect(ctx.db.insert).toHaveBeenCalledWith("posTerminalRuntimeStatus", input);
    expect(ctx.db.patch).not.toHaveBeenCalled();
  });
});

describe("terminalRepository sync evidence", () => {
  it("returns cursor evidence when no recent events exist", async () => {
    const ctx = buildCtx({
      posLocalSyncCursor: [
        {
          _id: "cursor-1" as Id<"posLocalSyncCursor">,
          _creationTime: 1,
          acceptedThroughSequence: 12,
          localRegisterSessionId: "register-1",
          storeId: "store-1" as Id<"store">,
          terminalId: "terminal-1" as Id<"posTerminal">,
          updatedAt: 300,
        },
      ],
    });

    const result = await getTerminalSyncEvidence(ctx as never, {
      storeId: "store-1" as Id<"store">,
      terminalId: "terminal-1" as Id<"posTerminal">,
    });

    expect(result).toEqual({
      latestEvent: null,
      sampledEventCount: 0,
      acceptedCount: 0,
      projectedCount: 0,
      conflictedCount: 0,
      heldCount: 0,
      rejectedCount: 0,
      acceptedThroughSequence: 12,
      cursorUpdatedAt: 300,
    });
  });

  it("aggregates recent sync event statuses and latest event evidence", async () => {
    const ctx = buildCtx({
      posLocalSyncCursor: [
        {
          _id: "cursor-1" as Id<"posLocalSyncCursor">,
          _creationTime: 1,
          acceptedThroughSequence: 7,
          localRegisterSessionId: "register-1",
          storeId: "store-1" as Id<"store">,
          terminalId: "terminal-1" as Id<"posTerminal">,
          updatedAt: 400,
        },
      ],
      posLocalSyncEvent: [
        buildSyncEvent({ localEventId: "event-accepted", sequence: 1, status: "accepted" }),
        buildSyncEvent({ localEventId: "event-projected", sequence: 2, status: "projected" }),
        buildSyncEvent({ localEventId: "event-conflicted", sequence: 3, status: "conflicted" }),
        buildSyncEvent({ localEventId: "event-held", sequence: 4, status: "held" }),
        buildSyncEvent({ localEventId: "event-rejected", sequence: 5, status: "rejected" }),
      ],
    });

    const result = await getTerminalSyncEvidence(ctx as never, {
      storeId: "store-1" as Id<"store">,
      terminalId: "terminal-1" as Id<"posTerminal">,
    });

    expect(result).toEqual({
      latestEvent: expect.objectContaining({
        localEventId: "event-rejected",
        sequence: 5,
        status: "rejected",
      }),
      sampledEventCount: 5,
      acceptedCount: 1,
      projectedCount: 1,
      conflictedCount: 1,
      heldCount: 1,
      rejectedCount: 1,
      acceptedThroughSequence: 7,
      cursorUpdatedAt: 400,
    });
  });
});

function buildCtx(seed: {
  posLocalSyncCursor?: Array<Doc<"posLocalSyncCursor">>;
  posLocalSyncEvent?: Array<Doc<"posLocalSyncEvent">>;
  posTerminalRuntimeStatus?: Array<Doc<"posTerminalRuntimeStatus">>;
} = {}) {
  return {
    db: {
      insert: vi.fn(async () => "runtime-status-new"),
      patch: vi.fn(async () => undefined),
      query: vi.fn((tableName: keyof typeof seed) =>
        buildQuery((seed[tableName] ?? []) as Array<Record<string, unknown>>),
      ),
    },
  };
}

function buildQuery<T extends { _creationTime?: number; sequence?: number }>(
  rows: T[],
) {
  let currentRows = [...rows];
  return {
    withIndex: vi.fn((_indexName: string, build: (q: {
      eq: (field: string, value: unknown) => unknown;
    }) => unknown) => {
      const q = {
        eq: vi.fn((field: string, value: unknown) => {
          currentRows = currentRows.filter(
            (row) => (row as Record<string, unknown>)[field] === value,
          );
          return q;
        }),
      };
      build(q);

      return {
        order: vi.fn((direction: "asc" | "desc") => {
          currentRows = [...currentRows].sort((left, right) => {
            const leftOrder = left.sequence ?? left._creationTime ?? 0;
            const rightOrder = right.sequence ?? right._creationTime ?? 0;
            return direction === "desc"
              ? rightOrder - leftOrder
              : leftOrder - rightOrder;
          });
          return {
            first: vi.fn(async () => currentRows[0] ?? null),
            take: vi.fn(async (count: number) => currentRows.slice(0, count)),
          };
        }),
        take: vi.fn(async (count: number) => currentRows.slice(0, count)),
      };
    }),
  };
}

function buildRuntimeStatus(
  overrides: Partial<Doc<"posTerminalRuntimeStatus">> = {},
): Doc<"posTerminalRuntimeStatus"> {
  return {
    _id: "runtime-status-1" as Id<"posTerminalRuntimeStatus">,
    _creationTime: 100,
    storeId: "store-1" as Id<"store">,
    terminalId: "terminal-1" as Id<"posTerminal">,
    reportedAt: 100,
    receivedAt: 110,
    source: "sync-runtime",
    localStore: {
      available: true,
      terminalSeedReady: true,
    },
    sync: {
      status: "idle",
      pendingEventCount: 0,
      uploadableEventCount: 0,
      failedEventCount: 0,
      reviewEventCount: 0,
      localOnlyEventCount: 0,
    },
    staffAuthority: {
      status: "unknown",
    },
    snapshots: {},
    ...overrides,
  };
}

function buildSyncEvent(
  overrides: Partial<Doc<"posLocalSyncEvent">> = {},
): Doc<"posLocalSyncEvent"> {
  return {
    _id: `${overrides.localEventId ?? "event-1"}-id` as Id<"posLocalSyncEvent">,
    _creationTime: overrides.sequence ?? 1,
    storeId: "store-1" as Id<"store">,
    terminalId: "terminal-1" as Id<"posTerminal">,
    localRegisterSessionId: "register-1",
    localEventId: "event-1",
    eventType: "sale.completed",
    sequence: 1,
    status: "accepted",
    occurredAt: 100,
    submittedAt: 110,
    ...overrides,
  } as Doc<"posLocalSyncEvent">;
}
