import { v } from "convex/values";

export const serviceCaseLineItemSchema = v.object({
  serviceCaseId: v.id("serviceCase"),
  lineType: v.union(
    v.literal("labor"),
    v.literal("material"),
    v.literal("adjustment")
  ),
  description: v.string(),
  quantity: v.number(),
  unitPrice: v.number(),
  amount: v.number(),
  notes: v.optional(v.string()),
  createdAt: v.number(),
});
