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

/**
 * Dev experiment knob: when set (e.g. "low"), every provider call carries
 * `providerOptions.openai.reasoningEffort`. Unset in production.
 */
export const CONVEX_AGENT_REASONING_EFFORT_ENV = "ATHENA_AGENT_REASONING_EFFORT" as const;

function experimentProviderOptions(): Record<string, Record<string, unknown>> | undefined {
  const effort = process.env[CONVEX_AGENT_REASONING_EFFORT_ENV];
  return effort && effort.length > 0 ? { openai: { reasoningEffort: effort } } : undefined;
}

export function createProductionConvexAgentRuntimeAdapter(input: {
  readonly ctx: ConvexAgentRuntimeCtx;
  readonly resolveModel: ConvexAgentModelResolver;
  readonly clock?: () => number;
  readonly maxRetries?: number;
}): ConvexAgentRuntimeAdapter {
  const providerOptions = experimentProviderOptions();
  return createConvexAgentRuntimeAdapter({
    ctx: input.ctx,
    component: components.agent,
    resolveModel: input.resolveModel,
    clock: input.clock,
    maxRetries: input.maxRetries,
    ...(providerOptions ? { providerOptions } : {}),
  });
}
