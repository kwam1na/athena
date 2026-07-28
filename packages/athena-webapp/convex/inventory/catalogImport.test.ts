import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

const mockedSkuSearch = vi.hoisted(() => ({
  advanceRegisterCatalogRevision: vi.fn(),
  applyInventoryEffectWithCtx: vi.fn(),
  getSharedDemoActorWithCtx: vi.fn(),
  upsertProductSkuSearchProjection: vi.fn(),
  upsertProductSkuSearchProjections: vi.fn(),
}));

vi.mock("../pos/application/sync/registerCatalogRevision", () => ({
  advanceRegisterCatalogRevision:
    mockedSkuSearch.advanceRegisterCatalogRevision,
}));

vi.mock("../inventoryLedger/effects", () => ({
  applyInventoryEffectWithCtx: mockedSkuSearch.applyInventoryEffectWithCtx,
}));

vi.mock("../sharedDemo/actor", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../sharedDemo/actor")>()),
  getSharedDemoActorWithCtx: mockedSkuSearch.getSharedDemoActorWithCtx,
}));

vi.mock("./skuSearch", () => ({
  upsertProductSkuSearchProjection:
    mockedSkuSearch.upsertProductSkuSearchProjection,
  upsertProductSkuSearchProjections:
    mockedSkuSearch.upsertProductSkuSearchProjections,
}));

import {
  completeFinalizedLegacyImportRowsForProductTaxonomyWithCtx,
  finalizeInventoryImportReviewVersionPayloadWithCtx,
  finalizeTrustedInventoryFromProductPage,
  finalizeTrustedInventoryFromProductPageWithCtx,
  finalizeInventoryImportReviewVersionPayload,
  getLegacyInventoryImportReviewVersionInlineEnvelopeByteLength,
  getInventoryImportReviewVersionByIdWithCtx,
  getInventoryImportReviewVersionPayloadChunk,
  getInventoryImportReviewVersionPayloadChunkWithCtx,
  getLatestInventoryImportReviewVersion,
  getLatestInventoryImportReviewVersionMetadata,
  getLatestInventoryImportReviewVersionMetadataWithCtx,
  getLatestInventoryImportReviewVersionWithCtx,
  importInventory,
  importInventoryRowsWithCtx,
  listInventoryImportReviewSkuContext,
  listInventoryImportReviewSkuContextWithCtx,
  listProductPageProvisionalSkuBinding,
  listProductPageProvisionalSkuBindingWithCtx,
  repairOnboardedLegacyImportTrustedSkuVisibilityWithCtx,
  saveInventoryImportReviewVersion,
  saveInventoryImportReviewVersionWithCtx,
  stageInventoryImportReviewVersionPayloadChunkWithCtx,
  stageInventoryImportReviewVersionPayloadChunk,
  expireInventoryImportReviewVersionPayloadUpload,
  stageInventoryImportReviewRowsForPos,
  stageInventoryImportReviewRowsForPosWithCtx,
  LEGACY_INVENTORY_IMPORT_REVIEW_INLINE_ENVELOPE_MAX_BYTES,
  type ProductPageTrustedInventoryFinalizationArgs,
} from "./catalogImport";
import { assertConformsToExportedReturns } from "../lib/returnValidatorContract";

type TableName =
  | "athenaUser"
  | "catalogSummary"
  | "category"
  | "checkoutSession"
  | "checkoutSessionItem"
  | "inventoryHold"
  | "inventoryImportCostOverlayRow"
  | "inventoryImportCostOverlayRun"
  | "inventoryMovement"
  | "inventoryImportProvisionalSku"
  | "inventoryImportReviewVersionPayloadChunk"
  | "inventoryImportReviewVersionPayloadUpload"
  | "inventoryImportReviewVersion"
  | "operationalEvent"
  | "operationalWorkItem"
  | "product"
  | "productSku"
  | "skuActivityEvent"
  | "store"
  | "subcategory";

type Row = Record<string, any> & { _id: string };

beforeEach(() => {
  mockedSkuSearch.getSharedDemoActorWithCtx.mockReset();
  mockedSkuSearch.getSharedDemoActorWithCtx.mockResolvedValue(null);
  mockedSkuSearch.applyInventoryEffectWithCtx.mockReset();
  mockedSkuSearch.applyInventoryEffectWithCtx.mockImplementation(
    async (
      ctx: MutationCtx,
      args: {
        compatibilityBalance: {
          onHandQuantity: number;
          sellableQuantity: number;
        };
        physicalQuantityDelta: number;
        productSkuId: Id<"productSku">;
      },
    ) => {
      const testDb = ctx.db as unknown as {
        insert(table: string, value: Record<string, unknown>): Promise<string>;
      };
      await ctx.db.patch("productSku", args.productSkuId, {
        inventoryCount: args.compatibilityBalance.onHandQuantity,
        quantityAvailable: args.compatibilityBalance.sellableQuantity,
      });
      const movementId =
        args.physicalQuantityDelta === 0
          ? null
          : await testDb.insert("inventoryMovement", {
              productSkuId: args.productSkuId,
            });
      if (movementId) {
        await testDb.insert("skuActivityEvent", {
          activityType: "stock_provisional_import_finalization",
          inventoryMovementId: movementId,
          productSkuId: args.productSkuId,
          status: "committed",
        });
      }
      return {
        disposition: "inserted",
        mode: "compatibility_shadow",
        movement: movementId ? { _id: movementId } : null,
      };
    },
  );
  mockedSkuSearch.advanceRegisterCatalogRevision.mockReset();
  mockedSkuSearch.upsertProductSkuSearchProjection.mockReset();
  mockedSkuSearch.upsertProductSkuSearchProjections.mockReset();
});

function getHandler(definition: unknown) {
  return (definition as { _handler: Function })._handler;
}

