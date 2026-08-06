import { v } from "convex/values";

import { internalMutation, type MutationCtx } from "../_generated/server";
import { captureSharedDemoAdmittedActionWithCtx } from "../contextTracking/sharedDemoActionCapture";
import { OPERATION_ADMISSION_DEFINITIONS } from "./definitions";
import { resolveSharedDemoOperationAdmission } from "./publicMutation";
import type { OperationAdmissionContext } from "./types";

export function findOperationDefinition(operationId: string) {
  return OPERATION_ADMISSION_DEFINITIONS.find(
    (definition) => definition.operationId === operationId,
  );
}

/**
 * The rail's entry point for Convex *actions*.
 *
 * `admitPublicMutation` cannot serve actions: it needs a `MutationCtx`, and an
 * action has no `db`. Actions instead call this through `ctx.runMutation`,
 * which carries the caller's identity, so the same definition, capability
 * check, store clamp, restore fence, and gateway policy apply.
 *
 * One semantic differs from the mutation path and cannot be papered over: an
 * action is not transactional, so this admission and its recorded event commit
 * on their own. A recorded action therefore means "admitted and started",
 * where the mutation path's rows mean "committed". Denials still stop the
 * action, because a denied admission throws out of the mutation.
 */
export async function admitActionOperationWithCtx(
  ctx: MutationCtx,
  args: { operationId: string; operationArgs: Record<string, unknown> },
  options: {
    capture?: typeof captureSharedDemoAdmittedActionWithCtx;
    resolveAdmission?: (
      resolveCtx: MutationCtx,
      resolveArgs: Record<string, unknown>,
      definition: (typeof OPERATION_ADMISSION_DEFINITIONS)[number],
    ) => Promise<OperationAdmissionContext>;
  } = {},
) {
  const definition = findOperationDefinition(args.operationId);
  if (!definition) {
    throw new Error(
      `Unknown operation admission definition: ${args.operationId}`,
    );
  }

  const resolveAdmission =
    options.resolveAdmission ?? resolveSharedDemoOperationAdmission;
  const admission = await resolveAdmission(
    ctx,
    args.operationArgs,
    definition,
  );

  const capture = options.capture ?? captureSharedDemoAdmittedActionWithCtx;
  await capture(ctx, admission);

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
      v.literal("public"),
    ),
    storeId: v.optional(v.id("store")),
  }),
  handler: (ctx, args) => admitActionOperationWithCtx(ctx, args),
});
