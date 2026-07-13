import { getAuthUserId } from "@convex-dev/auth/server";

import type { MutationCtx, QueryCtx } from "../_generated/server";
import { internalQuery } from "../_generated/server";
import { v } from "convex/values";
import type { SharedDemoCapability } from "./policy";
import { requireSharedDemoCapability } from "./policy";
import { isSharedDemoEnabled } from "./config";

type AuthCtx =
  | Pick<QueryCtx, "auth" | "db">
  | Pick<MutationCtx, "auth" | "db">;

export async function getSharedDemoActorWithCtx(
  ctx: AuthCtx,
  options: { environment?: Record<string, string | undefined>; now?: number } = {},
) {
  // Some existing unit-level command contexts intentionally omit auth because
  // their normal authorization dependency is mocked. A real Convex context
  // always supplies this method; an incomplete test context is a normal actor.
  if (typeof ctx.auth?.getUserIdentity !== "function") return null;
  const authUserId = await getAuthUserId(ctx);
  if (!authUserId) return null;

  const principal = await ctx.db
    .query("sharedDemoPrincipal")
    .withIndex("by_authUserId", (q) => q.eq("authUserId", authUserId))
    .unique();
  if (!principal) {
    return null;
  }
  if (!isSharedDemoEnabled(options.environment ?? process.env)) {
    throw new Error("The shared demo is unavailable in this environment.");
  }
  if (principal.admissionExpiresAt <= (options.now ?? Date.now())) {
    throw new Error("The shared demo session has expired. Open the demo again.");
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
  if (!actor) throw new Error("The shared demo session has expired. Open the demo again.");
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

const sharedDemoCapabilityValidator = v.union(
  v.literal("pos.sale.complete"), v.literal("inventory.adjust"),
  v.literal("cash.control.write"), v.literal("orders.fulfill"),
  v.literal("staff.communication.write"), v.literal("daily_operations.write"),
  v.literal("reports.read"), v.literal("identity.manage"),
  v.literal("permissions.manage"), v.literal("billing.manage"),
  v.literal("integrations.manage"), v.literal("exports.generate"),
  v.literal("payments.refund"), v.literal("administration.destructive"),
);

export const enforceSharedDemoActionCapability = internalQuery({
  args: { capability: sharedDemoCapabilityValidator },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireSharedDemoCapabilityIfApplicable(ctx, args.capability);
    return null;
  },
});

export const requireAuthenticatedNonDemoEffect = internalQuery({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const authUserId = await getAuthUserId(ctx);
    if (!authUserId) throw new Error("Sign in again to continue.");
    const actor = await getSharedDemoActorWithCtx(ctx);
    if (actor) throw new Error("This action is unavailable in the shared demo.");
    return null;
  },
});

export const denySharedDemoEffectIfApplicable = internalQuery({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const actor = await getSharedDemoActorWithCtx(ctx);
    if (actor) throw new Error("This action is unavailable in the shared demo.");
    return null;
  },
});
