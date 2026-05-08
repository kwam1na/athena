import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  join(process.cwd(), "src/components/orders/RefundsView.tsx"),
  "utf8",
);

describe("RefundsView money display", () => {
  it("formats stored minor-unit refund amounts through the shared helper", () => {
    expect(source).toContain("formatStoredAmount(formatter, refundAmount)");
    expect(source).toContain("formatStoredAmount(formatter, order.amount)");
    expect(source).toContain("formatStoredAmount(formatter, amountRefunded)");
    expect(source).toContain("formatStoredAmount(formatter, netAmount)");
    expect(source).toContain(
      "formatStoredAmount(formatter, order.deliveryFee)",
    );
  });

  it("formats item unit and line totals as stored minor-unit values", () => {
    expect(source).toContain("formatStoredAmount(formatter, item.price)");
    expect(source).toContain("item.price * item.quantity");
    expect(source).not.toContain("formatter.format(item.price)");
    expect(source).not.toContain("formatter.format(order.deliveryFee)");
  });
});
