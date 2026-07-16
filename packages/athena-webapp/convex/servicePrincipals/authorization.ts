import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { GenericId } from "convex/values";
import type { ServicePrincipalFoundationMutationCtx } from "../schemas/servicePrincipals";
import {
  resolveActiveServicePrincipalCapability,
  type ServicePrincipalCapabilityCatalog,
} from "./capabilities";
import { requireServicePrincipalActorWithCtx } from "./actor";

type ServicePrincipalAuthorizationCtx =
  | Pick<QueryCtx, "auth" | "db">
  | Pick<MutationCtx, "auth" | "db">;

function foundationCtx(
  ctx: ServicePrincipalAuthorizationCtx,
): ServicePrincipalFoundationMutationCtx {
  return ctx as unknown as ServicePrincipalFoundationMutationCtx;
}

export async function requireServicePrincipalCapabilityWithCtx<
  CapabilityId extends string,
>(
  ctx: ServicePrincipalAuthorizationCtx,
  input: {
    capabilityId: CapabilityId;
    catalog: ServicePrincipalCapabilityCatalog<CapabilityId>;
    now?: number;
    organizationId?: GenericId<"organization">;
    storeId?: GenericId<"store">;
  },
) {
  const now = input.now ?? Date.now();
  const actor = await requireServicePrincipalActorWithCtx(ctx, { now });

  if (
    actor.consumerId !== input.catalog.consumerId ||
    actor.requiredCapabilityId !== input.capabilityId ||
    (input.organizationId !== undefined &&
      actor.organizationId !== input.organizationId) ||
    (input.storeId !== undefined && actor.storeId !== input.storeId)
  ) {
    throw new Error("This service session is not authorized for this action.");
  }

  const capability = await resolveActiveServicePrincipalCapability(
    foundationCtx(ctx),
    {
      capabilityId: input.capabilityId,
      catalog: input.catalog,
      consumerId: actor.consumerId,
      now,
      organizationId: actor.organizationId,
      servicePrincipalId: actor.servicePrincipalId,
      storeId: actor.storeId,
    },
  );

  if (capability.revision !== actor.capabilityRevision) {
    throw new Error("This service session is not authorized for this action.");
  }

  return { actor, capability };
}
