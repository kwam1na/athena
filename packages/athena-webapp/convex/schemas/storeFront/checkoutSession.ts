import { v } from "convex/values";

export const checkoutSessionSchema = v.object({
  customerId: v.union(v.id("customer"), v.id("guest")),
  storeId: v.id("store"),
  bagId: v.id("bag"),
  expiresAt: v.number(),
});
