import { describe, expect, it } from "vitest";

import {
  buildRegisterCatalogIndex,
  buildRegisterServiceCatalogIndex,
  searchRegisterCatalog,
  searchRegisterServiceCatalog,
  type RegisterCatalogSearchRow,
  type RegisterServiceCatalogSearchRow,
} from "./catalogSearch";

const rows: RegisterCatalogSearchRow[] = [
  {
    productId: "product-red-shirt",
    productSkuId: "sku-red-small",
    name: "Red Linen Shirt",
    sku: "SHIRT-RED-S",
    barcode: "000111222333",
    category: "Apparel",
    description: "Breathable linen button shirt",
    price: 120,
    size: "S",
    color: "Red",
    length: null,
  },
  {
    productId: "product-red-shirt",
    productSkuId: "sku-red-large",
    name: "Red Linen Shirt",
    sku: "SHIRT-RED-L",
    barcode: "000111222334",
    category: "Apparel",
    description: "Breathable linen button shirt",
    price: 120,
    size: "L",
    color: "Red",
    length: null,
  },
  {
    productId: "product-socks",
    productSkuId: "sku-socks",
    name: "Black Cotton Socks",
    sku: "SOCK-BLK",
    barcode: "999888777666",
    category: "Accessories",
    description: "Everyday cotton crew socks",
    price: 25,
    size: "One Size",
    color: "Black",
    length: null,
  },
  {
    productId: "product-belt",
    productSkuId: "sku-belt",
    name: "Leather Belt",
    sku: "BELT-BRN-32",
    barcode: "555444333222",
    category: "Accessories",
    description: "Brown full grain leather belt",
    price: 80,
    size: "32",
    color: "Brown",
    length: 32,
  },
];

const serviceRows: RegisterServiceCatalogSearchRow[] = [
  {
    serviceCatalogId: "service-closure",
    name: "Closure Repair",
    description: "Repair a closure install",
    serviceMode: "repair",
    pricingModel: "fixed",
    basePrice: 4_500,
    depositType: "flat",
    depositValue: 1_000,
    requiresManagerApproval: false,
    checkoutReadiness: {
      canCheckoutDirectly: true,
      message: "Ready for checkout.",
      reason: "fixed_price",
      status: "ready",
      suggestedAmount: 4_500,
      minimumAmount: 1_000,
    },
  },
  {
    serviceCatalogId: "service-revamp",
    name: "Wig Revamp",
    description: "Refresh and style a wig",
    serviceMode: "revamp",
    pricingModel: "starting_at",
    basePrice: 8_000,
    depositType: "percentage",
    depositValue: 50,
    requiresManagerApproval: true,
    checkoutReadiness: {
      canCheckoutDirectly: false,
      message: "Enter the service amount before checkout.",
      reason: "starting_at_amount_required",
      status: "amount_required",
      suggestedAmount: 4_000,
    },
  },
];

