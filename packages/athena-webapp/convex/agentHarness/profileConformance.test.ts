/**
 * Profile conformance (plan U2 scenarios 4 and 6).
 *
 * The synthetic second surface is deliberately non-isomorphic to Daily
 * Operations: organization-scoped, a different context/thread key, a
 * different package mix, single-snapshot `get` plus cursor `list`, different
 * presentation metadata and source destinations. It must pass manifest,
 * read-port-index, profile-selection, and registry conformance with no kernel
 * edit, while genuinely new primitives fail with a versioned-extension error.
 */
import { describe, expect, it } from "vitest";

import { ATHENA_READ_INTENT_CATALOG } from "../platform/readIntentCatalog";
import {
  composeCapabilityPackages,
  defineCapabilityManifest,
  validateCapabilityManifest,
  type AgentCapabilityManifest,
} from "../../shared/agentHarness/manifest";
import {
  assertProfileSelection,
  defineAgentProfile,
  validateProfileDefinition,
} from "../../shared/agentHarness/profile";
import { validateReadPortIndex } from "../../shared/agentHarness/readPort";
import { validateRuntimeEvent, type AgentRuntimeEvent } from "../../shared/agentHarness/agentRuntime";
import {
  AgentVersionedExtensionError,
  isVersionedExtensionIssue,
  opaqueRef,
} from "../../shared/agentHarness/values";
import {
  assertManifestConformance,
  assertProfileConformance,
  buildAgentCapabilityRegistry,
  projectGrant,
} from "./registry";
import {
  SYNTHETIC_SECOND_SURFACE_MANIFESTS,
  SYNTHETIC_SECOND_SURFACE_PRESENTATION,
  SYNTHETIC_SECOND_SURFACE_PROFILE,
  SYNTHETIC_SECOND_SURFACE_READ_PORTS,
} from "./profiles/syntheticSecondSurface";

function codes(result: { ok: boolean; issues?: readonly { code: string }[] }) {
  return result.ok ? [] : (result.issues ?? []).map((issue) => issue.code);
}

const KNOWN_INTENTS = new Set<string>(ATHENA_READ_INTENT_CATALOG.map((intent) => intent.id));

