import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { assertConformsToExportedReturns } from "../lib/returnValidatorContract";
import {
  repairProductSkuSearchPage,
  removeStaleProductSkuSearchPage,
  searchProductSkus,
  upsertProductSkuSearchProjection,
} from "./skuSearch";

const mockedAuthServer = vi.hoisted(() => ({
  getAuthUserId: vi.fn(),
}));

vi.mock("@convex-dev/auth/server", () => ({
  getAuthUserId: mockedAuthServer.getAuthUserId,
}));

type TableName =
  | "athenaUser"
  | "category"
  | "color"
  | "organizationMember"
  | "product"
  | "productSku"
  | "productSkuSearch"
  | "store"
  | "subcategory"
  | "users";
type Row = Record<string, unknown> & { _id: string; _creationTime?: number };
type QueryFilter = {
  field: string;
  op: "eq";
  value: unknown;
};

function getHandler(definition: unknown) {
  return (definition as { _handler: Function })._handler;
}

function createCtx(seed: Partial<Record<TableName, Row[]>>) {
  const tables: Record<TableName, Map<string, Row>> = {
    athenaUser: new Map((seed.athenaUser ?? []).map((row) => [row._id, row])),
    category: new Map((seed.category ?? []).map((row) => [row._id, row])),
    color: new Map((seed.color ?? []).map((row) => [row._id, row])),
    organizationMember: new Map(
      (seed.organizationMember ?? []).map((row) => [row._id, row]),
    ),
    product: new Map((seed.product ?? []).map((row) => [row._id, row])),
    productSku: new Map((seed.productSku ?? []).map((row) => [row._id, row])),
    productSkuSearch: new Map(
      (seed.productSkuSearch ?? []).map((row) => [row._id, row]),
    ),
    store: new Map((seed.store ?? []).map((row) => [row._id, row])),
    subcategory: new Map(
      (seed.subcategory ?? []).map((row) => [row._id, row]),
    ),
    users: new Map((seed.users ?? []).map((row) => [row._id, row])),
  };
  const counters: Record<TableName, number> = {
    athenaUser: tables.athenaUser.size,
    category: tables.category.size,
    color: tables.color.size,
    organizationMember: tables.organizationMember.size,
    product: tables.product.size,
    productSku: tables.productSku.size,
    productSkuSearch: tables.productSkuSearch.size,
    store: tables.store.size,
    subcategory: tables.subcategory.size,
    users: tables.users.size,
  };

  function matchesFilters(row: Row, filters: QueryFilter[]) {
    return filters.every((filter) => row[filter.field] === filter.value);
  }

  function createQuery(table: TableName, rows: Row[]) {
    return {
      collect: async () => rows,
      first: async () => rows[0] ?? null,
      take: async (count: number) => rows.slice(0, count),
      paginate: async ({ cursor, numItems }: { cursor: string | null; numItems: number }) => {
        const start = cursor ? Number(cursor) : 0;
        const page = rows.slice(start, start + numItems);
        const next = start + page.length;

        return {
          continueCursor: next >= rows.length ? null : String(next),
          isDone: next >= rows.length,
          page,
        };
      },
      filter(applyFilter?: (queryBuilder: unknown) => (row: Row) => boolean) {
        if (!applyFilter) return createQuery(table, rows);
        const predicate = applyFilter({
          and: (...predicates: Array<(row: Row) => boolean>) => (row: Row) =>
            predicates.every((predicate) => predicate(row)),
          field: (field: string) => field,
          eq: (field: string, value: unknown) => (row: Row) =>
            row[field] === value,
        });
        return createQuery(table, rows.filter(predicate));
      },
    };
  }

  const db = {
    normalizeId(table: TableName, id: string) {
      return tables[table].has(id) ? id : null;
    },
    async get(tableOrId: TableName | string, maybeId?: string) {
      if (maybeId === undefined) {
        for (const table of Object.values(tables)) {
          const row = table.get(tableOrId);
          if (row) return row;
        }
        return null;
      }

      return tables[tableOrId as TableName].get(maybeId) ?? null;
    },
    async insert(table: TableName, value: Record<string, unknown>) {
      counters[table] += 1;
      const id = `${table}-${counters[table]}`;
      tables[table].set(id, {
        ...value,
        _creationTime:
          typeof value._creationTime === "number"
            ? value._creationTime
            : counters[table],
        _id: id,
      });
      return id;
    },
    async patch(tableOrId: TableName | string, idOrPatch: string | Record<string, unknown>, maybePatch?: Record<string, unknown>) {
      const table = maybePatch ? (tableOrId as TableName) : findTableForId(String(tableOrId));
      const id = maybePatch ? String(idOrPatch) : String(tableOrId);
      const patch = maybePatch ?? (idOrPatch as Record<string, unknown>);
      const existing = tables[table].get(id);
      if (!existing) throw new Error(`Missing ${table}: ${id}`);
      tables[table].set(id, { ...existing, ...patch });
    },
    async delete(tableOrId: TableName | string, maybeId?: string) {
      if (maybeId === undefined) {
        tables[findTableForId(tableOrId)].delete(tableOrId);
        return;
      }
      tables[tableOrId as TableName].delete(maybeId);
    },
    query(table: TableName) {
      const allRows = Array.from(tables[table].values());
      return {
        ...createQuery(table, allRows),
        withIndex(
          _index: string,
          applyIndex: (queryBuilder: {
            eq: (field: string, value: unknown) => unknown;
          }) => unknown,
        ) {
          const filters: QueryFilter[] = [];
          const queryBuilder = {
            eq(field: string, value: unknown) {
              filters.push({ field, op: "eq", value });
              return queryBuilder;
            },
          };
          applyIndex(queryBuilder);
          return createQuery(
            table,
            allRows.filter((row) => matchesFilters(row, filters)),
          );
        },
        withSearchIndex(
          _index: string,
          applyIndex: (queryBuilder: {
            search: (field: string, value: string) => unknown;
            eq: (field: string, value: unknown) => unknown;
          }) => unknown,
        ) {
          let searchField = "";
          let searchValue = "";
          const filters: QueryFilter[] = [];
          const queryBuilder = {
            search(field: string, value: string) {
              searchField = field;
              searchValue = value.toLowerCase();
              return queryBuilder;
            },
            eq(field: string, value: unknown) {
              filters.push({ field, op: "eq", value });
              return queryBuilder;
            },
          };
          applyIndex(queryBuilder);
          const terms = searchValue.split(/\s+/).filter(Boolean);
          return createQuery(
            table,
            allRows.filter((row) => {
              const haystack = String(row[searchField] ?? "").toLowerCase();
              return (
                matchesFilters(row, filters) &&
                terms.every((term) => haystack.includes(term))
              );
            }),
          );
        },
      };
    },
  };

  function findTableForId(id: string): TableName {
    for (const [table, rows] of Object.entries(tables)) {
      if (rows.has(id)) return table as TableName;
    }
    throw new Error(`No table contains ${id}`);
  }

  return {
    ctx: { db } as unknown as QueryCtx & MutationCtx,
    tables,
  };
}

