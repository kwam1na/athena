/**
 * Read ports for `reports.daySales`, `reports.weekPerformance`, and
 * `reports.storePulse` (V26-1267).
 *
 * Authority boundary: `defineAgentReadPortQuery` reauthorizes, scopes, strips
 * ungranted projections, and scans for raw identifiers. These handlers decide
 * only which authoritative record to stand on and how to label its authority.
 *
 * `daySales` reads the daily report record: a folded day carries a certified
 * fold revision and is reported `accepted`; an open day is the provisional
 * preview `reports/ingest.ts` maintains inside the sale's own transaction and
 * is reported `live`. `weekPerformance` reuses the frozen-versus-live week
 * metric seam and labels each day with the authority it actually came from.
 * `storePulse` is an explicit derivation over mixed-time sources.
 */
import type { Doc, Id } from "../../_generated/dataModel";
import type { QueryCtx } from "../../_generated/server";
import {
  mintAgentResourceRef,
  mintAgentSourceRef,
  money,
  resolveAgentOperatingWindowWithCtx,
  shiftOperatingDate,
  units,
} from "../../lib/agentCapabilitySupport";
import { defineAgentReadPortQuery } from "../../platform/operationAdmission";
import type { AgentReadPortHandler, AgentReadPortHandlerOutput } from "../../agentHarness/readPorts";
import type { AgentSourceCompleteness, AgentWarning } from "../../../shared/agentHarness/results";
import { known, unknown } from "../../../shared/agentHarness/results";
import { buildWeekMetricsForDates } from "../../operations/dailyOperations";
import { getStorePulseSummaryForWindow } from "../../pos/application/queries/storePulse";
import {
  DAY_SALES_PORT_KEY,
  DAY_SALES_TOP_ITEM_LIMIT,
  STORE_PULSE_PORT_KEY,
  WEEK_PERFORMANCE_PORT_KEY,
} from "./sales";

const SKU_DAY_ROW_CEILING = 200;

function fallbackWarning(sourceKey: string): AgentWarning {
  return {
    code: "operating_window_fallback",
    message: "No store schedule governed this date, so the calendar day was used for the window.",
    sourceKey,
  };
}

/** Saturday-ending week, matching the Daily Operations week rail. */
function saturdayWeekEnd(operatingDate: string): string {
  const dayOfWeek = new Date(`${operatingDate}T12:00:00.000Z`).getUTCDay();
  return shiftOperatingDate(operatingDate, 6 - dayOfWeek);
}

