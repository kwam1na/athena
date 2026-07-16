import type { GenericId } from "convex/values";

import type { ServicePrincipalFoundationMutationCtx } from "../schemas/servicePrincipals";

export const STORE_SERVICE_PRINCIPAL_STABLE_KEY = "store.service";

export type ServicePrincipalFoundationErrorCode =
  | "auth_binding_decommissioned"
  | "auth_binding_missing"
  | "auth_binding_duplicated"
  | "auth_session_already_bound"
  | "auth_user_already_bound"
  | "capability_absent"
  | "capability_catalog_invalid"
  | "capability_duplicated"
  | "capability_expired"
  | "capability_inactive"
  | "capability_namespace_mismatch"
  | "duplicate_capability"
  | "duplicate_principal"
  | "invalid_lifecycle_transition"
  | "invalid_stable_key"
  | "principal_already_bound"
  | "principal_inactive"
  | "principal_missing"
  | "scope_mismatch"
  | "session_duplicated"
  | "session_expired"
  | "session_inactive"
  | "session_missing"
  | "stale_principal_revision"
  | "stale_revision";

export class ServicePrincipalFoundationError extends Error {
  readonly code: ServicePrincipalFoundationErrorCode;

  constructor(code: ServicePrincipalFoundationErrorCode) {
    super(code);
    this.name = "ServicePrincipalFoundationError";
    this.code = code;
  }
}

function fail(code: ServicePrincipalFoundationErrorCode): never {
  throw new ServicePrincipalFoundationError(code);
}

function assertStableKey(stableKey: string) {
  if (!/^[a-z][a-z0-9_-]*(?:\.[a-z][a-z0-9_-]*)+$/.test(stableKey)) {
    fail("invalid_stable_key");
  }
}

function assertScope(
  row: {
    organizationId: GenericId<"organization">;
    storeId: GenericId<"store">;
  },
  scope: {
    organizationId: GenericId<"organization">;
    storeId: GenericId<"store">;
  },
) {
  if (
    row.organizationId !== scope.organizationId ||
    row.storeId !== scope.storeId
  ) {
    fail("scope_mismatch");
  }
}

export async function reconcileServicePrincipal(
  ctx: ServicePrincipalFoundationMutationCtx,
  input: {
    organizationId: GenericId<"organization">;
    storeId: GenericId<"store">;
    stableKey: string;
    servicePrincipalId?: GenericId<"servicePrincipal">;
    now: number;
    correlationId: string;
  },
) {
  assertStableKey(input.stableKey);

  if (input.servicePrincipalId) {
    const principal = await ctx.db.get(
      "servicePrincipal",
      input.servicePrincipalId,
    );
    if (!principal) fail("principal_missing");
    assertScope(principal, input);
    if (principal.stableKey !== input.stableKey) fail("scope_mismatch");
    return {
      created: false,
      lifecycleRevision: principal.lifecycleRevision,
      servicePrincipalId: principal._id,
      status: principal.status,
    };
  }

  const existing = await ctx.db
    .query("servicePrincipal")
    .withIndex(
      "by_organizationId_and_storeId_and_stableKey",
      (query) =>
        query
          .eq("organizationId", input.organizationId)
          .eq("storeId", input.storeId)
          .eq("stableKey", input.stableKey),
    )
    .take(2);
  if (existing.length > 1) fail("duplicate_principal");
  if (existing[0]) {
    return {
      created: false,
      lifecycleRevision: existing[0].lifecycleRevision,
      servicePrincipalId: existing[0]._id,
      status: existing[0].status,
    };
  }

  const servicePrincipalId = await ctx.db.insert("servicePrincipal", {
    organizationId: input.organizationId,
    storeId: input.storeId,
    stableKey: input.stableKey,
    status: "active",
    lifecycleRevision: 1,
    createdAt: input.now,
    updatedAt: input.now,
    lastCorrelationId: input.correlationId,
  });
  return {
    created: true,
    lifecycleRevision: 1,
    servicePrincipalId,
    status: "active" as const,
  };
}

const ALLOWED_PRINCIPAL_TRANSITIONS = {
  active: new Set(["disabled", "revoked", "decommissioned"]),
  disabled: new Set(["active", "revoked", "decommissioned"]),
  revoked: new Set(["decommissioned"]),
  decommissioned: new Set<string>(),
} as const;

