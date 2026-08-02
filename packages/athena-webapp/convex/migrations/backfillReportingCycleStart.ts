import { v } from "convex/values";

import {
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from "../_generated/server";

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

async function schedulePage(
  ctx: Pick<QueryCtx, "db"> | Pick<MutationCtx, "db">,
  args: Pick<BatchArgs, "cursor" | "limit">,
) {
  return await ctx.db.query("storeSchedule").paginate({
    cursor: args.cursor ?? null,
    numItems: boundedLimit(args.limit),
  });
}

export async function backfillReportingCycleStartWithCtx(
  ctx: MutationCtx,
  args: BatchArgs,
) {
  const dryRun = args.dryRun !== false;
  const page = await schedulePage(ctx, args);
  let changedCount = 0;
  let missingCount = 0;

  for (const schedule of page.page) {
    if (schedule.reportingCycleStartsOn !== undefined) continue;
    missingCount += 1;
    if (dryRun) continue;
    await ctx.db.patch("storeSchedule", schedule._id, {
      reportingCycleStartsOn: 1,
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

export async function verifyReportingCycleStartWithCtx(
  ctx: QueryCtx,
  args: Pick<BatchArgs, "cursor" | "limit">,
) {
  const page = await schedulePage(ctx, args);
  return {
    continueCursor: page.continueCursor,
    isDone: page.isDone,
    missingCount: page.page.filter(
      (schedule) => schedule.reportingCycleStartsOn === undefined,
    ).length,
    processedCount: page.page.length,
  };
}

const batchArgs = {
  cursor: v.optional(v.union(v.string(), v.null())),
  limit: v.optional(v.number()),
};

export const backfillReportingCycleStart = internalMutation({
  args: {
    ...batchArgs,
    dryRun: v.optional(v.boolean()),
  },
  handler: backfillReportingCycleStartWithCtx,
});

export const verifyReportingCycleStart = internalQuery({
  args: batchArgs,
  handler: verifyReportingCycleStartWithCtx,
});
