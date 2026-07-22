import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import * as athenaUserAuth from "../lib/athenaUserAuth";
import * as sharedDemoActor from "../sharedDemo/actor";

vi.mock("../lib/athenaUserAuth", () => ({
  requireAuthenticatedAthenaUserWithCtx: vi.fn(),
  requireOrganizationMemberRoleWithCtx: vi.fn(),
}));
vi.mock("../sharedDemo/actor", () => ({
  getSharedDemoActorWithCtx: vi.fn(),
  requireSharedDemoStoreReadIfApplicable: vi.fn(),
}));

import {
  buildSkuActivityEvent,
  getSkuActivityForProductSkuWithCtx,
  getUntrustedSkuSaleEvidence,
  getUntrustedSkuSaleEvidenceWithCtx,
  recordSkuActivityEventWithCtx,
} from "./skuActivity";

type TableName =
  | "checkoutSession"
  | "checkoutSessionItem"
  | "inventoryHold"
  | "inventoryImportProvisionalSku"
  | "product"
  | "productSku"
  | "posPendingCheckoutItem"
  | "posTransaction"
  | "posTransactionAdjustment"
  | "posTransactionAdjustmentLine"
  | "posTransactionItem"
  | "skuActivityEvent";

function getHandler<TArgs, TResult>(definition: unknown) {
  return (definition as { _handler: (ctx: unknown, args: TArgs) => TResult })
    ._handler;
}

describe("SKU activity public read access", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(athenaUserAuth.requireAuthenticatedAthenaUserWithCtx).mockResolvedValue({
      _id: "user-1",
    } as never);
    vi.mocked(athenaUserAuth.requireOrganizationMemberRoleWithCtx).mockResolvedValue({} as never);
    vi.mocked(sharedDemoActor.requireSharedDemoStoreReadIfApplicable).mockResolvedValue(null);
    vi.mocked(sharedDemoActor.getSharedDemoActorWithCtx).mockResolvedValue(null);
  });

  it("allows the shared demo to read untrusted SKU sale evidence without normal-user auth", async () => {
    vi.mocked(sharedDemoActor.getSharedDemoActorWithCtx).mockResolvedValueOnce({
      athenaUserId: "demo-user-1",
      kind: "shared_demo",
      organizationId: "org-1",
      storeId: "store-1",
    } as never);
    const { ctx } = createIndexedDb({});
    const db = ctx.db as unknown as Record<string, unknown>;
    const demoCtx = {
      db: {
        ...db,
        get: async (tableOrId: string, id?: string) =>
          tableOrId === "store" && id === "store-1"
            ? { _id: "store-1", organizationId: "org-1" }
            : (db.get as (tableOrId: string, id?: string) => unknown)(tableOrId, id),
      },
    } as unknown as QueryCtx;

    await getHandler(getUntrustedSkuSaleEvidence)(demoCtx, {
      storeId: "store-1" as Id<"store">,
    });

    expect(
      sharedDemoActor.getSharedDemoActorWithCtx,
    ).toHaveBeenCalledWith(demoCtx);
    expect(
      sharedDemoActor.requireSharedDemoStoreReadIfApplicable,
    ).not.toHaveBeenCalled();
    expect(
      athenaUserAuth.requireAuthenticatedAthenaUserWithCtx,
    ).not.toHaveBeenCalled();
  });
});

type Tables = Record<TableName, Map<string, Record<string, unknown>>>;

function createIndexedDb(seed: Partial<Tables>) {
  const tables: Tables = {
    checkoutSession: new Map(),
    checkoutSessionItem: new Map(),
    inventoryHold: new Map(),
    inventoryImportProvisionalSku: new Map(),
    product: new Map(),
    productSku: new Map(),
    posPendingCheckoutItem: new Map(),
    posTransaction: new Map(),
    posTransactionAdjustment: new Map(),
    posTransactionAdjustmentLine: new Map(),
    posTransactionItem: new Map(),
    skuActivityEvent: new Map(),
    ...seed,
  };
  const insertCounters = {
    skuActivityEvent: tables.skuActivityEvent.size,
  };

  function fieldValue(record: Record<string, unknown>, fieldPath: string) {
    return fieldPath.split(".").reduce<unknown>((value, key) => {
      if (!value || typeof value !== "object") {
        return undefined;
      }

      return (value as Record<string, unknown>)[key];
    }, record);
  }

  function filteredRecords(
    table: TableName,
    filters: Record<string, unknown>,
    ranges: Array<{ field: string; op: "gt"; value: number }>
  ) {
    return Array.from(tables[table].values()).filter((record) =>
      Object.entries(filters).every(
        ([field, value]) => fieldValue(record, field) === value
      ) &&
      ranges.every((range) => {
        const value = fieldValue(record, range.field);
        return typeof value === "number" && value > range.value;
      })
    );
  }

  const db = {
    get: async (tableOrId: string, maybeId?: string) => {
      if (maybeId) {
        return tables[tableOrId as TableName].get(maybeId) ?? null;
      }

      for (const table of Object.values(tables)) {
        const row = table.get(tableOrId);
        if (row) return row;
      }

      return null;
    },
    insert: async (tableName: TableName, input: Record<string, unknown>) => {
      if (tableName !== "skuActivityEvent") {
        throw new Error(`Unexpected insert into ${tableName}`);
      }

      insertCounters.skuActivityEvent += 1;
      const id = `sku-activity-${insertCounters.skuActivityEvent}`;
      tables.skuActivityEvent.set(id, { _id: id, ...input });
      return id;
    },
    normalizeId: (_tableName: TableName, id: string) => id,
    query: (tableName: TableName) => ({
      withIndex(
        _indexName: string,
        apply: (builder: {
          eq: (field: string, value: unknown) => unknown;
          gt: (field: string, value: number) => unknown;
        }) => void
      ) {
        const filters: Record<string, unknown> = {};
        const ranges: Array<{ field: string; op: "gt"; value: number }> = [];
        const builder = {
          eq(field: string, value: unknown) {
            filters[field] = value;
            return builder;
          },
          gt(field: string, value: number) {
            ranges.push({ field, op: "gt", value });
            return builder;
          },
        };
        apply(builder);
        const page = filteredRecords(tableName, filters, ranges);

        const chain = {
          collect: async () => page,
          first: async () => page[0] ?? null,
          order: () => chain,
          take: async (limit: number) => page.slice(0, limit),
        };

        return chain;
      },
    }),
  };

  return { ctx: { db } as unknown as MutationCtx & QueryCtx, tables };
}

