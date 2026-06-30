import { fireEvent, render, screen, within } from "@testing-library/react";
import React, { type AnchorHTMLAttributes, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DailyOperationsView,
  DailyOperationsViewContent,
  type DailyOperationsSnapshot,
} from "./DailyOperationsView";
import type { Id } from "~/convex/_generated/dataModel";

const mockedHooks = vi.hoisted(() => ({
  navigate: vi.fn(),
  useIsMobile: vi.fn(),
  useSearch: vi.fn(),
  useProtectedAdminPageState: vi.fn(),
  useQuery: vi.fn(),
}));

const mockedApi = vi.hoisted(() => ({
  getDailyOperationsDetailSnapshot: "getDailyOperationsDetailSnapshot",
  getDailyOperationsSnapshot: "getDailyOperationsSnapshot",
  getDailyOperationsStorePulseSnapshot: "getDailyOperationsStorePulseSnapshot",
  getDailyOperationsTimelinePreviewSnapshot:
    "getDailyOperationsTimelinePreviewSnapshot",
  getDailyOperationsTimelineSnapshot: "getDailyOperationsTimelineSnapshot",
}));

vi.mock("@tanstack/react-router", () => ({
  Link: React.forwardRef<
    HTMLAnchorElement,
    AnchorHTMLAttributes<HTMLAnchorElement> & {
      children: ReactNode;
      params?: Record<string, string>;
      search?: Record<string, string>;
      to?: string;
    }
  >(({ children, params, search, to, ...props }, ref) => {
    const path = to
      ? Object.entries(params ?? {}).reduce(
          (currentPath, [key, value]) =>
            currentPath.replace(`$${key}`, String(value)),
          to,
        )
      : "#";
    const searchParams = search ? `?${new URLSearchParams(search)}` : "";

    return (
      <a ref={ref} href={`${path}${searchParams}`} {...props}>
        {children}
      </a>
    );
  }),
  useParams: () => ({
    orgUrlSlug: "wigclub",
    storeUrlSlug: "osu",
  }),
  useNavigate: () => mockedHooks.navigate,
  useSearch: mockedHooks.useSearch,
}));

vi.mock("convex/react", () => ({
  useQuery: mockedHooks.useQuery,
}));

vi.mock("@/hooks/useProtectedAdminPageState", () => ({
  useProtectedAdminPageState: mockedHooks.useProtectedAdminPageState,
}));

vi.mock("@/hooks/use-mobile", () => ({
  useIsMobile: mockedHooks.useIsMobile,
}));

vi.mock("recharts", () => ({
  Area: ({
    animateNewValues,
    animationBegin,
    animationDuration,
    animationEasing,
    animationId,
    "data-replay-key": replayKey,
    isAnimationActive,
    pathLength,
  }: {
    animateNewValues?: boolean;
    animationBegin?: number;
    animationDuration?: number;
    animationEasing?: string;
    animationId?: number;
    "data-replay-key"?: string;
    isAnimationActive?: boolean;
    pathLength?: number;
  }) => (
    <path
      data-animate-new-values={String(Boolean(animateNewValues))}
      data-animation-begin={animationBegin ?? ""}
      data-animation-duration={animationDuration ?? ""}
      data-animation-easing={animationEasing ?? ""}
      data-animation-id={animationId ?? ""}
      data-animation-active={String(Boolean(isAnimationActive))}
      data-path-length={pathLength ?? ""}
      data-replay-key={replayKey ?? ""}
      data-testid="store-pulse-area"
    />
  ),
  AreaChart: ({
    children,
    className,
    data = [],
    margin,
  }: {
    children?: React.ReactNode;
    className?: string;
    data?: Array<{ displayDate?: string; displayLabel?: string }>;
    margin?: { bottom?: number; left?: number; right?: number; top?: number };
  }) => (
    <svg
      className={className}
      data-display-dates={data.map((day) => day.displayDate).join("|")}
      data-display-labels={data.map((day) => day.displayLabel).join("|")}
      data-margin-right={margin?.right ?? ""}
      data-testid="store-pulse-chart"
    >
      {children}
    </svg>
  ),
  CartesianGrid: () => null,
  XAxis: ({
    tickFormatter,
    ticks,
  }: {
    tickFormatter?: (value: number) => string;
    ticks?: number[];
  }) => (
    <g
      data-testid="store-pulse-x-axis"
      data-tick-labels={
        ticks?.map((tick) => tickFormatter?.(tick)).join("|") ?? ""
      }
      data-ticks={ticks?.join("|") ?? ""}
    />
  ),
  YAxis: () => null,
}));

vi.mock("@/components/ui/chart", () => ({
  ChartContainer: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="store-pulse-chart-container">{children}</div>
  ),
  ChartTooltip: () => null,
  ChartTooltipContent: () => null,
}));

vi.mock("~/convex/_generated/api", () => ({
  api: {
    operations: {
      dailyOperations: mockedApi,
    },
  },
}));

const weekMetrics = [
  {
    currentDayCashTotal: 0,
    currentDayCashTransactionCount: 0,
    expenseTotal: 0,
    expenseTransactionCount: 0,
    isClosed: true,
    isSelected: false,
    operatingDate: "2026-05-03",
    salesTotal: 70000,
    transactionCount: 1,
  },
  {
    currentDayCashTotal: 0,
    currentDayCashTransactionCount: 0,
    expenseTotal: 0,
    expenseTransactionCount: 0,
    isClosed: true,
    isSelected: false,
    operatingDate: "2026-05-04",
    salesTotal: 0,
    transactionCount: 0,
  },
  {
    currentDayCashTotal: 0,
    currentDayCashTransactionCount: 0,
    expenseTotal: 0,
    expenseTransactionCount: 0,
    isClosed: true,
    isSelected: false,
    operatingDate: "2026-05-05",
    salesTotal: 98000,
    transactionCount: 2,
  },
  {
    currentDayCashTotal: 0,
    currentDayCashTransactionCount: 0,
    expenseTotal: 0,
    expenseTransactionCount: 0,
    isClosed: false,
    isSelected: false,
    operatingDate: "2026-05-06",
    salesTotal: 0,
    transactionCount: 0,
  },
  {
    currentDayCashTotal: 0,
    currentDayCashTransactionCount: 0,
    expenseTotal: 0,
    expenseTransactionCount: 0,
    isClosed: false,
    isSelected: false,
    operatingDate: "2026-05-07",
    salesTotal: 45000,
    transactionCount: 1,
  },
  {
    currentDayCashTotal: 349100,
    currentDayCashTransactionCount: 2,
    expenseTotal: 19800,
    expenseTransactionCount: 1,
    isClosed: false,
    isSelected: true,
    operatingDate: "2026-05-08",
    salesTotal: 1533100,
    transactionCount: 3,
  },
  {
    currentDayCashTotal: 0,
    currentDayCashTransactionCount: 0,
    expenseTotal: 0,
    expenseTransactionCount: 0,
    isClosed: false,
    isSelected: false,
    operatingDate: "2026-05-09",
    salesTotal: 0,
    transactionCount: 0,
  },
] satisfies DailyOperationsSnapshot["weekMetrics"];

function buildStorePulseSummary({
  date = "2026-06-20",
  itemName = "Braiding hair",
  paymentLabel = "Cash",
  paymentMethod = "cash",
}: {
  date?: string;
  itemName?: string;
  paymentLabel?: string;
  paymentMethod?: string;
} = {}): NonNullable<DailyOperationsSnapshot["storePulse"]> {
  return {
    averageTransaction: 6_250,
    date,
    operatorSnapshot: {
      busiestHour: {
        hour: 14,
        label: "2 PM",
        totalSales: 12_500,
        transactionCount: 2,
      },
      comparison: {
        averageTransactionDeltaPercent: 25,
        currentAverageTransaction: 6_250,
        currentItemsSold: 3,
        currentSales: 12_500,
        currentTransactions: 2,
        itemsSoldDeltaPercent: 50,
        salesDeltaPercent: 25,
        transactionDeltaPercent: 0,
        yesterdayAverageTransaction: 5_000,
        yesterdayItemsSold: 2,
        yesterdaySales: 10_000,
        yesterdayTransactions: 2,
      },
      historyDays: 14,
      isLimited: false,
      paymentMix: [
        {
          count: 1,
          label: paymentLabel,
          method: paymentMethod,
          share: 60,
          total: 7_500,
        },
        {
          count: 1,
          label: "Card",
          method: "card",
          share: 40,
          total: 5_000,
        },
      ],
      topItems: [
        {
          name: itemName,
          productSku: "BRAID-1",
          quantity: 2,
          totalSales: 8_000,
        },
      ],
      trend: [
        {
          averageTransaction: 0,
          date: "2026-06-19",
          label: "Jun 19",
          totalItemsSold: 0,
          totalSales: 0,
          transactionCount: 0,
        },
        {
          averageTransaction: 6_250,
          date,
          label: "Selected day",
          totalItemsSold: 3,
          totalSales: 12_500,
          transactionCount: 2,
        },
      ],
      usableHistoryDays: 1,
    },
    totalItemsSold: 3,
    totalSales: 12_500,
    totalTransactions: 2,
  };
}

const operatingSnapshot: DailyOperationsSnapshot = {
  automationStatuses: [],
  attentionItems: [],
  closeSummary: {
    carriedOverCashTotal: 0,
    carriedOverRegisterCount: 0,
    currentDayCashTotal: 349100,
    currentDayCashTransactionCount: 2,
    expenseTotal: 19800,
    expenseTransactionCount: 1,
    netCashVariance: 0,
    paymentTotals: [
      { amount: 349100, method: "cash", transactionCount: 2 },
      { amount: 1184000, method: "mobile_money", transactionCount: 2 },
    ],
    registerVarianceCount: 0,
    salesTotal: 1533100,
    transactionCount: 3,
  },
  currency: "GHS",
  lanes: [
    {
      count: 0,
      description: "Opening handoff is complete.",
      key: "opening",
      label: "Opening",
      status: "ready",
      to: "/$orgUrlSlug/store/$storeUrlSlug/operations/opening",
    },
    {
      count: 0,
      description: "No close blockers are active.",
      key: "close",
      label: "EOD Review",
      status: "ready",
      to: "/$orgUrlSlug/store/$storeUrlSlug/operations/daily-close",
    },
    {
      count: 0,
      description: "No open queue work.",
      key: "queue",
      label: "Open work",
      status: "ready",
      to: "/$orgUrlSlug/store/$storeUrlSlug/operations/open-work",
    },
  ],
  lifecycle: {
    description:
      "Opening Handoff is complete and the end of day review has no blockers.",
    label: "Ready to close",
    status: "ready_to_close",
  },
  operatingDate: "2026-05-08",
  primaryAction: {
    label: "Start EOD Review",
    to: "/$orgUrlSlug/store/$storeUrlSlug/operations/daily-close",
  },
  storeId: "store-1" as Id<"store">,
  timeline: [],
  weekMetrics,
};

