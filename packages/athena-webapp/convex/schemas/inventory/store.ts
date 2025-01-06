import { v } from "convex/values";

export const storeSchema = v.object({
  config: v.optional(v.record(v.string(), v.any())),
  name: v.string(),
  currency: v.string(),
  slug: v.string(),
  createdByUserId: v.id("users"),
  organizationId: v.id("organization"),
});
