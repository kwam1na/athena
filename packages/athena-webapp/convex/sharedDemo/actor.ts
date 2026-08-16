import { getAuthUserId } from "@convex-dev/auth/server";

import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { internalQuery } from "../_generated/server";
import type { SharedDemoCapability } from "./policy";
import { denySharedDemoAction, requireSharedDemoCapability } from "./policy";
import { SHARED_DEMO_ALLOWED_CAPABILITIES } from "../platform/capabilityCatalog";
import { isSharedDemoEnabled } from "./config";
import { requireReadySharedDemoWriteWithCtx } from "./restore";

type AuthCtx = Pick<QueryCtx, "auth" | "db"> | Pick<MutationCtx, "auth" | "db">;

export type SharedDemoActorDenialReason = "demo_disabled" | "session_expired";

/**
 * A recognized shared-demo principal failure, carrying its reason as data.
 *
 * Adapters classify on `reason`, never on message text — the message stays
 * user-facing and may change without moving a policy decision.
 */
export class SharedDemoActorError extends Error {
  readonly reason: SharedDemoActorDenialReason;

  constructor(reason: SharedDemoActorDenialReason, message: string) {
    super(message);
    this.name = "SharedDemoActorError";
    this.reason = reason;
  }
}

export function isSharedDemoActorError(
  error: unknown,
): error is SharedDemoActorError {
  return error instanceof SharedDemoActorError;
}

export async function getSharedDemoActorWithCtx(
  ctx: AuthCtx,
  options: {
    environment?: Record<string, string | undefined>;
    now?: number;
  } = {},
) {
  // Some existing unit-level command contexts intentionally omit auth because
  // their normal authorization dependency is mocked. A real Convex context
  // always supplies this method; an incomplete test context is a normal actor.
  if (typeof ctx.auth?.getUserIdentity !== "function") return null;
  const authUserId = await getAuthUserId(ctx);
  if (!authUserId) return null;

  let principal;
  try {
    principal = await ctx.db
      .query("sharedDemoPrincipal")
      .withIndex("by_authUserId", (q) => q.eq("authUserId", authUserId))
      .unique();
  } catch (error) {
    if (error instanceof TypeError) return null;
    throw error;
  }
  if (!principal) {
    return null;
  }
  if (!isSharedDemoEnabled(options.environment ?? process.env)) {
    throw new SharedDemoActorError(
      "demo_disabled",
      "The demo is unavailable in this environment.",
    );
  }
  if (principal.admissionExpiresAt <= (options.now ?? Date.now())) {
    throw new SharedDemoActorError(
      "session_expired",
      "The demo session has expired. Open the demo again.",
    );
  }

  return {
    kind: "shared_demo" as const,
    authUserId,
    athenaUserId: principal.athenaUserId,
    organizationId: principal.organizationId,
    storeId: principal.storeId,
  };
}

export async function requireSharedDemoActorWithCtx(ctx: AuthCtx) {
  const actor = await getSharedDemoActorWithCtx(ctx);
  if (!actor)
    throw new Error("The demo session has expired. Open the demo again.");
  return actor;
}

/** Normal actors pass through unchanged; demo actors are checked against the
 * closed capability registry at the same transaction boundary as the write. */
export async function requireSharedDemoCapabilityIfApplicable(
  ctx: AuthCtx,
  capability: SharedDemoCapability,
) {
  const actor = await getSharedDemoActorWithCtx(ctx);
  if (!actor) return null;
  requireSharedDemoCapability(capability);
  return actor;
}

/** Demo principals are valid only for their server-owned shared store. Normal
 * actors keep using the existing domain authorization path. */
export async function requireSharedDemoStoreCapabilityIfApplicable(
  ctx: AuthCtx,
  capability: SharedDemoCapability,
  storeId: Id<"store">,
) {
  const actor = await requireSharedDemoCapabilityIfApplicable(ctx, capability);
  if (actor && actor.storeId !== storeId) {
    denySharedDemoAction();
  }
  return actor;
}

/** Apply the complete shared-demo write boundary in one place: closed
 * capability policy, server-owned store clamp, and the current restore fence. */
export async function requireReadySharedDemoStoreCapabilityIfApplicable(
  ctx: Pick<MutationCtx, "auth" | "db">,
  capability: SharedDemoCapability,
  storeId: Id<"store">,
) {
  const actor = await requireSharedDemoStoreCapabilityIfApplicable(
    ctx,
    capability,
    storeId,
  );
  if (actor) {
    await requireReadySharedDemoWriteWithCtx(ctx, { storeId });
  }
  return actor;
}

/*
 * `sharedDemoCapabilityValidator` was deleted with them.
 *
 * The U12 contract asked for it to be DERIVED from
 * `SHARED_DEMO_ALLOWED_CAPABILITIES` instead of hand-listed — it had drifted,
 * accepting six capabilities the demo was never granted plus one that no
 * longer exists. Deriving it satisfied that. Deleting it satisfies R10's
 * actual goal more strictly: its only consumer was
 * `enforceSharedDemoActionCapability` above, so once that went the validator
 * was dead code, and dead code cannot drift at all.
 */

/*
 * `enforceSharedDemoActionCapability`, `requireAuthenticatedNonDemoEffect`, and
 * `denySharedDemoEffectIfApplicable` were deleted here.
 *
 * All three were `internalQuery` wrappers that handlers called via
 * `ctx.runQuery` to ask "is this the demo?" mid-handler. R10 retired every such
 * call site: the question is now answered by `actors.sharedDemo` on the
 * operation definition, before the handler is entered. Keeping them exported
 * with zero callers left three live Convex functions in the deployment whose
 * only purpose was a pattern this delivery removed — and a future handler could
 * have reached for one and quietly reintroduced mid-handler demo checks.
 */
