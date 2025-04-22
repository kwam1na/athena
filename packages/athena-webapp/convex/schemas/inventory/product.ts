import { v } from "convex/values";

export const productSchema = v.object({
  areProcessingFeesAbsorbed: v.optional(v.boolean()),
  attributes: v.optional(v.record(v.string(), v.any())),
  availability: v.union(
    v.literal("archived"),
    v.literal("draft"),
    v.literal("live")
  ),
  isVisible: v.optional(v.boolean()),
  categoryId: v.id("category"),
  createdByUserId: v.id("athenaUser"),
  currency: v.string(),
  description: v.optional(v.string()),
  inventoryCount: v.number(),
  name: v.string(),
  organizationId: v.id("organization"),
  quantityAvailable: v.optional(v.number()),
  slug: v.string(),
  storeId: v.id("store"),
  subcategoryId: v.id("subcategory"),
});

export const productSkuSchema = v.object({
  attributes: v.optional(v.record(v.string(), v.any())),
  color: v.optional(v.id("color")),
  images: v.array(v.string()),
  isVisible: v.optional(v.boolean()),
  inventoryCount: v.number(),
  length: v.optional(v.number()),
  netPrice: v.optional(v.number()),
  price: v.number(),
  productId: v.id("product"),
  productName: v.optional(v.string()),
  quantityAvailable: v.number(),
  size: v.optional(v.string()),
  sku: v.optional(v.string()),
  storeId: v.id("store"),
  unitCost: v.optional(v.number()),
  weight: v.optional(v.string()),
});
