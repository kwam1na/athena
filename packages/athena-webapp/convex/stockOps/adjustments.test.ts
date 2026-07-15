import { readFileSync } from "node:fs";

// Shared-demo adjustments retain the established batch result envelope.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import { ok } from "../../shared/commandResult";
import { assertConformsToExportedReturns } from "../lib/returnValidatorContract";

const mockedAuthServer = vi.hoisted(() => ({
  getAuthUserId: vi.fn(),
}));
const reportingMocks = vi.hoisted(() => ({
  applyInventoryEffectWithCtx: vi.fn(),
  resolveReportingOperatingPeriodWithCtx: vi.fn(),
}));

vi.mock("@convex-dev/auth/server", () => ({
  getAuthUserId: mockedAuthServer.getAuthUserId,
}));
vi.mock("../reporting/inventory/effects", () => ({
  applyInventoryEffectWithCtx: reportingMocks.applyInventoryEffectWithCtx,
}));
vi.mock("../reporting/operatingPeriods", () => ({
  resolveReportingOperatingPeriodWithCtx:
    reportingMocks.resolveReportingOperatingPeriodWithCtx,
}));

import {
  STOCK_ADJUSTMENT_APPROVAL_THRESHOLD,
  assertDistinctStockAdjustmentLineItems,
  assertStockAdjustmentReasonCode,
  calculateCycleCountQuantityDelta,
  getInventoryUnitSummaryWithCtx,
  listInventorySnapshotForProductSkus,
  listInventorySnapshotForProductSkusWithCtx,
  hasHighStockAdjustmentVariance,
  listInventorySnapshotWithCtx,
  requiresStockAdjustmentApproval,
  resolveStockAdjustmentApprovalDecisionWithCtx,
  resolveStockAdjustmentQuantityDelta,
  submitStockAdjustmentBatch,
  submitStockAdjustmentBatchCommandWithCtx,
  submitStockAdjustmentBatchWithCtx,
  summarizeStockAdjustmentLineItems,
} from "./adjustments";

