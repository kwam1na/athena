import { v } from "convex/values";

export const vendorSchema = v.object({
  storeId: v.id("store"),
  organizationId: v.optional(v.id("organization")),
  name: v.string(),
  lookupKey: v.string(),
  code: v.optional(v.string()),
  contactName: v.optional(v.string()),
  email: v.optional(v.string()),
  phoneNumber: v.optional(v.string()),
  status: v.union(v.literal("active"), v.literal("inactive")),
  notes: v.optional(v.string()),
  createdByUserId: v.optional(v.id("athenaUser")),
  createdAt: v.number(),
});
