import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  assertDistinctReceivingLineItems,
  assertReceivablePurchaseOrderStatus,
  assertReceivingLineQuantities,
  calculatePurchaseOrderReceivingStatus,
  calculateReceivingBatchTotals,
  summarizeReceivingSkuDeltas,
} from "./receiving";

function getSource(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
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
});
