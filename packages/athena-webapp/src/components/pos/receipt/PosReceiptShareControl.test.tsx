import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PosReceiptShareControl } from "./PosReceiptShareControl";

const sendReceiptLinkMock = vi.fn();
const toastSuccessMock = vi.fn();

vi.mock("convex/react", () => ({
  useAction: () => sendReceiptLinkMock,
}));

vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccessMock(...args),
  },
}));

describe("PosReceiptShareControl", () => {
  beforeEach(() => {
    sendReceiptLinkMock.mockReset();
    sendReceiptLinkMock.mockResolvedValue({
      kind: "ok",
      data: {
        deliveryId: "delivery_1",
        status: "sent",
      },
    });
    toastSuccessMock.mockReset();
  });

  it("sends the receipt link to the entered WhatsApp number", async () => {
    const user = userEvent.setup();

    render(
      <PosReceiptShareControl
        messaging={{
          customerPhone: "0240000000",
          transactionId: "txn_1",
          transactionNumber: "POS-123456",
        }}
      />,
    );

    await user.clear(screen.getByLabelText("Customer WhatsApp number"));
    await user.type(
      screen.getByLabelText("Customer WhatsApp number"),
      "0550000000",
    );
    await user.click(screen.getByRole("button", { name: "Send link" }));

    await waitFor(() => {
      expect(sendReceiptLinkMock).toHaveBeenCalledWith({
        recipientPhone: "0550000000",
        transactionId: "txn_1",
      });
    });
    expect(toastSuccessMock).toHaveBeenCalledWith("Receipt link sent.");
  });

  it("shows the latest delivery attempt and exposes resend", () => {
    render(
      <PosReceiptShareControl
        messaging={{
          customerPhone: "0240000000",
          deliveryHistory: [
            {
              _id: "delivery_old",
              createdAt: 100,
              recipientDisplay: "0240000000",
              status: "sent",
            },
            {
              _id: "delivery_new",
              createdAt: 200,
              failureMessage: "Provider unavailable.",
              recipientDisplay: "0241111111",
              status: "failed",
            },
          ],
          transactionId: "txn_1",
          transactionNumber: "POS-123456",
        }}
      />,
    );

    expect(screen.getAllByText("Failed")).not.toHaveLength(0);
    expect(screen.getByText("0241111111")).toBeInTheDocument();
    expect(screen.getByText("Provider unavailable.")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Resend link" }),
    ).toBeInTheDocument();
  });
});
