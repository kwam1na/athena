import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function getSource(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

describe("online order checkout money wiring", () => {
  it("recomputes order item prices and totals from server SKU data", () => {
    const source = getSource("./helpers/onlineOrder.ts");

    expect(source).toContain("const serverPricedItems = await Promise.all");
    expect(source).toContain('ctx.db.get("productSku", item.productSkuId)');
    expect(source).toContain("const subtotal = calculateItemsSubtotal(serverPricedItems)");
    expect(source).toContain("amount: subtotal");
    expect(source).toContain("serverPricedItems.map((item) =>");
  });

  it("rejects unresolved delivery pricing instead of defaulting to a zero fee", () => {
    const source = getSource("./helpers/onlineOrder.ts");

    expect(source).toContain("if (deliveryFee === null)");
    expect(source).toContain(
      'throw new Error("Delivery details are required before creating an order.")',
    );
    expect(source).not.toContain("}) ?? 0");
  });
});
