// @vitest-environment node
/**
 * Model registry: the one place a provider/model selection becomes a language
 * model. These tests pin the turn lock, the contract-fake seam, credential
 * validation by name only, and the rate-card lookup — the provider SDK itself
 * is mocked so no credential or network is involved.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentModelSelection } from "../../shared/agentHarness/agentRuntime";

const resolveDefaultLanguageModel = vi.fn();

vi.mock("./agentRuntime/models", () => ({
  CONVEX_AGENT_PROVIDER_API_KEY_ENV: "OPENAI_API_KEY",
  resolveDefaultLanguageModel: (...args: unknown[]) => resolveDefaultLanguageModel(...args),
}));

const {
  AGENT_CONTRACT_FAKE_PROVIDER_ID,
  AGENT_DEFAULT_RATE_CARD,
  AGENT_MODEL_RATE_CARDS,
  AgentModelRegistryError,
  createAthenaModelResolver,
  isProviderConfigured,
  rateCardFor,
} = await import("./modelRegistry");

const openaiSelection: AgentModelSelection = { providerId: "openai", modelId: "gpt-5-nano", region: "us" };
const fakeSelection: AgentModelSelection = { providerId: AGENT_CONTRACT_FAKE_PROVIDER_ID, modelId: "fake-1", region: "test" };

beforeEach(() => {
  resolveDefaultLanguageModel.mockReset();
});

describe("rateCardFor", () => {
  it("returns the published card for a known provider/model pair", () => {
    expect(rateCardFor(openaiSelection)).toBe(AGENT_MODEL_RATE_CARDS["openai/gpt-5-nano"]);
    expect(rateCardFor(fakeSelection)).toBe(AGENT_MODEL_RATE_CARDS[`${AGENT_CONTRACT_FAKE_PROVIDER_ID}/fake-1`]);
    // The A/B candidate carries its own card so its spend is charged truthfully.
    expect(AGENT_MODEL_RATE_CARDS["openai/gpt-5"]).toEqual({
      perMillion: { input: 1_250, output: 10_000, cachedInput: 125, reasoning: 10_000 },
    });
  });

  it("falls back to the conservative default card for an unknown model", () => {
    expect(rateCardFor({ providerId: "openai", modelId: "gpt-99" })).toBe(AGENT_DEFAULT_RATE_CARD);
    expect(AGENT_DEFAULT_RATE_CARD.perMillion.output).toBeGreaterThan(AGENT_MODEL_RATE_CARDS["openai/gpt-5-nano"]!.perMillion.output);
  });
});

describe("isProviderConfigured", () => {
  it("checks the openai credential by name only", () => {
    expect(isProviderConfigured("openai", { OPENAI_API_KEY: "sk-test" })).toBe(true);
    expect(isProviderConfigured("openai", { OPENAI_API_KEY: "" })).toBe(false);
    expect(isProviderConfigured("openai", {})).toBe(false);
  });

  it("never reports the contract fake or an unknown provider as configured", () => {
    expect(isProviderConfigured(AGENT_CONTRACT_FAKE_PROVIDER_ID, { OPENAI_API_KEY: "sk-test" })).toBe(false);
    expect(isProviderConfigured("anthropic", { ANTHROPIC_API_KEY: "sk-test", OPENAI_API_KEY: "sk-test" })).toBe(false);
  });
});

describe("createAthenaModelResolver", () => {
  it("delegates the locked selection to the provider module for the real provider", () => {
    const model = { specificationVersion: "v4" };
    resolveDefaultLanguageModel.mockReturnValue(model);
    const resolve = createAthenaModelResolver({ selection: openaiSelection, turnKey: "turn-1" });

    expect(resolve(openaiSelection, { turnKey: "turn-1" })).toBe(model);
    expect(resolveDefaultLanguageModel).toHaveBeenCalledTimes(1);
    expect(resolveDefaultLanguageModel).toHaveBeenCalledWith(openaiSelection);
    // The same selection on the same turn is idempotent, not a conflict.
    expect(resolve({ ...openaiSelection }, { turnKey: "turn-1" })).toBe(model);
  });

  it("refuses a different selection on the same turn", () => {
    const resolve = createAthenaModelResolver({ selection: openaiSelection, turnKey: "turn-1" });
    let thrown: unknown;
    try {
      resolve({ ...openaiSelection, modelId: "gpt-5-mini" }, { turnKey: "turn-1" });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(AgentModelRegistryError);
    expect((thrown as InstanceType<typeof AgentModelRegistryError>).athenaCode).toBe("model_selection_locked");
    expect(resolveDefaultLanguageModel).not.toHaveBeenCalled();
  });

  it("is bound to one turn and refuses another turn key", () => {
    const resolve = createAthenaModelResolver({ selection: openaiSelection, turnKey: "turn-1" });
    expect(() => resolve(openaiSelection, { turnKey: "turn-2" })).toThrow(AgentModelRegistryError);
    expect(resolveDefaultLanguageModel).not.toHaveBeenCalled();
  });

  it("serves the contract fake only through the test seam", () => {
    const withoutSeam = createAthenaModelResolver({ selection: fakeSelection, turnKey: "turn-1" });
    let thrown: unknown;
    try {
      withoutSeam(fakeSelection, { turnKey: "turn-1" });
    } catch (error) {
      thrown = error;
    }
    expect((thrown as InstanceType<typeof AgentModelRegistryError>).athenaCode).toBe("provider_not_configured");

    const fakeModel = { fake: true };
    const withSeam = createAthenaModelResolver({ selection: fakeSelection, turnKey: "turn-1", fakeModel });
    expect(withSeam(fakeSelection, { turnKey: "turn-1" })).toBe(fakeModel);
    expect(resolveDefaultLanguageModel).not.toHaveBeenCalled();
  });
});
