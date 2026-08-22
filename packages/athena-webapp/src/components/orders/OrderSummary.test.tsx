import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Characterization coverage for the money lines the order summary renders.
// The component reads stored pesewas and formats major units, so it is the
// closest thing to a contract test for the currency helpers it imports.
const useOnlineOrderMock = vi.fn();
const useGetActiveStoreMock = vi.fn();

vi.mock("~/src/contexts/OnlineOrderContext", () => ({
  useOnlineOrder: () => useOnlineOrderMock(),
}));

vi.mock("~/src/hooks/useGetActiveStore", () => ({
  default: () => useGetActiveStoreMock(),
}));

import { OrderSummary } from "./OrderSummary";

type TestOrder = Record<string, unknown>;

function renderSummary(order: TestOrder | null) {
  useOnlineOrderMock.mockReturnValue({ order });
  useGetActiveStoreMock.mockReturnValue({
    activeStore: { currency: "GHS" },
  });

  return render(<OrderSummary />);
}

function amountFor(label: string) {
  const row = screen.getByText(label).closest(".justify-between");

  return row?.lastElementChild?.textContent ?? "";
}

describe("OrderSummary", () => {
  beforeEach(() => {
    useOnlineOrderMock.mockReset();
    useGetActiveStoreMock.mockReset();
  });

  it("renders nothing without an order", () => {
    const { container } = renderSummary(null);

    expect(container).toBeEmptyDOMElement();
  });

  it("formats subtotal and delivery fees from stored pesewas", () => {
    renderSummary({
      amount: 150000,
      deliveryFee: 3500,
      items: [{ price: 150000, quantity: 1, productSkuId: "sku_1" }],
      status: "open",
    });

    expect(amountFor("Subtotal")).toBe("GH₵1,500");
    expect(amountFor("Delivery fees")).toBe("GH₵35");
    expect(amountFor("Amount paid")).toBe("GH₵1,535");
  });

  it("omits the delivery line when there is no delivery fee", () => {
    renderSummary({
      amount: 150000,
      deliveryFee: 0,
      items: [{ price: 150000, quantity: 1, productSkuId: "sku_1" }],
      status: "open",
    });

    expect(screen.queryByText("Delivery fees")).toBeNull();
  });

  it("labels an uncollected payment-on-delivery order as an amount to collect", () => {
    renderSummary({
      amount: 150000,
      deliveryFee: 0,
      isPODOrder: true,
      paymentCollected: false,
      items: [{ price: 150000, quantity: 1, productSkuId: "sku_1" }],
      status: "open",
    });

    expect(screen.getByText("Amount to collect")).toBeVisible();
    expect(screen.queryByText("Amount paid")).toBeNull();
  });

  it("labels a collected payment-on-delivery order as an amount paid", () => {
    renderSummary({
      amount: 150000,
      deliveryFee: 0,
      paymentMethod: { type: "payment_on_delivery" },
      paymentCollected: true,
      items: [{ price: 150000, quantity: 1, productSkuId: "sku_1" }],
      status: "open",
    });

    expect(screen.getByText("Amount paid")).toBeVisible();
  });

  it("renders a percentage discount line and the discounted amount paid", () => {
    renderSummary({
      amount: 150000,
      deliveryFee: 0,
      discount: {
        code: "SAVE10",
        span: "entire-order",
        type: "percentage",
        value: 10,
      },
      items: [{ price: 1500, quantity: 1, productSkuId: "sku_1" }],
      status: "open",
    });

    expect(screen.getByText("SAVE10 - 10% off entire order")).toBeVisible();
    expect(amountFor("Discounts")).toBe("GH₵150");
    expect(amountFor("Amount paid")).toBe("GH₵1,350");
  });

  it("renders an amount discount line against the select-items span", () => {
    renderSummary({
      amount: 150000,
      deliveryFee: 0,
      discount: {
        code: "FLAT20",
        span: "selected-products",
        type: "amount",
        value: 20,
        productSkus: ["sku_1"],
      },
      items: [{ price: 1500, quantity: 1, productSkuId: "sku_1" }],
      status: "open",
    });

    // Amount discounts are stated in major units on the order but the summary
    // formats the pesewas-scaled value, so both the label and the amount read
    // 100x the entered value. Characterized as-is; changing it is out of scope.
    expect(screen.getByText("FLAT20 - GH₵2,000 off select items")).toBeVisible();
    expect(amountFor("Discounts")).toBe("GH₵2,000");
    expect(amountFor("Amount paid")).toBe("GH₵1,480");
  });

  it("renders refunded and net lines when refunds exist", () => {
    renderSummary({
      amount: 150000,
      deliveryFee: 0,
      refunds: [{ amount: 50000 }, { amount: 10000 }],
      items: [{ price: 150000, quantity: 1, productSkuId: "sku_1" }],
      status: "refunded",
    });

    expect(amountFor("Refunded")).toBe("- GH₵600");
    expect(amountFor("Net")).toBe("GH₵900");
  });

  it("omits refund lines when nothing was refunded", () => {
    renderSummary({
      amount: 150000,
      deliveryFee: 0,
      refunds: [],
      items: [{ price: 150000, quantity: 1, productSkuId: "sku_1" }],
      status: "open",
    });

    expect(screen.queryByText("Refunded")).toBeNull();
    expect(screen.queryByText("Net")).toBeNull();
  });
});
