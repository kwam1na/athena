import { mutation, query } from "../_generated/server";
import { v } from "convex/values";
import { subcategorySchema } from "../schemas/inventory";
import { toSlug } from "../utils";
import { refreshProductSkuSearchForSubcategory } from "./skuSearch";

export const getAll = query({
  args: {
    storeId: v.id("store"),
    categoryId: v.optional(v.id("category")),
  },
  handler: async (ctx, args) => {
    const subcategories = await ctx.db
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

    return subcategories;
  },
});

export const getById = query({
  args: {
    id: v.id("subcategory"),
    storeId: v.id("store"),
  },
  handler: async (ctx, args) => {
    return await ctx.db.get("subcategory", args.id);
  },
});

export const create = mutation({
  args: subcategorySchema,
  handler: async (ctx, args) => {
    const id = await ctx.db.insert("subcategory", args);

    return await ctx.db.get("subcategory", id);
  },
});

export const update = mutation({
  args: {
    id: v.id("subcategory"),
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
      await ctx.db.patch("subcategory", args.id, updates);
      await refreshProductSkuSearchForSubcategory(ctx, args.id);
    }

    return await ctx.db.get("subcategory", args.id);
  },
});

export const remove = mutation({
  args: {
    id: v.id("subcategory"),
  },
  handler: async (ctx, args) => {
    await ctx.db.delete("subcategory", args.id);
    await refreshProductSkuSearchForSubcategory(ctx, args.id);

    return { message: "OK" };
  },
});