/** The domain read itself, exported so the direct-harness smoke can bind the exact same code. */
export const getDaySalesHandler: AgentReadPortHandler = async (ctx, input): Promise<AgentReadPortHandlerOutput> => {
  const storeId = input.scope.storeId;
  if (!storeId) {
    return { kind: "unavailable", reason: "store_scope_missing", retryable: false, sourceKey: "report" };
  }
  const operatingDate = String(input.args.operatingDate);
  const window = await resolveAgentOperatingWindowWithCtx(ctx, { operatingDate, storeId });
  if (!window) {
    return { kind: "unavailable", reason: "operating_date_unresolvable", retryable: false, sourceKey: "report" };
  }

  const [store, day, skuRows] = await Promise.all([
    ctx.db.get("store", storeId),
    ctx.db
      .query("reportDay")
      .withIndex("by_storeId_operatingDate", (q) => q.eq("storeId", storeId).eq("operatingDate", operatingDate))
      .first(),
    ctx.db
      .query("reportSkuDay")
      .withIndex("by_storeId_operatingDate_productSkuId", (q) =>
        q.eq("storeId", storeId).eq("operatingDate", operatingDate),
      )
      .take(SKU_DAY_ROW_CEILING),
  ]);
  const currency = day?.currency ?? store?.currency ?? "GHS";
  const isAccepted = day !== null && day.status !== "open";

  const topSkuRows = [...skuRows]
    .sort((left, right) => right.unitsSold - left.unitsSold || right.netSalesMinor - left.netSalesMinor)
    .slice(0, DAY_SALES_TOP_ITEM_LIMIT);
  const skuDocs = await Promise.all(
    topSkuRows.map((row) => ctx.db.get("productSku", row.productSkuId)),
  );
  const topItems = topSkuRows.map((row, index) => {
    const sku = skuDocs[index];
    const resolved = sku?.storeId === storeId ? sku : null;
    return {
      skuRef: mintAgentResourceRef("product_sku", storeId, String(row.productSkuId)),
      skuCode: resolved?.sku ?? undefined,
      // A reporting row outlives its subject: an unresolvable SKU is disclosed, never dropped.
      displayName: resolved?.productName?.trim() || resolved?.sku || "Unknown item",
      quantity: units(row.unitsSold),
      value: money(row.netSalesMinor, currency),
    };
  });

  const paymentGroups =
    day?.paymentMix?.status === "complete"
      ? day.paymentMix.rows.map((row) => ({
          method: row.method,
          amount: money(row.amountMinor, currency),
          shareBasisPoints: row.shareBasisPoints,
          tenderUseCount: row.tenderUseCount,
        }))
      : [];

  const warnings: AgentWarning[] = window.derivation === "utc_fallback" ? [fallbackWarning("report")] : [];
  const sources: AgentSourceCompleteness[] = [
    day
      ? { sourceKey: "report", status: "complete", capturedAt: input.now }
      : { sourceKey: "report", status: "unavailable", reason: "no_report_record_for_day", capturedAt: input.now },
    {
      sourceKey: "topItems",
      status: skuRows.length >= SKU_DAY_ROW_CEILING ? "truncated" : day ? "complete" : "unavailable",
      reason:
        skuRows.length >= SKU_DAY_ROW_CEILING
          ? "sku_row_ceiling_reached"
          : day
            ? undefined
            : "no_report_record_for_day",
      capturedAt: input.now,
    },
    {
      // The mix is deliberately two-state: it reconciles exactly, or it is unavailable.
      sourceKey: "paymentMix",
      status: day?.paymentMix?.status === "complete" ? "complete" : "unavailable",
      reason: day?.paymentMix?.status === "complete" ? undefined : "payment_mix_does_not_reconcile",
      capturedAt: input.now,
    },
  ];

  return {
    kind: "data",
    data: {
      operatingDate,
      operatingWindow: { derivation: window.derivation, timezone: window.timezone },
      recordState: day?.status ?? "absent",
      recordRevision: day?.certifiedFoldRevision !== undefined ? String(day.certifiedFoldRevision) : undefined,
      transactionCount: day?.transactionCount ?? 0,
      unitsSold: day?.unitsSold ?? 0,
      unitsReturned: day?.unitsReturned ?? 0,
      revenue: day ? known(money(day.netSalesMinor, currency)) : unknown("not_recorded"),
      grossRevenue: day ? known(money(day.grossSalesMinor, currency)) : unknown("not_recorded"),
      refunds: day ? known(money(day.refundsMinor, currency)) : unknown("not_recorded"),
      // Absent, never zero: a day with uncosted revenue has no honest profit figure.
      grossProfit:
        day && day.grossProfitMinor !== null
          ? known(money(day.grossProfitMinor, currency))
          : unknown(day ? "not_applicable" : "not_recorded"),
      paymentGroups,
      topItems,
    },
    observedAt: input.now,
    freshness: isAccepted
      ? {
          class: "accepted",
          authority: "authoritative_record",
          sourceVersion: String(day.certifiedFoldRevision ?? day.foldVersion),
        }
      : { class: "live", authority: "authoritative_record" },
    sources,
    warnings,
    sourceRefs: [
      {
        ref: mintAgentSourceRef(isAccepted ? "report_revision" : "live_snapshot", storeId, `daySales:${operatingDate}`),
        kind: isAccepted ? "report_revision" : "live_snapshot",
        label: `Daily report ${operatingDate}`,
        version: isAccepted ? String(day.certifiedFoldRevision ?? day.foldVersion) : undefined,
        capturedAt: input.now,
      },
      ...topSkuRows.map((row) => ({
        ref: mintAgentSourceRef("sku_snapshot", storeId, `${operatingDate}:${String(row.productSkuId)}`),
        kind: "sku_snapshot",
        capturedAt: input.now,
      })),
    ],
  };
};

export const getDaySales = defineAgentReadPortQuery({ portKey: DAY_SALES_PORT_KEY, handler: getDaySalesHandler });

