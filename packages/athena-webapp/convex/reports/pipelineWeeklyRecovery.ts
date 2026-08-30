import { v } from "convex/values";
import { internalMutation, type MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { readPipelineControl } from "./pipelineControl";
import { readStoreAllowlist } from "./sweeper";
import { enqueueReportWork } from "./pipelineWork";
import { publishCloseLifecycleWithCtx } from "./closeEvidence";

export const WEEKLY_RECOVERY_INTERVAL_MS = 15 * 60_000;
export const WEEKLY_CURRENT_CLOCK_INTERVAL_MS = 60 * 60_000;

async function closeRecoveryPage(
  ctx: MutationCtx,
  storeId: Id<"store">,
  cursor: string | null,
) {
  return ctx.db
    .query("dailyClose")
    .withIndex("by_storeId_operatingDate", (q) => q.eq("storeId", storeId))
    .order("asc")
    .paginate({ cursor, numItems: 1 });
}

async function acceptedRecoveryPage(
  ctx: MutationCtx,
  storeId: Id<"store">,
  cursor: string | null,
) {
  return ctx.db
    .query("reportWeekAccepted")
    .withIndex("by_storeId_cycleStartDate", (q) => q.eq("storeId", storeId))
    .order("asc")
    .paginate({ cursor, numItems: 16 });
}

/** Explicit source-backed recovery. One source close, never a newest-N census.
 * Independent cursors rotate to the beginning at EOF, so quiet history and
 * schedule changes eventually receive the same exact handoffs as fresh writes.
 */
export async function maintainWeeklyWorkWithCtx(
  ctx: MutationCtx,
  storeId: Id<"store">,
  now: number,
) {
  const control = await readPipelineControl(ctx, storeId);
  if (control?.mode !== "active" || !readStoreAllowlist().has(String(storeId)))
    return "deferred" as const;
  const store = await ctx.db.get("store", storeId);
  if (!store || store.reportingReseedStartedAt !== undefined)
    return "deferred" as const;
  const state = await ctx.db
    .query("reportWeeklyRecovery")
    .withIndex("by_storeId", (q) => q.eq("storeId", storeId))
    .unique();
  let nextCurrentAt = state?.nextCurrentAt ?? 0;
  if (now >= nextCurrentAt) {
    const pending = await ctx.db
      .query("reportPipelineWork")
      .withIndex("by_storeId_kind_createdAt", (q) =>
        q.eq("storeId", storeId).eq("kind", "current"),
      )
      .first();
    if (!pending)
      await enqueueReportWork(ctx, { storeId, kind: "current" }, now);
    nextCurrentAt = now + WEEKLY_CURRENT_CLOCK_INTERVAL_MS;
  }
  if (state && now < state.nextRunAt) {
    if (nextCurrentAt !== state.nextCurrentAt)
      await ctx.db.patch("reportWeeklyRecovery", state._id, { nextCurrentAt });
    return "not-due" as const;
  }
  const lane = state?.lane ?? "close";
  let closeCursor = state?.closeCursor;
  let acceptedCursor = state?.acceptedCursor;
  if (lane === "close") {
    const page = await closeRecoveryPage(ctx, storeId, closeCursor ?? null);
    for (const close of page.page) {
      await publishCloseLifecycleWithCtx(ctx, close, now);
      await enqueueReportWork(
        ctx,
        {
          storeId,
          kind: "resolve-week-date",
          operatingDate: close.operatingDate,
        },
        now,
      );
    }
    closeCursor = page.isDone ? undefined : page.continueCursor;
  } else {
    const page = await acceptedRecoveryPage(
      ctx,
      storeId,
      acceptedCursor ?? null,
    );
    for (const accepted of page.page)
      await enqueueReportWork(
        ctx,
        { storeId, kind: "refresh", cycleStartDate: accepted.cycleStartDate },
        now,
      );
    acceptedCursor = page.isDone ? undefined : page.continueCursor;
  }
  const next = {
    storeId,
    closeCursor,
    acceptedCursor,
    lane: lane === "close" ? ("accepted" as const) : ("close" as const),
    nextRunAt: now + WEEKLY_RECOVERY_INTERVAL_MS,
    nextCurrentAt,
  };
  if (state) await ctx.db.patch("reportWeeklyRecovery", state._id, next);
  else await ctx.db.insert("reportWeeklyRecovery", next);
  return "applied" as const;
}

export const runRecovery = internalMutation({
  args: { storeId: v.id("store"), controlFence: v.number() },
  returns: v.union(
    v.literal("applied"),
    v.literal("deferred"),
    v.literal("not-due"),
  ),
  handler: async (ctx, args) => {
    const control = await readPipelineControl(ctx, args.storeId);
    if (control?.fence !== args.controlFence) return "deferred";
    return maintainWeeklyWorkWithCtx(ctx, args.storeId, Date.now());
  },
});
