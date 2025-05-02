import { v } from "convex/values";

export const complimentaryProductsCollectionSchema = v.object({
  name: v.string(),
  storeId: v.id("store"),
  organizationId: v.id("organization"),
  isActive: v.boolean(),
  startDate: v.optional(v.number()),
  endDate: v.optional(v.number()),
  createdByUserId: v.id("athenaUser"),
});

export const complimentaryProductSchema = v.object({
  collectionId: v.optional(v.id("complimentaryProductsCollection")),
  productSkuId: v.id("productSku"),
  storeId: v.id("store"),
  organizationId: v.id("organization"),
  isActive: v.boolean(),
  createdByUserId: v.id("athenaUser"),
});