/** The domain read itself, exported so the direct-harness smoke can bind the exact same code. */
export const getWeekPerformanceHandler: AgentReadPortHandler = async (ctx, input): Promise<AgentReadPortHandlerOutput> => {
  const storeId = input.scope.storeId;
  if (!storeId) {
    return { kind: "unavailable", reason: "store_scope_missing", retryable: false, sourceKey: "days" };
  }
  const requested = String(input.args.weekEndOperatingDate);
  const weekEndOperatingDate = saturdayWeekEnd(requested);
  const weekStartOperatingDate = shiftOperatingDate(weekEndOperatingDate, -6);
  const priorBoundaryOperatingDate = shiftOperatingDate(weekEndOperatingDate, -7);
  // Prove the requested date resolves through store time before reading a week of it.
  const window = await resolveAgentOperatingWindowWithCtx(ctx, {
    operatingDate: weekEndOperatingDate,
    storeId,
  });
  if (!window) {
    return { kind: "unavailable", reason: "operating_date_unresolvable", retryable: false, sourceKey: "days" };
  }

  const store = await ctx.db.get("store", storeId);
  const currency = store?.currency ?? "GHS";
  const operatingDates = Array.from({ length: 7 }, (_, index) => shiftOperatingDate(weekEndOperatingDate, index - 6));
  const metrics = await buildWeekMetricsForDates(ctx, {
    metrics: [
      ...operatingDates.map((operatingDate) => ({ isSelected: false, operatingDate })),
      { isSelected: false, operatingDate: priorBoundaryOperatingDate },
    ],
    storeId,
  });

  const days = metrics.map((metric, index) => ({
    operatingDate: metric.operatingDate,
    // A frozen (closed, not reopened) day is the accepted record; anything else was read live.
    authority: metric.isClosed && !metric.isReopened ? ("accepted" as const) : ("live" as const),
    isPriorBoundary: index === metrics.length - 1,
    transactionCount: metric.transactionCount,
    revenue: known(money(metric.salesTotal, currency)),
    expenses: known(money(metric.expenseTotal, currency)),
    cashTaken: known(money(metric.currentDayCashTotal, currency)),
  }));
  const missing = operatingDates.filter(
    (operatingDate) => !metrics.some((metric) => metric.operatingDate === operatingDate),
  );
  const anyAccepted = days.some((day) => day.authority === "accepted");
  const warnings: AgentWarning[] = window.derivation === "utc_fallback" ? [fallbackWarning("days")] : [];
  // The Saturday alignment silently rewrites the caller's question; say so,
  // and name the served days that fall after the date the caller actually
  // gave — a mid-week request otherwise reads days that have not happened
  // and mistakes their emptiness for a quiet week.
  if (weekEndOperatingDate !== requested) {
    warnings.push({
      code: "week_aligned",
      message: `Requested week end ${requested} was aligned to the Saturday-ending operating week ${weekStartOperatingDate}..${weekEndOperatingDate}.`,
      sourceKey: "days",
    });
    const afterRequested = operatingDates.filter((operatingDate) => operatingDate > requested);
    if (afterRequested.length > 0) {
      warnings.push({
        code: "days_after_requested",
        message: `${afterRequested.length} served day(s) (${afterRequested[0]}..${afterRequested[afterRequested.length - 1]}) fall after the requested ${requested} and may not have occurred yet.`,
        sourceKey: "days",
      });
    }
  }

  return {
    kind: "data",
    data: { weekEndOperatingDate, weekStartOperatingDate, priorBoundaryOperatingDate, days },
    observedAt: input.now,
    freshness: anyAccepted
      ? { class: "accepted", authority: "authoritative_record" }
      : { class: "live", authority: "authoritative_record" },
    sources: [
      {
        sourceKey: "days",
        status: missing.length === 0 ? "complete" : "partial",
        reason: missing.length === 0 ? undefined : "days_unreadable",
        missing: missing.length === 0 ? undefined : missing,
        capturedAt: input.now,
      },
    ],
    warnings,
    sourceRefs: days.map((day) => ({
      ref: mintAgentSourceRef(
        day.authority === "accepted" ? "report_revision" : "live_snapshot",
        storeId,
        `week:${day.operatingDate}`,
      ),
      kind: day.authority === "accepted" ? "report_revision" : "live_snapshot",
      label: day.operatingDate,
      capturedAt: input.now,
    })),
  };
};

