import { v } from "convex/values";

export const purchaseOrderSchema = v.object({
  storeId: v.id("store"),
  organizationId: v.optional(v.id("organization")),
  vendorId: v.id("vendor"),
  poNumber: v.string(),
  status: v.union(
    v.literal("draft"),
    v.literal("submitted"),
    v.literal("approved"),
    v.literal("ordered"),
    v.literal("partially_received"),
    v.literal("received"),
    v.literal("cancelled")
  ),
  lineItemCount: v.number(),
  totalUnits: v.number(),
  subtotalAmount: v.number(),
  totalAmount: v.number(),
  currency: v.optional(v.string()),
  expectedAt: v.optional(v.number()),
  notes: v.optional(v.string()),
  createdByUserId: v.optional(v.id("athenaUser")),
  operationalWorkItemId: v.optional(v.id("operationalWorkItem")),
  createdAt: v.number(),
  submittedAt: v.optional(v.number()),
  approvedAt: v.optional(v.number()),
  orderedAt: v.optional(v.number()),
  receivedAt: v.optional(v.number()),
  cancelledAt: v.optional(v.number()),
});
