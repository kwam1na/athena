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
  it("renders a status badge and close variance per day", () => {
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

    expect(screen.getByText("Reconciled")).toBeInTheDocument();
    expect(screen.getByText("$0.50")).toBeInTheDocument();
  });

  it("shows a loading state while pending", () => {
    useQuery.mockReturnValue(undefined);
    render(<ReportDaysPanel {...baseProps} />);
    expect(screen.getByTestId("report-days-loading")).toBeInTheDocument();
  });
});
