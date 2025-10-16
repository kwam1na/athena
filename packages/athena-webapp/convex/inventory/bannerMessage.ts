import { v } from "convex/values";
import { mutation, query } from "../_generated/server";

const entity = "bannerMessage";

export const get = query({
  args: {
    storeId: v.id("store"),
  },
  returns: v.union(
    v.null(),
    v.object({
      _id: v.id("bannerMessage"),
      _creationTime: v.number(),
      storeId: v.id("store"),
      heading: v.optional(v.string()),
      message: v.optional(v.string()),
      active: v.boolean(),
    })
  ),
  handler: async (ctx, args) => {
    const bannerMessage = await ctx.db
      .query(entity)
      .withIndex("by_storeId", (q) => q.eq("storeId", args.storeId))
      .filter((q) => q.eq(q.field("active"), true))
      .first();

    return bannerMessage ?? null;
  },
});

export const upsert = mutation({
  args: {
    storeId: v.id("store"),
    heading: v.optional(v.string()),
    message: v.optional(v.string()),
    active: v.boolean(),
  },
  returns: v.object({
    _id: v.id("bannerMessage"),
    _creationTime: v.number(),
    storeId: v.id("store"),
    heading: v.optional(v.string()),
    message: v.optional(v.string()),
    active: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query(entity)
      .withIndex("by_storeId", (q) => q.eq("storeId", args.storeId))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        heading: args.heading,
        message: args.message,
        active: args.active,
      });

      const updated = await ctx.db.get(existing._id);
      if (!updated) {
        throw new Error("Failed to get updated banner message");
      }
      return updated;
    }

    const id = await ctx.db.insert(entity, {
      storeId: args.storeId,
      heading: args.heading,
      message: args.message,
      active: args.active,
    });

    const created = await ctx.db.get(id);
    if (!created) {
      throw new Error("Failed to get created banner message");
    }
    return created;
  },
});

export const remove = mutation({
  args: {
    id: v.id(entity),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    await ctx.db.delete(args.id);
    return true;
  },
});
