import { v } from "convex/values";

export const offerSchema = v.object({
  email: v.string(),
  promoCodeId: v.id("promoCode"),
  storeFrontUserId: v.union(v.id("guest"), v.id("storeFrontUser")),
  storeId: v.id("store"),
  status: v.union(
    v.literal("pending"),
    v.literal("sent"),
    v.literal("error"),
    v.literal("redeemed"),
    v.literal("reminded")
  ),
  sentAt: v.optional(v.number()),
  errorMessage: v.optional(v.string()),
  isRedeemed: v.optional(v.boolean()),
  ipAddress: v.optional(v.string()), // For rate limiting
  activity: v.optional(
    v.array(
      v.object({
        action: v.string(),
        timestamp: v.number(),
      })
    )
  ),
});
