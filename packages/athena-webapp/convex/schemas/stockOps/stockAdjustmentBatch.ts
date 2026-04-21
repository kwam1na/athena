import { v } from "convex/values";

export const stockAdjustmentBatchSchema = v.object({
  storeId: v.id("store"),
  organizationId: v.optional(v.id("organization")),
  adjustmentType: v.union(v.literal("manual"), v.literal("cycle_count")),
  status: v.union(
    v.literal("pending_approval"),
    v.literal("applied"),
    v.literal("rejected"),
    v.literal("cancelled")
  ),
  submissionKey: v.string(),
  reasonCode: v.string(),
  lineItemCount: v.number(),
  netQuantityDelta: v.number(),
  largestAbsoluteDelta: v.number(),
  approvalRequired: v.boolean(),
  createdByUserId: v.optional(v.id("athenaUser")),
  operationalWorkItemId: v.optional(v.id("operationalWorkItem")),
  approvalRequestId: v.optional(v.id("approvalRequest")),
  notes: v.optional(v.string()),
  lineItems: v.array(
    v.object({
      productId: v.optional(v.id("product")),
      productSkuId: v.id("productSku"),
      productName: v.optional(v.string()),
      sku: v.optional(v.string()),
      systemQuantity: v.number(),
      countedQuantity: v.optional(v.number()),
      quantityDelta: v.number(),
    })
  ),
  createdAt: v.number(),
  appliedAt: v.optional(v.number()),
  decidedAt: v.optional(v.number()),
});
