import type { Id } from "../../../_generated/dataModel";
import type { QueryCtx } from "../../../_generated/server";
import { transactionPaymentTotals } from "../../../operations/paymentTotals";
import {
  listCompletedTransactionsForRange,
  listCompletedTransactionsSince,
  listTransactionItems,
} from "../../infrastructure/repositories/transactionRepository";

const DAY_MS = 24 * 60 * 60 * 1000;
const POS_OPERATOR_HISTORY_DAYS = 14;
const POS_OPERATOR_HISTORY_LIMIT = 400;

export type PosPulseSummaryTotals = {
  totalItemsSold: number;
  totalSales: number;
  totalTransactions: number;
};

export type PosPulseWindow =
  | "today"
  | "yesterday"
  | "this_week"
  | "this_month"
  | "all_time"
  | "last_week"
  | "last_month";

export type DailyOperationsStorePulseWindow =
  | "today"
  | "this_week"
  | "this_month"
  | "all_time";

type PosOperatorDayBucket = {
  averageTransaction: number;
  date: string;
  label: string;
  totalItemsSold: number;
  totalSales: number;
  transactionCount: number;
};

type PosOperatorPaymentBucket = {
  count: number;
  label: string;
  method: string;
  share: number;
  total: number;
};

type PosOperatorItemBucket = {
  name: string;
  productSku: string | null;
  quantity: number;
  totalSales: number;
};

function calculateDeltaPercent(current: number, previous: number) {
  return previous > 0 ? Math.round(((current - previous) / previous) * 100) : 0;
}

export async function getStorePulseSummaryForWindow(
  ctx: QueryCtx,
  args: {
    currentDayEnd: number;
    currentDayStart: number;
    currentOperatingDate: string;
    pulseWindow: PosPulseWindow;
    storeId: Id<"store">;
  },
) {
  const pulseWindow = resolvePosPulseWindow({
    currentDayEnd: args.currentDayEnd,
    currentDayStart: args.currentDayStart,
    currentOperatingDate: args.currentOperatingDate,
    pulseWindow: args.pulseWindow,
  });
  const [transactions, comparisonTransactions] = await Promise.all([
    listCompletedTransactionsForRange(ctx, {
      completedFrom: pulseWindow.rangeStart,
      completedTo: pulseWindow.rangeEnd,
      storeId: args.storeId,
    }),
    pulseWindow.comparisonStart !== undefined &&
    pulseWindow.comparisonEnd !== undefined
      ? listCompletedTransactionsForRange(ctx, {
          completedFrom: pulseWindow.comparisonStart,
          completedTo: pulseWindow.comparisonEnd,
          storeId: args.storeId,
        })
      : Promise.resolve([]),
  ]);
  const todaySummary = await summarizePosPulseTransactions(ctx, transactions);
  const comparisonSummary = await summarizePosPulseTransactions(
    ctx,
    comparisonTransactions,
  );
  const operatorSnapshot = await buildPosOperatorSnapshot(ctx, {
    comparisonEnd: pulseWindow.comparisonEnd,
    comparisonSummary,
    comparisonStart: pulseWindow.comparisonStart,
    currentOperatingDate: args.currentOperatingDate,
    historyBucketMode: pulseWindow.historyBucketMode,
    historyDays: pulseWindow.dayCount,
    historyEnd: pulseWindow.rangeEnd,
    historyStart: pulseWindow.rangeStart,
    storeId: args.storeId,
    todaySummary,
  });
  const trend =
    args.pulseWindow === "today" && pulseWindow.comparisonStart !== undefined
      ? [
          buildSummaryTrendBucket(
            pulseWindow.comparisonStart,
            comparisonSummary,
            pulseWindow.comparisonOperatingDate,
          ),
          buildSummaryTrendBucket(
            pulseWindow.rangeStart,
            todaySummary,
            args.currentOperatingDate,
          ),
        ]
      : operatorSnapshot.trend;

  return {
    averageTransaction:
      todaySummary.totalTransactions > 0
        ? todaySummary.totalSales / todaySummary.totalTransactions
        : 0,
    date:
      args.pulseWindow === "today"
        ? args.currentOperatingDate
        : toIsoDate(pulseWindow.rangeEnd),
    operatorSnapshot: {
      ...operatorSnapshot,
      historyDays: Math.max(operatorSnapshot.historyDays, trend.length),
      trend,
      usableHistoryDays:
        args.pulseWindow === "today" && comparisonSummary.totalTransactions > 0
          ? Math.max(operatorSnapshot.usableHistoryDays, 1)
          : operatorSnapshot.usableHistoryDays,
    },
    totalItemsSold: todaySummary.totalItemsSold,
    totalSales: todaySummary.totalSales,
    totalTransactions: todaySummary.totalTransactions,
  };
}

