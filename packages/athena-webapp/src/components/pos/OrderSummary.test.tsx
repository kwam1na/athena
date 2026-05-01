import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { render as renderEmail } from "@react-email/components";

import { currencyFormatter } from "~/shared/currencyFormatter";
import { OrderSummary } from "./OrderSummary";

vi.mock("@react-email/components", () => ({
  render: vi.fn().mockResolvedValue("<receipt />"),
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

const formatter = currencyFormatter("GHS");

function stripWhitespace(value: string) {
  return value.replace(/\s/g, "");
}

function getBalanceDueAmount() {
  const label = screen.getByText((content, node) => {
    return (
      node instanceof HTMLParagraphElement &&
      /^(Balance due|Change due)$/i.test(content)
    );
  });
  const panel = label.closest("div");
  const amount = Array.from(panel?.querySelectorAll("p") ?? []).find(
    (paragraph) => {
      const text = paragraph.textContent?.trim() || "";
      return !/^(Balance due|Change due)$/i.test(text);
    },
  );
  return amount?.textContent ?? "";
}

function getBalanceDueLabel() {
  return screen.getByText((content, node) => {
    return (
      node instanceof HTMLParagraphElement &&
      /^(Balance due|Change due)$/i.test(content)
    );
  });
}

function getBalanceDuePanel() {
  return getBalanceDueLabel().closest("div");
}

describe("OrderSummary completed transaction summary", () => {
  beforeEach(() => {
    vi.mocked(renderEmail).mockClear();
  });

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
        payments={[
          { id: "payment-1", method: "cash", amount: 115000, timestamp: 1 },
        ]}
        registerNumber="3"
      />,
    );

    expect(screen.getByText("Subtotal")).toBeInTheDocument();
    expect(screen.getAllByText("Total")).not.toHaveLength(0);
    expect(screen.queryByText("Tax")).not.toBeInTheDocument();
  });

  it("shows completed subtotal and total in rail summaries", () => {
    render(
      <OrderSummary
        cartItems={[]}
        completedOrderNumber="404924"
        completedTransactionData={{
          paymentMethod: "cash",
          completedAt: new Date("2026-04-25T18:08:00.000Z"),
          cartItems: [],
          customerInfo: undefined,
          subtotal: 1700,
          tax: 0,
          total: 1000,
          payments: [
            { id: "payment-1", method: "cash", amount: 1300, timestamp: 2 },
          ],
        }}
        isTransactionCompleted
        presentation="rail"
      />,
    );

    expect(screen.getByText("Amount paid")).toBeInTheDocument();
    expect(screen.getByText("Change given")).toBeInTheDocument();
    expect(screen.queryByText("Payments")).not.toBeInTheDocument();
    expect(screen.getByText("Subtotal")).toBeInTheDocument();
    expect(screen.getByText("Total")).toBeInTheDocument();
  });

  it("shows all payment methods used for a completed transaction", () => {
    render(
      <OrderSummary
        cartItems={[]}
        completedOrderNumber="404925"
        completedTransactionData={{
          paymentMethod: "cash",
          completedAt: new Date("2026-04-25T18:08:00.000Z"),
          cartItems: [],
          customerInfo: undefined,
          subtotal: 1700,
          tax: 0,
          total: 1700,
          payments: [
            { id: "payment-1", method: "cash", amount: 1000, timestamp: 1 },
            { id: "payment-2", method: "card", amount: 700, timestamp: 2 },
          ],
        }}
        isTransactionCompleted
        presentation="rail"
      />,
    );

    expect(screen.getByText("Cash Payment, Card Payment")).toBeInTheDocument();
    expect(screen.getAllByText(/Cash Payment/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Card Payment/i).length).toBeGreaterThan(0);
    expect(screen.getByText("Payments")).toBeInTheDocument();
    expect(screen.getByText("GH₵10")).toBeInTheDocument();
    expect(screen.getByText("GH₵7")).toBeInTheDocument();
  });

  it("combines repeated completed payments by method in the rail breakdown", () => {
    render(
      <OrderSummary
        cartItems={[]}
        completedOrderNumber="404926"
        completedTransactionData={{
          paymentMethod: "cash",
          completedAt: new Date("2026-04-25T18:08:00.000Z"),
          cartItems: [],
          customerInfo: undefined,
          subtotal: 1700,
          tax: 0,
          total: 1700,
          payments: [
            { id: "payment-1", method: "cash", amount: 700, timestamp: 1 },
            { id: "payment-2", method: "card", amount: 700, timestamp: 2 },
            { id: "payment-3", method: "cash", amount: 300, timestamp: 3 },
          ],
        }}
        isTransactionCompleted
        presentation="rail"
      />,
    );

    expect(screen.getByText("Payments")).toBeInTheDocument();
    expect(screen.getByText("GH₵10")).toBeInTheDocument();
    expect(screen.getByText("GH₵7")).toBeInTheDocument();
  });

  it("uses the shared currency formatter for generated receipt amounts", async () => {
    const user = userEvent.setup();

    render(
      <OrderSummary
        cartItems={[]}
        completedOrderNumber="404927"
        completedTransactionData={{
          paymentMethod: "cash",
          completedAt: new Date("2026-04-25T18:08:00.000Z"),
          cartItems: [
            {
              id: "item-1",
              name: "keyboard",
              barcode: "123456789012",
              price: 29900,
              quantity: 2,
              productId: "product-1",
              skuId: "sku-1",
            },
          ] as never,
          customerInfo: undefined,
          subtotal: 59800,
          tax: 0,
          total: 59800,
          payments: [
            { id: "payment-1", method: "cash", amount: 40000, timestamp: 1 },
            { id: "payment-2", method: "card", amount: 19800, timestamp: 2 },
          ],
        }}
        isTransactionCompleted
        presentation="rail"
      />,
    );

    await user.click(screen.getByRole("button", { name: /Print receipt/i }));

    await waitFor(() => {
      expect(renderEmail).toHaveBeenCalled();
    });

    const receiptElement = vi.mocked(renderEmail).mock.calls[0][0] as {
      props: {
        amountPaid: string;
        items: Array<{ quantityLabel: string; totalPrice: string }>;
        payments: Array<{ amount: string; method: string }>;
        subtotal: string;
        total: string;
      };
    };

    expect(receiptElement.props.subtotal).toBe("GH₵598");
    expect(receiptElement.props.total).toBe("GH₵598");
    expect(receiptElement.props.amountPaid).toBe("GH₵598");
    expect(receiptElement.props.items[0]).toMatchObject({
      quantityLabel: "2 × GH₵299",
      totalPrice: "GH₵598",
    });
    expect(receiptElement.props.payments).toEqual([
      { method: "cash", amount: "GH₵400" },
      { method: "card", amount: "GH₵198" },
    ]);
  });

  it("reflects a draft amount equal to balance due as zero remaining", async () => {
    const user = userEvent.setup();

    render(
      <OrderSummary
        cartItems={[
          {
            id: "item-1",
            name: "Hair",
            barcode: "123456789012",
            price: 1700,
            quantity: 2,
            productId: "product-1",
            skuId: "sku-1",
          } as never,
        ]}
        total={1700}
        onPaymentEntryStart={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Cash" }));

    await waitFor(() => {
      const label = getBalanceDueLabel();
      expect(label).toHaveTextContent("Balance due");
      expect(stripWhitespace(getBalanceDueAmount())).toBe(
        stripWhitespace(formatter.format(0)),
      );
    });
  });

  it.each([
    { method: "cash", label: "Cash" },
    { method: "card", label: "Card" },
    { method: "mobile_money", label: "Mobile Money" },
  ])(
    "reflects zero remaining for all payment methods when drafting exact amount ($method)",
    async ({ label }) => {
      const user = userEvent.setup();

      render(
        <OrderSummary
          cartItems={[
            {
              id: "item-1",
              name: "Hair",
              barcode: "123456789012",
              price: 1700,
              quantity: 2,
              productId: "product-1",
              skuId: "sku-1",
            } as never,
          ]}
          total={1700}
          onPaymentEntryStart={vi.fn()}
        />,
      );

      await user.click(screen.getByRole("button", { name: label }));

      await waitFor(() => {
        const balanceDueLabel = getBalanceDueLabel();
        expect(balanceDueLabel).toHaveTextContent("Balance due");
        expect(stripWhitespace(getBalanceDueAmount())).toBe(
          stripWhitespace(formatter.format(0)),
        );
      });
    },
  );

  it("uses transaction signal classes for the balance due panel and cash action", () => {
    render(
      <OrderSummary
        cartItems={[
          {
            id: "item-1",
            name: "Hair",
            barcode: "123456789012",
            price: 1700,
            quantity: 1,
            productId: "product-1",
            skuId: "sku-1",
          } as never,
        ]}
        total={1700}
      />,
    );

    expect(getBalanceDuePanel()).toHaveClass(
      "border-transaction-signal/20",
      "bg-transaction-signal/5",
    );
    expect(screen.getByRole("button", { name: "Cash" })).toHaveClass(
      "bg-transaction-signal",
      "text-transaction-signal-foreground",
    );
  });

  it("switches to change due when draft cash amount exceeds balance", async () => {
    const user = userEvent.setup();

    render(
      <OrderSummary
        cartItems={[
          {
            id: "item-1",
            name: "Hair",
            barcode: "123456789012",
            price: 1700,
            quantity: 2,
            productId: "product-1",
            skuId: "sku-1",
          } as never,
        ]}
        total={1700}
        onPaymentEntryStart={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Cash" }));

    const amountInput = await screen.findByRole("textbox");
    fireEvent.change(amountInput, { target: { value: "20" } });

    await waitFor(() => {
      const label = getBalanceDueLabel();
      expect(label).toHaveTextContent("Change due");
      expect(stripWhitespace(getBalanceDueAmount())).toBe(
        stripWhitespace(formatter.format(300 / 100)),
      );
    });
  });

  it("resets the cash draft when the method is cancelled and reopened", async () => {
    const user = userEvent.setup();

    render(
      <OrderSummary
        cartItems={[
          {
            id: "item-1",
            name: "Hair",
            barcode: "123456789012",
            price: 1700,
            quantity: 2,
            productId: "product-1",
            skuId: "sku-1",
          } as never,
        ]}
        total={1700}
        onPaymentEntryStart={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Cash" }));

    const amountInput = await screen.findByRole("textbox");
    fireEvent.change(amountInput, { target: { value: "10" } });

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Add Payment" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Cancel" }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Complete Sale" }),
      ).not.toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.click(screen.getByRole("button", { name: "Cash" }));

    await waitFor(() => {
      const label = getBalanceDueLabel();
      expect(label).toHaveTextContent("Balance due");
      expect(stripWhitespace(getBalanceDueAmount())).toBe(
        stripWhitespace(formatter.format(0)),
      );
    });
  });

  it("switches the payments summary to change due when a new cash entry would overpay", async () => {
    const user = userEvent.setup();

    render(
      <OrderSummary
        cartItems={[
          {
            id: "item-1",
            name: "Hair",
            barcode: "123456789012",
            price: 1700,
            quantity: 1,
            productId: "product-1",
            skuId: "sku-1",
          } as never,
        ]}
        total={1700}
        payments={[
          {
            id: "payment-1",
            amount: 800,
            method: "cash",
            timestamp: 1,
          },
          {
            id: "payment-2",
            amount: 660,
            method: "card",
            timestamp: 2,
          },
        ]}
        onPaymentEntryStart={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Cash" }));

    const amountInput = await screen.findByRole("textbox");
    fireEvent.change(amountInput, { target: { value: "3" } });

    await waitFor(() => {
      const label = getBalanceDueLabel();
      expect(label).toHaveTextContent("Change due");
      expect(stripWhitespace(getBalanceDueAmount())).toBe(
        stripWhitespace(formatter.format(60 / 100)),
      );
    });
  });

  it("keeps balance due at zero when existing payments plus exact cash entry clear the remaining", async () => {
    const user = userEvent.setup();

    render(
      <OrderSummary
        cartItems={[
          {
            id: "item-1",
            name: "Hair",
            barcode: "123456789012",
            price: 1700,
            quantity: 1,
            productId: "product-1",
            skuId: "sku-1",
          } as never,
        ]}
        total={1700}
        payments={[
          {
            id: "payment-1",
            amount: 1450,
            method: "card",
            timestamp: 1,
          },
        ]}
        onPaymentEntryStart={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Cash" }));

    await waitFor(() => {
      const label = getBalanceDueLabel();
      expect(label).toHaveTextContent("Balance due");
      expect(stripWhitespace(getBalanceDueAmount())).toBe(
        stripWhitespace(formatter.format(0)),
      );
    });
  });

  it("updates balance due while drafting a card payment", async () => {
    const user = userEvent.setup();

    render(
      <OrderSummary
        cartItems={[
          {
            id: "item-1",
            name: "Hair",
            barcode: "123456789012",
            price: 130,
            quantity: 1,
            productId: "product-1",
            skuId: "sku-1",
          } as never,
        ]}
        total={130}
        payments={[
          {
            id: "payment-1",
            amount: 50,
            method: "cash",
            timestamp: 1,
          },
        ]}
        onPaymentEntryStart={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Card" }));

    const amountInput = await screen.findByRole("textbox");
    fireEvent.change(amountInput, { target: { value: "0.5" } });

    await waitFor(() => {
      const label = getBalanceDueLabel();
      expect(label).toHaveTextContent("Balance due");
      expect(stripWhitespace(getBalanceDueAmount())).toBe(
        stripWhitespace(formatter.format(30 / 100)),
      );
    });
  });

  it("updates balance due while drafting a mobile money payment", async () => {
    const user = userEvent.setup();

    render(
      <OrderSummary
        cartItems={[
          {
            id: "item-1",
            name: "Hair",
            barcode: "123456789012",
            price: 130,
            quantity: 1,
            productId: "product-1",
            skuId: "sku-1",
          } as never,
        ]}
        total={130}
        payments={[
          {
            id: "payment-1",
            amount: 50,
            method: "cash",
            timestamp: 1,
          },
        ]}
        onPaymentEntryStart={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Mobile Money" }));

    const amountInput = await screen.findByRole("textbox");
    fireEvent.change(amountInput, { target: { value: "0.5" } });

    await waitFor(() => {
      const label = getBalanceDueLabel();
      expect(label).toHaveTextContent("Balance due");
      expect(stripWhitespace(getBalanceDueAmount())).toBe(
        stripWhitespace(formatter.format(30 / 100)),
      );
    });
  });
});
