import { v } from "convex/values";

export const bagItemSchema = v.object({
  bagId: v.id("bag"),
  customerId: v.union(v.id("customer"), v.id("guest")),
  productId: v.id("product"),
  productSkuId: v.id("productSku"),
  productSku: v.string(),
  quantity: v.number(),
  updatedAt: v.number(),
});
