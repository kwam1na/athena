import { v } from "convex/values";
import { internalMutation, mutation, query } from "../_generated/server";
import { internal } from "../_generated/api";

const entity = "bannerMessage";

export const expireActiveBannerMessage = internalMutation({
  args: {
    storeId: v.id("store"),
    countdownEndsAt: v.number(),
  },
  handler: async (ctx, args) => {
    const bannerMessage = await ctx.db
      .query(entity)
      .withIndex("by_storeId", (q) => q.eq("storeId", args.storeId))
      .filter((q) => q.eq(q.field("active"), true))
      .first();

    if (
      bannerMessage &&
      bannerMessage.countdownEndsAt === args.countdownEndsAt &&
      bannerMessage.active
    ) {
      await ctx.db.patch("bannerMessage", bannerMessage._id, { active: false });
    }
  },
});

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
      countdownEndsAt: v.optional(v.number()),
    })
  ),
  handler: async (ctx, args) => {
    return (
      (await ctx.db
      .query(entity)
      .withIndex("by_storeId", (q) => q.eq("storeId", args.storeId))
      .filter((q) => q.eq(q.field("active"), true))
      .first()) ?? null
    );
  },
});

export const upsert = mutation({
  args: {
    storeId: v.id("store"),
    heading: v.optional(v.string()),
    message: v.optional(v.string()),
    active: v.boolean(),
    countdownEndsAt: v.optional(v.number()),
    currentTimeMs: v.number(),
  },
  returns: v.object({
    _id: v.id("bannerMessage"),
    _creationTime: v.number(),
    storeId: v.id("store"),
    heading: v.optional(v.string()),
    message: v.optional(v.string()),
    active: v.boolean(),
    countdownEndsAt: v.optional(v.number()),
  }),
  handler: async (ctx, args) => {
    const shouldActivate =
      args.active &&
      (!args.countdownEndsAt || args.countdownEndsAt > args.currentTimeMs);

    const existing = await ctx.db
      .query(entity)
      .withIndex("by_storeId", (q) => q.eq("storeId", args.storeId))
      .first();

    if (existing) {
      await ctx.db.patch("bannerMessage", existing._id, {
        heading: args.heading,
        message: args.message,
        active: shouldActivate,
        countdownEndsAt: args.countdownEndsAt,
      });

      if (shouldActivate && args.countdownEndsAt) {
        await ctx.scheduler.runAt(
          args.countdownEndsAt,
          internal.inventory.bannerMessage.expireActiveBannerMessage,
          {
            storeId: args.storeId,
            countdownEndsAt: args.countdownEndsAt,
          }
        );
      }

      const updated = await ctx.db.get("bannerMessage", existing._id);
      if (!updated) {
        throw new Error("Failed to get updated banner message");
      }
      return updated;
    }

    const id = await ctx.db.insert(entity, {
      storeId: args.storeId,
      heading: args.heading,
      message: args.message,
      active: shouldActivate,
      countdownEndsAt: args.countdownEndsAt,
    });

    if (shouldActivate && args.countdownEndsAt) {
      await ctx.scheduler.runAt(
        args.countdownEndsAt,
        internal.inventory.bannerMessage.expireActiveBannerMessage,
        {
          storeId: args.storeId,
          countdownEndsAt: args.countdownEndsAt,
        }
      );
    }

    const created = await ctx.db.get("bannerMessage", id);
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
    await ctx.db.delete("bannerMessage", args.id);
    return true;
  },
});
