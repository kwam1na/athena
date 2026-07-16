import type { GenericId } from "convex/values";

import type { ServicePrincipalFoundationMutationCtx } from "../schemas/servicePrincipals";
import {
  ServicePrincipalFoundationError,
  type ServicePrincipalFoundationErrorCode,
} from "./lifecycle";

function fail(code: ServicePrincipalFoundationErrorCode): never {
  throw new ServicePrincipalFoundationError(code);
}

export type ServicePrincipalCapabilityCatalog<CapabilityId extends string = string> = {
  readonly consumerId: string;
  readonly capabilityIds: readonly CapabilityId[];
  has(capabilityId: string): capabilityId is CapabilityId;
};

export function defineServicePrincipalCapabilityCatalog<
  const CapabilityIds extends readonly string[],
>(
  consumerId: string,
  capabilityIds: CapabilityIds,
): ServicePrincipalCapabilityCatalog<CapabilityIds[number]> {
  if (!/^[a-z][a-z0-9_-]*$/.test(consumerId) || capabilityIds.length === 0) {
    fail("capability_catalog_invalid");
  }
  const declared = new Set<string>();
  for (const capabilityId of capabilityIds) {
    if (!capabilityId.startsWith(`${consumerId}.`)) {
      fail("capability_namespace_mismatch");
    }
    if (!/^[a-z][a-z0-9_-]*(?:\.[a-z][a-z0-9_-]*)+$/.test(capabilityId)) {
      fail("capability_catalog_invalid");
    }
    if (declared.has(capabilityId)) fail("duplicate_capability");
    declared.add(capabilityId);
  }
  const immutableIds = Object.freeze([...capabilityIds]) as unknown as CapabilityIds;
  return Object.freeze({
    consumerId,
    capabilityIds: immutableIds,
    has(capabilityId: string): capabilityId is CapabilityIds[number] {
      return declared.has(capabilityId);
    },
  });
}

function assertDeclaredCapability(
  catalog: ServicePrincipalCapabilityCatalog,
  consumerId: string,
  capabilityId: string,
) {
  if (catalog.consumerId !== consumerId) {
    fail("capability_namespace_mismatch");
  }
  if (!catalog.has(capabilityId)) fail("capability_absent");
}

function assertScope(
  row: {
    organizationId: GenericId<"organization">;
    storeId: GenericId<"store">;
  },
  input: {
    organizationId: GenericId<"organization">;
    storeId: GenericId<"store">;
  },
) {
  if (
    row.organizationId !== input.organizationId ||
    row.storeId !== input.storeId
  ) {
    throw new ServicePrincipalFoundationError("scope_mismatch");
  }
}

export async function reconcileServicePrincipalCapabilityGrant(
  ctx: ServicePrincipalFoundationMutationCtx,
  input: {
    organizationId: GenericId<"organization">;
    storeId: GenericId<"store">;
    servicePrincipalId: GenericId<"servicePrincipal">;
    consumerId: string;
    capabilityId: string;
    catalog: ServicePrincipalCapabilityCatalog;
    now: number;
    correlationId: string;
    expiresAt?: number;
  },
) {
  assertDeclaredCapability(input.catalog, input.consumerId, input.capabilityId);
  const principal = await ctx.db.get(
    "servicePrincipal",
    input.servicePrincipalId,
  );
  if (!principal) fail("principal_missing");
  assertScope(principal, input);
  if (principal.status !== "active") fail("principal_inactive");

  const existing = await ctx.db
    .query("servicePrincipalCapability")
    .withIndex(
      "by_servicePrincipalId_and_consumerId_and_capabilityId",
      (query) =>
        query
          .eq("servicePrincipalId", input.servicePrincipalId)
          .eq("consumerId", input.consumerId)
          .eq("capabilityId", input.capabilityId),
    )
    .take(2);
  if (existing.length > 1) fail("capability_duplicated");
  if (existing[0]) {
    assertScope(existing[0], input);
    return {
      capabilityId: existing[0].capabilityId,
      consumerId: existing[0].consumerId,
      created: false,
      grantId: existing[0]._id,
      revision: existing[0].revision,
      status: existing[0].status,
    };
  }

  const base = {
    organizationId: input.organizationId,
    storeId: input.storeId,
    servicePrincipalId: input.servicePrincipalId,
    consumerId: input.consumerId,
    capabilityId: input.capabilityId,
    status: "active" as const,
    revision: 1,
    grantedAt: input.now,
    updatedAt: input.now,
    lastCorrelationId: input.correlationId,
  };
  const grantId = await ctx.db.insert(
    "servicePrincipalCapability",
    input.expiresAt === undefined ? base : { ...base, expiresAt: input.expiresAt },
  );
  return {
    capabilityId: input.capabilityId,
    consumerId: input.consumerId,
    created: true,
    grantId,
    revision: 1,
    status: "active" as const,
  };
}

