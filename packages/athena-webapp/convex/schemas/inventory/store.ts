import { v } from "convex/values";

export const storeSchema = v.object({
  name: v.string(),
  currency: v.string(),
  slug: v.string(),
  createdByUserId: v.id("users"),
  organizationId: v.id("organization"),
});
