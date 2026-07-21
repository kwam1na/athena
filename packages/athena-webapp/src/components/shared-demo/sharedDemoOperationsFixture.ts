import type {
  DailyOperationsSnapshot,
  DailyOperationsViewContentProps,
} from "@/components/operations/DailyOperationsView";
import type { StorePulseSummary } from "@/components/store-pulse/StorePulseSummaryView";
import {
  getLocalDateFromOperatingDate,
  getLocalOperatingDate,
} from "@/lib/operations/operatingDate";
import {
  SHARED_DEMO_PRODUCTS,
  SHARED_DEMO_STORE_IDENTITY,
} from "~/shared/sharedDemoStory";
import type { Id } from "~/convex/_generated/dataModel";

type SharedDemoHistoricalMetric = ReturnType<typeof buildHistoricalMetric>;
type SharedDemoStorePulseOperatorSnapshot = NonNullable<
  StorePulseSummary["operatorSnapshot"]
>;

const HISTORICAL_SALES = [
  438_000, 512_000, 476_000, 645_000, 531_000, 704_000, 492_000, 568_000,
  421_000, 617_000, 554_000, 686_000, 508_000, 593_000,
] as const;

const HISTORICAL_TRANSACTIONS = [
  34, 31, 39, 37, 45, 42, 35, 48, 28, 46, 40, 41, 44, 38,
] as const;

const HISTORICAL_CASH_SHARES = [
  0.33, 0.28, 0.37, 0.3, 0.35, 0.29, 0.39, 0.31, 0.27, 0.36, 0.32, 0.34, 0.26,
  0.38,
] as const;

const HISTORICAL_CARD_SHARES = [
  0.4, 0.46, 0.35, 0.44, 0.38, 0.48, 0.34, 0.42, 0.45, 0.37, 0.47, 0.36, 0.49,
  0.33,
] as const;

const HISTORICAL_ITEMS_PER_TRANSACTION = [
  1.5, 1.8, 1.4, 1.7, 1.6, 1.9, 1.3, 1.7, 1.5, 1.8, 1.4, 1.6, 1.9, 1.5,
] as const;

export const SHARED_DEMO_HISTORY_DAYS = 21;
const INVENTORY_REVIEW_TRADING_DAY_ORDINALS = [4, 13] as const;

function formatOperatingDate(date: Date) {
  const localDate = new Date(
    date.getTime() - date.getTimezoneOffset() * 60_000,
  );
  return localDate.toISOString().slice(0, 10);
}

function shiftOperatingDate(operatingDate: string, days: number) {
  const date = getLocalDateFromOperatingDate(operatingDate);
  if (!date) throw new Error(`Invalid operating date: ${operatingDate}`);
  date.setDate(date.getDate() + days);
  return formatOperatingDate(date);
}

function getSaturdayWeekEndOperatingDate(operatingDate: string) {
  const date = getLocalDateFromOperatingDate(operatingDate);
  if (!date) throw new Error(`Invalid operating date: ${operatingDate}`);
  date.setDate(date.getDate() + (6 - date.getDay()));
  return formatOperatingDate(date);
}

function formatDayLabel(operatingDate: string) {
  const date = getLocalDateFromOperatingDate(operatingDate);
  return date
    ? date.toLocaleDateString("en-US", { day: "numeric", month: "short" })
    : operatingDate;
}

function toWholeCurrencyAmount(amount: number) {
  return Math.round(amount / 500) * 500;
}

function buildHistoricalMetrics(today: string) {
  return HISTORICAL_SALES.map((_, index) =>
    buildFixtureHistoricalMetric(
      shiftOperatingDate(today, index - HISTORICAL_SALES.length),
      today,
    ),
  );
}

function hasFixtureHistory(operatingDate: string, today: string) {
  const historyStartOperatingDate = shiftOperatingDate(
    today,
    -SHARED_DEMO_HISTORY_DAYS,
  );

  return operatingDate >= historyStartOperatingDate && operatingDate < today;
}

export function getSharedDemoHistoryStartOperatingDate(
  today = getLocalOperatingDate(),
) {
  return shiftOperatingDate(today, -SHARED_DEMO_HISTORY_DAYS);
}

