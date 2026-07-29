import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

const useQuery = vi.fn();
vi.mock("convex/react", () => ({
  useQuery: (...args: unknown[]) => useQuery(...args),
}));
vi.mock("@/hooks/useGetActiveStore", () => ({
  default: () => ({
    activeStore: { _id: "store-1", currency: "USD" },
    isLoadingStores: false,
  }),
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    ...props
  }: {
    children?: React.ReactNode;
    to: string;
  }) => {
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
  onPageChange: vi.fn(),
  page: 1,
};

describe("ReportDaysPanel", () => {
  it("paginates longer ranges in two-week slices with the shared controls", async () => {
    const user = userEvent.setup();
    const onPageChange = vi.fn();
    useQuery.mockReturnValue(
      Array.from({ length: 15 }, (_, index) => ({
        operatingDate: `2026-07-${String(index + 1).padStart(2, "0")}`,
        status: "reconciled",
        currency: "USD",
        netSalesMinor: 1000,
        unitsSold: 1,
        closeVarianceMinor: 0,
      })),
    );

    const { rerender } = render(
      <ReportDaysPanel {...baseProps} onPageChange={onPageChange} />,
    );

    expect(screen.getByText("Showing 1-14 of 15")).toBeInTheDocument();
    expect(screen.getByText("Page 1 of 2")).toBeInTheDocument();
    expect(screen.getByText("Wed, Jul 15, 2026")).toBeInTheDocument();
    expect(screen.queryByText("Wed, Jul 1, 2026")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Go to next page" }));
    expect(onPageChange).toHaveBeenCalledWith(2);

    rerender(
      <ReportDaysPanel {...baseProps} onPageChange={onPageChange} page={2} />,
    );
    expect(screen.getByText("Showing 15-15 of 15")).toBeInTheDocument();
    expect(screen.getByText("Page 2 of 2")).toBeInTheDocument();
    expect(screen.getByText("Wed, Jul 1, 2026")).toBeInTheDocument();
    expect(screen.queryByText("Wed, Jul 15, 2026")).not.toBeInTheDocument();
  });

  it("presents the filter as one date range and states the fixed table order", () => {
    useQuery.mockReturnValue([
      {
        operatingDate: "2026-07-28",
        status: "provisional",
        currency: "USD",
        netSalesMinor: 1200,
        unitsSold: 7,
      },
    ]);

    render(<ReportDaysPanel {...baseProps} />);

    expect(
      screen.getByRole("button", {
        name: "Change date range, currently Jul 15–28, 2026",
      }),
    ).toBeInTheDocument();
    expect(screen.queryByText("From")).not.toBeInTheDocument();
    expect(screen.queryByText("To")).not.toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Date" })).toHaveAttribute(
      "aria-sort",
      "descending",
    );
  });

  it("shows the most recent operating day first", () => {
    useQuery.mockReturnValue([
      {
        operatingDate: "2026-07-27",
        status: "reconciled",
        currency: "USD",
        netSalesMinor: 900,
        unitsSold: 5,
        closeVarianceMinor: 0,
      },
      {
        operatingDate: "2026-07-28",
        status: "provisional",
        currency: "USD",
        netSalesMinor: 1200,
        unitsSold: 7,
      },
    ]);

    render(<ReportDaysPanel {...baseProps} />);

    const table = screen.getByRole("table");
    const recentDay = within(table).getByText("Tue, Jul 28, 2026");
    const olderDay = within(table).getByText("Mon, Jul 27, 2026");
    expect(
      recentDay.compareDocumentPosition(olderDay) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

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
        flags: {
          mixedCurrency: false,
          hasUncostedRevenue: false,
          quarantinedFactCount: 0,
        },
        factCount: 4,
        closeVarianceMinor: 50,
      },
    ]);

    render(<ReportDaysPanel {...baseProps} />);

    expect(screen.getByText("Mon, Jul 27, 2026")).toBeInTheDocument();
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
        flags: {
          mixedCurrency: false,
          hasUncostedRevenue: false,
          quarantinedFactCount: 0,
        },
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
        flags: {
          mixedCurrency: false,
          hasUncostedRevenue: false,
          quarantinedFactCount: 0,
        },
        factCount: 4,
      },
    ]);

    render(<ReportDaysPanel {...baseProps} />);

    expect(screen.getByText("Not closed yet")).toBeInTheDocument();
    expect(document.querySelector('[data-attention="true"]')).toBeNull();
  });

  it("renders no results block until the first result settles", () => {
    // A skeleton would appear and vanish as a flash of its own on these
    // fast queries; refreshes keep prior data on screen instead.
    useQuery.mockReturnValue(undefined);
    render(<ReportDaysPanel {...baseProps} />);
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByTestId("report-days-loading")).not.toBeInTheDocument();
    // The panel's own controls stay put, so nothing jumps when data lands.
    expect(screen.getByTestId("report-days-panel")).toBeInTheDocument();
  });
});
