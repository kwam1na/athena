import { v } from "convex/values";

export const checkoutSessionItemSchema = v.object({
  sesionId: v.id("checkoutSession"),
  storeFrontUserId: v.union(v.id("storeFrontUser"), v.id("guest")),
  productId: v.id("product"),
  productSkuId: v.id("productSku"),
  productSku: v.string(),
  price: v.number(),
  quantity: v.number(),
  // Idempotency marker for the cedis->pesewas backfill
  // (migrations/backfillAmountsToPesewas.ts). Set in the same patch that
  // converts the money fields; its presence means "already minor units".
  pesewasMigratedAt: v.optional(v.number()),
});
