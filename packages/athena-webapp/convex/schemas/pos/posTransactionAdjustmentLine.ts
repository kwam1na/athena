import { v } from "convex/values";

export const posTransactionAdjustmentLineSchema = v.object({
  adjustmentId: v.id("posTransactionAdjustment"),
  storeId: v.id("store"),
  transactionId: v.id("posTransaction"),
  lineType: v.union(v.literal("existing"), v.literal("added")),
  originalTransactionItemId: v.optional(v.id("posTransactionItem")),
  pendingCheckoutItemId: v.optional(v.id("posPendingCheckoutItem")),
  productId: v.id("product"),
  productSkuId: v.id("productSku"),
  productName: v.string(),
  productSku: v.string(),
  originalQuantity: v.number(),
  correctedQuantity: v.number(),
  quantityDelta: v.number(),
  unitPrice: v.number(),
  originalTotal: v.number(),
  correctedTotal: v.number(),
  inventoryDelta: v.number(),
  createdAt: v.number(),
});
