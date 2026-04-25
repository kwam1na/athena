import { v } from "convex/values";

import { mutation, query } from "../../_generated/server";
import { quickAddCatalogItem } from "../application/commands/quickAddCatalogItem";
import {
  lookupByBarcode,
  searchProducts,
} from "../application/queries/searchCatalog";

const catalogResultValidator = v.object({
  id: v.id("productSku"),
  name: v.string(),
  sku: v.string(),
  barcode: v.string(),
  price: v.number(),
  category: v.string(),
  description: v.string(),
  inStock: v.boolean(),
  quantityAvailable: v.number(),
  image: v.union(v.string(), v.null()),
  size: v.string(),
  length: v.union(v.number(), v.null()),
  color: v.string(),
  productId: v.id("product"),
  skuId: v.id("productSku"),
  areProcessingFeesAbsorbed: v.boolean(),
});

export const search = query({
  args: {
    storeId: v.id("store"),
    searchQuery: v.string(),
  },
  handler: async (ctx, args) => searchProducts(ctx, args),
});

export const barcodeLookup = query({
  args: {
    storeId: v.id("store"),
    barcode: v.string(),
  },
  returns: v.union(
    v.null(),
    catalogResultValidator,
    v.array(catalogResultValidator),
  ),
  handler: async (ctx, args) => lookupByBarcode(ctx, args),
});

export const quickAddSku = mutation({
  args: {
    storeId: v.id("store"),
    createdByUserId: v.id("athenaUser"),
    name: v.string(),
    lookupCode: v.optional(v.string()),
    price: v.number(),
    quantityAvailable: v.number(),
  },
  returns: catalogResultValidator,
  handler: async (ctx, args) => quickAddCatalogItem(ctx, args),
});