const storeId = "store-1" as Id<"store">;
const otherStoreId = "store-2" as Id<"store">;
const productId = "product-1" as Id<"product">;
const skuId = "sku-1" as Id<"productSku">;
const categoryId = "category-1" as Id<"category">;
const subcategoryId = "subcategory-1" as Id<"subcategory">;
const colorId = "color-1" as Id<"color">;
const organizationId = "org-1" as Id<"organization">;
const authUserId = "auth-user-1";
const athenaUserId = "athena-user-1" as Id<"athenaUser">;

beforeEach(() => {
  mockedAuthServer.getAuthUserId.mockResolvedValue(authUserId);
});

function baseSeed() {
  return {
    athenaUser: [
      {
        _id: athenaUserId,
        email: "operator@example.com",
      },
    ],
    category: [
      {
        _id: categoryId,
        name: "Wigs",
        slug: "wigs",
        storeId,
      },
    ],
    color: [
      {
        _id: colorId,
        hexCode: "#101010",
        name: "Natural black",
        storeId,
      },
    ],
    organizationMember: [
      {
        _id: "organization-member-1",
        organizationId,
        role: "full_admin",
        userId: athenaUserId,
      },
    ],
    product: [
      {
        _id: productId,
        availability: "archived",
        areProcessingFeesAbsorbed: true,
        categoryId,
        createdByUserId: "user-1",
        currency: "GHS",
        description: "Full product description",
        inventoryCount: 4,
        isVisible: false,
        name: "Body wave bundle",
        organizationId,
        quantityAvailable: 2,
        slug: "body-wave-bundle",
        storeId,
        subcategoryId,
      },
    ],
    productSku: [
      {
        _id: skuId,
        _creationTime: 123,
        attributes: {
          internalNote: { nested: "ignored" },
          texture: "Body wave",
        },
        barcode: "ABC-123",
        barcodeAutoGenerated: false,
        color: colorId,
        images: ["image.webp"],
        inventoryCount: 4,
        isVisible: false,
        length: 18,
        netPrice: 80,
        price: 100,
        productId,
        productName: "Old cached name",
        quantityAvailable: 2,
        size: "M",
        sku: "BW-18",
        storeId,
        unitCost: 45,
        weight: "120g",
      },
    ],
    store: [
      {
        _id: storeId,
        organizationId,
      },
      {
        _id: otherStoreId,
        organizationId: "org-2",
      },
    ],
    subcategory: [
      {
        _id: subcategoryId,
        categoryId,
        description: "Bundle description",
        name: "Bundles",
        slug: "bundles",
        storeId,
      },
    ],
    users: [
      {
        _id: authUserId,
        email: "operator@example.com",
      },
    ],
  };
}

