import { v } from "convex/values";

export const receivingBatchSchema = v.object({
  storeId: v.id("store"),
  organizationId: v.optional(v.id("organization")),
  purchaseOrderId: v.id("purchaseOrder"),
  submissionKey: v.string(),
  lineItemCount: v.number(),
  totalUnits: v.number(),
  receivedByUserId: v.optional(v.id("athenaUser")),
  notes: v.optional(v.string()),
  lineItems: v.array(
    v.object({
      purchaseOrderLineItemId: v.id("purchaseOrderLineItem"),
      productSkuId: v.id("productSku"),
      receivedQuantity: v.number(),
    })
  ),
  createdAt: v.number(),
  receivedAt: v.number(),
});
