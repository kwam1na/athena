import { describe, it } from "vitest";

// Shared-demo restrictions do not change this inventory query contract.

import { assertConformsToExportedReturns } from "../lib/returnValidatorContract";
import { getInventoryBySkuIdsInternal } from "./productSku";

describe("product SKU public contracts", () => {
  it("accepts representative inventory query return values", () => {
    assertConformsToExportedReturns(getInventoryBySkuIdsInternal, [
      {
        _id: "sku-1",
        inventoryCount: 4,
        quantityAvailable: 3,
      },
    ]);
  });
});
