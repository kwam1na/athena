import { v } from "convex/values";
import { operationalRoleValidator } from "../../operations/staffRoles";

export const staffRoleAssignmentSchema = v.object({
  staffProfileId: v.id("staffProfile"),
  storeId: v.id("store"),
  organizationId: v.id("organization"),
  role: operationalRoleValidator,
  isPrimary: v.boolean(),
  status: v.union(v.literal("active"), v.literal("inactive")),
  assignedAt: v.number(),
});
