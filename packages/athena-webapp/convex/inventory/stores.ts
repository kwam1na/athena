import { mutation, query } from "../_generated/server";
import { v } from "convex/values";
import { storeSchema } from "../schemas/inventory";

const entity = "store";

export const getAll = query({
  args: {
    organizationId: v.id("organization"),
  },
  handler: async (ctx, args) => {
    const stores = await ctx.db
      .query(entity)
      .filter((q) => q.eq(q.field("organizationId"), args.organizationId))
      .collect();

    return stores;
  },
});

export const getById = query({
  args: {
    id: v.id(entity),
    organizationId: v.id("organization"),
  },
  handler: async (ctx, args) => {
    const categories = await ctx.db
      .query(entity)
      .filter((q) =>
        q.and(
          q.eq(q.field("_id"), args.id),
          q.eq(q.field("organizationId"), args.organizationId)
        )
      )
      .collect();

    return categories;
  },
});

export const findById = query({
  args: {
    id: v.id(entity),
  },
  handler: async (ctx, args) => {
    const store = await ctx.db.get(args.id);

    return store;
  },
});

export const getByIdOrSlug = query({
  args: {
    identifier: v.union(v.id(entity), v.string()),
    organizationId: v.id("organization"),
  },
  handler: async (ctx, args) => {
    const store = await ctx.db
      .query(entity)
      .filter((q) =>
        q.or(
          q.and(
            q.eq(q.field("_id"), args.identifier),
            q.eq(q.field("organizationId"), args.organizationId)
          ),
          q.and(
            q.eq(q.field("slug"), args.identifier),
            q.eq(q.field("organizationId"), args.organizationId)
          )
        )
      )
      .first();

    if (!store) {
      return null;
    }

    return store;
  },
});

export const create = mutation({
  args: storeSchema,
  handler: async (ctx, args) => {
    const id = await ctx.db.insert(entity, args);

    return await ctx.db.get(id);
  },
});

export const update = mutation({
  args: {
    id: v.id(entity),
    name: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, { name: args.name });

    return await ctx.db.get(args.id);
  },
});

export const remove = mutation({
  args: {
    id: v.id(entity),
  },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.id);

    return { message: "OK" };
  },
});

export const updateConfig = mutation({
  args: {
    id: v.id(entity),
    config: v.record(v.string(), v.any()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, { config: args.config });

    return await ctx.db.get(args.id);
  },
});
