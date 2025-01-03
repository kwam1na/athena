import { v } from "convex/values";

export const storeFrontVerificationCode = v.object({
  email: v.string(),
  firstName: v.optional(v.string()),
  lastName: v.optional(v.string()),
  code: v.string(),
  expiration: v.number(),
  storeId: v.id("store"),
  isUsed: v.boolean(),
});
