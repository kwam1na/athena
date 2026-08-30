import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  type MutationCtx,
} from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import {
  REPORT_DAY_METRIC_KEYS,
  REPORT_SKU_DAY_METRIC_KEYS,
  REPORT_RANGE_TOP_SKU_LIMIT,
  type ReportDayMetrics,
  type ReportSkuDayMetrics,
} from "../../shared/reportsContract";
import { readPipelineControl } from "./pipelineControl";
import { readStoreAllowlist } from "./pipelineAllowlist";
import { recordPipelineOutcomeWithCtx } from "./pipelineEvidence";

const SKU_BATCH = 100;
const LEASE_MS = 60_000;
const ZERO_SKU: ReportSkuDayMetrics = {
  unitsSold: 0,
  unitsReturned: 0,
  grossSalesMinor: 0,
  netSalesMinor: 0,
  refundsMinor: 0,
  uncostedRevenueMinor: 0,
  grossProfitMinor: 0,
};
const ZERO_DAY: ReportDayMetrics = {
  ...ZERO_SKU,
  paymentsCollectedMinor: 0,
  paymentsRefundedMinor: 0,
  paymentAllocatedMinor: 0,
};
type SummaryClaim = {
  requestId: Id<"reportRangeResult">;
  storeId: Id<"store">;
  fence: number;
};
const claimFields = {
  requestId: v.id("reportRangeResult"),
  storeId: v.id("store"),
  fence: v.number(),
};
const outcome = v.union(
  v.literal("more"),
  v.literal("done"),
  v.literal("stale"),
  v.literal("blocked"),
);

/** Scalar watermark only; creating a shadow control never activates readers. */
export async function ensureSummaryControlWithCtx(
  ctx: MutationCtx,
  storeId: Id<"store">,
) {
  const existing = await readPipelineControl(ctx, storeId);
  if (existing) return existing;
  const id = await ctx.db.insert("reportPipelineControl", {
    storeId,
    mode: "shadow",
    fence: 1,
    sourceWatermark: 0,
  });
  const created = await ctx.db.get("reportPipelineControl", id);
  if (!created) throw new Error("Missing range source fence");
  return created;
}

function isSummary(row: Doc<"reportRangeResult">) {
  return row.kind === undefined || row.kind === "custom_summary";
}

/** Two independently indexed prefixes: kinded movement/mix cannot hide legacy work. */
export async function dispatchSummaryRangesWithCtx(
  ctx: MutationCtx,
  storeId: Id<"store">,
  now: number,
) {
  if (!readStoreAllowlist().has(String(storeId))) return 0;
  const store = await ctx.db.get("store", storeId);
  const control = await readPipelineControl(ctx, storeId);
  if (
    !store ||
    store.reportingReseedStartedAt !== undefined ||
    control?.mode === "paused"
  )
    return 0;
  let scheduled = 0;
  for (const kind of [undefined, "custom_summary"] as const) {
    const row = await ctx.db
      .query("reportRangeResult")
      .withIndex("by_storeId_kind_status_summaryEligibleAt", (q) =>
        q
          .eq("storeId", storeId)
          .eq("kind", kind)
          .eq("status", "pending")
          .lte("summaryEligibleAt", now),
      )
      .first();
    if (!row) continue;
    if (row.expiresAt <= now) {
      await cleanupSummaryRangeWithCtx(ctx, row._id, now);
      continue;
    }
    const fence = (row.summaryFence ?? 0) + 1;
    await ctx.db.patch("reportRangeResult", row._id, {
      summaryFence: fence,
      summaryClaimed: true,
      summaryEligibleAt: now + LEASE_MS,
    });
    await ctx.scheduler.runAfter(
      0,
      makeFunctionReference<"action", SummaryClaim>(
        "reports/pipelineRange:runSummaryBatch",
      ),
      {
        requestId: row._id,
        storeId,
        fence,
      },
    );
    scheduled++;
  }
  return scheduled;
}

async function dirtyRange(ctx: MutationCtx, row: Doc<"reportRangeResult">) {
  return ctx.db
    .query("reportDirtyDay")
    .withIndex("by_storeId_operatingDate", (q) =>
      q
        .eq("storeId", row.storeId)
        .gte("operatingDate", row.startDate)
        .lte("operatingDate", row.endDate),
    )
    .first();
}

