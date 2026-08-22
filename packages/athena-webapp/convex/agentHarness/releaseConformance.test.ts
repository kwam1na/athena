/**
 * Release gate: enabled-capability conformance across every registered
 * manifest, plus the published release identity the deployment depends on.
 *
 * `conformance.test.ts` proves the harness itself (what the gate checks and
 * how it fails). This file points the same gate at the real registration
 * points, so a package cannot reach an operator without passing scope
 * isolation, field omission, pagination/snapshot bounds, freshness,
 * completeness, determinism, budget accounting, and evidence extraction —
 * and so the published artifact names the production runtime adapter rather
 * than a test double.
 */
import { describe, expect, it } from "vitest";

import { assertCapabilityEnableable } from "./conformance";
import {
  AGENT_MANIFEST_REGISTRATIONS,
  AGENT_SELECTED_RUNTIME_ADAPTER,
  mergeManifestRegistrations,
} from "./manifestRegistrations";
import { AGENT_GENERATED_REGISTRY } from "./_generated/registry";
import { AGENT_GENERATED_CAPABILITY_SCHEMAS } from "./_generated/schemas";
import {
  CONVEX_AGENT_ADAPTER_KIND,
  CONVEX_AGENT_ADAPTER_VERSION,
} from "./agentRuntime/convexAgentKind";
import { resolveAgentEvidenceExtractor } from "../platform/operationAdmission";
import { DAILY_OPERATIONS_PROFILE_ID } from "./profiles/dailyOperations";
import { SYNTHETIC_SECOND_SURFACE_PROFILE_ID } from "./profiles/syntheticSecondSurface";

const merged = mergeManifestRegistrations(AGENT_MANIFEST_REGISTRATIONS);
const portByKey = new Map(merged.readPorts.ports.map((port) => [port.portKey, port]));

describe("release conformance", () => {
  it("gates every enabled capability of every registration on the full conformance suite", () => {
    const enabled = merged.manifests.filter((manifest) => manifest.lifecycle === "enabled");
    // Both registered packages must contribute; a silent drop would make this
    // suite vacuous.
    expect(enabled.length).toBeGreaterThanOrEqual(14);
    expect(new Set(enabled.map((manifest) => manifest.namespace.package)).size).toBeGreaterThanOrEqual(6);

    for (const manifest of enabled) {
      const port = portByKey.get(manifest.binding.portKey);
      expect(port, `${manifest.capabilityId} has no read port`).toBeDefined();
      const fixture = merged.conformance[manifest.capabilityId];
      expect(fixture, `${manifest.capabilityId} has no conformance fixture`).toBeDefined();
      const result = assertCapabilityEnableable({
        manifest,
        port: port!,
        probes: fixture!.probes,
        extractor: fixture!.extractor,
      });
      expect(
        result.ok ? [] : result.issues,
        `${manifest.capabilityId}: ${JSON.stringify(result.ok ? [] : result.issues)}`,
      ).toEqual([]);
    }
  });

  it("keeps the synthetic second surface on the same gate as the product package", () => {
    const synthetic = merged.manifests.filter((manifest) =>
      manifest.capabilityId.startsWith("cap_synthetic_"),
    );
    expect(synthetic).toHaveLength(3);
    for (const manifest of synthetic) {
      const result = assertCapabilityEnableable({
        manifest,
        port: portByKey.get(manifest.binding.portKey)!,
        probes: merged.conformance[manifest.capabilityId]!.probes,
        extractor: merged.conformance[manifest.capabilityId]!.extractor,
      });
      expect(result.ok ? [] : result.issues, manifest.capabilityId).toEqual([]);
    }
  });

  it("resolves a registered evidence extractor for every extractor-mode capability", () => {
    const extractorModes = merged.manifests.filter((manifest) => manifest.evidence.mode === "extractor");
    expect(extractorModes.length).toBeGreaterThan(0);
    for (const manifest of extractorModes) {
      if (manifest.evidence.mode !== "extractor") throw new Error("unreachable");
      const extractor = resolveAgentEvidenceExtractor(manifest.capabilityId);
      expect(extractor, `${manifest.capabilityId} has no extractor at the composition root`).toBeDefined();
      expect(extractor!.extractorKey).toBe(manifest.evidence.extractorKey);
      expect(extractor!.extractorVersion).toBe(manifest.evidence.extractorVersion);
      for (const claimShape of manifest.evidence.claimShapes) {
        expect(extractor!.claimShapes, `${manifest.capabilityId}/${claimShape}`).toContain(claimShape);
      }
    }
  });

  it("pins the published compatibility identity to the production runtime adapter", () => {
    expect(AGENT_SELECTED_RUNTIME_ADAPTER.adapterKind).toBe(CONVEX_AGENT_ADAPTER_KIND);
    expect(AGENT_SELECTED_RUNTIME_ADAPTER.adapterVersion).toBe(CONVEX_AGENT_ADAPTER_VERSION);
    expect(AGENT_GENERATED_REGISTRY.protocolVersions.runtimeAdapter).toEqual({
      adapterKind: CONVEX_AGENT_ADAPTER_KIND,
      adapterVersion: CONVEX_AGENT_ADAPTER_VERSION,
    });
  });

  it("publishes the Daily Operations profile and leaves the synthetic surface unpublished", () => {
    // Publication is what makes the durable switch able to reach operators at
    // all; the switch itself is default-off and shrink-only.
    expect(AGENT_GENERATED_REGISTRY.enablement.profiles[DAILY_OPERATIONS_PROFILE_ID]).toBe("enabled");
    expect(AGENT_GENERATED_REGISTRY.enablement.profiles[SYNTHETIC_SECOND_SURFACE_PROFILE_ID]).toBe(
      "unpublished",
    );
    for (const [capabilityId, state] of Object.entries(AGENT_GENERATED_REGISTRY.enablement.capabilities)) {
      expect(state, capabilityId).toBe("enabled");
    }
  });

  it("keeps the model-projectable artifact free of dispatch and admission identity", () => {
    const serialized = JSON.stringify(AGENT_GENERATED_CAPABILITY_SCHEMAS);
    expect(serialized).not.toContain("functionPath");
    expect(serialized).not.toContain("portKey");
    expect(serialized).not.toContain("readIntents");
    expect(serialized).not.toContain("compatibilityDigest");
  });
});
