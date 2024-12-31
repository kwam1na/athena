import { v } from "convex/values";

export const featuredItemSchema = v.object({
  productId: v.optional(v.id("product")),
  categoryId: v.optional(v.id("category")),
  subcategoryId: v.optional(v.id("subcategory")),
  storeId: v.id("store"),
  rank: v.optional(v.number()),
});
