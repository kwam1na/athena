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

vi.mock("../../traces/WorkflowTraceRouteLink", () => ({
  WorkflowTraceRouteLink: ({
    traceId,
    children,
  }: {
    traceId: string;
    children?: React.ReactNode;
  }) => (
    <span data-testid="session-trace-link">
      {traceId}
      {children ? `:${children}` : ""}
    </span>
  ),
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
  it("renders the session trace link when the completed transaction has a session trace", () => {
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
      sessionTraceId: "pos_session:ses-001",
    });

    expect(screen.getByTestId("session-trace-link")).toHaveTextContent(
      "pos_session:ses-001:Session trace",
    );
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
      sessionTraceId: null,
    });

    expect(screen.queryByTestId("session-trace-link")).not.toBeInTheDocument();
  });
});
