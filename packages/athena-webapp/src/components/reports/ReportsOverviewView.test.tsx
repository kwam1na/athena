import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { ReportOverviewData } from "~/shared/reportsContract";

const useQuery = vi.fn();
vi.mock("convex/react", () => ({
  useQuery: (...args: unknown[]) => useQuery(...args),
}));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));
vi.mock("@/hooks/useGetActiveStore", () => ({
  default: () => ({ activeStore: { _id: "store-1", currency: "USD" }, isLoadingStores: false }),
}));
vi.mock("recharts", () => ({
  Area: () => null,
  AreaChart: ({ children }: { children?: React.ReactNode }) => <svg>{children}</svg>,
  CartesianGrid: () => null,
  Legend: () => null,
  ResponsiveContainer: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  Tooltip: () => null,
  XAxis: () => null,
  YAxis: () => null,
}));

import { ReportsOverviewView } from "./ReportsOverviewView";

function snapshot(overrides: Partial<ReportOverviewData["today"]> = {}) {
  return {
    grossSalesMinor: 100_00,
    netSalesMinor: 90_00,
    refundsMinor: 10_00,
    unitsSold: 12,
    unitsReturned: 1,
    uncostedRevenueMinor: 0,
    grossProfitMinor: 30_00,
    paymentsCollectedMinor: 90_00,
    paymentsRefundedMinor: 10_00,
    paymentAllocatedMinor: 90_00,
    dayCount: 1,
    unsettledDayCount: 0,
    ...overrides,
  };
}

const fixture: ReportOverviewData = {
  updatedAt: 1_700_000_000_000,
  currency: "USD",
  today: snapshot(),
  weekToDate: snapshot({ dayCount: 5, netSalesMinor: 400_00 }),
  priorWeek: snapshot({ dayCount: 7, netSalesMinor: 350_00 }),
  trailing30: snapshot({ dayCount: 30, netSalesMinor: 2500_00, grossProfitMinor: null }),
  comparisons: {
    netSalesVsPriorWeekBp: 1250,
    unitsSoldVsPriorWeekBp: null,
  },
  dailyTrend: [
    { operatingDate: "2026-07-26", netSalesMinor: 80_00, status: "reconciled" },
    { operatingDate: "2026-07-27", netSalesMinor: 90_00, status: "provisional" },
  ],
  trust: {
    reconciledDays: 25,
    provisionalDays: 3,
    amendedDays: 2,
    oldestUnreconciledDate: "2026-07-01",
  },
};

describe("ReportsOverviewView", () => {
  it("shows the selected window's KPIs and the trust strip", async () => {
    const user = userEvent.setup();
    useQuery.mockReturnValue(fixture);
    render(<ReportsOverviewView />);

    // Today is the default window: one set of metrics, not all three at once.
    expect(screen.getByText("$90")).toBeInTheDocument();
    expect(screen.queryByText("$400")).not.toBeInTheDocument();
    expect(screen.queryByText("$2,500")).not.toBeInTheDocument();

    // Trust strip is window-independent.
    expect(screen.getByTestId("report-trust-strip")).toHaveTextContent("25");
    expect(screen.getByTestId("report-trust-strip")).toHaveTextContent("3");
    expect(screen.getByTestId("report-trust-strip")).toHaveTextContent("2");
    expect(screen.getByTestId("report-trust-strip")).toHaveTextContent("Jul 1, 2026");

    await user.click(screen.getByRole("tab", { name: "Week to date" }));
    expect(screen.getByText("$400")).toBeInTheDocument();
    expect(screen.queryByText("$90")).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Trailing 30 days" }));
    expect(screen.getByText("$2,500")).toBeInTheDocument();
  });

  it("states the prior-week comparison in words rather than a bare percentage", async () => {
    const user = userEvent.setup();
    useQuery.mockReturnValue(fixture);
    render(<ReportsOverviewView />);

    await user.click(screen.getByRole("tab", { name: "Week to date" }));

    // 400 vs prior week 350 => +14%, rendered with the prior-window named.
    // Both comparable metrics (net sales, units sold) carry it.
    expect(screen.getAllByText(/prior week/i).length).toBeGreaterThan(0);
  });

  it("names an empty prior window instead of rendering -100%", async () => {
    const user = userEvent.setup();
    useQuery.mockReturnValue({
      ...fixture,
      weekToDate: snapshot({ dayCount: 1, netSalesMinor: 0, unitsSold: 0 }),
      priorWeek: snapshot({ dayCount: 7, netSalesMinor: 0, unitsSold: 0 }),
    });
    render(<ReportsOverviewView />);

    await user.click(screen.getByRole("tab", { name: "Week to date" }));

    expect(
      screen.getAllByText(/No activity for prior week/i).length,
    ).toBeGreaterThan(0);
    expect(screen.queryByText("-100.0%")).not.toBeInTheDocument();
  });

  it("explains a null gross profit in a helper line rather than the value", async () => {
    const user = userEvent.setup();
    useQuery.mockReturnValue(fixture);
    render(<ReportsOverviewView />);

    // trailing30 is the snapshot with a null gross profit.
    await user.click(screen.getByRole("tab", { name: "Trailing 30 days" }));

    expect(screen.getByText("No item cost recorded")).toBeInTheDocument();
  });

  it("shows a loading state while the query is pending", () => {
    useQuery.mockReturnValue(undefined);
    render(<ReportsOverviewView />);
    expect(screen.getByRole("status", { name: "Loading report overview" })).toBeInTheDocument();
  });

  it("shows an empty state when there is no overview document yet", () => {
    useQuery.mockReturnValue(null);
    render(<ReportsOverviewView />);
    expect(screen.getByText("No report data yet")).toBeInTheDocument();
  });
});
