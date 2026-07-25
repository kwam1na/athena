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
  return actor.kind === "public" ? undefined : actor.athenaUserId;
}

/**
 * Athena user id for an admitted actor that is expected to be identified.
 * Throws for a public actor — used on operations that never opt public in, so
 * this only fires if admission coverage and call-site expectations drift.
 */
export function requireOperationActorAthenaUserId(
  actor: OperationActor,
): Id<"athenaUser"> {
  if (actor.kind === "public") {
    throw new Error("Sign in again to continue.");
  }
  return actor.athenaUserId;
}
