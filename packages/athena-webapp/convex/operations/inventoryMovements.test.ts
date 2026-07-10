import { describe, expect, it } from "vitest";
import type { Id } from "../_generated/dataModel";
import {
  buildInventoryMovement,
  buildSkuActivityForInventoryMovement,
  recordInventoryMovementWithCtx,
  recordInventoryMovementWithDispositionWithCtx,
  summarizeInventoryMovements,
} from "./inventoryMovements";

type TestTable = "inventoryMovement" | "productSku" | "skuActivityEvent";

function createInventoryMovementCtx(seed: {
  inventoryMovement?: Map<string, Record<string, any>>;
  productSku?: Map<string, Record<string, any>>;
  skuActivityEvent?: Map<string, Record<string, any>>;
}) {
  const tables: Record<TestTable, Map<string, Record<string, any>>> = {
    inventoryMovement: seed.inventoryMovement ?? new Map(),
    productSku: seed.productSku ?? new Map(),
    skuActivityEvent: seed.skuActivityEvent ?? new Map(),
  };
  const insertCounters = {
    inventoryMovement: tables.inventoryMovement.size,
    skuActivityEvent: tables.skuActivityEvent.size,
  };

  function filteredRecords(table: TestTable, filters: Record<string, unknown>) {
    return Array.from(tables[table].values()).filter((record) =>
      Object.entries(filters).every(
        ([field, value]) => record[field] === value,
      ),
    );
  }

  const ctx = {
    db: {
      get: async (table: TestTable, id: string) =>
        tables[table].get(id) ?? null,
      insert: async (table: TestTable, input: Record<string, unknown>) => {
        if (table !== "inventoryMovement" && table !== "skuActivityEvent") {
          throw new Error(`Unexpected insert into ${table}`);
        }

        insertCounters[table] += 1;
        const id =
          table === "inventoryMovement"
            ? `movement-${insertCounters[table]}`
            : `sku-activity-${insertCounters[table]}`;
        tables[table].set(id, { _id: id, ...input });
        return id;
      },
      query: (table: TestTable) => ({
        withIndex(
          _indexName: string,
          apply: (builder: {
            eq: (field: string, value: unknown) => unknown;
          }) => void,
        ) {
          const filters: Record<string, unknown> = {};
          const builder = {
            eq(field: string, value: unknown) {
              filters[field] = value;
              return builder;
            },
          };
          apply(builder);
          const page = filteredRecords(table, filters);

          return {
            collect: async () => page,
            first: async () => page[0] ?? null,
          };
        },
      }),
    },
  };

  return { ctx: ctx as any, tables };
}

