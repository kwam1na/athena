import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  assertValidPurchaseOrderStatusTransition,
  calculatePurchaseOrderTotals,
} from "./purchaseOrders";

function getSource(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

describe("stock ops purchase orders", () => {
  it("calculates purchase-order totals from line items", () => {
    expect(
      calculatePurchaseOrderTotals([
        {
          orderedQuantity: 2,
          unitCost: 1500,
        },
        {
          orderedQuantity: 3,
          unitCost: 900,
        },
      ])
    ).toEqual({
      lineItemCount: 2,
      subtotalAmount: 5700,
      totalAmount: 5700,
      totalUnits: 5,
    });
  });

  it("blocks invalid purchase-order status transitions", () => {
    expect(() =>
      assertValidPurchaseOrderStatusTransition("draft", "received")
    ).toThrow("Cannot change purchase order from draft to received.");

    expect(() =>
      assertValidPurchaseOrderStatusTransition("ordered", "draft")
    ).toThrow("Cannot change purchase order from ordered to draft.");

    expect(() =>
      assertValidPurchaseOrderStatusTransition("draft", "submitted")
    ).not.toThrow();
  });

  it("writes purchase-order workflow changes through the shared operations rails", () => {
    const source = getSource("./purchaseOrders.ts");

    expect(source).toContain("export const createPurchaseOrder = mutation({");
    expect(source).toContain(
      "export const updatePurchaseOrderStatus = mutation({"
    );
    expect(source).toContain("createOperationalWorkItemWithCtx");
    expect(source).toContain("recordOperationalEventWithCtx");
    expect(source).toContain("updateOperationalWorkItemStatus");
  });
});
