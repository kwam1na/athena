import type { GenericId } from "convex/values";

import type { ServicePrincipalFoundationMutationCtx } from "../../schemas/servicePrincipals";
import {
  defineServicePrincipalCapabilityCatalog,
  reconcileServicePrincipalCapabilityGrant,
  resolveActiveServicePrincipalCapability,
  transitionServicePrincipalCapabilityGrant,
} from "../../servicePrincipals/capabilities";
import {
  ServicePrincipalFoundationError,
  STORE_SERVICE_PRINCIPAL_STABLE_KEY,
  reconcileServicePrincipal,
} from "../../servicePrincipals/lifecycle";

export const POS_SERVICE_PRINCIPAL_CONSUMER_ID = "pos";
export const POS_APPLICATION_CAPABILITY_ID = "pos.application";

export const POS_APPLICATION_CAPABILITY_CATALOG =
  defineServicePrincipalCapabilityCatalog(POS_SERVICE_PRINCIPAL_CONSUMER_ID, [
    POS_APPLICATION_CAPABILITY_ID,
  ] as const);

export type PosApplicationAccessStatus = {
  grantId?: GenericId<"servicePrincipalCapability">;
  grantRevision: number;
  principalStatus?: "active" | "disabled" | "revoked" | "decommissioned";
  servicePrincipalId?: GenericId<"servicePrincipal">;
  status: "enabled" | "revoked" | "not_configured" | "unavailable";
};

type PosServicePrincipalScope = {
  organizationId: GenericId<"organization">;
  storeId: GenericId<"store">;
};

function assertSameStore(
  row: PosServicePrincipalScope,
  scope: PosServicePrincipalScope,
) {
  if (
    row.organizationId !== scope.organizationId ||
    row.storeId !== scope.storeId
  ) {
    throw new ServicePrincipalFoundationError("scope_mismatch");
  }
}

export async function getPosApplicationAccessStatus(
  ctx: ServicePrincipalFoundationMutationCtx,
  scope: PosServicePrincipalScope,
): Promise<PosApplicationAccessStatus> {
  const principals = await ctx.db
    .query("servicePrincipal")
    .withIndex("by_organizationId_and_storeId_and_stableKey", (query) =>
      query
        .eq("organizationId", scope.organizationId)
        .eq("storeId", scope.storeId)
        .eq("stableKey", STORE_SERVICE_PRINCIPAL_STABLE_KEY),
    )
    .take(2);
  if (principals.length > 1) {
    throw new ServicePrincipalFoundationError("duplicate_principal");
  }
  const principal = principals[0];
  if (!principal) {
    return { grantRevision: 0, status: "not_configured" };
  }

  const grants = await ctx.db
    .query("servicePrincipalCapability")
    .withIndex(
      "by_servicePrincipalId_and_consumerId_and_capabilityId",
      (query) =>
        query
          .eq("servicePrincipalId", principal._id)
          .eq("consumerId", POS_SERVICE_PRINCIPAL_CONSUMER_ID)
          .eq("capabilityId", POS_APPLICATION_CAPABILITY_ID),
    )
    .take(2);
  if (grants.length > 1) {
    throw new ServicePrincipalFoundationError("capability_duplicated");
  }
  const grant = grants[0];
  const base = {
    principalStatus: principal.status,
    servicePrincipalId: principal._id,
  };
  if (!grant) {
    return {
      ...base,
      grantRevision: 0,
      status: principal.status === "active" ? "not_configured" : "unavailable",
    };
  }
  assertSameStore(grant, scope);
  if (
    grant.servicePrincipalId !== principal._id ||
    grant.consumerId !== POS_SERVICE_PRINCIPAL_CONSUMER_ID ||
    grant.capabilityId !== POS_APPLICATION_CAPABILITY_ID
  ) {
    throw new ServicePrincipalFoundationError("capability_absent");
  }
  return {
    ...base,
    grantId: grant._id,
    grantRevision: grant.revision,
    status:
      principal.status !== "active"
        ? "unavailable"
        : grant.status === "active"
          ? "enabled"
          : "revoked",
  };
}

