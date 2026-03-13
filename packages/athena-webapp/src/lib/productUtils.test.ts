import { describe, expect, it } from "vitest";

import { getProductName, sortProduct } from "./productUtils";

describe("getProductName", () => {
  it("formats hair products with length and capitalized color", () => {
    expect(
      getProductName({
        productCategory: "Hair",
        length: 24,
        colorName: "natural black",
        productName: "body wave",
      })
    ).toBe('24" Natural Black Body Wave');
  });

  it("returns the raw name for non-hair products", () => {
    expect(
      getProductName({
        productCategory: "Accessories",
        productName: "Silk Bonnet",
      })
    ).toBe("Silk Bonnet");
  });
});

describe("sortProduct", () => {
  it("sorts hair products by length", () => {
    expect(
      sortProduct(
        { productCategory: "Hair", length: 18, price: 120 },
        { productCategory: "Hair", length: 24, price: 80 }
      )
    ).toBeLessThan(0);
  });

  it("sorts non-hair products by price", () => {
    expect(
      sortProduct(
        { productCategory: "Accessories", price: 80 },
        { productCategory: "Accessories", price: 120 }
      )
    ).toBeLessThan(0);
  });
});
