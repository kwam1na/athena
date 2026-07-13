import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { assertConformsToExportedReturns } from "../lib/returnValidatorContract";
import {
  backfillUndefinedSkuVisibilityFromProducts,
  getInventoryBySkuIds,
} from "./productSku";
import {
  archive,
  batchUpdateSkuPrices,
  create,
  createSku,
  generateUniqueBarcode,
  getAll,
  getCatalogSummary,
  getByIdOrSlug,
  repairCatalogSummary,
  remove as removeProduct,
  removeAllProductsForStore,
  removeInternal as removeProductInternal,
  removeSku,
  unarchive,
  update,
  updateSku,
} from "./products";
import { repairArchivedPendingCheckoutReviewWork } from "../pos/application/commands/pendingCheckoutReviewWorkLifecycle";

const mocks = vi.hoisted(() => ({
  advanceRegisterCatalogRevision: vi.fn(),
  applyInventoryEffectWithCtx: vi.fn(),
  refreshProductSkuSearchForProduct: vi.fn(),
  requireProductSkuSearchReadAccess: vi.fn(),
  requireStoreFullAdminAccess: vi.fn(),
  removeProductSkuSearchProjection: vi.fn(),
  removeProductSkuSearchProjections: vi.fn(),
  upsertProductSkuSearchProjection: vi.fn(),
  upsertProductSkuSearchProjections: vi.fn(),
}));

vi.mock("../pos/application/sync/registerCatalogRevision", () => ({
  advanceRegisterCatalogRevision: mocks.advanceRegisterCatalogRevision,
}));

vi.mock("../reporting/inventory/effects", () => ({
  applyInventoryEffectWithCtx: mocks.applyInventoryEffectWithCtx,
}));

vi.mock("../stockOps/access", () => ({
  requireStoreFullAdminAccess: mocks.requireStoreFullAdminAccess,
}));

vi.mock("./skuSearch", () => ({
  refreshProductSkuSearchForProduct: mocks.refreshProductSkuSearchForProduct,
  removeProductSkuSearchProjection: mocks.removeProductSkuSearchProjection,
  removeProductSkuSearchProjections: mocks.removeProductSkuSearchProjections,
  requireProductSkuSearchReadAccess: mocks.requireProductSkuSearchReadAccess,
  upsertProductSkuSearchProjection: mocks.upsertProductSkuSearchProjection,
  upsertProductSkuSearchProjections: mocks.upsertProductSkuSearchProjections,
}));

type TableName =
  | "catalogSummary"
  | "category"
  | "inventoryHold"
  | "inventoryImportProvisionalSku"
  | "operationalEvent"
  | "operationalWorkItem"
  | "posPendingCheckoutItem"
  | "product"
  | "productSku"
  | "subcategory";
type Row = Record<string, unknown> & { _id: string };
type QueryFilter = {
  field: string;
  op: "eq" | "gt";
  value: unknown;
};

function getHandler(definition: unknown) {
  return (definition as { _handler: Function })._handler;
}

function getTestScheduler(ctx: QueryCtx | MutationCtx) {
  return (
    ctx as unknown as { scheduler: { runAfter: ReturnType<typeof vi.fn> } }
  ).scheduler;
}

function pendingCheckoutEvidence() {
  return {
    firstSeenAt: 1,
    lastSeenAt: 1,
    observedLookupCodes: ["123456789012"],
    observedPrices: [125000],
    offlineSaleCount: 0,
    totalQuantitySold: 1,
    transactionCount: 1,
  };
}

function pendingCheckoutItem(overrides: Partial<Row> = {}) {
  const { _id = "pending001", ...rest } = overrides;

  return {
    _id,
    createdAt: 1,
    createdFrom: "offline_sync",
    currency: "GHS",
    evidence: pendingCheckoutEvidence(),
    lookupCode: "123456789012",
    name: "Protein Brazilian Hair Repair Mask",
    normalizedLookupCode: "123456789012",
    normalizedName: "protein brazilian hair repair mask",
    operationalWorkItemId: "work001",
    organizationId: "org0001",
    provisionalPrice: 125000,
    provisionalProductId: "product001",
    provisionalProductSkuId: "sku001",
    reviewPriority: "normal",
    status: "pending_review",
    storeId: "storezzzz",
    updatedAt: 1,
    ...rest,
  };
}

function pendingCheckoutReviewWorkItem(overrides: Partial<Row> = {}) {
  const { _id = "work001", ...rest } = overrides;

  return {
    _id,
    approvalState: "not_required",
    createdAt: 1,
    metadata: {
      pendingCheckoutItemId: "pending001",
      provisionalProductId: "product001",
      provisionalProductSkuId: "sku001",
    },
    organizationId: "org0001",
    priority: "normal",
    status: "open",
    storeId: "storezzzz",
    title: "Review pending checkout item: Protein Brazilian Hair Repair Mask",
    type: "pos_pending_checkout_item_review",
    ...rest,
  };
}

function createSkuMutationCtx(seed: Partial<Record<TableName, Row[]>>) {
  const tables: Record<TableName, Map<string, Row>> = {
    catalogSummary: new Map(
      (seed.catalogSummary ?? []).map((row) => [row._id, row]),
    ),
    category: new Map((seed.category ?? []).map((row) => [row._id, row])),
    inventoryHold: new Map(
      (seed.inventoryHold ?? []).map((row) => [row._id, row]),
    ),
    inventoryImportProvisionalSku: new Map(
      (seed.inventoryImportProvisionalSku ?? []).map((row) => [row._id, row]),
    ),
    operationalEvent: new Map(
      (seed.operationalEvent ?? []).map((row) => [row._id, row]),
    ),
    operationalWorkItem: new Map(
      (seed.operationalWorkItem ?? []).map((row) => [row._id, row]),
    ),
    posPendingCheckoutItem: new Map(
      (seed.posPendingCheckoutItem ?? []).map((row) => [row._id, row]),
    ),
    product: new Map((seed.product ?? []).map((row) => [row._id, row])),
    productSku: new Map((seed.productSku ?? []).map((row) => [row._id, row])),
    subcategory: new Map((seed.subcategory ?? []).map((row) => [row._id, row])),
  };
  const counters: Record<TableName, number> = {
    catalogSummary: seed.catalogSummary?.length ?? 0,
    category: 0,
    inventoryHold: seed.inventoryHold?.length ?? 0,
    inventoryImportProvisionalSku:
      seed.inventoryImportProvisionalSku?.length ?? 0,
    operationalEvent: seed.operationalEvent?.length ?? 0,
    operationalWorkItem: seed.operationalWorkItem?.length ?? 0,
    posPendingCheckoutItem: seed.posPendingCheckoutItem?.length ?? 0,
    product: 0,
    productSku: seed.productSku?.length ?? 0,
    subcategory: 0,
  };

  function createIndexedQuery(table: TableName, filters: QueryFilter[]) {
    const matches = Array.from(tables[table].values()).filter((row) =>
      filters.every((filter) => {
        if (filter.op === "gt") {
          return Number(row[filter.field]) > Number(filter.value);
        }

        return row[filter.field] === filter.value;
      }),
    );

    return {
      first: async () => matches[0] ?? null,
      collect: async () => matches,
      take: async (count: number) => matches.slice(0, count),
      paginate: async (paginationOpts: {
        cursor: string | null;
        numItems: number;
      }) => {
        const start = paginationOpts.cursor ? Number(paginationOpts.cursor) : 0;
        const page = matches.slice(start, start + paginationOpts.numItems);
        const next = start + paginationOpts.numItems;

        return {
          continueCursor: String(next),
          isDone: next >= matches.length,
          page,
        };
      },
    };
  }

  const ctx = {
    db: {
      async get(table: TableName, id: string) {
        return tables[table].get(id) ?? null;
      },
      normalizeId(_table: TableName, id: string) {
        return id.includes("invalid") ? null : id;
      },
      async insert(table: TableName, value: Record<string, unknown>) {
        counters[table] += 1;
        const id = `${table}00${counters[table]}`;
        tables[table].set(id, { _id: id, ...value });
        return id;
      },
      async patch(
        table: TableName,
        id: string,
        value: Record<string, unknown>,
      ) {
        const existing = tables[table].get(id);
        if (!existing) {
          throw new Error(`Missing ${table}: ${id}`);
        }

        tables[table].set(id, { ...existing, ...value });
      },
      async delete(table: TableName, id: string) {
        tables[table].delete(id);
      },
      query(table: TableName) {
        return {
          collect: async () => Array.from(tables[table].values()),
          filter() {
            return createIndexedQuery(
              table,
              table === "product"
                ? [{ field: "_id", op: "eq", value: "product001" }]
                : [],
            );
          },
          withIndex(
            _index: string,
            applyIndex: (queryBuilder: {
              eq: (field: string, value: unknown) => unknown;
              gt: (field: string, value: unknown) => unknown;
            }) => unknown,
          ) {
            const filters: QueryFilter[] = [];
            const queryBuilder = {
              eq(field: string, value: unknown) {
                filters.push({ field, op: "eq", value });
                return queryBuilder;
              },
              gt(field: string, value: unknown) {
                filters.push({ field, op: "gt", value });
                return queryBuilder;
              },
            };

            applyIndex(queryBuilder);
            return createIndexedQuery(table, filters);
          },
        };
      },
    },
    scheduler: {
      runAfter: vi.fn(),
    },
  } as unknown as MutationCtx;

  return { ctx, tables };
}

