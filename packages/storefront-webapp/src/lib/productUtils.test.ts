import { describe, expect, it } from "vitest";

import { getPreferredSku, hasLowStock, isSoldOut } from "./productUtils";

describe("productUtils", () => {
  it("treats sellable availability as the storefront sold-out boundary", () => {
    expect(
      isSoldOut({
        inventoryCount: 0,
        quantityAvailable: 3,
      } as any),
    ).toBe(false);
    expect(
      isSoldOut({
        inventoryCount: 8,
        quantityAvailable: 0,
      } as any),
    ).toBe(true);
  });

  it("prefers the shortest in-stock SKU over earlier sold-out SKUs", () => {
    const preferred = getPreferredSku([
      { _id: "sku-12", length: 12, quantityAvailable: 0 } as any,
      { _id: "sku-18", length: 18, quantityAvailable: 4 } as any,
      { _id: "sku-16", length: 16, quantityAvailable: 2 } as any,
    ]);

    expect(preferred?._id).toBe("sku-16");
  });

  it("uses sellable availability for low-stock messaging", () => {
    expect(
      hasLowStock({
        inventoryCount: 1,
        quantityAvailable: 5,
      } as any),
    ).toBe(false);
  });
});
