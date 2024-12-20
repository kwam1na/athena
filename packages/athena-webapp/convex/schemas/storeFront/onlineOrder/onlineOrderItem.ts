import { v } from "convex/values";

export const onlineOrderItemSchema = v.object({
  orderId: v.id("onlineOrder"),
  customerId: v.union(v.id("customer"), v.id("guest")),
  productId: v.id("product"),
  productSkuId: v.id("productSku"),
  productSku: v.string(),
  quantity: v.number(),
});
