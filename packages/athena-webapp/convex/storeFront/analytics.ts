import { v } from "convex/values";
import { mutation, query } from "../_generated/server";

const entity = "analytics";

export const create = mutation({
  args: {
    storeId: v.id("store"),
    storeFrontUserId: v.union(v.id("storeFrontUser"), v.id("guest")),
    origin: v.optional(v.string()),
    action: v.string(),
    data: v.record(v.string(), v.any()),
    device: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const id = await ctx.db.insert(entity, {
      ...args,
    });

    return await ctx.db.get(id);
  },
});

export const updateOwner = mutation({
  args: {
    guestId: v.id("guest"),
    userId: v.id("storeFrontUser"),
  },
  handler: async (ctx, args) => {
    // Get all analytics records for the guest user
    const records = await ctx.db
      .query(entity)
      .withIndex("by_storeFrontUserId", (q) =>
        q.eq("storeFrontUserId", args.guestId)
      )
      .collect();

    // Update each record in parallel to associate with the authenticated user
    await Promise.all(
      records.map((record) =>
        ctx.db.patch(record._id, {
          storeFrontUserId: args.userId,
        })
      )
    );

    return { updated: records.length };
  },
});

export const getAll = query({
  args: {
    storeId: v.id("store"),
  },
  handler: async (ctx, args) => {
    // TODO: Add pagination
    // if (process.env.STAGE === "prod") {
    //   return await ctx.db
    //     .query(entity)
    //     .withIndex("by_storeId", (q) => q.eq("storeId", args.storeId))
    //     .order("desc")
    //     .collect();
    // }

    return await ctx.db
      .query(entity)
      .withIndex("by_storeId", (q) => q.eq("storeId", args.storeId))
      .order("desc")
      .take(250);
    // .collect();
  },
});

export const getAllPaginated = query({
  args: {
    storeId: v.id("store"),
    cursor: v.union(v.string(), v.null()),
    action: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { page, continueCursor, isDone } = await ctx.db
      .query(entity)
      .withIndex("by_storeId", (q) => q.eq("storeId", args.storeId))
      .filter((q) => q.eq(q.field("action"), args.action))
      .order("desc")
      .paginate({
        numItems: 10,
        cursor: args.cursor,
      });

    return {
      items: page,
      cursor: continueCursor,
      isDone,
    };
  },
});

export const get = query({
  args: {
    id: v.id("analytics"),
  },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

export const getProductViewCount = query({
  args: {
    productId: v.id("product"),
  },
  handler: async (ctx, args) => {
    // Calculate the start of today (midnight)
    const now = new Date();
    const startOfDay = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate()
    ).getTime();

    // All-time views
    const totalRecords = await ctx.db
      .query(entity)
      .filter((q) =>
        q.and(
          q.eq(q.field("action"), "viewed_product"),
          q.eq(q.field("data.product"), args.productId)
        )
      )
      .collect();

    // Today's views
    const dailyRecords = totalRecords.filter(
      (rec) => rec._creationTime >= startOfDay
    );

    return {
      daily: dailyRecords.length,
      total: totalRecords.length,
    };
  },
});

export const getByPromoCodeId = query({
  args: {
    promoCodeId: v.id("promoCode"),
  },
  handler: async (ctx, args) => {
    // Query the analytics table for records with promoCodeId in the data field
    const analytics = await ctx.db
      .query(entity)
      .filter(
        (q) => q.eq(q.field("data.promoCodeId"), args.promoCodeId) // Filter by the action relevant to promo codes
      )
      .order("desc")
      .collect();

    return analytics;
  },
});

export const clear = mutation({
  args: {
    storeId: v.id("store"),
    storeFrontUserId: v.union(v.id("storeFrontUser"), v.id("guest")),
    action: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (args.action) {
      const records = await ctx.db
        .query(entity)
        .withIndex("by_storeId", (q) => q.eq("storeId", args.storeId))
        .filter((q) =>
          q.and(
            q.eq(q.field("storeFrontUserId"), args.storeFrontUserId),
            q.eq(q.field("action"), args.action)
          )
        )
        .collect();

      await Promise.all(records.map((record) => ctx.db.delete(record._id)));

      return {
        deleted: records.length,
      };
    } else {
      const records = await ctx.db
        .query(entity)
        .withIndex("by_storeFrontUserId", (q) =>
          q.eq("storeFrontUserId", args.storeFrontUserId)
        )
        .collect();

      await Promise.all(records.map((record) => ctx.db.delete(record._id)));

      return {
        deleted: records.length,
      };
    }
  },
});
