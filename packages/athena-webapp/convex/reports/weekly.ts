import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import {
  type FoldFact,
  type ReportWeekAmendmentPosture,
  type ReportWeekCompleteness,
  type ReportWeekLifecyclePosture,
  type ReportWeekLineage,
  type ReportWeekMetrics,
  normalizeCurrencyCode,
} from "../../shared/reportsContract";
import {
  localDateAt,
  localDateStartAt,
  localDateTimeAt,
  localTimeAt,
} from "../lib/storeScheduleTime";
import { stableStringHash } from "./fingerprint";
import { foldDay } from "./foldDay";
import { listOpenSyncedSaleInventoryReviewGroupsWithCompleteness } from "../operations/operationalWorkItems";
import {
  projectFrozenWeeklyInventoryAttention,
  projectLiveWeeklyInventoryAttention,
} from "./weeklyInventory";
import { resolveWeeklyPeriod, type WeeklyPeriod } from "./weeklyPeriods";
import {
  hasCompletedWeeklyObservedAtVerification,
  isCloseWithinWeeklyAcceptanceFloor,
} from "../platform/capabilityCatalog";
import { addDaysToDate } from "./rollups";
import { getStoreScheduleContextForStoreAtWithCtx } from "../inventory/storeSchedule";
import { scheduleNotificationWithCtx } from "../notifications/emit";

/**
 * Active/candidate schedule versions read to resolve one seven-date reporting
 * frame. Every resolver scan reads this cap plus one overflow probe.
 */
export const WEEKLY_SCHEDULE_READ_LIMIT = 100;
/** `reportDay` has at most one row per frame date; one extra detects drift. */
export const WEEKLY_DAY_READ_LIMIT = 8;
/**
 * Shared acceptance cap across all seven dates. Each date gets only the
 * remaining allowance plus one probe, so the full frame reads at most this
 * many facts plus one overflow row — never this cap per date.
 */
export const MAX_WEEKLY_FACTS = 4_000;
/** One live partial prior-day fact fold, with a single overflow probe. */
export const MAX_WEEKLY_LIVE_PRIOR_CUTOFF_FACTS = 500;

export function acceptedTopSkuLeaders(args: {
  currency: string;
  factsByDate: ReadonlyMap<string, readonly Doc<"reportFact">[]>;
}): Array<{ productSkuId: Id<"productSku">; unitsSold: number }> {
  const unitsBySku = new Map<string, number>();
  for (const facts of args.factsByDate.values()) {
    const { skuDays } = foldDay(args.currency, facts.map(toFoldFact));
    for (const [productSkuId, metrics] of skuDays) {
      unitsBySku.set(
        productSkuId,
        (unitsBySku.get(productSkuId) ?? 0) + metrics.unitsSold,
      );
    }
  }

  return Array.from(unitsBySku, ([productSkuId, unitsSold]) => ({
    productSkuId: productSkuId as Id<"productSku">,
    unitsSold,
  }))
    .filter((row) => row.unitsSold > 0)
    .sort(
      (left, right) =>
        right.unitsSold - left.unitsSold ||
        String(left.productSkuId).localeCompare(String(right.productSkuId)),
    )
    .slice(0, 3);
}

export function nextWeeklyReportDeliveryAt(args: {
  acceptedAt: number;
  timezone: string;
}): number {
  const acceptedLocalDate = localDateAt(args.acceptedAt, args.timezone);
  const deliveryAt = localDateTimeAt({
    localDate: addDaysToDate(acceptedLocalDate, 1),
    time: { hour: 8, minute: 0, second: 0, millisecond: 0 },
    timezone: args.timezone,
  });
  if (deliveryAt === null) {
    throw new Error("Could not resolve weekly report delivery time.");
  }
  return deliveryAt;
}

export async function scheduleWeeklyManagerReportNotificationWithCtx(
  ctx: Pick<MutationCtx, "scheduler">,
  args: {
    acceptedAt: number;
    acceptedWeekId: Id<"reportWeekAccepted">;
    organizationId: Id<"organization">;
    storeId: Id<"store">;
    timezone: string;
  },
): Promise<Id<"_scheduled_functions">> {
  return scheduleNotificationWithCtx(ctx, {
    deliverAt: nextWeeklyReportDeliveryAt(args),
    kind: "eod.weekly_manager_report",
    organizationId: args.organizationId,
    payload: { acceptedWeekId: args.acceptedWeekId },
    storeId: args.storeId,
    subjectId: String(args.acceptedWeekId),
    subjectType: "reportWeekAccepted",
  });
}
/** Recent closes inspected per store to recover a missed acceptance intent. */
export const WEEKLY_CLOSE_RECONCILIATION_LIMIT = 16;
/** Recent accepted frames inspected only as a missed-marker fallback. */
export const WEEKLY_ACCEPTED_REFRESH_LIMIT = 16;
/** Close versions inspected for one accepted frame's final date. */
export const WEEKLY_CLOSE_VERSION_LIMIT = 8;

const ZERO_WEEK_METRICS: ReportWeekMetrics = {
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
  paymentUnsettledMinor: 0,
  paymentAllocationCoverage: "complete",
  paymentAllocationOmittedMinor: 0,
  paymentHasInvalidAllocation: false,
};

type WeekDay = Pick<
  Doc<"reportDay">,
  | "currency"
  | "closeVarianceMinor"
  | "flags"
  | "factCount"
  | "grossProfitMinor"
  | "grossSalesMinor"
  | "netSalesMinor"
  | "operatingDate"
  | "paymentAllocatedMinor"
  | "paymentPosture"
  | "paymentsCollectedMinor"
  | "paymentsRefundedMinor"
  | "refundsMinor"
  | "status"
  | "uncostedRevenueMinor"
  | "unitsReturned"
  | "unitsSold"
>;

/** The verified member of the current weekly union. */
export type AvailableWeekCurrent = Extract<
  Doc<"reportWeekCurrent">,
  { included: unknown }
>;

/** Narrow a current weekly singleton to its verified member, or nothing. */
export function availableWeekCurrent(
  doc: Doc<"reportWeekCurrent"> | null,
): AvailableWeekCurrent | null {
  return doc && doc.availability !== "unavailable" ? doc : null;
}

export type WeekFold = {
  included: ReportWeekMetrics;
  outsideSchedule: ReportWeekMetrics;
  scheduleLineage: ReportWeekLineage[];
  completeness: ReportWeekCompleteness;
};

function zeroWeekMetrics(): ReportWeekMetrics {
  return { ...ZERO_WEEK_METRICS };
}

function addDay(total: ReportWeekMetrics, day: WeekDay): ReportWeekMetrics {
  const payment = day.paymentPosture;
  const paymentUnknown =
    payment === undefined || payment.allocationCoverage === "unknown";

  return {
    grossSalesMinor: total.grossSalesMinor + day.grossSalesMinor,
    netSalesMinor: total.netSalesMinor + day.netSalesMinor,
    refundsMinor: total.refundsMinor + day.refundsMinor,
    unitsSold: total.unitsSold + day.unitsSold,
    unitsReturned: total.unitsReturned + day.unitsReturned,
    uncostedRevenueMinor: total.uncostedRevenueMinor + day.uncostedRevenueMinor,
    grossProfitMinor:
      total.grossProfitMinor === null || day.grossProfitMinor === null
        ? null
        : total.grossProfitMinor + day.grossProfitMinor,
    paymentsCollectedMinor:
      total.paymentsCollectedMinor + day.paymentsCollectedMinor,
    paymentsRefundedMinor:
      total.paymentsRefundedMinor + day.paymentsRefundedMinor,
    paymentAllocatedMinor:
      total.paymentAllocatedMinor + day.paymentAllocatedMinor,
    paymentUnsettledMinor:
      total.paymentUnsettledMinor === null ||
      paymentUnknown ||
      payment?.unsettledMinor === null
        ? null
        : total.paymentUnsettledMinor + payment.unsettledMinor,
    paymentAllocationCoverage:
      total.paymentAllocationCoverage === "unknown" || paymentUnknown
        ? "unknown"
        : "complete",
    paymentAllocationOmittedMinor:
      (total.paymentAllocationOmittedMinor ?? 0) +
      (payment?.allocationOmittedMinor ?? 0),
    paymentHasInvalidAllocation:
      (total.paymentHasInvalidAllocation ?? false) ||
      (payment?.hasInvalidAllocation ?? false),
  };
}

