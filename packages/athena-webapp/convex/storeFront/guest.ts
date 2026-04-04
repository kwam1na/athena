import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "../_generated/server";
import { v } from "convex/values";
import { Id } from "../_generated/dataModel";

const entity = "guest";
const MAX_GUESTS = 5000;
const MAX_ANALYTICS_VISITORS = 2000;

export const getAll = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query(entity).take(MAX_GUESTS);
  },
});

export const getById = internalQuery({
  args: {
    id: v.id(entity),
  },
  handler: async (ctx, args) => {
    return await ctx.db.get("guest", args.id);
  },
});

export const getByMarker = internalQuery({
  args: {
    marker: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const guest = await ctx.db
      .query(entity)
      .withIndex("by_marker", (q) => q.eq("marker", args.marker))
      .first();

    return guest;
  },
});

export const create = internalMutation({
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

    return ctx.db.get("guest", id);
  },
});

export const deleteGuest = mutation({
  args: {
    id: v.id(entity),
  },
  handler: async (ctx, args) => {
    await ctx.db.delete("guest", args.id);
    return { message: "Guest deleted" };
  },
});

export const update = internalMutation({
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
    await ctx.db.patch("guest", args.id, updates);
    return await ctx.db.get("guest", args.id);
  },
});

export const getUniqueVisitorsForDay = query({
  args: {
    storeId: v.id("store"),
    startTimeMs: v.number(),
    endTimeMs: v.number(),
  },
  handler: async (ctx, args) => {
    const uniqueVisitors = await ctx.db
      .query(entity)
      .withIndex("by_storeId", (q) => q.eq("storeId", args.storeId))
      .filter((q) =>
        q.and(
          q.gte(q.field("_creationTime"), args.startTimeMs),
          q.lt(q.field("_creationTime"), args.endTimeMs)
        )
      )
      .take(MAX_GUESTS);

    return uniqueVisitors.length;
  },
});

export const getUniqueVisitors = query({
  args: {
    storeId: v.id("store"),
    startTimeMs: v.number(),
  },
  handler: async (ctx, args) => {
    const uniqueVisitors = await ctx.db
      .query(entity)
      .withIndex("by_storeId", (q) => q.eq("storeId", args.storeId))
      .filter((q) => q.gte(q.field("_creationTime"), args.startTimeMs))
      .take(MAX_GUESTS);

    return uniqueVisitors.length;
  },
});

export const getReturningVisitorsForDay = query({
  args: {
    storeId: v.id("store"),
    startTimeMs: v.number(),
    endTimeMs: v.number(),
  },
  returns: v.number(),
  handler: async (ctx, args) => {
    // Get all visitors with analytics activity today
    const analyticsToday = await ctx.db
      .query("analytics")
      .withIndex("by_storeId", (q) => q.eq("storeId", args.storeId))
      .filter((q) =>
        q.and(
          q.gte(q.field("_creationTime"), args.startTimeMs),
          q.lt(q.field("_creationTime"), args.endTimeMs)
        )
      )
      .take(MAX_ANALYTICS_VISITORS);

    // Get unique visitor IDs from today's analytics
    const visitorIdsToday = new Set<Id<"storeFrontUser"> | Id<"guest">>();
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
        .withIndex("by_storeFrontUserId_storeId", (q) =>
          q.eq("storeFrontUserId", visitorId).eq("storeId", args.storeId)
        )
        .filter((q) => q.lt(q.field("_creationTime"), args.startTimeMs))
        .first();

      if (previousActivity) {
        returningVisitors++;
      }
    }

    return returningVisitors;
  },
});
