import { v } from "convex/values";

export const posSessionItemSchema = v.object({
  sessionId: v.id("posSession"),
  storeId: v.id("store"),

  // Product references
  productId: v.id("product"),
  productSkuId: v.id("productSku"),
  productSku: v.string(), // barcode

  // Item details
  productName: v.string(),
  price: v.number(),
  quantity: v.number(),

  // Optional attributes
  image: v.optional(v.string()),
  size: v.optional(v.string()),
  length: v.optional(v.number()),
  areProcessingFeesAbsorbed: v.optional(v.boolean()),

  // Timestamps
  createdAt: v.number(),
  updatedAt: v.number(),
});
