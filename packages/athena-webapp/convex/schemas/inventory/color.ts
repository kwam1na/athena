import { v } from "convex/values";

export const colorSchema = v.object({
  name: v.string(),
  hexCode: v.optional(v.string()),
  storeId: v.id("store"),
});
