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

export const getByMarker = query({
  args: {
    marker: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const guest = await ctx.db
      .query(entity)
      .filter((q) => q.eq(q.field("marker"), args.marker))
      .first();

    return guest;
  },
});

export const create = mutation({
  args: {
    marker: v.optional(v.string()),
    creationOrigin: v.optional(v.string()),
    storeId: v.optional(v.id("store")),
    organizationId: v.optional(v.id("organization")),
  },
  handler: async (ctx, args) => {
    const id = await ctx.db.insert(entity, {
      marker: args.marker,
      creationOrigin: args.creationOrigin,
      storeId: args.storeId,
      organizationId: args.organizationId,
    });

    return ctx.db.get(id);
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

export const update = mutation({
  args: {
    id: v.id(entity),
    email: v.optional(v.string()),
    firstName: v.optional(v.string()),
    lastName: v.optional(v.string()),
    phoneNumber: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const updates: Record<string, any> = {};
    if (args.email) {
      updates.email = args.email;
    }
    if (args.firstName) {
      updates.firstName = args.firstName;
    }
    if (args.lastName) {
      updates.lastName = args.lastName;
    }
    if (args.phoneNumber) {
      updates.phoneNumber = args.phoneNumber;
    }
    await ctx.db.patch(args.id, updates);
    return await ctx.db.get(args.id);
  },
});

export const getUniqueVisitorsForDay = query({
  args: {
    storeId: v.id("store"),
  },
  handler: async (ctx, args) => {
    // Get UTC midnight today and tomorrow
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    const tomorrow = new Date(today);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);

    const uniqueVisitors = await ctx.db
      .query(entity)
      .withIndex("by_storeId", (q) => q.eq("storeId", args.storeId))
      .filter((q) =>
        q.and(
          q.gte(q.field("_creationTime"), today.getTime()),
          q.lt(q.field("_creationTime"), tomorrow.getTime())
        )
      )
      .collect();

    return uniqueVisitors.length;
  },
});

export const getUniqueVisitors = query({
  args: {
    storeId: v.id("store"),
  },
  handler: async (ctx, args) => {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    const uniqueVisitors = await ctx.db
      .query(entity)
      .withIndex("by_storeId", (q) => q.eq("storeId", args.storeId))
      .filter((q) => q.gte(q.field("_creationTime"), today.getTime()))
      .collect();

    return uniqueVisitors.length;
  },
});

export const getReturningVisitorsForDay = query({
  args: {
    storeId: v.id("store"),
  },
  returns: v.number(),
  handler: async (ctx, args) => {
    // Get UTC midnight today and tomorrow
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    const tomorrow = new Date(today);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);

    // Get all visitors with analytics activity today
    const analyticsToday = await ctx.db
      .query("analytics")
      .withIndex("by_storeId", (q) => q.eq("storeId", args.storeId))
      .filter((q) =>
        q.and(
          q.gte(q.field("_creationTime"), today.getTime()),
          q.lt(q.field("_creationTime"), tomorrow.getTime())
        )
      )
      .collect();

    // Get unique visitor IDs from today's analytics
    const visitorIdsToday = new Set<string>();
    for (const analytic of analyticsToday) {
      if (analytic.storeFrontUserId) {
        visitorIdsToday.add(analytic.storeFrontUserId);
      }
    }

    // Count how many of these users also have analytics records from before today
    let returningVisitors = 0;
    for (const visitorId of visitorIdsToday) {
      const previousActivity = await ctx.db
        .query("analytics")
        .withIndex("by_storeId", (q) => q.eq("storeId", args.storeId))
        .filter((q) =>
          q.and(
            q.eq(q.field("storeFrontUserId"), visitorId),
            q.lt(q.field("_creationTime"), today.getTime())
          )
        )
        .first();

      if (previousActivity) {
        returningVisitors++;
      }
    }

    return returningVisitors;
  },
});
