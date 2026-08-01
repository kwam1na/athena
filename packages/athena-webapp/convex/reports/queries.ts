import { v } from "convex/values";
import { query } from "../_generated/server";
import type { QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { requireReportsStoreAccess } from "./access";
import {
  dayPeriodKey,
  isReportingTodayInProgress,
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
} from "../../shared/reportsContract";
import { emptySnapshot, snapshotForDays } from "./overview";
import { periodDateRange } from "./rollups";

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
    // by_storeId. During the unitsSold rollout, legacy overview documents are
    // enriched from at most 30 reportDay rows until the next sweep refreshes
    // the singleton.
    const doc = await ctx.db
      .query("reportOverview")
      .withIndex("by_storeId", (q) => q.eq("storeId", args.storeId))
      .first();
    if (!doc) return null;

    let dailyTrend = doc.dailyTrend;
    let trailing3Months = doc.trailing3Months;
    const needsTrendUnits = dailyTrend.some(
      (point) => point.unitsSold === undefined,
    );
    const anchorDate = dailyTrend.at(-1)?.operatingDate;

    if ((needsTrendUnits || !trailing3Months) && anchorDate) {
      const startDate = trailing3Months
        ? dailyTrend.at(0)?.operatingDate
        : trailingThreeMonthsStart(anchorDate);

      if (startDate) {
        const days = await ctx.db
          .query("reportDay")
          .withIndex("by_storeId_operatingDate", (q) =>
            q
              .eq("storeId", args.storeId)
              .gte("operatingDate", startDate)
              .lte("operatingDate", anchorDate),
          )
          .take(92);
        if (needsTrendUnits) {
          const unitsByDate = new Map(
            days.map((day) => [day.operatingDate, day.unitsSold]),
          );
          dailyTrend = dailyTrend.map((point) => ({
            ...point,
            unitsSold: point.unitsSold ?? unitsByDate.get(point.operatingDate),
          }));
        }
        trailing3Months ??= snapshotForDays(days);
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
      trailing3Months: trailing3Months ?? emptySnapshot(),
      comparisons: doc.comparisons,
      dailyTrend,
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
            identity?.sku ??
            identity?.displayName ??
            String(row.productSkuId),
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

function transactionCountFromCloseSummary(
  summary: Record<string, unknown>,
): number {
  const transactionCount = summary.transactionCount;
  return typeof transactionCount === "number" &&
    Number.isFinite(transactionCount) &&
    transactionCount >= 0
    ? Math.trunc(transactionCount)
    : 0;
}

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
    updatedAt: number | null;
    isTodayInProgress: boolean;
  }> => {
    await requireReportsStoreAccess(ctx, args.storeId);
    const periodRange = periodDateRange(args.periodKey as ReportPeriodKey);

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
    const [rows, overview, periodDays] = await Promise.all([
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
    ]);
    const periodCloses = await Promise.all(
      periodDays.map((day) =>
        day.closeId
          ? ctx.db.get("dailyClose", day.closeId)
          : Promise.resolve(null),
      ),
    );
    const periodTransactionCounts = await Promise.all(
      periodDays.map((day, index) => {
        const close = periodCloses[index];
        return close
          ? transactionCountFromCloseSummary(close.summary)
          : livePosTransactionCount(ctx, day);
      }),
    );
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
  const netPriceMinor = sku.netPrice ?? sku.price;
  const unitCostMinor = sku.unitCost;

  return {
    displayName:
      productName ??
      cleanMetadataValue(sku.productName) ??
      code ??
      String(productSkuId),
    netPriceMinor,
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
