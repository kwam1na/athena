/**
 * Provider egress policy (plan U7 scenarios 10, 16): the maximum egress class
 * across prompt, context, history, and every capability reachable through the
 * grant selects a provider/model/region from the profile allowlist; nothing
 * fails over to a less-trusted provider; a turn never switches model; and
 * unclassified material fails closed as `restricted`.
 */
import { describe, expect, it } from "vitest";

import type { AgentProfileEgressPolicy } from "../../shared/agentHarness/profile";
import {
  createModelSelectionLock,
  describeProviderSelectionForEvidence,
  normalizeEgressClass,
  permittedFailovers,
  redactProviderSecrets,
  resolveTurnEgressClass,
  selectProviderForEgress,
} from "./egressPolicy";

const POLICY: AgentProfileEgressPolicy = {
  maxClass: "sensitive",
  providers: [
    { providerId: "openai", modelId: "gpt-5-nano", region: "global", maxClass: "operational" },
    { providerId: "openai", modelId: "gpt-5-mini", region: "eu", maxClass: "sensitive" },
    { providerId: "athena_contract_fake", modelId: "fake-1", region: "local", maxClass: "restricted" },
  ],
};

describe("turn egress class", () => {
  it("is the maximum across prompt, context, projected history, and the reachable grant", () => {
    expect(resolveTurnEgressClass({ prompt: "operational", context: "operational", grant: "operational", history: "operational" })).toBe("operational");
    expect(resolveTurnEgressClass({ prompt: "operational", context: "operational", grant: "sensitive", history: "operational" })).toBe("sensitive");
    expect(resolveTurnEgressClass({ prompt: "operational", context: "operational", grant: "operational", history: "restricted" })).toBe("restricted");
  });

  it("fails closed on an unclassified egress class", () => {
    expect(normalizeEgressClass("sensitive")).toBe("sensitive");
    expect(normalizeEgressClass("internal")).toBe("restricted");
    expect(normalizeEgressClass(undefined)).toBe("restricted");
    expect(resolveTurnEgressClass({ prompt: "operational", context: "operational", grant: "mystery" as never, history: "operational" })).toBe("restricted");
  });
});

describe("provider selection", () => {
  it("selects the first allowlisted provider whose class covers the requirement, in allowlist order", () => {
    expect(selectProviderForEgress(POLICY, "operational")).toMatchObject({
      kind: "selected",
      selection: { providerId: "openai", modelId: "gpt-5-nano", region: "global" },
      allowance: { maxClass: "operational" },
    });
    expect(selectProviderForEgress(POLICY, "sensitive")).toMatchObject({
      kind: "selected",
      selection: { providerId: "openai", modelId: "gpt-5-mini", region: "eu" },
    });
  });

  it("fails early with a typed outcome when no allowlisted provider covers the class", () => {
    const narrow: AgentProfileEgressPolicy = { maxClass: "operational", providers: [POLICY.providers[0]] };
    expect(selectProviderForEgress(narrow, "sensitive")).toEqual({
      kind: "no_compatible_provider",
      required: "sensitive",
      candidates: [{ providerId: "openai", modelId: "gpt-5-nano", region: "global", maxClass: "operational" }],
    });
  });

  it("skips providers whose credentials are not configured and never falls back to a less-trusted one", () => {
    const configured = (providerId: string) => providerId === "athena_contract_fake";
    expect(selectProviderForEgress(POLICY, "sensitive", { isConfigured: configured })).toMatchObject({
      kind: "selected",
      selection: { providerId: "athena_contract_fake" },
    });
    const selected = selectProviderForEgress(POLICY, "sensitive");
    if (selected.kind !== "selected") throw new Error("expected selection");
    // Retry candidates for the same turn: only allowances that still cover the class.
    expect(permittedFailovers(POLICY, selected.allowance, "sensitive").map((allowance) => allowance.modelId)).toEqual(["fake-1"]);
    expect(permittedFailovers(POLICY, selected.allowance, "sensitive").some((allowance) => allowance.maxClass === "operational")).toBe(false);
  });

  it("locks the model for the whole turn: a different selection on the same turn is a conflict, never a switch", () => {
    const lock = createModelSelectionLock();
    const first = { providerId: "openai", modelId: "gpt-5-mini", region: "eu" };
    expect(lock.lock("turn-1", first)).toEqual({ kind: "locked", selection: first });
    expect(lock.lock("turn-1", { ...first })).toEqual({ kind: "already_locked", selection: first });
    expect(lock.lock("turn-1", { ...first, modelId: "gpt-5-nano" })).toEqual({ kind: "conflict", locked: first });
    expect(lock.lock("turn-2", { ...first, modelId: "gpt-5-nano" })).toMatchObject({ kind: "locked" });
    expect(lock.selectionFor("turn-1")).toEqual(first);
  });
});

describe("provider evidence", () => {
  it("records model, region, policy class, retention mode, and redaction — never credentials", () => {
    const selected = selectProviderForEgress(POLICY, "sensitive");
    if (selected.kind !== "selected") throw new Error("expected selection");
    const evidence = describeProviderSelectionForEvidence(selected, "sensitive");
    expect(evidence).toEqual({
      providerId: "openai",
      modelId: "gpt-5-mini",
      region: "eu",
      policyClass: "sensitive",
      providerMaxClass: "sensitive",
      retentionMode: "provider_default",
      redaction: "prompt_hash_only",
    });
    expect(JSON.stringify(evidence)).not.toMatch(/key|secret|token/i);
  });

  it("redacts credential-shaped tokens from diagnostics before they become evidence", () => {
    expect(redactProviderSecrets("401 Unauthorized: api key sk-live-1234567890abcdef rejected")).toBe("401 Unauthorized: api key [redacted] rejected");
    expect(redactProviderSecrets("Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.abc.def")).toBe("Authorization: Bearer [redacted]");
    expect(redactProviderSecrets("plain message")).toBe("plain message");
  });
});
