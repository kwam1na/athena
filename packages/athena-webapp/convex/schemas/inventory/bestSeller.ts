import { v } from "convex/values";

export const bestSellerSchema = v.object({
  rank: v.optional(v.number()),
  productId: v.id("product"),
  productSkuId: v.id("productSku"),
  storeId: v.id("store"),
});
