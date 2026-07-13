import { mutation, query } from "../_generated/server";
import { v } from "convex/values";
import { organizationSchema } from "../schemas/inventory";
import { getSharedDemoActorWithCtx } from "../sharedDemo/actor";
import { requireNonDemoFoundationMutation } from "../sharedDemo/foundation";

const entity = "organization";

export const getAll = query({
  args: {
    userId: v.id("athenaUser"),
  },
  handler: async (ctx, args) => {
    const demoActor = await getSharedDemoActorWithCtx(ctx);
    if (demoActor && args.userId !== demoActor.athenaUserId) return [];
    const memberOrgs = await ctx.db
      .query("organizationMember")
      .filter((q) => q.eq(q.field("userId"), args.userId))
      .collect();

    const orgs = memberOrgs.map((org) => org.organizationId);

    const organizations = await Promise.all(orgs.map((org) => ctx.db.get(org)));

    return organizations.filter((o) => !!o);
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
    const demoActor = await getSharedDemoActorWithCtx(ctx);
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
    if (demoActor && organization._id !== demoActor.organizationId) return null;

    return organization;
  },
});

export const create = mutation({
  args: organizationSchema,
  handler: async (ctx, args) => {
    requireNonDemoFoundationMutation({ athenaUserId: args.createdByUserId });
    const id = await ctx.db.insert(entity, args);

    await ctx.db.insert("organizationMember", {
      userId: args.createdByUserId,
      organizationId: id,
      role: "full_admin",
    });

    return await ctx.db.get(id);
  },
});

export const update = mutation({
  args: {
    id: v.id(entity),
    name: v.string(),
  },
  handler: async (ctx, args) => {
    requireNonDemoFoundationMutation({ organizationId: args.id });
    await ctx.db.patch(args.id, { name: args.name });

    return await ctx.db.get(args.id);
  },
});

export const remove = mutation({
  args: {
    id: v.id(entity),
  },
  handler: async (ctx, args) => {
    requireNonDemoFoundationMutation({ organizationId: args.id });
    await ctx.db.delete(args.id);

    return { message: "OK" };
  },
});
