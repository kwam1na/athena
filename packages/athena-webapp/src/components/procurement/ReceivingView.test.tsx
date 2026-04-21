import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Id } from "~/convex/_generated/dataModel";

import { ReceivingView } from "./ReceivingView";

const receivePurchaseOrderBatch = vi.fn().mockResolvedValue(undefined);

vi.mock("convex/react", () => ({
  useMutation: () => receivePurchaseOrderBatch,
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

describe("ReceivingView", () => {
  vi.stubGlobal("scrollTo", vi.fn());

  afterEach(() => {
    vi.restoreAllMocks();
    receivePurchaseOrderBatch.mockClear();
  });

  it("submits a receiving batch with a submission key and partial quantities", async () => {
    const user = userEvent.setup();

    render(
      <ReceivingView
        lineItems={[
          {
            _id: "line-item-1" as Id<"purchaseOrderLineItem">,
            description: "Curly closure",
            orderedQuantity: 4,
            productSkuId: "sku-1" as Id<"productSku">,
            receivedQuantity: 1,
          },
        ]}
        purchaseOrderId={"purchase-order-1" as Id<"purchaseOrder">}
        storeId={"store-1" as Id<"store">}
      />
    );

    await user.clear(screen.getByLabelText(/submission key/i));
    await user.type(screen.getByLabelText(/submission key/i), "batch-2026-04-20");
    await user.clear(
      screen.getByLabelText(/received quantity for curly closure/i)
    );
    await user.type(
      screen.getByLabelText(/received quantity for curly closure/i),
      "2"
    );
    await user.click(screen.getByRole("button", { name: /record receiving batch/i }));

    await waitFor(() =>
      expect(receivePurchaseOrderBatch).toHaveBeenCalledWith({
        lineItems: [
          {
            purchaseOrderLineItemId: "line-item-1",
            receivedQuantity: 2,
          },
        ],
        purchaseOrderId: "purchase-order-1",
        receivedByUserId: undefined,
        storeId: "store-1",
        submissionKey: "batch-2026-04-20",
      })
    );
  });

  it("submits only positive receiving quantities and rotates the default key", async () => {
    vi.spyOn(Date, "now")
      .mockReturnValueOnce(1000)
      .mockImplementation(() => 2000);

    const user = userEvent.setup();

    render(
      <ReceivingView
        lineItems={[
          {
            _id: "line-item-1" as Id<"purchaseOrderLineItem">,
            description: "Curly closure",
            orderedQuantity: 4,
            productSkuId: "sku-1" as Id<"productSku">,
            receivedQuantity: 4,
          },
          {
            _id: "line-item-2" as Id<"purchaseOrderLineItem">,
            description: "Body wave bundle",
            orderedQuantity: 3,
            productSkuId: "sku-2" as Id<"productSku">,
            receivedQuantity: 1,
          },
        ]}
        purchaseOrderId={"purchase-order-1" as Id<"purchaseOrder">}
        storeId={"store-1" as Id<"store">}
      />
    );

    await user.clear(
      screen.getByLabelText(/received quantity for body wave bundle/i)
    );
    await user.type(
      screen.getByLabelText(/received quantity for body wave bundle/i),
      "2"
    );
    await user.click(screen.getByRole("button", { name: /record receiving batch/i }));

    await waitFor(() =>
      expect(receivePurchaseOrderBatch).toHaveBeenCalledWith({
        lineItems: [
          {
            purchaseOrderLineItemId: "line-item-2",
            receivedQuantity: 2,
          },
        ],
        purchaseOrderId: "purchase-order-1",
        receivedByUserId: undefined,
        storeId: "store-1",
        submissionKey: "receive-purchase-order-1-rs",
      })
    );

    await waitFor(() =>
      expect(screen.getByLabelText(/submission key/i)).toHaveValue(
        "receive-purchase-order-1-1jk"
      )
    );
  });

  it("resets displayed quantities when line items refresh after a receipt", () => {
    const { rerender } = render(
      <ReceivingView
        lineItems={[
          {
            _id: "line-item-1" as Id<"purchaseOrderLineItem">,
            description: "Curly closure",
            orderedQuantity: 4,
            productSkuId: "sku-1" as Id<"productSku">,
            receivedQuantity: 1,
          },
        ]}
        purchaseOrderId={"purchase-order-1" as Id<"purchaseOrder">}
        storeId={"store-1" as Id<"store">}
      />
    );

    expect(
      screen.getByLabelText(/received quantity for curly closure/i)
    ).toHaveValue(3);

    rerender(
      <ReceivingView
        lineItems={[
          {
            _id: "line-item-1" as Id<"purchaseOrderLineItem">,
            description: "Curly closure",
            orderedQuantity: 4,
            productSkuId: "sku-1" as Id<"productSku">,
            receivedQuantity: 3,
          },
        ]}
        purchaseOrderId={"purchase-order-1" as Id<"purchaseOrder">}
        storeId={"store-1" as Id<"store">}
      />
    );

    expect(
      screen.getByLabelText(/received quantity for curly closure/i)
    ).toHaveValue(1);
  });

  it("updates displayed quantities to the remaining amounts after a successful receipt", async () => {
    const user = userEvent.setup();

    render(
      <ReceivingView
        lineItems={[
          {
            _id: "line-item-1" as Id<"purchaseOrderLineItem">,
            description: "Curly closure",
            orderedQuantity: 4,
            productSkuId: "sku-1" as Id<"productSku">,
            receivedQuantity: 1,
          },
        ]}
        purchaseOrderId={"purchase-order-1" as Id<"purchaseOrder">}
        storeId={"store-1" as Id<"store">}
      />
    );

    await user.clear(
      screen.getByLabelText(/received quantity for curly closure/i)
    );
    await user.type(
      screen.getByLabelText(/received quantity for curly closure/i),
      "2"
    );
    await user.click(screen.getByRole("button", { name: /record receiving batch/i }));

    await waitFor(() =>
      expect(receivePurchaseOrderBatch).toHaveBeenCalledWith(
        expect.objectContaining({
          lineItems: [
            {
              purchaseOrderLineItemId: "line-item-1",
              receivedQuantity: 2,
            },
          ],
        })
      )
    );

    await waitFor(() =>
      expect(
        screen.getByLabelText(/received quantity for curly closure/i)
      ).toHaveValue(1)
    );
  });
});
