import { v } from "convex/values";

export const reportWeekInventorySchema = v.object({
  storeId: v.id("store"),
  frameKey: v.string(),
  materializedAt: v.number(),
  attention: v.object({
    carriedForwardCount: v.number(),
    completeness: v.union(
      v.literal("complete"),
      v.literal("incomplete"),
      v.literal("unavailable"),
    ),
    groups: v.array(
      v.object({
        classification: v.union(
          v.literal("carried_forward"),
          v.literal("new_this_week"),
        ),
        evidenceLimited: v.boolean(),
        hasNewActivity: v.boolean(),
        key: v.string(),
        memberCount: v.number(),
        productSkuId: v.union(v.id("productSku"), v.null()),
      }),
    ),
    newCount: v.number(),
    observedCount: v.number(),
    overflow: v.boolean(),
  }),
});
