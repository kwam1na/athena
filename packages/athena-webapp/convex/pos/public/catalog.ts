import { v } from "convex/values";

import { mutation, query } from "../../_generated/server";
import { quickAddCatalogItem } from "../application/commands/quickAddCatalogItem";
import {
  lookupByBarcode,
  searchProducts,
} from "../application/queries/searchCatalog";
import {
  REGISTER_CATALOG_AVAILABILITY_LIMIT,
  listRegisterCatalog,
  listRegisterCatalogAvailability as readRegisterCatalogAvailability,
} from "../application/queries/listRegisterCatalog";

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

const registerCatalogRowValidator = v.object({
  id: v.id("productSku"),
  productSkuId: v.id("productSku"),
  skuId: v.id("productSku"),
  productId: v.id("product"),
  name: v.string(),
  sku: v.string(),
  barcode: v.string(),
  price: v.number(),
  category: v.string(),
  description: v.string(),
  image: v.union(v.string(), v.null()),
  size: v.string(),
  length: v.union(v.number(), v.null()),
  color: v.string(),
  areProcessingFeesAbsorbed: v.boolean(),
});

const registerCatalogAvailabilityValidator = v.object({
  productSkuId: v.id("productSku"),
  skuId: v.id("productSku"),
  inStock: v.boolean(),
  quantityAvailable: v.number(),
});

export const search = query({
  args: {
    storeId: v.id("store"),
    searchQuery: v.string(),
  },
  handler: async (ctx, args) => searchProducts(ctx, args),
});

export const listRegisterCatalogSnapshot = query({
  args: {
    storeId: v.id("store"),
  },
  returns: v.array(registerCatalogRowValidator),
  handler: async (ctx, args) => listRegisterCatalog(ctx, args),
});

export const listRegisterCatalogAvailability = query({
  args: {
    storeId: v.id("store"),
    productSkuIds: v.array(v.id("productSku")),
  },
  returns: v.array(registerCatalogAvailabilityValidator),
  handler: async (ctx, args) =>
    readRegisterCatalogAvailability(ctx, {
      storeId: args.storeId,
      productSkuIds: args.productSkuIds.slice(
        0,
        REGISTER_CATALOG_AVAILABILITY_LIMIT,
      ),
    }),
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
    productId: v.optional(v.id("product")),
    price: v.number(),
    quantityAvailable: v.number(),
  },
  returns: catalogResultValidator,
  handler: async (ctx, args) => quickAddCatalogItem(ctx, args),
});