function createProductsQueryCtx(seed: Partial<Record<TableName, Row[]>>) {
  const { ctx, tables } = createSkuMutationCtx(seed);
  const queryCtx = ctx as unknown as QueryCtx;

  queryCtx.db.query = ((table: TableName) => ({
    filter(applyFilter?: (queryBuilder: unknown) => (row: Row) => boolean) {
      const predicate = applyFilter
        ? applyFilter({
            field: (field: string) => field,
            eq: (field: string, value: unknown) => (row: Row) =>
              row[field] === value,
            and:
              (...predicates: Array<(row: Row) => boolean>) =>
              (row: Row) =>
                predicates.every((predicate) => predicate(row)),
            or:
              (...predicates: Array<(row: Row) => boolean>) =>
              (row: Row) =>
                predicates.some((predicate) => predicate(row)),
          })
        : () => true;

      const matches = Array.from(tables[table].values()).filter(predicate);
      return {
        collect: async () => matches,
        first: async () => matches[0] ?? null,
      };
    },
    withIndex(
      _index: string,
      applyIndex: (queryBuilder: {
        eq: (field: string, value: unknown) => unknown;
        gt: (field: string, value: unknown) => unknown;
      }) => unknown,
    ) {
      const filters: QueryFilter[] = [];
      const queryBuilder = {
        eq(field: string, value: unknown) {
          filters.push({ field, op: "eq", value });
          return queryBuilder;
        },
        gt(field: string, value: unknown) {
          filters.push({ field, op: "gt", value });
          return queryBuilder;
        },
      };

      applyIndex(queryBuilder);
      const matches = Array.from(tables[table].values()).filter((row) =>
        filters.every((filter) => {
          if (filter.op === "gt") {
            return Number(row[filter.field]) > Number(filter.value);
          }

          return row[filter.field] === filter.value;
        }),
      );
      return {
        collect: async () => matches,
        first: async () => matches[0] ?? null,
        take: async (count: number) => matches.slice(0, count),
      };
    },
  })) as unknown as QueryCtx["db"]["query"];

  return { ctx: queryCtx, tables };
}

describe("inventory SKU generation", () => {
  beforeEach(() => {
    mocks.advanceRegisterCatalogRevision.mockReset();
    mocks.applyInventoryEffectWithCtx.mockReset();
    mocks.applyInventoryEffectWithCtx.mockImplementation(
      async (
        ctx: MutationCtx,
        args: {
          compatibilityBalance: {
            onHandQuantity: number;
            sellableQuantity: number;
          };
          productSkuId: Id<"productSku">;
        },
      ) => {
        await ctx.db.patch("productSku", args.productSkuId, {
          inventoryCount: args.compatibilityBalance.onHandQuantity,
          quantityAvailable: args.compatibilityBalance.sellableQuantity,
        });
        return { disposition: "inserted", mode: "compatibility_shadow" };
      },
    );
    mocks.refreshProductSkuSearchForProduct.mockReset();
    mocks.refreshProductSkuSearchForProduct.mockResolvedValue(false);
    mocks.removeProductSkuSearchProjection.mockReset();
    mocks.removeProductSkuSearchProjection.mockResolvedValue(false);
    mocks.removeProductSkuSearchProjections.mockReset();
    mocks.removeProductSkuSearchProjections.mockResolvedValue(false);
    mocks.requireProductSkuSearchReadAccess.mockReset();
    mocks.requireStoreFullAdminAccess.mockReset();
    mocks.upsertProductSkuSearchProjection.mockReset();
    mocks.upsertProductSkuSearchProjections.mockReset();
  });

  it("generates a standard SKU when createSku receives an empty SKU", async () => {
    const { ctx, tables } = createSkuMutationCtx({
      product: [
        {
          _id: "product001",
          storeId: "storezzzz",
        },
      ],
    });

    const result = await getHandler(createSku)(ctx, {
      attributes: {},
      images: [],
      inventoryCount: 1,
      price: 1000,
      productId: "product001" as Id<"product">,
      quantityAvailable: 1,
      sku: "   ",
      storeId: "storezzzz" as Id<"store">,
    });

    expect(result.sku).toMatch(/^[A-Z0-9]+-[A-Z0-9]+-[A-Z0-9]+$/);
    expect(result.sku).not.toBe("TEMP_SKU");
    expect(mocks.applyInventoryEffectWithCtx).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        businessEventKey: expect.stringMatching(
          /^product_sku:productSku\d+:opening_stock$/,
        ),
        physicalQuantityDelta: 1,
        sellableQuantityDelta: 1,
        valuation: expect.objectContaining({
          costBasis: { kind: "uncosted" },
          kind: "inbound",
          quantity: 1,
        }),
      }),
    );
    expect(result.sku).not.toBe("   ");
    expect(Array.from(tables.productSku.values())[0].sku).toBe(result.sku);
    expect(mocks.upsertProductSkuSearchProjection).toHaveBeenCalledWith(
      ctx,
      result._id,
    );
    expect(Array.from(tables.catalogSummary.values())[0]).toMatchObject({
      missingInfoProductCount: 1,
      needsRefresh: false,
      outOfStockProductCount: 0,
      productCount: 1,
      storeId: "storezzzz",
    });
  });

  it("regenerates a standard SKU when updateSku receives an empty SKU", async () => {
    const { ctx, tables } = createSkuMutationCtx({
      product: [
        {
          _id: "product001",
          availability: "live",
          storeId: "storezzzz",
        },
      ],
      productSku: [
        {
          _id: "productSku001",
          inventoryCount: 1,
          price: 1000,
          productId: "product001",
          quantityAvailable: 1,
          sku: "OLD-SKU",
          storeId: "storezzzz",
        },
      ],
    });

    const patchSpy = vi.spyOn(ctx.db, "patch");

    const result = await getHandler(updateSku)(ctx, {
      id: "productSku001" as Id<"productSku">,
      sku: "",
    });

    expect(result.sku).toMatch(/^[A-Z0-9]+-[A-Z0-9]+-[A-Z0-9]+$/);
    expect(result.sku).not.toBe("OLD-SKU");
    expect(patchSpy).toHaveBeenCalledWith(
      "productSku",
      "productSku001",
      expect.objectContaining({ sku: result.sku }),
    );
    expect(mocks.upsertProductSkuSearchProjection).toHaveBeenCalledWith(
      ctx,
      "productSku001",
    );
    expect(Array.from(tables.catalogSummary.values())[0]).toMatchObject({
      needsRefresh: false,
      productCount: 1,
      storeId: "storezzzz",
    });
  });

  it("records legitimate zero opening cost as known inventory", async () => {
    const { ctx, tables } = createSkuMutationCtx({
      product: [
        {
          _id: "product001",
          currency: "GHS",
          organizationId: "org001",
          storeId: "storezzzz",
        },
      ],
    });

    await getHandler(createSku)(ctx, {
      attributes: {},
      images: [],
      inventoryCount: 2,
      price: 1000,
      productId: "product001" as Id<"product">,
      quantityAvailable: 2,
      storeId: "storezzzz" as Id<"store">,
      unitCost: 0,
    });

    expect(mocks.applyInventoryEffectWithCtx).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        physicalQuantityDelta: 2,
        valuation: expect.objectContaining({
          costBasis: expect.objectContaining({ kind: "known", unitCost: 0 }),
          kind: "inbound",
          quantity: 2,
        }),
      }),
    );
    expect(Array.from(tables.productSku.values())[0]).toMatchObject({
      unitCost: 0,
    });
  });

  it("keeps generic SKU metadata edits from changing inventory or cost", async () => {
    const { ctx, tables } = createSkuMutationCtx({
      productSku: [
        {
          _id: "sku001",
          inventoryCount: 5,
          productId: "product001",
          quantityAvailable: 4,
          sku: "SKU-1",
          storeId: "storezzzz",
          unitCost: 250,
        },
      ],
    });

    await getHandler(updateSku)(ctx, {
      id: "sku001" as Id<"productSku">,
      images: ["updated.webp"],
      inventoryCount: 99,
      quantityAvailable: 99,
      unitCost: 999,
    });

    expect(tables.productSku.get("sku001")).toMatchObject({
      images: ["updated.webp"],
      inventoryCount: 5,
      quantityAvailable: 4,
      unitCost: 250,
    });
  });

  it("updates search projection lookup data after generating a barcode", async () => {
    const { ctx } = createSkuMutationCtx({
      productSku: [
        {
          _id: "productSku001",
          inventoryCount: 1,
          price: 1000,
          productId: "product001",
          quantityAvailable: 1,
          sku: "SKU-1",
          storeId: "storezzzz",
        },
      ],
    });

    const result = await getHandler(generateUniqueBarcode)(ctx, {
      productId: "product001" as Id<"product">,
      skuId: "productSku001" as Id<"productSku">,
      storeId: "storezzzz" as Id<"store">,
    });

    expect(result.success).toBe(true);
    assertConformsToExportedReturns(generateUniqueBarcode, result);
    expect(mocks.upsertProductSkuSearchProjection).toHaveBeenCalledWith(
      ctx,
      "productSku001",
    );
  });

  it("removes search projections before deleting SKUs", async () => {
    const { ctx, tables } = createSkuMutationCtx({
      product: [
        {
          _id: "product001",
          availability: "live",
          storeId: "storezzzz",
        },
      ],
      productSku: [
        {
          _id: "productSku001",
          inventoryCount: 1,
          price: 1000,
          productId: "product001",
          quantityAvailable: 1,
          sku: "SKU-1",
          storeId: "storezzzz",
        },
      ],
    });

    await getHandler(removeSku)(ctx, {
      id: "productSku001" as Id<"productSku">,
    });

    expect(mocks.removeProductSkuSearchProjection).toHaveBeenCalledWith(
      ctx,
      "productSku001",
      { advanceRevision: false },
    );
    expect(tables.productSku.has("productSku001")).toBe(false);
    expect(Array.from(tables.catalogSummary.values())[0]).toMatchObject({
      needsRefresh: false,
      outOfStockProductCount: 1,
      productCount: 1,
      storeId: "storezzzz",
    });
  });

  it("advances the revision when deleting a SKU removes a suppressed pending-checkout row", async () => {
    const { ctx } = createSkuMutationCtx({
      posPendingCheckoutItem: [
        pendingCheckoutItem({
          provisionalProductSkuId: "productSku001",
        }),
      ],
      product: [
        {
          _id: "product001",
          availability: "archived",
          storeId: "storezzzz",
        },
      ],
      productSku: [
        {
          _id: "productSku001",
          inventoryCount: 1,
          price: 1000,
          productId: "product001",
          quantityAvailable: 1,
          sku: "SKU-1",
          storeId: "storezzzz",
        },
      ],
    });

    await getHandler(removeSku)(ctx, {
      id: "productSku001" as Id<"productSku">,
    });

    expect(mocks.advanceRegisterCatalogRevision).toHaveBeenCalledWith(ctx, {
      didChange: true,
      storeId: "storezzzz",
    });
  });

  it("includes suppressed pending-checkout rows in archived product deletion revision decisions", async () => {
    const { ctx } = createSkuMutationCtx({
      posPendingCheckoutItem: [pendingCheckoutItem()],
      product: [
        {
          _id: "product001",
          availability: "archived",
          storeId: "storezzzz",
        },
      ],
      productSku: [
        {
          _id: "sku001",
          productId: "product001",
          storeId: "storezzzz",
        },
      ],
    });

    await getHandler(removeProductInternal)(ctx, {
      id: "product001" as Id<"product">,
      storeId: "storezzzz" as Id<"store">,
    });

    expect(mocks.refreshProductSkuSearchForProduct).toHaveBeenCalledWith(
      ctx,
      "product001",
      { additionalEffectiveChange: true, storeId: "storezzzz" },
    );
  });

  it("shares the pending-checkout deletion decision in the unscoped internal path", async () => {
    const { ctx } = createSkuMutationCtx({
      posPendingCheckoutItem: [pendingCheckoutItem()],
      product: [
        {
          _id: "product001",
          availability: "archived",
          storeId: "storezzzz",
        },
      ],
      productSku: [
        {
          _id: "sku001",
          productId: "product001",
          storeId: "storezzzz",
        },
      ],
    });

    await getHandler(removeProduct)(ctx, {
      id: "product001" as Id<"product">,
    });

    expect(mocks.refreshProductSkuSearchForProduct).toHaveBeenCalledWith(
      ctx,
      "product001",
      { additionalEffectiveChange: true, storeId: "storezzzz" },
    );
  });

  it("includes suppressed pending-checkout rows in store-wide deletion revision decisions", async () => {
    const { ctx } = createSkuMutationCtx({
      posPendingCheckoutItem: [pendingCheckoutItem()],
      product: [
        {
          _id: "product001",
          availability: "archived",
          storeId: "storezzzz",
        },
      ],
      productSku: [
        {
          _id: "sku001",
          productId: "product001",
          storeId: "storezzzz",
        },
      ],
    });

    await getHandler(removeAllProductsForStore)(ctx, {
      storeId: "storezzzz" as Id<"store">,
    });

    expect(mocks.removeProductSkuSearchProjections).toHaveBeenCalledWith(
      ctx,
      ["sku001"],
      "storezzzz",
      { additionalEffectiveChange: true },
    );
  });
});