describe("SKU activity ledger helpers", () => {
  it("builds auditable reservation events with source and status context", () => {
    const event = buildSkuActivityEvent({
      activityType: "reservation_acquired",
      idempotencyKey: "hold-1:acquired",
      occurredAt: 1_000,
      productSkuId: "sku-1" as Id<"productSku">,
      reservationQuantity: 2,
      sourceId: "pos-session-1",
      sourceType: "posSession",
      status: "active",
      storeId: "store-1" as Id<"store">,
    });

    expect(event).toMatchObject({
      activityType: "reservation_acquired",
      idempotencyKey: "hold-1:acquired",
      productSkuId: "sku-1",
      reservationQuantity: 2,
      sourceId: "pos-session-1",
      sourceType: "posSession",
      status: "active",
      storeId: "store-1",
    });
    expect(event.createdAt).toEqual(expect.any(Number));
  });

  it("requires source identity, SKU identity, and status for zero-impact events", () => {
    expect(() =>
      buildSkuActivityEvent({
        activityType: "reservation_released",
        idempotencyKey: "hold-1:released",
        occurredAt: 1_000,
        productSkuId: "" as Id<"productSku">,
        reservationQuantity: 1,
        sourceId: "pos-session-1",
        sourceType: "posSession",
        status: "released",
        storeId: "store-1" as Id<"store">,
      })
    ).toThrow("SKU activity requires a product SKU.");

    expect(() =>
      buildSkuActivityEvent({
        activityType: "reservation_released",
        idempotencyKey: "hold-1:released",
        occurredAt: 1_000,
        productSkuId: "sku-1" as Id<"productSku">,
        reservationQuantity: 0,
        sourceId: "pos-session-1",
        sourceType: "posSession",
        storeId: "store-1" as Id<"store">,
      })
    ).toThrow("Zero-impact SKU activity requires explicit status context.");
  });

  it("records events idempotently by store and idempotency key", async () => {
    const { ctx, tables } = createIndexedDb({
      productSku: new Map([
        [
          "sku-1",
          {
            _id: "sku-1",
            inventoryCount: 5,
            productId: "product-1",
            quantityAvailable: 5,
            sku: "CW-18",
            storeId: "store-1",
          },
        ],
      ]),
    });

    const args = {
      activityType: "reservation_acquired",
      idempotencyKey: "hold-1:acquired",
      occurredAt: 1_000,
      productSkuId: "sku-1" as Id<"productSku">,
      reservationQuantity: 1,
      sourceId: "pos-session-1",
      sourceType: "posSession",
      status: "active",
      storeId: "store-1" as Id<"store">,
    };

    const first = await recordSkuActivityEventWithCtx(ctx, args);
    const second = await recordSkuActivityEventWithCtx(ctx, args);

    expect(first?._id).toBe(second?._id);
    expect(tables.skuActivityEvent).toHaveLength(1);
  });

  it("rejects an idempotency replay when line identity or quantity changes", async () => {
    const { ctx, tables } = createIndexedDb({
      productSku: new Map([
        [
          "sku-1",
          {
            _id: "sku-1",
            inventoryCount: 5,
            productId: "product-1",
            quantityAvailable: 5,
            sku: "CW-18",
            storeId: "store-1",
          },
        ],
      ]),
    });
    const args = {
      activityType: "stock_sale",
      idempotencyKey: "movement:1",
      occurredAt: 1_000,
      productSkuId: "sku-1" as Id<"productSku">,
      sourceId: "sale-1",
      sourceLineId: "line-1",
      sourceType: "posTransaction",
      status: "committed",
      stockQuantityDelta: -1,
      storeId: "store-1" as Id<"store">,
    };

    await recordSkuActivityEventWithCtx(ctx, args);

    await expect(
      recordSkuActivityEventWithCtx(ctx, {
        ...args,
        sourceLineId: "line-2",
      }),
    ).rejects.toThrow(/idempotency key conflicts/i);
    await expect(
      recordSkuActivityEventWithCtx(ctx, {
        ...args,
        stockQuantityDelta: -2,
      }),
    ).rejects.toThrow(/idempotency key conflicts/i);
    expect(tables.skuActivityEvent).toHaveLength(1);
  });

  it("records product-page trusted conversion evidence for support review", async () => {
    const { ctx, tables } = createIndexedDb({
      productSku: new Map([
        [
          "sku-1",
          {
            _id: "sku-1",
            inventoryCount: 10,
            productId: "product-1",
            quantityAvailable: 8,
            sku: "CW-18",
            storeId: "store-1",
          },
        ],
      ]),
    });

    const event = await recordSkuActivityEventWithCtx(ctx, {
      activityType: "legacy_import_trusted_inventory_finalized",
      idempotencyKey: "product-page-conversion:request-1",
      metadata: {
        conversionRequestId: "request-1",
        finalTrustedQuantity: 10,
        importKey: "legacy-review-1",
        lastPosTransactionId: "pos-transaction-1",
        lastRegisterSessionId: "register-session-1",
        provisionalSoldQuantity: 2,
        reviewVersionId: "review-version-1",
        reviewVersionNumber: 1,
        saleCount: 1,
        saleEvidenceFingerprint: "sale-evidence:v1",
        sourceSurface: "product_edit",
        trustedSkuFingerprint: "trusted-sku:v1",
      },
      occurredAt: 1_000,
      productId: "product-1" as Id<"product">,
      productSkuId: "sku-1" as Id<"productSku">,
      quantityDelta: 0,
      sourceId: "provisional-1",
      sourceType: "inventoryImportProvisionalSku",
      status: "committed",
      stockQuantityDelta: 0,
      storeId: "store-1" as Id<"store">,
    });

    expect(event).toMatchObject({
      activityType: "legacy_import_trusted_inventory_finalized",
      idempotencyKey: "product-page-conversion:request-1",
      productSkuId: "sku-1",
      sourceId: "provisional-1",
      sourceType: "inventoryImportProvisionalSku",
      status: "committed",
      metadata: expect.objectContaining({
        conversionRequestId: "request-1",
        finalTrustedQuantity: 10,
        importKey: "legacy-review-1",
        provisionalSoldQuantity: 2,
        saleEvidenceFingerprint: "sale-evidence:v1",
        sourceSurface: "product_edit",
        trustedSkuFingerprint: "trusted-sku:v1",
      }),
    });
    expect(tables.skuActivityEvent).toHaveLength(1);
  });

  it("rejects events for SKUs outside the source store", async () => {
    const { ctx } = createIndexedDb({
      productSku: new Map([
        [
          "sku-1",
          {
            _id: "sku-1",
            inventoryCount: 5,
            productId: "product-1",
            quantityAvailable: 5,
            sku: "CW-18",
            storeId: "store-2",
          },
        ],
      ]),
    });

    await expect(
      recordSkuActivityEventWithCtx(ctx, {
        activityType: "reservation_acquired",
        idempotencyKey: "hold-1:acquired",
        occurredAt: 1_000,
        productSkuId: "sku-1" as Id<"productSku">,
        reservationQuantity: 1,
        sourceId: "pos-session-1",
        sourceType: "posSession",
        status: "active",
        storeId: "store-1" as Id<"store">,
      })
    ).rejects.toThrow("Selected SKU could not be found for this store.");
  });
});

