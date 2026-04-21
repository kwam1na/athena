import { v } from "convex/values";

export const organizationMemberSchema = v.object({
  userId: v.id("athenaUser"),
  organizationId: v.id("organization"),
  role: v.union(v.literal("full_admin"), v.literal("pos_only")),
  operationalRoles: v.optional(
    v.array(
      v.union(
        v.literal("manager"),
        v.literal("front_desk"),
        v.literal("stylist"),
        v.literal("technician"),
        v.literal("cashier")
      )
    )
  ),
});
