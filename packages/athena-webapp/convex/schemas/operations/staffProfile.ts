import { v } from "convex/values";

export const staffProfileSchema = v.object({
  storeId: v.id("store"),
  organizationId: v.id("organization"),
  memberRole: v.optional(
    v.union(v.literal("full_admin"), v.literal("pos_only"))
  ),
  fullName: v.string(),
  firstName: v.string(),
  lastName: v.string(),
  email: v.optional(v.string()),
  phoneNumber: v.optional(v.string()),
  staffCode: v.optional(v.string()),
  jobTitle: v.optional(v.string()),
  hiredAt: v.optional(v.number()),
  notes: v.optional(v.string()),
  createdByUserId: v.optional(v.id("athenaUser")),
  updatedByUserId: v.optional(v.id("athenaUser")),
  linkedUserId: v.optional(v.id("athenaUser")),
  status: v.union(v.literal("active"), v.literal("inactive")),
});
