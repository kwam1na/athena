import { describe, expect, it, vi } from "vitest";

import type { Id } from "../../../_generated/dataModel";
import type { MutationCtx } from "../../../_generated/server";
import { quickAddCatalogItem } from "./quickAddCatalogItem";

type TableName =
  | "athenaUser"
  | "category"
  | "color"
  | "operationalEvent"
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
    operationalEvent: new Map(),
    product: new Map(),
    productSku: new Map(),
    store: new Map(),
    subcategory: new Map(),
  };
  const insertCounters: Record<TableName, number> = {
    athenaUser: 0,
    category: 0,
    color: 0,
    operationalEvent: 0,
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
  athenaUser: [
    {
      _id: "user0001",
      email: "kwamina@example.com",
      firstName: "Kwamina",
      lastName: "Nuh",
    },
  ],
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

    expect(Array.from(tables.operationalEvent.values())).toEqual([
      expect.objectContaining({
        actorUserId: "user0001",
        eventType: "pos_quick_add_product_created",
        organizationId: "org0001",
        storeId: "storezzzz",
        subjectId: sku._id,
        subjectLabel: "123456789012",
        subjectType: "product_sku",
        message: "Kwamina Nuh quick added 123456789012 with quantity 2.",
        metadata: expect.objectContaining({
          barcode: "123456789012",
          productId: product._id,
          productSkuId: sku._id,
          quantityAvailable: 2,
          sku: sku.sku,
        }),
      }),
    ]);
  });

  it("always auto-generates SKU and stores lookup code only as barcode when provided", async () => {
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
      sku: expect.stringMatching(/^[A-Z0-9]+-[A-Z0-9]+-[A-Z0-9]+$/),
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

    expect(insertSpy).not.toHaveBeenCalledWith(
      "product",
      expect.any(Object),
    );
    expect(insertSpy).not.toHaveBeenCalledWith(
      "productSku",
      expect.any(Object),
    );
    expect(result).toMatchObject({
      name: "Existing wig",
      barcode: "998877665544",
      sku: "EXISTING-SKU",
    });
  });

  it("attaches a scanned barcode to an existing SKU without inserting a duplicate item", async () => {
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
      productSku: [
        {
          _id: "productSku001",
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
      name: "",
      lookupCode: "111122223333",
      price: 0,
      quantityAvailable: 0,
      productSkuId: "productSku001" as Id<"productSku">,
    });

    expect(insertSpy).not.toHaveBeenCalledWith(
      "product",
      expect.any(Object),
    );
    expect(insertSpy).not.toHaveBeenCalledWith(
      "productSku",
      expect.any(Object),
    );
    expect(tables.productSku.get("productSku001")).toMatchObject({
      barcode: "111122223333",
    });
    expect(result).toMatchObject({
      name: "Existing wig",
      barcode: "111122223333",
      sku: "EXISTING-SKU",
    });

    expect(Array.from(tables.operationalEvent.values())).toEqual([
      expect.objectContaining({
        actorUserId: "user0001",
        eventType: "pos_quick_add_barcode_attached",
        organizationId: "org0001",
        storeId: "storezzzz",
        subjectId: "productSku001",
        subjectLabel: "Existing wig",
        subjectType: "product_sku",
        message:
          "Kwamina Nuh attached barcode 111122223333 to Existing wig.",
        metadata: expect.objectContaining({
          barcode: "111122223333",
          productId: "product001",
          productSkuId: "productSku001",
          sku: "EXISTING-SKU",
        }),
      }),
    ]);
  });

  it("blocks attaching a barcode that already belongs to another SKU", async () => {
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
          barcode: "111122223333",
          images: [],
          netPrice: 0,
          price: 75000,
          productId: "product001",
          quantityAvailable: 3,
          sku: "FIRST-SKU",
          storeId: "storezzzz",
        },
        {
          _id: "productSku002",
          images: [],
          netPrice: 0,
          price: 85000,
          productId: "product001",
          quantityAvailable: 2,
          sku: "SECOND-SKU",
          storeId: "storezzzz",
        },
      ],
    });

    await expect(
      quickAddCatalogItem(ctx, {
        storeId: "storezzzz" as Id<"store">,
        createdByUserId: "user0001" as Id<"athenaUser">,
        name: "",
        lookupCode: "111122223333",
        price: 0,
        quantityAvailable: 0,
        productSkuId: "productSku002" as Id<"productSku">,
      }),
    ).rejects.toThrow("Barcode is already attached to another SKU");
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

    expect(Array.from(tables.operationalEvent.values())).toEqual([
      expect.objectContaining({
        actorUserId: "user0001",
        eventType: "pos_quick_add_variant_created",
        organizationId: "org0001",
        storeId: "storezzzz",
        subjectId: sku._id,
        subjectLabel: "Existing wig",
        subjectType: "product_sku",
        message: "Kwamina Nuh quick added Existing wig with quantity 4.",
        metadata: expect.objectContaining({
          productId: "product001",
          productSkuId: sku._id,
          quantityAvailable: 4,
          sku: sku.sku,
        }),
      }),
    ]);
  });
});
