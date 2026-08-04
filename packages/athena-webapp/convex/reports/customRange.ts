import { v } from "convex/values";
import { mutation } from "../_generated/server";
import type { MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import {
  REPORTS_FOLD_VERSION,
  REPORT_RANGE_MAX_DAYS,
  REPORT_RANGE_TOP_SKU_LIMIT,
  REPORT_RANGE_TTL_MS,
  REPORT_DAY_METRIC_KEYS,
  REPORT_SKU_DAY_METRIC_KEYS,
  type ReportDayMetrics,
  type ReportSkuDayMetrics,
} from "../../shared/reportsContract";
import { requireReportsStoreAccess } from "./access";
import { stableStringHash } from "./fingerprint";

/**
 * Slice H — custom date-range reports.
 *
 * `requestRange` is a thin, access-gated mutation: it validates the request,
 * computes a deterministic `requestKey`, and upserts a `reportRangeResult`
 * row in "pending" status. The actual aggregation happens in `computeRange`,
 * invoked by slice C's sweeper (never inline in the mutation) so a request
 * for a wide range never blows the mutation's read/time budget.
 *
 * `computeRange` reads ONLY `reportDay` and `reportSkuDay` — never
 * `reportFact`. Those two tables are themselves bounded-size projections
 * (one row per operating day / per (day, sku) with activity), so a range of
 * up to `REPORT_RANGE_MAX_DAYS` days is always a bounded read.
 */

const OPERATING_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isValidOperatingDate(value: string): boolean {
  if (!OPERATING_DATE_PATTERN.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const asDate = new Date(Date.UTC(year, month - 1, day));
  return (
    asDate.getUTCFullYear() === year &&
    asDate.getUTCMonth() === month - 1 &&
    asDate.getUTCDate() === day
  );
}

function utcMillisForLabel(label: string): number {
  const [year, month, day] = label.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

/** Inclusive day count between two well-formed "YYYY-MM-DD" labels. */
function inclusiveDaySpan(startDate: string, endDate: string): number {
  const start = utcMillisForLabel(startDate);
  const end = utcMillisForLabel(endDate);
  return Math.round((end - start) / 86_400_000) + 1;
}

function validateRangeArgs(args: {
  startDate: string;
  endDate: string;
}): void {
  if (!isValidOperatingDate(args.startDate)) {
    throw new Error(`Invalid startDate: "${args.startDate}".`);
  }
  if (!isValidOperatingDate(args.endDate)) {
    throw new Error(`Invalid endDate: "${args.endDate}".`);
  }
  if (args.startDate > args.endDate) {
    throw new Error("startDate must be on or before endDate.");
  }
  const span = inclusiveDaySpan(args.startDate, args.endDate);
  if (span > REPORT_RANGE_MAX_DAYS) {
    throw new Error(
      `Range spans ${span} days; the maximum is ${REPORT_RANGE_MAX_DAYS} days.`,
    );
  }
}

/**
 * Deterministic requestKey: a stable hash of the request's identity fields.
 * Same (store, range, fold version) always yields the same key — no clock
 * input — so re-requesting an identical range is idempotent by construction.
 */
export function computeRequestKey(args: {
  storeId: Id<"store">;
  startDate: string;
  endDate: string;
}): string {
  const canonical = JSON.stringify([
    args.storeId,
    args.startDate,
    args.endDate,
    REPORTS_FOLD_VERSION,
  ]);
  return `range:${stableStringHash(canonical)}`;
}

type RequestRangeArgs = {
  storeId: Id<"store">;
  startDate: string;
  endDate: string;
};

/**
 * The access-checked core: validation, deterministic requestKey, and
 * dedupe/reinsert against `reportRangeResult`. Split out from the `mutation`
 * wrapper so it is directly testable against a real `MutationCtx` (via
 * convex-test's `t.run`) without needing to stand up full Athena-user auth
 * in every test — the access gate itself is covered separately by asserting
 * the wrapped mutation rejects an unauthenticated caller.
 */
export async function requestRangeCore(
  ctx: MutationCtx,
  args: RequestRangeArgs,
): Promise<{ requestKey: string }> {
  validateRangeArgs(args);

  const requestKey = computeRequestKey(args);
  const now = Date.now();

  const existing = await ctx.db
    .query("reportRangeResult")
    .withIndex("by_storeId_requestKey", (q) =>
      q.eq("storeId", args.storeId).eq("requestKey", requestKey),
    )
    .unique();

  if (existing) {
    if (existing.expiresAt > now) {
      return { requestKey };
    }
    await ctx.db.delete("reportRangeResult", existing._id);
  }

  await ctx.db.insert("reportRangeResult", {
    storeId: args.storeId,
    requestKey,
    startDate: args.startDate,
    endDate: args.endDate,
    status: "pending",
    requestedAt: now,
    expiresAt: now + REPORT_RANGE_TTL_MS,
    foldVersion: REPORTS_FOLD_VERSION,
  });

  return { requestKey };
}

export const requestRange = mutation({
  args: {
    storeId: v.id("store"),
    startDate: v.string(),
    endDate: v.string(),
  },
  handler: async (ctx, args): Promise<{ requestKey: string }> => {
    await requireReportsStoreAccess(ctx, args.storeId);
    return requestRangeCore(ctx, args);
  },
});

const ZERO_DAY_METRICS: ReportDayMetrics = {
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

const ZERO_SKU_DAY_METRICS: ReportSkuDayMetrics = {
  unitsSold: 0,
  unitsReturned: 0,
  grossSalesMinor: 0,
  netSalesMinor: 0,
  refundsMinor: 0,
  uncostedRevenueMinor: 0,
  grossProfitMinor: 0,
};

type RangeTotals = ReportDayMetrics & {
  dayCount: number;
  unsettledDayCount: number;
};

function sumDays(days: Doc<"reportDay">[]): RangeTotals {
  let anyNullProfit = false;
  const totals: ReportDayMetrics = { ...ZERO_DAY_METRICS };

  for (const day of days) {
    for (const key of REPORT_DAY_METRIC_KEYS) {
      if (key === "grossProfitMinor") continue;
      (totals[key] as number) += day[key] as number;
    }
    if (day.grossProfitMinor === null) {
      anyNullProfit = true;
    } else {
      totals.grossProfitMinor =
        (totals.grossProfitMinor ?? 0) + day.grossProfitMinor;
    }
  }

  totals.grossProfitMinor = anyNullProfit ? null : totals.grossProfitMinor;

  const unsettledDayCount = days.filter(
    (day) => day.status === "open" || day.status === "provisional",
  ).length;

  return { ...totals, dayCount: days.length, unsettledDayCount };
}

type SkuAgg = ReportSkuDayMetrics & { productSkuId: Id<"productSku"> };

function aggregateSkuDays(skuDays: Doc<"reportSkuDay">[]): SkuAgg[] {
  const bySku = new Map<Id<"productSku">, SkuAgg>();

  for (const row of skuDays) {
    const existing = bySku.get(row.productSkuId) ?? {
      productSkuId: row.productSkuId,
      ...ZERO_SKU_DAY_METRICS,
    };
    for (const key of REPORT_SKU_DAY_METRIC_KEYS) {
      if (key === "grossProfitMinor") continue;
      (existing[key] as number) += row[key] as number;
    }
    existing.grossProfitMinor =
      existing.grossProfitMinor === null || row.grossProfitMinor === null
        ? null
        : existing.grossProfitMinor + row.grossProfitMinor;
    bySku.set(row.productSkuId, existing);
  }

  return Array.from(bySku.values()).sort(
    (a, b) => b.netSalesMinor - a.netSalesMinor,
  );
}

/**
 * Ceiling on SKU-day rows a single custom range may aggregate. Sized well
 * above a realistic year for one store while still bounding the read.
 */
const MAX_RANGE_SKU_DAY_ROWS = 20_000;

/**
 * Invoked by slice C's sweeper for each pending `reportRangeResult` row.
 * Reads ONLY `reportDay` / `reportSkuDay` (bounded by the validated range,
 * ≤ `REPORT_RANGE_MAX_DAYS` days) — never `reportFact`. Always patches the
 * request to a terminal status; never throws into the caller.
 */
export async function computeRange(
  ctx: MutationCtx,
  request: Doc<"reportRangeResult">,
): Promise<void> {
  // Defense in depth: movement snapshots share the header table but are
  // computed exclusively by their fenced worker (reports/skuMovementRange.ts).
  // The sweeper already skips them; a movement row reaching this function
  // must be a no-op, never a summary overwrite of movement lifecycle state.
  if (request.kind === "sku_movement") return;
  try {
    // Bounded by the validated span, so this cannot outgrow the range check.
    const days = await ctx.db
      .query("reportDay")
      .withIndex("by_storeId_operatingDate", (q) =>
        q
          .eq("storeId", request.storeId)
          .gte("operatingDate", request.startDate)
          .lte("operatingDate", request.endDate),
      )
      .take(REPORT_RANGE_MAX_DAYS);

    // SKU-days grow with range length TIMES catalogue breadth, so unlike the
    // day read this one has no natural ceiling. It is capped, and hitting the
    // cap fails the range rather than returning quietly understated totals —
    // a wrong number here would be indistinguishable from a real one.
    const skuDays = await ctx.db
      .query("reportSkuDay")
      .withIndex("by_storeId_operatingDate_productSkuId", (q) =>
        q
          .eq("storeId", request.storeId)
          .gte("operatingDate", request.startDate)
          .lte("operatingDate", request.endDate),
      )
      .take(MAX_RANGE_SKU_DAY_ROWS + 1);

    if (skuDays.length > MAX_RANGE_SKU_DAY_ROWS) {
      await ctx.db.patch("reportRangeResult", request._id, {
        status: "failed",
        failureReason:
          "Range covers too much SKU activity to total accurately. Choose a shorter range.",
        computedAt: Date.now(),
      });
      return;
    }

    const totals = sumDays(days);
    const periodKey = `custom:${request.startDate}:${request.endDate}`;
    const topSkus = aggregateSkuDays(skuDays)
      .slice(0, REPORT_RANGE_TOP_SKU_LIMIT)
      .map((sku) => ({ ...sku, periodKey }));

    await ctx.db.patch("reportRangeResult", request._id, {
      status: "completed",
      totals,
      topSkus,
      computedAt: Date.now(),
      failureReason: undefined,
    });
  } catch (error) {
    await ctx.db.patch("reportRangeResult", request._id, {
      status: "failed",
      failureReason: error instanceof Error ? error.message : String(error),
      computedAt: Date.now(),
    });
  }
}
