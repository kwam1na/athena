import { v } from "convex/values";

export const onlineOrderItemSchema = v.object({
  orderId: v.id("onlineOrder"),
  customerId: v.union(v.id("customer"), v.id("guest")),
  productId: v.id("product"),
  productSkuId: v.id("productSku"),
  productSku: v.string(),
  quantity: v.number(),
  isReady: v.optional(v.boolean()),
  isUnavailable: v.optional(v.boolean()),
  isRefunded: v.optional(v.boolean()),
  isRestocked: v.optional(v.boolean()),
});