function buildWeekSnapshots(): DailyOperationsSnapshot[] {
  return weekMetrics.map((metric) => ({
    ...operatingSnapshot,
    closeSummary: {
      ...operatingSnapshot.closeSummary,
      currentDayCashTotal: metric.currentDayCashTotal,
      currentDayCashTransactionCount: metric.currentDayCashTransactionCount,
      expenseTotal: metric.expenseTotal,
      expenseTransactionCount: metric.expenseTransactionCount,
      salesTotal: metric.salesTotal,
      transactionCount: metric.transactionCount,
    },
    operatingDate: metric.operatingDate,
    storePulse: undefined,
    weekMetrics: weekMetrics.map((weekMetric) => ({
      ...weekMetric,
      isSelected: weekMetric.operatingDate === metric.operatingDate,
    })),
  }));
}

const blockedSnapshot: DailyOperationsSnapshot = {
  ...operatingSnapshot,
  attentionItems: [
    {
      id: "register_session:register-1:open",
      label: "Register session is still open",
      message:
        "Close the register session before completing the end of day review.",
      owner: "daily_close",
      severity: "critical",
      source: {
        id: "register-1",
        label: "Register 1",
        type: "register_session",
      },
      to: "/$orgUrlSlug/store/$storeUrlSlug/cash-controls/registers/$sessionId",
      params: { sessionId: "register-1" },
    },
  ],
  lanes: [
    ...operatingSnapshot.lanes,
    {
      count: 1,
      description: "1 register needs attention before close.",
      key: "registers",
      label: "Registers",
      status: "blocked",
      to: "/$orgUrlSlug/store/$storeUrlSlug/operations/daily-close",
    },
  ],
  lifecycle: {
    description: "Resolve close blockers before ending the store day.",
    label: "Close has blockers",
    status: "close_blocked",
  },
  primaryAction: {
    label: "Review close blockers",
    to: "/$orgUrlSlug/store/$storeUrlSlug/operations/daily-close",
  },
};

const notOpenedSnapshot: DailyOperationsSnapshot = {
  ...operatingSnapshot,
  lifecycle: {
    description: "Start Opening Handoff before running the store day.",
    label: "Not opened",
    status: "not_opened",
  },
  primaryAction: {
    label: "Start Opening Handoff",
    to: "/$orgUrlSlug/store/$storeUrlSlug/operations/opening",
  },
};

const closedSnapshot: DailyOperationsSnapshot = {
  ...operatingSnapshot,
  lanes: operatingSnapshot.lanes.map((lane) =>
    lane.key === "close"
      ? {
          ...lane,
          description: "The end of day review is saved for this store day.",
          status: "closed",
        }
      : lane,
  ),
  lifecycle: {
    description: "The store day has a saved close summary.",
    label: "Closed",
    status: "closed",
  },
  primaryAction: {
    label: "Review EOD Review",
    to: "/$orgUrlSlug/store/$storeUrlSlug/operations/daily-close",
  },
  timeline: [
    {
      createdAt: Date.UTC(2026, 4, 8, 22),
      id: "event-close",
      message: "EOD Review completed.",
      subject: {
        id: "close-1",
        type: "daily_close",
      },
      type: "daily_close.completed",
    },
    {
      createdAt: Date.UTC(2026, 4, 8, 8),
      id: "event-open",
      message: "Store day acknowledged for 2026-05-08.",
      subject: {
        id: "opening-1",
        type: "daily_opening",
      },
      type: "daily_opening.started",
    },
  ],
};

const timelineOverflowSnapshot: DailyOperationsSnapshot = {
  ...operatingSnapshot,
  timeline: Array.from({ length: 12 }, (_, index) => ({
    createdAt: Date.UTC(2026, 4, 8, 12, index),
    id: `event-${index + 1}`,
    message: `Timeline event ${index + 1}`,
    subject: {
      id: `subject-${index + 1}`,
      type: "operations",
    },
    type: "operations.event",
  })),
};

const compactTimelineOverflowSnapshot: DailyOperationsSnapshot = {
  ...operatingSnapshot,
  timeline: Array.from({ length: 5 }, (_, index) => ({
    createdAt: Date.UTC(2026, 4, 8, 12, index),
    id: `compact-event-${index + 1}`,
    message: `Compact timeline event ${index + 1}`,
    subject: {
      id: `compact-subject-${index + 1}`,
      type: "operations",
    },
    type: "operations.event",
  })),
  timelineHasMore: true,
};

const quickAddTimelineSnapshot: DailyOperationsSnapshot = {
  ...operatingSnapshot,
  timeline: [
    {
      createdAt: Date.UTC(2026, 4, 8, 12),
      id: "event-quick-add",
      message: "Kwamina Nuh quick added Vitamilk with quantity 100.",
      productLink: {
        label: "Vitamilk",
        params: {
          productSlug: "product-1",
        },
        search: {
          variant: "VITAMILK-001",
        },
        to: "/$orgUrlSlug/store/$storeUrlSlug/products/$productSlug",
      },
      subject: {
        id: "sku-1",
        label: "Vitamilk",
        type: "product_sku",
      },
      type: "pos_quick_add_product_created",
    },
  ],
};

const registerCloseoutTimelineSnapshot: DailyOperationsSnapshot = {
  ...operatingSnapshot,
  timeline: [
    {
      createdAt: Date.UTC(2026, 4, 8, 20, 45),
      id: "register_closeout:register-2:closed:1778273100000",
      message: "Register 2 closeout recorded with an exact cash match.",
      registerLink: {
        label: "Front counter / Register 2",
        matchLabel: "Register 2",
        params: {
          sessionId: "register-2",
        },
        to: "/$orgUrlSlug/store/$storeUrlSlug/cash-controls/registers/$sessionId",
      },
      subject: {
        id: "register-2",
        label: "Register 2",
        type: "register_session",
      },
      type: "register_session_closed",
    },
  ],
};

const registerSessionClosedTimelineSnapshot: DailyOperationsSnapshot = {
  ...operatingSnapshot,
  timeline: [
    {
      createdAt: Date.UTC(2026, 4, 8, 20, 45),
      id: "event-register-session-closed",
      message: "Register 80 closed with an exact cash match.",
      registerLink: {
        label: "M Supplies / Register 80",
        matchLabel: "Register 80",
        params: {
          sessionId: "register-session-80",
        },
        to: "/$orgUrlSlug/store/$storeUrlSlug/cash-controls/registers/$sessionId",
      },
      subject: {
        id: "register-session-80",
        label: "Register 80",
        type: "register_session",
      },
      type: "register_session_closed",
    },
  ],
};

const registerOpenedTimelineSnapshot: DailyOperationsSnapshot = {
  ...operatingSnapshot,
  timeline: [
    {
      createdAt: Date.UTC(2026, 4, 8, 10, 3),
      id: "event-register-opened",
      message: "Register 80 opened.",
      registerLink: {
        label: "M Supplies / Register 80",
        matchLabel: "Register 80",
        params: {
          sessionId: "register-session-80",
        },
        to: "/$orgUrlSlug/store/$storeUrlSlug/cash-controls/registers/$sessionId",
      },
      subject: {
        id: "register-session-80",
        label: "Register 80",
        type: "register_session",
      },
      type: "pos_local_sync.register_opened_projected",
    },
  ],
};

const posSyncedSaleTimelineSnapshot: DailyOperationsSnapshot = {
  ...operatingSnapshot,
  timeline: [
    {
      createdAt: Date.UTC(2026, 4, 8, 18),
      id: "event-pos-sale-synced",
      message: "Sale 946956 synced: 3 sale lines, GH₵1,039, cash.",
      subject: {
        id: "txn-946956",
        type: "posTransaction",
      },
      transactionLink: {
        label: "#946956",
        params: {
          transactionId: "txn-946956",
        },
        to: "/$orgUrlSlug/store/$storeUrlSlug/pos/transactions/$transactionId",
      },
      type: "pos_local_sync.sale_projected",
    },
  ],
};

const voidRequestedTimelineSnapshot: DailyOperationsSnapshot = {
  ...operatingSnapshot,
  timeline: [
    {
      createdAt: Date.UTC(2026, 4, 8, 15, 11),
      id: "event-void-requested",
      message: "Void requested by Joyce O. for Transaction #851031.",
      subject: {
        id: "transaction-851031",
        label: "Transaction #851031",
        type: "pos_transaction",
      },
      transactionLink: {
        label: "#851031",
        params: {
          transactionId: "transaction-851031",
        },
        to: "/$orgUrlSlug/store/$storeUrlSlug/pos/transactions/$transactionId",
      },
      type: "pos_transaction_void_approval_requested",
    },
  ],
};

const automationSnapshot: DailyOperationsSnapshot = {
  ...operatingSnapshot,
  automationStatuses: [
    {
      id: "automation-opening",
      lane: "opening",
      outcome: "applied",
      occurredAt: Date.UTC(2026, 4, 10, 8, 30),
      sourceLink: {
        to: "/$orgUrlSlug/store/$storeUrlSlug/operations/opening",
      },
    },
    {
      id: "automation-close",
      lane: "close",
      outcome: "prepared",
      occurredAt: Date.UTC(2026, 4, 10, 18, 15),
      sourceLink: {
        search: {
          operatingDate: "2026-05-10",
        },
        to: "/$orgUrlSlug/store/$storeUrlSlug/operations/daily-close",
      },
    },
  ],
  operatingDate: "2026-05-10",
};

const scheduledRunsSnapshot: DailyOperationsSnapshot = {
  ...operatingSnapshot,
  operatingDate: "2026-05-10",
  scheduledRunSummaries: [
    {
      candidateCount: 3,
      completedAt: Date.UTC(2026, 4, 10, 9, 30),
      cronFamily: "auto-verify-payments",
      failedCount: 1,
      id: "scheduled-partial",
      outcome: "partial_failure",
      processedCount: 3,
      skippedCount: 0,
      succeededCount: 2,
      windowEndAt: Date.UTC(2026, 4, 10, 9, 40),
      windowStartAt: Date.UTC(2026, 4, 10, 9, 30),
    },
    {
      candidateCount: 0,
      completedAt: Date.UTC(2026, 4, 10, 10, 30),
      cronFamily: "complete-checkout-sessions",
      failedCount: 0,
      id: "scheduled-zero",
      outcome: "no_candidates",
      processedCount: 0,
      skippedCount: 0,
      succeededCount: 0,
      windowEndAt: Date.UTC(2026, 4, 10, 11),
      windowStartAt: Date.UTC(2026, 4, 10, 10, 30),
    },
  ],
};

