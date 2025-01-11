import { mutation, query } from "../_generated/server";
import { v } from "convex/values";
import { organizationSchema } from "../schemas/inventory";

const entity = "organization";

export const getAll = query({
  args: {
    userId: v.id("athenaUser"),
  },
  handler: async (ctx, args) => {
    const organizations = await ctx.db
      .query(entity)
      .filter((q) => q.eq(q.field("createdByUserId"), args.userId))
      .collect();

    return organizations;
  },
});

export const getById = query({
  args: {
    id: v.id(entity),
  },
  handler: async (ctx, args) => {
    const organization = await ctx.db
      .query(entity)
      .filter((q) => q.eq(q.field("_id"), args.id))
      .collect();

    return organization;
  },
});

export const getByIdOrSlug = query({
  args: {
    identifier: v.union(v.id(entity), v.string()),
  },
  handler: async (ctx, args) => {
    const organization = await ctx.db
      .query(entity)
      .filter((q) =>
        q.or(
          q.eq(q.field("slug"), args.identifier),
          q.eq(q.field("_id"), args.identifier)
        )
      )
      .first();

    if (!organization) {
      return null;
    }

    return organization;
  },
});

export const create = mutation({
  args: organizationSchema,
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