describe("catalogSearch", () => {
  it("returns a barcode exact match before text ranking", () => {
    const result = searchRegisterCatalog(
      buildRegisterCatalogIndex(rows),
      "000111222333",
    );

    expect(result.intent).toBe("exact");
    expect(result.exactMatch?.productSkuId).toBe("sku-red-small");
    expect(result.results.map((row) => row.productSkuId)).toEqual([
      "sku-red-small",
    ]);
  });

  it("does not fuzzy match a barcode-shaped lookup that is not in the catalog", () => {
    const result = searchRegisterCatalog(
      buildRegisterCatalogIndex(rows),
      "555444333223",
    );

    expect(result.intent).toBe("exact");
    expect(result.exactMatch).toBeNull();
    expect(result.results).toEqual([]);
  });

  it("does not match barcode-shaped lookups against numeric SKU substrings", () => {
    const result = searchRegisterCatalog(
      buildRegisterCatalogIndex([
        ...rows,
        {
          productId: "product-wax",
          productSkuId: "sku-wax",
          name: "Yizia Wax & Mud 128ml",
          sku: "KK38-721-WBJ",
          barcode: "111222333444",
          category: "Hair care",
          description: "POS quick add",
          price: 15,
          size: null,
          color: null,
          length: null,
        },
      ]),
      "6935721830015",
    );

    expect(result.intent).toBe("exact");
    expect(result.results).toEqual([]);
  });

  it("returns a SKU exact match case-insensitively", () => {
    const result = searchRegisterCatalog(
      buildRegisterCatalogIndex(rows),
      "shirt-red-s",
    );

    expect(result.intent).toBe("exact");
    expect(result.exactMatch?.productSkuId).toBe("sku-red-small");
  });

  it("returns a product SKU id exact match", () => {
    const result = searchRegisterCatalog(
      buildRegisterCatalogIndex(rows),
      "sku-socks",
    );

    expect(result.intent).toBe("exact");
    expect(result.exactMatch?.name).toBe("Black Cotton Socks");
  });

  it("extracts product ids from product URLs", () => {
    const result = searchRegisterCatalog(
      buildRegisterCatalogIndex(rows),
      "https://store.example.com/shop/product/product-socks",
    );

    expect(result.intent).toBe("exact");
    expect(result.exactMatch?.productSkuId).toBe("sku-socks");
  });

  it("returns every variant for a product id with multiple variants", () => {
    const result = searchRegisterCatalog(
      buildRegisterCatalogIndex(rows),
      "product-red-shirt",
    );

    expect(result.intent).toBe("exact");
    expect(result.exactMatch).toBeNull();
    expect(result.results.map((row) => row.productSkuId)).toEqual([
      "sku-red-small",
      "sku-red-large",
    ]);
  });

  it("ranks text token matches by stronger product fields first", () => {
    const result = searchRegisterCatalog(
      buildRegisterCatalogIndex(rows),
      "red shirt",
    );

    expect(result.intent).toBe("text");
    expect(result.results.map((row) => row.productSkuId).slice(0, 2)).toEqual([
      "sku-red-small",
      "sku-red-large",
    ]);
  });

  it("requires every text query token to match somewhere in the row", () => {
    const result = searchRegisterCatalog(
      buildRegisterCatalogIndex([
        ...rows,
        {
          productId: "product-hair-bands",
          productSkuId: "sku-hair-bands",
          name: "Hair Bands",
          sku: "KK38-6C-VHT",
          barcode: "111222333555",
          category: "POS quick add",
          description: "Assorted hair bands",
          price: 25,
          size: null,
          color: null,
          length: null,
        },
        {
          productId: "product-clamps",
          productSkuId: "sku-clamps",
          name: "12 Pieces Butterfly Plastic Clamps",
          sku: "KK38-64H-WTB",
          barcode: "111222333556",
          category: "Hair Accessories",
          description: null,
          price: 20,
          size: null,
          color: null,
          length: null,
        },
      ]),
      "hair bands",
    );

    expect(result.intent).toBe("text");
    expect(result.results.map((row) => row.productSkuId)).toContain(
      "sku-hair-bands",
    );
    expect(result.results.map((row) => row.productSkuId)).not.toContain(
      "sku-clamps",
    );
  });

  it("normalizes case and punctuation for text search", () => {
    const result = searchRegisterCatalog(
      buildRegisterCatalogIndex(rows),
      "  LEATHER/belt!! ",
    );

    expect(result.intent).toBe("text");
    expect(result.results[0]?.productSkuId).toBe("sku-belt");
  });

  it("returns prefix fuzzy matches from the local text index", () => {
    const result = searchRegisterCatalog(
      buildRegisterCatalogIndex([
        ...rows,
        {
          productId: "product-durable-lace",
          productSkuId: "sku-durable-lace",
          name: "Durable Lace Front",
          sku: "DLF-20",
          barcode: "444555666777",
          category: "Wigs",
          description: "Long-wear frontal wig",
          price: 250,
          size: "M",
          color: "Natural",
          length: 20,
        },
      ]),
      "dura",
    );

    expect(result.intent).toBe("text");
    expect(result.results[0]?.productSkuId).toBe("sku-durable-lace");
  });

  it("returns typo-tolerant fuzzy matches from the local text index", () => {
    const result = searchRegisterCatalog(
      buildRegisterCatalogIndex(rows),
      "lether",
    );

    expect(result.intent).toBe("text");
    expect(result.results[0]?.productSkuId).toBe("sku-belt");
  });

  it("returns no results for unmatched text", () => {
    const result = searchRegisterCatalog(
      buildRegisterCatalogIndex(rows),
      "ceramic mug",
    );

    expect(result.intent).toBe("text");
    expect(result.results).toEqual([]);
  });

  it("keeps exact metadata matches visible without marking them auto-addable", () => {
    const result = searchRegisterCatalog(
      buildRegisterCatalogIndex(rows),
      "SHIRT-RED-L",
    );

    expect(result.intent).toBe("exact");
    expect(result.exactMatch?.productSkuId).toBe("sku-red-large");
    expect(result.canAutoAdd).toBe(false);
  });

  it("searches service catalog rows separately from SKU-backed product rows", () => {
    const result = searchRegisterServiceCatalog(
      buildRegisterServiceCatalogIndex(serviceRows),
      "wig revamp",
    );

    expect(result.intent).toBe("text");
    expect(result.results.map((row) => row.serviceCatalogId)).toEqual([
      "service-revamp",
    ]);
    expect(
      searchRegisterCatalog(buildRegisterCatalogIndex(rows), "wig revamp").results,
    ).toEqual([]);
  });

  it("returns service catalog id exact matches without product auto-add semantics", () => {
    const result = searchRegisterServiceCatalog(
      buildRegisterServiceCatalogIndex(serviceRows),
      "service-closure",
    );

    expect(result).toMatchObject({
      intent: "exact",
      canAutoAdd: false,
      exactMatch: expect.objectContaining({
        serviceCatalogId: "service-closure",
        checkoutReadiness: expect.objectContaining({ status: "ready" }),
      }),
    });
  });
});
