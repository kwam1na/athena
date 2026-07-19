import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  join(process.cwd(), "src/components/orders/OrderDetailsView.tsx"),
  "utf8",
);

describe("OrderDetailsView payment details", () => {
  it("hides card-ending metadata for payment-on-delivery orders", () => {
    expect(source).toContain("!isPODOrder && paymentMethod?.last4 ? (");
  });

  it("does not fetch unused live Paystack transactions when the view mounts", () => {
    expect(source).not.toContain("paystackActions.getAllTransactions");
  });
});