describe("product archiving", () => {
  it("refreshes catalog summary after product creation", async () => {
    const { ctx, tables } = createSkuMutationCtx({
      category: [{ _id: "category001", slug: "hair", storeId: "storezzzz" }],
      subcategory: [{ _id: "subcategory001", storeId: "storezzzz" }],
    });

    await getHandler(create)(ctx, {
      availability: "live",
      categoryId: "category001" as Id<"category">,
      createdByUserId: "user001" as Id<"athenaUser">,
      currency: "GHS",
      inventoryCount: 0,
      name: "New product",
      organizationId: "org001" as Id<"organization">,
      slug: "new-product",
      storeId: "storezzzz" as Id<"store">,
      subcategoryId: "subcategory001" as Id<"subcategory">,
    });

    expect(Array.from(tables.catalogSummary.values())[0]).toMatchObject({
      categoryCount: 1,
      needsRefresh: false,
      outOfStockProductCount: 1,
      productCount: 1,
      storeId: "storezzzz",
    });
  });

  it("archives a product without deleting the product record", async () => {
    mocks.requireStoreFullAdminAccess.mockResolvedValue({});

    const { ctx, tables } = createSkuMutationCtx({
      product: [
        {
          _id: "product001",
          availability: "live",
          storeId: "storezzzz",
        },
      ],
    });
    const deleteSpy = vi.spyOn(ctx.db, "delete");

    const result = await getHandler(archive)(ctx, {
      id: "product001" as Id<"product">,
      storeId: "storezzzz" as Id<"store">,
    });

    expect(mocks.requireStoreFullAdminAccess).toHaveBeenCalledWith(
      ctx,
      "storezzzz",
    );
    expect(result).toMatchObject({
      _id: "product001",
      availability: "archived",
    });
    expect(tables.product.get("product001")).toMatchObject({
      availability: "archived",
    });
    expect(deleteSpy).not.toHaveBeenCalled();
    expect(mocks.refreshProductSkuSearchForProduct).toHaveBeenCalledWith(
      ctx,
      "product001",
    );
    expect(Array.from(tables.catalogSummary.values())[0]).toMatchObject({
      needsRefresh: false,
      productCount: 0,
      storeId: "storezzzz",
    });
  });

  it("cancels pending checkout review work when archiving its provisional product", async () => {
    mocks.requireStoreFullAdminAccess.mockResolvedValue({});

    const { ctx, tables } = createSkuMutationCtx({
      operationalWorkItem: [
        pendingCheckoutReviewWorkItem({
          metadata: { pendingCheckoutItemId: "pending001" },
          priority: "high",
          title: "Stale title",
        }),
      ],
      posPendingCheckoutItem: [pendingCheckoutItem()],
      product: [
        {
          _id: "product001",
          availability: "live",
          storeId: "storezzzz",
        },
      ],
      productSku: [
        {
          _id: "sku001",
          productId: "product001",
          storeId: "storezzzz",
        },
      ],
    });

    await getHandler(archive)(ctx, {
      id: "product001" as Id<"product">,
      storeId: "storezzzz" as Id<"store">,
    });

    expect(tables.operationalWorkItem.get("work001")).toMatchObject({
      completedAt: expect.any(Number),
      metadata: expect.objectContaining({
        pendingCheckoutItemId: "pending001",
        retiredReason: "provisional_product_archived",
      }),
      status: "cancelled",
    });
    expect(tables.posPendingCheckoutItem.get("pending001")).toMatchObject({
      operationalWorkItemId: undefined,
    });
    expect(Array.from(tables.operationalEvent.values())).toEqual([
      expect.objectContaining({
        eventType: "pos_pending_checkout_item_review_work_cancelled",
        subjectId: "pending001",
        workItemId: "work001",
      }),
    ]);
  });

  it("cancels in-progress pending checkout review work through the product anchor when the SKU anchor is missing", async () => {
    mocks.requireStoreFullAdminAccess.mockResolvedValue({});

    const { ctx, tables } = createSkuMutationCtx({
      operationalWorkItem: [
        pendingCheckoutReviewWorkItem({
          metadata: {},
          status: "in_progress",
        }),
      ],
      posPendingCheckoutItem: [
        pendingCheckoutItem({
          provisionalProductSkuId: undefined,
        }),
      ],
      product: [
        {
          _id: "product001",
          availability: "live",
          storeId: "storezzzz",
        },
      ],
    });

    await getHandler(archive)(ctx, {
      id: "product001" as Id<"product">,
      storeId: "storezzzz" as Id<"store">,
    });

    expect(tables.operationalWorkItem.get("work001")).toMatchObject({
      completedAt: expect.any(Number),
      metadata: expect.objectContaining({
        pendingCheckoutItemId: "pending001",
        provisionalProductId: "product001",
        retiredReason: "provisional_product_archived",
      }),
      status: "cancelled",
    });
    expect(tables.posPendingCheckoutItem.get("pending001")).toMatchObject({
      operationalWorkItemId: undefined,
    });
  });

  it("unarchives a product with store admin access", async () => {
    mocks.requireStoreFullAdminAccess.mockResolvedValue({});

    const { ctx, tables } = createSkuMutationCtx({
      product: [
        {
          _id: "product001",
          availability: "archived",
          storeId: "storezzzz",
        },
      ],
    });

    const result = await getHandler(unarchive)(ctx, {
      id: "product001" as Id<"product">,
      storeId: "storezzzz" as Id<"store">,
    });

    expect(mocks.requireStoreFullAdminAccess).toHaveBeenCalledWith(
      ctx,
      "storezzzz",
    );
    expect(result).toMatchObject({
      _id: "product001",
      availability: "live",
    });
    expect(tables.product.get("product001")).toMatchObject({
      availability: "live",
    });
    expect(mocks.refreshProductSkuSearchForProduct).toHaveBeenCalledWith(
      ctx,
      "product001",
    );
    expect(Array.from(tables.catalogSummary.values())[0]).toMatchObject({
      needsRefresh: false,
      productCount: 1,
      storeId: "storezzzz",
    });
  });

  it("creates fresh pending checkout review work when unarchiving its provisional product", async () => {
    mocks.requireStoreFullAdminAccess.mockResolvedValue({});

    const { ctx, tables } = createSkuMutationCtx({
      posPendingCheckoutItem: [
        pendingCheckoutItem({
          operationalWorkItemId: undefined,
          reviewPriority: "elevated",
        }),
      ],
      product: [
        {
          _id: "product001",
          availability: "archived",
          storeId: "storezzzz",
        },
      ],
      productSku: [
        {
          _id: "sku001",
          productId: "product001",
          storeId: "storezzzz",
        },
      ],
    });

    await getHandler(unarchive)(ctx, {
      id: "product001" as Id<"product">,
      storeId: "storezzzz" as Id<"store">,
    });

    const workItem = Array.from(tables.operationalWorkItem.values())[0];
    expect(workItem).toMatchObject({
      priority: "medium",
      status: "open",
      title: "Review pending checkout item: Protein Brazilian Hair Repair Mask",
      type: "pos_pending_checkout_item_review",
    });
    expect(tables.posPendingCheckoutItem.get("pending001")).toMatchObject({
      operationalWorkItemId: workItem._id,
    });
  });

  it("reattaches existing pending checkout review work when unarchiving without duplicating it", async () => {
    mocks.requireStoreFullAdminAccess.mockResolvedValue({});

    const { ctx, tables } = createSkuMutationCtx({
      operationalWorkItem: [pendingCheckoutReviewWorkItem()],
      posPendingCheckoutItem: [
        pendingCheckoutItem({
          operationalWorkItemId: undefined,
        }),
      ],
      product: [
        {
          _id: "product001",
          availability: "archived",
          storeId: "storezzzz",
        },
      ],
      productSku: [
        {
          _id: "sku001",
          productId: "product001",
          storeId: "storezzzz",
        },
      ],
    });

    await getHandler(unarchive)(ctx, {
      id: "product001" as Id<"product">,
      storeId: "storezzzz" as Id<"store">,
    });

    expect(Array.from(tables.operationalWorkItem.values())).toHaveLength(1);
    expect(tables.operationalWorkItem.get("work001")).toMatchObject({
      metadata: expect.objectContaining({
        pendingCheckoutItemId: "pending001",
        provisionalProductId: "product001",
        provisionalProductSkuId: "sku001",
        restoredReason: "provisional_product_unarchived",
      }),
      priority: "normal",
      title: "Review pending checkout item: Protein Brazilian Hair Repair Mask",
    });
    expect(tables.posPendingCheckoutItem.get("pending001")).toMatchObject({
      operationalWorkItemId: "work001",
    });
  });

  it("repairs stale pending checkout review work for archived provisional products after a dry run", async () => {
    const { ctx, tables } = createSkuMutationCtx({
      operationalWorkItem: [pendingCheckoutReviewWorkItem()],
      posPendingCheckoutItem: [pendingCheckoutItem()],
      product: [
        {
          _id: "product001",
          availability: "archived",
          storeId: "storezzzz",
        },
      ],
    });

    const dryRun = await getHandler(repairArchivedPendingCheckoutReviewWork)(
      ctx,
      {
        dryRun: true,
        paginationOpts: { cursor: null, numItems: 10 },
        status: "open",
        storeId: "storezzzz" as Id<"store">,
      },
    );

    expect(dryRun).toMatchObject({
      candidates: ["work001"],
      repaired: [],
    });
    expect(tables.operationalWorkItem.get("work001")).toMatchObject({
      status: "open",
    });

    const repaired = await getHandler(repairArchivedPendingCheckoutReviewWork)(
      ctx,
      {
        dryRun: false,
        repairRunId: "repair-2026-07-04",
        status: "open",
        storeId: "storezzzz" as Id<"store">,
        workItemIds: dryRun.candidates,
      },
    );

    expect(repaired).toMatchObject({
      candidates: ["work001"],
      repaired: ["work001"],
    });
    expect(tables.operationalWorkItem.get("work001")).toMatchObject({
      completedAt: expect.any(Number),
      metadata: expect.objectContaining({
        repairRunId: "repair-2026-07-04",
        retiredReason: "archived_provisional_product_repair",
      }),
      status: "cancelled",
    });
    expect(tables.posPendingCheckoutItem.get("pending001")).toMatchObject({
      operationalWorkItemId: undefined,
    });
  });

  it("repairs stale in-progress pending checkout review work for archived provisional products", async () => {
    const { ctx, tables } = createSkuMutationCtx({
      operationalWorkItem: [
        pendingCheckoutReviewWorkItem({
          status: "in_progress",
        }),
      ],
      posPendingCheckoutItem: [pendingCheckoutItem()],
      product: [
        {
          _id: "product001",
          availability: "archived",
          storeId: "storezzzz",
        },
      ],
    });

    const dryRun = await getHandler(repairArchivedPendingCheckoutReviewWork)(
      ctx,
      {
        dryRun: true,
        paginationOpts: { cursor: null, numItems: 10 },
        status: "in_progress",
        storeId: "storezzzz" as Id<"store">,
      },
    );

    expect(dryRun).toMatchObject({
      candidates: ["work001"],
      repaired: [],
    });

    const repaired = await getHandler(repairArchivedPendingCheckoutReviewWork)(
      ctx,
      {
        dryRun: false,
        repairRunId: "repair-2026-07-04",
        status: "in_progress",
        storeId: "storezzzz" as Id<"store">,
        workItemIds: dryRun.candidates,
      },
    );

    expect(repaired).toMatchObject({
      candidates: ["work001"],
      repaired: ["work001"],
    });
    expect(tables.operationalWorkItem.get("work001")).toMatchObject({
      completedAt: expect.any(Number),
      metadata: expect.objectContaining({
        repairRunId: "repair-2026-07-04",
        retiredReason: "archived_provisional_product_repair",
      }),
      status: "cancelled",
    });
    expect(tables.posPendingCheckoutItem.get("pending001")).toMatchObject({
      operationalWorkItemId: undefined,
    });
  });

  it("skips unsafe repair rows without mutating unrelated work", async () => {
    const { ctx, tables } = createSkuMutationCtx({
      operationalWorkItem: [
        pendingCheckoutReviewWorkItem({
          _id: "work-missing-metadata",
          metadata: {},
        }),
        pendingCheckoutReviewWorkItem({
          _id: "work-invalid-pending",
          metadata: { pendingCheckoutItemId: "invalid-pending" },
        }),
        pendingCheckoutReviewWorkItem({
          _id: "work-approved",
          metadata: { pendingCheckoutItemId: "pending-approved" },
        }),
        pendingCheckoutReviewWorkItem({
          _id: "work-missing-product",
          metadata: { pendingCheckoutItemId: "pending-missing-product" },
        }),
        pendingCheckoutReviewWorkItem({
          _id: "work-live-product",
          metadata: { pendingCheckoutItemId: "pending-live-product" },
        }),
      ],
      posPendingCheckoutItem: [
        pendingCheckoutItem({
          _id: "pending-approved",
          operationalWorkItemId: "work-approved",
          status: "approved",
        }),
        pendingCheckoutItem({
          _id: "pending-missing-product",
          operationalWorkItemId: "work-missing-product",
          provisionalProductId: undefined,
          provisionalProductSkuId: undefined,
        }),
        pendingCheckoutItem({
          _id: "pending-live-product",
          operationalWorkItemId: "work-live-product",
          provisionalProductId: "product-live",
          provisionalProductSkuId: undefined,
        }),
      ],
      product: [
        {
          _id: "product-live",
          availability: "live",
          storeId: "storezzzz",
        },
      ],
    });

    const result = await getHandler(repairArchivedPendingCheckoutReviewWork)(
      ctx,
      {
        dryRun: true,
        paginationOpts: { cursor: null, numItems: 10 },
        status: "open",
        storeId: "storezzzz" as Id<"store">,
      },
    );

    expect(result).toMatchObject({
      candidates: [],
      repaired: [],
      skipped: [
        {
          reason: "missing_pending_checkout_item_id",
          workItemId: "work-missing-metadata",
        },
        {
          reason: "invalid_pending_checkout_item_id",
          workItemId: "work-invalid-pending",
        },
        {
          reason: "pending_checkout_item_not_actionable",
          workItemId: "work-approved",
        },
        {
          reason: "missing_provisional_product",
          workItemId: "work-missing-product",
        },
        {
          reason: "provisional_product_not_archived",
          workItemId: "work-live-product",
        },
      ],
    });
    expect(
      Array.from(tables.operationalWorkItem.values()).map(
        (workItem) => workItem.status,
      ),
    ).toEqual(["open", "open", "open", "open", "open"]);
  });

  it("requires explicit dry-run candidate ids before mutating repair rows", async () => {
    const { ctx } = createSkuMutationCtx({
      operationalWorkItem: [pendingCheckoutReviewWorkItem()],
      posPendingCheckoutItem: [pendingCheckoutItem()],
      product: [
        {
          _id: "product001",
          availability: "archived",
          storeId: "storezzzz",
        },
      ],
    });

    await expect(
      getHandler(repairArchivedPendingCheckoutReviewWork)(ctx, {
        dryRun: false,
        paginationOpts: { cursor: null, numItems: 10 },
        status: "open",
        storeId: "storezzzz" as Id<"store">,
      }),
    ).rejects.toThrow(
      "Provide a repair run id and explicit dry-run candidate work item ids to repair.",
    );
  });

  it("revalidates explicit repair candidate ids before mutating stale rows", async () => {
    const { ctx, tables } = createSkuMutationCtx({
      operationalWorkItem: [
        pendingCheckoutReviewWorkItem({
          _id: "work-wrong-status",
          status: "in_progress",
        }),
        pendingCheckoutReviewWorkItem({
          _id: "work-wrong-store",
          storeId: "other-store",
        }),
        pendingCheckoutReviewWorkItem({
          _id: "work-wrong-type",
          type: "service_case",
        }),
        pendingCheckoutReviewWorkItem({
          _id: "work-pending-wrong-store",
          metadata: { pendingCheckoutItemId: "pending-wrong-store" },
        }),
        pendingCheckoutReviewWorkItem({
          _id: "work-invalid-product",
          metadata: {
            pendingCheckoutItemId: "pending-bad-product",
            provisionalProductId: "invalid-product",
          },
        }),
      ],
      posPendingCheckoutItem: [
        pendingCheckoutItem({
          _id: "pending-wrong-store",
          operationalWorkItemId: "work-pending-wrong-store",
          storeId: "other-store",
        }),
        pendingCheckoutItem({
          _id: "pending-bad-product",
          operationalWorkItemId: "work-invalid-product",
          provisionalProductId: undefined,
          provisionalProductSkuId: undefined,
        }),
      ],
    });

    const result = await getHandler(repairArchivedPendingCheckoutReviewWork)(
      ctx,
      {
        dryRun: false,
        repairRunId: "repair-2026-07-04",
        status: "open",
        storeId: "storezzzz" as Id<"store">,
        workItemIds: [
          "work-wrong-status",
          "work-wrong-store",
          "work-wrong-type",
          "work-pending-wrong-store",
          "work-invalid-product",
        ],
      },
    );

    expect(result).toMatchObject({
      candidates: [],
      repaired: [],
      skipped: [
        {
          reason: "work_item_no_longer_matches_repair_scope",
          workItemId: "work-wrong-status",
        },
        {
          reason: "work_item_no_longer_matches_repair_scope",
          workItemId: "work-wrong-store",
        },
        {
          reason: "work_item_no_longer_matches_repair_scope",
          workItemId: "work-wrong-type",
        },
        {
          reason: "pending_checkout_item_wrong_store",
          workItemId: "work-pending-wrong-store",
        },
        {
          reason: "invalid_provisional_product",
          workItemId: "work-invalid-product",
        },
      ],
    });
    expect(
      Array.from(tables.operationalWorkItem.values()).map(
        (workItem) => workItem.status,
      ),
    ).toEqual(["in_progress", "open", "open", "open", "open"]);
  });

  it("reconciles pending checkout review work when a generic product update archives the provisional product", async () => {
    const { ctx, tables } = createSkuMutationCtx({
      operationalWorkItem: [pendingCheckoutReviewWorkItem()],
      posPendingCheckoutItem: [pendingCheckoutItem()],
      product: [
        {
          _id: "product001",
          availability: "live",
          storeId: "storezzzz",
        },
      ],
      productSku: [
        {
          _id: "sku001",
          productId: "product001",
          storeId: "storezzzz",
        },
      ],
    });

    await getHandler(update)(ctx, {
      availability: "archived",
      id: "product001" as Id<"product">,
    });

    expect(tables.operationalWorkItem.get("work001")).toMatchObject({
      completedAt: expect.any(Number),
      metadata: expect.objectContaining({
        pendingCheckoutItemId: "pending001",
        retiredReason: "provisional_product_archived",
      }),
      status: "cancelled",
    });
    expect(tables.posPendingCheckoutItem.get("pending001")).toMatchObject({
      operationalWorkItemId: undefined,
    });
    expect(Array.from(tables.operationalEvent.values())).toEqual([
      expect.objectContaining({
        eventType: "pos_pending_checkout_item_review_work_cancelled",
        subjectId: "pending001",
        workItemId: "work001",
      }),
    ]);
  });

  it("reconciles pending checkout review work when a generic product update unarchives the provisional product", async () => {
    const { ctx, tables } = createSkuMutationCtx({
      posPendingCheckoutItem: [
        pendingCheckoutItem({
          operationalWorkItemId: undefined,
          reviewPriority: "elevated",
        }),
      ],
      product: [
        {
          _id: "product001",
          availability: "archived",
          storeId: "storezzzz",
        },
      ],
      productSku: [
        {
          _id: "sku001",
          productId: "product001",
          storeId: "storezzzz",
        },
      ],
    });

    await getHandler(update)(ctx, {
      availability: "live",
      id: "product001" as Id<"product">,
    });

    const workItem = Array.from(tables.operationalWorkItem.values())[0];
    expect(workItem).toMatchObject({
      metadata: expect.objectContaining({
        pendingCheckoutItemId: "pending001",
        restoredReason: "provisional_product_unarchived",
      }),
      priority: "medium",
      status: "open",
      title: "Review pending checkout item: Protein Brazilian Hair Repair Mask",
      type: "pos_pending_checkout_item_review",
    });
    expect(tables.posPendingCheckoutItem.get("pending001")).toMatchObject({
      operationalWorkItemId: workItem._id,
    });
  });

  it("refreshes search projections when product metadata changes", async () => {
    const { ctx, tables } = createSkuMutationCtx({
      product: [
        {
          _id: "product001",
          availability: "live",
          name: "Old name",
          storeId: "storezzzz",
        },
      ],
    });

    await getHandler(update)(ctx, {
      id: "product001" as Id<"product">,
      name: "New name",
    });

    expect(mocks.refreshProductSkuSearchForProduct).toHaveBeenCalledWith(
      ctx,
      "product001",
    );
    expect(Array.from(tables.catalogSummary.values())[0]).toMatchObject({
      needsRefresh: false,
      productCount: 1,
      storeId: "storezzzz",
    });
  });

  it("completes finalized legacy import review rows when product taxonomy leaves legacy import", async () => {
    const { ctx, tables } = createSkuMutationCtx({
      category: [
        {
          _id: "category-hair",
          name: "Hair Care",
          slug: "hair-care",
          storeId: "storezzzz",
        },
      ],
      inventoryImportProvisionalSku: [
        {
          _id: "provisional001",
          finalTrustedQuantity: 5,
          finalizedAt: 1_000,
          productId: "product001",
          productSkuId: "sku001",
          status: "active",
          storeId: "storezzzz",
        },
      ],
      operationalWorkItem: [
        {
          _id: "taxonomy-work-001",
          approvalState: "not_required",
          createdAt: 1_000,
          metadata: {
            categorySlug: "legacy-import",
            productId: "product001",
            productSkuId: "sku001",
            provisionalSkuId: "provisional001",
          },
          organizationId: "org0001",
          priority: "medium",
          productId: "product001",
          productSkuId: "sku001",
          status: "open",
          storeId: "storezzzz",
          title: "Assign catalog category: Quick And Go Bonding Glue",
          type: "catalog_taxonomy_setup",
        },
      ],
      product: [
        {
          _id: "product001",
          availability: "draft",
          categoryId: "category-legacy",
          name: "Quick And Go Bonding Glue",
          organizationId: "org0001",
          storeId: "storezzzz",
          subcategoryId: "subcategory-legacy",
        },
      ],
      productSku: [
        {
          _id: "sku001",
          productId: "product001",
          storeId: "storezzzz",
        },
      ],
      subcategory: [
        {
          _id: "subcategory-protectant",
          categoryId: "category-hair",
          name: "Heat Protectant",
          slug: "heat-protectant",
          storeId: "storezzzz",
        },
      ],
    });

    await getHandler(update)(ctx, {
      categoryId: "category-hair" as Id<"category">,
      id: "product001" as Id<"product">,
      subcategoryId: "subcategory-protectant" as Id<"subcategory">,
    });

    expect(
      tables.inventoryImportProvisionalSku.get("provisional001"),
    ).toMatchObject({
      status: "finalized",
      updatedAt: expect.any(Number),
    });
    expect(tables.operationalWorkItem.get("taxonomy-work-001")).toMatchObject({
      completedAt: expect.any(Number),
      metadata: expect.objectContaining({
        completedReason: "athena_taxonomy_applied",
        productId: "product001",
      }),
      status: "completed",
    });
  });

  it("makes onboarded trusted legacy import products visible in catalog search", async () => {
    const { ctx, tables } = createSkuMutationCtx({
      category: [
        {
          _id: "category-hair",
          name: "Hair Care",
          slug: "hair-care",
          storeId: "storezzzz",
        },
      ],
      inventoryImportProvisionalSku: [
        {
          _id: "provisional001",
          finalTrustedQuantity: 5,
          finalizedAt: 1_000,
          productId: "product001",
          productSkuId: "sku001",
          status: "active",
          storeId: "storezzzz",
        },
      ],
      product: [
        {
          _id: "product001",
          availability: "live",
          categoryId: "category-legacy",
          isVisible: false,
          name: "Quick And Go Bonding Glue",
          organizationId: "org0001",
          storeId: "storezzzz",
          subcategoryId: "subcategory-legacy",
        },
      ],
      productSku: [
        {
          _id: "sku001",
          productId: "product001",
          storeId: "storezzzz",
        },
      ],
      subcategory: [
        {
          _id: "subcategory-protectant",
          categoryId: "category-hair",
          name: "Heat Protectant",
          slug: "heat-protectant",
          storeId: "storezzzz",
        },
      ],
    });

    await getHandler(update)(ctx, {
      categoryId: "category-hair" as Id<"category">,
      id: "product001" as Id<"product">,
      subcategoryId: "subcategory-protectant" as Id<"subcategory">,
    });

    expect(tables.product.get("product001")).toMatchObject({
      categoryId: "category-hair",
      isVisible: true,
      subcategoryId: "subcategory-protectant",
    });
    expect(mocks.refreshProductSkuSearchForProduct).toHaveBeenCalledWith(
      ctx,
      "product001",
    );
  });

  it("keeps onboarded trusted legacy import products hidden when explicitly requested", async () => {
    const { ctx, tables } = createSkuMutationCtx({
      category: [
        {
          _id: "category-hair",
          name: "Hair Care",
          slug: "hair-care",
          storeId: "storezzzz",
        },
      ],
      inventoryImportProvisionalSku: [
        {
          _id: "provisional001",
          finalTrustedQuantity: 5,
          finalizedAt: 1_000,
          productId: "product001",
          productSkuId: "sku001",
          status: "active",
          storeId: "storezzzz",
        },
      ],
      product: [
        {
          _id: "product001",
          availability: "live",
          categoryId: "category-legacy",
          isVisible: false,
          name: "Quick And Go Bonding Glue",
          organizationId: "org0001",
          storeId: "storezzzz",
          subcategoryId: "subcategory-legacy",
        },
      ],
      productSku: [
        {
          _id: "sku001",
          productId: "product001",
          storeId: "storezzzz",
        },
      ],
      subcategory: [
        {
          _id: "subcategory-protectant",
          categoryId: "category-hair",
          name: "Heat Protectant",
          slug: "heat-protectant",
          storeId: "storezzzz",
        },
      ],
    });

    await getHandler(update)(ctx, {
      categoryId: "category-hair" as Id<"category">,
      id: "product001" as Id<"product">,
      isVisible: false,
      subcategoryId: "subcategory-protectant" as Id<"subcategory">,
    });

    expect(tables.product.get("product001")).toMatchObject({
      categoryId: "category-hair",
      isVisible: false,
      subcategoryId: "subcategory-protectant",
    });
    expect(mocks.refreshProductSkuSearchForProduct).toHaveBeenCalledWith(
      ctx,
      "product001",
    );
  });

  it("rejects finalized legacy import review row saves when taxonomy remains legacy import", async () => {
    const { ctx, tables } = createSkuMutationCtx({
      category: [
        {
          _id: "category-legacy",
          name: "Legacy import",
          slug: "legacy-import",
          storeId: "storezzzz",
        },
      ],
      inventoryImportProvisionalSku: [
        {
          _id: "provisional001",
          finalTrustedQuantity: 5,
          finalizedAt: 1_000,
          productId: "product001",
          productSkuId: "sku001",
          status: "active",
          storeId: "storezzzz",
        },
      ],
      operationalWorkItem: [
        {
          _id: "taxonomy-work-001",
          approvalState: "not_required",
          createdAt: 1_000,
          metadata: {
            categorySlug: "legacy-import",
            productId: "product001",
            productSkuId: "sku001",
            provisionalSkuId: "provisional001",
          },
          organizationId: "org0001",
          priority: "medium",
          productId: "product001",
          productSkuId: "sku001",
          status: "open",
          storeId: "storezzzz",
          title: "Assign catalog category: Quick And Go Bonding Glue",
          type: "catalog_taxonomy_setup",
        },
      ],
      product: [
        {
          _id: "product001",
          availability: "draft",
          categoryId: "category-legacy",
          name: "Quick And Go Bonding Glue",
          organizationId: "org0001",
          storeId: "storezzzz",
          subcategoryId: "subcategory-legacy",
        },
      ],
      productSku: [
        {
          _id: "sku001",
          productId: "product001",
          storeId: "storezzzz",
        },
      ],
      subcategory: [
        {
          _id: "subcategory-legacy",
          categoryId: "category-legacy",
          name: "872",
          slug: "872",
          storeId: "storezzzz",
        },
      ],
    });

    await expect(
      getHandler(update)(ctx, {
        categoryId: "category-legacy" as Id<"category">,
        id: "product001" as Id<"product">,
        subcategoryId: "subcategory-legacy" as Id<"subcategory">,
      }),
    ).rejects.toThrow(
      "Catalog setup required. Assign an Athena category and subcategory before saving.",
    );

    expect(
      tables.inventoryImportProvisionalSku.get("provisional001"),
    ).toMatchObject({
      status: "active",
    });
    expect(tables.operationalWorkItem.get("taxonomy-work-001")).toMatchObject({
      status: "open",
    });
  });

  it("skips legacy import taxonomy cleanup when non-taxonomy product fields change", async () => {
    const { ctx, tables } = createSkuMutationCtx({
      category: [
        {
          _id: "category-hair",
          name: "Hair Care",
          slug: "hair-care",
          storeId: "storezzzz",
        },
      ],
      inventoryImportProvisionalSku: [
        {
          _id: "provisional001",
          finalTrustedQuantity: 5,
          finalizedAt: 1_000,
          productId: "product001",
          productSkuId: "sku001",
          status: "active",
          storeId: "storezzzz",
        },
      ],
      operationalWorkItem: [
        {
          _id: "taxonomy-work-001",
          approvalState: "not_required",
          createdAt: 1_000,
          metadata: {
            productId: "product001",
            productSkuId: "sku001",
          },
          organizationId: "org0001",
          priority: "medium",
          productId: "product001",
          productSkuId: "sku001",
          status: "open",
          storeId: "storezzzz",
          title: "Assign catalog category: Quick And Go Bonding Glue",
          type: "catalog_taxonomy_setup",
        },
      ],
      product: [
        {
          _id: "product001",
          availability: "live",
          categoryId: "category-hair",
          name: "Quick And Go Bonding Glue",
          organizationId: "org0001",
          storeId: "storezzzz",
          subcategoryId: "subcategory-protectant",
        },
      ],
      productSku: [
        {
          _id: "sku001",
          productId: "product001",
          productName: "Quick And Go Bonding Glue",
          storeId: "storezzzz",
        },
      ],
      subcategory: [
        {
          _id: "subcategory-protectant",
          categoryId: "category-hair",
          name: "Heat Protectant",
          slug: "heat-protectant",
          storeId: "storezzzz",
        },
      ],
    });

    await getHandler(update)(ctx, {
      id: "product001" as Id<"product">,
      name: "Quick & Go Bonding Glue",
    });

    expect(
      tables.inventoryImportProvisionalSku.get("provisional001"),
    ).toMatchObject({
      status: "active",
    });
    expect(tables.operationalWorkItem.get("taxonomy-work-001")).toMatchObject({
      status: "open",
    });
  });

  it("blocks non-taxonomy saves after trusted inventory is finalized for legacy import rows", async () => {
    const { ctx, tables } = createSkuMutationCtx({
      category: [
        {
          _id: "category-legacy",
          name: "Legacy import",
          slug: "legacy-import",
          storeId: "storezzzz",
        },
      ],
      inventoryImportProvisionalSku: [
        {
          _id: "provisional001",
          finalTrustedQuantity: 5,
          finalizedAt: 1_000,
          productId: "product001",
          productSkuId: "sku001",
          status: "active",
          storeId: "storezzzz",
        },
      ],
      product: [
        {
          _id: "product001",
          availability: "live",
          categoryId: "category-legacy",
          name: "Quick And Go Bonding Glue",
          organizationId: "org0001",
          storeId: "storezzzz",
          subcategoryId: "subcategory-legacy",
        },
      ],
      productSku: [
        {
          _id: "sku001",
          productId: "product001",
          productName: "Quick And Go Bonding Glue",
          storeId: "storezzzz",
        },
      ],
      subcategory: [
        {
          _id: "subcategory-legacy",
          categoryId: "category-legacy",
          name: "872",
          slug: "872",
          storeId: "storezzzz",
        },
      ],
    });

    await expect(
      getHandler(update)(ctx, {
        id: "product001" as Id<"product">,
        name: "Quick & Go Bonding Glue",
      }),
    ).rejects.toThrow(
      "Catalog setup required. Assign an Athena category and subcategory before saving.",
    );

    expect(tables.product.get("product001")).toMatchObject({
      name: "Quick And Go Bonding Glue",
    });
    expect(tables.productSku.get("sku001")).toMatchObject({
      productName: "Quick And Go Bonding Glue",
    });
  });

  it("fails closed when finalized legacy import row checks exceed the product SKU cap", async () => {
    const productSkus = Array.from({ length: 5_001 }, (_, index) => ({
      _id: `sku-${index}`,
      productId: "product001",
      productName: "Quick And Go Bonding Glue",
      storeId: "storezzzz",
    }));
    const { ctx, tables } = createSkuMutationCtx({
      category: [
        {
          _id: "category-legacy",
          name: "Legacy import",
          slug: "legacy-import",
          storeId: "storezzzz",
        },
      ],
      inventoryImportProvisionalSku: [
        {
          _id: "provisional-overflow",
          finalTrustedQuantity: 5,
          finalizedAt: 1_000,
          productId: "product001",
          productSkuId: "sku-5000",
          status: "active",
          storeId: "storezzzz",
        },
      ],
      product: [
        {
          _id: "product001",
          availability: "live",
          categoryId: "category-legacy",
          name: "Quick And Go Bonding Glue",
          organizationId: "org0001",
          storeId: "storezzzz",
          subcategoryId: "subcategory-legacy",
        },
      ],
      productSku: productSkus,
      subcategory: [
        {
          _id: "subcategory-legacy",
          categoryId: "category-legacy",
          name: "872",
          slug: "872",
          storeId: "storezzzz",
        },
      ],
    });

    await expect(
      getHandler(update)(ctx, {
        id: "product001" as Id<"product">,
        name: "Quick & Go Bonding Glue",
      }),
    ).rejects.toThrow(
      "Catalog setup required. Assign an Athena category and subcategory before saving.",
    );

    expect(tables.product.get("product001")).toMatchObject({
      name: "Quick And Go Bonding Glue",
    });
    expect(tables.productSku.get("sku-5000")).toMatchObject({
      productName: "Quick And Go Bonding Glue",
    });
  });

  it("fails closed when active legacy import rows exceed the per-SKU product update cap", async () => {
    const provisionalRows = Array.from({ length: 26 }, (_, index) => ({
      _id: `provisional-${index}`,
      productId: "product001",
      productSkuId: "sku001",
      status: "active",
      storeId: "storezzzz",
    }));
    const { ctx, tables } = createSkuMutationCtx({
      category: [
        {
          _id: "category-legacy",
          name: "Legacy import",
          slug: "legacy-import",
          storeId: "storezzzz",
        },
      ],
      inventoryImportProvisionalSku: provisionalRows,
      product: [
        {
          _id: "product001",
          availability: "live",
          categoryId: "category-legacy",
          name: "Quick And Go Bonding Glue",
          organizationId: "org0001",
          storeId: "storezzzz",
          subcategoryId: "subcategory-legacy",
        },
      ],
      productSku: [
        {
          _id: "sku001",
          productId: "product001",
          productName: "Quick And Go Bonding Glue",
          storeId: "storezzzz",
        },
      ],
      subcategory: [
        {
          _id: "subcategory-legacy",
          categoryId: "category-legacy",
          name: "872",
          slug: "872",
          storeId: "storezzzz",
        },
      ],
    });

    await expect(
      getHandler(update)(ctx, {
        id: "product001" as Id<"product">,
        name: "Quick & Go Bonding Glue",
      }),
    ).rejects.toThrow(
      "Catalog setup required. Assign an Athena category and subcategory before saving.",
    );

    expect(tables.product.get("product001")).toMatchObject({
      name: "Quick And Go Bonding Glue",
    });
    expect(tables.productSku.get("sku001")).toMatchObject({
      productName: "Quick And Go Bonding Glue",
    });
  });

  it("refreshes catalog summary after batch SKU price updates", async () => {
    const { ctx, tables } = createSkuMutationCtx({
      product: [
        {
          _id: "product001",
          availability: "live",
          storeId: "storezzzz",
        },
      ],
      productSku: [
        {
          _id: "productSku001",
          images: ["sku.jpg"],
          inventoryCount: 3,
          price: 0,
          productId: "product001",
          quantityAvailable: 3,
          sku: "SKU-1",
          storeId: "storezzzz",
        },
      ],
    });

    await getHandler(batchUpdateSkuPrices)(ctx, {
      updates: [
        {
          id: "productSku001" as Id<"productSku">,
          netPrice: 900,
          price: 1000,
        },
      ],
    });

    expect(Array.from(tables.catalogSummary.values())[0]).toMatchObject({
      missingInfoProductCount: 0,
      needsRefresh: false,
      outOfStockProductCount: 0,
      productCount: 1,
      storeId: "storezzzz",
    });
  });

  it("refreshes projections and revisions independently for every store in a price batch", async () => {
    const { ctx } = createSkuMutationCtx({
      product: [
        {
          _id: "product001",
          availability: "live",
          storeId: "storeaaaa",
        },
        {
          _id: "product002",
          availability: "live",
          storeId: "storebbbb",
        },
      ],
      productSku: [
        {
          _id: "productSku001",
          price: 0,
          productId: "product001",
          storeId: "storeaaaa",
        },
        {
          _id: "productSku002",
          price: 0,
          productId: "product002",
          storeId: "storebbbb",
        },
      ],
    });

    await getHandler(batchUpdateSkuPrices)(ctx, {
      updates: [
        {
          id: "productSku001" as Id<"productSku">,
          netPrice: 900,
          price: 1_000,
        },
        {
          id: "productSku002" as Id<"productSku">,
          netPrice: 1_800,
          price: 2_000,
        },
      ],
    });

    expect(mocks.upsertProductSkuSearchProjections).toHaveBeenCalledTimes(2);
    expect(mocks.upsertProductSkuSearchProjections).toHaveBeenCalledWith(
      ctx,
      ["productSku001"],
      "storeaaaa",
    );
    expect(mocks.upsertProductSkuSearchProjections).toHaveBeenCalledWith(
      ctx,
      ["productSku002"],
      "storebbbb",
    );
  });
});

