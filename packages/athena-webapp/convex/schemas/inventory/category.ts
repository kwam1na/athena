import { v } from "convex/values";

export const categorySchema = v.object({
  description: v.optional(v.string()),
  name: v.string(),
  showOnStorefront: v.optional(v.boolean()),
  slug: v.string(),
  storeId: v.id("store"),
});