export async function summarizePosPulseTransactions(
  ctx: QueryCtx,
  transactions: Array<{ _id: Id<"posTransaction">; total: number }>,
): Promise<PosPulseSummaryTotals> {
  let totalItemsSold = 0;

  for (const transaction of transactions) {
    const items = await listTransactionItems(ctx, transaction._id);
    totalItemsSold += items.reduce((sum, item) => sum + item.quantity, 0);
  }

  return {
    totalItemsSold,
    totalSales: transactions.reduce(
      (sum, transaction) => sum + transaction.total,
      0,
    ),
    totalTransactions: transactions.length,
  };
}

export async function buildPosOperatorSnapshot(
  ctx: QueryCtx,
  args: {
    comparisonEnd?: number;
    comparisonSummary?: PosPulseSummaryTotals;
    comparisonStart?: number;
    currentOperatingDate: string;
    historyBucketMode?: "fixed" | "transaction_dates";
    historyDays?: number;
    historyEnd?: number;
    historyStart?: number;
    storeId: Id<"store">;
    todaySummary: {
      totalItemsSold: number;
      totalSales: number;
      totalTransactions: number;
    };
  },
) {
  const currentDayStart = parseOperatingDateStart(args.currentOperatingDate);
  const historyDays = args.historyDays ?? POS_OPERATOR_HISTORY_DAYS;
  const historyStart =
    args.historyStart ?? currentDayStart - (historyDays - 1) * DAY_MS;
  const historyEnd = args.historyEnd ?? currentDayStart + DAY_MS - 1;
  const queryStart = args.comparisonStart ?? historyStart;
  const loadedTransactions =
    args.historyEnd === undefined
      ? await listCompletedTransactionsSince(ctx, {
          completedFrom: queryStart,
          limit: POS_OPERATOR_HISTORY_LIMIT,
          storeId: args.storeId,
        })
      : (
          await listCompletedTransactionsForRange(ctx, {
            completedFrom: queryStart,
            completedTo: historyEnd,
            storeId: args.storeId,
          })
        )
          .sort((first, second) => second.completedAt - first.completedAt)
          .slice(0, POS_OPERATOR_HISTORY_LIMIT);
  const transactions = args.comparisonStart
    ? loadedTransactions.filter(
        (transaction) =>
          transaction.completedAt >= historyStart &&
          transaction.completedAt <= historyEnd,
      )
    : loadedTransactions;
  const days =
    args.historyBucketMode === "transaction_dates"
      ? buildTransactionDateBuckets(transactions, historyEnd)
      : buildRecentDayBuckets(historyStart, historyDays);
  const dayBucketsByDate = new Map(days.map((day) => [day.date, day]));
  const itemBuckets = new Map<string, PosOperatorItemBucket>();
  const paymentBuckets = new Map<string, PosOperatorPaymentBucket>();
  const hourBuckets = new Map<
    number,
    { hour: number; totalSales: number; transactionCount: number }
  >();

  for (const transaction of transactions) {
    const date =
      args.historyBucketMode === "transaction_dates"
        ? toIsoDate(transaction.completedAt)
        : getFixedHistoryBucketDate(transaction.completedAt, historyStart);
    const dayBucket = dayBucketsByDate.get(date);
    if (dayBucket) {
      dayBucket.totalSales += transaction.total;
      dayBucket.transactionCount += 1;
    }

    const hour = new Date(transaction.completedAt).getUTCHours();
    const hourBucket = hourBuckets.get(hour) ?? {
      hour,
      totalSales: 0,
      transactionCount: 0,
    };
    hourBucket.totalSales += transaction.total;
    hourBucket.transactionCount += 1;
    hourBuckets.set(hour, hourBucket);

    for (const payment of transactionPaymentTotals(transaction)) {
      const method = payment.method || "unknown";
      const existing = paymentBuckets.get(method) ?? {
        count: 0,
        label: formatPaymentMethodLabel(method),
        method,
        share: 0,
        total: 0,
      };
      existing.count += 1;
      existing.total += payment.amount;
      paymentBuckets.set(method, existing);
    }

    const items = await listTransactionItems(ctx, transaction._id);
    const itemCount = items.reduce((sum, item) => sum + item.quantity, 0);
    if (dayBucket) {
      dayBucket.totalItemsSold += itemCount;
    }

    for (const item of items) {
      const key = `${item.productId}:${item.productSkuId}`;
      const existing = itemBuckets.get(key) ?? {
        name: item.productName,
        productSku: item.productSku || null,
        quantity: 0,
        totalSales: 0,
      };
      existing.quantity += item.quantity;
      existing.totalSales += item.totalPrice;
      itemBuckets.set(key, existing);
    }
  }

  for (const day of days) {
    day.averageTransaction =
      day.transactionCount > 0 ? day.totalSales / day.transactionCount : 0;
  }

  const totalPaymentSales = Array.from(paymentBuckets.values()).reduce(
    (sum, payment) => sum + payment.total,
    0,
  );
  const paymentMix = Array.from(paymentBuckets.values())
    .map((payment) => ({
      ...payment,
      share:
        totalPaymentSales > 0
          ? Math.round((payment.total / totalPaymentSales) * 100)
          : 0,
    }))
    .sort((first, second) => second.total - first.total)
    .slice(0, 4);
  const topItems = Array.from(itemBuckets.values())
    .sort((first, second) => {
      if (second.quantity !== first.quantity) {
        return second.quantity - first.quantity;
      }
      return second.totalSales - first.totalSales;
    })
    .slice(0, 10);
  const busiestHour = Array.from(hourBuckets.values()).sort((first, second) => {
    if (second.transactionCount !== first.transactionCount) {
      return second.transactionCount - first.transactionCount;
    }
    return second.totalSales - first.totalSales;
  })[0];
  const priorDays = days.slice(0, -1);
  const priorDaysWithSales = priorDays.filter(
    (day) => day.transactionCount > 0,
  );
  const yesterday = priorDays.at(-1);
  const hasComparison = Boolean(args.comparisonStart && args.comparisonEnd);
  const shouldCompareWithPreviousDay =
    !hasComparison && args.historyBucketMode !== "transaction_dates";
  const yesterdaySales = hasComparison
    ? (args.comparisonSummary?.totalSales ?? 0)
    : shouldCompareWithPreviousDay
      ? (yesterday?.totalSales ?? 0)
      : 0;
  const yesterdayTransactions = hasComparison
    ? (args.comparisonSummary?.totalTransactions ?? 0)
    : shouldCompareWithPreviousDay
      ? (yesterday?.transactionCount ?? 0)
      : 0;
  const yesterdayItemsSold = hasComparison
    ? (args.comparisonSummary?.totalItemsSold ?? 0)
    : shouldCompareWithPreviousDay
      ? (yesterday?.totalItemsSold ?? 0)
      : 0;

  const currentAverageTransaction =
    args.todaySummary.totalTransactions > 0
      ? args.todaySummary.totalSales / args.todaySummary.totalTransactions
      : 0;
  const yesterdayAverageTransaction =
    yesterdayTransactions > 0 ? yesterdaySales / yesterdayTransactions : 0;

  return {
    busiestHour: busiestHour
      ? {
          hour: busiestHour.hour,
          label: formatHourLabel(busiestHour.hour),
          totalSales: busiestHour.totalSales,
          transactionCount: busiestHour.transactionCount,
        }
      : null,
    comparison: {
      averageTransactionDeltaPercent: calculateDeltaPercent(
        currentAverageTransaction,
        yesterdayAverageTransaction,
      ),
      currentAverageTransaction,
      currentItemsSold: args.todaySummary.totalItemsSold,
      currentSales: args.todaySummary.totalSales,
      currentTransactions: args.todaySummary.totalTransactions,
      itemsSoldDeltaPercent: calculateDeltaPercent(
        args.todaySummary.totalItemsSold,
        yesterdayItemsSold,
      ),
      salesDeltaPercent: calculateDeltaPercent(
        args.todaySummary.totalSales,
        yesterdaySales,
      ),
      transactionDeltaPercent: calculateDeltaPercent(
        args.todaySummary.totalTransactions,
        yesterdayTransactions,
      ),
      yesterdayAverageTransaction,
      yesterdayItemsSold,
      yesterdaySales,
      yesterdayTransactions,
    },
    historyDays:
      args.historyBucketMode === "transaction_dates" ? days.length : historyDays,
    isLimited: loadedTransactions.length >= POS_OPERATOR_HISTORY_LIMIT,
    paymentMix,
    topItems,
    trend: days,
    usableHistoryDays: priorDaysWithSales.length,
  };
}