export type SharedDemoHistoricalDayFixture = ReturnType<
  typeof buildHistoricalMetric
> & {
  hasInventoryReview: boolean;
};

export function getSharedDemoHistoricalDayFixture(
  operatingDate: string,
  today = getLocalOperatingDate(),
): SharedDemoHistoricalDayFixture | undefined {
  if (!hasFixtureHistory(operatingDate, today)) return undefined;

  return {
    ...buildHistoricalMetric(operatingDate),
    hasInventoryReview:
      getFixtureInventoryReviewOperatingDates(today).includes(operatingDate),
  };
}

function getFixtureInventoryReviewOperatingDates(today: string) {
  const historyStartOperatingDate = shiftOperatingDate(
    today,
    -SHARED_DEMO_HISTORY_DAYS,
  );
  const tradingDates = Array.from(
    { length: SHARED_DEMO_HISTORY_DAYS },
    (_, index) => shiftOperatingDate(historyStartOperatingDate, index),
  ).filter((operatingDate) => {
    const date = getLocalDateFromOperatingDate(operatingDate);
    return date?.getDay() !== 0;
  });

  return INVENTORY_REVIEW_TRADING_DAY_ORDINALS.map(
    (ordinal) => tradingDates[ordinal]!,
  );
}

function getOperatingDateTimestamp(
  operatingDate: string,
  hours: number,
  minutes: number,
) {
  const date = getLocalDateFromOperatingDate(operatingDate);
  if (!date) throw new Error(`Invalid operating date: ${operatingDate}`);
  return date.setHours(hours, minutes, 0, 0);
}

function buildFixtureHistoricalMetric(operatingDate: string, today: string) {
  return hasFixtureHistory(operatingDate, today)
    ? buildHistoricalMetric(operatingDate)
    : createEmptyMetric(operatingDate);
}

function buildHistoricalMetric(operatingDate: string) {
  const date = getLocalDateFromOperatingDate(operatingDate);
  if (!date) throw new Error(`Invalid operating date: ${operatingDate}`);

  const dayIndex = Math.floor(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000,
  );
  const fixtureIndex =
    ((dayIndex % HISTORICAL_SALES.length) + HISTORICAL_SALES.length) %
    HISTORICAL_SALES.length;
  const seededSalesTotal = HISTORICAL_SALES[fixtureIndex]!;
  const isSunday = date.getDay() === 0;
  const salesTotal = isSunday ? 0 : seededSalesTotal;
  const transactionCount = isSunday
    ? 0
    : HISTORICAL_TRANSACTIONS[fixtureIndex]!;
  const cashShare = HISTORICAL_CASH_SHARES[fixtureIndex]!;
  const cardShare = HISTORICAL_CARD_SHARES[fixtureIndex]!;
  const cashTotal = toWholeCurrencyAmount(salesTotal * cashShare);
  const cardTotal = toWholeCurrencyAmount(salesTotal * cardShare);
  const cashTransactionCount = Math.round(transactionCount * cashShare);
  const cardTransactionCount = Math.round(transactionCount * cardShare);
  const mobileMoneyTransactionCount =
    transactionCount - cashTransactionCount - cardTransactionCount;
  const totalItemsSold = Math.round(
    transactionCount * HISTORICAL_ITEMS_PER_TRANSACTION[fixtureIndex]!,
  );

  return {
    currentDayCashTotal: cashTotal,
    currentDayCashTransactionCount: cashTransactionCount,
    expenseTotal: !isSunday && fixtureIndex % 5 === 0 ? 18_000 : 0,
    expenseTransactionCount: !isSunday && fixtureIndex % 5 === 0 ? 1 : 0,
    isClosed: true,
    isSelected: false,
    operatingDate,
    paymentTotals:
      salesTotal > 0
        ? [
            {
              amount: cashTotal,
              method: "cash",
              transactionCount: cashTransactionCount,
            },
            {
              amount: cardTotal,
              method: "card",
              transactionCount: cardTransactionCount,
            },
            {
              amount: salesTotal - cashTotal - cardTotal,
              method: "mobile_money",
              transactionCount: mobileMoneyTransactionCount,
            },
          ]
        : [],
    salesTotal,
    totalItemsSold,
    transactionCount,
  };
}

