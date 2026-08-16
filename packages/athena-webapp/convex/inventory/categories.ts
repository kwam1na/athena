/* eslint-disable @convex-dev/no-collect-in-query -- Admin category selectors and storefront navigation need full store-scoped category lists; category counts are bounded operational taxonomy. */
import { internalQuery, mutation, query } from "../_generated/server";
import type { QueryCtx } from "../_generated/server";
import { v } from "convex/values";
import { categorySchema } from "../schemas/inventory";
import { Id } from "../_generated/dataModel";
import { refreshProductSkuSearchForCategory } from "./skuSearch";
import { markCatalogSummaryNeedsRefresh } from "./catalogSummary";
import { requireAuthenticatedAthenaUserWithCtx } from "../lib/athenaUserAuth";
import {
  admitPublicMutation,
  admitPublicQuery,
} from "../platform/operationAdmission";
import {
  createCategoryOperationDefinition,
  removeCategoryOperationDefinition,
  updateCategoryOperationDefinition,
} from "../operationAdmission/domains/u3_inventoryCatalog_definitions";
import {
  getCategoryByIdReadDefinition,
  listCategoriesReadDefinition,
} from "../operationAdmission/domains/u3_inventoryCatalog_readDefinitions";
import type {
  OperationMutationCtx,
  OperationQueryCtx,
} from "../operationAdmission/types";

const entity = "category";

async function listCategoriesWithCtx(
  ctx: QueryCtx,
  args: { storeId: Id<"store"> },
) {
  return await ctx.db
    .query(entity)
    .filter((q) => q.eq(q.field("storeId"), args.storeId))
    .collect();
}

async function listCategoriesWithSubcategoriesWithCtx(
  ctx: QueryCtx,
  args: { storeId: Id<"store"> },
) {
  // Fetch all categories for the given storeId
  const categories = await ctx.db
    .query("category")
    .filter((q) => q.eq(q.field("storeId"), args.storeId))
    .collect();

  // Fetch all subcategories for the storeId in a single query
  const subcategories = await ctx.db
    .query("subcategory")
    .filter((q) => q.eq(q.field("storeId"), args.storeId))
    .collect();

  // Group subcategories by their categoryId
  const subcategoriesByCategoryId: Record<
    Id<"category">,
    (typeof subcategories)[0][]
  > = subcategories.reduce(
    (map, subcategory) => {
      if (!map[subcategory.categoryId]) {
        map[subcategory.categoryId] = [];
      }
      map[subcategory.categoryId].push(subcategory);
      return map;
    },
    {} as Record<Id<"category">, (typeof subcategories)[0][]>
  );

  // Map categories to include their subcategories
  return categories.map((category) => ({
    ...category,
    subcategories: subcategoriesByCategoryId[category._id] || [],
  }));
}

export const getAll = query({
  args: {
    storeId: v.id("store"),
  },
  handler: admitPublicQuery(
    listCategoriesReadDefinition,
    async (ctx: OperationQueryCtx, args: { storeId: Id<"store"> }) =>
      listCategoriesWithCtx(ctx, args),
  ),
});

/**
 * Internal sibling for backend callers (the anonymous `GET /categories` route).
 * The public export stays until wave B2 flips the route to this reference.
 */
export const getAllInternal = internalQuery({
  args: {
    storeId: v.id("store"),
  },
  handler: async (ctx, args) => listCategoriesWithCtx(ctx, args),
});

/** Internal sibling for the anonymous `GET /categories` route (B2 flips it). */
export const getCategoriesWithSubcategoriesInternal = internalQuery({
  args: {
    storeId: v.id("store"),
  },
  handler: async (ctx, args) =>
    listCategoriesWithSubcategoriesWithCtx(ctx, args),
});

export const getById = query({
  args: {
    id: v.id(entity),
    storeId: v.string(),
  },
  handler: admitPublicQuery(
    getCategoryByIdReadDefinition,
    async (
      ctx: OperationQueryCtx,
      args: { id: Id<"category">; storeId: string },
    ) => {
      return await ctx.db.get("category", args.id);
    },
  ),
});

export const create = mutation({
  args: categorySchema,
  handler: admitPublicMutation(
    createCategoryOperationDefinition,
    async (ctx: OperationMutationCtx, args: any) => {
      await requireAuthenticatedAthenaUserWithCtx(ctx);
      const id = await ctx.db.insert(entity, args);
      await markCatalogSummaryNeedsRefresh(ctx, args.storeId);

      return await ctx.db.get("category", id);
    },
  ),
});

export const update = mutation({
  args: {
    id: v.id(entity),
    name: v.optional(v.string()),
    showOnStorefront: v.optional(v.boolean()),
    slug: v.optional(v.string()),
  },
  handler: admitPublicMutation(
    updateCategoryOperationDefinition,
    async (
      ctx: OperationMutationCtx,
      args: {
        id: Id<"category">;
        name?: string;
        showOnStorefront?: boolean;
        slug?: string;
      },
    ) => {
      await requireAuthenticatedAthenaUserWithCtx(ctx);
      const category = await ctx.db.get("category", args.id);
      const patch: Partial<{
        name: string;
        showOnStorefront: boolean;
        slug: string;
      }> = {};

      if (args.name !== undefined) {
        patch.name = args.name;
      }

      if (args.slug !== undefined) {
        patch.slug = args.slug;
      }

      if (args.showOnStorefront !== undefined) {
        patch.showOnStorefront = args.showOnStorefront;
      }

      await ctx.db.patch("category", args.id, patch);
      await refreshProductSkuSearchForCategory(ctx, args.id);
      if (category) {
        await markCatalogSummaryNeedsRefresh(ctx, category.storeId);
      }

      return await ctx.db.get("category", args.id);
    },
  ),
});

export const remove = mutation({
  args: {
    id: v.id(entity),
  },
  handler: admitPublicMutation(
    removeCategoryOperationDefinition,
    async (ctx: OperationMutationCtx, args: { id: Id<"category"> }) => {
      await requireAuthenticatedAthenaUserWithCtx(ctx);
      const category = await ctx.db.get("category", args.id);
      await ctx.db.delete("category", args.id);
      await refreshProductSkuSearchForCategory(ctx, args.id);
      if (category) {
        await markCatalogSummaryNeedsRefresh(ctx, category.storeId);
      }

      return { message: "OK" };
    },
  ),
});
