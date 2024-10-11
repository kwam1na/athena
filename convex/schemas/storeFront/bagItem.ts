import { v } from "convex/values";

export const bagItemSchema = v.object({
  bagId: v.id("bag"),
  customerId: v.id("customer"),
  price: v.number(),
  productId: v.id("product"),
  quantity: v.number(),
  _updatedAt: v.number(),
});
