import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import type { Id } from "../_generated/dataModel";
import { ok, userError } from "../../shared/commandResult";

const mockedAuthServer = vi.hoisted(() => ({
  getAuthUserId: vi.fn(),
}));

vi.mock("@convex-dev/auth/server", () => ({
  getAuthUserId: mockedAuthServer.getAuthUserId,
}));

import {
  buildCashControlsDashboardSnapshot,
  buildRegisterSessionDepositTargetId,
  getDashboardSnapshot,
  getRegisterSessionSnapshot,
  listOpenLocalSyncConflictsByRegisterSession,
  recordRegisterSessionDeposit,
  resolveRegisterSessionSyncReview,
} from "./deposits";

function getSource(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

function getHandler(definition: unknown) {
  return (definition as { _handler: Function })._handler;
}

function createQueryCtx(seed: Record<string, Array<Record<string, unknown>>>) {
  const rowsByTable = new Map(
    Object.entries(seed).map(([tableName, rows]) => [
      tableName,
      rows.map((row) => ({ ...row })),
    ]),
  );
  const getRows = (tableName: string) => {
    let rows = rowsByTable.get(tableName);
    if (!rows) {
      rows = [];
      rowsByTable.set(tableName, rows);
    }
    return rows;
  };

  return {
    tables: rowsByTable,
    db: {
      get: async (tableName: string, id: string) =>
        getRows(tableName).find((row) => row._id === id) ?? null,
      insert: async (tableName: string, value: Record<string, unknown>) => {
        const rows = getRows(tableName);
        const id =
          (value._id as string | undefined) ??
          `${tableName}_${rows.length + 1}`;
        rows.push({ ...value, _id: id });
        return id;
      },
      normalizeId: (tableName: string, id: string) =>
        getRows(tableName).some((row) => row._id === id) ? id : null,
      patch: async (
        tableName: string,
        id: string,
        value: Record<string, unknown>,
      ) => {
        const row = getRows(tableName).find(
          (candidate) => candidate._id === id,
        );
        if (!row) {
          throw new Error(`Missing ${tableName} row ${id}`);
        }
        Object.assign(row, value);
      },
      query: (tableName: string) => {
        const filters: Array<[string, unknown]> = [];
        const predicateFilters: Array<
          (row: Record<string, unknown>) => boolean
        > = [];
        const matches = (row: Record<string, unknown>) =>
          filters.every(([field, value]) => row[field] === value) &&
          predicateFilters.every((predicate) => predicate(row));
        const filterQuery = {
          and: (...conditions: boolean[]) => conditions.every(Boolean),
          eq: (left: unknown, right: unknown) => left === right,
          field: (field: string) => ({
            __field: field,
          }),
        };
        const resolveFilterValue = (
          value: unknown,
          row: Record<string, unknown>,
        ) =>
          value &&
          typeof value === "object" &&
          "__field" in value &&
          typeof value.__field === "string"
            ? row[value.__field]
            : value;
        const query = {
          filter: (build: (q: any) => boolean) => {
            predicateFilters.push((row) =>
              build({
                ...filterQuery,
                eq: (left: unknown, right: unknown) =>
                  resolveFilterValue(left, row) ===
                  resolveFilterValue(right, row),
              }),
            );
            return query;
          },
          withIndex: (_indexName: string, build: (q: any) => unknown) => {
            const indexQuery = {
              eq(field: string, value: unknown) {
                filters.push([field, value]);
                return indexQuery;
              },
              gte(field: string, value: unknown) {
                predicateFilters.push(
                  (row) =>
                    typeof row[field] === "number" &&
                    row[field] >= (value as number),
                );
                return indexQuery;
              },
              gt(field: string, value: unknown) {
                predicateFilters.push(
                  (row) =>
                    typeof row[field] === "number" &&
                    row[field] > (value as number),
                );
                return indexQuery;
              },
            };
            build(indexQuery);
            return query;
          },
          order: () => query,
          async unique() {
            return getRows(tableName).find((row) => matches(row)) ?? null;
          },
          async first() {
            return getRows(tableName).find((row) => matches(row)) ?? null;
          },
          async take(limit: number) {
            return getRows(tableName)
              .filter((row) => matches(row))
              .slice(0, limit);
          },
          async collect() {
            return getRows(tableName).filter((row) => matches(row));
          },
          async *[Symbol.asyncIterator]() {
            for (const row of getRows(tableName).filter((candidate) =>
              matches(candidate),
            )) {
              yield row;
            }
          },
        };
        return query;
      },
    },
    auth: {},
  };
}

function createAuthorizedRegisterDepositCtx(
  overrides: Record<string, Array<Record<string, unknown>>> = {},
) {
  return createQueryCtx({
    athenaUser: [{ _id: "athena_user_1", email: "operator@example.com" }],
    organizationMember: [
      {
        _id: "member_1",
        organizationId: "org_1",
        role: "pos_only",
        userId: "athena_user_1",
      },
    ],
    registerSession: [
      {
        _id: "session_open",
        expectedCash: 50000,
        openedAt: 1,
        openingFloat: 10000,
        organizationId: "org_1",
        registerNumber: "1",
        status: "active",
        storeId: "store_1",
      },
    ],
    staffProfile: [
      {
        _id: "staff_1",
        linkedUserId: "athena_user_1",
        status: "active",
        storeId: "store_1",
      },
    ],
    store: [{ _id: "store_1", currency: "GHS", organizationId: "org_1" }],
    users: [{ _id: "auth_user_1", email: "operator@example.com" }],
    ...overrides,
  });
}

describe("cash control deposits", () => {
  beforeEach(() => {
    mockedAuthServer.getAuthUserId.mockResolvedValue("auth_user_1");
  });

  it("builds a stable session-scoped submission target for idempotent deposit writes", () => {
    expect(
      buildRegisterSessionDepositTargetId({
        registerSessionId: "session_1" as Id<"registerSession">,
        submissionKey: "submission_1",
      }),
    ).toBe("session_1:submission_1");
  });

  it("builds dashboard sections from register sessions and recorded deposits", () => {
    const snapshot = buildCashControlsDashboardSnapshot({
      approvalRequestsBySessionId: new Map([
        [
          "session_closing" as Id<"registerSession">,
          {
            _id: "approval_1" as Id<"approvalRequest">,
            notes: "Counted twice before manager review.",
            reason: "Variance review required.",
            status: "pending",
          },
        ],
      ]),
      deposits: [
        {
          _id: "deposit_1" as Id<"paymentAllocation">,
          amount: 1200,
          externalReference: "BANK-001",
          notes: "Midday bank drop",
          recordedAt: 30,
          registerSessionId: "session_open" as Id<"registerSession">,
        },
        {
          _id: "deposit_2" as Id<"paymentAllocation">,
          amount: 500,
          recordedAt: 40,
          registerSessionId: "session_closing" as Id<"registerSession">,
        },
      ],
      syncConflictsBySessionId: new Map([
        [
          "session_open" as Id<"registerSession">,
          [
            {
              _id: "sync_conflict_1" as Id<"posLocalSyncConflict">,
              _creationTime: 20,
              conflictType: "permission",
              createdAt: 20,
              localEventId: "event-register-closeout-1",
              localRegisterSessionId: "session_open",
              sequence: 7,
              status: "needs_review",
              storeId: "store_1" as Id<"store">,
              summary:
                "Register closeout variance requires manager review before synced closeout can be applied.",
              terminalId: "terminal_1" as Id<"posTerminal">,
              details: {
                countedCash: 13100,
                expectedCash: 13800,
                variance: -700,
              },
            },
          ],
        ],
      ]),
      registerSessions: [
        {
          _id: "session_open" as Id<"registerSession">,
          countedCash: undefined,
          expectedCash: 13800,
          openedAt: 10,
          openingFloat: 5000,
          registerNumber: "A1",
          status: "active",
          storeId: "store_1" as Id<"store">,
          terminalId: "terminal_1" as Id<"posTerminal">,
          variance: undefined,
        },
        {
          _id: "session_closing" as Id<"registerSession">,
          countedCash: 9000,
          expectedCash: 9500,
          managerApprovalRequestId: "approval_1" as Id<"approvalRequest">,
          openedAt: 20,
          openingFloat: 5000,
          registerNumber: "B2",
          status: "closing",
          storeId: "store_1" as Id<"store">,
          terminalId: "terminal_2" as Id<"posTerminal">,
          variance: -500,
        },
        {
          _id: "session_closed" as Id<"registerSession">,
          countedCash: 5000,
          expectedCash: 5000,
          openedAt: 5,
          openingFloat: 5000,
          registerNumber: "C3",
          status: "closed",
          storeId: "store_1" as Id<"store">,
          variance: 0,
        },
      ],
      staffNamesById: new Map(),
      terminalNamesById: new Map([
        ["terminal_1" as Id<"posTerminal">, "Front counter"],
        ["terminal_2" as Id<"posTerminal">, "Back counter"],
      ]),
    });

    expect(snapshot.registerSessions).toHaveLength(3);
    expect(snapshot.registerSessions.map((session) => session._id)).toEqual([
      "session_closing",
      "session_open",
      "session_closed",
    ]);

    expect(snapshot.openSessions).toHaveLength(1);
    expect(snapshot.openSessions[0]).toMatchObject({
      _id: "session_open",
      registerNumber: "A1",
      terminalName: "Front counter",
      totalDeposited: 1200,
    });

    expect(snapshot.pendingCloseouts).toHaveLength(1);
    expect(snapshot.pendingCloseouts[0]).toMatchObject({
      _id: "session_closing",
      pendingApprovalRequest: {
        _id: "approval_1",
        notes: "Counted twice before manager review.",
        status: "pending",
      },
      terminalName: "Back counter",
      totalDeposited: 500,
    });

    expect(snapshot.openSessions[0]).toMatchObject({
      localSyncStatus: {
        status: "needs_review",
        reconciliationItems: [
          {
            countedCash: 13100,
            createdAt: 20,
            expectedCash: 13800,
            id: "sync_conflict_1",
            localEventId: "event-register-closeout-1",
            sequence: 7,
            status: "needs_review",
            summary:
              "Register closeout variance requires manager review before synced closeout can be applied.",
            type: "register_closeout",
            variance: -700,
          },
        ],
      },
    });

    expect(snapshot.unresolvedVariances).toHaveLength(2);
    expect(snapshot.unresolvedVariances[0]).toMatchObject({
      _id: "session_closing",
      variance: -500,
    });

    expect(snapshot.recentDeposits).toEqual([
      expect.objectContaining({
        _id: "deposit_2",
        amount: 500,
        registerNumber: "B2",
      }),
      expect.objectContaining({
        _id: "deposit_1",
        amount: 1200,
        reference: "BANK-001",
        registerNumber: "A1",
      }),
    ]);
  });

  it("maps open sync conflicts when an unmapped local id is the cloud session id", async () => {
    const conflict = {
      _id: "sync_conflict_1",
      storeId: "store_1",
      terminalId: "terminal_1",
      localRegisterSessionId: "session_open",
      localEventId: "event_1",
      sequence: 1,
      conflictType: "payment",
      status: "needs_review",
      summary: "Payment needs manager review.",
      details: {},
      createdAt: 1,
    };
    const ctx = createQueryCtx({
      posLocalSyncConflict: [conflict],
      posLocalSyncMapping: [],
      registerSession: [
        {
          _id: "session_open",
          storeId: "store_1",
          terminalId: "terminal_1",
        },
      ],
    });

    await expect(
      listOpenLocalSyncConflictsByRegisterSession(
        ctx as never,
        "store_1" as Id<"store">,
      ),
    ).resolves.toEqual(
      new Map([
        ["session_open", [expect.objectContaining({ _id: "sync_conflict_1" })]],
      ]),
    );
  });

  it("maps open sync conflicts through local register-session sync mappings", async () => {
    const conflict = {
      _id: "sync_conflict_1",
      storeId: "store_1",
      terminalId: "terminal_1",
      localRegisterSessionId: "local-register-1",
      localEventId: "event_1",
      sequence: 1,
      conflictType: "payment",
      status: "needs_review",
      summary: "Payment needs manager review.",
      details: {},
      createdAt: 1,
    };
    const ctx = createQueryCtx({
      posLocalSyncConflict: [conflict],
      posLocalSyncMapping: [
        {
          _id: "sync_mapping_1",
          storeId: "store_1",
          terminalId: "terminal_1",
          localRegisterSessionId: "local-register-1",
          localIdKind: "registerSession",
          localId: "local-register-1",
          cloudTable: "registerSession",
          cloudId: "session_open",
        },
      ],
      registerSession: [
        {
          _id: "session_open",
          storeId: "store_1",
          terminalId: "terminal_1",
        },
      ],
    });

    await expect(
      listOpenLocalSyncConflictsByRegisterSession(
        ctx as never,
        "store_1" as Id<"store">,
      ),
    ).resolves.toEqual(
      new Map([
        ["session_open", [expect.objectContaining({ _id: "sync_conflict_1" })]],
      ]),
    );
  });

  it("excludes resolved sync conflicts from register-session reconciliation", async () => {
    const ctx = createQueryCtx({
      posLocalSyncConflict: [
        {
          _id: "sync_conflict_resolved",
          storeId: "store_1",
          terminalId: "terminal_1",
          localRegisterSessionId: "local-register-1",
          localEventId: "event_1",
          sequence: 1,
          conflictType: "payment",
          status: "resolved",
          summary: "Payment was reviewed.",
          details: {},
          createdAt: 1,
          resolvedAt: 2,
        },
      ],
      posLocalSyncMapping: [
        {
          _id: "sync_mapping_1",
          storeId: "store_1",
          terminalId: "terminal_1",
          localRegisterSessionId: "local-register-1",
          localIdKind: "registerSession",
          localId: "local-register-1",
          cloudTable: "registerSession",
          cloudId: "session_open",
        },
      ],
      registerSession: [{ _id: "session_open" }],
    });

    await expect(
      listOpenLocalSyncConflictsByRegisterSession(
        ctx as never,
        "store_1" as Id<"store">,
      ),
    ).resolves.toEqual(new Map());
  });

  it("resolves register-session sync review conflicts with manager staff", async () => {
    const ctx = createAuthorizedRegisterDepositCtx({
      operationalEvent: [],
      posLocalSyncConflict: [
        {
          _id: "sync_conflict_1",
          storeId: "store_1",
          terminalId: "terminal_1",
          localRegisterSessionId: "local-register-1",
          localEventId: "event_1",
          sequence: 1,
          conflictType: "permission",
          status: "needs_review",
          summary: "Register was not open before this sale synced.",
          details: {},
          createdAt: 1,
        },
      ],
      posLocalSyncEvent: [
        {
          _id: "sync_event_1",
          storeId: "store_1",
          terminalId: "terminal_1",
          localRegisterSessionId: "local-register-1",
          localEventId: "event_1",
          sequence: 1,
          eventType: "sale_completed",
          occurredAt: 2,
          staffProfileId: "staff_1",
          payload: {
            localPosSessionId: "local-pos-session-1",
            localTransactionId: "local-transaction-1",
            localReceiptNumber: "885447",
            receiptNumber: "885447",
            registerNumber: "1",
            totals: {
              subtotal: 15000,
              tax: 0,
              total: 15000,
            },
            items: [
              {
                localTransactionItemId: "local-item-1",
                productId: "product_1",
                productSkuId: "product_sku_1",
                productName: "Wig Cap",
                productSku: "CAP-1",
                quantity: 1,
                unitPrice: 15000,
              },
            ],
            payments: [
              {
                localPaymentId: "local-payment-1",
                method: "cash",
                amount: 15000,
                timestamp: 3,
              },
            ],
          },
          status: "conflicted",
          submittedAt: 4,
          acceptedAt: 4,
        },
      ],
      posLocalSyncMapping: [
        {
          _id: "sync_mapping_1",
          storeId: "store_1",
          terminalId: "terminal_1",
          localRegisterSessionId: "local-register-1",
          localIdKind: "registerSession",
          localId: "local-register-1",
          cloudTable: "registerSession",
          cloudId: "session_open",
        },
      ],
      registerSession: [
        {
          _id: "session_open",
          expectedCash: 50000,
          openedAt: 1,
          openingFloat: 10000,
          organizationId: "org_1",
          registerNumber: "1",
          status: "closed",
          storeId: "store_1",
          terminalId: "terminal_1",
        },
      ],
      posTerminal: [
        {
          _id: "terminal_1",
          registerNumber: "1",
          registeredByUserId: "athena_user_1",
          status: "active",
          storeId: "store_1",
        },
      ],
      product: [
        {
          _id: "product_1",
          storeId: "store_1",
        },
      ],
      productSku: [
        {
          _id: "product_sku_1",
          images: [],
          inventoryCount: 10,
          price: 15000,
          productId: "product_1",
          quantityAvailable: 10,
          sku: "CAP-1",
          storeId: "store_1",
        },
      ],
      staffProfile: [
        {
          _id: "manager_1",
          organizationId: "org_1",
          status: "active",
          storeId: "store_1",
        },
        {
          _id: "staff_1",
          organizationId: "org_1",
          status: "active",
          storeId: "store_1",
        },
      ],
      staffRoleAssignment: [
        {
          _id: "role_1",
          organizationId: "org_1",
          role: "manager",
          staffProfileId: "manager_1",
          status: "active",
          storeId: "store_1",
        },
        {
          _id: "role_2",
          organizationId: "org_1",
          role: "cashier",
          staffProfileId: "staff_1",
          status: "active",
          storeId: "store_1",
        },
      ],
    });

    const result = await getHandler(resolveRegisterSessionSyncReview)(
      ctx as never,
      {
        actorStaffProfileId: "manager_1" as Id<"staffProfile">,
        registerSessionId: "session_open" as Id<"registerSession">,
        storeId: "store_1" as Id<"store">,
      },
    );

    expect(result).toEqual(
      ok({
        action: "resolved",
        projectedCount: 1,
        registerSession: expect.objectContaining({ _id: "session_open" }),
        resolvedCount: 1,
      }),
    );
    expect(ctx.tables.get("posLocalSyncConflict")).toEqual([
      expect.objectContaining({
        _id: "sync_conflict_1",
        resolvedByStaffProfileId: "manager_1",
        status: "resolved",
      }),
    ]);
    expect(ctx.tables.get("posLocalSyncEvent")).toEqual([
      expect.objectContaining({
        _id: "sync_event_1",
        projectedAt: expect.any(Number),
        status: "projected",
      }),
    ]);
    expect(ctx.tables.get("posTransaction")).toEqual([
      expect.objectContaining({
        registerSessionId: "session_open",
        total: 15000,
        transactionNumber: "885447",
      }),
    ]);
    expect(ctx.tables.get("registerSession")).toEqual([
      expect.objectContaining({
        _id: "session_open",
        expectedCash: 65000,
      }),
    ]);
    expect(ctx.tables.get("operationalEvent")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actorStaffProfileId: "manager_1",
          eventType: "register_session_sync_review_resolved",
          metadata: expect.objectContaining({
            projectedTransactionIds: ["posTransaction_1"],
          }),
          registerSessionId: "session_open",
        }),
      ]),
    );
  });

  it("applies proofless staff-access sync reviews after manager approval", async () => {
    const ctx = createAuthorizedRegisterDepositCtx({
      operationalEvent: [],
      posLocalSyncConflict: [
        {
          _id: "sync_conflict_open",
          storeId: "store_1",
          terminalId: "terminal_1",
          localRegisterSessionId: "local-register-1",
          localEventId: "event_open",
          sequence: 6,
          conflictType: "permission",
          status: "needs_review",
          summary: "Staff access changed before this POS history synced.",
          details: {
            eventType: "register_opened",
            hasStaffProof: false,
            staffProfileId: "staff_1",
          },
          createdAt: 1,
        },
        {
          _id: "sync_conflict_sale",
          storeId: "store_1",
          terminalId: "terminal_1",
          localRegisterSessionId: "local-register-1",
          localEventId: "event_sale",
          sequence: 7,
          conflictType: "permission",
          status: "needs_review",
          summary: "Staff access changed before this POS history synced.",
          details: {
            eventType: "sale_completed",
            hasStaffProof: false,
            staffProfileId: "staff_1",
          },
          createdAt: 2,
        },
      ],
      posLocalSyncEvent: [
        {
          _id: "sync_event_open",
          storeId: "store_1",
          terminalId: "terminal_1",
          localRegisterSessionId: "local-register-1",
          localEventId: "event_open",
          sequence: 6,
          eventType: "register_opened",
          occurredAt: 2,
          staffProfileId: "staff_1",
          payload: {
            openingFloat: 35000,
            registerNumber: "1",
          },
          status: "conflicted",
          submittedAt: 4,
          acceptedAt: 4,
        },
        {
          _id: "sync_event_sale",
          storeId: "store_1",
          terminalId: "terminal_1",
          localRegisterSessionId: "local-register-1",
          localEventId: "event_sale",
          sequence: 7,
          eventType: "sale_completed",
          occurredAt: 3,
          staffProfileId: "staff_1",
          payload: {
            localPosSessionId: "local-pos-session-1",
            localTransactionId: "local-transaction-1",
            localReceiptNumber: "881GJJ-001",
            receiptNumber: "881GJJ-001",
            registerNumber: "1",
            totals: {
              subtotal: 15000,
              tax: 0,
              total: 15000,
            },
            items: [
              {
                localTransactionItemId: "local-item-1",
                productId: "product_1",
                productSkuId: "product_sku_1",
                productName: "Wig Cap",
                productSku: "CAP-1",
                quantity: 1,
                unitPrice: 15000,
              },
            ],
            payments: [
              {
                localPaymentId: "local-payment-1",
                method: "cash",
                amount: 15000,
                timestamp: 3,
              },
            ],
          },
          status: "conflicted",
          submittedAt: 4,
          acceptedAt: 4,
        },
      ],
      posLocalSyncMapping: [
        {
          _id: "sync_mapping_register",
          storeId: "store_1",
          terminalId: "terminal_1",
          localRegisterSessionId: "local-register-1",
          localIdKind: "registerSession",
          localId: "local-register-1",
          cloudTable: "registerSession",
          cloudId: "session_open",
        },
      ],
      registerSession: [
        {
          _id: "session_open",
          expectedCash: 35000,
          openedAt: 1,
          openingFloat: 35000,
          organizationId: "org_1",
          registerNumber: "1",
          status: "active",
          storeId: "store_1",
          terminalId: "terminal_1",
        },
      ],
      posTerminal: [
        {
          _id: "terminal_1",
          registerNumber: "1",
          registeredByUserId: "athena_user_1",
          status: "active",
          storeId: "store_1",
        },
      ],
      product: [
        {
          _id: "product_1",
          storeId: "store_1",
        },
      ],
      productSku: [
        {
          _id: "product_sku_1",
          images: [],
          inventoryCount: 10,
          price: 15000,
          productId: "product_1",
          quantityAvailable: 10,
          sku: "CAP-1",
          storeId: "store_1",
        },
      ],
      staffProfile: [
        {
          _id: "manager_1",
          organizationId: "org_1",
          status: "active",
          storeId: "store_1",
        },
        {
          _id: "staff_1",
          organizationId: "org_1",
          status: "active",
          storeId: "store_1",
        },
      ],
      staffRoleAssignment: [
        {
          _id: "role_1",
          organizationId: "org_1",
          role: "manager",
          staffProfileId: "manager_1",
          status: "active",
          storeId: "store_1",
        },
        {
          _id: "role_2",
          organizationId: "org_1",
          role: "cashier",
          staffProfileId: "staff_1",
          status: "active",
          storeId: "store_1",
        },
      ],
    });

    const result = await getHandler(resolveRegisterSessionSyncReview)(
      ctx as never,
      {
        actorStaffProfileId: "manager_1" as Id<"staffProfile">,
        registerSessionId: "session_open" as Id<"registerSession">,
        storeId: "store_1" as Id<"store">,
      },
    );

    expect(result).toEqual(
      ok({
        action: "resolved",
        projectedCount: 1,
        registerSession: expect.objectContaining({ _id: "session_open" }),
        resolvedCount: 2,
      }),
    );
    expect(ctx.tables.get("posLocalSyncConflict")).toEqual([
      expect.objectContaining({
        _id: "sync_conflict_open",
        resolvedByStaffProfileId: "manager_1",
        status: "resolved",
      }),
      expect.objectContaining({
        _id: "sync_conflict_sale",
        resolvedByStaffProfileId: "manager_1",
        status: "resolved",
      }),
    ]);
    expect(ctx.tables.get("posLocalSyncEvent")).toEqual([
      expect.objectContaining({
        _id: "sync_event_open",
        projectedAt: expect.any(Number),
        status: "projected",
      }),
      expect.objectContaining({
        _id: "sync_event_sale",
        projectedAt: expect.any(Number),
        status: "projected",
      }),
    ]);
    expect(ctx.tables.get("posTransaction")).toEqual([
      expect.objectContaining({
        registerSessionId: "session_open",
        total: 15000,
        transactionNumber: "881GJJ-001",
      }),
    ]);
    expect(ctx.tables.get("registerSession")).toEqual([
      expect.objectContaining({
        _id: "session_open",
        expectedCash: 50000,
      }),
    ]);
  });

  it("does not apply staff-access reviews that had an invalid proof", async () => {
    const ctx = createAuthorizedRegisterDepositCtx({
      posLocalSyncConflict: [
        {
          _id: "sync_conflict_sale",
          storeId: "store_1",
          terminalId: "terminal_1",
          localRegisterSessionId: "local-register-1",
          localEventId: "event_sale",
          sequence: 7,
          conflictType: "permission",
          status: "needs_review",
          summary: "Staff access changed before this POS history synced.",
          details: {
            eventType: "sale_completed",
            hasStaffProof: true,
            staffProfileId: "staff_1",
          },
          createdAt: 2,
        },
      ],
      posLocalSyncEvent: [
        {
          _id: "sync_event_sale",
          storeId: "store_1",
          terminalId: "terminal_1",
          localRegisterSessionId: "local-register-1",
          localEventId: "event_sale",
          sequence: 7,
          eventType: "sale_completed",
          occurredAt: 3,
          staffProfileId: "staff_1",
          payload: {},
          status: "conflicted",
          submittedAt: 4,
          acceptedAt: 4,
        },
      ],
      posLocalSyncMapping: [
        {
          _id: "sync_mapping_register",
          storeId: "store_1",
          terminalId: "terminal_1",
          localRegisterSessionId: "local-register-1",
          localIdKind: "registerSession",
          localId: "local-register-1",
          cloudTable: "registerSession",
          cloudId: "session_open",
        },
      ],
      registerSession: [
        {
          _id: "session_open",
          expectedCash: 35000,
          openedAt: 1,
          openingFloat: 35000,
          organizationId: "org_1",
          registerNumber: "1",
          status: "active",
          storeId: "store_1",
          terminalId: "terminal_1",
        },
      ],
      staffProfile: [
        {
          _id: "manager_1",
          organizationId: "org_1",
          status: "active",
          storeId: "store_1",
        },
        {
          _id: "staff_1",
          organizationId: "org_1",
          status: "active",
          storeId: "store_1",
        },
      ],
      staffRoleAssignment: [
        {
          _id: "role_1",
          organizationId: "org_1",
          role: "manager",
          staffProfileId: "manager_1",
          status: "active",
          storeId: "store_1",
        },
        {
          _id: "role_2",
          organizationId: "org_1",
          role: "cashier",
          staffProfileId: "staff_1",
          status: "active",
          storeId: "store_1",
        },
      ],
    });

    await expect(
      getHandler(resolveRegisterSessionSyncReview)(ctx as never, {
        actorStaffProfileId: "manager_1" as Id<"staffProfile">,
        registerSessionId: "session_open" as Id<"registerSession">,
        storeId: "store_1" as Id<"store">,
      }),
    ).resolves.toEqual(
      userError({
        code: "precondition_failed",
        message:
          "This register review still needs attention before the synced activity can be applied.",
      }),
    );
  });

  it("automatically applies proofless staff-access synced sales without manager approval", async () => {
    const ctx = createAuthorizedRegisterDepositCtx({
      operationalEvent: [],
      posLocalSyncConflict: [
        {
          _id: "sync_conflict_sale",
          storeId: "store_1",
          terminalId: "terminal_1",
          localRegisterSessionId: "local-register-1",
          localEventId: "event_sale",
          sequence: 7,
          conflictType: "permission",
          status: "needs_review",
          summary: "Staff access changed before this POS history synced.",
          details: {
            eventType: "sale_completed",
            hasStaffProof: false,
            staffProfileId: "staff_1",
          },
          createdAt: 2,
        },
      ],
      posLocalSyncEvent: [
        {
          _id: "sync_event_sale",
          storeId: "store_1",
          terminalId: "terminal_1",
          localRegisterSessionId: "local-register-1",
          localEventId: "event_sale",
          sequence: 7,
          eventType: "sale_completed",
          occurredAt: 3,
          staffProfileId: "staff_1",
          payload: {
            localPosSessionId: "local-pos-session-1",
            localTransactionId: "local-transaction-1",
            localReceiptNumber: "881GJJ-002",
            receiptNumber: "881GJJ-002",
            registerNumber: "1",
            totals: {
              subtotal: 15000,
              tax: 0,
              total: 15000,
            },
            items: [
              {
                localTransactionItemId: "local-item-1",
                productId: "product_1",
                productSkuId: "product_sku_1",
                productName: "Wig Cap",
                productSku: "CAP-1",
                quantity: 1,
                unitPrice: 15000,
              },
            ],
            payments: [
              {
                localPaymentId: "local-payment-1",
                method: "cash",
                amount: 15000,
                timestamp: 3,
              },
            ],
          },
          status: "conflicted",
          submittedAt: 4,
          acceptedAt: 4,
        },
      ],
      posLocalSyncMapping: [
        {
          _id: "sync_mapping_register",
          storeId: "store_1",
          terminalId: "terminal_1",
          localRegisterSessionId: "local-register-1",
          localIdKind: "registerSession",
          localId: "local-register-1",
          cloudTable: "registerSession",
          cloudId: "session_open",
        },
      ],
      registerSession: [
        {
          _id: "session_open",
          expectedCash: 35000,
          openedAt: 1,
          openingFloat: 35000,
          organizationId: "org_1",
          registerNumber: "1",
          status: "active",
          storeId: "store_1",
          terminalId: "terminal_1",
        },
      ],
      posTerminal: [
        {
          _id: "terminal_1",
          registerNumber: "1",
          registeredByUserId: "athena_user_1",
          status: "active",
          storeId: "store_1",
        },
      ],
      product: [
        {
          _id: "product_1",
          storeId: "store_1",
        },
      ],
      productSku: [
        {
          _id: "product_sku_1",
          images: [],
          inventoryCount: 10,
          price: 15000,
          productId: "product_1",
          quantityAvailable: 10,
          sku: "CAP-1",
          storeId: "store_1",
        },
      ],
      staffProfile: [
        {
          _id: "staff_1",
          organizationId: "org_1",
          status: "active",
          storeId: "store_1",
        },
      ],
      staffRoleAssignment: [
        {
          _id: "role_1",
          organizationId: "org_1",
          role: "cashier",
          staffProfileId: "staff_1",
          status: "active",
          storeId: "store_1",
        },
      ],
    });

    const result = await getHandler(resolveRegisterSessionSyncReview)(
      ctx as never,
      {
        registerSessionId: "session_open" as Id<"registerSession">,
        storeId: "store_1" as Id<"store">,
      },
    );

    expect(result).toEqual(
      ok({
        action: "resolved",
        projectedCount: 1,
        registerSession: expect.objectContaining({ _id: "session_open" }),
        resolvedCount: 1,
      }),
    );
    expect(ctx.tables.get("posLocalSyncConflict")).toEqual([
      expect.objectContaining({
        _id: "sync_conflict_sale",
        status: "resolved",
      }),
    ]);
    expect(ctx.tables.get("posLocalSyncConflict")?.[0]).not.toHaveProperty(
      "resolvedByStaffProfileId",
    );
    expect(ctx.tables.get("posLocalSyncEvent")).toEqual([
      expect.objectContaining({
        _id: "sync_event_sale",
        projectedAt: expect.any(Number),
        status: "projected",
      }),
    ]);
    expect(ctx.tables.get("posTransaction")).toEqual([
      expect.objectContaining({
        registerSessionId: "session_open",
        total: 15000,
        transactionNumber: "881GJJ-002",
      }),
    ]);
    expect(ctx.tables.get("operationalEvent")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actorUserId: "athena_user_1",
          eventType: "register_session_sync_review_resolved",
          message: "Automatically applied proofless synced register sale.",
        }),
      ]),
    );
  });

  it("does not automatically apply non-proofless synced reviews", async () => {
    const ctx = createAuthorizedRegisterDepositCtx({
      posLocalSyncConflict: [
        {
          _id: "sync_conflict_sale",
          storeId: "store_1",
          terminalId: "terminal_1",
          localRegisterSessionId: "local-register-1",
          localEventId: "event_sale",
          sequence: 7,
          conflictType: "permission",
          status: "needs_review",
          summary: "Staff access changed before this POS history synced.",
          details: {
            eventType: "sale_completed",
            hasStaffProof: true,
            staffProfileId: "staff_1",
          },
          createdAt: 2,
        },
      ],
      posLocalSyncEvent: [
        {
          _id: "sync_event_sale",
          storeId: "store_1",
          terminalId: "terminal_1",
          localRegisterSessionId: "local-register-1",
          localEventId: "event_sale",
          sequence: 7,
          eventType: "sale_completed",
          occurredAt: 3,
          staffProfileId: "staff_1",
          payload: {},
          status: "conflicted",
          submittedAt: 4,
          acceptedAt: 4,
        },
      ],
      posLocalSyncMapping: [
        {
          _id: "sync_mapping_register",
          storeId: "store_1",
          terminalId: "terminal_1",
          localRegisterSessionId: "local-register-1",
          localIdKind: "registerSession",
          localId: "local-register-1",
          cloudTable: "registerSession",
          cloudId: "session_open",
        },
      ],
      registerSession: [
        {
          _id: "session_open",
          expectedCash: 35000,
          openedAt: 1,
          openingFloat: 35000,
          organizationId: "org_1",
          registerNumber: "1",
          status: "active",
          storeId: "store_1",
          terminalId: "terminal_1",
        },
      ],
    });

    const result = await getHandler(resolveRegisterSessionSyncReview)(
      ctx as never,
      {
        registerSessionId: "session_open" as Id<"registerSession">,
        storeId: "store_1" as Id<"store">,
      },
    );

    expect(result).toEqual(
      userError({
        code: "precondition_failed",
        message:
          "This register review is not eligible for automatic sync repair.",
      }),
    );
    expect(ctx.tables.get("posLocalSyncEvent")).toEqual([
      expect.objectContaining({
        _id: "sync_event_sale",
        status: "conflicted",
      }),
    ]);
    expect(ctx.tables.get("posTransaction") ?? []).toEqual([]);
  });

  it("lets managers override and project server-rejected synced sales", async () => {
    const ctx = createAuthorizedRegisterDepositCtx({
      operationalEvent: [],
      posLocalSyncEvent: [
        {
          _id: "sync_event_rejected",
          storeId: "store_1",
          terminalId: "terminal_1",
          localRegisterSessionId: "local-register-1",
          localEventId: "event_rejected_sale",
          sequence: 4,
          eventType: "sale_completed",
          occurredAt: 2,
          staffProfileId: "staff_1",
          payload: {
            localPosSessionId: "local-pos-session-1",
            localTransactionId: "local-transaction-1",
            localReceiptNumber: "885447",
            receiptNumber: "885447",
            registerNumber: "1",
            totals: {
              subtotal: 15000,
              tax: 0,
              total: 15000,
            },
            items: [
              {
                localTransactionItemId: "local-item-1",
                productId: "product_1",
                productSkuId: "product_sku_1",
                productName: "Wig Cap",
                productSku: "CAP-1",
                quantity: 1,
                unitPrice: 15000,
              },
            ],
            payments: [
              {
                localPaymentId: "local-payment-1",
                method: "cash",
                amount: 15000,
                timestamp: 3,
              },
            ],
          },
          status: "rejected",
          rejectionCode: "manager_override_available",
          rejectionMessage:
            "Server rejected synced register activity for this drawer.",
          submittedAt: 4,
          acceptedAt: 4,
        },
      ],
      posLocalSyncMapping: [
        {
          _id: "sync_mapping_1",
          storeId: "store_1",
          terminalId: "terminal_1",
          localRegisterSessionId: "local-register-1",
          localIdKind: "registerSession",
          localId: "local-register-1",
          cloudTable: "registerSession",
          cloudId: "session_open",
        },
      ],
      registerSession: [
        {
          _id: "session_open",
          expectedCash: 50000,
          openedAt: 1,
          openingFloat: 10000,
          organizationId: "org_1",
          registerNumber: "1",
          status: "closed",
          storeId: "store_1",
          terminalId: "terminal_1",
        },
      ],
      posTerminal: [
        {
          _id: "terminal_1",
          registerNumber: "1",
          registeredByUserId: "athena_user_1",
          status: "active",
          storeId: "store_1",
        },
      ],
      product: [
        {
          _id: "product_1",
          storeId: "store_1",
        },
      ],
      productSku: [
        {
          _id: "product_sku_1",
          images: [],
          inventoryCount: 10,
          price: 15000,
          productId: "product_1",
          quantityAvailable: 10,
          sku: "CAP-1",
          storeId: "store_1",
        },
      ],
      staffProfile: [
        {
          _id: "manager_1",
          organizationId: "org_1",
          status: "active",
          storeId: "store_1",
        },
        {
          _id: "staff_1",
          organizationId: "org_1",
          status: "active",
          storeId: "store_1",
        },
      ],
      staffRoleAssignment: [
        {
          _id: "role_1",
          organizationId: "org_1",
          role: "manager",
          staffProfileId: "manager_1",
          status: "active",
          storeId: "store_1",
        },
        {
          _id: "role_2",
          organizationId: "org_1",
          role: "cashier",
          staffProfileId: "staff_1",
          status: "active",
          storeId: "store_1",
        },
      ],
    });

    const result = await getHandler(resolveRegisterSessionSyncReview)(
      ctx as never,
      {
        actorStaffProfileId: "manager_1" as Id<"staffProfile">,
        registerSessionId: "session_open" as Id<"registerSession">,
        storeId: "store_1" as Id<"store">,
      },
    );

    expect(result).toEqual(
      ok({
        action: "resolved",
        projectedCount: 1,
        registerSession: expect.objectContaining({ _id: "session_open" }),
        resolvedCount: 1,
      }),
    );
    expect(ctx.tables.get("posLocalSyncEvent")).toEqual([
      expect.objectContaining({
        _id: "sync_event_rejected",
        projectedAt: expect.any(Number),
        status: "projected",
      }),
    ]);
    expect(ctx.tables.get("posTransaction")).toEqual([
      expect.objectContaining({
        registerSessionId: "session_open",
        total: 15000,
        transactionNumber: "885447",
      }),
    ]);
    expect(ctx.tables.get("operationalEvent")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actorStaffProfileId: "manager_1",
          eventType: "register_session_sync_review_resolved",
          message: "Manager override applied rejected synced register sale.",
          metadata: expect.objectContaining({
            conflictIds: ["sync_event_rejected"],
            conflictTypes: ["server_rejected"],
            localEventIds: ["event_rejected_sale"],
            managerOverride: true,
            originalStatuses: ["rejected"],
            projectedTransactionIds: ["posTransaction_1"],
            sequences: [4],
          }),
          registerSessionId: "session_open",
        }),
      ]),
    );
  });

  it("settles server-rejected synced activity when a manager rejects it", async () => {
    const ctx = createAuthorizedRegisterDepositCtx({
      posLocalSyncEvent: [
        {
          _id: "sync_event_rejected",
          storeId: "store_1",
          terminalId: "terminal_1",
          localRegisterSessionId: "local-register-1",
          localEventId: "event_rejected_sale",
          sequence: 4,
          eventType: "sale_completed",
          occurredAt: 2,
          staffProfileId: "staff_1",
          payload: {},
          status: "rejected",
          rejectionCode: "validation_failed",
          rejectionMessage:
            "Server rejected synced register activity for this drawer.",
          submittedAt: 4,
          acceptedAt: 4,
        },
      ],
      posLocalSyncMapping: [
        {
          _id: "sync_mapping_1",
          storeId: "store_1",
          terminalId: "terminal_1",
          localRegisterSessionId: "local-register-1",
          localIdKind: "registerSession",
          localId: "local-register-1",
          cloudTable: "registerSession",
          cloudId: "session_open",
        },
      ],
      registerSession: [
        {
          _id: "session_open",
          expectedCash: 50000,
          openedAt: 1,
          openingFloat: 10000,
          organizationId: "org_1",
          registerNumber: "1",
          status: "closed",
          storeId: "store_1",
          terminalId: "terminal_1",
        },
      ],
      staffProfile: [
        {
          _id: "manager_1",
          organizationId: "org_1",
          status: "active",
          storeId: "store_1",
        },
        {
          _id: "staff_1",
          organizationId: "org_1",
          status: "active",
          storeId: "store_1",
        },
      ],
      staffRoleAssignment: [
        {
          _id: "role_1",
          organizationId: "org_1",
          role: "manager",
          staffProfileId: "manager_1",
          status: "active",
          storeId: "store_1",
        },
      ],
    });

    const result = await getHandler(resolveRegisterSessionSyncReview)(
      ctx as never,
      {
        actorStaffProfileId: "manager_1" as Id<"staffProfile">,
        decision: "rejected",
        registerSessionId: "session_open" as Id<"registerSession">,
        storeId: "store_1" as Id<"store">,
      },
    );

    expect(result).toEqual(
      ok({
        action: "rejected",
        projectedCount: 0,
        registerSession: expect.objectContaining({ _id: "session_open" }),
        resolvedCount: 1,
      }),
    );
    expect(ctx.tables.get("posLocalSyncEvent")).toEqual([
      expect.objectContaining({
        _id: "sync_event_rejected",
        rejectionCode: "manager_rejected",
        rejectionMessage:
          "Manager rejected synced register activity during cash-controls review.",
        status: "rejected",
      }),
    ]);
    await expect(
      listOpenLocalSyncConflictsByRegisterSession(
        ctx as never,
        "store_1" as Id<"store">,
        { includeRejectedEvidence: true },
      ),
    ).resolves.toEqual(new Map());
  });

  it("explains why synced service sales without customer attribution cannot be approved", async () => {
    const ctx = createAuthorizedRegisterDepositCtx({
      posLocalSyncConflict: [
        {
          _id: "sync_conflict_service_customer",
          storeId: "store_1",
          terminalId: "terminal_1",
          localRegisterSessionId: "local-register-1",
          localEventId: "event_service_sale",
          sequence: 2,
          conflictType: "permission",
          status: "needs_review",
          summary: "Service line is missing customer attribution.",
          details: {},
          createdAt: 1,
        },
      ],
      posLocalSyncEvent: [
        {
          _id: "sync_event_service",
          storeId: "store_1",
          terminalId: "terminal_1",
          localRegisterSessionId: "local-register-1",
          localEventId: "event_service_sale",
          sequence: 2,
          eventType: "sale_completed",
          occurredAt: 2,
          staffProfileId: "staff_1",
          payload: {},
          status: "conflicted",
          submittedAt: 4,
          acceptedAt: 4,
        },
      ],
      posLocalSyncMapping: [
        {
          _id: "sync_mapping_1",
          storeId: "store_1",
          terminalId: "terminal_1",
          localRegisterSessionId: "local-register-1",
          localIdKind: "registerSession",
          localId: "local-register-1",
          cloudTable: "registerSession",
          cloudId: "session_open",
        },
      ],
      registerSession: [
        {
          _id: "session_open",
          expectedCash: 50000,
          openedAt: 1,
          openingFloat: 10000,
          organizationId: "org_1",
          registerNumber: "1",
          status: "closed",
          storeId: "store_1",
          terminalId: "terminal_1",
        },
      ],
      staffProfile: [
        {
          _id: "manager_1",
          organizationId: "org_1",
          status: "active",
          storeId: "store_1",
        },
        {
          _id: "staff_1",
          organizationId: "org_1",
          status: "active",
          storeId: "store_1",
        },
      ],
      staffRoleAssignment: [
        {
          _id: "role_1",
          organizationId: "org_1",
          role: "manager",
          staffProfileId: "manager_1",
          status: "active",
          storeId: "store_1",
        },
      ],
    });

    await expect(
      getHandler(resolveRegisterSessionSyncReview)(ctx as never, {
        actorStaffProfileId: "manager_1" as Id<"staffProfile">,
        registerSessionId: "session_open" as Id<"registerSession">,
        storeId: "store_1" as Id<"store">,
      }),
    ).resolves.toEqual(
      userError({
        code: "precondition_failed",
        message:
          "This synced service sale is missing customer attribution. Reject the synced activity to clear this review, then recreate the service work with a customer if needed.",
      }),
    );
  });

  it("rejects sync review resolution from non-manager staff", async () => {
    const ctx = createAuthorizedRegisterDepositCtx({
      posLocalSyncConflict: [
        {
          _id: "sync_conflict_1",
          storeId: "store_1",
          terminalId: "terminal_1",
          localRegisterSessionId: "session_open",
          localEventId: "event_1",
          sequence: 1,
          conflictType: "permission",
          status: "needs_review",
          summary: "Register was not open before this sale synced.",
          details: {},
          createdAt: 1,
        },
      ],
      registerSession: [
        {
          _id: "session_open",
          expectedCash: 50000,
          openedAt: 1,
          openingFloat: 10000,
          organizationId: "org_1",
          registerNumber: "1",
          status: "closed",
          storeId: "store_1",
          terminalId: "terminal_1",
        },
      ],
      staffProfile: [
        {
          _id: "staff_1",
          organizationId: "org_1",
          status: "active",
          storeId: "store_1",
        },
      ],
      staffRoleAssignment: [
        {
          _id: "role_1",
          organizationId: "org_1",
          role: "cashier",
          staffProfileId: "staff_1",
          status: "active",
          storeId: "store_1",
        },
      ],
    });

    await expect(
      getHandler(resolveRegisterSessionSyncReview)(ctx as never, {
        actorStaffProfileId: "staff_1" as Id<"staffProfile">,
        registerSessionId: "session_open" as Id<"registerSession">,
        storeId: "store_1" as Id<"store">,
      }),
    ).resolves.toEqual(
      userError({
        code: "authorization_failed",
        message: "Only managers can resolve synced register reviews.",
      }),
    );
    expect(ctx.tables.get("posLocalSyncConflict")).toEqual([
      expect.objectContaining({
        _id: "sync_conflict_1",
        status: "needs_review",
      }),
    ]);
  });

  it("applies reviewed synced closeouts with variance after manager approval", async () => {
    const ctx = createAuthorizedRegisterDepositCtx({
      operationalEvent: [],
      posLocalSyncConflict: [
        {
          _id: "sync_conflict_closeout",
          storeId: "store_1",
          terminalId: "terminal_1",
          localRegisterSessionId: "local-register-1",
          localEventId: "event_closeout",
          sequence: 2,
          conflictType: "permission",
          status: "needs_review",
          summary:
            "Register closeout variance requires manager review before synced closeout can be applied.",
          details: {
            countedCash: 45000,
            expectedCash: 50000,
            variance: -5000,
          },
          createdAt: 1,
        },
      ],
      posLocalSyncEvent: [
        {
          _id: "sync_event_closeout",
          storeId: "store_1",
          terminalId: "terminal_1",
          localRegisterSessionId: "local-register-1",
          localEventId: "event_closeout",
          sequence: 2,
          eventType: "register_closed",
          occurredAt: 2,
          staffProfileId: "staff_1",
          payload: {
            countedCash: 45000,
            notes: "I dont know",
          },
          status: "conflicted",
          submittedAt: 4,
          acceptedAt: 4,
        },
      ],
      posLocalSyncMapping: [
        {
          _id: "sync_mapping_1",
          storeId: "store_1",
          terminalId: "terminal_1",
          localRegisterSessionId: "local-register-1",
          localIdKind: "registerSession",
          localId: "local-register-1",
          cloudTable: "registerSession",
          cloudId: "session_open",
        },
      ],
      registerSession: [
        {
          _id: "session_open",
          closeoutRecords: [],
          expectedCash: 50000,
          openedAt: 1,
          openingFloat: 50000,
          organizationId: "org_1",
          registerNumber: "1",
          status: "active",
          storeId: "store_1",
          terminalId: "terminal_1",
        },
      ],
      posTerminal: [
        {
          _id: "terminal_1",
          registerNumber: "1",
          registeredByUserId: "athena_user_1",
          status: "active",
          storeId: "store_1",
        },
      ],
      staffProfile: [
        {
          _id: "manager_1",
          organizationId: "org_1",
          status: "active",
          storeId: "store_1",
        },
        {
          _id: "staff_1",
          organizationId: "org_1",
          status: "active",
          storeId: "store_1",
        },
      ],
      staffRoleAssignment: [
        {
          _id: "role_1",
          organizationId: "org_1",
          role: "manager",
          staffProfileId: "manager_1",
          status: "active",
          storeId: "store_1",
        },
        {
          _id: "role_2",
          organizationId: "org_1",
          role: "cashier",
          staffProfileId: "staff_1",
          status: "active",
          storeId: "store_1",
        },
      ],
    });

    const result = await getHandler(resolveRegisterSessionSyncReview)(
      ctx as never,
      {
        actorStaffProfileId: "manager_1" as Id<"staffProfile">,
        registerSessionId: "session_open" as Id<"registerSession">,
        storeId: "store_1" as Id<"store">,
      },
    );

    expect(result).toEqual(
      ok({
        action: "resolved",
        projectedCount: 0,
        registerSession: expect.objectContaining({
          _id: "session_open",
          status: "closed",
        }),
        resolvedCount: 1,
      }),
    );
    expect(ctx.tables.get("registerSession")).toEqual([
      expect.objectContaining({
        _id: "session_open",
        closeoutRecords: [
          expect.objectContaining({
            countedCash: 45000,
            expectedCash: 50000,
            notes: "I dont know",
            type: "closed",
            variance: -5000,
          }),
        ],
        countedCash: 45000,
        status: "closed",
        variance: -5000,
      }),
    ]);
    expect(ctx.tables.get("posLocalSyncEvent")).toEqual([
      expect.objectContaining({
        _id: "sync_event_closeout",
        projectedAt: expect.any(Number),
        status: "projected",
      }),
    ]);
    expect(ctx.tables.get("operationalEvent")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: "register_session_sync_review_resolved",
          message: "Applied reviewed synced register closeout.",
          metadata: expect.objectContaining({
            projectedCloseoutCount: 1,
          }),
        }),
      ]),
    );
  });

  it("explains that already-closed synced closeouts must be rejected", async () => {
    const ctx = createAuthorizedRegisterDepositCtx({
      posLocalSyncConflict: [
        {
          _id: "sync_conflict_closeout",
          storeId: "store_1",
          terminalId: "terminal_1",
          localRegisterSessionId: "session_closed",
          localEventId: "event_closeout",
          sequence: 2,
          conflictType: "permission",
          status: "needs_review",
          summary: "Register session is not open for synced POS closeout.",
          details: {
            localRegisterSessionId: "session_closed",
            status: "closed",
          },
          createdAt: 1,
        },
      ],
      posLocalSyncEvent: [
        {
          _id: "sync_event_closeout",
          storeId: "store_1",
          terminalId: "terminal_1",
          localRegisterSessionId: "session_closed",
          localEventId: "event_closeout",
          sequence: 2,
          eventType: "register_closed",
          occurredAt: 2,
          staffProfileId: "staff_1",
          payload: {
            countedCash: 50000,
          },
          status: "conflicted",
          submittedAt: 4,
          acceptedAt: 4,
        },
      ],
      registerSession: [
        {
          _id: "session_closed",
          closeoutRecords: [],
          countedCash: 50000,
          expectedCash: 50000,
          openedAt: 1,
          openingFloat: 50000,
          organizationId: "org_1",
          registerNumber: "1",
          status: "closed",
          storeId: "store_1",
          terminalId: "terminal_1",
          variance: 0,
        },
      ],
      staffProfile: [
        {
          _id: "manager_1",
          organizationId: "org_1",
          status: "active",
          storeId: "store_1",
        },
        {
          _id: "staff_1",
          organizationId: "org_1",
          status: "active",
          storeId: "store_1",
        },
      ],
      staffRoleAssignment: [
        {
          _id: "role_1",
          organizationId: "org_1",
          role: "manager",
          staffProfileId: "manager_1",
          status: "active",
          storeId: "store_1",
        },
      ],
    });

    const result = await getHandler(resolveRegisterSessionSyncReview)(
      ctx as never,
      {
        actorStaffProfileId: "manager_1" as Id<"staffProfile">,
        registerSessionId: "session_closed" as Id<"registerSession">,
        storeId: "store_1" as Id<"store">,
      },
    );

    expect(result).toEqual(
      userError({
        code: "precondition_failed",
        message:
          "This synced closeout cannot be applied because the register is already closed. Reject the synced activity to discard it.",
      }),
    );
    expect(ctx.tables.get("posLocalSyncEvent")).toEqual([
      expect.objectContaining({
        _id: "sync_event_closeout",
        status: "conflicted",
      }),
    ]);
  });

  it("ignores unmapped local register ids that are not valid cloud session ids", async () => {
    const conflict = {
      _id: "sync_conflict_1",
      storeId: "store_1",
      terminalId: "terminal_1",
      localRegisterSessionId: "local-register-1",
      localEventId: "event_1",
      sequence: 1,
      conflictType: "payment",
      status: "needs_review",
      summary: "Payment needs manager review.",
      details: {},
      createdAt: 1,
    };
    const ctx = createQueryCtx({
      posLocalSyncConflict: [conflict],
      posLocalSyncMapping: [],
      registerSession: [
        {
          _id: "session_open",
          storeId: "store_1",
          terminalId: "terminal_1",
        },
      ],
    });

    await expect(
      listOpenLocalSyncConflictsByRegisterSession(
        ctx as never,
        "store_1" as Id<"store">,
      ),
    ).resolves.toEqual(new Map());
  });

  it("surfaces rejected sync events as register-session evidence when requested", async () => {
    const ctx = createQueryCtx({
      posLocalSyncConflict: [],
      posLocalSyncEvent: [
        {
          _id: "sync_event_rejected",
          storeId: "store_1",
          terminalId: "terminal_1",
          localRegisterSessionId: "local-register-1",
          localEventId: "event_1",
          sequence: 1,
          eventType: "sale_completed",
          occurredAt: 2,
          staffProfileId: "staff_1",
          payload: {},
          rejectionMessage: "Register was closed before this sale synced.",
          status: "rejected",
          submittedAt: 3,
        },
      ],
      posLocalSyncMapping: [
        {
          _id: "sync_mapping_1",
          storeId: "store_1",
          terminalId: "terminal_1",
          localRegisterSessionId: "local-register-1",
          localIdKind: "registerSession",
          localId: "local-register-1",
          cloudTable: "registerSession",
          cloudId: "session_open",
        },
      ],
      registerSession: [{ _id: "session_open" }],
    });

    await expect(
      listOpenLocalSyncConflictsByRegisterSession(
        ctx as never,
        "store_1" as Id<"store">,
        { includeRejectedEvidence: true },
      ),
    ).resolves.toEqual(
      new Map([
        [
          "session_open",
          [
            expect.objectContaining({
              _id: "sync_event_rejected",
              status: "rejected",
              summary: "Register was closed before this sale synced.",
            }),
          ],
        ],
      ]),
    );
  });

  it("keeps resolved sync conflicts reviewable when the source event is still conflicted", async () => {
    const conflict = {
      _id: "sync_conflict_1",
      storeId: "store_1",
      terminalId: "terminal_1",
      localRegisterSessionId: "local-register-1",
      localEventId: "event_1",
      sequence: 1,
      conflictType: "permission",
      status: "resolved",
      summary:
        "Register closeout variance requires manager review before synced closeout can be applied.",
      details: {},
      createdAt: 1,
    };
    const ctx = createQueryCtx({
      posLocalSyncConflict: [conflict],
      posLocalSyncEvent: [
        {
          _id: "sync_event_1",
          storeId: "store_1",
          terminalId: "terminal_1",
          localRegisterSessionId: "local-register-1",
          localEventId: "event_1",
          sequence: 1,
          eventType: "register_closed",
          occurredAt: 2,
          staffProfileId: "staff_1",
          payload: { countedCash: 45000 },
          status: "conflicted",
          submittedAt: 3,
        },
      ],
      posLocalSyncMapping: [
        {
          _id: "sync_mapping_1",
          storeId: "store_1",
          terminalId: "terminal_1",
          localRegisterSessionId: "local-register-1",
          localIdKind: "registerSession",
          localId: "local-register-1",
          cloudTable: "registerSession",
          cloudId: "session_open",
        },
      ],
      registerSession: [
        {
          _id: "session_open",
          storeId: "store_1",
          terminalId: "terminal_1",
        },
      ],
    });

    await expect(
      listOpenLocalSyncConflictsByRegisterSession(
        ctx as never,
        "store_1" as Id<"store">,
      ),
    ).resolves.toEqual(
      new Map([
        [
          "session_open",
          [
            expect.objectContaining({
              _id: "sync_conflict_1",
              status: "needs_review",
            }),
          ],
        ],
      ]),
    );
  });

  it("surfaces resolved sync conflicts as rejected evidence when the source event is rejected", async () => {
    const conflict = {
      _id: "sync_conflict_1",
      storeId: "store_1",
      terminalId: "terminal_1",
      localRegisterSessionId: "local-register-1",
      localEventId: "event_1",
      sequence: 1,
      conflictType: "permission",
      status: "resolved",
      summary:
        "Register closeout variance requires manager review before synced closeout can be applied.",
      details: {},
      createdAt: 1,
    };
    const ctx = createQueryCtx({
      posLocalSyncConflict: [conflict],
      posLocalSyncEvent: [
        {
          _id: "sync_event_1",
          storeId: "store_1",
          terminalId: "terminal_1",
          localRegisterSessionId: "local-register-1",
          localEventId: "event_1",
          sequence: 1,
          eventType: "register_closed",
          occurredAt: 2,
          staffProfileId: "staff_1",
          payload: { countedCash: 45000 },
          rejectionMessage:
            "Manager rejected synced register activity during cash-controls review.",
          status: "rejected",
          submittedAt: 3,
        },
      ],
      posLocalSyncMapping: [
        {
          _id: "sync_mapping_1",
          storeId: "store_1",
          terminalId: "terminal_1",
          localRegisterSessionId: "local-register-1",
          localIdKind: "registerSession",
          localId: "local-register-1",
          cloudTable: "registerSession",
          cloudId: "session_open",
        },
      ],
      registerSession: [
        {
          _id: "session_open",
          storeId: "store_1",
          terminalId: "terminal_1",
        },
      ],
    });

    await expect(
      listOpenLocalSyncConflictsByRegisterSession(
        ctx as never,
        "store_1" as Id<"store">,
        { includeRejectedEvidence: true },
      ),
    ).resolves.toEqual(
      new Map([
        [
          "session_open",
          [
            expect.objectContaining({
              _id: "sync_conflict_1",
              status: "rejected",
              summary:
                "Manager rejected synced register activity during cash-controls review.",
            }),
          ],
        ],
      ]),
    );
  });

  it("resolves mapped sync conflicts beyond the dashboard session display limit", async () => {
    const olderConflicts = Array.from({ length: 100 }, (_, index) => ({
      _id: `sync_conflict_${index}`,
      storeId: "store_1",
      terminalId: "terminal_1",
      localRegisterSessionId: `local-register-${index}`,
      localEventId: `event_${index}`,
      sequence: index + 1,
      conflictType: "payment",
      status: "needs_review",
      summary: "Payment needs manager review.",
      details: {},
      createdAt: index,
    }));
    const targetConflict = {
      _id: "sync_conflict_target",
      storeId: "store_1",
      terminalId: "terminal_2",
      localRegisterSessionId: "local-register-target",
      localEventId: "event_target",
      sequence: 101,
      conflictType: "permission",
      status: "needs_review",
      summary: "Staff access changed.",
      details: {},
      createdAt: 101,
    };
    const ctx = createQueryCtx({
      posLocalSyncConflict: [...olderConflicts, targetConflict],
      posLocalSyncMapping: [
        {
          _id: "sync_mapping_target",
          storeId: "store_1",
          terminalId: "terminal_2",
          localRegisterSessionId: "local-register-target",
          localIdKind: "registerSession",
          localId: "local-register-target",
          cloudTable: "registerSession",
          cloudId: "session_target",
        },
      ],
      registerSession: [
        {
          _id: "session_target",
          storeId: "store_1",
          terminalId: "terminal_2",
        },
      ],
    });

    await expect(
      listOpenLocalSyncConflictsByRegisterSession(
        ctx as never,
        "store_1" as Id<"store">,
      ),
    ).resolves.toEqual(
      new Map([
        [
          "session_target",
          [expect.objectContaining({ _id: "sync_conflict_target" })],
        ],
      ]),
    );
  });

  it("includes register sessions with mapped sync conflicts outside the first dashboard page", async () => {
    const initialSessions = Array.from({ length: 100 }, (_, index) => ({
      _id: `session_${index}`,
      storeId: "store_1",
      terminalId: "terminal_1",
      registerNumber: `${index}`,
      status: "closed",
      openedAt: index,
      expectedCash: 0,
    }));
    const conflictedSession = {
      _id: "session_target",
      storeId: "store_1",
      terminalId: "terminal_2",
      registerNumber: "target",
      status: "active",
      openedAt: 101,
      expectedCash: 0,
    };
    const ctx = createQueryCtx({
      approvalRequest: [],
      athenaUser: [
        {
          _id: "athena_user_1",
          email: "operator@example.com",
        },
      ],
      organizationMember: [
        {
          _id: "member_1",
          organizationId: "org_1",
          role: "full_admin",
          userId: "athena_user_1",
        },
      ],
      paymentAllocation: [],
      posLocalSyncConflict: [
        {
          _id: "sync_conflict_target",
          storeId: "store_1",
          terminalId: "terminal_2",
          localRegisterSessionId: "local-register-target",
          localEventId: "event_target",
          sequence: 101,
          conflictType: "permission",
          status: "needs_review",
          summary: "Staff access changed.",
          details: {},
          createdAt: 101,
        },
      ],
      posLocalSyncMapping: [
        {
          _id: "sync_mapping_target",
          storeId: "store_1",
          terminalId: "terminal_2",
          localRegisterSessionId: "local-register-target",
          localIdKind: "registerSession",
          localId: "local-register-target",
          cloudTable: "registerSession",
          cloudId: "session_target",
        },
      ],
      posTerminal: [],
      registerSession: [...initialSessions, conflictedSession],
      staffProfile: [],
      store: [{ _id: "store_1", organizationId: "org_1" }],
      users: [{ _id: "auth_user_1", email: "operator@example.com" }],
    });

    await expect(
      getHandler(getDashboardSnapshot)(ctx as never, {
        storeId: "store_1" as Id<"store">,
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        openSessions: expect.arrayContaining([
          expect.objectContaining({
            _id: "session_target",
            localSyncStatus: expect.objectContaining({
              status: "needs_review",
            }),
          }),
        ]),
      }),
    );
  });

  it("rejects dashboard snapshots when the caller is unauthenticated", async () => {
    mockedAuthServer.getAuthUserId.mockResolvedValue(null);
    const ctx = createQueryCtx({
      store: [{ _id: "store_1", organizationId: "org_1" }],
    });

    await expect(
      getHandler(getDashboardSnapshot)(ctx as never, {
        storeId: "store_1" as Id<"store">,
      }),
    ).rejects.toThrow("Sign in again to continue.");
  });

  it("rejects dashboard snapshots when the caller lacks cash-control roles", async () => {
    const ctx = createQueryCtx({
      athenaUser: [{ _id: "athena_user_1", email: "operator@example.com" }],
      organizationMember: [
        {
          _id: "member_1",
          organizationId: "org_1",
          role: "staff",
          userId: "athena_user_1",
        },
      ],
      store: [{ _id: "store_1", organizationId: "org_1" }],
      users: [{ _id: "auth_user_1", email: "operator@example.com" }],
    });

    await expect(
      getHandler(getDashboardSnapshot)(ctx as never, {
        storeId: "store_1" as Id<"store">,
      }),
    ).rejects.toThrow("You do not have access to cash controls.");
  });

  it("rejects register-session snapshots when the caller is unauthenticated", async () => {
    mockedAuthServer.getAuthUserId.mockResolvedValue(null);
    const ctx = createQueryCtx({
      registerSession: [
        {
          _id: "session_open",
          storeId: "store_1",
        },
      ],
      store: [{ _id: "store_1", organizationId: "org_1" }],
    });

    await expect(
      getHandler(getRegisterSessionSnapshot)(ctx as never, {
        registerSessionId: "session_open" as Id<"registerSession">,
        storeId: "store_1" as Id<"store">,
      }),
    ).rejects.toThrow("Sign in again to continue.");
  });

  it("rejects register-session snapshots when the caller lacks cash-control roles", async () => {
    const ctx = createQueryCtx({
      athenaUser: [{ _id: "athena_user_1", email: "operator@example.com" }],
      organizationMember: [
        {
          _id: "member_1",
          organizationId: "org_1",
          role: "staff",
          userId: "athena_user_1",
        },
      ],
      registerSession: [{ _id: "session_open", storeId: "store_1" }],
      store: [{ _id: "store_1", organizationId: "org_1" }],
      users: [{ _id: "auth_user_1", email: "operator@example.com" }],
    });

    await expect(
      getHandler(getRegisterSessionSnapshot)(ctx as never, {
        registerSessionId: "session_open" as Id<"registerSession">,
        storeId: "store_1" as Id<"store">,
      }),
    ).rejects.toThrow("You do not have access to cash controls.");
  });

  it("exposes the deterministic register trace when the session link is missing", async () => {
    const ctx = createAuthorizedRegisterDepositCtx({
      registerSession: [
        {
          _id: "session_open",
          expectedCash: 50000,
          openedAt: 1,
          openingFloat: 10000,
          organizationId: "org_1",
          registerNumber: "1",
          status: "active",
          storeId: "store_1",
        },
      ],
      workflowTrace: [
        {
          _id: "trace_1",
          storeId: "store_1",
          traceId: "register_session:session_open",
        },
      ],
    });

    await expect(
      getHandler(getRegisterSessionSnapshot)(ctx as never, {
        registerSessionId: "session_open" as Id<"registerSession">,
        storeId: "store_1" as Id<"store">,
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        registerSession: expect.objectContaining({
          workflowTraceId: "register_session:session_open",
        }),
      }),
    );
  });

  it("includes void status details on linked register-session transactions", async () => {
    const voidedAt = new Date("2026-04-21T17:45:00.000Z").getTime();
    const ctx = createAuthorizedRegisterDepositCtx({
      posTransaction: [
        {
          _id: "transaction_void",
          completedAt: new Date("2026-04-21T17:30:00.000Z").getTime(),
          paymentMethod: "cash",
          registerSessionId: "session_open",
          staffProfileId: "staff_1",
          status: "void",
          storeId: "store_1",
          total: 15000,
          transactionNumber: "198508",
          voidedAt,
        },
      ],
      posTransactionItem: [
        {
          _id: "transaction_item_1",
          quantity: 3,
          transactionId: "transaction_void",
        },
      ],
    });

    await expect(
      getHandler(getRegisterSessionSnapshot)(ctx as never, {
        registerSessionId: "session_open" as Id<"registerSession">,
        storeId: "store_1" as Id<"store">,
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        transactions: [
          expect.objectContaining({
            _id: "transaction_void",
            itemCount: 3,
            status: "void",
            transactionNumber: "198508",
            voidedAt,
          }),
        ],
      }),
    );
  });

  it("rejects register-session deposits when the caller is unauthenticated", async () => {
    mockedAuthServer.getAuthUserId.mockResolvedValue(null);
    const ctx = createQueryCtx({
      store: [{ _id: "store_1", organizationId: "org_1" }],
    });

    await expect(
      getHandler(recordRegisterSessionDeposit)(ctx as never, {
        amount: 100,
        registerSessionId: "session_open" as Id<"registerSession">,
        storeId: "store_1" as Id<"store">,
        submissionKey: "deposit-1",
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        error: expect.objectContaining({ code: "authorization_failed" }),
        kind: "user_error",
      }),
    );
  });

  it("rejects register-session deposits when the caller lacks cash-control roles", async () => {
    const ctx = createQueryCtx({
      athenaUser: [{ _id: "athena_user_1", email: "operator@example.com" }],
      organizationMember: [
        {
          _id: "member_1",
          organizationId: "org_1",
          role: "staff",
          userId: "athena_user_1",
        },
      ],
      store: [{ _id: "store_1", organizationId: "org_1" }],
      users: [{ _id: "auth_user_1", email: "operator@example.com" }],
    });

    await expect(
      getHandler(recordRegisterSessionDeposit)(ctx as never, {
        amount: 100,
        registerSessionId: "session_open" as Id<"registerSession">,
        storeId: "store_1" as Id<"store">,
        submissionKey: "deposit-1",
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        error: expect.objectContaining({ code: "authorization_failed" }),
        kind: "user_error",
      }),
    );
  });

  it("rejects register-session deposits when the staff actor is from another store", async () => {
    const ctx = createAuthorizedRegisterDepositCtx({
      staffProfile: [
        {
          _id: "staff_1",
          linkedUserId: "athena_user_1",
          status: "active",
          storeId: "store_2",
        },
      ],
    });

    await expect(
      getHandler(recordRegisterSessionDeposit)(ctx as never, {
        actorStaffProfileId: "staff_1" as Id<"staffProfile">,
        amount: 100,
        registerSessionId: "session_open" as Id<"registerSession">,
        storeId: "store_1" as Id<"store">,
        submissionKey: "deposit-1",
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        error: expect.objectContaining({ code: "authorization_failed" }),
        kind: "user_error",
      }),
    );
  });

  it("rejects register-session deposits when the staff actor is inactive", async () => {
    const ctx = createAuthorizedRegisterDepositCtx({
      staffProfile: [
        {
          _id: "staff_1",
          linkedUserId: "athena_user_1",
          status: "inactive",
          storeId: "store_1",
        },
      ],
    });

    await expect(
      getHandler(recordRegisterSessionDeposit)(ctx as never, {
        actorStaffProfileId: "staff_1" as Id<"staffProfile">,
        amount: 100,
        registerSessionId: "session_open" as Id<"registerSession">,
        storeId: "store_1" as Id<"store">,
        submissionKey: "deposit-1",
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        error: expect.objectContaining({ code: "authorization_failed" }),
        kind: "user_error",
      }),
    );
  });

  it("rejects register-session deposits when the staff actor belongs to another user", async () => {
    const ctx = createAuthorizedRegisterDepositCtx({
      staffProfile: [
        {
          _id: "staff_1",
          linkedUserId: "athena_user_2",
          status: "active",
          storeId: "store_1",
        },
      ],
    });

    await expect(
      getHandler(recordRegisterSessionDeposit)(ctx as never, {
        actorStaffProfileId: "staff_1" as Id<"staffProfile">,
        amount: 100,
        registerSessionId: "session_open" as Id<"registerSession">,
        storeId: "store_1" as Id<"store">,
        submissionKey: "deposit-1",
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        error: expect.objectContaining({ code: "authorization_failed" }),
        kind: "user_error",
      }),
    );
  });

  it("rejects register-session deposits when actor user is spoofed", async () => {
    const ctx = createAuthorizedRegisterDepositCtx();

    await expect(
      getHandler(recordRegisterSessionDeposit)(ctx as never, {
        actorStaffProfileId: "staff_1" as Id<"staffProfile">,
        actorUserId: "athena_user_2" as Id<"athenaUser">,
        amount: 100,
        registerSessionId: "session_open" as Id<"registerSession">,
        storeId: "store_1" as Id<"store">,
        submissionKey: "deposit-1",
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        error: expect.objectContaining({ code: "authorization_failed" }),
        kind: "user_error",
      }),
    );
  });

  it("rejects register-session deposits without a staff actor", async () => {
    const ctx = createAuthorizedRegisterDepositCtx();

    await expect(
      getHandler(recordRegisterSessionDeposit)(ctx as never, {
        amount: 100,
        registerSessionId: "session_open" as Id<"registerSession">,
        storeId: "store_1" as Id<"store">,
        submissionKey: "deposit-1",
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        error: expect.objectContaining({ code: "authorization_failed" }),
        kind: "user_error",
      }),
    );
  });

  it("records register-session deposits with authenticated actor refs", async () => {
    const ctx = createAuthorizedRegisterDepositCtx();

    await expect(
      getHandler(recordRegisterSessionDeposit)(ctx as never, {
        actorStaffProfileId: "staff_1" as Id<"staffProfile">,
        amount: 100,
        registerSessionId: "session_open" as Id<"registerSession">,
        storeId: "store_1" as Id<"store">,
        submissionKey: "deposit-1",
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        data: expect.objectContaining({ action: "recorded" }),
        kind: "ok",
      }),
    );

    expect(ctx.tables.get("paymentAllocation")).toEqual([
      expect.objectContaining({
        actorStaffProfileId: "staff_1",
        actorUserId: "athena_user_1",
        amount: 10000,
      }),
    ]);
    expect(ctx.tables.get("operationalEvent")).toEqual([
      expect.objectContaining({
        actorStaffProfileId: "staff_1",
        actorUserId: "athena_user_1",
        eventType: "register_session_cash_deposit_recorded",
      }),
    ]);
    expect(ctx.tables.get("workflowTraceEvent")).toEqual([
      expect.objectContaining({
        actorRefs: {
          actorStaffProfileId: "staff_1",
          actorUserId: "athena_user_1",
        },
        step: "register_session_deposit_recorded",
      }),
    ]);
  });

  it("writes through payment allocations, register-session math, and operational events", () => {
    const source = getSource("./deposits.ts");

    expect(source).toContain("recordPaymentAllocationWithCtx");
    expect(source).toContain("recordRegisterSessionDeposit");
    expect(source).toContain("recordOperationalEventWithCtx");
  });
});
