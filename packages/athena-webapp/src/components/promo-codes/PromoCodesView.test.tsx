import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function readSource(relativePath: string) {
  return readFileSync(
    fileURLToPath(new URL(relativePath, import.meta.url)),
    "utf8",
  );
}

describe("promo code money display", () => {
  it("formats fixed promo discounts from stored minor units in the list view", () => {
    const source = readSource("./PromoCodesView.tsx");

    expect(source).toContain(
      "formatStoredAmount(formatter, promoCode.discountValue)",
    );
    expect(source).toContain("`${promoCode.discountValue}%`");
    expect(source).not.toContain("formatter.format(promoCode.discountValue)");
  });

  it("formats selected SKU prices from stored minor units in the edit view", () => {
    const source = readSource("./PromoCodeView.tsx");

    expect(source).toContain("formatStoredAmount(formatter, sku.price)");
    expect(source).not.toContain("formatter.format(sku.price)");
  });
});
