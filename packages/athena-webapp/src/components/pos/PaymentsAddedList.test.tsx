import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { PaymentsAddedList } from "./PaymentsAddedList";
import type { Payment } from "./types";

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "GHS",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

function stripWhitespace(value: string) {
  return value.replace(/\s/g, "");
}

function getSummaryLabel() {
  return screen.getByText((content, node) => {
    return (
      node instanceof HTMLParagraphElement &&
      /^(Balance due|Change due)$/i.test(content)
    );
  });
}

function getSummaryAmount() {
  const label = getSummaryLabel();
  const panel = label.closest("div");
  const summaryAmount = Array.from(panel?.querySelectorAll("p") ?? []).find(
    (paragraph) => {
      const text = paragraph.textContent?.trim() || "";
      return !/^(Balance due|Change due)$/i.test(text);
    },
  );

  return summaryAmount?.textContent ?? "";
}

function getSummaryPanel() {
  const label = getSummaryLabel();
  return label.closest(".rounded-xl");
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });

  return { promise, resolve };
}

describe("PaymentsAddedList", () => {
  const basePayments: Payment[] = [
    {
      id: "payment-1",
      amount: 800,
      method: "cash",
      timestamp: 1,
    },
  ];

  it.each([
    { method: "cash" as const },
    { method: "card" as const },
    { method: "mobile_money" as const },
  ])(
    "projects exact remaining as zero balance for all selected payment methods ($method)",
    ({ method }) => {
      render(
        <PaymentsAddedList
          payments={basePayments}
          formatter={currencyFormatter}
          totalAmountDue={1700}
          balanceDue={900}
          selectedPaymentMethod={method}
          paymentAmountDraft={900}
        />,
      );

      const label = getSummaryLabel();
      expect(label).toHaveTextContent("Balance due");
      expect(stripWhitespace(getSummaryAmount())).toBe(
        stripWhitespace(currencyFormatter.format(0)),
      );
      expect(getSummaryPanel()).toHaveClass(
        "border-signal/20",
        "bg-signal/5",
      );
      expect(label).toHaveClass("text-signal");
    },
  );

  it("keeps payment edit controls open when a durable edit save fails", async () => {
    const user = userEvent.setup();
    const onUpdatePayment = vi.fn().mockResolvedValue(false);

    render(
      <PaymentsAddedList
        payments={basePayments}
        formatter={currencyFormatter}
        totalAmountDue={800}
        balanceDue={0}
        onUpdatePayment={onUpdatePayment}
      />,
    );

    await user.click(screen.getByRole("button", { name: /show payments/i }));
    await user.click(screen.getByRole("button", { name: /edit/i }));
    await user.click(screen.getByRole("button", { name: /save/i }));

    expect(onUpdatePayment).toHaveBeenCalledWith("payment-1", 800);
    expect(screen.getByText("Edit payment")).toBeInTheDocument();
  });

  it("clears payment edit controls after an async durable edit save succeeds", async () => {
    const user = userEvent.setup();
    const saved = deferred<boolean>();
    const onUpdatePayment = vi.fn(() => saved.promise);

    render(
      <PaymentsAddedList
        payments={basePayments}
        formatter={currencyFormatter}
        totalAmountDue={800}
        balanceDue={0}
        onUpdatePayment={onUpdatePayment}
      />,
    );

    await user.click(screen.getByRole("button", { name: /show payments/i }));
    await user.click(screen.getByRole("button", { name: /edit/i }));
    await user.click(screen.getByRole("button", { name: /save/i }));

    expect(screen.getByText("Edit payment")).toBeInTheDocument();
    saved.resolve(true);
    await waitFor(() => {
      expect(screen.queryByText("Edit payment")).not.toBeInTheDocument();
    });
  });

  it("keeps expanded payment controls when clearing payments fails locally", async () => {
    const user = userEvent.setup();
    const onClearPayments = vi.fn().mockResolvedValue(false);

    render(
      <PaymentsAddedList
        payments={basePayments}
        formatter={currencyFormatter}
        totalAmountDue={800}
        balanceDue={0}
        onClearPayments={onClearPayments}
      />,
    );

    await user.click(screen.getByRole("button", { name: /show payments/i }));
    await user.click(screen.getByRole("button", { name: /clear all/i }));

    expect(onClearPayments).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /clear all/i })).toBeInTheDocument();
  });

  it("collapses expanded payment controls after clearing payments succeeds", async () => {
    const user = userEvent.setup();
    const saved = deferred<boolean>();
    const onClearPayments = vi.fn(() => saved.promise);

    render(
      <PaymentsAddedList
        payments={basePayments}
        formatter={currencyFormatter}
        totalAmountDue={800}
        balanceDue={0}
        onClearPayments={onClearPayments}
      />,
    );

    await user.click(screen.getByRole("button", { name: /show payments/i }));
    await user.click(screen.getByRole("button", { name: /clear all/i }));

    expect(screen.getByRole("button", { name: /clear all/i })).toBeInTheDocument();
    saved.resolve(true);
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /clear all/i })).not.toBeInTheDocument();
    });
  });

  it("keeps expanded payment controls when removing the last payment fails locally", async () => {
    const user = userEvent.setup();
    const onRemovePayment = vi.fn().mockResolvedValue(false);

    render(
      <PaymentsAddedList
        payments={basePayments}
        formatter={currencyFormatter}
        totalAmountDue={800}
        balanceDue={0}
        onRemovePayment={onRemovePayment}
      />,
    );

    await user.click(screen.getByRole("button", { name: /show payments/i }));
    await user.click(screen.getByRole("button", { name: /remove cash payment/i }));

    expect(onRemovePayment).toHaveBeenCalledWith("payment-1");
    expect(screen.getByRole("button", { name: /remove cash payment/i })).toBeInTheDocument();
  });

  it("collapses expanded payment controls after removing the last payment succeeds", async () => {
    const user = userEvent.setup();
    const saved = deferred<boolean>();
    const onRemovePayment = vi.fn(() => saved.promise);

    render(
      <PaymentsAddedList
        payments={basePayments}
        formatter={currencyFormatter}
        totalAmountDue={800}
        balanceDue={0}
        onRemovePayment={onRemovePayment}
      />,
    );

    await user.click(screen.getByRole("button", { name: /show payments/i }));
    await user.click(screen.getByRole("button", { name: /remove cash payment/i }));

    expect(screen.getByRole("button", { name: /remove cash payment/i })).toBeInTheDocument();
    saved.resolve(true);
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /remove cash payment/i })).not.toBeInTheDocument();
    });
  });

  it.each([
    { method: "cash" as const, expected: 100 },
    { method: "card" as const, expected: 100 },
    { method: "mobile_money" as const, expected: 100 },
  ])(
    "projects change due regardless of payment method when draft exceeds remaining ($method)",
    ({ method, expected }) => {
      render(
        <PaymentsAddedList
          payments={basePayments}
          formatter={currencyFormatter}
          totalAmountDue={1700}
          balanceDue={900}
          selectedPaymentMethod={method}
          paymentAmountDraft={1000}
        />,
      );

      const label = getSummaryLabel();
      expect(label).toHaveTextContent("Change due");
      expect(stripWhitespace(getSummaryAmount())).toBe(
        stripWhitespace(currencyFormatter.format(expected / 100)),
      );
    },
  );
});