export const getWeekPerformance = defineAgentReadPortQuery({ portKey: WEEK_PERFORMANCE_PORT_KEY, handler: getWeekPerformanceHandler });

type PulseSummary = Awaited<ReturnType<typeof getStorePulseSummaryForWindow>>;

function pulseTopItems(summary: PulseSummary, currency: string) {
  return summary.operatorSnapshot.topItems.slice(0, 10).map((item) => ({
    displayName: item.name,
    skuCode: item.productSku ?? undefined,
    quantity: units(item.quantity),
    value: money(item.totalSales, currency),
  }));
}

/** The domain read itself, exported so the direct-harness smoke can bind the exact same code. */
export const getStorePulseHandler: AgentReadPortHandler = async (ctx, input): Promise<AgentReadPortHandlerOutput> => {
  const storeId = input.scope.storeId as Id<"store"> | undefined;
  if (!storeId) {
    return { kind: "unavailable", reason: "store_scope_missing", retryable: false, sourceKey: "sales" };
  }
  const operatingDate = String(input.args.operatingDate);
  const requestedWindow = input.args.window === "week" ? "week" : "today";
  const window = await resolveAgentOperatingWindowWithCtx(ctx, { operatingDate, storeId });
  if (!window) {
    return { kind: "unavailable", reason: "operating_date_unresolvable", retryable: false, sourceKey: "sales" };
  }

  const store = (await ctx.db.get("store", storeId)) as Doc<"store"> | null;
  const currency = store?.currency ?? "GHS";
  const summary = await getStorePulseSummaryForWindow(ctx as QueryCtx, {
    currentDayEnd: window.endAt - 1,
    currentDayStart: window.startAt,
    currentOperatingDate: operatingDate,
    pulseWindow: requestedWindow === "week" ? "this_week" : "today",
    storeId,
  });
  const snapshot = summary.operatorSnapshot;
  const busiest = snapshot.busiestHour;
  const hasComparison = snapshot.comparison.yesterdayTransactions > 0;
  const warnings: AgentWarning[] = window.derivation === "utc_fallback" ? [fallbackWarning("sales")] : [];

  return {
    kind: "data",
    data: {
      operatingDate,
      operatingWindow: { derivation: window.derivation, timezone: window.timezone },
      window: requestedWindow,
      transactionCount: summary.totalTransactions,
      itemsSold: summary.totalItemsSold,
      historyDayCount: snapshot.historyDays,
      isLimitedHistory: snapshot.isLimited,
      revenue: known(money(summary.totalSales, currency)),
      averageTransaction: known(money(summary.averageTransaction, currency)),
      revenueChangeBasisPoints: snapshot.comparison.salesDeltaPercent * 100,
      busiestHour: busiest
        ? {
            hour: busiest.hour,
            transactionCount: busiest.transactionCount,
            revenue: money(busiest.totalSales, currency),
          }
        : undefined,
      topItems: pulseTopItems(summary, currency),
    },
    observedAt: input.now,
    // Explicitly a derivation over sources captured at different times.
    freshness: { class: "derived", authority: "derived" },
    sources: [
      { sourceKey: "sales", status: "complete", capturedAt: input.now },
      {
        sourceKey: "comparison",
        status: hasComparison ? "complete" : "unavailable",
        reason: hasComparison ? undefined : "no_comparison_window_activity",
        capturedAt: input.now,
      },
      {
        sourceKey: "items",
        status: snapshot.topItems.length > 0 ? "complete" : "unavailable",
        reason: snapshot.topItems.length > 0 ? undefined : "no_items_sold_in_window",
        capturedAt: input.now,
      },
    ],
    warnings,
    sourceRefs: [
      {
        ref: mintAgentSourceRef("summary_source", storeId, `pulse:${requestedWindow}:${operatingDate}`),
        kind: "summary_source",
        label: `Store pulse ${requestedWindow}`,
        capturedAt: input.now,
      },
    ],
  };
};

export const getStorePulse = defineAgentReadPortQuery({ portKey: STORE_PULSE_PORT_KEY, handler: getStorePulseHandler });
