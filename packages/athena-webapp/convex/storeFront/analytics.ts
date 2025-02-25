import { v } from "convex/values";
import { mutation } from "../_generated/server";

const entity = "analytics";

export const create = mutation({
  args: {
    storeId: v.id("store"),
    storeFrontUserId: v.union(v.id("storeFrontUser"), v.id("guest")),
    origin: v.optional(v.string()),
    action: v.string(),
    data: v.record(v.string(), v.any()),
  },
  handler: async (ctx, args) => {
    const id = await ctx.db.insert(entity, {
      ...args,
    });

    return await ctx.db.get(id);
  },
});

export const getAll = mutation({
  args: {
    storeId: v.id("store"),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query(entity)
      .filter((q) => q.eq(q.field("storeId"), args.storeId))
      .collect();
  },
});
