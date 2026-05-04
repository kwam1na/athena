import { describe, expect, it } from "vitest";

import type { Id } from "../../../_generated/dataModel";
import type { QueryCtx } from "../../../_generated/server";
import { listRegisterCatalog } from "./listRegisterCatalog";

type TableName = "category" | "color" | "product" | "productSku";
type Row = Record<string, unknown> & { _id: string };

function createRegisterCatalogCtx(seed: Partial<Record<TableName, Row[]>>) {
  const tables: Record<TableName, Map<string, Row>> = {
    category: new Map(),
    color: new Map(),
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
    filters: Array<[string, unknown]>,
  ) {
    const matches = Array.from(tables[table].values()).filter((row) =>
      filters.every(([field, value]) => row[field] === value),
    );

    return {
      async *[Symbol.asyncIterator]() {
        for (const row of matches) {
          yield row;
        }
      },
      collect: async () => matches,
      first: async () => matches[0] ?? null,
    };
  }

  const ctx = {
    db: {
      async get(table: TableName, id: string) {
        return tables[table].get(id) ?? null;
      },
      query(table: TableName) {
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
            return createIndexedQuery(table, filters);
          },
        };
      },
    },
  } as unknown as QueryCtx;

  return { ctx, tables };
}

describe("listRegisterCatalog", () => {
  it("returns compact store-scoped SKU rows with identity, display, price, and availability fields", async () => {
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
        inStock: true,
        quantityAvailable: 4,
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
        inStock: false,
        quantityAvailable: 0,
        areProcessingFeesAbsorbed: false,
      },
    ]);
  });
});
