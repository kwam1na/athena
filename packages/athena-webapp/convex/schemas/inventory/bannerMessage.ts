import { v } from "convex/values";

export const bannerMessageSchema = v.object({
  storeId: v.id("store"),
  heading: v.optional(v.string()),
  message: v.optional(v.string()),
  active: v.boolean(),
});
