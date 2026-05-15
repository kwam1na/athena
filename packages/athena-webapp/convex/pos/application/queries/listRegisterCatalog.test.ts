import { describe, expect, it } from "vitest";

import type { Id } from "../../../_generated/dataModel";
import type { QueryCtx } from "../../../_generated/server";
import {
  listRegisterCatalog,
  listRegisterCatalogAvailability,
  listRegisterCatalogAvailabilitySnapshot,
} from "./listRegisterCatalog";

type TableName =
  | "category"
  | "color"
  | "inventoryHold"
  | "product"
  | "productSku";
type Row = Record<string, unknown> & { _id: string };
type IndexedFilter = {
  field: string;
  matches: (value: unknown) => boolean;
};

function createRegisterCatalogCtx(seed: Partial<Record<TableName, Row[]>>) {
  const tables: Record<TableName, Map<string, Row>> = {
    category: new Map(),
    color: new Map(),
    inventoryHold: new Map(),
    product: new Map(),
    productSku: new Map(),
  };

  for (const [table, rows] of Object.entries(seed) as Array<
    [TableName, Row[]]
  >) {
    rows.forEach((row) => tables[table].set(row._id, row));
  }

  function createIndexedQuery(
    table: TableName,
    filters: IndexedFilter[],
  ) {
    const matches = Array.from(tables[table].values()).filter((row) =>
      filters.every((filter) => filter.matches(row[filter.field])),
    );

    return {
      async *[Symbol.asyncIterator]() {
        for (const row of matches) {
          yield row;
        }
      },
      collect: async () => matches,
      first: async () => matches[0] ?? null,
      take: async (limit: number) => matches.slice(0, limit),
    };
  }

  const ctx = {
    db: {
      async get(tableOrId: TableName | string, maybeId?: string) {
        if (maybeId !== undefined && tableOrId in tables) {
          return tables[tableOrId as TableName].get(maybeId) ?? null;
        }

        for (const table of Object.values(tables)) {
          const row = table.get(tableOrId);
          if (row) {
            return row;
          }
        }

        return null;
      },
      query(table: TableName) {
        return {
          withIndex(
            _index: string,
            applyIndex: (queryBuilder: {
              eq: (field: string, value: unknown) => unknown;
              gt: (field: string, value: number) => unknown;
            }) => unknown,
          ) {
            const filters: Array<
              | { field: string; op: "eq"; value: unknown }
              | { field: string; op: "gt"; value: number }
            > = [];
            const queryBuilder = {
              eq(field: string, value: unknown) {
                filters.push({ field, op: "eq", value });
                return queryBuilder;
              },
              gt(field: string, value: number) {
                filters.push({ field, op: "gt", value });
                return queryBuilder;
              },
            };

            applyIndex(queryBuilder);
            return createIndexedQuery(
              table,
              filters.map((filter) => ({
                field: filter.field,
                matches:
                  filter.op === "eq"
                    ? (rowValue) => rowValue === filter.value
                    : (rowValue) =>
                        typeof rowValue === "number" &&
                        rowValue > filter.value,
              })),
            );
          },
        };
      },
    },
  } as unknown as QueryCtx;

  return { ctx, tables };
}

