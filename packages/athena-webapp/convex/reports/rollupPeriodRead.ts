import type { QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import {
  isReportingTodayInProgress,
  periodKeysForOperatingDate,
  type ReportPeriodSkusResult,
} from "../../shared/reportsContract";
import {
  REPORT_SKU_PAGE_SIZE,
  type ReportPeriodKey,
  type ReportPeriodSkusUnavailable,
  type ReportSkuPeriodRow,
  type ReportSkuSortBy,
} from "../../shared/reportsContract";
import { readPipelineControl } from "./pipelineControl";
import { isPipelineRecoveryPending } from "./pipelineFreshness";
import { periodDateRange } from "./rollups";

type Page = {
  status: "ready";
  epoch: string;
  publicationRevision: number;
  rows: ReportSkuPeriodRow[];
  continueCursor: string | null;
  updatedAt: number | null;
};
type Args = {
  storeId: Id<"store">;
  periodKey: string;
  sortBy: ReportSkuSortBy;
  cursor?: string;
};
type Cursor = {
  v: 1;
  storeId: string;
  epoch: string;
  periodKey: string;
  sortBy: ReportSkuSortBy;
  revision: number;
  cursor: string;
};
const unavailable = (
  status: ReportPeriodSkusUnavailable["status"],
): ReportPeriodSkusUnavailable => ({
  status,
  reason:
    status === "blocked"
      ? "repair_required"
      : status === "restart"
        ? "period_changed"
        : "projection_pending",
  rows: [],
  continueCursor: null,
});

/** Null means this store still uses the unchanged legacy epoch. */
export async function readEpochPeriodPageWithCtx(
  ctx: QueryCtx,
  args: Args,
): Promise<Page | ReportPeriodSkusUnavailable | null> {
  const control = await readPipelineControl(ctx, args.storeId);
  if (isPipelineRecoveryPending(control)) return unavailable("pending");
  const epoch = control?.activeRollupEpoch;
  if (!epoch) {
    // An activated epoch may have been rolled back while the page was open.
    // Hand its cursor back as a restart, never feed it into the legacy pager.
    if (args.cursor) {
      let decoded;
      try {
        decoded = JSON.parse(atob(args.cursor));
      } catch {
        return null;
      }
      if (decoded?.v === 1 && typeof decoded.epoch === "string") {
        if (
          decoded.storeId !== args.storeId ||
          decoded.periodKey !== args.periodKey ||
          decoded.sortBy !== args.sortBy
        )
          throw new Error(
            "Pagination cursor does not match the current query context.",
          );
        return unavailable("restart");
      }
    }
    return null;
  }
  if (control.mode !== "active") return unavailable("pending");
  const epochDoc = await ctx.db
    .query("reportRollupEpoch")
    .withIndex("by_storeId_epoch", (q) =>
      q.eq("storeId", args.storeId).eq("epoch", epoch),
    )
    .unique();
  if (!epochDoc) return unavailable("blocked");
  if (!epochDoc.backfillComplete) return unavailable("pending");
  const ready = await ctx.db
    .query("reportPeriodReadiness")
    .withIndex("by_storeId_epoch_periodKey", (q) =>
      q
        .eq("storeId", args.storeId)
        .eq("epoch", epoch)
        .eq("periodKey", args.periodKey),
    )
    .unique();
  if (ready?.status === "blocked") return unavailable("blocked");
  if (ready && (ready.status !== "ready" || ready.pendingDays !== 0))
    return unavailable("pending");
  const range = periodDateRange(args.periodKey as ReportPeriodKey);
  if (!range) return unavailable("blocked");
  // Live ingestion mutates reportDay/SKU-day before a canonical fold. That
  // producer marks the day atomically, so never mix fresh day totals with an
  // older ready SKU epoch while the fold obligation is still pending.
  const dirty = await ctx.db
    .query("reportDirtyDay")
    .withIndex("by_storeId_operatingDate", (q) =>
      q
        .eq("storeId", args.storeId)
        .gte("operatingDate", range.startDate)
        .lte("operatingDate", range.endDate),
    )
    .first();
  if (dirty) return unavailable("pending");
  const revision = ready?.publicationRevision ?? 0;
  let cursor: string | null = null;
  if (args.cursor) {
    let decoded: Partial<Cursor>;
    try {
      decoded = JSON.parse(atob(args.cursor));
    } catch {
      throw new Error("Invalid pagination cursor.");
    }
    if (
      !decoded ||
      typeof decoded !== "object" ||
      decoded.storeId !== args.storeId ||
      decoded.periodKey !== args.periodKey ||
      decoded.sortBy !== args.sortBy
    )
      throw new Error(
        "Pagination cursor does not match the current query context.",
      );
    if (
      decoded.v !== 1 ||
      decoded.epoch !== epoch ||
      decoded.revision !== revision
    )
      return unavailable("restart");
    if (typeof decoded.cursor !== "string")
      throw new Error("Invalid pagination cursor.");
    cursor = decoded.cursor;
  }
  const index =
    args.sortBy === "revenue"
      ? "by_storeId_epoch_periodKey_revenueSortKey_productSkuId"
      : "by_storeId_epoch_periodKey_unitsSortKey_productSkuId";
  const page = await ctx.db
    .query("reportEpochSkuRollup")
    .withIndex(index, (q) =>
      q
        .eq("storeId", args.storeId)
        .eq("epoch", epoch)
        .eq("periodKey", args.periodKey),
    )
    .paginate({ cursor, numItems: REPORT_SKU_PAGE_SIZE });
  return {
    status: "ready",
    epoch,
    publicationRevision: revision,
    updatedAt: ready?.updatedAt ?? null,
    rows: page.page.map((row) => ({
      productSkuId: row.productSkuId,
      periodKey: row.periodKey as ReportPeriodKey,
      unitsSold: row.unitsSold,
      unitsReturned: row.unitsReturned,
      grossSalesMinor: row.grossSalesMinor,
      netSalesMinor: row.netSalesMinor,
      refundsMinor: row.refundsMinor,
      uncostedRevenueMinor: row.uncostedRevenueMinor,
      grossProfitMinor: row.grossProfitMinor,
    })),
    continueCursor: page.isDone
      ? null
      : btoa(
          JSON.stringify({
            v: 1,
            storeId: args.storeId,
            epoch,
            periodKey: args.periodKey,
            sortBy: args.sortBy,
            revision,
            cursor: page.continueCursor,
          } satisfies Cursor),
        ),
  };
}

/** Financial totals use only canonical day counts, never legacy source hydration. */
export async function readEpochPeriodResultWithCtx(
  ctx: QueryCtx,
  args: Args,
  priorRange: { startDate: string; endDate: string } | null,
): Promise<ReportPeriodSkusResult | null> {
  const page = await readEpochPeriodPageWithCtx(ctx, args);
  if (!page || page.status !== "ready") return page;
  const range = periodDateRange(args.periodKey as ReportPeriodKey);
  if (!range) return unavailable("blocked");
  const readDays = (dates: { startDate: string; endDate: string }) =>
    ctx.db
      .query("reportDay")
      .withIndex("by_storeId_operatingDate", (q) =>
        q
          .eq("storeId", args.storeId)
          .gte("operatingDate", dates.startDate)
          .lte("operatingDate", dates.endDate),
      )
      .take(32);
  const periodDays = await readDays(range);
  if (
    periodDays.length > 31 ||
    periodDays.some((day) => day.transactionCount === undefined)
  )
    return unavailable("blocked");
  const totals = (days: Doc<"reportDay">[]) =>
    days.reduce(
      (sum, day) => ({
        netSalesMinor: sum.netSalesMinor + day.netSalesMinor,
        unitsSold: sum.unitsSold + day.unitsSold,
        transactions: sum.transactions + (day.transactionCount ?? 0),
      }),
      { netSalesMinor: 0, unitsSold: 0, transactions: 0 },
    );
  let priorPeriodTotals;
  if (priorRange) {
    const priorKey = periodKeysForOperatingDate(priorRange.startDate).find(
      (key) => key.startsWith(args.periodKey.slice(0, 2)),
    );
    const priorGate = priorKey
      ? await ctx.db
          .query("reportPeriodReadiness")
          .withIndex("by_storeId_epoch_periodKey", (q) =>
            q
              .eq("storeId", args.storeId)
              .eq("epoch", page.epoch)
              .eq("periodKey", priorKey),
          )
          .unique()
      : null;
    const priorDirty = await ctx.db
      .query("reportDirtyDay")
      .withIndex("by_storeId_operatingDate", (q) =>
        q
          .eq("storeId", args.storeId)
          .gte("operatingDate", priorRange.startDate)
          .lte("operatingDate", priorRange.endDate),
      )
      .first();
    if (
      !priorDirty &&
      (!priorGate ||
        (priorGate.status === "ready" && priorGate.pendingDays === 0))
    ) {
      const priorDays = await readDays(priorRange);
      if (
        priorDays.length <= 31 &&
        priorDays.every((day) => day.transactionCount !== undefined)
      )
        priorPeriodTotals = totals(priorDays);
    }
  }
  const current = totals(periodDays);
  return {
    ...page,
    totalNetSalesMinor: current.netSalesMinor,
    totalUnitsSold: current.unitsSold,
    totalTransactions: current.transactions,
    ...(priorPeriodTotals ? { priorPeriodTotals } : {}),
    isTodayInProgress:
      range.startDate === range.endDate &&
      periodDays.some((day) => isReportingTodayInProgress(day.status)),
  };
}
