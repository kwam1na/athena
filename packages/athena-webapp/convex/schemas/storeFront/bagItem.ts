import { v } from "convex/values";

export const bagItemSchema = v.object({
  bagId: v.id("bag"),
  storeFrontUserId: v.union(v.id("storeFrontUser"), v.id("guest")),
  productId: v.id("product"),
  productSkuId: v.id("productSku"),
  price: v.optional(v.number()),
  productSku: v.string(),
  quantity: v.number(),
  updatedAt: v.number(),
  productCategory: v.optional(v.string()),
  colorName: v.optional(v.string()),
  productName: v.optional(v.string()),
  productImage: v.optional(v.string()),
  productSlug: v.optional(v.string()),
  otherBagsWithSku: v.optional(v.number()),
  size: v.optional(v.string()),
  length: v.optional(v.number()),
});
