import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { transactionColumns, type CompletedTransactionRow } from "./transactionColumns";

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    className,
  }: {
    children: React.ReactNode;
    className?: string;
  }) => <a className={className}>{children}</a>,
}));

vi.mock("./WorkflowTraceLink", () => ({
  WorkflowTraceLink: ({
    transactionNumber,
  }: {
    transactionNumber: string;
  }) => <span data-testid="trace-link">{transactionNumber}</span>,
}));

function renderTransactionCell(row: CompletedTransactionRow) {
  const cell = transactionColumns[0]?.cell as
    | ((args: {
        row: {
          original: CompletedTransactionRow;
          getValue: () => string;
        };
      }) => React.ReactNode)
    | undefined;

  if (!cell) {
    throw new Error("Transaction column cell renderer is not configured.");
  }

  render(
    <>{cell({
      row: {
        original: row,
        getValue: () => row.transactionNumber,
      },
    } as never)}</>,
  );
}

describe("transactionColumns", () => {
  it("renders the workflow trace link when the completed transaction has a trace", () => {
    renderTransactionCell({
      _id: "txn_1" as CompletedTransactionRow["_id"],
      transactionNumber: "POS-123456",
      formattedTotal: "GHc 10.00",
      paymentMethodLabel: "Cash",
      paymentMethod: "cash",
      cashierName: "Ada L.",
      customerName: "Walk-in",
      itemCount: 2,
      completedAt: 100,
      hasTrace: true,
    });

    expect(screen.getByTestId("trace-link")).toHaveTextContent("POS-123456");
  });

  it("hides the workflow trace link when the completed transaction does not have a trace", () => {
    renderTransactionCell({
      _id: "txn_2" as CompletedTransactionRow["_id"],
      transactionNumber: "POS-654321",
      formattedTotal: "GHc 10.00",
      paymentMethodLabel: "Cash",
      paymentMethod: "cash",
      cashierName: "Ada L.",
      customerName: "Walk-in",
      itemCount: 1,
      completedAt: 100,
      hasTrace: false,
    });

    expect(screen.queryByTestId("trace-link")).not.toBeInTheDocument();
  });
});
