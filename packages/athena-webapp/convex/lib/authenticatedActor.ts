import { getAuthUserId } from "@convex-dev/auth/server";

import type { MutationCtx, QueryCtx } from "../_generated/server";
import { getAuthenticatedAthenaUserWithCtx } from "./athenaUserAuth";
import { getSharedDemoActorWithCtx } from "../sharedDemo/actor";
import { getServicePrincipalActorWithCtx } from "../servicePrincipals/actor";

type AuthenticatedActorCtx =
  | Pick<QueryCtx, "auth" | "db">
  | Pick<MutationCtx, "auth" | "db">;

export async function getAuthenticatedActorWithCtx(
  ctx: AuthenticatedActorCtx,
) {
  // A bound service user owns the identity lane. The service resolver throws
  // when that binding exists but its exact session is invalid, preventing a
  // transport user from falling through to demo or email-based human access.
  const serviceActor = await getServicePrincipalActorWithCtx(ctx);
  if (serviceActor) return serviceActor;

  const sharedDemoActor = await getSharedDemoActorWithCtx(ctx);
  if (sharedDemoActor) return sharedDemoActor;

  const authUserId = await getAuthUserId(ctx);
  if (!authUserId) return null;

  const athenaUser = await getAuthenticatedAthenaUserWithCtx(ctx);
  if (!athenaUser) return null;

  return {
    kind: "human" as const,
    authUserId,
    athenaUserId: athenaUser._id,
  };
}

export async function requireAuthenticatedActorWithCtx(
  ctx: AuthenticatedActorCtx,
) {
  const actor = await getAuthenticatedActorWithCtx(ctx);
  if (!actor) throw new Error("Sign in again to continue.");
  return actor;
}