export async function transitionServicePrincipal(
  ctx: ServicePrincipalFoundationMutationCtx,
  input: {
    servicePrincipalId: GenericId<"servicePrincipal">;
    expectedRevision: number;
    nextStatus: "active" | "disabled" | "revoked" | "decommissioned";
    now: number;
    correlationId: string;
  },
) {
  const principal = await ctx.db.get(
    "servicePrincipal",
    input.servicePrincipalId,
  );
  if (!principal) fail("principal_missing");
  if (principal.lifecycleRevision !== input.expectedRevision) {
    fail("stale_revision");
  }
  if (principal.status === input.nextStatus) {
    return {
      lifecycleRevision: principal.lifecycleRevision,
      servicePrincipalId: principal._id,
      status: principal.status,
    };
  }
  if (!ALLOWED_PRINCIPAL_TRANSITIONS[principal.status].has(input.nextStatus)) {
    fail("invalid_lifecycle_transition");
  }

  const lifecycleRevision = principal.lifecycleRevision + 1;
  const transitionTimestamp =
    input.nextStatus === "disabled"
      ? { disabledAt: input.now }
      : input.nextStatus === "revoked"
        ? { revokedAt: input.now }
        : input.nextStatus === "decommissioned"
          ? { decommissionedAt: input.now }
          : {};
  await ctx.db.patch("servicePrincipal", principal._id, {
    ...transitionTimestamp,
    status: input.nextStatus,
    lifecycleRevision,
    updatedAt: input.now,
    lastCorrelationId: input.correlationId,
  });
  return {
    lifecycleRevision,
    servicePrincipalId: principal._id,
    status: input.nextStatus,
  };
}

export async function reconcileServicePrincipalAuthBinding(
  ctx: ServicePrincipalFoundationMutationCtx,
  input: {
    organizationId: GenericId<"organization">;
    storeId: GenericId<"store">;
    servicePrincipalId: GenericId<"servicePrincipal">;
    authUserId: GenericId<"users">;
    now: number;
    correlationId: string;
  },
) {
  const principal = await ctx.db.get(
    "servicePrincipal",
    input.servicePrincipalId,
  );
  if (!principal) fail("principal_missing");
  assertScope(principal, input);
  if (principal.status !== "active") fail("principal_inactive");

  const [byUser, byPrincipal] = await Promise.all([
    ctx.db
      .query("servicePrincipalAuthBinding")
      .withIndex("by_authUserId", (query) =>
        query.eq("authUserId", input.authUserId),
      )
      .take(2),
    ctx.db
      .query("servicePrincipalAuthBinding")
      .withIndex("by_servicePrincipalId", (query) =>
        query.eq("servicePrincipalId", input.servicePrincipalId),
      )
      .take(2),
  ]);
  if (byUser.length > 1 || byPrincipal.length > 1) {
    fail("auth_binding_duplicated");
  }
  const userBinding = byUser[0];
  const principalBinding = byPrincipal[0];
  if (
    userBinding &&
    (userBinding.servicePrincipalId !== input.servicePrincipalId ||
      userBinding.organizationId !== input.organizationId ||
      userBinding.storeId !== input.storeId)
  ) {
    fail("auth_user_already_bound");
  }
  if (
    principalBinding &&
    (principalBinding.authUserId !== input.authUserId ||
      principalBinding.organizationId !== input.organizationId ||
      principalBinding.storeId !== input.storeId)
  ) {
    fail("principal_already_bound");
  }
  const existing = userBinding ?? principalBinding;
  if (existing) {
    if (existing.status !== "active") fail("auth_binding_decommissioned");
    return {
      authUserId: existing.authUserId,
      created: false,
      revision: existing.revision,
      servicePrincipalAuthBindingId: existing._id,
      servicePrincipalId: existing.servicePrincipalId,
      status: existing.status,
    };
  }

  const servicePrincipalAuthBindingId = await ctx.db.insert(
    "servicePrincipalAuthBinding",
    {
      organizationId: input.organizationId,
      storeId: input.storeId,
      servicePrincipalId: input.servicePrincipalId,
      authUserId: input.authUserId,
      status: "active",
      revision: 1,
      createdAt: input.now,
      updatedAt: input.now,
      lastCorrelationId: input.correlationId,
    },
  );
  return {
    authUserId: input.authUserId,
    created: true,
    revision: 1,
    servicePrincipalAuthBindingId,
    servicePrincipalId: input.servicePrincipalId,
    status: "active" as const,
  };
}