function getSource(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

function getHandler(definition: unknown) {
  return (definition as { _handler: Function })._handler;
}

function createInventorySnapshotQueryCtx() {
  const tables = {
    athenaUser: new Map<string, Record<string, unknown>>([
      [
        "athena-user-1",
        { _id: "athena-user-1", email: "operator@example.com" },
      ],
    ]),
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
    organizationMember: new Map<string, Record<string, unknown>>([
      [
        "organization-member-1",
        {
          _id: "organization-member-1",
          organizationId: "org-1",
          role: "pos_only",
          userId: "athena-user-1",
        },
      ],
    ]),
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
    store: new Map<string, Record<string, unknown>>([
      ["store-1", { _id: "store-1", organizationId: "org-1" }],
      ["store-2", { _id: "store-2", organizationId: "org-2" }],
    ]),
    subcategory: new Map<string, Record<string, unknown>>([
      [
        "subcategory-1",
        {
          _id: "subcategory-1",
          categoryId: "category-1",
          name: "Hair Pins",
          slug: "hair-pins",
          storeId: "store-1",
        },
      ],
    ]),
    users: new Map<string, Record<string, unknown>>([
      ["auth-user-1", { _id: "auth-user-1", email: "operator@example.com" }],
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
      first: async () => filteredRecords()[0] ?? null,
      take: async (limit: number) => filteredRecords().slice(0, limit),
      filter(
        applyFilter?: (queryBuilder: {
          and: (
            ...predicates: Array<(row: Record<string, unknown>) => boolean>
          ) => (row: Record<string, unknown>) => boolean;
          eq: (
            field: string,
            value: unknown,
          ) => (row: Record<string, unknown>) => boolean;
          field: (field: string) => string;
        }) => (row: Record<string, unknown>) => boolean,
      ) {
        if (!applyFilter) return query;
        const predicate = applyFilter({
          and:
            (...predicates) =>
            (row) =>
              predicates.every((predicate) => predicate(row)),
          eq: (field, value) => (row) => row[field] === value,
          field: (field) => field,
        });
        const baseFilteredRecords = filteredRecords;
        const scopedRecords = () => baseFilteredRecords().filter(predicate);

        return {
          collect: async () => scopedRecords(),
          first: async () => scopedRecords()[0] ?? null,
          take: async (limit: number) => scopedRecords().slice(0, limit),
        };
      },
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
    auth: {},
  } as unknown as QueryCtx;

  return { ctx, tables };
}

beforeEach(() => {
  mockedAuthServer.getAuthUserId.mockResolvedValue("auth-user-1");
  reportingMocks.resolveReportingOperatingPeriodWithCtx.mockResolvedValue({
    kind: "missing_schedule",
  });
  reportingMocks.applyInventoryEffectWithCtx.mockImplementation(
    async (ctx: MutationCtx, args: Record<string, any>) => {
      await ctx.db.patch("productSku", args.productSkuId, {
        inventoryCount: args.compatibilityBalance.onHandQuantity,
        quantityAvailable: args.compatibilityBalance.sellableQuantity,
      });
      const movementId = await ctx.db.insert("inventoryMovement", {
        actorUserId: args.actorUserId,
        createdAt: args.recordedAt,
        movementType: args.movementType,
        organizationId: args.organizationId,
        productId: args.productId,
        productSkuId: args.productSkuId,
        quantityDelta: args.physicalQuantityDelta,
        reasonCode: args.reasonCode,
        sourceId: args.sourceId,
        sourceType: args.sourceType,
        storeId: args.storeId,
        workItemId: args.workItemId,
      });
      return {
        movement: await ctx.db.get("inventoryMovement", movementId),
      };
    },
  );
});

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
    catalogSummary: new Map<string, Record<string, unknown>>(),
    category: new Map<string, Record<string, unknown>>([
      [
        "category-1",
        {
          _id: "category-1",
          name: "Hair",
          slug: "hair",
          storeId: "store-1",
        },
      ],
    ]),
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
    product: new Map<string, Record<string, unknown>>([
      [
        "product-1",
        {
          _id: "product-1",
          availability: "live",
          categoryId: "category-1",
          name: "Closure wig",
          storeId: "store-1",
          subcategoryId: "subcategory-1",
        },
      ],
    ]),
    skuActivityEvent: new Map<string, Record<string, unknown>>(),
    store: new Map<string, Record<string, unknown>>([
      ["store-1", { _id: "store-1", organizationId: "org-1" }],
    ]),
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
    | "catalogSummary"
    | "inventoryMovement"
    | "operationalEvent"
    | "skuActivityEvent",
    number
  > = {
    catalogSummary: 0,
    inventoryMovement: 0,
    operationalEvent: 0,
    skuActivityEvent: 0,
  };

  const queryTable = (table: keyof typeof tables) => ({
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
        table:
          | "catalogSummary"
          | "inventoryMovement"
          | "operationalEvent"
          | "skuActivityEvent",
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
        return queryTable(table);
      },
    },
    scheduler: {
      runAfter: vi.fn().mockResolvedValue(undefined),
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
      ).map((athenaUser) => [
        athenaUser._id,
        {
          ...athenaUser,
          normalizedEmail: athenaUser.email.trim().toLowerCase(),
        },
      ]),
    ),
    catalogSummary: new Map<string, Record<string, unknown>>(),
    category: new Map<string, Record<string, unknown>>([
      [
        "category-1",
        {
          _id: "category-1",
          name: "Hair",
          slug: "hair",
          storeId: "store-1",
        },
      ],
    ]),
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
    product: new Map<string, Record<string, unknown>>([
      [
        "product-1",
        {
          _id: "product-1",
          availability: "live",
          categoryId: "category-1",
          name: "Closure wig",
          storeId: "store-1",
          subcategoryId: "subcategory-1",
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
    subcategory: new Map<string, Record<string, unknown>>([
      [
        "subcategory-1",
        {
          _id: "subcategory-1",
          categoryId: "category-1",
          name: "Closures",
          slug: "closures",
          storeId: "store-1",
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
    | "catalogSummary"
    | "inventoryMovement"
    | "operationalEvent"
    | "operationalWorkItem"
    | "skuActivityEvent"
    | "stockAdjustmentBatch",
    number
  > = {
    approvalRequest: 0,
    catalogSummary: 0,
    inventoryMovement: 0,
    operationalEvent: 0,
    operationalWorkItem: 0,
    skuActivityEvent: 0,
    stockAdjustmentBatch: 0,
  };

  mockedAuthServer.getAuthUserId.mockResolvedValue(args.authUserId ?? null);

  const indexedQuery = (
    table:
      | "catalogSummary"
      | "category"
      | "inventoryMovement"
      | "inventoryImportProvisionalSku"
      | "operationalEvent"
      | "operationalWorkItem"
      | "posPendingCheckoutItem"
      | "product"
      | "productSku"
      | "skuActivityEvent"
      | "stockAdjustmentBatch"
      | "subcategory",
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
          | "catalogSummary"
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
            withIndex(
              _index: string,
              applyIndex: (queryBuilder: {
                eq: (field: string, value: unknown) => unknown;
              }) => unknown,
            ) {
              const filters: Array<[string, unknown]> = [];
              const queryBuilder = {
                eq(field: string, value: unknown) {
                  filters.push([field, value]);
                  return queryBuilder;
                },
              };
              applyIndex(queryBuilder);
              return {
                first: async () =>
                  Array.from(tables.athenaUser.values()).find((record) =>
                    filters.every(([field, value]) => record[field] === value),
                  ) ?? null,
                take: async (limit: number) =>
                  Array.from(tables.athenaUser.values())
                    .filter((record) =>
                      filters.every(
                        ([field, value]) => record[field] === value,
                      ),
                    )
                    .slice(0, limit),
              };
            },
          };
        }

        if (table === "organizationMember") {
          const findMember = (filters: Array<[string, unknown]>) =>
            Array.from(tables.organizationMember.values()).find((record) =>
              filters.every(([field, value]) => record[field] === value),
            ) ?? null;

          return {
            withIndex(
              _index: string,
              applyIndex: (queryBuilder: {
                eq: (field: string, value: unknown) => unknown;
              }) => unknown,
            ) {
              const filters: Array<[string, unknown]> = [];
              const queryBuilder = {
                eq(field: string, value: unknown) {
                  filters.push([field, value]);
                  return queryBuilder;
                },
              };

              applyIndex(queryBuilder);

              return {
                first: async () => findMember(filters),
              };
            },
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
                first: async () => findMember(filters),
              };
            },
          };
        }

        if (
          table === "inventoryMovement" ||
          table === "inventoryImportProvisionalSku" ||
          table === "operationalEvent" ||
          table === "operationalWorkItem" ||
          table === "posPendingCheckoutItem" ||
          table === "catalogSummary" ||
          table === "category" ||
          table === "product" ||
          table === "productSku" ||
          table === "skuActivityEvent" ||
          table === "stockAdjustmentBatch" ||
          table === "subcategory"
        ) {
          return indexedQuery(table);
        }

        throw new Error(`Unexpected query table: ${table}`);
      },
    },
    scheduler: {
      runAfter: vi.fn().mockResolvedValue(undefined),
    },
  } as unknown as MutationCtx;

  return { ctx, tables };
}

describe("stock ops adjustments", () => {
  it("accepts representative stock adjustment command return contracts", () => {
    assertConformsToExportedReturns(
      submitStockAdjustmentBatch,
      ok({
        _id: "stock-adjustment-batch-1",
        adjustmentType: "manual",
        approvalRequired: false,
        createdAt: 1_700_000_000_000,
        createdByUserId: "user-1",
        lineItemCount: 1,
        lineItems: [
          {
            inventoryAfter: 11,
            inventoryBefore: 10,
            productSkuId: "sku-1",
            quantityDelta: 1,
          },
        ],
        largestAbsoluteDelta: 1,
        netQuantityDelta: 1,
        organizationId: "org-1",
        reasonCode: "manual_correction",
        status: "applied",
        storeId: "store-1",
        submissionKey: "submission-1",
        varianceThreshold: STOCK_ADJUSTMENT_APPROVAL_THRESHOLD,
      }),
    );
  });

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

  it("summarizes store-level inventory units without hydrating snapshot rows", async () => {
    const { ctx, tables } = createInventorySnapshotQueryCtx();

    tables.productSku.set("sku-2", {
      _id: "sku-2",
      images: [],
      inventoryCount: 4,
      productId: "product-1",
      quantityAvailable: 1,
      sku: "CW-20",
      storeId: "store-1",
    });
    tables.productSku.set("other-store-sku", {
      _id: "other-store-sku",
      images: [],
      inventoryCount: 100,
      productId: "product-1",
      quantityAvailable: 100,
      sku: "OTHER",
      storeId: "store-2",
    });

    const summary = await getInventoryUnitSummaryWithCtx(ctx, {
      storeId: "store-1" as Id<"store">,
    });

    expect(summary).toEqual({
      availableUnits: 9,
      hasMoreSkus: false,
      onHandUnits: 14,
      reservedUnits: 5,
      skuCount: 2,
      unavailableSkuCount: 2,
      unavailableUnits: 5,
    });
  });

  it("excludes archived products from store-level inventory unit summaries", async () => {
    const { ctx, tables } = createInventorySnapshotQueryCtx();

    tables.product.set("archived-product", {
      _id: "archived-product",
      availability: "archived",
      categoryId: "category-1",
      name: "Archived Wig",
    });
    tables.productSku.set("archived-sku", {
      _id: "archived-sku",
      images: [],
      inventoryCount: 12,
      productId: "archived-product",
      quantityAvailable: 2,
      sku: "ARCHIVED-22",
      storeId: "store-1",
    });

    const summary = await getInventoryUnitSummaryWithCtx(ctx, {
      storeId: "store-1" as Id<"store">,
    });

    expect(summary).toEqual({
      availableUnits: 8,
      hasMoreSkus: false,
      onHandUnits: 10,
      reservedUnits: 2,
      skuCount: 1,
      unavailableSkuCount: 1,
      unavailableUnits: 2,
    });
  });

  it("hydrates generic SKU search candidates through stock-owned snapshot rows", async () => {
    const { ctx, tables } = createInventorySnapshotQueryCtx();

    tables.productSku.set("sku-2", {
      _id: "sku-2",
      images: [],
      inventoryCount: 5,
      productId: "product-1",
      quantityAvailable: 5,
      sku: "CW-20",
      storeId: "store-1",
    });
    tables.productSku.set("other-store-sku", {
      _id: "other-store-sku",
      images: [],
      inventoryCount: 100,
      productId: "product-1",
      quantityAvailable: 100,
      sku: "OTHER",
      storeId: "store-2",
    });

    const rows = await listInventorySnapshotForProductSkusWithCtx(ctx, {
      now: 1_000,
      productSkuIds: [
        "other-store-sku",
        "sku-2",
        "sku-1",
      ] as Id<"productSku">[],
      storeId: "store-1" as Id<"store">,
    });

    expect(rows.map((row) => row._id)).toEqual(["sku-1", "sku-2"]);
    expect(rows.find((row) => row._id === "sku-1")).toMatchObject({
      durableQuantityAvailable: 8,
      posReservedQuantity: 2,
      quantityAvailable: 6,
    });
  });

  it("keeps the SKU-level product name as a search alias when the canonical product name differs", async () => {
    const { ctx, tables } = createInventorySnapshotQueryCtx();

    tables.productSku.set("sku-1", {
      ...(tables.productSku.get("sku-1") ?? {}),
      productName: "agya",
    });

    const rows = await listInventorySnapshotForProductSkusWithCtx(ctx, {
      now: 1_000,
      productSkuIds: ["sku-1"] as Id<"productSku">[],
      storeId: "store-1" as Id<"store">,
    });

    expect(rows[0]).toMatchObject({
      _id: "sku-1",
      productName: "Closure Wig",
      productSkuProductName: "agya",
    });
  });

  it("requires authenticated store access before hydrating generic SKU search candidates", async () => {
    const { ctx } = createInventorySnapshotQueryCtx();

    mockedAuthServer.getAuthUserId.mockResolvedValue(null);

    await expect(
      getHandler(listInventorySnapshotForProductSkus)(ctx, {
        productSkuIds: ["sku-1"] as Id<"productSku">[],
        storeId: "store-1" as Id<"store">,
      }),
    ).rejects.toThrow("Sign in again to continue.");
  });

  it("allows POS-only store operators to hydrate generic SKU search candidates", async () => {
    const { ctx } = createInventorySnapshotQueryCtx();

    const rows = await getHandler(listInventorySnapshotForProductSkus)(ctx, {
      productSkuIds: ["sku-1"] as Id<"productSku">[],
      storeId: "store-1" as Id<"store">,
    });

    expect(rows.map((row: { _id: string }) => row._id)).toEqual(["sku-1"]);
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

  it("does not block zero-sale provisional rows linked to onboarded trusted SKUs", async () => {
    const { ctx, tables } = createInventorySnapshotQueryCtx();

    tables.category.set("category-1", {
      _id: "category-1",
      name: "Hair Accessories",
      slug: "hair-accessories",
      storeId: "store-1",
    });
    tables.product.set("product-1", {
      _id: "product-1",
      availability: "live",
      categoryId: "category-1",
      name: "Tweezers",
      storeId: "store-1",
      subcategoryId: "subcategory-1",
    });
    tables.inventoryImportProvisionalSku.set("provisional-1", {
      _id: "provisional-1",
      productId: "product-1",
      productSkuId: "sku-1",
      saleEvidence: {
        saleCount: 0,
        totalQuantitySold: 0,
      },
      status: "active",
      storeId: "store-1",
    });

    const rows = await listInventorySnapshotWithCtx(ctx, {
      now: 1_000,
      storeId: "store-1" as Id<"store">,
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).not.toHaveProperty("stockAdjustmentBlockedMessage");
    expect(rows[0]).not.toHaveProperty("stockAdjustmentBlockedReason");
  });

  it("does not block sold provisional rows linked to onboarded trusted SKUs", async () => {
    const { ctx, tables } = createInventorySnapshotQueryCtx();

    tables.category.set("category-1", {
      _id: "category-1",
      name: "Hair Accessories",
      slug: "hair-accessories",
      storeId: "store-1",
    });
    tables.product.set("product-1", {
      _id: "product-1",
      availability: "live",
      categoryId: "category-1",
      name: "Tweezers",
      storeId: "store-1",
      subcategoryId: "subcategory-1",
    });
    tables.inventoryImportProvisionalSku.set("provisional-1", {
      _id: "provisional-1",
      productId: "product-1",
      productSkuId: "sku-1",
      saleEvidence: {
        saleCount: 1,
        totalQuantitySold: 1,
      },
      status: "active",
      storeId: "store-1",
    });

    const rows = await listInventorySnapshotWithCtx(ctx, {
      now: 1_000,
      storeId: "store-1" as Id<"store">,
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).not.toHaveProperty("stockAdjustmentBlockedMessage");
    expect(rows[0]).not.toHaveProperty("stockAdjustmentBlockedReason");
  });

  it("does not block stock adjustments after a legacy import SKU is finalized", async () => {
    const { ctx, tables } = createInventorySnapshotQueryCtx();

    tables.inventoryImportProvisionalSku.set("provisional-1", {
      _id: "provisional-1",
      finalTrustedQuantity: 10,
      finalizedAt: 1_000,
      posExposureStatus: "hidden",
      productSkuId: "sku-1",
      provisionalSoldQuantityAtFinalization: 2,
      status: "finalized",
      storeId: "store-1",
    });

    const rows = await listInventorySnapshotWithCtx(ctx, {
      now: 1_000,
      storeId: "store-1" as Id<"store">,
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).not.toHaveProperty("stockAdjustmentBlockedMessage");
    expect(rows[0]).not.toHaveProperty("stockAdjustmentBlockedReason");
  });

  it("does not block trusted legacy import SKUs that remain active for catalog setup", async () => {
    const { ctx, tables } = createInventorySnapshotQueryCtx();

    tables.inventoryImportProvisionalSku.set("provisional-1", {
      _id: "provisional-1",
      finalTrustedQuantity: 10,
      finalizedAt: 1_000,
      posExposureStatus: "hidden",
      productSkuId: "sku-1",
      provisionalSoldQuantityAtFinalization: 2,
      status: "active",
      storeId: "store-1",
    });

    const rows = await listInventorySnapshotWithCtx(ctx, {
      now: 1_000,
      storeId: "store-1" as Id<"store">,
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).not.toHaveProperty("stockAdjustmentBlockedMessage");
    expect(rows[0]).not.toHaveProperty("stockAdjustmentBlockedReason");
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

  it("keeps inventory snapshot rows bounded and sparse to stay below Convex response limits", async () => {
    const { ctx, tables } = createInventorySnapshotQueryCtx();

    tables.inventoryHold.clear();
    tables.productSku.set("sku-1", {
      ...(tables.productSku.get("sku-1") ?? {}),
      images: [],
      quantityAvailable: 10,
      inventoryCount: 10,
      netPrice: null,
      barcode: null,
      color: null,
      length: null,
      size: null,
      sku: null,
    });

    for (let index = 2; index <= 1_000; index += 1) {
      tables.productSku.set(`sku-${index}`, {
        _id: `sku-${index}`,
        barcode: null,
        color: null,
        images: [],
        inventoryCount: 10,
        length: null,
        netPrice: null,
        price: 1000,
        productId: "product-1",
        quantityAvailable: 10,
        size: null,
        sku: null,
        storeId: "store-1",
      });
    }

    const rows = await listInventorySnapshotWithCtx(ctx, {
      limit: 1_000,
      now: 1_000,
      storeId: "store-1" as Id<"store">,
    });
    const firstRow = rows[0] as Record<string, unknown>;

    expect(rows).toHaveLength(750);
    expect(firstRow).not.toHaveProperty("barcode");
    expect(firstRow).not.toHaveProperty("checkoutReservedQuantity");
    expect(firstRow).not.toHaveProperty("durableQuantityAvailable");
    expect(firstRow).not.toHaveProperty("imageUrl");
    expect(firstRow).not.toHaveProperty("posReservedQuantity");
    expect(firstRow).not.toHaveProperty("reservedQuantity");
    expect(firstRow).not.toHaveProperty("stockAdjustmentBlockedMessage");
    expect(JSON.stringify(rows).length).toBeLessThan(130_000);
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
    expect(source).toContain("applyInventoryEffectWithCtx");
    expect(source).not.toContain('ctx.db.patch("productSku"');
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

  it("allows normal stock adjustments once a legacy import SKU has been finalized", async () => {
    const { ctx, tables } = createSubmissionMutationCtx({
      authUserId: "auth-user-1",
      membershipRole: "full_admin",
    });

    tables.inventoryImportProvisionalSku.set("provisional-1", {
      _id: "provisional-1",
      finalTrustedQuantity: 8,
      finalizedAt: 1_000,
      posExposureStatus: "hidden",
      productSkuId: "sku-1",
      provisionalSoldQuantityAtFinalization: 2,
      status: "finalized",
      storeId: "store-1",
    });

    await submitStockAdjustmentBatchWithCtx(ctx, {
      adjustmentType: "manual",
      lineItems: [
        {
          productSkuId: "sku-1" as Id<"productSku">,
          quantityDelta: 1,
        },
      ],
      reasonCode: "correction",
      storeId: "store-1" as Id<"store">,
      submissionKey: "legacy-import-finalized-adjustment",
    });

    expect(tables.productSku.get("sku-1")).toMatchObject({
      inventoryCount: 9,
      quantityAvailable: 7,
    });
    expect(Array.from(tables.stockAdjustmentBatch.values())).toEqual([
      expect.objectContaining({
        status: "applied",
        submissionKey: "legacy-import-finalized-adjustment",
      }),
    ]);
    expect(Array.from(tables.inventoryMovement.values())).toEqual([
      expect.objectContaining({
        movementType: "adjustment",
        productSkuId: "sku-1",
        quantityDelta: 1,
      }),
    ]);
    expect(reportingMocks.applyInventoryEffectWithCtx).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        businessEventKey:
          "stock_adjustment_batch:stockAdjustmentBatch-1:sku:sku-1",
        compatibilityBalance: {
          onHandQuantity: 9,
          sellableQuantity: 7,
        },
        reasonCode: "correction",
        valuation: {
          costBasis: { kind: "uncosted" },
          kind: "inbound",
          quantity: 1,
        },
      }),
    );
    expect(ctx.scheduler.runAfter).toHaveBeenCalledWith(
      0,
      internal.inventory.catalogSummary.markCatalogSummaryNeedsRefreshInternal,
      { storeId: "store-1" },
    );
  });

  it("completes synced sale inventory review work when the affected SKU is adjusted", async () => {
    const { ctx, tables } = createSubmissionMutationCtx({
      authUserId: "auth-user-1",
      membershipRole: "pos_only",
    });

    tables.operationalWorkItem.set("inventory-review-1", {
      _id: "inventory-review-1",
      createdAt: 1,
      metadata: {
        localTransactionId: "local-sale-1",
        primaryProductSkuId: "sku-1",
        receiptNumber: "#001",
      },
      organizationId: "org-1",
      productSkuId: "sku-1",
      status: "open",
      storeId: "store-1",
      title: "Review inventory for Closure wig",
      type: "synced_sale_inventory_review",
    });

    await submitStockAdjustmentBatchWithCtx(ctx, {
      adjustmentType: "manual",
      lineItems: [
        {
          productSkuId: "sku-1" as Id<"productSku">,
          quantityDelta: 1,
        },
      ],
      reasonCode: "correction",
      storeId: "store-1" as Id<"store">,
      submissionKey: "auto-resolve-inventory-review",
    });

    const stockMovement = Array.from(tables.inventoryMovement.values())[0];

    expect(tables.operationalWorkItem.get("inventory-review-1")).toMatchObject({
      completedAt: expect.any(Number),
      metadata: {
        resolution: {
          actorUserId: "operator-1",
          authority: {
            kind: "system",
            reason: "stock_adjustment_applied",
          },
          domainTrace: {
            inventoryMovementId: stockMovement._id,
            proofKind: "stock_update_movement",
            stockAdjustmentBatchId: "stockAdjustmentBatch-1",
          },
          outcome: "completed",
          reason: "Resolved by applied stock adjustment.",
          stockUpdate: {
            inventoryMovementId: stockMovement._id,
            productSkuId: "sku-1",
            quantityDelta: 1,
          },
        },
      },
      status: "completed",
    });
    expect(Array.from(tables.operationalEvent.values())).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: "synced_sale_inventory_review_completed",
          message:
            "Synced sale inventory review completed by stock adjustment.",
          subjectId: "inventory-review-1",
        }),
      ]),
    );
  });

  it("keeps unrelated synced sale inventory review work open", async () => {
    const { ctx, tables } = createSubmissionMutationCtx({
      authUserId: "auth-user-1",
      membershipRole: "pos_only",
    });

    tables.operationalWorkItem.set("inventory-review-1", {
      _id: "inventory-review-1",
      createdAt: 1,
      metadata: {
        primaryProductSkuId: "other-sku",
      },
      organizationId: "org-1",
      productSkuId: "other-sku",
      status: "open",
      storeId: "store-1",
      title: "Review inventory for another SKU",
      type: "synced_sale_inventory_review",
    });

    await submitStockAdjustmentBatchWithCtx(ctx, {
      adjustmentType: "manual",
      lineItems: [
        {
          productSkuId: "sku-1" as Id<"productSku">,
          quantityDelta: 1,
        },
      ],
      reasonCode: "correction",
      storeId: "store-1" as Id<"store">,
      submissionKey: "unrelated-inventory-review",
    });

    expect(tables.operationalWorkItem.get("inventory-review-1")).toMatchObject({
      status: "open",
    });
    expect(
      tables.operationalWorkItem.get("inventory-review-1"),
    ).not.toHaveProperty("completedAt");
  });

  it("allows stock adjustments for trusted legacy import SKUs that still need catalog setup", async () => {
    const { ctx, tables } = createSubmissionMutationCtx({
      authUserId: "auth-user-1",
      membershipRole: "full_admin",
    });

    tables.inventoryImportProvisionalSku.set("provisional-1", {
      _id: "provisional-1",
      finalTrustedQuantity: 8,
      finalizedAt: 1_000,
      posExposureStatus: "hidden",
      productSkuId: "sku-1",
      provisionalSoldQuantityAtFinalization: 2,
      status: "active",
      storeId: "store-1",
    });

    await submitStockAdjustmentBatchWithCtx(ctx, {
      adjustmentType: "manual",
      lineItems: [
        {
          productSkuId: "sku-1" as Id<"productSku">,
          quantityDelta: 1,
        },
      ],
      reasonCode: "correction",
      storeId: "store-1" as Id<"store">,
      submissionKey: "trusted-legacy-import-catalog-setup-adjustment",
    });

    expect(tables.productSku.get("sku-1")).toMatchObject({
      inventoryCount: 9,
      quantityAvailable: 7,
    });
    expect(Array.from(tables.stockAdjustmentBatch.values())).toEqual([
      expect.objectContaining({
        status: "applied",
        submissionKey: "trusted-legacy-import-catalog-setup-adjustment",
      }),
    ]);
  });

  it("blocks stock adjustments when any active provisional row for the SKU still needs review", async () => {
    const { ctx, tables } = createSubmissionMutationCtx({
      authUserId: "auth-user-1",
      membershipRole: "full_admin",
    });

    tables.inventoryImportProvisionalSku.set("provisional-trusted", {
      _id: "provisional-trusted",
      finalTrustedQuantity: 8,
      finalizedAt: 1_000,
      posExposureStatus: "hidden",
      productSkuId: "sku-1",
      provisionalSoldQuantityAtFinalization: 2,
      status: "active",
      storeId: "store-1",
    });
    tables.inventoryImportProvisionalSku.set("provisional-unresolved", {
      _id: "provisional-unresolved",
      productSkuId: "sku-1",
      saleEvidence: {
        totalQuantitySold: 1,
      },
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
        submissionKey: "mixed-provisional-rows-block",
      }),
    ).rejects.toThrow(
      "Legacy import SKUs must be finalized before stock adjustments can update them.",
    );

    expect(tables.inventoryMovement.size).toBe(0);
    expect(tables.stockAdjustmentBatch.size).toBe(0);
  });

  it("fails closed when active provisional rows exceed the per-SKU blocker cap", async () => {
    const { ctx, tables } = createSubmissionMutationCtx({
      authUserId: "auth-user-1",
      membershipRole: "full_admin",
    });

    for (let index = 0; index < 26; index += 1) {
      tables.inventoryImportProvisionalSku.set(`provisional-${index}`, {
        _id: `provisional-${index}`,
        finalTrustedQuantity: 8,
        finalizedAt: 1_000 + index,
        posExposureStatus: "hidden",
        productSkuId: "sku-1",
        provisionalSoldQuantityAtFinalization: 0,
        status: "active",
        storeId: "store-1",
      });
    }

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
        submissionKey: "provisional-row-cap-block",
      }),
    ).rejects.toThrow(
      "Legacy import SKUs must be finalized before stock adjustments can update them.",
    );

    expect(tables.inventoryMovement.size).toBe(0);
    expect(tables.stockAdjustmentBatch.size).toBe(0);
  });

  it("allows stock adjustments for zero-sale provisional rows linked to onboarded trusted SKUs", async () => {
    const { ctx, tables } = createSubmissionMutationCtx({
      authUserId: "auth-user-1",
      membershipRole: "full_admin",
    });

    tables.inventoryImportProvisionalSku.set("provisional-1", {
      _id: "provisional-1",
      productId: "product-1",
      productSkuId: "sku-1",
      saleEvidence: {
        saleCount: 0,
        totalQuantitySold: 0,
      },
      status: "active",
      storeId: "store-1",
    });

    await submitStockAdjustmentBatchWithCtx(ctx, {
      adjustmentType: "manual",
      lineItems: [
        {
          productSkuId: "sku-1" as Id<"productSku">,
          quantityDelta: 1,
        },
      ],
      reasonCode: "correction",
      storeId: "store-1" as Id<"store">,
      submissionKey: "trusted-zero-sale-provisional-adjustment",
    });

    expect(tables.productSku.get("sku-1")).toMatchObject({
      inventoryCount: 9,
      quantityAvailable: 7,
    });
    expect(Array.from(tables.stockAdjustmentBatch.values())).toEqual([
      expect.objectContaining({
        status: "applied",
        submissionKey: "trusted-zero-sale-provisional-adjustment",
      }),
    ]);
  });

  it("allows stock adjustments for sold provisional rows linked to onboarded trusted SKUs", async () => {
    const { ctx, tables } = createSubmissionMutationCtx({
      authUserId: "auth-user-1",
      membershipRole: "full_admin",
    });

    tables.inventoryImportProvisionalSku.set("provisional-1", {
      _id: "provisional-1",
      productId: "product-1",
      productSkuId: "sku-1",
      saleEvidence: {
        saleCount: 1,
        totalQuantitySold: 1,
      },
      status: "active",
      storeId: "store-1",
    });

    await submitStockAdjustmentBatchWithCtx(ctx, {
      adjustmentType: "manual",
      lineItems: [
        {
          productSkuId: "sku-1" as Id<"productSku">,
          quantityDelta: 1,
        },
      ],
      reasonCode: "correction",
      storeId: "store-1" as Id<"store">,
      submissionKey: "trusted-sold-provisional-adjustment",
    });

    expect(tables.productSku.get("sku-1")).toMatchObject({
      inventoryCount: 9,
      quantityAvailable: 7,
    });
    expect(Array.from(tables.stockAdjustmentBatch.values())).toEqual([
      expect.objectContaining({
        status: "applied",
        submissionKey: "trusted-sold-provisional-adjustment",
      }),
    ]);
  });

  it.each([
    [
      "missing category",
      (tables: ReturnType<typeof createSubmissionMutationCtx>["tables"]) => {
        tables.category.delete("category-1");
      },
    ],
    [
      "cross-store category",
      (tables: ReturnType<typeof createSubmissionMutationCtx>["tables"]) => {
        tables.category.set("category-1", {
          _id: "category-1",
          name: "Hair",
          slug: "hair",
          storeId: "store-2",
        });
      },
    ],
    [
      "missing subcategory",
      (tables: ReturnType<typeof createSubmissionMutationCtx>["tables"]) => {
        tables.subcategory.delete("subcategory-1");
      },
    ],
    [
      "mismatched subcategory",
      (tables: ReturnType<typeof createSubmissionMutationCtx>["tables"]) => {
        tables.subcategory.set("subcategory-1", {
          _id: "subcategory-1",
          categoryId: "category-other",
          name: "Closures",
          slug: "closures",
          storeId: "store-1",
        });
      },
    ],
  ])(
    "blocks zero-sale provisional rows with %s",
    async (caseName, mutateTables) => {
      const { ctx, tables } = createSubmissionMutationCtx({
        authUserId: "auth-user-1",
        membershipRole: "full_admin",
      });

      mutateTables(tables);
      tables.inventoryImportProvisionalSku.set("provisional-1", {
        _id: "provisional-1",
        productId: "product-1",
        productSkuId: "sku-1",
        saleEvidence: {
          saleCount: 0,
          totalQuantitySold: 0,
        },
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
          submissionKey: `invalid-taxonomy-${caseName.replaceAll(" ", "-")}`,
        }),
      ).rejects.toThrow(
        "Legacy import SKUs must be finalized before stock adjustments can update them.",
      );

      expect(tables.inventoryMovement.size).toBe(0);
      expect(tables.stockAdjustmentBatch.size).toBe(0);
    },
  );

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
    expect(ctx.scheduler.runAfter).toHaveBeenCalledWith(
      0,
      internal.inventory.catalogSummary.markCatalogSummaryNeedsRefreshInternal,
      { storeId: "store-1" },
    );
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
    expect(reportingMocks.applyInventoryEffectWithCtx).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        actorUserId: "manager-1",
        businessEventKey: "stock_adjustment_batch:batch-1:sku:sku-1",
        valuation: {
          disposition: "stock_correction",
          kind: "outbound",
          quantity: 6,
        },
        workItemId: "work-item-1",
      }),
    );
    expect(ctx.scheduler.runAfter).toHaveBeenCalledWith(
      0,
      internal.inventory.catalogSummary.markCatalogSummaryNeedsRefreshInternal,
      { storeId: "store-1" },
    );
  });

  it("completes synced sale inventory review work only after approval-gated stock adjustments are applied", async () => {
    const { ctx, tables } = createApprovalDecisionMutationCtx();

    tables.operationalWorkItem.set("inventory-review-1", {
      _id: "inventory-review-1",
      createdAt: 1,
      metadata: {
        primaryProductSkuId: "sku-1",
      },
      organizationId: "org-1",
      productSkuId: "sku-1",
      status: "open",
      storeId: "store-1",
      title: "Review inventory for Closure wig",
      type: "synced_sale_inventory_review",
    });

    await resolveStockAdjustmentApprovalDecisionWithCtx(ctx, {
      approvalRequestId: "approval-1" as Id<"approvalRequest">,
      decision: "approved",
      reviewedByUserId: "manager-1" as Id<"athenaUser">,
    });

    const stockMovement = Array.from(tables.inventoryMovement.values())[0];

    expect(tables.operationalWorkItem.get("inventory-review-1")).toMatchObject({
      completedAt: expect.any(Number),
      metadata: {
        resolution: {
          actorUserId: "manager-1",
          domainTrace: {
            inventoryMovementId: stockMovement._id,
            proofKind: "stock_update_movement",
            stockAdjustmentBatchId: "batch-1",
          },
          outcome: "completed",
          reason: "Resolved by applied stock adjustment.",
        },
      },
      status: "completed",
    });
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
    expect(ctx.scheduler.runAfter).not.toHaveBeenCalledWith(
      0,
      internal.inventory.catalogSummary.markCatalogSummaryNeedsRefreshInternal,
      { storeId: "store-1" },
    );
  });
});
