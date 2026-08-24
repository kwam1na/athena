/**
 * The production adapter's provider-option knobs: the measured low-effort
 * default is load-bearing; env overrides win; empty string opts out.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { experimentProviderOptions } from "./convexAgentProduction";

const ENV_KEYS = ["ATHENA_AGENT_REASONING_EFFORT", "ATHENA_AGENT_TEXT_VERBOSITY", "ATHENA_AGENT_SERVICE_TIER"] as const;

// Hermetic regardless of the invoking shell: snapshot and clear before, restore after.
const snapshot = new Map<string, string | undefined>();
beforeEach(() => {
  for (const key of ENV_KEYS) {
    snapshot.set(key, process.env[key]);
    delete process.env[key];
  }
});
afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = snapshot.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("experimentProviderOptions", () => {
  it("defaults to the measured low reasoning effort", () => {
    expect(experimentProviderOptions()).toEqual({ openai: { reasoningEffort: "low" } });
  });

  it("env overrides win and extra knobs merge", () => {
    process.env.ATHENA_AGENT_REASONING_EFFORT = "medium";
    process.env.ATHENA_AGENT_TEXT_VERBOSITY = "low";
    process.env.ATHENA_AGENT_SERVICE_TIER = "priority";
    expect(experimentProviderOptions()).toEqual({
      openai: { reasoningEffort: "medium", textVerbosity: "low", serviceTier: "priority" },
    });
  });

  it("an empty-string effort opts out entirely", () => {
    process.env.ATHENA_AGENT_REASONING_EFFORT = "";
    expect(experimentProviderOptions()).toBeUndefined();
  });
});
