import { v } from "convex/values";

export const inventoryHoldSchema = v.object({
  storeId: v.id("store"),
  productSkuId: v.id("productSku"),
  sourceType: v.literal("posSession"),
  sourceSessionId: v.id("posSession"),
  status: v.union(
    v.literal("active"),
    v.literal("released"),
    v.literal("consumed"),
    v.literal("expired"),
  ),
  quantity: v.number(),
  expiresAt: v.number(),
  createdAt: v.number(),
  updatedAt: v.number(),
  releasedAt: v.optional(v.number()),
  consumedAt: v.optional(v.number()),
  expiredAt: v.optional(v.number()),
});
