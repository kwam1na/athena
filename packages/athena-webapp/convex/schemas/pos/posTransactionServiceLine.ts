import { v } from "convex/values";

export const posTransactionServiceLineSchema = v.object({
  transactionId: v.id("posTransaction"),
  serviceCaseId: v.id("serviceCase"),
  serviceCatalogId: v.optional(v.id("serviceCatalog")),
  serviceName: v.string(),
  serviceMode: v.union(
    v.literal("same_day"),
    v.literal("consultation"),
    v.literal("repair"),
    v.literal("revamp"),
  ),
  pricingSource: v.union(
    v.literal("catalog_base_price"),
    v.literal("pos_entered"),
    v.literal("service_case_quote"),
    v.literal("deposit_rule"),
  ),
  quantity: v.number(),
  unitPrice: v.number(),
  totalPrice: v.number(),
  notes: v.optional(v.string()),
  isRefunded: v.optional(v.boolean()),
  refundedQuantity: v.optional(v.number()),
  refundedAt: v.optional(v.number()),
});
