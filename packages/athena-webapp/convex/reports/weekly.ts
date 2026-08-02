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
import { hasCompletedWeeklyObservedAtVerification } from "../platform/capabilityCatalog";

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
  };
}

function firstIncompleteReason(args: {
  days: readonly WeekDay[];
}): ReportWeekCompleteness {
  if (args.days.some((day) => day.flags.mixedCurrency)) {
    return { complete: false, reason: "mixed_currency" };
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
 */
export function foldWeekFromDays(args: {
  period: Extract<WeeklyPeriod, { kind: "resolved" }>;
  days: readonly WeekDay[];
}): WeekFold {
  const byDate = new Map(args.days.map((day) => [day.operatingDate, day]));
  let included = zeroWeekMetrics();
  let outsideSchedule = zeroWeekMetrics();

  for (const date of args.period.dates) {
    const day = byDate.get(date.localDate);
    if (!day) continue;
    if (date.included) included = addDay(included, day);
    else outsideSchedule = addDay(outsideSchedule, day);
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
        activityPosture:
          day === undefined || day.factCount === 0
            ? "zero_activity"
            : "recorded",
      };
    }),
    completeness: firstIncompleteReason({
      days: args.days,
    }),
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

async function readWeekDays(
  ctx: MutationCtx,
  storeId: Id<"store">,
  startDate: string,
  endDate: string,
) {
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
  if (pendingDay.length > 0) return null;

  const days = await ctx.db
    .query("reportDay")
    .withIndex("by_storeId_operatingDate", (q) =>
      q
        .eq("storeId", storeId)
        .gte("operatingDate", startDate)
        .lte("operatingDate", endDate),
    )
    .take(WEEKLY_DAY_READ_LIMIT);
  return days.length >= WEEKLY_DAY_READ_LIMIT ? null : days;
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

export function computeWeeklyVariancePosture(
  period: Extract<WeeklyPeriod, { kind: "resolved" }>,
  days: readonly WeekDay[],
) {
  const included = new Set(period.includedDates);
  const includedDays = days.filter((day) => included.has(day.operatingDate));
  const covered = includedDays.filter(
    (day) => day.closeVarianceMinor !== undefined,
  );
  return {
    closeVarianceMinor: covered.reduce(
      (total, day) => total + (day.closeVarianceMinor ?? 0),
      0,
    ),
    coverage:
      covered.length === 0
        ? ("unavailable" as const)
        : covered.length === period.includedDates.length
          ? ("complete" as const)
          : ("partial" as const),
    coveredIncludedDayCount: covered.length,
    includedDayCount: period.includedDates.length,
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
  const days = await readWeekDays(
    args.ctx,
    args.storeId,
    prior.startDate,
    prior.endDate,
  );
  if (!days) {
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
  const comparisonPeriod = {
    ...prior,
    dates: prior.dates.filter((date) => selected.has(date.localDate)),
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
      : folded.completeness.reason === "missing_day_fold"
        ? ("missing_prior_day_fold" as const)
        : ("prior_incomplete" as const);
  return {
    cycleStartDate: prior.startDate,
    cycleEndDate: prior.endDate,
    comparabilityReason,
    currentScheduledPositionCount: currentDates.length,
    equivalentScheduledPositions,
    priorScheduledPositionCount: priorDates.length,
    values: folded.completeness.complete ? folded.included : null,
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
      const lifecyclePosture: ReportWeekLifecyclePosture =
        existing.acceptedBaselineId
          ? (existing.closePosture?.status ?? "accepted")
          : "materializing";
      const amendmentPosture: ReportWeekAmendmentPosture =
        existing.acceptedBaselineId ? "pending_recompute" : "none";
      await ctx.db.patch("reportWeekCurrent", existing._id, {
        lifecyclePosture,
        amendmentPosture,
        ...(unavailableReason === "missing_schedule" ||
        unavailableReason === "missing_timezone" ||
        unavailableReason === "schedule_history_cap" ||
        unavailableReason === "missing_day_fold"
          ? {
              completeness: {
                complete: false,
                reason: unavailableReason,
              },
            }
          : {}),
      });
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
  const days = await readWeekDays(
    ctx,
    storeId,
    period.startDate,
    period.endDate,
  );
  if (!days) {
    await persistUnavailable("missing_day_fold");
    return "unavailable";
  }

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

/** Upsert the per-store marker consumed by the one existing Reports sweeper. */
export async function markWeekDirty(
  ctx: MutationCtx,
  storeId: Id<"store">,
  reason: Doc<"reportDirtyWeek">["reason"],
  now: number,
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
  if (existing) {
    await ctx.db.patch("reportDirtyWeek", existing._id, {
      reason,
      markedAt: now,
    });
    return;
  }
  await ctx.db.insert("reportDirtyWeek", { storeId, reason, markedAt: now });
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
  acceptedAt: number;
  closeId: Id<"dailyClose">;
  ctx: MutationCtx;
  cutoffObservedAt: number;
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
    finalDay.foldedAt < args.acceptedAt
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

  const factsByDate = new Map<string, Doc<"reportFact">[]>();
  let remaining = MAX_WEEKLY_FACTS;
  for (const date of period.dates.map((row) => row.localDate)) {
    const facts = await args.ctx.db
      .query("reportFact")
      .withIndex("by_storeId_operatingDate_observedAt", (q) =>
        q
          .eq("storeId", args.storeId)
          .eq("operatingDate", date)
          .lte("observedAt", args.cutoffObservedAt),
      )
      .take(remaining + 1);
    if (facts.length > remaining) return "incomplete";
    remaining -= facts.length;
    factsByDate.set(date, facts);
  }

  const folded = foldWeekFromAcceptedFacts({
    currency: normalizeCurrencyCode(store.currency),
    factsByDate,
    period,
  });
  if (!folded.completeness.complete) return "incomplete";
  const frameStartAt = await periodStartAt(args.ctx, period);
  if (frameStartAt === null) return "unavailable";
  const acceptedDays = await readWeekDays(
    args.ctx,
    args.storeId,
    period.startDate,
    period.endDate,
  );
  if (!acceptedDays) return "incomplete";
  const currentFolded = foldWeekFromDays({ period, days: acceptedDays });
  if (!currentFolded.completeness.complete) return "incomplete";
  const closePosture = await resolveAcceptedWeekClosePosture(
    args.ctx,
    {
      acceptedAt: args.acceptedAt,
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
    now: args.acceptedAt,
    period,
    storeId: args.storeId,
  });

  const fingerprint = stableStringHash(
    JSON.stringify({
      cutoffObservedAt: args.cutoffObservedAt,
      included: folded.included,
      outsideSchedule: folded.outsideSchedule,
      scheduleLineage: folded.scheduleLineage,
    }),
  );
  const baselineId = await args.ctx.db.insert("reportWeekAccepted", {
    storeId: args.storeId,
    cycleStartDate: period.startDate,
    cycleEndDate: period.endDate,
    currency: normalizeCurrencyCode(store.currency),
    metricVersion: 1,
    acceptedAt: args.acceptedAt,
    cutoffObservedAt: args.cutoffObservedAt,
    closeId: args.closeId,
    baselineFingerprint: fingerprint,
    included: folded.included,
    outsideSchedule: folded.outsideSchedule,
    scheduleLineage: folded.scheduleLineage.map((row) => ({
      ...row,
      scheduleVersionId: row.scheduleVersionId as Id<"storeSchedule"> | null,
    })),
    completeness: folded.completeness,
    lifecyclePosture: closePosture.status,
    amendmentPosture: amendment ? "amended" : "none",
    inventoryAttention: acceptedInventoryFromClose(close, frameStartAt),
    closePosture,
    amendment,
    priorPeriod,
    variancePosture: computeWeeklyVariancePosture(period, acceptedDays),
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
    outsideScheduleFactDates: [],
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
  const days = await readWeekDays(
    ctx,
    accepted.storeId,
    accepted.cycleStartDate,
    accepted.cycleEndDate,
  );
  if (!days) return false;
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
    await retainAcceptedWeekDateRetry(ctx, storeId, operatingDate, now);
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
    await retainAcceptedWeekDateRetry(ctx, storeId, operatingDate, now);
    return 0;
  }

  const acceptedAt = close.completedAt ?? close.updatedAt;
  const result = await materializeAcceptedWeek({
    acceptedAt,
    closeId: close._id,
    ctx,
    cutoffObservedAt: acceptedAt,
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
      close.lifecycleStatus === "superseded"
    ) {
      continue;
    }
    const acceptedAt = close.completedAt ?? close.updatedAt;
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
    if (
      finalDay?.closeId !== close._id ||
      finalDay.foldedAt === undefined ||
      finalDay.foldedAt < acceptedAt
    ) {
      continue;
    }
    const result = await materializeAcceptedWeek({
      acceptedAt,
      closeId: close._id,
      ctx,
      cutoffObservedAt: acceptedAt,
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
