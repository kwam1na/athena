import { v } from "convex/values";

export const posTransactionItemSchema = v.object({
  transactionId: v.id("posTransaction"),
  productId: v.id("product"),
  productSkuId: v.id("productSku"),
  pendingCheckoutItemId: v.optional(v.id("posPendingCheckoutItem")),
  inventoryImportProvisionalSkuId: v.optional(v.id("inventoryImportProvisionalSku")),
  productName: v.string(),
  productSku: v.string(), // human-readable SKU reference
  barcode: v.optional(v.string()),
  image: v.optional(v.string()),
  quantity: v.number(),
  unitPrice: v.number(),
  totalPrice: v.number(),
  discount: v.optional(v.number()),
  discountReason: v.optional(v.string()),
  isRefunded: v.optional(v.boolean()),
  refundedQuantity: v.optional(v.number()),
  refundedAt: v.optional(v.number()),
  // U10: deterministic idempotency marker for the cedis→pesewas migration.
  pesewasMigratedAt: v.optional(v.number()),
});