export async function decommissionServicePrincipalAuthBinding(
  ctx: ServicePrincipalFoundationMutationCtx,
  input: {
    servicePrincipalAuthBindingId: GenericId<"servicePrincipalAuthBinding">;
    expectedRevision: number;
    now: number;
    correlationId: string;
  },
) {
  const binding = await ctx.db.get(
    "servicePrincipalAuthBinding",
    input.servicePrincipalAuthBindingId,
  );
  if (!binding) fail("auth_binding_missing");
  if (binding.revision !== input.expectedRevision) fail("stale_revision");
  if (binding.status === "decommissioned") return binding;
  const revision = binding.revision + 1;
  await ctx.db.patch("servicePrincipalAuthBinding", binding._id, {
    status: "decommissioned",
    revision,
    decommissionedAt: input.now,
    updatedAt: input.now,
    lastCorrelationId: input.correlationId,
  });
  return { ...binding, status: "decommissioned" as const, revision };
}

export async function resolveServicePrincipalAuthBinding(
  ctx: ServicePrincipalFoundationMutationCtx,
  input: {
    authUserId: GenericId<"users">;
    organizationId?: GenericId<"organization">;
    storeId?: GenericId<"store">;
  },
) {
  const bindings = await ctx.db
    .query("servicePrincipalAuthBinding")
    .withIndex("by_authUserId", (query) =>
      query.eq("authUserId", input.authUserId),
    )
    .take(2);
  if (bindings.length > 1) fail("auth_binding_duplicated");
  const binding = bindings[0];
  if (!binding) fail("auth_binding_missing");
  if (binding.status !== "active") fail("auth_binding_decommissioned");
  if (
    (input.organizationId && binding.organizationId !== input.organizationId) ||
    (input.storeId && binding.storeId !== input.storeId)
  ) {
    fail("scope_mismatch");
  }
  return {
    authUserId: binding.authUserId,
    organizationId: binding.organizationId,
    revision: binding.revision,
    servicePrincipalAuthBindingId: binding._id,
    servicePrincipalId: binding.servicePrincipalId,
    storeId: binding.storeId,
  };
}

