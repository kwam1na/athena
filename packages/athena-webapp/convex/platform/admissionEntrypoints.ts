import { v } from "convex/values";

import { internalMutation, internalQuery } from "../_generated/server";
import {
  admitOperationWithCtx,
  admitReadOperationWithCtx,
} from "./operationAdmission";

/**
 * Registered admission entry points.
 *
 * Actions and HTTP routes have no `db`, so they enter the rail through these.
 * They live next to the composition root rather than in the rail core so the
 * core exports only factories and pure logic and no import cycle exists at
 * module init.
 *
 * The write path is a mutation (it records the admitted action for shared-demo
 * visibility through the injected capture port). The read path is a query: no
 * write, no capture — browse traffic must not pay for a transaction.
 */
const scopeConstraintsValidator = v.object({
  organizationId: v.optional(v.id("organization")),
  storeId: v.optional(v.id("store")),
});

const actorValidator = v.union(
  v.object({
    kind: v.literal("normal_user"),
    athenaUserId: v.id("athenaUser"),
  }),
  v.object({
    kind: v.literal("shared_demo"),
    authUserId: v.id("users"),
    athenaUserId: v.id("athenaUser"),
    organizationId: v.id("organization"),
    storeId: v.id("store"),
  }),
  v.object({
    kind: v.literal("storefront_customer"),
    assurance: v.literal("bearer_id"),
    storeId: v.id("store"),
    storeFrontUserId: v.optional(v.id("storeFrontUser")),
    guestId: v.optional(v.id("guest")),
  }),
  v.object({ kind: v.literal("public") }),
);

const admissionProjectionValidator = v.object({
  actor: actorValidator,
  constraints: scopeConstraintsValidator,
  decision: v.object({
    adapter: v.union(
      v.literal("normal_user"),
      v.literal("shared_demo"),
      v.literal("storefront_customer"),
      v.literal("public"),
    ),
    outcome: v.literal("admitted"),
  }),
  operationId: v.string(),
  provenance: v.record(v.string(), v.any()),
});

export const admitOperation = internalMutation({
  args: {
    operationId: v.string(),
    operationArgs: v.record(v.string(), v.any()),
  },
  returns: admissionProjectionValidator,
  handler: (ctx, args) => admitOperationWithCtx(ctx, args),
});

export const admitReadOperation = internalQuery({
  args: {
    operationId: v.string(),
    operationArgs: v.record(v.string(), v.any()),
  },
  returns: admissionProjectionValidator,
  handler: (ctx, args) => admitReadOperationWithCtx(ctx, args),
});