function createMutationCtx(seed: Partial<Record<TableName, Row[]>> = {}) {
  const tables: Record<TableName, Map<string, Row>> = {
    athenaUser: new Map(),
    catalogSummary: new Map(),
    category: new Map(),
    checkoutSession: new Map(),
    checkoutSessionItem: new Map(),
    inventoryHold: new Map(),
    inventoryImportCostOverlayRow: new Map(),
    inventoryImportCostOverlayRun: new Map(),
    inventoryMovement: new Map(),
    inventoryImportProvisionalSku: new Map(),
    inventoryImportReviewVersionPayloadChunk: new Map(),
    inventoryImportReviewVersionPayloadUpload: new Map(),
    inventoryImportReviewVersion: new Map(),
    operationalEvent: new Map(),
    operationalWorkItem: new Map(),
    product: new Map(),
    productSku: new Map(),
    skuActivityEvent: new Map(),
    store: new Map(),
    subcategory: new Map(),
  };
  const counters = new Map<TableName, number>();

  for (const [table, rows] of Object.entries(seed) as Array<
    [TableName, Row[]]
  >) {
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
    const gts: Record<string, number> = {};

    const api = {
      withIndex(name: string, callback: (q: any) => any) {
        indexName = name;
        const q = {
          eq(field: string, value: unknown) {
            eqs[field] = value;
            return q;
          },
          gt(field: string, value: number) {
            gts[field] = value;
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
      async unique() {
        const rows = await api.take(2);
        if (rows.length > 1)
          throw new Error("Query did not return a unique row");
        return rows[0] ?? null;
      },
      async take(limit: number) {
        return Array.from(tables[table].values())
          .filter((row) => {
            if (!indexName) return true;
            return (
              Object.entries(eqs).every(
                ([field, value]) => row[field] === value,
              ) &&
              Object.entries(gts).every(([field, value]) => row[field] > value)
            );
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
      async delete(table: TableName, id: string) {
        tables[table].delete(id);
      },
      query,
    },
    scheduler: {
      runAt: vi.fn(async () => undefined),
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

function seedTrustedConversionData(
  overrides: Partial<Record<TableName, Row[]>> = {},
) {
  return createMutationCtx({
    category: [
      {
        _id: "category-1",
        name: "Legacy import",
        slug: "legacy-import",
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
          lastPosTransactionId: "pos-transaction-1",
          lastRegisterSessionId: "register-session-1",
          lastSoldAt: 120,
          saleCount: 1,
          totalQuantitySold: 2,
        },
        sourceFormat: "csv",
        status: "active",
        storeId: "store-1",
        updatedAt: 130,
      },
    ],
    product: [
      {
        _id: "product-1",
        availability: "draft",
        categoryId: "category-1",
        createdByUserId: "user-1",
        currency: "GHS",
        inventoryCount: 2,
        isVisible: false,
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
        isVisible: true,
        price: 30000,
        productId: "product-1",
        productName: "Body Wave",
        quantityAvailable: 2,
        sku: "BW-18",
        storeId: "store-1",
      },
    ],
    store: [
      {
        _id: "store-1",
        organizationId: "org-1",
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
    ...overrides,
  });
}

async function readTrustedConversionBinding(ctx: any) {
  const binding = await listProductPageProvisionalSkuBindingWithCtx(
    ctx,
    {
      productSkuId: "sku-1" as Id<"productSku">,
      storeId: "store-1" as Id<"store">,
    },
    access,
  );
  expect(binding.state).toBe("unique");
  if (binding.state !== "unique") throw new Error("expected unique binding");
  return binding;
}

function buildTrustedConversionArgs(
  binding: Awaited<ReturnType<typeof readTrustedConversionBinding>>,
  overrides: Partial<ProductPageTrustedInventoryFinalizationArgs> = {},
): ProductPageTrustedInventoryFinalizationArgs {
  return {
    conversionRequestId: "conversion-1",
    productId: "product-1" as Id<"product">,
    productSkuId: "sku-1" as Id<"productSku">,
    provisionalSkuId: "provisional-1" as Id<"inventoryImportProvisionalSku">,
    reviewedInventoryCount: 10,
    reviewedIsVisible: true,
    reviewedPosVisible: true,
    reviewedPrice: 50000,
    reviewedQuantityAvailable: 8,
    saleEvidenceFingerprint: binding.saleEvidenceFingerprint,
    sourceSurface: "product_edit",
    storeId: "store-1" as Id<"store">,
    trustedSkuFingerprint: binding.trustedSkuFingerprint,
    ...overrides,
  };
}

describe("catalog import", () => {
  it("denies shared-demo review payload staging and finalization at runtime", async () => {
    mockedSkuSearch.getSharedDemoActorWithCtx.mockResolvedValue({
      athenaUserId: "demo-user",
      kind: "shared_demo",
      organizationId: "org-1",
      storeId: "store-1",
    });
    const ctx = {
      auth: { getUserIdentity: vi.fn(async () => ({ subject: "demo" })) },
      db: {},
    };

    await expect(
      getHandler(stageInventoryImportReviewVersionPayloadChunk)(ctx, {
        chunk: { kind: "raw_content", rawContent: "sku,cost" },
        chunkIndex: 0,
        storeId: "store-1",
        uploadKey: "upload-1",
      }),
    ).rejects.toThrow();
    await expect(
      getHandler(finalizeInventoryImportReviewVersionPayload)(ctx, {
        importKey: "import-1",
        issueCount: 0,
        rawContentChunkCount: 1,
        rowCount: 1,
        rowDecisionChunkCount: 0,
        sourceFormat: "csv",
        storeId: "store-1",
        uploadKey: "upload-1",
      }),
    ).rejects.toThrow();
  });

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
    expect(
      mockedSkuSearch.upsertProductSkuSearchProjections,
    ).toHaveBeenCalledWith(
      expect.anything(),
      [Array.from(tables.productSku.values())[0]._id],
      "store-1",
      { additionalEffectiveChange: false },
    );
    expect(Array.from(tables.operationalEvent.values())[0]).toMatchObject({
      eventType: "inventory_import_applied",
      subjectId: "legacy-smartpos-1",
      subjectType: "inventory_import",
    });
    expect(mockedSkuSearch.applyInventoryEffectWithCtx).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        businessEventKey: expect.stringMatching(
          /^inventory_import:legacy-smartpos-1:row:2:sku:/,
        ),
        physicalQuantityDelta: 6,
        valuation: expect.objectContaining({
          costBasis: { kind: "uncosted" },
          kind: "inbound",
          quantity: 6,
        }),
      }),
    );
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
          unitCost: 0,
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
    expect(mockedSkuSearch.applyInventoryEffectWithCtx).toHaveBeenCalledTimes(
      1,
    );
    expect(mockedSkuSearch.applyInventoryEffectWithCtx).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        businessEventKey: "inventory_import:legacy-smartpos-2:row:2:sku:sku-1",
        physicalQuantityDelta: 7,
        valuation: expect.objectContaining({
          costBasis: expect.objectContaining({ kind: "known", unitCost: 0 }),
          kind: "inbound",
          quantity: 7,
        }),
      }),
    );
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

    const saved = await saveInventoryImportReviewVersionWithCtx(
      ctx,
      {
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
      },
      access,
    );

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
      sourceProjectionVersion: 1,
      sourceColumns: expect.arrayContaining([
        expect.objectContaining({
          id: "csv:product_name:1",
          label: "product_name",
          ordinal: 1,
        }),
      ]),
      storeId: "store-1",
      versionNumber: 2,
    });
    const loaded = await getLatestInventoryImportReviewVersionWithCtx(
      ctx,
      { storeId: "store-1" as Id<"store"> },
      access,
    );
    expect(loaded).toMatchObject({
      _id: saved._id,
      rawContent: "product_name,sku,price,qty\nComb,COMB-1,25,4",
      rowDecisions: [
        expect.objectContaining({
          priceSource: "athena",
          quantitySource: "import",
          rowKey: "2:COMB-1::Comb",
        }),
      ],
    });
    expect(tables.inventoryImportReviewVersionPayloadChunk.size).toBe(0);
    expect(Array.from(tables.operationalEvent.values())[0]).toMatchObject({
      eventType: "inventory_import_review_version_saved",
      subjectId: saved._id,
      subjectType: "inventory_import_review_version",
    });
  });

  it("accepts the legacy inline envelope at its explicit byte limit", async () => {
    const { ctx, tables } = createMutationCtx();
    const baseArgs = {
      fileName: "products.csv",
      importKey: "inline-boundary",
      issueCount: 0,
      notes: "Legacy rolling-client compatibility.",
      rawContent: "",
      rowCount: 1,
      rowDecisions: [],
      sourceFormat: "csv" as const,
      storeId: "store-1" as Id<"store">,
    };
    const baseBytes =
      getLegacyInventoryImportReviewVersionInlineEnvelopeByteLength(baseArgs);
    const rawContent = `column\n${"a".repeat(
      LEGACY_INVENTORY_IMPORT_REVIEW_INLINE_ENVELOPE_MAX_BYTES -
        baseBytes -
        "column\n".length -
        1,
    )}`;
    const args = { ...baseArgs, rawContent };

    expect(
      getLegacyInventoryImportReviewVersionInlineEnvelopeByteLength(args),
    ).toBe(LEGACY_INVENTORY_IMPORT_REVIEW_INLINE_ENVELOPE_MAX_BYTES);

    const saved = await saveInventoryImportReviewVersionWithCtx(
      ctx,
      args,
      access,
    );

    expect(tables.inventoryImportReviewVersion.get(saved._id)).toMatchObject({
      rawContent,
      rowDecisions: [],
    });
  });

  it("rejects the legacy inline envelope one byte above its explicit limit", async () => {
    const { ctx } = createMutationCtx();
    const baseArgs = {
      fileName: "products.csv",
      importKey: "inline-boundary",
      issueCount: 0,
      notes: "Legacy rolling-client compatibility.",
      rawContent: "",
      rowCount: 1,
      rowDecisions: [],
      sourceFormat: "csv" as const,
      storeId: "store-1" as Id<"store">,
    };
    const baseBytes =
      getLegacyInventoryImportReviewVersionInlineEnvelopeByteLength(baseArgs);
    const rawContent = `column\n${"a".repeat(
      LEGACY_INVENTORY_IMPORT_REVIEW_INLINE_ENVELOPE_MAX_BYTES +
        1 -
        baseBytes -
        "column\n".length -
        1,
    )}`;
    const args = { ...baseArgs, rawContent };

    expect(
      getLegacyInventoryImportReviewVersionInlineEnvelopeByteLength(args),
    ).toBe(LEGACY_INVENTORY_IMPORT_REVIEW_INLINE_ENVELOPE_MAX_BYTES + 1);

    await expect(
      saveInventoryImportReviewVersionWithCtx(ctx, args, access),
    ).rejects.toThrow(
      "Large review payloads must be staged in bounded chunks before finalizing.",
    );
  });

  it("keeps payloads above the Convex document limit off the legacy inline path", async () => {
    const { ctx, tables } = createMutationCtx();
    const rawContent = `product_name,sku,price,qty\n${"a".repeat(700_000)}`;
    const rowDecisions = Array.from({ length: 2_000 }, (_, index) => ({
      priceSource: "athena" as const,
      productName: `Product ${index} ${"b".repeat(120)}`,
      quantitySource: "import" as const,
      rowKey: `${index + 2}:SKU-${index}::Product ${index}`,
      rowNumber: index + 2,
    }));

    expect(
      new TextEncoder().encode(JSON.stringify({ rawContent, rowDecisions }))
        .byteLength,
    ).toBeGreaterThan(1_048_576);

    await expect(
      saveInventoryImportReviewVersionWithCtx(
        ctx,
        {
          importKey: "large-review",
          issueCount: 0,
          rawContent,
          rowCount: rowDecisions.length,
          rowDecisions,
          sourceFormat: "csv",
          storeId: "store-1" as Id<"store">,
        },
        access,
      ),
    ).rejects.toThrow(
      "Large review payloads must be staged in bounded chunks before finalizing.",
    );
    expect(tables.inventoryImportReviewVersion.size).toBe(0);
    expect(tables.inventoryImportReviewVersionPayloadChunk.size).toBe(0);
  });

  it("stages and finalizes a review source larger than 1 MiB through bounded public seams", async () => {
    const { ctx, tables } = createMutationCtx();
    const rawContent = `product_name,sku,price,qty\n${"a".repeat(1_200_000)}`;
    const rawChunks = rawContent.match(/[\s\S]{1,240000}/g) ?? [];
    const rowDecisions = Array.from({ length: 2_000 }, (_, index) => ({
      productName: `Product ${index}`,
      rowKey: `${index + 2}:SKU-${index}::Product ${index}`,
      rowNumber: index + 2,
    }));
    const rowDecisionChunks = Array.from(
      { length: Math.ceil(rowDecisions.length / 500) },
      (_, index) => rowDecisions.slice(index * 500, (index + 1) * 500),
    );
    const chunks = [
      ...rawChunks.map((content) => ({
        kind: "raw_content" as const,
        rawContent: content,
      })),
      ...rowDecisionChunks.map((decisions) => ({
        kind: "row_decisions" as const,
        rowDecisions: decisions,
      })),
    ];
    const expectedByteLength = chunks.reduce(
      (total, chunk) =>
        total +
        new TextEncoder().encode(
          chunk.kind === "raw_content"
            ? chunk.rawContent
            : JSON.stringify(chunk.rowDecisions),
        ).byteLength,
      0,
    );

    for (const [chunkIndex, chunk] of chunks.entries()) {
      expect(
        new TextEncoder().encode(
          chunk.kind === "raw_content"
            ? chunk.rawContent
            : JSON.stringify(chunk.rowDecisions),
        ).byteLength,
      ).toBeLessThanOrEqual(256 * 1024);
      await expect(
        stageInventoryImportReviewVersionPayloadChunkWithCtx(
          ctx,
          {
            chunk,
            chunkIndex,
            expectedByteLength,
            expectedChunkCount: chunks.length,
            storeId: "store-1" as Id<"store">,
            uploadKey: "large-public-review",
          },
          access,
        ),
      ).resolves.toMatchObject({ alreadyStaged: false, chunkIndex });
    }
    await expect(
      stageInventoryImportReviewVersionPayloadChunkWithCtx(
        ctx,
        {
          chunk: chunks[0],
          chunkIndex: 0,
          expectedByteLength,
          expectedChunkCount: chunks.length,
          storeId: "store-1" as Id<"store">,
          uploadKey: "large-public-review",
        },
        access,
      ),
    ).resolves.toMatchObject({ alreadyStaged: true, chunkIndex: 0 });
    await expect(
      stageInventoryImportReviewVersionPayloadChunkWithCtx(
        ctx,
        {
          chunk: chunks[0],
          chunkIndex: 0,
          expectedByteLength: expectedByteLength + 1,
          expectedChunkCount: chunks.length,
          storeId: "store-1" as Id<"store">,
          uploadKey: "large-public-review",
        },
        access,
      ),
    ).rejects.toThrow(
      "Review payload upload key was already used with different metadata.",
    );
    await expect(
      stageInventoryImportReviewVersionPayloadChunkWithCtx(
        ctx,
        {
          chunk: chunks[0],
          chunkIndex: 0,
          expectedByteLength,
          expectedChunkCount: chunks.length - 1,
          storeId: "store-1" as Id<"store">,
          uploadKey: "large-public-review",
        },
        access,
      ),
    ).rejects.toThrow(
      "Review payload upload key was already used with different metadata.",
    );
    await expect(
      stageInventoryImportReviewVersionPayloadChunkWithCtx(
        ctx,
        {
          chunk: {
            kind: "raw_content",
            rawContent: `${rawChunks[0]}changed`,
          },
          chunkIndex: 0,
          expectedByteLength,
          expectedChunkCount: chunks.length,
          storeId: "store-1" as Id<"store">,
          uploadKey: "large-public-review",
        },
        access,
      ),
    ).rejects.toThrow(
      "Review payload upload key was already used with different content.",
    );

    const upload = Array.from(
      tables.inventoryImportReviewVersionPayloadUpload.values(),
    )[0];
    await expect(
      getHandler(expireInventoryImportReviewVersionPayloadUpload)(ctx, {
        uploadId: upload._id,
      }),
    ).resolves.toEqual({ disposition: "unchanged" });

    const saved = await finalizeInventoryImportReviewVersionPayloadWithCtx(
      ctx,
      {
        importKey: "large-public-review",
        issueCount: 0,
        rawContentChunkCount: rawChunks.length,
        rowCount: rowDecisions.length,
        rowDecisionChunkCount: rowDecisionChunks.length,
        sourceFormat: "csv",
        storeId: "store-1" as Id<"store">,
        uploadKey: "large-public-review",
      },
      access,
    );

    expect(tables.inventoryImportReviewVersion.get(saved._id)).toMatchObject({
      payloadChunkCount: chunks.length,
      payloadUploadKey: "large-public-review",
      rawContentChunkCount: rawChunks.length,
      rowDecisionChunkCount: rowDecisionChunks.length,
    });
    expect(
      Array.from(
        tables.inventoryImportReviewVersionPayloadChunk.values(),
      ).every((chunk) => chunk.reviewVersionId === saved._id),
    ).toBe(true);
    await expect(
      getLatestInventoryImportReviewVersionWithCtx(
        ctx,
        { storeId: "store-1" as Id<"store"> },
        access,
      ),
    ).resolves.toBeNull();
    await expect(
      finalizeInventoryImportReviewVersionPayloadWithCtx(
        ctx,
        {
          importKey: "large-public-review",
          issueCount: 0,
          rawContentChunkCount: rawChunks.length,
          rowCount: rowDecisions.length,
          rowDecisionChunkCount: rowDecisionChunks.length,
          sourceFormat: "csv",
          storeId: "store-1" as Id<"store">,
          uploadKey: "large-public-review",
        },
        access,
      ),
    ).resolves.toEqual(saved);
    await expect(
      finalizeInventoryImportReviewVersionPayloadWithCtx(
        ctx,
        {
          importKey: "large-public-review",
          issueCount: 1,
          rawContentChunkCount: rawChunks.length,
          rowCount: rowDecisions.length,
          rowDecisionChunkCount: rowDecisionChunks.length,
          sourceFormat: "csv",
          storeId: "store-1" as Id<"store">,
          uploadKey: "large-public-review",
        },
        access,
      ),
    ).rejects.toThrow(
      "Review payload upload key was already finalized with different metadata.",
    );
    const finalizedChunkCount =
      tables.inventoryImportReviewVersionPayloadChunk.size;
    await expect(
      getHandler(expireInventoryImportReviewVersionPayloadUpload)(ctx, {
        uploadId: upload._id,
      }),
    ).resolves.toEqual({ disposition: "unchanged" });
    expect(tables.inventoryImportReviewVersionPayloadChunk.size).toBe(
      finalizedChunkCount,
    );
    await expect(
      stageInventoryImportReviewVersionPayloadChunkWithCtx(
        ctx,
        {
          chunk: chunks[0],
          chunkIndex: 0,
          expectedByteLength,
          expectedChunkCount: chunks.length,
          storeId: "store-1" as Id<"store">,
          uploadKey: "large-public-review",
        },
        access,
      ),
    ).resolves.toMatchObject({ alreadyStaged: true, chunkIndex: 0 });
    await expect(
      stageInventoryImportReviewVersionPayloadChunkWithCtx(
        ctx,
        {
          chunk: {
            kind: "raw_content",
            rawContent: `${rawChunks[0]}changed`,
          },
          chunkIndex: 0,
          expectedByteLength,
          expectedChunkCount: chunks.length,
          storeId: "store-1" as Id<"store">,
          uploadKey: "large-public-review",
        },
        access,
      ),
    ).rejects.toThrow(
      "Review payload upload key was already used with different content.",
    );
  });

  it("admits the independently chunked boundary at eight MiB", async () => {
    const { ctx } = createMutationCtx();
    const chunk = { kind: "raw_content" as const, rawContent: "x" };

    await expect(
      stageInventoryImportReviewVersionPayloadChunkWithCtx(
        ctx,
        {
          chunk,
          chunkIndex: 35,
          expectedByteLength: 8 * 1024 * 1024,
          expectedChunkCount: 36,
          storeId: "store-1" as Id<"store">,
          uploadKey: "eight-mib-boundary",
        },
        access,
      ),
    ).resolves.toMatchObject({ alreadyStaged: false, chunkIndex: 35 });

    await expect(
      stageInventoryImportReviewVersionPayloadChunkWithCtx(
        ctx,
        {
          chunk,
          chunkIndex: 0,
          expectedByteLength: 8 * 1024 * 1024,
          expectedChunkCount: 37,
          storeId: "store-1" as Id<"store">,
          uploadKey: "above-eight-mib-boundary",
        },
        access,
      ),
    ).rejects.toThrow("Review payload chunk is invalid or too large.");
  });

  it("expires abandoned review uploads, removes their chunks, and rejects later writes", async () => {
    const { ctx, tables } = createMutationCtx();
    const chunk = { kind: "raw_content" as const, rawContent: "sku,cost\nA,4" };
    const expectedByteLength = new TextEncoder().encode(
      chunk.rawContent,
    ).byteLength;
    await stageInventoryImportReviewVersionPayloadChunkWithCtx(
      ctx,
      {
        chunk,
        chunkIndex: 0,
        expectedByteLength,
        expectedChunkCount: 1,
        storeId: "store-1" as Id<"store">,
        uploadKey: "abandoned-upload",
      },
      access,
    );
    const upload = Array.from(
      tables.inventoryImportReviewVersionPayloadUpload.values(),
    )[0];
    await ctx.db.patch(
      "inventoryImportReviewVersionPayloadUpload",
      upload._id,
      { expiresAt: Date.now() - 1 },
    );
    const expireHandler = (
      expireInventoryImportReviewVersionPayloadUpload as unknown as {
        _handler: (ctx: unknown, args: unknown) => Promise<unknown>;
      }
    )._handler;
    await expect(
      expireHandler(ctx, { uploadId: upload._id }),
    ).resolves.toMatchObject({
      deletedChunkCount: 1,
      disposition: "expired",
    });
    expect(tables.inventoryImportReviewVersionPayloadChunk.size).toBe(0);
    expect(
      tables.inventoryImportReviewVersionPayloadUpload.get(upload._id),
    ).toMatchObject({ status: "expired" });
    await expect(
      stageInventoryImportReviewVersionPayloadChunkWithCtx(
        ctx,
        {
          chunk,
          chunkIndex: 0,
          expectedByteLength,
          expectedChunkCount: 1,
          storeId: "store-1" as Id<"store">,
          uploadKey: "abandoned-upload",
        },
        access,
      ),
    ).rejects.toThrow("Review payload upload has expired");
  });

  it("caps concurrent review uploads per operator and store", async () => {
    const { ctx } = createMutationCtx();
    const chunk = { kind: "raw_content" as const, rawContent: "sku,cost\nA,4" };
    const expectedByteLength = new TextEncoder().encode(
      chunk.rawContent,
    ).byteLength;
    for (let index = 0; index < 5; index += 1) {
      await stageInventoryImportReviewVersionPayloadChunkWithCtx(
        ctx,
        {
          chunk,
          chunkIndex: 0,
          expectedByteLength,
          expectedChunkCount: 1,
          storeId: "store-1" as Id<"store">,
          uploadKey: `active-${index}`,
        },
        access,
      );
    }
    await expect(
      stageInventoryImportReviewVersionPayloadChunkWithCtx(
        ctx,
        {
          chunk,
          chunkIndex: 0,
          expectedByteLength,
          expectedChunkCount: 1,
          storeId: "store-1" as Id<"store">,
          uploadKey: "active-over-limit",
        },
        access,
      ),
    ).rejects.toThrow("Too many review payload saves are active");
  });

  it("rejects pathological source-column counts before saving descriptors", async () => {
    const { ctx } = createMutationCtx();
    const headers = Array.from({ length: 257 }, (_, index) => `field_${index}`);
    await expect(
      saveInventoryImportReviewVersionWithCtx(
        ctx,
        {
          importKey: "too-many-columns",
          issueCount: 0,
          rawContent: `${headers.join(",")}\n${headers.map(() => "1").join(",")}`,
          rowCount: 1,
          sourceFormat: "csv",
          storeId: "store-1" as Id<"store">,
        },
        access,
      ),
    ).rejects.toThrow("Import source has too many columns (257 > 256).");
  });

  it("rejects oversized source-column identity descriptors", async () => {
    const { ctx } = createMutationCtx();
    await expect(
      saveInventoryImportReviewVersionWithCtx(
        ctx,
        {
          importKey: "oversized-header",
          issueCount: 0,
          rawContent: `${"h".repeat(140_000)}\n1`,
          rowCount: 1,
          sourceFormat: "csv",
          storeId: "store-1" as Id<"store">,
        },
        access,
      ),
    ).rejects.toThrow(
      "Import source column labels are too large to save safely.",
    );
  });

  it("fails closed when a chunked review payload is incomplete", async () => {
    const { ctx } = createMutationCtx({
      inventoryImportReviewVersion: [
        {
          _id: "review-version-1",
          createdAt: 100,
          createdByUserId: "user-1",
          importKey: "incomplete-review",
          issueCount: 0,
          organizationId: "org-1",
          payloadChunkCount: 1,
          rawContentChunkCount: 1,
          rowCount: 1,
          rowDecisionChunkCount: 0,
          sourceFormat: "csv",
          storeId: "store-1",
          versionNumber: 1,
        },
      ],
    });

    await expect(
      getInventoryImportReviewVersionPayloadChunkWithCtx(
        ctx,
        {
          chunkIndex: 0,
          reviewVersionId:
            "review-version-1" as Id<"inventoryImportReviewVersion">,
          storeId: "store-1" as Id<"store">,
        },
        access,
      ),
    ).rejects.toThrow("Saved review payload is incomplete.");
  });

  it("loads legacy review versions with embedded payloads", async () => {
    const { ctx } = createMutationCtx({
      inventoryImportReviewVersion: [
        {
          _id: "review-version-1",
          createdAt: 100,
          createdByUserId: "user-1",
          importKey: "legacy-review",
          issueCount: 0,
          organizationId: "org-1",
          rawContent: "product_name,sku,price,qty\nComb,COMB-1,25,4",
          rowCount: 1,
          rowDecisions: [
            {
              productName: "Comb",
              rowKey: "2:COMB-1::Comb",
              rowNumber: 2,
            },
          ],
          sourceFormat: "csv",
          storeId: "store-1",
          versionNumber: 1,
        },
      ],
    });

    const loaded = await getLatestInventoryImportReviewVersionWithCtx(
      ctx,
      { storeId: "store-1" as Id<"store"> },
      access,
    );

    expect(loaded).toMatchObject({
      importKey: "legacy-review",
      rawContent: "product_name,sku,price,qty\nComb,COMB-1,25,4",
      rowDecisions: [
        {
          productName: "Comb",
          rowKey: "2:COMB-1::Comb",
          rowNumber: 2,
        },
      ],
    });
  });

  it("reconstructs a small staged review for a rolling legacy client", async () => {
    const { ctx } = createMutationCtx();
    const rawContent = "product_name,sku,price,qty\nComb,COMB-1,25,4";
    const rowDecisions = [
      {
        priceSource: "athena" as const,
        productName: "Comb",
        quantitySource: "import" as const,
        rowKey: "2:COMB-1::Comb",
        rowNumber: 2,
      },
    ];
    const chunks = [
      { kind: "raw_content" as const, rawContent },
      { kind: "row_decisions" as const, rowDecisions },
    ];
    const expectedByteLength = chunks.reduce(
      (total, chunk) =>
        total +
        new TextEncoder().encode(
          chunk.kind === "raw_content"
            ? chunk.rawContent
            : JSON.stringify(chunk.rowDecisions),
        ).byteLength,
      0,
    );

    for (const [chunkIndex, chunk] of chunks.entries()) {
      await stageInventoryImportReviewVersionPayloadChunkWithCtx(
        ctx,
        {
          chunk,
          chunkIndex,
          expectedByteLength,
          expectedChunkCount: chunks.length,
          storeId: "store-1" as Id<"store">,
          uploadKey: "rolling-client-review",
        },
        access,
      );
    }
    const saved = await finalizeInventoryImportReviewVersionPayloadWithCtx(
      ctx,
      {
        fileName: "products.csv",
        importKey: "rolling-client-review",
        issueCount: 0,
        rawContentChunkCount: 1,
        rowCount: 1,
        rowDecisionChunkCount: 1,
        sourceFormat: "csv",
        storeId: "store-1" as Id<"store">,
        uploadKey: "rolling-client-review",
      },
      access,
    );

    await expect(
      getLatestInventoryImportReviewVersionWithCtx(
        ctx,
        { storeId: "store-1" as Id<"store"> },
        access,
      ),
    ).resolves.toMatchObject({
      _id: saved._id,
      rawContent,
      rowDecisions,
    });
  });

  it("preserves the legacy latest-review contract when the latest version is chunk-backed", async () => {
    const { ctx } = createMutationCtx({
      inventoryImportReviewVersion: [
        {
          _id: "review-version-1",
          createdAt: 100,
          createdByUserId: "user-1",
          importKey: "legacy-review",
          issueCount: 0,
          organizationId: "org-1",
          rawContent: "product_name,sku,price,qty\nComb,COMB-1,25,4",
          rowCount: 1,
          sourceFormat: "csv",
          storeId: "store-1",
          versionNumber: 1,
        },
        {
          _id: "review-version-2",
          createdAt: 200,
          createdByUserId: "user-1",
          importKey: "chunked-review",
          issueCount: 0,
          organizationId: "org-1",
          payloadChunkCount: 1,
          rowCount: 1,
          sourceFormat: "csv",
          storeId: "store-1",
          versionNumber: 2,
        },
      ],
    });

    await expect(
      getLatestInventoryImportReviewVersionWithCtx(
        ctx,
        { storeId: "store-1" as Id<"store"> },
        access,
      ),
    ).resolves.toBeNull();
    await expect(
      getLatestInventoryImportReviewVersionMetadataWithCtx(
        ctx,
        { storeId: "store-1" as Id<"store"> },
        access,
      ),
    ).resolves.toMatchObject({
      _id: "review-version-2",
      payloadChunkCount: 1,
      versionNumber: 2,
    });
  });

  it("loads the requested saved review version instead of the latest version", async () => {
    const { ctx } = createMutationCtx({
      inventoryImportReviewVersion: [
        {
          _id: "review-version-1",
          createdAt: 100,
          createdByUserId: "user-1",
          importKey: "selected-review",
          issueCount: 0,
          organizationId: "org-1",
          rawContent: "product_name,sku,cost\nComb,COMB-1,12",
          rowCount: 1,
          sourceFormat: "csv",
          storeId: "store-1",
          versionNumber: 1,
        },
        {
          _id: "review-version-2",
          createdAt: 200,
          createdByUserId: "user-1",
          importKey: "latest-review",
          issueCount: 0,
          organizationId: "org-1",
          rawContent: "product_name,sku,cost\nBrush,BRUSH-1,18",
          rowCount: 1,
          sourceFormat: "csv",
          storeId: "store-1",
          versionNumber: 2,
        },
      ],
    });

    const loaded = await getInventoryImportReviewVersionByIdWithCtx(
      ctx,
      {
        reviewVersionId:
          "review-version-1" as Id<"inventoryImportReviewVersion">,
        storeId: "store-1" as Id<"store">,
      },
      access,
    );

    expect(loaded).toMatchObject({
      _id: "review-version-1",
      importKey: "selected-review",
      rawContent: "product_name,sku,cost\nComb,COMB-1,12",
      versionNumber: 1,
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
          rawContent:
            "product_name,sku,price,qty\nBody Wave,LEGACY-BODY-WAVE,450,6",
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

    const staged = await stageInventoryImportReviewRowsForPosWithCtx(
      ctx,
      {
        importKey: "legacy-review-1",
        reviewVersionId:
          "review-version-1" as Id<"inventoryImportReviewVersion">,
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
      },
      access,
    );

    expect(staged).toMatchObject({
      alreadyStaged: false,
      catalogIdentitiesCreated: 0,
      provisionalRowsCreated: 1,
      provisionalRowsUpdated: 0,
      rowsSkipped: 0,
      trustedStockRowsUpdated: 0,
    });
    const provisionalRow = Array.from(
      tables.inventoryImportProvisionalSku.values(),
    )[0];
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

  it.each([
    {
      expectedUnitCost: 425,
      runStatus: "applying",
      rowWorkStatus: "applied",
    },
    {
      expectedUnitCost: 425,
      runStatus: "undoing",
      rowWorkStatus: "applied",
    },
    {
      expectedUnitCost: 425,
      runStatus: "undone_with_exceptions",
      rowWorkStatus: "undo_exception",
    },
    {
      expectedUnitCost: 999,
      provisionalUndoneAt: 120,
      runStatus: "undone",
      rowUndoneAt: 120,
      rowWorkStatus: "undone",
    },
  ] as const)(
    "resolves batch trusted-finalization overlay authority from $runStatus/$rowWorkStatus row evidence",
    async ({
      expectedUnitCost,
      provisionalUndoneAt,
      runStatus,
      rowUndoneAt,
      rowWorkStatus,
    }) => {
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
            costOverlayAppliedAt: 110,
            costOverlayRunId: "overlay-run-1",
            costOverlayRowId: "overlay-row-1",
            costOverlaySourceDigest: "source-digest",
            costOverlayUnitCost: 425,
            costOverlayUndoneAt: provisionalUndoneAt,
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
          {
            _id: "provisional-2",
            createdAt: 101,
            createdByUserId: "user-1",
            costOverlayAppliedAt: 110,
            costOverlayRunId: "overlay-run-1",
            costOverlayRowId: "overlay-row-1",
            costOverlaySourceDigest: "source-digest",
            costOverlayUnitCost: 425,
            costOverlayUndoneAt: provisionalUndoneAt,
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
            rowKey: "2:BW-18:123456789012:Body Wave imported duplicate",
            rowNumber: 2,
            saleEvidence: { saleCount: 0, totalQuantitySold: 0 },
            sourceFormat: "csv",
            status: "active",
            storeId: "store-1",
            updatedAt: 101,
          },
        ],
        inventoryImportCostOverlayRun: [
          {
            _id: "overlay-run-1",
            organizationId: "org-1",
            reviewVersionId: "review-version-1",
            sourceDigest: "source-digest",
            status: runStatus,
            storeId: "store-1",
          },
        ],
        inventoryImportCostOverlayRow: [
          {
            _id: "overlay-row-1",
            organizationId: "org-1",
            postUnitCostMinor: 425,
            productSkuId: "sku-1",
            provisionalSkuId: "provisional-1",
            runId: "overlay-run-1",
            storeId: "store-1",
            undoneAt: rowUndoneAt,
            workStatus: rowWorkStatus,
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
            unitCost: 425,
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
              unitCost: 999,
            },
          ],
          sourceFormat: "csv",
          storeId: "store-1" as Id<"store">,
        },
        access,
      );

      expect(summary.skusUpdated).toBe(1);
      expect(mockedSkuSearch.applyInventoryEffectWithCtx).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          valuation: expect.objectContaining({
            costBasis: expect.objectContaining({ unitCost: expectedUnitCost }),
          }),
        }),
      );
      expect(tables.productSku.get("sku-1")).toMatchObject({
        inventoryCount: 7,
        quantityAvailable: 7,
      });
      expect(
        tables.inventoryImportProvisionalSku.get("provisional-1"),
      ).toMatchObject({
        finalTrustedQuantity: 7,
        finalizedByUserId: "user-1",
        costOverlayRunId: "overlay-run-1",
        costOverlayUnitCost: 425,
        posExposureStatus: "hidden",
        provisionalSoldQuantityAtFinalization: 2,
        status: "finalized",
      });
      expect(
        tables.inventoryImportProvisionalSku.get("provisional-2"),
      ).toMatchObject({
        costOverlayRunId: "overlay-run-1",
        costOverlayUnitCost: 425,
        status: "finalized",
      });
    },
  );

  it("returns product-page provisional binding fingerprints for exactly one active row", async () => {
    const { ctx } = seedTrustedConversionData();

    const binding = await listProductPageProvisionalSkuBindingWithCtx(
      ctx,
      {
        productSkuId: "sku-1" as Id<"productSku">,
        storeId: "store-1" as Id<"store">,
      },
      access,
    );

    expect(binding).toMatchObject({
      state: "unique",
      row: {
        _id: "provisional-1",
        importKey: "legacy-review-1",
        importedQuantity: 6,
        provisionalSoldQuantity: 2,
        reviewVersionId: "review-version-1",
        reviewVersionNumber: 1,
        rowNumber: 2,
        saleCount: 1,
      },
    });
    if (binding.state !== "unique") throw new Error("expected unique binding");
    expect(binding.saleEvidenceFingerprint).toContain("saleCount");
    expect(binding.trustedSkuFingerprint).toContain("inventoryCount");
  });

  it("keeps product-page provisional binding and finalization return values aligned to public Convex validators", async () => {
    const { ctx } = seedTrustedConversionData();
    const binding = await readTrustedConversionBinding(ctx);
    assertConformsToExportedReturns(
      listProductPageProvisionalSkuBinding,
      binding,
    );

    const result = await finalizeTrustedInventoryFromProductPageWithCtx(
      ctx,
      {
        conversionRequestId: "conversion-1",
        productId: "product-1" as Id<"product">,
        productSkuId: "sku-1" as Id<"productSku">,
        provisionalSkuId:
          "provisional-1" as Id<"inventoryImportProvisionalSku">,
        reviewedInventoryCount: 10,
        reviewedIsVisible: true,
        reviewedPosVisible: true,
        reviewedPrice: 50000,
        reviewedQuantityAvailable: 8,
        saleEvidenceFingerprint: binding.saleEvidenceFingerprint,
        sourceSurface: "product_edit",
        storeId: "store-1" as Id<"store">,
        trustedSkuFingerprint: binding.trustedSkuFingerprint,
      },
      access,
    );

    assertConformsToExportedReturns(
      finalizeTrustedInventoryFromProductPage,
      result,
    );
  });

  it("keeps existing catalog import return values aligned to public Convex validators", () => {
    assertConformsToExportedReturns(importInventory, {
      kind: "ok",
      data: {
        categoriesCreated: 0,
        productsCreated: 0,
        productsUpdated: 0,
        rowsImported: 1,
        skusCreated: 0,
        skusUpdated: 1,
        subcategoriesCreated: 0,
      },
    });
    assertConformsToExportedReturns(saveInventoryImportReviewVersion, {
      kind: "ok",
      data: {
        _id: "review-version-1",
        createdAt: 100,
        importKey: "legacy-review-1",
        issueCount: 0,
        rowCount: 1,
        sourceFormat: "csv",
        versionNumber: 1,
      },
    });
    assertConformsToExportedReturns(
      stageInventoryImportReviewVersionPayloadChunk,
      {
        kind: "ok",
        data: { alreadyStaged: false, chunkIndex: 0 },
      },
    );
    assertConformsToExportedReturns(
      getInventoryImportReviewVersionPayloadChunk,
      {
        chunkIndex: 0,
        kind: "raw_content",
        rawContent: "sku,cost\nA,4",
      },
    );
    assertConformsToExportedReturns(
      finalizeInventoryImportReviewVersionPayload,
      {
        kind: "ok",
        data: {
          _id: "review-version-1",
          createdAt: 100,
          importKey: "legacy-review-1",
          issueCount: 0,
          rowCount: 1,
          sourceFormat: "csv",
          versionNumber: 1,
        },
      },
    );
    assertConformsToExportedReturns(stageInventoryImportReviewRowsForPos, {
      kind: "ok",
      data: {
        alreadyStaged: false,
        catalogIdentitiesCreated: 0,
        provisionalRowsCreated: 1,
        provisionalRowsUpdated: 0,
        rowsSkipped: 0,
        rowsStaged: 1,
        trustedStockRowsUpdated: 0,
      },
    });
    assertConformsToExportedReturns(
      getLatestInventoryImportReviewVersion,
      null,
    );
    assertConformsToExportedReturns(getLatestInventoryImportReviewVersion, {
      _id: "review-version-1",
      createdAt: 100,
      importKey: "legacy-review-1",
      issueCount: 0,
      rawContent: "sku,cost\nA,4",
      rowCount: 1,
      sourceFormat: "csv",
      versionNumber: 1,
    });
    assertConformsToExportedReturns(
      getLatestInventoryImportReviewVersionMetadata,
      {
        _id: "review-version-1",
        createdAt: 100,
        importKey: "legacy-review-1",
        issueCount: 0,
        payloadChunkCount: 1,
        rowCount: 1,
        sourceFormat: "csv",
        versionNumber: 1,
      },
    );
    assertConformsToExportedReturns(listInventoryImportReviewSkuContext, [
      {
        barcode: "123456789012",
        inventoryCount: 2,
        price: 30000,
        productAvailability: "draft",
        productId: "product-1",
        productName: "Body Wave",
        productSkuId: "sku-1",
        quantityAvailable: 2,
        sku: "BW-18",
      },
    ]);
    assertConformsToExportedReturns(listProductPageProvisionalSkuBinding, {
      activeRowCount: 0,
      state: "empty",
    });
  });

  it("returns ambiguous product-page binding instead of choosing between active rows", async () => {
    const { ctx } = seedTrustedConversionData({
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
          rowKey: "row-1",
          rowNumber: 2,
          saleEvidence: { saleCount: 0, totalQuantitySold: 0 },
          sourceFormat: "csv",
          status: "active",
          storeId: "store-1",
          updatedAt: 100,
        },
        {
          _id: "provisional-2",
          createdAt: 101,
          createdByUserId: "user-1",
          importKey: "legacy-review-1",
          importedPrice: 45000,
          importedProductName: "Body Wave duplicate",
          importedQuantity: 4,
          normalizedImportedProductName: "body wave duplicate",
          organizationId: "org-1",
          posExposureStatus: "available",
          productId: "product-1",
          productSkuId: "sku-1",
          reviewVersionId: "review-version-1",
          reviewVersionNumber: 1,
          rowKey: "row-2",
          rowNumber: 3,
          saleEvidence: { saleCount: 0, totalQuantitySold: 0 },
          sourceFormat: "csv",
          status: "active",
          storeId: "store-1",
          updatedAt: 101,
        },
      ],
    });

    const binding = await listProductPageProvisionalSkuBindingWithCtx(
      ctx,
      {
        productSkuId: "sku-1" as Id<"productSku">,
        storeId: "store-1" as Id<"store">,
      },
      access,
    );

    expect(binding).toMatchObject({ activeRowCount: 2, state: "ambiguous" });
  });

  it("keeps one product-page provisional row active after trusted SKU evidence is finalized", async () => {
    const { ctx, tables } = seedTrustedConversionData();
    const binding = await readTrustedConversionBinding(ctx);

    const result = await finalizeTrustedInventoryFromProductPageWithCtx(
      ctx,
      {
        conversionRequestId: "conversion-1",
        productId: "product-1" as Id<"product">,
        productSkuId: "sku-1" as Id<"productSku">,
        provisionalSkuId:
          "provisional-1" as Id<"inventoryImportProvisionalSku">,
        reviewedInventoryCount: 10,
        reviewedIsVisible: true,
        reviewedPosVisible: true,
        reviewedPrice: 50000,
        reviewedQuantityAvailable: 8,
        reviewedUnitCost: 25000,
        saleEvidenceFingerprint: binding.saleEvidenceFingerprint!,
        sourceSurface: "product_edit",
        storeId: "store-1" as Id<"store">,
        trustedSkuFingerprint: binding.trustedSkuFingerprint!,
      },
      access,
    );

    expect(result.kind).toBe("ok");
    expect(result.kind === "ok" ? result.data : null).toMatchObject({
      finalTrustedQuantity: 10,
      inventoryMovementId: "inventoryMovement-1",
      productId: "product-1",
      productSkuId: "sku-1",
      product: {
        availability: "live",
        posVisible: true,
      },
      provisionalSoldQuantity: 2,
      provisionalSkuId: "provisional-1",
      quantityAvailable: 8,
    });
    expect(tables.productSku.get("sku-1")).toMatchObject({
      inventoryCount: 10,
      isVisible: true,
      posVisible: true,
      price: 50000,
      quantityAvailable: 8,
    });
    expect(
      mockedSkuSearch.upsertProductSkuSearchProjection,
    ).toHaveBeenCalledWith(expect.anything(), "sku-1", {
      advanceRevision: false,
    });
    expect(tables.product.get("product-1")).toMatchObject({
      availability: "live",
      inventoryCount: 10,
      posVisible: true,
      quantityAvailable: 8,
    });
    expect(
      tables.inventoryImportProvisionalSku.get("provisional-1"),
    ).toMatchObject({
      finalTrustedQuantity: 10,
      finalizationConversionRequestId: "conversion-1",
      finalizationSourceSurface: "product_edit",
      posExposureStatus: "hidden",
      provisionalSoldQuantityAtFinalization: 2,
      status: "active",
    });
    expect(Array.from(tables.operationalWorkItem.values())).toEqual([
      expect.objectContaining({
        metadata: expect.objectContaining({
          categorySlug: "legacy-import",
          productId: "product-1",
          productName: "Body Wave",
          productSkuId: "sku-1",
          provisionalSkuId: "provisional-1",
          sku: "BW-18",
          sourceId: "provisional-1",
          sourceType: "inventoryImportProvisionalSku",
        }),
        notes:
          "Assign an Athena category and subcategory before saving this product.",
        priority: "medium",
        status: "open",
        title: "Assign catalog category: Body Wave",
        type: "catalog_taxonomy_setup",
      }),
    ]);
    expect(Array.from(tables.inventoryMovement.values())).toHaveLength(1);
    expect(Array.from(tables.skuActivityEvent.values())).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          activityType: "provisional_import_trusted_finalization",
          idempotencyKey:
            "inventoryImportProvisionalSku:provisional-1:conversion-1",
          productSkuId: "sku-1",
          sourceId: "provisional-1",
          sourceType: "inventory_import_provisional_sku",
          status: "committed",
        }),
        expect.objectContaining({
          activityType: "stock_provisional_import_finalization",
          inventoryMovementId: "inventoryMovement-1",
          productSkuId: "sku-1",
          status: "committed",
        }),
      ]),
    );
  });

  it("keeps an active cost overlay authoritative during product-page finalization", async () => {
    const seeded = seedTrustedConversionData();
    const provisional =
      seeded.tables.inventoryImportProvisionalSku.get("provisional-1")!;
    seeded.tables.inventoryImportProvisionalSku.set("provisional-1", {
      ...provisional,
      costOverlayAppliedAt: 140,
      costOverlayRunId: "overlay-run-1",
      costOverlayRowId: "overlay-row-1",
      costOverlaySourceDigest: "source-digest",
      costOverlayUnitCost: 425,
    });
    const sku = seeded.tables.productSku.get("sku-1")!;
    seeded.tables.productSku.set("sku-1", { ...sku, unitCost: 425 });
    seeded.tables.inventoryImportCostOverlayRun.set("overlay-run-1", {
      _id: "overlay-run-1",
      organizationId: "org-1",
      reviewVersionId: "review-version-1",
      sourceDigest: "source-digest",
      status: "applied",
      storeId: "store-1",
    });
    seeded.tables.inventoryImportCostOverlayRow.set("overlay-row-1", {
      _id: "overlay-row-1",
      organizationId: "org-1",
      postUnitCostMinor: 425,
      productSkuId: "sku-1",
      provisionalSkuId: "representative-provisional",
      runId: "overlay-run-1",
      storeId: "store-1",
      workStatus: "applied",
    });
    const binding = await readTrustedConversionBinding(seeded.ctx);

    const submittedArgs = buildTrustedConversionArgs(binding, {
      reviewedUnitCost: 999,
    });
    const result = await finalizeTrustedInventoryFromProductPageWithCtx(
      seeded.ctx,
      submittedArgs,
      access,
    );

    expect(result.kind).toBe("ok");
    expect(mockedSkuSearch.applyInventoryEffectWithCtx).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        valuation: expect.objectContaining({
          costBasis: expect.objectContaining({ unitCost: 425 }),
        }),
      }),
    );
    expect(
      seeded.tables.inventoryImportProvisionalSku.get("provisional-1"),
    ).toMatchObject({
      costOverlayRunId: "overlay-run-1",
      costOverlayUnitCost: 425,
      status: "active",
    });
    seeded.tables.inventoryImportCostOverlayRun.set("overlay-run-1", {
      ...seeded.tables.inventoryImportCostOverlayRun.get("overlay-run-1")!,
      status: "undone",
    });
    seeded.tables.productSku.set("sku-1", {
      ...seeded.tables.productSku.get("sku-1")!,
      unitCost: 700,
    });
    const replay = await finalizeTrustedInventoryFromProductPageWithCtx(
      seeded.ctx,
      submittedArgs,
      access,
    );
    expect(replay).toEqual(result);
    expect(mockedSkuSearch.applyInventoryEffectWithCtx).toHaveBeenCalledTimes(
      1,
    );
  });

  it.each([
    {
      expectedUnitCost: 425,
      runStatus: "undoing",
      rowWorkStatus: "applied",
    },
    {
      expectedUnitCost: 425,
      runStatus: "undone_with_exceptions",
      rowWorkStatus: "undo_exception",
    },
    {
      expectedUnitCost: 700,
      provisionalUndoneAt: 150,
      runStatus: "undone",
      rowUndoneAt: 150,
      rowWorkStatus: "undone",
    },
    {
      expectedUnitCost: 700,
      overlayProductSkuId: "sku-2",
      runStatus: "applied",
      rowWorkStatus: "applied",
    },
  ] as const)(
    "resolves product-page overlay authority from $runStatus/$rowWorkStatus row evidence",
    async ({
      expectedUnitCost,
      overlayProductSkuId,
      provisionalUndoneAt,
      runStatus,
      rowUndoneAt,
      rowWorkStatus,
    }) => {
      const seeded = seedTrustedConversionData();
      const provisional =
        seeded.tables.inventoryImportProvisionalSku.get("provisional-1")!;
      seeded.tables.inventoryImportProvisionalSku.set("provisional-1", {
        ...provisional,
        costOverlayAppliedAt: 140,
        costOverlayRunId: "overlay-run-1",
        costOverlayRowId: "overlay-row-1",
        costOverlaySourceDigest: "source-digest",
        costOverlayUndoneAt: provisionalUndoneAt,
        costOverlayUnitCost: 425,
      });
      const sku = seeded.tables.productSku.get("sku-1")!;
      seeded.tables.productSku.set("sku-1", {
        ...sku,
        unitCost: runStatus === "undone" ? 700 : 425,
      });
      seeded.tables.inventoryImportCostOverlayRun.set("overlay-run-1", {
        _id: "overlay-run-1",
        organizationId: "org-1",
        reviewVersionId: "review-version-1",
        sourceDigest: "source-digest",
        status: runStatus,
        storeId: "store-1",
      });
      seeded.tables.inventoryImportCostOverlayRow.set("overlay-row-1", {
        _id: "overlay-row-1",
        organizationId: "org-1",
        postUnitCostMinor: 425,
        productSkuId: overlayProductSkuId ?? "sku-1",
        provisionalSkuId: "provisional-1",
        runId: "overlay-run-1",
        storeId: "store-1",
        undoneAt: rowUndoneAt,
        workStatus: rowWorkStatus,
      });
      const binding = await readTrustedConversionBinding(seeded.ctx);

      const result = await finalizeTrustedInventoryFromProductPageWithCtx(
        seeded.ctx,
        buildTrustedConversionArgs(binding, { reviewedUnitCost: 700 }),
        access,
      );

      expect(result.kind).toBe("ok");
      expect(mockedSkuSearch.applyInventoryEffectWithCtx).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          valuation: expect.objectContaining({
            costBasis: expect.objectContaining({
              unitCost: expectedUnitCost,
            }),
          }),
        }),
      );
    },
  );

  it("lets a later SKU cost correction supersede stale overlay authority", async () => {
    const seeded = seedTrustedConversionData();
    const provisional =
      seeded.tables.inventoryImportProvisionalSku.get("provisional-1")!;
    seeded.tables.inventoryImportProvisionalSku.set("provisional-1", {
      ...provisional,
      costOverlayAppliedAt: 140,
      costOverlayRunId: "overlay-run-1",
      costOverlayRowId: "overlay-row-1",
      costOverlaySourceDigest: "source-digest",
      costOverlayUnitCost: 425,
    });
    seeded.tables.inventoryImportCostOverlayRun.set("overlay-run-1", {
      _id: "overlay-run-1",
      organizationId: "org-1",
      reviewVersionId: "review-version-1",
      sourceDigest: "source-digest",
      status: "applied",
      storeId: "store-1",
    });
    seeded.tables.inventoryImportCostOverlayRow.set("overlay-row-1", {
      _id: "overlay-row-1",
      organizationId: "org-1",
      postUnitCostMinor: 425,
      productSkuId: "sku-1",
      runId: "overlay-run-1",
      storeId: "store-1",
      workStatus: "applied",
    });
    seeded.tables.productSku.set("sku-1", {
      ...seeded.tables.productSku.get("sku-1")!,
      unitCost: 700,
    });
    const binding = await readTrustedConversionBinding(seeded.ctx);

    const result = await finalizeTrustedInventoryFromProductPageWithCtx(
      seeded.ctx,
      buildTrustedConversionArgs(binding, { reviewedUnitCost: 700 }),
      access,
    );

    expect(result.kind).toBe("ok");
    expect(mockedSkuSearch.applyInventoryEffectWithCtx).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        valuation: expect.objectContaining({
          costBasis: expect.objectContaining({ unitCost: 700 }),
        }),
      }),
    );
  });

  it("dry-runs onboarded legacy import trusted SKU visibility repair", async () => {
    const { ctx, tables } = createMutationCtx({
      category: [
        {
          _id: "category-hair",
          name: "Hair Care",
          slug: "hair-care",
          storeId: "store-1",
        },
        {
          _id: "category-legacy",
          name: "Legacy import",
          slug: "legacy-import",
          storeId: "store-1",
        },
      ],
      inventoryImportProvisionalSku: [
        {
          _id: "provisional-hidden-draft",
          finalizedAt: 1_000,
          productId: "product-hidden-draft",
          productSkuId: "sku-hidden-draft",
          status: "finalized",
          storeId: "store-1",
        },
        {
          _id: "provisional-legacy",
          finalizedAt: 1_000,
          productId: "product-legacy",
          productSkuId: "sku-legacy",
          status: "finalized",
          storeId: "store-1",
        },
      ],
      product: [
        {
          _id: "product-hidden-draft",
          availability: "draft",
          categoryId: "category-hair",
          isVisible: false,
          posVisible: false,
          name: "Hidden Draft",
          storeId: "store-1",
          subcategoryId: "subcategory-hair",
        },
        {
          _id: "product-legacy",
          availability: "draft",
          categoryId: "category-legacy",
          isVisible: false,
          name: "Still Legacy",
          storeId: "store-1",
          subcategoryId: "subcategory-legacy",
        },
      ],
      productSku: [
        {
          _id: "sku-hidden-draft",
          productId: "product-hidden-draft",
          sku: "SKU-HIDDEN-DRAFT",
          storeId: "store-1",
        },
        {
          _id: "sku-legacy",
          productId: "product-legacy",
          sku: "SKU-LEGACY",
          storeId: "store-1",
        },
      ],
      subcategory: [
        {
          _id: "subcategory-hair",
          categoryId: "category-hair",
          name: "Hair Oils",
          slug: "hair-oils",
          storeId: "store-1",
        },
        {
          _id: "subcategory-legacy",
          categoryId: "category-legacy",
          name: "Imported inventory",
          slug: "imported-inventory",
          storeId: "store-1",
        },
      ],
    });

    const result = await repairOnboardedLegacyImportTrustedSkuVisibilityWithCtx(
      ctx,
      {
        dryRun: true,
        limit: 10,
        storeId: "store-1" as Id<"store">,
      },
    );

    expect(result).toMatchObject({
      dryRun: true,
      promotedToLive: 1,
      refreshedSearchProjections: 0,
      repairedProducts: 1,
      scannedRows: 2,
      skippedLegacyTaxonomy: 1,
      taxonomyWorkItemsEnsured: 1,
      visibleProducts: 1,
    });
    expect(result.repairedSkus).toEqual([
      expect.objectContaining({
        productId: "product-hidden-draft",
        productName: "Hidden Draft",
        productSkuId: "sku-hidden-draft",
        sku: "SKU-HIDDEN-DRAFT",
      }),
    ]);
    expect(result.taxonomyWorkItemSkus).toEqual([
      expect.objectContaining({
        productId: "product-legacy",
        productName: "Still Legacy",
        productSkuId: "sku-legacy",
        sku: "SKU-LEGACY",
      }),
    ]);
    expect(tables.product.get("product-hidden-draft")).toMatchObject({
      availability: "draft",
      isVisible: false,
    });
    expect(Array.from(tables.operationalWorkItem.values())).toEqual([]);
    expect(
      mockedSkuSearch.upsertProductSkuSearchProjection,
    ).not.toHaveBeenCalled();
  });

  it("repairs onboarded legacy import trusted SKU visibility and draft status", async () => {
    const { ctx, tables } = createMutationCtx({
      category: [
        {
          _id: "category-hair",
          name: "Hair Care",
          slug: "hair-care",
          storeId: "store-1",
        },
        {
          _id: "category-legacy",
          name: "Legacy import",
          slug: "legacy-import",
          storeId: "store-1",
        },
      ],
      inventoryImportProvisionalSku: [
        {
          _id: "provisional-hidden-draft",
          finalizedAt: 1_000,
          productId: "product-hidden-draft",
          productSkuId: "sku-hidden-draft",
          status: "finalized",
          storeId: "store-1",
        },
        {
          _id: "provisional-visible-live",
          finalizedAt: 1_100,
          productId: "product-visible-live",
          productSkuId: "sku-visible-live",
          status: "active",
          storeId: "store-1",
        },
        {
          _id: "provisional-hidden-draft-other",
          finalizedAt: 1_150,
          productId: "product-hidden-draft",
          productSkuId: "sku-hidden-draft-other",
          status: "finalized",
          storeId: "store-1",
        },
        {
          _id: "provisional-other-store",
          finalizedAt: 1_200,
          productId: "product-other-store",
          productSkuId: "sku-other-store",
          status: "finalized",
          storeId: "store-other",
        },
        {
          _id: "provisional-legacy",
          finalizedAt: 1_300,
          productId: "product-legacy",
          productSkuId: "sku-legacy",
          status: "finalized",
          storeId: "store-1",
        },
      ],
      product: [
        {
          _id: "product-hidden-draft",
          availability: "draft",
          categoryId: "category-hair",
          isVisible: false,
          posVisible: false,
          name: "Hidden Draft",
          storeId: "store-1",
          subcategoryId: "subcategory-hair",
        },
        {
          _id: "product-visible-live",
          availability: "live",
          categoryId: "category-hair",
          isVisible: true,
          name: "Visible Live",
          storeId: "store-1",
          subcategoryId: "subcategory-hair",
        },
        {
          _id: "product-other-store",
          availability: "draft",
          categoryId: "category-hair",
          isVisible: false,
          name: "Other Store",
          storeId: "store-other",
          subcategoryId: "subcategory-hair",
        },
        {
          _id: "product-legacy",
          availability: "draft",
          categoryId: "category-legacy",
          isVisible: false,
          name: "Still Legacy",
          organizationId: "org-1",
          storeId: "store-1",
          subcategoryId: "subcategory-legacy",
        },
      ],
      productSku: [
        {
          _id: "sku-hidden-draft",
          productId: "product-hidden-draft",
          sku: "SKU-HIDDEN-DRAFT",
          storeId: "store-1",
        },
        {
          _id: "sku-hidden-draft-other",
          productId: "product-hidden-draft",
          sku: "SKU-HIDDEN-DRAFT-OTHER",
          storeId: "store-1",
        },
        {
          _id: "sku-visible-live",
          productId: "product-visible-live",
          sku: "SKU-VISIBLE-LIVE",
          storeId: "store-1",
        },
        {
          _id: "sku-other-store",
          productId: "product-other-store",
          sku: "SKU-OTHER",
          storeId: "store-other",
        },
        {
          _id: "sku-legacy",
          productId: "product-legacy",
          sku: "SKU-LEGACY",
          storeId: "store-1",
        },
      ],
      subcategory: [
        {
          _id: "subcategory-hair",
          categoryId: "category-hair",
          name: "Hair Oils",
          slug: "hair-oils",
          storeId: "store-1",
        },
        {
          _id: "subcategory-legacy",
          categoryId: "category-legacy",
          name: "Imported inventory",
          slug: "imported-inventory",
          storeId: "store-1",
        },
      ],
    });

    const result = await repairOnboardedLegacyImportTrustedSkuVisibilityWithCtx(
      ctx,
      {
        dryRun: false,
        limit: 10,
        storeId: "store-1" as Id<"store">,
      },
    );

    expect(result).toMatchObject({
      dryRun: false,
      promotedToLive: 1,
      refreshedSearchProjections: 2,
      repairedProducts: 1,
      scannedRows: 4,
      skippedLegacyTaxonomy: 1,
      taxonomyWorkItemsEnsured: 1,
      visibleProducts: 1,
    });
    expect(tables.product.get("product-hidden-draft")).toMatchObject({
      availability: "live",
      isVisible: false,
      posVisible: true,
    });
    expect(tables.product.get("product-visible-live")).toMatchObject({
      availability: "live",
      isVisible: true,
    });
    expect(
      mockedSkuSearch.upsertProductSkuSearchProjections,
    ).toHaveBeenCalledWith(
      ctx,
      ["sku-hidden-draft", "sku-hidden-draft-other"],
      "store-1",
    );
    expect(
      mockedSkuSearch.upsertProductSkuSearchProjections,
    ).not.toHaveBeenCalledWith(
      ctx,
      expect.arrayContaining(["sku-visible-live"]),
      "store-1",
    );
    expect(Array.from(tables.operationalWorkItem.values())).toEqual([
      expect.objectContaining({
        metadata: expect.objectContaining({
          categorySlug: "legacy-import",
          productId: "product-legacy",
          productSkuId: "sku-legacy",
          provisionalSkuId: "provisional-legacy",
          sku: "SKU-LEGACY",
        }),
        productId: "product-legacy",
        productSkuId: "sku-legacy",
        status: "open",
        title: "Assign catalog category: Still Legacy",
        type: "catalog_taxonomy_setup",
      }),
    ]);
  });

  it("scans finalized active rows without letting non-finalized rows consume the repair page", async () => {
    const nonFinalizedRows = Array.from({ length: 3 }, (_, index) => ({
      _id: `provisional-active-draft-${index + 1}`,
      createdAt: index + 1,
      productId: `product-active-draft-${index + 1}`,
      productSkuId: `sku-active-draft-${index + 1}`,
      status: "active",
      storeId: "store-1",
    }));
    const { ctx, tables } = createMutationCtx({
      category: [
        {
          _id: "category-hair",
          name: "Hair Care",
          slug: "hair-care",
          storeId: "store-1",
        },
      ],
      inventoryImportProvisionalSku: [
        ...nonFinalizedRows,
        {
          _id: "provisional-finalized-active",
          createdAt: 10,
          finalizedAt: 1_500,
          productId: "product-hidden-draft",
          productSkuId: "sku-hidden-draft",
          status: "active",
          storeId: "store-1",
        },
      ],
      product: [
        {
          _id: "product-hidden-draft",
          availability: "draft",
          categoryId: "category-hair",
          isVisible: false,
          posVisible: false,
          name: "Hidden Draft",
          storeId: "store-1",
          subcategoryId: "subcategory-hair",
        },
      ],
      productSku: [
        {
          _id: "sku-hidden-draft",
          productId: "product-hidden-draft",
          sku: "SKU-HIDDEN-DRAFT",
          storeId: "store-1",
        },
      ],
      subcategory: [
        {
          _id: "subcategory-hair",
          categoryId: "category-hair",
          name: "Hair Oils",
          slug: "hair-oils",
          storeId: "store-1",
        },
      ],
    });

    const result = await repairOnboardedLegacyImportTrustedSkuVisibilityWithCtx(
      ctx,
      {
        dryRun: false,
        limit: 1,
        storeId: "store-1" as Id<"store">,
      },
    );

    expect(result).toMatchObject({
      promotedToLive: 1,
      refreshedSearchProjections: 1,
      repairedProducts: 1,
      scannedRows: 1,
      visibleProducts: 1,
    });
    expect(tables.product.get("product-hidden-draft")).toMatchObject({
      availability: "live",
      isVisible: false,
      posVisible: true,
    });
    expect(
      mockedSkuSearch.upsertProductSkuSearchProjections,
    ).toHaveBeenCalledWith(ctx, ["sku-hidden-draft"], "store-1");
  });

  it("returns a cursor so legacy visibility repair can advance past skipped rows", async () => {
    const { ctx, tables } = createMutationCtx({
      category: [
        {
          _id: "category-hair",
          name: "Hair Care",
          slug: "hair-care",
          storeId: "store-1",
        },
      ],
      inventoryImportProvisionalSku: [
        {
          _id: "provisional-clean",
          finalizedAt: 100,
          productId: "product-clean",
          productSkuId: "sku-clean",
          status: "active",
          storeId: "store-1",
        },
        {
          _id: "provisional-hidden-draft",
          finalizedAt: 200,
          productId: "product-hidden-draft",
          productSkuId: "sku-hidden-draft",
          status: "active",
          storeId: "store-1",
        },
      ],
      product: [
        {
          _id: "product-clean",
          availability: "live",
          categoryId: "category-hair",
          isVisible: true,
          name: "Clean Product",
          storeId: "store-1",
          subcategoryId: "subcategory-hair",
        },
        {
          _id: "product-hidden-draft",
          availability: "draft",
          categoryId: "category-hair",
          isVisible: false,
          posVisible: false,
          name: "Hidden Draft",
          storeId: "store-1",
          subcategoryId: "subcategory-hair",
        },
      ],
      productSku: [
        {
          _id: "sku-clean",
          productId: "product-clean",
          sku: "SKU-CLEAN",
          storeId: "store-1",
        },
        {
          _id: "sku-hidden-draft",
          productId: "product-hidden-draft",
          sku: "SKU-HIDDEN-DRAFT",
          storeId: "store-1",
        },
      ],
      subcategory: [
        {
          _id: "subcategory-hair",
          categoryId: "category-hair",
          name: "Hair Oils",
          slug: "hair-oils",
          storeId: "store-1",
        },
      ],
    });

    const firstPage =
      await repairOnboardedLegacyImportTrustedSkuVisibilityWithCtx(ctx, {
        dryRun: false,
        limit: 1,
        storeId: "store-1" as Id<"store">,
      });

    expect(firstPage).toMatchObject({
      refreshedSearchProjections: 0,
      repairedProducts: 0,
      scannedRows: 1,
      truncated: true,
      nextCursor: {
        finalizedAt: 100,
        scannedRowIds: ["provisional-clean"],
        status: "active",
      },
    });

    const secondPage =
      await repairOnboardedLegacyImportTrustedSkuVisibilityWithCtx(ctx, {
        cursor: firstPage.nextCursor,
        dryRun: false,
        limit: 1,
        storeId: "store-1" as Id<"store">,
      });

    expect(secondPage).toMatchObject({
      promotedToLive: 1,
      refreshedSearchProjections: 1,
      repairedProducts: 1,
      scannedRows: 1,
      truncated: false,
      visibleProducts: 1,
    });
    expect(tables.product.get("product-hidden-draft")).toMatchObject({
      availability: "live",
      isVisible: false,
      posVisible: true,
    });
    expect(
      mockedSkuSearch.upsertProductSkuSearchProjections,
    ).toHaveBeenCalledWith(ctx, ["sku-hidden-draft"], "store-1");
  });

  it("continues through repair candidates that share a finalizedAt timestamp", async () => {
    const { ctx, tables } = createMutationCtx({
      category: [
        {
          _id: "category-hair",
          name: "Hair Care",
          slug: "hair-care",
          storeId: "store-1",
        },
      ],
      inventoryImportProvisionalSku: [
        {
          _id: "provisional-hidden-draft-1",
          finalizedAt: 300,
          productId: "product-hidden-draft-1",
          productSkuId: "sku-hidden-draft-1",
          status: "active",
          storeId: "store-1",
        },
        {
          _id: "provisional-hidden-draft-2",
          finalizedAt: 300,
          productId: "product-hidden-draft-2",
          productSkuId: "sku-hidden-draft-2",
          status: "active",
          storeId: "store-1",
        },
      ],
      product: [
        {
          _id: "product-hidden-draft-1",
          availability: "draft",
          categoryId: "category-hair",
          isVisible: false,
          posVisible: false,
          name: "Hidden Draft 1",
          storeId: "store-1",
          subcategoryId: "subcategory-hair",
        },
        {
          _id: "product-hidden-draft-2",
          availability: "draft",
          categoryId: "category-hair",
          isVisible: false,
          name: "Hidden Draft 2",
          storeId: "store-1",
          subcategoryId: "subcategory-hair",
        },
      ],
      productSku: [
        {
          _id: "sku-hidden-draft-1",
          productId: "product-hidden-draft-1",
          sku: "SKU-HIDDEN-DRAFT-1",
          storeId: "store-1",
        },
        {
          _id: "sku-hidden-draft-2",
          productId: "product-hidden-draft-2",
          sku: "SKU-HIDDEN-DRAFT-2",
          storeId: "store-1",
        },
      ],
      subcategory: [
        {
          _id: "subcategory-hair",
          categoryId: "category-hair",
          name: "Hair Oils",
          slug: "hair-oils",
          storeId: "store-1",
        },
      ],
    });

    const firstPage =
      await repairOnboardedLegacyImportTrustedSkuVisibilityWithCtx(ctx, {
        dryRun: false,
        limit: 1,
        storeId: "store-1" as Id<"store">,
      });
    const secondPage =
      await repairOnboardedLegacyImportTrustedSkuVisibilityWithCtx(ctx, {
        cursor: firstPage.nextCursor,
        dryRun: false,
        limit: 1,
        storeId: "store-1" as Id<"store">,
      });

    expect(firstPage.nextCursor).toMatchObject({
      finalizedAt: 300,
      scannedRowIds: ["provisional-hidden-draft-1"],
      status: "active",
    });
    expect(secondPage).toMatchObject({
      refreshedSearchProjections: 1,
      repairedProducts: 1,
      scannedRows: 1,
      truncated: false,
    });
    expect(tables.product.get("product-hidden-draft-1")).toMatchObject({
      availability: "live",
      isVisible: false,
      posVisible: true,
    });
    expect(tables.product.get("product-hidden-draft-2")).toMatchObject({
      availability: "live",
      isVisible: false,
      posVisible: true,
    });
    expect(
      mockedSkuSearch.upsertProductSkuSearchProjections,
    ).toHaveBeenNthCalledWith(1, ctx, ["sku-hidden-draft-1"], "store-1");
    expect(
      mockedSkuSearch.upsertProductSkuSearchProjections,
    ).toHaveBeenNthCalledWith(2, ctx, ["sku-hidden-draft-2"], "store-1");
  });

  it("does not create an inventory movement when finalization has no trusted stock delta", async () => {
    const { ctx, tables } = seedTrustedConversionData();
    const binding = await readTrustedConversionBinding(ctx);

    const result = await finalizeTrustedInventoryFromProductPageWithCtx(
      ctx,
      {
        conversionRequestId: "conversion-1",
        productId: "product-1" as Id<"product">,
        productSkuId: "sku-1" as Id<"productSku">,
        provisionalSkuId:
          "provisional-1" as Id<"inventoryImportProvisionalSku">,
        reviewedInventoryCount: 2,
        reviewedIsVisible: true,
        reviewedPrice: 50000,
        reviewedQuantityAvailable: 2,
        saleEvidenceFingerprint: binding.saleEvidenceFingerprint!,
        sourceSurface: "product_edit",
        storeId: "store-1" as Id<"store">,
        trustedSkuFingerprint: binding.trustedSkuFingerprint!,
      },
      access,
    );

    expect(result.kind).toBe("ok");
    expect(Array.from(tables.inventoryMovement.values())).toHaveLength(0);
    expect(Array.from(tables.skuActivityEvent.values())).toHaveLength(1);
    expect(Array.from(tables.skuActivityEvent.values())[0]).toMatchObject({
      activityType: "provisional_import_trusted_finalization",
      status: "committed",
      stockQuantityDelta: 0,
    });
  });

  it("rejects POS-hidden trusted inventory finalization", async () => {
    const { ctx, tables } = seedTrustedConversionData();
    const binding = await readTrustedConversionBinding(ctx);

    const result = await finalizeTrustedInventoryFromProductPageWithCtx(
      ctx,
      buildTrustedConversionArgs(binding, {
        reviewedIsVisible: true,
        reviewedPosVisible: false,
      }),
      access,
    );

    expect(result).toMatchObject({
      error: {
        code: "precondition_failed",
        message:
          "Make this SKU available in POS before finalizing trusted inventory.",
      },
      kind: "user_error",
    });
    expect(tables.productSku.get("sku-1")).toMatchObject({
      inventoryCount: 2,
      quantityAvailable: 2,
    });
    expect(tables.productSku.get("sku-1")).not.toHaveProperty("posVisible");
    expect(Array.from(tables.inventoryMovement.values())).toHaveLength(0);
    expect(Array.from(tables.skuActivityEvent.values())).toHaveLength(0);
  });

  it("returns the stored success on identical product-page finalization retries", async () => {
    const { ctx, tables } = seedTrustedConversionData();
    const binding = await readTrustedConversionBinding(ctx);
    const args = buildTrustedConversionArgs(binding);

    const first = await finalizeTrustedInventoryFromProductPageWithCtx(
      ctx,
      args,
      access,
    );
    const second = await finalizeTrustedInventoryFromProductPageWithCtx(
      ctx,
      args,
      access,
    );

    expect(first).toEqual(second);
    expect(Array.from(tables.inventoryMovement.values())).toHaveLength(1);
    expect(Array.from(tables.operationalWorkItem.values())).toHaveLength(1);
    expect(Array.from(tables.skuActivityEvent.values())).toHaveLength(2);
  });

  it("rejects reused product-page finalization request ids with changed reviewed values before side effects", async () => {
    const { ctx, tables } = seedTrustedConversionData();
    const binding = await readTrustedConversionBinding(ctx);
    const firstArgs = buildTrustedConversionArgs(binding);

    const first = await finalizeTrustedInventoryFromProductPageWithCtx(
      ctx,
      firstArgs,
      access,
    );
    const second = await finalizeTrustedInventoryFromProductPageWithCtx(
      ctx,
      {
        ...firstArgs,
        reviewedInventoryCount: 11,
        reviewedPrice: 51000,
        reviewedQuantityAvailable: 9,
      },
      access,
    );

    expect(first.kind).toBe("ok");
    expect(second).toMatchObject({
      error: { code: "conflict" },
      kind: "user_error",
    });
    expect(tables.productSku.get("sku-1")).toMatchObject({
      inventoryCount: 10,
      price: 50000,
      quantityAvailable: 8,
    });
    expect(
      tables.inventoryImportProvisionalSku.get("provisional-1"),
    ).toMatchObject({
      finalTrustedQuantity: 10,
      status: "active",
    });
    expect(Array.from(tables.inventoryMovement.values())).toHaveLength(1);
    expect(Array.from(tables.skuActivityEvent.values())).toHaveLength(2);
  });

  it("rejects stale sale evidence before product-page finalization writes", async () => {
    const { ctx, tables } = seedTrustedConversionData();
    const binding = await readTrustedConversionBinding(ctx);
    await ctx.db.patch("inventoryImportProvisionalSku", "provisional-1", {
      saleEvidence: {
        ...tables.inventoryImportProvisionalSku.get("provisional-1")!
          .saleEvidence,
        saleCount: 2,
        totalQuantitySold: 3,
      },
      updatedAt: 200,
    });

    const result = await finalizeTrustedInventoryFromProductPageWithCtx(
      ctx,
      {
        conversionRequestId: "conversion-1",
        productId: "product-1" as Id<"product">,
        productSkuId: "sku-1" as Id<"productSku">,
        provisionalSkuId:
          "provisional-1" as Id<"inventoryImportProvisionalSku">,
        reviewedInventoryCount: 10,
        reviewedIsVisible: true,
        reviewedPosVisible: true,
        reviewedPrice: 50000,
        reviewedQuantityAvailable: 8,
        saleEvidenceFingerprint: binding.saleEvidenceFingerprint!,
        sourceSurface: "product_edit",
        storeId: "store-1" as Id<"store">,
        trustedSkuFingerprint: binding.trustedSkuFingerprint!,
      },
      access,
    );

    expect(result).toMatchObject({
      error: { code: "conflict" },
      kind: "user_error",
    });
    expect(tables.productSku.get("sku-1")).toMatchObject({ inventoryCount: 2 });
    expect(
      tables.inventoryImportProvisionalSku.get("provisional-1"),
    ).toMatchObject({
      status: "active",
    });
  });

  it("rejects stale trusted SKU fingerprints before product-page finalization writes", async () => {
    const { ctx, tables } = seedTrustedConversionData();
    const binding = await readTrustedConversionBinding(ctx);
    await ctx.db.patch("productSku", "sku-1", {
      inventoryCount: 3,
      price: 31000,
      quantityAvailable: 3,
    });

    const result = await finalizeTrustedInventoryFromProductPageWithCtx(
      ctx,
      buildTrustedConversionArgs(binding),
      access,
    );

    expect(result).toMatchObject({
      error: { code: "conflict" },
      kind: "user_error",
    });
    expect(tables.productSku.get("sku-1")).toMatchObject({
      inventoryCount: 3,
      price: 31000,
      quantityAvailable: 3,
    });
    expect(
      tables.inventoryImportProvisionalSku.get("provisional-1"),
    ).toMatchObject({
      status: "active",
    });
    expect(Array.from(tables.inventoryMovement.values())).toHaveLength(0);
    expect(Array.from(tables.skuActivityEvent.values())).toHaveLength(0);
  });

  it("blocks product-page finalization when active POS holds exist", async () => {
    const { ctx, tables } = seedTrustedConversionData({
      inventoryHold: [
        {
          _id: "hold-1",
          createdAt: 100,
          expiresAt: Date.now() + 60_000,
          productSkuId: "sku-1",
          quantity: 1,
          sourceSessionId: "pos-session-1",
          sourceType: "posSession",
          status: "active",
          storeId: "store-1",
          updatedAt: 100,
        },
      ],
    });
    const binding = await readTrustedConversionBinding(ctx);

    const result = await finalizeTrustedInventoryFromProductPageWithCtx(
      ctx,
      {
        conversionRequestId: "conversion-1",
        productId: "product-1" as Id<"product">,
        productSkuId: "sku-1" as Id<"productSku">,
        provisionalSkuId:
          "provisional-1" as Id<"inventoryImportProvisionalSku">,
        reviewedInventoryCount: 10,
        reviewedIsVisible: true,
        reviewedPosVisible: true,
        reviewedPrice: 50000,
        reviewedQuantityAvailable: 8,
        saleEvidenceFingerprint: binding.saleEvidenceFingerprint!,
        sourceSurface: "product_edit",
        storeId: "store-1" as Id<"store">,
        trustedSkuFingerprint: binding.trustedSkuFingerprint!,
      },
      access,
    );

    expect(result).toMatchObject({
      error: { code: "precondition_failed" },
      kind: "user_error",
    });
    expect(
      tables.inventoryImportProvisionalSku.get("provisional-1"),
    ).toMatchObject({
      status: "active",
    });
  });

  it("blocks product-page finalization when an active checkout reservation exists", async () => {
    const { ctx, tables } = seedTrustedConversionData({
      checkoutSession: [
        {
          _id: "checkout-session-active",
          expiresAt: Date.now() + 60_000,
          hasCompletedCheckoutSession: false,
          storeId: "store-1",
          storeFrontUserId: "guest-1",
        },
      ],
      checkoutSessionItem: [
        {
          _id: "checkout-item-active",
          price: 50000,
          productId: "product-1",
          productSku: "BW-18",
          productSkuId: "sku-1",
          quantity: 1,
          sesionId: "checkout-session-active",
          storeFrontUserId: "guest-1",
        },
      ],
    });
    const binding = await readTrustedConversionBinding(ctx);

    const result = await finalizeTrustedInventoryFromProductPageWithCtx(
      ctx,
      buildTrustedConversionArgs(binding),
      access,
    );

    expect(result).toMatchObject({
      error: { code: "precondition_failed" },
      kind: "user_error",
    });
    expect(tables.productSku.get("sku-1")).toMatchObject({ inventoryCount: 2 });
    expect(
      tables.inventoryImportProvisionalSku.get("provisional-1"),
    ).toMatchObject({
      status: "active",
    });
    expect(Array.from(tables.inventoryMovement.values())).toHaveLength(0);
    expect(Array.from(tables.skuActivityEvent.values())).toHaveLength(0);
  });

  it("ignores historical and abandoned checkout rows when no active checkout reservation exists", async () => {
    const completedItems = Array.from({ length: 101 }, (_, index) => ({
      _id: `checkout-item-stale-${index}`,
      price: 50000,
      productId: "product-1",
      productSku: "BW-18",
      productSkuId: "sku-1",
      quantity: 1,
      sesionId: `checkout-session-stale-${index}`,
      storeFrontUserId: "guest-1",
    }));
    const completedSessions = Array.from({ length: 101 }, (_, index) => ({
      _id: `checkout-session-stale-${index}`,
      expiresAt: Date.now() - 60_000,
      hasCompletedCheckoutSession: true,
      storeId: "store-1",
      storeFrontUserId: "guest-1",
    }));
    const abandonedItems = Array.from({ length: 201 }, (_, index) => ({
      _id: `checkout-item-abandoned-${index}`,
      price: 50000,
      productId: "product-1",
      productSku: "BW-18",
      productSkuId: "sku-1",
      quantity: 1,
      sesionId: `checkout-session-abandoned-${index}`,
      storeFrontUserId: "guest-1",
    }));
    const abandonedSessions = Array.from({ length: 201 }, (_, index) => ({
      _id: `checkout-session-abandoned-${index}`,
      expiresAt: Date.now() - 60_000,
      hasCompletedCheckoutSession: false,
      storeId: "store-1",
      storeFrontUserId: "guest-1",
    }));
    const { ctx, tables } = seedTrustedConversionData({
      checkoutSession: [...completedSessions, ...abandonedSessions],
      checkoutSessionItem: [...completedItems, ...abandonedItems],
    });
    const binding = await readTrustedConversionBinding(ctx);

    const result = await finalizeTrustedInventoryFromProductPageWithCtx(
      ctx,
      buildTrustedConversionArgs(binding),
      access,
    );

    expect(result.kind).toBe("ok");
    expect(tables.productSku.get("sku-1")).toMatchObject({
      inventoryCount: 10,
      quantityAvailable: 8,
    });
    expect(
      tables.inventoryImportProvisionalSku.get("provisional-1"),
    ).toMatchObject({
      status: "active",
    });
  });

  it("fails closed when historical checkout rows accompany an active reservation", async () => {
    const staleItems = Array.from({ length: 100 }, (_, index) => ({
      _id: `checkout-item-stale-${index}`,
      price: 50000,
      productId: "product-1",
      productSku: "BW-18",
      productSkuId: "sku-1",
      quantity: 1,
      sesionId: `checkout-session-stale-${index}`,
      storeFrontUserId: "guest-1",
    }));
    const staleSessions = Array.from({ length: 100 }, (_, index) => ({
      _id: `checkout-session-stale-${index}`,
      expiresAt: Date.now() - 60_000,
      hasCompletedCheckoutSession: true,
      storeId: "store-1",
      storeFrontUserId: "guest-1",
    }));
    const { ctx, tables } = seedTrustedConversionData({
      checkoutSession: [
        ...staleSessions,
        {
          _id: "checkout-session-active",
          expiresAt: Date.now() + 60_000,
          hasCompletedCheckoutSession: false,
          storeId: "store-1",
          storeFrontUserId: "guest-1",
        },
      ],
      checkoutSessionItem: [
        ...staleItems,
        {
          _id: "checkout-item-active",
          price: 50000,
          productId: "product-1",
          productSku: "BW-18",
          productSkuId: "sku-1",
          quantity: 1,
          sesionId: "checkout-session-active",
          storeFrontUserId: "guest-1",
        },
      ],
    });
    const binding = await readTrustedConversionBinding(ctx);

    const result = await finalizeTrustedInventoryFromProductPageWithCtx(
      ctx,
      {
        conversionRequestId: "conversion-1",
        productId: "product-1" as Id<"product">,
        productSkuId: "sku-1" as Id<"productSku">,
        provisionalSkuId:
          "provisional-1" as Id<"inventoryImportProvisionalSku">,
        reviewedInventoryCount: 10,
        reviewedIsVisible: true,
        reviewedPosVisible: true,
        reviewedPrice: 50000,
        reviewedQuantityAvailable: 8,
        saleEvidenceFingerprint: binding.saleEvidenceFingerprint,
        sourceSurface: "product_edit",
        storeId: "store-1" as Id<"store">,
        trustedSkuFingerprint: binding.trustedSkuFingerprint,
      },
      access,
    );

    expect(result).toMatchObject({
      error: { code: "precondition_failed" },
      kind: "user_error",
    });
    expect(tables.productSku.get("sku-1")).toMatchObject({ inventoryCount: 2 });
    expect(
      tables.inventoryImportProvisionalSku.get("provisional-1"),
    ).toMatchObject({
      status: "active",
    });
  });

  it("detects an active checkout reservation behind many expired abandoned sessions", async () => {
    const abandonedItems = Array.from({ length: 201 }, (_, index) => ({
      _id: `checkout-item-abandoned-${index}`,
      price: 50000,
      productId: "product-1",
      productSku: "BW-18",
      productSkuId: "sku-1",
      quantity: 1,
      sesionId: `checkout-session-abandoned-${index}`,
      storeFrontUserId: "guest-1",
    }));
    const abandonedSessions = Array.from({ length: 201 }, (_, index) => ({
      _id: `checkout-session-abandoned-${index}`,
      expiresAt: Date.now() - 60_000,
      hasCompletedCheckoutSession: false,
      storeId: "store-1",
      storeFrontUserId: "guest-1",
    }));
    const { ctx, tables } = seedTrustedConversionData({
      checkoutSession: [
        ...abandonedSessions,
        {
          _id: "checkout-session-active",
          expiresAt: Date.now() + 60_000,
          hasCompletedCheckoutSession: false,
          storeId: "store-1",
          storeFrontUserId: "guest-1",
        },
      ],
      checkoutSessionItem: [
        ...abandonedItems,
        {
          _id: "checkout-item-active",
          price: 50000,
          productId: "product-1",
          productSku: "BW-18",
          productSkuId: "sku-1",
          quantity: 1,
          sesionId: "checkout-session-active",
          storeFrontUserId: "guest-1",
        },
      ],
    });
    const binding = await readTrustedConversionBinding(ctx);

    const result = await finalizeTrustedInventoryFromProductPageWithCtx(
      ctx,
      buildTrustedConversionArgs(binding),
      access,
    );

    expect(result).toMatchObject({
      error: { code: "precondition_failed" },
      kind: "user_error",
    });
    expect(tables.productSku.get("sku-1")).toMatchObject({ inventoryCount: 2 });
    expect(
      tables.inventoryImportProvisionalSku.get("provisional-1"),
    ).toMatchObject({
      status: "active",
    });
    expect(Array.from(tables.inventoryMovement.values())).toHaveLength(0);
    expect(Array.from(tables.skuActivityEvent.values())).toHaveLength(0);
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

  it("rejects taxonomy cleanup when active product rows exceed the finalization cap", async () => {
    const provisionalRows = Array.from({ length: 26 }, (_, index) => ({
      _id: `provisional-${index}`,
      finalTrustedQuantity: 2,
      finalizedAt: 1_000 + index,
      productId: "product-1",
      productSkuId: "sku-1",
      status: "active",
      storeId: "store-1",
    }));
    const { ctx } = createMutationCtx({
      category: [
        {
          _id: "category-1",
          name: "Hair",
          slug: "hair",
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
      inventoryImportProvisionalSku: provisionalRows,
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

    await expect(
      completeFinalizedLegacyImportRowsForProductTaxonomyWithCtx(ctx, {
        productId: "product-1" as Id<"product">,
        storeId: "store-1" as Id<"store">,
      }),
    ).rejects.toThrow(
      "Cannot complete catalog setup because this product has too many active legacy import rows to finalize safely.",
    );
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

    const staged = await stageInventoryImportReviewRowsForPosWithCtx(
      ctx,
      {
        importKey: "legacy-review-1",
        reviewVersionId:
          "review-version-1" as Id<"inventoryImportReviewVersion">,
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
      },
      access,
    );

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
    expect(
      Array.from(tables.inventoryImportProvisionalSku.values())[0],
    ).toMatchObject({
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

    const staged = await stageInventoryImportReviewRowsForPosWithCtx(
      ctx,
      {
        importKey: "legacy-review-1",
        reviewVersionId:
          "review-version-1" as Id<"inventoryImportReviewVersion">,
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
      },
      access,
    );

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
    expect(
      Array.from(tables.inventoryImportProvisionalSku.values())[0],
    ).toMatchObject({
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

    const first = await stageInventoryImportReviewRowsForPosWithCtx(
      ctx,
      args,
      access,
    );
    const second = await stageInventoryImportReviewRowsForPosWithCtx(
      ctx,
      {
        ...args,
        rows: [{ ...args.rows[0], price: 2700, quantity: 5 }, args.rows[1]],
      },
      access,
    );

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
    expect(
      Array.from(tables.inventoryImportProvisionalSku.values())[0],
    ).toMatchObject({
      importedPrice: 2700,
      importedQuantity: 5,
      rowKey: "2:COMB-1::Comb",
    });

    const closed = await stageInventoryImportReviewRowsForPosWithCtx(
      ctx,
      {
        ...args,
        rows: [{ ...args.rows[0], action: "skip_row" as const }],
      },
      access,
    );

    expect(closed).toMatchObject({
      alreadyStaged: true,
      provisionalRowsUpdated: 1,
      rowsSkipped: 1,
    });
    expect(
      Array.from(tables.inventoryImportProvisionalSku.values())[0],
    ).toMatchObject({
      posExposureStatus: "hidden",
      status: "closed",
    });

    const notReopened = await stageInventoryImportReviewRowsForPosWithCtx(
      ctx,
      {
        ...args,
        rows: [{ ...args.rows[0], price: 3100, quantity: 9 }],
      },
      access,
    );

    expect(notReopened).toMatchObject({
      alreadyStaged: true,
      provisionalRowsUpdated: 0,
      rowsSkipped: 1,
    });
    expect(
      Array.from(tables.inventoryImportProvisionalSku.values())[0],
    ).toMatchObject({
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
      stageInventoryImportReviewRowsForPosWithCtx(
        ctx,
        {
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
        },
        access,
      ),
    ).rejects.toThrow(
      "Terminal context is required before using manager elevation.",
    );
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
    ).rejects.toThrow(
      "Terminal context is required before using manager elevation.",
    );

    await expect(
      listInventoryImportReviewSkuContextWithCtx(ctx, {
        managerElevationId: "elevation-1" as Id<"managerElevation">,
        storeId: "store-1" as Id<"store">,
      }),
    ).rejects.toThrow(
      "Terminal context is required before using manager elevation.",
    );
  });
});