function resolvePosPulseWindow(args: {
  currentDayEnd: number;
  currentDayStart: number;
  currentOperatingDate: string;
  pulseWindow: PosPulseWindow;
}) {
  const parsedCurrentDayStart = parseOperatingDateStart(args.currentOperatingDate);
  const currentDayStart = Number.isFinite(args.currentDayStart)
    ? args.currentDayStart
    : parsedCurrentDayStart;
  const currentDayEnd =
    Number.isFinite(args.currentDayEnd) && args.currentDayEnd >= currentDayStart
      ? args.currentDayEnd
      : parsedCurrentDayStart + DAY_MS - 1;

  if (args.pulseWindow === "all_time") {
    return {
      dayCount: 0,
      historyBucketMode: "transaction_dates" as const,
      rangeEnd: currentDayEnd,
      rangeStart: 0,
    };
  }

  if (args.pulseWindow === "today") {
    const windowLength = currentDayEnd - currentDayStart + 1;

    return {
      comparisonEnd: currentDayStart - 1,
      comparisonOperatingDate: toIsoDate(parsedCurrentDayStart - DAY_MS),
      comparisonStart: currentDayStart - windowLength,
      dayCount: 1,
      rangeEnd: currentDayEnd,
      rangeStart: currentDayStart,
    };
  }

  if (args.pulseWindow === "yesterday") {
    const rangeStart = currentDayStart - DAY_MS;

    return {
      comparisonEnd: rangeStart - 1,
      comparisonStart: rangeStart - DAY_MS,
      dayCount: 1,
      rangeEnd: rangeStart + DAY_MS - 1,
      rangeStart,
    };
  }

  if (args.pulseWindow === "this_week") {
    const dayOfWeek = new Date(currentDayStart).getUTCDay();
    const daysSinceMonday = (dayOfWeek + 6) % 7;
    const dayCount = daysSinceMonday + 1;
    const rangeStart = currentDayStart - daysSinceMonday * DAY_MS;
    const comparisonStart = rangeStart - 7 * DAY_MS;

    return {
      comparisonEnd: comparisonStart + dayCount * DAY_MS - 1,
      comparisonStart,
      dayCount,
      rangeEnd: currentDayEnd,
      rangeStart,
    };
  }

  if (args.pulseWindow === "last_week") {
    const dayOfWeek = new Date(currentDayStart).getUTCDay();
    const daysSinceMonday = (dayOfWeek + 6) % 7;
    const currentWeekStart = currentDayStart - daysSinceMonday * DAY_MS;
    const rangeStart = currentWeekStart - 7 * DAY_MS;
    const comparisonStart = rangeStart - 7 * DAY_MS;

    return {
      comparisonEnd: rangeStart - 1,
      comparisonStart,
      dayCount: 7,
      rangeEnd: currentWeekStart - 1,
      rangeStart,
    };
  }

  const currentDate = new Date(currentDayStart);
  const rangeStart = Date.UTC(
    currentDate.getUTCFullYear(),
    currentDate.getUTCMonth(),
    1,
  );
  const dayCount =
    Math.floor((currentDayStart - rangeStart) / DAY_MS) + 1;
  const previousMonthStart = Date.UTC(
    currentDate.getUTCFullYear(),
    currentDate.getUTCMonth() - 1,
    1,
  );
  const currentMonthStart = rangeStart;

  if (args.pulseWindow === "last_month") {
    const monthBeforePreviousStart = Date.UTC(
      currentDate.getUTCFullYear(),
      currentDate.getUTCMonth() - 2,
      1,
    );
    const previousMonthDayCount = Math.round(
      (currentMonthStart - previousMonthStart) / DAY_MS,
    );

    return {
      comparisonEnd: previousMonthStart - 1,
      comparisonStart: monthBeforePreviousStart,
      dayCount: previousMonthDayCount,
      rangeEnd: currentMonthStart - 1,
      rangeStart: previousMonthStart,
    };
  }

  const previousMonthDayCount = Math.round(
    (currentMonthStart - previousMonthStart) / DAY_MS,
  );
  const comparisonDayCount = Math.min(dayCount, previousMonthDayCount);

  return {
    comparisonEnd: previousMonthStart + comparisonDayCount * DAY_MS - 1,
    comparisonStart: previousMonthStart,
    dayCount,
    rangeEnd: currentDayEnd,
    rangeStart,
  };
}

