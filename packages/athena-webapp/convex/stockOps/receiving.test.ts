import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";

import {
  assertDistinctReceivingLineItems,
  assertReceivablePurchaseOrderStatus,
  assertReceivingLineQuantities,
  calculatePurchaseOrderReceivingStatus,
  calculateReceivingBatchTotals,
  receivePurchaseOrderBatchCommandWithCtx,
  summarizeReceivingSkuDeltas,
} from "./receiving";

function getSource(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

function createReceivingMutationCtx(args?: {
  purchaseOrderStatus?: string;
}) {
  const tables = {
    productSku: new Map<string, Record<string, unknown>>([
      [
        "sku-1",
        {
          _id: "sku-1",
          inventoryCount: 8,
          quantityAvailable: 6,
          storeId: "store-1",
        },
      ],
    ]),
    purchaseOrder: new Map<string, Record<string, unknown>>([
      [
        "purchase-order-1",
        {
          _id: "purchase-order-1",
          operationalWorkItemId: "work-item-1",
          organizationId: "org-1",
          status: args?.purchaseOrderStatus ?? "ordered",
          storeId: "store-1",
        },
      ],
    ]),
    purchaseOrderLineItem: new Map<string, Record<string, unknown>>([
      [
        "line-item-1",
        {
          _id: "line-item-1",
          orderedQuantity: 4,
          productId: "product-1",
          productSkuId: "sku-1",
          purchaseOrderId: "purchase-order-1",
          receivedQuantity: 1,
        },
      ],
    ]),
    receivingBatch: new Map<string, Record<string, unknown>>(),
  };
  const insertCounters: Record<"receivingBatch" | "inventoryMovement", number> = {
    inventoryMovement: 0,
    receivingBatch: 0,
  };

  const ctx = {
    db: {
      async get(table: keyof typeof tables, id: string) {
        return tables[table].get(id) ?? null;
      },
      async insert(
        table: "inventoryMovement" | "receivingBatch",
        value: Record<string, unknown>
      ) {
        insertCounters[table] += 1;
        const id = `${table}-${insertCounters[table]}`;
        return id;
      },
      async patch(
        table: keyof typeof tables,
        id: string,
        value: Record<string, unknown>
      ) {
        const existingRecord = tables[table].get(id);

        if (!existingRecord) {
          throw new Error(`Missing ${table} record: ${id}`);
        }

        tables[table].set(id, { ...existingRecord, ...value });
      },
      query(table: "purchaseOrderLineItem" | "receivingBatch") {
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

              return {
                async *[Symbol.asyncIterator]() {
                  for (const record of tables.purchaseOrderLineItem.values()) {
                    if (record.purchaseOrderId === purchaseOrderId) {
                      yield record;
                    }
                  }
                },
              };
            },
          };
        }

        return {
          withIndex(
            _index: string,
            applyIndex: (queryBuilder: {
              eq: (field: string, value: unknown) => unknown;
            }) => unknown
          ) {
            const filters: Array<[string, unknown]> = [];
            const queryBuilder = {
              eq(field: string, value: unknown) {
                filters.push([field, value]);
                return queryBuilder;
              },
            };

            applyIndex(queryBuilder);

            return {
              first: async () =>
                Array.from(tables.receivingBatch.values()).find((record) =>
                  filters.every(([field, value]) => record[field] === value)
                ) ?? null,
            };
          },
        };
      },
    },
    runMutation: vi.fn().mockResolvedValue(undefined),
  } as unknown as MutationCtx;

  return { ctx, tables };
}

