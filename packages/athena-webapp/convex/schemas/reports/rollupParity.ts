import { v } from "convex/values";

/** Recomputable target proof, bound to the source watermark and control fence. */
export const reportRollupParitySchema = v.object({
  storeId: v.id("store"),
  epoch: v.string(),
  controlFence: v.number(),
  sourceWatermark: v.number(),
  phase: v.union(
    v.literal("inputs"),
    v.literal("checkpoints"),
    v.literal("outputs"),
    v.literal("ready"),
    v.literal("blocked"),
  ),
  cursor: v.union(v.string(), v.null()),
  inputId: v.optional(v.id("reportRollupInput")),
  nextInputCursor: v.optional(v.union(v.string(), v.null())),
  inputPageDone: v.optional(v.boolean()),
  chunkOrdinal: v.number(),
  rowOffset: v.number(),
  lastSkuId: v.optional(v.string()),
  inputRows: v.number(),
  checkpointRows: v.number(),
  outputRows: v.number(),
  reason: v.optional(
    v.union(
      v.literal("not_drained"),
      v.literal("input_mismatch"),
      v.literal("checkpoint_mismatch"),
      v.literal("output_mismatch"),
    ),
  ),
  updatedAt: v.number(),
});
