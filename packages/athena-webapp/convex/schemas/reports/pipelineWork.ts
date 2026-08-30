import { v } from "convex/values";

export const reportPipelineWorkKindValidator = v.union(
  v.literal("close-evidence"),
  v.literal("resolve-week-date"),
  v.literal("current"),
  v.literal("accept"),
  v.literal("refresh"),
  v.literal("rollup"),
  v.literal("overview"),
  v.literal("inventory"),
);

export const reportPipelineWorkFailureCodeValidator = v.union(
  v.literal("unexpected_failure"),
  v.literal("capacity_exceeded"),
  v.literal("missing_evidence"),
  v.literal("invalid_evidence"),
  v.literal("missing_schedule"),
  v.literal("missing_timezone"),
  v.literal("schedule_history_cap"),
  v.literal("matching_fold_pending"),
  v.literal("store_reseeding"),
  v.literal("coverage_incomplete"),
  v.literal("stale_source"),
);

const common = {
  storeId: v.id("store"),
  workKey: v.string(),
  generation: v.number(),
  dispatchFence: v.number(),
  status: v.union(v.literal("pending"), v.literal("blocked")),
  createdAt: v.number(),
  updatedAt: v.number(),
  eligibleAt: v.number(),
  attempts: v.number(),
  claimedAt: v.optional(v.number()),
  leaseUntil: v.optional(v.number()),
  lastFailure: v.optional(
    v.object({
      code: reportPipelineWorkFailureCodeValidator,
      at: v.number(),
    }),
  ),
};

/** Reports-local exact work; never carry source detail or an unbounded date list. */
export const reportPipelineWorkSchema = v.union(
  v.object({
    ...common,
    kind: v.literal("close-evidence"),
    closeId: v.id("dailyClose"),
  }),
  v.object({
    ...common,
    kind: v.literal("resolve-week-date"),
    operatingDate: v.string(),
  }),
  v.object({ ...common, kind: v.literal("current") }),
  v.object({
    ...common,
    kind: v.literal("accept"),
    cycleStartDate: v.string(),
    closeId: v.id("dailyClose"),
    cutoffObservedAt: v.number(),
  }),
  v.object({
    ...common,
    kind: v.literal("refresh"),
    cycleStartDate: v.string(),
  }),
  v.object({ ...common, kind: v.literal("rollup"), operatingDate: v.string() }),
  v.object({ ...common, kind: v.literal("overview") }),
  v.object({ ...common, kind: v.literal("inventory") }),
);