async function continueSummary(
  ctx: MutationCtx,
  row: Doc<"reportRangeResult">,
  now: number,
  patch: Partial<Doc<"reportRangeResult">>,
) {
  await ctx.db.patch("reportRangeResult", row._id, {
    ...patch,
    summaryClaimed: false,
    summaryEligibleAt: now,
    summaryAttempts: 0,
  });
  // Fast path is optional: the durable eligibility above is the backstop authority.
  await ctx.scheduler.runAfter(
    0,
    makeFunctionReference<"mutation", { storeId: Id<"store"> }>(
      "reports/pipelineRange:dispatchStore",
    ),
    { storeId: row.storeId },
  );
}

async function rangeBasis(ctx: MutationCtx, row: Doc<"reportRangeResult">) {
  const inputs = await ctx.db
    .query("reportRollupInputCurrent")
    .withIndex("by_storeId_operatingDate", (q) =>
      q
        .eq("storeId", row.storeId)
        .gte("operatingDate", row.startDate)
        .lte("operatingDate", row.endDate),
    )
    .take(367);
  if (
    inputs.length > 366 ||
    new Set(inputs.map((input) => input.operatingDate)).size !== inputs.length
  )
    throw new Error("summary_range_capacity_or_duplicate_input");
  return JSON.stringify(
    inputs.map((input) => [input.operatingDate, input.inputId, input.revision]),
  );
}

