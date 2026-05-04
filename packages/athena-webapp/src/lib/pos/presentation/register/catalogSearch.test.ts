import { describe, expect, it } from "vitest";

import {
  buildRegisterCatalogIndex,
  searchRegisterCatalog,
  type RegisterCatalogSearchRow,
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
    quantityAvailable: 6,
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
    quantityAvailable: 0,
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
    quantityAvailable: 12,
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
    quantityAvailable: 4,
    price: 80,
    size: "32",
    color: "Brown",
    length: 32,
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
      "shirt accessories",
    );

    expect(result.intent).toBe("text");
    expect(result.results.map((row) => row.productSkuId).slice(0, 2)).toEqual([
      "sku-red-small",
      "sku-red-large",
    ]);
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
          quantityAvailable: 3,
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

  it("keeps out-of-stock exact matches visible but not auto-addable", () => {
    const result = searchRegisterCatalog(
      buildRegisterCatalogIndex(rows),
      "SHIRT-RED-L",
    );

    expect(result.intent).toBe("exact");
    expect(result.exactMatch?.productSkuId).toBe("sku-red-large");
    expect(result.exactMatch?.quantityAvailable).toBe(0);
    expect(result.canAutoAdd).toBe(false);
  });
});
