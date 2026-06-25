import { mutation, query } from "../_generated/server";
import { v } from "convex/values";
import { colorSchema } from "../schemas/inventory";
import { refreshProductSkuSearchForColor } from "./skuSearch";

export const getAll = query({
  args: {
    storeId: v.id("store"),
  },
  handler: async (ctx, args) => {
    const categories = await ctx.db
      .query("color")
      .filter((q) => q.eq(q.field("storeId"), args.storeId))
      .take(1000);

    return categories;
  },
});

export const getById = query({
  args: {
    id: v.id("color"),
  },
  handler: async (ctx, args) => {
    return await ctx.db.get("color", args.id);
  },
});

export const create = mutation({
  args: colorSchema,
  handler: async (ctx, args) => {
    const id = await ctx.db.insert("color", args);

    return await ctx.db.get("color", id);
  },
});

export const update = mutation({
  args: {
    id: v.id("color"),
    name: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch("color", args.id, { name: args.name });
    await refreshProductSkuSearchForColor(ctx, args.id);

    return await ctx.db.get("color", args.id);
  },
});

export const remove = mutation({
  args: {
    id: v.id("color"),
  },
  handler: async (ctx, args) => {
    await ctx.db.delete("color", args.id);
    await refreshProductSkuSearchForColor(ctx, args.id);

    return { message: "OK" };
  },
});
