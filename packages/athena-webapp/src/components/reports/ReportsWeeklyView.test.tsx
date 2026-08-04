import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getFunctionName } from "convex/server";

const { ensureMovementRange, useQuery } = vi.hoisted(() => ({
  ensureMovementRange: vi.fn(),
  useQuery: vi.fn(),
}));

const MOVEMENT_REQUEST_KEY = "movement:weekly-test";

const movementTotals = {
  unitsSold: 20,
  unitsReturned: 2,
  netUnits: 18,
  skuCount: 2,
};

const movementLifecycle = {
  state: "completed" as const,
  totals: movementTotals,
  completedAt: 1_754_000_000_000,
  pageCount: 1,
};

const movementRows = [
  {
    identity: {
      displayName: "Lace Front Wig",
      netPriceMinor: 4_500,
      size: "18 in",
      sku: "LFW-01",
    },
    key: "sku-lace-front",
    label: "LFW-01",
    productSkuId: "sku-lace-front",
    netUnits: 10,
    rank: 1,
    unitsReturned: 2,
    unitsSold: 12,
  },
  {
    identity: {
      displayName: "Body Wave Wig",
      netPriceMinor: 6_000,
      sku: "BWW-01",
    },
    key: "sku-body-wave",
    label: "BWW-01",
    productSkuId: "sku-body-wave",
    netUnits: 8,
    rank: 2,
    unitsReturned: 0,
    unitsSold: 8,
  },
];

/** Wires the sheet's movement lifecycle reads to a completed snapshot. */
function installMovementQueries() {
  ensureMovementRange.mockResolvedValue({
    requestKey: MOVEMENT_REQUEST_KEY,
    lifecycle: { state: "queued_pending" },
  });
  useQuery.mockImplementation((reference: unknown, args: unknown) => {
    if (args === "skip") return undefined;
    const name = getFunctionName(reference as never);
    if (name === "reports/skuMovementRange:getMovementRange") {
      return {
        requestKey: MOVEMENT_REQUEST_KEY,
        startDate: "2026-07-06",
        endDate: "2026-07-12",
        lifecycle: movementLifecycle,
      };
    }
    if (name === "reports/skuMovementRange:getMovementRangePage") {
      return {
        requestKey: MOVEMENT_REQUEST_KEY,
        startDate: "2026-07-06",
        endDate: "2026-07-12",
        lifecycle: movementLifecycle,
        page: 1,
        pageCount: 1,
        rows: movementRows,
      };
    }
    return undefined;
  });
}

vi.mock("convex/react", () => ({
  useQuery,
  useMutation: () => ensureMovementRange,
}));
vi.mock("@/hooks/useGetActiveStore", () => ({
  default: () => ({ activeStore: { _id: "store-1" } }),
}));
vi.mock("./useReportsSharedDemoMode", () => ({
  useReportsSharedDemoMode: () => ({
    isSharedDemo: false,
    useLiveQuery: true,
  }),
}));

vi.mock("recharts", () => ({
  Bar: ({
    dataKey,
    isAnimationActive,
  }: {
    dataKey: string;
    isAnimationActive?: boolean;
  }) => (
    <div
      data-animation-active={String(Boolean(isAnimationActive))}
      data-testid={`weekly-units-bar-${dataKey}`}
    />
  ),
  BarChart: ({
    children,
    data,
  }: {
    children?: React.ReactNode;
    data: unknown;
  }) => (
    <div data-chart-data={JSON.stringify(data)} data-testid="weekly-units-chart">
      {children}
    </div>
  ),
  CartesianGrid: () => null,
  Cell: () => null,
  Legend: () => null,
  ReferenceLine: () => null,
  ResponsiveContainer: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  Tooltip: () => null,
  XAxis: () => null,
  YAxis: () => null,
}));

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => children,
  TooltipContent: ({ children }: { children: React.ReactNode }) => (
    <div role="tooltip">{children}</div>
  ),
  TooltipProvider: ({ children }: { children: React.ReactNode }) => children,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    search,
    params,
    to,
    ...props
  }: {
    children?: React.ReactNode;
    params?: unknown;
    search?: unknown;
    to: string;
  }) => {
    return (
      <a
        data-params={params ? JSON.stringify(params) : undefined}
        data-search={search ? JSON.stringify(search) : undefined}
        href={to}
        {...props}
      >
        {children}
      </a>
    );
  },
  useParams: () => ({ orgUrlSlug: "acme", storeUrlSlug: "downtown" }),
}));

import {
  ReportsWeeklyView,
  type WeeklyReportProjection,
} from "./ReportsWeeklyView";
import { weeklyUpdatedAt } from "./weeklyReportPresentation";

const summary = {
  grossSalesMinor: 120_000,
  merchandiseMarginMinor: 40_000,
  netSalesMinor: 100_000,
  netUnits: 16,
  paymentAllocatedMinor: 100_000,
  paymentAllocationCoverage: "complete" as const,
  paymentUnsettledMinor: 0,
  paymentsCollectedMinor: 100_000,
  paymentsRefundedMinor: 20_000,
  refundsMinor: 20_000,
  unitsReturned: 2,
  unitsSold: 18,
};