function firstIncompleteReason(args: {
  days: readonly WeekDay[];
}): ReportWeekCompleteness {
  if (args.days.some((day) => day.flags.mixedCurrency)) {
    return { complete: false, reason: "mixed_currency" };
  }
  // An over-allocated day cannot roll into a week reported complete: the
  // allocated total exceeds what the payment universe can settle.
  if (args.days.some((day) => day.paymentPosture?.hasInvalidAllocation)) {
    return { complete: false, reason: "payment_invalid_allocation" };
  }
  if (
    args.days.some(
      (day) =>
        day.paymentPosture === undefined ||
        day.paymentPosture.allocationCoverage === "unknown",
    )
  ) {
    return { complete: false, reason: "payment_coverage_unknown" };
  }
  return { complete: true, reason: "complete" };
}

/**
 * Pure composition of seven `reportDay` rows. Missing scheduled rows are
 * explicit zero-activity slots; folded evidence still carries its own
 * fail-closed completeness. Outside-schedule activity stays separately named.
 *
 * Completeness is scoped to the positions actually composed: days read outside
 * this frame — and excluded dates, which have their own lane — never withhold
 * the headline week.
 */
export function foldWeekFromDays(args: {
  period: Extract<WeeklyPeriod, { kind: "resolved" }>;
  days: readonly WeekDay[];
}): WeekFold {
  const byDate = new Map(args.days.map((day) => [day.operatingDate, day]));
  let included = zeroWeekMetrics();
  let outsideSchedule = zeroWeekMetrics();
  const includedDays: WeekDay[] = [];
  const outsideScheduleDays: WeekDay[] = [];

  for (const date of args.period.dates) {
    const day = byDate.get(date.localDate);
    if (!day) continue;
    if (date.included) {
      included = addDay(included, day);
      includedDays.push(day);
    } else {
      outsideSchedule = addDay(outsideSchedule, day);
      outsideScheduleDays.push(day);
    }
  }

  return {
    included,
    outsideSchedule,
    scheduleLineage: args.period.dates.map((date) => {
      const day = byDate.get(date.localDate);
      return {
        localDate: date.localDate,
        included: date.included,
        scheduleVersionId: date.scheduleVersionId,
        dayStatus: day?.status ?? null,
        dayAvailable: day !== undefined,
        // The same close evidence `computeWeeklyVariancePosture` counts. A
        // date with no day row has no close, which is a known false rather
        // than an unknown.
        dayClosed: day?.closeVarianceMinor !== undefined,
        activityPosture:
          day === undefined || day.factCount === 0
            ? "zero_activity"
            : "recorded",
      };
    }),
    completeness: {
      ...firstIncompleteReason({ days: includedDays }),
      outsideSchedule: firstIncompleteReason({ days: outsideScheduleDays }),
    },
  };
}

function toFoldFact(fact: Doc<"reportFact">): FoldFact {
  return {
    factId: String(fact._id),
    sourceDomain: fact.sourceDomain,
    sourceId: fact.sourceId,
    lineId: fact.lineId,
    factKind: fact.factKind,
    occurredAt: fact.occurredAt,
    recordedAt: fact.recordedAt,
    currency: fact.currency,
    grossAmountMinor: fact.grossAmountMinor,
    netAmountMinor: fact.netAmountMinor,
    taxAmountMinor: fact.taxAmountMinor,
    discountAmountMinor: fact.discountAmountMinor,
    quantity: fact.quantity,
    ...(fact.productSkuId ? { productSkuId: String(fact.productSkuId) } : {}),
    ...(fact.unitCostMinor !== undefined
      ? { unitCostMinor: fact.unitCostMinor }
      : {}),
    ...(fact.paymentAllocationMinor !== undefined
      ? { paymentAllocationMinor: fact.paymentAllocationMinor }
      : {}),
    ...(fact.paymentAllocationCoverage !== undefined
      ? { paymentAllocationCoverage: fact.paymentAllocationCoverage }
      : {}),
    quarantined: fact.quarantine !== undefined,
  };
}

function toWeekDay(args: {
  currency: string;
  operatingDate: string;
  facts: readonly Doc<"reportFact">[];
}): WeekDay {
  const folded = foldDay(args.currency, args.facts.map(toFoldFact));
  return {
    operatingDate: args.operatingDate,
    currency: args.currency,
    status: folded.day.status,
    factCount: folded.day.factCount,
    grossSalesMinor: folded.day.grossSalesMinor,
    netSalesMinor: folded.day.netSalesMinor,
    refundsMinor: folded.day.refundsMinor,
    unitsSold: folded.day.unitsSold,
    unitsReturned: folded.day.unitsReturned,
    uncostedRevenueMinor: folded.day.uncostedRevenueMinor,
    grossProfitMinor: folded.day.grossProfitMinor,
    paymentsCollectedMinor: folded.day.paymentsCollectedMinor,
    paymentsRefundedMinor: folded.day.paymentsRefundedMinor,
    paymentAllocatedMinor: folded.day.paymentAllocatedMinor,
    paymentPosture: folded.day.paymentPosture,
    flags: folded.day.flags,
  };
}

/**
 * Pure acceptance fold. Facts are already cutoff-filtered by the caller;
 * missing server knowledge time fails closed so a reseed cannot revise an
 * immutable baseline by presenting an earlier business timestamp.
 */
export function foldWeekFromAcceptedFacts(args: {
  currency: string;
  factsByDate: ReadonlyMap<string, readonly Doc<"reportFact">[]>;
  period: Extract<WeeklyPeriod, { kind: "resolved" }>;
}): WeekFold {
  const facts = [...args.factsByDate.values()].flat();
  if (facts.some((fact) => fact.observedAt === undefined)) {
    return {
      included: zeroWeekMetrics(),
      outsideSchedule: zeroWeekMetrics(),
      scheduleLineage: args.period.dates.map((date) => ({
        localDate: date.localDate,
        included: date.included,
        scheduleVersionId: date.scheduleVersionId,
        dayStatus: null,
        dayAvailable: false,
        activityPosture: "unavailable",
      })),
      completeness: {
        complete: false,
        reason: "legacy_fact_without_observed_at",
        outsideSchedule: {
          complete: false,
          reason: "legacy_fact_without_observed_at",
        },
      },
    };
  }

  return foldWeekFromDays({
    period: args.period,
    days: args.period.dates.map((date) =>
      toWeekDay({
        currency: args.currency,
        operatingDate: date.localDate,
        facts: args.factsByDate.get(date.localDate) ?? [],
      }),
    ),
  });
}

async function resolveCurrentPeriod(
  ctx: MutationCtx,
  storeId: Id<"store">,
  now: number,
): Promise<WeeklyPeriod> {
  const schedules = await ctx.db
    .query("storeSchedule")
    .withIndex("by_storeId_status_effectiveFrom", (q) =>
      q.eq("storeId", storeId),
    )
    .take(WEEKLY_SCHEDULE_READ_LIMIT + 1);
  if (schedules.length > WEEKLY_SCHEDULE_READ_LIMIT) {
    return { kind: "unavailable", reason: "schedule_history_cap" };
  }
  const eligibleSchedules = schedules.filter(
    (schedule) => schedule.status !== "candidate",
  );
  const current = eligibleSchedules
    .filter(
      (schedule) =>
        schedule.effectiveFrom <= now &&
        (schedule.effectiveTo === undefined || now < schedule.effectiveTo),
    )
    .sort((a, b) => b.effectiveFrom - a.effectiveFrom)[0];
  if (!current) return { kind: "unavailable", reason: "missing_schedule" };

  return resolveWeeklyPeriod({
    referenceAt: now,
    schedules: eligibleSchedules,
    timezone: current.timezone || null,
  });
}

/**
 * Resolve a historical frame from the close's store-local operating date.
 * Completion time is deliberately absent: a delayed close can be completed
 * after the next reporting cycle has already started.
 */
