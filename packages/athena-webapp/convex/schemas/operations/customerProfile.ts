import { v } from "convex/values";

export const customerProfileSchema = v.object({
  storeId: v.id("store"),
  organizationId: v.optional(v.id("organization")),
  fullName: v.string(),
  firstName: v.optional(v.string()),
  lastName: v.optional(v.string()),
  email: v.optional(v.string()),
  phoneNumber: v.optional(v.string()),
  preferredContactChannel: v.optional(v.string()),
  notes: v.optional(v.string()),
  status: v.union(v.literal("active"), v.literal("archived")),
  tags: v.optional(v.array(v.string())),
  storeFrontUserId: v.optional(v.id("storeFrontUser")),
  guestId: v.optional(v.id("guest")),
  posCustomerId: v.optional(v.id("posCustomer")),
});
