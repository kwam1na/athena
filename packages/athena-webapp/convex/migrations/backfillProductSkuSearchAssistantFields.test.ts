import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import {
  backfillProductSkuSearchAssistantFieldsWithCtx,
  countProductSkuSearchAssistantFieldsWithCtx,
} from "./backfillProductSkuSearchAssistantFields";

const mockedCatalogRevision = vi.hoisted(() => ({
  advance: vi.fn(async () => 0),
}));

vi.mock("../pos/application/sync/registerCatalogRevision", () => ({
  advanceRegisterCatalogRevision: mockedCatalogRevision.advance,
}));

type TableName =
  | "category"
  | "color"
  | "product"
  | "productSku"
  | "productSkuSearch"
  | "store"
  | "subcategory";
type Row = Record<string, unknown> & { _id: string; _creationTime?: number };

const storeId = "store-1" as Id<"store">;
const categoryId = "category-1" as Id<"category">;
const subcategoryId = "subcategory-1" as Id<"subcategory">;
const productId = "product-1" as Id<"product">;

/**
 * A small in-memory Convex database: the backfill calls the real projection
 * writer, so the harness has to serve every table that writer reads.
 */
function createCtx(seed: Partial<Record<TableName, Row[]>>) {
  const tables = {
    category: new Map((seed.category ?? []).map((row) => [row._id, row])),
    color: new Map((seed.color ?? []).map((row) => [row._id, row])),
    product: new Map((seed.product ?? []).map((row) => [row._id, row])),
    productSku: new Map((seed.productSku ?? []).map((row) => [row._id, row])),
    productSkuSearch: new Map(
      (seed.productSkuSearch ?? []).map((row) => [row._id, row]),
    ),
    store: new Map((seed.store ?? []).map((row) => [row._id, row])),
    subcategory: new Map((seed.subcategory ?? []).map((row) => [row._id, row])),
  } as Record<TableName, Map<string, Row>>;
  let inserted = 0;

  function createQuery(rows: Row[]) {
    return {
      collect: async () => rows,
      first: async () => rows[0] ?? null,
      take: async (count: number) => rows.slice(0, count),
      paginate: async ({
        cursor,
        numItems,
      }: {
        cursor: string | null;
        numItems: number;
      }) => {
        const start = cursor ? Number(cursor) : 0;
        const page = rows.slice(start, start + numItems);
        const next = start + page.length;
        return {
          continueCursor: next >= rows.length ? null : String(next),
          isDone: next >= rows.length,
          page,
        };
      },
    };
  }

  const insert = vi.fn(
    async (table: TableName, value: Record<string, unknown>) => {
      inserted += 1;
      const id = `${table}-inserted-${inserted}`;
      tables[table].set(id, { ...value, _creationTime: inserted, _id: id });
      return id;
    },
  );
  const patch = vi.fn(
    async (table: TableName, id: string, value: Record<string, unknown>) => {
      const existing = tables[table].get(id);
      if (!existing) throw new Error(`Missing ${table}: ${id}`);
      tables[table].set(id, { ...existing, ...value });
    },
  );

  const db = {
    async get(table: TableName, id: string) {
      return tables[table].get(id) ?? null;
    },
    insert,
    patch,
    async delete(table: TableName, id: string) {
      tables[table].delete(id);
    },
    query(table: TableName) {
      const allRows = Array.from(tables[table].values());
      return {
        ...createQuery(allRows),
        withIndex(
          _index: string,
          applyIndex: (queryBuilder: {
            eq: (field: string, value: unknown) => unknown;
          }) => unknown,
        ) {
          const filters: Array<{ field: string; value: unknown }> = [];
          const queryBuilder = {
            eq(field: string, value: unknown) {
              filters.push({ field, value });
              return queryBuilder;
            },
          };
          applyIndex(queryBuilder);
          return createQuery(
            allRows.filter((row) =>
              filters.every((filter) => row[filter.field] === filter.value),
            ),
          );
        },
      };
    },
  };

  return {
    ctx: { db } as unknown as MutationCtx & QueryCtx,
    insert,
    patch,
    tables,
  };
}

function seedStore(skuCount: number) {
  return {
    category: [
      {
        _id: categoryId,
        name: "Wigs",
        showOnStorefront: true,
        slug: "wigs",
        storeId,
      },
    ],
    product: [
      {
        _id: productId,
        areProcessingFeesAbsorbed: true,
        availability: "live",
        categoryId,
        currency: "GHS",
        description: "Full product description",
        inventoryCount: 10,
        isVisible: true,
        name: "Body wave bundle",
        quantityAvailable: 10,
        slug: "body-wave-bundle",
        storeId,
        subcategoryId,
      },
    ],
    productSku: Array.from({ length: skuCount }, (_value, index) => ({
      _id: `sku-${index + 1}`,
      _creationTime: index + 1,
      barcode: `BAR-${index + 1}`,
      images: [],
      inventoryCount: 4,
      isVisible: true,
      price: 100,
      productId,
      productName: "Body wave bundle",
      quantityAvailable: 4,
      sku: `BW-${index + 1}`,
      storeId,
    })),
    store: [{ _id: storeId, organizationId: "org-1" }],
    subcategory: [
      {
        _id: subcategoryId,
        categoryId,
        name: "Bundles",
        slug: "bundles",
        storeId,
      },
    ],
  };
}