async function resolvePeriodForOperatingDate(
  ctx: MutationCtx,
  storeId: Id<"store">,
  operatingDate: string,
): Promise<WeeklyPeriod> {
  const schedules = await ctx.db
    .query("storeSchedule")
    .withIndex("by_storeId_status_effectiveFrom", (q) =>
      q.eq("storeId", storeId),
    )
    .take(WEEKLY_SCHEDULE_READ_LIMIT + 1);
  if (schedules.length > WEEKLY_SCHEDULE_READ_LIMIT) {
    return { kind: "unavailable", reason: "schedule_history_cap" };
  }
  const eligibleSchedules = schedules.filter(
    (schedule) => schedule.status !== "candidate",
  );
  let hasTimezoneAuthority = false;
  const datedSchedules = eligibleSchedules.flatMap((schedule) => {
    if (!schedule.timezone) return [];
    hasTimezoneAuthority = true;
    let referenceAt: number | null;
    try {
      referenceAt = localDateStartAt(operatingDate, schedule.timezone);
    } catch {
      return [];
    }
    if (
      referenceAt === null ||
      schedule.effectiveFrom > referenceAt ||
      (schedule.effectiveTo !== undefined &&
        referenceAt >= schedule.effectiveTo)
    ) {
      return [];
    }
    return [{ referenceAt, schedule }];
  });
  const authority = datedSchedules.sort(
    (left, right) => right.schedule.effectiveFrom - left.schedule.effectiveFrom,
  )[0];
  if (!authority) {
    return {
      kind: "unavailable",
      reason: hasTimezoneAuthority ? "missing_schedule" : "missing_timezone",
    };
  }

  return resolveWeeklyPeriod({
    referenceAt: authority.referenceAt,
    schedules: eligibleSchedules,
    timezone: authority.schedule.timezone,
  });
}

type WeekDaysRead =
  | { status: "ok"; days: Doc<"reportDay">[] }
  /** A fold for a frame date is still queued or failed; zeros are not truth. */
  | { status: "pending_fold" }
  /** More day rows than the frame can hold — the read cannot be trusted. */
  | { status: "day_row_drift" };

async function readWeekDays(
  ctx: MutationCtx,
  storeId: Id<"store">,
  startDate: string,
  endDate: string,
): Promise<WeekDaysRead> {
  // A missing reportDay is a supported zero only when no day fold for this
  // frame is still queued. Fold failures reinsert their dirty mark, so this
  // indexed probe keeps stale or failed source posture from looking complete.
  const pendingDay = await ctx.db
    .query("reportDirtyDay")
    .withIndex("by_storeId_operatingDate", (q) =>
      q
        .eq("storeId", storeId)
        .gte("operatingDate", startDate)
        .lte("operatingDate", endDate),
    )
    .take(1);
  if (pendingDay.length > 0) return { status: "pending_fold" };

  const days = await ctx.db
    .query("reportDay")
    .withIndex("by_storeId_operatingDate", (q) =>
      q
        .eq("storeId", storeId)
        .gte("operatingDate", startDate)
        .lte("operatingDate", endDate),
    )
    .take(WEEKLY_DAY_READ_LIMIT);
  return days.length >= WEEKLY_DAY_READ_LIMIT
    ? { status: "day_row_drift" }
    : { status: "ok", days };
}

function weekTruthFingerprint(args: {
  included: ReportWeekMetrics;
  outsideSchedule: ReportWeekMetrics;
  scheduleLineage: ReportWeekLineage[];
}) {
  return stableStringHash(
    JSON.stringify({
      included: args.included,
      outsideSchedule: args.outsideSchedule,
      scheduleLineage: args.scheduleLineage.map((row) => ({
        included: row.included,
        localDate: row.localDate,
        scheduleVersionId: row.scheduleVersionId,
        activityPosture: row.activityPosture,
      })),
    }),
  );
}

type WeeklyClosePosture = NonNullable<
  Doc<"reportWeekAccepted">["closePosture"]
>;

function deriveWeeklyAmendment(args: {
  accepted: Pick<
    Doc<"reportWeekAccepted">,
    "amendment" | "closeId" | "included" | "outsideSchedule" | "scheduleLineage"
  >;
  closePosture: WeeklyClosePosture;
  folded: WeekFold;
  now: number;
}) {
  const currentFingerprint = weekTruthFingerprint({
    included: args.folded.included,
    outsideSchedule: args.folded.outsideSchedule,
    scheduleLineage: args.folded.scheduleLineage,
  });
  const baselineFingerprint = weekTruthFingerprint({
    included: args.accepted.included,
    outsideSchedule: args.accepted.outsideSchedule,
    scheduleLineage: args.accepted.scheduleLineage,
  });
  const currentCloseId = args.closePosture.currentCloseId;
  const hasAmendment =
    currentFingerprint !== baselineFingerprint ||
    (currentCloseId !== undefined && currentCloseId !== args.accepted.closeId);
  if (!hasAmendment) return undefined;

  const previousAmendment = args.accepted.amendment;
  return {
    changedAt:
      previousAmendment?.currentFingerprint === currentFingerprint &&
      previousAmendment.sourceCloseId === currentCloseId
        ? previousAmendment.changedAt
        : args.now,
    currentFingerprint,
    included: args.folded.included,
    includedNetSalesDeltaMinor:
      args.folded.included.netSalesMinor - args.accepted.included.netSalesMinor,
    outsideSchedule: args.folded.outsideSchedule,
    outsideScheduleNetSalesDeltaMinor:
      args.folded.outsideSchedule.netSalesMinor -
      args.accepted.outsideSchedule.netSalesMinor,
    ...(currentCloseId
      ? {
          sourceCloseId: currentCloseId,
          sourceCloseAcceptedAt: args.closePosture.changedAt,
        }
      : {}),
  };
}

/**
 * Close variance across the whole resolved frame.
 *
 * Closes are recorded on non-operational dates too, so restricting the total
 * to scheduled dates drops real register discrepancies without disclosure. The
 * scheduled figure stays available beside the total because that is what Daily
 * Close and Cash Controls evidence reconciles against.
 *
 * Coverage stays a scheduled-expectation ratio: a scheduled date without a
 * close is a gap, an outside-schedule date without one is not.
 */
export function computeWeeklyVariancePosture(
  period: Extract<WeeklyPeriod, { kind: "resolved" }>,
  days: readonly WeekDay[],
) {
  const included = new Set(period.includedDates);
  const covered = days.filter((day) => day.closeVarianceMinor !== undefined);
  const scheduledCovered = covered.filter((day) =>
    included.has(day.operatingDate),
  );
  const outsideCovered = covered.filter(
    (day) => !included.has(day.operatingDate),
  );
  const totalVariance = (rows: readonly WeekDay[]) =>
    rows.reduce((total, day) => total + (day.closeVarianceMinor ?? 0), 0);
  const scheduledVarianceMinor = totalVariance(scheduledCovered);
  const outsideScheduleVarianceMinor = totalVariance(outsideCovered);
  return {
    closeVarianceMinor: scheduledVarianceMinor + outsideScheduleVarianceMinor,
    coverage:
      scheduledCovered.length === 0
        ? ("unavailable" as const)
        : scheduledCovered.length === period.includedDates.length
          ? ("complete" as const)
          : ("partial" as const),
    coveredIncludedDayCount: scheduledCovered.length,
    includedDayCount: period.includedDates.length,
    scheduledVarianceMinor,
    outsideScheduleVarianceMinor,
    outsideScheduleCoveredDayCount: outsideCovered.length,
  };
}