describe("synthetic second surface conformance", () => {
  it("is organization-scoped with a different context, thread key, mount mode, and destinations", () => {
    expect(SYNTHETIC_SECOND_SURFACE_PROFILE.scope.kind).toBe("organization");
    expect(SYNTHETIC_SECOND_SURFACE_PRESENTATION.contextBinding).toEqual({
      scopeKind: "organization",
      keys: ["organizationRef"],
    });
    expect(SYNTHETIC_SECOND_SURFACE_PRESENTATION.mountMode).toBe("full_screen_sheet");
    expect(SYNTHETIC_SECOND_SURFACE_PRESENTATION.entry.location).not.toContain("daily_operations");
    expect(SYNTHETIC_SECOND_SURFACE_PRESENTATION.threadKeyPolicy.compose({ organizationRef: "org-1" })).toBe(
      "organization_overview|organizationRef=org-1",
    );
    expect(SYNTHETIC_SECOND_SURFACE_PRESENTATION.threadKeyPolicy.onContextChange).toBe("confirm_before_next_turn");
    expect(
      SYNTHETIC_SECOND_SURFACE_PRESENTATION.resolveSourceDestination({
        ref: opaqueRef("source", "store-7"),
        kind: "fleet_store",
        capturedAt: 1,
      }),
    ).toEqual({ kind: "internal_route", route: "/organization/stores/store-7", label: "Open store" });
    expect(
      SYNTHETIC_SECOND_SURFACE_PRESENTATION.resolveSourceDestination({
        ref: opaqueRef("source", "x"),
        kind: "store_day_record",
        capturedAt: 1,
      }),
    ).toBeNull();
    expect(SYNTHETIC_SECOND_SURFACE_PRESENTATION.contextLabel({ organizationRef: "Yaegars Group" })).toBe(
      "Yaegars Group · all stores",
    );
  });

  it("mixes a single-snapshot get with cursor-bounded lists across a different package mix", () => {
    const packages = new Set(SYNTHETIC_SECOND_SURFACE_MANIFESTS.map((manifest) => manifest.namespace.package));
    expect([...packages].sort()).toEqual(["directory", "fleet"]);
    const verbs = SYNTHETIC_SECOND_SURFACE_MANIFESTS.map((manifest) => Object.keys(manifest.operations).sort().join("+"));
    expect(verbs).toContain("get");
    expect(verbs).toContain("list");
    for (const manifest of SYNTHETIC_SECOND_SURFACE_MANIFESTS) {
      expect(manifest.scope.kind).toBe("organization");
      expect(manifest.binding.readIntents.some((intent) => intent.startsWith("daily_operations"))).toBe(false);
      for (const intent of manifest.binding.readIntents) expect(KNOWN_INTENTS.has(intent)).toBe(true);
    }
  });

  it("passes manifest, read-port-index, profile, and selection conformance", () => {
    for (const manifest of SYNTHETIC_SECOND_SURFACE_MANIFESTS) {
      expect(validateCapabilityManifest(manifest), manifest.namespace.resource).toEqual({ ok: true, manifest });
      expect(assertManifestConformance(manifest)).toEqual({ ok: true });
    }
    const composed = composeCapabilityPackages(SYNTHETIC_SECOND_SURFACE_MANIFESTS);
    expect(composed.ok).toBe(true);
    if (!composed.ok) return;
    expect(
      validateReadPortIndex(SYNTHETIC_SECOND_SURFACE_READ_PORTS, SYNTHETIC_SECOND_SURFACE_MANIFESTS, {
        isKnownReadIntent: (intent) => KNOWN_INTENTS.has(intent),
      }),
    ).toEqual({ ok: true });
    expect(validateProfileDefinition(SYNTHETIC_SECOND_SURFACE_PROFILE)).toEqual({
      ok: true,
      profile: SYNTHETIC_SECOND_SURFACE_PROFILE,
    });
    expect(assertProfileSelection(SYNTHETIC_SECOND_SURFACE_PROFILE, composed.view, SYNTHETIC_SECOND_SURFACE_MANIFESTS)).toEqual({ ok: true });
    expect(
      assertProfileConformance(SYNTHETIC_SECOND_SURFACE_PROFILE, {
        manifests: SYNTHETIC_SECOND_SURFACE_MANIFESTS,
        readPorts: SYNTHETIC_SECOND_SURFACE_READ_PORTS,
      }),
    ).toEqual({ ok: true });
  });

  it("builds a kernel-neutral registry with a stable digest and projects grants per authority", () => {
    const build = () =>
      buildAgentCapabilityRegistry({
        manifests: SYNTHETIC_SECOND_SURFACE_MANIFESTS,
        readPorts: SYNTHETIC_SECOND_SURFACE_READ_PORTS,
        profiles: [SYNTHETIC_SECOND_SURFACE_PROFILE],
        runtimeAdapter: { adapterKind: "athena_contract_fake", adapterVersion: "fake.1" },
        admissionPolicyVersion: "u4.0",
      });
    const first = build();
    const second = build();
    expect(first.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.registry.registryDigest).toBe(second.registry.registryDigest);
    expect(first.registry.compatibilityDigest).toBe(second.registry.compatibilityDigest);
    expect(Object.keys(first.registry.profiles)).toEqual(["organization_overview"]);
    expect(Object.keys(first.registry.capabilities)).toHaveLength(SYNTHETIC_SECOND_SURFACE_MANIFESTS.length);

    const bumpedPort = build();
    if (!bumpedPort.ok) return;
    const withNewAdapter = buildAgentCapabilityRegistry({
      manifests: SYNTHETIC_SECOND_SURFACE_MANIFESTS,
      readPorts: SYNTHETIC_SECOND_SURFACE_READ_PORTS,
      profiles: [SYNTHETIC_SECOND_SURFACE_PROFILE],
      runtimeAdapter: { adapterKind: "athena_contract_fake", adapterVersion: "fake.2" },
      admissionPolicyVersion: "u4.0",
    });
    expect(withNewAdapter.ok && withNewAdapter.registry.registryDigest).toBe(first.registry.registryDigest);
    expect(withNewAdapter.ok && withNewAdapter.registry.compatibilityDigest).not.toBe(first.registry.compatibilityDigest);

    const fullAdmin = projectGrant(first.registry, {
      profileId: "organization_overview",
      grantedPackages: ["fleet", "directory"],
      grantedReadIntents: ["organization.view", "platform.health.view", "store.configuration.view", "staff.view"],
      authorityTier: "full_admin",
    });
    expect(fullAdmin.kind).toBe("projected");
    if (fullAdmin.kind !== "projected") return;
    const health = fullAdmin.capabilities.find((capability) => capability.namespace.resource === "storeHealth");
    expect(health && Object.keys(health.result.fields)).toContain("incidentNotes");

    const manager = projectGrant(first.registry, {
      profileId: "organization_overview",
      grantedPackages: ["fleet", "directory"],
      grantedReadIntents: ["organization.view", "platform.health.view", "store.configuration.view", "staff.view"],
      authorityTier: "manager",
    });
    expect(manager.kind).toBe("projected");
    if (manager.kind !== "projected") return;
    const managerHealth = manager.capabilities.find((capability) => capability.namespace.resource === "storeHealth");
    expect(managerHealth && Object.keys(managerHealth.result.fields)).not.toContain("incidentNotes");
    expect(JSON.stringify(manager)).not.toContain("incidentDetails");
    expect(manager.grantDigest).not.toBe(fullAdmin.grantDigest);

    const noStaff = projectGrant(first.registry, {
      profileId: "organization_overview",
      grantedPackages: ["fleet", "directory"],
      grantedReadIntents: ["organization.view", "platform.health.view", "store.configuration.view"],
      authorityTier: "full_admin",
    });
    expect(noStaff.kind === "projected" && noStaff.capabilities.map((capability) => capability.namespace.resource)).not.toContain("teams");
    expect(noStaff.kind === "projected" && noStaff.summaries.map((summary) => summary.namespace)).not.toContain("directory.teams");

    const fleetOnly = projectGrant(first.registry, {
      profileId: "organization_overview",
      grantedPackages: ["fleet"],
      grantedReadIntents: ["organization.view", "platform.health.view", "store.configuration.view", "staff.view"],
      authorityTier: "full_admin",
    });
    expect(fleetOnly.kind === "projected" && Object.keys(fleetOnly.sdkView.packages)).toEqual(["fleet"]);

    expect(
      projectGrant(first.registry, {
        profileId: "daily_operations",
        grantedPackages: ["fleet"],
        grantedReadIntents: [],
        authorityTier: "member",
      }),
    ).toEqual({ kind: "profile_unknown", profileId: "daily_operations" });
  });

  it("accepts an additional package expressible in v1 without any kernel edit", () => {
    const extra = defineCapabilityManifest({
      contractVersion: 1,
      capabilityId: "cap_synthetic_extra_notices",
      namespace: { package: "notices", resource: "bulletins" },
      packageVersion: "0.1.0",
      purpose: "Organization bulletins.",
      scope: { kind: "organization" },
      lifecycle: "enabled",
      operations: {
        list: {
          purpose: "Page bulletins.",
          filters: { audience: { kind: "enum", required: false, values: ["all", "managers"], meaning: "Audience." } },
          bounds: { kind: "collection", maxItemsPerPage: 20, maxPagesPerRun: 1 },
        },
      },
      result: { fields: { bulletinRef: { kind: "opaqueRef", refKind: "resource", meaning: "Bulletin." }, title: { kind: "string", meaning: "Title." } } },
      projections: {},
      freshness: { classes: ["live"], authority: "live_read", rule: "Live." },
      completeness: { rule: "Pages.", sourceKeys: ["pages"] },
      citation: { rule: "Cite bulletin refs.", sourceRefKinds: ["bulletin"] },
      evidence: { mode: "provenance_only", reason: "Bulletins are references." },
      cost: { worstCasePerCall: { calls: 1, rows: 20, bytes: 8_192, costUnits: 1, elapsedMs: 500 } },
      egressClass: "operational",
      examples: [{ title: "All", verb: "list", args: {}, description: "Everything." }],
      binding: { readIntents: ["organization.view"], portKey: "notices.bulletins", implementationVersion: "1" },
    });
    const extraPort = {
      contractVersion: 1 as const,
      portKey: "notices.bulletins",
      capabilityId: "cap_synthetic_extra_notices",
      verbs: ["list" as const],
      scopeKind: "organization" as const,
      readIntents: ["organization.view"],
      implementationVersion: "1",
      declaredCost: extra.cost.worstCasePerCall,
      handler: { kind: "internal_query" as const, functionPath: "notices/agentCapabilities/bulletins:list" },
      projections: [],
      completenessSourceKeys: ["pages"],
    };
    const widened = defineAgentProfile({
      ...SYNTHETIC_SECOND_SURFACE_PROFILE,
      packages: [...SYNTHETIC_SECOND_SURFACE_PROFILE.packages, { packageKey: "notices", packageVersion: "0.1.0" }],
    });
    const registry = buildAgentCapabilityRegistry({
      manifests: [...SYNTHETIC_SECOND_SURFACE_MANIFESTS, extra],
      readPorts: { contractVersion: 1, ports: [...SYNTHETIC_SECOND_SURFACE_READ_PORTS.ports, extraPort] },
      profiles: [widened],
      runtimeAdapter: { adapterKind: "athena_contract_fake", adapterVersion: "fake.1" },
      admissionPolicyVersion: "u4.0",
    });
    expect(codes(registry)).toEqual([]);
    expect(registry.ok && Object.keys(registry.registry.sdkView.packages).sort()).toEqual(["directory", "fleet", "notices"]);
  });

  it("fails genuinely new primitives with a versioned-extension error instead of a kernel special case", () => {
    const [fleetStores] = SYNTHETIC_SECOND_SURFACE_MANIFESTS;
    const regionScoped = { ...fleetStores, scope: { kind: "region" } } as unknown as AgentCapabilityManifest;
    const regionResult = validateCapabilityManifest(regionScoped);
    expect(regionResult.ok).toBe(false);
    if (!regionResult.ok) {
      const issue = regionResult.issues.find(isVersionedExtensionIssue);
      expect(issue).toMatchObject({ primitive: "scope.kind", value: "region", contractVersion: 1 });
      expect(issue?.message).toMatch(/versioned contract evolution/);
    }
    const searchVerb = {
      ...fleetStores,
      operations: { ...fleetStores.operations, search: { purpose: "x", filters: {}, bounds: { kind: "collection", maxItemsPerPage: 1, maxPagesPerRun: 1 } } },
    } as unknown as AgentCapabilityManifest;
    expect(codes(validateCapabilityManifest(searchVerb))).toContain("versioned_extension_required");
    expect(() =>
      defineAgentProfile({
        ...SYNTHETIC_SECOND_SURFACE_PROFILE,
        presentation: { ...SYNTHETIC_SECOND_SURFACE_PRESENTATION, mountMode: "voice_overlay" },
      } as unknown as typeof SYNTHETIC_SECOND_SURFACE_PROFILE),
    ).toThrow(AgentVersionedExtensionError);
    expect(() =>
      defineAgentProfile({ ...SYNTHETIC_SECOND_SURFACE_PROFILE, lifecycle: "canary" } as unknown as typeof SYNTHETIC_SECOND_SURFACE_PROFILE),
    ).toThrow(AgentVersionedExtensionError);
    const streamingEvent = validateRuntimeEvent({
      kind: "narrative_delta",
      sequence: 1,
      turnRef: opaqueRef("runtime_turn", "t"),
      at: 1,
    } as unknown as AgentRuntimeEvent);
    expect(codes(streamingEvent)).toEqual(["versioned_extension_required"]);
    const registry = buildAgentCapabilityRegistry({
      manifests: [regionScoped],
      readPorts: { contractVersion: 1, ports: [] },
      profiles: [],
      runtimeAdapter: { adapterKind: "athena_contract_fake", adapterVersion: "fake.1" },
      admissionPolicyVersion: "u4.0",
    });
    expect(codes(registry)).toContain("versioned_extension_required");
  });

  it("rejects read intents outside the closed catalog at the registry boundary", () => {
    const [fleetStores] = SYNTHETIC_SECOND_SURFACE_MANIFESTS;
    const coined = defineCapabilityManifest({
      ...fleetStores,
      binding: { ...fleetStores.binding, readIntents: ["fleet.view"] },
    });
    expect(codes(assertManifestConformance(coined))).toEqual(["read_intent_unknown"]);
    const registry = buildAgentCapabilityRegistry({
      manifests: [coined, ...SYNTHETIC_SECOND_SURFACE_MANIFESTS.slice(1)],
      readPorts: SYNTHETIC_SECOND_SURFACE_READ_PORTS,
      profiles: [SYNTHETIC_SECOND_SURFACE_PROFILE],
      runtimeAdapter: { adapterKind: "athena_contract_fake", adapterVersion: "fake.1" },
      admissionPolicyVersion: "u4.0",
    });
    expect(codes(registry)).toContain("read_intent_unknown");
  });
});
