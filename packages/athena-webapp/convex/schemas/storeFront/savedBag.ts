import { v } from "convex/values";

export const savedBagSchema = v.object({
  customerId: v.union(v.id("customer"), v.id("guest")),
  storeId: v.id("store"),
  updatedAt: v.number(),
});
