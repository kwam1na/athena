import { v } from "convex/values";
export const retentionLane = v.union(v.literal("close"), v.literal("rollup"));
export const reportPipelineRetentionSchema = v.object({
  storeId: v.id("store"),
  lane: retentionLane,
  cursor: v.union(v.string(), v.null()),
  eligibleAt: v.number(),
  fence: v.number(),
  claimed: v.boolean(),
  lastFailureAt: v.optional(v.number()),
});
