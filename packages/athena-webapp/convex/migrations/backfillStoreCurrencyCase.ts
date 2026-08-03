import { v } from "convex/values";

import {
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from "../_generated/server";
import { internal } from "../_generated/api";
import { normalizeCurrencyCode } from "../../shared/reportsContract";

/**
 * Canonicalize `store.currency` in place.
 *
 * `inventory/stores.create` took the currency straight from a free-text form
 * field, so production holds values like "ghs" alongside the canonical "GHS".
 * Daily Close stamps `close_snapshot` report facts from `store.currency` while
 * POS sales facts carry the uppercase code, so a single day looked like two
 * currencies to the day fold: it flagged `mixedCurrency`, dropped those facts,
 * and the weekly surface withheld every total. The fold now normalizes before
 * comparing and `create` normalizes on write — this migration retires the rows
 * that were already stored wrong.
 *
 * `autoContinue` turns a paged migration into one fire-and-forget call: each
 * batch schedules the next from the cursor it just produced, and the running
 * totals ride along so the final batch can report the whole job rather than
 * its own slice. Opt-in, so a dry run can still be taken one bounded page at
 * a time. See backfillReportingCycleStart.ts for the same contract.
 */
type BatchArgs = {
  autoContinue?: boolean;
  changedSoFar?: number;
  cursor?: string | null;
  dryRun?: boolean;
  limit?: number;
  mismatchedSoFar?: number;
  processedSoFar?: number;
};

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

function boundedLimit(limit?: number) {
  if (limit === undefined || !Number.isInteger(limit) || limit < 1) {
    return DEFAULT_LIMIT;
  }
  return Math.min(limit, MAX_LIMIT);
}

async function storePage(
  ctx: Pick<QueryCtx, "db"> | Pick<MutationCtx, "db">,
  args: Pick<BatchArgs, "cursor" | "limit">,
) {
  return await ctx.db.query("store").paginate({
    cursor: args.cursor ?? null,
    numItems: boundedLimit(args.limit),
  });
}

/**
 * The single predicate both the backfill and the verifier answer with, so the
 * two can never disagree about what "still needs work" means. Idempotent by
 * construction: after a write the normalized value equals itself, so a re-run
 * sees nothing to do.
 */
function needsNormalization(currency: string | undefined): boolean {
  return normalizeCurrencyCode(currency) !== currency;
}

export async function backfillStoreCurrencyCaseWithCtx(
  ctx: MutationCtx,
  args: BatchArgs,
) {
  const dryRun = args.dryRun !== false;
  const page = await storePage(ctx, args);
  let changedCount = 0;
  let mismatchedCount = 0;

  for (const store of page.page) {
    if (!needsNormalization(store.currency)) continue;
    mismatchedCount += 1;
    if (dryRun) continue;
    await ctx.db.patch("store", store._id, {
      currency: normalizeCurrencyCode(store.currency),
    });
    changedCount += 1;
  }

  const totals = {
    changedCount: (args.changedSoFar ?? 0) + changedCount,
    mismatchedCount: (args.mismatchedSoFar ?? 0) + mismatchedCount,
    processedCount: (args.processedSoFar ?? 0) + page.page.length,
  };

  // Scheduled from inside the same transaction the batch committed, so the
  // chain cannot skip a page: either this batch's writes and its successor
  // both land, or neither does and the operator re-runs from the last cursor.
  if (args.autoContinue && !page.isDone) {
    await ctx.scheduler.runAfter(
      0,
      internal.migrations.backfillStoreCurrencyCase.backfillStoreCurrencyCase,
      {
        autoContinue: true,
        changedSoFar: totals.changedCount,
        cursor: page.continueCursor,
        dryRun: args.dryRun,
        limit: args.limit,
        mismatchedSoFar: totals.mismatchedCount,
        processedSoFar: totals.processedCount,
      },
    );
  }

  return {
    changedCount,
    continueCursor: page.continueCursor,
    dryRun,
    isDone: page.isDone,
    mismatchedCount,
    processedCount: page.page.length,
    // Cumulative across an `autoContinue` chain; equal to this batch when the
    // caller is driving the cursor itself.
    totals,
  };
}

/**
 * Read-only spot check: how many stores on this page still carry a
 * non-canonical currency. Run it across every page until `mismatchedCount` is
 * zero to confirm the backfill drained. It writes nothing, so it cannot
 * self-schedule and is safe to run against production at any time.
 */
export async function verifyStoreCurrencyCaseWithCtx(
  ctx: QueryCtx,
  args: Pick<BatchArgs, "cursor" | "limit">,
) {
  const page = await storePage(ctx, args);
  return {
    continueCursor: page.continueCursor,
    isDone: page.isDone,
    mismatchedCount: page.page.filter((store) =>
      needsNormalization(store.currency),
    ).length,
    processedCount: page.page.length,
  };
}

export const backfillStoreCurrencyCase = internalMutation({
  args: {
    autoContinue: v.optional(v.boolean()),
    changedSoFar: v.optional(v.number()),
    cursor: v.optional(v.union(v.string(), v.null())),
    dryRun: v.optional(v.boolean()),
    limit: v.optional(v.number()),
    mismatchedSoFar: v.optional(v.number()),
    processedSoFar: v.optional(v.number()),
  },
  handler: backfillStoreCurrencyCaseWithCtx,
});

export const verifyStoreCurrencyCase = internalQuery({
  args: {
    cursor: v.optional(v.union(v.string(), v.null())),
    limit: v.optional(v.number()),
  },
  handler: verifyStoreCurrencyCaseWithCtx,
});
