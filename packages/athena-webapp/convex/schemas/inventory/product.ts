import { v } from "convex/values";

export const productSchema = v.object({
  availability: v.union(
    v.literal("archived"),
    v.literal("draft"),
    v.literal("live")
  ),
  currency: v.string(),
  createdByUserId: v.id("users"),
  categoryId: v.id("category"),
  description: v.optional(v.string()),
  name: v.string(),
  organizationId: v.id("organization"),
  storeId: v.id("store"),
  slug: v.string(),
  subcategoryId: v.id("subcategory"),
  inventoryCount: v.number(),
});

export const productSkuSchema = v.object({
  attributes: v.object({}),
  color: v.optional(v.string()),
  sku: v.optional(v.string()),
  length: v.optional(v.number()),
  size: v.optional(v.string()),
  productId: v.id("product"),
  storeId: v.id("store"),
  images: v.array(v.string()),
  inventoryCount: v.number(),
  price: v.number(),
  unitCost: v.optional(v.number()),
});