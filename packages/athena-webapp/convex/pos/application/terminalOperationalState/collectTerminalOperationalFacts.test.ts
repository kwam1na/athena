import { describe, expect, it } from "vitest";

import type { Doc, Id } from "../../../_generated/dataModel";
import type { QueryCtx } from "../../../_generated/server";
import { collectTerminalOperationalFacts } from "./collectTerminalOperationalFacts";

const now = 2_000_000;
const storeId = "store-1" as Id<"store">;
const terminalId = "terminal-1" as Id<"posTerminal">;

describe("collectTerminalOperationalFacts", () => {
  it("keeps latest lifecycle evidence separate from active card-link evidence", async () => {
    const ctx = buildQueryCtx({
      posTerminalRuntimeStatus: [buildRuntimeStatus()],
      registerSession: [
        buildRegisterSession({
          _id: "register-open" as Id<"registerSession">,
          openedAt: now - 100_000,
          status: "open",
        }),
        buildRegisterSession({
          _id: "register-closed" as Id<"registerSession">,
          closedAt: now - 1_000,
          openedAt: now - 20_000,
          status: "closed",
        }),
      ],
    });

    const facts = await collectTerminalOperationalFacts(ctx, {
      emptySyncEvidence: emptySyncEvidence(),
      includeSyncEvidence: false,
      terminal: buildTerminal(),
    });

    expect(facts.latestRegisterSession?._id).toBe("register-closed");
    expect(facts.registerSessionLink).toEqual({
      registerSessionId: "register-open",
      status: "open",
    });
    expect(facts.drawerAuthorityRegisterSession).toBeNull();
    expect(facts.runtimeStatus?._id).toBe("runtime-1");
  });

  it("collects drawer authority cloud register session as a fact", async () => {
    const ctx = buildQueryCtx({
      posTerminalRuntimeStatus: [
        buildRuntimeStatus({
          drawerAuthority: {
            cloudRegisterSessionId: "register-closed",
            localRegisterSessionId: "local-register-1",
            observedAt: now - 1_000,
            reason: "cloud_closed",
            status: "blocked",
          },
        }),
      ],
      registerSession: [
        buildRegisterSession({
          _id: "register-closed" as Id<"registerSession">,
          closedAt: now - 500,
          openedAt: now - 20_000,
          status: "closed",
        }),
      ],
    });

    const facts = await collectTerminalOperationalFacts(ctx, {
      emptySyncEvidence: emptySyncEvidence(),
      includeSyncEvidence: false,
      terminal: buildTerminal(),
    });

    expect(facts.drawerAuthorityRegisterSession?._id).toBe("register-closed");
  });

  it("collects local sync events, cursors, and conflicts when sync evidence is included", async () => {
    const ctx = buildQueryCtx({
      posLocalSyncConflict: [
        buildSyncConflict({
          _id: "conflict-1" as Id<"posLocalSyncConflict">,
          sequence: 11,
        }),
      ],
      posLocalSyncCursor: [
        {
          _id: "cursor-1" as Id<"posLocalSyncCursor">,
          _creationTime: now - 4_000,
          acceptedThroughSequence: 9,
          cursorKey: "terminal",
          storeId,
          terminalId,
          updatedAt: now - 2_000,
        },
      ],
      posLocalSyncEvent: [
        buildSyncEvent({
          _id: "event-rejected" as Id<"posLocalSyncEvent">,
          localEventId: "local-rejected",
          sequence: 12,
          status: "rejected",
        }),
        buildSyncEvent({
          _id: "event-accepted" as Id<"posLocalSyncEvent">,
          localEventId: "local-accepted",
          sequence: 10,
          status: "accepted",
        }),
      ],
      posTerminalRuntimeStatus: [buildRuntimeStatus()],
      registerSession: [buildRegisterSession()],
    });

    const facts = await collectTerminalOperationalFacts(ctx, {
      emptySyncEvidence: emptySyncEvidence(),
      includeSyncEvidence: true,
      terminal: buildTerminal(),
    });

    expect(facts.rawSyncEvidence.latestEvent?.localEventId).toBe(
      "local-rejected",
    );
    expect(facts.rawSyncEvidence.rejectedCount).toBe(1);
    expect(facts.rawSyncEvidence.acceptedCount).toBe(1);
    expect(facts.rawSyncEvidence.acceptedThroughSequence).toBe(9);
    expect(facts.rawSyncEvidence.unresolvedConflictCount).toBe(1);
    expect(facts.rawSyncEvidence.unresolvedConflicts?.[0]?._id).toBe(
      "conflict-1",
    );
  });
});

type TestTable =
  | "posLocalSyncConflict"
  | "posLocalSyncCursor"
  | "posLocalSyncEvent"
  | "posTerminalRuntimeStatus"
  | "registerSession";

