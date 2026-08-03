import { v } from "convex/values";

import {
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import { REPORTS_FOLD_VERSION } from "../../shared/reportsContract";

/**
 * Make a `REPORTS_FOLD_VERSION` bump actually reach already-folded days.
 *
 * `reportDay` rows carry the `foldVersion` they were written with, but no read
 * or write path has ever compared a stored row against the current constant.
 * Bumping the constant therefore corrected new folds and left old ones frozen
 * with their pre-change values — in production that meant days keeping a false
 * `mixedCurrency` flag, which propagates into weekly `completeness` and makes
 * the weekly surface withhold every total.
 *
 * This module closes that gap the only safe way: it marks stale rows dirty with
 * `reason: "fold_version_bump"` (the literal the schema has always declared and
 * nothing has ever produced) and lets the sweeper refold them. Refolding inline
 * would create a second fold authority beside `sweeper.ts`, which already owns
 * fact caps, fold failures, and retry semantics.
 */
type BatchArgs = {
  autoContinue?: boolean;
  cursor?: string | null;
  limit?: number;
  markedSoFar?: number;
  processedSoFar?: number;
  alreadyQueuedSoFar?: number;
  staleSoFar?: number;
  storeId: Id<"store">;
};

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

function boundedLimit(limit?: number) {
  if (limit === undefined || !Number.isInteger(limit) || limit < 1) {
    return DEFAULT_LIMIT;
  }
  return Math.min(limit, MAX_LIMIT);
}

/**
 * `by_storeId_operatingDate` is the ONLY index on `reportDay`; there is none on
 * `foldVersion`. So the scan is store-scoped and paginated on that index and
 * the staleness predicate is applied in memory, per page. That is deliberate
 * and sufficient: pages are bounded by `MAX_LIMIT`, the work is one-shot per
 * bump, and adding an index for a maintenance path would cost every fold write.
 */
async function dayPage(
  ctx: Pick<QueryCtx, "db"> | Pick<MutationCtx, "db">,
  args: Pick<BatchArgs, "cursor" | "limit" | "storeId">,
) {
  return await ctx.db
    .query("reportDay")
    .withIndex("by_storeId_operatingDate", (q) => q.eq("storeId", args.storeId))
    .paginate({
      cursor: args.cursor ?? null,
      numItems: boundedLimit(args.limit),
    });
}

export async function markStaleFoldVersionDaysWithCtx(
  ctx: MutationCtx,
  args: BatchArgs,
) {
  const now = Date.now();
  const page = await dayPage(ctx, args);
  const stale = page.page.filter(
    (day) => day.foldVersion !== REPORTS_FOLD_VERSION,
  );

  let markedCount = 0;
  let alreadyQueuedCount = 0;

  for (const day of stale) {
    const existing = await ctx.db
      .query("reportDirtyDay")
      .withIndex("by_storeId_operatingDate", (q) =>
        q.eq("storeId", args.storeId).eq("operatingDate", day.operatingDate),
      )
      .unique();

    if (existing) {
      // Already queued — leave the row completely untouched.
      //
      // One mark per (store, day) already means "refold me", so there is
      // nothing to add. Writing anything here would be actively harmful: the
      // sweeper drains oldest-`markedAt` first, so refreshing recency would
      // push an already-waiting day to the BACK of the queue and delay a
      // pending `close_accepted` fold behind a bulk version repair. Patching
      // the reason would erase that more specific cause, and inserting would
      // duplicate the queue entry and fold the day twice.
      alreadyQueuedCount += 1;
      continue;
    }

    await ctx.db.insert("reportDirtyDay", {
      storeId: args.storeId,
      operatingDate: day.operatingDate,
      reason: "fold_version_bump",
      markedAt: now,
    });
    markedCount += 1;
  }

  const totals = {
    markedCount: (args.markedSoFar ?? 0) + markedCount,
    processedCount: (args.processedSoFar ?? 0) + page.page.length,
    alreadyQueuedCount: (args.alreadyQueuedSoFar ?? 0) + alreadyQueuedCount,
    staleCount: (args.staleSoFar ?? 0) + stale.length,
  };

  // Scheduled from inside the transaction this batch committed, so the chain
  // cannot skip a page: either this batch's marks and its successor both land,
  // or neither does and the operator re-runs from the last cursor.
  if (args.autoContinue && !page.isDone) {
    await ctx.scheduler.runAfter(
      0,
      internal.reports.foldVersionRepair.markStaleFoldVersionDays,
      {
        autoContinue: true,
        cursor: page.continueCursor,
        limit: args.limit,
        markedSoFar: totals.markedCount,
        processedSoFar: totals.processedCount,
        alreadyQueuedSoFar: totals.alreadyQueuedCount,
        staleSoFar: totals.staleCount,
        storeId: args.storeId,
      },
    );
  }

  return {
    continueCursor: page.continueCursor,
    foldVersion: REPORTS_FOLD_VERSION,
    isDone: page.isDone,
    markedCount,
    processedCount: page.page.length,
    alreadyQueuedCount,
    staleCount: stale.length,
    // Cumulative across an `autoContinue` chain; equal to this batch when the
    // caller is driving the cursor itself.
    totals,
  };
}

/**
 * Read-only companion: "does this store need the repair / did it finish?".
 *
 * Writes nothing, so it can be run against production freely before and after
 * the mutation. A store is repaired when every page reports `staleCount: 0`
 * AFTER the sweeper has drained the marks — a stale row stays stale until its
 * refold lands, so a non-zero count immediately after marking means the queue
 * is still draining, not that the repair failed.
 */
export async function countStaleFoldVersionDaysWithCtx(
  ctx: QueryCtx,
  args: Pick<BatchArgs, "cursor" | "limit" | "storeId">,
) {
  const page = await dayPage(ctx, args);
  return {
    continueCursor: page.continueCursor,
    foldVersion: REPORTS_FOLD_VERSION,
    isDone: page.isDone,
    processedCount: page.page.length,
    staleCount: page.page.filter(
      (day) => day.foldVersion !== REPORTS_FOLD_VERSION,
    ).length,
  };
}

export const markStaleFoldVersionDays = internalMutation({
  args: {
    autoContinue: v.optional(v.boolean()),
    cursor: v.optional(v.union(v.string(), v.null())),
    limit: v.optional(v.number()),
    markedSoFar: v.optional(v.number()),
    processedSoFar: v.optional(v.number()),
    alreadyQueuedSoFar: v.optional(v.number()),
    staleSoFar: v.optional(v.number()),
    storeId: v.id("store"),
  },
  handler: markStaleFoldVersionDaysWithCtx,
});

// Read-only, so it cannot self-schedule; the operator pages it by cursor.
export const countStaleFoldVersionDays = internalQuery({
  args: {
    cursor: v.optional(v.union(v.string(), v.null())),
    limit: v.optional(v.number()),
    storeId: v.id("store"),
  },
  handler: countStaleFoldVersionDaysWithCtx,
});
