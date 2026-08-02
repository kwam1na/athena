import { v } from "convex/values";

import {
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import { hasCompletedWeeklyReportingCycleAnchorVerification } from "../platform/capabilityCatalog";

/**
 * `autoContinue` turns a paged migration into one fire-and-forget call: each
 * batch schedules the next from the cursor it just produced, and the running
 * totals ride along so the final batch can report the whole job rather than
 * its own slice. Without it a production-sized `reportFact` table would need
 * one manual invocation per hundred rows. Opt-in, so a dry run can still be
 * taken one bounded page at a time.
 */
type BatchArgs = {
  autoContinue?: boolean;
  changedSoFar?: number;
  cursor?: string | null;
  dryRun?: boolean;
  limit?: number;
  missingSoFar?: number;
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

async function factPage(
  ctx: Pick<QueryCtx, "db"> | Pick<MutationCtx, "db">,
  args: Pick<BatchArgs, "cursor" | "limit">,
) {
  return await ctx.db.query("reportFact").paginate({
    cursor: args.cursor ?? null,
    numItems: boundedLimit(args.limit),
  });
}

async function storeFactPage(
  ctx: Pick<QueryCtx, "db"> | Pick<MutationCtx, "db">,
  args: Pick<BatchArgs, "cursor" | "limit"> & { storeId: Id<"store"> },
) {
  return await ctx.db
    .query("reportFact")
    .withIndex("by_storeId_operatingDate_observedAt", (q) =>
      q.eq("storeId", args.storeId),
    )
    .paginate({
      cursor: args.cursor ?? null,
      numItems: boundedLimit(args.limit),
    });
}

export async function backfillReportFactObservedAtWithCtx(
  ctx: MutationCtx,
  args: BatchArgs,
) {
  const dryRun = args.dryRun !== false;
  const page = await factPage(ctx, args);
  let changedCount = 0;
  let missingCount = 0;

  for (const fact of page.page) {
    if (fact.observedAt !== undefined) continue;
    missingCount += 1;
    if (dryRun) continue;
    await ctx.db.patch("reportFact", fact._id, {
      observedAt: fact._creationTime,
    });
    changedCount += 1;
  }

  const totals = {
    changedCount: (args.changedSoFar ?? 0) + changedCount,
    missingCount: (args.missingSoFar ?? 0) + missingCount,
    processedCount: (args.processedSoFar ?? 0) + page.page.length,
  };

  // Scheduled from inside the same transaction the batch committed, so the
  // chain cannot skip a page: either this batch's writes and its successor
  // both land, or neither does and the operator re-runs from the last cursor.
  if (args.autoContinue && !page.isDone) {
    await ctx.scheduler.runAfter(
      0,
      internal.migrations.backfillReportFactObservedAt
        .backfillReportFactObservedAt,
      {
        autoContinue: true,
        changedSoFar: totals.changedCount,
        cursor: page.continueCursor,
        dryRun: args.dryRun,
        limit: args.limit,
        missingSoFar: totals.missingCount,
        processedSoFar: totals.processedCount,
      },
    );
  }

  return {
    changedCount,
    continueCursor: page.continueCursor,
    dryRun,
    isDone: page.isDone,
    missingCount,
    processedCount: page.page.length,
    // Cumulative across an `autoContinue` chain; equal to this batch when the
    // caller is driving the cursor itself.
    totals,
  };
}

/**
 * DEPLOYMENT-ORDERING CONTRACT — do not narrow before this reports zero.
 *
 * `reportFact.observedAt` is `v.optional(v.number())` today because facts
 * written before knowledge time existed carry none. The only safe order is:
 *
 *   1. deploy the widened (optional) schema — done;
 *   2. run `backfillReportFactObservedAt` to completion, dry run first;
 *   3. run THIS check across every page until `missingCount` is zero
 *      (and `verifyStoreReportFactObservedAt` per store for the capability
 *      evidence the weekly gate reads);
 *   4. only then may the field be made required.
 *
 * Narrowing at step 1 or 2 rejects writes to facts this migration has not
 * reached yet. `backfillReportFactObservedAt.test.ts` holds a guard test that
 * fails if the schema is narrowed while this contract can still report
 * stragglers, so the two can never drift apart silently.
 */
export async function verifyReportFactObservedAtWithCtx(
  ctx: QueryCtx,
  args: Pick<BatchArgs, "cursor" | "limit">,
) {
  const page = await factPage(ctx, args);
  return {
    continueCursor: page.continueCursor,
    isDone: page.isDone,
    missingCount: page.page.filter((fact) => fact.observedAt === undefined)
      .length,
    processedCount: page.page.length,
  };
}

/**
 * Verify one store's complete fact ledger and persist the result on `store`.
 * The cursor is intentionally caller-resumable; only a full zero-missing scan
 * writes `complete`, which is the weekly capability and acceptance proof.
 */
export async function verifyStoreReportFactObservedAtWithCtx(
  ctx: MutationCtx,
  args: BatchArgs & { storeId: Id<"store"> },
) {
  const store = await ctx.db.get("store", args.storeId);
  if (!store) throw new Error("Store not found.");

  const continuing = args.cursor !== undefined;
  const priorMissingCount = continuing
    ? store.weeklyObservedAtVerification?.missingCount ?? 0
    : 0;
  const page = await storeFactPage(ctx, args);
  const missingCount =
    priorMissingCount +
    page.page.filter((fact) => fact.observedAt === undefined).length;
  const now = Date.now();

  if (page.isDone) {
    const complete = missingCount === 0;
    // The second completed verification activates the store: stamp the
    // acceptance floor exactly once so pre-activation closes can never gain
    // retrospective accepted baselines.
    const activates =
      complete &&
      hasCompletedWeeklyReportingCycleAnchorVerification(store) &&
      store.weeklyReportingAcceptanceFloor === undefined;
    await ctx.db.patch("store", args.storeId, {
      weeklyObservedAtVerification: {
        status: complete ? "complete" : "incomplete",
        missingCount,
        startedAt: continuing
          ? store.weeklyObservedAtVerification?.startedAt ?? now
          : now,
        ...(complete ? { completedAt: now } : {}),
      },
      ...(activates ? { weeklyReportingAcceptanceFloor: now } : {}),
    });
    return { complete, continueCursor: page.continueCursor, isDone: true, missingCount };
  }

  await ctx.db.patch("store", args.storeId, {
    weeklyObservedAtVerification: {
      status: "running",
      missingCount,
      startedAt: continuing
        ? store.weeklyObservedAtVerification?.startedAt ?? now
        : now,
    },
  });
  if (args.autoContinue) {
    await ctx.scheduler.runAfter(
      0,
      internal.migrations.backfillReportFactObservedAt
        .verifyStoreReportFactObservedAt,
      {
        autoContinue: true,
        cursor: page.continueCursor,
        limit: args.limit,
        storeId: args.storeId,
      },
    );
  }
  return {
    complete: false,
    continueCursor: page.continueCursor,
    isDone: false,
    missingCount,
  };
}

const batchArgs = {
  autoContinue: v.optional(v.boolean()),
  cursor: v.optional(v.union(v.string(), v.null())),
  limit: v.optional(v.number()),
};

export const backfillReportFactObservedAt = internalMutation({
  args: {
    ...batchArgs,
    changedSoFar: v.optional(v.number()),
    dryRun: v.optional(v.boolean()),
    missingSoFar: v.optional(v.number()),
    processedSoFar: v.optional(v.number()),
  },
  handler: backfillReportFactObservedAtWithCtx,
});

// Read-only, so it cannot self-schedule. It stays a manual spot check; the
// per-store mutation below is what the capability gate actually consumes.
export const verifyReportFactObservedAt = internalQuery({
  args: {
    cursor: v.optional(v.union(v.string(), v.null())),
    limit: v.optional(v.number()),
  },
  handler: verifyReportFactObservedAtWithCtx,
});

export const verifyStoreReportFactObservedAt = internalMutation({
  args: {
    ...batchArgs,
    storeId: v.id("store"),
  },
  handler: verifyStoreReportFactObservedAtWithCtx,
});
