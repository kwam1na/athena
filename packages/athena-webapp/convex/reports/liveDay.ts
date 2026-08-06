import { v } from "convex/values";

import { query } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import type {
  ReportDayMetrics,
  ReportLiveOperatingDay,
  ReportLiveSkuIdentity,
  ReportLiveSkuStockRow,
  ReportSkuDayMetrics,
} from "../../shared/reportsContract";
import { requireReportsStoreAccess } from "./access";

/**
 * The single open operating day, read straight from the rows a sale writes.
 *
 * ## Why this exists rather than `getOverview`
 *
 * `reportOverview` and `reportPeriodSkuRollup` are written by the sweeper, on a
 * five-minute interval. `reportDay` and `reportSkuDay` are patched by
 * `recordFacts` INSIDE the sale's own transaction (see the "open day is a
 * preview" invariant in `reports/ingest.ts`). So for a caller that needs the
 * day to move the instant a sale completes — the shared demo, where a visitor
 * rings a sale and looks straight at Reports — these two tables are the only
 * honest source. The numbers here are provisional by design; the close-time
 * fold replaces every one of them.
 *
 * ## Read budget
 *
 * One `reportDay` document, up to `LIVE_DAY_SKU_ROW_LIMIT` `reportSkuDay`
 * documents, and one `productSku` per SKU row for its business code. Bounded
 * and flat: this is a single day, never a range.
 */

/**
 * SKU rows returned for one day. A day's mix is one row per SKU sold, so this
 * is a per-day catalogue breadth ceiling rather than a page size — well above
 * anything a single trading day produces, and a hard stop on the read.
 */
export const LIVE_DAY_SKU_ROW_LIMIT = 200;

/**
 * SKUs read for the stock lane. The shared demo's catalogue is eight items;
 * the ceiling is a hard stop on the read, not a page size.
 */
export const LIVE_STOCK_SKU_LIMIT = 100;

const OPERATING_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const dayMetricsValidator = v.object({
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
});

const skuMetricsValidator = v.object({
  unitsSold: v.number(),
  unitsReturned: v.number(),
  grossSalesMinor: v.number(),
  netSalesMinor: v.number(),
  refundsMinor: v.number(),
  uncostedRevenueMinor: v.number(),
  grossProfitMinor: v.union(v.number(), v.null()),
});

// The result shape lives in `shared/reportsContract.ts` (ReportLiveOperatingDay):
// its consumer is client code, which may not import this server module.
export type {
  ReportLiveOperatingDay,
  ReportLiveSkuStockRow,
} from "../../shared/reportsContract";

const skuIdentityValidator = v.object({
  displayName: v.string(),
  netPriceMinor: v.number(),
  productId: v.string(),
  quantityAvailable: v.number(),
  sku: v.union(v.string(), v.null()),
  unitCostMinor: v.union(v.number(), v.null()),
});

/**
 * Catalogue identity from the SKU document both lanes already load.
 *
 * `productName` is denormalised onto `productSku`, so a name costs no product
 * read. `netPrice` falls back to `price`: the two agree except where a SKU
 * carries a distinct net, and the register's quick add writes both.
 */
function toSkuIdentity(sku: Doc<"productSku">): ReportLiveSkuIdentity {
  const code = sku.sku?.trim() || null;
  return {
    displayName: sku.productName?.trim() || code || "",
    netPriceMinor: sku.netPrice ?? sku.price,
    productId: String(sku.productId),
    quantityAvailable: sku.quantityAvailable,
    sku: code,
    // Absent, never zero: a SKU with no cost basis is uncosted revenue, and
    // reporting a zero cost would state a full margin the store never earned.
    unitCostMinor: sku.unitCost ?? null,
  };
}

function toDayMetrics(row: Doc<"reportDay">): ReportDayMetrics {
  return {
    grossSalesMinor: row.grossSalesMinor,
    netSalesMinor: row.netSalesMinor,
    refundsMinor: row.refundsMinor,
    unitsSold: row.unitsSold,
    unitsReturned: row.unitsReturned,
    uncostedRevenueMinor: row.uncostedRevenueMinor,
    grossProfitMinor: row.grossProfitMinor,
    paymentsCollectedMinor: row.paymentsCollectedMinor,
    paymentsRefundedMinor: row.paymentsRefundedMinor,
    paymentAllocatedMinor: row.paymentAllocatedMinor,
  };
}

function toSkuMetrics(row: Doc<"reportSkuDay">): ReportSkuDayMetrics {
  return {
    unitsSold: row.unitsSold,
    unitsReturned: row.unitsReturned,
    grossSalesMinor: row.grossSalesMinor,
    netSalesMinor: row.netSalesMinor,
    refundsMinor: row.refundsMinor,
    uncostedRevenueMinor: row.uncostedRevenueMinor,
    grossProfitMinor: row.grossProfitMinor,
  };
}

