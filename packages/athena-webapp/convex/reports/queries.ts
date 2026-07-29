import { v } from "convex/values";
import { query } from "../_generated/server";
import type { QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { requireReportsStoreAccess } from "./access";
import { dayPeriodKey } from "../../shared/reportsContract";
import { REPORT_SKU_PAGE_SIZE } from "../../shared/reportsContract";
import type {
  ReportDayRow,
  ReportOverviewData,
  ReportRangeSummary,
  ReportSkuIdentity,
  ReportSkuPeriodRow,
  ReportSkuSortBy,
} from "../../shared/reportsContract";
import { emptySnapshot } from "./overview";

/**
 * Slice D — read queries for the rebuilt reports layer.
 *
 * Names, args, and return shapes are contract-frozen (slice E builds
 * against exactly these). Every handler starts with the access check and
 * carries a comment stating its worst-case document reads.
 */

const RANGE_MAX_SPAN_DAYS = 92;

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

    // Read budget: 1 doc — the reportOverview singleton via by_storeId.
    const doc = await ctx.db
      .query("reportOverview")
      .withIndex("by_storeId", (q) => q.eq("storeId", args.storeId))
      .first();
    if (!doc) return null;

    return {
      updatedAt: doc.updatedAt,
      currency: doc.currency,
      today: doc.today,
      yesterday: doc.yesterday ?? emptySnapshot(),
      weekToDate: doc.weekToDate,
      priorWeek: doc.priorWeek,
      trailing30: doc.trailing30,
      comparisons: doc.comparisons,
      dailyTrend: doc.dailyTrend,
      trust: doc.trust,
    };
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
    updatedAt: number | null;
  }> => {
    await requireReportsStoreAccess(ctx, args.storeId);

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

    // One singleton read carries the same sweep timestamp shown on Overview,
    // so Items can disclose rollup freshness without a second client query.
    const [rows, overview] = await Promise.all([
      withSkuIdentity(ctx, page.map(toSkuPeriodRow)),
      ctx.db
        .query("reportOverview")
        .withIndex("by_storeId", (q) => q.eq("storeId", args.storeId))
        .first(),
    ]);

    return {
      rows,
      continueCursor,
      updatedAt: overview?.updatedAt ?? null,
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

  return {
    displayName:
      productName ??
      cleanMetadataValue(sku.productName) ??
      code ??
      String(productSkuId),
    ...(code ? { sku: code } : {}),
    ...(size ? { size } : {}),
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
    identity?: ReportSkuIdentity;
  } | null> => {
    await requireReportsStoreAccess(ctx, args.storeId);
    requireValidDateRange(args.startDate, args.endDate);

    // Read budget: up to RANGE_MAX_SPAN_DAYS (92) reportSkuDay docs — a
    // single range read on by_storeId_productSkuId_operatingDate.
    const rows = await ctx.db
      .query("reportSkuDay")
      .withIndex("by_storeId_productSkuId_operatingDate", (q) =>
        q
          .eq("storeId", args.storeId)
          .eq("productSkuId", args.productSkuId)
          .gte("operatingDate", args.startDate)
          .lte("operatingDate", args.endDate),
      )
      .take(RANGE_MAX_SPAN_DAYS);

    // Resolved before the empty-range return so the page can still name the
    // SKU when it simply had no activity in the selected window.
    const identity = await resolveSkuIdentity(ctx, args.productSkuId);

    if (rows.length === 0) {
      return { days: [], totals: null, identity };
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

    const anyUncosted = rows.some((row) => row.grossProfitMinor === null);
    const totals: ReportSkuPeriodRow = {
      productSkuId: args.productSkuId,
      periodKey: `range:${args.startDate}:${args.endDate}`,
      unitsSold: sum(rows, "unitsSold"),
      unitsReturned: sum(rows, "unitsReturned"),
      grossSalesMinor: sum(rows, "grossSalesMinor"),
      netSalesMinor: sum(rows, "netSalesMinor"),
      refundsMinor: sum(rows, "refundsMinor"),
      uncostedRevenueMinor: sum(rows, "uncostedRevenueMinor"),
      grossProfitMinor: anyUncosted ? null : sum(rows, "grossProfitMinor"),
    };

    return { days, totals, identity };
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
