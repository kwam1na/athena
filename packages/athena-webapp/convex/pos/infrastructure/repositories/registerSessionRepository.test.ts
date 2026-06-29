import { describe, expect, it } from "vitest";

import type { Id } from "../../../_generated/dataModel";
import { buildRegisterSessionLocalSyncStatus } from "../../application/sync/registerSessionSyncReview";
import { getActiveRegisterSessionForRegisterState } from "./registerSessionRepository";

function createRegisterSessionQueryCtx(
  seed: Record<string, Array<Record<string, unknown>>>,
  activeRegisterSession: Record<string, unknown> | null,
) {
  const indexReads: Array<{ indexName: string; tableName: string }> = [];
  const rowsByTable = new Map(
    Object.entries(seed).map(([tableName, rows]) => [
      tableName,
      rows.map((row) => ({ ...row })),
    ]),
  );
  const getRows = (tableName: string) => rowsByTable.get(tableName) ?? [];

  return {
    indexReads,
    runQuery: async () => activeRegisterSession,
    db: {
      get: async (tableName: string, id: string) =>
        getRows(tableName).find((row) => row._id === id) ?? null,
      query: (tableName: string) => {
        const filters: Array<[string, unknown]> = [];
        const matches = (row: Record<string, unknown>) =>
          filters.every(([field, value]) => row[field] === value);
        const query = {
          withIndex: (indexName: string, build: (q: any) => unknown) => {
            indexReads.push({ indexName, tableName });
            const indexQuery = {
              eq(field: string, value: unknown) {
                filters.push([field, value]);
                return indexQuery;
              },
              gte(field: string, value: unknown) {
                filters.push([field, value]);
                return indexQuery;
              },
            };
            build(indexQuery);
            return query;
          },
          async unique() {
            return getRows(tableName).find((row) => matches(row)) ?? null;
          },
          async take(limit: number) {
            return getRows(tableName)
              .filter((row) => matches(row))
              .slice(0, limit);
          },
        };
        return query;
      },
    },
  };
}

describe("register session repository", () => {
  it("loads active drawer sync review through the target session instead of store-wide conflict scans", async () => {
    const activeRegisterSession = {
      _id: "session_active",
      expectedCash: 3000,
      openedAt: 1,
      openingFloat: 3000,
      registerNumber: "1",
      status: "active",
      storeId: "store-1",
      terminalId: "terminal-1",
    };
    const ctx = createRegisterSessionQueryCtx(
      {
        posLocalSyncConflict: [
          {
            _id: "sync-conflict-target",
            conflictType: "permission",
            createdAt: 2,
            details: {
              countedCash: 4000,
              expectedCash: 3000,
              variance: 1000,
            },
            localEventId: "event-register-closed",
            localRegisterSessionId: "local-register-1",
            sequence: 7,
            status: "needs_review",
            storeId: "store-1",
            summary:
              "Register closeout variance requires manager review before synced closeout can be applied.",
            terminalId: "terminal-1",
          },
        ],
        posLocalSyncEvent: [
          {
            _id: "sync-event-target",
            eventType: "register_closed",
            localEventId: "event-register-closed",
            localRegisterSessionId: "local-register-1",
            payload: {},
            sequence: 7,
            status: "conflicted",
            storeId: "store-1",
            submittedAt: 2,
            terminalId: "terminal-1",
          },
        ],
        posLocalSyncMapping: [
          {
            _id: "sync-mapping-target",
            cloudId: "session_active",
            cloudTable: "registerSession",
            localId: "local-register-1",
            localIdKind: "registerSession",
            localRegisterSessionId: "local-register-1",
            storeId: "store-1",
            terminalId: "terminal-1",
          },
        ],
        registerSession: [activeRegisterSession],
      },
      activeRegisterSession,
    );

    await expect(
      getActiveRegisterSessionForRegisterState(ctx as never, {
        storeId: "store-1" as Id<"store">,
        terminalId: "terminal-1" as Id<"posTerminal">,
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        _id: "session_active",
        localSyncStatus: expect.objectContaining({
          reconciliationItems: [
            expect.objectContaining({
              id: "sync-conflict-target",
              reviewKind: "register_closeout_variance",
            }),
          ],
          status: "needs_review",
        }),
      }),
    );
    expect(ctx.indexReads).not.toContainEqual({
      indexName: "by_store_status",
      tableName: "posLocalSyncConflict",
    });
    expect(ctx.indexReads).not.toContainEqual({
      indexName: "by_storeId_status_registerSessionId_completedAt",
      tableName: "posTransaction",
    });
  });

  it("maps closeout sync conflicts into register-session review status", () => {
    const result = buildRegisterSessionLocalSyncStatus([
      {
        _id: "sync-conflict-1" as Id<"posLocalSyncConflict">,
        conflictType: "permission",
        createdAt: 1710000000000,
        details: {
          countedCash: 4_500,
          expectedCash: 5_000,
          notes: "Short drawer",
          variance: -500,
        },
        localEventId: "event-register-closed-1",
        localRegisterSessionId: "local-register-1",
        sequence: 3,
        status: "needs_review",
        storeId: "store-1" as Id<"store">,
        summary:
          "Register closeout variance requires manager review before synced closeout can be applied.",
        terminalId: "terminal-1" as Id<"posTerminal">,
      },
      {
        _id: "sync-conflict-2" as Id<"posLocalSyncConflict">,
        conflictType: "permission",
        createdAt: 1710000000001,
        details: {
          countedCash: 4_700,
          expectedCash: 5_000,
          variance: -300,
        },
        localEventId: "event-register-closed-2",
        localRegisterSessionId: "local-register-1",
        sequence: 4,
        sourceEventNotes: "Recovered from source event",
        status: "needs_review",
        storeId: "store-1" as Id<"store">,
        summary:
          "Register closeout variance requires manager review before synced closeout can be applied.",
        terminalId: "terminal-1" as Id<"posTerminal">,
      },
    ]);

    expect(result).toEqual({
      status: "needs_review",
      reconciliationItems: [
        {
          actionPolicy: "apply_or_reject",
          createdAt: 1710000000000,
          countedCash: 4_500,
          expectedCash: 5_000,
          id: "sync-conflict-1",
          inventoryReview: null,
          localEventId: "event-register-closed-1",
          notes: "Short drawer",
          reviewKind: "register_closeout_variance",
          sequence: 3,
          status: "needs_review",
          summary:
            "Register closeout variance requires manager review before synced closeout can be applied.",
          type: "register_closeout",
          variance: -500,
        },
        {
          actionPolicy: "apply_or_reject",
          createdAt: 1710000000001,
          countedCash: 4_700,
          expectedCash: 5_000,
          id: "sync-conflict-2",
          inventoryReview: null,
          localEventId: "event-register-closed-2",
          notes: "Recovered from source event",
          reviewKind: "register_closeout_variance",
          sequence: 4,
          status: "needs_review",
          summary:
            "Register closeout variance requires manager review before synced closeout can be applied.",
          type: "register_closeout",
          variance: -300,
        },
      ],
    });
  });
});
