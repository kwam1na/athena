import { v } from "convex/values";

export const storeFrontUserSchema = v.object({
  email: v.string(),
  firstName: v.optional(v.string()),
  lastName: v.optional(v.string()),
  phoneNumber: v.optional(v.string()),
  storeId: v.id("store"),
});
