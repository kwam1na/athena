import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Doc, Id } from "../_generated/dataModel";
import {
  buildRegisterSessionActivityPage,
  listRegisterSessionActivity,
  type RegisterSessionActivityPage,
} from "./registerSessionActivity";

const authMocks = vi.hoisted(() => ({
  requireAuthenticatedAthenaUserWithCtx: vi.fn(),
  requireOrganizationMemberRoleWithCtx: vi.fn(),
}));
const sharedDemoMocks = vi.hoisted(() => ({
  requireSharedDemoStoreCapabilityIfApplicable: vi.fn(),
}));

vi.mock("../lib/athenaUserAuth", () => authMocks);
vi.mock("../sharedDemo/actor", () => sharedDemoMocks);

function getHandler<TArgs, TResult>(definition: unknown) {
  return (definition as { _handler: (ctx: unknown, args: TArgs) => TResult })
    ._handler;
}

function baseEvent(
  overrides: Partial<Doc<"posLocalSyncEvent">> = {},
): Doc<"posLocalSyncEvent"> {
  return {
    _creationTime: 1,
    _id: "event-1" as Id<"posLocalSyncEvent">,
    acceptedAt: 102,
    eventType: "sale_completed",
    localEventId: "local-event-1",
    localRegisterSessionId: "local-session-1",
    occurredAt: 100,
    payload: {
      items: [{ quantity: 1 }],
      localPosSessionId: "local-pos-session-1",
      localReceiptNumber: "R-1",
      localTransactionId: "local-transaction-1",
      payments: [],
      receiptNumber: "R-1",
      totals: { subtotal: 1000, tax: 0, total: 1000 },
    },
    projectedAt: 104,
    sequence: 7,
    staffProfileId: "staff-1" as Id<"staffProfile">,
    status: "projected",
    storeId: "store-1" as Id<"store">,
    submittedAt: 101,
    terminalId: "terminal-1" as Id<"posTerminal">,
    ...overrides,
  };
}

function baseMapping(
  overrides: Partial<Doc<"posLocalSyncMapping">> = {},
): Doc<"posLocalSyncMapping"> {
  return {
    _creationTime: 1,
    _id: "mapping-1" as Id<"posLocalSyncMapping">,
    cloudId: "transaction-1",
    cloudTable: "posTransaction",
    createdAt: 110,
    localEventId: "local-event-1",
    localId: "local-transaction-1",
    localIdKind: "transaction",
    localRegisterSessionId: "local-session-1",
    sourceEventType: "sale_completed",
    storeId: "store-1" as Id<"store">,
    terminalId: "terminal-1" as Id<"posTerminal">,
    ...overrides,
  };
}

describe("buildRegisterSessionActivityPage", () => {
  it("summarizes coverage, categories, attention, and normalized row labels", () => {
    const event = baseEvent({
      _id: "event-held" as Id<"posLocalSyncEvent">,
      eventType: "register_closed",
      payload: { countedCash: 5000 },
      status: "held",
    });

    const page = buildRegisterSessionActivityPage({
      conflictsByLocalEventId: new Map(),
      cursors: [
        {
          _creationTime: 1,
          _id: "cursor-1" as Id<"posLocalSyncCursor">,
          acceptedThroughSequence: 7,
          localRegisterSessionId: "local-session-1",
          storeId: "store-1" as Id<"store">,
          terminalId: "terminal-1" as Id<"posTerminal">,
          updatedAt: 120,
        },
      ],
      events: [event],
      isDone: true,
      mappingsByLocalEventId: new Map(),
      staffNamesById: new Map([
        ["staff-1" as Id<"staffProfile">, "Ama Mensah"],
      ]),
      terminalName: "Front counter",
    });

    expect(page.summary.coverageState).toBe("partially_reported");
    expect(page.summary.reportedThroughSequence).toBe(7);
    expect(page.summary.attentionCounts.held).toBe(1);
    expect(page.summary.categoryCounts.closeout).toBe(1);
    expect(page.page[0]).toMatchObject({
      actorStaffName: "Ama Mensah",
      label: "Closeout started",
      status: {
        label: "Waiting for earlier POS history",
      },
      terminalName: "Front counter",
    });
  });

  it("deduplicates evidence links that point to the same cloud record", () => {
    const page = buildRegisterSessionActivityPage({
      conflictsByLocalEventId: new Map(),
      cursors: [],
      events: [baseEvent()],
      isDone: true,
      mappingsByLocalEventId: new Map([
        [
          "local-event-1",
          [
            baseMapping({ _id: "mapping-1" as Id<"posLocalSyncMapping"> }),
            baseMapping({
              _id: "mapping-2" as Id<"posLocalSyncMapping">,
              localId: "local-payment-1",
              localIdKind: "payment",
            }),
            baseMapping({
              _id: "mapping-3" as Id<"posLocalSyncMapping">,
              localId: "local-receipt-1",
              localIdKind: "receipt",
            }),
          ],
        ],
      ]),
      staffNamesById: new Map(),
      terminalName: null,
    });

    expect(page.page[0].evidenceLinks).toEqual([
      {
        id: "transaction-1",
        label: "Transaction",
        type: "transaction",
      },
    ]);
  });
});

