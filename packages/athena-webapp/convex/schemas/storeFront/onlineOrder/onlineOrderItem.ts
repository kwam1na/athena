import { v } from "convex/values";

export const onlineOrderItemSchema = v.object({
  isReady: v.optional(v.boolean()),
  isRefunded: v.optional(v.boolean()),
  isRestocked: v.optional(v.boolean()),
  isUnavailable: v.optional(v.boolean()),
  orderId: v.id("onlineOrder"),
  price: v.number(),
  productId: v.id("product"),
  productSku: v.string(),
  productSkuId: v.id("productSku"),
  productName: v.optional(v.string()),
  productImage: v.optional(v.string()),
  quantity: v.number(),
  storeFrontUserId: v.union(v.id("storeFrontUser"), v.id("guest")),
});
