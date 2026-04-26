import { describe, expect, it, vi } from "vitest";

import type { Id } from "../../../_generated/dataModel";
import type { MutationCtx } from "../../../_generated/server";
import { quickAddCatalogItem } from "./quickAddCatalogItem";

type TableName =
  | "athenaUser"
  | "category"
  | "color"
  | "product"
  | "productSku"
  | "store"
  | "subcategory";
type Row = Record<string, unknown> & { _id: string };

function createQuickAddCtx(seed?: Partial<Record<TableName, Row[]>>) {
  const tables: Record<TableName, Map<string, Row>> = {
    athenaUser: new Map(),
    category: new Map(),
    color: new Map(),
    product: new Map(),
    productSku: new Map(),
    store: new Map(),
    subcategory: new Map(),
  };
  const insertCounters: Record<TableName, number> = {
    athenaUser: 0,
    category: 0,
    color: 0,
    product: 0,
    productSku: 0,
    store: 0,
    subcategory: 0,
  };

  for (const [table, rows] of Object.entries(seed ?? {}) as Array<
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
      first: async () => matches[0] ?? null,
      collect: async () => matches,
    };
  }

  const ctx = {
    db: {
      async get(table: TableName, id: string) {
        return tables[table].get(id) ?? null;
      },
      async insert(table: TableName, value: Record<string, unknown>) {
        insertCounters[table] += 1;
        const id = `${table}00${insertCounters[table]}`;
        tables[table].set(id, { _id: id, ...value });
        return id;
      },
      async patch(table: TableName, id: string, value: Record<string, unknown>) {
        const existing = tables[table].get(id);
        if (!existing) {
          throw new Error(`Missing ${table}: ${id}`);
        }

        tables[table].set(id, { ...existing, ...value });
      },
      query(table: TableName) {
        return {
          filter() {
            if (table === "category") {
              return createIndexedQuery(table, [
                ["storeId", "storezzzz"],
                ["slug", "pos-quick-add"],
              ]);
            }

            if (table === "subcategory") {
              const quickAddCategory = Array.from(
                tables.category.values(),
              ).find((row) => row.slug === "pos-quick-add");

              return createIndexedQuery(table, [
                ["storeId", "storezzzz"],
                ["categoryId", quickAddCategory?._id],
                ["slug", "uncategorized"],
              ]);
            }

            return createIndexedQuery(table, []);
          },
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
  } as unknown as MutationCtx;

  return { ctx, tables };
}

const baseSeed = {
  store: [
    {
      _id: "storezzzz",
      currency: "GHS",
      organizationId: "org0001",
    },
  ],
};

describe("quickAddCatalogItem", () => {
  it("creates hidden quick-add products, visible SKUs, and saves numeric lookup codes as barcodes", async () => {
    const { ctx, tables } = createQuickAddCtx(baseSeed);

    const result = await quickAddCatalogItem(ctx, {
      storeId: "storezzzz" as Id<"store">,
      createdByUserId: "user0001" as Id<"athenaUser">,
      name: "",
      lookupCode: "123456789012",
      price: 115000,
      quantityAvailable: 2.7,
    });

    const product = Array.from(tables.product.values())[0];
    const sku = Array.from(tables.productSku.values())[0];

    expect(product).toMatchObject({
      name: "123456789012",
      isVisible: false,
      inventoryCount: 2,
      quantityAvailable: 2,
    });
    expect(sku).toMatchObject({
      barcode: "123456789012",
      isVisible: true,
      price: 115000,
      quantityAvailable: 2,
    });
    expect(sku.sku).toMatch(/^[A-Z0-9]+-[A-Z0-9]+-[A-Z0-9]+$/);
    expect(sku.sku).not.toBe("123456789012");
    expect(result).toMatchObject({
      barcode: "123456789012",
      sku: sku.sku,
      inStock: true,
    });
  });

  it("uses non-barcode lookup codes as the requested SKU", async () => {
    const { ctx, tables } = createQuickAddCtx(baseSeed);

    await quickAddCatalogItem(ctx, {
      storeId: "storezzzz" as Id<"store">,
      createdByUserId: "user0001" as Id<"athenaUser">,
      name: "Loose wave bundle",
      lookupCode: "LW-BUNDLE",
      price: 90000,
      quantityAvailable: 1,
    });

    expect(Array.from(tables.productSku.values())[0]).toMatchObject({
      barcode: undefined,
      sku: "LW-BUNDLE",
      isVisible: true,
    });
  });

  it("returns an existing SKU match instead of inserting a duplicate quick-add item", async () => {
    const { ctx } = createQuickAddCtx({
      ...baseSeed,
      category: [
        { _id: "category001", storeId: "storezzzz", slug: "wigs", name: "Wigs" },
      ],
      product: [
        {
          _id: "product001",
          categoryId: "category001",
          storeId: "storezzzz",
          description: "",
          name: "Existing wig",
          areProcessingFeesAbsorbed: false,
        },
      ],
      productSku: [
        {
          _id: "productSku001",
          barcode: "998877665544",
          images: [],
          netPrice: 0,
          price: 75000,
          productId: "product001",
          quantityAvailable: 3,
          sku: "EXISTING-SKU",
          storeId: "storezzzz",
        },
      ],
    });
    const insertSpy = vi.spyOn(ctx.db, "insert");

    const result = await quickAddCatalogItem(ctx, {
      storeId: "storezzzz" as Id<"store">,
      createdByUserId: "user0001" as Id<"athenaUser">,
      name: "Duplicate scan",
      lookupCode: "998877665544",
      price: 75000,
      quantityAvailable: 1,
    });

    expect(insertSpy).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      name: "Existing wig",
      barcode: "998877665544",
      sku: "EXISTING-SKU",
    });
  });

  it("adds a new SKU variant to an existing product when productId is provided", async () => {
    const { ctx, tables } = createQuickAddCtx({
      ...baseSeed,
      category: [
        { _id: "category001", storeId: "storezzzz", slug: "wigs", name: "Wigs" },
      ],
      product: [
        {
          _id: "product001",
          categoryId: "category001",
          storeId: "storezzzz",
          description: "",
          name: "Existing wig",
          areProcessingFeesAbsorbed: false,
        },
      ],
    });

    const result = await quickAddCatalogItem(ctx, {
      storeId: "storezzzz" as Id<"store">,
      createdByUserId: "user0001" as Id<"athenaUser">,
      name: "Should ignore this title",
      price: 110000,
      quantityAvailable: 4.2,
      productId: "product001" as Id<"product">,
    });

    const sku = Array.from(tables.productSku.values())[0];

    expect(Array.from(tables.product).length).toBe(1);
    expect(Array.from(tables.productSku).length).toBe(1);
    expect(sku).toMatchObject({
      productId: "product001",
      barcode: undefined,
      price: 110000,
      quantityAvailable: 4,
    });
    expect(sku?.sku).toMatch(/^[A-Z0-9]+-[A-Z0-9]+-[A-Z0-9]+$/);
    expect(result).toMatchObject({
      productId: "product001",
      name: "Existing wig",
      barcode: "",
      inStock: true,
    });
  });
});