function averageTransaction(salesTotal: number, transactionCount: number) {
  return transactionCount > 0 ? Math.round(salesTotal / transactionCount) : 0;
}

function percentageChange(current: number, previous: number) {
  return previous === 0 ? 0 : Math.round((current / previous - 1) * 100);
}

function buildPaymentMix(
  history: ReturnType<typeof buildHistoricalMetrics>,
  totalSales: number,
): SharedDemoStorePulseOperatorSnapshot["paymentMix"] {
  return [
    { label: "Card", method: "card" },
    { label: "Cash", method: "cash" },
    { label: "Mobile money", method: "mobile_money" },
  ].map(({ label, method }) => {
    const totals = history.reduce(
      (sum, day) => {
        const payment = day.paymentTotals.find(
          (paymentTotal) => paymentTotal.method === method,
        );
        return {
          count: sum.count + (payment?.transactionCount ?? 0),
          total: sum.total + (payment?.amount ?? 0),
        };
      },
      { count: 0, total: 0 },
    );

    return {
      ...totals,
      label,
      method,
      share: totalSales > 0 ? Math.round((totals.total / totalSales) * 100) : 0,
    };
  });
}

function buildStorePulseSummary(
  history: ReturnType<typeof buildHistoricalMetrics>,
): StorePulseSummary {
  const totalSales = history.reduce((sum, day) => sum + day.salesTotal, 0);
  const totalTransactions = history.reduce(
    (sum, day) => sum + day.transactionCount,
    0,
  );
  const totalItemsSold = history.reduce(
    (sum, day) => sum + day.totalItemsSold,
    0,
  );
  const yesterday = history.at(-1)!;
  const dayBeforeYesterday = history.at(-2)!;

  return {
    averageTransaction: averageTransaction(totalSales, totalTransactions),
    date: yesterday.operatingDate,
    operatorSnapshot: {
      busiestHour: {
        hour: 14,
        label: "2 PM",
        totalSales: 92_000,
        transactionCount: 7,
      },
      comparison: {
        averageTransactionDeltaPercent: percentageChange(
          averageTransaction(yesterday.salesTotal, yesterday.transactionCount),
          averageTransaction(
            dayBeforeYesterday.salesTotal,
            dayBeforeYesterday.transactionCount,
          ),
        ),
        currentAverageTransaction: averageTransaction(
          yesterday.salesTotal,
          yesterday.transactionCount,
        ),
        currentItemsSold: yesterday.totalItemsSold,
        currentSales: yesterday.salesTotal,
        currentTransactions: yesterday.transactionCount,
        itemsSoldDeltaPercent: percentageChange(
          yesterday.totalItemsSold,
          dayBeforeYesterday.totalItemsSold,
        ),
        salesDeltaPercent: percentageChange(
          yesterday.salesTotal,
          dayBeforeYesterday.salesTotal,
        ),
        transactionDeltaPercent: percentageChange(
          yesterday.transactionCount,
          dayBeforeYesterday.transactionCount,
        ),
        yesterdayAverageTransaction: averageTransaction(
          dayBeforeYesterday.salesTotal,
          dayBeforeYesterday.transactionCount,
        ),
        yesterdayItemsSold: dayBeforeYesterday.totalItemsSold,
        yesterdaySales: dayBeforeYesterday.salesTotal,
        yesterdayTransactions: dayBeforeYesterday.transactionCount,
      },
      historyDays: history.length,
      isLimited: false,
      paymentMix: buildPaymentMix(history, totalSales),
      topItems: [
        {
          name: SHARED_DEMO_PRODUCTS[0].name,
          productSku: SHARED_DEMO_PRODUCTS[0].sku,
          quantity: 56,
          totalSales: 336_000,
        },
        {
          name: SHARED_DEMO_PRODUCTS[1].name,
          productSku: SHARED_DEMO_PRODUCTS[1].sku,
          quantity: 49,
          totalSales: 171_500,
        },
        {
          name: SHARED_DEMO_PRODUCTS[6].name,
          productSku: SHARED_DEMO_PRODUCTS[6].sku,
          quantity: 22,
          totalSales: 396_000,
        },
        {
          name: SHARED_DEMO_PRODUCTS[4].name,
          productSku: SHARED_DEMO_PRODUCTS[4].sku,
          quantity: 28,
          totalSales: 336_000,
        },
      ],
      trend: history.map((day) => ({
        averageTransaction: averageTransaction(
          day.salesTotal,
          day.transactionCount,
        ),
        date: day.operatingDate,
        label: formatDayLabel(day.operatingDate),
        totalItemsSold: day.totalItemsSold,
        totalSales: day.salesTotal,
        transactionCount: day.transactionCount,
      })),
      usableHistoryDays: history.length,
    },
    totalItemsSold,
    totalSales,
    totalTransactions,
  };
}