describe("inventory movement helpers", () => {
  it("builds auditable inventory movements with timestamps", () => {
    const movement = buildInventoryMovement({
      storeId: "store_1" as Id<"store">,
      movementType: "sale",
      sourceType: "pos_transaction",
      sourceId: "pos_txn_1",
      quantityDelta: -2,
      productSkuId: "sku_1" as Id<"productSku">,
    });

    expect(movement).toMatchObject({
      storeId: "store_1",
      movementType: "sale",
      sourceType: "pos_transaction",
      quantityDelta: -2,
      productSkuId: "sku_1",
    });
    expect(movement.createdAt).toEqual(expect.any(Number));
  });

  it("preserves enriched inventory evidence on movement and SKU activity rows", () => {
    const movement = buildInventoryMovement({
      afterOnHandQuantity: 3,
      afterSellableQuantity: 2,
      beforeOnHandQuantity: 5,
      beforeSellableQuantity: 4,
      businessEventKey: "pos:sale-1:line-1",
      contentFingerprint: "fingerprint-1",
      disposition: "merchandise_sale",
      movementType: "sale",
      occurrenceAt: 1_000,
      productSkuId: "sku-1" as Id<"productSku">,
      quantityDelta: -2,
      recordedAt: 1_100,
      reportingInventoryEffectId:
        "reporting-effect-1" as Id<"reportingInventoryEffect">,
      sellableQuantityDelta: -2,
      sourceId: "sale-1",
      sourceLineId: "line-1",
      sourceType: "posTransaction",
      storeId: "store-1" as Id<"store">,
    });
    const activity = buildSkuActivityForInventoryMovement({
      ...movement,
      inventoryMovementId: "movement-1" as Id<"inventoryMovement">,
    });

    expect(movement).toMatchObject({
      businessEventKey: "pos:sale-1:line-1",
      contentFingerprint: "fingerprint-1",
      createdAt: 1_100,
      occurrenceAt: 1_000,
      recordedAt: 1_100,
      reportingInventoryEffectId: "reporting-effect-1",
      sourceLineId: "line-1",
    });
    expect(activity).toMatchObject({
      occurredAt: 1_000,
      sourceLineId: "line-1",
      metadata: expect.objectContaining({
        afterOnHandQuantity: 3,
        beforeOnHandQuantity: 5,
        businessEventKey: "pos:sale-1:line-1",
        contentFingerprint: "fingerprint-1",
        reportingInventoryEffectId: "reporting-effect-1",
        sellableQuantityDelta: -2,
      }),
    });
  });

  it("summarizes net stock deltas across movements", () => {
    expect(
      summarizeInventoryMovements([
        { quantityDelta: 4 },
        { quantityDelta: -1 },
        { quantityDelta: -2 },
      ]),
    ).toEqual({
      movementCount: 3,
      netDelta: 1,
    });
  });

  it("builds committed SKU activity linked to the movement row", () => {
    const activity = buildSkuActivityForInventoryMovement({
      inventoryMovementId: "movement-1" as Id<"inventoryMovement">,
      movementType: "receipt",
      productSkuId: "sku-1" as Id<"productSku">,
      quantityDelta: 4,
      sourceId: "receiving-1",
      sourceType: "purchase_order_receiving_batch",
      storeId: "store-1" as Id<"store">,
    });

    expect(activity).toMatchObject({
      activityType: "stock_receipt",
      idempotencyKey: "inventoryMovement:movement-1",
      inventoryMovementId: "movement-1",
      productSkuId: "sku-1",
      sourceId: "receiving-1",
      sourceType: "purchase_order_receiving_batch",
      status: "committed",
      stockQuantityDelta: 4,
      storeId: "store-1",
    });
  });

  it("records movement activity idempotently when a source operation replays", async () => {
    const { ctx, tables } = createInventoryMovementCtx({
      productSku: new Map([
        [
          "sku-1",
          {
            _id: "sku-1",
            inventoryCount: 5,
            productId: "product-1",
            quantityAvailable: 5,
            storeId: "store-1",
          },
        ],
      ]),
    });

    const args = {
      movementType: "receipt",
      productSkuId: "sku-1" as Id<"productSku">,
      quantityDelta: 4,
      sourceId: "receiving-1",
      sourceType: "purchase_order_receiving_batch",
      storeId: "store-1" as Id<"store">,
    };

    const first = await recordInventoryMovementWithCtx(ctx, args);
    const second = await recordInventoryMovementWithCtx(ctx, args);

    expect(second?._id).toBe(first?._id);
    expect(tables.inventoryMovement).toHaveLength(1);
    expect(tables.skuActivityEvent).toHaveLength(1);
    expect(Array.from(tables.skuActivityEvent.values())[0]).toMatchObject({
      activityType: "stock_receipt",
      inventoryMovementId: first?._id,
      stockQuantityDelta: 4,
    });
  });

  it("reports whether source-scoped movement recording inserted or reused a row", async () => {
    const { ctx, tables } = createInventoryMovementCtx({
      productSku: new Map([
        [
          "sku-1",
          {
            _id: "sku-1",
            inventoryCount: 5,
            productId: "product-1",
            quantityAvailable: 5,
            storeId: "store-1",
          },
        ],
      ]),
    });
    const args = {
      movementType: "pos_transaction_void",
      productId: "product-1" as Id<"product">,
      productSkuId: "sku-1" as Id<"productSku">,
      quantityDelta: 1,
      reasonCode: "pos_transaction_void",
      sourceId: "txn-1",
      sourceType: "posTransaction",
      storeId: "store-1" as Id<"store">,
    };

    const first = await recordInventoryMovementWithDispositionWithCtx(ctx, args);
    const second = await recordInventoryMovementWithDispositionWithCtx(ctx, args);

    expect(first).toMatchObject({
      disposition: "inserted",
      movement: { _id: expect.any(String) },
    });
    expect(second).toMatchObject({
      disposition: "existing",
      movement: { _id: first.movement?._id },
    });
    expect(tables.inventoryMovement).toHaveLength(1);
  });

  it("rejects a reused business event key with conflicting content", async () => {
    const { ctx, tables } = createInventoryMovementCtx({
      productSku: new Map([
        [
          "sku-1",
          {
            _id: "sku-1",
            inventoryCount: 5,
            productId: "product-1",
            quantityAvailable: 5,
            storeId: "store-1",
          },
        ],
      ]),
    });
    const args = {
      businessEventKey: "pos:sale-1:line-1",
      contentFingerprint: "fingerprint-1",
      movementType: "sale",
      productSkuId: "sku-1" as Id<"productSku">,
      quantityDelta: -1,
      sourceId: "sale-1",
      sourceType: "posTransaction",
      storeId: "store-1" as Id<"store">,
    };

    await recordInventoryMovementWithDispositionWithCtx(ctx, args);

    await expect(
      recordInventoryMovementWithDispositionWithCtx(ctx, {
        ...args,
        contentFingerprint: "different-fingerprint",
      }),
    ).rejects.toThrow(/business event key conflicts/i);
    expect(tables.inventoryMovement).toHaveLength(1);
    expect(tables.skuActivityEvent).toHaveLength(1);
  });
});
