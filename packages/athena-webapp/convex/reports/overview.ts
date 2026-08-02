import type { MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import {
  weekPeriodKey,
  trailingThreeMonthsStart,
  type ReportDayMetrics,
  type ReportOverviewData,
  type ReportPeriodSnapshot,
  type ReportTrendPoint,
  type ReportTrustSummary,
  normalizeCurrencyCode,
} from "../../shared/reportsContract";
import { addDaysToDate } from "./rollups";
import { transactionCountFromCloseSummary } from "./transactionCounts";

/**
 * The overview document (slice C).
 *
 * The dashboard subscribes to exactly ONE doc per store. Everything it needs —
 * KPI snapshots, comparisons, the 30-day sparkline, the trust strip — is
 * denormalized here at sweep time, so a dashboard execution costs one read and
 * re-executes at most once per sweep instead of once per fact.
 *
 * Read ledger for a rebuild: ONE index read of at most
 * `OVERVIEW_DAY_SCAN_LIMIT` reportDay docs, plus the singleton lookup.
 */

/**
 * Day docs read per rebuild. One doc per operating day; 184 covers the current
 * and immediately preceding three-calendar-month windows.
 */
export const OVERVIEW_DAY_SCAN_LIMIT = 184;

export const OVERVIEW_TREND_DAYS = 30;

const ZERO_METRICS: ReportDayMetrics = {
  grossSalesMinor: 0,
  netSalesMinor: 0,
  refundsMinor: 0,
  unitsSold: 0,
  unitsReturned: 0,
  uncostedRevenueMinor: 0,
  grossProfitMinor: 0,
  paymentsCollectedMinor: 0,
  paymentsRefundedMinor: 0,
  paymentAllocatedMinor: 0,
};

export function emptySnapshot(): ReportPeriodSnapshot {
  return { ...ZERO_METRICS, dayCount: 0, unsettledDayCount: 0 };
}

/** A day whose numbers can still move: mid-flight or not yet reconciled. */
function isUnsettled(status: Doc<"reportDay">["status"]): boolean {
  return status === "open" || status === "provisional";
}

/**
 * Sum day docs into a period snapshot.
 *
 * `grossProfitMinor` is null when ANY contributing day lacks a cost basis —
 * a partial sum would read as a real margin.
 */
export function snapshotForDays(
  days: readonly Doc<"reportDay">[],
): ReportPeriodSnapshot {
  const snapshot = emptySnapshot();
  let grossProfit: number | null = 0;

  for (const day of days) {
    snapshot.grossSalesMinor += day.grossSalesMinor;
    snapshot.netSalesMinor += day.netSalesMinor;
    snapshot.refundsMinor += day.refundsMinor;
    snapshot.unitsSold += day.unitsSold;
    snapshot.unitsReturned += day.unitsReturned;
    snapshot.uncostedRevenueMinor += day.uncostedRevenueMinor;
    snapshot.paymentsCollectedMinor += day.paymentsCollectedMinor;
    snapshot.paymentsRefundedMinor += day.paymentsRefundedMinor;
    snapshot.paymentAllocatedMinor += day.paymentAllocatedMinor;
    grossProfit =
      grossProfit === null || day.grossProfitMinor === null
        ? null
        : grossProfit + day.grossProfitMinor;
    snapshot.dayCount += 1;
    if (isUnsettled(day.status)) snapshot.unsettledDayCount += 1;
  }

  snapshot.grossProfitMinor = grossProfit;
  return snapshot;
}

/**
 * Relative change in basis points (1bp = 0.01%), rounded.
 * Null when the prior period is zero — "infinite growth" is not a number an
 * operator can act on, so the UI shows "no comparison" instead of a fake one.
 */
export function comparisonBp(current: number, prior: number): number | null {
  if (prior === 0) return null;
  return Math.round(((current - prior) / Math.abs(prior)) * 10_000);
}

export function trustSummaryForDays(
  days: readonly Doc<"reportDay">[],
): ReportTrustSummary {
  const summary: ReportTrustSummary = {
    reconciledDays: 0,
    provisionalDays: 0,
    amendedDays: 0,
  };

  // `days` arrives ascending, so the first unreconciled day is the oldest.
  for (const day of days) {
    if (day.status === "reconciled") summary.reconciledDays += 1;
    else if (day.status === "amended") summary.amendedDays += 1;
    else if (day.status === "provisional") summary.provisionalDays += 1;

    if (day.status !== "reconciled" && summary.oldestUnreconciledDate === undefined) {
      summary.oldestUnreconciledDate = day.operatingDate;
    }
  }

  return summary;
}

/**
 * The store's "today" for overview purposes: the day still open, else the most
 * recent day on record. Deliberately derived from the day docs rather than
 * from operating-day/timezone resolution — the overview describes the data
 * that exists, and a store with no facts today has nothing to show for it.
 */
export function anchorDate(days: readonly Doc<"reportDay">[]): string | null {
  const open = days.find((day) => day.status === "open");
  if (open) return open.operatingDate;
  return days.length > 0 ? days[days.length - 1].operatingDate : null;
}

/**
 * Pure overview construction. `days` must be ASCENDING by operatingDate and
 * contain at least the trailing-30 window and the prior ISO week.
 */
export function buildOverviewData(args: {
  days: readonly Doc<"reportDay">[];
  fallbackCurrency: string;
  now: number;
  /** Settled transaction counts by operating date; absent days stay absent. */
  transactionCountsByDate?: ReadonlyMap<string, number>;
}): ReportOverviewData {
  const { days, now } = args;
  const anchor = anchorDate(days);

  if (anchor === null) {
    return {
      updatedAt: now,
      currency: args.fallbackCurrency,
      today: emptySnapshot(),
      yesterday: emptySnapshot(),
      weekToDate: emptySnapshot(),
      priorWeek: emptySnapshot(),
      trailing30: emptySnapshot(),
      priorTrailing30: emptySnapshot(),
      trailing3Months: emptySnapshot(),
      priorTrailing3Months: emptySnapshot(),
      comparisons: { netSalesVsPriorWeekBp: null, unitsSoldVsPriorWeekBp: null },
      dailyTrend: [],
      trust: { reconciledDays: 0, provisionalDays: 0, amendedDays: 0 },
    };
  }

  const anchorDay = days.find((day) => day.operatingDate === anchor);
  const yesterdayDate = addDaysToDate(anchor, -1);
  const yesterdayDay = days.find(
    (day) => day.operatingDate === yesterdayDate,
  );
  const currency = anchorDay?.currency ?? args.fallbackCurrency;

  const trailingStart = addDaysToDate(anchor, -(OVERVIEW_TREND_DAYS - 1));
  const priorTrailing30Start = addDaysToDate(
    trailingStart,
    -OVERVIEW_TREND_DAYS,
  );
  const priorTrailing30End = addDaysToDate(trailingStart, -1);
  const trailing30Days = days.filter(
    (day) => day.operatingDate >= trailingStart && day.operatingDate <= anchor,
  );
  const priorTrailing30Days = days.filter(
    (day) =>
      day.operatingDate >= priorTrailing30Start &&
      day.operatingDate <= priorTrailing30End,
  );
  const trailing3MonthsStart = trailingThreeMonthsStart(anchor);
  const priorTrailing3MonthsEnd = addDaysToDate(trailing3MonthsStart, -1);
  const priorTrailing3MonthsStart = trailingThreeMonthsStart(
    priorTrailing3MonthsEnd,
  );
  const trailing3MonthsDays = days.filter(
    (day) =>
      day.operatingDate >= trailing3MonthsStart &&
      day.operatingDate <= anchor,
  );
  const priorTrailing3MonthsDays = days.filter(
    (day) =>
      day.operatingDate >= priorTrailing3MonthsStart &&
      day.operatingDate <= priorTrailing3MonthsEnd,
  );

  const currentWeekKey = weekPeriodKey(anchor);
  const priorWeekKey = weekPeriodKey(addDaysToDate(anchor, -7));

  const weekToDateDays = days.filter(
    (day) =>
      day.operatingDate <= anchor &&
      weekPeriodKey(day.operatingDate) === currentWeekKey,
  );
  const priorWeekDays = days.filter(
    (day) => weekPeriodKey(day.operatingDate) === priorWeekKey,
  );

  const weekToDate = snapshotForDays(weekToDateDays);
  const priorWeek = snapshotForDays(priorWeekDays);

  const dailyTrend: ReportTrendPoint[] = trailing30Days.map((day) => ({
    operatingDate: day.operatingDate,
    netSalesMinor: day.netSalesMinor,
    status: day.status,
    unitsSold: day.unitsSold,
    transactionCount: args.transactionCountsByDate?.get(day.operatingDate),
  }));

  return {
    updatedAt: now,
    currency,
    today: anchorDay ? snapshotForDays([anchorDay]) : emptySnapshot(),
    yesterday: yesterdayDay
      ? snapshotForDays([yesterdayDay])
      : emptySnapshot(),
    weekToDate,
    priorWeek,
    trailing30: snapshotForDays(trailing30Days),
    priorTrailing30: snapshotForDays(priorTrailing30Days),
    trailing3Months: snapshotForDays(trailing3MonthsDays),
    priorTrailing3Months: snapshotForDays(priorTrailing3MonthsDays),
    comparisons: {
      netSalesVsPriorWeekBp: comparisonBp(
        weekToDate.netSalesMinor,
        priorWeek.netSalesMinor,
      ),
      unitsSoldVsPriorWeekBp: comparisonBp(
        weekToDate.unitsSold,
        priorWeek.unitsSold,
      ),
    },
    dailyTrend,
    trust: trustSummaryForDays(trailing30Days),
  };
}

/** Read the store's recent day docs, ascending. Bounded by construction. */
export async function readRecentDays(
  ctx: MutationCtx,
  storeId: Id<"store">,
): Promise<Doc<"reportDay">[]> {
  const descending = await ctx.db
    .query("reportDay")
    .withIndex("by_storeId_operatingDate", (q) => q.eq("storeId", storeId))
    .order("desc")
    .take(OVERVIEW_DAY_SCAN_LIMIT);

  return descending.reverse();
}

/**
 * Settled transaction counts for the trend window, keyed by operating date.
 *
 * Bounded by `OVERVIEW_TREND_DAYS` close lookups on top of the day scan, and
 * only for days that actually closed. Open days are omitted rather than
 * counted live: the sweep would then depend on fact volume, and the overview
 * exists precisely so the dashboard never pays that cost.
 */
async function readTrendTransactionCounts(
  ctx: MutationCtx,
  days: readonly Doc<"reportDay">[],
): Promise<Map<string, number>> {
  const trendDays = days.slice(-OVERVIEW_TREND_DAYS).filter((day) => day.closeId);
  const closes = await Promise.all(
    trendDays.map((day) => ctx.db.get("dailyClose", day.closeId!)),
  );

  const counts = new Map<string, number>();
  trendDays.forEach((day, index) => {
    const close = closes[index];
    if (!close) return;
    counts.set(
      day.operatingDate,
      transactionCountFromCloseSummary(close.summary),
    );
  });

  return counts;
}

/** Rebuild and upsert the store's singleton overview doc. */
export async function rebuildStoreOverview(
  ctx: MutationCtx,
  storeId: Id<"store">,
  now: number,
): Promise<void> {
  const days = await readRecentDays(ctx, storeId);
  const store = await ctx.db.get("store", storeId);

  const data = buildOverviewData({
    days,
    fallbackCurrency: normalizeCurrencyCode(store?.currency),
    now,
    transactionCountsByDate: await readTrendTransactionCounts(ctx, days),
  });

  const existing = await ctx.db
    .query("reportOverview")
    .withIndex("by_storeId", (q) => q.eq("storeId", storeId))
    .unique();

  if (existing) {
    await ctx.db.patch("reportOverview", existing._id, data);
    return;
  }

  await ctx.db.insert("reportOverview", { storeId, ...data });
}
