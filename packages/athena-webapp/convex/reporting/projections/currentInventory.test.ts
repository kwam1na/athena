import { describe, expect, it } from "vitest";

import { buildCurrentInventoryProjection } from "./currentInventory";

describe("current inventory projection", () => {
  it("keeps known value, unknown quantity, and signed book position explicit", () => {
    expect(
      buildCurrentInventoryProjection({
        costedQuantity: 6,
        currency: "GHS",
        knownCostPoolMinor: 12_000,
        onHandQuantity: 10,
        sellableQuantity: 8,
        skuId: "sku-1",
        storeId: "store-1",
        uncostedQuantity: 4,
        unresolvedDeficitQuantity: 2,
      }),
    ).toEqual({
      averageKnownUnitCostMinor: 2_000,
      costStatus: "partial",
      costedQuantity: 6,
      currency: "GHS",
      knownCostPoolMinor: 12_000,
      onHandQuantity: 10,
      sellableQuantity: 8,
      signedBookPosition: 8,
      skuId: "sku-1",
      storeId: "store-1",
      uncostedQuantity: 4,
      unresolvedDeficitQuantity: 2,
    });
  });
});
