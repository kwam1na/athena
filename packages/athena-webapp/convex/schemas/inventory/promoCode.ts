import { v } from "convex/values";

export const promoCodeSchema = v.object({
  code: v.string(),
  storeId: v.id("store"),
  createdByUserId: v.id("athenaUser"),
});

export const promoCodeItemSchema = v.object({
  promoCodeId: v.id("promoCode"),
  productId: v.optional(v.id("product")),
  productSkuId: v.optional(v.id("productSku")),
  discountType: v.union(v.literal("percentage"), v.literal("amount")),
  discountValue: v.number(),
  limit: v.optional(v.number()),
  validFrom: v.number(),
  validTo: v.number(),
  active: v.boolean(),
});
