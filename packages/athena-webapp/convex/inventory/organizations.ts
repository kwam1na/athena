import { internal } from "../_generated/api";
import { internalMutation, mutation, query } from "../_generated/server";
import type { MutationCtx } from "../_generated/server";
import { v } from "convex/values";
import { organizationSchema } from "../schemas/inventory";
import {
  admitPublicMutation,
  admitPublicQuery,
} from "../platform/operationAdmission";
import {
  getOrganizationByIdOrSlugReadDefinition,
  listAthenaUserOrganizationsReadDefinition,
} from "../operationAdmission/readDefinitions";
import { getOrganizationByIdReadDefinition } from "../operationAdmission/domains/inventoryIdentity_readDefinitions";
import {
  createOrganizationOperationDefinition,
  removeOrganizationOperationDefinition,
  updateOrganizationOperationDefinition,
} from "../operationAdmission/domains/inventoryIdentity_definitions";
import type {
  OperationMutationCtx,
  OperationQueryCtx,
} from "../operationAdmission/types";
import type { Id } from "../_generated/dataModel";
import { deleteWeeklyReportingForStoreWithCtx } from "./stores";

const entity = "organization";
const ORGANIZATION_STORE_DELETE_BATCH_SIZE = 10;

async function removeOrganizationBatchWithCtx(
  ctx: MutationCtx,
  organizationId: Id<"organization">,
  cursor: string | null,
): Promise<boolean> {
  const organization = await ctx.db.get("organization", organizationId);
  if (!organization) return true;

  const stores = await ctx.db
    .query("store")
    .withIndex("by_organizationId_slug", (q) =>
      q.eq("organizationId", organizationId),
    )
    .paginate({ cursor, numItems: ORGANIZATION_STORE_DELETE_BATCH_SIZE });
  if (stores.page.length === 0) {
    if (stores.isDone) {
      await ctx.db.delete("organization", organizationId);
      return true;
    }
    await ctx.scheduler.runAfter(
      0,
      internal.inventory.organizations.continueOrganizationRemoval,
      { organizationId, cursor: stores.continueCursor },
    );
    return false;
  }

  let storeHasMoreWeeklyRows = false;
  for (const store of stores.page) {
    const cleanup = await deleteWeeklyReportingForStoreWithCtx(ctx, store._id);
    storeHasMoreWeeklyRows ||= cleanup.hasMore;
  }
  if (storeHasMoreWeeklyRows) {
    await ctx.scheduler.runAfter(
      0,
      internal.inventory.organizations.continueOrganizationRemoval,
      { organizationId, cursor },
    );
    return false;
  }

  if (stores.isDone) {
    await ctx.db.delete("organization", organizationId);
    return true;
  }
  await ctx.scheduler.runAfter(
    0,
    internal.inventory.organizations.continueOrganizationRemoval,
    { organizationId, cursor: stores.continueCursor },
  );
  return false;
}

export async function removeOrganizationWithCtx(
  ctx: MutationCtx,
  organizationId: Id<"organization">,
): Promise<boolean> {
  return removeOrganizationBatchWithCtx(ctx, organizationId, null);
}

export const continueOrganizationRemoval = internalMutation({
  args: {
    organizationId: v.id("organization"),
    cursor: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args) =>
    removeOrganizationBatchWithCtx(ctx, args.organizationId, args.cursor),
});

export const getAll = query({
  args: {
    userId: v.id("athenaUser"),
  },
  handler: admitPublicQuery(
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
  handler: admitPublicQuery(
    getOrganizationByIdReadDefinition,
    async (ctx: OperationQueryCtx, args: { id: Id<"organization"> }) => {
      const organization = await ctx.db.get("organization", args.id);
      return organization ? [organization] : [];
    },
  ),
});

export const getByIdOrSlug = query({
  args: {
    identifier: v.union(v.id(entity), v.string()),
  },
  handler: admitPublicQuery(
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
  // `requireNonDemoFoundationMutation({ athenaUserId: createdByUserId })`
  // retired here and re-expressed as `target.protectDemoFoundation` bound to
  // `createdByUserId`, so the guard still runs for every actor kind.
  handler: admitPublicMutation(
    createOrganizationOperationDefinition,
    async (
      ctx: OperationMutationCtx,
      args: {
        name: string;
        slug: string;
        createdByUserId: Id<"athenaUser">;
      },
    ) => {
    const id = await ctx.db.insert(entity, args);

    await ctx.db.insert("organizationMember", {
      userId: args.createdByUserId,
      organizationId: id,
      role: "full_admin",
    });

    return await ctx.db.get("organization", id);
    },
  ),
});

export const update = mutation({
  args: {
    id: v.id(entity),
    name: v.string(),
  },
  // `requireNonDemoFoundationMutation({ organizationId: id })` retired here and
  // re-expressed as `target.protectDemoFoundation` bound to `id`.
  handler: admitPublicMutation(
    updateOrganizationOperationDefinition,
    async (
      ctx: OperationMutationCtx,
      args: { id: Id<"organization">; name: string },
    ) => {
      await ctx.db.patch("organization", args.id, { name: args.name });

      return await ctx.db.get("organization", args.id);
    },
  ),
});

export const remove = mutation({
  args: {
    id: v.id(entity),
  },
  // `requireNonDemoFoundationMutation({ organizationId: id })` retired here and
  // re-expressed as `target.protectDemoFoundation` bound to `id`.
  handler: admitPublicMutation(
    removeOrganizationOperationDefinition,
    async (ctx: OperationMutationCtx, args: { id: Id<"organization"> }) => {
      await removeOrganizationWithCtx(ctx, args.id);

      return { message: "OK" };
    },
  ),
});
