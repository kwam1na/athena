import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

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
