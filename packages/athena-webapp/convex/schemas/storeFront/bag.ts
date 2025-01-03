import { v } from "convex/values";

export const bagSchema = v.object({
  storeFrontUserId: v.union(v.id("storeFrontUser"), v.id("guest")),
  storeId: v.id("store"),
  updatedAt: v.number(),
});
