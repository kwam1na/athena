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

const paymentPosture = v.object({
  collectedMinor: v.number(),
  refundedMinor: v.number(),
  allocatedMinor: v.number(),
  unsettledMinor: v.union(v.number(), v.null()),
  allocationCoverage: v.union(v.literal("complete"), v.literal("unknown")),
  allocationOmittedMinor: v.number(),
  hasInvalidAllocation: v.boolean(),
});

/** Compact weekly metric snapshot. It is deliberately metric-as-field. */
const weeklyMetrics = {
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
  paymentUnsettledMinor: v.union(v.number(), v.null()),
  paymentAllocationCoverage: v.union(
    v.literal("complete"),
    v.literal("unknown"),
  ),
};

const weeklyLineage = v.object({
  localDate: v.string(),
  included: v.boolean(),
  scheduleVersionId: v.union(v.id("storeSchedule"), v.null()),
  dayStatus: v.union(dayStatus, v.null()),
  dayAvailable: v.boolean(),
  activityPosture: v.union(
    v.literal("recorded"),
    v.literal("zero_activity"),
    v.literal("unavailable"),
  ),
});

const weeklyCompleteness = v.object({
  reason: v.union(
    v.literal("complete"),
    v.literal("missing_schedule"),
    v.literal("missing_timezone"),
    v.literal("schedule_history_cap"),
    v.literal("missing_day_fold"),
    v.literal("mixed_currency"),
    v.literal("payment_coverage_unknown"),
    v.literal("fact_cap_exceeded"),
    v.literal("legacy_fact_without_observed_at"),
  ),
  complete: v.boolean(),
});

const weeklyInventoryAttention = v.object({
  carriedForwardCount: v.number(),
  completeness: v.union(
    v.literal("complete"),
    v.literal("incomplete"),
    v.literal("unavailable"),
  ),
  groups: v.array(
    v.object({
      classification: v.union(
        v.literal("carried_forward"),
        v.literal("new_this_week"),
      ),
      evidenceLimited: v.boolean(),
      hasNewActivity: v.boolean(),
      key: v.string(),
      memberCount: v.number(),
      productSkuId: v.union(v.id("productSku"), v.null()),
    }),
  ),
  newCount: v.number(),
  observedCount: v.number(),
  overflow: v.boolean(),
  route: v.object({
    search: v.object({
      workType: v.literal("synced_sale_inventory_review"),
    }),
    to: v.literal("/operations"),
  }),
});

const weeklyClosePosture = v.object({
  acceptedCloseId: v.id("dailyClose"),
  currentCloseId: v.optional(v.id("dailyClose")),
  changedAt: v.number(),
  status: v.union(
    v.literal("accepted"),
    v.literal("reopened_awaiting_successor"),
    v.literal("successor_accepted"),
  ),
});

const weeklyAmendment = v.object({
  changedAt: v.number(),
  currentFingerprint: v.string(),
  included: v.object(weeklyMetrics),
  includedNetSalesDeltaMinor: v.number(),
  outsideSchedule: v.object(weeklyMetrics),
  outsideScheduleNetSalesDeltaMinor: v.number(),
  sourceCloseAcceptedAt: v.optional(v.number()),
  sourceCloseId: v.optional(v.id("dailyClose")),
});

const weeklyPriorPeriod = v.object({
  cycleEndDate: v.string(),
  cycleStartDate: v.string(),
  comparabilityReason: v.union(
    v.literal("comparable"),
    v.literal("missing_schedule"),
    v.literal("missing_timezone"),
    v.literal("schedule_history_cap"),
    v.literal("scheduled_membership_changed"),
    v.literal("missing_prior_day_fold"),
    v.literal("prior_incomplete"),
  ),
  currentScheduledPositionCount: v.number(),
  equivalentScheduledPositions: v.boolean(),
  priorScheduledPositionCount: v.number(),
  values: v.union(v.object(weeklyMetrics), v.null()),
});

const weeklyVariancePosture = v.object({
  closeVarianceMinor: v.number(),
  coverage: v.union(
    v.literal("complete"),
    v.literal("partial"),
    v.literal("unavailable"),
  ),
  coveredIncludedDayCount: v.number(),
  includedDayCount: v.number(),
});

const weeklyLifecyclePosture = v.union(
  v.literal("live"),
  v.literal("awaiting_final_close"),
  v.literal("materializing"),
  v.literal("accepted"),
  v.literal("reopened_awaiting_successor"),
  v.literal("successor_accepted"),
);

const weeklyAmendmentPosture = v.union(
  v.literal("none"),
  v.literal("pending_recompute"),
  v.literal("amended"),
);