/** One large day OR100 compact SKU rows per atomic cursor advance; no partial public totals. */
export async function applySummaryRangeBatchWithCtx(
  ctx: MutationCtx,
  claim: SummaryClaim,
  now: number,
): Promise<"more" | "done" | "stale" | "blocked"> {
  const row = await ctx.db.get("reportRangeResult", claim.requestId);
  if (
    !row ||
    !isSummary(row) ||
    row.storeId !== claim.storeId ||
    row.status !== "pending" ||
    row.summaryFence !== claim.fence ||
    !row.summaryClaimed ||
    (row.summaryEligibleAt ?? 0) <= now
  )
    return "stale";
  const store = await ctx.db.get("store", claim.storeId);
  const control = await ensureSummaryControlWithCtx(ctx, claim.storeId);
  if (
    !store ||
    store.reportingReseedStartedAt !== undefined ||
    control.mode === "paused" ||
    !readStoreAllowlist().has(String(claim.storeId))
  )
    return "blocked";
  if (row.expiresAt <= now) {
    await cleanupSummaryRangeWithCtx(ctx, row._id, now);
    return "stale";
  }
  if (row.summaryPhase === "cleaning") {
    const children = await ctx.db
      .query("reportRangeSummarySku")
      .withIndex("by_rangeResultId_productSkuId", (q) =>
        q.eq("rangeResultId", row._id),
      )
      .take(SKU_BATCH + 1);
    if (children.some((child) => child.storeId !== row.storeId))
      throw new Error("Invalid summary child ownership");
    for (const child of children.slice(0, SKU_BATCH))
      await ctx.db.delete("reportRangeSummarySku", child._id);
    await continueSummary(
      ctx,
      row,
      now,
      children.length > SKU_BATCH
        ? {}
        : {
            summaryPhase: undefined,
            summaryCursor: undefined,
            summaryWatermark: undefined,
            summaryBasis: undefined,
            summaryControlFence: undefined,
            summaryTotals: undefined,
          },
    );
    return "more";
  }
  if (
    row.summaryControlFence !== undefined &&
    row.summaryControlFence !== control.fence
  ) {
    await continueSummary(ctx, row, now, { summaryPhase: "cleaning" });
    return "more";
  }
  if (await dirtyRange(ctx, row)) {
    await ctx.db.patch("reportRangeResult", row._id, {
      summaryClaimed: false,
      summaryEligibleAt: now + 5_000,
    });
    await recordPipelineOutcomeWithCtx(ctx, {
      storeId: row.storeId,
      lane: "legacy",
      now,
      outcome: "blocked",
    });
    return "blocked";
  }
  if (!row.summaryPhase) {
    await continueSummary(ctx, row, now, {
      kind: "custom_summary",
      summaryPhase: "days",
      summaryCursor: null,
      summaryWatermark: control.sourceWatermark,
      summaryControlFence: control.fence,
      summaryBasis: await rangeBasis(ctx, row),
      summaryTotals: { ...ZERO_DAY, dayCount: 0, unsettledDayCount: 0 },
    });
    return "more";
  }
  if (row.summaryPhase === "days") {
    const page = await ctx.db
      .query("reportDay")
      .withIndex("by_storeId_operatingDate", (q) =>
        q
          .eq("storeId", row.storeId)
          .gte("operatingDate", row.startDate)
          .lte("operatingDate", row.endDate),
      )
      .paginate({
        cursor: row.summaryCursor ?? null,
        numItems: 1,
        maximumBytesRead: 1_048_576,
      });
    const totals = { ...row.summaryTotals! };
    for (const day of page.page) {
      for (const key of REPORT_DAY_METRIC_KEYS) {
        if (key === "grossProfitMinor")
          totals[key] =
            totals[key] === null || day[key] === null
              ? null
              : totals[key] + day[key];
        else totals[key] += day[key];
      }
      totals.dayCount++;
      if (day.status === "open" || day.status === "provisional")
        totals.unsettledDayCount++;
    }
    await continueSummary(ctx, row, now, {
      summaryTotals: totals,
      summaryPhase: page.isDone ? "skus" : "days",
      summaryCursor: page.isDone ? null : page.continueCursor,
    });
    return "more";
  }
  if (row.summaryPhase === "skus") {
    const page = await ctx.db
      .query("reportSkuDay")
      .withIndex("by_storeId_operatingDate_productSkuId", (q) =>
        q
          .eq("storeId", row.storeId)
          .gte("operatingDate", row.startDate)
          .lte("operatingDate", row.endDate),
      )
      .paginate({
        cursor: row.summaryCursor ?? null,
        numItems: SKU_BATCH,
        maximumBytesRead: 512_000,
      });
    for (const sku of page.page) {
      const prior = await ctx.db
        .query("reportRangeSummarySku")
        .withIndex("by_rangeResultId_productSkuId", (q) =>
          q.eq("rangeResultId", row._id).eq("productSkuId", sku.productSkuId),
        )
        .unique();
      if (prior && prior.storeId !== row.storeId)
        throw new Error("Invalid summary child ownership");
      const metrics: ReportSkuDayMetrics = { ...ZERO_SKU };
      for (const key of REPORT_SKU_DAY_METRIC_KEYS) {
        const old = prior?.[key] ?? 0;
        if (key === "grossProfitMinor")
          metrics[key] =
            prior?.grossProfitMinor === null || sku.grossProfitMinor === null
              ? null
              : old + (sku[key] ?? 0);
        else metrics[key] = old + sku[key];
      }
      const next = {
        storeId: row.storeId,
        rangeResultId: row._id,
        productSkuId: sku.productSkuId,
        ...metrics,
        revenueSortKey: -metrics.netSalesMinor,
      };
      if (prior) await ctx.db.patch("reportRangeSummarySku", prior._id, next);
      else await ctx.db.insert("reportRangeSummarySku", next);
    }
    await continueSummary(ctx, row, now, {
      summaryPhase: page.isDone ? "publish" : "skus",
      summaryCursor: page.isDone ? null : page.continueCursor,
    });
    return "more";
  }
  if (
    row.summaryWatermark !== control.sourceWatermark &&
    row.summaryBasis !== (await rangeBasis(ctx, row))
  ) {
    await continueSummary(ctx, row, now, { summaryPhase: "cleaning" });
    return "more";
  }
  const top = await ctx.db
    .query("reportRangeSummarySku")
    .withIndex("by_rangeResultId_revenueSortKey_productSkuId", (q) =>
      q.eq("rangeResultId", row._id),
    )
    .take(REPORT_RANGE_TOP_SKU_LIMIT);
  if (top.some((child) => child.storeId !== row.storeId))
    throw new Error("Invalid summary child ownership");
  const periodKey = `custom:${row.startDate}:${row.endDate}`;
  await ctx.db.patch("reportRangeResult", row._id, {
    status: "completed",
    computedAt: now,
    totals: row.summaryTotals,
    topSkus: top.map((child) => ({
      productSkuId: child.productSkuId,
      periodKey,
      unitsSold: child.unitsSold,
      unitsReturned: child.unitsReturned,
      grossSalesMinor: child.grossSalesMinor,
      netSalesMinor: child.netSalesMinor,
      refundsMinor: child.refundsMinor,
      uncostedRevenueMinor: child.uncostedRevenueMinor,
      grossProfitMinor: child.grossProfitMinor,
    })),
    summaryClaimed: false,
    summaryEligibleAt: undefined,
    summaryTotals: undefined,
    failureReason: undefined,
  });
  await recordPipelineOutcomeWithCtx(ctx, {
    storeId: row.storeId,
    lane: "legacy",
    now,
    outcome: "applied",
  });
  return "done";
}

