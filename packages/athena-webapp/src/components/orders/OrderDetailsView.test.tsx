import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const useOnlineOrderMock = vi.fn();
const getActiveStoreMock = vi.fn();

vi.mock("~/src/contexts/OnlineOrderContext", () => ({
  useOnlineOrder: () => useOnlineOrderMock(),
}));

vi.mock("~/src/hooks/useGetActiveStore", () => ({
  default: () => getActiveStoreMock(),
}));

vi.mock("~/src/hooks/useAuth", () => ({
  useAuth: () => ({ user: { _id: "user_1", email: "ops@osustudio.com" } }),
}));

import { OrderDetailsView } from "./OrderDetailsView";

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

describe("OrderDetailsView paid amount", () => {
  beforeEach(() => {
    useOnlineOrderMock.mockReset();
    getActiveStoreMock.mockReset();
    getActiveStoreMock.mockReturnValue({ activeStore: { currency: "GHS" } });
  });

  const verifiedOrder = (overrides: Record<string, unknown>) => ({
    _id: "order_1",
    amount: 150000,
    deliveryFee: 0,
    hasVerifiedPayment: true,
    items: [{ price: 150000, productSkuId: "sku_1", quantity: 1 }],
    paymentMethod: { channel: "card", type: "card" },
    status: "open",
    ...overrides,
  });

  it("shows the undiscounted order total when no discount applies", () => {
    useOnlineOrderMock.mockReturnValue({ order: verifiedOrder({}) });

    render(<OrderDetailsView />);

    expect(screen.getByText("Paid GH₵1,500")).toBeVisible();
  });

  it("subtracts a percentage discount from the paid amount it renders", () => {
    // 10% of a GH₵1,500 order is GH₵150, so the payment badge must read
    // GH₵1,350 — the same figure `getAmountPaidForOrder` gives every other
    // surface. Rendering the gross GH₵1,500, or the 100x-inflated GH₵15,000
    // the old local discount helper produced, both fail here.
    useOnlineOrderMock.mockReturnValue({
      order: verifiedOrder({
        discount: {
          code: "SAVE10",
          span: "entire-order",
          type: "percentage",
          value: 10,
        },
      }),
    });

    render(<OrderDetailsView />);

    expect(screen.getByText("Paid GH₵1,350")).toBeVisible();
    expect(screen.queryByText("Paid GH₵1,500")).toBeNull();
  });
});
