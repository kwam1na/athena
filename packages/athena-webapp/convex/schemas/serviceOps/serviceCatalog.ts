import { v } from "convex/values";

export const serviceCatalogSchema = v.object({
  storeId: v.id("store"),
  organizationId: v.optional(v.id("organization")),
  slug: v.string(),
  name: v.string(),
  description: v.optional(v.string()),
  serviceMode: v.union(
    v.literal("same_day"),
    v.literal("consultation"),
    v.literal("repair"),
    v.literal("revamp")
  ),
  durationMinutes: v.number(),
  pricingModel: v.union(
    v.literal("fixed"),
    v.literal("starting_at"),
    v.literal("quote_after_consultation")
  ),
  basePrice: v.optional(v.number()),
  depositType: v.union(
    v.literal("none"),
    v.literal("flat"),
    v.literal("percentage")
  ),
  depositValue: v.optional(v.number()),
  requiresManagerApproval: v.boolean(),
  status: v.union(v.literal("active"), v.literal("archived")),
  createdAt: v.number(),
  updatedAt: v.number(),
});
