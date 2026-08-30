import { v } from "convex/values";

/** Additive capability fence. Absence retains the legacy reporting readers. */
export const reportPipelineControlSchema = v.object({
  storeId: v.id("store"),
  mode: v.union(v.literal("shadow"), v.literal("active"), v.literal("paused")),
  fence: v.number(),
  sourceWatermark: v.number(),
  acceptedWatermark: v.optional(v.number()),
  // Enduring eligibility, not a live epoch pointer or auto-activation policy.
  // Preserve through resets; each migration separately chooses whether to resume.
  hasActivated: v.optional(v.boolean()),
  // Reseed reconstructs observation times; older accepted cohorts cannot be
  // independently replayed from the replacement fact ledger.
  acceptedReplayUnavailableBefore: v.optional(v.number()),
  targetRollupEpoch: v.optional(v.string()),
  activeRollupEpoch: v.optional(v.string()),
});

/** One rotation cursor per bounded reports lane, not per work item. */
export const reportPipelineCursorSchema = v.object({
  lane: v.string(),
  lastStoreId: v.string(),
  updatedAt: v.number(),
});
