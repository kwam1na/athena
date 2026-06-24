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
  | "inventoryImportProvisionalSku"
  | "posPendingCheckoutItem"
  | "product"
  | "productSku";
type Row = Record<string, unknown> & { _id: string };
type IndexedFilter = {
  field: string;
  matches: (value: unknown) => boolean;
};

function createRegisterCatalogCtx(
  seed: Partial<Record<TableName, Row[]>>,
  options: { asyncIteratorLimit?: number; failOnPaginate?: boolean } = {},
) {
  const readCounts = Object.fromEntries(
    (
      [
        "category",
        "color",
        "inventoryHold",
        "inventoryImportProvisionalSku",
        "posPendingCheckoutItem",
        "product",
        "productSku",
      ] as TableName[]
    ).map((table) => [table, 0]),
  ) as Record<TableName, number>;
  const tables: Record<TableName, Map<string, Row>> = {
    category: new Map(),
    color: new Map(),
    inventoryHold: new Map(),
    inventoryImportProvisionalSku: new Map(),
    posPendingCheckoutItem: new Map(),
    product: new Map(),
    productSku: new Map(),
  };

  for (const [table, rows] of Object.entries(seed) as Array<
    [TableName, Row[]]
  >) {
    rows.forEach((row) =>
      tables[table].set(row._id, {
        ...(table === "inventoryImportProvisionalSku"
          ? { posExposureStatus: "available" }
          : {}),
        ...row,
      }),
    );
  }

  function countRead(table: TableName, count = 1) {
    readCounts[table] += count;
  }

  function createIndexedQuery(table: TableName, filters: IndexedFilter[]) {
    const matches = Array.from(tables[table].values()).filter((row) =>
      filters.every((filter) => filter.matches(row[filter.field])),
    );

    return {
      async *[Symbol.asyncIterator]() {
        for (const row of matches.slice(0, options.asyncIteratorLimit)) {
          countRead(table);
          yield row;
        }
      },
      collect: async () => {
        countRead(table, matches.length);
        return matches;
      },
      first: async () => {
        const row = matches[0] ?? null;
        if (row) countRead(table);
        return row;
      },
      paginate: async ({
        cursor,
        numItems,
      }: {
        cursor: string | null;
        numItems: number;
      }) => {
        if (options.failOnPaginate) {
          throw new Error("paginate should not be used in this query");
        }
        const offset = cursor ? Number(cursor) : 0;
        const page = matches.slice(offset, offset + numItems);
        countRead(table, page.length);
        const nextOffset = offset + page.length;
        const isDone = nextOffset >= matches.length;

        return {
          page,
          isDone,
          continueCursor: isDone ? "" : String(nextOffset),
        };
      },
      take: async (limit: number) => {
        const rows = matches.slice(0, limit);
        countRead(table, rows.length);
        return rows;
      },
    };
  }

  const ctx = {
    db: {
      async get(tableOrId: TableName | string, maybeId?: string) {
        if (maybeId !== undefined && tableOrId in tables) {
          const row = tables[tableOrId as TableName].get(maybeId) ?? null;
          if (row) countRead(tableOrId as TableName);
          return row;
        }

        for (const [tableName, table] of Object.entries(tables) as Array<
          [TableName, Map<string, Row>]
        >) {
          const row = table.get(tableOrId);
          if (row) {
            countRead(tableName);
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
                        typeof rowValue === "number" && rowValue > filter.value,
              })),
            );
          },
        };
      },
    },
  } as unknown as QueryCtx;

  return { ctx, readCounts, tables };
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
        {
          _id: "category-pos-quick-add",
          storeId: "store-a",
          name: "POS quick add",
          slug: "pos-quick-add",
        },
        {
          _id: "category-pos-pending-checkout",
          storeId: "store-a",
          name: "POS pending checkout",
          slug: "pos-pending-checkout",
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
        {
          _id: "product-draft",
          storeId: "store-a",
          categoryId: "category-store-a",
          description: "Pending checkout anchor",
          name: "Pending Checkout Anchor",
          availability: "draft",
          isVisible: false,
        },
        {
          _id: "product-hidden",
          storeId: "store-a",
          categoryId: "category-store-a",
          description: "Hidden product",
          name: "Hidden Product",
          isVisible: false,
        },
        {
          _id: "product-pos-quick-add",
          storeId: "store-a",
          categoryId: "category-pos-quick-add",
          description: "Cashier recovery item",
          name: "Quick Added Item",
          availability: "live",
          isVisible: false,
        },
        {
          _id: "product-pos-pending-checkout",
          storeId: "store-a",
          categoryId: "category-pos-pending-checkout",
          description: "Reviewable cashier item",
          name: "Pending Checkout Item",
          availability: "draft",
          isVisible: false,
        },
        {
          _id: "product-hidden-sku",
          storeId: "store-a",
          categoryId: "category-store-a",
          description: "Visible product with hidden SKU",
          name: "Hidden SKU Product",
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
        {
          _id: "sku-draft",
          storeId: "store-a",
          productId: "product-draft",
          sku: "PENDING-DRAFT",
          barcode: "666",
          images: [],
          isVisible: false,
          price: 1000,
          quantityAvailable: 0,
        },
        {
          _id: "sku-hidden-product",
          storeId: "store-a",
          productId: "product-hidden",
          sku: "HIDDEN-PRODUCT",
          barcode: "555",
          images: [],
          price: 1000,
          quantityAvailable: 3,
        },
        {
          _id: "sku-pos-quick-add",
          storeId: "store-a",
          productId: "product-pos-quick-add",
          sku: "QUICK-ADD",
          barcode: "777",
          images: [],
          price: 1000,
          quantityAvailable: 3,
        },
        {
          _id: "sku-pos-pending-checkout",
          storeId: "store-a",
          productId: "product-pos-pending-checkout",
          sku: "PENDING-CHECKOUT",
          barcode: "111",
          images: [],
          isVisible: false,
          price: 1000,
          quantityAvailable: 0,
        },
        {
          _id: "sku-hidden",
          storeId: "store-a",
          productId: "product-hidden-sku",
          sku: "HIDDEN-SKU",
          barcode: "444",
          images: [],
          isVisible: false,
          price: 1000,
          quantityAvailable: 3,
        },
      ],
      posPendingCheckoutItem: [
        {
          _id: "pending-checkout-1",
          storeId: "store-a",
          status: "pending_review",
          provisionalProductSkuId: "sku-pos-pending-checkout",
          provisionalPrice: 1000,
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
        availabilityPolicy: "trusted_inventory",
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
        availabilityPolicy: "trusted_inventory",
      },
      {
        id: "sku-pos-quick-add",
        productSkuId: "sku-pos-quick-add",
        skuId: "sku-pos-quick-add",
        productId: "product-pos-quick-add",
        name: "Quick Added Item",
        sku: "QUICK-ADD",
        barcode: "777",
        price: 1000,
        category: "POS quick add",
        description: "Cashier recovery item",
        image: null,
        size: "",
        length: null,
        color: "",
        areProcessingFeesAbsorbed: false,
        availabilityPolicy: "trusted_inventory",
      },
      {
        id: "sku-pos-pending-checkout",
        productSkuId: "sku-pos-pending-checkout",
        skuId: "sku-pos-pending-checkout",
        productId: "product-pos-pending-checkout",
        name: "Pending Checkout Item",
        sku: "PENDING-CHECKOUT",
        barcode: "111",
        price: 1000,
        category: "POS pending checkout",
        description: "Reviewable cashier item",
        image: null,
        size: "",
        length: null,
        color: "",
        areProcessingFeesAbsorbed: false,
        availabilityPolicy: "pending_checkout",
        pendingCheckoutItemId: "pending-checkout-1",
      },
    ]);

    expect(rows[0]).not.toHaveProperty("inStock");
    expect(rows[0]).not.toHaveProperty("quantityAvailable");
  });

  it("surfaces active provisional import SKUs without shadowing trusted inventory", async () => {
    const { ctx } = createRegisterCatalogCtx({
      category: [
        {
          _id: "category-store-a",
          storeId: "store-a",
          name: "Imports",
          slug: "legacy-import",
        },
      ],
      inventoryImportProvisionalSku: [
        {
          _id: "provisional-matched",
          storeId: "store-a",
          status: "active",
          posExposureStatus: "available",
          productId: "product-trusted",
          productSkuId: "sku-trusted",
          importedProductName: "Matched Imported Closure",
          importedSku: "LEGACY-CLOSURE",
          importedBarcode: "123PROV",
          importedPrice: 83000,
          importedQuantity: 8,
          provisionalQuantitySold: 0,
          provisionalTransactionCount: 0,
        },
        {
          _id: "provisional-sku-1",
          storeId: "store-a",
          status: "active",
          productId: "product-provisional",
          productSkuId: "sku-provisional",
          importedProductName: "Imported Closure",
          importedSku: "LEGACY-CLOSURE",
          importedBarcode: "123PROV",
          importedPrice: 85000,
          importedQuantity: 12,
          provisionalQuantitySold: 0,
          provisionalTransactionCount: 0,
        },
        {
          _id: "provisional-finalized",
          storeId: "store-a",
          status: "finalized",
          productId: "product-finalized",
          productSkuId: "sku-finalized",
          importedProductName: "Finalized Closure",
          importedPrice: 85000,
          importedQuantity: 12,
        },
        {
          _id: "provisional-hidden",
          storeId: "store-a",
          status: "active",
          posExposureStatus: "hidden",
          productId: "product-hidden",
          productSkuId: "sku-hidden",
          importedProductName: "Hidden Closure",
          importedPrice: 85000,
          importedQuantity: 12,
        },
        {
          _id: "provisional-archived",
          storeId: "store-a",
          status: "active",
          productId: "product-archived",
          productSkuId: "sku-archived",
          importedProductName: "Archived Legacy Import",
          importedSku: "ARCHIVED-LEGACY",
          importedBarcode: "ARCHIVED123",
          importedPrice: 85000,
          importedQuantity: 12,
        },
      ],
      product: [
        {
          _id: "product-trusted",
          storeId: "store-a",
          categoryId: "category-store-a",
          description: "Trusted catalog row",
          name: "Imported Closure",
          availability: "active",
          isVisible: true,
        },
        {
          _id: "product-provisional",
          storeId: "store-a",
          categoryId: "category-store-a",
          description: "Review anchor",
          name: "Hidden Review Anchor",
          availability: "draft",
          isVisible: false,
        },
        {
          _id: "product-finalized",
          storeId: "store-a",
          categoryId: "category-store-a",
          description: "Closed anchor",
          name: "Closed Anchor",
          availability: "draft",
          isVisible: false,
        },
        {
          _id: "product-hidden",
          storeId: "store-a",
          categoryId: "category-store-a",
          description: "Hidden anchor",
          name: "Hidden Anchor",
          availability: "draft",
          isVisible: false,
        },
        {
          _id: "product-archived",
          storeId: "store-a",
          categoryId: "category-store-a",
          description: "Archived anchor",
          name: "Archived Anchor",
          availability: "archived",
          isVisible: false,
        },
      ],
      productSku: [
        {
          _id: "sku-trusted",
          storeId: "store-a",
          productId: "product-trusted",
          sku: "ATHENA-CLOSURE",
          barcode: "123PROV",
          images: [],
          isVisible: true,
          price: 85000,
          quantityAvailable: 14,
        },
        {
          _id: "sku-provisional",
          storeId: "store-a",
          productId: "product-provisional",
          sku: "ATHENA-PROVISIONAL-CLOSURE",
          barcode: "",
          images: [],
          isVisible: true,
          price: 85000,
          quantityAvailable: 12,
        },
        {
          _id: "sku-finalized",
          storeId: "store-a",
          productId: "product-finalized",
          sku: "ANCHOR-FINALIZED",
          barcode: "",
          images: [],
          isVisible: false,
          price: 0,
          quantityAvailable: 0,
        },
        {
          _id: "sku-hidden",
          storeId: "store-a",
          productId: "product-hidden",
          sku: "ANCHOR-HIDDEN",
          barcode: "",
          images: [],
          isVisible: false,
          price: 0,
          quantityAvailable: 0,
        },
        {
          _id: "sku-archived",
          storeId: "store-a",
          productId: "product-archived",
          sku: "ARCHIVED-ANCHOR",
          barcode: "",
          images: [],
          isVisible: false,
          price: 0,
          quantityAvailable: 0,
        },
      ],
    });

    await expect(
      listRegisterCatalog(ctx, {
        storeId: "store-a" as Id<"store">,
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        productSkuId: "sku-trusted",
        name: "Imported Closure",
        sku: "ATHENA-CLOSURE",
        barcode: "123PROV",
        price: 85000,
        availabilityPolicy: "trusted_inventory",
      }),
      expect.objectContaining({
        productSkuId: "sku-provisional",
        inventoryImportProvisionalSkuId: "provisional-sku-1",
        name: "Imported Closure",
        sku: "ATHENA-PROVISIONAL-CLOSURE",
        barcode: "123PROV",
        price: 85000,
        availabilityPolicy: "active_provisional_import",
      }),
    ]);

    await expect(
      listRegisterCatalogAvailability(ctx, {
        storeId: "store-a" as Id<"store">,
        productSkuIds: [
          "sku-trusted",
          "sku-provisional",
          "sku-archived",
        ] as Array<Id<"productSku">>,
      }),
    ).resolves.toEqual([
      {
        productSkuId: "sku-trusted",
        skuId: "sku-trusted",
        inStock: true,
        quantityAvailable: 14,
        availabilityPolicy: "trusted_inventory",
      },
      {
        productSkuId: "sku-provisional",
        skuId: "sku-provisional",
        inventoryImportProvisionalSkuId: "provisional-sku-1",
        inStock: true,
        quantityAvailable: 0,
        availabilityPolicy: "active_provisional_import",
      },
    ]);

    await expect(
      listRegisterCatalogAvailabilitySnapshot(ctx, {
        storeId: "store-a" as Id<"store">,
      }),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          productSkuId: "sku-trusted",
          availabilityPolicy: "trusted_inventory",
          inStock: true,
          quantityAvailable: 14,
        }),
        expect.objectContaining({
          productSkuId: "sku-provisional",
          inventoryImportProvisionalSkuId: "provisional-sku-1",
          availabilityPolicy: "active_provisional_import",
          inStock: true,
        }),
      ]),
    );
    await expect(
      listRegisterCatalogAvailabilitySnapshot(ctx, {
        storeId: "store-a" as Id<"store">,
      }),
    ).resolves.not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          productSkuId: "sku-archived",
        }),
      ]),
    );
  });

  it("uses trusted POS policy after product-page provisional import finalization", async () => {
    const { ctx } = createRegisterCatalogCtx({
      category: [
        {
          _id: "category-store-a",
          storeId: "store-a",
          name: "Legacy import",
          slug: "legacy-import",
        },
      ],
      inventoryImportProvisionalSku: [
        {
          _id: "provisional-finalized-product-page",
          storeId: "store-a",
          status: "finalized",
          posExposureStatus: "hidden",
          productId: "product-finalized",
          productSkuId: "sku-finalized",
          importedProductName: "Reviewed Closure",
          importedSku: "LEGACY-CLOSURE",
          importedBarcode: "123FINAL",
          importedPrice: 85000,
          importedQuantity: 12,
          finalTrustedQuantity: 10,
          provisionalSoldQuantityAtFinalization: 2,
        },
      ],
      product: [
        {
          _id: "product-finalized",
          storeId: "store-a",
          categoryId: "category-store-a",
          description: "Reviewed import anchor",
          name: "Reviewed Closure",
          availability: "draft",
          isVisible: false,
        },
      ],
      productSku: [
        {
          _id: "sku-finalized",
          storeId: "store-a",
          productId: "product-finalized",
          sku: "ATHENA-FINALIZED-CLOSURE",
          barcode: "123FINAL",
          images: [],
          isVisible: true,
          price: 85000,
          quantityAvailable: 8,
        },
      ],
    });

    await expect(
      listRegisterCatalog(ctx, {
        storeId: "store-a" as Id<"store">,
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        productSkuId: "sku-finalized",
        name: "Reviewed Closure",
        sku: "ATHENA-FINALIZED-CLOSURE",
        barcode: "123FINAL",
        price: 85000,
        availabilityPolicy: "trusted_inventory",
      }),
    ]);

    const availability = await listRegisterCatalogAvailability(ctx, {
      storeId: "store-a" as Id<"store">,
      productSkuIds: ["sku-finalized"] as Array<Id<"productSku">>,
    });
    expect(availability).toEqual([
      {
        productSkuId: "sku-finalized",
        skuId: "sku-finalized",
        inStock: true,
        quantityAvailable: 8,
        availabilityPolicy: "trusted_inventory",
      },
    ]);
    expect(availability[0]).not.toHaveProperty(
      "inventoryImportProvisionalSkuId",
    );

    const snapshot = await listRegisterCatalogAvailabilitySnapshot(ctx, {
      storeId: "store-a" as Id<"store">,
    });
    expect(snapshot).toEqual([
      expect.objectContaining({
        productSkuId: "sku-finalized",
        availabilityPolicy: "trusted_inventory",
        inStock: true,
        quantityAvailable: 8,
      }),
    ]);
    expect(snapshot[0]).not.toHaveProperty("inventoryImportProvisionalSkuId");
  });

  it("does not rely on pagination for large register catalog snapshots", async () => {
    const products = Array.from({ length: 505 }, (_, index) => ({
      _id: `product-${index}`,
      storeId: "store-a",
      categoryId: "category-store-a",
      description: "",
      name: index === 504 ? "Club" : `Product ${index}`,
    }));
    const productSkus = products.map((product, index) => ({
      _id: `sku-${index}`,
      storeId: "store-a",
      productId: product._id,
      sku: `SKU-${index}`,
      barcode: "",
      images: [],
      netPrice: 1000 + index,
      price: 1100 + index,
      quantityAvailable: 5,
    }));
    const { ctx } = createRegisterCatalogCtx(
      {
        category: [
          {
            _id: "category-store-a",
            storeId: "store-a",
            name: "General",
            slug: "general",
          },
        ],
        product: products,
        productSku: productSkus,
      },
      { asyncIteratorLimit: 30, failOnPaginate: true },
    );

    const rows = await listRegisterCatalog(ctx, {
      storeId: "store-a" as Id<"store">,
    });

    expect(rows).toHaveLength(505);
    expect(rows.at(-1)).toMatchObject({
      productSkuId: "sku-504",
      name: "Club",
      price: 1504,
    });
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
      inventoryImportProvisionalSku: [
        {
          _id: "provisional-sku-out",
          storeId: "store-a",
          status: "active",
          productId: "product-out",
          productSkuId: "sku-out",
          importedProductName: "Out Wig",
          importedPrice: 100,
          importedQuantity: 10,
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
        {
          _id: "sku-pending-checkout",
          storeId: "store-a",
          productId: "product-pending-checkout",
          sku: "PENDING-CHECKOUT",
          quantityAvailable: 0,
        },
      ],
      posPendingCheckoutItem: [
        {
          _id: "pending-checkout-1",
          storeId: "store-a",
          status: "pending_review",
          provisionalProductSkuId: "sku-pending-checkout",
          provisionalPrice: 100,
        },
      ],
    });

    const rows = await listRegisterCatalogAvailability(ctx, {
      storeId: "store-a" as Id<"store">,
      productSkuIds: [
        "sku-live",
        "sku-out",
        "sku-pending-checkout",
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
        availabilityPolicy: "trusted_inventory",
      },
      {
        productSkuId: "sku-out",
        skuId: "sku-out",
        inventoryImportProvisionalSkuId: "provisional-sku-out",
        inStock: true,
        quantityAvailable: 0,
        availabilityPolicy: "active_provisional_import",
      },
      {
        productSkuId: "sku-pending-checkout",
        skuId: "sku-pending-checkout",
        inStock: true,
        quantityAvailable: 0,
        availabilityPolicy: "pending_checkout",
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
      productSkuIds: productSkus.map((sku) => sku._id as Id<"productSku">),
    });

    expect(rows).toHaveLength(50);
    expect(rows.at(-1)).toMatchObject({
      productSkuId: "sku-49",
      quantityAvailable: 1,
      availabilityPolicy: "trusted_inventory",
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
        {
          _id: "category-pos-pending-checkout",
          storeId: "store-a",
          name: "POS pending checkout",
          slug: "pos-pending-checkout",
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
      inventoryImportProvisionalSku: [
        {
          _id: "provisional-sku-out",
          storeId: "store-a",
          status: "active",
          productId: "product-out",
          productSkuId: "sku-out",
          importedProductName: "Out Wig",
          importedPrice: 100,
          importedQuantity: 10,
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
        {
          _id: "product-pending-checkout",
          storeId: "store-a",
          categoryId: "category-pos-pending-checkout",
          name: "Pending Checkout Item",
          availability: "draft",
          isVisible: false,
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
        {
          _id: "sku-pending-checkout",
          storeId: "store-a",
          productId: "product-pending-checkout",
          sku: "PENDING-CHECKOUT",
          images: [],
          isVisible: false,
          price: 100,
          quantityAvailable: 0,
        },
      ],
      posPendingCheckoutItem: [
        {
          _id: "pending-checkout-1",
          storeId: "store-a",
          status: "pending_review",
          provisionalProductSkuId: "sku-pending-checkout",
          provisionalPrice: 100,
        },
      ],
    });

    const rows = await listRegisterCatalogAvailabilitySnapshot(ctx, {
      storeId: "store-a" as Id<"store">,
    });

    expect(rows).toEqual(
      expect.arrayContaining([
        {
          productSkuId: "sku-live",
          skuId: "sku-live",
          inStock: true,
          quantityAvailable: 2,
          availabilityPolicy: "trusted_inventory",
        },
        {
          productSkuId: "sku-out",
          skuId: "sku-out",
          inStock: false,
          quantityAvailable: 0,
          availabilityPolicy: "trusted_inventory",
        },
        {
          productSkuId: "sku-out",
          skuId: "sku-out",
          inventoryImportProvisionalSkuId: "provisional-sku-out",
          inStock: true,
          quantityAvailable: 0,
          availabilityPolicy: "active_provisional_import",
        },
        {
          productSkuId: "sku-pending-checkout",
          skuId: "sku-pending-checkout",
          inStock: true,
          quantityAvailable: 0,
          availabilityPolicy: "pending_checkout",
        },
      ]),
    );
    expect(rows).toHaveLength(4);
  });

  it("does not read category metadata for normal live SKUs in the full availability snapshot", async () => {
    const productCount = 1_000;
    const products = Array.from({ length: productCount }, (_, index) => ({
      _id: `product-${index}`,
      storeId: "store-a",
      categoryId: "category-store-a",
      name: `Product ${index}`,
    }));
    const productSkus = products.map((product, index) => ({
      _id: `sku-${index}`,
      storeId: "store-a",
      productId: product._id,
      sku: `SKU-${index}`,
      price: 100,
      quantityAvailable: 3,
    }));
    const { ctx, readCounts } = createRegisterCatalogCtx({
      category: [
        {
          _id: "category-store-a",
          storeId: "store-a",
          name: "General",
          slug: "general",
        },
      ],
      product: products,
      productSku: productSkus,
    });

    const rows = await listRegisterCatalogAvailabilitySnapshot(ctx, {
      storeId: "store-a" as Id<"store">,
    });

    expect(rows).toHaveLength(productCount);
    expect(readCounts.category).toBe(0);
    expect(
      Object.values(readCounts).reduce((total, count) => total + count, 0),
    ).toBeLessThan(2_050);
  });
});
