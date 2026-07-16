import {
  getAuthSessionId,
  getAuthUserId,
} from "@convex-dev/auth/server";

import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { ServicePrincipalFoundationMutationCtx } from "../schemas/servicePrincipals";
import {
  resolveServicePrincipalAuthBinding,
  resolveServicePrincipalSession,
  ServicePrincipalFoundationError,
} from "./lifecycle";

type ServicePrincipalActorCtx =
  | Pick<QueryCtx, "auth" | "db">
  | Pick<MutationCtx, "auth" | "db">;

const INVALID_SERVICE_SESSION = "The service session is no longer valid.";

function foundationCtx(
  ctx: ServicePrincipalActorCtx,
): ServicePrincipalFoundationMutationCtx {
  return ctx as unknown as ServicePrincipalFoundationMutationCtx;
}

export async function getServicePrincipalActorWithCtx(
  ctx: ServicePrincipalActorCtx,
  options: { now?: number } = {},
) {
  if (typeof ctx.auth?.getUserIdentity !== "function") return null;
  const authUserId = await getAuthUserId(ctx);
  if (!authUserId) return null;

  let binding;
  try {
    binding = await resolveServicePrincipalAuthBinding(foundationCtx(ctx), {
      authUserId,
    });
  } catch (error) {
    if (
      error instanceof ServicePrincipalFoundationError &&
      error.code === "auth_binding_missing"
    ) {
      return null;
    }
    throw error;
  }

  // From this point onward this transport user is exclusively a service
  // identity. Every failure throws so callers cannot fall through to a human
  // email or shared-demo lookup.
  const authSessionId = await getAuthSessionId(ctx);
  if (!authSessionId) throw new Error(INVALID_SERVICE_SESSION);

  const backingAuthSession = await ctx.db.get("authSessions", authSessionId);
  const now = options.now ?? Date.now();
  if (
    !backingAuthSession ||
    backingAuthSession.userId !== authUserId ||
    backingAuthSession.expirationTime <= now
  ) {
    throw new Error(INVALID_SERVICE_SESSION);
  }

  let session;
  try {
    session = await resolveServicePrincipalSession(foundationCtx(ctx), {
      authSessionId,
      authUserId,
      now,
    });
  } catch (error) {
    if (error instanceof ServicePrincipalFoundationError) {
      throw new Error(INVALID_SERVICE_SESSION);
    }
    throw error;
  }

  if (
    session.servicePrincipalAuthBindingId !==
      binding.servicePrincipalAuthBindingId ||
    session.servicePrincipalId !== binding.servicePrincipalId ||
    session.organizationId !== binding.organizationId ||
    session.storeId !== binding.storeId
  ) {
    throw new Error(INVALID_SERVICE_SESSION);
  }

  return {
    kind: "service_principal" as const,
    ...session,
  };
}

export async function requireServicePrincipalActorWithCtx(
  ctx: ServicePrincipalActorCtx,
  options: { now?: number } = {},
) {
  const actor = await getServicePrincipalActorWithCtx(ctx, options);
  if (!actor) throw new Error("A service session is required.");
  return actor;
}
