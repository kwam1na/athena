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
 * `reason: "fold_version_bump"` and lets the sweeper refold them. Refolding
 * inline would create a second fold authority beside `sweeper.ts`, which
 * already owns fact caps, fold failures, and retry semantics.
 *
 * Since fold version 3 a refold also stamps `certifiedFoldRevision` on the day
 * and its SKU rows, so this repair path doubles as the certification backfill.
 * A day is stale when its foldVersion is superseded OR it lacks a certified
 * revision (`needsCertifiedRefold`).
 *
 * Rollout ordering for the movement feature (hard sequence — see the plan's
 * runbook):
 *   1. Deploy the schema fields (U1) — optional, tolerated on both generations.
 *   2. Deploy fold stamping + the `REPORTS_FOLD_VERSION` bump (U2, this
 *      change). New folds certify from here on.
 *   3. Run `markStaleFoldVersionDays` per allowlisted store and let the
 *      sweeper drain the marks. The bump refolds EVERY historical day of each
 *      repaired store; the drain rate is bounded by `SWEEP_DIRTY_BATCH` (10
 *      days) per 5-minute tick, so size the window from the store's history
 *      length.
 *   4. Confirm coverage with `countUncertifiedDays` (zero
 *      `uncertifiedCount` across all pages) before enabling the movement
 *      backend (U3) and UI for that store.
 */
type BatchArgs = {
  autoContinue?: boolean;
  cursor?: string | null;
  limit?: number;
  markedSoFar?: number;
  processedSoFar?: number;
  alreadyQueuedSoFar?: number;
  staleSoFar?: number;
  missingRevisionSoFar?: number;
  storeId: Id<"store">;
};

/**
 * The repair's staleness predicate: a day needs a refold when it was folded
 * under a superseded version OR when it carries no certified revision (the
 * pre-certification generation, and the movement lane treats it as
 * inadmissible either way — see `admissibleMovementDayRevision`).
 */
export function needsCertifiedRefold(day: {
  foldVersion: number;
  certifiedFoldRevision?: number | null;
}): boolean {
  return (
    day.foldVersion !== REPORTS_FOLD_VERSION ||
    day.certifiedFoldRevision === undefined ||
    day.certifiedFoldRevision === null
  );
}

/**
 * The U8 backfill predicate: a day folded before `skuDayRowCount` existed.
 *
 * Kept separate from `needsCertifiedRefold` because it is a different claim —
 * certification is the movement lane's TRUST boundary, this is only the mix
 * lane's SIZING hint. A day missing the count is fully trustworthy; the mix
 * probe simply cannot size it and falls back to the span rule (see
 * `skuMixSyncRowProbe`). Merging the two would make `countUncertifiedDays`
 * report a movement-readiness failure for what is a performance shortfall.
 *
 * Deliberately no fold-version bump: the fold's OUTPUT is unchanged, so
 * refolding is not a correctness repair and must not invalidate certified
 * provenance for stores that are already movement-ready.
 */
export function skuDayRowCountBackfillNeeded(day: {
  skuDayRowCount?: number | null;
}): boolean {
  return day.skuDayRowCount === undefined || day.skuDayRowCount === null;
}

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
    (day) => needsCertifiedRefold(day) || skuDayRowCountBackfillNeeded(day),
  );
  // Current-version rows that were never revision-certified (an anomaly once
  // fold stamping is live, since a version bump ships with it) — reported
  // separately so the operator can tell the staleness causes apart. Tested
  // directly rather than inferred from "stale AND current version", which
  // since U8 also matches a certified day that only wants the row count.
  const missingRevisionCount = stale.filter(
    (day) =>
      day.foldVersion === REPORTS_FOLD_VERSION &&
      (day.certifiedFoldRevision === undefined ||
        day.certifiedFoldRevision === null),
  ).length;
  const missingSkuDayRowCountCount = stale.filter(
    skuDayRowCountBackfillNeeded,
  ).length;

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
      generation: 1,
      firstMarkedAt: now,
      eligibleAt: now,
    });
    markedCount += 1;
  }

  const totals = {
    markedCount: (args.markedSoFar ?? 0) + markedCount,
    processedCount: (args.processedSoFar ?? 0) + page.page.length,
    alreadyQueuedCount: (args.alreadyQueuedSoFar ?? 0) + alreadyQueuedCount,
    staleCount: (args.staleSoFar ?? 0) + stale.length,
    missingRevisionCount:
      (args.missingRevisionSoFar ?? 0) + missingRevisionCount,
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
        missingRevisionSoFar: totals.missingRevisionCount,
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
    missingRevisionCount,
    missingSkuDayRowCountCount,
    // Cumulative across an `autoContinue` chain; equal to this batch when the
    // caller is driving the cursor itself.
    totals,
  };
}

/**
 * Read-only companion: how many rows still carry a superseded foldVersion.
 *
 * Writes nothing, so it can be run against production freely before and after
 * the mutation. A stale row stays stale until its refold lands, so a non-zero
 * count immediately after marking means the queue is still draining, not that
 * the repair failed. Note this counts the version dimension only; the
 * authoritative "is this store fully certified" check for the movement
 * rollout is `countUncertifiedDays` below.
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
    // U8 backfill drain gauge. Reported here rather than on
    // `countUncertifiedDays` because a missing count is not an uncertified
    // day: the mix probe degrades to the span rule, the movement lane is
    // unaffected, and conflating them would gate a rollout on a hint.
    missingSkuDayRowCountCount: page.page.filter(skuDayRowCountBackfillNeeded)
      .length,
  };
}

/**
 * The runbook's coverage gate: per page, how many `reportDay` rows are not yet
 * revision-certified — folded under a superseded version, or lacking a
 * `certifiedFoldRevision`. A store is movement-ready only when every page
 * reports `uncertifiedCount: 0` AFTER the repair marks have drained; any
 * non-zero page means the store's history is still mixed-generation and the
 * movement surface must stay off for it. Read-only and store-scoped; the
 * operator pages it by cursor exactly like `countStaleFoldVersionDays`.
 */
export async function countUncertifiedDaysWithCtx(
  ctx: QueryCtx,
  args: Pick<BatchArgs, "cursor" | "limit" | "storeId">,
) {
  const page = await dayPage(ctx, args);
  let staleFoldVersionCount = 0;
  let missingRevisionCount = 0;
  for (const day of page.page) {
    if (day.foldVersion !== REPORTS_FOLD_VERSION) {
      staleFoldVersionCount += 1;
    } else if (
      day.certifiedFoldRevision === undefined ||
      day.certifiedFoldRevision === null
    ) {
      missingRevisionCount += 1;
    }
  }
  const uncertifiedCount = staleFoldVersionCount + missingRevisionCount;
  return {
    continueCursor: page.continueCursor,
    foldVersion: REPORTS_FOLD_VERSION,
    isDone: page.isDone,
    processedCount: page.page.length,
    staleFoldVersionCount,
    missingRevisionCount,
    uncertifiedCount,
    certifiedCount: page.page.length - uncertifiedCount,
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
    missingRevisionSoFar: v.optional(v.number()),
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

// Read-only, so it cannot self-schedule; the operator pages it by cursor.
export const countUncertifiedDays = internalQuery({
  args: {
    cursor: v.optional(v.union(v.string(), v.null())),
    limit: v.optional(v.number()),
    storeId: v.id("store"),
  },
  handler: countUncertifiedDaysWithCtx,
});