export async function transitionServicePrincipalCapabilityGrant(
  ctx: ServicePrincipalFoundationMutationCtx,
  input: {
    grantId: GenericId<"servicePrincipalCapability">;
    expectedRevision: number;
    nextStatus: "active" | "revoked";
    now: number;
    correlationId: string;
    expiresAt?: number;
  },
) {
  const grant = await ctx.db.get("servicePrincipalCapability", input.grantId);
  if (!grant) fail("capability_absent");
  if (grant.revision !== input.expectedRevision) fail("stale_revision");
  if (grant.status === input.nextStatus && input.expiresAt === undefined) {
    return {
      grantId: grant._id,
      revision: grant.revision,
      status: grant.status,
    };
  }
  const revision = grant.revision + 1;
  const patch = {
    status: input.nextStatus,
    revision,
    updatedAt: input.now,
    lastCorrelationId: input.correlationId,
    ...(input.nextStatus === "revoked" ? { revokedAt: input.now } : {}),
    ...(input.expiresAt === undefined ? {} : { expiresAt: input.expiresAt }),
  };
  await ctx.db.patch("servicePrincipalCapability", grant._id, patch);
  return { grantId: grant._id, revision, status: input.nextStatus };
}

export async function resolveActiveServicePrincipalCapability(
  ctx: ServicePrincipalFoundationMutationCtx,
  input: {
    organizationId: GenericId<"organization">;
    storeId: GenericId<"store">;
    servicePrincipalId: GenericId<"servicePrincipal">;
    consumerId: string;
    capabilityId: string;
    catalog: ServicePrincipalCapabilityCatalog;
    now: number;
  },
) {
  assertDeclaredCapability(input.catalog, input.consumerId, input.capabilityId);
  const principal = await ctx.db.get(
    "servicePrincipal",
    input.servicePrincipalId,
  );
  if (!principal) fail("principal_missing");
  assertScope(principal, input);
  if (principal.status !== "active") fail("principal_inactive");

  const grants = await ctx.db
    .query("servicePrincipalCapability")
    .withIndex(
      "by_servicePrincipalId_and_consumerId_and_capabilityId",
      (query) =>
        query
          .eq("servicePrincipalId", input.servicePrincipalId)
          .eq("consumerId", input.consumerId)
          .eq("capabilityId", input.capabilityId),
    )
    .take(2);
  if (grants.length > 1) fail("capability_duplicated");
  const grant = grants[0];
  if (!grant) fail("capability_absent");
  assertScope(grant, input);
  if (grant.status !== "active") fail("capability_inactive");
  if (grant.expiresAt !== undefined && input.now >= grant.expiresAt) {
    fail("capability_expired");
  }
  return {
    capabilityId: grant.capabilityId,
    consumerId: grant.consumerId,
    expiresAt: grant.expiresAt,
    grantId: grant._id,
    organizationId: grant.organizationId,
    revision: grant.revision,
    servicePrincipalId: grant.servicePrincipalId,
    storeId: grant.storeId,
  };
}
