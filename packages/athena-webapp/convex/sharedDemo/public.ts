import { v } from "convex/values";

import { mutation, query } from "../_generated/server";
import { requireSharedDemoActorWithCtx } from "./actor";
import { restoreBaselineWithCtx } from "./restore";

const contextResult = v.union(
  v.null(),
  v.object({
    baselineVersion: v.number(),
    kind: v.literal("shared_demo"),
    nextHourlyRestoreAt: v.number(),
    restore: v.object({
      completedAt: v.optional(v.number()),
      epoch: v.number(),
      failureCode: v.optional(v.string()),
      startedAt: v.optional(v.number()),
      status: v.union(v.literal("ready"), v.literal("restoring"), v.literal("failed")),
    }),
    storeId: v.id("store"),
  }),
);

export const getContext = query({
  args: {},
  returns: contextResult,
  handler: async (ctx) => {
    let actor;
    try { actor = await requireSharedDemoActorWithCtx(ctx); } catch { return null; }
    const state = await ctx.db.query("sharedDemoRestoreState").withIndex("by_storeId", (q) => q.eq("storeId", actor.storeId)).unique();
    if (!state) return null;
    const hour = 3_600_000;
    return {
      baselineVersion: state.baselineVersion,
      kind: "shared_demo" as const,
      nextHourlyRestoreAt: (Math.floor(Date.now() / hour) + 1) * hour,
      restore: {
        completedAt: state.completedAt,
        epoch: state.epoch,
        failureCode: state.failureCode,
        startedAt: state.startedAt,
        status: state.status,
      },
      storeId: actor.storeId,
    };
  },
});

export const requestManualRestore = mutation({
  args: { idempotencyKey: v.string() },
  returns: v.object({
    baselineVersion: v.number(),
    epoch: v.number(),
    kind: v.union(v.literal("started"), v.literal("already_running"), v.literal("rate_limited"), v.literal("failed")),
  }),
  handler: async (ctx, args) => {
    const actor = await requireSharedDemoActorWithCtx(ctx);
    if (!/^[A-Za-z0-9_-]{8,100}$/.test(args.idempotencyKey)) throw new Error("Restore request is invalid.");
    const latest = await ctx.db.query("sharedDemoRestoreAudit").withIndex("by_storeId_occurredAt", (q) => q.eq("storeId", actor.storeId)).order("desc").first();
    if (latest?.source === "manual" && latest.occurredAt > Date.now() - 60_000) {
      const state = await ctx.db.query("sharedDemoRestoreState").withIndex("by_storeId", (q) => q.eq("storeId", actor.storeId)).unique();
      return { baselineVersion: state?.baselineVersion ?? 1, epoch: state?.epoch ?? 0, kind: "rate_limited" as const };
    }
    const result = await restoreBaselineWithCtx(ctx, { idempotencyKey: args.idempotencyKey, source: "manual", storeId: actor.storeId });
    return {
      baselineVersion: result.baselineVersion,
      epoch: result.epoch,
      kind: result.kind === "started" ? "started" as const : result.kind === "failed" ? "failed" as const : "already_running" as const,
    };
  },
});
