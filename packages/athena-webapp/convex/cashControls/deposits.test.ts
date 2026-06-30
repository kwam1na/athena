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
import {
  buildRegisterSessionLocalSyncStatus,
  classifyRegisterSessionSyncReview,
} from "../pos/application/sync/registerSessionSyncReview";
import { assertConformsToExportedReturns } from "../lib/returnValidatorContract";

function getSource(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

function getHandler(definition: unknown) {
  return (definition as { _handler: Function })._handler;
}

function createQueryCtx(seed: Record<string, Array<Record<string, unknown>>>) {
  const indexReads: Array<{ indexName: string; tableName: string }> = [];
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
          withIndex: (indexName: string, build: (q: any) => unknown) => {
            indexReads.push({ indexName, tableName });
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
              lte(field: string, value: unknown) {
                predicateFilters.push(
                  (row) =>
                    typeof row[field] === "number" &&
                    row[field] <= (value as number),
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
    indexReads,
  };
}

function createProjectedInventoryReviewQueryCtx(input: {
  workItemMetadata?: Record<string, unknown>;
  workItemStatus?: string;
}) {
  return createQueryCtx({
    operationalWorkItem: [
      {
        _id: "work_item_inventory",
        approvalState: "not_required",
        createdAt: 4,
        metadata: {
          localEventId: "event_inventory_sale",
          localRegisterSessionId: "local-register-1",
          localTransactionId: "local-transaction-1",
          receiptNumber: "939540",
          registerSessionId: "session_open",
          ...(input.workItemMetadata ?? {}),
        },
        organizationId: "org_1",
        priority: "high",
        status: input.workItemStatus ?? "open",
        storeId: "store_1",
        title: "Review inventory for Ebin Skin Protector Enhanced",
        type: "synced_sale_inventory_review",
      },
    ],
    posLocalSyncConflict: [
      {
        _id: "sync_conflict_inventory",
        storeId: "store_1",
        terminalId: "terminal_1",
        localRegisterSessionId: "local-register-1",
        localEventId: "event_inventory_sale",
        sequence: 3,
        conflictType: "inventory",
        status: "needs_review",
        summary: "Inventory needs manager review for a synced offline sale.",
        details: {
          localTransactionId: "local-transaction-1",
          productSkuId: "product_sku_1",
          requestedQuantity: 2,
          quantityAvailable: 1,
          quantityAvailableAfterHolds: 1,
        },
        createdAt: 1,
      },
    ],
    posLocalSyncEvent: [
      {
        _id: "sync_event_inventory_sale",
        storeId: "store_1",
        terminalId: "terminal_1",
        localRegisterSessionId: "local-register-1",
        localEventId: "event_inventory_sale",
        sequence: 3,
        eventType: "sale_completed",
        occurredAt: 2,
        staffProfileId: "staff_1",
        payload: {
          localTransactionId: "local-transaction-1",
          receiptNumber: "939540",
        },
        projectedAt: 4,
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

function createMissingMappingRepairSeed(
  options: {
    existingRegisterMappingCloudId?: string;
    localTransactionId?: string;
    registerSessionStatus?: string;
    saleSequence?: number;
    transactionRegisterSessionId?: string;
    transactionStatus?: string;
    withCloseoutBeforeSale?: boolean;
    withCloudTransaction?: boolean;
    withTransactionMapping?: boolean;
  } = {},
) {
  const localTransactionId =
    options.localTransactionId === undefined
      ? "local-transaction-1"
      : options.localTransactionId;
  const saleSequence = options.saleSequence ?? 3;
  const mappings: Record<string, unknown>[] = [
    ...(localTransactionId && options.withTransactionMapping !== false
      ? [
          {
            _id: "transaction_mapping_1",
            storeId: "store_1",
            terminalId: "terminal_1",
            localRegisterSessionId: "local-register-1",
            localEventId: "event_sale_1",
            localIdKind: "transaction",
            localId: localTransactionId,
            cloudTable: "posTransaction",
            cloudId: "transaction_1",
            createdAt: 2,
          },
        ]
        : []),
  ];
  if (options.existingRegisterMappingCloudId) {
    mappings.push({
      _id: "register_mapping_1",
      storeId: "store_1",
      terminalId: "terminal_1",
      localRegisterSessionId: "local-register-1",
      localEventId: "event_open_1",
      localIdKind: "registerSession",
      localId: "local-register-1",
      cloudTable: "registerSession",
      cloudId: options.existingRegisterMappingCloudId,
      createdAt: 1,
    });
  }

  return {
    operationalEvent: [],
    posLocalSyncConflict: [
      {
        _id: "sync_conflict_missing_mapping",
        storeId: "store_1",
        terminalId: "terminal_1",
        localRegisterSessionId: "local-register-1",
        localEventId: "event_sale_1",
        sequence: saleSequence,
        conflictType: "permission",
        status: "needs_review",
        summary: "Register session mapping is missing for synced POS history.",
        details: {
          ...(localTransactionId ? { localTransactionId } : {}),
        },
        createdAt: 1,
      },
    ],
    posLocalSyncEvent: [
      ...(options.withCloseoutBeforeSale
        ? [
            {
              _id: "sync_event_closeout_1",
              storeId: "store_1",
              terminalId: "terminal_1",
              localRegisterSessionId: "local-register-1",
              localEventId: "event_closeout_1",
              sequence: saleSequence - 1,
              eventType: "register_closed",
              occurredAt: 1,
              payload: {},
              status: "projected",
              submittedAt: 1,
            },
          ]
        : []),
      {
        _id: "sync_event_sale_1",
        storeId: "store_1",
        terminalId: "terminal_1",
        localRegisterSessionId: "local-register-1",
        localEventId: "event_sale_1",
        sequence: saleSequence,
        eventType: "sale_completed",
        occurredAt: 2,
        staffProfileId: "staff_1",
        payload: {
          ...(localTransactionId ? { localTransactionId } : {}),
          localPosSessionId: "local-pos-session-1",
          localReceiptNumber: "local-receipt-1",
          receiptNumber: "R-1001",
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
              productName: "Test product",
              productSku: "SKU-1",
              productSkuId: "product_sku_1",
              quantity: 1,
              unitPrice: 15000,
            },
          ],
          payments: [
            {
              amount: 15000,
              localPaymentId: "local-payment-1",
              method: "cash",
              timestamp: 2,
            },
          ],
        },
        status: "conflicted",
        submittedAt: 2,
      },
    ],
    posLocalSyncMapping: mappings,
    posTransaction:
      options.withCloudTransaction === false
        ? []
        : [
            {
              _id: "transaction_1",
              completedAt: 2,
              registerSessionId:
                options.transactionRegisterSessionId ?? "session_open",
              status: options.transactionStatus ?? "completed",
              storeId: "store_1",
              terminalId: "terminal_1",
              total: 15000,
              transactionNumber: "R-1001",
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
        sku: "SKU-1",
        storeId: "store_1",
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
        status: options.registerSessionStatus ?? "active",
        storeId: "store_1",
        terminalId: "terminal_1",
      },
    ],
    staffProfile: [
      {
        _id: "manager_1",
        linkedUserId: "athena_user_1",
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
  };
}

describe("cash control deposits", () => {
  beforeEach(() => {
    mockedAuthServer.getAuthUserId.mockResolvedValue("auth_user_1");
  });

  it("classifies register-session sync reviews with action policy at the source", () => {
    expect(
      classifyRegisterSessionSyncReview({
        conflictType: "permission",
        details: {
          countedCash: 45000,
          expectedCash: 50000,
          variance: -5000,
        },
        localEventId: "local-register-closed-1",
        status: "needs_review",
        summary: "Synced register closeout has a variance.",
      }),
    ).toEqual({
      actionPolicy: "apply_or_reject",
      conflictType: "permission",
      reviewKind: "register_closeout_variance",
    });
    expect(
      classifyRegisterSessionSyncReview({
        conflictType: "permission",
        details: {},
        localEventId: "event_closeout",
        status: "needs_review",
        summary: "Register session is not open for synced POS closeout.",
      }),
    ).toEqual({
      actionPolicy: "reject_only",
      conflictType: "permission",
      reviewKind: "duplicate_register_closeout",
    });
    expect(
      classifyRegisterSessionSyncReview({
        conflictType: "server_rejected",
        details: {},
        localEventId: "event_1",
        status: "rejected",
        summary: "Server rejected synced register activity for this drawer.",
      }),
    ).toEqual({
      actionPolicy: "override_or_reject",
      conflictType: "server_rejected",
      reviewKind: "server_rejected",
    });
    expect(
      classifyRegisterSessionSyncReview({
        conflictType: "inventory",
        details: {},
        localEventId: "event-sale-completed-1",
        status: "needs_review",
        summary: "Inventory needs manager review for a synced offline sale.",
      }),
    ).toEqual({
      actionPolicy: "apply_or_reject",
      conflictType: "inventory",
      reviewKind: "inventory_review",
    });
    expect(
      classifyRegisterSessionSyncReview({
        conflictType: "permission",
        details: {},
        localEventId: "event-sale-missing-register",
        status: "needs_review",
        summary: "Register session mapping is missing for synced POS history.",
      }),
    ).toEqual({
      actionPolicy: "apply_or_reject",
      conflictType: "permission",
      reviewKind: "missing_register_session_mapping",
    });
    expect(
      classifyRegisterSessionSyncReview({
        conflictType: "permission",
        details: {
          blockingRegisterSessionId: "session_open",
          localRegisterSessionId: "local-register-2",
        },
        localEventId: "event-register-opened-2",
        status: "needs_review",
        summary: "A register session is already open for this terminal.",
      }),
    ).toEqual({
      actionPolicy: "reject_only",
      conflictType: "permission",
      reviewKind: "duplicate_register_open",
    });
    expect(
      classifyRegisterSessionSyncReview({
        conflictType: "duplicate_local_id",
        details: {},
        localEventId: "event-sale-completed-summary",
        status: "needs_review",
        summary: "Local POS session id was reused by a different synced sale.",
      }),
    ).toEqual({
      actionPolicy: "apply_or_reject",
      conflictType: "duplicate_local_id",
      reviewKind: "duplicate_pos_session_sale",
    });
    expect(
      classifyRegisterSessionSyncReview({
        conflictType: "duplicate_local_id",
        details: {
          localId: "local-pos-session-1",
          localIdKind: "posSession",
          localTransactionId: "local-transaction-1",
          originalTransactionId: "transaction-original",
        },
        localEventId: "event-sale-completed-details",
        status: "needs_review",
        summary: "Backend copy can change.",
      }),
    ).toEqual({
      actionPolicy: "apply_or_reject",
      conflictType: "duplicate_local_id",
      reviewKind: "duplicate_pos_session_sale",
    });
    expect(
      classifyRegisterSessionSyncReview({
        conflictType: "duplicate_local_id",
        details: {
          localId: "local-register-2",
          localIdKind: "registerSession",
          localTransactionId: "local-transaction-1",
        },
        localEventId: "event-register-opened-2",
        status: "needs_review",
        summary:
          "Local register session id was reused by a different synced register open.",
      }),
    ).toEqual({
      actionPolicy: "reject_only",
      conflictType: "duplicate_local_id",
      reviewKind: "duplicate_register_open",
    });
  });

  it("projects sync review classification into register-session local sync status", () => {
    expect(
      buildRegisterSessionLocalSyncStatus(
        [
          {
            _id: "sync_conflict_closeout",
            conflictType: "permission",
            createdAt: 1,
            details: {
              countedCash: 45000,
              expectedCash: 50000,
              variance: -5000,
            },
            localEventId: "local-register-closed-1",
            sequence: 2,
            status: "needs_review",
            summary: "Synced register closeout has a variance.",
          },
          {
            _id: "sync_conflict_sale",
            conflictType: "inventory",
            createdAt: 2,
            localEventId: "event-sale-1",
            localRegisterSessionId: "local-register-1",
            sale: {
              cashAmount: 2200000,
              itemCount: 2,
              items: [
                {
                  name: "Lace front wig",
                  quantity: 1,
                  sku: "WIG-001",
                  total: 1200000,
                },
                {
                  name: "Wig care kit",
                  quantity: 1,
                  sku: "CARE-001",
                  total: 1000000,
                },
              ],
              localReceiptNumber: "local-receipt-1",
              localTransactionId: "local-transaction-1",
              occurredAt: 1_781_623_200_000,
              paymentMethods: ["cash"],
              receiptNumber: "R-1001",
              staffProfileId: "staff_1" as Id<"staffProfile">,
              total: 2200000,
              totalPaid: 2200000,
            },
            sequence: 12,
            status: "needs_review",
            summary: "Inventory needs manager review for a synced offline sale.",
          },
          {
            _id: "sync_conflict_duplicate_open",
            conflictType: "permission",
            createdAt: 3,
            details: {
              blockingRegisterSessionId: "session_open",
              localRegisterSessionId: "local-register-2",
            },
            localEventId: "event-register-opened-2",
            localRegisterSessionId: "local-register-2",
            sequence: 13,
            status: "needs_review",
            summary: "A register session is already open for this terminal.",
          },
        ],
        {
          staffNamesById: new Map([
            ["staff_1" as Id<"staffProfile">, "Skank H."],
          ]),
        },
      ),
    ).toEqual({
      status: "needs_review",
      reconciliationItems: [
        expect.objectContaining({
          actionPolicy: "apply_or_reject",
          id: "sync_conflict_closeout",
          reviewKind: "register_closeout_variance",
          type: "register_closeout",
        }),
        expect.objectContaining({
          actionPolicy: "apply_or_reject",
          id: "sync_conflict_sale",
          reviewKind: "inventory_review",
          sale: expect.objectContaining({
            cashAmount: 2200000,
            receiptNumber: "R-1001",
            staffName: "Skank H.",
            total: 2200000,
          }),
        }),
        expect.objectContaining({
          actionPolicy: "reject_only",
          id: "sync_conflict_duplicate_open",
          reviewKind: "duplicate_register_open",
          type: "permission",
        }),
      ],
    });
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
      pendingVoidApprovalsBySessionId: new Map([
        [
          "session_closing" as Id<"registerSession">,
          {
            count: 2,
            items: [
              {
                approvalRequestId: "void_approval_1" as Id<"approvalRequest">,
                requestedAt: 25,
                transactionId: "txn_1",
                transactionNumber: "POS-1001",
                workItemId: "work_item_1" as Id<"operationalWorkItem">,
              },
              {
                approvalRequestId: "void_approval_2" as Id<"approvalRequest">,
                requestedAt: 26,
                transactionId: "txn_2",
                transactionNumber: "POS-1002",
                workItemId: null,
              },
            ],
          },
        ],
      ]),
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
        {
          _id: "session_rejected" as Id<"registerSession">,
          countedCash: 8800,
          expectedCash: 9500,
          openedAt: 15,
          openingFloat: 5000,
          registerNumber: "D4",
          status: "closeout_rejected",
          storeId: "store_1" as Id<"store">,
          terminalId: "terminal_3" as Id<"posTerminal">,
          variance: -700,
        },
      ],
      staffNamesById: new Map(),
      terminalNamesById: new Map([
        ["terminal_1" as Id<"posTerminal">, "Front counter"],
        ["terminal_2" as Id<"posTerminal">, "Back counter"],
      ]),
    });

    expect(snapshot.registerSessions).toHaveLength(4);
    expect(snapshot.registerSessions.map((session) => session._id)).toEqual([
      "session_closing",
      "session_rejected",
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

    expect(snapshot.pendingCloseouts).toHaveLength(2);
    expect(snapshot.pendingCloseouts[0]).toMatchObject({
      _id: "session_closing",
      pendingApprovalRequest: {
        _id: "approval_1",
        notes: "Counted twice before manager review.",
        status: "pending",
      },
      pendingVoidApprovals: {
        count: 2,
        items: [
          expect.objectContaining({
            approvalRequestId: "void_approval_1",
            transactionNumber: "POS-1001",
          }),
          expect.objectContaining({
            approvalRequestId: "void_approval_2",
            transactionNumber: "POS-1002",
          }),
        ],
      },
      terminalName: "Back counter",
      totalDeposited: 500,
    });
    expect(snapshot.pendingCloseouts[1]).toMatchObject({
      _id: "session_rejected",
      status: "closeout_rejected",
      terminalName: null,
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

    expect(snapshot.unresolvedVariances).toHaveLength(3);
    expect(snapshot.unresolvedVariances[0]).toMatchObject({
      _id: "session_closing",
      variance: -500,
    });
    expect(snapshot.unresolvedVariances[1]).toMatchObject({
      _id: "session_rejected",
      variance: -700,
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

  it("maps repairable missing register-session mapping conflicts through the completed sale", async () => {
    const ctx = createQueryCtx({
      posLocalSyncConflict: [
        {
          _id: "sync_conflict_missing_mapping",
          storeId: "store_1",
          terminalId: "terminal_1",
          localRegisterSessionId: "local-register-1",
          localEventId: "event_sale_1",
          sequence: 3,
          conflictType: "permission",
          status: "needs_review",
          summary: "Register session mapping is missing for synced POS history.",
          details: {
            localTransactionId: "local-transaction-1",
          },
          createdAt: 1,
        },
      ],
      posLocalSyncEvent: [
        {
          _id: "sync_event_sale_1",
          storeId: "store_1",
          terminalId: "terminal_1",
          localRegisterSessionId: "local-register-1",
          localEventId: "event_sale_1",
          sequence: 3,
          eventType: "sale_completed",
          occurredAt: 2,
          staffProfileId: "staff_1",
          payload: {
            localTransactionId: "local-transaction-1",
            receiptNumber: "R-1001",
          },
          status: "conflicted",
          submittedAt: 2,
        },
      ],
      posLocalSyncMapping: [
        {
          _id: "transaction_mapping_1",
          storeId: "store_1",
          terminalId: "terminal_1",
          localRegisterSessionId: "local-register-1",
          localEventId: "event_sale_1",
          localIdKind: "transaction",
          localId: "local-transaction-1",
          cloudTable: "posTransaction",
          cloudId: "transaction_1",
          createdAt: 2,
        },
      ],
      posTransaction: [
        {
          _id: "transaction_1",
          storeId: "store_1",
          terminalId: "terminal_1",
          registerSessionId: "session_open",
          status: "completed",
          transactionNumber: "R-1001",
          total: 15000,
          completedAt: 2,
        },
      ],
      registerSession: [
        {
          _id: "session_open",
          storeId: "store_1",
          terminalId: "terminal_1",
          status: "active",
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
              _id: "sync_conflict_missing_mapping",
            }),
          ],
        ],
      ]),
    );
  });

  it("does not surface missing register-session mapping conflicts for non-sale sync events", async () => {
    const ctx = createQueryCtx({
      posLocalSyncConflict: [
        {
          _id: "sync_conflict_closeout_missing_mapping",
          storeId: "store_1",
          terminalId: "terminal_1",
          localRegisterSessionId: "local-register-1",
          localEventId: "event_closeout_1",
          sequence: 4,
          conflictType: "permission",
          status: "needs_review",
          summary: "Register session mapping is missing for synced POS history.",
          details: {
            localRegisterSessionId: "local-register-1",
          },
          createdAt: 1,
        },
      ],
      posLocalSyncEvent: [
        {
          _id: "sync_event_closeout_1",
          storeId: "store_1",
          terminalId: "terminal_1",
          localRegisterSessionId: "local-register-1",
          localEventId: "event_closeout_1",
          sequence: 4,
          eventType: "register_closed",
          occurredAt: 2,
          payload: {
            countedCash: 359000,
          },
          status: "conflicted",
          submittedAt: 2,
        },
      ],
      posLocalSyncMapping: [
        {
          _id: "sync_mapping_1",
          storeId: "store_1",
          terminalId: "terminal_1",
          localRegisterSessionId: "local-register-1",
          localEventId: "event_open_1",
          localIdKind: "registerSession",
          localId: "local-register-1",
          cloudTable: "registerSession",
          cloudId: "session_closing",
          createdAt: 2,
        },
      ],
      registerSession: [
        {
          _id: "session_closing",
          storeId: "store_1",
          terminalId: "terminal_1",
          status: "closing",
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

  it("hides duplicate closeout shadows while the variance closeout review is open", async () => {
    const ctx = createQueryCtx({
      posLocalSyncConflict: [
        {
          _id: "sync_conflict_variance",
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
            countedCash: 20000,
            expectedCash: 23000,
            variance: -3000,
          },
          createdAt: 1,
        },
        {
          _id: "sync_conflict_duplicate",
          storeId: "store_1",
          terminalId: "terminal_1",
          localRegisterSessionId: "local-register-1",
          localEventId: "event_closeout",
          sequence: 2,
          conflictType: "permission",
          status: "needs_review",
          summary: "Register session is not open for synced POS closeout.",
          details: {
            localRegisterSessionId: "local-register-1",
            status: "closing",
          },
          createdAt: 2,
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
          cloudId: "session_closing",
        },
      ],
      registerSession: [
        {
          _id: "session_closing",
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
          "session_closing",
          [expect.objectContaining({ _id: "sync_conflict_variance" })],
        ],
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
          linkedUserId: "athena_user_1",
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
    expect(() =>
      assertConformsToExportedReturns(resolveRegisterSessionSyncReview, result),
    ).not.toThrow();
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
        status: "active",
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

  it("repairs missing register-session mappings with an inline manager approval proof", async () => {
    const ctx = createAuthorizedRegisterDepositCtx({
      ...createMissingMappingRepairSeed(),
      approvalProof: [
        {
          _id: "approval_proof_1",
          actionKey: "cash_controls.register_session.resolve_sync_review",
          approvedByCredentialId: "credential_manager_1",
          approvedByStaffProfileId: "manager_1",
          createdAt: 1,
          expiresAt: Date.now() + 60_000,
          requestedByStaffProfileId: "staff_1",
          requiredRole: "manager",
          storeId: "store_1",
          subjectId: "session_open",
          subjectLabel: "1",
          subjectType: "register_session",
        },
      ],
      staffProfile: [
        {
          _id: "manager_1",
          linkedUserId: "athena_user_2",
          organizationId: "org_1",
          status: "active",
          storeId: "store_1",
        },
        {
          _id: "staff_1",
          linkedUserId: "athena_user_1",
          organizationId: "org_1",
          status: "active",
          storeId: "store_1",
        },
      ],
    });

    const result = await getHandler(resolveRegisterSessionSyncReview)(
      ctx as never,
      {
        actorStaffProfileId: "manager_1" as Id<"staffProfile">,
        approvalProofId: "approval_proof_1" as Id<"approvalProof">,
        registerSessionId: "session_open" as Id<"registerSession">,
        requestedByStaffProfileId: "staff_1" as Id<"staffProfile">,
        reviewConflictIds: ["sync_conflict_missing_mapping"],
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
    expect(ctx.tables.get("approvalProof")).toEqual([
      expect.objectContaining({
        _id: "approval_proof_1",
        consumedAt: expect.any(Number),
      }),
    ]);
    expect(ctx.tables.get("posLocalSyncConflict")).toEqual([
      expect.objectContaining({
        _id: "sync_conflict_missing_mapping",
        resolvedByStaffProfileId: "manager_1",
        status: "resolved",
      }),
    ]);
    expect(ctx.tables.get("posLocalSyncMapping")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          cloudId: "session_open",
          cloudTable: "registerSession",
          localIdKind: "registerSession",
        }),
      ]),
    );
    expect(ctx.tables.get("operationalEvent")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actorStaffProfileId: "manager_1",
          eventType: "register_session_sync_review_resolved",
          metadata: expect.objectContaining({
            approvalProofId: "approval_proof_1",
            conflictIds: ["sync_conflict_missing_mapping"],
          }),
        }),
      ]),
    );
  });

  it("repairs missing register-session mappings for completed synced sales", async () => {
    const ctx = createAuthorizedRegisterDepositCtx({
      operationalEvent: [],
      posLocalSyncConflict: [
        {
          _id: "sync_conflict_missing_mapping",
          storeId: "store_1",
          terminalId: "terminal_1",
          localRegisterSessionId: "local-register-1",
          localEventId: "event_sale_1",
          sequence: 3,
          conflictType: "permission",
          status: "needs_review",
          summary: "Register session mapping is missing for synced POS history.",
          details: {
            localTransactionId: "local-transaction-1",
          },
          createdAt: 1,
        },
      ],
      posLocalSyncEvent: [
        {
          _id: "sync_event_sale_1",
          storeId: "store_1",
          terminalId: "terminal_1",
          localRegisterSessionId: "local-register-1",
          localEventId: "event_sale_1",
          sequence: 3,
          eventType: "sale_completed",
          occurredAt: 2,
          staffProfileId: "staff_1",
          payload: {
            localTransactionId: "local-transaction-1",
            receiptNumber: "R-1001",
            totals: {
              total: 15000,
            },
          },
          status: "conflicted",
          submittedAt: 2,
        },
      ],
      posLocalSyncMapping: [
        {
          _id: "transaction_mapping_1",
          storeId: "store_1",
          terminalId: "terminal_1",
          localRegisterSessionId: "local-register-1",
          localEventId: "event_sale_1",
          localIdKind: "transaction",
          localId: "local-transaction-1",
          cloudTable: "posTransaction",
          cloudId: "transaction_1",
          createdAt: 2,
        },
      ],
      posTransaction: [
        {
          _id: "transaction_1",
          completedAt: 2,
          registerSessionId: "session_open",
          status: "completed",
          storeId: "store_1",
          terminalId: "terminal_1",
          total: 15000,
          transactionNumber: "R-1001",
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
      staffProfile: [
        {
          _id: "manager_1",
          linkedUserId: "athena_user_1",
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
        reviewConflictIds: ["sync_conflict_missing_mapping"],
        storeId: "store_1" as Id<"store">,
      },
    );

    expect(result).toEqual(
      ok({
        action: "resolved",
        projectedCount: 1,
        registerSession: expect.objectContaining({
          _id: "session_open",
          status: "active",
        }),
        resolvedCount: 1,
      }),
    );
    expect(ctx.tables.get("posLocalSyncMapping")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          cloudId: "session_open",
          cloudTable: "registerSession",
          localEventId: "event_sale_1",
          localId: "local-register-1",
          localIdKind: "registerSession",
          localRegisterSessionId: "local-register-1",
        }),
      ]),
    );
    expect(ctx.tables.get("posLocalSyncEvent")).toEqual([
      expect.objectContaining({
        _id: "sync_event_sale_1",
        projectedAt: expect.any(Number),
        status: "projected",
      }),
    ]);
    expect(ctx.tables.get("posLocalSyncConflict")).toEqual([
      expect.objectContaining({
        _id: "sync_conflict_missing_mapping",
        resolvedByStaffProfileId: "manager_1",
        status: "resolved",
      }),
    ]);
  });

  it("projects an unprojected sale after repairing its missing register mapping", async () => {
    const ctx = createAuthorizedRegisterDepositCtx(
      createMissingMappingRepairSeed({
        existingRegisterMappingCloudId: "session_open",
        withCloudTransaction: false,
        withTransactionMapping: false,
      }),
    );

    const result = await getHandler(resolveRegisterSessionSyncReview)(
      ctx as never,
      {
        actorStaffProfileId: "manager_1" as Id<"staffProfile">,
        registerSessionId: "session_open" as Id<"registerSession">,
        reviewConflictIds: ["sync_conflict_missing_mapping"],
        storeId: "store_1" as Id<"store">,
      },
    );

    expect(result).toEqual(
      ok({
        action: "resolved",
        projectedCount: 1,
        registerSession: expect.objectContaining({
          _id: "session_open",
          expectedCash: 65000,
          status: "active",
        }),
        resolvedCount: 1,
      }),
    );
    expect(ctx.tables.get("posTransaction")).toEqual([
      expect.objectContaining({
        registerSessionId: "session_open",
        total: 15000,
        transactionNumber: "R-1001",
      }),
    ]);
    expect(ctx.tables.get("posLocalSyncMapping")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          cloudId: "session_open",
          cloudTable: "registerSession",
          localIdKind: "registerSession",
        }),
        expect.objectContaining({
          cloudTable: "posTransaction",
          localId: "local-transaction-1",
          localIdKind: "transaction",
        }),
      ]),
    );
    expect(ctx.tables.get("posLocalSyncEvent")).toEqual([
      expect.objectContaining({
        _id: "sync_event_sale_1",
        projectedAt: expect.any(Number),
        status: "projected",
      }),
    ]);
    expect(ctx.tables.get("posLocalSyncConflict")).toEqual([
      expect.objectContaining({
        _id: "sync_conflict_missing_mapping",
        resolvedByStaffProfileId: "manager_1",
        status: "resolved",
      }),
    ]);
  });

  it("associates and repairs missing register mapping reviews for open register sessions", async () => {
    const ctx = createAuthorizedRegisterDepositCtx(
      createMissingMappingRepairSeed({ registerSessionStatus: "open" }),
    );

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
              _id: "sync_conflict_missing_mapping",
            }),
          ],
        ],
      ]),
    );

    const result = await getHandler(resolveRegisterSessionSyncReview)(
      ctx as never,
      {
        actorStaffProfileId: "manager_1" as Id<"staffProfile">,
        registerSessionId: "session_open" as Id<"registerSession">,
        reviewConflictIds: ["sync_conflict_missing_mapping"],
        storeId: "store_1" as Id<"store">,
      },
    );

    expect(result).toEqual(
      ok({
        action: "resolved",
        projectedCount: 1,
        registerSession: expect.objectContaining({
          _id: "session_open",
          status: "open",
        }),
        resolvedCount: 1,
      }),
    );
    expect(ctx.tables.get("posLocalSyncMapping")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          cloudId: "session_open",
          cloudTable: "registerSession",
          localIdKind: "registerSession",
        }),
      ]),
    );
  });

  it("repairs missing register mapping reviews while the register is closing", async () => {
    const ctx = createAuthorizedRegisterDepositCtx(
      createMissingMappingRepairSeed({ registerSessionStatus: "closing" }),
    );

    const result = await getHandler(resolveRegisterSessionSyncReview)(
      ctx as never,
      {
        actorStaffProfileId: "manager_1" as Id<"staffProfile">,
        registerSessionId: "session_open" as Id<"registerSession">,
        reviewConflictIds: ["sync_conflict_missing_mapping"],
        storeId: "store_1" as Id<"store">,
      },
    );

    expect(result).toEqual(
      ok({
        action: "resolved",
        projectedCount: 1,
        registerSession: expect.objectContaining({
          _id: "session_open",
          status: "closing",
        }),
        resolvedCount: 1,
      }),
    );
  });

  it("rejects missing register mapping repair after the local closeout event", async () => {
    const ctx = createAuthorizedRegisterDepositCtx(
      createMissingMappingRepairSeed({
        registerSessionStatus: "closing",
        withCloseoutBeforeSale: true,
      }),
    );

    await expect(
      getHandler(resolveRegisterSessionSyncReview)(ctx as never, {
        actorStaffProfileId: "manager_1" as Id<"staffProfile">,
        registerSessionId: "session_open" as Id<"registerSession">,
        reviewConflictIds: ["sync_conflict_missing_mapping"],
        storeId: "store_1" as Id<"store">,
      }),
    ).resolves.toEqual(
      userError({
        code: "precondition_failed",
        message:
          "This synced sale can no longer be repaired for this closeout.",
      }),
    );
  });

  it("rejects missing register mapping repair once the register is closed", async () => {
    const ctx = createAuthorizedRegisterDepositCtx(
      createMissingMappingRepairSeed({
        existingRegisterMappingCloudId: "session_open",
        registerSessionStatus: "closed",
      }),
    );

    await expect(
      getHandler(resolveRegisterSessionSyncReview)(ctx as never, {
        actorStaffProfileId: "manager_1" as Id<"staffProfile">,
        registerSessionId: "session_open" as Id<"registerSession">,
        reviewConflictIds: ["sync_conflict_missing_mapping"],
        storeId: "store_1" as Id<"store">,
      }),
    ).resolves.toEqual(
      userError({
        code: "precondition_failed",
        message:
          "This synced sale can only be repaired before the register session is closed.",
      }),
    );
  });

  it("rejects missing register mapping repair when the completed sale cannot be matched", async () => {
    const ctx = createAuthorizedRegisterDepositCtx(
      createMissingMappingRepairSeed({
        existingRegisterMappingCloudId: "session_open",
        transactionStatus: "void",
      }),
    );

    await expect(
      getHandler(resolveRegisterSessionSyncReview)(ctx as never, {
        actorStaffProfileId: "manager_1" as Id<"staffProfile">,
        registerSessionId: "session_open" as Id<"registerSession">,
        reviewConflictIds: ["sync_conflict_missing_mapping"],
        storeId: "store_1" as Id<"store">,
      }),
    ).resolves.toEqual(
      userError({
        code: "precondition_failed",
        message:
          "This synced sale could not be matched to a completed sale for this register session.",
      }),
    );
  });

  it("rejects automatic missing register mapping repair", async () => {
    const ctx = createAuthorizedRegisterDepositCtx(
      createMissingMappingRepairSeed({
        existingRegisterMappingCloudId: "session_open",
      }),
    );

    await expect(
      getHandler(resolveRegisterSessionSyncReview)(ctx as never, {
        registerSessionId: "session_open" as Id<"registerSession">,
        reviewConflictIds: ["sync_conflict_missing_mapping"],
        storeId: "store_1" as Id<"store">,
      }),
    ).resolves.toEqual(
      userError({
        code: "precondition_failed",
        message:
          "This register review is not eligible for automatic sync repair.",
      }),
    );
  });

  it("rejects missing register mapping repair when the local drawer already has a conflicting mapping", async () => {
    const seed = createMissingMappingRepairSeed();
    const ctx = createAuthorizedRegisterDepositCtx({
      ...seed,
      posLocalSyncMapping: [
        ...(seed.posLocalSyncMapping as Record<string, unknown>[]),
        {
          _id: "corrupt_register_mapping",
          storeId: "store_1",
          terminalId: "terminal_1",
          localRegisterSessionId: "local-register-1",
          localEventId: "event_open_1",
          localIdKind: "registerSession",
          localId: "local-register-1",
          cloudTable: "posTransaction",
          cloudId: "transaction_other",
          createdAt: 1,
        },
      ],
    });

    await expect(
      getHandler(resolveRegisterSessionSyncReview)(ctx as never, {
        actorStaffProfileId: "manager_1" as Id<"staffProfile">,
        registerSessionId: "session_open" as Id<"registerSession">,
        reviewConflictIds: ["sync_conflict_missing_mapping"],
        storeId: "store_1" as Id<"store">,
      }),
    ).resolves.toEqual(
      userError({
        code: "precondition_failed",
        message:
          "This synced sale is already mapped to a different register session.",
      }),
    );
  });

  it("keeps the source sync event conflicted when a sibling conflict remains open", async () => {
    const seed = createMissingMappingRepairSeed();
    const ctx = createAuthorizedRegisterDepositCtx({
      ...seed,
      posLocalSyncConflict: [
        ...(seed.posLocalSyncConflict as Record<string, unknown>[]),
        {
          _id: "sync_conflict_inventory",
          storeId: "store_1",
          terminalId: "terminal_1",
          localRegisterSessionId: "local-register-1",
          localEventId: "event_sale_1",
          sequence: 3,
          conflictType: "inventory",
          status: "needs_review",
          summary: "Inventory needs manager review for a synced offline sale.",
          details: {
            productSkuId: "product_sku_1",
            requestedQuantity: 2,
          },
          createdAt: 2,
        },
      ],
      posLocalSyncMapping: [
        ...(seed.posLocalSyncMapping as Record<string, unknown>[]),
        {
          _id: "register_mapping_1",
          storeId: "store_1",
          terminalId: "terminal_1",
          localRegisterSessionId: "local-register-1",
          localEventId: "event_open_1",
          localIdKind: "registerSession",
          localId: "local-register-1",
          cloudTable: "registerSession",
          cloudId: "session_open",
          createdAt: 1,
        },
      ],
    });

    const result = await getHandler(resolveRegisterSessionSyncReview)(
      ctx as never,
      {
        actorStaffProfileId: "manager_1" as Id<"staffProfile">,
        registerSessionId: "session_open" as Id<"registerSession">,
        reviewConflictIds: ["sync_conflict_missing_mapping"],
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
        _id: "sync_event_sale_1",
        status: "conflicted",
      }),
    ]);
    expect(ctx.tables.get("posLocalSyncConflict")).toEqual([
      expect.objectContaining({
        _id: "sync_conflict_missing_mapping",
        status: "resolved",
      }),
      expect.objectContaining({
        _id: "sync_conflict_inventory",
        status: "needs_review",
      }),
    ]);
  });

  it("rejects synced register review when the manager actor belongs to another user", async () => {
    const ctx = createAuthorizedRegisterDepositCtx({
      posLocalSyncConflict: [
        {
          _id: "sync_conflict_1",
          conflictType: "permission",
          createdAt: 1,
          details: {},
          localEventId: "event_1",
          localRegisterSessionId: "local-register-1",
          sequence: 1,
          status: "needs_review",
          storeId: "store_1",
          summary: "Register was not open before this sale synced.",
          terminalId: "terminal_1",
        },
      ],
      posLocalSyncEvent: [
        {
          _id: "sync_event_1",
          eventType: "sale_completed",
          localEventId: "event_1",
          localRegisterSessionId: "local-register-1",
          occurredAt: 2,
          payload: {},
          sequence: 1,
          status: "conflicted",
          storeId: "store_1",
          submittedAt: 4,
          terminalId: "terminal_1",
        },
      ],
      staffProfile: [
        {
          _id: "manager_1",
          linkedUserId: "athena_user_2",
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
        registerSessionId: "session_open" as Id<"registerSession">,
        storeId: "store_1" as Id<"store">,
      },
    );

    expect(result).toEqual(
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
    expect(ctx.tables.get("posLocalSyncEvent")).toEqual([
      expect.objectContaining({
        _id: "sync_event_1",
        status: "conflicted",
      }),
    ]);
  });

  it("applies reviewed inventory sale activity without forcing a stock mutation", async () => {
    const ctx = createAuthorizedRegisterDepositCtx({
      operationalEvent: [],
      posLocalSyncConflict: [
        {
          _id: "sync_conflict_inventory",
          storeId: "store_1",
          terminalId: "terminal_1",
          localRegisterSessionId: "local-register-1",
          localEventId: "event_inventory_sale",
          sequence: 3,
          conflictType: "inventory",
          status: "needs_review",
          summary: "Inventory needs manager review for a synced offline sale.",
          details: {
            localTransactionId: "local-transaction-1",
            productSkuId: "product_sku_1",
            requestedQuantity: 2,
            availableInventoryCount: 1,
            quantityAvailable: 1,
            quantityAvailableAfterHolds: 1,
          },
          createdAt: 1,
        },
      ],
      posLocalSyncEvent: [
        {
          _id: "sync_event_inventory_sale",
          storeId: "store_1",
          terminalId: "terminal_1",
          localRegisterSessionId: "local-register-1",
          localEventId: "event_inventory_sale",
          sequence: 3,
          eventType: "sale_completed",
          occurredAt: 2,
          staffProfileId: "staff_1",
          payload: {
            localPosSessionId: "local-pos-session-1",
            localTransactionId: "local-transaction-1",
            localReceiptNumber: "939540",
            receiptNumber: "939540",
            registerNumber: "1",
            totals: {
              subtotal: 116000,
              tax: 0,
              total: 116000,
            },
            items: [
              {
                localTransactionItemId: "local-item-1",
                productId: "product_1",
                productSkuId: "product_sku_1",
                productName: "Ebin Skin Protector Enhanced",
                productSku: "KK38-3NA-5QK",
                quantity: 2,
                unitPrice: 58000,
              },
            ],
            payments: [
              {
                localPaymentId: "local-payment-1",
                method: "mobile_money",
                amount: 116000,
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
          expectedCash: 231000,
          openedAt: 1,
          openingFloat: 15500,
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
          inventoryCount: 1,
          price: 58000,
          productId: "product_1",
          quantityAvailable: 1,
          sku: "KK38-3NA-5QK",
          storeId: "store_1",
        },
      ],
      staffProfile: [
        {
          _id: "manager_1",
          linkedUserId: "athena_user_1",
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
        reviewConflictIds: ["sync_conflict_inventory"],
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
        _id: "sync_conflict_inventory",
        resolvedByStaffProfileId: "manager_1",
        status: "resolved",
      }),
    ]);
    expect(ctx.tables.get("posLocalSyncEvent")).toEqual([
      expect.objectContaining({
        _id: "sync_event_inventory_sale",
        projectedAt: expect.any(Number),
        status: "projected",
      }),
    ]);
    expect(ctx.tables.get("posTransaction")).toEqual([
      expect.objectContaining({
        registerSessionId: "session_open",
        total: 116000,
        transactionNumber: "939540",
      }),
    ]);
    expect(ctx.tables.get("productSku")).toEqual([
      expect.objectContaining({
        _id: "product_sku_1",
        inventoryCount: 1,
        quantityAvailable: 1,
      }),
    ]);
    expect(ctx.tables.get("operationalWorkItem")).toEqual([
      expect.objectContaining({
        approvalState: "not_required",
        createdByStaffProfileId: "manager_1",
        createdByUserId: "athena_user_1",
        metadata: expect.objectContaining({
          primaryProductSkuId: "product_sku_1",
          receiptNumber: "939540",
          registerSessionId: "session_open",
          skippedMutationItems: [
            expect.objectContaining({
              productSkuId: "product_sku_1",
              reason: "stock_shortfall",
              requestedQuantity: 2,
            }),
          ],
          sourceType: "posTransaction",
          trustedInventoryLines: [
            expect.objectContaining({
              productSkuId: "product_sku_1",
              quantity: 2,
            }),
          ],
        }),
        priority: "high",
        status: "open",
        title: "Review inventory for Ebin Skin Protector Enhanced",
        type: "synced_sale_inventory_review",
      }),
    ]);
  });

  it("resolves selected sale review rows without clearing sibling review rows", async () => {
    const ctx = createAuthorizedRegisterDepositCtx({
      operationalEvent: [],
      posLocalSyncConflict: [
        {
          _id: "sync_conflict_inventory",
          storeId: "store_1",
          terminalId: "terminal_1",
          localRegisterSessionId: "local-register-1",
          localEventId: "event_inventory_sale",
          sequence: 3,
          conflictType: "inventory",
          status: "needs_review",
          summary: "Inventory needs manager review for a synced offline sale.",
          details: {
            localTransactionId: "local-transaction-1",
            productSkuId: "product_sku_1",
            requestedQuantity: 2,
            availableInventoryCount: 1,
            quantityAvailable: 1,
            quantityAvailableAfterHolds: 1,
          },
          createdAt: 1,
        },
        {
          _id: "sync_conflict_duplicate",
          storeId: "store_1",
          terminalId: "terminal_1",
          localRegisterSessionId: "local-register-1",
          localEventId: "event_inventory_sale",
          sequence: 3,
          conflictType: "duplicate_local_id",
          status: "needs_review",
          summary:
            "Local POS session id was reused by a different synced sale.",
          details: {
            localId: "local-pos-session-1",
            localIdKind: "posSession",
            localTransactionId: "local-transaction-1",
            originalTransactionId: "transaction_original",
          },
          createdAt: 2,
        },
      ],
      posLocalSyncEvent: [
        {
          _id: "sync_event_inventory_sale",
          storeId: "store_1",
          terminalId: "terminal_1",
          localRegisterSessionId: "local-register-1",
          localEventId: "event_inventory_sale",
          sequence: 3,
          eventType: "sale_completed",
          occurredAt: 2,
          staffProfileId: "staff_1",
          payload: {
            localPosSessionId: "local-pos-session-1",
            localTransactionId: "local-transaction-1",
            localReceiptNumber: "939540",
            receiptNumber: "939540",
            registerNumber: "1",
            totals: {
              subtotal: 116000,
              tax: 0,
              total: 116000,
            },
            items: [
              {
                localTransactionItemId: "local-item-1",
                productId: "product_1",
                productSkuId: "product_sku_1",
                productName: "Ebin Skin Protector Enhanced",
                productSku: "KK38-3NA-5QK",
                quantity: 2,
                unitPrice: 58000,
              },
            ],
            payments: [
              {
                localPaymentId: "local-payment-1",
                method: "mobile_money",
                amount: 116000,
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
          expectedCash: 231000,
          openedAt: 1,
          openingFloat: 15500,
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
          inventoryCount: 1,
          price: 58000,
          productId: "product_1",
          quantityAvailable: 1,
          sku: "KK38-3NA-5QK",
          storeId: "store_1",
        },
      ],
      staffProfile: [
        {
          _id: "manager_1",
          linkedUserId: "athena_user_1",
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

    const approveDuplicateOnly = await getHandler(
      resolveRegisterSessionSyncReview,
    )(ctx as never, {
      actorStaffProfileId: "manager_1" as Id<"staffProfile">,
      registerSessionId: "session_open" as Id<"registerSession">,
      reviewConflictIds: ["sync_conflict_duplicate"],
      storeId: "store_1" as Id<"store">,
    });

    expect(approveDuplicateOnly).toEqual(
      userError({
        code: "precondition_failed",
        message:
          "This synced sale has multiple review items. Resolve them together so Athena can apply the sale once.",
      }),
    );
    expect(ctx.tables.get("posTransaction")).toEqual([]);
    expect(ctx.tables.get("paymentAllocation") ?? []).toEqual([]);
    expect(ctx.tables.get("posLocalSyncEvent")).toEqual([
      expect.objectContaining({
        _id: "sync_event_inventory_sale",
        status: "conflicted",
      }),
    ]);
    expect(ctx.tables.get("posLocalSyncConflict")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          _id: "sync_conflict_duplicate",
          status: "needs_review",
        }),
        expect.objectContaining({
          _id: "sync_conflict_inventory",
          status: "needs_review",
        }),
      ]),
    );

    const rejectDuplicate = await getHandler(resolveRegisterSessionSyncReview)(
      ctx as never,
      {
        actorStaffProfileId: "manager_1" as Id<"staffProfile">,
        decision: "rejected",
        registerSessionId: "session_open" as Id<"registerSession">,
        reviewConflictIds: ["sync_conflict_duplicate"],
        storeId: "store_1" as Id<"store">,
      },
    );

    expect(rejectDuplicate).toEqual(
      ok({
        action: "rejected",
        projectedCount: 0,
        registerSession: expect.objectContaining({ _id: "session_open" }),
        resolvedCount: 1,
      }),
    );
    expect(ctx.tables.get("posLocalSyncEvent")).toEqual([
      expect.objectContaining({
        _id: "sync_event_inventory_sale",
        status: "conflicted",
      }),
    ]);
    expect(ctx.tables.get("posLocalSyncConflict")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          _id: "sync_conflict_duplicate",
          resolvedByStaffProfileId: "manager_1",
          status: "resolved",
        }),
        expect.objectContaining({
          _id: "sync_conflict_inventory",
          status: "needs_review",
        }),
      ]),
    );
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
              _id: "sync_conflict_inventory",
              status: "needs_review",
            }),
          ],
        ],
      ]),
    );

    const applyInventory = await getHandler(resolveRegisterSessionSyncReview)(
      ctx as never,
      {
        actorStaffProfileId: "manager_1" as Id<"staffProfile">,
        registerSessionId: "session_open" as Id<"registerSession">,
        reviewConflictIds: ["sync_conflict_inventory"],
        storeId: "store_1" as Id<"store">,
      },
    );

    expect(applyInventory).toEqual(
      ok({
        action: "resolved",
        projectedCount: 1,
        registerSession: expect.objectContaining({ _id: "session_open" }),
        resolvedCount: 1,
      }),
    );
    expect(ctx.tables.get("posLocalSyncConflict")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          _id: "sync_conflict_duplicate",
          status: "resolved",
        }),
        expect.objectContaining({
          _id: "sync_conflict_inventory",
          resolvedByStaffProfileId: "manager_1",
          status: "resolved",
        }),
      ]),
    );
    expect(ctx.tables.get("posLocalSyncEvent")).toEqual([
      expect.objectContaining({
        _id: "sync_event_inventory_sale",
        projectedAt: expect.any(Number),
        status: "projected",
      }),
    ]);
    expect(ctx.tables.get("operationalWorkItem")).toEqual([
      expect.objectContaining({
        metadata: expect.objectContaining({
          receiptNumber: "939540",
          sourceType: "posTransaction",
        }),
        title: "Review inventory for Ebin Skin Protector Enhanced",
        type: "synced_sale_inventory_review",
      }),
    ]);
  });

  it("rejects duplicate register-opening evidence without rejecting the projected sale event", async () => {
    const ctx = createAuthorizedRegisterDepositCtx({
      operationalEvent: [],
      posLocalSyncConflict: [
        {
          _id: "sync_conflict_duplicate",
          storeId: "store_1",
          terminalId: "terminal_1",
          localRegisterSessionId: "local-register-1",
          localEventId: "event_inventory_sale",
          sequence: 13,
          conflictType: "duplicate_local_id",
          status: "needs_review",
          summary:
            "Local register session id was reused by a different synced register open.",
          details: {
            localId: "local-register-1",
            localIdKind: "registerSession",
            localTransactionId: "local-transaction-1",
            originalTransactionId: "transaction_original",
          },
          createdAt: 2,
        },
      ],
      posLocalSyncEvent: [
        {
          _id: "sync_event_inventory_sale",
          storeId: "store_1",
          terminalId: "terminal_1",
          localRegisterSessionId: "local-register-1",
          localEventId: "event_inventory_sale",
          sequence: 13,
          eventType: "sale_completed",
          occurredAt: 2,
          projectedAt: 4,
          staffProfileId: "staff_1",
          payload: {
            localPosSessionId: "local-pos-session-1",
            localTransactionId: "local-transaction-1",
            localReceiptNumber: "224763",
            receiptNumber: "224763",
            registerNumber: "1",
            totals: {
              subtotal: 8000,
              tax: 0,
              total: 8000,
            },
            items: [
              {
                localTransactionItemId: "local-item-1",
                productId: "product_1",
                productSkuId: "product_sku_1",
                productName: "Melt Band",
                productSku: "KK38-61G-ZW8",
                quantity: 2,
                unitPrice: 2500,
              },
              {
                localTransactionItemId: "local-item-2",
                productId: "product_2",
                productSkuId: "product_sku_2",
                productName: "Romantic Rain Lip Oil",
                productSku: "KK38-9KB-VPS",
                quantity: 1,
                unitPrice: 3000,
              },
            ],
            payments: [
              {
                localPaymentId: "local-payment-1",
                method: "mobile_money",
                amount: 8000,
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
          expectedCash: 231000,
          openedAt: 1,
          openingFloat: 15500,
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
          linkedUserId: "athena_user_1",
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
        decision: "rejected",
        registerSessionId: "session_open" as Id<"registerSession">,
        reviewConflictIds: ["sync_conflict_duplicate"],
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
        _id: "sync_event_inventory_sale",
        projectedAt: 4,
        status: "projected",
      }),
    ]);
    expect(ctx.tables.get("posLocalSyncEvent")?.[0]).not.toHaveProperty(
      "rejectionCode",
    );
    expect(ctx.tables.get("posLocalSyncEvent")?.[0]).not.toHaveProperty(
      "rejectionMessage",
    );
    expect(ctx.tables.get("posLocalSyncConflict")).toEqual([
      expect.objectContaining({
        _id: "sync_conflict_duplicate",
        resolvedByStaffProfileId: "manager_1",
        status: "resolved",
      }),
    ]);
  });

  it("rejects unprojected duplicate POS-session sale evidence without leaving a hidden conflict", async () => {
    const ctx = createAuthorizedRegisterDepositCtx({
      operationalEvent: [],
      posLocalSyncConflict: [
        {
          _id: "sync_conflict_duplicate",
          storeId: "store_1",
          terminalId: "terminal_1",
          localRegisterSessionId: "local-register-1",
          localEventId: "event_duplicate_sale",
          sequence: 13,
          conflictType: "duplicate_local_id",
          status: "needs_review",
          summary:
            "Local POS session id was reused by a different synced sale.",
          details: {
            localId: "local-pos-session-1",
            localIdKind: "posSession",
            localTransactionId: "local-transaction-1",
            originalTransactionId: "transaction_original",
          },
          createdAt: 2,
        },
      ],
      posLocalSyncEvent: [
        {
          _id: "sync_event_duplicate_sale",
          storeId: "store_1",
          terminalId: "terminal_1",
          localRegisterSessionId: "local-register-1",
          localEventId: "event_duplicate_sale",
          sequence: 13,
          eventType: "sale_completed",
          occurredAt: 2,
          staffProfileId: "staff_1",
          payload: {
            localPosSessionId: "local-pos-session-1",
            localTransactionId: "local-transaction-1",
            localReceiptNumber: "224763",
            receiptNumber: "224763",
            registerNumber: "1",
            totals: { subtotal: 8000, tax: 0, total: 8000 },
            items: [],
            payments: [
              {
                localPaymentId: "local-payment-1",
                method: "mobile_money",
                amount: 8000,
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
          expectedCash: 231000,
          openedAt: 1,
          openingFloat: 15500,
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
          linkedUserId: "athena_user_1",
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
        reviewConflictIds: ["sync_conflict_duplicate"],
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
        _id: "sync_event_duplicate_sale",
        rejectionCode: "manager_rejected",
        status: "rejected",
      }),
    ]);
    expect(ctx.tables.get("posLocalSyncConflict")).toEqual([
      expect.objectContaining({
        _id: "sync_conflict_duplicate",
        resolvedByStaffProfileId: "manager_1",
        status: "resolved",
      }),
    ]);
  });

  it("resolves projected duplicate POS-session sale review rows on approval", async () => {
    const ctx = createAuthorizedRegisterDepositCtx({
      operationalEvent: [],
      posLocalSyncConflict: [
        {
          _id: "sync_conflict_duplicate",
          storeId: "store_1",
          terminalId: "terminal_1",
          localRegisterSessionId: "local-register-1",
          localEventId: "event_duplicate_sale",
          sequence: 13,
          conflictType: "duplicate_local_id",
          status: "needs_review",
          summary:
            "Local POS session id was reused by a different synced sale.",
          details: {
            localId: "local-pos-session-1",
            localIdKind: "posSession",
            localTransactionId: "local-transaction-1",
            originalTransactionId: "transaction_original",
          },
          createdAt: 2,
        },
      ],
      posLocalSyncEvent: [
        {
          _id: "sync_event_duplicate_sale",
          storeId: "store_1",
          terminalId: "terminal_1",
          localRegisterSessionId: "local-register-1",
          localEventId: "event_duplicate_sale",
          sequence: 13,
          eventType: "sale_completed",
          occurredAt: 2,
          projectedAt: 4,
          staffProfileId: "staff_1",
          payload: {
            localPosSessionId: "local-pos-session-1",
            localTransactionId: "local-transaction-1",
            localReceiptNumber: "224763",
            receiptNumber: "224763",
            registerNumber: "1",
            totals: { subtotal: 8000, tax: 0, total: 8000 },
            items: [],
            payments: [
              {
                localPaymentId: "local-payment-1",
                method: "mobile_money",
                amount: 8000,
                timestamp: 3,
              },
            ],
          },
          status: "projected",
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
          expectedCash: 231000,
          openedAt: 1,
          openingFloat: 15500,
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
          linkedUserId: "athena_user_1",
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
        registerSessionId: "session_open" as Id<"registerSession">,
        reviewConflictIds: ["sync_conflict_duplicate"],
        storeId: "store_1" as Id<"store">,
      },
    );

    expect(result).toEqual(
      ok({
        action: "resolved",
        projectedCount: 0,
        registerSession: expect.objectContaining({ _id: "session_open" }),
        resolvedCount: 1,
      }),
    );
    expect(ctx.tables.get("posLocalSyncConflict")).toEqual([
      expect.objectContaining({
        _id: "sync_conflict_duplicate",
        resolvedByStaffProfileId: "manager_1",
        status: "resolved",
      }),
    ]);
    expect(ctx.tables.get("posLocalSyncEvent")).toEqual([
      expect.objectContaining({
        _id: "sync_event_duplicate_sale",
        projectedAt: 4,
        status: "projected",
      }),
    ]);
  });

  it("preserves a duplicate POS-session sale with sibling inventory review through the cash-controls review resolver", async () => {
    const ctx = createAuthorizedRegisterDepositCtx({
      operationalEvent: [],
      paymentAllocation: [],
      posInventoryMovement: [],
      posLocalSyncConflict: [
        {
          _id: "sync_conflict_inventory",
          storeId: "store_1",
          terminalId: "terminal_1",
          localRegisterSessionId: "local-register-1",
          localEventId: "event_duplicate_sale",
          sequence: 13,
          conflictType: "inventory",
          status: "needs_review",
          summary: "Inventory needs manager review for a synced offline sale.",
          details: {
            localTransactionId: "local-transaction-preserved",
            productSkuId: "product_sku_1",
            requestedQuantity: 2,
            availableInventoryCount: 1,
            quantityAvailable: 1,
            quantityAvailableAfterHolds: 1,
          },
          createdAt: 1,
        },
        {
          _id: "sync_conflict_duplicate",
          storeId: "store_1",
          terminalId: "terminal_1",
          localRegisterSessionId: "local-register-1",
          localEventId: "event_duplicate_sale",
          sequence: 13,
          conflictType: "duplicate_local_id",
          status: "needs_review",
          summary:
            "Local POS session id was reused by a different synced sale.",
          details: {
            localId: "local-pos-session-1",
            localIdKind: "posSession",
            localTransactionId: "local-transaction-preserved",
            originalTransactionId: "transaction_original",
          },
          createdAt: 2,
        },
      ],
      posLocalSyncEvent: [
        {
          _id: "sync_event_duplicate_sale",
          storeId: "store_1",
          terminalId: "terminal_1",
          localRegisterSessionId: "local-register-1",
          localEventId: "event_duplicate_sale",
          sequence: 13,
          eventType: "sale_completed",
          occurredAt: 2,
          staffProfileId: "staff_1",
          payload: {
            localPosSessionId: "local-pos-session-1",
            localTransactionId: "local-transaction-preserved",
            localReceiptNumber: "224763",
            receiptNumber: "224763",
            registerNumber: "1",
            totals: { subtotal: 8000, tax: 0, total: 8000 },
            items: [
              {
                localTransactionItemId: "local-item-1",
                productId: "product_1",
                productSkuId: "product_sku_1",
                productName: "Melt Band",
                productSku: "KK38-61G-ZW8",
                quantity: 2,
                unitPrice: 2500,
              },
              {
                localTransactionItemId: "local-item-2",
                productId: "product_2",
                productSkuId: "product_sku_2",
                productName: "Romantic Rain Lip Oil",
                productSku: "KK38-9KB-VPS",
                quantity: 1,
                unitPrice: 3000,
              },
            ],
            payments: [
              {
                localPaymentId: "local-payment-1",
                method: "mobile_money",
                amount: 8000,
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
        {
          _id: "sync_mapping_pos_session",
          storeId: "store_1",
          terminalId: "terminal_1",
          localRegisterSessionId: "local-register-1",
          localEventId: "event_original_sale",
          localIdKind: "posSession",
          localId: "local-pos-session-1",
          cloudTable: "posSession",
          cloudId: "pos_session_original",
        },
      ],
      posSession: [
        {
          _id: "pos_session_original",
          registerSessionId: "session_open",
          staffProfileId: "staff_1",
          status: "completed",
          storeId: "store_1",
          terminalId: "terminal_1",
          transactionId: "transaction_original",
        },
      ],
      posTransaction: [
        {
          _id: "transaction_original",
          completedAt: 1,
          registerSessionId: "session_open",
          status: "completed",
          storeId: "store_1",
          terminalId: "terminal_1",
          total: 5000,
          transactionNumber: "196629",
        },
      ],
      registerSession: [
        {
          _id: "session_open",
          expectedCash: 231000,
          openedAt: 1,
          openingFloat: 15500,
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
        { _id: "product_1", storeId: "store_1" },
        { _id: "product_2", storeId: "store_1" },
      ],
      productSku: [
        {
          _id: "product_sku_1",
          images: [],
          inventoryCount: 1,
          price: 2500,
          productId: "product_1",
          quantityAvailable: 1,
          sku: "KK38-61G-ZW8",
          storeId: "store_1",
        },
        {
          _id: "product_sku_2",
          images: [],
          inventoryCount: 10,
          price: 3000,
          productId: "product_2",
          quantityAvailable: 10,
          sku: "KK38-9KB-VPS",
          storeId: "store_1",
        },
      ],
      staffProfile: [
        {
          _id: "manager_1",
          linkedUserId: "athena_user_1",
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
        reviewConflictIds: [
          "sync_conflict_inventory",
          "sync_conflict_duplicate",
        ],
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
    expect(ctx.tables.get("posTransaction")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          _id: "posTransaction_2",
          registerSessionId: "session_open",
          sessionId: undefined,
          status: "completed",
          total: 8000,
          transactionNumber: "224763",
        }),
      ]),
    );
    expect(ctx.tables.get("posSession")).toEqual([
      expect.objectContaining({
        _id: "pos_session_original",
        transactionId: "transaction_original",
      }),
    ]);
    expect(ctx.tables.get("paymentAllocation")).toEqual([
      expect.objectContaining({
        amount: 8000,
        externalReference: "local-payment-1",
        method: "mobile_money",
        posTransactionId: "posTransaction_2",
        targetType: "pos_transaction",
      }),
    ]);
    expect(ctx.tables.get("posLocalSyncMapping")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          localIdKind: "posSession",
          localId: "local-pos-session-1",
          cloudId: "pos_session_original",
        }),
        expect.objectContaining({
          localIdKind: "transaction",
          localId: "local-transaction-preserved",
          cloudId: "posTransaction_2",
        }),
        expect.objectContaining({
          localIdKind: "receipt",
          localId: "224763",
          cloudId: "posTransaction_2",
        }),
      ]),
    );
    expect(
      ctx
        .tables
        .get("posLocalSyncMapping")
        ?.filter((row) => row.localIdKind === "posSession"),
    ).toHaveLength(1);
    expect(ctx.tables.get("posLocalSyncEvent")).toEqual([
      expect.objectContaining({
        _id: "sync_event_duplicate_sale",
        status: "projected",
      }),
    ]);
    expect(ctx.tables.get("posLocalSyncConflict")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          _id: "sync_conflict_inventory",
          resolvedByStaffProfileId: "manager_1",
          status: "resolved",
        }),
        expect.objectContaining({
          _id: "sync_conflict_duplicate",
          resolvedByStaffProfileId: "manager_1",
          status: "resolved",
        }),
      ]),
    );
    expect(ctx.tables.get("operationalWorkItem")).toEqual([
      expect.objectContaining({
        createdByStaffProfileId: "manager_1",
        metadata: expect.objectContaining({
          primaryProductSkuId: "product_sku_1",
          receiptNumber: "224763",
          registerSessionId: "session_open",
          skippedMutationItems: expect.arrayContaining([
            expect.objectContaining({
              productSkuId: "product_sku_1",
              reason: "stock_shortfall",
              requestedQuantity: 2,
            }),
          ]),
          sourceType: "posTransaction",
          trustedInventoryLines: expect.arrayContaining([
            expect.objectContaining({
              productSkuId: "product_sku_1",
              quantity: 2,
            }),
          ]),
        }),
        status: "open",
        title: "Review inventory for Melt Band",
        type: "synced_sale_inventory_review",
      }),
    ]);
  });

  it("rejects large duplicate register-open review batches without rereading matching conflicts", async () => {
    const duplicateConflicts = Array.from({ length: 150 }, (_, index) => ({
      _id: `sync_conflict_duplicate_open_${index}`,
      storeId: "store_1",
      terminalId: "terminal_1",
      localRegisterSessionId: "local-register-1",
      localEventId: "event_duplicate_open",
      sequence: index + 1,
      conflictType: "permission",
      status: "needs_review",
      summary: "A register session is already open for this terminal.",
      details: {
        blockingRegisterSessionId: "session_open",
        localRegisterSessionId: "local-register-1",
      },
      createdAt: index + 1,
    }));
    const ctx = createAuthorizedRegisterDepositCtx({
      operationalEvent: [],
      organizationMember: [
        {
          _id: "member_1",
          organizationId: "org_1",
          role: "full_admin",
          userId: "athena_user_1",
        },
      ],
      posLocalSyncConflict: duplicateConflicts,
      posLocalSyncEvent: [
        {
          _id: "sync_event_duplicate_open",
          storeId: "store_1",
          terminalId: "terminal_1",
          localRegisterSessionId: "local-register-1",
          localEventId: "event_duplicate_open",
          sequence: 1,
          eventType: "register_opened",
          occurredAt: 2,
          staffProfileId: "staff_1",
          payload: {
            openingFloat: 50000,
            registerNumber: "1",
          },
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
      staffProfile: [
        {
          _id: "manager_1",
          linkedUserId: "athena_user_1",
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
        reviewConflictIds: duplicateConflicts.map((conflict) => conflict._id),
        storeId: "store_1" as Id<"store">,
      },
    );

    expect(result).toEqual(
      ok({
        action: "rejected",
        projectedCount: 0,
        registerSession: expect.objectContaining({ _id: "session_open" }),
        resolvedCount: duplicateConflicts.length,
      }),
    );
    expect(ctx.tables.get("posLocalSyncConflict")).toEqual(
      duplicateConflicts.map((conflict) =>
        expect.objectContaining({
          _id: conflict._id,
          resolvedByStaffProfileId: "manager_1",
          status: "resolved",
        }),
      ),
    );
    expect(ctx.tables.get("posLocalSyncEvent")).toEqual([
      expect.objectContaining({
        _id: "sync_event_duplicate_open",
        rejectionCode: "manager_rejected",
        status: "rejected",
      }),
    ]);
  });

  it("does not keep projected inventory handoff sales in cash-controls review", async () => {
    const ctx = createProjectedInventoryReviewQueryCtx({});

    await expect(
      listOpenLocalSyncConflictsByRegisterSession(
        ctx as never,
        "store_1" as Id<"store">,
        { includeRejectedEvidence: true },
      ),
    ).resolves.toEqual(new Map());
  });

  it("keeps projected inventory sales in cash-controls review when inventory work is closed", async () => {
    const ctx = createProjectedInventoryReviewQueryCtx({
      workItemStatus: "resolved",
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
          [expect.objectContaining({ _id: "sync_conflict_inventory" })],
        ],
      ]),
    );
  });

  it("keeps projected inventory sales in cash-controls review when receipt-only metadata belongs to another local drawer", async () => {
    const ctx = createProjectedInventoryReviewQueryCtx({
      workItemMetadata: {
        localEventId: "other-event",
        localRegisterSessionId: "other-local-register",
        localTransactionId: "other-local-transaction",
        receiptNumber: "939540",
      },
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
          [expect.objectContaining({ _id: "sync_conflict_inventory" })],
        ],
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
          linkedUserId: "athena_user_1",
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
          linkedUserId: "athena_user_1",
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
          linkedUserId: "athena_user_1",
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

  it("lets managers override server-rejected non-cash overpayments at the expected sale total", async () => {
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
                localPaymentId: "local-payment-cash",
                method: "cash",
                amount: 15000,
                timestamp: 2,
              },
              {
                localPaymentId: "local-payment-1",
                method: "mobile_money",
                amount: 16000,
                timestamp: 3,
              },
            ],
          },
          status: "rejected",
          rejectionCode: "validation_failed",
          rejectionMessage:
            "POS sale non-cash payments cannot exceed the sale total.",
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
          linkedUserId: "athena_user_1",
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
    expect(ctx.tables.get("posTransaction")).toEqual([
      expect.objectContaining({
        payments: [
          expect.objectContaining({
            amount: 15000,
            method: "mobile_money",
          }),
        ],
        registerSessionId: "session_open",
        total: 15000,
        totalPaid: 15000,
      }),
    ]);
    expect(ctx.tables.get("paymentAllocation")).toEqual([
      expect.objectContaining({
        amount: 15000,
        externalReference: "local-payment-1",
        method: "mobile_money",
        targetType: "pos_transaction",
      }),
    ]);
    expect(ctx.tables.get("registerSession")).toEqual([
      expect.objectContaining({
        _id: "session_open",
        expectedCash: 50000,
        status: "active",
      }),
    ]);
    expect(ctx.tables.get("posLocalSyncEvent")).toEqual([
      expect.objectContaining({
        _id: "sync_event_rejected",
        payload: expect.objectContaining({
          payments: [
            expect.objectContaining({
              amount: 15000,
              method: "cash",
            }),
            expect.objectContaining({
              amount: 16000,
              method: "mobile_money",
            }),
          ],
        }),
        projectedAt: expect.any(Number),
        status: "projected",
      }),
    ]);
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
          linkedUserId: "athena_user_1",
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
          linkedUserId: "athena_user_1",
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
          linkedUserId: "athena_user_1",
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

  it("applies reviewed synced closeouts when the review summary was normalized", async () => {
    const ctx = createAuthorizedRegisterDepositCtx({
      operationalEvent: [],
      posLocalSyncConflict: [
        {
          _id: "sync_conflict_closeout",
          storeId: "store_1",
          terminalId: "terminal_1",
          localRegisterSessionId: "local-register-1",
          localEventId: "local-register-closed-1",
          sequence: 2,
          conflictType: "permission",
          status: "needs_review",
          summary: "Synced register closeout has a variance.",
          details: {
            countedCash: 45000,
            expectedCash: 50000,
            variance: -5000,
          },
          createdAt: 1,
        },
        {
          _id: "sync_conflict_service",
          storeId: "store_1",
          terminalId: "terminal_1",
          localRegisterSessionId: "local-register-1",
          localEventId: "local-sale-1",
          sequence: 3,
          conflictType: "permission",
          status: "needs_review",
          summary: "Service line is missing customer attribution.",
          details: {},
          createdAt: 2,
        },
      ],
      posLocalSyncEvent: [
        {
          _id: "sync_event_closeout",
          storeId: "store_1",
          terminalId: "terminal_1",
          localRegisterSessionId: "local-register-1",
          localEventId: "local-register-closed-1",
          sequence: 2,
          eventType: "register_closed",
          occurredAt: 2,
          staffProfileId: "staff_1",
          payload: {
            countedCash: 45000,
            notes: "Short drawer",
          },
          status: "conflicted",
          submittedAt: 4,
          acceptedAt: 4,
        },
        {
          _id: "sync_event_service",
          storeId: "store_1",
          terminalId: "terminal_1",
          localRegisterSessionId: "local-register-1",
          localEventId: "local-sale-1",
          sequence: 3,
          eventType: "sale_completed",
          occurredAt: 3,
          staffProfileId: "staff_1",
          payload: {},
          status: "conflicted",
          submittedAt: 5,
          acceptedAt: 5,
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
          linkedUserId: "athena_user_1",
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
        reviewConflictIds: [
          "sync_conflict_closeout" as Id<"posLocalSyncConflict">,
        ],
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
    expect(ctx.tables.get("posLocalSyncEvent")).toEqual([
      expect.objectContaining({
        _id: "sync_event_closeout",
        projectedAt: expect.any(Number),
        status: "projected",
      }),
      expect.objectContaining({
        _id: "sync_event_service",
        status: "conflicted",
      }),
    ]);
    expect(ctx.tables.get("posLocalSyncConflict")).toEqual([
      expect.objectContaining({
        _id: "sync_conflict_closeout",
        status: "resolved",
      }),
      expect.objectContaining({
        _id: "sync_conflict_service",
        status: "needs_review",
      }),
    ]);
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
          linkedUserId: "athena_user_1",
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

  it("clears duplicate synced closeout reviews after manager rejection", async () => {
    const ctx = createAuthorizedRegisterDepositCtx({
      operationalEvent: [],
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
            countedCash: 45000,
            expectedCash: 50000,
            localRegisterSessionId: "session_closed",
            notes: "cash count issue",
            status: "closed",
            variance: -5000,
          },
          createdAt: 1,
        },
        {
          _id: "sync_conflict_closeout_shadow",
          storeId: "store_1",
          terminalId: "terminal_1",
          localRegisterSessionId: "session_closed",
          localEventId: "event_closeout",
          sequence: 2,
          conflictType: "permission",
          status: "needs_review",
          summary: "Register session is not open for synced POS closeout.",
          details: {
            countedCash: 45000,
            expectedCash: 50000,
            localRegisterSessionId: "session_closed",
            notes: "cash count issue",
            status: "closed",
            variance: -5000,
          },
          createdAt: 2,
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
            countedCash: 45000,
            notes: "cash count issue",
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
          linkedUserId: "athena_user_1",
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
        registerSessionId: "session_closed" as Id<"registerSession">,
        reviewConflictIds: [
          "sync_conflict_closeout" as Id<"posLocalSyncConflict">,
        ],
        storeId: "store_1" as Id<"store">,
      },
    );

    expect(result).toEqual(
      ok({
        action: "rejected",
        projectedCount: 0,
        registerSession: expect.objectContaining({ _id: "session_closed" }),
        resolvedCount: 1,
      }),
    );
    expect(ctx.tables.get("posLocalSyncEvent")).toEqual([
      expect.objectContaining({
        _id: "sync_event_closeout",
        rejectionCode: "manager_rejected",
        rejectionMessage:
          "Manager rejected synced register activity during cash-controls review.",
        status: "rejected",
      }),
    ]);
    expect(ctx.tables.get("posLocalSyncConflict")).toEqual([
      expect.objectContaining({
        _id: "sync_conflict_closeout",
        status: "resolved",
      }),
      expect.objectContaining({
        _id: "sync_conflict_closeout_shadow",
        status: "resolved",
      }),
    ]);
    await expect(
      listOpenLocalSyncConflictsByRegisterSession(
        ctx as never,
        "store_1" as Id<"store">,
        { includeRejectedEvidence: true },
      ),
    ).resolves.toEqual(new Map());
    expect(ctx.tables.get("operationalEvent")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actorStaffProfileId: "manager_1",
          eventType: "register_session_sync_closeout_rejected",
          localEventId: "event_closeout",
          message: "Rejected synced closeout for Register 1.",
          metadata: expect.objectContaining({
            conflictId: "sync_conflict_closeout",
            countedCash: 45000,
            decision: "rejected",
            expectedCash: 50000,
            notes: "cash count issue",
            sequence: 2,
            syncOrigin: "local_sync",
            variance: -5000,
          }),
          registerSessionId: "session_closed",
          subjectId: "session_closed",
          terminalId: "terminal_1",
        }),
      ]),
    );
  });

  it("persists rejected variance closeout reviews without clearing evidence", async () => {
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
            notes: "cash count issue",
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
            notes: "cash count issue",
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
          countedCash: 45000,
          expectedCash: 50000,
          notes: "cash count issue",
          openedAt: 1,
          openingFloat: 50000,
          organizationId: "org_1",
          registerNumber: "1",
          status: "closing",
          storeId: "store_1",
          terminalId: "terminal_1",
          variance: -5000,
        },
      ],
      staffProfile: [
        {
          _id: "manager_1",
          linkedUserId: "athena_user_1",
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
        reviewConflictIds: [
          "sync_conflict_closeout" as Id<"posLocalSyncConflict">,
        ],
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
    expect(ctx.tables.get("registerSession")).toEqual([
      expect.objectContaining({
        _id: "session_open",
        countedCash: 45000,
        expectedCash: 50000,
        notes: "cash count issue",
        status: "closeout_rejected",
        variance: -5000,
      }),
    ]);
    expect(ctx.tables.get("posLocalSyncEvent")).toEqual([
      expect.objectContaining({
        _id: "sync_event_closeout",
        rejectionCode: "manager_rejected",
        status: "rejected",
      }),
    ]);
    expect(ctx.tables.get("posLocalSyncConflict")).toEqual([
      expect.objectContaining({
        _id: "sync_conflict_closeout",
        status: "resolved",
      }),
    ]);
  });

  it("does not report success when a scoped review id is no longer present", async () => {
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
          details: {},
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
          payload: {},
          status: "conflicted",
          submittedAt: 4,
          acceptedAt: 4,
        },
      ],
      registerSession: [
        {
          _id: "session_closed",
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
          linkedUserId: "athena_user_1",
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
        decision: "rejected",
        registerSessionId: "session_closed" as Id<"registerSession">,
        reviewConflictIds: ["stale-review-id"],
        storeId: "store_1" as Id<"store">,
      }),
    ).resolves.toEqual(
      userError({
        code: "precondition_failed",
        message:
          "This register review changed before the action completed. Refresh the register session and try again.",
      }),
    );
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

  it("includes the target session sync review when the store-level review backlog is capped", async () => {
    const olderConflicts = Array.from({ length: 500 }, (_, index) => ({
      _id: `sync_conflict_${index}`,
      storeId: "store_1",
      terminalId: "terminal_backlog",
      localRegisterSessionId: `local-register-${index}`,
      localEventId: `event_${index}`,
      sequence: index + 1,
      conflictType: "permission",
      status: "needs_review",
      summary: "Backlogged register activity needs review.",
      details: {},
      createdAt: index + 1,
    }));
    const ctx = createAuthorizedRegisterDepositCtx({
      posLocalSyncConflict: [
        ...olderConflicts,
        {
          _id: "sync_conflict_target",
          storeId: "store_1",
          terminalId: "terminal_1",
          localRegisterSessionId: "local-register-target",
          localEventId: "event_target_closeout",
          sequence: 501,
          conflictType: "permission",
          status: "needs_review",
          summary:
            "Register closeout variance requires manager review before synced closeout can be applied.",
          details: {
            countedCash: 4000,
            expectedCash: 3000,
            variance: 1000,
          },
          createdAt: 501,
        },
      ],
      posLocalSyncEvent: [
        {
          _id: "sync_event_target",
          storeId: "store_1",
          terminalId: "terminal_1",
          localRegisterSessionId: "local-register-target",
          localEventId: "event_target_closeout",
          sequence: 501,
          eventType: "register_closed",
          occurredAt: 501,
          staffProfileId: "staff_1",
          payload: { countedCash: 4000 },
          status: "conflicted",
          submittedAt: 501,
        },
      ],
      posLocalSyncMapping: [
        {
          _id: "sync_mapping_target",
          storeId: "store_1",
          terminalId: "terminal_1",
          localRegisterSessionId: "local-register-target",
          localIdKind: "registerSession",
          localId: "local-register-target",
          cloudTable: "registerSession",
          cloudId: "session_open",
        },
      ],
      registerSession: [
        {
          _id: "session_open",
          countedCash: 4000,
          expectedCash: 3000,
          openedAt: 1,
          openingFloat: 3000,
          organizationId: "org_1",
          registerNumber: "1",
          status: "closing",
          storeId: "store_1",
          terminalId: "terminal_1",
          variance: 1000,
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
          localSyncStatus: expect.objectContaining({
            reconciliationItems: [
              expect.objectContaining({
                id: "sync_conflict_target",
                reviewKind: "register_closeout_variance",
              }),
            ],
            status: "needs_review",
          }),
        }),
      }),
    );
    expect(ctx.indexReads).not.toContainEqual({
      indexName: "by_store_status",
      tableName: "posLocalSyncConflict",
    });
    expect(ctx.indexReads).not.toContainEqual({
      indexName: "by_store_status",
      tableName: "posLocalSyncEvent",
    });
  });

  it("applies the target session sync review when the store-level review backlog is capped", async () => {
    const olderConflicts = Array.from({ length: 500 }, (_, index) => ({
      _id: `sync_conflict_${index}`,
      storeId: "store_1",
      terminalId: "terminal_backlog",
      localRegisterSessionId: `local-register-${index}`,
      localEventId: `event_${index}`,
      sequence: index + 1,
      conflictType: "permission",
      status: "needs_review",
      summary: "Backlogged register activity needs review.",
      details: {},
      createdAt: index + 1,
    }));
    const ctx = createAuthorizedRegisterDepositCtx({
      operationalEvent: [],
      posLocalSyncConflict: [
        ...olderConflicts,
        {
          _id: "sync_conflict_target",
          storeId: "store_1",
          terminalId: "terminal_1",
          localRegisterSessionId: "local-register-target",
          localEventId: "event_target_closeout",
          sequence: 501,
          conflictType: "permission",
          status: "needs_review",
          summary:
            "Register closeout variance requires manager review before synced closeout can be applied.",
          details: {
            countedCash: 4000,
            expectedCash: 3000,
            variance: 1000,
          },
          createdAt: 501,
        },
      ],
      posLocalSyncEvent: [
        {
          _id: "sync_event_target",
          storeId: "store_1",
          terminalId: "terminal_1",
          localRegisterSessionId: "local-register-target",
          localEventId: "event_target_closeout",
          sequence: 501,
          eventType: "register_closed",
          occurredAt: 501,
          staffProfileId: "staff_1",
          payload: { countedCash: 4000 },
          status: "conflicted",
          submittedAt: 501,
        },
      ],
      posLocalSyncMapping: [
        {
          _id: "sync_mapping_target",
          storeId: "store_1",
          terminalId: "terminal_1",
          localRegisterSessionId: "local-register-target",
          localIdKind: "registerSession",
          localId: "local-register-target",
          cloudTable: "registerSession",
          cloudId: "session_open",
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
      registerSession: [
        {
          _id: "session_open",
          closeoutRecords: [],
          countedCash: 4000,
          expectedCash: 3000,
          openedAt: 1,
          openingFloat: 3000,
          organizationId: "org_1",
          registerNumber: "1",
          status: "closing",
          storeId: "store_1",
          terminalId: "terminal_1",
          variance: 1000,
        },
      ],
      staffProfile: [
        {
          _id: "manager_1",
          linkedUserId: "athena_user_1",
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
        reviewConflictIds: [
          "sync_conflict_target" as Id<"posLocalSyncConflict">,
        ],
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
    expect(ctx.tables.get("posLocalSyncEvent")).toEqual([
      expect.objectContaining({
        _id: "sync_event_target",
        projectedAt: expect.any(Number),
        status: "projected",
      }),
    ]);
    expect(ctx.tables.get("posLocalSyncConflict")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          _id: "sync_conflict_target",
          resolvedAt: expect.any(Number),
          status: "resolved",
        }),
      ]),
    );
  });

  it("sanitizes internal sync metadata from register-session timelines", async () => {
    const ctx = createAuthorizedRegisterDepositCtx({
      operationalEvent: [
        {
          _id: "event_sync_review",
          actorStaffProfileId: "staff_1",
          createdAt: 10,
          eventType: "register_session_sync_review_resolved",
          metadata: {
            conflictIds: ["sync_conflict_missing_mapping"],
            decision: "approved",
            localEventIds: ["event_sale_1"],
            managerOverride: false,
            originalStatuses: ["conflicted"],
            projectedTransactionIds: ["transaction_1"],
            sequences: [3],
          },
          message: "Applied reviewed synced register sale.",
          registerSessionId: "session_open",
          storeId: "store_1",
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
        timeline: [
          expect.objectContaining({
            _id: "event_sync_review",
            metadata: {
              decision: "approved",
              managerOverride: false,
            },
          }),
        ],
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

  it("rejects new deposits while register-scoped void approvals are pending", async () => {
    const ctx = createAuthorizedRegisterDepositCtx({
      approvalRequest: [
        {
          _id: "void_approval_1",
          createdAt: 1,
          organizationId: "org_1",
          posTransactionId: "transaction_1",
          registerSessionId: "session_open",
          requestType: "pos_transaction_void",
          status: "pending",
          storeId: "store_1",
          subjectId: "transaction_1",
          subjectType: "pos_transaction",
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
    ).resolves.toEqual({
      kind: "user_error",
      error: {
        code: "precondition_failed",
        message: "Resolve pending void approvals before recording a deposit.",
      },
    });

    expect(ctx.tables.get("paymentAllocation")).toEqual([]);
  });

  it("rejects new deposits while repairable register mapping reviews are pending", async () => {
    const ctx = createAuthorizedRegisterDepositCtx({
      posLocalSyncConflict: [
        {
          _id: "sync_conflict_missing_mapping",
          storeId: "store_1",
          terminalId: "terminal_1",
          localRegisterSessionId: "local-register-1",
          localEventId: "event_sale_1",
          sequence: 3,
          conflictType: "permission",
          status: "needs_review",
          summary: "Register session mapping is missing for synced POS history.",
          details: {
            localTransactionId: "local-transaction-1",
          },
          createdAt: 1,
        },
      ],
      posLocalSyncEvent: [
        {
          _id: "sync_event_sale_1",
          storeId: "store_1",
          terminalId: "terminal_1",
          localRegisterSessionId: "local-register-1",
          localEventId: "event_sale_1",
          sequence: 3,
          eventType: "sale_completed",
          occurredAt: 2,
          staffProfileId: "staff_1",
          payload: {
            localTransactionId: "local-transaction-1",
            receiptNumber: "R-1001",
          },
          status: "conflicted",
          submittedAt: 2,
        },
      ],
      posLocalSyncMapping: [
        {
          _id: "transaction_mapping_1",
          storeId: "store_1",
          terminalId: "terminal_1",
          localRegisterSessionId: "local-register-1",
          localEventId: "event_sale_1",
          localIdKind: "transaction",
          localId: "local-transaction-1",
          cloudTable: "posTransaction",
          cloudId: "transaction_1",
          createdAt: 2,
        },
      ],
      posTransaction: [
        {
          _id: "transaction_1",
          completedAt: 2,
          registerSessionId: "session_open",
          status: "completed",
          storeId: "store_1",
          terminalId: "terminal_1",
          total: 15000,
          transactionNumber: "R-1001",
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
          status: "open",
          storeId: "store_1",
          terminalId: "terminal_1",
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
    ).resolves.toEqual({
      kind: "user_error",
      error: {
        code: "precondition_failed",
        message: "Resolve pending register corrections before recording a deposit.",
      },
    });

    expect(ctx.tables.get("paymentAllocation")).toEqual([]);
  });

  it("records register-session deposits with authenticated actor refs", async () => {
    const ctx = createAuthorizedRegisterDepositCtx();

    const result = await getHandler(recordRegisterSessionDeposit)(
      ctx as never,
      {
        actorStaffProfileId: "staff_1" as Id<"staffProfile">,
        amount: 100,
        registerSessionId: "session_open" as Id<"registerSession">,
        storeId: "store_1" as Id<"store">,
        submissionKey: "deposit-1",
      },
    );

    expect(result).toEqual(
      expect.objectContaining({
        data: expect.objectContaining({ action: "recorded" }),
        kind: "ok",
      }),
    );
    expect(() =>
      assertConformsToExportedReturns(recordRegisterSessionDeposit, result),
    ).not.toThrow();

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
