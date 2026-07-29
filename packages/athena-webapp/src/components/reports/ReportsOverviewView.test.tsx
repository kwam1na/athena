import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { ReportOverviewData } from "~/shared/reportsContract";

const useQuery = vi.fn();
vi.mock("convex/react", () => ({
  useQuery: (...args: unknown[]) => useQuery(...args),
}));
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
  it("renders all KPI and trust values from the overview fixture", () => {
    useQuery.mockReturnValue(fixture);
    render(<ReportsOverviewView />);

    // KPI cards: net sales for each snapshot.
    expect(screen.getByText("$90")).toBeInTheDocument(); // today net sales
    expect(screen.getByText("$400")).toBeInTheDocument(); // week to date net sales
    expect(screen.getByText("$2,500")).toBeInTheDocument(); // trailing 30 net sales

    // Comparison chip: +12.5% (1250 bp).
    expect(screen.getByText("+12.5%")).toBeInTheDocument();
    // Missing comparison renders "—", not a blank or throw.
    const dashes = screen.getAllByText("—");
    expect(dashes.length).toBeGreaterThan(0);

    // Trust strip.
    expect(screen.getByTestId("report-trust-strip")).toHaveTextContent("25");
    expect(screen.getByTestId("report-trust-strip")).toHaveTextContent("3");
    expect(screen.getByTestId("report-trust-strip")).toHaveTextContent("2");
    expect(screen.getByTestId("report-trust-strip")).toHaveTextContent("Jul 1, 2026");
  });

  it("renders an explicit 'profit unavailable (uncosted)' treatment for null gross profit, not a bare dash", () => {
    useQuery.mockReturnValue(fixture);
    render(<ReportsOverviewView />);

    expect(screen.getByText("profit unavailable (uncosted)")).toBeInTheDocument();
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
