import type { MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import {
  descendingSortKey,
  periodKeysForOperatingDate,
  type ReportPeriodKey,
  type ReportSkuDayMetrics,
} from "../../shared/reportsContract";

/**
 * Calendar-period per-SKU rollups (slice C).
 *
 * Rollups are re-aggregated from `reportSkuDay` docs — never from raw facts.
 * That keeps a single authority (the fold) for what a day means, and makes the
 * rollup write path idempotent: re-running it over unchanged sku-day docs
 * produces byte-identical rollup rows.
 *
 * Every read here is bounded. A period is at most one calendar month, and the
 * sku-day table is sparse (rows exist only for (sku, day) pairs with activity),
 * so a month's re-aggregation is an index range read capped by
 * `MAX_ROLLUP_SKU_DAY_ROWS`.
 */

/** Cap on sku-day docs read while re-aggregating one period. */
export const MAX_ROLLUP_SKU_DAY_ROWS = 4000;
/** Cap on existing rollup rows reconciled for one period. */
export const MAX_ROLLUP_ROWS_PER_PERIOD = 4000;

// ---------------------------------------------------------------------------
// Operating-date arithmetic over calendar labels
//
// Operating dates are calendar labels ("YYYY-MM-DD"), so UTC math over the
// label is correct by construction — no store timezone enters here (same
// reasoning as `weekPeriodKey` in the contract).
// ---------------------------------------------------------------------------

export function toUtcDate(operatingDate: string): Date {
  return new Date(`${operatingDate}T00:00:00.000Z`);
}

export function formatOperatingDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDaysToDate(operatingDate: string, days: number): string {
  const d = toUtcDate(operatingDate);
  d.setUTCDate(d.getUTCDate() + days);
  return formatOperatingDate(d);
}

/** Monday (ISO weekday 1) of the ISO week containing `operatingDate`. */
export function isoWeekStart(operatingDate: string): string {
  const d = toUtcDate(operatingDate);
  const isoDay = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
  return addDaysToDate(operatingDate, 1 - isoDay);
}

/**
 * Inclusive [start, end] operating-date range covered by a calendar period key
 * ("d:2026-07-28" | "w:2026-W31" | "m:2026-07"). Returns null for keys this
 * module does not own (rolling windows live on the overview doc).
 */
export function periodDateRange(
  periodKey: ReportPeriodKey,
): { startDate: string; endDate: string } | null {
  const body = periodKey.slice(2);

  if (periodKey.startsWith("d:")) {
    return { startDate: body, endDate: body };
  }

  if (periodKey.startsWith("m:")) {
    const [yearRaw, monthRaw] = body.split("-");
    const year = Number(yearRaw);
    const month = Number(monthRaw);
    if (!Number.isFinite(year) || !Number.isFinite(month)) return null;
    // Day 0 of the next month is the last day of this one.
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return {
      startDate: `${body}-01`,
      endDate: `${body}-${String(lastDay).padStart(2, "0")}`,
    };
  }

  if (periodKey.startsWith("w:")) {
    const [yearRaw, weekRaw] = body.split("-W");
    const year = Number(yearRaw);
    const week = Number(weekRaw);
    if (!Number.isFinite(year) || !Number.isFinite(week)) return null;
    // ISO-8601: January 4th always falls in week 1.
    const week1Monday = isoWeekStart(`${yearRaw}-01-04`);
    const startDate = addDaysToDate(week1Monday, (week - 1) * 7);
    return { startDate, endDate: addDaysToDate(startDate, 6) };
  }

  return null;
}

/** The calendar period keys a change to `operatingDate` invalidates. */
export function affectedPeriodKeys(
  operatingDates: readonly string[],
): ReportPeriodKey[] {
  const keys = new Set<ReportPeriodKey>();
  for (const date of operatingDates) {
    for (const key of periodKeysForOperatingDate(date)) keys.add(key);
  }
  return [...keys].sort();
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

export type RollupMeasures = ReportSkuDayMetrics;

function zeroMeasures(): RollupMeasures {
  return {
    unitsSold: 0,
    unitsReturned: 0,
    grossSalesMinor: 0,
    netSalesMinor: 0,
    refundsMinor: 0,
    uncostedRevenueMinor: 0,
    grossProfitMinor: 0,
  };
}

/**
 * Sum sku-day rows into per-SKU period measures.
 *
 * `grossProfitMinor` is null for the period when ANY contributing day lacks a
 * cost basis — a partial sum would read as a real margin. The uncovered
 * revenue stays visible in `uncostedRevenueMinor`.
 */
export function aggregateSkuDays(
  rows: readonly Pick<
    Doc<"reportSkuDay">,
    keyof ReportSkuDayMetrics | "productSkuId"
  >[],
): Map<string, RollupMeasures> {
  const bySku = new Map<string, RollupMeasures>();

  for (const row of rows) {
    const key = String(row.productSkuId);
    const acc = bySku.get(key) ?? zeroMeasures();

    acc.unitsSold += row.unitsSold;
    acc.unitsReturned += row.unitsReturned;
    acc.grossSalesMinor += row.grossSalesMinor;
    acc.netSalesMinor += row.netSalesMinor;
    acc.refundsMinor += row.refundsMinor;
    acc.uncostedRevenueMinor += row.uncostedRevenueMinor;
    acc.grossProfitMinor =
      acc.grossProfitMinor === null || row.grossProfitMinor === null
        ? null
        : acc.grossProfitMinor + row.grossProfitMinor;

    bySku.set(key, acc);
  }

  return bySku;
}

function measuresEqual(a: RollupMeasures, b: RollupMeasures): boolean {
  return (
    a.unitsSold === b.unitsSold &&
    a.unitsReturned === b.unitsReturned &&
    a.grossSalesMinor === b.grossSalesMinor &&
    a.netSalesMinor === b.netSalesMinor &&
    a.refundsMinor === b.refundsMinor &&
    a.uncostedRevenueMinor === b.uncostedRevenueMinor &&
    a.grossProfitMinor === b.grossProfitMinor
  );
}

// ---------------------------------------------------------------------------
// Upsert
// ---------------------------------------------------------------------------

/**
 * Re-aggregate one calendar period from `reportSkuDay` and replace its rollup
 * rows: patch changed rows, insert new SKUs, delete SKUs that no longer have
 * activity in the period. Unchanged rows are left untouched so the write does
 * not needlessly invalidate subscriptions.
 */
export async function rebuildPeriodRollup(
  ctx: MutationCtx,
  storeId: Id<"store">,
  periodKey: ReportPeriodKey,
): Promise<{ upserted: number; deleted: number }> {
  const range = periodDateRange(periodKey);
  if (!range) return { upserted: 0, deleted: 0 };

  const skuDays = await ctx.db
    .query("reportSkuDay")
    .withIndex("by_storeId_operatingDate_productSkuId", (q) =>
      q
        .eq("storeId", storeId)
        .gte("operatingDate", range.startDate)
        .lte("operatingDate", range.endDate),
    )
    .take(MAX_ROLLUP_SKU_DAY_ROWS);

  const desired = aggregateSkuDays(skuDays);

  const existing = await ctx.db
    .query("reportPeriodSkuRollup")
    .withIndex("by_storeId_periodKey_productSkuId", (q) =>
      q.eq("storeId", storeId).eq("periodKey", periodKey),
    )
    .take(MAX_ROLLUP_ROWS_PER_PERIOD);

  let upserted = 0;
  let deleted = 0;
  const seen = new Set<string>();

  for (const row of existing) {
    const key = String(row.productSkuId);
    const next = desired.get(key);

    if (!next) {
      await ctx.db.delete(row._id);
      deleted += 1;
      continue;
    }

    seen.add(key);
    if (
      measuresEqual(row, next) &&
      row.revenueSortKey === descendingSortKey(next.netSalesMinor) &&
      row.unitsSortKey === descendingSortKey(next.unitsSold)
    ) {
      continue;
    }

    await ctx.db.patch(row._id, {
      ...next,
      revenueSortKey: descendingSortKey(next.netSalesMinor),
      unitsSortKey: descendingSortKey(next.unitsSold),
    });
    upserted += 1;
  }

  for (const [skuId, measures] of desired) {
    if (seen.has(skuId)) continue;
    await ctx.db.insert("reportPeriodSkuRollup", {
      storeId,
      periodKey,
      productSkuId: skuId as Id<"productSku">,
      ...measures,
      revenueSortKey: descendingSortKey(measures.netSalesMinor),
      unitsSortKey: descendingSortKey(measures.unitsSold),
    });
    upserted += 1;
  }

  return { upserted, deleted };
}

/** Rebuild every calendar period touched by the given operating dates. */
export async function rebuildRollupsForDates(
  ctx: MutationCtx,
  storeId: Id<"store">,
  operatingDates: readonly string[],
): Promise<{ periods: number; upserted: number; deleted: number }> {
  const keys = affectedPeriodKeys(operatingDates);
  let upserted = 0;
  let deleted = 0;

  for (const key of keys) {
    const result = await rebuildPeriodRollup(ctx, storeId, key);
    upserted += result.upserted;
    deleted += result.deleted;
  }

  return { periods: keys.length, upserted, deleted };
}
