import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Id } from "~/convex/_generated/dataModel";
import { ok } from "~/shared/commandResult";

import { ReceivingView } from "./ReceivingView";

const mockedConvex = vi.hoisted(() => ({
  receivePurchaseOrderBatch: vi.fn(),
}));

const mockedToast = vi.hoisted(() => ({
  error: vi.fn(),
  success: vi.fn(),
}));

vi.mock("convex/react", () => ({
  useMutation: () => mockedConvex.receivePurchaseOrderBatch,
}));

vi.mock("sonner", () => ({
  toast: mockedToast,
}));

describe("ReceivingView", () => {
  vi.stubGlobal("scrollTo", vi.fn());

  afterEach(() => {
    vi.restoreAllMocks();
    mockedConvex.receivePurchaseOrderBatch.mockReset();
    mockedConvex.receivePurchaseOrderBatch.mockResolvedValue(
      ok({ _id: "receiving-batch-1" }),
    );
    mockedToast.error.mockReset();
    mockedToast.success.mockReset();
  });

  it("submits a receiving batch with a generated submission key and partial quantities", async () => {
    mockedConvex.receivePurchaseOrderBatch.mockResolvedValue(
      ok({ _id: "receiving-batch-1" }),
    );
    vi.spyOn(Date, "now").mockReturnValue(1000);
    const user = userEvent.setup();

    render(
      <ReceivingView
        lineItems={[
          {
            _id: "line-item-1" as Id<"purchaseOrderLineItem">,
            description: "Curly closure (CC-18)",
            orderedQuantity: 4,
            productSkuId: "sku-1" as Id<"productSku">,
            receivedQuantity: 1,
          },
        ]}
        purchaseOrderId={"purchase-order-1" as Id<"purchaseOrder">}
        storeId={"store-1" as Id<"store">}
      />,
    );

    expect(screen.getByText("Curly closure")).toBeInTheDocument();
    expect(screen.getByText("CC-18")).toBeInTheDocument();
    expect(screen.queryByText("Curly closure (CC-18)")).not.toBeInTheDocument();
    await user.clear(
      screen.getByLabelText(/received quantity for curly closure/i),
    );
    await user.type(
      screen.getByLabelText(/received quantity for curly closure/i),
      "2",
    );
    await user.click(
      screen.getByRole("button", { name: /record receiving batch/i }),
    );

    await waitFor(() =>
      expect(mockedConvex.receivePurchaseOrderBatch).toHaveBeenCalledWith({
        lineItems: [
          {
            purchaseOrderLineItemId: "line-item-1",
            receivedQuantity: 2,
          },
        ],
        purchaseOrderId: "purchase-order-1",
        receivedByUserId: undefined,
        storeId: "store-1",
        submissionKey: "receive-purchase-order-1-rs",
      }),
    );
    await waitFor(() =>
      expect(mockedToast.success).toHaveBeenCalledWith(
        "Receiving batch recorded",
      ),
    );
  });

  it("submits only positive receiving quantities and rotates the default key", async () => {
    mockedConvex.receivePurchaseOrderBatch.mockResolvedValue(
      ok({ _id: "receiving-batch-1" }),
    );
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
      />,
    );

    await user.clear(
      screen.getByLabelText(/received quantity for body wave bundle/i),
    );
    await user.type(
      screen.getByLabelText(/received quantity for body wave bundle/i),
      "2",
    );
    await user.click(
      screen.getByRole("button", { name: /record receiving batch/i }),
    );

    await waitFor(() =>
      expect(mockedConvex.receivePurchaseOrderBatch).toHaveBeenCalledWith({
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
      }),
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
      />,
    );

    expect(
      screen.getByLabelText(/received quantity for curly closure/i),
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
      />,
    );

    expect(
      screen.getByLabelText(/received quantity for curly closure/i),
    ).toHaveValue(1);
  });

  it("updates displayed quantities to the remaining amounts after a successful receipt", async () => {
    mockedConvex.receivePurchaseOrderBatch.mockResolvedValue(
      ok({ _id: "receiving-batch-1" }),
    );
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
      />,
    );

    await user.clear(
      screen.getByLabelText(/received quantity for curly closure/i),
    );
    await user.type(
      screen.getByLabelText(/received quantity for curly closure/i),
      "2",
    );
    await user.click(
      screen.getByRole("button", { name: /record receiving batch/i }),
    );

    await waitFor(() =>
      expect(mockedConvex.receivePurchaseOrderBatch).toHaveBeenCalledWith(
        expect.objectContaining({
          lineItems: [
            {
              purchaseOrderLineItemId: "line-item-1",
              receivedQuantity: 2,
            },
          ],
        }),
      ),
    );

    await waitFor(() =>
      expect(
        screen.getByLabelText(/received quantity for curly closure/i),
      ).toHaveValue(1),
    );
  });

  it("notifies the parent after a successful receipt", async () => {
    mockedConvex.receivePurchaseOrderBatch.mockResolvedValue(
      ok({ _id: "receiving-batch-1" }),
    );
    const onReceived = vi.fn();
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
        onReceived={onReceived}
        purchaseOrderId={"purchase-order-1" as Id<"purchaseOrder">}
        storeId={"store-1" as Id<"store">}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: /record receiving batch/i }),
    );

    await waitFor(() => expect(onReceived).toHaveBeenCalledTimes(1));
  });

  it("collapses unexpected receiving failures to the shared fallback toast", async () => {
    const user = userEvent.setup();
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    mockedConvex.receivePurchaseOrderBatch.mockRejectedValueOnce(
      new Error("Leaked receiving backend detail"),
    );

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
      />,
    );

    await user.clear(
      screen.getByLabelText(/received quantity for curly closure/i),
    );
    await user.type(
      screen.getByLabelText(/received quantity for curly closure/i),
      "2",
    );
    await user.click(
      screen.getByRole("button", { name: /record receiving batch/i }),
    );

    await waitFor(() =>
      expect(mockedToast.error).toHaveBeenCalledWith("Please try again."),
    );
    expect(mockedToast.error).not.toHaveBeenCalledWith(
      "Leaked receiving backend detail",
    );

    consoleErrorSpy.mockRestore();
  });
});