export async function reconcilePosServicePrincipal(
  ctx: ServicePrincipalFoundationMutationCtx,
  input: PosServicePrincipalScope & {
    now: number;
    correlationId: string;
  },
) {
  const principal = await reconcileServicePrincipal(ctx, {
    ...input,
    stableKey: STORE_SERVICE_PRINCIPAL_STABLE_KEY,
  });
  const grant = await reconcileServicePrincipalCapabilityGrant(ctx, {
    ...input,
    capabilityId: POS_APPLICATION_CAPABILITY_ID,
    catalog: POS_APPLICATION_CAPABILITY_CATALOG,
    consumerId: POS_SERVICE_PRINCIPAL_CONSUMER_ID,
    servicePrincipalId: principal.servicePrincipalId,
  });
  return {
    createdGrant: grant.created,
    createdPrincipal: principal.created,
    grantId: grant.grantId,
    grantRevision: grant.revision,
    grantStatus: grant.status,
    principalLifecycleRevision: principal.lifecycleRevision,
    principalStatus: principal.status,
    servicePrincipalId: principal.servicePrincipalId,
  };
}

async function transitionPosApplicationCapability(
  ctx: ServicePrincipalFoundationMutationCtx,
  input: PosServicePrincipalScope & {
    servicePrincipalId: GenericId<"servicePrincipal">;
    grantId: GenericId<"servicePrincipalCapability">;
    expectedRevision: number;
    nextStatus: "active" | "revoked";
    now: number;
    correlationId: string;
  },
) {
  const [principal, grant] = await Promise.all([
    ctx.db.get("servicePrincipal", input.servicePrincipalId),
    ctx.db.get("servicePrincipalCapability", input.grantId),
  ]);
  if (!principal) {
    throw new ServicePrincipalFoundationError("principal_missing");
  }
  if (!grant) {
    throw new ServicePrincipalFoundationError("capability_absent");
  }
  assertSameStore(principal, input);
  assertSameStore(grant, input);
  if (
    principal.stableKey !== STORE_SERVICE_PRINCIPAL_STABLE_KEY ||
    grant.servicePrincipalId !== principal._id ||
    grant.consumerId !== POS_SERVICE_PRINCIPAL_CONSUMER_ID ||
    grant.capabilityId !== POS_APPLICATION_CAPABILITY_ID
  ) {
    throw new ServicePrincipalFoundationError("capability_absent");
  }
  return transitionServicePrincipalCapabilityGrant(ctx, input);
}

export function enablePosApplicationCapability(
  ctx: ServicePrincipalFoundationMutationCtx,
  input: PosServicePrincipalScope & {
    servicePrincipalId: GenericId<"servicePrincipal">;
    grantId: GenericId<"servicePrincipalCapability">;
    expectedRevision: number;
    now: number;
    correlationId: string;
  },
) {
  return transitionPosApplicationCapability(ctx, {
    ...input,
    nextStatus: "active",
  });
}

export function revokePosApplicationCapability(
  ctx: ServicePrincipalFoundationMutationCtx,
  input: PosServicePrincipalScope & {
    servicePrincipalId: GenericId<"servicePrincipal">;
    grantId: GenericId<"servicePrincipalCapability">;
    expectedRevision: number;
    now: number;
    correlationId: string;
  },
) {
  return transitionPosApplicationCapability(ctx, {
    ...input,
    nextStatus: "revoked",
  });
}

export async function setPosApplicationAccess(
  ctx: ServicePrincipalFoundationMutationCtx,
  input: PosServicePrincipalScope & {
    enabled: boolean;
    expectedRevision: number;
    now: number;
    correlationId: string;
  },
) {
  const current = await getPosApplicationAccessStatus(ctx, input);
  if (current.grantRevision !== input.expectedRevision) {
    throw new ServicePrincipalFoundationError("stale_revision");
  }

  if (!current.grantId || !current.servicePrincipalId) {
    if (!input.enabled) {
      throw new ServicePrincipalFoundationError("capability_absent");
    }
    await reconcilePosServicePrincipal(ctx, input);
  } else if (input.enabled) {
    await enablePosApplicationCapability(ctx, {
      ...input,
      grantId: current.grantId,
      servicePrincipalId: current.servicePrincipalId,
    });
  } else {
    await revokePosApplicationCapability(ctx, {
      ...input,
      grantId: current.grantId,
      servicePrincipalId: current.servicePrincipalId,
    });
  }

  return getPosApplicationAccessStatus(ctx, input);
}

export function resolvePosApplicationCapability(
  ctx: ServicePrincipalFoundationMutationCtx,
  input: PosServicePrincipalScope & {
    servicePrincipalId: GenericId<"servicePrincipal">;
    now: number;
  },
) {
  return resolveActiveServicePrincipalCapability(ctx, {
    ...input,
    capabilityId: POS_APPLICATION_CAPABILITY_ID,
    catalog: POS_APPLICATION_CAPABILITY_CATALOG,
    consumerId: POS_SERVICE_PRINCIPAL_CONSUMER_ID,
  });
}
