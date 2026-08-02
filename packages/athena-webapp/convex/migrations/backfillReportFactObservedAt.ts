import { v } from "convex/values";

import {
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from "../_generated/server";
import type { Id } from "../_generated/dataModel";

type BatchArgs = {
  cursor?: string | null;
  dryRun?: boolean;
  limit?: number;
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

  return {
    changedCount,
    continueCursor: page.continueCursor,
    dryRun,
    isDone: page.isDone,
    missingCount,
    processedCount: page.page.length,
  };
}

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
    await ctx.db.patch("store", args.storeId, {
      weeklyObservedAtVerification: {
        status: complete ? "complete" : "incomplete",
        missingCount,
        startedAt: continuing
          ? store.weeklyObservedAtVerification?.startedAt ?? now
          : now,
        ...(complete ? { completedAt: now } : {}),
      },
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
  return {
    complete: false,
    continueCursor: page.continueCursor,
    isDone: false,
    missingCount,
  };
}

const batchArgs = {
  cursor: v.optional(v.union(v.string(), v.null())),
  limit: v.optional(v.number()),
};

export const backfillReportFactObservedAt = internalMutation({
  args: {
    ...batchArgs,
    dryRun: v.optional(v.boolean()),
  },
  handler: backfillReportFactObservedAtWithCtx,
});

export const verifyReportFactObservedAt = internalQuery({
  args: batchArgs,
  handler: verifyReportFactObservedAtWithCtx,
});

export const verifyStoreReportFactObservedAt = internalMutation({
  args: {
    ...batchArgs,
    storeId: v.id("store"),
  },
  handler: verifyStoreReportFactObservedAtWithCtx,
});
