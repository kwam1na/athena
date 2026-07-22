import { getAuthUserId } from "@convex-dev/auth/server";

import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { internalQuery } from "../_generated/server";
import { v } from "convex/values";
import type { SharedDemoCapability } from "./policy";
import { denySharedDemoAction, requireSharedDemoCapability } from "./policy";
import { isSharedDemoEnabled } from "./config";
import { requireReadySharedDemoWriteWithCtx } from "./restore";

type AuthCtx = Pick<QueryCtx, "auth" | "db"> | Pick<MutationCtx, "auth" | "db">;

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
    throw new Error("The demo is unavailable in this environment.");
  }
  if (principal.admissionExpiresAt <= (options.now ?? Date.now())) {
    throw new Error("The demo session has expired. Open the demo again.");
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

/** Reads remain available to normal actors, while demo principals may only
 * address the store assigned by the server-owned admission record. */
export async function requireSharedDemoStoreReadIfApplicable(
  ctx: AuthCtx,
  storeId: Id<"store">,
) {
  const actor = await getSharedDemoActorWithCtx(ctx);
  if (actor && actor.storeId !== storeId) {
    denySharedDemoAction();
  }
  return actor;
}

const sharedDemoCapabilityValidator = v.union(
  v.literal("approvals.manage"),
  v.literal("customer.messaging.send"),
  v.literal("expense.manage"),
  v.literal("pos.sale.complete"),
  v.literal("pos.sync.write"),
  v.literal("pos.transaction.correct"),
  v.literal("inventory.adjust"),
  v.literal("cash.control.write"),
  v.literal("catalog.quick_add"),
  v.literal("orders.fulfill"),
  v.literal("orders.manage"),
  v.literal("orders.return"),
  v.literal("reviews.manage"),
  v.literal("staff.communication.write"),
  v.literal("daily_operations.write"),
  v.literal("reports.read"),
  v.literal("staff.authenticate"),
  v.literal("identity.manage"),
  v.literal("permissions.manage"),
  v.literal("billing.manage"),
  v.literal("integrations.manage"),
  v.literal("exports.generate"),
  v.literal("payments.refund"),
  v.literal("administration.destructive"),
  v.literal("demo.lifecycle"),
);

export const enforceSharedDemoActionCapability = internalQuery({
  args: {
    capability: sharedDemoCapabilityValidator,
    storeId: v.optional(v.id("store")),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const actor = args.storeId
      ? await requireSharedDemoStoreCapabilityIfApplicable(
          ctx,
          args.capability,
          args.storeId,
        )
      : await requireSharedDemoCapabilityIfApplicable(ctx, args.capability);
    return Boolean(actor);
  },
});

export const requireAuthenticatedNonDemoEffect = internalQuery({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const authUserId = await getAuthUserId(ctx);
    if (!authUserId) throw new Error("Sign in again to continue.");
    const actor = await getSharedDemoActorWithCtx(ctx);
    if (actor) denySharedDemoAction();
    return null;
  },
});

export const denySharedDemoEffectIfApplicable = internalQuery({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const actor = await getSharedDemoActorWithCtx(ctx);
    if (actor) denySharedDemoAction();
    return null;
  },
});
