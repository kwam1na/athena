import { describe, expect, it } from "vitest";

import type { ProductSku } from "~/types";
import { convertSkuToVariant } from "./ProductContext";

function buildProductSku(unitCost?: number): ProductSku {
  return {
    _id: "sku-1",
    _creationTime: 1,
    productId: "product-1",
    storeId: "store-1",
    productName: "Body wave",
    sku: "BW-18",
    images: [],
    inventoryCount: 4,
    quantityAvailable: 4,
    price: 5000,
    unitCost,
  } as unknown as ProductSku;
}

describe("convertSkuToVariant", () => {
  it("keeps a missing stored unit cost unknown", () => {
    expect(convertSkuToVariant(buildProductSku()).cost).toBeUndefined();
  });

  it("preserves a legitimate stored zero unit cost", () => {
    expect(convertSkuToVariant(buildProductSku(0)).cost).toBe(0);
  });
});
