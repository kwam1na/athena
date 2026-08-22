// @vitest-environment node
/**
 * Default model resolution for the Convex Agent adapter: the provider SDK is
 * mocked, so these tests pin only the refusal vocabulary and the credential
 * plumbing (the key reaches the SDK factory and nothing else).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentModelSelection } from "../../../shared/agentHarness/agentRuntime";

const createOpenAI = vi.fn();

vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: (...args: unknown[]) => createOpenAI(...args),
}));

const { ConvexAgentAdapterError } = await import("./convexAgent");
const {
  CONVEX_AGENT_DEFAULT_MODEL_ID,
  CONVEX_AGENT_DEFAULT_PROVIDER_ID,
  CONVEX_AGENT_PROVIDER_API_KEY_ENV,
  resolveDefaultLanguageModel,
} = await import("./models");

const selection: AgentModelSelection = {
  providerId: CONVEX_AGENT_DEFAULT_PROVIDER_ID,
  modelId: CONVEX_AGENT_DEFAULT_MODEL_ID,
  region: "us",
};

const originalKey = process.env[CONVEX_AGENT_PROVIDER_API_KEY_ENV];

beforeEach(() => {
  createOpenAI.mockReset();
  delete process.env[CONVEX_AGENT_PROVIDER_API_KEY_ENV];
});

afterEach(() => {
  if (originalKey === undefined) delete process.env[CONVEX_AGENT_PROVIDER_API_KEY_ENV];
  else process.env[CONVEX_AGENT_PROVIDER_API_KEY_ENV] = originalKey;
});

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    return error instanceof ConvexAgentAdapterError ? error.athenaCode : `unexpected:${String(error)}`;
  }
  return undefined;
}

describe("resolveDefaultLanguageModel", () => {
  it("refuses any provider other than the configured default with a typed error", () => {
    expect(codeOf(() => resolveDefaultLanguageModel({ ...selection, providerId: "anthropic" }, { apiKey: "sk-test" }))).toBe(
      "provider_not_configured",
    );
    expect(createOpenAI).not.toHaveBeenCalled();
  });

  it("refuses when no credential is configured, without a provider round trip", () => {
    expect(codeOf(() => resolveDefaultLanguageModel(selection))).toBe("provider_credentials_missing");
    expect(createOpenAI).not.toHaveBeenCalled();
  });

  it("builds the model for the selected id with the explicit key", () => {
    const model = { modelId: selection.modelId };
    const factory = vi.fn().mockReturnValue(model);
    createOpenAI.mockReturnValue(factory);

    expect(resolveDefaultLanguageModel(selection, { apiKey: "sk-explicit" })).toBe(model);
    expect(createOpenAI).toHaveBeenCalledWith({ apiKey: "sk-explicit" });
    expect(factory).toHaveBeenCalledWith(selection.modelId);
  });

  it("falls back to the environment credential by name", () => {
    process.env[CONVEX_AGENT_PROVIDER_API_KEY_ENV] = "sk-env";
    const factory = vi.fn().mockReturnValue({});
    createOpenAI.mockReturnValue(factory);

    resolveDefaultLanguageModel(selection);
    expect(createOpenAI).toHaveBeenCalledWith({ apiKey: "sk-env" });
  });
});
