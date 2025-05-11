import { v } from "convex/values";

// User reward points
export const rewardPointsSchema = v.object({
  storeFrontUserId: v.id("storeFrontUser"),
  points: v.number(),
  storeId: v.id("store"),
  updatedAt: v.number(),
});

// Reward point transactions
export const rewardTransactionSchema = v.object({
  storeFrontUserId: v.id("storeFrontUser"),
  storeId: v.id("store"),
  points: v.number(), // positive for earned, negative for spent
  orderId: v.optional(v.id("onlineOrder")),
  reason: v.string(), // "order_placed", "referral", "points_redeemed", etc.
  orderNumber: v.optional(v.string()),
});

// Reward tiers/redemption rules
export const rewardTierSchema = v.object({
  storeId: v.id("store"),
  name: v.string(),
  pointsRequired: v.number(),
  discountType: v.union(v.literal("percentage"), v.literal("fixed")),
  discountValue: v.number(),
  isActive: v.boolean(),
});