export const getLiveOperatingDay = query({
  args: { operatingDate: v.string(), storeId: v.id("store") },
  returns: v.object({
    day: v.union(
      v.null(),
      v.object({
        currency: v.string(),
        factCount: v.number(),
        lastFactRecordedAt: v.number(),
        metrics: dayMetricsValidator,
        status: v.union(
          v.literal("open"),
          v.literal("provisional"),
          v.literal("reconciled"),
          v.literal("amended"),
        ),
        transactionCount: v.optional(v.number()),
      }),
    ),
    operatingDate: v.string(),
    skus: v.array(
      v.object({
        identity: v.union(v.null(), skuIdentityValidator),
        metrics: skuMetricsValidator,
        productSkuId: v.string(),
        sku: v.union(v.string(), v.null()),
      }),
    ),
  }),
  handler: async (ctx, args): Promise<ReportLiveOperatingDay> => {
    await requireReportsStoreAccess(ctx, args.storeId);

    if (!OPERATING_DATE_PATTERN.test(args.operatingDate)) {
      throw new Error("Invalid operating date.");
    }

    const [day, skuRows] = await Promise.all([
      ctx.db
        .query("reportDay")
        .withIndex("by_storeId_operatingDate", (q) =>
          q.eq("storeId", args.storeId).eq("operatingDate", args.operatingDate),
        )
        .first(),
      ctx.db
        .query("reportSkuDay")
        .withIndex("by_storeId_operatingDate_productSkuId", (q) =>
          q.eq("storeId", args.storeId).eq("operatingDate", args.operatingDate),
        )
        .take(LIVE_DAY_SKU_ROW_LIMIT),
    ]);

    const skus = await Promise.all(
      skuRows.map(async (row) => {
        // A reporting row outlives its subject; a missing catalogue document
        // is reported as an unresolvable code, never as a dropped row.
        const sku = await ctx.db.get("productSku", row.productSkuId);
        const resolved = sku?.storeId === args.storeId ? sku : null;
        return {
          // Carried inline because the row is the only place a client can
          // learn the name of a SKU that exists nowhere but this store's own
          // catalogue — the register's quick add being exactly that case.
          identity: resolved ? toSkuIdentity(resolved) : null,
          metrics: toSkuMetrics(row),
          productSkuId: String(row.productSkuId),
          sku: resolved?.sku ?? null,
        };
      }),
    );

    return {
      day: day
        ? {
            currency: day.currency,
            factCount: day.factCount,
            lastFactRecordedAt: day.lastFactRecordedAt,
            metrics: toDayMetrics(day),
            status: day.status,
            // Carried even while the day is OPEN: ingest maintains it per
            // sale, so a caller that reads the day live can state a basket
            // size without waiting for the close.
            ...(day.transactionCount === undefined
              ? {}
              : { transactionCount: day.transactionCount }),
          }
        : null,
      operatingDate: args.operatingDate,
      skus,
    };
  },
});

/**
 * Current sellable stock for a store's SKUs, keyed by business code.
 *
 * Stock is not day-scoped, so it does not belong on `getLiveOperatingDay` —
 * it is one current value per SKU, unaffected by which operating date is on
 * screen. It exists as its own read for the shared demo: that workspace
 * resolves SKU identity from a client fixture, whose stock figure is a story
 * constant that never moves, while the demo's REAL rows are decremented by a
 * visitor's sale like any other store's.
 *
 * It carries identity as well as stock, and is keyed by id as well as code,
 * because the story fixture cannot name every SKU the store has: one created
 * at the register by POS quick add exists only here. The code is still
 * reported — that is what matches a row to its story — but it is no longer the
 * key, so a SKU that has none is disclosed rather than dropped.
 *
 * Read budget: up to `LIVE_STOCK_SKU_LIMIT` `productSku` documents, one
 * indexed range scan, no joins — identity is denormalised onto the SKU.
 */
export const listLiveSkuStock = query({
  args: { storeId: v.id("store") },
  returns: v.array(
    v.object({
      identity: skuIdentityValidator,
      productSkuId: v.string(),
      sku: v.union(v.string(), v.null()),
    }),
  ),
  handler: async (ctx, args): Promise<ReportLiveSkuStockRow[]> => {
    await requireReportsStoreAccess(ctx, args.storeId);

    const skus = await ctx.db
      .query("productSku")
      .withIndex("by_storeId", (q) => q.eq("storeId", args.storeId))
      .take(LIVE_STOCK_SKU_LIMIT);

    return skus.map((sku) => ({
      identity: toSkuIdentity(sku),
      productSkuId: String(sku._id),
      sku: sku.sku?.trim() || null,
    }));
  },
});