/** Header remains addressable until all private children have drained. */
export async function cleanupSummaryRangeWithCtx(
  ctx: MutationCtx,
  requestId: Id<"reportRangeResult">,
  now: number,
) {
  const row = await ctx.db.get("reportRangeResult", requestId);
  if (!row || !isSummary(row) || row.expiresAt > now) return false;
  const children = await ctx.db
    .query("reportRangeSummarySku")
    .withIndex("by_rangeResultId_productSkuId", (q) =>
      q.eq("rangeResultId", requestId),
    )
    .take(SKU_BATCH + 1);
  if (children.some((child) => child.storeId !== row.storeId)) {
    await ctx.db.patch("reportRangeResult", row._id, {
      summaryCleanupBlocked: true,
      summaryClaimed: false,
      summaryEligibleAt: Number.MAX_SAFE_INTEGER,
    });
    return false;
  }
  for (const child of children.slice(0, SKU_BATCH))
    await ctx.db.delete("reportRangeSummarySku", child._id);
  if (children.length > SKU_BATCH) {
    // Expiry owns the remaining children; don't let a large expired header
    // repeatedly win the live-work index while its cleanup cursor drains.
    await ctx.db.patch("reportRangeResult", row._id, {
      summaryClaimed: false,
      summaryEligibleAt: Number.MAX_SAFE_INTEGER,
    });
    return false;
  }
  await ctx.db.delete("reportRangeResult", requestId);
  return true;
}

export const dispatchStore = internalMutation({
  args: { storeId: v.id("store") },
  returns: v.number(),
  handler: (ctx, args) =>
    dispatchSummaryRangesWithCtx(ctx, args.storeId, Date.now()),
});
export const applySummaryBatch = internalMutation({
  args: claimFields,
  returns: outcome,
  handler: (ctx, args) => applySummaryRangeBatchWithCtx(ctx, args, Date.now()),
});
export const recordSummaryFailure = internalMutation({
  args: claimFields,
  returns: v.null(),
  handler: async (ctx, claim) => {
    const row = await ctx.db.get("reportRangeResult", claim.requestId);
    if (
      !row ||
      !isSummary(row) ||
      row.storeId !== claim.storeId ||
      row.summaryFence !== claim.fence ||
      !row.summaryClaimed ||
      row.status !== "pending"
    )
      return null;
    const now = Date.now(),
      attempt = (row.summaryAttempts ?? 0) + 1;
    await ctx.db.patch("reportRangeResult", row._id, {
      summaryClaimed: false,
      summaryAttempts: attempt,
      summaryEligibleAt:
        now + Math.min(30 * 60_000, 5_000 * 2 ** Math.min(attempt - 1, 9)),
    });
    await recordPipelineOutcomeWithCtx(ctx, {
      storeId: row.storeId,
      lane: "legacy",
      now,
      outcome: "failed",
    });
    return null;
  },
});
export const runSummaryBatch = internalAction({
  args: claimFields,
  returns: v.null(),
  handler: async (ctx, args) => {
    try {
      await ctx.runMutation(
        makeFunctionReference<"mutation", SummaryClaim>(
          "reports/pipelineRange:applySummaryBatch",
        ),
        args,
      );
    } catch {
      await ctx.runMutation(
        makeFunctionReference<"mutation", SummaryClaim>(
          "reports/pipelineRange:recordSummaryFailure",
        ),
        args,
      );
    }
    return null;
  },
});
