import { v } from "convex/values";

export const staffRoleAssignmentSchema = v.object({
  staffProfileId: v.id("staffProfile"),
  storeId: v.id("store"),
  organizationId: v.id("organization"),
  role: v.union(
    v.literal("manager"),
    v.literal("front_desk"),
    v.literal("stylist"),
    v.literal("technician"),
    v.literal("cashier")
  ),
  isPrimary: v.boolean(),
  status: v.union(v.literal("active"), v.literal("inactive")),
  assignedAt: v.number(),
});
