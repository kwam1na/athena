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

/** Mirrors REPORT_PAYMENT_METHODS in shared/reportsContract.ts. */
const reportPaymentMethod = v.union(
  v.literal("cash"),
  v.literal("card"),
  v.literal("mobile_money"),
);

/**
 * Gross payments by method. Two states only: `complete` rows reconcile exactly
 * to the same frame's `paymentsCollectedMinor`, and everything else is
 * `unavailable`. There is deliberately no partial shape — a breakdown that
 * does not add up to the total beside it is worse than none.
 */
const paymentMix = v.union(
  v.object({
    status: v.literal("complete"),
    totalMinor: v.number(),
    rows: v.array(
      v.object({
        method: reportPaymentMethod,
        amountMinor: v.number(),
        shareBasisPoints: v.number(),
        tenderUseCount: v.number(),
      }),
    ),
  }),
  v.object({ status: v.literal("unavailable") }),
);

/**
 * The bounded evidence behind a day's mix, carried between incremental
 * batches. `net` is a participation COUNT, not a value: a pair with a positive
 * net is one tender use, which is how several same-method allocations on one
 * POS transaction stay a single use.
 */
const paymentMixState = v.object({
  amountByMethod: v.array(
    v.object({ method: reportPaymentMethod, amountMinor: v.number() }),
  ),
  participation: v.array(
    v.object({
      participationId: v.string(),
      method: reportPaymentMethod,
      net: v.number(),
    }),
  ),
  unattributedMinor: v.number(),
  evidenceBroken: v.boolean(),
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
  // Optional-then-required: weekly documents written before weekly payment
  // posture landed carry neither field. See normalizeWeekMetrics.
  paymentAllocationOmittedMinor: v.optional(v.number()),
  paymentHasInvalidAllocation: v.optional(v.boolean()),
};

const weeklyLineage = v.object({
  localDate: v.string(),
  included: v.boolean(),
  scheduleVersionId: v.union(v.id("storeSchedule"), v.null()),
  dayStatus: v.union(dayStatus, v.null()),
  dayAvailable: v.boolean(),
  /**
   * Whether this date has an EOD close on record — `closeVarianceMinor` being
   * present on the day, the same evidence `computeWeeklyVariancePosture`
   * counts. Deliberately NOT derived from `dayStatus`: the sweeper folds a day
   * to `provisional` on its own, so a non-`open` day may still have no close.
   *
   * Optional because rows folded before this field existed carry none, and a
   * missing value means "unknown", never "not closed" — see
   * `lastClosedScheduledDate` in `reports/queries.ts`, which falls back to the
   * old behaviour rather than mistaking a legacy row for an unclosed week.
   */
  dayClosed: v.optional(v.boolean()),
  activityPosture: v.union(
    v.literal("recorded"),
    v.literal("zero_activity"),
    v.literal("unavailable"),
  ),
});

const weeklyCompletenessReason = v.union(
  v.literal("complete"),
  v.literal("missing_schedule"),
  v.literal("missing_timezone"),
  v.literal("schedule_history_cap"),
  v.literal("missing_day_fold"),
  v.literal("mixed_currency"),
  v.literal("payment_coverage_unknown"),
  v.literal("payment_invalid_allocation"),
  v.literal("fact_cap_exceeded"),
  v.literal("legacy_fact_without_observed_at"),
);

/**
 * Headline completeness covers the included dates only. The outside-schedule
 * lane carries its own verdict so an excluded date can never withhold — or
 * silently complete — the headline week.
 */
const weeklyCompleteness = v.object({
  reason: weeklyCompletenessReason,
  complete: v.boolean(),
  // Optional while weekly documents written before the split are refreshed.
  outsideSchedule: v.optional(
    v.object({ reason: weeklyCompletenessReason, complete: v.boolean() }),
  ),
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
  // Deliberately no live route: routing is rebuilt per read (queries.ts
  // `weeklyOwnerRoutes`), never frozen into an immutable accepted baseline.
  // Deprecated: projections materialized before the route field was removed
  // still carry it; nothing reads or writes it, and the next rebuild's
  // replace drops it. Delete this validator once no stored row carries it.
  route: v.optional(
    v.object({
      search: v.object({ workType: v.string() }),
      to: v.string(),
    }),
  ),
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
  // The prior week's outside-schedule lane, so the total-vs-total comparison
  // has a like-for-like counterpart. Optional only while rows written before
  // the lane landed are rebuilt; an absent value withholds the comparison
  // rather than falling back to the scheduled lane alone.
  outsideScheduleValues: v.optional(v.union(v.object(weeklyMetrics), v.null())),
});

/**
 * `closeVarianceMinor` is the whole-frame total; the scheduled/outside split
 * states which lane produced it. Coverage counts remain scheduled-only, since
 * only a scheduled date without a close is a coverage gap.
 *
 * The split fields are optional because rows written before the frame-wide
 * total landed carry a scheduled-only `closeVarianceMinor` and no knowable
 * split. Reads surface such a row's split as unavailable rather than zero.
 */
const weeklyVariancePosture = v.object({
  closeVarianceMinor: v.number(),
  coverage: v.union(
    v.literal("complete"),
    v.literal("partial"),
    v.literal("unavailable"),
  ),
  coveredIncludedDayCount: v.number(),
  includedDayCount: v.number(),
  scheduledVarianceMinor: v.optional(v.number()),
  outsideScheduleVarianceMinor: v.optional(v.number()),
  outsideScheduleCoveredDayCount: v.optional(v.number()),
});

const weeklyCashVariancePosture = v.object({
  cashVarianceMinor: v.number(),
  coverage: v.union(
    v.literal("complete"),
    v.literal("partial"),
    v.literal("unavailable"),
  ),
  coveredIncludedDayCount: v.number(),
  includedDayCount: v.number(),
});

const weeklyCloseEvidenceCoverage = v.object({
  scheduledDayCount: v.number(),
  status: v.union(
    v.literal("complete"),
    v.literal("partial"),
    v.literal("unavailable"),
  ),
  usableDayCount: v.number(),
});

const weeklyExpenseProduct = v.object({
  productName: v.string(),
  productSku: v.string(),
  productSkuId: v.id("productSku"),
  quantity: v.number(),
  spendMinor: v.number(),
});

const weeklyExpenseRemainder = v.object({
  productCount: v.number(),
  quantity: v.number(),
  spendMinor: v.number(),
});

const weeklyCloseEvidence = v.object({
  cash: v.object({
    cashVarianceMinor: v.number(),
    coverage: weeklyCloseEvidenceCoverage,
  }),
  // Optional for accepted/current rows written before transaction evidence.
  transactions: v.optional(
    v.object({
      coverage: weeklyCloseEvidenceCoverage,
      transactionCount: v.number(),
    }),
  ),
  payments: v.object({
    coveredTenderValueMinor: v.number(),
    coverage: weeklyCloseEvidenceCoverage,
    rows: v.array(
      v.object({
        amountMinor: v.number(),
        method: v.string(),
        shareBasisPoints: v.number(),
        tenderUseCount: v.number(),
      }),
    ),
  }),
  expenses: v.object({
    byQuantity: v.array(weeklyExpenseProduct),
    bySpend: v.array(weeklyExpenseProduct),
    coveredQuantity: v.number(),
    coveredSpendMinor: v.number(),
    coverage: weeklyCloseEvidenceCoverage,
    quantityRemainder: v.union(weeklyExpenseRemainder, v.null()),
    spendRemainder: v.union(weeklyExpenseRemainder, v.null()),
  }),
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
    // Deprecated: rows written before the outside-schedule verdict moved
    // inside `completeness.outsideSchedule` carry it top-level; nothing reads
    // or writes it, and the next rebuild's replace drops it. Delete this
    // validator once no stored row carries it.
    outsideScheduleCompleteness: v.optional(
      v.object({
        complete: v.boolean(),
        reason: weeklyCompletenessReason,
      }),
    ),
    lifecyclePosture: v.optional(weeklyLifecyclePosture),
    amendmentPosture: v.optional(weeklyAmendmentPosture),
    inventoryAttention: v.optional(weeklyInventoryAttention),
    acceptedBaselineId: v.optional(v.id("reportWeekAccepted")),
    closePosture: v.optional(weeklyClosePosture),
    amendment: v.optional(weeklyAmendment),
    priorPeriod: v.optional(weeklyPriorPeriod),
    variancePosture: v.optional(weeklyVariancePosture),
    cashVariancePosture: v.optional(weeklyCashVariancePosture),
    // Optional for legacy rows; every new available materialization writes it.
    closeEvidence: v.optional(weeklyCloseEvidence),
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
  topSkuLeaders: v.optional(
    v.array(
      v.object({
        productSkuId: v.id("productSku"),
        // Optional only for accepted rows created before identity freezing.
        productName: v.optional(v.string()),
        productSku: v.optional(v.string()),
        unitsSold: v.number(),
      }),
    ),
  ),
  lifecyclePosture: v.optional(weeklyLifecyclePosture),
  amendmentPosture: v.optional(weeklyAmendmentPosture),
  inventoryAttention: v.optional(weeklyInventoryAttention),
  closePosture: v.optional(weeklyClosePosture),
  amendment: v.optional(weeklyAmendment),
  priorPeriod: v.optional(weeklyPriorPeriod),
  variancePosture: v.optional(weeklyVariancePosture),
  cashVariancePosture: v.optional(weeklyCashVariancePosture),
  // Optional for accepted rows created before the close-evidence rollout.
  closeEvidence: v.optional(weeklyCloseEvidence),
  /**
   * One set-once repair projection. It is orthogonal to the immutable accepted
   * baseline and deliberately excludes financial/amendment/notification state.
   */
  correction: v.optional(
    v.object({
      contractVersion: v.literal(1),
      appliedAt: v.number(),
      candidateFingerprint: v.string(),
      sourceManifestFingerprint: v.string(),
      scheduleLineage: v.array(weeklyLineage),
      closeEvidence: weeklyCloseEvidence,
      // Reconstructed frozen top-sales identity. Absent when the corrected
      // baseline carried no leaders, so the section stays legitimately empty.
      topSkuLeaders: v.optional(
        v.array(
          v.object({
            productSkuId: v.id("productSku"),
            productName: v.string(),
            productSku: v.string(),
            unitsSold: v.number(),
          }),
        ),
      ),
    }),
  ),
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
  /**
   * The durable acceptance intent. Written once per (store, cycle, close) and
   * never rewritten, so a close patched between materialization retries cannot
   * move the knowledge cutoff of an immutable baseline. Optional for marks
   * created before the intent record landed, and for ordinary day-fold marks.
   */
  intent: v.optional(
    v.object({
      cycleStartDate: v.string(),
      closeId: v.id("dailyClose"),
      cutoffObservedAt: v.number(),
    }),
  ),
  /**
   * Why no intent could be recorded yet. Retryable and operator-visible: a
   * completed close with no `completedAt` has no immutable acceptance instant,
   * and the mutable `updatedAt` must never stand in for one.
   */
  acceptanceBlockedReason: v.optional(
    v.literal("close_missing_completed_at"),
  ),
  /**
   * Dates folded since this marker was raised. Persisted rather than handed
   * over in memory so a store whose marker misses the sweeper's weekly page
   * still replays its exact historical amendments on a later tick.
   */
  foldedDates: v.optional(v.array(v.string())),
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
  /**
   * Completed POS transactions the close settled, recorded by the fold so a
   * period read can sum basket-size evidence without reopening every close.
   *
   * Optional: absent on an unclosed day, and on any day folded before version
   * 5. Absent means UNKNOWN, never zero — a closed day with no sales stores 0.
   * `REPORTS_FOLD_VERSION` 5 + `foldVersionRepair` is what backfills history.
   * Not 4: that version stamped days without persisting this field, because
   * `foldAndReplaceDay` writes an explicit document rather than spreading the
   * fold result. See the version history in `shared/reportsContract.ts`.
   */
  transactionCount: v.optional(v.number()),

  /** Unset while the day is open (incrementally maintained, provisional). */
  foldedAt: v.optional(v.number()),
  foldVersion: v.number(),
  factCount: v.number(),
  /**
   * Exact number of `reportSkuDay` rows this day's fold wrote — the size of
   * the SKU-mix read for this day, published so the days rail can route the
   * mix chart without issuing the read (`skuMixSyncRowProbe`).
   *
   * Optional: days folded before U8 carry none. Absent means UNKNOWN, not
   * zero — a day with no SKU activity stores 0. `skuDayRowCountBackfillNeeded`
   * marks the pre-U8 generation for refold.
   */
  skuDayRowCount: v.optional(v.number()),
  lastFactRecordedAt: v.number(),
  flags: dayFlags,
  // Optional while legacy projections refresh; every new fold writes it.
  paymentPosture: v.optional(paymentPosture),
  /**
   * Gross payments by method for this day, and the bounded participation
   * evidence behind it.
   *
   * Optional because days folded before the mix landed carry neither. Absent
   * means UNKNOWN, never an empty mix: a day with zero receipts stores an
   * explicit `complete` mix with a zero total. Reads that see a legacy day
   * with positive receipts and no mix must treat it as unavailable —
   * `REPORTS_FOLD_VERSION` 6 + `foldVersionRepair` is what refreshes history.
   */
  paymentMix: v.optional(paymentMix),
  paymentMixState: v.optional(paymentMixState),
  /**
   * Certified fold revision — the movement trust boundary. Stamped by the
   * fold (U2) on the day and every SKU row it replaces, together. Optional
   * because rows folded before stamping landed carry none; they acquire one
   * only through the fold-version bump + foldVersionRepair rewrite. A missing
   * revision means "not admissible movement evidence", never "revision 0".
   */
  certifiedFoldRevision: v.optional(v.number()),
});

/** Sparse: rows exist only for (sku, day) pairs with activity. */
export const reportSkuDaySchema = v.object({
  storeId: v.id("store"),
  productSkuId: v.id("productSku"),
  operatingDate: v.string(),
  ...skuDayMetrics,
  foldedAt: v.optional(v.number()),
  /** Matches the owning reportDay's certifiedFoldRevision; see reportDay. */
  certifiedFoldRevision: v.optional(v.number()),
});

const periodSnapshot = v.object({
  ...dayMetrics,
  dayCount: v.number(),
  unsettledDayCount: v.number(),
  // Settled transaction evidence and the days it actually covers. Both
  // optional while existing singletons are refreshed by the sweeper; the pair
  // is meaningless apart, so reads treat either being absent as unknown.
  transactionCount: v.optional(v.number()),
  transactionCoveredDayCount: v.optional(v.number()),
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
  // Optional while existing singleton documents are refreshed by the sweeper.
  trailing6Months: v.optional(periodSnapshot),
  // Optional while existing singleton documents are refreshed by the sweeper.
  priorTrailing6Months: v.optional(periodSnapshot),
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

/**
 * On-demand range results, computed by background work, TTL'd.
 *
 * A row WITHOUT `kind` is a legacy custom-summary request and keeps its
 * exact original lifecycle (pending → completed/failed, failed rows reused
 * until TTL, "range:" request keys). Kinded rows are admitted range
 * snapshots driven by the kind-generic lifecycle
 * (convex/reports/rangeSnapshotLifecycle.ts): their `movement*` fields — the
 * prefix is historical, from the movement lifecycle that introduced them —
 * are the generic phase/fence/retry rail for ANY kind, their request keys
 * are kind-prefixed and fold in contract/fold versions plus the
 * included-day revision vector, and their per-SKU results live in per-kind
 * child tables (movement's is `reportRangeMovementSku`) — never in arrays on
 * this header. `kind: "sku_movement"` is the shipped movement snapshot; U4
 * adds `sku_mix`.
 */
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
  /** Absent = legacy custom summary (exact current behavior). */
  kind: v.optional(
    v.union(
      v.literal("custom_summary"),
      v.literal("sku_movement"),
      v.literal("sku_mix"),
    ),
  ),
  // -- Movement lifecycle (kind === "sku_movement" only; all optional so
  // -- legacy rows validate untouched). Field meanings are contract-owned:
  // -- shared/reportsContract.ts ReportMovementRequestPhase et al.
  movementPhase: v.optional(
    v.union(
      v.literal("queued"),
      v.literal("aggregating"),
      v.literal("ranking"),
      v.literal("retry_wait"),
      v.literal("completed"),
      v.literal("terminal_error"),
      v.literal("cleaning"),
    ),
  ),
  /** REPORT_MOVEMENT_CONTRACT_VERSION the snapshot was admitted under. */
  movementContractVersion: v.optional(v.number()),
  /**
   * Lineage: certified revision per included operating day (or the explicit
   * empty-day sentinel), captured at admission and rechecked at publication.
   * Bounded by REPORT_MOVEMENT_RANGE_MAX_DAYS (184) entries.
   */
  movementRevisionVector: v.optional(
    v.array(
      v.object({
        operatingDate: v.string(),
        revision: v.union(v.number(), v.literal("empty")),
      }),
    ),
  ),
  /** Retry metadata: attempts so far and when the next attempt is eligible. */
  movementAttempt: v.optional(v.number()),
  movementEligibleAt: v.optional(v.number()),
  /** Phase/version fence — a stale worker's writes must not apply. */
  movementFence: v.optional(v.number()),
  /** Next operating date to aggregate; unset once aggregation finishes. */
  movementSourceDayCursor: v.optional(v.string()),
  /** Authoritative kinded totals rail. Movement writes it only at rank
   * finalization; mix (no ranking phase) accumulates it during aggregation
   * with `unitsSold`/`netUnits` both carrying the sold total and
   * `unitsReturned` structurally zero. The generic lifecycle erases it on
   * retry resets and source-stale terminals for every kind. */
  movementTotals: v.optional(
    v.object({
      unitsSold: v.number(),
      unitsReturned: v.number(),
      netUnits: v.number(),
      skuCount: v.number(),
    }),
  ),
  /** Sanitized terminal metadata — never raw exception text. */
  movementErrorCode: v.optional(v.string()),
  movementCorrelationId: v.optional(v.string()),
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

/**
 * One row per (movement request, SKU) — the bounded child projection behind
 * ranked movement pages. Request-owned and private until the header
 * completes; addressable ONLY through indexes (the header stores no child
 * ids). Signed semantics: `netUnits` keeps its sign so outbound movement and
 * net returns stay distinguishable, while `absNetUnitsSortKey` (negated
 * |netUnits|, ascending-index convention as in reportPeriodSkuRollup) gives
 * both tabs one deterministic ordering with `productSkuId` as the tie-break.
 */
/**
 * Fixed-window admission counters for kinded range-snapshot generation,
 * modeled on the shared-demo admission bucket (sharedDemo/admission.ts) but
 * this lifecycle's own table (the `Movement` name is historical): one row
 * per (scope, key) window. Keys are kind-scoped so each kind's budgets are
 * independent at every scope: movement (grandfathered — its production rows
 * predate kind scoping) keys `scope: "principal"` by raw athenaUser id,
 * `"store"` by raw store id, `"global"` by the literal "global"; every
 * later kind prefixes each of those with `"<kind>:"`. No migration
 * accompanies key-shape changes — buckets are fixed 10-minute windows, so
 * rows under a superseded key age out within one window.
 * Rows are transient rate-limit state, not derived report data — they are
 * overwritten in place when a window rolls and are deliberately NOT part of
 * `RESEED_PURGE_TABLES` (a reseed must not reset abuse budgets).
 */
export const reportMovementAdmissionSchema = v.object({
  scope: v.union(
    v.literal("principal"),
    v.literal("store"),
    v.literal("global"),
  ),
  key: v.string(),
  windowStartedAt: v.number(),
  count: v.number(),
});

export const reportRangeMovementSkuSchema = v.object({
  storeId: v.id("store"),
  /** Owning request header; cleanup deletes children before the header. */
  rangeResultId: v.id("reportRangeResult"),
  productSkuId: v.id("productSku"),
  unitsSold: v.number(),
  unitsReturned: v.number(),
  /** Signed: sold minus returned; may be negative or zero with activity. */
  netUnits: v.number(),
  /** -|netUnits|: ascending index order = descending absolute movement. */
  absNetUnitsSortKey: v.number(),
  /** Ordinal rank (1-based); absent until rank finalization completes. */
  rank: v.optional(v.number()),
  /** Cleanup ownership: mirrors the header's expiresAt so expired children
   * are found directly, without loading their header first. */
  expiresAt: v.number(),
});

/**
 * One row per (mix request, SKU) — the bounded child projection behind the
 * top-5 SKU mix reader. A sibling of `reportRangeMovementSku`, deliberately
 * NOT that table reused: movement's `netUnits`/`absNetUnitsSortKey` encode
 * signed movement semantics mix does not have. Rows exist only for SKUs with
 * accumulated `unitsSold > 0` (matching the sync reader's aggregate-level
 * filter), and there is NO rank field: mix only ever shows top 5 + Other, so
 * the reader takes the top rows through the sort-key index at read time
 * instead of running a ranking pass. Request-owned and private until the
 * header completes; addressable ONLY through indexes.
 */
export const reportRangeMixSkuSchema = v.object({
  storeId: v.id("store"),
  /** Owning request header; cleanup deletes children before the header. */
  rangeResultId: v.id("reportRangeResult"),
  productSkuId: v.id("productSku"),
  /** Accumulated units sold across the range; always > 0 once written. */
  unitsSold: v.number(),
  /** -unitsSold: ascending index order = descending units sold. */
  unitsSoldSortKey: v.number(),
  /** Cleanup ownership: mirrors the header's expiresAt so expired children
   * are found directly, without loading their header first. */
  expiresAt: v.number(),
});