describe("listRegisterCatalog", () => {
  it("returns compact store-scoped SKU rows with stable identity, display, and price fields", async () => {
    const { ctx } = createRegisterCatalogCtx({
      category: [
        {
          _id: "category-store-a",
          storeId: "store-a",
          name: "Wigs",
          slug: "wigs",
        },
        {
          _id: "category-store-b",
          storeId: "store-b",
          name: "Accessories",
          slug: "accessories",
        },
      ],
      color: [
        {
          _id: "color-black",
          storeId: "store-a",
          name: "Natural black",
        },
      ],
      product: [
        {
          _id: "product-live",
          storeId: "store-a",
          categoryId: "category-store-a",
          description: "Body wave frontal",
          name: "Body Wave Frontal",
          areProcessingFeesAbsorbed: true,
        },
        {
          _id: "product-out",
          storeId: "store-a",
          categoryId: "category-store-a",
          description: "",
          name: "Out of Stock Closure",
        },
        {
          _id: "product-other-store",
          storeId: "store-b",
          categoryId: "category-store-b",
          description: "Should not leak",
          name: "Other Store Wig",
        },
        {
          _id: "product-archived",
          storeId: "store-a",
          categoryId: "category-store-a",
          description: "Archived product",
          name: "Archived Wig",
          availability: "archived",
        },
        {
          _id: "product-zero-price",
          storeId: "store-a",
          categoryId: "category-store-a",
          description: "Unpriced SKU",
          name: "Bottle Water",
        },
      ],
      productSku: [
        {
          _id: "sku-live",
          storeId: "store-a",
          productId: "product-live",
          sku: "BW-FRONTAL-18",
          barcode: "123456789012",
          images: ["https://example.com/frontal.jpg"],
          netPrice: 120000,
          price: 125000,
          quantityAvailable: 4,
          size: "13x4",
          length: 18,
          color: "color-black",
        },
        {
          _id: "sku-out",
          storeId: "store-a",
          productId: "product-out",
          images: [],
          price: 95000,
          quantityAvailable: 0,
        },
        {
          _id: "sku-other-store",
          storeId: "store-b",
          productId: "product-other-store",
          sku: "OTHER-STORE",
          barcode: "999",
          images: [],
          price: 1000,
          quantityAvailable: 9,
        },
        {
          _id: "sku-archived",
          storeId: "store-a",
          productId: "product-archived",
          sku: "ARCHIVED-WIG",
          barcode: "888",
          images: [],
          price: 1000,
          quantityAvailable: 9,
        },
        {
          _id: "sku-zero-price",
          storeId: "store-a",
          productId: "product-zero-price",
          sku: "BOTTLE-WATER-ZERO",
          barcode: "777",
          images: [],
          netPrice: 0,
          price: 0,
          quantityAvailable: 200,
        },
      ],
    });

    const rows = await listRegisterCatalog(ctx, {
      storeId: "store-a" as Id<"store">,
    });

    expect(rows).toEqual([
      {
        id: "sku-live",
        productSkuId: "sku-live",
        skuId: "sku-live",
        productId: "product-live",
        name: "Body Wave Frontal",
        sku: "BW-FRONTAL-18",
        barcode: "123456789012",
        price: 120000,
        category: "Wigs",
        description: "Body wave frontal",
        image: "https://example.com/frontal.jpg",
        size: "13x4",
        length: 18,
        color: "Natural black",
        areProcessingFeesAbsorbed: true,
      },
      {
        id: "sku-out",
        productSkuId: "sku-out",
        skuId: "sku-out",
        productId: "product-out",
        name: "Out of Stock Closure",
        sku: "",
        barcode: "",
        price: 95000,
        category: "Wigs",
        description: "",
        image: null,
        size: "",
        length: null,
        color: "",
        areProcessingFeesAbsorbed: false,
      },
    ]);

    expect(rows[0]).not.toHaveProperty("inStock");
    expect(rows[0]).not.toHaveProperty("quantityAvailable");
  });

  it("returns bounded store-scoped availability for requested SKU ids after active holds", async () => {
    const { ctx } = createRegisterCatalogCtx({
      inventoryHold: [
        {
          _id: "hold-other-session",
          storeId: "store-a",
          productSkuId: "sku-live",
          sourceType: "posSession",
          sourceSessionId: "session-other",
          status: "active",
          quantity: 3,
          expiresAt: Date.now() + 60_000,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      productSku: [
        {
          _id: "sku-live",
          storeId: "store-a",
          productId: "product-live",
          sku: "SKU-LIVE",
          quantityAvailable: 4,
        },
        {
          _id: "sku-out",
          storeId: "store-a",
          productId: "product-out",
          sku: "SKU-OUT",
          quantityAvailable: 0,
        },
        {
          _id: "sku-other-store",
          storeId: "store-b",
          productId: "product-other-store",
          sku: "SKU-OTHER",
          quantityAvailable: 9,
        },
      ],
    });

    const rows = await listRegisterCatalogAvailability(ctx, {
      storeId: "store-a" as Id<"store">,
      productSkuIds: [
        "sku-live",
        "sku-out",
        "sku-live",
        "sku-other-store",
        "sku-missing",
      ] as Array<Id<"productSku">>,
    });

    expect(rows).toEqual([
      {
        productSkuId: "sku-live",
        skuId: "sku-live",
        inStock: true,
        quantityAvailable: 1,
      },
      {
        productSkuId: "sku-out",
        skuId: "sku-out",
        inStock: false,
        quantityAvailable: 0,
      },
    ]);
  });

  it("keeps requested availability capped", async () => {
    const productSkus = Array.from({ length: 51 }, (_, index) => ({
      _id: `sku-${index}`,
      storeId: "store-a",
      productId: `product-${index}`,
      sku: `SKU-${index}`,
      quantityAvailable: 1,
    }));
    const { ctx } = createRegisterCatalogCtx({
      productSku: productSkus,
    });

    const rows = await listRegisterCatalogAvailability(ctx, {
      storeId: "store-a" as Id<"store">,
      productSkuIds: productSkus.map(
        (sku) => sku._id as Id<"productSku">,
      ),
    });

    expect(rows).toHaveLength(50);
    expect(rows.at(-1)).toMatchObject({
      productSkuId: "sku-49",
      quantityAvailable: 1,
    });
  });

  it("returns a full-store availability snapshot scoped like register catalog metadata", async () => {
    const { ctx } = createRegisterCatalogCtx({
      category: [
        {
          _id: "category-store-a",
          storeId: "store-a",
          name: "Wigs",
        },
      ],
      inventoryHold: [
        {
          _id: "hold-active",
          storeId: "store-a",
          productSkuId: "sku-live",
          sourceType: "posSession",
          sourceSessionId: "session-active",
          status: "active",
          quantity: 3,
          expiresAt: Date.now() + 60_000,
          createdAt: 1,
          updatedAt: 1,
        },
        {
          _id: "hold-expired",
          storeId: "store-a",
          productSkuId: "sku-live",
          sourceType: "posSession",
          sourceSessionId: "session-expired",
          status: "active",
          quantity: 2,
          expiresAt: Date.now() - 60_000,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      product: [
        {
          _id: "product-live",
          storeId: "store-a",
          categoryId: "category-store-a",
          name: "Live Wig",
        },
        {
          _id: "product-out",
          storeId: "store-a",
          categoryId: "category-store-a",
          name: "Out Wig",
        },
        {
          _id: "product-archived",
          storeId: "store-a",
          categoryId: "category-store-a",
          name: "Archived Wig",
          availability: "archived",
        },
        {
          _id: "product-zero-price",
          storeId: "store-a",
          categoryId: "category-store-a",
          name: "Zero Price Wig",
        },
        {
          _id: "product-other-store",
          storeId: "store-b",
          categoryId: "category-store-a",
          name: "Other Store Wig",
        },
      ],
      productSku: [
        {
          _id: "sku-live",
          storeId: "store-a",
          productId: "product-live",
          sku: "SKU-LIVE",
          price: 100,
          quantityAvailable: 5,
        },
        {
          _id: "sku-out",
          storeId: "store-a",
          productId: "product-out",
          sku: "SKU-OUT",
          price: 100,
          quantityAvailable: 0,
        },
        {
          _id: "sku-archived",
          storeId: "store-a",
          productId: "product-archived",
          sku: "SKU-ARCHIVED",
          price: 100,
          quantityAvailable: 9,
        },
        {
          _id: "sku-zero-price",
          storeId: "store-a",
          productId: "product-zero-price",
          sku: "SKU-ZERO",
          price: 0,
          quantityAvailable: 9,
        },
        {
          _id: "sku-other-store",
          storeId: "store-b",
          productId: "product-other-store",
          sku: "SKU-OTHER",
          price: 100,
          quantityAvailable: 9,
        },
      ],
    });

    const rows = await listRegisterCatalogAvailabilitySnapshot(ctx, {
      storeId: "store-a" as Id<"store">,
    });

    expect(rows).toEqual([
      {
        productSkuId: "sku-live",
        skuId: "sku-live",
        inStock: true,
        quantityAvailable: 2,
      },
      {
        productSkuId: "sku-out",
        skuId: "sku-out",
        inStock: false,
        quantityAvailable: 0,
      },
    ]);
  });
});
