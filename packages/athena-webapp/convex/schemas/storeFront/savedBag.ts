import { v } from "convex/values";

export const savedBagSchema = v.object({
  storeFrontUserId: v.union(v.id("storeFrontUser"), v.id("guest")),
  storeId: v.id("store"),
  updatedAt: v.number(),
  items: v.array(v.any()),
});
