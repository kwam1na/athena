import { describe, expect, it } from "vitest";

import { parseVariantInputValue } from "./ProductStock";

describe("ProductStock money inputs", () => {
  it("keeps SKU and barcode inputs as text", () => {
    expect(parseVariantInputValue("sku", "ABC-123")).toBe("ABC-123");
    expect(parseVariantInputValue("barcode", "00001234")).toBe("00001234");
  });

  it("parses money fields through display-money normalization", () => {
    expect(parseVariantInputValue("netPrice", "12.34")).toBe(12.34);
    expect(parseVariantInputValue("cost", "0.75")).toBe(0.75);
  });

  it("keeps raw stock fields as raw numbers", () => {
    expect(parseVariantInputValue("stock", "12.5")).toBe(12.5);
    expect(parseVariantInputValue("quantityAvailable", "3")).toBe(3);
  });

  it("preserves blank numeric fields as unset", () => {
    expect(parseVariantInputValue("netPrice", "")).toBeUndefined();
    expect(parseVariantInputValue("stock", " ")).toBeUndefined();
  });
});
