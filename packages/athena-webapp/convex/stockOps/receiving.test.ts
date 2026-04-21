import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  assertReceivingLineQuantities,
  calculatePurchaseOrderReceivingStatus,
  calculateReceivingBatchTotals,
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

  it("short-circuits duplicate batch submissions through the receiving batch lookup", () => {
    const source = getSource("./receiving.ts");

    expect(source).toContain(
      'withIndex("by_storeId_purchaseOrderId_submissionKey"'
    );
    expect(source).toContain("existingReceivingBatch");
    expect(source).toContain("if (existingReceivingBatch) {");
  });
});
