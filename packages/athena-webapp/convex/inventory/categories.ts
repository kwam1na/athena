import { mutation, query } from "../_generated/server";
import { v } from "convex/values";
import { categorySchema } from "../schemas/inventory";

const entity = "category";

export const getAll = query({
  args: {
    storeId: v.id("store"),
  },
  handler: async (ctx, args) => {
    const categories = await ctx.db
      .query(entity)
      .filter((q) => q.eq(q.field("storeId"), args.storeId))
      .collect();

    return categories;
  },
});

export const getById = query({
  args: {
    id: v.id(entity),
    storeId: v.string(),
  },
  handler: async (ctx, args) => {
    const categories = await ctx.db
      .query(entity)
      .filter((q) =>
        q.and(
          q.eq(q.field("_id"), args.id),
          q.eq(q.field("storeId"), args.storeId)
        )
      )
      .collect();

    return categories;
  },
});

export const create = mutation({
  args: categorySchema,
  handler: async (ctx, args) => {
    const id = await ctx.db.insert(entity, args);

    return await ctx.db.get(id);
  },
});

export const update = mutation({
  args: {
    id: v.id(entity),
    name: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, { name: args.name });

    return await ctx.db.get(args.id);
  },
});

export const remove = mutation({
  args: {
    id: v.id(entity),
  },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.id);

    return { message: "OK" };
  },
});