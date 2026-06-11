import { describe, expect, it } from "vitest";
import type { Id } from "../_generated/dataModel";

import {
  importInventoryRowsWithCtx,
  listInventoryImportReviewSkuContextWithCtx,
  saveInventoryImportReviewVersionWithCtx,
  stageInventoryImportReviewRowsForPosWithCtx,
} from "./catalogImport";

type TableName =
  | "athenaUser"
  | "category"
  | "inventoryImportProvisionalSku"
  | "inventoryImportReviewVersion"
  | "operationalEvent"
  | "product"
  | "productSku"
  | "store"
  | "subcategory";

type Row = Record<string, any> & { _id: string };

function createMutationCtx(seed: Partial<Record<TableName, Row[]>> = {}) {
  const tables: Record<TableName, Map<string, Row>> = {
    athenaUser: new Map(),
    category: new Map(),
    inventoryImportProvisionalSku: new Map(),
    inventoryImportReviewVersion: new Map(),
    operationalEvent: new Map(),
    product: new Map(),
    productSku: new Map(),
    store: new Map(),
    subcategory: new Map(),
  };
  const counters = new Map<TableName, number>();

  for (const [table, rows] of Object.entries(seed) as Array<[TableName, Row[]]>) {
    rows.forEach((row) => tables[table].set(row._id, row));
  }

  function nextId(table: TableName) {
    const next = (counters.get(table) ?? tables[table].size) + 1;
    counters.set(table, next);
    return `${table}-${next}`;
  }

  function query(table: TableName) {
    let indexName: string | null = null;
    let orderDirection: "asc" | "desc" = "asc";
    const eqs: Record<string, unknown> = {};

    const api = {
      withIndex(name: string, callback: (q: any) => any) {
        indexName = name;
        const q = {
          eq(field: string, value: unknown) {
            eqs[field] = value;
            return q;
          },
        };
        callback(q);
        return api;
      },
      order(direction: "asc" | "desc") {
        orderDirection = direction;
        return api;
      },
      async first() {
        return api.take(1).then((rows) => rows[0] ?? null);
      },
      async take(limit: number) {
        return Array.from(tables[table].values())
          .filter((row) => {
            if (!indexName) return true;
            return Object.entries(eqs).every(([field, value]) => row[field] === value);
          })
          .sort((left, right) =>
            orderDirection === "desc"
              ? Number(right.createdAt ?? 0) - Number(left.createdAt ?? 0)
              : Number(left.createdAt ?? 0) - Number(right.createdAt ?? 0),
          )
          .slice(0, limit);
      },
      async collect() {
        return api.take(Number.MAX_SAFE_INTEGER);
      },
      async *[Symbol.asyncIterator]() {
        // eslint-disable-next-line @convex-dev/no-collect-in-query -- test fake, not a Convex query
        for (const row of await api.collect()) {
          yield row;
        }
      },
    };

    return api;
  }

  const ctx = {
    db: {
      async get(table: TableName, id: string) {
        return tables[table].get(id) ?? null;
      },
      async insert(table: TableName, row: Record<string, any>) {
        const id = nextId(table);
        tables[table].set(id, { ...row, _id: id });
        return id;
      },
      async patch(table: TableName, id: string, patch: Record<string, any>) {
        const existing = tables[table].get(id);
        if (!existing) throw new Error(`${table} ${id} missing`);
        tables[table].set(id, { ...existing, ...patch });
      },
      query,
    },
  };

  return { ctx: ctx as any, tables };
}

const access = {
  athenaUser: {
    _id: "user-1" as Id<"athenaUser">,
    email: "owner@example.com",
    firstName: "Store",
    lastName: "Owner",
  } as any,
  store: {
    _id: "store-1" as Id<"store">,
    organizationId: "org-1" as Id<"organization">,
  } as any,
};

