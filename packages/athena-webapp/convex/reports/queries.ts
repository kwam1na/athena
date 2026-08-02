import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { query } from "../_generated/server";
import type { QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import {
  hasCompletedWeeklyObservedAtVerification,
  isWeeklyReportingEnabledForStore,
} from "../platform/capabilityCatalog";
import { requireReportsStoreAccess } from "./access";
import {
  dayPeriodKey,
  isReportingTodayInProgress,
  monthPeriodKey,
  trailingThreeMonthsStart,
} from "../../shared/reportsContract";
import { REPORT_SKU_PAGE_SIZE } from "../../shared/reportsContract";
import type {
  ReportDayRow,
  ReportOverviewData,
  ReportPeriodKey,
  ReportRangeSummary,
  ReportSkuIdentity,
  ReportSkuMixData,
  ReportSkuPeriodRow,
  ReportSkuSortBy,
  ReportSkuTransactionEvidence,
  ReportWeekMetrics,
  ReportWeekSummary,
} from "../../shared/reportsContract";
import type { ReportWeekChangeDirection } from "../../shared/reportsContract";
import { emptySnapshot, snapshotForDays } from "./overview";
import { addDaysToDate, periodDateRange } from "./rollups";
import { transactionCountFromCloseSummary } from "./transactionCounts";

/**
 * Slice D — read queries for the rebuilt reports layer.
 *
 * Names, args, and return shapes are contract-frozen (slice E builds
 * against exactly these). Every handler starts with the access check and
 * carries a comment stating its worst-case document reads.
 */

const RANGE_MAX_SPAN_DAYS = 92;
const RANGE_SKU_MIX_ROW_LIMIT = 5_000;
const RANGE_SKU_MIX_VISIBLE_LIMIT = 5;
const SKU_DAY_EVIDENCE_FACT_LIMIT = 500;
const ITEMS_PERIOD_MAX_DAYS = 31;
const ITEMS_UNCLOSED_DAY_FACT_LIMIT = 2_000;
const WEEKLY_HISTORY_PAGE_MAX = 24;
const WEEKLY_REPORT_ID_PREFIX = "week:";

type WeeklyHistoryPagination = {
  cursor: string | null;
  numItems: number;
};

function requireWeeklyHistoryPagination(
  paginationOpts: WeeklyHistoryPagination,
): void {
  if (
    !Number.isInteger(paginationOpts.numItems) ||
    paginationOpts.numItems < 1 ||
    paginationOpts.numItems > WEEKLY_HISTORY_PAGE_MAX
  ) {
    throw new Error(
      `Weekly history page size must be between 1 and ${WEEKLY_HISTORY_PAGE_MAX}.`,
    );
  }
  if (
    paginationOpts.cursor !== null &&
    typeof paginationOpts.cursor !== "string"
  ) {
    throw new Error("Weekly history cursor is invalid.");
  }
}

/** Stable, store-scoped accepted-report identity; never a source record id. */
function weeklyReportId(cycleStartDate: string): string {
  return `${WEEKLY_REPORT_ID_PREFIX}${cycleStartDate}`;
}

function cycleStartDateForWeeklyReportId(reportId: string): string {
  const match = /^week:(\d{4}-\d{2}-\d{2})$/.exec(reportId);
  if (!match) throw new Error("Weekly report id is invalid.");
  return match[1]!;
}

function weeklySummary(metrics: ReportWeekMetrics): ReportWeekSummary {
  return {
    grossSalesMinor: metrics.grossSalesMinor,
    merchandiseMarginMinor: metrics.grossProfitMinor,
    netSalesMinor: metrics.netSalesMinor,
    netUnits: metrics.unitsSold - metrics.unitsReturned,
    paymentAllocatedMinor: metrics.paymentAllocatedMinor,
    paymentAllocationCoverage: metrics.paymentAllocationCoverage,
    paymentUnsettledMinor: metrics.paymentUnsettledMinor,
    paymentsCollectedMinor: metrics.paymentsCollectedMinor,
    paymentsRefundedMinor: metrics.paymentsRefundedMinor,
    refundsMinor: metrics.refundsMinor,
    unitsReturned: metrics.unitsReturned,
    unitsSold: metrics.unitsSold,
  };
}

function priorNetSalesChange(currentMinor: number, priorMinor: number) {
  const amountMinor = Math.abs(currentMinor - priorMinor);
  const direction: ReportWeekChangeDirection =
    currentMinor > priorMinor
      ? "higher"
      : currentMinor < priorMinor
        ? "lower"
        : "unchanged";
  return { amountMinor, direction };
}

function priorPeriodProjection(
  current: ReportWeekMetrics,
  priorPeriod: Doc<"reportWeekCurrent">["priorPeriod"],
) {
  if (!priorPeriod) return undefined;
  return {
    ...priorPeriod,
    summary: priorPeriod.values ? weeklySummary(priorPeriod.values) : null,
    netSalesChange:
      priorPeriod.comparabilityReason === "comparable" && priorPeriod.values
        ? priorNetSalesChange(current.netSalesMinor, priorPeriod.values.netSalesMinor)
        : null,
  };
}

function finalScheduledDate(
  scheduleLineage: {
    included: boolean;
    localDate: string;
  }[],
): string | null {
  return (
    scheduleLineage.filter((date) => date.included).at(-1)?.localDate ?? null
  );
}

function weeklyOwnerRoutes(args: {
  cycleEndDate: string;
  cycleStartDate: string;
  historical: boolean;
  scheduleLineage: { included: boolean; localDate: string }[];
}) {
  const finalDate = finalScheduledDate(args.scheduleLineage);
  return {
    transactions: {
      to: "/$orgUrlSlug/store/$storeUrlSlug/pos/transactions" as const,
      search: {
        startDate: args.cycleStartDate,
        endDate: args.cycleEndDate,
        order: "oldestFirst" as const,
      },
    },
    // Daily Close owns the final included schedule date, never the calendar
    // frame end (which can be a closed date).
    dailyClose: finalDate
      ? args.historical
        ? {
            to: "/$orgUrlSlug/store/$storeUrlSlug/operations/daily-close-history" as const,
            search: { day: finalDate },
          }
        : {
            to: "/$orgUrlSlug/store/$storeUrlSlug/operations/daily-close" as const,
            search: { operatingDate: finalDate },
          }
      : null,
    cashControls: {
      to: "/$orgUrlSlug/store/$storeUrlSlug/cash-controls" as const,
    },
    openWork: {
      to: "/$orgUrlSlug/store/$storeUrlSlug/operations/open-work" as const,
      search: { workType: "synced_sale_inventory_review" as const },
    },
  };
}

function toWeeklyCurrentProjection(doc: Doc<"reportWeekCurrent">) {
  return {
    cycleStartDate: doc.cycleStartDate,
    cycleEndDate: doc.cycleEndDate,
    currency: doc.currency,
    metricVersion: doc.metricVersion,
    materializedAt: doc.materializedAt,
    included: doc.included,
    summary: weeklySummary(doc.included),
    outsideSchedule: doc.outsideSchedule,
    scheduleLineage: doc.scheduleLineage,
    completeness: doc.completeness,
    lifecyclePosture: doc.lifecyclePosture!,
    amendmentPosture: doc.amendmentPosture!,
    inventoryAttention: doc.inventoryAttention,
    closePosture: doc.closePosture,
    amendment: doc.amendment
      ? {
          ...doc.amendment,
          summary: weeklySummary(doc.amendment.included),
          outsideScheduleSummary: weeklySummary(doc.amendment.outsideSchedule),
        }
      : undefined,
    priorPeriod: priorPeriodProjection(doc.included, doc.priorPeriod),
    variancePosture: doc.variancePosture,
    ownerRoutes: weeklyOwnerRoutes({
      cycleStartDate: doc.cycleStartDate,
      cycleEndDate: doc.cycleEndDate,
      historical: false,
      scheduleLineage: doc.scheduleLineage,
    }),
  };
}

function toAcceptedWeeklyProjection(doc: Doc<"reportWeekAccepted">) {
  const lifecyclePosture =
    doc.lifecyclePosture ?? doc.closePosture?.status ?? "accepted";
  const amendmentPosture =
    doc.amendmentPosture ?? (doc.amendment ? "amended" : "none");
  const current = doc.amendment
    ? {
        included: doc.amendment.included,
        summary: weeklySummary(doc.amendment.included),
        includedNetSalesDeltaMinor: doc.amendment.includedNetSalesDeltaMinor,
        outsideSchedule: doc.amendment.outsideSchedule,
        outsideScheduleSummary: weeklySummary(doc.amendment.outsideSchedule),
        outsideScheduleNetSalesDeltaMinor:
          doc.amendment.outsideScheduleNetSalesDeltaMinor,
      }
    : undefined;
  return {
    reportId: weeklyReportId(doc.cycleStartDate),
    cycleStartDate: doc.cycleStartDate,
    cycleEndDate: doc.cycleEndDate,
    currency: doc.currency,
    metricVersion: doc.metricVersion,
    acceptedAt: doc.acceptedAt,
    cutoffObservedAt: doc.cutoffObservedAt,
    closeId: doc.closeId,
    included: doc.included,
    summary: weeklySummary(doc.included),
    outsideSchedule: doc.outsideSchedule,
    scheduleLineage: doc.scheduleLineage,
    completeness: doc.completeness,
    lifecyclePosture,
    amendmentPosture,
    inventoryAttention: doc.inventoryAttention,
    closePosture: doc.closePosture,
    current,
    amendment: doc.amendment
      ? {
          ...doc.amendment,
          summary: weeklySummary(doc.amendment.included),
          outsideScheduleSummary: weeklySummary(doc.amendment.outsideSchedule),
        }
      : undefined,
    priorPeriod: priorPeriodProjection(doc.included, doc.priorPeriod),
    variancePosture: doc.variancePosture,
    ownerRoutes: weeklyOwnerRoutes({
      cycleStartDate: doc.cycleStartDate,
      cycleEndDate: doc.cycleEndDate,
      historical: true,
      scheduleLineage: doc.scheduleLineage,
    }),
  };
}

/** Inclusive day count between two "YYYY-MM-DD" operating-date labels. */
function inclusiveDaySpan(startDate: string, endDate: string): number {
  const start = Date.parse(`${startDate}T00:00:00.000Z`);
  const end = Date.parse(`${endDate}T00:00:00.000Z`);
  return Math.round((end - start) / 86_400_000) + 1;
}

function requireValidDateRange(startDate: string, endDate: string): void {
  if (startDate > endDate) {
    throw new Error("startDate must not be after endDate.");
  }
  const span = inclusiveDaySpan(startDate, endDate);
  if (!Number.isFinite(span) || span > RANGE_MAX_SPAN_DAYS) {
    throw new Error(`Date range must not exceed ${RANGE_MAX_SPAN_DAYS} days.`);
  }
}

function toReportDayRow(doc: Doc<"reportDay">): ReportDayRow {
  return {
    operatingDate: doc.operatingDate,
    status: doc.status,
    currency: doc.currency,
    flags: doc.flags,
    factCount: doc.factCount,
    closeVarianceMinor: doc.closeVarianceMinor,
    postCloseNetSalesDeltaMinor: doc.postCloseNetSalesDeltaMinor,
    grossSalesMinor: doc.grossSalesMinor,
    netSalesMinor: doc.netSalesMinor,
    refundsMinor: doc.refundsMinor,
    unitsSold: doc.unitsSold,
    unitsReturned: doc.unitsReturned,
    uncostedRevenueMinor: doc.uncostedRevenueMinor,
    grossProfitMinor: doc.grossProfitMinor,
    paymentsCollectedMinor: doc.paymentsCollectedMinor,
    paymentsRefundedMinor: doc.paymentsRefundedMinor,
    paymentAllocatedMinor: doc.paymentAllocatedMinor,
  };
}

function toSkuPeriodRow(doc: Doc<"reportPeriodSkuRollup">): ReportSkuPeriodRow {
  return {
    productSkuId: doc.productSkuId,
    periodKey: doc.periodKey,
    unitsSold: doc.unitsSold,
    unitsReturned: doc.unitsReturned,
    grossSalesMinor: doc.grossSalesMinor,
    netSalesMinor: doc.netSalesMinor,
    refundsMinor: doc.refundsMinor,
    uncostedRevenueMinor: doc.uncostedRevenueMinor,
    grossProfitMinor: doc.grossProfitMinor,
  };
}

// ---------------------------------------------------------------------------
// getOverview
// ---------------------------------------------------------------------------

export const getOverview = query({
  args: { storeId: v.id("store") },
  handler: async (ctx, args): Promise<ReportOverviewData | null> => {
    await requireReportsStoreAccess(ctx, args.storeId);

    // Steady-state read budget: 1 doc — the reportOverview singleton via
    // by_storeId. During overview-document rollouts, legacy documents are
    // enriched from at most 184 reportDay rows until the next sweep refreshes
    // the singleton with both current and prior rolling snapshots.
    const doc = await ctx.db
      .query("reportOverview")
      .withIndex("by_storeId", (q) => q.eq("storeId", args.storeId))
      .first();
    if (!doc) return null;

    let dailyTrend = doc.dailyTrend;
    let trailing3Months = doc.trailing3Months;
    let priorTrailing30 = doc.priorTrailing30;
    let priorTrailing3Months = doc.priorTrailing3Months;
    const needsTrendUnits = dailyTrend.some(
      (point) => point.unitsSold === undefined,
    );
    const anchorDate = dailyTrend.at(-1)?.operatingDate;

    if (
      (needsTrendUnits ||
        !trailing3Months ||
        !priorTrailing30 ||
        !priorTrailing3Months) &&
      anchorDate
    ) {
      const trailing3MonthsStart = trailingThreeMonthsStart(anchorDate);
      const priorTrailing3MonthsEnd = addDaysToDate(trailing3MonthsStart, -1);
      const startDate =
        !priorTrailing30 || !priorTrailing3Months
          ? trailingThreeMonthsStart(priorTrailing3MonthsEnd)
          : !trailing3Months
            ? trailing3MonthsStart
            : dailyTrend.at(0)?.operatingDate;

      if (startDate) {
        const days = await ctx.db
          .query("reportDay")
          .withIndex("by_storeId_operatingDate", (q) =>
            q
              .eq("storeId", args.storeId)
              .gte("operatingDate", startDate)
              .lte("operatingDate", anchorDate),
          )
          .take(184);
        if (needsTrendUnits) {
          const unitsByDate = new Map(
            days.map((day) => [day.operatingDate, day.unitsSold]),
          );
          dailyTrend = dailyTrend.map((point) => ({
            ...point,
            unitsSold: point.unitsSold ?? unitsByDate.get(point.operatingDate),
          }));
        }
        trailing3Months ??= snapshotForDays(
          days.filter(
            (day) =>
              day.operatingDate >= trailing3MonthsStart &&
              day.operatingDate <= anchorDate,
          ),
        );
        priorTrailing30 ??= snapshotForDays(
          days.filter((day) => {
            const endDate = addDaysToDate(anchorDate, -30);
            const startDate = addDaysToDate(anchorDate, -59);
            return (
              day.operatingDate >= startDate && day.operatingDate <= endDate
            );
          }),
        );
        priorTrailing3Months ??= snapshotForDays(
          days.filter(
            (day) =>
              day.operatingDate >=
                trailingThreeMonthsStart(priorTrailing3MonthsEnd) &&
              day.operatingDate <= priorTrailing3MonthsEnd,
          ),
        );
      }
    }

    return {
      updatedAt: doc.updatedAt,
      currency: doc.currency,
      today: doc.today,
      yesterday: doc.yesterday ?? emptySnapshot(),
      weekToDate: doc.weekToDate,
      priorWeek: doc.priorWeek,
      trailing30: doc.trailing30,
      priorTrailing30: priorTrailing30 ?? emptySnapshot(),
      trailing3Months: trailing3Months ?? emptySnapshot(),
      priorTrailing3Months: priorTrailing3Months ?? emptySnapshot(),
      comparisons: doc.comparisons,
      dailyTrend,
      trust: doc.trust,
    };
  },
});

// ---------------------------------------------------------------------------
// Weekly projections
// ---------------------------------------------------------------------------

/**
 * The live weekly tab's single summary subscription. It reads only the
 * Reports-owned singleton and, when linked, one immutable accepted baseline:
 * authorization and the fail-closed capability check run first; then <=1
 * `reportWeekCurrent` via `by_storeId` and <=1 `reportWeekAccepted` via
 * `by_storeId_cycleStartDate`. No source or report-day reads occur here.
 */
export const getActiveWeeklyBriefing = query({
  args: { storeId: v.id("store") },
  handler: async (ctx, args) => {
    const { store } = await requireReportsStoreAccess(ctx, args.storeId);
    if (
      !isWeeklyReportingEnabledForStore(
        String(args.storeId),
        undefined,
        hasCompletedWeeklyObservedAtVerification(store),
      )
    ) {
      return {
        status: "unavailable" as const,
        reason: "capability_disabled" as const,
      };
    }

    const current = await ctx.db
      .query("reportWeekCurrent")
      .withIndex("by_storeId", (q) => q.eq("storeId", args.storeId))
      .unique();
    if (!current) {
      return {
        status: "unavailable" as const,
        reason: "missing_projection" as const,
      };
    }
    if (current.availability === "unavailable") {
      return {
        status: "unavailable" as const,
        reason: current.unavailableReason,
      };
    }
    if (!current.lifecyclePosture || !current.amendmentPosture) {
      return {
        status: "unavailable" as const,
        reason: "missing_projection" as const,
      };
    }

    const baseline = current.acceptedBaselineId
      ? await ctx.db
          .query("reportWeekAccepted")
          .withIndex("by_storeId_cycleStartDate", (q) =>
            q
              .eq("storeId", args.storeId)
              .eq("cycleStartDate", current.cycleStartDate),
          )
          .unique()
      : null;

    return {
      status: "available" as const,
      current: toWeeklyCurrentProjection(current),
      acceptedBaseline: baseline ? toAcceptedWeeklyProjection(baseline) : null,
    };
  },
});

/**
 * Lazy accepted-history read. After authorization and the fail-closed
 * capability check, it pages at most 24 stored `reportWeekAccepted` rows
 * (plus Convex's continuation probe) through the newest-first
 * `by_storeId_acceptedAt` index. Invalid page bounds fail before projection
 * reads; no source-domain data is hydrated.
 */
export const listAcceptedWeeklyHistory = query({
  args: {
    storeId: v.id("store"),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    requireWeeklyHistoryPagination(args.paginationOpts);
    const { store } = await requireReportsStoreAccess(ctx, args.storeId);
    if (
      !isWeeklyReportingEnabledForStore(
        String(args.storeId),
        undefined,
        hasCompletedWeeklyObservedAtVerification(store),
      )
    ) {
      return { page: [], isDone: true, continueCursor: "" };
    }

    const page = await ctx.db
      .query("reportWeekAccepted")
      .withIndex("by_storeId_acceptedAt", (q) => q.eq("storeId", args.storeId))
      .order("desc")
      .paginate(args.paginationOpts);

    return {
      ...page,
      page: page.page.map(toAcceptedWeeklyProjection),
    };
  },
});

/**
 * Historical detail is one exact, store-prefixed accepted projection lookup:
 * authorization and the fail-closed capability check run first; then <=1
 * `reportWeekAccepted` through `by_storeId_cycleStartDate`. The stable report
 * id is validated before any projection read, and another store's row is
 * indistinguishable from missing.
 */
export const getAcceptedWeeklyDetail = query({
  args: { storeId: v.id("store"), reportId: v.string() },
  handler: async (ctx, args) => {
    const cycleStartDate = cycleStartDateForWeeklyReportId(args.reportId);
    const { store } = await requireReportsStoreAccess(ctx, args.storeId);
    if (
      !isWeeklyReportingEnabledForStore(
        String(args.storeId),
        undefined,
        hasCompletedWeeklyObservedAtVerification(store),
      )
    )
      return null;

    const accepted = await ctx.db
      .query("reportWeekAccepted")
      .withIndex("by_storeId_cycleStartDate", (q) =>
        q.eq("storeId", args.storeId).eq("cycleStartDate", cycleStartDate),
      )
      .unique();
    return accepted ? toAcceptedWeeklyProjection(accepted) : null;
  },
});

// ---------------------------------------------------------------------------
// listDays
// ---------------------------------------------------------------------------

export const listDays = query({
  args: {
    storeId: v.id("store"),
    startDate: v.string(),
    endDate: v.string(),
  },
  handler: async (ctx, args): Promise<ReportDayRow[]> => {
    await requireReportsStoreAccess(ctx, args.storeId);
    requireValidDateRange(args.startDate, args.endDate);

    // Read budget: up to RANGE_MAX_SPAN_DAYS (92) reportDay docs — a single
    // range read on by_storeId_operatingDate, capped by .take().
    const rows = await ctx.db
      .query("reportDay")
      .withIndex("by_storeId_operatingDate", (q) =>
        q
          .eq("storeId", args.storeId)
          .gte("operatingDate", args.startDate)
          .lte("operatingDate", args.endDate),
      )
      .take(RANGE_MAX_SPAN_DAYS);

    return rows.map(toReportDayRow);
  },
});

// ---------------------------------------------------------------------------
// listRangeSkuMix
// ---------------------------------------------------------------------------

export const listRangeSkuMix = query({
  args: {
    storeId: v.id("store"),
    startDate: v.string(),
    endDate: v.string(),
  },
  handler: async (ctx, args): Promise<ReportSkuMixData> => {
    await requireReportsStoreAccess(ctx, args.storeId);
    requireValidDateRange(args.startDate, args.endDate);

    // SKU-day density depends on both range length and catalogue breadth.
    // Fail closed at a bounded read instead of presenting an understated mix.
    const skuDays = await ctx.db
      .query("reportSkuDay")
      .withIndex("by_storeId_operatingDate_productSkuId", (q) =>
        q
          .eq("storeId", args.storeId)
          .gte("operatingDate", args.startDate)
          .lte("operatingDate", args.endDate),
      )
      .take(RANGE_SKU_MIX_ROW_LIMIT + 1);

    if (skuDays.length > RANGE_SKU_MIX_ROW_LIMIT) {
      throw new Error(
        "SKU mix covers too much activity to summarize accurately. Choose a shorter range.",
      );
    }

    const unitsBySku = new Map<Id<"productSku">, number>();
    for (const row of skuDays) {
      unitsBySku.set(
        row.productSkuId,
        (unitsBySku.get(row.productSkuId) ?? 0) + row.unitsSold,
      );
    }

    const ranked = Array.from(unitsBySku, ([productSkuId, unitsSold]) => ({
      productSkuId,
      unitsSold,
    }))
      .filter((row) => row.unitsSold > 0)
      .sort(
        (left, right) =>
          right.unitsSold - left.unitsSold ||
          String(left.productSkuId).localeCompare(String(right.productSkuId)),
      );
    const totalUnitsSold = ranked.reduce(
      (total, row) => total + row.unitsSold,
      0,
    );
    const leadingRows = ranked.slice(0, RANGE_SKU_MIX_VISIBLE_LIMIT);
    const rows: ReportSkuMixData["rows"] = await Promise.all(
      leadingRows.map(async (row) => {
        const identity = await resolveSkuIdentity(ctx, row.productSkuId);
        return {
          key: String(row.productSkuId),
          productSkuId: String(row.productSkuId),
          label:
            identity?.sku ?? identity?.displayName ?? String(row.productSkuId),
          unitsSold: row.unitsSold,
          shareBasisPoints:
            totalUnitsSold === 0
              ? 0
              : Math.round((row.unitsSold / totalUnitsSold) * 10_000),
          ...(identity ? { identity } : {}),
        };
      }),
    );
    const otherUnitsSold = ranked
      .slice(RANGE_SKU_MIX_VISIBLE_LIMIT)
      .reduce((total, row) => total + row.unitsSold, 0);

    if (otherUnitsSold > 0) {
      rows.push({
        key: "other",
        label: "Other SKUs",
        unitsSold: otherUnitsSold,
        shareBasisPoints: Math.round(
          (otherUnitsSold / totalUnitsSold) * 10_000,
        ),
      });
    }

    return { rows, totalUnitsSold, skuCount: ranked.length };
  },
});

// ---------------------------------------------------------------------------
// listPeriodSkus
// ---------------------------------------------------------------------------

type ListPeriodSkusCursor = {
  storeId: string;
  periodKey: string;
  sortBy: ReportSkuSortBy;
  lastSortKey: number;
  lastSkuId: string;
};

function encodeCursor(cursor: ListPeriodSkusCursor): string {
  return btoa(JSON.stringify(cursor));
}

function decodeCursor(cursor: string): ListPeriodSkusCursor {
  let parsed: unknown;
  try {
    parsed = JSON.parse(atob(cursor));
  } catch {
    throw new Error("Invalid pagination cursor.");
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    typeof (parsed as ListPeriodSkusCursor).storeId !== "string" ||
    typeof (parsed as ListPeriodSkusCursor).periodKey !== "string" ||
    typeof (parsed as ListPeriodSkusCursor).sortBy !== "string" ||
    typeof (parsed as ListPeriodSkusCursor).lastSortKey !== "number" ||
    typeof (parsed as ListPeriodSkusCursor).lastSkuId !== "string"
  ) {
    throw new Error("Invalid pagination cursor.");
  }
  return parsed as ListPeriodSkusCursor;
}

/**
 * Bound on rows skipped for exact sort-key ties at the cursor boundary —
 * the sort index is (storeId, periodKey, sortKey) only, so ties on
 * sortKey are disambiguated by productSkuId in application code rather
 * than by a compound index (the derived schema is frozen).
 */
const TIE_BREAK_OVERFETCH = 25;

async function livePosTransactionCount(
  ctx: QueryCtx,
  day: Pick<Doc<"reportDay">, "currency" | "operatingDate" | "storeId">,
): Promise<number> {
  const facts = await ctx.db
    .query("reportFact")
    .withIndex("by_storeId_operatingDate", (q) =>
      q.eq("storeId", day.storeId).eq("operatingDate", day.operatingDate),
    )
    .take(ITEMS_UNCLOSED_DAY_FACT_LIMIT + 1);
  if (facts.length > ITEMS_UNCLOSED_DAY_FACT_LIMIT) {
    throw new Error(
      `Transaction count is unavailable because ${day.operatingDate} exceeds the report fact limit.`,
    );
  }

  const saleSources = new Set<string>();
  const voidedSources = new Set<string>();
  for (const fact of facts) {
    if (
      fact.sourceDomain !== "pos" ||
      fact.currency !== day.currency ||
      fact.quarantine
    ) {
      continue;
    }
    if (fact.factKind === "sale") saleSources.add(fact.sourceId);
    if (fact.factKind === "void") voidedSources.add(fact.sourceId);
  }
  for (const sourceId of voidedSources) saleSources.delete(sourceId);
  return saleSources.size;
}

function priorPeriodDateRange(
  periodKey: ReportPeriodKey,
  periodRange: { startDate: string; endDate: string } | null,
) {
  if (!periodRange) return null;

  if (periodKey.startsWith("d:")) {
    const operatingDate = addDaysToDate(periodRange.startDate, -1);
    return { startDate: operatingDate, endDate: operatingDate };
  }

  if (periodKey.startsWith("w:")) {
    return {
      startDate: addDaysToDate(periodRange.startDate, -7),
      endDate: addDaysToDate(periodRange.endDate, -7),
    };
  }

  if (periodKey.startsWith("m:")) {
    return periodDateRange(
      monthPeriodKey(addDaysToDate(periodRange.startDate, -1)),
    );
  }

  return null;
}

async function transactionCountsForDays(
  ctx: QueryCtx,
  days: Doc<"reportDay">[],
): Promise<number[]> {
  const closes = await Promise.all(
    days.map((day) =>
      day.closeId
        ? ctx.db.get("dailyClose", day.closeId)
        : Promise.resolve(null),
    ),
  );

  return Promise.all(
    days.map((day, index) => {
      const close = closes[index];
      return close
        ? transactionCountFromCloseSummary(close.summary)
        : livePosTransactionCount(ctx, day);
    }),
  );
}

export const listPeriodSkus = query({
  args: {
    storeId: v.id("store"),
    periodKey: v.string(),
    sortBy: v.union(v.literal("revenue"), v.literal("units")),
    cursor: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    rows: ReportSkuPeriodRow[];
    continueCursor: string | null;
    totalNetSalesMinor: number;
    totalUnitsSold: number;
    totalTransactions: number;
    priorPeriodTotals: {
      netSalesMinor: number;
      unitsSold: number;
      transactions: number;
    };
    updatedAt: number | null;
    isTodayInProgress: boolean;
  }> => {
    await requireReportsStoreAccess(ctx, args.storeId);
    const periodRange = periodDateRange(args.periodKey as ReportPeriodKey);
    const priorRange = priorPeriodDateRange(
      args.periodKey as ReportPeriodKey,
      periodRange,
    );

    let cursorCtx: ListPeriodSkusCursor | null = null;
    if (args.cursor) {
      cursorCtx = decodeCursor(args.cursor);
      if (
        cursorCtx.storeId !== args.storeId ||
        cursorCtx.periodKey !== args.periodKey ||
        cursorCtx.sortBy !== args.sortBy
      ) {
        throw new Error(
          "Pagination cursor does not match the current query context.",
        );
      }
    }

    const sortField =
      args.sortBy === "revenue" ? "revenueSortKey" : "unitsSortKey";
    const indexName =
      args.sortBy === "revenue"
        ? "by_storeId_periodKey_revenueSortKey"
        : "by_storeId_periodKey_unitsSortKey";

    // Read budget: page size (10) + 1 lookahead row to detect continuation,
    // plus up to TIE_BREAK_OVERFETCH (25) extra rows to skip already-seen
    // sort-key ties at the cursor boundary — bounded at 36 docs worst case.
    const takeCount = REPORT_SKU_PAGE_SIZE + 1 + TIE_BREAK_OVERFETCH;
    const candidates = await ctx.db
      .query("reportPeriodSkuRollup")
      .withIndex(indexName, (q) => {
        const base = q
          .eq("storeId", args.storeId)
          .eq("periodKey", args.periodKey);
        return cursorCtx ? base.gte(sortField, cursorCtx.lastSortKey) : base;
      })
      .take(takeCount);

    // The index only orders by sortField; ties are broken deterministically
    // here (not by Convex's unspecified tie order) so pagination across a
    // tie group is consistent regardless of fetch order.
    candidates.sort((a, b) => {
      if (a[sortField] !== b[sortField]) return a[sortField] - b[sortField];
      return a.productSkuId < b.productSkuId
        ? -1
        : a.productSkuId > b.productSkuId
          ? 1
          : 0;
    });

    const filtered = cursorCtx
      ? candidates.filter((row) => {
          const key = row[sortField];
          if (key > cursorCtx!.lastSortKey) return true;
          if (key === cursorCtx!.lastSortKey) {
            return row.productSkuId > cursorCtx!.lastSkuId;
          }
          return false;
        })
      : candidates;

    const page = filtered.slice(0, REPORT_SKU_PAGE_SIZE);
    const hasMore = filtered.length > REPORT_SKU_PAGE_SIZE;

    const last = page[page.length - 1];
    const continueCursor =
      hasMore && last
        ? encodeCursor({
            storeId: args.storeId,
            periodKey: args.periodKey,
            sortBy: args.sortBy,
            lastSortKey: last[sortField],
            lastSkuId: last.productSkuId,
          })
        : null;

    // The bounded day read keeps period totals independent of SKU pagination
    // and uses the same reportDay authority as Overview's day rows. Linked,
    // accepted closes are the authority for finalized transaction counts.
    // A day without a close reads at most 2,001 facts to count its distinct
    // live POS transactions; the extra row detects the same 2,000-fact cap
    // enforced by the day fold instead of silently returning a partial count.
    // One singleton read carries the same sweep timestamp shown on Overview.
    const [rows, overview, periodDays, priorPeriodDays] = await Promise.all([
      withSkuIdentity(ctx, page.map(toSkuPeriodRow)),
      ctx.db
        .query("reportOverview")
        .withIndex("by_storeId", (q) => q.eq("storeId", args.storeId))
        .first(),
      periodRange
        ? ctx.db
            .query("reportDay")
            .withIndex("by_storeId_operatingDate", (q) =>
              q
                .eq("storeId", args.storeId)
                .gte("operatingDate", periodRange.startDate)
                .lte("operatingDate", periodRange.endDate),
            )
            .take(ITEMS_PERIOD_MAX_DAYS)
        : Promise.resolve([]),
      priorRange
        ? ctx.db
            .query("reportDay")
            .withIndex("by_storeId_operatingDate", (q) =>
              q
                .eq("storeId", args.storeId)
                .gte("operatingDate", priorRange.startDate)
                .lte("operatingDate", priorRange.endDate),
            )
            .take(ITEMS_PERIOD_MAX_DAYS)
        : Promise.resolve([]),
    ]);
    const [periodTransactionCounts, priorPeriodTransactionCounts] =
      await Promise.all([
        transactionCountsForDays(ctx, periodDays),
        transactionCountsForDays(ctx, priorPeriodDays),
      ]);
    const selectedDayDate =
      periodRange && periodRange.startDate === periodRange.endDate
        ? periodRange.startDate
        : null;

    return {
      rows,
      continueCursor,
      totalNetSalesMinor: periodDays.reduce(
        (total, day) => total + day.netSalesMinor,
        0,
      ),
      totalUnitsSold: periodDays.reduce(
        (total, day) => total + day.unitsSold,
        0,
      ),
      totalTransactions: periodTransactionCounts.reduce(
        (total, count) => total + count,
        0,
      ),
      priorPeriodTotals: {
        netSalesMinor: priorPeriodDays.reduce(
          (total, day) => total + day.netSalesMinor,
          0,
        ),
        unitsSold: priorPeriodDays.reduce(
          (total, day) => total + day.unitsSold,
          0,
        ),
        transactions: priorPeriodTransactionCounts.reduce(
          (total, count) => total + count,
          0,
        ),
      },
      updatedAt: overview?.updatedAt ?? null,
      isTodayInProgress:
        selectedDayDate !== null &&
        periodDays.some(
          (day) =>
            day.operatingDate === selectedDayDate &&
            isReportingTodayInProgress(day.status),
        ),
    };
  },
});

/**
 * Resolve display identity for a page of SKU rows.
 *
 * Product is the canonical source for its name. Legacy `productSku` rows do
 * not always carry the denormalized `productName`, so identity resolution
 * reads the linked product as well — bounded at two reads per row and 50 reads
 * for a full page. Rows whose SKU document is gone resolve to `undefined` and
 * fall back to the id in the UI: a reporting fact outlives its subject, and
 * dropping the row would silently understate the period.
 */
/**
 * Inventory metadata carries import placeholders — 1,078 of wigclub's 1,088
 * non-empty `size` values are the literal string "NULL" — so a raw value
 * would render as "6N2Y-GW8-2CB · NULL". Same rule the stock-adjustment
 * workspace applies client-side, enforced here so the placeholder never
 * leaves the server.
 */
function cleanMetadataValue(value?: string | null): string | undefined {
  const next = value?.trim();
  if (!next || next.toLowerCase() === "null") return undefined;
  return next;
}

/** Identity for one SKU — at most two document reads. */
async function resolveSkuIdentity(
  ctx: QueryCtx,
  productSkuId: Id<"productSku">,
): Promise<ReportSkuIdentity | undefined> {
  const sku = await ctx.db.get("productSku", productSkuId);
  if (!sku) return undefined;

  const product = await ctx.db.get("product", sku.productId);
  const productName =
    product?.storeId === sku.storeId
      ? cleanMetadataValue(product.name)
      : undefined;
  const code = cleanMetadataValue(sku.sku);
  const size = cleanMetadataValue(sku.size);
  const imageUrl = cleanMetadataValue(sku.images[0]);
  const unitCostMinor = sku.unitCost;

  return {
    displayName:
      productName ??
      cleanMetadataValue(sku.productName) ??
      code ??
      String(productSkuId),
    ...(sku.netPrice !== undefined ? { netPriceMinor: sku.netPrice } : {}),
    ...(unitCostMinor !== undefined ? { unitCostMinor } : {}),
    ...(code ? { sku: code } : {}),
    ...(size ? { size } : {}),
    ...(imageUrl ? { imageUrl } : {}),
    productId: String(sku.productId),
  };
}

async function withSkuIdentity(
  ctx: QueryCtx,
  rows: ReportSkuPeriodRow[],
): Promise<ReportSkuPeriodRow[]> {
  return Promise.all(
    rows.map(async (row) => {
      const identity = await resolveSkuIdentity(
        ctx,
        row.productSkuId as Id<"productSku">,
      );
      return identity ? { ...row, identity } : row;
    }),
  );
}

// ---------------------------------------------------------------------------
// getSkuDetail
// ---------------------------------------------------------------------------

function precedingEqualRange(startDate: string, endDate: string) {
  const dayCount = inclusiveDaySpan(startDate, endDate);
  const priorEndDate = addDaysToDate(startDate, -1);
  return {
    startDate: addDaysToDate(priorEndDate, 1 - dayCount),
    endDate: priorEndDate,
  };
}

function skuRangeTotals(
  rows: Doc<"reportSkuDay">[],
  productSkuId: Id<"productSku">,
  periodKey: string,
): ReportSkuPeriodRow | null {
  if (rows.length === 0) return null;

  const anyUncosted = rows.some((row) => row.grossProfitMinor === null);
  return {
    productSkuId,
    periodKey,
    unitsSold: sum(rows, "unitsSold"),
    unitsReturned: sum(rows, "unitsReturned"),
    grossSalesMinor: sum(rows, "grossSalesMinor"),
    netSalesMinor: sum(rows, "netSalesMinor"),
    refundsMinor: sum(rows, "refundsMinor"),
    uncostedRevenueMinor: sum(rows, "uncostedRevenueMinor"),
    grossProfitMinor: anyUncosted ? null : sum(rows, "grossProfitMinor"),
  };
}

export const getSkuDetail = query({
  args: {
    storeId: v.id("store"),
    productSkuId: v.id("productSku"),
    startDate: v.string(),
    endDate: v.string(),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    days: (ReportSkuPeriodRow & { operatingDate: string })[];
    totals: ReportSkuPeriodRow | null;
    priorPeriodTotals: ReportSkuPeriodRow | null;
    identity?: ReportSkuIdentity;
  } | null> => {
    await requireReportsStoreAccess(ctx, args.storeId);
    requireValidDateRange(args.startDate, args.endDate);
    const priorRange = precedingEqualRange(args.startDate, args.endDate);

    // Read budget: up to 2 * RANGE_MAX_SPAN_DAYS (184) reportSkuDay docs —
    // one bounded indexed read for the selected range and one for the
    // immediately preceding equal-length comparison range.
    const [rows, priorRows, identity] = await Promise.all([
      ctx.db
        .query("reportSkuDay")
        .withIndex("by_storeId_productSkuId_operatingDate", (q) =>
          q
            .eq("storeId", args.storeId)
            .eq("productSkuId", args.productSkuId)
            .gte("operatingDate", args.startDate)
            .lte("operatingDate", args.endDate),
        )
        .take(RANGE_MAX_SPAN_DAYS),
      ctx.db
        .query("reportSkuDay")
        .withIndex("by_storeId_productSkuId_operatingDate", (q) =>
          q
            .eq("storeId", args.storeId)
            .eq("productSkuId", args.productSkuId)
            .gte("operatingDate", priorRange.startDate)
            .lte("operatingDate", priorRange.endDate),
        )
        .take(RANGE_MAX_SPAN_DAYS),
      resolveSkuIdentity(ctx, args.productSkuId),
    ]);
    const priorPeriodTotals = skuRangeTotals(
      priorRows,
      args.productSkuId,
      `range:${priorRange.startDate}:${priorRange.endDate}`,
    );

    if (rows.length === 0) {
      return { days: [], totals: null, priorPeriodTotals, identity };
    }

    const days = rows.map((row) => ({
      productSkuId: row.productSkuId,
      periodKey: dayPeriodKey(row.operatingDate),
      operatingDate: row.operatingDate,
      unitsSold: row.unitsSold,
      unitsReturned: row.unitsReturned,
      grossSalesMinor: row.grossSalesMinor,
      netSalesMinor: row.netSalesMinor,
      refundsMinor: row.refundsMinor,
      uncostedRevenueMinor: row.uncostedRevenueMinor,
      grossProfitMinor: row.grossProfitMinor,
    }));

    const totals = skuRangeTotals(
      rows,
      args.productSkuId,
      `range:${args.startDate}:${args.endDate}`,
    );

    return { days, totals, priorPeriodTotals, identity };
  },
});

// ---------------------------------------------------------------------------
// listSkuDayTransactions
// ---------------------------------------------------------------------------

export const listSkuDayTransactions = query({
  args: {
    storeId: v.id("store"),
    productSkuId: v.id("productSku"),
    operatingDate: v.string(),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    transactions: ReportSkuTransactionEvidence[];
    truncated: boolean;
  }> => {
    await requireReportsStoreAccess(ctx, args.storeId);

    // Read budget: at most 501 reportFact docs plus at most 500 source docs.
    // The extra fact tells the UI when the bounded evidence result is not
    // complete, as required by the Reports trust contract.
    const factsWithSentinel = await ctx.db
      .query("reportFact")
      .withIndex("by_storeId_productSkuId_operatingDate", (q) =>
        q
          .eq("storeId", args.storeId)
          .eq("productSkuId", args.productSkuId)
          .eq("operatingDate", args.operatingDate),
      )
      .take(SKU_DAY_EVIDENCE_FACT_LIMIT + 1);
    const truncated = factsWithSentinel.length > SKU_DAY_EVIDENCE_FACT_LIMIT;
    const facts = factsWithSentinel
      .slice(0, SKU_DAY_EVIDENCE_FACT_LIMIT)
      .filter(
        (fact) =>
          fact.sourceDomain === "pos" || fact.sourceDomain === "storefront",
      );

    const grouped = new Map<string, typeof facts>();
    for (const fact of facts) {
      const key = `${fact.sourceDomain}:${fact.sourceId}`;
      const existing = grouped.get(key);
      if (existing) existing.push(fact);
      else grouped.set(key, [fact]);
    }

    const transactions = await Promise.all(
      Array.from(grouped.values()).map(
        async (sourceFacts): Promise<ReportSkuTransactionEvidence> => {
          const first = sourceFacts[0]!;
          const quantity = sourceFacts.reduce(
            (total, fact) => total + fact.quantity,
            0,
          );
          const netSalesMinor = sourceFacts.reduce(
            (total, fact) => total + fact.netAmountMinor,
            0,
          );
          const costFacts = sourceFacts.filter((fact) => fact.quantity !== 0);
          const hasCompleteCost = costFacts.every(
            (fact) => fact.unitCostMinor !== undefined,
          );
          const costMinor = hasCompleteCost
            ? costFacts.reduce(
                (total, fact) =>
                  total + fact.quantity * (fact.unitCostMinor ?? 0),
                0,
              )
            : null;
          const occurredAt = Math.max(
            ...sourceFacts.map((fact) => fact.occurredAt),
          );
          const hasRefunds = sourceFacts.some(
            (fact) => fact.factKind === "refund" || fact.factKind === "return",
          );
          const hasAdjustments = sourceFacts.some(
            (fact) =>
              fact.factKind === "correction" || fact.factKind === "void",
          );

          if (first.sourceDomain === "pos") {
            const id = ctx.db.normalizeId("posTransaction", first.sourceId);
            const sourceTransaction = id
              ? await ctx.db.get("posTransaction", id)
              : null;
            const transaction =
              sourceTransaction?.storeId === args.storeId
                ? sourceTransaction
                : null;
            return {
              sourceDomain: "pos",
              sourceId: first.sourceId,
              reference: transaction?.transactionNumber ?? first.sourceId,
              occurredAt,
              status: transaction?.status ?? "Unavailable",
              quantity,
              netSalesMinor,
              costMinor,
              grossProfitMinor:
                costMinor === null ? null : netSalesMinor - costMinor,
              hasRefunds: hasRefunds || transaction?.status === "refunded",
              hasAdjustments: hasAdjustments || transaction?.status === "void",
            };
          }

          const id = ctx.db.normalizeId("onlineOrder", first.sourceId);
          const sourceOrder = id ? await ctx.db.get("onlineOrder", id) : null;
          const order =
            sourceOrder?.storeId === args.storeId ? sourceOrder : null;
          return {
            sourceDomain: "storefront",
            sourceId: first.sourceId,
            reference: order?.orderNumber ?? first.sourceId,
            occurredAt,
            status: order?.status ?? "Unavailable",
            quantity,
            netSalesMinor,
            costMinor,
            grossProfitMinor:
              costMinor === null ? null : netSalesMinor - costMinor,
            hasRefunds: hasRefunds || Boolean(order?.refunds?.length),
            hasAdjustments,
          };
        },
      ),
    );

    transactions.sort((left, right) => right.occurredAt - left.occurredAt);
    return { transactions, truncated };
  },
});

function sum(
  rows: Doc<"reportSkuDay">[],
  key:
    | "unitsSold"
    | "unitsReturned"
    | "grossSalesMinor"
    | "netSalesMinor"
    | "refundsMinor"
    | "uncostedRevenueMinor"
    | "grossProfitMinor",
): number {
  return rows.reduce((total, row) => {
    const value = row[key];
    return total + (typeof value === "number" ? value : 0);
  }, 0);
}

// ---------------------------------------------------------------------------
// getRangeResult
// ---------------------------------------------------------------------------

export const getRangeResult = query({
  args: { storeId: v.id("store"), requestKey: v.string() },
  handler: async (ctx, args): Promise<ReportRangeSummary | null> => {
    await requireReportsStoreAccess(ctx, args.storeId);

    // Read budget: 1 doc — reportRangeResult via by_storeId_requestKey.
    const doc = await ctx.db
      .query("reportRangeResult")
      .withIndex("by_storeId_requestKey", (q) =>
        q.eq("storeId", args.storeId).eq("requestKey", args.requestKey),
      )
      .first();
    if (!doc) return null;

    // Treat rows past expiresAt as null — the sweeper reaps them, but a
    // read racing that sweep must not surface stale/expired results.
    if (doc.expiresAt <= Date.now()) return null;

    return {
      requestKey: doc.requestKey,
      startDate: doc.startDate,
      endDate: doc.endDate,
      status: doc.status,
      totals: doc.totals,
      topSkus: doc.topSkus,
      failureReason: doc.failureReason,
      computedAt: doc.computedAt,
      expiresAt: doc.expiresAt,
    };
  },
});
