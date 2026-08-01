import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ReportOverviewData } from "~/shared/reportsContract";

const useQuery = vi.fn();
const navigate = vi.fn();
vi.mock("convex/react", () => ({
  useQuery: (...args: unknown[]) => useQuery(...args),
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    params,
    search,
    to,
    ...props
  }: {
    children?: React.ReactNode;
    params?: Record<string, string>;
    search?: Record<string, string>;
    to: string;
  }) => (
    <a
      data-params={JSON.stringify(params)}
      data-search={JSON.stringify(search)}
      href={to}
      {...props}
    >
      {children}
    </a>
  ),
  useNavigate: () => navigate,
  useParams: () => ({ orgUrlSlug: "wigclub", storeUrlSlug: "wigclub" }),
}));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));
vi.mock("@/hooks/useGetActiveStore", () => ({
  default: () => ({
    activeStore: { _id: "store-1", currency: "USD" },
    isLoadingStores: false,
  }),
}));
vi.mock("recharts", () => ({
  Area: ({
    activeDot,
  }: {
    activeDot?: (props: Record<string, unknown>) => React.ReactNode;
  }) =>
    typeof activeDot === "function"
      ? activeDot({
          cx: 20,
          cy: 20,
          payload: {
            axisLabel: "Mon, Jul 27",
            chartIndex: 1,
            label: "Mon, Jul 27, 2026",
            netSalesMinor: 90_00,
            operatingDate: "2026-07-27",
            status: "provisional",
            unitsSold: 9,
          },
        })
      : null,
  AreaChart: ({ children }: { children?: React.ReactNode }) => (
    <svg>{children}</svg>
  ),
  CartesianGrid: () => null,
  Legend: () => null,
  ResponsiveContainer: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
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
  trailing30: snapshot({
    dayCount: 30,
    netSalesMinor: 2500_00,
    grossProfitMinor: null,
  }),
  priorTrailing30: snapshot({
    dayCount: 30,
    netSalesMinor: 2000_00,
    unitsSold: 10,
    grossProfitMinor: 700_00,
    refundsMinor: 5_00,
  }),
  trailing3Months: snapshot({ dayCount: 82, netSalesMinor: 7000_00 }),
  priorTrailing3Months: snapshot({
    dayCount: 92,
    netSalesMinor: 6000_00,
    unitsSold: 10,
    grossProfitMinor: 20_00,
    refundsMinor: 5_00,
  }),
  comparisons: {
    netSalesVsPriorWeekBp: 1250,
    unitsSoldVsPriorWeekBp: null,
  },
  dailyTrend: [
    { operatingDate: "2026-07-26", netSalesMinor: 80_00, status: "reconciled" },
    {
      operatingDate: "2026-07-27",
      netSalesMinor: 90_00,
      status: "provisional",
    },
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
  beforeEach(() => {
    navigate.mockReset();
  });

  it("opens a selected chart day in the item sales workspace", async () => {
    const user = userEvent.setup();
    useQuery.mockReturnValue(fixture);
    renderOverview();

    await user.click(
      screen.getByRole("link", {
        name: "View item sales for Mon, Jul 27, 2026",
      }),
    );

    expect(navigate).toHaveBeenCalledWith({
      params: {
        orgUrlSlug: "wigclub",
        storeUrlSlug: "wigclub",
      },
      search: {
        o: expect.any(String),
        periodDate: "2026-07-27",
        periodType: "day",
      },
      to: "/$orgUrlSlug/store/$storeUrlSlug/reports/items",
    });
  });

  it("discloses the overview processing delay and snapshot time", () => {
    useQuery.mockReturnValue(fixture);
    renderOverview();

    const freshness = screen.getByTestId("report-freshness");
    expect(freshness).toHaveTextContent(
      "Day totals update first. Overview data may take about 5 minutes to catch up.",
    );
    expect(freshness).not.toHaveTextContent(
      "New activity may take about 5 minutes to appear",
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

    const transactionsLink = screen.getByRole("link", {
      name: "Open transactions",
    });
    expect(JSON.parse(transactionsLink.dataset.search ?? "{}")).toEqual({
      endDate: "2026-07-27",
      o: expect.any(String),
      order: "oldestFirst",
      startDate: "2026-07-27",
    });
    expect(JSON.parse(transactionsLink.dataset.params ?? "{}")).toEqual({
      orgUrlSlug: "wigclub",
      storeUrlSlug: "wigclub",
    });

    // Reporting status is window-independent and belongs to the fixed
    // 30-day trend heading, not the selectable KPI window above it.
    const trendHeading = screen.getByRole("heading", { name: "Net sales" });
    const trustSummary = screen.getByTestId("report-trust-summary");
    expect(trustSummary).toHaveTextContent(
      "30-day trend · 25 of 30 reported days reconciled · 3 awaiting reconciliation · 2 amended after close · Oldest unsettled Wed, Jul 1, 2026",
    );
    expect(trendHeading.parentElement).toContainElement(trustSummary);
    expect(
      screen.queryByText("Net sales — last 30 days"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("+13%")).toBeInTheDocument();
    expect(screen.getByText("+50%")).toBeInTheDocument();
    expect(screen.getAllByText("vs yesterday")).toHaveLength(4);

    await user.click(screen.getByRole("tab", { name: "Week to date" }));
    expect(screen.getByText("$400")).toBeInTheDocument();
    expect(screen.queryByText("$90")).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Trailing 30 days" }));
    expect(screen.getByText("$2,500")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Trailing 3 months" }));
    expect(screen.getByText("$7,000")).toBeInTheDocument();
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
      "30-day trend · 27 of 28 reported days reconciled · Today in progress",
    );
    expect(screen.getByTestId("report-period-status")).toHaveTextContent(
      "In progress",
    );
    const dailyOperationsLink = screen.getByRole("link", {
      name: "View Daily Operations",
    });
    expect(dailyOperationsLink).toHaveAttribute(
      "href",
      "/$orgUrlSlug/store/$storeUrlSlug/operations",
    );
    expect(JSON.parse(dailyOperationsLink.dataset.params ?? "{}")).toEqual({
      orgUrlSlug: "wigclub",
      storeUrlSlug: "wigclub",
    });
    expect(JSON.parse(dailyOperationsLink.dataset.search ?? "{}")).toEqual({
      o: expect.any(String),
      operatingDate: "2026-07-29",
    });
    expect(
      dailyOperationsLink.closest('[data-motion="period-status"]'),
    ).not.toBeNull();
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

  it("animates every metric value and comparison across every overview period", async () => {
    const user = userEvent.setup();
    useQuery.mockReturnValue({
      ...fixture,
      trailing30: snapshot({
        dayCount: 30,
        netSalesMinor: 2500_00,
        grossProfitMinor: 900_00,
      }),
    });
    renderOverview();

    const metricLabels = ["Net sales", "Units sold", "Gross profit", "Refunds"];
    const expectAnimatedMetrics = (comparisonLabel: string) => {
      for (const label of metricLabels) {
        const metricLabel = screen
          .getAllByText(label)
          .find((element) => element.tagName === "P");
        const card = metricLabel?.closest("div.rounded-lg");
        expect(card?.querySelector('[data-motion="flip"]')).not.toBeNull();
        expect(
          card?.querySelector('[data-motion="comparison-crossfade"]'),
        ).not.toBeNull();
      }
      expect(
        screen.getAllByText(new RegExp(comparisonLabel, "i")),
      ).toHaveLength(4);
    };

    expectAnimatedMetrics("yesterday");

    await user.click(screen.getByRole("tab", { name: "Week to date" }));
    expectAnimatedMetrics("prior week");

    await user.click(screen.getByRole("tab", { name: "Trailing 30 days" }));
    expectAnimatedMetrics("previous 30 days");

    await user.click(screen.getByRole("tab", { name: "Trailing 3 months" }));
    expectAnimatedMetrics("previous 3 months");
  });

  it("presents unsettled reporting state once at the period level", async () => {
    const user = userEvent.setup();
    useQuery.mockReturnValue({
      ...fixture,
      today: snapshot({ unsettledDayCount: 1 }),
      weekToDate: snapshot({ dayCount: 5, unsettledDayCount: 1 }),
    });
    renderOverview();

    expect(screen.getByTestId("report-period-status")).toHaveTextContent(
      "In progress",
    );
    expect(screen.getByTestId("report-period-status")).not.toHaveTextContent(
      "Today",
    );
    expect(screen.queryByText(/day\\(s\\) unsettled/i)).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Week to date" }));

    expect(screen.getByTestId("report-period-status")).toHaveTextContent(
      "1 of 5 reported days awaiting reconciliation",
    );
    expect(screen.queryByText(/day\\(s\\) unsettled/i)).not.toBeInTheDocument();
  });

  it("links a closed current operating day to its EOD Review", async () => {
    const user = userEvent.setup();
    useQuery.mockReturnValue({
      ...fixture,
      dailyTrend: [
        ...fixture.dailyTrend,
        {
          operatingDate: "2026-07-30",
          netSalesMinor: 100_00,
          status: "reconciled",
        },
      ],
    });
    renderOverview();

    expect(screen.getByTestId("report-period-status")).toHaveTextContent(
      "Closed",
    );
    const eodReviewLink = screen.getByRole("link", {
      name: "View EOD Review",
    });
    expect(eodReviewLink).toHaveAttribute(
      "href",
      "/$orgUrlSlug/store/$storeUrlSlug/operations/daily-close",
    );
    expect(JSON.parse(eodReviewLink.dataset.params ?? "{}")).toEqual({
      orgUrlSlug: "wigclub",
      storeUrlSlug: "wigclub",
    });
    expect(JSON.parse(eodReviewLink.dataset.search ?? "{}")).toEqual({
      o: expect.any(String),
      operatingDate: "2026-07-30",
    });
    expect(
      screen.getByTestId("report-period-status-transition"),
    ).toHaveAttribute("data-motion", "height");
    expect(
      eodReviewLink.closest('[data-motion="period-status"]'),
    ).not.toBeNull();
    expect(
      screen.queryByRole("link", { name: "View Daily Operations" }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Week to date" }));
    await waitFor(() =>
      expect(
        screen.queryByRole("link", { name: "View EOD Review" }),
      ).not.toBeInTheDocument(),
    );

    await user.click(screen.getByRole("tab", { name: "Today" }));
    await waitFor(() =>
      expect(
        screen.getByRole("link", { name: "View EOD Review" }),
      ).toBeInTheDocument(),
    );
    expect(
      screen
        .getByRole("link", { name: "View EOD Review" })
        .closest('[data-motion="period-status"]'),
    ).not.toBeNull();
  });

  it("links each overview window to transactions from that period's start date", async () => {
    const user = userEvent.setup();
    useQuery.mockReturnValue({
      ...fixture,
      dailyTrend: [
        ...fixture.dailyTrend,
        {
          operatingDate: "2026-07-30",
          netSalesMinor: 100_00,
          status: "open",
        },
      ],
    });
    renderOverview();

    const linkedRange = () => {
      const link = screen.getByRole("link", { name: "Open transactions" });
      const { endDate, order, startDate } = JSON.parse(
        link.dataset.search ?? "{}",
      );
      return { endDate, order, startDate };
    };

    expect(linkedRange()).toEqual({
      endDate: "2026-07-30",
      order: undefined,
      startDate: "2026-07-30",
    });
    expect(
      JSON.parse(
        screen.getByRole("link", { name: "Open transactions" }).dataset
          .search ?? "{}",
      ),
    ).not.toHaveProperty("order");

    await user.click(screen.getByRole("tab", { name: "Week to date" }));
    expect(linkedRange()).toEqual({
      endDate: "2026-07-30",
      order: "oldestFirst",
      startDate: "2026-07-27",
    });

    await user.click(screen.getByRole("tab", { name: "Trailing 30 days" }));
    expect(linkedRange()).toEqual({
      endDate: "2026-07-30",
      order: "oldestFirst",
      startDate: "2026-07-01",
    });

    await user.click(screen.getByRole("tab", { name: "Trailing 3 months" }));
    expect(linkedRange()).toEqual({
      endDate: "2026-07-30",
      order: "oldestFirst",
      startDate: "2026-05-01",
    });
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
