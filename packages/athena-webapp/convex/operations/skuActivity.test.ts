import { describe, expect, it } from "vitest";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import {
  buildSkuActivityEvent,
  getSkuActivityForProductSkuWithCtx,
  recordSkuActivityEventWithCtx,
} from "./skuActivity";

type TableName =
  | "checkoutSession"
  | "checkoutSessionItem"
  | "inventoryHold"
  | "productSku"
  | "skuActivityEvent";

type Tables = Record<TableName, Map<string, Record<string, unknown>>>;

function createIndexedDb(seed: Partial<Tables>) {
  const tables: Tables = {
    checkoutSession: new Map(),
    checkoutSessionItem: new Map(),
    inventoryHold: new Map(),
    productSku: new Map(),
    skuActivityEvent: new Map(),
    ...seed,
  };
  const insertCounters = {
    skuActivityEvent: tables.skuActivityEvent.size,
  };

  function filteredRecords(table: TableName, filters: Record<string, unknown>) {
    return Array.from(tables[table].values()).filter((record) =>
      Object.entries(filters).every(([field, value]) => record[field] === value)
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
    query: (tableName: TableName) => ({
      withIndex(
        _indexName: string,
        apply: (builder: { eq: (field: string, value: unknown) => unknown }) => void
      ) {
        const filters: Record<string, unknown> = {};
        const builder = {
          eq(field: string, value: unknown) {
            filters[field] = value;
            return builder;
          },
        };
        apply(builder);
        const page = filteredRecords(tableName, filters);

        return {
          collect: async () => page,
          first: async () => page[0] ?? null,
          take: async (limit: number) => page.slice(0, limit),
        };
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
