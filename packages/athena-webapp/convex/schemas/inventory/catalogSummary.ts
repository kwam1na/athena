import { v } from "convex/values";

export const catalogSummarySchema = v.object({
  categoryCount: v.number(),
  missingInfoProductCount: v.number(),
  needsRefresh: v.optional(v.boolean()),
  outOfStockProductCount: v.number(),
  productCount: v.number(),
  storeId: v.id("store"),
  updatedAt: v.number(),
});
