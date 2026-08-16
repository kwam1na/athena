import { internalQuery, mutation, query } from "../_generated/server";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { colorSchema } from "../schemas/inventory";
import { refreshProductSkuSearchForColor } from "./skuSearch";
import { requireAuthenticatedAthenaUserWithCtx } from "../lib/athenaUserAuth";
import {
  admitPublicMutation,
  admitPublicQuery,
} from "../platform/operationAdmission";
import {
  createColorOperationDefinition,
  removeColorOperationDefinition,
  updateColorOperationDefinition,
} from "../operationAdmission/domains/u3_inventoryCatalog_definitions";
import {
  getColorByIdReadDefinition,
  listColorsReadDefinition,
} from "../operationAdmission/domains/u3_inventoryCatalog_readDefinitions";
import type {
  OperationMutationCtx,
  OperationQueryCtx,
} from "../operationAdmission/types";

async function listColorsWithCtx(
  ctx: { db: OperationQueryCtx["db"] },
  args: { storeId: Id<"store"> },
) {
  return await ctx.db
    .query("color")
    .filter((q) => q.eq(q.field("storeId"), args.storeId))
    .take(1000);
}

export const getAll = query({
  args: {
    storeId: v.id("store"),
  },
  handler: admitPublicQuery(
    listColorsReadDefinition,
    async (ctx: OperationQueryCtx, args: { storeId: Id<"store"> }) =>
      listColorsWithCtx(ctx, args),
  ),
});

/**
 * Internal sibling for backend callers (the anonymous `GET /colors` route).
 * The public export stays until wave B2 flips the route to this reference.
 */
export const getAllInternal = internalQuery({
  args: {
    storeId: v.id("store"),
  },
  handler: async (ctx, args) => listColorsWithCtx(ctx, args),
});

export const getById = query({
  args: {
    id: v.id("color"),
  },
  handler: admitPublicQuery(
    getColorByIdReadDefinition,
    async (ctx: OperationQueryCtx, args: { id: Id<"color"> }) => {
      return await ctx.db.get("color", args.id);
    },
  ),
});

export const create = mutation({
  args: colorSchema,
  handler: admitPublicMutation(
    createColorOperationDefinition,
    async (ctx: OperationMutationCtx, args: any) => {
      await requireAuthenticatedAthenaUserWithCtx(ctx);
      const id = await ctx.db.insert("color", args);

      return await ctx.db.get("color", id);
    },
  ),
});

export const update = mutation({
  args: {
    id: v.id("color"),
    name: v.string(),
  },
  handler: admitPublicMutation(
    updateColorOperationDefinition,
    async (
      ctx: OperationMutationCtx,
      args: { id: Id<"color">; name: string },
    ) => {
      await requireAuthenticatedAthenaUserWithCtx(ctx);
      await ctx.db.patch("color", args.id, { name: args.name });
      await refreshProductSkuSearchForColor(ctx, args.id);

      return await ctx.db.get("color", args.id);
    },
  ),
});

export const remove = mutation({
  args: {
    id: v.id("color"),
  },
  handler: admitPublicMutation(
    removeColorOperationDefinition,
    async (ctx: OperationMutationCtx, args: { id: Id<"color"> }) => {
      await requireAuthenticatedAthenaUserWithCtx(ctx);
      await ctx.db.delete("color", args.id);
      await refreshProductSkuSearchForColor(ctx, args.id);

      return { message: "OK" };
    },
  ),
});
