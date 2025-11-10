import { v } from "convex/values";

export const organizationMemberSchema = v.object({
  userId: v.id("athenaUser"),
  organizationId: v.id("organization"),
  role: v.union(v.literal("full_admin"), v.literal("pos_only")),
});
