import { v } from "convex/values";

export const appVerificationCodeSchema = v.object({
  email: v.string(),
  firstName: v.optional(v.string()),
  lastName: v.optional(v.string()),
  code: v.string(),
  expiration: v.number(),
  isUsed: v.boolean(),
});
