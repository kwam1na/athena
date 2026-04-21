import { v } from "convex/values";

export const purchaseOrderLineItemSchema = v.object({
  purchaseOrderId: v.id("purchaseOrder"),
  storeId: v.id("store"),
  productId: v.optional(v.id("product")),
  productSkuId: v.id("productSku"),
  description: v.optional(v.string()),
  orderedQuantity: v.number(),
  receivedQuantity: v.number(),
  unitCost: v.number(),
  lineTotal: v.number(),
  createdAt: v.number(),
});
