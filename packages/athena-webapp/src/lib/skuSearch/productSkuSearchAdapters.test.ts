import { describe, expect, it } from "vitest";

import type { Id } from "../../../convex/_generated/dataModel";
import {
  buildAdminSkuSearchOption,
  buildAdminSkuSearchOptions,
  groupAdminSkuSearchOptionsByProduct,
  type ProductSkuSearchResultLike,
} from "./productSkuSearchAdapters";

function buildResult(
  overrides: Partial<ProductSkuSearchResultLike> = {},
): ProductSkuSearchResultLike {
  return {
    barcode: "123456789012",
    categoryName: "Wigs",
    colorName: "Natural black",
    images: ["image.webp"],
    inventoryCount: 4,
    isVisible: true,
    length: 18,
    match: {
      kind: "barcode",
      matchedValue: "123456789012",
      rank: 2,
    },
    price: 120000,
    productAvailability: "live",
    productId: "product-1" as Id<"product">,
    productIsVisible: true,
    productName: "Body wave bundle",
    productSkuId: "sku-1" as Id<"productSku">,
    productSlug: "body-wave-bundle",
    quantityAvailable: 3,
    size: "M",
    sku: "BW-18",
    skuIsVisible: true,
    storeId: "store-1" as Id<"store">,
    subcategoryName: "Bundles",
    ...overrides,
  };
}

describe("productSkuSearchAdapters", () => {
  it("builds stable admin option labels from generic SKU search results", () => {
    const option = buildAdminSkuSearchOption(buildResult());

    expect(option).toMatchObject({
      barcode: "123456789012",
      imageUrl: "image.webp",
      label: "Body wave bundle / BW-18",
      matchKind: "barcode",
      metadata: "Wigs · Bundles · Barcode 123456789012",
      productId: "product-1",
      productSkuId: "sku-1",
      quantityAvailable: 3,
      sizeLabel: 'M · 18" · Natural black',
      subtitle: 'M · 18" · Natural black · Visible · Wigs · Bundles · Barcode 123456789012',
    });
  });

  it("keeps archived and hidden lifecycle state in presentation metadata", () => {
    const archived = buildAdminSkuSearchOption(
      buildResult({
        barcode: null,
        match: { kind: "sku", matchedValue: "ARCH-1", rank: 1 },
        productAvailability: "archived",
        productIsVisible: false,
        sku: "ARCH-1",
      }),
    );

    expect(archived.subtitle).toContain("Archived");
    expect(archived.metadata).not.toContain("Barcode");
    expect(archived.matchKind).toBe("sku");
  });

  it("groups SKU options by product and sorts by best match rank", () => {
    const options = buildAdminSkuSearchOptions([
      buildResult({
        match: { kind: "text", matchedValue: "body", rank: 4 },
        productId: "product-1" as Id<"product">,
        productName: "Body wave bundle",
        productSkuId: "sku-2" as Id<"productSku">,
        sku: "BW-20",
      }),
      buildResult({
        match: { kind: "sku", matchedValue: "BW-18", rank: 1 },
        productId: "product-1" as Id<"product">,
        productName: "Body wave bundle",
        productSkuId: "sku-1" as Id<"productSku">,
        sku: "BW-18",
      }),
      buildResult({
        match: { kind: "text", matchedValue: "straight", rank: 3 },
        productId: "product-2" as Id<"product">,
        productName: "Straight bundle",
        productSkuId: "sku-3" as Id<"productSku">,
        sku: "ST-18",
      }),
    ]);

    const groups = groupAdminSkuSearchOptionsByProduct(options);

    expect(groups.map((group) => group.productId)).toEqual([
      "product-1",
      "product-2",
    ]);
    expect(groups[0].bestMatchRank).toBe(1);
    expect(groups[0].skus.map((sku) => sku.productSkuId)).toEqual([
      "sku-1",
      "sku-2",
    ]);
  });
});
