import { v } from "convex/values";

export const subcategorySchema = v.object({
  description: v.optional(v.string()),
  name: v.string(),
  slug: v.string(),
  categoryId: v.id("category"),
  storeId: v.id("store"),
});
