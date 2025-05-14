import { v } from "convex/values";

export const offerSchema = v.object({
  email: v.string(),
  promoCodeId: v.id("promoCode"),
  storeFrontUserId: v.union(v.id("guest"), v.id("storeFrontUser")),
  storeId: v.id("store"),
  status: v.union(v.literal("pending"), v.literal("sent"), v.literal("error")),
  sentAt: v.optional(v.number()),
  errorMessage: v.optional(v.string()),
  ipAddress: v.optional(v.string()), // For rate limiting
});