describe("catalog import", () => {
  it("creates categories, products, skus, and a batch operational event", async () => {
    const { ctx, tables } = createMutationCtx();

    const summary = await importInventoryRowsWithCtx(
      ctx,
      {
        importKey: "legacy-smartpos-1",
        rows: [
          {
            rowNumber: 2,
            productName: "Body Wave",
            category: "Hair",
            subcategory: "Wigs",
            sku: "BW-18",
            barcode: "123456789012",
            price: 45000,
            quantity: 6,
            color: "Natural",
          },
        ],
        sourceFormat: "csv",
        storeId: "store-1" as Id<"store">,
      },
      access,
    );

    expect(summary).toMatchObject({
      categoriesCreated: 1,
      productsCreated: 1,
      rowsImported: 1,
      skusCreated: 1,
      subcategoriesCreated: 1,
    });
    expect(Array.from(tables.product.values())[0]).toMatchObject({
      inventoryCount: 6,
      name: "Body Wave",
      quantityAvailable: 6,
    });
    expect(Array.from(tables.productSku.values())[0]).toMatchObject({
      barcode: "123456789012",
      inventoryCount: 6,
      price: 45000,
      quantityAvailable: 6,
      sku: "BW-18",
    });
    expect(Array.from(tables.operationalEvent.values())[0]).toMatchObject({
      eventType: "inventory_import_applied",
      subjectId: "legacy-smartpos-1",
      subjectType: "inventory_import",
    });
  });

  it("updates existing SKUs by barcode and returns the prior result for repeated import keys", async () => {
    const { ctx, tables } = createMutationCtx({
      category: [
        {
          _id: "category-1",
          name: "Hair",
          slug: "hair",
          storeId: "store-1",
        },
      ],
      subcategory: [
        {
          _id: "subcategory-1",
          categoryId: "category-1",
          name: "Wigs",
          slug: "wigs",
          storeId: "store-1",
        },
      ],
      product: [
        {
          _id: "product-1",
          availability: "live",
          categoryId: "category-1",
          createdByUserId: "user-1",
          currency: "GHS",
          inventoryCount: 2,
          name: "Body Wave",
          organizationId: "org-1",
          quantityAvailable: 2,
          slug: "body-wave",
          storeId: "store-1",
          subcategoryId: "subcategory-1",
        },
      ],
      productSku: [
        {
          _id: "sku-1",
          barcode: "123456789012",
          images: [],
          inventoryCount: 2,
          price: 30000,
          productId: "product-1",
          productName: "Body Wave",
          quantityAvailable: 2,
          sku: "BW-18",
          storeId: "store-1",
        },
      ],
    });

    const args = {
      importKey: "legacy-smartpos-2",
      rows: [
        {
          rowNumber: 2,
          productName: "Body Wave",
          category: "Hair",
          subcategory: "Wigs",
          sku: "BW-18",
          barcode: "123456789012",
          price: 50000,
          quantity: 9,
        },
      ],
      sourceFormat: "json" as const,
      storeId: "store-1" as Id<"store">,
    };

    const first = await importInventoryRowsWithCtx(ctx, args, access);
    const second = await importInventoryRowsWithCtx(ctx, args, access);

    expect(first.skusUpdated).toBe(1);
    expect(second).toMatchObject({ alreadyApplied: true, skusUpdated: 1 });
    expect(tables.productSku.get("sku-1")).toMatchObject({
      inventoryCount: 9,
      price: 50000,
      quantityAvailable: 9,
    });
    expect(tables.product.size).toBe(1);
    expect(tables.operationalEvent.size).toBe(1);
  });

  it("imports sparse rows by applying fallback Athena fields", async () => {
    const { ctx, tables } = createMutationCtx();

    const summary = await importInventoryRowsWithCtx(
      ctx,
      {
        importKey: "legacy-sparse-1",
        rows: [
          {
            rowNumber: 2,
            productName: "",
            category: "Accessories",
            sku: "",
            price: -1,
            quantity: -3,
          },
        ],
        sourceFormat: "csv",
        storeId: "store-1" as Id<"store">,
      },
      access,
    );

    expect(summary.rowsImported).toBe(1);
    expect(Array.from(tables.product.values())[0]).toMatchObject({
      name: "Imported row 2",
      inventoryCount: 0,
      quantityAvailable: 0,
    });
    expect(Array.from(tables.productSku.values())[0]).toMatchObject({
      inventoryCount: 0,
      price: 0,
      productName: "Imported row 2",
      quantityAvailable: 0,
      sku: "legacy-row-2",
    });
  });

  it("lists Athena SKU context for the inventory import review overlay", async () => {
    const { ctx } = createMutationCtx({
      product: [
        {
          _id: "product-1",
          availability: "live",
          categoryId: "category-1",
          createdByUserId: "user-1",
          currency: "GHS",
          inventoryCount: 7,
          name: "Body Wave",
          organizationId: "org-1",
          quantityAvailable: 5,
          slug: "body-wave",
          storeId: "store-1",
          subcategoryId: "subcategory-1",
        },
      ],
      productSku: [
        {
          _id: "sku-1",
          barcode: "123456789012",
          images: [],
          inventoryCount: 7,
          netPrice: 45000,
          price: 45900,
          productId: "product-1",
          productName: "Body Wave fallback",
          quantityAvailable: 5,
          sku: "BW-18",
          storeId: "store-1",
        },
        {
          _id: "sku-2",
          barcode: "999",
          images: [],
          inventoryCount: 1,
          price: 30000,
          productId: "missing-product",
          productName: "Fallback SKU",
          quantityAvailable: 1,
          sku: "FALLBACK-1",
          storeId: "store-1",
        },
      ],
    });

    const rows = await listInventoryImportReviewSkuContextWithCtx(
      ctx,
      { storeId: "store-1" as Id<"store"> },
      access,
    );

    expect(rows).toEqual([
      expect.objectContaining({
        barcode: "123456789012",
        inventoryCount: 7,
        price: 45000,
        productAvailability: "live",
        productName: "Body Wave",
        productSkuId: "sku-1",
        quantityAvailable: 5,
        sku: "BW-18",
      }),
      expect.objectContaining({
        productName: "Fallback SKU",
        productSkuId: "sku-2",
      }),
    ]);
  });

  it("saves import review versions as server snapshots", async () => {
    const { ctx, tables } = createMutationCtx({
      inventoryImportReviewVersion: [
        {
          _id: "review-version-1",
          createdAt: 100,
          createdByUserId: "user-1",
          importKey: "legacy-review-1",
          issueCount: 0,
          organizationId: "org-1",
          rawContent: "product_name,sku,price,qty\nOld,OLD-1,10,1",
          rowCount: 1,
          sourceFormat: "csv",
          storeId: "store-1",
          versionNumber: 1,
        },
      ],
    });

    const saved = await saveInventoryImportReviewVersionWithCtx(ctx, {
      fileName: "products.csv",
      importKey: "legacy-review-2",
      issueCount: 0,
      notes: "Review before apply.",
      rawContent: "product_name,sku,price,qty\nComb,COMB-1,25,4",
      rowDecisions: [
        {
          priceSource: "athena",
          productName: "Comb",
          quantitySource: "import",
          rowKey: "2:COMB-1::Comb",
          rowNumber: 2,
        },
      ],
      rowCount: 1,
      sourceFormat: "csv",
      storeId: "store-1" as Id<"store">,
    }, access);

    expect(saved).toMatchObject({
      fileName: "products.csv",
      rowCount: 1,
      sourceFormat: "csv",
      versionNumber: 2,
    });
    expect(tables.inventoryImportReviewVersion.get(saved._id)).toMatchObject({
      createdByUserId: "user-1",
      importKey: "legacy-review-2",
      notes: "Review before apply.",
      rawContent: "product_name,sku,price,qty\nComb,COMB-1,25,4",
      rowDecisions: [
        expect.objectContaining({
          priceSource: "athena",
          quantitySource: "import",
          rowKey: "2:COMB-1::Comb",
        }),
      ],
      storeId: "store-1",
      versionNumber: 2,
    });
    expect(Array.from(tables.operationalEvent.values())[0]).toMatchObject({
      eventType: "inventory_import_review_version_saved",
      subjectId: saved._id,
      subjectType: "inventory_import_review_version",
    });
  });

  it("stages saved review rows as active provisional POS rows without applying trusted counts", async () => {
    const { ctx, tables } = createMutationCtx({
      inventoryImportReviewVersion: [
        {
          _id: "review-version-1",
          createdAt: 100,
          createdByUserId: "user-1",
          importKey: "legacy-review-1",
          issueCount: 0,
          organizationId: "org-1",
          rawContent: "product_name,sku,price,qty\nBody Wave,LEGACY-BODY-WAVE,450,6",
          rowCount: 1,
          sourceFormat: "csv",
          storeId: "store-1",
          versionNumber: 1,
        },
      ],
      product: [
        {
          _id: "product-1",
          availability: "live",
          categoryId: "category-1",
          createdByUserId: "user-1",
          currency: "GHS",
          inventoryCount: 2,
          name: "Body Wave",
          organizationId: "org-1",
          quantityAvailable: 2,
          slug: "body-wave",
          storeId: "store-1",
          subcategoryId: "subcategory-1",
        },
      ],
      productSku: [
        {
          _id: "sku-1",
          barcode: "123456789012",
          images: [],
          inventoryCount: 2,
          price: 30000,
          productId: "product-1",
          productName: "Body Wave",
          quantityAvailable: 2,
          sku: "BW-18",
          storeId: "store-1",
        },
      ],
    });

    const staged = await stageInventoryImportReviewRowsForPosWithCtx(ctx, {
      importKey: "legacy-review-1",
      reviewVersionId: "review-version-1" as Id<"inventoryImportReviewVersion">,
      rows: [
        {
          barcode: "123456789012",
          price: 45000,
          productId: "product-1" as Id<"product">,
          productName: "Body Wave imported",
          productSkuId: "sku-1" as Id<"productSku">,
          quantity: 6,
          rowKey: "2:LEGACY-BODY-WAVE:123456789012:Body Wave imported",
          rowNumber: 2,
          sku: "LEGACY-BODY-WAVE",
        },
      ],
      sourceFormat: "csv",
      storeId: "store-1" as Id<"store">,
    }, access);

    expect(staged).toMatchObject({
      alreadyStaged: false,
      catalogIdentitiesCreated: 0,
      provisionalRowsCreated: 1,
      provisionalRowsUpdated: 0,
      rowsSkipped: 0,
      trustedStockRowsUpdated: 0,
    });
    const provisionalRow = Array.from(tables.inventoryImportProvisionalSku.values())[0];
    expect(provisionalRow).toMatchObject({
      importKey: "legacy-review-1",
      importedBarcode: "123456789012",
      importedPrice: 45000,
      importedProductName: "Body Wave imported",
      importedQuantity: 6,
      importedSku: "BW-18",
      posExposureStatus: "available",
      reviewVersionId: "review-version-1",
      rowKey: "2:LEGACY-BODY-WAVE:123456789012:Body Wave imported",
      status: "active",
      storeId: "store-1",
    });
    expect(provisionalRow.productId).toBe("product-1");
    expect(provisionalRow.productSkuId).toBe("sku-1");
    expect(tables.product.size).toBe(1);
    expect(tables.productSku.size).toBe(1);
    expect(tables.productSku.get("sku-1")).toMatchObject({
      inventoryCount: 2,
      quantityAvailable: 2,
    });
    expect(Array.from(tables.operationalEvent.values())[0]).toMatchObject({
      eventType: "inventory_import_provisional_pos_staged",
      subjectId: "review-version-1",
      subjectType: "inventory_import_review_version",
    });
  });

  it("finalizes staged provisional rows when the trusted import is applied", async () => {
    const { ctx, tables } = createMutationCtx({
      category: [
        {
          _id: "category-1",
          name: "Hair",
          slug: "hair",
          storeId: "store-1",
        },
      ],
      inventoryImportProvisionalSku: [
        {
          _id: "provisional-1",
          createdAt: 100,
          createdByUserId: "user-1",
          importKey: "legacy-review-1",
          importedPrice: 45000,
          importedProductName: "Body Wave imported",
          importedQuantity: 6,
          normalizedImportedProductName: "body wave imported",
          organizationId: "org-1",
          posExposureStatus: "available",
          productId: "product-1",
          productSkuId: "sku-1",
          reviewVersionId: "review-version-1",
          reviewVersionNumber: 1,
          rowKey: "2:BW-18:123456789012:Body Wave imported",
          rowNumber: 2,
          saleEvidence: {
            saleCount: 1,
            totalQuantitySold: 2,
          },
          sourceFormat: "csv",
          status: "active",
          storeId: "store-1",
          updatedAt: 100,
        },
      ],
      product: [
        {
          _id: "product-1",
          availability: "live",
          categoryId: "category-1",
          createdByUserId: "user-1",
          currency: "GHS",
          inventoryCount: 2,
          name: "Body Wave",
          organizationId: "org-1",
          quantityAvailable: 2,
          slug: "body-wave",
          storeId: "store-1",
          subcategoryId: "subcategory-1",
        },
      ],
      productSku: [
        {
          _id: "sku-1",
          barcode: "123456789012",
          images: [],
          inventoryCount: 2,
          price: 30000,
          productId: "product-1",
          productName: "Body Wave",
          quantityAvailable: 2,
          sku: "BW-18",
          storeId: "store-1",
        },
      ],
      subcategory: [
        {
          _id: "subcategory-1",
          categoryId: "category-1",
          name: "Wigs",
          slug: "wigs",
          storeId: "store-1",
        },
      ],
    });

    const summary = await importInventoryRowsWithCtx(
      ctx,
      {
        importKey: "legacy-review-1",
        rows: [
          {
            barcode: "123456789012",
            category: "Hair",
            price: 50000,
            productName: "Body Wave",
            quantity: 9,
            rowNumber: 2,
            sku: "BW-18",
            subcategory: "Wigs",
          },
        ],
        sourceFormat: "csv",
        storeId: "store-1" as Id<"store">,
      },
      access,
    );

    expect(summary.skusUpdated).toBe(1);
    expect(tables.productSku.get("sku-1")).toMatchObject({
      inventoryCount: 7,
      quantityAvailable: 7,
    });
    expect(tables.inventoryImportProvisionalSku.get("provisional-1")).toMatchObject({
      finalTrustedQuantity: 7,
      finalizedByUserId: "user-1",
      posExposureStatus: "hidden",
      provisionalSoldQuantityAtFinalization: 2,
      status: "finalized",
    });
  });

  it("rejects trusted import before stock mutation when too many provisional rows must finalize", async () => {
    const provisionalRows = Array.from({ length: 5001 }, (_, index) => ({
      _id: `provisional-${index}`,
      createdAt: 100,
      createdByUserId: "user-1",
      importKey: "legacy-review-large",
      importedPrice: 45000,
      importedProductName: `Imported row ${index}`,
      importedQuantity: 1,
      normalizedImportedProductName: `imported row ${index}`,
      organizationId: "org-1",
      posExposureStatus: "available",
      productId: "product-1",
      productSkuId: "sku-1",
      reviewVersionId: "review-version-1",
      reviewVersionNumber: 1,
      rowKey: `row-${index}`,
      rowNumber: index + 2,
      saleEvidence: {
        saleCount: 0,
        totalQuantitySold: 0,
      },
      sourceFormat: "csv",
      status: "active",
      storeId: "store-1",
      updatedAt: 100,
    }));
    const { ctx, tables } = createMutationCtx({
      inventoryImportProvisionalSku: provisionalRows,
      product: [
        {
          _id: "product-1",
          availability: "live",
          categoryId: "category-1",
          createdByUserId: "user-1",
          currency: "GHS",
          inventoryCount: 2,
          name: "Body Wave",
          organizationId: "org-1",
          quantityAvailable: 2,
          slug: "body-wave",
          storeId: "store-1",
          subcategoryId: "subcategory-1",
        },
      ],
      productSku: [
        {
          _id: "sku-1",
          barcode: "123456789012",
          images: [],
          inventoryCount: 2,
          price: 30000,
          productId: "product-1",
          productName: "Body Wave",
          quantityAvailable: 2,
          sku: "BW-18",
          storeId: "store-1",
        },
      ],
    });

    await expect(
      importInventoryRowsWithCtx(
        ctx,
        {
          importKey: "legacy-review-large",
          rows: [
            {
              barcode: "123456789012",
              price: 50000,
              productName: "Body Wave",
              quantity: 9,
              rowNumber: 2,
              sku: "BW-18",
            },
          ],
          sourceFormat: "csv",
          storeId: "store-1" as Id<"store">,
        },
        access,
      ),
    ).rejects.toThrow("more than 5000 active provisional POS rows");

    expect(tables.productSku.get("sku-1")).toMatchObject({
      inventoryCount: 2,
      quantityAvailable: 2,
    });
    expect(tables.operationalEvent.size).toBe(0);
  });

  it("creates hidden catalog identity for new staged rows while keeping imported counts provisional", async () => {
    const { ctx, tables } = createMutationCtx({
      inventoryImportReviewVersion: [
        {
          _id: "review-version-1",
          createdAt: 100,
          createdByUserId: "user-1",
          importKey: "legacy-review-1",
          issueCount: 0,
          organizationId: "org-1",
          rawContent: "product_name,sku,price,qty\nComb,COMB-1,25,4",
          rowCount: 1,
          sourceFormat: "csv",
          storeId: "store-1",
          versionNumber: 1,
        },
      ],
    });

    const staged = await stageInventoryImportReviewRowsForPosWithCtx(ctx, {
      importKey: "legacy-review-1",
      reviewVersionId: "review-version-1" as Id<"inventoryImportReviewVersion">,
      rows: [
        {
          category: "Accessories",
          price: 2500,
          productName: "Comb",
          quantity: 4,
          rowKey: "2:COMB-1::Comb",
          rowNumber: 2,
          sku: "COMB-1",
        },
      ],
      sourceFormat: "csv",
      storeId: "store-1" as Id<"store">,
    }, access);

    const product = Array.from(tables.product.values())[0];
    const sku = Array.from(tables.productSku.values())[0];

    expect(staged).toMatchObject({
      catalogIdentitiesCreated: 1,
      provisionalRowsCreated: 1,
      trustedStockRowsUpdated: 0,
    });
    expect(product).toMatchObject({
      availability: "draft",
      inventoryCount: 0,
      isVisible: false,
      name: "Comb",
      quantityAvailable: 0,
    });
    expect(sku).toMatchObject({
      inventoryCount: 0,
      isVisible: false,
      price: 2500,
      productId: product._id,
      quantityAvailable: 0,
    });
    expect(sku.sku).toMatch(/^[A-Z0-9]+-[A-Z0-9]+-[A-Z0-9]+$/);
    expect(sku.sku).not.toBe("COMB-1");
    expect(Array.from(tables.inventoryImportProvisionalSku.values())[0]).toMatchObject({
      importedQuantity: 4,
      importedSku: sku.sku,
      productId: product._id,
      productSkuId: sku._id,
      status: "active",
    });
  });

  it("does not mutate a trusted product when creating a provisional catalog identity with the same name", async () => {
    const { ctx, tables } = createMutationCtx({
      category: [
        {
          _id: "category-1",
          name: "Accessories",
          storeId: "store-1",
        },
      ],
      inventoryImportReviewVersion: [
        {
          _id: "review-version-1",
          createdAt: 100,
          createdByUserId: "user-1",
          importKey: "legacy-review-1",
          issueCount: 0,
          organizationId: "org-1",
          rawContent: "product_name,sku,price,qty\nComb,COMB-1,25,4",
          rowCount: 1,
          sourceFormat: "csv",
          storeId: "store-1",
          versionNumber: 1,
        },
      ],
      product: [
        {
          _id: "trusted-product-1",
          availability: "in_stock",
          categoryId: "category-1",
          inventoryCount: 8,
          isVisible: true,
          name: "Comb",
          quantityAvailable: 8,
          storeId: "store-1",
          subcategoryId: "subcategory-1",
        },
      ],
      productSku: [
        {
          _id: "trusted-sku-1",
          inventoryCount: 8,
          isVisible: true,
          price: 3000,
          productId: "trusted-product-1",
          productName: "Comb",
          quantityAvailable: 8,
          sku: "TRUSTED-COMB",
          storeId: "store-1",
        },
      ],
      subcategory: [
        {
          _id: "subcategory-1",
          categoryId: "category-1",
          name: "General",
          storeId: "store-1",
        },
      ],
    });

    const staged = await stageInventoryImportReviewRowsForPosWithCtx(ctx, {
      importKey: "legacy-review-1",
      reviewVersionId: "review-version-1" as Id<"inventoryImportReviewVersion">,
      rows: [
        {
          category: "Accessories",
          price: 2500,
          productName: "Comb",
          quantity: 4,
          rowKey: "2:COMB-1::Comb",
          rowNumber: 2,
          sku: "COMB-1",
          subcategory: "General",
        },
      ],
      sourceFormat: "csv",
      storeId: "store-1" as Id<"store">,
    }, access);

    expect(staged).toMatchObject({
      catalogIdentitiesCreated: 1,
      provisionalRowsCreated: 1,
      trustedStockRowsUpdated: 0,
    });
    expect(tables.product.get("trusted-product-1")).toMatchObject({
      availability: "in_stock",
      inventoryCount: 8,
      isVisible: true,
      quantityAvailable: 8,
    });
    expect(tables.productSku.get("trusted-sku-1")).toMatchObject({
      inventoryCount: 8,
      isVisible: true,
      quantityAvailable: 8,
    });
    expect(tables.product.size).toBe(2);
    const provisionalProduct = Array.from(tables.product.values()).find(
      (product) => product._id !== "trusted-product-1",
    );
    expect(provisionalProduct).toMatchObject({
      availability: "draft",
      inventoryCount: 0,
      isVisible: false,
      name: "Comb",
      quantityAvailable: 0,
    });
    expect(Array.from(tables.inventoryImportProvisionalSku.values())[0]).toMatchObject({
      productId: provisionalProduct?._id,
      status: "active",
    });
  });

  it("updates existing provisional rows by store/import row key and skips skipped review rows", async () => {
    const { ctx, tables } = createMutationCtx({
      inventoryImportReviewVersion: [
        {
          _id: "review-version-1",
          createdAt: 100,
          createdByUserId: "user-1",
          importKey: "legacy-review-1",
          issueCount: 0,
          organizationId: "org-1",
          rawContent: "product_name,sku,price,qty\nComb,COMB-1,25,4",
          rowCount: 2,
          sourceFormat: "csv",
          storeId: "store-1",
          versionNumber: 1,
        },
      ],
    });
    const args = {
      importKey: "legacy-review-1",
      reviewVersionId: "review-version-1" as Id<"inventoryImportReviewVersion">,
      rows: [
        {
          price: 2500,
          productName: "Comb",
          quantity: 4,
          rowKey: "2:COMB-1::Comb",
          rowNumber: 2,
          sku: "COMB-1",
        },
        {
          action: "skip_row" as const,
          price: 9900,
          productName: "Skip Me",
          quantity: 1,
          rowKey: "3:SKIP::Skip Me",
          rowNumber: 3,
          sku: "SKIP",
        },
      ],
      sourceFormat: "csv" as const,
      storeId: "store-1" as Id<"store">,
    };

    const first = await stageInventoryImportReviewRowsForPosWithCtx(ctx, args, access);
    const second = await stageInventoryImportReviewRowsForPosWithCtx(ctx, {
      ...args,
      rows: [{ ...args.rows[0], price: 2700, quantity: 5 }, args.rows[1]],
    }, access);

    expect(first).toMatchObject({
      provisionalRowsCreated: 1,
      rowsSkipped: 1,
    });
    expect(second).toMatchObject({
      alreadyStaged: true,
      provisionalRowsCreated: 0,
      provisionalRowsUpdated: 1,
      rowsSkipped: 1,
    });
    expect(tables.inventoryImportProvisionalSku.size).toBe(1);
    expect(Array.from(tables.inventoryImportProvisionalSku.values())[0]).toMatchObject({
      importedPrice: 2700,
      importedQuantity: 5,
      rowKey: "2:COMB-1::Comb",
    });

    const closed = await stageInventoryImportReviewRowsForPosWithCtx(ctx, {
      ...args,
      rows: [{ ...args.rows[0], action: "skip_row" as const }],
    }, access);

    expect(closed).toMatchObject({
      alreadyStaged: true,
      provisionalRowsUpdated: 1,
      rowsSkipped: 1,
    });
    expect(Array.from(tables.inventoryImportProvisionalSku.values())[0]).toMatchObject({
      posExposureStatus: "hidden",
      status: "closed",
    });

    const notReopened = await stageInventoryImportReviewRowsForPosWithCtx(ctx, {
      ...args,
      rows: [{ ...args.rows[0], price: 3100, quantity: 9 }],
    }, access);

    expect(notReopened).toMatchObject({
      alreadyStaged: true,
      provisionalRowsUpdated: 0,
      rowsSkipped: 1,
    });
    expect(Array.from(tables.inventoryImportProvisionalSku.values())[0]).toMatchObject({
      importedPrice: 2700,
      importedQuantity: 5,
      status: "closed",
    });
  });

  it("requires terminal context when staging with manager elevation", async () => {
    const { ctx } = createMutationCtx({
      inventoryImportReviewVersion: [
        {
          _id: "review-version-1",
          createdAt: 100,
          createdByUserId: "user-1",
          importKey: "legacy-review-1",
          issueCount: 0,
          organizationId: "org-1",
          rawContent: "product_name,sku,price,qty\nComb,COMB-1,25,4",
          rowCount: 1,
          sourceFormat: "csv",
          storeId: "store-1",
          versionNumber: 1,
        },
      ],
    });

    await expect(
      stageInventoryImportReviewRowsForPosWithCtx(ctx, {
        importKey: "legacy-review-1",
        managerElevationId: "elevation-1" as Id<"managerElevation">,
        reviewVersionId:
          "review-version-1" as Id<"inventoryImportReviewVersion">,
        rows: [
          {
            price: 2500,
            productName: "Comb",
            quantity: 4,
            rowKey: "2:COMB-1::Comb",
            rowNumber: 2,
            sku: "COMB-1",
          },
        ],
        sourceFormat: "csv",
        storeId: "store-1" as Id<"store">,
      }, access),
    ).rejects.toThrow("Terminal context is required before using manager elevation.");
  });

  it("requires terminal context when using manager elevation for import review helpers", async () => {
    const { ctx } = createMutationCtx();

    await expect(
      saveInventoryImportReviewVersionWithCtx(ctx, {
        importKey: "legacy-review-1",
        issueCount: 0,
        managerElevationId: "elevation-1" as Id<"managerElevation">,
        rawContent: "product_name,sku,price,qty\nComb,COMB-1,25,4",
        rowCount: 1,
        sourceFormat: "csv",
        storeId: "store-1" as Id<"store">,
      }),
    ).rejects.toThrow("Terminal context is required before using manager elevation.");

    await expect(
      listInventoryImportReviewSkuContextWithCtx(ctx, {
        managerElevationId: "elevation-1" as Id<"managerElevation">,
        storeId: "store-1" as Id<"store">,
      }),
    ).rejects.toThrow("Terminal context is required before using manager elevation.");
  });
});
