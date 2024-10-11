import { v } from "convex/values";

export const categorySchema = v.object({
  description: v.optional(v.string()),
  name: v.string(),
  storeId: v.id("store"),
});
