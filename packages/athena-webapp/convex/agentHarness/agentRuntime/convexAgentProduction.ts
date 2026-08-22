"use node";
/**
 * Production construction of the Convex Agent runtime adapter.
 *
 * The kernel's runtime host may not name the mounted component
 * (`components.agent` is a runtime-native identifier reserved to this
 * directory), so this is the one place the adapter is bound to it. Model
 * selection stays an injected resolver (`modelRegistry.ts`); the kernel
 * receives an `AgentRuntimeAdapter` plus the Athena-side authoring seams and
 * nothing runtime-native.
 */
import { components } from "../../_generated/api";
// eslint-disable-next-line @convex-dev/import-wrong-runtime -- this module is "use node" too; the rule only inspects the imported file
import {
  createConvexAgentRuntimeAdapter,
  type ConvexAgentModelResolver,
  type ConvexAgentRuntimeAdapter,
  type ConvexAgentRuntimeCtx,
} from "./convexAgent";

export type { ConvexAgentModelResolver, ConvexAgentRuntimeAdapter, ConvexAgentRuntimeCtx };

export function createProductionConvexAgentRuntimeAdapter(input: {
  readonly ctx: ConvexAgentRuntimeCtx;
  readonly resolveModel: ConvexAgentModelResolver;
  readonly clock?: () => number;
  readonly maxRetries?: number;
}): ConvexAgentRuntimeAdapter {
  return createConvexAgentRuntimeAdapter({
    ctx: input.ctx,
    component: components.agent,
    resolveModel: input.resolveModel,
    clock: input.clock,
    maxRetries: input.maxRetries,
  });
}
