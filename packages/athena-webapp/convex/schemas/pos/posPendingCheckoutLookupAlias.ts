import { v } from "convex/values";

export const posPendingCheckoutLookupAliasStatusValidator = v.union(
  v.literal("active"),
  v.literal("conflicted"),
  v.literal("retired"),
);

export const posPendingCheckoutLookupAliasSchema = v.object({
  storeId: v.id("store"),
  organizationId: v.id("organization"),
  normalizedLookupCode: v.string(),
  pendingCheckoutItemId: v.id("posPendingCheckoutItem"),
  productId: v.id("product"),
  productSkuId: v.id("productSku"),
  status: posPendingCheckoutLookupAliasStatusValidator,
  conflictReason: v.optional(v.string()),
  createdAt: v.number(),
  updatedAt: v.number(),
});
