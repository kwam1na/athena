"use node";
/**
 * Model registry (kernel; Node runtime — it loads the provider SDK through
 * `agentRuntime/models.ts`).
 *
 * Authority boundary: the registry is the ONLY place a provider/model/region
 * selection becomes a language model. It is governed by `egressPolicy.ts`:
 * the turn's selection was chosen for the turn's maximum egress class, is
 * locked for the whole turn (a resolver asked for a different selection on
 * the same turn refuses), and credentials are validated up front through the
 * provider module so a missing key is a typed `provider_credentials_missing`
 * rather than a provider round trip. Credentials never leave the provider
 * module; the registry records rate cards and evidence facts only.
 */
import type { AgentModelSelection, AgentUsageRateCard } from "../../shared/agentHarness/agentRuntime";
// eslint-disable-next-line @convex-dev/import-wrong-runtime -- this module is "use node" too; the rule only inspects the imported file
import { CONVEX_AGENT_PROVIDER_API_KEY_ENV, resolveDefaultLanguageModel } from "./agentRuntime/models";
import { createModelSelectionLock } from "./egressPolicy";

export const AGENT_CONTRACT_FAKE_PROVIDER_ID = "athena_contract_fake" as const;

/** Cost units per million tokens; conservative defaults for models without a card. */
export const AGENT_DEFAULT_RATE_CARD: AgentUsageRateCard = Object.freeze({
  perMillion: Object.freeze({ input: 1_000, output: 4_000, cachedInput: 250, reasoning: 4_000 }),
});

export const AGENT_MODEL_RATE_CARDS: { readonly [model: string]: AgentUsageRateCard } = Object.freeze({
  "openai/gpt-5-nano": { perMillion: { input: 50, output: 400, cachedInput: 5, reasoning: 400 } },
  "openai/gpt-5-mini": { perMillion: { input: 250, output: 2_000, cachedInput: 25, reasoning: 2_000 } },
  "openai/gpt-5": { perMillion: { input: 1_250, output: 10_000, cachedInput: 125, reasoning: 10_000 } },
  [`${AGENT_CONTRACT_FAKE_PROVIDER_ID}/fake-1`]: { perMillion: { input: 0, output: 0, cachedInput: 0, reasoning: 0 } },
});

export function rateCardFor(selection: Pick<AgentModelSelection, "providerId" | "modelId">): AgentUsageRateCard {
  return AGENT_MODEL_RATE_CARDS[`${selection.providerId}/${selection.modelId}`] ?? AGENT_DEFAULT_RATE_CARD;
}

/** Startup credential validation: names only, never values. */
export function isProviderConfigured(providerId: string, environment: Record<string, string | undefined> = process.env): boolean {
  switch (providerId) {
    case "openai":
      return typeof environment[CONVEX_AGENT_PROVIDER_API_KEY_ENV] === "string" && environment[CONVEX_AGENT_PROVIDER_API_KEY_ENV]!.length > 0;
    case AGENT_CONTRACT_FAKE_PROVIDER_ID:
      return false;
    default:
      return false;
  }
}

export type AgentModelRegistryOptions = {
  /** The selection the egress policy chose for this turn; the resolver refuses any other. */
  readonly selection: AgentModelSelection;
  readonly turnKey: string;
  /** Test seam: a model for the contract-fake provider (never configured in production). */
  readonly fakeModel?: unknown;
};

export class AgentModelRegistryError extends Error {
  readonly athenaCode: string;
  constructor(athenaCode: string, message: string) {
    super(message);
    this.name = "AgentModelRegistryError";
    this.athenaCode = athenaCode;
  }
}

/**
 * Build the resolver the adapter calls at `startTurn`. It locks the selection
 * for the turn and hands the provider module the selection only; the provider
 * module reads its own credential.
 */
export function createAthenaModelResolver(options: AgentModelRegistryOptions) {
  const lock = createModelSelectionLock();
  lock.lock(options.turnKey, options.selection);
  return (selection: AgentModelSelection, context: { readonly turnKey: string }) => {
    const locked = lock.lock(context.turnKey, selection);
    if (locked.kind === "conflict") {
      throw new AgentModelRegistryError("model_selection_locked", "The model for this turn is fixed; a different selection was refused.");
    }
    if (context.turnKey !== options.turnKey) {
      throw new AgentModelRegistryError("model_selection_locked", "The resolver is bound to one turn.");
    }
    if (selection.providerId === AGENT_CONTRACT_FAKE_PROVIDER_ID) {
      if (options.fakeModel === undefined) {
        throw new AgentModelRegistryError("provider_not_configured", "The contract-fake provider is not available outside tests.");
      }
      return options.fakeModel as never;
    }
    return resolveDefaultLanguageModel(selection);
  };
}