describe("listRegisterSessionActivity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMocks.requireAuthenticatedAthenaUserWithCtx.mockResolvedValue({
      _id: "user-1",
    });
    authMocks.requireOrganizationMemberRoleWithCtx.mockResolvedValue({
      role: "full_admin",
    });
  });

  it("shared-demo-pos-activity uses the store-clamped cash capability", async () => {
    sharedDemoMocks.requireSharedDemoStoreCapabilityIfApplicable.mockResolvedValue(
      {
        storeId: "store-1",
      },
    );
    const handler = getHandler(listRegisterSessionActivity);
    const ctx = {
      db: {
        get: vi.fn(async (table: string) => {
          if (table === "store") {
            return { _id: "store-1", organizationId: "org-1" };
          }
          if (table === "registerSession") {
            return { _id: "session-1", storeId: "store-1" };
          }
          return null;
        }),
      },
    };

    const page = (await handler(ctx, {
      paginationOpts: { cursor: null, numItems: 10 },
      registerSessionId: "session-1" as Id<"registerSession">,
      storeId: "store-1" as Id<"store">,
    })) as RegisterSessionActivityPage;

    expect(
      sharedDemoMocks.requireSharedDemoStoreCapabilityIfApplicable,
    ).toHaveBeenCalledWith(ctx, "cash.control.write", "store-1");
    expect(
      authMocks.requireAuthenticatedAthenaUserWithCtx,
    ).toHaveBeenCalledWith(ctx, { sharedDemoCapability: "cash.control.write" });
    expect(page.registerSession).toEqual({
      _id: "session-1",
      registerNumber: null,
      terminalName: null,
    });
  });

  it("requires full-admin organization membership before returning activity", async () => {
    const handler = getHandler(listRegisterSessionActivity);
    const ctx = {
      db: {
        get: vi.fn(async (table: string) => {
          if (table === "store") {
            return {
              _id: "store-1",
              organizationId: "org-1",
            };
          }
          if (table === "registerSession") {
            return {
              _id: "session-1",
              storeId: "store-1",
            };
          }
          return null;
        }),
      },
    };

    await handler(ctx, {
      paginationOpts: { cursor: null, numItems: 10 },
      registerSessionId: "session-1" as Id<"registerSession">,
      storeId: "store-1" as Id<"store">,
    });

    expect(authMocks.requireOrganizationMemberRoleWithCtx).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        allowedRoles: ["full_admin"],
        failureMessage: "You do not have access to POS activity.",
      }),
    );
  });

  it("does not fall back to POS-only Cash Controls access", async () => {
    authMocks.requireOrganizationMemberRoleWithCtx.mockImplementation(
      async (_ctx, args: { allowedRoles: string[] }) => {
        if (!args.allowedRoles.includes("pos_only")) {
          throw new Error("You do not have access to POS activity.");
        }
      },
    );
    const handler = getHandler(listRegisterSessionActivity);
    const ctx = {
      db: {
        get: vi.fn(async (table: string) => {
          if (table === "store") {
            return {
              _id: "store-1",
              organizationId: "org-1",
            };
          }
          if (table === "registerSession") {
            return {
              _id: "session-1",
              storeId: "store-1",
            };
          }
          return null;
        }),
      },
    };

    await expect(
      handler(ctx, {
        paginationOpts: { cursor: null, numItems: 10 },
        registerSessionId: "session-1" as Id<"registerSession">,
        storeId: "store-1" as Id<"store">,
      }),
    ).rejects.toThrow("You do not have access to POS activity.");
  });

  it("returns activity read-model rows with scoped staff names and checkpoint coverage", async () => {
    const handler = getHandler(listRegisterSessionActivity);
    const activity = {
      _creationTime: 1,
      _id: "activity-1",
      activityKey: "local:store-1:terminal-1:event-1",
      category: "cash",
      eventType: "cash.movement_recorded",
      localEventId: "event-1",
      localRegisterSessionId: "local-register-1",
      localSequence: 12,
      metadata: { amount: 1000, direction: "in" },
      occurredAt: 100,
      receivedAt: 110,
      reportedAt: 105,
      staffProfileId: "staff-other-store",
      status: "mapping_pending",
      storeId: "store-1",
      terminalId: "terminal-1",
      updatedAt: 120,
    };
    const checkpoint = {
      _creationTime: 1,
      _id: "checkpoint-1",
      lastAcceptedBatchAt: 130,
      localRegisterSessionId: "local-register-1",
      reportedThroughSequence: 12,
      skippedCounts: {},
      storeId: "store-1",
      terminalId: "terminal-1",
      updatedAt: 130,
    };
    const tableRows: Record<string, unknown[]> = {
      posLocalSyncConflict: [],
      posLocalSyncMapping: [],
      posRegisterSessionActivity: [activity],
      posRegisterSessionActivityCheckpoint: [checkpoint],
    };
    const orderCalls: string[] = [];
    const ctx = {
      db: {
        get: vi.fn(async (table: string, id: string) => {
          if (table === "store") {
            return { _id: "store-1", organizationId: "org-1" };
          }
          if (table === "registerSession") {
            return {
              _id: "session-1",
              registerNumber: "07",
              storeId: "store-1",
              terminalId: "terminal-1",
            };
          }
          if (table === "posTerminal") {
            return {
              _id: id,
              displayName: "Front counter",
              storeId: "store-1",
            };
          }
          if (table === "staffProfile") {
            return {
              _id: id,
              firstName: "Other",
              fullName: "Other Store Staff",
              lastName: "Staff",
              storeId: "store-2",
            };
          }
          return null;
        }),
        query: vi.fn((table: string) => ({
          withIndex: vi.fn(
            (_index: string, callback: (q: never) => unknown) => {
              const q = {
                eq: () => q,
                gt: () => q,
              };
              callback(q as never);
              return {
                order: (direction: string) => {
                  orderCalls.push(direction);
                  return {
                    take: async (limit: number) =>
                      (tableRows[table] ?? []).slice(0, limit),
                  };
                },
                take: async (limit: number) =>
                  (tableRows[table] ?? []).slice(0, limit),
              };
            },
          ),
        })),
      },
    };

    const page = (await handler(ctx, {
      paginationOpts: { cursor: null, numItems: 10 },
      registerSessionId: "session-1" as Id<"registerSession">,
      storeId: "store-1" as Id<"store">,
    })) as RegisterSessionActivityPage;

    expect(orderCalls).toContain("desc");
    expect(page.integration).toEqual({
      activityReadModelAvailable: true,
      source: "activity_read_model",
    });
    expect(page.registerSession).toEqual({
      _id: "session-1",
      registerNumber: "07",
      terminalName: "Front counter",
    });
    expect(page.summary).toMatchObject({
      coverageState: "reported",
      reportedThroughSequence: 12,
    });
    expect(page.summary.attentionCounts.mapping_pending).toBe(1);
    expect(page.summary.categoryCounts.cash).toBe(1);
    expect(page.page[0]).toMatchObject({
      actorStaffName: null,
      label: "Cash movement recorded",
      sequence: 12,
      status: {
        label: "Waiting for session mapping",
      },
      terminalName: "Front counter",
    });
  });

  it("uses the sequence cursor as a descending upper bound", async () => {
    const handler = getHandler(listRegisterSessionActivity);
    const cursorComparisons: Array<{ field: string; value: number }> = [];
    const orderCalls: string[] = [];
    const ctx = {
      db: {
        get: vi.fn(async (table: string, id: string) => {
          if (table === "store") {
            return { _id: "store-1", organizationId: "org-1" };
          }
          if (table === "registerSession") {
            return {
              _id: id,
              registerNumber: "07",
              storeId: "store-1",
              terminalId: "terminal-1",
            };
          }
          if (table === "posTerminal") {
            return {
              _id: id,
              displayName: "Other store terminal",
              storeId: "store-2",
            };
          }
          return null;
        }),
        query: vi.fn((table: string) => ({
          withIndex: vi.fn(
            (_index: string, callback: (q: never) => unknown) => {
              const q = {
                eq: () => q,
                lt: (field: string, value: number) => {
                  cursorComparisons.push({ field, value });
                  return q;
                },
              };
              callback(q as never);
              return {
                order: (direction: string) => {
                  orderCalls.push(direction);
                  return {
                    take: async () => [],
                  };
                },
                take: async () => [],
              };
            },
          ),
        })),
      },
    };

    const page = (await handler(ctx, {
      paginationOpts: { cursor: "12", numItems: 10 },
      registerSessionId: "session-1" as Id<"registerSession">,
      storeId: "store-1" as Id<"store">,
    })) as RegisterSessionActivityPage;

    expect(orderCalls).toContain("desc");
    expect(page.registerSession).toEqual({
      _id: "session-1",
      registerNumber: "07",
      terminalName: null,
    });
    expect(cursorComparisons).toContainEqual({
      field: "localSequence",
      value: 12,
    });
    expect(cursorComparisons).toContainEqual({
      field: "sequence",
      value: 12,
    });
  });
});
