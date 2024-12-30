import { v } from "convex/values";
import { mutation, query } from "../_generated/server";
import { api } from "../_generated/api";

const entity = "bestSeller";

export const create = mutation({
  args: {
    productId: v.id("product"),
    storeId: v.id("store"),
  },
  handler: async (ctx, args) => {
    const id = await ctx.db.insert(entity, {
      productId: args.productId,
      storeId: args.storeId,
    });

    return await ctx.db.get(id);
  },
});

export const remove = mutation({
  args: {
    id: v.id(entity),
  },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.id);

    return true;
  },
});

export const getById = query({
  args: {
    id: v.id(entity),
  },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

export const getAll = query({
  args: {
    storeId: v.id("store"),
  },
  handler: async (ctx, args) => {
    const items = await ctx.db
      .query(entity)
      .filter((q) => q.eq(q.field("storeId"), args.storeId))
      .collect();

    const res: any[] = await Promise.all(
      items.map((item) =>
        ctx.runQuery(api.inventory.products.getByIdOrSlug, {
          identifier: item.productId,
          storeId: args.storeId,
        })
      )
    );

    return res;
  },
});
