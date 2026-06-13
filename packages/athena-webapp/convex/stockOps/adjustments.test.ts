import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";

const mockedAuthServer = vi.hoisted(() => ({
  getAuthUserId: vi.fn(),
}));

vi.mock("@convex-dev/auth/server", () => ({
  getAuthUserId: mockedAuthServer.getAuthUserId,
}));

import {
  STOCK_ADJUSTMENT_APPROVAL_THRESHOLD,
  assertDistinctStockAdjustmentLineItems,
  assertStockAdjustmentReasonCode,
  calculateCycleCountQuantityDelta,
  hasHighStockAdjustmentVariance,
  listInventorySnapshotWithCtx,
  requiresStockAdjustmentApproval,
  resolveStockAdjustmentApprovalDecisionWithCtx,
  resolveStockAdjustmentQuantityDelta,
  submitStockAdjustmentBatchCommandWithCtx,
  submitStockAdjustmentBatchWithCtx,
  summarizeStockAdjustmentLineItems,
} from "./adjustments";

function getSource(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

function createInventorySnapshotQueryCtx() {
  const tables = {
    category: new Map<string, Record<string, unknown>>([
      ["category-1", { _id: "category-1", name: "Hair" }],
    ]),
    color: new Map<string, Record<string, unknown>>([
      ["color-1", { _id: "color-1", name: "Black" }],
    ]),
    checkoutSession: new Map<string, Record<string, unknown>>(),
    checkoutSessionItem: new Map<string, Record<string, unknown>>(),
    inventoryHold: new Map<string, Record<string, unknown>>([
      [
        "hold-active",
        {
          _id: "hold-active",
          expiresAt: 2_000,
          productSkuId: "sku-1",
          quantity: 2,
          sourceSessionId: "session-1",
          status: "active",
          storeId: "store-1",
        },
      ],
      [
        "hold-expired",
        {
          _id: "hold-expired",
          expiresAt: 500,
          productSkuId: "sku-1",
          quantity: 1,
          sourceSessionId: "session-2",
          status: "active",
          storeId: "store-1",
        },
      ],
      [
        "hold-released",
        {
          _id: "hold-released",
          expiresAt: 2_000,
          productSkuId: "sku-1",
          quantity: 4,
          sourceSessionId: "session-3",
          status: "released",
          storeId: "store-1",
        },
      ],
    ]),
    inventoryImportProvisionalSku: new Map<string, Record<string, unknown>>(),
    posPendingCheckoutItem: new Map<string, Record<string, unknown>>(),
    product: new Map<string, Record<string, unknown>>([
      [
        "product-1",
        {
          _id: "product-1",
          categoryId: "category-1",
          name: "Closure Wig",
        },
      ],
    ]),
    productSku: new Map<string, Record<string, unknown>>([
      [
        "sku-1",
        {
          _id: "sku-1",
          color: "color-1",
          images: [],
          inventoryCount: 10,
          netPrice: 4200,
          price: 4500,
          productId: "product-1",
          quantityAvailable: 8,
          size: "Large",
          sku: "CW-18",
          storeId: "store-1",
        },
      ],
    ]),
  };

  function indexedQuery(table: keyof typeof tables) {
    const filters: Array<[string, unknown | { gt: number }]> = [];
    const filteredRecords = () =>
      Array.from(tables[table].values()).filter((record) =>
        filters.every(([field, value]) =>
          typeof value === "object" && value !== null && "gt" in value
            ? Number(record[field]) > (value as { gt: number }).gt
            : record[field] === value,
        ),
      );

    const query = {
      collect: async () => filteredRecords(),
      take: async (limit: number) => filteredRecords().slice(0, limit),
      withIndex(
        _index: string,
        applyIndex: (builder: {
          eq: (field: string, value: unknown) => unknown;
          gt: (field: string, value: number) => unknown;
        }) => unknown,
      ) {
        const builder = {
          eq(field: string, value: unknown) {
            filters.push([field, value]);
            return builder;
          },
          gt(field: string, value: number) {
            filters.push([field, { gt: value }]);
            return builder;
          },
        };

        applyIndex(builder);

        return {
          collect: async () => filteredRecords(),
          first: async () => filteredRecords()[0] ?? null,
          take: async (limit: number) => filteredRecords().slice(0, limit),
        };
      },
    };

    return query;
  }

  const ctx = {
    db: {
      async get(tableOrId: string, maybeId?: string) {
        if (maybeId === undefined) {
          for (const table of Object.values(tables)) {
            const record = table.get(tableOrId);
            if (record) return record;
          }

          return null;
        }

        return tables[tableOrId as keyof typeof tables].get(maybeId) ?? null;
      },
      query(table: keyof typeof tables) {
        return indexedQuery(table);
      },
    },
  } as unknown as QueryCtx;

  return { ctx, tables };
}

function createApprovalDecisionMutationCtx() {
  const tables = {
    approvalRequest: new Map<string, Record<string, unknown>>([
      [
        "approval-1",
        {
          _id: "approval-1",
          requestType: "inventory_adjustment_review",
          status: "pending",
          storeId: "store-1",
          subjectId: "batch-1",
          subjectType: "stock_adjustment_batch",
          workItemId: "work-item-1",
        },
      ],
    ]),
    inventoryMovement: new Map<string, Record<string, unknown>>(),
    inventoryImportProvisionalSku: new Map<string, Record<string, unknown>>(),
    posPendingCheckoutItem: new Map<string, Record<string, unknown>>(),
    operationalEvent: new Map<string, Record<string, unknown>>(),
    operationalWorkItem: new Map<string, Record<string, unknown>>([
      [
        "work-item-1",
        {
          _id: "work-item-1",
          approvalRequestId: "approval-1",
          approvalState: "pending",
          status: "open",
          storeId: "store-1",
        },
      ],
    ]),
    productSku: new Map<string, Record<string, unknown>>([
      [
        "sku-1",
        {
          _id: "sku-1",
          inventoryCount: 8,
          productId: "product-1",
          productName: "Closure wig",
          quantityAvailable: 6,
          sku: "CW-18",
          storeId: "store-1",
        },
      ],
    ]),
    skuActivityEvent: new Map<string, Record<string, unknown>>(),
    stockAdjustmentBatch: new Map<string, Record<string, unknown>>([
      [
        "batch-1",
        {
          _id: "batch-1",
          adjustmentType: "manual",
          approvalRequestId: "approval-1",
          approvalRequired: true,
          createdAt: 1,
          createdByUserId: "operator-1",
          largestAbsoluteDelta: 6,
          lineItemCount: 1,
          lineItems: [
            {
              productId: "product-1",
              productName: "Closure wig",
              productSkuId: "sku-1",
              quantityDelta: -6,
              sku: "CW-18",
              systemQuantity: 8,
            },
          ],
          netQuantityDelta: -6,
          notes: "Cycle count variance",
          operationalWorkItemId: "work-item-1",
          organizationId: "org-1",
          reasonCode: "damage",
          status: "pending_approval",
          storeId: "store-1",
          submissionKey: "batch-key",
        },
      ],
    ]),
  };
  const insertCounters: Record<
    "inventoryMovement" | "operationalEvent" | "skuActivityEvent",
    number
  > = {
    inventoryMovement: 0,
    operationalEvent: 0,
    skuActivityEvent: 0,
  };

  const queryTable = (
    table: "inventoryMovement" | "operationalEvent" | "skuActivityEvent",
  ) => ({
    withIndex(
      _index: string,
      applyIndex: (query: {
        eq: (field: string, value: unknown) => unknown;
      }) => unknown,
    ) {
      const filters: Array<[string, unknown]> = [];
      const query = {
        eq(field: string, value: unknown) {
          filters.push([field, value]);
          return query;
        },
      };

      applyIndex(query);

      return {
        collect: async () =>
          Array.from(tables[table].values()).filter((record) =>
            filters.every(([field, value]) => record[field] === value),
          ),
        first: async () =>
          Array.from(tables[table].values()).find((record) =>
            filters.every(([field, value]) => record[field] === value),
          ) ?? null,
        take: async (limit: number) =>
          Array.from(tables[table].values())
            .filter((record) =>
              filters.every(([field, value]) => record[field] === value),
            )
            .slice(0, limit),
      };
    },
  });

  const ctx = {
    db: {
      async get(table: keyof typeof tables, id: string) {
        return tables[table].get(id) ?? null;
      },
      async insert(
        table: "inventoryMovement" | "operationalEvent" | "skuActivityEvent",
        value: Record<string, unknown>,
      ) {
        insertCounters[table] += 1;
        const id = `${table}-${insertCounters[table]}`;
        tables[table].set(id, { _id: id, ...value });
        return id;
      },
      async patch(
        table: keyof typeof tables,
        id: string,
        value: Record<string, unknown>,
      ) {
        const existingRecord = tables[table].get(id);

        if (!existingRecord) {
          throw new Error(`Missing ${table} record: ${id}`);
        }

        tables[table].set(id, { ...existingRecord, ...value });
      },
      query(
        table: "inventoryMovement" | "operationalEvent" | "skuActivityEvent",
      ) {
        return queryTable(table);
      },
    },
  } as unknown as MutationCtx;

  return { ctx, tables };
}

function createSubmissionMutationCtx(args: {
  athenaUsers?: Array<{ _id: string; email: string }>;
  authUserId?: string | null;
  membershipRole?: "full_admin" | "pos_only" | null;
}) {
  const tables = {
    approvalRequest: new Map<string, Record<string, unknown>>(),
    athenaUser: new Map<string, Record<string, unknown>>(
      (
        args.athenaUsers ?? [
          {
            _id: "operator-1",
            email: "operator@example.com",
          },
        ]
      ).map((athenaUser) => [athenaUser._id, athenaUser]),
    ),
    inventoryMovement: new Map<string, Record<string, unknown>>(),
    inventoryImportProvisionalSku: new Map<string, Record<string, unknown>>(),
    operationalEvent: new Map<string, Record<string, unknown>>(),
    operationalWorkItem: new Map<string, Record<string, unknown>>(),
    organizationMember: new Map<string, Record<string, unknown>>(
      args.membershipRole
        ? [
            [
              "membership-1",
              {
                _id: "membership-1",
                organizationId: "org-1",
                role: args.membershipRole,
                userId: "operator-1",
              },
            ],
          ]
        : [],
    ),
    productSku: new Map<string, Record<string, unknown>>([
      [
        "sku-1",
        {
          _id: "sku-1",
          inventoryCount: 8,
          productId: "product-1",
          productName: "Closure wig",
          quantityAvailable: 6,
          sku: "CW-18",
          storeId: "store-1",
        },
      ],
    ]),
    posPendingCheckoutItem: new Map<string, Record<string, unknown>>(),
    skuActivityEvent: new Map<string, Record<string, unknown>>(),
    stockAdjustmentBatch: new Map<string, Record<string, unknown>>(),
    store: new Map<string, Record<string, unknown>>([
      [
        "store-1",
        {
          _id: "store-1",
          organizationId: "org-1",
        },
      ],
    ]),
    users: new Map<string, Record<string, unknown>>([
      [
        "auth-user-1",
        {
          _id: "auth-user-1",
          email: "operator@example.com",
        },
      ],
    ]),
  };
  const insertCounters: Record<
    | "approvalRequest"
    | "inventoryMovement"
    | "operationalEvent"
    | "operationalWorkItem"
    | "skuActivityEvent"
    | "stockAdjustmentBatch",
    number
  > = {
    approvalRequest: 0,
    inventoryMovement: 0,
    operationalEvent: 0,
    operationalWorkItem: 0,
    skuActivityEvent: 0,
    stockAdjustmentBatch: 0,
  };

  mockedAuthServer.getAuthUserId.mockResolvedValue(args.authUserId ?? null);

  const indexedQuery = (
    table:
      | "inventoryMovement"
      | "inventoryImportProvisionalSku"
      | "operationalEvent"
      | "posPendingCheckoutItem"
      | "skuActivityEvent"
      | "stockAdjustmentBatch",
  ) => ({
    withIndex(
      _index: string,
      applyIndex: (query: {
        eq: (field: string, value: unknown) => unknown;
      }) => unknown,
    ) {
      const filters: Array<[string, unknown]> = [];
      const query = {
        eq(field: string, value: unknown) {
          filters.push([field, value]);
          return query;
        },
      };

      applyIndex(query);

      return {
        collect: async () =>
          Array.from(tables[table].values()).filter((record) =>
            filters.every(([field, value]) => record[field] === value),
          ),
        first: async () =>
          Array.from(tables[table].values()).find((record) =>
            filters.every(([field, value]) => record[field] === value),
          ) ?? null,
        take: async (limit: number) =>
          Array.from(tables[table].values())
            .filter((record) =>
              filters.every(([field, value]) => record[field] === value),
            )
            .slice(0, limit),
      };
    },
  });

  const ctx = {
    auth: {},
    db: {
      async get(tableOrId: keyof typeof tables | string, id?: string) {
        if (id === undefined) {
          return tables.users.get(tableOrId as string) ?? null;
        }

        return tables[tableOrId as keyof typeof tables].get(id) ?? null;
      },
      async insert(
        table:
          | "approvalRequest"
          | "inventoryMovement"
          | "operationalEvent"
          | "operationalWorkItem"
          | "skuActivityEvent"
          | "stockAdjustmentBatch",
        value: Record<string, unknown>,
      ) {
        insertCounters[table] += 1;
        const id = `${table}-${insertCounters[table]}`;
        tables[table].set(id, { _id: id, ...value });
        return id;
      },
      async patch(
        table: keyof typeof tables,
        id: string,
        value: Record<string, unknown>,
      ) {
        const existingRecord = tables[table].get(id);

        if (!existingRecord) {
          throw new Error(`Missing ${table} record: ${id}`);
        }

        tables[table].set(id, { ...existingRecord, ...value });
      },
      query(table: keyof typeof tables) {
        if (table === "athenaUser") {
          return {
            collect: async () => Array.from(tables.athenaUser.values()),
          };
        }

        if (table === "organizationMember") {
          return {
            filter(
              applyFilter: (queryBuilder: {
                and: (...conditions: unknown[]) => unknown;
                eq: (left: unknown, right: unknown) => unknown;
                field: (name: string) => string;
              }) => unknown,
            ) {
              const filters: Array<[string, unknown]> = [];
              const queryBuilder = {
                and: (...conditions: unknown[]) => conditions,
                eq(left: unknown, right: unknown) {
                  filters.push([left as string, right]);
                  return { left, right };
                },
                field(name: string) {
                  return name;
                },
              };

              applyFilter(queryBuilder);

              return {
                first: async () =>
                  Array.from(tables.organizationMember.values()).find(
                    (record) =>
                      filters.every(
                        ([field, value]) => record[field] === value,
                      ),
                  ) ?? null,
              };
            },
          };
        }

        if (
          table === "inventoryMovement" ||
          table === "inventoryImportProvisionalSku" ||
          table === "operationalEvent" ||
          table === "posPendingCheckoutItem" ||
          table === "skuActivityEvent" ||
          table === "stockAdjustmentBatch"
        ) {
          return indexedQuery(table);
        }

        throw new Error(`Unexpected query table: ${table}`);
      },
    },
  } as unknown as MutationCtx;

  return { ctx, tables };
}

describe("stock ops adjustments", () => {
  it("returns hold-adjusted sellable availability while preserving durable SKU availability", async () => {
    const { ctx } = createInventorySnapshotQueryCtx();

    const rows = await listInventorySnapshotWithCtx(ctx, {
      now: 1_000,
      storeId: "store-1" as Id<"store">,
    });

    expect(rows).toEqual([
      expect.objectContaining({
        _id: "sku-1",
        durableQuantityAvailable: 8,
        inventoryCount: 10,
        netPrice: 4200,
        price: 4500,
        quantityAvailable: 6,
        reservedQuantity: 2,
        size: "Large",
      }),
    ]);
  });

  it("labels active checkout reservations without double subtracting availability", async () => {
    const { ctx, tables } = createInventorySnapshotQueryCtx();

    tables.checkoutSession.set("checkout-active", {
      _id: "checkout-active",
      expiresAt: 2_000,
      hasCompletedCheckoutSession: false,
      storeId: "store-1",
    });
    tables.checkoutSession.set("checkout-completed", {
      _id: "checkout-completed",
      expiresAt: 2_000,
      hasCompletedCheckoutSession: true,
      storeId: "store-1",
    });
    tables.checkoutSession.set("checkout-expired", {
      _id: "checkout-expired",
      expiresAt: 500,
      hasCompletedCheckoutSession: false,
      storeId: "store-1",
    });
    tables.checkoutSessionItem.set("checkout-item-active", {
      _id: "checkout-item-active",
      productSkuId: "sku-1",
      quantity: 1,
      sesionId: "checkout-active",
    });
    tables.checkoutSessionItem.set("checkout-item-completed", {
      _id: "checkout-item-completed",
      productSkuId: "sku-1",
      quantity: 3,
      sesionId: "checkout-completed",
    });
    tables.checkoutSessionItem.set("checkout-item-expired", {
      _id: "checkout-item-expired",
      productSkuId: "sku-1",
      quantity: 5,
      sesionId: "checkout-expired",
    });

    const rows = await listInventorySnapshotWithCtx(ctx, {
      now: 1_000,
      storeId: "store-1" as Id<"store">,
    });

    expect(rows).toEqual([
      expect.objectContaining({
        _id: "sku-1",
        checkoutReservedQuantity: 1,
        durableQuantityAvailable: 8,
        inventoryCount: 10,
        posReservedQuantity: 2,
        quantityAvailable: 6,
        reservedQuantity: 3,
      }),
    ]);
  });

  it("marks active provisional legacy import SKUs as blocked for stock adjustments", async () => {
    const { ctx, tables } = createInventorySnapshotQueryCtx();

    tables.inventoryImportProvisionalSku.set("provisional-1", {
      _id: "provisional-1",
      productSkuId: "sku-1",
      status: "active",
      storeId: "store-1",
    });

    const rows = await listInventorySnapshotWithCtx(ctx, {
      now: 1_000,
      storeId: "store-1" as Id<"store">,
    });

    expect(rows).toEqual([
      expect.objectContaining({
        _id: "sku-1",
        stockAdjustmentBlockedMessage:
          "Legacy import SKUs must be finalized before stock adjustments can update them.",
        stockAdjustmentBlockedReason: "provisional_import",
      }),
    ]);
  });

  it("marks unresolved POS pending checkout SKUs as blocked for stock adjustments", async () => {
    const { ctx, tables } = createInventorySnapshotQueryCtx();

    tables.posPendingCheckoutItem.set("pending-checkout-1", {
      _id: "pending-checkout-1",
      provisionalProductSkuId: "sku-1",
      status: "pending_review",
      storeId: "store-1",
    });

    const rows = await listInventorySnapshotWithCtx(ctx, {
      now: 1_000,
      storeId: "store-1" as Id<"store">,
    });

    expect(rows).toEqual([
      expect.objectContaining({
        _id: "sku-1",
        stockAdjustmentBlockedMessage:
          "POS pending checkout SKUs must be finalized before stock adjustments can update them.",
        stockAdjustmentBlockedReason: "pos_pending_checkout",
      }),
    ]);
  });

  it("uses store-scoped blocker scans for full-store stock adjustment snapshots", async () => {
    const { ctx, tables } = createInventorySnapshotQueryCtx();

    for (let index = 2; index <= 60; index += 1) {
      tables.productSku.set(`sku-${index}`, {
        _id: `sku-${index}`,
        images: [],
        inventoryCount: 0,
        netPrice: 1000,
        price: 1000,
        productId: "product-1",
        quantityAvailable: 0,
        sku: `SKU-${index}`,
        storeId: "store-1",
      });
    }
    tables.inventoryImportProvisionalSku.set("provisional-60", {
      _id: "provisional-60",
      productSkuId: "sku-60",
      status: "active",
      storeId: "store-1",
    });
    tables.posPendingCheckoutItem.set("pending-checkout-59", {
      _id: "pending-checkout-59",
      provisionalProductSkuId: "sku-59",
      status: "pending_review",
      storeId: "store-1",
    });

    const rows = await listInventorySnapshotWithCtx(ctx, {
      now: 1_000,
      storeId: "store-1" as Id<"store">,
    });

    expect(rows).toHaveLength(60);
    expect(rows.find((row) => row._id === "sku-59")).toMatchObject({
      stockAdjustmentBlockedMessage:
        "POS pending checkout SKUs must be finalized before stock adjustments can update them.",
      stockAdjustmentBlockedReason: "pos_pending_checkout",
    });
    expect(rows.find((row) => row._id === "sku-60")).toMatchObject({
      stockAdjustmentBlockedMessage:
        "Legacy import SKUs must be finalized before stock adjustments can update them.",
      stockAdjustmentBlockedReason: "provisional_import",
    });
  });

  it("calculates cycle-count deltas from the system quantity", () => {
    expect(
      calculateCycleCountQuantityDelta({
        countedQuantity: 3,
        systemQuantity: 8,
      }),
    ).toBe(-5);

    expect(
      calculateCycleCountQuantityDelta({
        countedQuantity: 13,
        systemQuantity: 8,
      }),
    ).toBe(5);
  });

  it("rejects duplicate sku entries inside one adjustment batch", () => {
    expect(() =>
      assertDistinctStockAdjustmentLineItems([
        {
          productSkuId: "sku-1",
        },
        {
          productSkuId: "sku-1",
        },
      ]),
    ).toThrow("cannot include the same SKU twice");
  });

  it("requires valid reason codes for manual adjustments and cycle counts", () => {
    expect(() =>
      assertStockAdjustmentReasonCode("manual", "damage"),
    ).not.toThrow();
    expect(() =>
      assertStockAdjustmentReasonCode("manual", "cycle_count_reconciliation"),
    ).toThrow("Manual stock adjustments require a supported reason code.");

    expect(() =>
      assertStockAdjustmentReasonCode(
        "cycle_count",
        "cycle_count_reconciliation",
      ),
    ).not.toThrow();
    expect(() =>
      assertStockAdjustmentReasonCode("cycle_count", "correction"),
    ).toThrow("Cycle counts must reconcile with the cycle-count reason code.");
  });

  it("requires manual adjustment approval when a batch crosses the variance threshold", () => {
    const belowThreshold = summarizeStockAdjustmentLineItems([
      { quantityDelta: STOCK_ADJUSTMENT_APPROVAL_THRESHOLD - 1 },
      { quantityDelta: -1 },
    ]);
    const atThreshold = summarizeStockAdjustmentLineItems([
      { quantityDelta: STOCK_ADJUSTMENT_APPROVAL_THRESHOLD },
    ]);

    expect(hasHighStockAdjustmentVariance(belowThreshold)).toBe(false);
    expect(hasHighStockAdjustmentVariance(atThreshold)).toBe(true);
    expect(
      requiresStockAdjustmentApproval({
        adjustmentType: "manual",
        largestAbsoluteDelta: belowThreshold.largestAbsoluteDelta,
      }),
    ).toBe(false);
    expect(
      requiresStockAdjustmentApproval({
        adjustmentType: "manual",
        largestAbsoluteDelta: atThreshold.largestAbsoluteDelta,
      }),
    ).toBe(true);
    expect(
      requiresStockAdjustmentApproval({
        adjustmentType: "cycle_count",
        largestAbsoluteDelta: atThreshold.largestAbsoluteDelta,
      }),
    ).toBe(false);
  });

  it("requires typed quantities that match the adjustment mode", () => {
    expect(
      resolveStockAdjustmentQuantityDelta({
        adjustmentType: "manual",
        quantityDelta: -2,
        systemQuantity: 8,
      }),
    ).toBe(-2);

    expect(
      resolveStockAdjustmentQuantityDelta({
        adjustmentType: "cycle_count",
        countedQuantity: 11,
        systemQuantity: 8,
      }),
    ).toBe(3);

    expect(() =>
      resolveStockAdjustmentQuantityDelta({
        adjustmentType: "manual",
        systemQuantity: 8,
      }),
    ).toThrow(
      "Manual stock adjustments require a whole-unit delta for every selected SKU.",
    );

    expect(() =>
      resolveStockAdjustmentQuantityDelta({
        adjustmentType: "cycle_count",
        systemQuantity: 8,
      }),
    ).toThrow(
      "Cycle counts require an integer counted quantity for every selected SKU.",
    );
  });

  it("tracks the net delta and largest absolute variance for a batch", () => {
    expect(
      summarizeStockAdjustmentLineItems([
        { quantityDelta: -3 },
        { quantityDelta: 5 },
        { quantityDelta: -1 },
      ]),
    ).toEqual({
      largestAbsoluteDelta: 5,
      lineItemCount: 3,
      netQuantityDelta: 1,
    });
  });

  it("short-circuits duplicate submissions and wires approvals plus inventory movements", () => {
    const source = getSource("./adjustments.ts");

    expect(source).toContain(
      'withIndex("by_storeId_adjustmentType_submissionKey"',
    );
    expect(source).toContain("buildApprovalRequest");
    expect(source).toContain("recordInventoryMovementWithCtx");
  });

  it("keeps the temporary stock-scope SKU deletion guarded", () => {
    const source = getSource("./adjustments.ts");

    expect(source).toContain("temporaryDeleteStockAdjustmentScopeSkus");
    expect(source).toContain('"delete-stock-adjustment-scope-skus"');
    expect(source).toContain('allowedRoles: ["full_admin"]');
    expect(source).toContain("args.dryRun !== false");
    expect(source).toContain('ctx.db.delete("productSku"');
  });

  it("rejects unauthenticated stock-adjustment submissions", async () => {
    const { ctx } = createSubmissionMutationCtx({
      authUserId: null,
      membershipRole: "pos_only",
    });

    await expect(
      submitStockAdjustmentBatchWithCtx(ctx, {
        adjustmentType: "manual",
        lineItems: [
          {
            productSkuId: "sku-1" as Id<"productSku">,
            quantityDelta: -2,
          },
        ],
        reasonCode: "damage",
        storeId: "store-1" as Id<"store">,
        submissionKey: "submission-1",
      }),
    ).rejects.toThrow("Sign in again to continue.");
  });

  it("returns a validation user error when stock-adjustment submissions are empty", async () => {
    const { ctx } = createSubmissionMutationCtx({
      authUserId: "auth-user-1",
      membershipRole: "pos_only",
    });

    await expect(
      submitStockAdjustmentBatchCommandWithCtx(ctx, {
        adjustmentType: "manual",
        lineItems: [],
        reasonCode: "damage",
        storeId: "store-1" as Id<"store">,
        submissionKey: "submission-empty",
      }),
    ).resolves.toMatchObject({
      kind: "user_error",
      error: {
        code: "validation_failed",
        message: "Stock adjustment batches require at least one line item.",
      },
    });
  });

  it("returns an authentication user error for unauthenticated stock-adjustment submissions", async () => {
    const { ctx } = createSubmissionMutationCtx({
      authUserId: null,
      membershipRole: "pos_only",
    });

    await expect(
      submitStockAdjustmentBatchCommandWithCtx(ctx, {
        adjustmentType: "manual",
        lineItems: [
          {
            productSkuId: "sku-1" as Id<"productSku">,
            quantityDelta: -2,
          },
        ],
        reasonCode: "damage",
        storeId: "store-1" as Id<"store">,
        submissionKey: "submission-auth",
      }),
    ).resolves.toMatchObject({
      kind: "user_error",
      error: {
        code: "authentication_failed",
        message: "Sign in again to continue.",
      },
    });
  });

  it("rejects authenticated users without store membership", async () => {
    const { ctx } = createSubmissionMutationCtx({
      authUserId: "auth-user-1",
      membershipRole: null,
    });

    await expect(
      submitStockAdjustmentBatchWithCtx(ctx, {
        adjustmentType: "manual",
        lineItems: [
          {
            productSkuId: "sku-1" as Id<"productSku">,
            quantityDelta: -2,
          },
        ],
        reasonCode: "damage",
        storeId: "store-1" as Id<"store">,
        submissionKey: "submission-2",
      }),
    ).rejects.toThrow(
      "You do not have permission to adjust stock for this store.",
    );
  });

  it("rejects stock adjustments for active provisional legacy import SKUs", async () => {
    const { ctx, tables } = createSubmissionMutationCtx({
      authUserId: "auth-user-1",
      membershipRole: "full_admin",
    });

    tables.inventoryImportProvisionalSku.set("provisional-1", {
      _id: "provisional-1",
      productSkuId: "sku-1",
      status: "active",
      storeId: "store-1",
    });

    await expect(
      submitStockAdjustmentBatchWithCtx(ctx, {
        adjustmentType: "manual",
        lineItems: [
          {
            productSkuId: "sku-1" as Id<"productSku">,
            quantityDelta: 1,
          },
        ],
        reasonCode: "correction",
        storeId: "store-1" as Id<"store">,
        submissionKey: "legacy-import-block",
      }),
    ).rejects.toThrow(
      "Legacy import SKUs must be finalized before stock adjustments can update them.",
    );

    expect(tables.productSku.get("sku-1")).toMatchObject({
      inventoryCount: 8,
      quantityAvailable: 6,
    });
    expect(tables.inventoryMovement.size).toBe(0);
    expect(tables.stockAdjustmentBatch.size).toBe(0);
  });

  it("rejects stock adjustments for unresolved POS pending checkout SKUs", async () => {
    const { ctx, tables } = createSubmissionMutationCtx({
      authUserId: "auth-user-1",
      membershipRole: "full_admin",
    });

    tables.posPendingCheckoutItem.set("pending-checkout-1", {
      _id: "pending-checkout-1",
      provisionalProductSkuId: "sku-1",
      status: "flagged",
      storeId: "store-1",
    });

    await expect(
      submitStockAdjustmentBatchWithCtx(ctx, {
        adjustmentType: "manual",
        lineItems: [
          {
            productSkuId: "sku-1" as Id<"productSku">,
            quantityDelta: 1,
          },
        ],
        reasonCode: "correction",
        storeId: "store-1" as Id<"store">,
        submissionKey: "pos-pending-checkout-block",
      }),
    ).rejects.toThrow(
      "POS pending checkout SKUs must be finalized before stock adjustments can update them.",
    );

    expect(tables.productSku.get("sku-1")).toMatchObject({
      inventoryCount: 8,
      quantityAvailable: 6,
    });
    expect(tables.inventoryMovement.size).toBe(0);
    expect(tables.stockAdjustmentBatch.size).toBe(0);
  });

  it("returns an authorization user error when the operator lacks store membership", async () => {
    const { ctx } = createSubmissionMutationCtx({
      authUserId: "auth-user-1",
      membershipRole: null,
    });

    await expect(
      submitStockAdjustmentBatchCommandWithCtx(ctx, {
        adjustmentType: "manual",
        lineItems: [
          {
            productSkuId: "sku-1" as Id<"productSku">,
            quantityDelta: -2,
          },
        ],
        reasonCode: "damage",
        storeId: "store-1" as Id<"store">,
        submissionKey: "submission-authz",
      }),
    ).resolves.toMatchObject({
      kind: "user_error",
      error: {
        code: "authorization_failed",
        message: "You do not have permission to adjust stock for this store.",
      },
    });
  });

  it("derives the submitting operator from the authenticated session", async () => {
    const { ctx, tables } = createSubmissionMutationCtx({
      authUserId: "auth-user-1",
      membershipRole: "pos_only",
    });

    await submitStockAdjustmentBatchWithCtx(ctx, {
      adjustmentType: "manual",
      lineItems: [
        {
          productSkuId: "sku-1" as Id<"productSku">,
          quantityDelta: -2,
        },
      ],
      reasonCode: "damage",
      storeId: "store-1" as Id<"store">,
      submissionKey: "submission-3",
    });

    expect(Array.from(tables.stockAdjustmentBatch.values())).toEqual([
      expect.objectContaining({
        createdByUserId: "operator-1",
      }),
    ]);
    expect(Array.from(tables.inventoryMovement.values())).toEqual([
      expect.objectContaining({
        actorUserId: "operator-1",
        quantityDelta: -2,
      }),
    ]);
  });

  it("applies high-variance cycle counts immediately and flags the batch", async () => {
    const { ctx, tables } = createSubmissionMutationCtx({
      authUserId: "auth-user-1",
      membershipRole: "pos_only",
    });

    await submitStockAdjustmentBatchWithCtx(ctx, {
      adjustmentType: "cycle_count",
      lineItems: [
        {
          countedQuantity: 14,
          productSkuId: "sku-1" as Id<"productSku">,
        },
      ],
      reasonCode: "cycle_count_reconciliation",
      storeId: "store-1" as Id<"store">,
      submissionKey: "submission-cycle-count-high-variance",
    });

    expect(Array.from(tables.stockAdjustmentBatch.values())).toEqual([
      expect.objectContaining({
        adjustmentType: "cycle_count",
        approvalRequired: false,
        highVarianceFlag: true,
        largestAbsoluteDelta: 6,
        status: "applied",
        varianceThreshold: STOCK_ADJUSTMENT_APPROVAL_THRESHOLD,
      }),
    ]);
    expect(tables.approvalRequest.size).toBe(0);
    expect(tables.operationalWorkItem.size).toBe(0);
    expect(Array.from(tables.inventoryMovement.values())).toEqual([
      expect.objectContaining({
        quantityDelta: 6,
        reasonCode: "cycle_count_reconciliation",
      }),
    ]);
    expect(Array.from(tables.operationalEvent.values())).toEqual([
      expect.objectContaining({
        eventType: "stock_adjustment_applied",
        message:
          "operator@example.com applied a cycle count for 1 SKU. Net inventory change +6 units.",
        metadata: expect.objectContaining({
          actorLabel: "operator@example.com",
          highVarianceFlag: true,
          largestAbsoluteDelta: 6,
        }),
      }),
    ]);
  });

  it("applies approved stock adjustments and closes the review work item", async () => {
    const { ctx, tables } = createApprovalDecisionMutationCtx();

    await resolveStockAdjustmentApprovalDecisionWithCtx(ctx, {
      approvalRequestId: "approval-1" as Id<"approvalRequest">,
      decision: "approved",
      reviewedByUserId: "manager-1" as Id<"athenaUser">,
    });

    expect(tables.stockAdjustmentBatch.get("batch-1")).toMatchObject({
      appliedAt: expect.any(Number),
      decidedAt: expect.any(Number),
      status: "applied",
    });
    expect(tables.productSku.get("sku-1")).toMatchObject({
      inventoryCount: 2,
      quantityAvailable: 0,
    });
    expect(tables.operationalWorkItem.get("work-item-1")).toMatchObject({
      approvalState: "approved",
      completedAt: expect.any(Number),
      status: "completed",
    });
    expect(Array.from(tables.inventoryMovement.values())).toEqual([
      expect.objectContaining({
        actorUserId: "manager-1",
        movementType: "adjustment",
        quantityDelta: -6,
        reasonCode: "damage",
        sourceType: "stock_adjustment_batch",
        workItemId: "work-item-1",
      }),
    ]);
  });

  it("rejects approval-gated stock adjustments without mutating inventory", async () => {
    const { ctx, tables } = createApprovalDecisionMutationCtx();

    await resolveStockAdjustmentApprovalDecisionWithCtx(ctx, {
      approvalRequestId: "approval-1" as Id<"approvalRequest">,
      decision: "rejected",
      reviewedByUserId: "manager-1" as Id<"athenaUser">,
    });

    expect(tables.stockAdjustmentBatch.get("batch-1")).toMatchObject({
      decidedAt: expect.any(Number),
      status: "rejected",
    });
    expect(tables.productSku.get("sku-1")).toMatchObject({
      inventoryCount: 8,
      quantityAvailable: 6,
    });
    expect(tables.operationalWorkItem.get("work-item-1")).toMatchObject({
      approvalState: "rejected",
      status: "cancelled",
    });
    expect(Array.from(tables.inventoryMovement.values())).toHaveLength(0);
  });
});
