import { v } from "convex/values";

export const savedBagItemSchema = v.object({
  savedBagId: v.id("savedBag"),
  storeFrontUserId: v.union(v.id("storeFrontUser"), v.id("guest")),
  productId: v.id("product"),
  productSkuId: v.id("productSku"),
  productSku: v.string(),
  quantity: v.number(),
  updatedAt: v.number(),
});
