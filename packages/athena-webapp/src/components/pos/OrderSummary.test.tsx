import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { OrderSummary } from "./OrderSummary";

vi.mock("@react-email/components", () => ({
  render: vi.fn(),
}));

vi.mock("~/src/hooks/useGetActiveStore", () => ({
  default: () => ({
    activeStore: {
      _id: "store-1",
      currency: "GHS",
      name: "Wig Club",
      config: {},
    },
  }),
}));

vi.mock("~/src/hooks/usePrint", () => ({
  usePrint: () => ({
    printReceipt: vi.fn(),
  }),
}));

describe("OrderSummary completed transaction summary", () => {
  it("does not render the tax line in the completed sale totals", () => {
    render(
      <OrderSummary
        cartItems={[]}
        completedOrderNumber="404923"
        completedTransactionData={{
          paymentMethod: "cash",
          completedAt: new Date("2026-04-25T18:08:00.000Z"),
          cartItems: [
            {
              id: "item-1",
              name: "Loose wave",
              barcode: "123456789012",
              price: 115000,
              quantity: 1,
              productId: "product-1",
              skuId: "sku-1",
            },
          ] as never,
          customerInfo: undefined,
          subtotal: 115000,
          tax: 0,
          total: 115000,
        }}
        isTransactionCompleted
        payments={[{ id: "payment-1", method: "cash", amount: 115000, timestamp: 1 }]}
        registerNumber="3"
      />,
    );

    expect(screen.getByText("Subtotal")).toBeInTheDocument();
    expect(screen.getAllByText("Total")).not.toHaveLength(0);
    expect(screen.queryByText("Tax")).not.toBeInTheDocument();
  });
});
