import { mutation, query } from "../_generated/server";
import { v } from "convex/values";
import { subcategorySchema } from "../schemas/inventory";
import { toSlug } from "../utils";

const entity = "subcategory";

export const getAll = query({
  args: {
    storeId: v.id("store"),
    categoryId: v.optional(v.id("category")),
  },
  handler: async (ctx, args) => {
    const subcategories = await ctx.db
      .query(entity)
      .filter((q) => {
        if (args.categoryId) {
          return q.and(
            q.eq(q.field("storeId"), args.storeId),
            q.eq(q.field("categoryId"), args.categoryId)
          );
        }

        return q.eq(q.field("storeId"), args.storeId);
      })
      .collect();

    return subcategories;
  },
});

export const getById = query({
  args: {
    id: v.id(entity),
    storeId: v.id("store"),
  },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

export const create = mutation({
  args: subcategorySchema,
  handler: async (ctx, args) => {
    const id = await ctx.db.insert(entity, args);

    return await ctx.db.get(id);
  },
});

export const update = mutation({
  args: {
    id: v.id(entity),
    name: v.optional(v.string()),
    categoryId: v.optional(v.id("category")),
  },
  handler: async (ctx, args) => {
    const updates: Record<string, any> = {};

    if (args.name) {
      updates.name = args.name;
      updates.slug = toSlug(args.name);
    }

    if (args.categoryId) {
      updates.categoryId = args.categoryId;
    }

    if (Object.keys(updates).length > 0) {
      await ctx.db.patch(args.id, updates);
    }

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
