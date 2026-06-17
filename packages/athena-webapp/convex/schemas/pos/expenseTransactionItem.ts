import { v } from "convex/values";

export const expenseTransactionItemSchema = v.object({
  transactionId: v.id("expenseTransaction"),
  productId: v.id("product"),
  productSkuId: v.id("productSku"),
  pendingCheckoutItemId: v.optional(v.id("posPendingCheckoutItem")),
  inventoryImportProvisionalSkuId: v.optional(
    v.id("inventoryImportProvisionalSku"),
  ),
  inventoryHoldApplied: v.optional(v.boolean()),
  productName: v.string(),
  productSku: v.string(), // human-readable SKU reference
  quantity: v.number(),
  costPrice: v.number(), // Cost price at time of expense
  image: v.optional(v.string()),
  size: v.optional(v.string()),
  length: v.optional(v.number()),
  color: v.optional(v.string()),
});