const weeklyUnavailableReason = v.union(
  v.literal("missing_schedule"),
  v.literal("missing_timezone"),
  v.literal("schedule_history_cap"),
  v.literal("no_scheduled_dates"),
  v.literal("missing_day_fold"),
  v.literal("missing_projection"),
);

/**
 * The one current weekly projection per store. It is replaced wholesale by
 * the Reports sweeper, never assembled by a client or source-domain query.
 */
export const reportWeekCurrentSchema = v.union(
  v.object({
    storeId: v.id("store"),
    availability: v.literal("unavailable"),
    unavailableReason: weeklyUnavailableReason,
    lifecyclePosture: v.literal("materializing"),
    amendmentPosture: weeklyAmendmentPosture,
    materializedAt: v.number(),
  }),
  v.object({
    storeId: v.id("store"),
    // Optional only for rows written before the posture contract landed.
    availability: v.optional(v.literal("available")),
    cycleStartDate: v.string(),
    cycleEndDate: v.string(),
    currency: v.string(),
    metricVersion: v.number(),
    materializedAt: v.number(),
    included: v.object(weeklyMetrics),
    outsideSchedule: v.object(weeklyMetrics),
    scheduleLineage: v.array(weeklyLineage),
    completeness: weeklyCompleteness,
    lifecyclePosture: v.optional(weeklyLifecyclePosture),
    amendmentPosture: v.optional(weeklyAmendmentPosture),
    inventoryAttention: v.optional(weeklyInventoryAttention),
    acceptedBaselineId: v.optional(v.id("reportWeekAccepted")),
    closePosture: v.optional(weeklyClosePosture),
    amendment: v.optional(weeklyAmendment),
    priorPeriod: v.optional(weeklyPriorPeriod),
    variancePosture: v.optional(weeklyVariancePosture),
  }),
);

/**
 * Immutable accepted values. Only `closePosture` and the single replacement
 * `amendment` projection may change as later operational truth arrives.
 */
export const reportWeekAcceptedSchema = v.object({
  storeId: v.id("store"),
  cycleStartDate: v.string(),
  cycleEndDate: v.string(),
  currency: v.string(),
  metricVersion: v.number(),
  acceptedAt: v.number(),
  cutoffObservedAt: v.number(),
  closeId: v.id("dailyClose"),
  baselineFingerprint: v.string(),
  included: v.object(weeklyMetrics),
  outsideSchedule: v.object(weeklyMetrics),
  scheduleLineage: v.array(weeklyLineage),
  completeness: weeklyCompleteness,
  lifecyclePosture: v.optional(weeklyLifecyclePosture),
  amendmentPosture: v.optional(weeklyAmendmentPosture),
  inventoryAttention: v.optional(weeklyInventoryAttention),
  closePosture: v.optional(weeklyClosePosture),
  amendment: v.optional(weeklyAmendment),
  priorPeriod: v.optional(weeklyPriorPeriod),
  variancePosture: v.optional(weeklyVariancePosture),
});

/** One declarative per-store work marker, drained by the existing sweeper. */
export const reportDirtyWeekSchema = v.object({
  storeId: v.id("store"),
  reason: v.union(
    v.literal("day_folded"),
    v.literal("acceptance_requested"),
    v.literal("write_failure"),
  ),
  markedAt: v.number(),
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
  // Optional while legacy projections refresh; every new fold writes it.
  paymentPosture: v.optional(paymentPosture),
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
  // Optional while existing singleton documents are refreshed by the sweeper.
  yesterday: v.optional(periodSnapshot),
  weekToDate: periodSnapshot,
  priorWeek: periodSnapshot,
  trailing30: periodSnapshot,
  // Optional while existing singleton documents are refreshed by the sweeper.
  priorTrailing30: v.optional(periodSnapshot),
  // Optional while existing singleton documents are refreshed by the sweeper.
  trailing3Months: v.optional(periodSnapshot),
  // Optional while existing singleton documents are refreshed by the sweeper.
  priorTrailing3Months: v.optional(periodSnapshot),
  comparisons: v.object({
    netSalesVsPriorWeekBp: v.union(v.number(), v.null()),
    unitsSoldVsPriorWeekBp: v.union(v.number(), v.null()),
  }),
  dailyTrend: v.array(
    v.object({
      operatingDate: v.string(),
      netSalesMinor: v.number(),
      status: dayStatus,
      // Optional during the rolling overview-document migration.
      unitsSold: v.optional(v.number()),
      // Absent for days with no register close; see ReportTrendPoint.
      transactionCount: v.optional(v.number()),
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