function createEmptyMetric(operatingDate: string) {
  return {
    currentDayCashTotal: 0,
    currentDayCashTransactionCount: 0,
    expenseTotal: 0,
    expenseTransactionCount: 0,
    isClosed: false,
    isSelected: false,
    operatingDate,
    paymentTotals: [],
    salesTotal: 0,
    totalItemsSold: 0,
    transactionCount: 0,
  } satisfies SharedDemoHistoricalMetric;
}

function buildHistoricalTimeline({
  operatingDate,
  today,
  transactionCount,
}: {
  operatingDate: string;
  today: string;
  transactionCount: number;
}): DailyOperationsSnapshot["timeline"] {
  if (transactionCount === 0) return [];

  const timeline: DailyOperationsSnapshot["timeline"] = [
    {
      createdAt: getOperatingDateTimestamp(operatingDate, 8, 30),
      id: `demo-opening-${operatingDate}`,
      message: "Opening Handoff is complete.",
      subject: {
        id: `demo-opening-${operatingDate}`,
        type: "daily_opening",
      },
      type: "daily_opening.started",
    },
    {
      createdAt: getOperatingDateTimestamp(operatingDate, 13, 30),
      id: `demo-sales-${operatingDate}`,
      message: "Completed POS sales recorded.",
      subject: {
        id: `demo-sales-${operatingDate}`,
        type: "pos_sales_summary",
      },
      type: "pos_sales.completed",
    },
  ];

  if (getFixtureInventoryReviewOperatingDates(today).includes(operatingDate)) {
    timeline.push({
      createdAt: getOperatingDateTimestamp(operatingDate, 16, 15),
      id: `demo-inventory-review-${operatingDate}`,
      message: "Synced sale inventory review completed.",
      subject: {
        id: `demo-inventory-review-${operatingDate}`,
        type: "synced_sale_inventory_review",
      },
      type: "synced_sale_inventory_review_completed",
    });
  }

  timeline.push({
    createdAt: getOperatingDateTimestamp(operatingDate, 20, 15),
    id: `demo-close-${operatingDate}`,
    message: "Athena completed EOD Review under store policy.",
    subject: {
      id: `demo-close-${operatingDate}`,
      type: "daily_close",
    },
    type: "daily_close.completed",
  });

  return timeline.sort((left, right) => right.createdAt - left.createdAt);
}