describe("product catalog visibility", () => {
  it("keeps product mutation return contracts executable", () => {
    assertConformsToExportedReturns(getInventoryBySkuIds, [
      {
        _id: "productSku001",
        inventoryCount: 2,
        quantityAvailable: 1,
      },
    ]);
    assertConformsToExportedReturns(generateUniqueBarcode, {
      success: true,
      barcode: "123456789012",
    });
    assertConformsToExportedReturns(generateUniqueBarcode, {
      success: false,
      error: "Could not generate unique barcode after multiple attempts",
    });
  });

  it("excludes non-live products and hidden SKUs by default while preserving explicit archived queries", async () => {
    const seed = {
      product: [
        {
          _id: "product-live",
          availability: "live",
          categoryId: "category-1",
          isVisible: true,
          name: "Live Product",
          storeId: "storezzzz",
          subcategoryId: "subcategory-1",
        },
        {
          _id: "product-archived",
          availability: "archived",
          categoryId: "category-1",
          isVisible: false,
          name: "Archived Product",
          storeId: "storezzzz",
          subcategoryId: "subcategory-1",
        },
        {
          _id: "product-draft",
          availability: "draft",
          categoryId: "category-1",
          isVisible: false,
          name: "Draft Product",
          storeId: "storezzzz",
          subcategoryId: "subcategory-1",
        },
        {
          _id: "product-hidden-sku",
          availability: "live",
          categoryId: "category-1",
          isVisible: true,
          name: "Hidden SKU Product",
          storeId: "storezzzz",
          subcategoryId: "subcategory-1",
        },
      ],
      productSku: [
        {
          _id: "sku-live",
          images: ["live.jpg"],
          inventoryCount: 1,
          price: 1000,
          productId: "product-live",
          quantityAvailable: 1,
          storeId: "storezzzz",
        },
        {
          _id: "sku-archived",
          images: ["archived.jpg"],
          inventoryCount: 1,
          isVisible: false,
          price: 1000,
          productId: "product-archived",
          quantityAvailable: 1,
          storeId: "storezzzz",
        },
        {
          _id: "sku-draft",
          images: ["draft.jpg"],
          inventoryCount: 1,
          isVisible: false,
          price: 1000,
          productId: "product-draft",
          quantityAvailable: 1,
          storeId: "storezzzz",
        },
        {
          _id: "sku-hidden",
          images: ["hidden.jpg"],
          inventoryCount: 1,
          isVisible: false,
          price: 1000,
          productId: "product-hidden-sku",
          quantityAvailable: 1,
          storeId: "storezzzz",
        },
      ],
    };

    const activeCtx = createProductsQueryCtx(seed).ctx;
    const defaultProducts = await getHandler(getAll)(activeCtx, {
      storeId: "storezzzz" as Id<"store">,
    });

    expect(defaultProducts.map((product: Row) => product._id)).toEqual([
      "product-live",
    ]);

    const archivedCtx = createProductsQueryCtx(seed).ctx;
    const archivedProducts = await getHandler(getAll)(archivedCtx, {
      storeId: "storezzzz" as Id<"store">,
      availability: "archived",
    });

    expect(archivedProducts.map((product: Row) => product._id)).toEqual([
      "product-archived",
    ]);
    expect(archivedProducts[0].skus).toEqual([
      expect.objectContaining({
        _id: "sku-archived",
      }),
    ]);

    const draftHiddenCtx = createProductsQueryCtx(seed).ctx;
    const draftHiddenProducts = await getHandler(getAll)(draftHiddenCtx, {
      storeId: "storezzzz" as Id<"store">,
      availability: "draft",
      isVisible: false,
    });

    expect(draftHiddenProducts).toEqual([
      expect.objectContaining({
        _id: "product-draft",
        skus: [
          expect.objectContaining({
            _id: "sku-draft",
          }),
        ],
      }),
    ]);
  });

  it("returns unarchived POS pending checkout products for catalog operations", async () => {
    const { ctx } = createProductsQueryCtx({
      category: [
        {
          _id: "category-pending",
          name: "POS pending checkout",
          slug: "pos-pending-checkout",
          storeId: "storezzzz",
        },
        {
          _id: "category-hair",
          name: "Hair",
          slug: "hair",
          storeId: "storezzzz",
        },
      ],
      product: [
        {
          _id: "product-pending-draft",
          availability: "draft",
          categoryId: "category-pending",
          isVisible: false,
          name: "Pending draft",
          storeId: "storezzzz",
          subcategoryId: "subcategory-1",
        },
        {
          _id: "product-pending-live",
          availability: "live",
          categoryId: "category-pending",
          isVisible: true,
          name: "Pending live",
          storeId: "storezzzz",
          subcategoryId: "subcategory-1",
        },
        {
          _id: "product-pending-archived",
          availability: "archived",
          categoryId: "category-pending",
          isVisible: false,
          name: "Pending archived",
          storeId: "storezzzz",
          subcategoryId: "subcategory-1",
        },
        {
          _id: "product-other-category",
          availability: "draft",
          categoryId: "category-hair",
          isVisible: false,
          name: "Other category draft",
          storeId: "storezzzz",
          subcategoryId: "subcategory-1",
        },
      ],
      productSku: [
        {
          _id: "sku-pending-draft",
          images: [],
          inventoryCount: 0,
          isVisible: false,
          price: 900,
          productId: "product-pending-draft",
          quantityAvailable: 0,
          storeId: "storezzzz",
        },
        {
          _id: "sku-pending-live",
          images: [],
          inventoryCount: 0,
          isVisible: true,
          price: 900,
          productId: "product-pending-live",
          quantityAvailable: 0,
          storeId: "storezzzz",
        },
        {
          _id: "sku-pending-archived",
          images: [],
          inventoryCount: 0,
          isVisible: false,
          price: 900,
          productId: "product-pending-archived",
          quantityAvailable: 0,
          storeId: "storezzzz",
        },
        {
          _id: "sku-other-category",
          images: [],
          inventoryCount: 0,
          isVisible: false,
          price: 900,
          productId: "product-other-category",
          quantityAvailable: 0,
          storeId: "storezzzz",
        },
      ],
    });

    const products = await getHandler(getAll)(ctx, {
      storeId: "storezzzz" as Id<"store">,
      category: ["pos-pending-checkout"],
      availability: "unarchived",
      filters: {
        isPriceZero: true,
      },
    });

    expect(products.map((product: Row) => product._id)).toEqual([
      "product-pending-draft",
      "product-pending-live",
    ]);
    expect(products.flatMap((product: Row) => product.skus)).toEqual([
      expect.objectContaining({
        _id: "sku-pending-draft",
      }),
      expect.objectContaining({
        _id: "sku-pending-live",
      }),
    ]);
  });

  it("returns store catalog summary counts without returning product payloads", async () => {
    const { ctx } = createProductsQueryCtx({
      category: [
        {
          _id: "category-1",
          name: "Hair",
          slug: "hair",
          storeId: "storezzzz",
        },
        {
          _id: "category-2",
          name: "Books",
          slug: "books",
          storeId: "storezzzz",
        },
        {
          _id: "category-other-store",
          name: "Other store",
          slug: "other-store",
          storeId: "store-other",
        },
      ],
      product: [
        {
          _id: "product-live-stocked",
          availability: "live",
          categoryId: "category-1",
          isVisible: true,
          name: "Stocked",
          storeId: "storezzzz",
          subcategoryId: "subcategory-1",
        },
        {
          _id: "product-live-out",
          availability: "live",
          categoryId: "category-1",
          isVisible: true,
          name: "Out",
          storeId: "storezzzz",
          subcategoryId: "subcategory-1",
        },
        {
          _id: "product-live-missing-info",
          availability: "live",
          categoryId: "category-1",
          isVisible: true,
          name: "Missing",
          storeId: "storezzzz",
          subcategoryId: "subcategory-1",
        },
        {
          _id: "product-hidden",
          availability: "live",
          categoryId: "category-1",
          isVisible: false,
          name: "Hidden",
          storeId: "storezzzz",
          subcategoryId: "subcategory-1",
        },
        {
          _id: "product-archived",
          availability: "archived",
          categoryId: "category-1",
          isVisible: false,
          name: "Archived",
          storeId: "storezzzz",
          subcategoryId: "subcategory-1",
        },
        {
          _id: "product-other-store",
          availability: "live",
          categoryId: "category-1",
          isVisible: true,
          name: "Other store",
          storeId: "store-other",
          subcategoryId: "subcategory-1",
        },
      ],
      productSku: [
        {
          _id: "sku-stocked",
          images: ["stocked.jpg"],
          inventoryCount: 3,
          price: 1000,
          productId: "product-live-stocked",
          quantityAvailable: 3,
          storeId: "storezzzz",
        },
        {
          _id: "sku-out",
          images: ["out.jpg"],
          inventoryCount: 0,
          price: 1000,
          productId: "product-live-out",
          quantityAvailable: 0,
          storeId: "storezzzz",
        },
        {
          _id: "sku-missing-image",
          images: [],
          inventoryCount: 2,
          price: 1000,
          productId: "product-live-missing-info",
          quantityAvailable: 2,
          storeId: "storezzzz",
        },
        {
          _id: "sku-zero-price-same-product",
          images: ["missing-price.jpg"],
          inventoryCount: 1,
          price: 0,
          productId: "product-live-missing-info",
          quantityAvailable: 1,
          storeId: "storezzzz",
        },
        {
          _id: "sku-hidden-parent",
          images: [],
          inventoryCount: 0,
          price: 0,
          productId: "product-hidden",
          quantityAvailable: 0,
          storeId: "storezzzz",
        },
        {
          _id: "sku-archived-parent",
          images: [],
          inventoryCount: 0,
          price: 0,
          productId: "product-archived",
          quantityAvailable: 0,
          storeId: "storezzzz",
        },
        {
          _id: "sku-other-store",
          images: [],
          inventoryCount: 0,
          price: 0,
          productId: "product-other-store",
          quantityAvailable: 0,
          storeId: "store-other",
        },
      ],
    });

    await expect(
      getHandler(getCatalogSummary)(ctx, {
        storeId: "storezzzz" as Id<"store">,
      }),
    ).resolves.toMatchObject({
      categoryCount: 0,
      missingInfoProductCount: 0,
      needsRefresh: true,
      outOfStockProductCount: 0,
      productCount: 0,
      storeId: "storezzzz",
      updatedAt: 0,
    });
    expect(getTestScheduler(ctx).runAfter).not.toHaveBeenCalled();

    mocks.requireProductSkuSearchReadAccess.mockResolvedValue({});
    const repairedSummary = await getHandler(repairCatalogSummary)(ctx, {
      storeId: "storezzzz" as Id<"store">,
    });

    expect(repairedSummary).toMatchObject({
      categoryCount: 2,
      missingInfoProductCount: 2,
      needsRefresh: false,
      outOfStockProductCount: 2,
      productCount: 4,
    });
    expect(mocks.requireProductSkuSearchReadAccess).toHaveBeenCalledWith(
      ctx,
      "storezzzz",
      "You do not have access to repair catalog summaries.",
    );
    await expect(
      getHandler(getCatalogSummary)(ctx, {
        storeId: "storezzzz" as Id<"store">,
      }),
    ).resolves.toMatchObject({
      categoryCount: 2,
      missingInfoProductCount: 2,
      needsRefresh: false,
      outOfStockProductCount: 2,
      productCount: 4,
      storeId: "storezzzz",
    });
  });

  it("returns stale catalog summary rows until the client requests repair", async () => {
    const { ctx } = createProductsQueryCtx({
      catalogSummary: [
        {
          _id: "catalog-summary-1",
          categoryCount: 12,
          missingInfoProductCount: 1,
          needsRefresh: true,
          outOfStockProductCount: 4,
          productCount: 17,
          storeId: "storezzzz",
          updatedAt: 123,
        },
      ],
    });

    await expect(
      getHandler(getCatalogSummary)(ctx, {
        storeId: "storezzzz" as Id<"store">,
      }),
    ).resolves.toMatchObject({
      categoryCount: 12,
      missingInfoProductCount: 1,
      needsRefresh: true,
      outOfStockProductCount: 4,
      productCount: 17,
      storeId: "storezzzz",
      updatedAt: 123,
    });
    expect(getTestScheduler(ctx).runAfter).not.toHaveBeenCalled();
  });
});

