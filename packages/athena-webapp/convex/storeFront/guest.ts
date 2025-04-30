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
    const today = new Date();

    const startOfDay = new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate()
    ).getTime();

    const endOfDay = new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate() + 1
    ).getTime();

    const uniqueVisitors = await ctx.db
      .query(entity)
      .withIndex("by_storeId", (q) => q.eq("storeId", args.storeId))
      .filter((q) =>
        q.and(
          q.gte(q.field("_creationTime"), startOfDay),
          q.lt(q.field("_creationTime"), endOfDay)
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
    const uniqueVisitors = await ctx.db
      .query(entity)
      .withIndex("by_storeId", (q) => q.eq("storeId", args.storeId))
      .collect();

    return uniqueVisitors.length;
  },
});