describe("SKU search foundation", () => {
  it("keeps changed public return contracts executable", () => {
    assertConformsToExportedReturns(searchProductSkus, {
      candidateOverflow: false,
      limit: 20,
      results: [],
      truncated: false,
    });
    assertConformsToExportedReturns(repairProductSkuSearchPage, {
      continueCursor: null,
      duplicatesCollapsed: 0,
      isDone: true,
      scanned: 0,
      sourceOrphans: 0,
      staleOrphansRemoved: 0,
      unchanged: 0,
      upserted: 0,
    });
    assertConformsToExportedReturns(removeStaleProductSkuSearchPage, {
      continueCursor: null,
      duplicatesCollapsed: 0,
      isDone: true,
      scanned: 0,
      sourceOrphans: 0,
      staleOrphansRemoved: 0,
      unchanged: 0,
      upserted: 0,
    });
  });

  it("requires an authenticated operator before searching store SKUs", async () => {
    const { ctx } = createCtx(baseSeed());

    mockedAuthServer.getAuthUserId.mockResolvedValue(null);

    await expect(
      getHandler(searchProductSkus)(ctx, {
        query: "ABC-123",
        storeId,
      }),
    ).rejects.toThrow("Sign in again to continue.");
  });

  it("rejects SKU search for authenticated users outside the store organization", async () => {
    const seed = baseSeed();
    seed.organizationMember[0].organizationId = "other-org" as Id<"organization">;
    const { ctx } = createCtx(seed);

    await expect(
      getHandler(searchProductSkus)(ctx, {
        query: "ABC-123",
        storeId,
      }),
    ).rejects.toThrow("You do not have access to search product SKUs.");
  });

  it("allows POS-only organization members to search store SKUs", async () => {
    const seed = baseSeed();
    seed.organizationMember[0].role = "pos_only";
    const { ctx } = createCtx(seed);
    await upsertProductSkuSearchProjection(ctx, skuId);

    const result = await getHandler(searchProductSkus)(ctx, {
      query: "ABC-123",
      storeId,
    });

    expect(result.results).toHaveLength(1);
    expect(result.results[0].productSkuId).toBe(skuId);
  });

  it("does not scan canonical product text when the search sidecar is empty", async () => {
    const { ctx } = createCtx(baseSeed());

    const result = await getHandler(searchProductSkus)(ctx, {
      query: "body wave",
      storeId,
    });

    expect(result).toMatchObject({
      candidateOverflow: false,
      results: [],
      truncated: false,
    });
  });

  it("uses indexed canonical SKU and barcode matches when the search sidecar is empty", async () => {
    const { ctx } = createCtx(baseSeed());

    const skuResult = await getHandler(searchProductSkus)(ctx, {
      query: "bw-18",
      storeId,
    });
    const barcodeResult = await getHandler(searchProductSkus)(ctx, {
      query: "ABC-123",
      storeId,
    });

    expect(skuResult.results).toHaveLength(1);
    expect(skuResult.results[0]).toMatchObject({
      match: {
        kind: "sku",
        matchedValue: "BW-18",
        rank: 1,
      },
      productSkuId: skuId,
    });
    expect(barcodeResult.results).toHaveLength(1);
    expect(barcodeResult.results[0]).toMatchObject({
      match: {
        kind: "barcode",
        matchedValue: "ABC-123",
        rank: 2,
      },
      productSkuId: skuId,
    });
  });

  it("requires an authenticated full admin before repairing or cleaning search projections", async () => {
    const { ctx } = createCtx(baseSeed());

    mockedAuthServer.getAuthUserId.mockResolvedValue(null);

    await expect(
      getHandler(repairProductSkuSearchPage)(ctx, {
        paginationOpts: { cursor: null, numItems: 10 },
        storeId,
      }),
    ).rejects.toThrow("Sign in again to continue.");
    await expect(
      getHandler(removeStaleProductSkuSearchPage)(ctx, {
        paginationOpts: { cursor: null, numItems: 10 },
        storeId,
      }),
    ).rejects.toThrow("Sign in again to continue.");
  });

  it("keeps projection repair and cleanup restricted to full admins", async () => {
    const seed = baseSeed();
    seed.organizationMember[0].role = "pos_only";
    const { ctx } = createCtx(seed);

    await expect(
      getHandler(repairProductSkuSearchPage)(ctx, {
        paginationOpts: { cursor: null, numItems: 10 },
        storeId,
      }),
    ).rejects.toThrow("You do not have access to repair product SKU search.");
    await expect(
      getHandler(removeStaleProductSkuSearchPage)(ctx, {
        paginationOpts: { cursor: null, numItems: 10 },
        storeId,
      }),
    ).rejects.toThrow("You do not have access to repair product SKU search.");
  });

  it("returns archived and hidden SKUs with the generic result contract", async () => {
    const { ctx } = createCtx(baseSeed());
    await upsertProductSkuSearchProjection(ctx, skuId);

    const result = await getHandler(searchProductSkus)(ctx, {
      query: "ABC-123",
      storeId,
    });

    expect(result.results).toHaveLength(1);
    expect(() =>
      assertConformsToExportedReturns(searchProductSkus, result),
    ).not.toThrow();
    expect(result.results[0]).toMatchObject({
      barcode: "ABC-123",
      category: {
        categoryId,
        description: null,
        id: categoryId,
        name: "Wigs",
        showOnStorefront: null,
        slug: "wigs",
      },
      categoryName: "Wigs",
      color: {
        hexCode: "#101010",
        id: colorId,
        name: "Natural black",
      },
      colorName: "Natural black",
      isVisible: false,
      match: {
        kind: "barcode",
        matchedValue: "ABC-123",
        rank: 2,
      },
      primaryImageUrl: "image.webp",
      product: {
        areProcessingFeesAbsorbed: true,
        availability: "archived",
        categoryId,
        currency: "GHS",
        description: "Full product description",
        id: productId,
        inventoryCount: 4,
        isVisible: false,
        name: "Body wave bundle",
        quantityAvailable: 2,
        slug: "body-wave-bundle",
        subcategoryId,
      },
      productAvailability: "archived",
      productIsVisible: false,
      productName: "Body wave bundle",
      productSkuCreationTime: 123,
      productSkuId: skuId,
      quantityAvailable: 2,
      sku: "BW-18",
      skuIsVisible: false,
      subcategory: {
        categoryId,
        description: "Bundle description",
        id: subcategoryId,
        name: "Bundles",
        subcategoryId,
        slug: "bundles",
      },
      subcategoryName: "Bundles",
    });
    expect(result.results[0].attributes).toEqual({ texture: "Body wave" });
  });

  it("ranks exact matches first and dedupes exact/text overlap", async () => {
    const seed = baseSeed();
    seed.productSku.push({
      ...seed.productSku[0],
      _id: "sku-2" as Id<"productSku">,
      barcode: "XYZ-999",
      sku: "BW-18-ALT",
    });
    const { ctx } = createCtx(seed);
    await upsertProductSkuSearchProjection(ctx, skuId);
    await upsertProductSkuSearchProjection(ctx, "sku-2" as Id<"productSku">);

    const result = await getHandler(searchProductSkus)(ctx, {
      limit: 1,
      query: "BW-18",
      storeId,
    });

    expect(result.results.map((row: { productSkuId: string }) => row.productSkuId)).toEqual([
      skuId,
    ]);
    expect(result.truncated).toBe(true);
  });

  it("finds a canonical productSku id before sidecar backfill", async () => {
    const { ctx } = createCtx(baseSeed());

    const result = await getHandler(searchProductSkus)(ctx, {
      query: skuId,
      storeId,
    });

    expect(result.results).toHaveLength(1);
    expect(result.results[0]).toMatchObject({
      match: {
        kind: "productSkuId",
        matchedValue: skuId,
        rank: 0,
      },
      productSkuId: skuId,
      sku: "BW-18",
    });
    expect(() =>
      assertConformsToExportedReturns(searchProductSkus, result),
    ).not.toThrow();
  });

  it("rejects canonical productSku id matches from another store", async () => {
    const { ctx, tables } = createCtx(baseSeed());
    tables.product.set("other-product", {
      ...tables.product.get(productId)!,
      _id: "other-product",
      storeId: otherStoreId,
    });
    tables.productSku.set("other-sku", {
      ...tables.productSku.get(skuId)!,
      _id: "other-sku",
      productId: "other-product",
      storeId: otherStoreId,
    });

    const result = await getHandler(searchProductSkus)(ctx, {
      query: "other-sku",
      storeId,
    });

    expect(result.results).toEqual([]);
  });

  it("normalizes sparse optional result fields to null", async () => {
    const seed = baseSeed();
    const sparseSku = seed.productSku[0] as Record<string, unknown>;
    delete sparseSku.barcode;
    delete sparseSku.barcodeAutoGenerated;
    delete sparseSku.color;
    delete sparseSku.isVisible;
    delete sparseSku.length;
    delete sparseSku.netPrice;
    delete sparseSku.size;
    delete sparseSku.unitCost;
    delete sparseSku.weight;
    sparseSku.images = [];
    sparseSku.sku = "SPARSE-1";
    const { ctx } = createCtx(seed);
    await upsertProductSkuSearchProjection(ctx, skuId);

    const result = await getHandler(searchProductSkus)(ctx, {
      query: "SPARSE-1",
      storeId,
    });

    expect(result.results[0]).toMatchObject({
      barcode: null,
      barcodeAutoGenerated: null,
      color: null,
      colorId: null,
      colorName: null,
      isVisible: null,
      length: null,
      netPrice: null,
      primaryImageUrl: null,
      size: null,
      skuIsVisible: null,
      unitCost: null,
      weight: null,
    });
    expect(() =>
      assertConformsToExportedReturns(searchProductSkus, result),
    ).not.toThrow();
  });

  it("allows nullable joined context in the public return contract", () => {
    expect(() =>
      assertConformsToExportedReturns(searchProductSkus, {
        candidateOverflow: false,
        limit: 25,
        truncated: false,
        results: [
          {
            barcode: null,
            barcodeAutoGenerated: null,
            category: null,
            categoryId: null,
            categoryName: null,
            categorySlug: null,
            color: null,
            colorHexCode: null,
            colorId: null,
            colorName: null,
            currency: null,
            images: [],
            inventoryCount: 0,
            isVisible: null,
            length: null,
            match: {
              kind: "text",
              matchedValue: null,
              rank: 3,
            },
            netPrice: null,
            price: 0,
            primaryImageUrl: null,
            product: null,
            productAvailability: "draft",
            productId,
            productIsVisible: null,
            productName: "Sparse SKU",
            productSkuCreationTime: 1,
            productSlug: null,
            productSkuId: skuId,
            quantityAvailable: 0,
            size: null,
            sku: null,
            skuIsVisible: null,
            storeId,
            subcategory: null,
            subcategoryId: null,
            subcategoryName: null,
            subcategorySlug: null,
            unitCost: null,
            weight: null,
          },
        ],
      }),
    ).not.toThrow();
  });

  it("skips stale projections and respects store boundaries", async () => {
    const { ctx, tables } = createCtx({
      ...baseSeed(),
      productSkuSearch: [
        {
          _id: "stale-projection",
          barcode: "MISSING",
          images: [],
          inventoryCount: 1,
          normalizedBarcode: "missing",
          price: 1,
          productAvailability: "live",
          productId,
          productName: "Missing",
          productSkuId: "missing-sku",
          quantityAvailable: 1,
          searchText: "missing",
          storeId,
          updatedAt: 1,
          sourceUpdatedAt: 1,
        },
      ],
    });
    await upsertProductSkuSearchProjection(ctx, skuId);
    tables.product.set("other-product", {
      ...tables.product.get(productId)!,
      _id: "other-product",
      storeId: otherStoreId,
    });
    tables.productSku.set("other-sku", {
      ...tables.productSku.get(skuId)!,
      _id: "other-sku",
      productId: "other-product",
      sku: "BW-18",
      storeId: otherStoreId,
    });
    await upsertProductSkuSearchProjection(ctx, "other-sku" as Id<"productSku">);

    const staleResult = await getHandler(searchProductSkus)(ctx, {
      query: "missing",
      storeId,
    });
    const storeResult = await getHandler(searchProductSkus)(ctx, {
      query: "BW-18",
      storeId,
    });

    expect(staleResult.results).toEqual([]);
    expect(storeResult.results.map((row: { storeId: string }) => row.storeId)).toEqual([
      storeId,
    ]);
  });

  it("suppresses cross-store joined taxonomy and color labels", async () => {
    const seed = baseSeed();
    seed.category[0].storeId = otherStoreId;
    seed.subcategory[0].storeId = otherStoreId;
    seed.color[0].storeId = otherStoreId;
    const { ctx } = createCtx(seed);
    await upsertProductSkuSearchProjection(ctx, skuId);

    const result = await getHandler(searchProductSkus)(ctx, {
      query: "BW-18",
      storeId,
    });

    expect(result.results[0]).toMatchObject({
      category: null,
      categoryId: null,
      categoryName: null,
      color: null,
      colorId: null,
      colorName: null,
      subcategory: null,
      subcategoryId: null,
      subcategoryName: null,
    });
    expect(result.results[0].product.name).toBe("Body wave bundle");
    expect(() =>
      assertConformsToExportedReturns(searchProductSkus, result),
    ).not.toThrow();
  });

  it("suppresses subcategory labels when the subcategory belongs to another category", async () => {
    const seed = baseSeed();
    seed.subcategory[0].categoryId = "other-category" as Id<"category">;
    const { ctx } = createCtx(seed);
    await upsertProductSkuSearchProjection(ctx, skuId);

    const result = await getHandler(searchProductSkus)(ctx, {
      query: "BW-18",
      storeId,
    });

    expect(result.results[0]).toMatchObject({
      categoryId,
      subcategory: null,
      subcategoryId: null,
      subcategoryName: null,
    });
  });

  it("repairs projections idempotently with bounded pagination", async () => {
    const { ctx, tables } = createCtx(baseSeed());

    const originalNow = Date.now;
    let now = 1000;
    Date.now = () => {
      now += 1000;
      return now;
    };

    const first = await getHandler(repairProductSkuSearchPage)(ctx, {
      paginationOpts: { cursor: null, numItems: 10 },
      storeId,
    });
    const second = await getHandler(repairProductSkuSearchPage)(ctx, {
      paginationOpts: { cursor: null, numItems: 10 },
      storeId,
    });
    Date.now = originalNow;

    expect(first).toMatchObject({
      scanned: 1,
      upserted: 1,
      unchanged: 0,
      isDone: true,
    });
    expect(second).toMatchObject({
      scanned: 1,
      upserted: 0,
      unchanged: 1,
      isDone: true,
    });
    expect(() =>
      assertConformsToExportedReturns(repairProductSkuSearchPage, first),
    ).not.toThrow();
    expect(tables.productSkuSearch.size).toBe(1);
  });

  it("removes stale projections with the exported repair contract", async () => {
    const { ctx, tables } = createCtx({
      ...baseSeed(),
      productSkuSearch: [
        {
          _id: "stale-projection",
          images: [],
          inventoryCount: 1,
          price: 1,
          productAvailability: "live",
          productId,
          productName: "Missing",
          productSkuId: "missing-sku",
          quantityAvailable: 1,
          searchText: "missing",
          storeId,
          updatedAt: 1,
          sourceUpdatedAt: 1,
        },
      ],
    });

    const result = await getHandler(removeStaleProductSkuSearchPage)(ctx, {
      paginationOpts: { cursor: null, numItems: 10 },
      storeId,
    });

    expect(result).toMatchObject({
      scanned: 1,
      sourceOrphans: 1,
      staleOrphansRemoved: 1,
      isDone: true,
    });
    expect(() =>
      assertConformsToExportedReturns(removeStaleProductSkuSearchPage, result),
    ).not.toThrow();
    expect(tables.productSkuSearch.size).toBe(0);
  });

  it("collapses duplicate sidecars even when duplicates are split across pages", async () => {
    const { ctx, tables } = createCtx(baseSeed());
    await upsertProductSkuSearchProjection(ctx, skuId);
    const firstProjection = tables.productSkuSearch.values().next().value!;
    tables.productSkuSearch.set("duplicate-projection", {
      ...firstProjection,
      _creationTime: Number(firstProjection._creationTime) + 1,
      _id: "duplicate-projection",
    });

    const firstPage = await getHandler(removeStaleProductSkuSearchPage)(ctx, {
      paginationOpts: { cursor: null, numItems: 1 },
      storeId,
    });
    const secondPage = await getHandler(removeStaleProductSkuSearchPage)(ctx, {
      paginationOpts: { cursor: "1", numItems: 1 },
      storeId,
    });

    expect(firstPage).toMatchObject({
      duplicatesCollapsed: 1,
      staleOrphansRemoved: 1,
      unchanged: 1,
    });
    expect(secondPage).toMatchObject({
      scanned: 0,
      duplicatesCollapsed: 0,
    });
    expect(tables.productSkuSearch.size).toBe(1);
  });

  it("defines and uses the store-filtered Convex search index", () => {
    const schemaSource = readFileSync("convex/schema.ts", "utf8");
    const skuSearchSource = readFileSync("convex/inventory/skuSearch.ts", "utf8");

    expect(schemaSource).toContain('.searchIndex("searchText"');
    expect(schemaSource).toContain('filterFields: ["storeId"]');
    expect(schemaSource).toContain('.index("by_categoryId"');
    expect(schemaSource).toContain('.index("by_subcategoryId"');
    expect(schemaSource).toContain('.index("by_color"');
    expect(skuSearchSource).toContain('.withSearchIndex("searchText"');
    expect(skuSearchSource).toContain('.withIndex("by_categoryId"');
    expect(skuSearchSource).toContain('.withIndex("by_subcategoryId"');
    expect(skuSearchSource).toContain('.withIndex("by_color"');
    expect(skuSearchSource).not.toContain('.query("productSku").collect()');
  });
});
