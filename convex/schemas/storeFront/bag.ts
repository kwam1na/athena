import { v } from "convex/values";

export const bagSchema = v.object({
  customerId: v.id("customer"),
  storeId: v.id("store"),
  _updatedAt: v.number(),
});