function shiftIsoDate(localDate: string, days: number) {
  return new Date(Date.parse(`${localDate}T12:00:00.000Z`) + days * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

function scheduledOffsets(startDate: string, dates: readonly string[]) {
  const startAt = Date.parse(`${startDate}T12:00:00.000Z`);
  return dates.map(
    (date) => (Date.parse(`${date}T12:00:00.000Z`) - startAt) / 86_400_000,
  );
}

async function priorPeriodPosture(args: {
  currency: string;
  ctx: MutationCtx;
  fullCurrentPeriod: boolean;
  now: number;
  period: Extract<WeeklyPeriod, { kind: "resolved" }>;
  storeId: Id<"store">;
}) {
  const startAt = await periodStartAt(args.ctx, args.period);
  const priorFallback = {
    cycleStartDate: shiftIsoDate(args.period.startDate, -7),
    cycleEndDate: shiftIsoDate(args.period.endDate, -7),
  };
  if (startAt === null) {
    return {
      ...priorFallback,
      comparabilityReason: "missing_timezone" as const,
      currentScheduledPositionCount: 0,
      equivalentScheduledPositions: false,
      priorScheduledPositionCount: 0,
      values: null,
    };
  }
  const currentSchedules = args.fullCurrentPeriod
    ? []
    : await Promise.all(
        [
          ...new Set(
            args.period.dates.flatMap((date) =>
              date.scheduleVersionId ? [date.scheduleVersionId] : [],
            ),
          ),
        ].map((scheduleVersionId) =>
          args.ctx.db.get(
            "storeSchedule",
            scheduleVersionId as Id<"storeSchedule">,
          ),
        ),
      );
  const currentSchedule = currentSchedules
    .filter(
      (schedule) =>
        schedule &&
        schedule.effectiveFrom <= args.now &&
        (schedule.effectiveTo === undefined || args.now < schedule.effectiveTo),
    )
    .sort((left, right) => right!.effectiveFrom - left!.effectiveFrom)[0];
  if (!args.fullCurrentPeriod && !currentSchedule?.timezone) {
    return {
      ...priorFallback,
      comparabilityReason: "missing_timezone" as const,
      currentScheduledPositionCount: 0,
      equivalentScheduledPositions: false,
      priorScheduledPositionCount: 0,
      values: null,
    };
  }
  const currentLocalDate = currentSchedule?.timezone
    ? localDateAt(args.now, currentSchedule.timezone)
    : null;
  const currentDates = args.fullCurrentPeriod
    ? args.period.includedDates
    : args.period.includedDates.filter((date) => date <= currentLocalDate!);
  const prior = await resolveCurrentPeriod(args.ctx, args.storeId, startAt - 1);
  if (prior.kind !== "resolved") {
    return {
      ...priorFallback,
      comparabilityReason: prior.reason,
      currentScheduledPositionCount: currentDates.length,
      equivalentScheduledPositions: false,
      priorScheduledPositionCount: 0,
      values: null,
    };
  }
  const priorDates = prior.includedDates.slice(0, currentDates.length);
  const equivalentScheduledPositions =
    currentDates.length === priorDates.length &&
    scheduledOffsets(args.period.startDate, currentDates).every(
      (offset, index) =>
        offset === scheduledOffsets(prior.startDate, priorDates)[index],
    );
  const priorDays = await readWeekDays(
    args.ctx,
    args.storeId,
    prior.startDate,
    prior.endDate,
  );
  if (priorDays.status !== "ok") {
    return {
      cycleStartDate: prior.startDate,
      cycleEndDate: prior.endDate,
      // A queued or failed prior fold is a named comparison qualification, not
      // the generic incomplete bucket the row-drift refusal falls into.
      comparabilityReason:
        priorDays.status === "pending_fold"
          ? ("missing_prior_day_fold" as const)
          : ("prior_incomplete" as const),
      currentScheduledPositionCount: currentDates.length,
      equivalentScheduledPositions,
      priorScheduledPositionCount: priorDates.length,
      values: null,
    };
  }
  const days = priorDays.days;
  const liveCurrentScheduledDate =
    !args.fullCurrentPeriod &&
    currentLocalDate !== null &&
    args.period.includedDates.includes(currentLocalDate)
      ? currentLocalDate
      : null;
  const priorCutoffDate = liveCurrentScheduledDate ? priorDates.at(-1) : null;
  let comparisonDays: WeekDay[] = days;
  if (priorCutoffDate) {
    const priorScheduleVersionId = prior.dates.find(
      (date) => date.localDate === priorCutoffDate,
    )?.scheduleVersionId;
    const priorSchedule = priorScheduleVersionId
      ? await args.ctx.db.get(
          "storeSchedule",
          priorScheduleVersionId as Id<"storeSchedule">,
        )
      : null;
    if (!currentSchedule?.timezone || !priorSchedule?.timezone) {
      return {
        cycleStartDate: prior.startDate,
        cycleEndDate: prior.endDate,
        comparabilityReason: "missing_timezone" as const,
        currentScheduledPositionCount: currentDates.length,
        equivalentScheduledPositions,
        priorScheduledPositionCount: priorDates.length,
        values: null,
      };
    }
    const cutoffAt = localDateTimeAt({
      localDate: priorCutoffDate,
      time: localTimeAt(args.now, currentSchedule.timezone),
      timezone: priorSchedule.timezone,
    });
    if (cutoffAt === null) {
      return {
        cycleStartDate: prior.startDate,
        cycleEndDate: prior.endDate,
        comparabilityReason: "missing_timezone" as const,
        currentScheduledPositionCount: currentDates.length,
        equivalentScheduledPositions,
        priorScheduledPositionCount: priorDates.length,
        values: null,
      };
    }
    const facts = await args.ctx.db
      .query("reportFact")
      .withIndex("by_storeId_operatingDate", (q) =>
        q.eq("storeId", args.storeId).eq("operatingDate", priorCutoffDate),
      )
      .take(MAX_WEEKLY_LIVE_PRIOR_CUTOFF_FACTS + 1);
    if (facts.length > MAX_WEEKLY_LIVE_PRIOR_CUTOFF_FACTS) {
      return {
        cycleStartDate: prior.startDate,
        cycleEndDate: prior.endDate,
        comparabilityReason: "prior_incomplete" as const,
        currentScheduledPositionCount: currentDates.length,
        equivalentScheduledPositions,
        priorScheduledPositionCount: priorDates.length,
        values: null,
      };
    }
    comparisonDays = [
      ...days.filter((day) => day.operatingDate !== priorCutoffDate),
      toWeekDay({
        currency: args.currency,
        operatingDate: priorCutoffDate,
        facts: facts.filter((fact) => fact.occurredAt <= cutoffAt),
      }),
    ];
  }
  const selected = new Set(priorDates);
  // The comparison frame mirrors the elapsed portion of the current week: the
  // matched scheduled positions, plus every excluded date the same elapsed
  // window covers. A full current period mirrors the whole prior week, so its
  // outside-schedule lane is the prior week's real one — which is what the
  // headline's total-vs-total comparison needs. The included lane's membership
  // is unchanged, so `values` and comparability are untouched by this.
  const outsideCutoffDate = args.fullCurrentPeriod
    ? prior.endDate
    : (priorDates.at(-1) ?? prior.startDate);
  const comparisonPeriod = {
    ...prior,
    dates: prior.dates.filter((date) =>
      date.included
        ? selected.has(date.localDate)
        : date.localDate <= outsideCutoffDate,
    ),
    includedDates: priorDates,
  };
  const folded = foldWeekFromDays({
    period: comparisonPeriod,
    days: comparisonDays,
  });
  const comparabilityReason = !equivalentScheduledPositions
    ? ("scheduled_membership_changed" as const)
    : folded.completeness.complete
      ? ("comparable" as const)
      : ("prior_incomplete" as const);
  // The prior total is only as trustworthy as its weaker lane. An incomplete
  // outside-schedule lane would understate the prior week silently, so the
  // lane is withheld and the read withholds the comparison with it.
  const outsideScheduleComplete =
    folded.completeness.complete &&
    (folded.completeness.outsideSchedule?.complete ?? false);
  return {
    cycleStartDate: prior.startDate,
    cycleEndDate: prior.endDate,
    comparabilityReason,
    currentScheduledPositionCount: currentDates.length,
    equivalentScheduledPositions,
    priorScheduledPositionCount: priorDates.length,
    values: folded.completeness.complete ? folded.included : null,
    // The same fold already carries this lane — no extra read — and it is what
    // makes the headline's total-vs-total comparison like-for-like.
    outsideScheduleValues: outsideScheduleComplete
      ? folded.outsideSchedule
      : null,
  };
}

/**
 * Live read budget: two <=101 schedule-history scans (100 schedule versions
 * plus one overflow probe), up to ten direct schedule
 * documents, two single-row dirty-day probes plus two <=8 weekly-day reads
 * (current plus prior), one <=501-fact prior-day cutoff fold only while the
 * current local date is scheduled, one store, and
 * one each of the current/accepted weekly singletons. It also reads the
 * canonical Open Work inventory projection (<=500 items and <=100 repairs
 * shared across its indexed lanes, each with one overflow probe). No facts
 * or payments are read.
 */
/**
 * Disclose an incomplete posture on the current weekly singleton while keeping
 * the previously verified values. Nothing partial is ever published, and the
 * operator still sees why the week is not complete.
 */
async function persistWeeklyIncompleteness(
  ctx: MutationCtx,
  storeId: Id<"store">,
  reason: ReportWeekCompleteness["reason"],
): Promise<boolean> {
  const current = await ctx.db
    .query("reportWeekCurrent")
    .withIndex("by_storeId", (q) => q.eq("storeId", storeId))
    .unique();
  if (!current || current.availability === "unavailable") return false;
  const lifecyclePosture: ReportWeekLifecyclePosture =
    current.acceptedBaselineId
      ? (current.closePosture?.status ?? "accepted")
      : "materializing";
  const amendmentPosture: ReportWeekAmendmentPosture =
    current.acceptedBaselineId ? "pending_recompute" : "none";
  await ctx.db.patch("reportWeekCurrent", current._id, {
    completeness: { complete: false, reason },
    lifecyclePosture,
    amendmentPosture,
  });
  return true;
}

export async function rebuildCurrentWeek(
  ctx: MutationCtx,
  storeId: Id<"store">,
  now: number,
): Promise<"rebuilt" | "unavailable"> {
  const store = await ctx.db.get("store", storeId);
  if (!store || store.reportingReseedStartedAt !== undefined) {
    return "unavailable";
  }
  const existing = await ctx.db
    .query("reportWeekCurrent")
    .withIndex("by_storeId", (q) => q.eq("storeId", storeId))
    .unique();
  const persistUnavailable = async (
    unavailableReason:
      | "missing_schedule"
      | "missing_timezone"
      | "schedule_history_cap"
      | "no_scheduled_dates"
      | "missing_day_fold",
  ) => {
    if (
      existing &&
      existing.availability !== "unavailable" &&
      unavailableReason !== "no_scheduled_dates"
    ) {
      await persistWeeklyIncompleteness(ctx, storeId, unavailableReason);
      return;
    }
    const amendmentPosture: ReportWeekAmendmentPosture =
      existing?.availability !== "unavailable" && existing?.acceptedBaselineId
        ? "pending_recompute"
        : "none";
    const unavailable = {
      storeId,
      availability: "unavailable" as const,
      unavailableReason,
      lifecyclePosture: "materializing" as const,
      amendmentPosture,
      materializedAt: now,
    };
    if (existing) {
      await ctx.db.replace("reportWeekCurrent", existing._id, unavailable);
    } else {
      await ctx.db.insert("reportWeekCurrent", unavailable);
    }
  };
  const period = await resolveCurrentPeriod(ctx, storeId, now);
  if (period.kind !== "resolved") {
    await persistUnavailable(period.reason);
    return "unavailable";
  }
  if (period.automaticFinalizationReason === "no_scheduled_dates") {
    await persistUnavailable("no_scheduled_dates");
    return "unavailable";
  }
  const weekDays = await readWeekDays(
    ctx,
    storeId,
    period.startDate,
    period.endDate,
  );
  if (weekDays.status !== "ok") {
    await persistUnavailable("missing_day_fold");
    return "unavailable";
  }
  const days = weekDays.days;

  const folded = foldWeekFromDays({ period, days });
  const frameStartAt = await periodStartAt(ctx, period);
  const inventoryAttention =
    frameStartAt === null
      ? projectFrozenWeeklyInventoryAttention({
          frameStartAt: now,
          groups: [],
          membershipCompleteness: "incomplete",
        })
      : projectLiveWeeklyInventoryAttention({
          frameStartAt,
          logicalWork:
            await listOpenSyncedSaleInventoryReviewGroupsWithCompleteness(
              ctx,
              storeId,
            ),
        });
  const priorPeriod = await priorPeriodPosture({
    currency: normalizeCurrencyCode(store.currency),
    ctx,
    fullCurrentPeriod: false,
    now,
    period,
    storeId,
  });
  const accepted = await ctx.db
    .query("reportWeekAccepted")
    .withIndex("by_storeId_cycleStartDate", (q) =>
      q.eq("storeId", storeId).eq("cycleStartDate", period.startDate),
    )
    .unique();
  const lifecyclePosture: ReportWeekLifecyclePosture = accepted?.closePosture
    ?.status
    ? accepted.closePosture.status
    : accepted
      ? "accepted"
      : period.finalScheduledDate &&
          period.finalScheduledDate <=
            (await localDateForPeriod(ctx, period, now))
        ? "awaiting_final_close"
        : "live";
  const amendmentPosture: ReportWeekAmendmentPosture = accepted?.amendment
    ? "amended"
    : "none";
  if (
    accepted &&
    (accepted.lifecyclePosture !== lifecyclePosture ||
      accepted.amendmentPosture !== amendmentPosture)
  ) {
    await ctx.db.patch("reportWeekAccepted", accepted._id, {
      lifecyclePosture,
      amendmentPosture,
    });
  }
  const currentDoc = {
    storeId,
    availability: "available" as const,
    cycleStartDate: period.startDate,
    cycleEndDate: period.endDate,
    currency: normalizeCurrencyCode(store.currency),
    metricVersion: 1,
    materializedAt: now,
    included: folded.included,
    outsideSchedule: folded.outsideSchedule,
    scheduleLineage: folded.scheduleLineage.map((row) => ({
      ...row,
      scheduleVersionId: row.scheduleVersionId as Id<"storeSchedule"> | null,
    })),
    completeness: folded.completeness,
    lifecyclePosture,
    amendmentPosture,
    inventoryAttention,
    priorPeriod,
    variancePosture: computeWeeklyVariancePosture(period, days),
    ...(accepted
      ? {
          acceptedBaselineId: accepted._id,
          closePosture: accepted.closePosture,
          amendment: accepted.amendment,
        }
      : {}),
  };

  if (existing)
    await ctx.db.replace("reportWeekCurrent", existing._id, currentDoc);
  else await ctx.db.insert("reportWeekCurrent", currentDoc);
  return "rebuilt";
}

export type WeeklyAcceptanceIntent = NonNullable<
  Doc<"reportDirtyWeek">["intent"]
>;

/** Folded dates carried on one marker. Bounded: two frames of daily work. */
export const WEEKLY_MARK_FOLDED_DATE_LIMIT = 16;

/**
 * Upsert the per-store marker consumed by the one existing Reports sweeper.
 *
 * `foldedDates` accumulate on the marker instead of being handed over in
 * memory, so a store whose marker misses one weekly page still replays the
 * exact historical dates on the next tick. A recorded acceptance intent is
 * preserved across re-marks and never rewritten by a later mark.
 */
export async function markWeekDirty(
  ctx: MutationCtx,
  storeId: Id<"store">,
  reason: Doc<"reportDirtyWeek">["reason"],
  now: number,
  opts?: {
    acceptanceBlockedReason?: Doc<"reportDirtyWeek">["acceptanceBlockedReason"];
    foldedDates?: readonly string[];
    intent?: WeeklyAcceptanceIntent;
  },
): Promise<void> {
  const current = await ctx.db
    .query("reportWeekCurrent")
    .withIndex("by_storeId", (q) => q.eq("storeId", storeId))
    .unique();
  if (current && current.availability !== "unavailable") {
    const lifecyclePosture: ReportWeekLifecyclePosture = current.acceptedBaselineId
      ? (current.closePosture?.status ?? "accepted")
      : "materializing";
    const amendmentPosture: ReportWeekAmendmentPosture =
      current.acceptedBaselineId ? "pending_recompute" : "none";
    await ctx.db.patch("reportWeekCurrent", current._id, {
      lifecyclePosture,
      amendmentPosture,
    });
    if (current.acceptedBaselineId) {
      await ctx.db.patch(
        "reportWeekAccepted",
        current.acceptedBaselineId,
        {
          lifecyclePosture,
          amendmentPosture,
        },
      );
    }
  }
  const existing = await ctx.db
    .query("reportDirtyWeek")
    .withIndex("by_storeId", (q) => q.eq("storeId", storeId))
    .unique();
  const foldedDates = [
    ...new Set([...(existing?.foldedDates ?? []), ...(opts?.foldedDates ?? [])]),
  ]
    .sort()
    .slice(-WEEKLY_MARK_FOLDED_DATE_LIMIT);
  const intent = existing?.intent ?? opts?.intent;
  const acceptanceBlockedReason =
    opts?.acceptanceBlockedReason ??
    (intent ? undefined : existing?.acceptanceBlockedReason);
  if (existing) {
    await ctx.db.patch("reportDirtyWeek", existing._id, {
      reason,
      markedAt: now,
      intent,
      acceptanceBlockedReason,
      ...(foldedDates.length > 0 ? { foldedDates } : {}),
    });
    return;
  }
  await ctx.db.insert("reportDirtyWeek", {
    storeId,
    reason,
    markedAt: now,
    ...(intent ? { intent } : {}),
    ...(acceptanceBlockedReason ? { acceptanceBlockedReason } : {}),
    ...(foldedDates.length > 0 ? { foldedDates } : {}),
  });
}

/**
 * Read — or write once — the durable acceptance identity for one cycle.
 *
 * The stored cutoff always wins: a close patched between materialization
 * attempts cannot move the knowledge boundary of an immutable baseline. When
 * nothing is stored (a mark raised before this record existed, or drained by
 * the sweeper), the cutoff is derived from `completedAt` ONLY. `updatedAt` is
 * mutable and would make the boundary depend on retry timing, so a completed
 * close without `completedAt` records a retryable blocked reason instead.
 *
 * One marker per store means a second cycle's intent replaces the first's.
 * That is safe: identity is structural, so re-derivation from the same close
 * reproduces the same cutoff.
 */
async function resolveWeeklyAcceptanceIntent(
  ctx: MutationCtx,
  args: {
    close: Doc<"dailyClose">;
    cycleStartDate: string;
    now: number;
    storeId: Id<"store">;
  },
): Promise<WeeklyAcceptanceIntent | null> {
  const marker = await ctx.db
    .query("reportDirtyWeek")
    .withIndex("by_storeId", (q) => q.eq("storeId", args.storeId))
    .unique();
  const stored = marker?.intent;
  if (
    stored &&
    stored.cycleStartDate === args.cycleStartDate &&
    stored.closeId === args.close._id
  ) {
    return stored;
  }
  const cutoffObservedAt = args.close.completedAt;
  if (cutoffObservedAt === undefined) {
    await markWeekDirty(ctx, args.storeId, "acceptance_requested", args.now, {
      acceptanceBlockedReason: "close_missing_completed_at",
    });
    return null;
  }
  const intent: WeeklyAcceptanceIntent = {
    closeId: args.close._id,
    cycleStartDate: args.cycleStartDate,
    cutoffObservedAt,
  };
  if (marker) {
    await ctx.db.patch("reportDirtyWeek", marker._id, {
      intent,
      acceptanceBlockedReason: undefined,
    });
  } else {
    await ctx.db.insert("reportDirtyWeek", {
      storeId: args.storeId,
      reason: "acceptance_requested",
      markedAt: args.now,
      intent,
    });
  }
  return intent;
}

/** The intent has produced its baseline; the work item is no longer pending. */
async function clearWeeklyAcceptanceIntent(
  ctx: MutationCtx,
  storeId: Id<"store">,
  intent: WeeklyAcceptanceIntent,
) {
  const marker = await ctx.db
    .query("reportDirtyWeek")
    .withIndex("by_storeId", (q) => q.eq("storeId", storeId))
    .unique();
  if (
    !marker?.intent ||
    marker.intent.cycleStartDate !== intent.cycleStartDate ||
    marker.intent.closeId !== intent.closeId
  ) {
    return;
  }
  await ctx.db.patch("reportDirtyWeek", marker._id, { intent: undefined });
}

type FrozenInventoryGroup = Parameters<
  typeof projectFrozenWeeklyInventoryAttention
>[0]["groups"][number];

function acceptedInventoryFromClose(
  close: Doc<"dailyClose">,
  frameStartAt: number,
) {
  const snapshot = close.reportSnapshot as
    | {
        frozenSyncedSaleInventoryReviewGroups?: Array<
          FrozenInventoryGroup & {
            membershipCompleteness?: "complete" | "incomplete";
          }
        >;
        openWorkMembership?: {
          completeness: "complete" | "incomplete";
        };
      }
    | undefined;
  const groups = snapshot?.frozenSyncedSaleInventoryReviewGroups;
  const membershipCompleteness =
    groups !== undefined &&
    snapshot?.openWorkMembership?.completeness === "complete" &&
    groups.every((group) => group.membershipCompleteness === "complete")
      ? "complete"
      : "incomplete";

  return projectFrozenWeeklyInventoryAttention({
    frameStartAt,
    groups: groups ?? [],
    membershipCompleteness,
  });
}

async function periodStartAt(
  ctx: MutationCtx,
  period: Extract<WeeklyPeriod, { kind: "resolved" }>,
) {
  const scheduleVersionId = period.dates[0]?.scheduleVersionId;
  if (!scheduleVersionId) return null;
  const schedule = await ctx.db.get(
    "storeSchedule",
    scheduleVersionId as Id<"storeSchedule">,
  );
  if (!schedule?.timezone) return null;
  return localDateStartAt(period.startDate, schedule.timezone);
}

async function localDateForPeriod(
  ctx: MutationCtx,
  period: Extract<WeeklyPeriod, { kind: "resolved" }>,
  now: number,
) {
  const scheduleVersionId = period.dates.find(
    (date) => date.scheduleVersionId !== null,
  )?.scheduleVersionId;
  if (!scheduleVersionId) return period.startDate;
  const schedule = await ctx.db.get(
    "storeSchedule",
    scheduleVersionId as Id<"storeSchedule">,
  );
  return schedule?.timezone ? localDateAt(now, schedule.timezone) : period.startDate;
}

/**
 * Acceptance budget: two <=101 schedule-history scans (100 schedule versions
 * plus one overflow probe), bounded day reads for the accepted and prior
 * frames, plus <=MAX_WEEKLY_FACTS facts and one overflow probe total through
 * `by_storeId_operatingDate_observedAt`. A cap breach returns no partial
 * baseline.
 */
export async function materializeAcceptedWeek(args: {
  /** Repair/inspection override. Normal callers take both from the intent. */
  acceptedAt?: number;
  closeId: Id<"dailyClose">;
  ctx: MutationCtx;
  cutoffObservedAt?: number;
  now?: number;
  storeId: Id<"store">;
}): Promise<"created" | "existing" | "incomplete" | "unavailable"> {
  const store = await args.ctx.db.get("store", args.storeId);
  if (
    !store ||
    store.reportingReseedStartedAt !== undefined ||
    !hasCompletedWeeklyObservedAtVerification(store)
  ) {
    return "unavailable";
  }
  const close = await args.ctx.db.get("dailyClose", args.closeId);
  if (
    !close ||
    close.storeId !== args.storeId ||
    close.status !== "completed" ||
    close.lifecycleStatus === "superseded"
  ) {
    return "unavailable";
  }
  const period = await resolvePeriodForOperatingDate(
    args.ctx,
    args.storeId,
    close.operatingDate,
  );
  if (
    period.kind !== "resolved" ||
    period.finalScheduledDate === null ||
    close.operatingDate !== period.finalScheduledDate
  ) {
    return "unavailable";
  }
  const existing = await args.ctx.db
    .query("reportWeekAccepted")
    .withIndex("by_storeId_cycleStartDate", (q) =>
      q.eq("storeId", args.storeId).eq("cycleStartDate", period.startDate),
    )
    .unique();
  if (existing) {
    if (!existing.lifecyclePosture || !existing.amendmentPosture) {
      await args.ctx.db.patch("reportWeekAccepted", existing._id, {
        lifecyclePosture: existing.closePosture?.status ?? "accepted",
        amendmentPosture: existing.amendment ? "amended" : "none",
      });
    }
    return "existing";
  }
  const intent = await resolveWeeklyAcceptanceIntent(args.ctx, {
    close,
    cycleStartDate: period.startDate,
    now: args.now ?? Date.now(),
    storeId: args.storeId,
  });
  if (!intent) return "unavailable";
  const acceptedAt = args.acceptedAt ?? intent.cutoffObservedAt;
  const cutoffObservedAt = args.cutoffObservedAt ?? intent.cutoffObservedAt;

  const finalDay = await args.ctx.db
    .query("reportDay")
    .withIndex("by_storeId_operatingDate", (q) =>
      q
        .eq("storeId", args.storeId)
        .eq("operatingDate", period.finalScheduledDate!),
    )
    .unique();
  if (
    !finalDay ||
    finalDay.closeId !== args.closeId ||
    finalDay.foldedAt === undefined ||
    finalDay.foldedAt < acceptedAt
  ) {
    return "unavailable";
  }

  const factsByDate = new Map<string, Doc<"reportFact">[]>();
  let remaining = MAX_WEEKLY_FACTS;
  for (const date of period.dates.map((row) => row.localDate)) {
    const facts = await args.ctx.db
      .query("reportFact")
      .withIndex("by_storeId_operatingDate_observedAt", (q) =>
        q
          .eq("storeId", args.storeId)
          .eq("operatingDate", date)
          .lte("observedAt", cutoffObservedAt),
      )
      .take(remaining + 1);
    if (facts.length > remaining) {
      // Publish nothing, but make the refusal operator-visible: a shared-cap
      // breach is a structural limit, not a transient write failure.
      await persistWeeklyIncompleteness(
        args.ctx,
        args.storeId,
        "fact_cap_exceeded",
      );
      return "incomplete";
    }
    remaining -= facts.length;
    factsByDate.set(date, facts);
  }

  const folded = foldWeekFromAcceptedFacts({
    currency: normalizeCurrencyCode(store.currency),
    factsByDate,
    period,
  });
  if (!folded.completeness.complete) {
    await persistWeeklyIncompleteness(
      args.ctx,
      args.storeId,
      folded.completeness.reason,
    );
    return "incomplete";
  }
  const topSkuLeaders = acceptedTopSkuLeaders({
    currency: normalizeCurrencyCode(store.currency),
    factsByDate,
  });
  const frameStartAt = await periodStartAt(args.ctx, period);
  if (frameStartAt === null) return "unavailable";
  const acceptedRead = await readWeekDays(
    args.ctx,
    args.storeId,
    period.startDate,
    period.endDate,
  );
  if (acceptedRead.status !== "ok") return "incomplete";
  const acceptedDays = acceptedRead.days;
  const currentFolded = foldWeekFromDays({ period, days: acceptedDays });
  if (!currentFolded.completeness.complete) return "incomplete";
  const closePosture = await resolveAcceptedWeekClosePosture(
    args.ctx,
    {
      acceptedAt,
      closeId: args.closeId,
      storeId: args.storeId,
    },
    period.finalScheduledDate,
  );
  if (!closePosture) return "incomplete";
  const amendment = deriveWeeklyAmendment({
    accepted: {
      amendment: undefined,
      closeId: args.closeId,
      included: folded.included,
      outsideSchedule: folded.outsideSchedule,
      scheduleLineage: folded.scheduleLineage.map((row) => ({
        ...row,
        scheduleVersionId: row.scheduleVersionId as Id<"storeSchedule"> | null,
      })),
    },
    closePosture,
    folded: currentFolded,
    now: Date.now(),
  });
  const priorPeriod = await priorPeriodPosture({
    currency: normalizeCurrencyCode(store.currency),
    ctx: args.ctx,
    fullCurrentPeriod: true,
    now: acceptedAt,
    period,
    storeId: args.storeId,
  });

  const fingerprint = stableStringHash(
    JSON.stringify({
      cutoffObservedAt,
      included: folded.included,
      outsideSchedule: folded.outsideSchedule,
      scheduleLineage: folded.scheduleLineage,
      topSkuLeaders,
    }),
  );
  const baselineId = await args.ctx.db.insert("reportWeekAccepted", {
    storeId: args.storeId,
    cycleStartDate: period.startDate,
    cycleEndDate: period.endDate,
    currency: normalizeCurrencyCode(store.currency),
    metricVersion: 1,
    acceptedAt,
    cutoffObservedAt,
    closeId: args.closeId,
    baselineFingerprint: fingerprint,
    included: folded.included,
    outsideSchedule: folded.outsideSchedule,
    scheduleLineage: folded.scheduleLineage.map((row) => ({
      ...row,
      scheduleVersionId: row.scheduleVersionId as Id<"storeSchedule"> | null,
    })),
    completeness: folded.completeness,
    topSkuLeaders,
    lifecyclePosture: closePosture.status,
    amendmentPosture: amendment ? "amended" : "none",
    inventoryAttention: acceptedInventoryFromClose(close, frameStartAt),
    closePosture,
    amendment,
    priorPeriod,
    variancePosture: computeWeeklyVariancePosture(period, acceptedDays),
  });
  const deliverySchedule = await getStoreScheduleContextForStoreAtWithCtx(
    args.ctx,
    { at: acceptedAt, storeId: args.storeId },
  );
  if (deliverySchedule.context.kind !== "resolved") {
    throw new Error("Accepted weekly report has no delivery timezone.");
  }
  await scheduleWeeklyManagerReportNotificationWithCtx(args.ctx, {
    acceptedAt,
    acceptedWeekId: baselineId,
    organizationId: store.organizationId,
    storeId: args.storeId,
    timezone: deliverySchedule.context.timezone,
  });
  const current = await args.ctx.db
    .query("reportWeekCurrent")
    .withIndex("by_storeId", (q) => q.eq("storeId", args.storeId))
    .unique();
  if (current && current.availability !== "unavailable") {
    await args.ctx.db.patch("reportWeekCurrent", current._id, {
      acceptedBaselineId: baselineId,
      closePosture,
      amendment,
      lifecyclePosture: closePosture.status,
      amendmentPosture: amendment ? "amended" : "none",
    });
  }
  await clearWeeklyAcceptanceIntent(args.ctx, args.storeId, intent);
  return "created";
}

function acceptedPeriod(
  accepted: Doc<"reportWeekAccepted">,
): Extract<WeeklyPeriod, { kind: "resolved" }> {
  const dates = accepted.scheduleLineage.map((row) => ({
    included: row.included,
    localDate: row.localDate,
    scheduleVersionId: row.scheduleVersionId
      ? String(row.scheduleVersionId)
      : null,
  }));
  const includedDates = dates
    .filter((date) => date.included)
    .map((date) => date.localDate);
  return {
    kind: "resolved",
    startDate: accepted.cycleStartDate,
    endDate: accepted.cycleEndDate,
    dates,
    includedDates,
    finalScheduledDate: includedDates.at(-1) ?? null,
    automaticFinalizationReason:
      includedDates.length === 0 ? "no_scheduled_dates" : null,
  };
}

export async function resolveAcceptedWeekClosePosture(
  ctx: QueryCtx,
  accepted: Pick<
    Doc<"reportWeekAccepted">,
    "acceptedAt" | "closeId" | "storeId"
  >,
  finalScheduledDate: string | null,
) {
  const original = await ctx.db.get("dailyClose", accepted.closeId);
  if (!original || !finalScheduledDate) {
    return {
      acceptedCloseId: accepted.closeId,
      changedAt: accepted.acceptedAt,
      status: "accepted" as const,
    };
  }
  const closeProbe = await ctx.db
    .query("dailyClose")
    .withIndex("by_storeId_operatingDate", (q) =>
      q.eq("storeId", accepted.storeId).eq("operatingDate", finalScheduledDate),
    )
    .take(WEEKLY_CLOSE_VERSION_LIMIT + 1);
  if (closeProbe.length > WEEKLY_CLOSE_VERSION_LIMIT) return null;
  const closes = closeProbe;
  const successor = closes
    .filter(
      (close) =>
        close._id !== accepted.closeId &&
        close.status === "completed" &&
        close.lifecycleStatus !== "superseded",
    )
    .sort(
      (left, right) =>
        (right.completedAt ?? right.updatedAt) -
        (left.completedAt ?? left.updatedAt),
    )[0];
  if (successor) {
    return {
      acceptedCloseId: accepted.closeId,
      currentCloseId: successor._id,
      changedAt: successor.completedAt ?? successor.updatedAt,
      status: "successor_accepted" as const,
    };
  }
  if (
    original.lifecycleStatus === "reopened" ||
    original.lifecycleStatus === "superseded" ||
    closes.some(
      (close) =>
        close.reopenedFromDailyCloseId === accepted.closeId &&
        close.status === "open",
    )
  ) {
    return {
      acceptedCloseId: accepted.closeId,
      changedAt: original.reopenedAt ?? original.updatedAt,
      status: "reopened_awaiting_successor" as const,
    };
  }
  return {
    acceptedCloseId: accepted.closeId,
    currentCloseId: accepted.closeId,
    changedAt: accepted.acceptedAt,
    status: "accepted" as const,
  };
}

async function refreshAcceptedWeek(
  ctx: MutationCtx,
  accepted: Doc<"reportWeekAccepted">,
  now: number,
) {
  const period = acceptedPeriod(accepted);
  const read = await readWeekDays(
    ctx,
    accepted.storeId,
    accepted.cycleStartDate,
    accepted.cycleEndDate,
  );
  if (read.status !== "ok") return false;
  const days = read.days;
  const folded = foldWeekFromDays({ period, days });
  if (!folded.completeness.complete) return false;

  const closePosture = await resolveAcceptedWeekClosePosture(
    ctx,
    accepted,
    period.finalScheduledDate,
  );
  if (!closePosture) return false;
  const amendment = deriveWeeklyAmendment({
    accepted,
    closePosture,
    folded,
    now,
  });

  await ctx.db.patch("reportWeekAccepted", accepted._id, {
    amendment,
    closePosture,
    lifecyclePosture: closePosture.status,
    amendmentPosture: amendment ? "amended" : "none",
  });
  const current = await ctx.db
    .query("reportWeekCurrent")
    .withIndex("by_storeId", (q) => q.eq("storeId", accepted.storeId))
    .unique();
  if (
    current?.availability !== "unavailable" &&
    current?.cycleStartDate === accepted.cycleStartDate
  ) {
    await ctx.db.patch("reportWeekCurrent", current._id, {
      acceptedBaselineId: accepted._id,
      amendment,
      closePosture,
      lifecyclePosture: closePosture.status,
      amendmentPosture: amendment ? "amended" : "none",
      variancePosture: computeWeeklyVariancePosture(period, days),
    });
  }
  return true;
}

async function retainAcceptedWeekDateRetry(
  ctx: MutationCtx,
  storeId: Id<"store">,
  operatingDate: string,
  now: number,
) {
  const dirtyDay = await ctx.db
    .query("reportDirtyDay")
    .withIndex("by_storeId_operatingDate", (q) =>
      q.eq("storeId", storeId).eq("operatingDate", operatingDate),
    )
    .unique();
  if (dirtyDay) {
    await ctx.db.patch("reportDirtyDay", dirtyDay._id, {
      markedAt: now,
    });
    return;
  }
  await ctx.db.insert("reportDirtyDay", {
    storeId,
    operatingDate,
    reason: "late_fact",
    markedAt: now,
  });
}

/**
 * Bounded accepted-history refresh for one folded date. Baseline fields are
 * never replaced; only the orthogonal current close/amendment projection is.
 */
export async function refreshAcceptedWeekForDate(
  ctx: MutationCtx,
  storeId: Id<"store">,
  operatingDate: string,
  now: number,
) {
  const store = await ctx.db.get("store", storeId);
  if (!store) return 0;
  if (
    store.reportingReseedStartedAt !== undefined ||
    !hasCompletedWeeklyObservedAtVerification(store)
  ) {
    await retainAcceptedWeekDateRetry(ctx, storeId, operatingDate, now);
    return 0;
  }
  // A folded day identifies its historical frame. Use the structural
  // store/cycle-start index rather than the bounded newest-first fallback so
  // late facts and reopens still reach an accepted week after it has aged out
  // of the recent refresh window.
  const accepted = await ctx.db
    .query("reportWeekAccepted")
    .withIndex("by_storeId_cycleStartDate", (q) =>
      q.eq("storeId", storeId).lte("cycleStartDate", operatingDate),
    )
    .order("desc")
    .first();
  if (accepted && operatingDate <= accepted.cycleEndDate) {
    if (await refreshAcceptedWeek(ctx, accepted, now)) return 1;
    await retainAcceptedWeekDateRetry(ctx, storeId, operatingDate, now);
    return 0;
  }

  // If this is the final scheduled close of a frame whose first attempt did
  // not create a baseline, the same exact day handoff retries it. This keeps
  // an older final close reachable even once newer closes exceed the bounded
  // store-level recovery scan below.
  const period = await resolvePeriodForOperatingDate(
    ctx,
    storeId,
    operatingDate,
  );
  if (period.kind !== "resolved") {
    // `missing_schedule` is the one unresolvable reason waiting cannot fix: a
    // date older than the store's oldest schedule version stays uncovered
    // because new versions are effective-dated forward. Re-marking it would
    // requeue the date on every sweep forever — observed on a real store whose
    // facts predate its schedule history by weeks. The day fold itself already
    // succeeded and is durable. A capped history or an absent timezone IS
    // remediable, so those keep their retry.
    if (period.reason !== "missing_schedule") {
      await retainAcceptedWeekDateRetry(ctx, storeId, operatingDate, now);
    }
    return 0;
  }
  if (period.finalScheduledDate !== operatingDate) {
    return 0;
  }

  const closeProbe = await ctx.db
    .query("dailyClose")
    .withIndex("by_storeId_operatingDate", (q) =>
      q.eq("storeId", storeId).eq("operatingDate", operatingDate),
    )
    .take(WEEKLY_CLOSE_VERSION_LIMIT + 1);
  if (closeProbe.length > WEEKLY_CLOSE_VERSION_LIMIT) {
    await retainAcceptedWeekDateRetry(ctx, storeId, operatingDate, now);
    return 0;
  }
  const closes = closeProbe;
  const close = closes
    .filter(
      (candidate) =>
        candidate.status === "completed" &&
        candidate.lifecycleStatus !== "superseded",
    )
    .sort(
      (left, right) =>
        (right.completedAt ?? right.updatedAt) -
        (left.completedAt ?? left.updatedAt),
    )[0];
  if (!close) {
    // An open final scheduled day has no baseline to recover yet. Requeueing
    // it as `late_fact` gives the next day fold lifecycle authority and
    // demotes the current day to `provisional`; the following sale reasserts
    // `day_open`, producing an open/provisional loop. Completing Daily Close
    // emits `close_accepted`, which is the durable retry signal once a close
    // actually exists. Historical or missing day evidence keeps the retry:
    // its delayed close may have fallen outside the bounded recovery scan.
    const finalDay = await ctx.db
      .query("reportDay")
      .withIndex("by_storeId_operatingDate", (q) =>
        q.eq("storeId", storeId).eq("operatingDate", operatingDate),
      )
      .unique();
    if (finalDay?.status !== "open") {
      await retainAcceptedWeekDateRetry(ctx, storeId, operatingDate, now);
    }
    return 0;
  }
  // A pre-activation close will never become acceptable; do not retry it.
  if (!isCloseWithinWeeklyAcceptanceFloor(store, close.completedAt)) {
    return 0;
  }

  const result = await materializeAcceptedWeek({
    closeId: close._id,
    ctx,
    now,
    storeId,
  });
  if (result === "created") return 1;
  if (result === "existing") return 0;

  // The sweeper consumed the completed day mark before attempting the weekly
  // baseline. Preserve that same bounded work item when source posture is not
  // yet fit for an immutable baseline, rather than silently losing an older
  // retry behind newer closes.
  await retainAcceptedWeekDateRetry(ctx, storeId, operatingDate, now);
  return 0;
}

/**
 * Recovery path for a final close whose day fold succeeded but whose weekly
 * intent was missed. The existing close index keeps the scan store-scoped and
 * bounded; structural cycle identity keeps retries idempotent.
 */
export async function reconcileRecentAcceptedWeeksForStore(
  ctx: MutationCtx,
  storeId: Id<"store">,
  now: number,
) {
  const store = await ctx.db.get("store", storeId);
  if (
    !store ||
    store.reportingReseedStartedAt !== undefined ||
    !hasCompletedWeeklyObservedAtVerification(store)
  ) {
    return 0;
  }
  const closes = await ctx.db
    .query("dailyClose")
    .withIndex("by_storeId_operatingDate", (q) => q.eq("storeId", storeId))
    .order("desc")
    .take(WEEKLY_CLOSE_RECONCILIATION_LIMIT);
  let created = 0;
  for (const close of closes) {
    if (
      close.status !== "completed" ||
      close.lifecycleStatus === "superseded" ||
      // Pre-activation closes never gain retrospective accepted baselines.
      !isCloseWithinWeeklyAcceptanceFloor(store, close.completedAt)
    ) {
      continue;
    }
    const period = await resolvePeriodForOperatingDate(
      ctx,
      storeId,
      close.operatingDate,
    );
    if (
      period.kind !== "resolved" ||
      period.finalScheduledDate !== close.operatingDate
    ) {
      continue;
    }
    const finalDay = await ctx.db
      .query("reportDay")
      .withIndex("by_storeId_operatingDate", (q) =>
        q.eq("storeId", storeId).eq("operatingDate", close.operatingDate),
      )
      .unique();
    // A completed close without `completedAt` still reaches materialization:
    // it records the retryable blocked reason rather than inventing a cutoff.
    if (
      finalDay?.closeId !== close._id ||
      finalDay.foldedAt === undefined ||
      (close.completedAt !== undefined && finalDay.foldedAt < close.completedAt)
    ) {
      continue;
    }
    const result = await materializeAcceptedWeek({
      closeId: close._id,
      ctx,
      now,
      storeId,
    });
    if (result === "created") created += 1;
    else if (result === "incomplete" || result === "unavailable") {
      await markWeekDirty(ctx, storeId, "acceptance_requested", now);
    }
  }

  // A missed dirty marker can also hide a recent reopen/successor posture
  // change. Exact folded-day handoffs above cover historical weeks; this is
  // only the bounded fallback for recent missed markers.
  const accepted = await ctx.db
    .query("reportWeekAccepted")
    .withIndex("by_storeId_acceptedAt", (q) => q.eq("storeId", storeId))
    .order("desc")
    .take(WEEKLY_ACCEPTED_REFRESH_LIMIT);
  for (const week of accepted) await refreshAcceptedWeek(ctx, week, now);
  return created;
}
