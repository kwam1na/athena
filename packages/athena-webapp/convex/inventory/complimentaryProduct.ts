import { ComplimentaryProduct } from "../../types";
import { api } from "../_generated/api";
import { mutation, query } from "../_generated/server";
import { v } from "convex/values";

// Create a new complimentary products collection
export const createCollection = mutation({
  args: {
    name: v.string(),
    storeId: v.id("store"),
    organizationId: v.id("organization"),
    isActive: v.boolean(),
    startDate: v.optional(v.number()),
    endDate: v.optional(v.number()),
    createdByUserId: v.id("athenaUser"),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("complimentaryProductsCollection", args);
  },
});

// Create a new complimentary product
export const createComplimentaryProduct = mutation({
  args: {
    productSkuId: v.id("productSku"),
    storeId: v.id("store"),
    organizationId: v.id("organization"),
    isActive: v.boolean(),
    collectionId: v.optional(v.id("complimentaryProductsCollection")),
    createdByUserId: v.id("athenaUser"),
  },
  handler: async (ctx, args) => {
    // Check if the SKU already exists as a complimentary product
    const existingProduct = await ctx.db
      .query("complimentaryProduct")
      .withIndex("by_storeId", (q) => q.eq("storeId", args.storeId))
      .filter((q) => q.eq(q.field("productSkuId"), args.productSkuId))
      .first();

    if (existingProduct) {
      return existingProduct._id;
    }

    return await ctx.db.insert("complimentaryProduct", args);
  },
});

// Get all active complimentary products for a store
export const getActiveComplimentaryProducts = query({
  args: {
    storeId: v.id("store"),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("complimentaryProduct")
      .withIndex("by_storeId", (q) => q.eq("storeId", args.storeId))
      .filter((q) => q.eq(q.field("isActive"), true))
      .collect();
  },
});

// Get all complimentary products in a collection
export const getComplimentaryProductsByCollection = query({
  args: {
    collectionId: v.id("complimentaryProductsCollection"),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("complimentaryProduct")
      .withIndex("by_collectionId", (q) =>
        q.eq("collectionId", args.collectionId)
      )
      .collect();
  },
});

// Toggle active status of a complimentary product
export const toggleComplimentaryProductActive = mutation({
  args: {
    complimentaryProductId: v.id("complimentaryProduct"),
    isActive: v.boolean(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.patch(args.complimentaryProductId, {
      isActive: args.isActive,
    });
  },
});

// Toggle active status of a collection
export const toggleCollectionActive = mutation({
  args: {
    collectionId: v.id("complimentaryProductsCollection"),
    isActive: v.boolean(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.patch(args.collectionId, {
      isActive: args.isActive,
    });
  },
});

// Get all active collections for a store
export const getActiveCollections = query({
  args: {
    storeId: v.id("store"),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("complimentaryProductsCollection")
      .withIndex("by_storeId", (q) => q.eq("storeId", args.storeId))
      .filter((q) => q.eq(q.field("isActive"), true))
      .collect();
  },
});

// Get all complimentary products for a store
export const getAllComplimentaryProducts = query({
  args: {
    storeId: v.id("store"),
  },
  handler: async (ctx, args): Promise<ComplimentaryProduct[]> => {
    const products = await ctx.db
      .query("complimentaryProduct")
      .withIndex("by_storeId", (q) => q.eq("storeId", args.storeId))
      .collect();

    const productSkus: any[] = await Promise.all(
      products.map((product) =>
        ctx.runQuery(api.inventory.productSku.getById, {
          id: product.productSkuId,
        })
      )
    );

    return products.map((product, index) => ({
      ...product,
      productSku: productSkus[index],
    }));
  },
});

// Batch create complimentary products
export const batchCreateComplimentaryProducts = mutation({
  args: {
    productSkuIds: v.array(v.id("productSku")),
    storeId: v.id("store"),
    organizationId: v.id("organization"),
    isActive: v.boolean(),
    collectionId: v.optional(v.id("complimentaryProductsCollection")),
    createdByUserId: v.id("athenaUser"),
  },
  handler: async (ctx, args) => {
    const { productSkuIds, ...commonArgs } = args;

    // Check for existing complimentary products with these SKUs
    const existingProducts = await Promise.all(
      productSkuIds.map((skuId) =>
        ctx.db
          .query("complimentaryProduct")
          .withIndex("by_storeId", (q) => q.eq("storeId", args.storeId))
          .filter((q) => q.eq(q.field("productSkuId"), skuId))
          .first()
      )
    );

    const existingSkuIds = new Set(
      existingProducts
        .filter((p): p is NonNullable<typeof p> => p !== null)
        .map((p) => p.productSkuId)
    );

    const newSkuIds = productSkuIds.filter((id) => !existingSkuIds.has(id));

    if (newSkuIds.length === 0) {
      return [];
    }

    const results = await Promise.all(
      newSkuIds.map((productSkuId) =>
        ctx.db.insert("complimentaryProduct", {
          ...commonArgs,
          productSkuId,
        })
      )
    );

    return results;
  },
});
