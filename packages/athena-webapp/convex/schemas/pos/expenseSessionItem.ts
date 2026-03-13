import { v } from "convex/values";

export const expenseSessionItemSchema = v.object({
  sessionId: v.id("expenseSession"),
  storeId: v.id("store"),

  // Product references
  productId: v.id("product"),
  productSkuId: v.id("productSku"),
  productSku: v.string(), // human-readable SKU reference
  barcode: v.optional(v.string()),

  // Item details
  productName: v.string(),
  price: v.number(), // Cost price for record keeping
  quantity: v.number(),

  // Optional attributes
  image: v.optional(v.string()),
  size: v.optional(v.string()),
  length: v.optional(v.number()),
  color: v.optional(v.string()),

  // Timestamps
  createdAt: v.number(),
  updatedAt: v.number(),
});
