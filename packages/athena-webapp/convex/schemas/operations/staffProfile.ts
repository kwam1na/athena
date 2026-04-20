import { v } from "convex/values";

export const staffProfileSchema = v.object({
  storeId: v.id("store"),
  organizationId: v.id("organization"),
  userId: v.id("athenaUser"),
  memberRole: v.union(v.literal("full_admin"), v.literal("pos_only")),
  fullName: v.string(),
  firstName: v.optional(v.string()),
  lastName: v.optional(v.string()),
  email: v.string(),
  phoneNumber: v.optional(v.string()),
  status: v.union(v.literal("active"), v.literal("inactive")),
});