const automationReviewSnapshot: DailyOperationsSnapshot = {
  ...operatingSnapshot,
  automationStatuses: [
    {
      id: "automation-opening-review",
      lane: "opening",
      outcome: "applied",
      occurredAt: Date.UTC(2026, 4, 10, 8, 30),
      reviewEvidence: [
        {
          id: "register-session-review",
          label: "Register session still needs closeout",
          message: "Close the carried-over register session in Cash Controls.",
          source: {
            id: "session-1",
            label: "Register 1",
            type: "register_session",
          },
          sourceLink: {
            params: { sessionId: "session-1" },
            to: "/$orgUrlSlug/store/$storeUrlSlug/cash-controls/registers/$sessionId",
          },
        },
        {
          id: "cash-variance-review",
          label: "Cash variance reviewed at close",
          message: "Manager accepted a small cash variance during close.",
          source: {
            id: "close-1",
            type: "daily_close",
          },
        },
        {
          id: "pending-checkout-1",
          label: "Review pending checkout item: Ebin tinted lace",
          source: {
            id: "pending-checkout-1",
            label: "POS pending checkout",
            type: "pos_pending_checkout_item",
          },
          sourceLink: {
            to: "/$orgUrlSlug/store/$storeUrlSlug/operations/open-work",
          },
        },
        {
          id: "pending-checkout-2",
          label: "Review pending checkout item: Hooded dryer bonnet",
          source: {
            id: "pending-checkout-2",
            label: "POS pending checkout",
            type: "pos_pending_checkout_item",
          },
          sourceLink: {
            to: "/$orgUrlSlug/store/$storeUrlSlug/operations/open-work",
          },
        },
        {
          id: "pending-checkout-3",
          label: "Review pending checkout item: Eco lip balm",
          source: {
            id: "pending-checkout-3",
            label: "POS pending checkout",
            type: "pos_pending_checkout_item",
          },
        },
        {
          id: "pending-checkout-4",
          label: "Review pending checkout item: Hidden lace bond",
          source: {
            id: "pending-checkout-4",
            label: "POS pending checkout",
            type: "pos_pending_checkout_item",
          },
        },
      ],
      sourceLink: {
        to: "/$orgUrlSlug/store/$storeUrlSlug/operations/opening",
      },
    },
  ],
  operatingDate: "2026-05-10",
};

const staleSkippedAutomationSnapshot: DailyOperationsSnapshot = {
  ...closedSnapshot,
  automationStatuses: [
    {
      id: "automation-stale-skip",
      lane: "close",
      outcome: "skipped",
      sourceLink: {
        to: "/$orgUrlSlug/store/$storeUrlSlug/operations/daily-close",
      },
    },
  ],
};

const staleOpeningAutomationSnapshot: DailyOperationsSnapshot = {
  ...operatingSnapshot,
  automationStatuses: [
    {
      id: "automation-opening-dry-run",
      lane: "opening",
      outcome: "dry_run",
      sourceLink: {
        to: "/$orgUrlSlug/store/$storeUrlSlug/operations/opening",
      },
    },
  ],
};

const cycleCountSkuTimelineSnapshot: DailyOperationsSnapshot = {
  ...operatingSnapshot,
  timeline: [
    {
      createdAt: Date.UTC(2026, 4, 8, 18),
      id: "event-cycle-count-sku",
      message:
        "pos@wigclub.store counted AI Engineering (6N2Y-8T-6RM) as 24. Draft has 1 change",
      productLink: {
        label: "AI Engineering (6N2Y-8T-6RM)",
        params: {
          productSlug: "product-1",
        },
        search: {
          variant: "6N2Y-8T-6RM",
        },
        to: "/$orgUrlSlug/store/$storeUrlSlug/products/$productSlug",
      },
      subject: {
        id: "draft-1",
        label: "Cycle count draft",
        type: "cycle_count_draft",
      },
      type: "cycle_count_draft_updated",
    },
  ],
};

function getCurrentLocalOperatingDate() {
  const date = new Date();
  const localDate = new Date(
    date.getTime() - date.getTimezoneOffset() * 60_000,
  );

  return localDate.toISOString().slice(0, 10);
}

function getCurrentSaturdayWeekEndOperatingDate() {
  const date = new Date();
  const weekEndDate = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate() + (6 - date.getDay()),
  );
  const localDate = new Date(
    weekEndDate.getTime() - weekEndDate.getTimezoneOffset() * 60_000,
  );

  return localDate.toISOString().slice(0, 10);
}

function shiftTestOperatingDate(operatingDate: string, offsetDays: number) {
  const [year, month, day] = operatingDate.split("-").map(Number);
  const date = new Date(year, month - 1, day + offsetDays);
  const localDate = new Date(
    date.getTime() - date.getTimezoneOffset() * 60_000,
  );

  return localDate.toISOString().slice(0, 10);
}

