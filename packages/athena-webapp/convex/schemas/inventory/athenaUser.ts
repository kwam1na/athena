import { v } from "convex/values";

export const athenaUserSchema = v.object({
  email: v.string(),
  normalizedEmail: v.optional(v.string()),
  firstName: v.optional(v.string()),
  lastName: v.optional(v.string()),
  phoneNumber: v.optional(v.string()),
  organizationId: v.optional(v.id("organization")),
});