function parseOperatingDateStart(operatingDate: string) {
  const parsed = Date.parse(`${operatingDate}T00:00:00.000Z`);
  return Number.isFinite(parsed)
    ? parsed
    : Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
}

function buildRecentDayBuckets(startAt: number, dayCount: number) {
  return Array.from({ length: dayCount }, (_, index): PosOperatorDayBucket => {
    const dateAt = startAt + index * DAY_MS;
    const date = toIsoDate(dateAt);
    return {
      averageTransaction: 0,
      date,
      label: formatShortDate(date),
      totalItemsSold: 0,
      totalSales: 0,
      transactionCount: 0,
    };
  });
}

function buildSummaryTrendBucket(
  dateAt: number,
  summary: PosPulseSummaryTotals,
  operatingDate?: string,
): PosOperatorDayBucket {
  const date = operatingDate ?? toIsoDate(dateAt);

  return {
    averageTransaction:
      summary.totalTransactions > 0
        ? summary.totalSales / summary.totalTransactions
        : 0,
    date,
    label: formatShortDate(date),
    totalItemsSold: summary.totalItemsSold,
    totalSales: summary.totalSales,
    transactionCount: summary.totalTransactions,
  };
}

function buildTransactionDateBuckets(
  transactions: Array<{ completedAt: number }>,
  fallbackDateAt: number,
) {
  const dates = Array.from(
    new Set(transactions.map((transaction) => toIsoDate(transaction.completedAt))),
  ).sort();

  if (!dates.length) {
    const date = toIsoDate(fallbackDateAt);

    return [
      {
        averageTransaction: 0,
        date,
        label: formatShortDate(date),
        totalItemsSold: 0,
        totalSales: 0,
        transactionCount: 0,
      },
    ];
  }

  return dates.map((date): PosOperatorDayBucket => ({
    averageTransaction: 0,
    date,
    label: formatShortDate(date),
    totalItemsSold: 0,
    totalSales: 0,
    transactionCount: 0,
  }));
}