describe("stock ops receiving", () => {
  it("calculates batch totals from partial receiving line items", () => {
    expect(
      calculateReceivingBatchTotals([
        { receivedQuantity: 2 },
        { receivedQuantity: 1 },
      ])
    ).toEqual({
      lineItemCount: 2,
      totalUnits: 3,
    });
  });

  it("blocks over-receiving beyond the ordered quantity", () => {
    expect(() =>
      assertReceivingLineQuantities([
        {
          orderedQuantity: 2,
          receivedQuantity: 3,
        },
      ])
    ).toThrow("cannot receive more than ordered");
  });

  it("keeps a purchase order partially received until every line is satisfied", () => {
    expect(
      calculatePurchaseOrderReceivingStatus([
        {
          orderedQuantity: 4,
          receivedQuantity: 4,
        },
        {
          orderedQuantity: 2,
          receivedQuantity: 0,
        },
      ])
    ).toBe("partially_received");

    expect(
      calculatePurchaseOrderReceivingStatus([
        {
          orderedQuantity: 4,
          receivedQuantity: 4,
        },
        {
          orderedQuantity: 2,
          receivedQuantity: 2,
        },
      ])
    ).toBe("received");
  });

  it("rejects duplicate purchase-order lines inside one receiving batch", () => {
    expect(() =>
      assertDistinctReceivingLineItems([
        {
          purchaseOrderLineItemId: "line-1",
        },
        {
          purchaseOrderLineItemId: "line-1",
        },
      ])
    ).toThrow("cannot include the same purchase order line twice");
  });

  it("only accepts receivable purchase-order statuses", () => {
    expect(() => assertReceivablePurchaseOrderStatus("draft")).toThrow(
      "Cannot receive purchase order while it is draft"
    );
    expect(() => assertReceivablePurchaseOrderStatus("approved")).toThrow(
      "Cannot receive purchase order while it is approved"
    );
    expect(() => assertReceivablePurchaseOrderStatus("ordered")).not.toThrow();
    expect(() =>
      assertReceivablePurchaseOrderStatus("partially_received")
    ).not.toThrow();
  });

  it("coalesces repeated sku deltas before inventory updates are written", () => {
    expect(
      summarizeReceivingSkuDeltas([
        {
          productId: "product-1",
          productSkuId: "sku-1",
          receivedQuantity: 2,
        },
        {
          productId: "product-1",
          productSkuId: "sku-1",
          receivedQuantity: 3,
        },
        {
          productId: "product-2",
          productSkuId: "sku-2",
          receivedQuantity: 1,
        },
      ])
    ).toEqual([
      {
        productId: "product-1",
        productSkuId: "sku-1",
        receivedQuantity: 5,
      },
      {
        productId: "product-2",
        productSkuId: "sku-2",
        receivedQuantity: 1,
      },
    ]);
  });

  it("short-circuits duplicate batch submissions through the receiving batch lookup", () => {
    const source = getSource("./receiving.ts");

    expect(source).toContain(
      'withIndex("by_storeId_purchaseOrderId_submissionKey"'
    );
    expect(source).toContain("existingReceivingBatch");
    expect(source).toContain("if (existingReceivingBatch) {");
  });

  it("returns a validation user error when the receiving submission key is missing", async () => {
    const { ctx } = createReceivingMutationCtx();

    await expect(
      receivePurchaseOrderBatchCommandWithCtx(ctx, {
        lineItems: [],
        notes: undefined,
        purchaseOrderId: "purchase-order-1" as Id<"purchaseOrder">,
        receivedByUserId: undefined,
        storeId: "store-1" as Id<"store">,
        submissionKey: "   ",
      })
    ).resolves.toMatchObject({
      kind: "user_error",
      error: {
        code: "validation_failed",
        message: "A receiving submission key is required.",
      },
    });
  });

  it("returns a validation user error when a receiving batch over-receives a line", async () => {
    const { ctx } = createReceivingMutationCtx();

    await expect(
      receivePurchaseOrderBatchCommandWithCtx(ctx, {
        lineItems: [
          {
            purchaseOrderLineItemId: "line-item-1" as Id<"purchaseOrderLineItem">,
            receivedQuantity: 4,
          },
        ],
        notes: undefined,
        purchaseOrderId: "purchase-order-1" as Id<"purchaseOrder">,
        receivedByUserId: undefined,
        storeId: "store-1" as Id<"store">,
        submissionKey: "receive-1",
      })
    ).resolves.toMatchObject({
      kind: "user_error",
      error: {
        code: "validation_failed",
        message: "You cannot receive more than ordered.",
      },
    });
  });
});
