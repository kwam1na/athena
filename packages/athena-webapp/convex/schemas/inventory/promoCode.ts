import { v } from "convex/values";

export const promoCodeSchema = v.object({
  code: v.string(),
  storeId: v.id("store"),
  discountType: v.union(v.literal("percentage"), v.literal("amount")),
  discountValue: v.number(),
  limit: v.optional(v.number()),
  validFrom: v.number(),
  validTo: v.number(),
  span: v.union(v.literal("entire-order"), v.literal("selected-products")),
  active: v.boolean(),
  displayText: v.string(),
  isExclusive: v.optional(v.boolean()),
  autoApply: v.optional(v.boolean()),
  sitewide: v.optional(v.boolean()),
  createdByUserId: v.id("athenaUser"),
});

export const promoCodeItemSchema = v.object({
  promoCodeId: v.id("promoCode"),
  storeId: v.id("store"),
  productId: v.optional(v.id("product")),
  productSkuId: v.optional(v.id("productSku")),
  quantity: v.optional(v.number()),
  quantityClaimed: v.optional(v.number()),
});