describe("product detail availability", () => {
  it("returns hold-adjusted sellable SKU availability for product detail queries", async () => {
    const future = Date.now() + 60_000;
    const past = Date.now() - 60_000;
    const { ctx } = createProductsQueryCtx({
      category: [
        {
          _id: "category-1",
          name: "Hair",
          slug: "hair",
        },
      ],
      subcategory: [
        {
          _id: "subcategory-1",
          name: "Frontals",
          slug: "frontals",
        },
      ],
      product: [
        {
          _id: "product-1",
          availability: "live",
          categoryId: "category-1",
          isVisible: true,
          name: "Agya",
          slug: "agya",
          storeId: "storezzzz",
          subcategoryId: "subcategory-1",
        },
      ],
      productSku: [
        {
          _id: "sku-1",
          images: [],
          inventoryCount: 10,
          isVisible: true,
          price: 7500,
          productId: "product-1",
          quantityAvailable: 8,
          sku: "6N2Y-FRF-SQF",
          storeId: "storezzzz",
        },
      ],
      inventoryHold: [
        {
          _id: "hold-active",
          expiresAt: future,
          productSkuId: "sku-1",
          quantity: 3,
          sourceSessionId: "pos-session-1",
          status: "active",
          storeId: "storezzzz",
        },
        {
          _id: "hold-expired",
          expiresAt: past,
          productSkuId: "sku-1",
          quantity: 2,
          sourceSessionId: "pos-session-2",
          status: "active",
          storeId: "storezzzz",
        },
        {
          _id: "hold-released",
          expiresAt: future,
          productSkuId: "sku-1",
          quantity: 1,
          sourceSessionId: "pos-session-3",
          status: "released",
          storeId: "storezzzz",
        },
      ],
    });

    const product = await getHandler(getByIdOrSlug)(ctx, {
      identifier: "product-1" as Id<"product">,
      storeId: "storezzzz" as Id<"store">,
    });

    expect(product.skus[0]).toMatchObject({
      durableQuantityAvailable: 8,
      inventoryCount: 10,
      quantityAvailable: 5,
      reservedQuantity: 3,
    });
  });

  it("returns archived product details only when explicitly requested", async () => {
    const seed = {
      product: [
        {
          _id: "product-archived",
          availability: "archived",
          categoryId: "category-1",
          inventoryCount: 4,
          name: "Archived product",
          storeId: "storezzzz",
          subcategoryId: "subcategory-1",
        },
      ],
      productSku: [
        {
          _id: "sku-archived",
          images: [],
          inventoryCount: 4,
          price: 1000,
          productId: "product-archived",
          quantityAvailable: 4,
          sku: "ARCH-01",
          storeId: "storezzzz",
        },
      ],
    };

    const defaultCtx = createProductsQueryCtx(seed).ctx;
    await expect(
      getHandler(getByIdOrSlug)(defaultCtx, {
        identifier: "product-archived" as Id<"product">,
        storeId: "storezzzz" as Id<"store">,
      }),
    ).resolves.toBeNull();

    const includeArchivedCtx = createProductsQueryCtx(seed).ctx;
    const archivedProduct = await getHandler(getByIdOrSlug)(
      includeArchivedCtx,
      {
        identifier: "product-archived" as Id<"product">,
        storeId: "storezzzz" as Id<"store">,
        filters: {
          includeArchived: true,
          isVisible: false,
        },
      },
    );

    expect(archivedProduct).toMatchObject({
      _id: "product-archived",
      availability: "archived",
      name: "Archived product",
      skus: [
        {
          _id: "sku-archived",
          sku: "ARCH-01",
        },
      ],
    });
  });
});

