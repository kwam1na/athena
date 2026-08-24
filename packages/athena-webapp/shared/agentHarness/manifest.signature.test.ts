/**
 * verbSignature disclosure contract: small enums are inlined with their legal
 * values (an undisclosed legal value is answered with a guess and costs a
 * denied round trip), optional filters carry `?`, and large enums stay bare.
 */
import { describe, expect, it } from "vitest";

import { summarizeCapability, type AgentCapabilityManifest } from "./manifest";

const manifest = {
  capabilityId: "test.things@1",
  namespace: { package: "test", resource: "things" },
  purpose: "Things for signature tests.",
  scope: { kind: "store" },
  operations: {
    list: {
      filters: {
        operatingDate: { kind: "operatingDate", required: true },
        state: { kind: "enum", required: true, values: ["pending", "done"] },
        channel: { kind: "enum", required: false, values: ["a", "b", "c", "d", "e"] },
        window: { kind: "string", required: false },
      },
      bounds: { kind: "collection", maxRows: 10 },
    },
  },
  result: { fields: { name: { kind: "string", meaning: "Name." } } },
  projections: {},
  examples: [],
} as unknown as AgentCapabilityManifest;

describe("verbSignature disclosure", () => {
  it("inlines small enums with quoted values, marks optional filters, keeps large enums bare", () => {
    const summary = summarizeCapability(manifest);
    expect(summary.calls).toHaveLength(1);
    const call = summary.calls[0];
    expect(call).toContain('state: "pending"|"done"');
    expect(call).toContain("window?");
    expect(call).toContain("channel?");
    expect(call).not.toContain('"a"|"b"|"c"|"d"|"e"');
    expect(call).toMatch(/^list\(\{ /);
  });

  it("lists public result field names", () => {
    expect(summarizeCapability(manifest).resultFields).toEqual(["name"]);
  });
});
