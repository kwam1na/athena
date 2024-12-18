import { v } from "convex/values";

export const checkoutSessionItemSchema = v.object({
  sesionId: v.id("checkoutSession"),
  customerId: v.union(v.id("customer"), v.id("guest")),
  productId: v.id("product"),
  productSkuId: v.id("productSku"),
  productSku: v.string(),
  quantity: v.number(),
});
