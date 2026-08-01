import { v } from "convex/values";

import type { Doc, Id } from "../_generated/dataModel";
import { internalMutation, type MutationCtx } from "../_generated/server";
import {
  ensureTimezoneAuthorityForScheduleWithCtx,
  listTimezoneVersionsForStoreWithCtx,
} from "../storeTime/ensureTimezoneAuthority";

type BackfillArgs = {
  cursor?: string | null;
  dryRun?: boolean;
  limit?: number;
};

type BackfillRow = {
  action: "inserted" | "needs_review" | "skipped_existing" | "would_insert";
  reason?: string;
  storeId: Id<"store">;
  timezone?: string;
  timezoneVersionId?: Id<"storeTimezoneVersion">;
};

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;
const SCHEDULE_READ_LIMIT = 100;

function normalizeLimit(limit?: number) {
  if (limit === undefined || !Number.isInteger(limit) || limit <= 0) {
    return DEFAULT_LIMIT;
  }
  return Math.min(limit, MAX_LIMIT);
}

async function listSchedulesForStore(
  ctx: Pick<MutationCtx, "db">,
  store: Doc<"store">,
) {
  return await ctx.db
    .query("storeSchedule")
    .withIndex("by_organizationId_storeId_status", (schedule) =>
      schedule.eq("organizationId", store.organizationId).eq("storeId", store._id),
    )
    .take(SCHEDULE_READ_LIMIT);
}

async function buildRow(
  ctx: MutationCtx,
  args: { dryRun: boolean; store: Doc<"store"> },
): Promise<BackfillRow> {
  const versions = await listTimezoneVersionsForStoreWithCtx(ctx, args.store._id);
  if (versions.length > 0) {
    return {
      action: "skipped_existing",
      storeId: args.store._id,
      timezoneVersionId: versions[0]._id,
    };
  }

  const schedules = await listSchedulesForStore(ctx, args.store);
  if (schedules.length === 0) {
    return {
      action: "needs_review",
      reason: "No schedule evidence is available.",
      storeId: args.store._id,
    };
  }

  const timezones = new Set(schedules.map((schedule) => schedule.timezone));
  if (timezones.size !== 1) {
    return {
      action: "needs_review",
      reason: "Historical schedules disagree on timezone.",
      storeId: args.store._id,
    };
  }

  const schedule = schedules
    .slice()
    .sort((left, right) => left.effectiveFrom - right.effectiveFrom)[0];
  const actorUserId =
    schedule.createdByUserId ??
    schedule.updatedByUserId ??
    schedules.find((candidate) => candidate.createdByUserId)?.createdByUserId ??
    schedules.find((candidate) => candidate.updatedByUserId)?.updatedByUserId;
  if (!actorUserId) {
    return {
      action: "needs_review",
      reason: "Schedule evidence has no attributable author.",
      storeId: args.store._id,
      timezone: schedule.timezone,
    };
  }

  if (args.dryRun) {
    return {
      action: "would_insert",
      storeId: args.store._id,
      timezone: schedule.timezone,
    };
  }

  const result = await ensureTimezoneAuthorityForScheduleWithCtx(ctx, {
    actorUserId,
    schedule,
  });
  for (const relatedSchedule of schedules) {
    if (
      relatedSchedule._id !== schedule._id &&
      relatedSchedule.timezone === schedule.timezone &&
      !relatedSchedule.timezoneVersionId
    ) {
      await ctx.db.patch("storeSchedule", relatedSchedule._id, {
        timezoneVersionId: result.timezoneVersionId,
      });
    }
  }

  return {
    action: "inserted",
    storeId: args.store._id,
    timezone: schedule.timezone,
    timezoneVersionId: result.timezoneVersionId,
  };
}

export async function backfillStoreTimezoneAuthorityWithCtx(
  ctx: MutationCtx,
  args: BackfillArgs,
) {
  const dryRun = args.dryRun !== false;
  const page = await ctx.db.query("store").paginate({
    numItems: normalizeLimit(args.limit),
    cursor: args.cursor ?? null,
  });
  const rows: BackfillRow[] = [];

  for (const store of page.page) {
    rows.push(await buildRow(ctx, { dryRun, store }));
  }

  return {
    cursor: page.continueCursor,
    dryRun,
    insertedCount: rows.filter((row) => row.action === "inserted").length,
    isDone: page.isDone,
    needsReviewCount: rows.filter((row) => row.action === "needs_review").length,
    processedCount: rows.length,
    rows,
  };
}

export const backfillStoreTimezoneAuthority = internalMutation({
  args: {
    cursor: v.optional(v.union(v.string(), v.null())),
    dryRun: v.optional(v.boolean()),
    limit: v.optional(v.number()),
  },
  handler: backfillStoreTimezoneAuthorityWithCtx,
});
