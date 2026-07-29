import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const useQuery = vi.fn();
vi.mock("convex/react", () => ({
  useQuery: (...args: unknown[]) => useQuery(...args),
}));
vi.mock("@/hooks/useGetActiveStore", () => ({
  default: () => ({ activeStore: { _id: "store-1", currency: "USD" }, isLoadingStores: false }),
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to, ...props }: { children?: React.ReactNode; to: string }) => {
    delete (props as Record<string, unknown>).params;
    delete (props as Record<string, unknown>).search;
    return (
      <a href={to} {...props}>
        {children}
      </a>
    );
  },
  useParams: () => ({ orgUrlSlug: "acme", storeUrlSlug: "downtown" }),
}));

import { ReportDaysPanel } from "./ReportDaysPanel";

const baseProps = {
  startDate: "2026-07-15",
  endDate: "2026-07-28",
  onRangeChange: vi.fn(),
};

describe("ReportDaysPanel", () => {
  it("states a day's settlement against its close, without a status badge", () => {
    useQuery.mockReturnValue([
      {
        operatingDate: "2026-07-27",
        status: "reconciled",
        currency: "USD",
        grossSalesMinor: 1000,
        netSalesMinor: 900,
        refundsMinor: 100,
        unitsSold: 5,
        unitsReturned: 0,
        uncostedRevenueMinor: 0,
        grossProfitMinor: 300,
        paymentsCollectedMinor: 900,
        paymentsRefundedMinor: 100,
        paymentAllocatedMinor: 900,
        flags: { mixedCurrency: false, hasUncostedRevenue: false, quarantinedFactCount: 0 },
        factCount: 4,
        closeVarianceMinor: 50,
      },
    ]);

    render(<ReportDaysPanel {...baseProps} />);

    // A reconciled day that does not match its close is the case worth
    // surfacing: the amount is shown with an explanatory caption, and the
    // row is flagged for attention rather than badged "Reconciled".
    expect(screen.getByText("$0.50")).toBeInTheDocument();
    expect(screen.getByText("Over close")).toBeInTheDocument();
    expect(screen.queryByText("Reconciled")).not.toBeInTheDocument();
    expect(
      document.querySelector('[data-attention="true"]'),
    ).toBeInTheDocument();
  });

  it("leaves a day that matches its close unflagged", () => {
    useQuery.mockReturnValue([
      {
        operatingDate: "2026-07-27",
        status: "reconciled",
        currency: "USD",
        grossSalesMinor: 1000,
        netSalesMinor: 900,
        refundsMinor: 100,
        unitsSold: 5,
        unitsReturned: 0,
        uncostedRevenueMinor: 0,
        grossProfitMinor: 300,
        paymentsCollectedMinor: 900,
        paymentsRefundedMinor: 100,
        paymentAllocatedMinor: 900,
        flags: { mixedCurrency: false, hasUncostedRevenue: false, quarantinedFactCount: 0 },
        factCount: 4,
        closeVarianceMinor: 0,
      },
    ]);

    render(<ReportDaysPanel {...baseProps} />);

    expect(screen.getByText("Matches close")).toBeInTheDocument();
    expect(document.querySelector('[data-attention="true"]')).toBeNull();
  });

  it("says a provisional day is simply not closed yet", () => {
    useQuery.mockReturnValue([
      {
        operatingDate: "2026-07-27",
        status: "provisional",
        currency: "USD",
        grossSalesMinor: 1000,
        netSalesMinor: 900,
        refundsMinor: 100,
        unitsSold: 5,
        unitsReturned: 0,
        uncostedRevenueMinor: 0,
        grossProfitMinor: 300,
        paymentsCollectedMinor: 900,
        paymentsRefundedMinor: 100,
        paymentAllocatedMinor: 900,
        flags: { mixedCurrency: false, hasUncostedRevenue: false, quarantinedFactCount: 0 },
        factCount: 4,
      },
    ]);

    render(<ReportDaysPanel {...baseProps} />);

    expect(screen.getByText("Not closed yet")).toBeInTheDocument();
    expect(document.querySelector('[data-attention="true"]')).toBeNull();
  });

  it("shows a loading state while pending", () => {
    useQuery.mockReturnValue(undefined);
    render(<ReportDaysPanel {...baseProps} />);
    expect(screen.getByTestId("report-days-loading")).toBeInTheDocument();
  });
});
