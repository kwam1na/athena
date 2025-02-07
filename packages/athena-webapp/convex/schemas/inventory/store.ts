import { v } from "convex/values";

export const storeSchema = v.object({
  config: v.optional(v.record(v.string(), v.any())),
  name: v.string(),
  currency: v.string(),
  slug: v.string(),
  createdByUserId: v.id("athenaUser"),
  organizationId: v.id("organization"),
});

export const storeAssetSchema = v.object({
  storeId: v.id("store"),
  url: v.string(),
});
