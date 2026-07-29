import { v } from "convex/values";

/**
 * Derived read-model tables. All are disposable projections of reportFact:
 * the day fold can rebuild any of them wholesale, so none carry audit weight.
 *
 * Metric-as-field everywhere — never metric-as-row. Field names MUST match
 * shared/reportsContract.ts (enforced by convex/reports/contract.test.ts).
 */

const dayStatus = v.union(
  v.literal("open"),
  v.literal("provisional"),
  v.literal("reconciled"),
  v.literal("amended"),
);

const dayMetrics = {
  grossSalesMinor: v.number(),
  netSalesMinor: v.number(),
  refundsMinor: v.number(),
  unitsSold: v.number(),
  unitsReturned: v.number(),
  uncostedRevenueMinor: v.number(),
  grossProfitMinor: v.union(v.number(), v.null()),
  paymentsCollectedMinor: v.number(),
  paymentsRefundedMinor: v.number(),
  paymentAllocatedMinor: v.number(),
} as const;

const skuDayMetrics = {
  unitsSold: v.number(),
  unitsReturned: v.number(),
  grossSalesMinor: v.number(),
  netSalesMinor: v.number(),
  refundsMinor: v.number(),
  uncostedRevenueMinor: v.number(),
  grossProfitMinor: v.union(v.number(), v.null()),
} as const;

const dayFlags = v.object({
  mixedCurrency: v.boolean(),
  hasUncostedRevenue: v.boolean(),
  quarantinedFactCount: v.number(),
});

/** One doc per (store, operating day). The unit of trust and of rebuild. */
export const reportDaySchema = v.object({
  storeId: v.id("store"),
  operatingDate: v.string(),
  currency: v.string(),
  status: dayStatus,
  ...dayMetrics,

  closeId: v.optional(v.id("dailyClose")),
  closeAcceptedAt: v.optional(v.number()),
  closeVarianceMinor: v.optional(v.number()),
  postCloseNetSalesDeltaMinor: v.optional(v.number()),

  /** Unset while the day is open (incrementally maintained, provisional). */
  foldedAt: v.optional(v.number()),
  foldVersion: v.number(),
  factCount: v.number(),
  lastFactRecordedAt: v.number(),
  flags: dayFlags,
});

/** Sparse: rows exist only for (sku, day) pairs with activity. */
export const reportSkuDaySchema = v.object({
  storeId: v.id("store"),
  productSkuId: v.id("productSku"),
  operatingDate: v.string(),
  ...skuDayMetrics,
  foldedAt: v.optional(v.number()),
});

const periodSnapshot = v.object({
  ...dayMetrics,
  dayCount: v.number(),
  unsettledDayCount: v.number(),
});

/** Singleton per store. The dashboard subscribes to THIS DOC ONLY. */
export const reportOverviewSchema = v.object({
  storeId: v.id("store"),
  updatedAt: v.number(),
  currency: v.string(),
  today: periodSnapshot,
  weekToDate: periodSnapshot,
  priorWeek: periodSnapshot,
  trailing30: periodSnapshot,
  comparisons: v.object({
    netSalesVsPriorWeekBp: v.union(v.number(), v.null()),
    unitsSoldVsPriorWeekBp: v.union(v.number(), v.null()),
  }),
  dailyTrend: v.array(
    v.object({
      operatingDate: v.string(),
      netSalesMinor: v.number(),
      status: dayStatus,
    }),
  ),
  trust: v.object({
    reconciledDays: v.number(),
    provisionalDays: v.number(),
    amendedDays: v.number(),
    oldestUnreconciledDate: v.optional(v.string()),
  }),
});

/**
 * Materialized per-SKU rollups for calendar periods ("d:…", "w:…", "m:…").
 * Rolling windows live on the overview doc; custom ranges are on-demand.
 * Sort keys are negated measures (Convex indexes are ascending-only).
 */
export const reportPeriodSkuRollupSchema = v.object({
  storeId: v.id("store"),
  periodKey: v.string(),
  productSkuId: v.id("productSku"),
  ...skuDayMetrics,
  revenueSortKey: v.number(),
  unitsSortKey: v.number(),
});

/**
 * Work queue for the sweeper. Separate table so dirty marks never invalidate
 * subscriptions on reportDay/reportOverview docs. One row per (store, day),
 * upserted; the sweeper deletes marks it has folded.
 */
export const reportDirtyDaySchema = v.object({
  storeId: v.id("store"),
  operatingDate: v.string(),
  reason: v.union(
    v.literal("day_open"),
    v.literal("late_fact"),
    v.literal("close_accepted"),
    v.literal("fold_version_bump"),
    v.literal("reseed"),
    v.literal("write_failure"),
    // The day holds more rows than a fold read may take; folding it would
    // write a silently truncated total. See DayCapExceeded in sweeper.ts.
    v.literal("fact_cap_exceeded"),
  ),
  markedAt: v.number(),
});

/** On-demand custom range results, computed by the sweeper, TTL'd. */
export const reportRangeResultSchema = v.object({
  storeId: v.id("store"),
  requestKey: v.string(),
  startDate: v.string(),
  endDate: v.string(),
  status: v.union(
    v.literal("pending"),
    v.literal("completed"),
    v.literal("failed"),
  ),
  totals: v.optional(
    v.object({
      ...dayMetrics,
      dayCount: v.number(),
      unsettledDayCount: v.number(),
    }),
  ),
  topSkus: v.optional(
    v.array(
      v.object({
        productSkuId: v.id("productSku"),
        periodKey: v.string(),
        ...skuDayMetrics,
      }),
    ),
  ),
  failureReason: v.optional(v.string()),
  requestedAt: v.number(),
  computedAt: v.optional(v.number()),
  expiresAt: v.number(),
  foldVersion: v.number(),
});