export function createSharedDemoDailyOperationsFixture({
  operatingDate = getLocalOperatingDate(),
  orgUrlSlug,
  storeId,
  storeUrlSlug,
  weekEndOperatingDate,
}: {
  operatingDate?: string;
  orgUrlSlug: string;
  storeId: Id<"store">;
  storeUrlSlug: string;
  weekEndOperatingDate?: string;
}): DailyOperationsViewContentProps {
  const today = getLocalOperatingDate();
  const isHistorical = hasFixtureHistory(operatingDate, today);
  const selectedMetric = isHistorical
    ? buildHistoricalMetric(operatingDate)
    : createEmptyMetric(operatingDate);
  const weekEnd = getSaturdayWeekEndOperatingDate(
    weekEndOperatingDate ?? selectedMetric.operatingDate,
  );
  const weekMetrics = Array.from({ length: 7 }, (_, index) => {
    const date = shiftOperatingDate(weekEnd, index - 6);
    const metric = buildFixtureHistoricalMetric(date, today);
    return {
      ...metric,
      isSelected: metric.operatingDate === selectedMetric.operatingDate,
    };
  });
  const history = isHistorical
    ? buildHistoricalMetrics(
        shiftOperatingDate(selectedMetric.operatingDate, 1),
      )
    : [...buildHistoricalMetrics(today).slice(-13), createEmptyMetric(today)];
  const storePulse = buildStorePulseSummary(history);
  const snapshot: DailyOperationsSnapshot = {
    attentionItems: [],
    closeSummary: {
      carriedOverCashTotal: 0,
      carriedOverRegisterCount: 0,
      currentDayCashTotal: selectedMetric.currentDayCashTotal,
      currentDayCashTransactionCount:
        selectedMetric.currentDayCashTransactionCount,
      expenseTotal: selectedMetric.expenseTotal,
      expenseTransactionCount: selectedMetric.expenseTransactionCount,
      netCashVariance: 0,
      paymentTotals: selectedMetric.paymentTotals,
      registerVarianceCount: 0,
      salesTotal: selectedMetric.salesTotal,
      transactionCount: selectedMetric.transactionCount,
    },
    completedClose: isHistorical
      ? {
          actorType: "automation",
          automationDecisionReason:
            "EOD Review has only low-risk review evidence within policy thresholds.",
          completedAt: getLocalDateFromOperatingDate(
            selectedMetric.operatingDate,
          )!.setHours(20, 15, 0, 0),
        }
      : null,
    currency: SHARED_DEMO_STORE_IDENTITY.currency,
    lanes: [
      {
        count: 0,
        description: isHistorical
          ? "Opening Handoff was completed for this store day."
          : "The demo session starts at zero.",
        key: "opening",
        label: "Opening",
        status: isHistorical ? "closed" : "ready",
        to: "/$orgUrlSlug/store/$storeUrlSlug/operations/opening",
      },
      {
        count: 0,
        description: isHistorical
          ? "Athena completed EOD Review under store policy."
          : "Historical closes are available in the last 14 days.",
        key: "close",
        label: "EOD Review",
        status: isHistorical ? "closed" : "ready",
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
    lifecycle: isHistorical
      ? {
          description: "Athena completed EOD Review under store policy.",
          label: "Closed",
          status: "closed",
        }
      : {
          description:
            "This demo session starts at zero. Make a sale to explore Athena's live workflows.",
          label: "Ready to trade",
          status: "operating",
        },
    operatingDate: selectedMetric.operatingDate,
    primaryAction: isHistorical
      ? {
          label: "Review EOD Review",
          to: "/$orgUrlSlug/store/$storeUrlSlug/operations/daily-close",
        }
      : {
          label: "Start EOD Review",
          to: "/$orgUrlSlug/store/$storeUrlSlug/operations/daily-close",
        },
    priorDayMetric:
      selectedMetric.operatingDate < today
        ? buildFixtureHistoricalMetric(
            shiftOperatingDate(selectedMetric.operatingDate, -1),
            today,
          )
        : buildFixtureHistoricalMetric(shiftOperatingDate(today, -1), today),
    storeId,
    storePulse,
    timeline: isHistorical
      ? buildHistoricalTimeline({
          operatingDate: selectedMetric.operatingDate,
          today,
          transactionCount: selectedMetric.transactionCount,
        })
      : [],
    weekMetrics,
  };

  return {
    cachedWeekMetrics: weekMetrics,
    cachedWeekStorePulse: storePulse,
    currency: SHARED_DEMO_STORE_IDENTITY.currency,
    hasDetailSnapshot: true,
    hasFinancialDetailsAccess: true,
    hasFullAdminAccess: true,
    isAuthenticated: true,
    isLoadingAccess: false,
    isLoadingSnapshot: false,
    orgUrlSlug,
    snapshot,
    storePulseWindow: "this_week",
    storeUrlSlug,
    timelinePreviewSnapshot: {
      operatingDate: snapshot.operatingDate,
      timeline: snapshot.timeline,
      timelineHasMore: false,
    },
  };
}