export async function issueServicePrincipalSession(
  ctx: ServicePrincipalFoundationMutationCtx,
  input: {
    organizationId: GenericId<"organization">;
    storeId: GenericId<"store">;
    servicePrincipalId: GenericId<"servicePrincipal">;
    servicePrincipalAuthBindingId: GenericId<"servicePrincipalAuthBinding">;
    authUserId: GenericId<"users">;
    authSessionId: GenericId<"authSessions">;
    consumerId: string;
    requiredCapabilityId: string;
    principalLifecycleRevision: number;
    capabilityRevision: number;
    now: number;
    idleExpiresAt: number;
    absoluteExpiresAt: number;
    correlationId: string;
  },
) {
  const [principal, binding] = await Promise.all([
    ctx.db.get("servicePrincipal", input.servicePrincipalId),
    ctx.db.get(
      "servicePrincipalAuthBinding",
      input.servicePrincipalAuthBindingId,
    ),
  ]);
  if (!principal) fail("principal_missing");
  assertScope(principal, input);
  if (principal.status !== "active") fail("principal_inactive");
  if (principal.lifecycleRevision !== input.principalLifecycleRevision) {
    fail("stale_principal_revision");
  }
  if (!binding) fail("auth_binding_missing");
  if (binding.status !== "active") fail("auth_binding_decommissioned");
  if (
    binding.authUserId !== input.authUserId ||
    binding.servicePrincipalId !== input.servicePrincipalId
  ) {
    fail("scope_mismatch");
  }
  assertScope(binding, input);

  const existing = await ctx.db
    .query("servicePrincipalSession")
    .withIndex("by_authSessionId", (query) =>
      query.eq("authSessionId", input.authSessionId),
    )
    .take(2);
  if (existing.length > 1) fail("session_duplicated");
  if (existing[0]) {
    const session = existing[0];
    if (
      session.authUserId !== input.authUserId ||
      session.servicePrincipalId !== input.servicePrincipalId ||
      session.servicePrincipalAuthBindingId !==
        input.servicePrincipalAuthBindingId ||
      session.consumerId !== input.consumerId ||
      session.requiredCapabilityId !== input.requiredCapabilityId
    ) {
      fail("auth_session_already_bound");
    }
    return {
      absoluteExpiresAt: session.absoluteExpiresAt,
      authSessionId: session.authSessionId,
      created: false,
      servicePrincipalSessionId: session._id,
      status: session.status,
    };
  }

  const servicePrincipalSessionId = await ctx.db.insert(
    "servicePrincipalSession",
    {
      organizationId: input.organizationId,
      storeId: input.storeId,
      servicePrincipalId: input.servicePrincipalId,
      servicePrincipalAuthBindingId: input.servicePrincipalAuthBindingId,
      authUserId: input.authUserId,
      authSessionId: input.authSessionId,
      consumerId: input.consumerId,
      requiredCapabilityId: input.requiredCapabilityId,
      principalLifecycleRevision: input.principalLifecycleRevision,
      capabilityRevision: input.capabilityRevision,
      status: "active",
      revision: 1,
      issuedAt: input.now,
      lastSeenAt: input.now,
      idleExpiresAt: input.idleExpiresAt,
      absoluteExpiresAt: input.absoluteExpiresAt,
      updatedAt: input.now,
      lastCorrelationId: input.correlationId,
    },
  );
  return {
    absoluteExpiresAt: input.absoluteExpiresAt,
    authSessionId: input.authSessionId,
    created: true,
    servicePrincipalSessionId,
    status: "active" as const,
  };
}

export async function resolveServicePrincipalSession(
  ctx: ServicePrincipalFoundationMutationCtx,
  input: {
    authUserId: GenericId<"users">;
    authSessionId: GenericId<"authSessions">;
    now: number;
  },
) {
  const sessions = await ctx.db
    .query("servicePrincipalSession")
    .withIndex("by_authSessionId", (query) =>
      query.eq("authSessionId", input.authSessionId),
    )
    .take(2);
  if (sessions.length > 1) fail("session_duplicated");
  const session = sessions[0];
  if (!session) fail("session_missing");
  if (session.authUserId !== input.authUserId) fail("scope_mismatch");
  if (session.status !== "active") fail("session_inactive");
  if (
    input.now >= session.idleExpiresAt ||
    input.now >= session.absoluteExpiresAt
  ) {
    fail("session_expired");
  }

  const [binding, principal] = await Promise.all([
    ctx.db.get(
      "servicePrincipalAuthBinding",
      session.servicePrincipalAuthBindingId,
    ),
    ctx.db.get("servicePrincipal", session.servicePrincipalId),
  ]);
  if (!binding) fail("auth_binding_missing");
  if (binding.status !== "active") fail("auth_binding_decommissioned");
  if (
    binding.authUserId !== input.authUserId ||
    binding.servicePrincipalId !== session.servicePrincipalId
  ) {
    fail("scope_mismatch");
  }
  if (!principal) fail("principal_missing");
  if (principal.status !== "active") fail("principal_inactive");
  if (principal.lifecycleRevision !== session.principalLifecycleRevision) {
    fail("stale_principal_revision");
  }

  return {
    absoluteExpiresAt: session.absoluteExpiresAt,
    authSessionId: session.authSessionId,
    authUserId: session.authUserId,
    capabilityRevision: session.capabilityRevision,
    consumerId: session.consumerId,
    idleExpiresAt: session.idleExpiresAt,
    organizationId: session.organizationId,
    principalLifecycleRevision: session.principalLifecycleRevision,
    requiredCapabilityId: session.requiredCapabilityId,
    servicePrincipalAuthBindingId: session.servicePrincipalAuthBindingId,
    servicePrincipalId: session.servicePrincipalId,
    servicePrincipalSessionId: session._id,
    sessionRevision: session.revision,
    storeId: session.storeId,
  };
}
