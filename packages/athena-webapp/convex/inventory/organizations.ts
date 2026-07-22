import { mutation, query } from "../_generated/server";
import { v } from "convex/values";
import { organizationSchema } from "../schemas/inventory";
import { requireNonDemoFoundationMutation } from "../sharedDemo/foundation";
import { withOperationReadAdmission } from "../operationAdmission/publicQuery";
import {
  getOrganizationByIdOrSlugReadDefinition,
  listAthenaUserOrganizationsReadDefinition,
} from "../operationAdmission/readDefinitions";
import type { OperationQueryCtx } from "../operationAdmission/types";
import type { Id } from "../_generated/dataModel";

const entity = "organization";

export const getAll = query({
  args: {
    userId: v.id("athenaUser"),
  },
  handler: withOperationReadAdmission(
    listAthenaUserOrganizationsReadDefinition,
    async (ctx: OperationQueryCtx, args: { userId: Id<"athenaUser"> }) => {
      const admittedActor = ctx.operationAdmission.actor;
      if (
        admittedActor.kind === "shared_demo" &&
        args.userId !== admittedActor.athenaUserId
      )
        return [];
      const memberOrgs = await ctx.db
        .query("organizationMember")
        .withIndex("by_userId", (q) => q.eq("userId", args.userId))
        .take(100);

      const orgs = memberOrgs.map((org) => org.organizationId);

      const organizations = await Promise.all(
        orgs.map((org) => ctx.db.get("organization", org)),
      );

      return organizations.filter((o) => !!o);
    },
  ),
});

export const getById = query({
  args: {
    id: v.id(entity),
  },
  handler: async (ctx, args) => {
    const organization = await ctx.db.get("organization", args.id);
    return organization ? [organization] : [];
  },
});

export const getByIdOrSlug = query({
  args: {
    identifier: v.union(v.id(entity), v.string()),
  },
  handler: withOperationReadAdmission(
    getOrganizationByIdOrSlugReadDefinition,
    async (
      ctx: OperationQueryCtx,
      args: { identifier: Id<"organization"> | string },
    ) => {
      const organization = await ctx.db
        .query(entity)
        .filter((q) =>
          q.or(
            q.eq(q.field("slug"), args.identifier),
            q.eq(q.field("_id"), args.identifier),
          ),
        )
        .first();

      if (!organization) {
        return null;
      }
      const admittedActor = ctx.operationAdmission.actor;
      if (
        admittedActor.kind === "shared_demo" &&
        organization._id !== admittedActor.organizationId
      )
        return null;

      return organization;
    },
  ),
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

    return await ctx.db.get("organization", id);
  },
});

export const update = mutation({
  args: {
    id: v.id(entity),
    name: v.string(),
  },
  handler: async (ctx, args) => {
    requireNonDemoFoundationMutation({ organizationId: args.id });
    await ctx.db.patch("organization", args.id, { name: args.name });

    return await ctx.db.get("organization", args.id);
  },
});

export const remove = mutation({
  args: {
    id: v.id(entity),
  },
  handler: async (ctx, args) => {
    requireNonDemoFoundationMutation({ organizationId: args.id });
    await ctx.db.delete("organization", args.id);

    return { message: "OK" };
  },
});
