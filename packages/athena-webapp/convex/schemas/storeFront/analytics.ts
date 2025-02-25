import { v } from "convex/values";

export const analyticsSchema = v.object({
  storeFrontUserId: v.union(v.id("storeFrontUser"), v.id("guest")),
  storeId: v.id("store"),
  origin: v.optional(v.string()),
  action: v.string(),
  data: v.record(v.string(), v.any()),
});
