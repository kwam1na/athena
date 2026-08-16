import { v } from "convex/values";

import { internalMutation, type MutationCtx } from "../_generated/server";
import { admitOperationWithCtx } from "../platform/operationAdmission";

/**
 * TRANSITIONAL module — retired by U1c.
 *
 * The registered admission entry points now live in
 * `convex/platform/admissionEntrypoints.ts`. This module keeps the older,
 * narrower `admitOperationForAction` shape (`{ actorKind, storeId }`) alive at
 * its current path so `storeFront/onlineOrderUtilFns.ts` and
 * `storeFront/reviews.ts` keep compiling until U1c adopts `admitPublicAction`
 * at those sites. It is one of the three files exempt from the rail-core
 * import allowlist.
 */
export { findOperationDefinition } from "./rail";

export async function admitActionOperationWithCtx(
  ctx: MutationCtx,
  args: { operationId: string; operationArgs: Record<string, unknown> },
  options: {
    admit?: typeof admitOperationWithCtx;
  } = {},
) {
  const admission = await (options.admit ?? admitOperationWithCtx)(ctx, args);
  return {
    actorKind: admission.actor.kind,
    storeId: admission.constraints.storeId,
  };
}

export const admitOperationForAction = internalMutation({
  args: {
    operationId: v.string(),
    operationArgs: v.record(v.string(), v.any()),
  },
  returns: v.object({
    actorKind: v.union(
      v.literal("normal_user"),
      v.literal("shared_demo"),
      v.literal("storefront_customer"),
      v.literal("public"),
    ),
    storeId: v.optional(v.id("store")),
  }),
  handler: (ctx, args) => admitActionOperationWithCtx(ctx, args),
});
