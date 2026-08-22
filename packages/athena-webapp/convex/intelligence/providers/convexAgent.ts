/**
 * Convex Agent model path as an Athena intelligence provider (V26-1265).
 *
 * The agent harness does not generate structured text through the TanStack
 * adapter; its model turns run behind the Athena runtime adapter (U5). This
 * module is the provider-registry face of that path: a descriptor with its
 * own capability id, the provider key every harness run records on
 * `intelligenceRun.providerKey` / `intelligenceProviderInvocation`, and the
 * normalizer that turns the kernel's settled usage (U2 reconciler output)
 * into the same `AthenaProviderUsage` / evidence summary shape the TanStack
 * path records. TanStack AI stays a separate provider; neither imports the
 * other, and no runtime-native usage object reaches this module.
 */
import type { AthenaProviderConfigStatus, AthenaProviderDescriptor, AthenaProviderUsage, JsonObject } from "../types";

/** Capability id of the agent turn path (distinct from `structured_text.v1`). */
export const ATHENA_AGENT_TURN_V1 = "agent_turn.v1" as const;

/** Provider key recorded on harness runs and provider invocations. */
export const CONVEX_AGENT_PROVIDER_KEY = "convex_agent" as const;

export type ConvexAgentProviderDescriptor = Omit<AthenaProviderDescriptor, "capabilities"> & {
  readonly capabilities: readonly [typeof ATHENA_AGENT_TURN_V1];
};

export type ConvexAgentProviderOptions = {
  readonly configStatus?: AthenaProviderConfigStatus;
  readonly defaultModelId?: string;
};

export function createConvexAgentProviderDescriptor(options: ConvexAgentProviderOptions = {}): ConvexAgentProviderDescriptor {
  return {
    id: CONVEX_AGENT_PROVIDER_KEY,
    label: "Convex Agent model path (Athena runtime adapter)",
    capabilities: [ATHENA_AGENT_TURN_V1],
    configStatus: options.configStatus ?? { status: "available" },
    defaultModelId: options.defaultModelId,
  };
}

/** Token totals the kernel settled (U2 reconciler); never a provider-native object. */
export type ConvexAgentSettledUsage = {
  readonly tokens: { readonly input: number; readonly output: number; readonly cachedInput: number; readonly reasoning: number };
  readonly streams: number;
  readonly conservative: boolean;
  readonly settledBy: readonly string[];
  readonly lateEventCount: number;
  readonly costUnits: number;
};

export function toAthenaProviderUsage(settled: ConvexAgentSettledUsage): AthenaProviderUsage {
  return {
    inputTokens: settled.tokens.input,
    outputTokens: settled.tokens.output,
    totalTokens: settled.tokens.input + settled.tokens.output,
    estimatedCostMicros: settled.costUnits,
    currency: "athena_cost_units",
  };
}

/** The `responseSummary` an agent turn records on its provider invocation row. */
export function buildConvexAgentInvocationSummary(settled: ConvexAgentSettledUsage, outcome: "completed" | "failed" | "canceled"): JsonObject {
  return {
    provider: CONVEX_AGENT_PROVIDER_KEY,
    capability: ATHENA_AGENT_TURN_V1,
    outcome,
    usage: {
      input: settled.tokens.input,
      output: settled.tokens.output,
      cachedInput: settled.tokens.cachedInput,
      reasoning: settled.tokens.reasoning,
    },
    streams: settled.streams,
    conservative: settled.conservative,
    settledBy: [...settled.settledBy],
    lateEventCount: settled.lateEventCount,
    costUnits: settled.costUnits,
  };
}
