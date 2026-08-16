/* eslint-disable @convex-dev/no-collect-in-query -- Query refactors are tracked in V26-168, V26-169, and V26-170; this PR only hardens API boundaries. */
import { ComplimentaryProduct } from "../../types";
import { internal } from "../_generated/api";
import { mutation, query } from "../_generated/server";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { requireAuthenticatedAthenaUserWithCtx } from "../lib/athenaUserAuth";
import {
  admitPublicMutation,
  admitPublicQuery,
} from "../platform/operationAdmission";
import {
  batchCreateComplimentaryProductsOperationDefinition,
  createComplimentaryCollectionOperationDefinition,
  createComplimentaryProductOperationDefinition,
  toggleComplimentaryCollectionActiveOperationDefinition,
  toggleComplimentaryProductActiveOperationDefinition,
} from "../operationAdmission/domains/u3_inventoryCatalog_definitions";
import {
  listActiveComplimentaryCollectionsReadDefinition,
  listActiveComplimentaryProductsReadDefinition,
  listAllComplimentaryProductsReadDefinition,
  listComplimentaryProductsByCollectionReadDefinition,
} from "../operationAdmission/domains/u3_inventoryCatalog_readDefinitions";
import type {
  OperationMutationCtx,
  OperationQueryCtx,
} from "../operationAdmission/types";

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
  handler: admitPublicMutation(
    createComplimentaryCollectionOperationDefinition,
    async (
      ctx: OperationMutationCtx,
      args: {
        name: string;
        storeId: Id<"store">;
        organizationId: Id<"organization">;
        isActive: boolean;
        startDate?: number;
        endDate?: number;
        createdByUserId: Id<"athenaUser">;
      },
    ) => {
      await requireAuthenticatedAthenaUserWithCtx(ctx);
      return await ctx.db.insert("complimentaryProductsCollection", args);
    },
  ),
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
  handler: admitPublicMutation(
    createComplimentaryProductOperationDefinition,
    async (
      ctx: OperationMutationCtx,
      args: {
        productSkuId: Id<"productSku">;
        storeId: Id<"store">;
        organizationId: Id<"organization">;
        isActive: boolean;
        collectionId?: Id<"complimentaryProductsCollection">;
        createdByUserId: Id<"athenaUser">;
      },
    ) => {
      await requireAuthenticatedAthenaUserWithCtx(ctx);
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
  ),
});

// Get all active complimentary products for a store
export const getActiveComplimentaryProducts = query({
  args: {
    storeId: v.id("store"),
  },
  handler: admitPublicQuery(
    listActiveComplimentaryProductsReadDefinition,
    async (ctx: OperationQueryCtx, args: { storeId: Id<"store"> }) => {
      return await ctx.db
        .query("complimentaryProduct")
        .withIndex("by_storeId", (q) => q.eq("storeId", args.storeId))
        .filter((q) => q.eq(q.field("isActive"), true))
        .collect();
    },
  ),
});

// Get all complimentary products in a collection
export const getComplimentaryProductsByCollection = query({
  args: {
    collectionId: v.id("complimentaryProductsCollection"),
  },
  handler: admitPublicQuery(
    listComplimentaryProductsByCollectionReadDefinition,
    async (
      ctx: OperationQueryCtx,
      args: { collectionId: Id<"complimentaryProductsCollection"> },
    ) => {
      return await ctx.db
        .query("complimentaryProduct")
        .withIndex("by_collectionId", (q) =>
          q.eq("collectionId", args.collectionId)
        )
        .collect();
    },
  ),
});

// Toggle active status of a complimentary product
export const toggleComplimentaryProductActive = mutation({
  args: {
    complimentaryProductId: v.id("complimentaryProduct"),
    isActive: v.boolean(),
  },
  handler: admitPublicMutation(
    toggleComplimentaryProductActiveOperationDefinition,
    async (
      ctx: OperationMutationCtx,
      args: {
        complimentaryProductId: Id<"complimentaryProduct">;
        isActive: boolean;
      },
    ) => {
      await requireAuthenticatedAthenaUserWithCtx(ctx);
      return await ctx.db.patch(
        "complimentaryProduct",
        args.complimentaryProductId,
        {
          isActive: args.isActive,
        },
      );
    },
  ),
});

// Toggle active status of a collection
export const toggleCollectionActive = mutation({
  args: {
    collectionId: v.id("complimentaryProductsCollection"),
    isActive: v.boolean(),
  },
  handler: admitPublicMutation(
    toggleComplimentaryCollectionActiveOperationDefinition,
    async (
      ctx: OperationMutationCtx,
      args: {
        collectionId: Id<"complimentaryProductsCollection">;
        isActive: boolean;
      },
    ) => {
      await requireAuthenticatedAthenaUserWithCtx(ctx);
      return await ctx.db.patch(
        "complimentaryProductsCollection",
        args.collectionId,
        {
          isActive: args.isActive,
        },
      );
    },
  ),
});

// Get all active collections for a store
export const getActiveCollections = query({
  args: {
    storeId: v.id("store"),
  },
  handler: admitPublicQuery(
    listActiveComplimentaryCollectionsReadDefinition,
    async (ctx: OperationQueryCtx, args: { storeId: Id<"store"> }) => {
      return await ctx.db
        .query("complimentaryProductsCollection")
        .withIndex("by_storeId", (q) => q.eq("storeId", args.storeId))
        .filter((q) => q.eq(q.field("isActive"), true))
        .collect();
    },
  ),
});

// Get all complimentary products for a store
export const getAllComplimentaryProducts = query({
  args: {
    storeId: v.id("store"),
  },
  handler: admitPublicQuery(
    listAllComplimentaryProductsReadDefinition,
    async (
      ctx: OperationQueryCtx,
      args: { storeId: Id<"store"> },
    ): Promise<ComplimentaryProduct[]> => {
      const products = await ctx.db
        .query("complimentaryProduct")
        .withIndex("by_storeId", (q) => q.eq("storeId", args.storeId))
        .collect();

      const productSkus: any[] = await Promise.all(
        products.map((product) =>
          ctx.runQuery(internal.inventory.productSku.retrieve, {
            id: product.productSkuId,
          })
        )
      );

      return products.map((product, index) => ({
        ...product,
        productSku: productSkus[index],
      }));
    },
  ),
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
  handler: admitPublicMutation(
    batchCreateComplimentaryProductsOperationDefinition,
    async (
      ctx: OperationMutationCtx,
      args: {
        productSkuIds: Id<"productSku">[];
        storeId: Id<"store">;
        organizationId: Id<"organization">;
        isActive: boolean;
        collectionId?: Id<"complimentaryProductsCollection">;
        createdByUserId: Id<"athenaUser">;
      },
    ) => {
      await requireAuthenticatedAthenaUserWithCtx(ctx);
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
  ),
});
