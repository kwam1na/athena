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

  it("keeps method, status, and pending guidance readable in the narrow rail", () => {
    expect(source).toContain(
      'className="flex items-start justify-between gap-layout-md"',
    );
    expect(source).toContain("Account ending in {paymentMethod.last4}");
    expect(source).toContain("Verification pending");
    expect(source).toContain("Automatic verification has not run yet.");
    expect(source).toContain("border-warning/20 bg-warning/5");
    expect(source).not.toContain("text-yellow-600 bg-yellow-50");
  });
});
