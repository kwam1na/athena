import { internalQuery, mutation, query } from "../_generated/server";
import type { QueryCtx } from "../_generated/server";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { subcategorySchema } from "../schemas/inventory";
import { toSlug } from "../utils";
import { refreshProductSkuSearchForSubcategory } from "./skuSearch";
import { requireAuthenticatedAthenaUserWithCtx } from "../lib/athenaUserAuth";
import {
  admitPublicMutation,
  admitPublicQuery,
} from "../platform/operationAdmission";
import {
  createSubcategoryOperationDefinition,
  removeSubcategoryOperationDefinition,
  updateSubcategoryOperationDefinition,
} from "../operationAdmission/domains/inventoryCatalog_definitions";
import {
  getSubcategoryByIdReadDefinition,
  listSubcategoriesReadDefinition,
} from "../operationAdmission/domains/inventoryCatalog_readDefinitions";
import type {
  OperationMutationCtx,
  OperationQueryCtx,
} from "../operationAdmission/types";

async function listSubcategoriesWithCtx(
  ctx: QueryCtx,
  args: { storeId: Id<"store">; categoryId?: Id<"category"> },
) {
  return await ctx.db
    .query("subcategory")
    .filter((q) => {
      if (args.categoryId) {
        return q.and(
          q.eq(q.field("storeId"), args.storeId),
          q.eq(q.field("categoryId"), args.categoryId),
        );
      }

      return q.eq(q.field("storeId"), args.storeId);
    })
    .take(1000);
}

export const getAll = query({
  args: {
    storeId: v.id("store"),
    categoryId: v.optional(v.id("category")),
  },
  handler: admitPublicQuery(
    listSubcategoriesReadDefinition,
    async (
      ctx: OperationQueryCtx,
      args: { storeId: Id<"store">; categoryId?: Id<"category"> },
    ) => listSubcategoriesWithCtx(ctx, args),
  ),
});

/**
 * Internal sibling for backend callers (the anonymous `GET /subcategories`
 * route). The public export stays until wave B2 flips the route to it.
 */
export const getAllInternal = internalQuery({
  args: {
    storeId: v.id("store"),
    categoryId: v.optional(v.id("category")),
  },
  handler: async (ctx, args) => listSubcategoriesWithCtx(ctx, args),
});

export const getById = query({
  args: {
    id: v.id("subcategory"),
    storeId: v.id("store"),
  },
  handler: admitPublicQuery(
    getSubcategoryByIdReadDefinition,
    async (
      ctx: OperationQueryCtx,
      args: { id: Id<"subcategory">; storeId: Id<"store"> },
    ) => {
      return await ctx.db.get("subcategory", args.id);
    },
  ),
});

export const create = mutation({
  args: subcategorySchema,
  handler: admitPublicMutation(
    createSubcategoryOperationDefinition,
    async (ctx: OperationMutationCtx, args: any) => {
      await requireAuthenticatedAthenaUserWithCtx(ctx);
      const id = await ctx.db.insert("subcategory", args);

      return await ctx.db.get("subcategory", id);
    },
  ),
});

export const update = mutation({
  args: {
    id: v.id("subcategory"),
    name: v.optional(v.string()),
    categoryId: v.optional(v.id("category")),
  },
  handler: admitPublicMutation(
    updateSubcategoryOperationDefinition,
    async (
      ctx: OperationMutationCtx,
      args: {
        id: Id<"subcategory">;
        name?: string;
        categoryId?: Id<"category">;
      },
    ) => {
      await requireAuthenticatedAthenaUserWithCtx(ctx);
      const updates: Record<string, any> = {};

      if (args.name) {
        updates.name = args.name;
        updates.slug = toSlug(args.name);
      }

      if (args.categoryId) {
        updates.categoryId = args.categoryId;
      }

      if (Object.keys(updates).length > 0) {
        await ctx.db.patch("subcategory", args.id, updates);
        await refreshProductSkuSearchForSubcategory(ctx, args.id);
      }

      return await ctx.db.get("subcategory", args.id);
    },
  ),
});

export const remove = mutation({
  args: {
    id: v.id("subcategory"),
  },
  handler: admitPublicMutation(
    removeSubcategoryOperationDefinition,
    async (ctx: OperationMutationCtx, args: { id: Id<"subcategory"> }) => {
      await requireAuthenticatedAthenaUserWithCtx(ctx);
      await ctx.db.delete("subcategory", args.id);
      await refreshProductSkuSearchForSubcategory(ctx, args.id);

      return { message: "OK" };
    },
  ),
});