describe("SKU activity read model", () => {
  it("returns active POS reservations and keeps terminal events historical", async () => {
    const { ctx } = createIndexedDb({
      inventoryHold: new Map([
        [
          "hold-active",
          {
            _id: "hold-active",
            productSkuId: "sku-1",
            quantity: 1,
            sourceSessionId: "pos-session-1",
            status: "active",
            storeId: "store-1",
          },
        ],
      ]),
      productSku: new Map([
        [
          "sku-1",
          {
            _id: "sku-1",
            inventoryCount: 10,
            productId: "product-1",
            quantityAvailable: 10,
            sku: "CW-18",
            storeId: "store-1",
          },
        ],
      ]),
      skuActivityEvent: new Map([
        [
          "event-1",
          {
            _id: "event-1",
            activityType: "reservation_acquired",
            createdAt: 900,
            idempotencyKey: "hold-active:acquired",
            inventoryHoldId: "hold-active",
            occurredAt: 1_000,
            productSkuId: "sku-1",
            reservationQuantity: 1,
            sourceId: "pos-session-1",
            sourceType: "posSession",
            status: "active",
            storeId: "store-1",
          },
        ],
        [
          "event-2",
          {
            _id: "event-2",
            activityType: "reservation_expired",
            createdAt: 1_100,
            idempotencyKey: "hold-expired:expired",
            occurredAt: 1_100,
            productSkuId: "sku-1",
            reservationQuantity: 3,
            sourceId: "pos-session-2",
            sourceType: "posSession",
            status: "expired",
            storeId: "store-1",
          },
        ],
      ]),
    });

    const result = await getSkuActivityForProductSkuWithCtx(ctx, {
      productSkuId: "sku-1" as Id<"productSku">,
      storeId: "store-1" as Id<"store">,
    });

    expect(result?.activeReservations).toMatchObject({
      checkoutQuantity: 0,
      posQuantity: 1,
      totalQuantity: 1,
    });
    expect(result?.activeReservations.entries).toEqual([
      expect.objectContaining({
        inventoryHoldId: "hold-active",
        quantity: 1,
        sourceLabel: "POS session pos-session-1",
        sourceType: "posSession",
        status: "active",
      }),
    ]);
    expect(result?.timeline.map((row) => row.status)).toEqual([
      "expired",
      "active",
    ]);
  });

  it("resolves by SKU string and explains checkout reservations without subtracting availability twice", async () => {
    const { ctx } = createIndexedDb({
      checkoutSession: new Map([
        [
          "checkout-session-1",
          {
            _id: "checkout-session-1",
            expiresAt: 2_000,
            hasCompletedCheckoutSession: false,
            storeId: "store-1",
          },
        ],
      ]),
      checkoutSessionItem: new Map([
        [
          "checkout-item-1",
          {
            _id: "checkout-item-1",
            productSkuId: "sku-1",
            quantity: 2,
            sesionId: "checkout-session-1",
          },
        ],
      ]),
      productSku: new Map([
        [
          "sku-1",
          {
            _id: "sku-1",
            inventoryCount: 10,
            productId: "product-1",
            quantityAvailable: 8,
            sku: "CW-18",
            storeId: "store-1",
          },
        ],
      ]),
      skuActivityEvent: new Map([
        [
          "event-1",
          {
            _id: "event-1",
            activityType: "reservation_acquired",
            checkoutSessionId: "checkout-session-1",
            createdAt: 900,
            idempotencyKey: "checkout-session-1:sku-1:reserved",
            occurredAt: 1_000,
            productSkuId: "sku-1",
            reservationQuantity: 2,
            sourceId: "checkout-session-1",
            sourceType: "checkoutSession",
            status: "active",
            storeId: "store-1",
          },
        ],
      ]),
    });

    const result = await getSkuActivityForProductSkuWithCtx(ctx, {
      now: 1_500,
      sku: "CW-18",
      storeId: "store-1" as Id<"store">,
    });

    expect(result?.stock).toMatchObject({
      inventoryCount: 10,
      quantityAvailable: 8,
      durableQuantityAvailable: 8,
    });
    expect(result?.activeReservations).toMatchObject({
      checkoutQuantity: 2,
      posQuantity: 0,
      totalQuantity: 2,
    });
    expect(result?.warnings).toEqual([]);
  });

  it("warns when durable availability has an unexplained gap", async () => {
    const { ctx } = createIndexedDb({
      productSku: new Map([
        [
          "sku-1",
          {
            _id: "sku-1",
            inventoryCount: 10,
            productId: "product-1",
            quantityAvailable: 7,
            sku: "CW-18",
            storeId: "store-1",
          },
        ],
      ]),
    });

    const result = await getSkuActivityForProductSkuWithCtx(ctx, {
      sku: "CW-18",
      storeId: "store-1" as Id<"store">,
    });

    expect(result?.warnings).toEqual([
      expect.objectContaining({
        code: "unexplained_availability_gap",
        quantity: 3,
      }),
    ]);
  });

  it("returns null when the requested SKU belongs to another store", async () => {
    const { ctx } = createIndexedDb({
      productSku: new Map([
        [
          "sku-1",
          {
            _id: "sku-1",
            inventoryCount: 10,
            productId: "product-1",
            quantityAvailable: 10,
            sku: "CW-18",
            storeId: "store-2",
          },
        ],
      ]),
    });

    await expect(
      getSkuActivityForProductSkuWithCtx(ctx, {
        productSkuId: "sku-1" as Id<"productSku">,
        storeId: "store-1" as Id<"store">,
      })
    ).resolves.toBeNull();
  });
});