const outsideSchedule = {
  grossSalesMinor: 4_000,
  netSalesMinor: 4_000,
  refundsMinor: 0,
  unitsSold: 1,
  unitsReturned: 0,
  uncostedRevenueMinor: 0,
  grossProfitMinor: 1_500,
  paymentsCollectedMinor: 4_000,
  paymentsRefundedMinor: 0,
  paymentAllocatedMinor: 4_000,
  paymentUnsettledMinor: 0,
  paymentAllocationCoverage: "complete" as const,
};

const outsideScheduleSummary = {
  grossSalesMinor: 4_000,
  merchandiseMarginMinor: 1_500,
  netSalesMinor: 4_000,
  netUnits: 1,
  paymentAllocatedMinor: 4_000,
  paymentAllocationCoverage: "complete" as const,
  paymentUnsettledMinor: 0,
  paymentsCollectedMinor: 4_000,
  paymentsRefundedMinor: 0,
  refundsMinor: 0,
  unitsReturned: 0,
  unitsSold: 1,
};

/** Both lanes combined — what the headline now prints. */
const totalSummary = {
  ...summary,
  grossSalesMinor: 124_000,
  merchandiseMarginMinor: 41_500,
  netSalesMinor: 104_000,
  netUnits: 17,
  paymentAllocatedMinor: 104_000,
  paymentsCollectedMinor: 104_000,
  unitsSold: 19,
};

const report: WeeklyReportProjection = {
  reportId: "week:2026-07-06",
  cycleStartDate: "2026-07-06",
  cycleEndDate: "2026-07-12",
  currency: "USD",
  lifecyclePosture: "accepted",
  amendmentPosture: "amended",
  included: {
    grossSalesMinor: 120_000,
    netSalesMinor: 100_000,
    refundsMinor: 20_000,
    unitsSold: 18,
    unitsReturned: 2,
    uncostedRevenueMinor: 0,
    grossProfitMinor: 40_000,
    paymentsCollectedMinor: 100_000,
    paymentsRefundedMinor: 20_000,
    paymentAllocatedMinor: 100_000,
    paymentUnsettledMinor: 0,
    paymentAllocationCoverage: "complete",
  },
  summary,
  outsideSchedule,
  outsideScheduleSummary,
  total: totalSummary,
  totalCompleteness: { complete: true, reason: "complete" },
  scheduleLineage: [
    {
      localDate: "2026-07-06",
      included: true,
      scheduleVersionId: "schedule-1",
      dayStatus: "reconciled",
      dayAvailable: true,
      activityPosture: "recorded",
    },
    {
      localDate: "2026-07-12",
      included: false,
      scheduleVersionId: "schedule-1",
      dayStatus: "reconciled",
      dayAvailable: true,
      activityPosture: "recorded",
    },
  ],
  completeness: { complete: true, reason: "complete" },
  closePosture: {
    status: "accepted",
    acceptedCloseId: "close-1",
    changedAt: 0,
  },
  amendment: {
    changedAt: 1,
    currentFingerprint: "amended",
    includedNetSalesDeltaMinor: 1_500,
    netSalesDeltaMinor: 1_500,
    outsideSchedule,
    outsideScheduleNetSalesDeltaMinor: 0,
    outsideScheduleSummary,
    summary: { ...summary, netSalesMinor: 101_500 },
    totalSummary: { ...totalSummary, netSalesMinor: 105_500 },
  },
  inventoryAttention: {
    newCount: 2,
    carriedForwardCount: 1,
    completeness: "complete",
  },
  priorPeriod: {
    cycleStartDate: "2026-06-29",
    cycleEndDate: "2026-07-05",
    comparabilityReason: "comparable",
    currentScheduledPositionCount: 1,
    equivalentScheduledPositions: true,
    priorScheduledPositionCount: 1,
    values: {
      grossSalesMinor: 110_000,
      netSalesMinor: 90_000,
      refundsMinor: 20_000,
      unitsSold: 16,
      unitsReturned: 1,
      uncostedRevenueMinor: 0,
      grossProfitMinor: 35_000,
      paymentsCollectedMinor: 90_000,
      paymentsRefundedMinor: 20_000,
      paymentAllocatedMinor: 90_000,
      paymentUnsettledMinor: 0,
      paymentAllocationCoverage: "complete",
    },
    summary: {
      ...summary,
      grossSalesMinor: 110_000,
      merchandiseMarginMinor: 35_000,
      netSalesMinor: 90_000,
      netUnits: 15,
      paymentAllocatedMinor: 90_000,
      paymentsCollectedMinor: 90_000,
      unitsReturned: 1,
      unitsSold: 16,
    },
    totalSummary: {
      ...summary,
      grossSalesMinor: 114_000,
      merchandiseMarginMinor: 36_500,
      netSalesMinor: 94_000,
      netUnits: 16,
      paymentAllocatedMinor: 94_000,
      paymentsCollectedMinor: 94_000,
      unitsReturned: 1,
      unitsSold: 17,
    },
    // Total vs total: 104,000 − 94,000.
    netSalesChange: { amountMinor: 10_000, direction: "higher" },
  },
  variancePosture: {
    closeVarianceMinor: -250,
    coverage: "partial",
    coveredIncludedDayCount: 1,
    includedDayCount: 2,
    scheduledVarianceMinor: -250,
    outsideScheduleVarianceMinor: 0,
    outsideScheduleCoveredDayCount: 0,
  },
  ownerRoutes: {
    transactions: {
      to: "/$orgUrlSlug/store/$storeUrlSlug/pos/transactions",
      search: {
        startDate: "2026-07-06",
        endDate: "2026-07-12",
        order: "oldestFirst",
      },
    },
    dailyClose: {
      to: "/$orgUrlSlug/store/$storeUrlSlug/operations/daily-close-history",
      search: { day: "2026-07-12" },
    },
    cashControls: {
      to: "/$orgUrlSlug/store/$storeUrlSlug/cash-controls",
    },
    openWork: {
      to: "/$orgUrlSlug/store/$storeUrlSlug/operations/open-work",
      search: { workType: "synced_sale_inventory_review" },
    },
  },
};