function formatTestOperatingDate(operatingDate: string) {
  const [year, month, day] = operatingDate.split("-").map(Number);

  return new Date(year, month - 1, day).toLocaleDateString([], {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function renderContent(
  snapshot: DailyOperationsSnapshot | undefined,
  overrides: Partial<
    React.ComponentProps<typeof DailyOperationsViewContent>
  > = {},
) {
  const defaultTimelinePreviewSnapshot =
    snapshot && !overrides.timelinePreviewSnapshot
      ? {
          operatingDate: snapshot.operatingDate,
          timeline: snapshot.timeline.slice(0, 5),
          timelineHasMore:
            snapshot.timelineHasMore ?? snapshot.timeline.length > 5,
        }
      : undefined;

  return render(
    <DailyOperationsViewContent
      currency="GHS"
      hasDetailSnapshot
      hasFullAdminAccess
      hasFinancialDetailsAccess
      isAuthenticated
      isLoadingAccess={false}
      isLoadingSnapshot={snapshot === undefined}
      orgUrlSlug="wigclub"
      snapshot={snapshot}
      storePulseWindow="today"
      storeUrlSlug="osu"
      timelinePreviewSnapshot={defaultTimelinePreviewSnapshot}
      {...overrides}
    />,
  );
}

describe("DailyOperationsViewContent", () => {
  let scrollIntoViewMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 4, 10, 12));
    window.scrollTo = vi.fn();
    scrollIntoViewMock = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoViewMock;
    HTMLElement.prototype.scrollIntoView = scrollIntoViewMock;
    window.history.pushState({}, "", "/wigclub/store/osu/operations");
    mockedHooks.navigate.mockReset();
    mockedHooks.useIsMobile.mockReset();
    mockedHooks.useIsMobile.mockReturnValue(false);
    mockedHooks.useSearch.mockReturnValue({});
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders historical metrics with view-only workflow messaging", () => {
    renderContent(operatingSnapshot);

    expect(
      screen.getByRole("heading", { name: "Daily Operations" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Net sales")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Open transactions" }),
    ).toHaveAttribute(
      "href",
      "/wigclub/store/osu/pos/transactions?o=%252Fwigclub%252Fstore%252Fosu%252Foperations&operatingDate=2026-05-08",
    );
    expect(screen.getAllByText("GH₵15,331")).not.toHaveLength(0);
    expect(screen.getAllByText("3 transactions")).not.toHaveLength(0);
    expect(screen.getByText("Cash")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Open cash transactions" }),
    ).toHaveAttribute(
      "href",
      "/wigclub/store/osu/pos/transactions?o=%252Fwigclub%252Fstore%252Fosu%252Foperations&operatingDate=2026-05-08&paymentMethod=cash",
    );
    expect(screen.getByText("GH₵3,491")).toBeInTheDocument();
    expect(screen.getByText("2 cash transactions")).toBeInTheDocument();
    expect(screen.getByText("Mobile Money")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Open Mobile Money transactions" }),
    ).toHaveAttribute(
      "href",
      "/wigclub/store/osu/pos/transactions?o=%252Fwigclub%252Fstore%252Fosu%252Foperations&operatingDate=2026-05-08&paymentMethod=mobile_money",
    );
    expect(screen.getByText("GH₵11,840")).toBeInTheDocument();
    expect(screen.getByText("2 payments")).toBeInTheDocument();
    expect(screen.getByText("Carried-over cash")).toBeInTheDocument();
    expect(screen.getAllByText("GH₵0")).not.toHaveLength(0);
    expect(
      screen.getByText("No registers from prior days"),
    ).toBeInTheDocument();
    expect(screen.getByText("Expenses")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Open expense reports" }),
    ).toHaveAttribute(
      "href",
      "/wigclub/store/osu/pos/expense-reports?o=%252Fwigclub%252Fstore%252Fosu%252Foperations&operatingDate=2026-05-08",
    );
    expect(screen.getByText("GH₵198")).toBeInTheDocument();
    expect(screen.getByText("1 expense transaction")).toBeInTheDocument();
    expect(screen.queryByText("Variance")).not.toBeInTheDocument();
    expect(screen.queryByText("No register variances")).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Week at a glance" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Week sales")).toBeInTheDocument();
    expect(screen.getByText("GH₵17,461")).toBeInTheDocument();
    expect(
      screen.getByRole("link", {
        name: "Previous week, seven days ending May 2, 2026",
      }),
    ).toHaveAttribute(
      "href",
      "/wigclub/store/osu/operations?operatingDate=2026-04-26&weekEndOperatingDate=2026-05-02",
    );
    expect(
      screen.getByRole("link", {
        name: "Next week, seven days ending May 16, 2026",
      }),
    ).toHaveAttribute(
      "href",
      "/wigclub/store/osu/operations?weekEndOperatingDate=2026-05-16",
    );
    expect(
      screen.getByRole("link", { name: "View May 7, 2026 operations" }),
    ).toHaveAttribute(
      "href",
      "/wigclub/store/osu/operations?operatingDate=2026-05-07&weekEndOperatingDate=2026-05-09",
    );
    expect(
      screen.getByRole("link", { name: "View May 6, 2026 operations" }),
    ).not.toContainHTML("width:");
    expect(
      screen.getByRole("link", { name: "View May 8, 2026 operations" }),
    ).toHaveAttribute("aria-current", "date");
    expect(scrollIntoViewMock).toHaveBeenCalledWith({
      behavior: "auto",
      block: "nearest",
      inline: "center",
    });
    expect(
      screen.getByRole("button", {
        name: "Change operating date, currently Friday, May 8, 2026",
      }),
    ).toBeDisabled();
    expect(
      screen.queryByRole("link", { name: "Start EOD Review" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Historical store-day view" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", {
        name: "Review EOD Review for Friday, May 8, 2026",
      }),
    ).toHaveAttribute(
      "href",
      "/wigclub/store/osu/operations/daily-close?o=%252Fwigclub%252Fstore%252Fosu%252Foperations&operatingDate=2026-05-08",
    );
    expect(screen.queryByText("Workflow status")).not.toBeInTheDocument();
    expect(screen.queryByText("Current day only")).not.toBeInTheDocument();
    expect(screen.queryByText("Needs attention")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Open Opening" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Open EOD Review" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Open Open work" }),
    ).not.toBeInTheDocument();
  });

  it("redacts financial metrics when a POS-only user has no manager elevation", () => {
    renderContent(operatingSnapshot, {
      hasFinancialDetailsAccess: false,
    });

    expect(screen.queryByText("GH₵15,331")).not.toBeInTheDocument();
    expect(screen.queryByText("GH₵3,491")).not.toBeInTheDocument();
    expect(screen.queryByText("GH₵17,461")).not.toBeInTheDocument();
    expect(screen.getAllByText("Manager only")).not.toHaveLength(0);
    expect(screen.getAllByText("3 transactions")).not.toHaveLength(0);
    expect(screen.getByText("2 cash transactions")).toBeInTheDocument();
    expect(screen.queryByText(/vs prior day/)).not.toBeInTheDocument();
    expect(
      screen.queryByText(/No payments on prior day/),
    ).not.toBeInTheDocument();
  });

  it("uses today labels and current-day transaction links for the current operating date", () => {
    renderContent({
      ...operatingSnapshot,
      operatingDate: getCurrentLocalOperatingDate(),
      storePulse: buildStorePulseSummary(),
    });

    expect(screen.getByText("Today's net sales")).toBeInTheDocument();
    expect(screen.getByText("Today's cash")).toBeInTheDocument();
    expect(screen.getByText("Today's top items")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Open transactions" }),
    ).toHaveAttribute(
      "href",
      "/wigclub/store/osu/pos/transactions?o=%252Fwigclub%252Fstore%252Fosu%252Foperations",
    );
    expect(
      screen.getByRole("link", { name: "Open cash transactions" }),
    ).toHaveAttribute(
      "href",
      "/wigclub/store/osu/pos/transactions?o=%252Fwigclub%252Fstore%252Fosu%252Foperations&paymentMethod=cash",
    );
    expect(
      screen.getByRole("link", { name: "Open Mobile Money transactions" }),
    ).toHaveAttribute(
      "href",
      "/wigclub/store/osu/pos/transactions?o=%252Fwigclub%252Fstore%252Fosu%252Foperations&paymentMethod=mobile_money",
    );
    expect(
      screen.getByRole("link", { name: "Open expense reports" }),
    ).toHaveAttribute(
      "href",
      "/wigclub/store/osu/pos/expense-reports?o=%252Fwigclub%252Fstore%252Fosu%252Foperations",
    );
    expect(
      screen.getByRole("link", { name: "Start EOD Review" }),
    ).toHaveAttribute(
      "href",
      "/wigclub/store/osu/operations/daily-close?o=%252Fwigclub%252Fstore%252Fosu%252Foperations",
    );
    expect(screen.queryByText("Current day only")).not.toBeInTheDocument();
    expect(screen.getByText("No active workflow blockers")).toBeInTheDocument();
    expect(screen.getByLabelText("Workflow clear")).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Open Opening" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Open EOD Review" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Open Open work" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Open Close history workspace" }),
    ).toHaveAttribute(
      "href",
      "/wigclub/store/osu/operations/daily-close-history?o=%252Fwigclub%252Fstore%252Fosu%252Foperations",
    );
    expect(
      screen.getByRole("link", { name: "Open Stock adjustments workspace" }),
    ).toHaveAttribute(
      "href",
      "/wigclub/store/osu/operations/stock-adjustments?o=%252Fwigclub%252Fstore%252Fosu%252Foperations",
    );
    expect(
      screen.getByRole("link", { name: "Open SKU activity workspace" }),
    ).toHaveAttribute(
      "href",
      "/wigclub/store/osu/operations/sku-activity?o=%252Fwigclub%252Fstore%252Fosu%252Foperations",
    );
    expect(
      screen.queryByRole("link", { name: "Open Opening Handoff workspace" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Open EOD Review workspace" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Open Open work workspace" }),
    ).not.toBeInTheDocument();
  });

  it("shows normalized automation status for the current store day", () => {
    renderContent(automationSnapshot);

    expect(
      screen.getByRole("heading", { name: "Athena automation" }),
    ).toBeInTheDocument();
    const automationHeading = screen.getByRole("heading", {
      name: "Athena automation",
    });
    const automationPanel = automationHeading.closest("section");
    const netSalesMetric = screen.getByText(/^(Today's net sales|Net sales)$/);

    expect(automationPanel).toHaveClass("py-layout-sm", "rounded-md");
    expect(automationHeading).toHaveClass(
      "text-sm",
      "font-medium",
      "text-foreground",
    );
    expect(automationHeading.parentElement).toHaveClass("gap-layout-md");
    expect(automationHeading.parentElement?.lastElementChild).toHaveClass(
      "divide-y",
      "divide-border/70",
    );
    const automationTime = within(automationPanel!).getByText(/[48]:30 AM/);

    expect(automationTime).toHaveClass("tabular-nums");
    expect(automationTime.parentElement).toHaveClass("mt-1.5");
    expect(
      automationHeading.compareDocumentPosition(netSalesMetric) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      automationHeading.compareDocumentPosition(
        screen.getByRole("heading", { name: "Week at a glance" }),
      ) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      screen.getByText("Athena started Opening Handoff."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Athena prepared EOD Review for manager review."),
    ).toBeInTheDocument();
    const closeAutomationMessage = screen.getByText(
      "Athena prepared EOD Review for manager review.",
    );

    expect(closeAutomationMessage).not.toHaveClass("truncate");
    expect(closeAutomationMessage).toHaveClass("break-words", "leading-5");
    expect(
      screen.getByRole("link", {
        name: "Open Opening Handoff automation source",
      }),
    ).toHaveAttribute(
      "href",
      "/wigclub/store/osu/operations/opening?o=%252Fwigclub%252Fstore%252Fosu%252Foperations",
    );
    expect(
      screen.getByRole("link", { name: "Open EOD Review automation source" }),
    ).toHaveAttribute(
      "href",
      "/wigclub/store/osu/operations/daily-close?o=%252Fwigclub%252Fstore%252Fosu%252Foperations&operatingDate=2026-05-10",
    );
    const closeAutomationLink = screen.getByRole("link", {
      name: "Open EOD Review automation source",
    });
    const closeAutomationRow = closeAutomationLink.closest("article");

    expect(closeAutomationRow).toHaveClass(
      "py-layout-sm",
      "sm:flex-row",
      "sm:justify-between",
    );
    expect(closeAutomationLink).toHaveClass("sm:ml-layout-md", "self-start");
  });

  it("shows Athena completion attribution for a closed store day", () => {
    renderContent({
      ...closedSnapshot,
      completedClose: {
        actorType: "automation",
        automationDecisionReason:
          "EOD Review has only low-risk review evidence within policy thresholds.",
        completedAt: Date.UTC(2026, 4, 8, 22),
      },
    } as DailyOperationsSnapshot);

    expect(
      screen.getByText("Athena completed EOD Review under store policy."),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Policy checked low-risk review evidence before completion.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(
        "Policy checked low-risk review evidence and preserved carry-forward work for Opening.",
      ),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/manager approved/i)).not.toBeInTheDocument();
  });

  it("shows preserved carry-forward copy when the completed close has carry-forward", () => {
    renderContent({
      ...closedSnapshot,
      completedClose: {
        actorType: "automation",
        automationDecisionReason:
          "EOD Review has only low-risk review evidence within policy thresholds.",
        carryForwardCount: 1,
        completedAt: Date.UTC(2026, 4, 8, 22),
      },
    } as DailyOperationsSnapshot);

    expect(
      screen.getByText(
        "Policy checked low-risk review evidence and preserved carry-forward work for Opening.",
      ),
    ).toBeInTheDocument();
  });

  it("shows safe Athena completion attribution when details are redacted", () => {
    renderContent({
      ...closedSnapshot,
      completedClose: {
        actorType: "automation",
        completedAt: Date.UTC(2026, 4, 8, 22),
        restrictedDetailsRedacted: true,
      },
    } as DailyOperationsSnapshot);

    expect(
      screen.getByText("Athena completed EOD Review under store policy."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Restricted close evidence is hidden for this account."),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(
        "Policy checked low-risk review evidence and preserved carry-forward work for Opening.",
      ),
    ).not.toBeInTheDocument();
  });

  it("keeps scheduled-run evidence off the daily operations workspace", () => {
    renderContent(scheduledRunsSnapshot);

    expect(
      screen.queryByRole("heading", { name: "Scheduled runs" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/Payment verification partially ran/i),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/Checkout completion ran/i),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/provider|exception|stack/i),
    ).not.toBeInTheDocument();
  });

  it("renders store pulse visualizations in the main workspace when provided", () => {
    vi.useRealTimers();

    renderContent(
      {
        ...operatingSnapshot,
        storePulse: buildStorePulseSummary(),
      },
      {
        storePulseWindow: "this_week",
      },
    );

    const storePulse = screen.getByRole("region", { name: "Store pulse" });
    const chart = within(storePulse).getByTestId("store-pulse-chart");
    const chartContainer = within(storePulse).getByTestId(
      "store-pulse-chart-container",
    );

    expect(within(storePulse).getByText("Sales trend")).toBeInTheDocument();
    expect(chart).toBeInTheDocument();
    expect(chartContainer.parentElement).toHaveClass(
      "px-layout-sm",
      "py-8",
      "sm:p-8",
    );
    expect(chart).toHaveAttribute(
      "data-display-labels",
      "Sun, May 3|Mon, May 4|Tue, May 5|Wed, May 6|Thu, May 7|Fri, May 8",
    );
    expect(
      within(storePulse).getByTestId("store-pulse-x-axis"),
    ).toHaveAttribute("data-ticks", "0|1|2|3|4|5");
    expect(chart).toHaveAttribute("data-margin-right", "72");
    expect(within(storePulse).getByText("Braiding Hair")).toBeInTheDocument();
    expect(within(storePulse).getByText("Top items")).toBeInTheDocument();
    expect(
      within(storePulse).getByLabelText("Total items sold: 3"),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Store-day timeline")).toBeInTheDocument();
    expect(within(storePulse).queryByRole("tablist")).not.toBeInTheDocument();
    expect(
      within(storePulse).queryByText("Average sale"),
    ).not.toBeInTheDocument();
    expect(
      within(storePulse).queryByText("Items sold"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Store pulse")).not.toBeInTheDocument();
    expect(
      screen.queryByText(
        "POS sales activity for the selected reporting window.",
      ),
    ).not.toBeInTheDocument();
    expect(
      within(storePulse).getByText("This week's completed POS sales."),
    ).toBeInTheDocument();
  });

  it("uses evenly spaced store pulse trend ticks on mobile", () => {
    vi.useRealTimers();
    mockedHooks.useIsMobile.mockReturnValue(true);

    renderContent(
      {
        ...operatingSnapshot,
        storePulse: buildStorePulseSummary(),
      },
      {
        storePulseWindow: "this_week",
      },
    );

    const storePulse = screen.getByRole("region", { name: "Store pulse" });
    const xAxis = within(storePulse).getByTestId("store-pulse-x-axis");

    expect(xAxis).toHaveAttribute("data-ticks", "0|2.5|5");
    expect(xAxis).toHaveAttribute(
      "data-tick-labels",
      "Sun, May 3|Wed, May 6|Fri, May 8",
    );
  });

  it("omits store pulse detail when no pulse data or request handler is available", () => {
    renderContent(operatingSnapshot);

    expect(
      screen.queryByRole("region", { name: "Store pulse" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText("Store pulse loading"),
    ).not.toBeInTheDocument();
  });

  it("surfaces Opening auto-start review evidence for managers", () => {
    renderContent(automationReviewSnapshot);

    expect(
      screen.getByRole("link", { name: "Start EOD Review" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Opening Handoff has carry-forward review items."),
    ).toBeInTheDocument();
    expect(screen.getByText("Pending checkout")).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(
      screen.getByText("2 other manager review items"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Register session still needs closeout"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("Cash variance reviewed at close"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Ebin tinted lace")).not.toBeInTheDocument();
    expect(screen.queryByText("Hooded dryer bonnet")).not.toBeInTheDocument();
    expect(screen.queryByText("Eco lip balm")).not.toBeInTheDocument();
    expect(screen.queryByText("Hidden lace bond")).not.toBeInTheDocument();
    expect(
      screen.queryByText("3 more items in the full Opening workflow."),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", {
        name: "Review all Opening Handoff review items",
      }),
    ).toHaveAttribute(
      "href",
      "/wigclub/store/osu/operations/opening?o=%252Fwigclub%252Fstore%252Fosu%252Foperations",
    );
    const openingReview = screen
      .getByRole("heading", { name: "Opening review" })
      .closest("section");
    const timeline = screen.getByLabelText("Store-day timeline");
    const workflowSection = screen
      .getByRole("heading", { name: "Workflow status" })
      .closest("section");

    expect(openingReview?.parentElement).toBe(timeline.parentElement);
    expect(timeline.compareDocumentPosition(openingReview!)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(openingReview?.compareDocumentPosition(workflowSection!)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it("places Opening review below automation on mobile", () => {
    mockedHooks.useIsMobile.mockReturnValue(true);

    renderContent(automationReviewSnapshot);

    const automationPanel = screen
      .getByRole("heading", { name: "Athena automation" })
      .closest("section");
    const openingReview = screen
      .getByRole("heading", { name: "Opening review" })
      .closest("section");
    const netSalesMetric = screen
      .getByText("Today's net sales")
      .closest("a,article,div");

    expect(
      screen.getAllByRole("heading", { name: "Opening review" }),
    ).toHaveLength(1);
    expect(automationPanel?.compareDocumentPosition(openingReview!)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(openingReview?.compareDocumentPosition(netSalesMetric!)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it("passes historical operating dates to Opening Handoff review links", () => {
    renderContent({
      ...automationReviewSnapshot,
      operatingDate: "2026-05-08",
    });

    expect(
      screen.getByRole("link", {
        name: "Review all Opening Handoff review items",
      }),
    ).toHaveAttribute(
      "href",
      "/wigclub/store/osu/operations/opening?o=%252Fwigclub%252Fstore%252Fosu%252Foperations&operatingDate=2026-05-08",
    );
  });

  it("keeps closed lifecycle state primary over stale skipped automation decisions", () => {
    renderContent(staleSkippedAutomationSnapshot);

    expect(screen.getByText("Closed store-day record")).toBeInTheDocument();
    expect(screen.queryByText("Athena automation")).not.toBeInTheDocument();
    expect(
      screen.queryByText("Athena checked EOD Review. No change was made."),
    ).not.toBeInTheDocument();
  });

  it("keeps scheduled-later EOD automation checks quiet", () => {
    renderContent({
      ...operatingSnapshot,
      automationStatuses: [
        {
          bucket: "scheduled_later",
          id: "automation-close-scheduled-later",
          lane: "close",
          outcome: "skipped",
          sourceLink: {
            to: "/$orgUrlSlug/store/$storeUrlSlug/operations/daily-close",
          },
        },
      ],
    });

    expect(screen.queryByText("Athena automation")).not.toBeInTheDocument();
    expect(
      screen.queryByText("Athena checked EOD Review. No change was made."),
    ).not.toBeInTheDocument();
  });

  it("keeps opened lifecycle state primary over stale Opening automation decisions", () => {
    renderContent(staleOpeningAutomationSnapshot);

    expect(screen.queryByText("Athena automation")).not.toBeInTheDocument();
    expect(
      screen.queryByText(
        "Athena checked Opening Handoff in dry run. No workflow changes were made.",
      ),
    ).not.toBeInTheDocument();
  });

  it.each(["disabled", "dry_run", "failed", "eligible"] as const)(
    "keeps closed lifecycle state primary over stale %s automation decisions",
    (outcome) => {
      renderContent({
        ...closedSnapshot,
        automationStatuses: [
          {
            id: `automation-stale-${outcome}`,
            lane: "close",
            outcome,
            sourceLink: {
              to: "/$orgUrlSlug/store/$storeUrlSlug/operations/daily-close",
            },
          },
        ],
      });

      expect(screen.getByText("Closed store-day record")).toBeInTheDocument();
      expect(screen.queryByText("Athena automation")).not.toBeInTheDocument();
    },
  );

  it("incorporates workflow lane counts into the description", () => {
    renderContent({
      ...operatingSnapshot,
      lanes: [
        ...operatingSnapshot.lanes,
        {
          count: 2,
          countLabel: "2 registers",
          description: "2 registers need attention before close.",
          key: "registers",
          label: "Registers",
          status: "blocked",
          to: "/$orgUrlSlug/store/$storeUrlSlug/operations/daily-close",
        },
      ],
      operatingDate: getCurrentLocalOperatingDate(),
    });

    const workflowSection = screen
      .getByRole("heading", { name: "Workflow status" })
      .closest("section");

    expect(workflowSection).not.toBeNull();
    const workflow = within(workflowSection!);

    expect(workflow.queryByText("0")).not.toBeInTheDocument();
    expect(workflow.queryByText("2 registers")).not.toBeInTheDocument();
    expect(
      workflow.getByText("2 registers need attention before close."),
    ).toBeInTheDocument();
  });

  it("uses compact icons for workflow lanes that need attention or are blocked", () => {
    renderContent({
      ...operatingSnapshot,
      lanes: [
        {
          ...operatingSnapshot.lanes[0],
          status: "ready",
        },
        {
          ...operatingSnapshot.lanes[1],
          description: "EOD Review was reopened and needs a revised close.",
          status: "needs_attention",
        },
        {
          count: 2,
          description: "2 registers need attention before close.",
          key: "registers",
          label: "Registers",
          status: "blocked",
          to: "/$orgUrlSlug/store/$storeUrlSlug/operations/daily-close",
        },
      ],
      operatingDate: getCurrentLocalOperatingDate(),
    });

    expect(
      screen.getByLabelText("EOD Review needs attention"),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Registers blocked")).toBeInTheDocument();
    expect(screen.queryByText("Opening")).not.toBeInTheDocument();
    expect(screen.queryByText("Needs attention")).not.toBeInTheDocument();
    expect(screen.queryByText("Blocked")).not.toBeInTheDocument();
  });

  it("marks reopened operating days in the week strip", () => {
    renderContent({
      ...operatingSnapshot,
      operatingDate: getCurrentLocalOperatingDate(),
      weekMetrics: [
        {
          ...weekMetrics[0],
          isClosed: false,
          isReopened: true,
          isSelected: true,
          operatingDate: getCurrentLocalOperatingDate(),
        },
      ],
    });

    expect(screen.getByText("Reopened")).toBeInTheDocument();
    expect(screen.queryByText("Closed")).not.toBeInTheDocument();
  });

  it("uses prior-day metric for card comparisons when yesterday is outside the visible week", () => {
    const currentOperatingDate = getCurrentLocalOperatingDate();
    const priorOperatingDate = shiftTestOperatingDate(currentOperatingDate, -1);
    const futureOperatingDate = shiftTestOperatingDate(currentOperatingDate, 1);

    renderContent({
      ...operatingSnapshot,
      closeSummary: {
        ...operatingSnapshot.closeSummary,
        salesTotal: 1533100,
        transactionCount: 3,
      },
      operatingDate: currentOperatingDate,
      priorDayMetric: {
        ...weekMetrics[0],
        currentDayCashTotal: 200000,
        currentDayCashTransactionCount: 1,
        isClosed: false,
        isSelected: false,
        operatingDate: priorOperatingDate,
        paymentTotals: [
          { amount: 200000, method: "cash", transactionCount: 1 },
          { amount: 800000, method: "mobile_money", transactionCount: 1 },
        ],
        salesTotal: 1000000,
        transactionCount: 2,
      },
      weekMetrics: [
        {
          ...weekMetrics[0],
          isClosed: false,
          isSelected: true,
          operatingDate: currentOperatingDate,
          salesTotal: 1533100,
          transactionCount: 3,
        },
        {
          ...weekMetrics[1],
          isClosed: false,
          isSelected: false,
          operatingDate: futureOperatingDate,
          salesTotal: 0,
          transactionCount: 0,
        },
      ],
    });

    expect(screen.getByText("+53%")).toBeInTheDocument();
    expect(screen.getAllByText("vs yesterday").length).toBeGreaterThan(0);
    expect(screen.queryAllByText("None yesterday")).toHaveLength(0);
  });

  it("uses payment-specific copy when a prior-day payment method has no entries", () => {
    renderContent(operatingSnapshot);

    expect(
      screen.getAllByText("No payments on prior day").length,
    ).toBeGreaterThan(0);
    expect(
      screen.queryByText("3 payments · No activity on prior day"),
    ).toBeNull();
  });

  it("disables future dates in the week strip", () => {
    const currentOperatingDate = getCurrentLocalOperatingDate();
    const futureOperatingDate = shiftTestOperatingDate(currentOperatingDate, 1);
    const futureDateLabel = formatTestOperatingDate(futureOperatingDate);

    renderContent({
      ...operatingSnapshot,
      operatingDate: currentOperatingDate,
      weekMetrics: [
        {
          ...weekMetrics[0],
          isClosed: false,
          isSelected: true,
          operatingDate: currentOperatingDate,
          salesTotal: 748500,
          transactionCount: 1,
        },
        {
          ...weekMetrics[1],
          isClosed: false,
          isSelected: false,
          operatingDate: futureOperatingDate,
          salesTotal: 0,
          transactionCount: 0,
        },
      ],
    });

    expect(
      screen.queryByRole("link", {
        name: `View ${futureDateLabel} operations`,
      }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByLabelText(`${futureDateLabel} operations unavailable`),
    ).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText("-")).toBeInTheDocument();
    expect(screen.getByText("Upcoming")).toBeInTheDocument();
  });

  it("disables historical start actions that would mutate the store day", () => {
    renderContent(notOpenedSnapshot);

    expect(
      screen.queryByRole("link", { name: "Start Opening Handoff" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Review EOD Review" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Historical store-day view" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "This historical operating date is view-only. Workflow actions are available only on the current operating date.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("Needs attention")).not.toBeInTheDocument();
    expect(screen.queryByText("Workflow status")).not.toBeInTheDocument();
  });

  it("links historical started store days to EOD Review even before close", () => {
    renderContent(operatingSnapshot);

    expect(
      screen.getByRole("heading", { name: "Historical store-day view" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", {
        name: "Review EOD Review for Friday, May 8, 2026",
      }),
    ).toHaveAttribute(
      "href",
      "/wigclub/store/osu/operations/daily-close?o=%252Fwigclub%252Fstore%252Fosu%252Foperations&operatingDate=2026-05-08",
    );
    expect(
      screen.queryByRole("link", { name: "Review EOD Review" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(
        "This historical operating date is view-only. Workflow actions are available only on the current operating date.",
      ),
    ).toBeInTheDocument();
  });

  it("keeps current-day opening actions available", () => {
    renderContent({
      ...notOpenedSnapshot,
      operatingDate: getCurrentLocalOperatingDate(),
    });

    expect(
      screen.getByRole("link", { name: "Start Opening Handoff" }),
    ).toHaveAttribute(
      "href",
      "/wigclub/store/osu/operations/opening?o=%252Fwigclub%252Fstore%252Fosu%252Foperations",
    );
  });

  it("surfaces pending approval requests on the leading side of the action strip", () => {
    renderContent({
      ...blockedSnapshot,
      lanes: [
        ...blockedSnapshot.lanes,
        {
          count: 2,
          countLabel: "2",
          description: "2 approvals pending.",
          key: "approvals",
          label: "Approvals",
          status: "blocked",
          to: "/$orgUrlSlug/store/$storeUrlSlug/operations/approvals",
        },
      ],
      operatingDate: getCurrentLocalOperatingDate(),
    });

    const approvalLink = screen.getByRole("link", {
      name: "Open 2 pending approvals",
    });
    const operatingDateButton = screen.getByRole("button", {
      name: /Change operating date/,
    });

    expect(approvalLink).toHaveAttribute(
      "href",
      "/wigclub/store/osu/operations/approvals?o=%252Fwigclub%252Fstore%252Fosu%252Foperations",
    );
    expect(approvalLink).toHaveClass("w-full", "sm:w-auto");
    expect(within(approvalLink).getByText("2")).toHaveClass(
      "font-semibold",
      "tabular-nums",
    );
    expect(within(approvalLink).getByText("pending approvals")).toHaveClass(
      "text-muted-foreground",
    );
    expect(
      approvalLink.compareDocumentPosition(operatingDateButton) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Review close blockers" }),
    ).toBeInTheDocument();
  });

  it("passes origin context to current-day blocker review actions", () => {
    renderContent({
      ...blockedSnapshot,
      operatingDate: getCurrentLocalOperatingDate(),
    });

    expect(
      screen.getByRole("link", { name: "Review close blockers" }),
    ).toHaveAttribute(
      "href",
      "/wigclub/store/osu/operations/daily-close?o=%252Fwigclub%252Fstore%252Fosu%252Foperations",
    );
    expect(
      screen.getByRole("link", { name: "Open Registers" }),
    ).toHaveAttribute(
      "href",
      "/wigclub/store/osu/operations/daily-close?o=%252Fwigclub%252Fstore%252Fosu%252Foperations",
    );
  });

  it("keeps attention items out of the right rail", () => {
    renderContent(blockedSnapshot);

    expect(
      screen.queryByRole("link", { name: "Review close blockers" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Historical store-day view" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByLabelText("Operator attention"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("Register session is still open"),
    ).not.toBeInTheDocument();
  });

  it("keeps historical EOD Review links on the selected operating date", () => {
    renderContent(closedSnapshot);

    expect(
      screen.getByRole("heading", { name: "Closed store-day record" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(
        "This operating date is closed. The saved The end of day review is available for this store-day record.",
      ),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(
        "Metrics and timeline remain available for this historical day.",
      ),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Review EOD Review" }),
    ).toHaveAttribute(
      "href",
      "/wigclub/store/osu/operations/daily-close?o=%252Fwigclub%252Fstore%252Fosu%252Foperations&operatingDate=2026-05-08",
    );
    expect(
      screen.getByRole("link", {
        name: "Review EOD Review for Friday, May 8, 2026",
      }),
    ).toHaveAttribute(
      "href",
      "/wigclub/store/osu/operations/daily-close?o=%252Fwigclub%252Fstore%252Fosu%252Foperations&operatingDate=2026-05-08",
    );
    expect(screen.queryByText("Workflow status")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Open EOD Review" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", {
        name: "Open EOD Review unavailable for May 8, 2026",
      }),
    ).not.toBeInTheDocument();
  });

  it("renders closed-day review timeline without mutation copy", () => {
    renderContent(closedSnapshot);

    expect(
      screen.getByRole("link", { name: "Review EOD Review" }),
    ).toBeInTheDocument();
    expect(screen.getByText("EOD Review completed.")).toBeInTheDocument();
    expect(
      screen.getByText("Store day acknowledged for May 8, 2026."),
    ).toBeInTheDocument();
    expect(screen.queryByText("2026-05-08")).not.toBeInTheDocument();
    expect(screen.queryByText("Complete EOD Review")).not.toBeInTheDocument();
  });

  it("previews the five most recent timeline events and opens the full list in a sheet", () => {
    renderContent(timelineOverflowSnapshot, {
      timelineSnapshot: {
        operatingDate: timelineOverflowSnapshot.operatingDate,
        timeline: timelineOverflowSnapshot.timeline,
      },
    });

    const timeline = screen.getByRole("region", {
      name: "Store-day timeline",
    });

    expect(within(timeline).getByText("Timeline event 1")).toBeInTheDocument();
    expect(within(timeline).getByText("Timeline event 5")).toBeInTheDocument();
    expect(
      within(timeline).queryByText("Timeline event 6"),
    ).not.toBeInTheDocument();

    fireEvent.click(
      within(timeline).getByRole("button", { name: "Show more" }),
    );

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getAllByText("Store-day timeline")).not.toHaveLength(0);
    expect(
      screen.getByText("All recorded events for Friday, May 8, 2026."),
    ).toBeInTheDocument();
    expect(screen.getByText("Timeline event 6")).toBeInTheDocument();
    expect(screen.getByText("Timeline event 12")).toBeInTheDocument();
  });

  it("offers timeline detail when the compact snapshot has hidden events", () => {
    const onRequestTimelineSnapshot = vi.fn();

    renderContent(compactTimelineOverflowSnapshot, {
      onRequestTimelineSnapshot,
    });

    const timeline = screen.getByRole("region", {
      name: "Store-day timeline",
    });

    expect(
      within(timeline).getByText("Compact timeline event 5"),
    ).toBeInTheDocument();

    fireEvent.click(
      within(timeline).getByRole("button", { name: "Show more" }),
    );

    expect(onRequestTimelineSnapshot).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Timeline loading")).toBeInTheDocument();
  });

  it("links quick-add product names to the product detail page with origin search", () => {
    renderContent(quickAddTimelineSnapshot);

    const productLink = screen.getByRole("link", { name: "Vitamilk" });

    expect(productLink).toHaveAttribute(
      "href",
      expect.stringContaining("/wigclub/store/osu/products/product-1?o="),
    );
    expect(productLink).toHaveAttribute(
      "href",
      expect.stringContaining("variant=VITAMILK-001"),
    );
    expect(
      screen.getByText((content, node) => {
        return (
          node?.textContent ===
          "Kwamina Nuh quick added Vitamilk with quantity 100."
        );
      }),
    ).toBeInTheDocument();
  });

  it("links register closeout timeline events to the register session", () => {
    renderContent(registerCloseoutTimelineSnapshot);

    const registerLink = screen.getByRole("link", {
      name: "Front counter / Register 2",
    });

    expect(registerLink).toHaveAttribute(
      "href",
      expect.stringContaining(
        "/wigclub/store/osu/cash-controls/registers/register-2?o=",
      ),
    );
    expect(
      screen.getByText((content, node) => {
        return (
          node?.textContent ===
          "Front counter / Register 2 closeout recorded with an exact cash match."
        );
      }),
    ).toBeInTheDocument();
  });

  it("links generic register session closed timeline events to the register session", () => {
    renderContent(registerSessionClosedTimelineSnapshot);

    const registerLink = screen.getByRole("link", {
      name: "M Supplies / Register 80",
    });

    expect(registerLink).toHaveAttribute(
      "href",
      expect.stringContaining(
        "/wigclub/store/osu/cash-controls/registers/register-session-80?o=",
      ),
    );
    expect(
      screen.getByText((content, node) => {
        return (
          node?.textContent ===
          "M Supplies / Register 80 closed with an exact cash match."
        );
      }),
    ).toBeInTheDocument();
    expect(registerLink.querySelector("svg")).toBeInTheDocument();
  });

  it("links POS register opened timeline events to the register session", () => {
    renderContent(registerOpenedTimelineSnapshot);

    const registerLink = screen.getByRole("link", {
      name: "M Supplies / Register 80",
    });

    expect(registerLink).toHaveAttribute(
      "href",
      expect.stringContaining(
        "/wigclub/store/osu/cash-controls/registers/register-session-80?o=",
      ),
    );
    expect(
      screen.getByText((content, node) => {
        return node?.textContent === "M Supplies / Register 80 opened.";
      }),
    ).toBeInTheDocument();
    expect(registerLink.querySelector("svg")).toBeInTheDocument();
  });

  it("links synced offline POS sale transaction numbers with link-out affordance", () => {
    renderContent(posSyncedSaleTimelineSnapshot);

    const transactionLink = screen.getByRole("link", { name: "#946956" });

    expect(transactionLink).toHaveAttribute(
      "href",
      expect.stringContaining(
        "/wigclub/store/osu/pos/transactions/txn-946956?o=",
      ),
    );
    expect(
      screen.getByText((content, node) => {
        return (
          node?.textContent ===
          "Sale #946956 synced: 3 sale lines, GH₵1,039, cash."
        );
      }),
    ).toBeInTheDocument();
    expect(transactionLink.querySelector("svg")).toBeInTheDocument();
  });

  it("links void requested timeline transactions and keeps requester copy inline", () => {
    renderContent(voidRequestedTimelineSnapshot);

    const transactionLink = screen.getByRole("link", { name: "#851031" });

    expect(transactionLink).toHaveAttribute(
      "href",
      expect.stringContaining(
        "/wigclub/store/osu/pos/transactions/transaction-851031?o=",
      ),
    );
    expect(
      screen.getByText((content, node) => {
        return (
          node?.textContent ===
          "Void requested by Joyce O. for Transaction #851031."
        );
      }),
    ).toBeInTheDocument();
    expect(transactionLink.querySelector("svg")).toBeInTheDocument();
  });

  it("links cycle-count product labels and SKU tokens with link-out affordance", () => {
    renderContent(cycleCountSkuTimelineSnapshot);

    const skuLink = screen.getByRole("link", {
      name: "AI Engineering (6N2Y-8T-6RM)",
    });

    expect(skuLink).toHaveAttribute(
      "href",
      expect.stringContaining("/wigclub/store/osu/products/product-1?o="),
    );
    expect(skuLink).toHaveAttribute(
      "href",
      expect.stringContaining("variant=6N2Y-8T-6RM"),
    );
    expect(
      screen.getByText((content, node) => {
        return (
          node?.textContent ===
          "pos@wigclub.store counted AI Engineering (6N2Y-8T-6RM) as 24. Draft has 1 change"
        );
      }),
    ).toBeInTheDocument();
    expect(skuLink.querySelector("svg")).toBeInTheDocument();
  });

  it("leaves content empty while the store-day snapshot loads", () => {
    const { container } = renderContent(undefined);

    expect(
      screen.getByRole("heading", { name: "Daily Operations" }),
    ).toBeInTheDocument();
    expect(container.querySelectorAll(".animate-pulse")).toHaveLength(0);
  });

  it("renders access states before showing protected operations data", () => {
    renderContent(undefined, {
      isAuthenticated: false,
      isLoadingSnapshot: false,
    });

    expect(screen.getByText("Sign in required")).toBeInTheDocument();

    renderContent(undefined, {
      hasFullAdminAccess: false,
      isLoadingSnapshot: false,
    });

    expect(screen.getByText("Access Denied")).toBeInTheDocument();
  });
});

describe("DailyOperationsView", () => {
  beforeEach(() => {
    (
      mockedApi as { getDailyOperationsDetailSnapshot?: unknown }
    ).getDailyOperationsDetailSnapshot = "getDailyOperationsDetailSnapshot";
    (
      mockedApi as { getDailyOperationsSnapshot?: unknown }
    ).getDailyOperationsSnapshot = "getDailyOperationsSnapshot";
    (
      mockedApi as { getDailyOperationsStorePulseSnapshot?: unknown }
    ).getDailyOperationsStorePulseSnapshot =
      "getDailyOperationsStorePulseSnapshot";
    (
      mockedApi as { getDailyOperationsTimelinePreviewSnapshot?: unknown }
    ).getDailyOperationsTimelinePreviewSnapshot =
      "getDailyOperationsTimelinePreviewSnapshot";
    (
      mockedApi as { getDailyOperationsTimelineSnapshot?: unknown }
    ).getDailyOperationsTimelineSnapshot = "getDailyOperationsTimelineSnapshot";
    window.scrollTo = vi.fn();
    mockedHooks.useProtectedAdminPageState.mockReturnValue({
      activeStore: { _id: "store-1", currency: "GHS" },
      canQueryProtectedData: true,
      hasFinancialDetailsAccess: true,
      hasFullAdminAccess: true,
      isAuthenticated: true,
      isLoadingAccess: false,
    });
    mockedHooks.useQuery.mockImplementation((_query, args) =>
      args === "skip" ? undefined : operatingSnapshot,
    );
    mockedHooks.navigate.mockReset();
    mockedHooks.useSearch.mockReturnValue({});
  });

  it("queries the daily operations snapshot for the active store", () => {
    render(<DailyOperationsView />);

    expect(mockedHooks.useQuery).toHaveBeenCalledWith(
      mockedApi.getDailyOperationsSnapshot,
      expect.objectContaining({
        operatingTimezoneOffsetMinutes: expect.any(Number),
        storeId: "store-1",
        storePulseWindow: "today",
        weekEndOperatingDate: getCurrentSaturdayWeekEndOperatingDate(),
      }),
    );
    expect(
      screen.getByRole("heading", { name: "Historical store-day view" }),
    ).toBeInTheDocument();
  });

  it("hydrates analytics detail on initial load for an uncached week", () => {
    render(<DailyOperationsView />);

    expect(mockedHooks.useQuery).toHaveBeenCalledWith(
      mockedApi.getDailyOperationsDetailSnapshot,
      expect.objectContaining({
        operatingTimezoneOffsetMinutes: expect.any(Number),
        storeId: "store-1",
        storePulseWindow: "today",
        weekEndOperatingDate: getCurrentSaturdayWeekEndOperatingDate(),
      }),
    );
  });

  it("mirrors the analytics layout before detail is loaded", () => {
    mockedHooks.useQuery.mockImplementation((query, args) => {
      if (args === "skip") return undefined;
      if (query === mockedApi.getDailyOperationsDetailSnapshot) {
        return undefined;
      }
      return operatingSnapshot;
    });
    render(<DailyOperationsView />);

    expect(
      screen.getByRole("heading", { name: "Week at a glance" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Week sales")).toBeInTheDocument();
    expect(screen.getAllByText("Loading analytics").length).toBeGreaterThan(0);
    expect(
      screen.getByRole("button", {
        name: "Load analytics for week at a glance",
      }),
    ).toBeInTheDocument();

    const storePulse = screen.getByRole("region", { name: "Store pulse" });

    expect(
      within(storePulse).getByRole("button", {
        name: "Load analytics for sales trend",
      }),
    ).toBeInTheDocument();
    expect(
      within(storePulse).getByRole("heading", { name: "Sales trend" }),
    ).toBeInTheDocument();
    expect(
      within(storePulse).getByTestId("sales-trend-preview-grid"),
    ).toBeInTheDocument();
    expect(
      within(storePulse).queryByTestId("sales-trend-preview-line"),
    ).not.toBeInTheDocument();
    expect(
      within(storePulse).getByText("Store pulse detail loads with analytics."),
    ).toBeInTheDocument();
    expect(
      within(storePulse).getByRole("heading", { name: "Top items" }),
    ).toBeInTheDocument();
    expect(
      within(storePulse).getByRole("heading", { name: "How customers paid" }),
    ).toBeInTheDocument();
  });

  it("uses the explicit companion query for analytics hydration", () => {
    render(<DailyOperationsView />);

    expect(mockedHooks.useQuery).toHaveBeenCalledWith(
      mockedApi.getDailyOperationsDetailSnapshot,
      expect.objectContaining({
        operatingTimezoneOffsetMinutes: expect.any(Number),
        storeId: "store-1",
        storePulseWindow: "today",
        weekEndOperatingDate: getCurrentSaturdayWeekEndOperatingDate(),
      }),
    );
  });

  it("queries analytics detail when the empty analytics shell is clicked", () => {
    mockedHooks.useQuery.mockImplementation((query, args) => {
      if (args === "skip") return undefined;
      if (query === mockedApi.getDailyOperationsDetailSnapshot) {
        return undefined;
      }
      return operatingSnapshot;
    });
    render(<DailyOperationsView />);

    fireEvent.click(
      screen.getByRole("button", {
        name: "Load analytics for week at a glance",
      }),
    );

    expect(mockedHooks.useQuery).toHaveBeenCalledWith(
      mockedApi.getDailyOperationsDetailSnapshot,
      expect.objectContaining({
        operatingTimezoneOffsetMinutes: expect.any(Number),
        storeId: "store-1",
        storePulseWindow: "today",
        weekEndOperatingDate: getCurrentSaturdayWeekEndOperatingDate(),
      }),
    );
  });

  it("queries selected-day store pulse detail on mount when auto hydration is enabled", () => {
    mockedHooks.useQuery.mockImplementation((query, args) => {
      if (args === "skip") return undefined;
      if (query === mockedApi.getDailyOperationsStorePulseSnapshot) {
        return undefined;
      }
      return operatingSnapshot;
    });
    render(<DailyOperationsView />);

    expect(mockedHooks.useQuery).toHaveBeenCalledWith(
      mockedApi.getDailyOperationsStorePulseSnapshot,
      expect.objectContaining({
        operatingTimezoneOffsetMinutes: expect.any(Number),
        storeId: "store-1",
        storePulseWindow: "today",
        weekEndOperatingDate: getCurrentSaturdayWeekEndOperatingDate(),
      }),
    );
  });

  it("keeps the week chart stable when selected-day pulse detail hydrates", async () => {
    let shouldReturnPulseDetail = false;

    mockedHooks.useQuery.mockImplementation((query, args) => {
      if (args === "skip") return undefined;
      if (query === mockedApi.getDailyOperationsDetailSnapshot) {
        return {
          ...operatingSnapshot,
          weekSnapshots: buildWeekSnapshots(),
        };
      }
      if (query === mockedApi.getDailyOperationsStorePulseSnapshot) {
        if (!shouldReturnPulseDetail) return undefined;

        return {
          operatingDate: "2026-05-08",
          storePulse: buildStorePulseSummary({
            date: "2026-05-08",
            itemName: "Hydrated selected item",
            paymentLabel: "Mobile Money",
            paymentMethod: "mobile_money",
          }),
        };
      }
      return operatingSnapshot;
    });
    mockedHooks.useSearch.mockReturnValue({
      operatingDate: "2026-05-08",
      weekEndOperatingDate: "2026-05-09",
    });
    const view = render(<DailyOperationsView />);

    expect(await screen.findByText(/Data refreshed at /)).toBeInTheDocument();
    const chart = screen.getByTestId("store-pulse-chart");
    const replayKey = screen
      .getByTestId("store-pulse-area")
      .getAttribute("data-replay-key");

    expect(chart).toHaveAttribute(
      "data-display-labels",
      "Sun, May 3|Mon, May 4|Tue, May 5|Wed, May 6|Thu, May 7|Fri, May 8",
    );

    shouldReturnPulseDetail = true;
    view.rerender(<DailyOperationsView />);

    expect(
      await screen.findByText("Hydrated Selected Item"),
    ).toBeInTheDocument();
    expect(screen.getByText("Mobile Money")).toBeInTheDocument();
    expect(screen.getByTestId("store-pulse-chart")).toHaveAttribute(
      "data-display-labels",
      "Sun, May 3|Mon, May 4|Tue, May 5|Wed, May 6|Thu, May 7|Fri, May 8",
    );
    expect(screen.getByTestId("store-pulse-area")).toHaveAttribute(
      "data-replay-key",
      replayKey,
    );
  });

  it("queries timeline detail separately when the timeline asks for more", () => {
    mockedHooks.useQuery.mockImplementation((query, args) => {
      if (args === "skip") return undefined;
      if (query === mockedApi.getDailyOperationsTimelinePreviewSnapshot) {
        return compactTimelineOverflowSnapshot;
      }
      if (query === mockedApi.getDailyOperationsTimelineSnapshot) {
        return {
          operatingDate: compactTimelineOverflowSnapshot.operatingDate,
          timeline: timelineOverflowSnapshot.timeline,
        };
      }
      return compactTimelineOverflowSnapshot;
    });
    render(<DailyOperationsView />);

    const timeline = screen.getByRole("region", {
      name: "Store-day timeline",
    });

    fireEvent.click(
      within(timeline).getByRole("button", { name: "Show more" }),
    );

    expect(mockedHooks.useQuery).toHaveBeenCalledWith(
      mockedApi.getDailyOperationsTimelineSnapshot,
      expect.objectContaining({
        operatingTimezoneOffsetMinutes: expect.any(Number),
        storeId: "store-1",
      }),
    );
    expect(mockedHooks.useQuery).toHaveBeenCalledWith(
      mockedApi.getDailyOperationsDetailSnapshot,
      expect.objectContaining({
        operatingTimezoneOffsetMinutes: expect.any(Number),
        storeId: "store-1",
      }),
    );
  });

  it("renders the store-day timeline from the separate preview query", () => {
    mockedHooks.useQuery.mockImplementation((query, args) => {
      if (args === "skip") return undefined;
      if (query === mockedApi.getDailyOperationsTimelinePreviewSnapshot) {
        return {
          operatingDate: operatingSnapshot.operatingDate,
          timeline: [
            {
              createdAt: Date.UTC(2026, 4, 8, 23),
              id: "fresh-preview-event",
              message: "Latest preview event from timeline query.",
              subject: {
                id: "timeline-preview",
                type: "operations",
              },
              type: "operations.event",
            },
          ],
          timelineHasMore: false,
        };
      }

      return {
        ...operatingSnapshot,
        timeline: [
          {
            createdAt: Date.UTC(2026, 4, 8, 8),
            id: "stale-main-snapshot-event",
            message: "Stale event from main snapshot.",
            subject: {
              id: "main-snapshot",
              type: "operations",
            },
            type: "operations.event",
          },
        ],
      };
    });

    render(<DailyOperationsView />);

    const timeline = screen.getByRole("region", {
      name: "Store-day timeline",
    });

    expect(
      within(timeline).getByText("Latest preview event from timeline query."),
    ).toBeInTheDocument();
    expect(
      within(timeline).queryByText("Stale event from main snapshot."),
    ).not.toBeInTheDocument();
  });

  it("keeps loaded week analytics visible when navigating within the same week", async () => {
    mockedHooks.useQuery.mockImplementation((query, args) => {
      if (args === "skip") return undefined;
      if (query === mockedApi.getDailyOperationsDetailSnapshot) {
        return {
          ...operatingSnapshot,
          closeSummary: {
            ...operatingSnapshot.closeSummary,
            salesTotal: 999,
            transactionCount: 99,
          },
          weekSnapshots: buildWeekSnapshots(),
        };
      }
      return operatingSnapshot;
    });
    mockedHooks.useSearch.mockReturnValue({
      operatingDate: "2026-05-08",
      weekEndOperatingDate: "2026-05-09",
    });
    const view = render(<DailyOperationsView />);

    expect(await screen.findByText(/Data refreshed at /)).toBeInTheDocument();
    expect(
      screen.getAllByText((_, node) => node?.textContent === "GH₵15,331")
        .length,
    ).toBeGreaterThan(0);
    expect(screen.queryByText("99 transactions")).not.toBeInTheDocument();
    mockedHooks.useQuery.mockClear();

    mockedHooks.useSearch.mockReturnValue({
      operatingDate: "2026-05-07",
      weekEndOperatingDate: "2026-05-09",
    });
    view.rerender(<DailyOperationsView />);

    expect(screen.getByText(/Data refreshed at /)).toBeInTheDocument();
    expect(mockedHooks.useQuery).toHaveBeenCalledWith(
      mockedApi.getDailyOperationsSnapshot,
      "skip",
    );
    expect(mockedHooks.useQuery).not.toHaveBeenCalledWith(
      mockedApi.getDailyOperationsSnapshot,
      expect.objectContaining({
        operatingDate: "2026-05-07",
      }),
    );
    expect(
      screen.getByText((_, node) => node?.textContent === "GH₵17,461"),
    ).toBeInTheDocument();
    expect(
      screen.getAllByText((_, node) => node?.textContent === "GH₵450").length,
    ).toBeGreaterThan(0);
    expect(screen.getAllByText("1 transaction").length).toBeGreaterThan(0);
    expect(
      screen.queryByRole("button", {
        name: "Load analytics for week at a glance",
      }),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("store-pulse-chart")).toBeInTheDocument();
    expect(screen.getByTestId("store-pulse-chart")).toHaveAttribute(
      "data-display-labels",
      "Sun, May 3|Mon, May 4|Tue, May 5|Wed, May 6|Thu, May 7",
    );
    expect(screen.getByTestId("store-pulse-chart")).toHaveClass(
      "store-pulse-sales-trend-plot",
    );
    expect(screen.getByTestId("store-pulse-area")).toHaveAttribute(
      "data-animate-new-values",
      "false",
    );
    expect(screen.getByTestId("store-pulse-area")).toHaveAttribute(
      "data-animation-active",
      "false",
    );
    expect(screen.getByTestId("store-pulse-area")).toHaveAttribute(
      "data-animation-duration",
      "",
    );
    expect(screen.getByTestId("store-pulse-area")).toHaveAttribute(
      "data-path-length",
      "1",
    );
    expect(screen.getByTestId("store-pulse-area")).toHaveAttribute(
      "data-replay-key",
      "2026-05-07",
    );
    expect(
      screen.queryByTestId("sales-trend-preview-grid"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "Load analytics for Top items",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "Load analytics for How customers paid",
      }),
    ).toBeInTheDocument();

    mockedHooks.useQuery.mockClear();
    mockedHooks.useSearch.mockReturnValue({
      operatingDate: "2026-05-08",
      weekEndOperatingDate: "2026-05-09",
    });
    view.rerender(<DailyOperationsView />);

    expect(mockedHooks.useQuery).toHaveBeenCalledWith(
      mockedApi.getDailyOperationsSnapshot,
      "skip",
    );
    expect(mockedHooks.useQuery).toHaveBeenCalledWith(
      mockedApi.getDailyOperationsDetailSnapshot,
      "skip",
    );
    expect(mockedHooks.useQuery).not.toHaveBeenCalledWith(
      mockedApi.getDailyOperationsDetailSnapshot,
      expect.objectContaining({
        operatingDate: "2026-05-08",
      }),
    );
    expect(screen.getByTestId("store-pulse-area")).toHaveAttribute(
      "data-animate-new-values",
      "false",
    );
    expect(screen.getByTestId("store-pulse-area")).toHaveAttribute(
      "data-replay-key",
      "2026-05-08",
    );
  });

  it("hydrates analytics detail again after navigating to an uncached week", () => {
    const view = render(<DailyOperationsView />);

    expect(mockedHooks.useQuery).toHaveBeenCalledWith(
      mockedApi.getDailyOperationsDetailSnapshot,
      expect.objectContaining({
        operatingDate: expect.any(String),
        storeId: "store-1",
      }),
    );

    mockedHooks.useQuery.mockClear();
    mockedHooks.useSearch.mockReturnValue({
      operatingDate: "2026-05-07",
      weekEndOperatingDate: "2026-05-08",
    });

    view.rerender(<DailyOperationsView />);

    expect(mockedHooks.useQuery).toHaveBeenCalledWith(
      mockedApi.getDailyOperationsSnapshot,
      expect.objectContaining({
        operatingDate: "2026-05-07",
        storeId: "store-1",
      }),
    );
    expect(mockedHooks.useQuery).toHaveBeenCalledWith(
      mockedApi.getDailyOperationsDetailSnapshot,
      expect.objectContaining({
        operatingDate: "2026-05-07",
        storeId: "store-1",
      }),
    );
  });

  it("queries the daily operations snapshot for the route operating date", () => {
    mockedHooks.useSearch.mockReturnValue({
      operatingDate: "2026-05-07",
      weekEndOperatingDate: "2026-05-08",
    });

    render(<DailyOperationsView />);

    expect(mockedHooks.useQuery).toHaveBeenCalledWith(
      mockedApi.getDailyOperationsSnapshot,
      expect.objectContaining({
        operatingDate: "2026-05-07",
        operatingTimezoneOffsetMinutes: new Date(
          2026,
          4,
          7,
        ).getTimezoneOffset(),
        storeId: "store-1",
        storePulseWindow: "today",
        weekEndOperatingDate: "2026-05-09",
      }),
    );
  });

  it("keeps the store pulse query scoped to the operating day", () => {
    mockedHooks.useSearch.mockReturnValue({
      storePulseWindow: "this_month",
    });

    render(<DailyOperationsView />);

    expect(mockedHooks.useQuery).toHaveBeenCalledWith(
      mockedApi.getDailyOperationsSnapshot,
      expect.objectContaining({
        storePulseWindow: "today",
      }),
    );
  });

  it("does not render store pulse window tabs on daily operations", () => {
    mockedHooks.useSearch.mockReturnValue({
      storePulseWindow: "this_week",
    });
    mockedHooks.useQuery.mockReturnValue({
      ...operatingSnapshot,
      storePulse: buildStorePulseSummary(),
    });

    render(<DailyOperationsView />);

    const storePulse = screen.getByRole("region", { name: "Store pulse" });

    expect(within(storePulse).queryByRole("tablist")).not.toBeInTheDocument();
    expect(
      within(storePulse).getByText("Cached sales trend through the selected day."),
    ).toBeInTheDocument();
  });

  it("skips the protected query when access is not ready", () => {
    mockedHooks.useProtectedAdminPageState.mockReturnValue({
      activeStore: { _id: "store-1", currency: "GHS" },
      canQueryProtectedData: false,
      hasFullAdminAccess: false,
      isAuthenticated: true,
      isLoadingAccess: false,
    });

    render(<DailyOperationsView />);

    expect(mockedHooks.useQuery).toHaveBeenCalledWith(
      mockedApi.getDailyOperationsSnapshot,
      "skip",
    );
    expect(mockedHooks.useQuery).toHaveBeenCalledWith(
      mockedApi.getDailyOperationsDetailSnapshot,
      "skip",
    );
    expect(screen.getByText("Access Denied")).toBeInTheDocument();
  });

  it("shows an operator-facing unavailable state while generated API wiring catches up", () => {
    (
      mockedApi as { getDailyOperationsSnapshot?: unknown }
    ).getDailyOperationsSnapshot = undefined;

    render(<DailyOperationsView />);

    expect(
      screen.getByText("Daily Operations unavailable"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("getDailyOperationsSnapshot"),
    ).not.toBeInTheDocument();
  });
});