describe("untrusted SKU sale evidence read model", () => {
  it("lists open untrusted sources and returns selected-source transaction history", async () => {
    const { ctx } = createIndexedDb({
      inventoryImportProvisionalSku: new Map([
        [
          "provisional-1",
          {
            _id: "provisional-1",
            createdAt: 900,
            createdByUserId: "user-1",
            importKey: "legacy-import-1",
            importedBarcode: "BAR-18",
            importedPrice: 120,
            importedProductName: "Legacy closure wig",
            importedQuantity: 5,
            importedSku: "LEG-18",
            normalizedImportedBarcode: "bar-18",
            normalizedImportedProductName: "legacy closure wig",
            normalizedImportedSku: "leg-18",
            organizationId: "org-1",
            posExposureStatus: "available",
            productId: "product-1",
            productSkuId: "sku-1",
            reviewVersionId: "review-version-1",
            reviewVersionNumber: 1,
            rowKey: "row-1",
            rowNumber: 12,
            saleEvidence: {
              lastPosTransactionId: "transaction-1",
              lastRegisterSessionId: "register-session-1",
              lastSoldAt: 2_000,
              saleCount: 1,
              totalQuantitySold: 2,
            },
            sourceFormat: "csv",
            status: "active",
            storeId: "store-1",
            updatedAt: 2_100,
          },
        ],
        [
          "provisional-unsold",
          {
            _id: "provisional-unsold",
            importKey: "legacy-import-1",
            importedPrice: 100,
            importedProductName: "Unsold row",
            importedQuantity: 3,
            normalizedImportedProductName: "unsold row",
            organizationId: "org-1",
            posExposureStatus: "available",
            reviewVersionId: "review-version-1",
            reviewVersionNumber: 1,
            rowKey: "row-2",
            rowNumber: 13,
            saleEvidence: { saleCount: 0, totalQuantitySold: 0 },
            sourceFormat: "csv",
            status: "active",
            storeId: "store-1",
            updatedAt: 2_200,
          },
        ],
        [
          "provisional-other-store",
          {
            _id: "provisional-other-store",
            importKey: "legacy-import-1",
            importedPrice: 100,
            importedProductName: "Wrong store row",
            importedQuantity: 3,
            normalizedImportedProductName: "wrong store row",
            organizationId: "org-2",
            posExposureStatus: "available",
            reviewVersionId: "review-version-2",
            reviewVersionNumber: 1,
            rowKey: "row-3",
            rowNumber: 14,
            saleEvidence: {
              lastSoldAt: 3_000,
              saleCount: 1,
              totalQuantitySold: 1,
            },
            sourceFormat: "csv",
            status: "active",
            storeId: "store-2",
            updatedAt: 3_100,
          },
        ],
      ]),
      posPendingCheckoutItem: new Map([
        [
          "pending-1",
          {
            _id: "pending-1",
            createdAt: 800,
            createdFrom: "offline_sync",
            currency: "GHS",
            evidence: {
              firstSeenAt: 1_000,
              lastPosTransactionId: "transaction-3",
              lastRegisterSessionId: "register-session-3",
              lastSeenAt: 2_500,
              observedLookupCodes: ["PEND-22"],
              observedPrices: [45],
              offlineSaleCount: 1,
              totalQuantitySold: 1,
              transactionCount: 1,
            },
            lookupCode: "PEND-22",
            name: "Pending checkout wig",
            normalizedLookupCode: "pend-22",
            normalizedName: "pending checkout wig",
            organizationId: "org-1",
            provisionalPrice: 45,
            reviewPriority: "elevated",
            status: "pending_review",
            storeId: "store-1",
            updatedAt: 2_550,
          },
        ],
      ]),
      posTransaction: new Map([
        [
          "transaction-1",
          {
            _id: "transaction-1",
            completedAt: 2_000,
            payments: [],
            status: "completed",
            storeId: "store-1",
            subtotal: 240,
            tax: 0,
            total: 240,
            totalPaid: 240,
            transactionNumber: "POS-1001",
          },
        ],
        [
          "transaction-other-store",
          {
            _id: "transaction-other-store",
            completedAt: 2_100,
            payments: [],
            status: "completed",
            storeId: "store-2",
            subtotal: 120,
            tax: 0,
            total: 120,
            totalPaid: 120,
            transactionNumber: "POS-2001",
          },
        ],
      ]),
      posTransactionAdjustment: new Map([
        [
          "adjustment-1",
          {
            _id: "adjustment-1",
            appliedAt: 2_200,
            correctedSubtotal: 120,
            correctedTax: 0,
            correctedTotal: 120,
            createdAt: 2_150,
            deltaTotal: -120,
            originalSubtotal: 240,
            originalTax: 0,
            originalTotal: 240,
            payloadFingerprint: "adjustment:fingerprint",
            payloadSubject: "transaction-1",
            settlementAmount: 120,
            settlementDirection: "refund",
            status: "applied",
            storeId: "store-1",
            transactionId: "transaction-1",
            updatedAt: 2_200,
          },
        ],
      ]),
      posTransactionAdjustmentLine: new Map([
        [
          "adjustment-line-1",
          {
            _id: "adjustment-line-1",
            adjustmentId: "adjustment-1",
            correctedQuantity: 1,
            correctedTotal: 120,
            createdAt: 2_150,
            inventoryDelta: -1,
            lineType: "existing",
            originalQuantity: 2,
            originalTotal: 240,
            originalTransactionItemId: "transaction-item-1",
            productId: "product-1",
            productName: "Legacy closure wig",
            productSku: "LEG-18",
            productSkuId: "sku-1",
            quantityDelta: -1,
            storeId: "store-1",
            transactionId: "transaction-1",
            unitPrice: 120,
          },
        ],
      ]),
      posTransactionItem: new Map([
        [
          "transaction-item-1",
          {
            _id: "transaction-item-1",
            inventoryImportProvisionalSkuId: "provisional-1",
            productId: "product-1",
            productName: "Legacy closure wig",
            productSku: "LEG-18",
            productSkuId: "sku-1",
            quantity: 2,
            totalPrice: 240,
            transactionId: "transaction-1",
            unitPrice: 120,
          },
        ],
        [
          "transaction-item-other-store",
          {
            _id: "transaction-item-other-store",
            inventoryImportProvisionalSkuId: "provisional-1",
            productId: "product-1",
            productName: "Legacy closure wig",
            productSku: "LEG-18",
            productSkuId: "sku-1",
            quantity: 1,
            totalPrice: 120,
            transactionId: "transaction-other-store",
            unitPrice: 120,
          },
        ],
      ]),
    });

    const result = await getUntrustedSkuSaleEvidenceWithCtx(ctx, {
      selectedSource: {
        sourceId: "provisional-1",
        sourceType: "inventoryImportProvisionalSku",
      },
      storeId: "store-1" as Id<"store">,
    });

    expect(result.sources.map((source) => source.id)).toEqual([
      "pending-1",
      "provisional-1",
    ]);
    expect(result.sources[0]).toMatchObject({
      evidence: {
        offlineSaleCount: 1,
        totalQuantitySold: 1,
      },
      reviewState: "open",
      sourceType: "posPendingCheckoutItem",
      status: "pending_review",
    });
    expect(result.selected?.source).toMatchObject({
      id: "provisional-1",
      evidence: {
        saleCount: 1,
        totalQuantitySold: 2,
      },
      reviewState: "open",
      sourceType: "inventoryImportProvisionalSku",
    });
    expect(result.selected?.transactionHistory).toMatchObject({
      isTruncated: false,
      rows: [
        {
          id: "transaction-item-1",
          transactionId: "transaction-1",
          transactionNumber: "POS-1001",
          quantity: 2,
          refundedQuantity: 0,
          netQuantity: 1,
          adjustments: expect.objectContaining({
            appliedQuantityDelta: -1,
            count: 1,
            latestStatus: "applied",
          }),
        },
      ],
    });
  });

  it("filters linked archived legacy import products out of untrusted sale evidence", async () => {
    const { ctx } = createIndexedDb({
      inventoryImportProvisionalSku: new Map([
        [
          "provisional-archived",
          {
            _id: "provisional-archived",
            importKey: "legacy-import-1",
            importedPrice: 120,
            importedProductName: "Archived zirconia earring",
            importedQuantity: 5,
            normalizedImportedProductName: "archived zirconia earring",
            organizationId: "org-1",
            posExposureStatus: "hidden",
            productId: "product-archived",
            productSkuId: "sku-archived",
            reviewVersionId: "review-version-1",
            reviewVersionNumber: 1,
            rowKey: "row-archived",
            rowNumber: 12,
            saleEvidence: {
              lastSoldAt: 3_000,
              saleCount: 1,
              totalQuantitySold: 4,
            },
            sourceFormat: "csv",
            status: "active",
            storeId: "store-1",
            updatedAt: 3_100,
          },
        ],
        [
          "provisional-live",
          {
            _id: "provisional-live",
            importKey: "legacy-import-1",
            importedPrice: 90,
            importedProductName: "Live wig bag",
            importedQuantity: 3,
            normalizedImportedProductName: "live wig bag",
            organizationId: "org-1",
            posExposureStatus: "available",
            productId: "product-live",
            productSkuId: "sku-live",
            reviewVersionId: "review-version-1",
            reviewVersionNumber: 1,
            rowKey: "row-live",
            rowNumber: 13,
            saleEvidence: {
              lastSoldAt: 2_000,
              saleCount: 1,
              totalQuantitySold: 1,
            },
            sourceFormat: "csv",
            status: "active",
            storeId: "store-1",
            updatedAt: 2_100,
          },
        ],
        [
          "provisional-unlinked",
          {
            _id: "provisional-unlinked",
            importKey: "legacy-import-1",
            importedPrice: 75,
            importedProductName: "Unlinked import row",
            importedQuantity: 2,
            normalizedImportedProductName: "unlinked import row",
            organizationId: "org-1",
            posExposureStatus: "available",
            reviewVersionId: "review-version-1",
            reviewVersionNumber: 1,
            rowKey: "row-unlinked",
            rowNumber: 14,
            saleEvidence: {
              lastSoldAt: 1_000,
              saleCount: 1,
              totalQuantitySold: 1,
            },
            sourceFormat: "csv",
            status: "active",
            storeId: "store-1",
            updatedAt: 1_100,
          },
        ],
      ]),
      product: new Map([
        [
          "product-archived",
          {
            _id: "product-archived",
            availability: "archived",
            storeId: "store-1",
          },
        ],
        [
          "product-live",
          {
            _id: "product-live",
            availability: "live",
            storeId: "store-1",
          },
        ],
      ]),
    });

    const result = await getUntrustedSkuSaleEvidenceWithCtx(ctx, {
      selectedSource: {
        sourceId: "provisional-archived",
        sourceType: "inventoryImportProvisionalSku",
      },
      sourceFilter: "legacy_import",
      storeId: "store-1" as Id<"store">,
    });

    expect(result.sources.map((source) => source.id)).toEqual([
      "provisional-live",
      "provisional-unlinked",
    ]);
    expect(result.selected).toBeNull();
  });

  it("treats active finalized legacy import rows as reviewed sale evidence", async () => {
    const { ctx } = createIndexedDb({
      inventoryImportProvisionalSku: new Map([
        [
          "provisional-finalized",
          {
            _id: "provisional-finalized",
            finalizedAt: 3_000,
            importKey: "legacy-import-1",
            importedPrice: 120,
            importedProductName: "Finalized legacy wig",
            importedQuantity: 5,
            normalizedImportedProductName: "finalized legacy wig",
            organizationId: "org-1",
            posExposureStatus: "hidden",
            productId: "product-live",
            productSkuId: "sku-live",
            reviewVersionId: "review-version-1",
            reviewVersionNumber: 1,
            rowKey: "row-finalized",
            rowNumber: 12,
            saleEvidence: {
              lastSoldAt: 2_000,
              saleCount: 1,
              totalQuantitySold: 4,
            },
            sourceFormat: "csv",
            status: "active",
            storeId: "store-1",
            updatedAt: 3_100,
          },
        ],
      ]),
      product: new Map([
        [
          "product-live",
          {
            _id: "product-live",
            availability: "live",
            storeId: "store-1",
          },
        ],
      ]),
    });

    const openResult = await getUntrustedSkuSaleEvidenceWithCtx(ctx, {
      reviewStatus: "open",
      sourceFilter: "legacy_import",
      storeId: "store-1" as Id<"store">,
    });
    expect(openResult.sources).toEqual([]);

    const reviewedResult = await getUntrustedSkuSaleEvidenceWithCtx(ctx, {
      reviewStatus: "reviewed",
      selectedSource: {
        sourceId: "provisional-finalized",
        sourceType: "inventoryImportProvisionalSku",
      },
      sourceFilter: "legacy_import",
      storeId: "store-1" as Id<"store">,
    });
    expect(reviewedResult.sources).toEqual([
      expect.objectContaining({
        id: "provisional-finalized",
        reviewState: "reviewed",
      }),
    ]);
    expect(reviewedResult.selected).toMatchObject({
      source: {
        id: "provisional-finalized",
        reviewState: "reviewed",
      },
    });
  });

  it("applies the source filter before limiting source rows", async () => {
    const { ctx } = createIndexedDb({
      inventoryImportProvisionalSku: new Map([
        [
          "provisional-1",
          {
            _id: "provisional-1",
            importKey: "legacy-import-1",
            importedPrice: 120,
            importedProductName: "Legacy closure wig",
            importedQuantity: 5,
            normalizedImportedProductName: "legacy closure wig",
            organizationId: "org-1",
            posExposureStatus: "available",
            reviewVersionId: "review-version-1",
            reviewVersionNumber: 1,
            rowKey: "row-1",
            rowNumber: 12,
            saleEvidence: {
              lastSoldAt: 2_000,
              saleCount: 1,
              totalQuantitySold: 2,
            },
            sourceFormat: "csv",
            status: "active",
            storeId: "store-1",
            updatedAt: 2_100,
          },
        ],
      ]),
      posPendingCheckoutItem: new Map([
        [
          "pending-1",
          {
            _id: "pending-1",
            createdAt: 800,
            createdFrom: "offline_sync",
            currency: "GHS",
            evidence: {
              firstSeenAt: 1_000,
              lastSeenAt: 2_500,
              observedLookupCodes: ["PEND-22"],
              observedPrices: [45],
              totalQuantitySold: 1,
              transactionCount: 1,
            },
            lookupCode: "PEND-22",
            name: "Pending checkout wig",
            normalizedLookupCode: "pend-22",
            normalizedName: "pending checkout wig",
            organizationId: "org-1",
            provisionalPrice: 45,
            reviewPriority: "elevated",
            status: "pending_review",
            storeId: "store-1",
            updatedAt: 2_550,
          },
        ],
      ]),
    });

    const result = await getUntrustedSkuSaleEvidenceWithCtx(ctx, {
      limit: 1,
      sourceFilter: "pending_checkout",
      storeId: "store-1" as Id<"store">,
    });

    expect(result.sourceFilter).toBe("pending_checkout");
    expect(result.sources.map((source) => source.id)).toEqual(["pending-1"]);
    expect(result.totalSourceCount).toBe(1);
    expect(result.hasMoreSources).toBe(false);
  });

  it("sorts selected-source transactions before applying the history limit", async () => {
    const { ctx } = createIndexedDb({
      inventoryImportProvisionalSku: new Map([
        [
          "provisional-1",
          {
            _id: "provisional-1",
            importKey: "legacy-import-1",
            importedPrice: 120,
            importedProductName: "Legacy closure wig",
            importedQuantity: 5,
            normalizedImportedProductName: "legacy closure wig",
            organizationId: "org-1",
            posExposureStatus: "available",
            reviewVersionId: "review-version-1",
            reviewVersionNumber: 1,
            rowKey: "row-1",
            rowNumber: 12,
            saleEvidence: {
              lastPosTransactionId: "transaction-new",
              lastSoldAt: 3_000,
              saleCount: 2,
              totalQuantitySold: 2,
            },
            sourceFormat: "csv",
            status: "active",
            storeId: "store-1",
            updatedAt: 3_100,
          },
        ],
      ]),
      posTransaction: new Map([
        [
          "transaction-old",
          {
            _id: "transaction-old",
            completedAt: 1_000,
            payments: [],
            status: "completed",
            storeId: "store-1",
            subtotal: 120,
            tax: 0,
            total: 120,
            totalPaid: 120,
            transactionNumber: "POS-OLD",
          },
        ],
        [
          "transaction-new",
          {
            _id: "transaction-new",
            completedAt: 3_000,
            payments: [],
            status: "completed",
            storeId: "store-1",
            subtotal: 120,
            tax: 0,
            total: 120,
            totalPaid: 120,
            transactionNumber: "POS-NEW",
          },
        ],
      ]),
      posTransactionItem: new Map([
        [
          "transaction-item-old",
          {
            _id: "transaction-item-old",
            inventoryImportProvisionalSkuId: "provisional-1",
            productId: "product-1",
            productName: "Legacy closure wig",
            productSku: "LEG-18",
            productSkuId: "sku-1",
            quantity: 1,
            totalPrice: 120,
            transactionId: "transaction-old",
            unitPrice: 120,
          },
        ],
        [
          "transaction-item-new",
          {
            _id: "transaction-item-new",
            inventoryImportProvisionalSkuId: "provisional-1",
            productId: "product-1",
            productName: "Legacy closure wig",
            productSku: "LEG-18",
            productSkuId: "sku-1",
            quantity: 1,
            totalPrice: 120,
            transactionId: "transaction-new",
            unitPrice: 120,
          },
        ],
      ]),
    });

    const result = await getUntrustedSkuSaleEvidenceWithCtx(ctx, {
      selectedSource: {
        sourceId: "provisional-1",
        sourceType: "inventoryImportProvisionalSku",
      },
      storeId: "store-1" as Id<"store">,
      transactionLimit: 1,
    });

    expect(result.selected?.transactionHistory).toMatchObject({
      isTruncated: true,
      rows: [
        {
          id: "transaction-item-new",
          completedAt: 3_000,
          transactionNumber: "POS-NEW",
        },
      ],
    });
  });

  it("supports a reviewed-history filter without mixing open sources", async () => {
    const { ctx } = createIndexedDb({
      inventoryImportProvisionalSku: new Map([
        [
          "provisional-open",
          {
            _id: "provisional-open",
            importKey: "legacy-import-1",
            importedPrice: 100,
            importedProductName: "Open row",
            importedQuantity: 3,
            normalizedImportedProductName: "open row",
            organizationId: "org-1",
            posExposureStatus: "available",
            reviewVersionId: "review-version-1",
            reviewVersionNumber: 1,
            rowKey: "row-1",
            rowNumber: 1,
            saleEvidence: {
              lastSoldAt: 1_000,
              saleCount: 1,
              totalQuantitySold: 1,
            },
            sourceFormat: "csv",
            status: "active",
            storeId: "store-1",
            updatedAt: 1_100,
          },
        ],
        [
          "provisional-finalized",
          {
            _id: "provisional-finalized",
            importKey: "legacy-import-1",
            importedPrice: 100,
            importedProductName: "Finalized row",
            importedQuantity: 3,
            normalizedImportedProductName: "finalized row",
            organizationId: "org-1",
            posExposureStatus: "available",
            reviewVersionId: "review-version-1",
            reviewVersionNumber: 1,
            rowKey: "row-2",
            rowNumber: 2,
            saleEvidence: {
              lastSoldAt: 2_000,
              saleCount: 1,
              totalQuantitySold: 1,
            },
            sourceFormat: "csv",
            status: "finalized",
            storeId: "store-1",
            updatedAt: 2_100,
          },
        ],
      ]),
      posPendingCheckoutItem: new Map([
        [
          "pending-approved",
          {
            _id: "pending-approved",
            createdAt: 1_000,
            createdFrom: "online",
            currency: "GHS",
            evidence: {
              firstSeenAt: 1_000,
              lastSeenAt: 3_000,
              observedLookupCodes: ["APP-1"],
              observedPrices: [75],
              totalQuantitySold: 2,
              transactionCount: 1,
            },
            lookupCode: "APP-1",
            name: "Approved pending row",
            normalizedLookupCode: "app-1",
            normalizedName: "approved pending row",
            organizationId: "org-1",
            provisionalPrice: 75,
            reviewPriority: "normal",
            status: "approved",
            storeId: "store-1",
            updatedAt: 3_100,
          },
        ],
      ]),
    });

    const result = await getUntrustedSkuSaleEvidenceWithCtx(ctx, {
      reviewStatus: "reviewed",
      selectedSource: {
        sourceId: "provisional-open",
        sourceType: "inventoryImportProvisionalSku",
      },
      storeId: "store-1" as Id<"store">,
    });

    expect(result.sources.map((source) => source.id)).toEqual([
      "pending-approved",
      "provisional-finalized",
    ]);
    expect(result.sources.every((source) => source.reviewState === "reviewed")).toBe(
      true
    );
    expect(result.selected).toBeNull();
  });
});
