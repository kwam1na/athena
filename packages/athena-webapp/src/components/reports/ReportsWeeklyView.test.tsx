import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    search: _search,
    params: _params,
    state,
    to,
    ...props
  }: {
    children?: React.ReactNode;
    params?: unknown;
    search?: unknown;
    state?: unknown;
    to: string;
  }) => {
    void _params;
    void _search;
    return (
      <a
        data-router-state={state ? JSON.stringify(state) : undefined}
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
    outsideSchedule,
    outsideScheduleNetSalesDeltaMinor: 0,
    outsideScheduleSummary,
    summary: { ...summary, netSalesMinor: 101_500 },
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
    netSalesChange: { amountMinor: 10_000, direction: "higher" },
  },
  variancePosture: {
    closeVarianceMinor: -250,
    coverage: "partial",
    coveredIncludedDayCount: 1,
    includedDayCount: 2,
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
  it("keeps net sales singular and orders the supporting lanes underneath", () => {
    render(<ReportsWeeklyView report={report} />);

    expect(
      screen.getByRole("heading", { name: "Net sales" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("weekly-net-sales-value")).toHaveTextContent(
      "$1,000",
    );
    expect(screen.getByTestId("weekly-prior-net-sales-delta")).toHaveTextContent(
      "Higher than the prior period by $100",
    );
    expect(screen.getByText("Lifecycle:")).toBeInTheDocument();
    expect(screen.getByText("Accepted week")).toBeInTheDocument();
    expect(screen.getByText("Amendment:")).toBeInTheDocument();
    expect(screen.getByText("Amended")).toBeInTheDocument();

    expect(
      screen.getAllByRole("heading").map((heading) => heading.textContent),
    ).toEqual([
      "Net sales",
      "Financial performance",
      "Units moved",
      "Payment posture",
      "Variance",
      "Inventory attention",
      "Disclosures",
    ]);
    expect(
      screen.getByText("$15 scheduled · $0 outside schedule since acceptance"),
    ).toBeInTheDocument();
    expect(screen.getByText("Current net units")).toBeInTheDocument();
    expect(screen.getByText("Prior net units")).toBeInTheDocument();
    expect(screen.getByText("Current allocated")).toBeInTheDocument();
    expect(screen.getByText("Prior allocated")).toBeInTheDocument();
    expect(screen.getByText("2 new review groups")).toBeInTheDocument();
    expect(
      screen.getByText("1 carried-forward review group"),
    ).toBeInTheDocument();
    expect(
      screen.getAllByText(/outside the reporting schedule:/i),
    ).toHaveLength(2);
    expect(screen.getAllByText(/\$900/)).not.toHaveLength(0);
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
      screen.getByRole("link", { name: "Review Daily Close" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Open inventory review" }),
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
    expect(screen.getByText("No amendment")).toBeInTheDocument();
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

    expect(screen.getByText("Live week to date")).toBeInTheDocument();
    expect(
      screen.getByText(
        "No scheduled activity has been recorded for this reporting week.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Scheduled · No activity recorded")).toBeInTheDocument();
    expect(screen.queryByText(/still materializing/i)).not.toBeInTheDocument();
  });

  it.each([
    {
      name: "awaiting final close",
      expectedLifecycle: "Awaiting final Daily Close",
      lifecyclePosture: "awaiting_final_close" as const,
      completeness: { complete: true, reason: "complete" as const },
      closePosture: undefined,
      finalDay: { dayAvailable: true, dayStatus: "open" as const },
      amendment: undefined,
      expectedAmendment: "No amendment",
      amendmentPosture: "none" as const,
    },
    {
      name: "materializing",
      expectedLifecycle: "Materializing scheduled activity",
      lifecyclePosture: "materializing" as const,
      completeness: { complete: false, reason: "missing_day_fold" as const },
      closePosture: undefined,
      finalDay: { dayAvailable: false, dayStatus: null },
      amendment: undefined,
      expectedAmendment: "No amendment",
      amendmentPosture: "none" as const,
    },
    {
      name: "reopened and amended",
      expectedLifecycle: "Reopened — awaiting a successor close",
      lifecyclePosture: "reopened_awaiting_successor" as const,
      completeness: { complete: true, reason: "complete" as const },
      closePosture: {
        status: "reopened_awaiting_successor" as const,
        acceptedCloseId: "close-1",
        changedAt: 2,
      },
      finalDay: { dayAvailable: true, dayStatus: "amended" as const },
      amendment: report.amendment,
      expectedAmendment: "Amended",
      amendmentPosture: "amended" as const,
    },
    {
      name: "accepted while an amendment recomputes",
      expectedLifecycle: "Accepted week",
      lifecyclePosture: "accepted" as const,
      completeness: { complete: false, reason: "missing_day_fold" as const },
      closePosture: report.closePosture,
      finalDay: { dayAvailable: true, dayStatus: "reconciled" as const },
      amendment: undefined,
      expectedAmendment: "Recomputing amendment",
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
                activityPosture:
                  finalDay.dayAvailable ? "recorded" : "unavailable",
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
        }}
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent(guidance);
  });

  it("carries the selected Weekly context into every owner link", () => {
    const ownerReturnContext = {
      reportId: "week:2026-07-06",
      history: true,
      historyCursor: "cursor-2",
      historyCursorTrail: [null, "cursor-1"],
    };
    render(
      <ReportsWeeklyView
        ownerReturnContext={ownerReturnContext}
        report={report}
      />,
    );

    for (const link of screen.getAllByRole("link")) {
      expect(link).toHaveAttribute(
        "data-router-state",
        JSON.stringify({ reportsWeeklyReturn: ownerReturnContext }),
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
          },
        }}
      />,
    );

    expect(
      screen.getByText("$0 scheduled · $25 outside schedule since acceptance"),
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
          amendment: {
            ...report.amendment!,
            summary: {
              ...report.amendment!.summary,
              merchandiseMarginMinor: null,
              paymentAllocationCoverage: "unknown",
              paymentUnsettledMinor: null,
            },
          },
        }}
      />,
    );

    expect(screen.getByText("No item cost recorded")).toBeInTheDocument();
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
            netSalesChange: null,
          },
          variancePosture: {
            closeVarianceMinor: 0,
            coverage: "unavailable",
            coveredIncludedDayCount: 0,
            includedDayCount: 2,
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