async function drainBackfill(
  ctx: MutationCtx,
  args: { dryRun: boolean; limit: number },
) {
  let cursor: string | null = null;
  const totals = {
    missingProjectionCount: 0,
    pendingCount: 0,
    processedCount: 0,
    unchangedCount: 0,
    upsertedCount: 0,
  };
  let pages = 0;

  while (true) {
    const result = await backfillProductSkuSearchAssistantFieldsWithCtx(ctx, {
      cursor,
      dryRun: args.dryRun,
      limit: args.limit,
      storeId,
    });
    pages += 1;
    totals.missingProjectionCount += result.missingProjectionCount;
    totals.pendingCount += result.pendingCount;
    totals.processedCount += result.processedCount;
    totals.unchangedCount += result.unchangedCount;
    totals.upsertedCount += result.upsertedCount;
    if (result.isDone) return { pages, totals };
    cursor = result.continueCursor;
  }
}

beforeEach(() => {
  mockedCatalogRevision.advance.mockClear();
});

describe("product SKU search assistant field backfill", () => {
  it("paginates the store's SKUs and creates missing projection rows", async () => {
    const { ctx, tables } = createCtx(seedStore(5));

    const { pages, totals } = await drainBackfill(ctx, {
      dryRun: false,
      limit: 2,
    });

    expect(pages).toBe(3);
    expect(totals).toEqual({
      missingProjectionCount: 0,
      pendingCount: 0,
      processedCount: 5,
      unchangedCount: 0,
      upsertedCount: 5,
    });
    expect(tables.productSkuSearch.size).toBe(5);
    for (const row of tables.productSkuSearch.values()) {
      expect(typeof row.assistantSearchText).toBe("string");
      expect(row.assistantVisible).toBe(true);
    }
  });

  it("writes nothing on a dry run and reports the pending rows", async () => {
    const { ctx, insert, patch, tables } = createCtx(seedStore(3));

    const { totals } = await drainBackfill(ctx, { dryRun: true, limit: 2 });

    expect(totals).toEqual({
      missingProjectionCount: 3,
      pendingCount: 3,
      processedCount: 3,
      unchangedCount: 0,
      upsertedCount: 0,
    });
    expect(insert).not.toHaveBeenCalled();
    expect(patch).not.toHaveBeenCalled();
    expect(tables.productSkuSearch.size).toBe(0);
  });

  it("defaults to a dry run when dryRun is omitted", async () => {
    const { ctx, insert } = createCtx(seedStore(1));

    const result = await backfillProductSkuSearchAssistantFieldsWithCtx(ctx, {
      storeId,
    });

    expect(result.dryRun).toBe(true);
    expect(result.pendingCount).toBe(1);
    expect(insert).not.toHaveBeenCalled();
  });

  it("is idempotent: a second apply reports every row unchanged", async () => {
    const { ctx, patch } = createCtx(seedStore(3));

    await drainBackfill(ctx, { dryRun: false, limit: 3 });
    patch.mockClear();

    const { totals } = await drainBackfill(ctx, { dryRun: false, limit: 3 });

    expect(totals).toMatchObject({
      processedCount: 3,
      unchangedCount: 3,
      upsertedCount: 0,
    });
    expect(patch).not.toHaveBeenCalled();
  });

  it("refreshes a projection row written before the assistant fields", async () => {
    const { ctx, tables } = createCtx(seedStore(3));

    await drainBackfill(ctx, { dryRun: false, limit: 3 });

    // The migration's actual production input: a projection row that exists
    // and is otherwise current, but predates the two assistant keys.
    const legacy = [...tables.productSkuSearch.values()][0];
    delete legacy.assistantSearchText;
    delete legacy.assistantVisible;

    const preview = await drainBackfill(ctx, { dryRun: true, limit: 3 });
    expect(preview.totals).toMatchObject({
      missingProjectionCount: 0,
      pendingCount: 1,
    });

    const applied = await drainBackfill(ctx, { dryRun: false, limit: 3 });
    expect(applied.totals).toMatchObject({
      unchangedCount: 2,
      upsertedCount: 1,
    });
    const refreshed = tables.productSkuSearch.get(legacy._id);
    expect(refreshed?.assistantSearchText).toBeDefined();
    expect(refreshed?.assistantVisible).toBe(true);

    // The coverage gate the operator reads before minting is closed.
    const after = await drainBackfill(ctx, { dryRun: true, limit: 3 });
    expect(after.totals.pendingCount).toBe(0);
  });

  it("leaves the POS register catalog revision untouched", async () => {
    const { ctx } = createCtx(seedStore(3));

    await drainBackfill(ctx, { dryRun: false, limit: 2 });

    expect(mockedCatalogRevision.advance).not.toHaveBeenCalled();
  });

  it("counts the projection rows carrying the assistant field against the SKUs", async () => {
    const { ctx } = createCtx(seedStore(4));

    await expect(
      countProductSkuSearchAssistantFieldsWithCtx(ctx, { storeId }),
    ).resolves.toEqual({
      isComplete: false,
      productSkuCount: 4,
      projectionCount: 0,
      withAssistantSearchTextCount: 0,
    });

    await drainBackfill(ctx, { dryRun: false, limit: 2 });

    await expect(
      countProductSkuSearchAssistantFieldsWithCtx(ctx, { storeId }),
    ).resolves.toEqual({
      isComplete: true,
      productSkuCount: 4,
      projectionCount: 4,
      withAssistantSearchTextCount: 4,
    });
  });
});
