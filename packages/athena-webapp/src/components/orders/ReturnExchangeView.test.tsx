import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ReturnExchangeViewContent } from "./ReturnExchangeView";

const baseOrder = {
  _creationTime: Date.now(),
  _id: "order-1",
  amount: 15_000,
  deliveryMethod: "pickup",
  orderNumber: "10001",
  refunds: [],
  status: "picked-up",
  items: [
    {
      _id: "item-1",
      isReady: true,
      isRefunded: false,
      isRestocked: false,
      price: 45,
      productId: "product-1",
      productName: "Curly Closure",
      productSku: "SKU-RETURN-1",
      productSkuId: "sku-1",
      quantity: 2,
    },
    {
      _id: "item-2",
      isReady: true,
      isRefunded: false,
      isRestocked: false,
      price: 60,
      productId: "product-2",
      productName: "Frontal Unit",
      productSku: "SKU-RETURN-2",
      productSkuId: "sku-2",
      quantity: 1,
    },
  ],
} as any;

describe("ReturnExchangeViewContent", () => {
  it("submits selected line items as a return operation from the dedicated staff view", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);

    render(
      <ReturnExchangeViewContent
        isSubmitting={false}
        onSubmit={onSubmit}
        order={baseOrder}
        pendingApprovalCount={0}
      />,
    );

    expect(
      screen.getByRole("heading", { name: /return & exchange/i }),
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole("checkbox", { name: /curly closure/i }),
    );
    await user.click(screen.getByRole("button", { name: /process return/i }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith({
      operationType: "return",
      replacementItems: [],
      restockReturnedItems: true,
      returnItemIds: ["item-1"],
    });
  });

  it("captures exchange details and sends a replacement line payload", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);

    render(
      <ReturnExchangeViewContent
        isSubmitting={false}
        onSubmit={onSubmit}
        order={baseOrder}
        pendingApprovalCount={1}
      />,
    );

    expect(screen.getByText(/1 approval pending/i)).toBeInTheDocument();

    await user.click(screen.getByRole("checkbox", { name: /frontal unit/i }));
    await user.click(screen.getByLabelText(/exchange for a new item/i));
    await user.type(screen.getByLabelText(/replacement sku id/i), "sku-9");
    await user.type(screen.getByLabelText(/replacement product id/i), "product-9");
    await user.type(screen.getByLabelText(/replacement product name/i), "Loose Wave Bundle");
    await user.clear(screen.getByLabelText(/replacement quantity/i));
    await user.type(screen.getByLabelText(/replacement quantity/i), "1");
    await user.clear(screen.getByLabelText(/replacement unit price/i));
    await user.type(screen.getByLabelText(/replacement unit price/i), "75");
    await user.click(screen.getByRole("button", { name: /process exchange/i }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith({
      operationType: "exchange",
      replacementItems: [
        {
          productId: "product-9",
          productName: "Loose Wave Bundle",
          productSkuId: "sku-9",
          quantity: 1,
          unitPrice: 7_500,
        },
      ],
      restockReturnedItems: true,
      returnItemIds: ["item-2"],
    });
  });
});
