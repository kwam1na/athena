import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Characterization coverage for the money lines the order summary renders.
// The component reads stored pesewas and formats major units, so it is the
// closest thing to a contract test for the currency helpers it imports.
const useOnlineOrderMock = vi.fn();
const getActiveStoreMock = vi.fn();

vi.mock("~/src/contexts/OnlineOrderContext", () => ({
  useOnlineOrder: () => useOnlineOrderMock(),
}));

vi.mock("~/src/hooks/useGetActiveStore", () => ({
  default: () => getActiveStoreMock(),
}));

import { getDiscountValue as sharedGetDiscountValue } from "~/shared/orderMath";
import { toDisplayAmount } from "~/shared/currency";
import { currencyFormatter } from "~/src/lib/utils";

import { OrderSummary } from "./OrderSummary";

type TestOrder = Record<string, unknown>;

function renderSummary(order: TestOrder | null) {
  useOnlineOrderMock.mockReturnValue({ order });
  getActiveStoreMock.mockReturnValue({
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
    getActiveStoreMock.mockReset();
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
      items: [{ price: 150000, quantity: 1, productSkuId: "sku_1" }],
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
        value: 2000,
        productSkus: ["sku_1"],
      },
      items: [{ price: 150000, quantity: 1, productSkuId: "sku_1" }],
      status: "open",
    });

    // An operator who enters a GH₵20 flat discount stores 2000 pesewas. The
    // label, the discount line, and the amount paid all read that one stored
    // figure back through a single minor-unit conversion.
    expect(screen.getByText("FLAT20 - GH₵20 off select items")).toBeVisible();
    expect(amountFor("Discounts")).toBe("GH₵20");
    expect(amountFor("Amount paid")).toBe("GH₵1,480");
  });

  it("renders an entire-order amount discount unscaled", () => {
    renderSummary({
      amount: 150000,
      deliveryFee: 0,
      discount: {
        code: "FLAT20",
        span: "entire-order",
        type: "amount",
        value: 2000,
      },
      items: [{ price: 150000, quantity: 1, productSkuId: "sku_1" }],
      status: "open",
    });

    expect(screen.getByText("FLAT20 - GH₵20 off entire order")).toBeVisible();
    expect(amountFor("Discounts")).toBe("GH₵20");
    expect(amountFor("Amount paid")).toBe("GH₵1,480");
  });

  it("keeps the amount discount label, line, and total in agreement", () => {
    const order = {
      amount: 150000,
      deliveryFee: 3500,
      discount: {
        code: "FLAT20",
        span: "entire-order",
        type: "amount",
        value: 2000,
      },
      items: [{ price: 150000, quantity: 1, productSkuId: "sku_1" }],
      status: "open",
    };

    renderSummary(order);

    const labelled = screen
      .getByText(/^FLAT20 - /)
      .textContent?.replace(/^FLAT20 - /, "")
      .replace(/ off .*$/, "");

    expect(labelled).toBe("GH₵20");
    expect(amountFor("Discounts")).toBe(labelled);
    // 1,500 subtotal + 35 delivery - 20 discount.
    expect(amountFor("Amount paid")).toBe("GH₵1,515");
  });

  it("renders a zero amount discount without inflating it", () => {
    renderSummary({
      amount: 150000,
      deliveryFee: 0,
      discount: {
        code: "FLAT0",
        span: "entire-order",
        type: "amount",
        value: 0,
      },
      items: [{ price: 150000, quantity: 1, productSkuId: "sku_1" }],
      status: "open",
    });

    expect(screen.getByText("FLAT0 - GH₵0 off entire order")).toBeVisible();
    expect(amountFor("Discounts")).toBe("GH₵0");
    expect(amountFor("Amount paid")).toBe("GH₵1,500");
  });

  it("renders an amount discount carrying sub-cedi precision", () => {
    renderSummary({
      amount: 150000,
      deliveryFee: 0,
      discount: {
        code: "FLAT1550",
        span: "entire-order",
        type: "amount",
        value: 1550,
      },
      items: [{ price: 150000, quantity: 1, productSkuId: "sku_1" }],
      status: "open",
    });

    // The shared formatter drops trailing zeros, so 1,550 pesewas reads
    // "GH₵15.5" — sub-cedi precision survives instead of being rounded away.
    expect(
      screen.getByText("FLAT1550 - GH₵15.5 off entire order"),
    ).toBeVisible();
    expect(amountFor("Discounts")).toBe("GH₵15.5");
    expect(amountFor("Amount paid")).toBe("GH₵1,484.5");
  });

  it("clamps a select-items amount discount to the eligible subtotal", () => {
    renderSummary({
      amount: 150000,
      deliveryFee: 0,
      discount: {
        code: "FLATMAX",
        span: "selected-products",
        type: "amount",
        value: 200000,
        productSkus: ["sku_1"],
      },
      items: [{ price: 150000, quantity: 1, productSkuId: "sku_1" }],
      status: "open",
    });

    expect(
      screen.getByText("FLATMAX - GH₵1,500 off select items"),
    ).toBeVisible();
    expect(amountFor("Discounts")).toBe("GH₵1,500");
    expect(amountFor("Amount paid")).toBe("GH₵0");
  });

  it("renders the same discount figure the shared order math authority computes", () => {
    const order = {
      amount: 150000,
      deliveryFee: 0,
      discount: {
        code: "FLAT20",
        span: "selected-products" as const,
        type: "amount" as const,
        value: 2000,
        productSkus: ["sku_1"],
      },
      items: [{ price: 150000, quantity: 1, productSkuId: "sku_1" }],
      status: "open",
    };

    renderSummary(order);

    // Emails, the storefront order views, and the checkout session panel all
    // render this same authority, so the operator summary has to match it.
    const shared = sharedGetDiscountValue(order.items, order.discount);

    expect(amountFor("Discounts")).toBe(
      currencyFormatter("GHS").format(toDisplayAmount(shared)),
    );
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
