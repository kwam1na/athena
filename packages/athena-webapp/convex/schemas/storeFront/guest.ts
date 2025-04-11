import { v } from "convex/values";

export const guestSchema = v.object({
  marker: v.optional(v.string()),
  creationOrigin: v.optional(v.string()),
  email: v.optional(v.string()),
  firstName: v.optional(v.string()),
  lastName: v.optional(v.string()),
  phoneNumber: v.optional(v.string()),
  storeId: v.optional(v.id("store")),
  organizationId: v.optional(v.id("organization")),
});
