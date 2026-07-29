import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
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
import type { ReportOverviewWindow } from "./reportPeriodKeys";

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
  yesterday: snapshot({ netSalesMinor: 80_00, unitsSold: 8 }),
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

function renderOverview(initialWindow: ReportOverviewWindow = "today") {
  function Harness() {
    const [selectedWindow, setSelectedWindow] =
      useState<ReportOverviewWindow>(initialWindow);
    return (
      <ReportsOverviewView
        onSelectedWindowChange={setSelectedWindow}
        selectedWindow={selectedWindow}
      />
    );
  }

  return render(<Harness />);
}

describe("ReportsOverviewView", () => {
  it("discloses the overview refresh cadence and snapshot time", () => {
    useQuery.mockReturnValue(fixture);
    renderOverview();

    const freshness = screen.getByTestId("report-freshness");
    expect(freshness).toHaveTextContent(
      "Report totals update about every 5 minutes",
    );
    expect(freshness).toHaveTextContent("Last updated");
    expect(freshness.querySelector("time")).toHaveAttribute(
      "datetime",
      new Date(fixture.updatedAt).toISOString(),
    );
  });

  it("shows the selected window's KPIs and a compact reporting summary", async () => {
    const user = userEvent.setup();
    useQuery.mockReturnValue(fixture);
    renderOverview();

    // Today is the default window: one set of metrics, not all three at once.
    expect(screen.getByText("$90")).toBeInTheDocument();
    expect(screen.queryByText("$400")).not.toBeInTheDocument();
    expect(screen.queryByText("$2,500")).not.toBeInTheDocument();

    // Reporting status is window-independent and reads as one informational
    // sentence rather than four operational metric cards.
    expect(screen.getByTestId("report-trust-summary")).toHaveTextContent(
      "Last 30 days · 25 of 30 reported days reconciled · 3 awaiting reconciliation · 2 amended after close · Oldest unsettled Wed, Jul 1, 2026",
    );
    expect(
      screen.getByRole("heading", { name: "Net sales" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Net sales — last 30 days"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("+13%")).toBeInTheDocument();
    expect(screen.getByText("+50%")).toBeInTheDocument();
    expect(screen.getAllByText("vs yesterday")).toHaveLength(2);

    await user.click(screen.getByRole("tab", { name: "Week to date" }));
    expect(screen.getByText("$400")).toBeInTheDocument();
    expect(screen.queryByText("$90")).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Trailing 30 days" }));
    expect(screen.getByText("$2,500")).toBeInTheDocument();
  });

  it("describes the current open day as in progress", () => {
    useQuery.mockReturnValue({
      ...fixture,
      trailing30: snapshot({ dayCount: 28 }),
      dailyTrend: [
        ...fixture.dailyTrend,
        { operatingDate: "2026-07-29", netSalesMinor: 100_00, status: "open" },
      ],
      trust: {
        reconciledDays: 27,
        provisionalDays: 0,
        amendedDays: 0,
        oldestUnreconciledDate: "2026-07-29",
      },
    });
    renderOverview();

    expect(screen.getByTestId("report-trust-summary")).toHaveTextContent(
      "Last 30 days · 27 of 28 reported days reconciled · Today in progress",
    );
  });

  it("states the prior-week comparison in words rather than a bare percentage", async () => {
    const user = userEvent.setup();
    useQuery.mockReturnValue(fixture);
    renderOverview();

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
    renderOverview();

    await user.click(screen.getByRole("tab", { name: "Week to date" }));

    expect(
      screen.getAllByText(/No activity for prior week/i).length,
    ).toBeGreaterThan(0);
    expect(screen.queryByText("-100.0%")).not.toBeInTheDocument();
  });

  it("explains a null gross profit in a helper line rather than the value", async () => {
    const user = userEvent.setup();
    useQuery.mockReturnValue(fixture);
    renderOverview();

    // trailing30 is the snapshot with a null gross profit.
    await user.click(screen.getByRole("tab", { name: "Trailing 30 days" }));

    expect(screen.getByText("No item cost recorded")).toBeInTheDocument();
  });

  it("renders nothing until the first result settles", () => {
    useQuery.mockReturnValue(undefined);
    renderOverview();
    expect(screen.queryByTestId("reports-overview")).not.toBeInTheDocument();
  });

  it("shows an empty state when there is no overview document yet", () => {
    useQuery.mockReturnValue(null);
    renderOverview();
    expect(screen.getByText("No report data yet")).toBeInTheDocument();
  });
});
