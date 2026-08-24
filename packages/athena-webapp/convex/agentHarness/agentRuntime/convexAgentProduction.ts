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

/**
 * Default reasoning effort for the production adapter. Measured 2026-08-24 on
 * the 20-question regression set with gpt-5-mini and the disclosure
 * scaffolding (embedded catalog, enum signatures, ref snapping): low effort
 * committed 20/20 with zero denials, first-delta p50 4.1 s (vs ~16 s at the
 * default), total elapsed p50 14.8 s (vs ~39 s), and 4x fewer reasoning
 * tokens. The env var still overrides (e.g. "medium") for experiments.
 */
const CONVEX_AGENT_DEFAULT_REASONING_EFFORT = "low" as const;

function experimentProviderOptions(): Record<string, Record<string, unknown>> | undefined {
  const effort = process.env[CONVEX_AGENT_REASONING_EFFORT_ENV] ?? CONVEX_AGENT_DEFAULT_REASONING_EFFORT;
  return effort.length > 0 ? { openai: { reasoningEffort: effort } } : undefined;
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
