import { v } from "convex/values";

export const receiptShareTokenSchema = v.object({
  storeId: v.id("store"),
  transactionId: v.id("posTransaction"),
  tokenHash: v.string(),
  status: v.union(
    v.literal("active"),
    v.literal("expired"),
    v.literal("revoked"),
  ),
  createdByStaffProfileId: v.optional(v.id("staffProfile")),
  createdAt: v.number(),
  expiresAt: v.number(),
  revokedAt: v.optional(v.number()),
});
