import { describe, expect, it } from "vitest";

import { buildVariantSkuMoneyPayload } from "./ProductView";

describe("ProductView SKU money payloads", () => {
  it("persists decimal net price and unit cost as minor units when fees are absorbed", () => {
    expect(
      buildVariantSkuMoneyPayload(
        {
          cost: 12.34,
          netPrice: 45.67,
        },
        true,
      ),
    ).toEqual({
      netPrice: 4567,
      price: 4567,
      unitCost: 1234,
    });
  });

  it("persists a fee-inclusive price as minor units when fees are not absorbed", () => {
    expect(
      buildVariantSkuMoneyPayload(
        {
          cost: 9.99,
          netPrice: 100,
        },
        false,
      ),
    ).toEqual({
      netPrice: 10000,
      price: 10200,
      unitCost: 999,
    });
  });
});