describe("ReportsWeeklyView", () => {
  it("uses the newest projection, acceptance, close, or amendment timestamp", () => {
    expect(weeklyUpdatedAt({ ...report, materializedAt: 100 })).toBe(100);
    expect(
      weeklyUpdatedAt({
        ...report,
        acceptedAt: 200,
        closePosture: { ...report.closePosture!, changedAt: 300 },
        amendment: { ...report.amendment!, changedAt: 400 },
        materializedAt: undefined,
      }),
    ).toBe(400);
  });

  beforeEach(() => {
    ensureMovementRange.mockReset();
    useQuery.mockReset();
  });

  it("restores the report scroll position when an open sheet remounts", async () => {
    installMovementQueries();
    const user = userEvent.setup();
    const scrollHeightSpy = vi
      .spyOn(HTMLElement.prototype, "scrollHeight", "get")
      .mockImplementation(function (this: HTMLElement) {
        return this.dataset.testid === "weekly-scroll-container" ? 2_000 : 0;
      });
    const clientHeightSpy = vi
      .spyOn(HTMLElement.prototype, "clientHeight", "get")
      .mockImplementation(function (this: HTMLElement) {
        return this.dataset.testid === "weekly-scroll-container" ? 600 : 0;
      });
    let mounted: ReturnType<typeof render> | undefined;

    try {
      mounted = render(
        <div
          data-testid="weekly-scroll-container"
          style={{ overflowY: "auto" }}
        >
          <ReportsWeeklyView report={report} />
        </div>,
      );
      const firstScroller = screen.getByTestId("weekly-scroll-container");
      firstScroller.scrollTop = 640;

      await user.click(
        screen.getByRole("button", { name: "View item movement" }),
      );
      mounted.unmount();

      mounted = render(
        <div
          data-testid="weekly-scroll-container"
          style={{ overflowY: "auto" }}
        >
          <ReportsWeeklyView isUnitsSheetOpen report={report} />
        </div>,
      );

      expect(screen.getByTestId("weekly-scroll-container").scrollTop).toBe(
        640,
      );
      await user.click(screen.getByRole("button", { name: "Close" }));
    } finally {
      mounted?.unmount();
      scrollHeightSpy.mockRestore();
      clientHeightSpy.mockRestore();
    }
  });

  it("opens a tabbed units sheet fed by the movement lifecycle", async () => {
    installMovementQueries();
    const user = userEvent.setup();
    render(<ReportsWeeklyView report={report} />);

    const chartTrigger = screen.getByRole("button", {
      name: "View item movement",
    });
    expect(
      screen
        .getByText("Prior net units")
        .compareDocumentPosition(chartTrigger) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    await user.click(chartTrigger);

    expect(
      screen.getByRole("dialog", { name: "Item movement" }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(ensureMovementRange).toHaveBeenCalledWith({
        storeId: "store-1",
        startDate: "2026-07-06",
        endDate: "2026-07-12",
      }),
    );
    expect(screen.getByRole("tab", { name: "Top movers" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "All items" })).toBeInTheDocument();

    await waitFor(() =>
      expect(screen.getByTestId("weekly-units-dot-grid")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("weekly-units-dot-grid")).toHaveClass(
      "text-border/[0.55]",
    );
    expect(screen.getByTestId("weekly-units-dot-grid")).toHaveStyle({
      backgroundImage:
        "radial-gradient(currentColor 1px, transparent 1.5px)",
      backgroundSize: "16px 16px",
      maskImage:
        "radial-gradient(ellipse at center, black 50%, transparent 100%)",
    });
    const chartData = JSON.parse(
      screen
        .getByTestId("weekly-units-chart")
        .getAttribute("data-chart-data")!,
    );
    expect(chartData).toEqual([
      {
        key: "sku-lace-front",
        netPrice: "$45",
        productSkuId: "sku-lace-front",
        productName: "Lace Front Wig",
        rank: 1,
        size: "18 in",
        sku: "LFW-01",
        units: 10,
        unitsReturned: 2,
        unitsSold: 12,
      },
      {
        key: "sku-body-wave",
        netPrice: "$60",
        productSkuId: "sku-body-wave",
        productName: "Body Wave Wig",
        rank: 2,
        sku: "BWW-01",
        units: 8,
        unitsReturned: 0,
        unitsSold: 8,
      },
    ]);
    const unitsBar = screen.getByTestId("weekly-units-bar-units");
    expect(unitsBar).toHaveAttribute("data-animation-active", "true");
    expect(screen.getByRole("columnheader", { name: "Item" })).toBeInTheDocument();
    expect(
      screen.getByRole("columnheader", { name: "Net units" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Lace Front Wig")).toBeInTheDocument();
    expect(screen.getByTestId("unit-metadata-sku-lace-front")).toHaveTextContent(
      "LFW-01 · 18 in · $45",
    );
    expect(screen.getByText("Body Wave Wig")).toBeInTheDocument();
    expect(screen.getByTestId("unit-metadata-sku-body-wave")).toHaveTextContent(
      "BWW-01 · $60",
    );
    expect(screen.getByTestId("units-moved-count")).toHaveTextContent(
      "2 SKUs moved · 20 sold · 2 returned · net 18 out",
    );
    expect(screen.queryByText(/SKU LFW-01/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Size 18 in/)).not.toBeInTheDocument();

    const itemLink = screen.getByRole("link", { name: /Lace Front Wig/ });
    expect(itemLink).toHaveAttribute(
      "href",
      "/$orgUrlSlug/store/$storeUrlSlug/reports/items/$productSkuId",
    );
    expect(JSON.parse(itemLink.getAttribute("data-params") ?? "{}")).toEqual({
      orgUrlSlug: "acme",
      productSkuId: "sku-lace-front",
      storeUrlSlug: "downtown",
    });
    expect(JSON.parse(itemLink.getAttribute("data-search") ?? "{}")).toEqual({
      endDate: "2026-07-12",
      o: "%2F",
      startDate: "2026-07-06",
    });

    const focusSpy = vi.spyOn(HTMLElement.prototype, "focus");
    try {
      await user.click(screen.getByRole("button", { name: "Close" }));
      expect(focusSpy).toHaveBeenCalledWith({ preventScroll: true });
    } finally {
      focusSpy.mockRestore();
    }
  });

  it("keeps net sales singular and orders the supporting lanes underneath", () => {
    render(<ReportsWeeklyView report={report} />);

    expect(
      screen.getByRole("heading", { name: "Net sales" }),
    ).toBeInTheDocument();
    // The headline is the combined week, not the scheduled lane alone.
    expect(screen.getByTestId("weekly-net-sales-value")).toHaveTextContent(
      "$1,040",
    );
    expect(screen.getByTestId("weekly-net-sales-flip")).toHaveAttribute(
      "data-motion",
      "flip",
    );
    expect(screen.getByTestId("weekly-net-sales-flip")).toHaveAttribute(
      "data-value",
      "$1,040",
    );
    expect(
      screen.getByTestId("weekly-prior-net-sales-delta"),
    ).toHaveTextContent("Higher than the prior period by $100");
    expect(screen.getByText("Week status:")).toBeInTheDocument();
    expect(screen.getByText("Final Daily Close accepted")).toBeInTheDocument();
    expect(screen.getByText("Report changes:")).toBeInTheDocument();
    expect(screen.getByText("Updated after close")).toBeInTheDocument();

    expect(
      screen.getAllByRole("heading").map((heading) => heading.textContent),
    ).toEqual([
      "Net sales",
      "Sales breakdown",
      "Item movement",
      "Payments",
      "Variance",
      "Inventory attention",
      "Reporting details",
    ]);
    expect(
      screen.getByText(
        "$15 since acceptance ($15 scheduled · $0 outside schedule)",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Current net units")).toBeInTheDocument();
    expect(screen.getByText("Prior net units")).toBeInTheDocument();
    expect(
      screen.getByText("Current payments accounted for"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Prior period payments accounted for"),
    ).toBeInTheDocument();
    expect(screen.getByText("2 new review groups")).toBeInTheDocument();
    expect(
      screen.getByText("1 carried-forward review group"),
    ).toBeInTheDocument();
    // Only the current lane is restated in Reporting details; the accepted
    // outside-schedule figure lives under the headline it qualifies.
    expect(
      screen.getAllByText(/outside the reporting schedule:/i),
    ).toHaveLength(1);
    expect(
      screen.queryByText(/Accepted outside the reporting schedule/),
    ).not.toBeInTheDocument();
    expect(screen.getAllByText(/\$940/)).not.toHaveLength(0);
    expect(
      screen.getByText("Comparable scheduled positions."),
    ).toBeInTheDocument();
    expect(screen.getByText("-$2.50")).toBeInTheDocument();
    expect(
      screen.getByText("Partial coverage: 1 of 2 scheduled days."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "View transaction evidence" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "View EOD Review" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Open inventory review" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("list", { name: "Scheduled days" }).firstElementChild,
    ).toHaveClass(
      "grid",
      "sm:grid-cols-[minmax(0,1fr)_auto]",
      "sm:items-baseline",
    );
  });

  it("discloses the variance lanes only when an outside-schedule close moved the figure", () => {
    const { rerender } = render(
      <ReportsWeeklyView
        report={{
          ...report,
          variancePosture: {
            closeVarianceMinor: -1_050,
            coverage: "partial",
            coveredIncludedDayCount: 1,
            includedDayCount: 2,
            scheduledVarianceMinor: -250,
            outsideScheduleVarianceMinor: -800,
            outsideScheduleCoveredDayCount: 1,
          },
        }}
      />,
    );

    expect(screen.getByText("Close variance")).toBeInTheDocument();
    expect(
      screen.queryByText("Scheduled close variance"),
    ).not.toBeInTheDocument();
    const split = screen.getByTestId("weekly-variance-split");
    expect(split).toHaveTextContent("Scheduled: -$2.50");
    expect(split).toHaveTextContent("Outside schedule: -$8");
    // Coverage stays a scheduled-day expectation; the outside close is not a
    // gap and must not move this line.
    expect(
      screen.getByText("Partial coverage: 1 of 2 scheduled days."),
    ).toBeInTheDocument();

    rerender(
      <ReportsWeeklyView
        report={{
          ...report,
          variancePosture: {
            closeVarianceMinor: -250,
            coverage: "partial",
            coveredIncludedDayCount: 1,
            includedDayCount: 2,
            scheduledVarianceMinor: -250,
            outsideScheduleVarianceMinor: 0,
            outsideScheduleCoveredDayCount: 0,
          },
        }}
      />,
    );
    expect(
      screen.queryByTestId("weekly-variance-split"),
    ).not.toBeInTheDocument();

    rerender(
      <ReportsWeeklyView
        report={{
          ...report,
          variancePosture: {
            closeVarianceMinor: -250,
            coverage: "partial",
            coveredIncludedDayCount: 1,
            includedDayCount: 2,
            scheduledVarianceMinor: null,
            outsideScheduleVarianceMinor: null,
            outsideScheduleCoveredDayCount: null,
          },
        }}
      />,
    );
    expect(
      screen.queryByTestId("weekly-variance-split"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Close variance")).toBeInTheDocument();
    expect(
      screen.getByText("Partial coverage: 1 of 2 scheduled days."),
    ).toBeInTheDocument();
  });

  it("does not label a clean accepted week as amended", () => {
    render(
      <ReportsWeeklyView
        report={{
          ...report,
          amendment: undefined,
          amendmentPosture: "none",
          current: undefined,
        }}
      />,
    );

    expect(
      screen.queryByText(/current after amendment/i),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/current amendment/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/since acceptance/i)).not.toBeInTheDocument();
    expect(screen.getByText("None")).toBeInTheDocument();
  });

  it("distinguishes scheduled zero activity from missing materialization", () => {
    render(
      <ReportsWeeklyView
        report={{
          ...report,
          amendment: undefined,
          amendmentPosture: "none",
          closePosture: undefined,
          current: undefined,
          lifecyclePosture: "live",
          included: {
            ...report.included,
            grossSalesMinor: 0,
            netSalesMinor: 0,
            refundsMinor: 0,
            unitsSold: 0,
            unitsReturned: 0,
            paymentsCollectedMinor: 0,
            paymentsRefundedMinor: 0,
            paymentAllocatedMinor: 0,
          },
          priorPeriod: undefined,
          scheduleLineage: [
            {
              localDate: "2026-07-06",
              included: true,
              scheduleVersionId: "schedule-1",
              dayStatus: null,
              dayAvailable: false,
              activityPosture: "zero_activity",
            },
          ],
          summary: {
            ...summary,
            grossSalesMinor: 0,
            merchandiseMarginMinor: 0,
            netSalesMinor: 0,
            netUnits: 0,
            paymentAllocatedMinor: 0,
            paymentsCollectedMinor: 0,
            paymentsRefundedMinor: 0,
            refundsMinor: 0,
            unitsReturned: 0,
            unitsSold: 0,
          },
        }}
      />,
    );

    expect(screen.getByText("In progress")).toBeInTheDocument();
    expect(
      screen.getByText(
        "No scheduled activity has been recorded for this reporting week.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("No activity recorded")).toBeInTheDocument();
    expect(screen.queryByText(/still materializing/i)).not.toBeInTheDocument();
  });

  it.each([
    {
      name: "awaiting final close",
      expectedLifecycle: "Waiting for final Daily Close",
      lifecyclePosture: "awaiting_final_close" as const,
      completeness: { complete: true, reason: "complete" as const },
      closePosture: undefined,
      finalDay: { dayAvailable: true, dayStatus: "open" as const },
      amendment: undefined,
      expectedAmendment: "None",
      amendmentPosture: "none" as const,
    },
    {
      name: "materializing",
      expectedLifecycle: "Updating report",
      lifecyclePosture: "materializing" as const,
      completeness: { complete: false, reason: "missing_day_fold" as const },
      closePosture: undefined,
      finalDay: { dayAvailable: false, dayStatus: null },
      amendment: undefined,
      expectedAmendment: "None",
      amendmentPosture: "none" as const,
    },
    {
      name: "reopened and amended",
      expectedLifecycle: "Daily Close reopened",
      lifecyclePosture: "reopened_awaiting_successor" as const,
      completeness: { complete: true, reason: "complete" as const },
      closePosture: {
        status: "reopened_awaiting_successor" as const,
        acceptedCloseId: "close-1",
        changedAt: 2,
      },
      finalDay: { dayAvailable: true, dayStatus: "amended" as const },
      amendment: report.amendment,
      expectedAmendment: "Updated after close",
      amendmentPosture: "amended" as const,
    },
    {
      name: "accepted while an amendment recomputes",
      expectedLifecycle: "Final Daily Close accepted",
      lifecyclePosture: "accepted" as const,
      completeness: { complete: false, reason: "missing_day_fold" as const },
      closePosture: report.closePosture,
      finalDay: { dayAvailable: true, dayStatus: "reconciled" as const },
      amendment: undefined,
      expectedAmendment: "Updating",
      amendmentPosture: "pending_recompute" as const,
    },
  ])(
    "shows $name as independent lifecycle and amendment posture",
    ({
      amendment,
      closePosture,
      completeness,
      expectedAmendment,
      expectedLifecycle,
      lifecyclePosture,
      finalDay,
      amendmentPosture,
    }) => {
      render(
        <ReportsWeeklyView
          report={{
            ...report,
            amendment,
            amendmentPosture,
            closePosture,
            completeness,
            current: undefined,
            lifecyclePosture,
            scheduleLineage: [
              {
                localDate: "2026-07-12",
                included: true,
                scheduleVersionId: "schedule-1",
                activityPosture: finalDay.dayAvailable
                  ? "recorded"
                  : "unavailable",
                ...finalDay,
              },
            ],
          }}
        />,
      );

      expect(screen.getByText(expectedLifecycle)).toBeInTheDocument();
      expect(screen.getByText(expectedAmendment)).toBeInTheDocument();
    },
  );

  it.each([
    [
      "fact_cap_exceeded" as const,
      "This week exceeds the supported reporting limit, so totals are withheld. Contact support to review the reporting volume.",
    ],
    [
      "mixed_currency" as const,
      "This period includes more than one currency, so totals are unavailable. Review the source transactions for the affected dates.",
    ],
    [
      "missing_schedule" as const,
      "A reporting schedule is needed before this week can be summarized. Add at least one operational day in Store hours.",
    ],
  ])("gives reason-specific guidance for %s", (reason, guidance) => {
    render(
      <ReportsWeeklyView
        report={{
          ...report,
          completeness: { complete: false, reason },
          // A scheduled-lane limitation always reaches the combined verdict.
          totalCompleteness: { complete: false, reason },
        }}
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent(guidance);
  });

  it.each(["mixed_currency", "fact_cap_exceeded"] as const)(
    "withholds every total when completeness says totals are withheld for %s",
    (reason) => {
      render(
        <ReportsWeeklyView
          report={{
            ...report,
            completeness: { complete: false, reason },
            totalCompleteness: { complete: false, reason },
          }}
        />,
      );

      expect(screen.getByTestId("weekly-net-sales-value")).toHaveTextContent(
        "Unavailable",
      );
      expect(
        screen.queryByTestId("weekly-outside-schedule-disclosure"),
      ).not.toBeInTheDocument();
      // No figure derived from the withheld totals may survive anywhere.
      expect(screen.queryByText(/\$1,000/)).not.toBeInTheDocument();
      expect(screen.queryByText(/\$1,200/)).not.toBeInTheDocument();
      expect(
        screen.queryByTestId("weekly-prior-net-sales-delta"),
      ).not.toBeInTheDocument();
      expect(screen.queryByText(/since acceptance/i)).not.toBeInTheDocument();
      expect(document.body.textContent).not.toMatch(/\$\d/);

      // The structure and the guidance both survive.
      expect(
        screen.getAllByRole("heading").map((heading) => heading.textContent),
      ).toEqual([
        "Net sales",
        "Sales breakdown",
        "Item movement",
        "Payments",
        "Variance",
        "Inventory attention",
        "Reporting details",
      ]);
      expect(screen.getByRole("status").textContent).toMatch(
        reason === "mixed_currency" ? /more than one currency/ : /withheld/,
      );
      expect(screen.getAllByText("Unavailable").length).toBeGreaterThanOrEqual(
        6,
      );
      expect(
        screen.queryByRole("button", { name: "View item movement" }),
      ).not.toBeInTheDocument();
    },
  );

  it("keeps totals visible when the week is complete", () => {
    render(<ReportsWeeklyView report={report} />);

    expect(screen.getByTestId("weekly-net-sales-value")).toHaveTextContent(
      "$1,040",
    );
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("labels values Accepted when no amendment supplies later truth", () => {
    render(
      <ReportsWeeklyView
        report={{
          ...report,
          amendment: undefined,
          amendmentPosture: "none",
          current: undefined,
        }}
      />,
    );

    expect(screen.getByText("Accepted net units")).toBeInTheDocument();
    expect(
      screen.getByText("Accepted payments accounted for"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Current net units")).not.toBeInTheDocument();
    expect(
      screen.queryByText("Current payments accounted for"),
    ).not.toBeInTheDocument();
  });

  it("labels values Current only while an amendment exists", () => {
    render(<ReportsWeeklyView report={report} />);

    expect(screen.getByText("Current net units")).toBeInTheDocument();
    expect(
      screen.getByText("Current payments accounted for"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Accepted net units")).not.toBeInTheDocument();
  });

  it("renders the unavailable inventory lane as unavailable, never as proven zero counts", () => {
    render(
      <ReportsWeeklyView
        report={{
          ...report,
          inventoryAttention: {
            newCount: 0,
            carriedForwardCount: 0,
            completeness: "unavailable",
          },
        }}
      />,
    );

    expect(
      screen.getByText(
        "Inventory review is unavailable for this reporting record.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/review groups?$/)).not.toBeInTheDocument();
    expect(screen.queryByText("0 new review groups")).not.toBeInTheDocument();
  });

  it("labels a live week's values as week to date rather than accepted", () => {
    render(
      <ReportsWeeklyView
        report={{
          ...report,
          amendment: undefined,
          amendmentPosture: "none",
          closePosture: undefined,
          current: undefined,
          lifecyclePosture: "live",
        }}
      />,
    );

    expect(screen.getByText("Week to date net units")).toBeInTheDocument();
    expect(
      screen.getByText("Week to date payments received"),
    ).toBeInTheDocument();
    expect(screen.getByText("Week to date refunds issued")).toBeInTheDocument();
    expect(
      screen.getByText("Week to date payments accounted for"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Week to date payments to reconcile"),
    ).toBeInTheDocument();
  });

  it.each([
    {
      label: "About current payments received",
      copy: "Money collected from customers during this reporting period, before refunds.",
    },
    {
      label: "About current payments accounted for",
      copy: "Payments Athena can match to recorded sales and refunds for this reporting period.",
    },
    {
      label: "About current payments to reconcile",
      copy: "Payments received, less refunds, that are not yet matched to recorded sales or refunds.",
    },
    {
      label: "About prior period payments accounted for",
      copy: "Payments Athena could match to recorded sales and refunds in the prior reporting period.",
    },
  ])("explains $label in operator-facing language", ({ copy, label }) => {
    render(<ReportsWeeklyView report={report} />);

    expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    expect(screen.getByText(copy)).toBeInTheDocument();
  });

  it("covers AE14: a Monday–Saturday week keeps after-hours Saturday sales in the headline and labels Sunday outside schedule", () => {
    const week = [
      "2026-07-06",
      "2026-07-07",
      "2026-07-08",
      "2026-07-09",
      "2026-07-10",
      "2026-07-11",
    ];

    render(
      <ReportsWeeklyView
        report={{
          ...report,
          amendment: undefined,
          amendmentPosture: "none",
          current: undefined,
          scheduleLineage: [
            ...week.map((localDate) => ({
              localDate,
              included: true,
              scheduleVersionId: "schedule-1",
              dayStatus: "reconciled" as const,
              dayAvailable: true,
              activityPosture: "recorded" as const,
            })),
            {
              localDate: "2026-07-12",
              included: false,
              scheduleVersionId: "schedule-1",
              dayStatus: "reconciled" as const,
              dayAvailable: true,
              activityPosture: "recorded" as const,
            },
          ],
        }}
      />,
    );

    const scheduledList = screen.getByRole("list");
    expect(scheduledList.querySelectorAll("li")).toHaveLength(6);
    expect(scheduledList).toHaveTextContent("Sat, Jul 11, 2026");
    expect(scheduledList).not.toHaveTextContent("Jul 12");

    // The Saturday after-hours sale is inside the headline total, not a
    // separate line, and Sunday reads as outside schedule with no
    // Sunday-specific copy anywhere.
    expect(screen.getByTestId("weekly-net-sales-value")).toHaveTextContent(
      "$1,040",
    );
    expect(
      screen.getByTestId("weekly-outside-schedule-disclosure"),
    ).toHaveTextContent(
      "$40 of this total was recorded on Sun, Jul 12, outside your operating schedule.",
    );
    expect(document.body.textContent).not.toMatch(/Sunday/i);
    expect(document.body.textContent).not.toMatch(/after hours/i);
  });

  it("puts the outside-schedule disclosure directly after the headline, naming its dates and both lanes", () => {
    render(<ReportsWeeklyView report={report} />);

    const disclosure = screen.getByTestId("weekly-outside-schedule-disclosure");
    expect(disclosure).toHaveTextContent(
      "$40 of this total was recorded on Sun, Jul 12, outside your operating schedule.",
    );

    // Both lanes stay inspectable beside the total.
    expect(disclosure).toHaveTextContent("Scheduled: $1,000");
    expect(disclosure).toHaveTextContent("Outside schedule: $40");

    // Position, not just presence: after the headline value, before the first
    // section heading — never at the foot of the page.
    const headline = screen.getByTestId("weekly-net-sales-value");
    const financial = screen.getByRole("heading", {
      name: "Sales breakdown",
    });
    const disclosures = screen.getByRole("heading", {
      name: "Reporting details",
    });
    expect(
      headline.compareDocumentPosition(disclosure) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      disclosure.compareDocumentPosition(financial) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      disclosure.compareDocumentPosition(disclosures) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("says nothing about outside schedule when no outside-schedule sales exist", () => {
    render(
      <ReportsWeeklyView
        report={{
          ...report,
          amendment: undefined,
          amendmentPosture: "none",
          current: undefined,
          outsideSchedule: { ...outsideSchedule, netSalesMinor: 0 },
          outsideScheduleSummary: {
            ...outsideScheduleSummary,
            netSalesMinor: 0,
          },
          total: { ...totalSummary, netSalesMinor: 100_000 },
        }}
      />,
    );

    expect(screen.getByTestId("weekly-net-sales-value")).toHaveTextContent(
      "$1,000",
    );
    expect(
      screen.queryByTestId("weekly-outside-schedule-disclosure"),
    ).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/outside/i);
  });

  it("withholds the total when only the outside-schedule lane is incomplete", () => {
    render(
      <ReportsWeeklyView
        report={{
          ...report,
          completeness: { complete: true, reason: "complete" },
          totalCompleteness: {
            complete: false,
            reason: "mixed_currency",
            outsideSchedule: { complete: false, reason: "mixed_currency" },
          },
        }}
      />,
    );

    expect(screen.getByTestId("weekly-net-sales-value")).toHaveTextContent(
      "Unavailable",
    );
    expect(
      screen.queryByTestId("weekly-outside-schedule-disclosure"),
    ).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/\$\d/);
  });

  it("compares the total against the prior period's total", () => {
    render(
      <ReportsWeeklyView
        report={{
          ...report,
          priorPeriod: {
            ...report.priorPeriod!,
            netSalesChange: { amountMinor: 4_000, direction: "lower" },
          },
        }}
      />,
    );

    expect(
      screen.getByTestId("weekly-prior-net-sales-delta"),
    ).toHaveTextContent("Lower than the prior period by $40");
    // The prior line prints the prior TOTAL, never its scheduled lane alone.
    expect(screen.getByText(/\$940 net sales/)).toBeInTheDocument();
    expect(screen.queryByText(/\$900 net sales/)).not.toBeInTheDocument();
  });

  it("carries an origin param into every owner link", () => {
    window.history.replaceState(
      {},
      "",
      "/acme/store/downtown/reports/weekly?reportId=week%3A2026-07-06",
    );
    render(<ReportsWeeklyView report={report} />);

    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(4);
    for (const link of links) {
      const search = JSON.parse(link.getAttribute("data-search")!);
      // The app's standard return convention: the owning surface reads `o`
      // and renders the back control in its own page header.
      expect(search.o).toBe(
        encodeURIComponent(
          "/acme/store/downtown/reports/weekly?reportId=week%3A2026-07-06",
        ),
      );
    }
  });

  it("shows current outside-schedule truth for an outside-only amendment", () => {
    render(
      <ReportsWeeklyView
        report={{
          ...report,
          amendment: {
            ...report.amendment!,
            includedNetSalesDeltaMinor: 0,
            netSalesDeltaMinor: 2_500,
            outsideSchedule: {
              ...outsideSchedule,
              netSalesMinor: 6_500,
            },
            outsideScheduleNetSalesDeltaMinor: 2_500,
            outsideScheduleSummary: {
              ...outsideScheduleSummary,
              netSalesMinor: 6_500,
            },
            summary,
            totalSummary: { ...totalSummary, netSalesMinor: 106_500 },
          },
        }}
      />,
    );

    // The combined delta leads; the lanes explain where it came from.
    expect(
      screen.getByText(
        "$25 since acceptance ($0 scheduled · $25 outside schedule)",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Current outside the reporting schedule: \$65/),
    ).toHaveTextContent("$25 since acceptance");
  });

  it("withholds derived profit and settlement conclusions when coverage is incomplete", () => {
    render(
      <ReportsWeeklyView
        report={{
          ...report,
          included: {
            ...report.included,
            grossProfitMinor: null,
            paymentAllocationCoverage: "unknown",
            paymentUnsettledMinor: null,
            uncostedRevenueMinor: 7_500,
          },
          summary: {
            ...report.summary,
            merchandiseMarginMinor: null,
            paymentAllocationCoverage: "unknown",
            paymentUnsettledMinor: null,
          },
          // An unknown on either lane poisons the combined total.
          total: {
            ...report.total,
            merchandiseMarginMinor: null,
            paymentAllocationCoverage: "unknown",
            paymentUnsettledMinor: null,
          },
          amendment: {
            ...report.amendment!,
            summary: {
              ...report.amendment!.summary,
              merchandiseMarginMinor: null,
              paymentAllocationCoverage: "unknown",
              paymentUnsettledMinor: null,
            },
            totalSummary: {
              ...report.amendment!.totalSummary,
              merchandiseMarginMinor: null,
              paymentAllocationCoverage: "unknown",
              paymentUnsettledMinor: null,
            },
          },
        }}
      />,
    );

    const merchandiseMargin = screen
      .getByText("Merchandise margin")
      .closest("div");
    expect(merchandiseMargin).not.toBeNull();
    expect(merchandiseMargin).toHaveTextContent(
      "Merchandise margin—No item cost recorded",
    );
    expect(
      screen.getByText("Payment allocation is incomplete."),
    ).toBeInTheDocument();
    expect(screen.getByText("Settlement unavailable")).toBeInTheDocument();
  });

  it("discloses when server-owned prior-period values are not comparable", () => {
    render(
      <ReportsWeeklyView
        report={{
          ...report,
          priorPeriod: {
            ...report.priorPeriod!,
            comparabilityReason: "scheduled_membership_changed",
            values: null,
            summary: null,
            totalSummary: null,
            netSalesChange: null,
          },
          variancePosture: {
            closeVarianceMinor: 0,
            coverage: "unavailable",
            coveredIncludedDayCount: 0,
            includedDayCount: 2,
            scheduledVarianceMinor: 0,
            outsideScheduleVarianceMinor: 0,
            outsideScheduleCoveredDayCount: 0,
          },
        }}
      />,
    );

    expect(
      screen.getByText("Prior-period financial values are unavailable."),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Scheduled membership changed between these reporting periods.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Daily Close variance is not available for this period.",
      ),
    ).toBeInTheDocument();
  });
});
