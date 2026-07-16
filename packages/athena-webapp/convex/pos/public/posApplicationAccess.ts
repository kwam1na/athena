import { v } from "convex/values";

import type { Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import { mutation, query } from "../../_generated/server";
import {
  requireAuthenticatedAthenaUserWithCtx,
  requireOrganizationMemberRoleWithCtx,
} from "../../lib/athenaUserAuth";
import { recordOperationalEventWithCtx } from "../../operations/operationalEvents";
import { requireSharedDemoStoreCapabilityIfApplicable } from "../../sharedDemo/actor";
import {
  servicePrincipalStatusValidator,
  type ServicePrincipalFoundationMutationCtx,
} from "../../schemas/servicePrincipals";
import {
  getPosApplicationAccessStatus,
  setPosApplicationAccess,
} from "../application/posServicePrincipal";

const posApplicationAccessStatusValidator = v.object({
  grantId: v.optional(v.id("servicePrincipalCapability")),
  grantRevision: v.number(),
  principalStatus: v.optional(servicePrincipalStatusValidator),
  servicePrincipalId: v.optional(v.id("servicePrincipal")),
  status: v.union(
    v.literal("enabled"),
    v.literal("revoked"),
    v.literal("not_configured"),
    v.literal("unavailable"),
  ),
});

type PosApplicationAccessCtx =
  Pick<QueryCtx, "auth" | "db"> | Pick<MutationCtx, "auth" | "db">;

async function requireFullAdminApplicationAccess(
  ctx: PosApplicationAccessCtx,
  storeId: Id<"store">,
) {
  await requireSharedDemoStoreCapabilityIfApplicable(
    ctx,
    "pos.terminal.manage",
    storeId,
  );
  const store = await ctx.db.get("store", storeId);
  if (!store) {
    throw new Error("Store not found.");
  }
  const actor = await requireAuthenticatedAthenaUserWithCtx(ctx);
  await requireOrganizationMemberRoleWithCtx(ctx, {
    allowedRoles: ["full_admin"],
    failureMessage: "Only full admins can manage POS application access.",
    organizationId: store.organizationId,
    userId: actor._id,
  });
  return { actor, store };
}

function foundationCtx(ctx: Pick<QueryCtx, "db"> | Pick<MutationCtx, "db">) {
  return ctx as unknown as ServicePrincipalFoundationMutationCtx;
}

export const getApplicationAccessStatus = query({
  args: { storeId: v.id("store") },
  returns: posApplicationAccessStatusValidator,
  handler: async (ctx, args) => {
    const { store } = await requireFullAdminApplicationAccess(
      ctx,
      args.storeId,
    );
    return getPosApplicationAccessStatus(foundationCtx(ctx), {
      organizationId: store.organizationId,
      storeId: store._id,
    });
  },
});

async function changeApplicationAccess(
  ctx: MutationCtx,
  args: {
    enabled: boolean;
    expectedRevision: number;
    storeId: Id<"store">;
  },
) {
  const { actor, store } = await requireFullAdminApplicationAccess(
    ctx,
    args.storeId,
  );
  const now = Date.now();
  const status = await setPosApplicationAccess(foundationCtx(ctx), {
    correlationId: `pos-application-access:${store._id}:${args.expectedRevision}:${now}`,
    enabled: args.enabled,
    expectedRevision: args.expectedRevision,
    now,
    organizationId: store.organizationId,
    storeId: store._id,
  });
  await recordOperationalEventWithCtx(ctx, {
    actorType: "human",
    actorUserId: actor._id,
    eventType: args.enabled
      ? "pos_application_access_enabled"
      : "pos_application_access_revoked",
    message: args.enabled
      ? "POS application access was enabled."
      : "POS application access was revoked.",
    metadata: {
      grantRevision: status.grantRevision,
      status: status.status,
    },
    organizationId: store.organizationId,
    servicePrincipalId: status.servicePrincipalId,
    storeId: store._id,
    subjectId: String(status.grantId ?? status.servicePrincipalId),
    subjectType: "service_principal_capability",
  });
  return status;
}

export const enableApplicationAccess = mutation({
  args: {
    expectedRevision: v.number(),
    storeId: v.id("store"),
  },
  returns: posApplicationAccessStatusValidator,
  handler: (ctx, args) =>
    changeApplicationAccess(ctx, { ...args, enabled: true }),
});

export const revokeApplicationAccess = mutation({
  args: {
    expectedRevision: v.number(),
    storeId: v.id("store"),
  },
  returns: posApplicationAccessStatusValidator,
  handler: (ctx, args) =>
    changeApplicationAccess(ctx, { ...args, enabled: false }),
});