function getFixedHistoryBucketDate(timestamp: number, historyStart: number) {
  const bucketIndex = Math.max(
    0,
    Math.floor((timestamp - historyStart) / DAY_MS),
  );

  return toIsoDate(historyStart + bucketIndex * DAY_MS);
}

function toIsoDate(timestamp: number) {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function formatShortDate(date: string) {
  const [, month = "01", day = "01"] = date.split("-");
  const monthIndex = Math.max(0, Math.min(11, Number(month) - 1));
  const monthLabel = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ][monthIndex];

  return `${monthLabel} ${Number(day)}`;
}

function formatHourLabel(hour: number) {
  const normalizedHour = ((hour % 24) + 24) % 24;
  const suffix = normalizedHour >= 12 ? "PM" : "AM";
  const hour12 = normalizedHour % 12 || 12;
  return `${hour12} ${suffix}`;
}

function formatPaymentMethodLabel(method: string) {
  switch (method) {
    case "mobile_money":
      return "Mobile money";
    case "credit_card":
      return "Credit card";
    case "debit_card":
      return "Debit card";
    case "card":
      return "Card";
    case "cash":
      return "Cash";
    default:
      return method
        .replace(/[-_]/g, " ")
        .replace(/\b\w/g, (character) => character.toUpperCase());
  }
}
