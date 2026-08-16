import type { Id } from "../_generated/dataModel";
import type { OperationActor } from "./types";

export function isSharedDemoOperationActor(actor: OperationActor) {
  return actor.kind === "shared_demo";
}

export function isNormalUserOperationActor(actor: OperationActor) {
  return actor.kind === "normal_user";
}

export function isPublicOperationActor(actor: OperationActor) {
  return actor.kind === "public";
}

/**
 * Athena user id for an admitted actor, or undefined for an anonymous public
 * actor that carries no identity.
 */
export function getOperationActorAthenaUserId(
  actor: OperationActor,
): Id<"athenaUser"> | undefined {
  return actor.kind === "normal_user" || actor.kind === "shared_demo"
    ? actor.athenaUserId
    : undefined;
}

export function isStorefrontCustomerOperationActor(actor: OperationActor) {
  return actor.kind === "storefront_customer";
}

/**
 * Athena user id for an admitted actor that is expected to be identified.
 * Throws for a public actor — used on operations that never opt public in, so
 * this only fires if admission coverage and call-site expectations drift.
 */
export function requireOperationActorAthenaUserId(
  actor: OperationActor,
): Id<"athenaUser"> {
  const athenaUserId = getOperationActorAthenaUserId(actor);
  if (!athenaUserId) {
    throw new Error("Sign in again to continue.");
  }
  return athenaUserId;
}
