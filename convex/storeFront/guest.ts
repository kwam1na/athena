import { mutation, query } from "../_generated/server";
import { v } from "convex/values";

const entity = "guest";

export const getAll = query({
  handler: async (ctx) => {
    return await ctx.db.query(entity).collect();
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

export const create = mutation({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.insert(entity, {});
  },
});

export const deleteGuest = mutation({
  args: {
    id: v.id(entity),
  },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.id);
    return { message: "Guest deleted" };
  },
});
