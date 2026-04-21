import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import {
  listReplenishmentRecommendationsWithCtx,
} from "./replenishment";

function getSource(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

function toAsyncIterable<T>(records: T[]) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const record of records) {
        yield record;
      }
    },
  };
}

function createReplenishmentQueryCtx() {
  const tables = {
    productSku: new Map<string, Record<string, unknown>>([
      [
        "sku-reorder",
        {
          _id: "sku-reorder",
          inventoryCount: 0,
          productName: "Closure Wig",
          quantityAvailable: 0,
          sku: "CW-18",
          storeId: "store-1",
        },
      ],
      [
        "sku-inbound",
        {
          _id: "sku-inbound",
          inventoryCount: 1,
          productName: "Frontal Wig",
          quantityAvailable: 1,
          sku: "FW-20",
          storeId: "store-1",
        },
      ],
      [
        "sku-constrained",
        {
          _id: "sku-constrained",
          inventoryCount: 7,
          productName: "Silk Press Kit",
          quantityAvailable: 1,
          sku: "SP-01",
          storeId: "store-1",
        },
      ],
    ]),
    purchaseOrder: new Map<string, Record<string, unknown>>([
      [
        "po-inbound",
        {
          _id: "po-inbound",
          expectedAt: 1_712_345_678_900,
          poNumber: "PO-001",
          status: "ordered",
          storeId: "store-1",
        },
      ],
    ]),
    purchaseOrderLineItem: new Map<string, Record<string, unknown>>([
      [
        "line-inbound",
        {
          _id: "line-inbound",
          orderedQuantity: 6,
          productSkuId: "sku-inbound",
          purchaseOrderId: "po-inbound",
          receivedQuantity: 0,
          storeId: "store-1",
        },
      ],
    ]),
  };

  const ctx = {
    db: {
      query(table: keyof typeof tables) {
        if (table === "productSku") {
          return {
            withIndex(
              _index: string,
              applyIndex: (queryBuilder: {
                eq: (field: string, value: unknown) => unknown;
              }) => unknown
            ) {
              let storeId: unknown;
              const queryBuilder = {
                eq(field: string, value: unknown) {
                  if (field === "storeId") {
                    storeId = value;
                  }

                  return queryBuilder;
                },
              };

              applyIndex(queryBuilder);

              return toAsyncIterable(
                Array.from(tables.productSku.values()).filter(
                  (record) => record.storeId === storeId
                )
              );
            },
          };
        }

        if (table === "purchaseOrder") {
          return {
            withIndex(
              _index: string,
              applyIndex: (queryBuilder: {
                eq: (field: string, value: unknown) => unknown;
              }) => unknown
            ) {
              let status: unknown;
              let storeId: unknown;
              const queryBuilder = {
                eq(field: string, value: unknown) {
                  if (field === "status") {
                    status = value;
                  }

                  if (field === "storeId") {
                    storeId = value;
                  }

                  return queryBuilder;
                },
              };

              applyIndex(queryBuilder);

              return toAsyncIterable(
                Array.from(tables.purchaseOrder.values()).filter(
                  (record) =>
                    record.storeId === storeId && record.status === status
                )
              );
            },
          };
        }

        if (table === "purchaseOrderLineItem") {
          return {
            withIndex(
              _index: string,
              applyIndex: (queryBuilder: {
                eq: (field: string, value: unknown) => unknown;
              }) => unknown
            ) {
              let purchaseOrderId: unknown;
              const queryBuilder = {
                eq(field: string, value: unknown) {
                  if (field === "purchaseOrderId") {
                    purchaseOrderId = value;
                  }

                  return queryBuilder;
                },
              };

              applyIndex(queryBuilder);

              return toAsyncIterable(
                Array.from(tables.purchaseOrderLineItem.values()).filter(
                  (record) => record.purchaseOrderId === purchaseOrderId
                )
              );
            },
          };
        }

        throw new Error(`Unexpected table: ${table}`);
      },
    },
  } as unknown as QueryCtx;

  return { ctx, tables };
}

describe("stock ops replenishment", () => {
  it("builds reorder, inbound, and constrained recommendations from stock and receiving context", async () => {
    const { ctx } = createReplenishmentQueryCtx();

    const result = await listReplenishmentRecommendationsWithCtx(ctx, {
      storeId: "store-1" as Id<"store">,
    });

    expect(result.map((item) => item.status)).toEqual([
      "reorder_now",
      "awaiting_receipt",
      "availability_constrained",
    ]);
    expect(result[0]).toMatchObject({
      productName: "Closure Wig",
      status: "reorder_now",
      suggestedOrderQuantity: 6,
    });
    expect(result[1]).toMatchObject({
      pendingPurchaseOrderCount: 1,
      pendingPurchaseOrderQuantity: 6,
      productName: "Frontal Wig",
      status: "awaiting_receipt",
      suggestedOrderQuantity: 0,
    });
    expect(result[2]).toMatchObject({
      productName: "Silk Press Kit",
      status: "availability_constrained",
      suggestedOrderQuantity: 0,
    });
  });

  it("keeps a recommendation in reorder_now when inbound units still leave the shelf below target", async () => {
    const { ctx, tables } = createReplenishmentQueryCtx();

    tables.purchaseOrderLineItem.set("line-reorder-top-up", {
      _id: "line-reorder-top-up",
      orderedQuantity: 2,
      productSkuId: "sku-reorder",
      purchaseOrderId: "po-inbound",
      receivedQuantity: 0,
      storeId: "store-1",
    });

    const result = await listReplenishmentRecommendationsWithCtx(ctx, {
      storeId: "store-1" as Id<"store">,
    });
    const reorderItem = result.find((item) => item._id === "sku-reorder");

    expect(reorderItem).toMatchObject({
      pendingPurchaseOrderQuantity: 2,
      status: "reorder_now",
      suggestedOrderQuantity: 4,
    });
  });

  it("requires full-admin access before exposing replenishment recommendations", () => {
    const source = getSource("./replenishment.ts");

    expect(source).toContain("requireStoreFullAdminAccess(ctx, args.storeId);");
  });
});
