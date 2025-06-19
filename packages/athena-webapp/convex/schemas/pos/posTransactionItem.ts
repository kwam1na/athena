import { v } from "convex/values";

export const posTransactionItemSchema = v.object({
  transactionId: v.id("posTransaction"),
  productId: v.id("product"),
  productSkuId: v.id("productSku"),
  productName: v.string(),
  productSku: v.string(), // barcode
  quantity: v.number(),
  unitPrice: v.number(),
  totalPrice: v.number(),
  discount: v.optional(v.number()),
  discountReason: v.optional(v.string()),
  isRefunded: v.optional(v.boolean()),
  refundedQuantity: v.optional(v.number()),
  refundedAt: v.optional(v.number()),
});