describe("product SKU visibility backfill", () => {
  it("patches only undefined SKU visibility from the parent product visibility", async () => {
    const { ctx, tables } = createSkuMutationCtx({
      product: [
        {
          _id: "product-visible",
          isVisible: true,
        },
        {
          _id: "product-hidden",
          isVisible: false,
        },
        {
          _id: "product-unknown",
        },
      ],
      productSku: [
        {
          _id: "sku-visible-parent",
          productId: "product-visible",
        },
        {
          _id: "sku-hidden-parent",
          productId: "product-hidden",
        },
        {
          _id: "sku-already-visible",
          isVisible: true,
          productId: "product-hidden",
        },
        {
          _id: "sku-missing-product",
          productId: "product-missing",
        },
        {
          _id: "sku-parent-without-visibility",
          productId: "product-unknown",
        },
      ],
    });

    const result = await getHandler(backfillUndefinedSkuVisibilityFromProducts)(
      ctx,
      {},
    );

    expect(result).toEqual({
      success: true,
      scannedCount: 5,
      updatedCount: 2,
      skippedMissingProductCount: 1,
      skippedParentWithoutVisibilityCount: 1,
    });
    expect(tables.productSku.get("sku-visible-parent")).toMatchObject({
      isVisible: true,
    });
    expect(tables.productSku.get("sku-hidden-parent")).toMatchObject({
      isVisible: false,
    });
    expect(tables.productSku.get("sku-already-visible")).toMatchObject({
      isVisible: true,
    });
    expect(tables.productSku.get("sku-missing-product")).not.toHaveProperty(
      "isVisible",
    );
    expect(
      tables.productSku.get("sku-parent-without-visibility"),
    ).not.toHaveProperty("isVisible");
  });
});