function buildQueryCtx(
  records: Partial<Record<TestTable, Array<Record<string, unknown>>>>,
) {
  return {
    db: {
      get(table: TestTable, id: string) {
        return Promise.resolve(
          records[table]?.find((record) => record._id === id) ?? null,
        );
      },
      query(table: TestTable) {
        return buildQuery(records[table] ?? []);
      },
    },
  } as unknown as QueryCtx;
}

function buildTerminal(
  overrides: Partial<Doc<"posTerminal">> = {},
): Doc<"posTerminal"> {
  return {
    _id: terminalId,
    _creationTime: now - 50_000,
    browserInfo: {
      userAgent: "Mozilla/5.0",
    },
    displayName: "Front register",
    fingerprintHash: "fingerprint",
    registeredAt: now - 50_000,
    registeredByUserId: "user-1" as Id<"athenaUser">,
    registerNumber: "8",
    status: "active",
    storeId,
    ...overrides,
  };
}

function buildRuntimeStatus(
  overrides: Partial<Doc<"posTerminalRuntimeStatus">> = {},
): Doc<"posTerminalRuntimeStatus"> {
  return {
    _id: "runtime-1" as Id<"posTerminalRuntimeStatus">,
    _creationTime: now - 2_000,
    appSessionRecovery: {
      status: "ready",
    },
    browserInfo: {
      online: true,
      userAgent: "Mozilla/5.0",
    },
    localStore: {
      available: true,
      terminalSeedReady: true,
    },
    receivedAt: now - 1_000,
    reportedAt: now - 1_000,
    snapshots: {},
    source: "sync-runtime",
    staffAuthority: {
      status: "ready",
    },
    storeId,
    sync: {
      failedEventCount: 0,
      localOnlyEventCount: 0,
      pendingEventCount: 0,
      reviewEventCount: 0,
      status: "idle",
      uploadableEventCount: 0,
    },
    terminalId,
    terminalIntegrity: {
      observedAt: now - 1_000,
      status: "healthy",
    },
    ...overrides,
  };
}

function buildRegisterSession(
  overrides: Partial<Doc<"registerSession">> = {},
): Doc<"registerSession"> {
  return {
    _id: "register-1" as Id<"registerSession">,
    _creationTime: now - 10_000,
    closeoutRecords: [],
    closedAt: undefined,
    expectedCash: 0,
    openedAt: now - 100_000,
    openingFloat: 0,
    registerNumber: "8",
    status: "open",
    storeId,
    terminalId,
    ...overrides,
  };
}

function buildSyncEvent(
  overrides: Partial<Doc<"posLocalSyncEvent">> = {},
): Doc<"posLocalSyncEvent"> {
  return {
    _id: "event-1" as Id<"posLocalSyncEvent">,
    _creationTime: now - 5_000,
    acceptedAt: undefined,
    eventType: "sale",
    localEventId: "local-event-1",
    localRegisterSessionId: "local-register-1",
    occurredAt: now - 5_000,
    payload: "{}",
    projectedAt: undefined,
    rejectionCode: undefined,
    sequence: 1,
    status: "accepted",
    storeId,
    submittedAt: now - 4_000,
    terminalId,
    ...overrides,
  } as Doc<"posLocalSyncEvent">;
}

function buildSyncConflict(
  overrides: Partial<Doc<"posLocalSyncConflict">> = {},
): Doc<"posLocalSyncConflict"> {
  return {
    _id: "conflict-1" as Id<"posLocalSyncConflict">,
    _creationTime: now - 3_000,
    conflictType: "inventory",
    createdAt: now - 3_000,
    localEventId: "local-event-1",
    localRegisterSessionId: "local-register-1",
    resolution: undefined,
    sequence: 1,
    status: "needs_review",
    storeId,
    summary: "Inventory review required.",
    terminalId,
    updatedAt: now - 3_000,
    ...overrides,
  } as Doc<"posLocalSyncConflict">;
}

function emptySyncEvidence() {
  return {
    latestEvent: null,
    latestReviewEvent: null,
    latestReviewEventsByStatus: {
      conflicted: null,
      held: null,
      rejected: null,
    },
    sampledEventCount: 0,
    acceptedCount: 0,
    projectedCount: 0,
    conflictedCount: 0,
    heldCount: 0,
    rejectedCount: 0,
    unresolvedConflictCount: 0,
    unresolvedConflicts: [],
  };
}

function buildQuery(records: Array<Record<string, unknown>>) {
  const chain = {
    collect: () => Promise.resolve(records),
    first: () => Promise.resolve(records[0] ?? null),
    order: () => chain,
    take: (count: number) => Promise.resolve(records.slice(0, count)),
    unique: () => Promise.resolve(records[0] ?? null),
    withIndex: () => chain,
  };

  return chain;
}
