"use node";
/**
 * Default model resolution for the Convex Agent adapter.
 *
 * Model selection is an injected input to the adapter; the kernel's model registry
 * (governed by profile/provider egress policy) replaces this. The default
 * targets the provider the dev deployment already holds credentials for
 * (`OPENAI_API_KEY`) and refuses everything else with a typed error, so no
 * selection can silently fall through to an unconfigured provider.
 */
import { createOpenAI } from "@ai-sdk/openai";

import type { AgentModelSelection } from "../../../shared/agentHarness/agentRuntime";
// eslint-disable-next-line @convex-dev/import-wrong-runtime -- this module is "use node" too; the rule only inspects the imported file
import { ConvexAgentAdapterError, type ConvexAgentLanguageModel } from "./convexAgent";

export const CONVEX_AGENT_DEFAULT_PROVIDER_ID = "openai" as const;
export const CONVEX_AGENT_DEFAULT_MODEL_ID = "gpt-5-nano" as const;
export const CONVEX_AGENT_PROVIDER_API_KEY_ENV = "OPENAI_API_KEY" as const;
export type ResolveDefaultLanguageModelOptions = {
  readonly apiKey?: string;
};

export function resolveDefaultLanguageModel(
  selection: AgentModelSelection,
  options: ResolveDefaultLanguageModelOptions = {},
): ConvexAgentLanguageModel {
  if (selection.providerId !== CONVEX_AGENT_DEFAULT_PROVIDER_ID) {
    throw new ConvexAgentAdapterError("provider_not_configured", `Provider "${selection.providerId}" has no configured model path.`);
  }
  const apiKey = options.apiKey ?? process.env[CONVEX_AGENT_PROVIDER_API_KEY_ENV];
  if (!apiKey) {
    throw new ConvexAgentAdapterError("provider_credentials_missing", `${CONVEX_AGENT_PROVIDER_API_KEY_ENV} is not configured.`);
  }
  // The dev model-override env knob was removed (review finding: it swapped
  // the billed model AFTER egress provider selection recorded evidence from
  // the pinned selection — an instruction-guarded bypass in a codebase whose
  // adjudicated principle is mechanical enforcement). Experiments override
  // the model by editing the profile allowance through the fence instead.
  return createOpenAI({ apiKey })(selection.modelId);
}
