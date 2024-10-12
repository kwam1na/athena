import { v } from "convex/values";

export const bagSchema = v.object({
  customerId: v.union(v.id("customer"), v.id("guest")),
  storeId: v.id("store"),
  updatedAt: v.number(),
});
