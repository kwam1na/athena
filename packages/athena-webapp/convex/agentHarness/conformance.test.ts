/// <reference types="vite/client" />

/**
 * Capability conformance harness, enablement overlay, and compatibility
 * identity (plan U3 scenarios 2, 5, 6, 7, 8, 9).
 *
 * A capability may not be enabled until scope isolation, field omission,
 * pagination, freshness, evidence extraction, determinism, and budget
 * accounting all pass. Lifecycle is deliberately NOT part of the
 * compatibility digest: disabling is a live deny through the shrink-only
 * enablement overlay, while a behavioral read-port, protocol, adapter, or
 * admission change moves the digest and forces U7's epoch fence.
 */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";

import schema from "../schema";
import {
  advanceCompatibilityEpochWithCtx,
  getCurrentCompatibilityEpochWithCtx,
  markAgentRunRunningWithCtx,
  repairFencedRunsWithCtx,
} from "./lifecycle";
import { TEST_NOW, seedRun, seedTenant } from "./testSupport";

import { budgetVector } from "../../shared/agentHarness/execution";
import { defineCapabilityManifest, type AgentCapabilityManifest } from "../../shared/agentHarness/manifest";
import { defineAgentProfile } from "../../shared/agentHarness/profile";
import { defineAgentReadPort } from "../../shared/agentHarness/readPort";
import { opaqueRef } from "../../shared/agentHarness/values";
import type { AgentReadEnvelope } from "../../shared/agentHarness/results";
import {
  assertCapabilityEnableable,
  extractClaimSupport,
  runCapabilityConformance,
  type AgentConformanceProbe,
  type AgentEvidenceExtractor,
} from "./conformance";
import {
  baselineEnablement,
  buildAgentCapabilityRegistry,
  compareCompatibility,
  evaluateEnablement,
  planCompatibilityAdvance,
  narrowEnablement,
  projectGrant,
} from "./registry";
import {
  FLEET_STORES_MANIFEST,
  FLEET_STORE_HEALTH_MANIFEST,
  SYNTHETIC_SECOND_SURFACE_MANIFESTS,
  SYNTHETIC_SECOND_SURFACE_PROFILE,
  SYNTHETIC_SECOND_SURFACE_READ_PORTS,
} from "./profiles/syntheticSecondSurface";

const modules = Object.fromEntries(
  Object.entries(import.meta.glob("../**/*.ts")).map(([path, loader]) => [
    path.startsWith("../")
      ? path.replace(/^\.\.\//, "./")
      : path.replace(/^\.\//, "./agentHarness/"),
    loader,
  ]),
);

function codes(result: { ok: boolean; issues?: readonly { code: string }[] }) {
  return result.ok ? [] : (result.issues ?? []).map((issue) => issue.code).sort();
}

const STORES_PORT = SYNTHETIC_SECOND_SURFACE_READ_PORTS.ports[0];
const HEALTH_PORT = SYNTHETIC_SECOND_SURFACE_READ_PORTS.ports[1];

const listEnvelope = (
  overrides: Partial<AgentReadEnvelope<unknown>> = {},
): AgentReadEnvelope<unknown> =>
  ({
    contractVersion: 1,
    capabilityId: FLEET_STORES_MANIFEST.capabilityId,
    namespace: "fleet.stores",
    verb: "list",
    data: [
      {
        storeRef: opaqueRef("resource", "store-7"),
        name: "Osu",
        region: "GA",
        health: "degraded",
      },
    ],
    observedAt: 1_700_000_000_000,
    capturedAt: 1_700_000_000_000,
    freshness: {
      class: "live",
      authority: "live_read",
      observedAt: 1_700_000_000_000,
      capturedAt: 1_700_000_000_000,
    },
    completeness: { status: "complete", sources: [{ sourceKey: "pages", status: "complete" }] },
    warnings: [],
    sourceRefs: [{ ref: opaqueRef("source", "store-7"), kind: "fleet_store", capturedAt: 1 }],
    pagination: { hasMore: false, pageIndex: 0, pageSize: 1, pagesRemainingInRun: 1 },
    ...overrides,
  }) as AgentReadEnvelope<unknown>;

const getEnvelope = (
  overrides: Partial<AgentReadEnvelope<unknown>> = {},
): AgentReadEnvelope<unknown> =>
  ({
    contractVersion: 1,
    capabilityId: FLEET_STORE_HEALTH_MANIFEST.capabilityId,
    namespace: "fleet.storeHealth",
    verb: "get",
    data: {
      storeRef: opaqueRef("resource", "store-7"),
      uptimePercent: 99,
    },
    observedAt: 1_700_000_000_000,
    capturedAt: 1_700_000_000_000,
    freshness: {
      class: "derived",
      authority: "derived",
      observedAt: 1_700_000_000_000,
      capturedAt: 1_700_000_000_000,
    },
    completeness: {
      status: "complete",
      sources: [
        { sourceKey: "samples", status: "complete" },
        { sourceKey: "incidents", status: "complete" },
      ],
    },
    warnings: [],
    sourceRefs: [{ ref: opaqueRef("source", "window-1"), kind: "health_sample_window", capturedAt: 1 }],
    ...overrides,
  }) as AgentReadEnvelope<unknown>;

const storesProbe = (overrides: Partial<AgentConformanceProbe> = {}): AgentConformanceProbe => ({
  label: "in-scope page",
  verb: "list",
  args: { health: "degraded" },
  scopeRef: "organization:org-1",
  grantedProjections: [],
  envelope: listEnvelope(),
  budget: {
    requested: budgetVector({ calls: 1, rows: 50, bytes: 65_536, costUnits: 2, elapsedMs: 1_500 }),
    settled: budgetVector({ calls: 1, rows: 1, bytes: 512, costUnits: 1, elapsedMs: 40 }),
  },
  ...overrides,
});

const healthProbe = (overrides: Partial<AgentConformanceProbe> = {}): AgentConformanceProbe => ({
  label: "snapshot without the sensitive projection",
  verb: "get",
  args: { storeRef: opaqueRef("resource", "store-7") },
  scopeRef: "organization:org-1",
  grantedProjections: [],
  envelope: getEnvelope(),
  budget: {
    requested: budgetVector({ calls: 1, rows: 1, bytes: 8_192, costUnits: 1, elapsedMs: 800 }),
    settled: budgetVector({ calls: 1, rows: 1, bytes: 256, costUnits: 1, elapsedMs: 30 }),
  },
  ...overrides,
});

const uptimeExtractor: AgentEvidenceExtractor = {
  extractorKey: "fleet.storeHealth",
  extractorVersion: "1",
  claimShapes: ["uptimePercent"],
  extract: (input) => {
    const data = input.data as { uptimePercent?: number } | null;
    if (!data || typeof data.uptimePercent !== "number") return { unsupported: "no_uptime_in_result" };
    return { claim: { uptimePercent: data.uptimePercent } };
  },
};

describe("capability conformance harness", () => {
  it("passes a conforming capability across every conformance dimension", () => {
    expect(
      runCapabilityConformance({
        manifest: FLEET_STORES_MANIFEST,
        port: STORES_PORT,
        probes: [storesProbe()],
      }),
    ).toEqual({ ok: true });
    expect(
      runCapabilityConformance({
        manifest: FLEET_STORE_HEALTH_MANIFEST,
        port: HEALTH_PORT,
        probes: [healthProbe()],
        extractor: uptimeExtractor,
      }),
    ).toEqual({ ok: true });
  });

  it("blocks enabling when a probe leaks an ungranted projection field", () => {
    const leaked = healthProbe({
      label: "snapshot leaking incident notes",
      envelope: getEnvelope({
        data: {
          storeRef: opaqueRef("resource", "store-7"),
          uptimePercent: 99,
          incidentNotes: { state: "known", value: "Till drawer forced." },
        },
      }),
    });
    const result = runCapabilityConformance({
      manifest: FLEET_STORE_HEALTH_MANIFEST,
      port: HEALTH_PORT,
      probes: [leaked],
      extractor: uptimeExtractor,
    });
    expect(codes(result)).toContain("ungranted_field_present");
    expect(codes(assertCapabilityEnableable({ manifest: FLEET_STORE_HEALTH_MANIFEST, port: HEALTH_PORT, probes: [leaked], extractor: uptimeExtractor }))).toContain(
      "ungranted_field_present",
    );
  });

  it("rejects out-of-scope rows, unbounded pages, undeclared freshness, and overspent budgets", () => {
    const foreign = runCapabilityConformance({
      manifest: FLEET_STORES_MANIFEST,
      port: STORES_PORT,
      probes: [
        storesProbe(),
        storesProbe({
          label: "foreign scope must return nothing",
          scopeRef: "organization:org-2",
          foreignScope: true,
        }),
      ],
    });
    expect(codes(foreign)).toContain("scope_isolation_violated");

    const unbounded = runCapabilityConformance({
      manifest: FLEET_STORES_MANIFEST,
      port: STORES_PORT,
      probes: [
        storesProbe({
          envelope: listEnvelope({
            data: Array.from({ length: 51 }, (_, index) => ({
              storeRef: opaqueRef("resource", `store-${index}`),
              name: `Store ${index}`,
              region: "GA",
              health: "healthy",
            })),
            pagination: { hasMore: true, pageIndex: 0, pageSize: 51, pagesRemainingInRun: 1 },
          }),
        }),
      ],
    });
    expect(codes(unbounded)).toContain("pagination_bounds_exceeded");

    const wrongFreshness = runCapabilityConformance({
      manifest: FLEET_STORES_MANIFEST,
      port: STORES_PORT,
      probes: [
        storesProbe({
          envelope: listEnvelope({
            freshness: {
              class: "stale",
              authority: "live_read",
              observedAt: 1_700_000_000_000,
              capturedAt: 1_700_000_000_000,
            },
          }),
        }),
      ],
    });
    expect(codes(wrongFreshness)).toContain("freshness_undeclared");

    const overspent = runCapabilityConformance({
      manifest: FLEET_STORES_MANIFEST,
      port: STORES_PORT,
      probes: [
        storesProbe({
          budget: {
            requested: budgetVector({ calls: 1, rows: 50, bytes: 65_536, costUnits: 2, elapsedMs: 1_500 }),
            settled: budgetVector({ calls: 1, rows: 80, bytes: 512, costUnits: 1, elapsedMs: 40 }),
          },
        }),
      ],
    });
    expect(codes(overspent)).toContain("budget_overspent");
  });

  it("requires a repeated observation of the same call to be identical", () => {
    const drifting = storesProbe({
      repeat: listEnvelope({
        data: [
          {
            storeRef: opaqueRef("resource", "store-7"),
            name: "Osu",
            region: "GA",
            health: "healthy",
          },
        ],
      }),
    });
    expect(
      codes(runCapabilityConformance({ manifest: FLEET_STORES_MANIFEST, port: STORES_PORT, probes: [drifting] })),
    ).toContain("result_not_deterministic");
    expect(
      runCapabilityConformance({
        manifest: FLEET_STORES_MANIFEST,
        port: STORES_PORT,
        probes: [storesProbe({ repeat: listEnvelope({ observedAt: 1_700_000_009_999 }) })],
      }),
    ).toEqual({ ok: true });
  });

  it("requires at least one probe per declared verb", () => {
    const result = runCapabilityConformance({
      manifest: FLEET_STORES_MANIFEST,
      port: STORES_PORT,
      probes: [],
    });
    expect(codes(result)).toContain("conformance_probe_missing");
  });

  it("fails a capability whose port drifts from its manifest binding", () => {
    const driftedPort = defineAgentReadPort({
      ...STORES_PORT,
      implementationVersion: "2",
    });
    expect(
      codes(
        runCapabilityConformance({
          manifest: FLEET_STORES_MANIFEST,
          port: driftedPort,
          probes: [storesProbe()],
        }),
      ),
    ).toContain("port_binding_drift");
  });
});

describe("evidence extraction", () => {
  const claimInput = {
    capabilityId: FLEET_STORE_HEALTH_MANIFEST.capabilityId,
    verb: "get" as const,
    resultHash: "sha256:result",
    data: { storeRef: opaqueRef("resource", "store-7"), uptimePercent: 99 },
    grantedProjections: [] as readonly string[],
    claimShape: "uptimePercent",
  };

  it("produces a deterministic, hash-bound, field-minimized claim slice", () => {
    const first = extractClaimSupport(FLEET_STORE_HEALTH_MANIFEST, uptimeExtractor, claimInput);
    const second = extractClaimSupport(FLEET_STORE_HEALTH_MANIFEST, uptimeExtractor, claimInput);
    expect(first).toEqual(second);
    expect(first.kind).toBe("claim_support");
    if (first.kind !== "claim_support") return;
    expect(first.slice).toEqual({ uptimePercent: 99 });
    expect(first.resultHash).toBe("sha256:result");
    expect(first.extractorVersion).toBe("1");
    expect(first.sliceDigest).toEqual(expect.any(String));
    const rebound = extractClaimSupport(FLEET_STORE_HEALTH_MANIFEST, uptimeExtractor, {
      ...claimInput,
      resultHash: "sha256:other",
    });
    expect(rebound.kind === "claim_support" && rebound.sliceDigest).not.toBe(first.sliceDigest);
  });

  it("downgrades to provenance_only when no extractor, an unsupported transform, or a version mismatch", () => {
    expect(extractClaimSupport(FLEET_STORE_HEALTH_MANIFEST, undefined, claimInput)).toEqual({
      kind: "provenance_only",
      reason: "extractor_not_registered",
    });
    expect(
      extractClaimSupport(FLEET_STORE_HEALTH_MANIFEST, uptimeExtractor, { ...claimInput, data: {} }),
    ).toEqual({ kind: "provenance_only", reason: "no_uptime_in_result" });
    expect(
      extractClaimSupport(
        FLEET_STORE_HEALTH_MANIFEST,
        { ...uptimeExtractor, extractorVersion: "2" },
        claimInput,
      ),
    ).toEqual({ kind: "provenance_only", reason: "extractor_version_mismatch" });
    expect(extractClaimSupport(FLEET_STORES_MANIFEST, uptimeExtractor, claimInput)).toEqual({
      kind: "provenance_only",
      reason: "Roster rows are references.",
    });
  });

  it("refuses to emit a slice that carries an ungranted or unknown field", () => {
    const leaky: AgentEvidenceExtractor = {
      ...uptimeExtractor,
      extract: (input) => ({
        claim: {
          uptimePercent: (input.data as { uptimePercent: number }).uptimePercent,
          incidentNotes: "Till drawer forced.",
        },
      }),
    };
    expect(extractClaimSupport(FLEET_STORE_HEALTH_MANIFEST, leaky, claimInput)).toEqual({
      kind: "provenance_only",
      reason: "extractor_field_not_authorized",
    });
    expect(
      codes(
        runCapabilityConformance({
          manifest: FLEET_STORE_HEALTH_MANIFEST,
          port: HEALTH_PORT,
          probes: [healthProbe()],
          extractor: leaky,
        }),
      ),
    ).toContain("extractor_not_field_minimizing");
  });

  it("rejects a nondeterministic extractor before it can be enabled", () => {
    let calls = 0;
    const drifting: AgentEvidenceExtractor = {
      ...uptimeExtractor,
      extract: () => ({ claim: { uptimePercent: (calls += 1) } }),
    };
    expect(
      codes(
        runCapabilityConformance({
          manifest: FLEET_STORE_HEALTH_MANIFEST,
          port: HEALTH_PORT,
          probes: [healthProbe()],
          extractor: drifting,
        }),
      ),
    ).toContain("extractor_not_deterministic");

    const clockReader: AgentEvidenceExtractor = {
      ...uptimeExtractor,
      extract: (input) => ({
        claim: {
          uptimePercent: (input.data as { uptimePercent: number }).uptimePercent + 0 * Date.now(),
        },
      }),
    };
    expect(
      codes(
        runCapabilityConformance({
          manifest: FLEET_STORE_HEALTH_MANIFEST,
          port: HEALTH_PORT,
          probes: [healthProbe()],
          extractor: clockReader,
        }),
      ),
    ).toContain("extractor_reads_ambient_state");
  });

  it("requires a registered extractor for a manifest that declares extractor evidence", () => {
    expect(
      codes(
        runCapabilityConformance({
          manifest: FLEET_STORE_HEALTH_MANIFEST,
          port: HEALTH_PORT,
          probes: [healthProbe()],
        }),
      ),
    ).toContain("evidence_extractor_missing");
  });
});

describe("enablement overlay and compatibility identity", () => {
  /**
   * The published synthetic profile is `unpublished` until U10 enables it, and
   * `evaluateEnablement` denies an unpublished profile before it ever looks at
   * a capability. These cases are about the capability-level kill switch, so
   * they run against an enabled copy of the same profile.
   */
  const ENABLED_PROFILE = defineAgentProfile({
    ...SYNTHETIC_SECOND_SURFACE_PROFILE,
    lifecycle: "enabled",
  });

  const build = (
    overrides: Partial<Parameters<typeof buildAgentCapabilityRegistry>[0]> = {},
  ) =>
    buildAgentCapabilityRegistry({
      manifests: SYNTHETIC_SECOND_SURFACE_MANIFESTS,
      readPorts: SYNTHETIC_SECOND_SURFACE_READ_PORTS,
      profiles: [ENABLED_PROFILE],
      runtimeAdapter: { adapterKind: "athena_contract_fake", adapterVersion: "fake.1" },
      admissionPolicyVersion: "u4.0",
      ...overrides,
    });

  it("keeps lifecycle out of both digests so enabling never invalidates a pinned run", () => {
    const enabled = build();
    const disabledCapability = build({
      manifests: [
        { ...FLEET_STORES_MANIFEST, lifecycle: "disabled" } as AgentCapabilityManifest,
        ...SYNTHETIC_SECOND_SURFACE_MANIFESTS.slice(1),
      ],
    });
    expect(enabled.ok && disabledCapability.ok).toBe(true);
    if (!enabled.ok || !disabledCapability.ok) return;
    expect(disabledCapability.registry.registryDigest).toBe(enabled.registry.registryDigest);
    expect(disabledCapability.registry.compatibilityDigest).toBe(enabled.registry.compatibilityDigest);
    expect(disabledCapability.registry.enablement.capabilities[FLEET_STORES_MANIFEST.capabilityId]).toBe("disabled");
  });

  it("moves the compatibility digest for a port implementation change with an unchanged manifest", () => {
    const before = build({
      portImplementations: {
        "fleet.stores": { implementationVersion: "1", sourceDigest: "sha256:aaa" },
        "fleet.storeHealth": { implementationVersion: "1", sourceDigest: "sha256:bbb" },
        "directory.teams": { implementationVersion: "1", sourceDigest: "sha256:ccc" },
      },
    });
    const after = build({
      portImplementations: {
        "fleet.stores": { implementationVersion: "1", sourceDigest: "sha256:zzz" },
        "fleet.storeHealth": { implementationVersion: "1", sourceDigest: "sha256:bbb" },
        "directory.teams": { implementationVersion: "1", sourceDigest: "sha256:ccc" },
      },
    });
    expect(before.ok && after.ok).toBe(true);
    if (!before.ok || !after.ok) return;
    expect(after.registry.registryDigest).toBe(before.registry.registryDigest);
    expect(after.registry.compatibilityDigest).not.toBe(before.registry.compatibilityDigest);
    expect(compareCompatibility(before.registry.compatibilityDigest, after.registry.compatibilityDigest)).toEqual({
      changed: true,
      requiresEpochAdvance: true,
      previousDigest: before.registry.compatibilityDigest,
      nextDigest: after.registry.compatibilityDigest,
    });
    expect(compareCompatibility(before.registry.compatibilityDigest, before.registry.compatibilityDigest)).toMatchObject({
      changed: false,
      requiresEpochAdvance: false,
    });
    expect(compareCompatibility(undefined, after.registry.compatibilityDigest)).toMatchObject({
      changed: true,
      requiresEpochAdvance: true,
    });
  });

  it("moves the compatibility digest for an admission policy change", () => {
    const before = build();
    const after = build({ admissionPolicyVersion: "u4.1" });
    expect(before.ok && after.ok).toBe(true);
    if (!before.ok || !after.ok) return;
    expect(after.registry.compatibilityDigest).not.toBe(before.registry.compatibilityDigest);
  });

  it("only lets the kill switch shrink access", () => {
    const registry = build();
    expect(registry.ok).toBe(true);
    if (!registry.ok) return;
    const base = baselineEnablement(SYNTHETIC_SECOND_SURFACE_MANIFESTS, [SYNTHETIC_SECOND_SURFACE_PROFILE]);
    expect(base.capabilities[FLEET_STORES_MANIFEST.capabilityId]).toBe("enabled");
    expect(base.profiles.organization_overview).toBe("unpublished");
    expect(
      evaluateEnablement(base, {
        profileId: "organization_overview",
        capabilityId: FLEET_STORES_MANIFEST.capabilityId,
      }),
    ).toEqual({ ok: false, code: "profile_unpublished" });

    const shrunk = narrowEnablement(base, {
      capabilities: { [FLEET_STORES_MANIFEST.capabilityId]: "disabled" },
    });
    expect(shrunk.ok).toBe(true);
    if (!shrunk.ok) return;
    expect(shrunk.overlay.capabilities[FLEET_STORES_MANIFEST.capabilityId]).toBe("disabled");

    const widened = narrowEnablement(shrunk.overlay, {
      capabilities: { [FLEET_STORES_MANIFEST.capabilityId]: "enabled" },
    });
    expect(codes(widened)).toEqual(["kill_switch_widens_access"]);
    expect(
      codes(narrowEnablement(base, { profiles: { organization_overview: "enabled" } })),
    ).toEqual(["kill_switch_widens_access"]);
    expect(codes(narrowEnablement(base, { capabilities: { cap_unknown_thing: "disabled" } }))).toEqual([
      "enablement_subject_unknown",
    ]);
  });

  it("denies a disabled capability at call time even under a pinned digest", () => {
    const registry = build();
    expect(registry.ok).toBe(true);
    if (!registry.ok) return;
    const pinnedDigest = registry.registry.compatibilityDigest;

    const granted = {
      profileId: "organization_overview",
      grantedPackages: ["fleet", "directory"],
      grantedReadIntents: ["organization.view", "platform.health.view", "store.configuration.view", "staff.view"],
      authorityTier: "full_admin" as const,
    };
    const wide = projectGrant(registry.registry, granted);
    expect(wide.kind).toBe("projected");
    if (wide.kind !== "projected") return;
    expect(wide.compatibilityDigest).toBe(pinnedDigest);
    expect(wide.capabilities.map((capability) => capability.capabilityId)).toContain(
      FLEET_STORES_MANIFEST.capabilityId,
    );

    const shrunk = narrowEnablement(registry.registry.enablement, {
      capabilities: { [FLEET_STORES_MANIFEST.capabilityId]: "disabled" },
    });
    expect(shrunk.ok).toBe(true);
    if (!shrunk.ok) return;

    // The pinned run keeps the same schema semantics and the same digest ...
    const narrowed = projectGrant(registry.registry, granted, { enablement: shrunk.overlay });
    expect(narrowed.kind).toBe("projected");
    if (narrowed.kind !== "projected") return;
    expect(narrowed.compatibilityDigest).toBe(pinnedDigest);
    // ... but the disabled capability is absent from what the model can see ...
    expect(narrowed.capabilities.map((capability) => capability.capabilityId)).not.toContain(
      FLEET_STORES_MANIFEST.capabilityId,
    );
    // ... and a call pinned to the old digest is still denied live.
    expect(
      evaluateEnablement(shrunk.overlay, {
        profileId: "organization_overview",
        capabilityId: FLEET_STORES_MANIFEST.capabilityId,
      }),
    ).toEqual({ ok: false, code: "capability_disabled" });
    expect(
      evaluateEnablement(registry.registry.enablement, {
        profileId: "organization_overview",
        capabilityId: FLEET_STORES_MANIFEST.capabilityId,
      }),
    ).toEqual({ ok: true });

    const profileOff = narrowEnablement(registry.registry.enablement, {
      profiles: { organization_overview: "disabled" },
    });
    expect(profileOff.ok).toBe(true);
    if (!profileOff.ok) return;
    expect(evaluateEnablement(profileOff.overlay, { profileId: "organization_overview" })).toEqual({
      ok: false,
      code: "profile_disabled",
    });
    expect(projectGrant(registry.registry, granted, { enablement: profileOff.overlay })).toEqual({
      kind: "profile_disabled",
      profileId: "organization_overview",
    });
  });

  it("reports an unknown enablement subject rather than failing open", () => {
    const registry = build();
    if (!registry.ok) return;
    expect(
      evaluateEnablement(registry.registry.enablement, {
        profileId: "organization_overview",
        capabilityId: "cap_not_registered",
      }),
    ).toEqual({ ok: false, code: "capability_unknown" });
    expect(evaluateEnablement(registry.registry.enablement, { profileId: "nope" })).toEqual({
      ok: false,
      code: "profile_unknown",
    });
  });
});

describe("compatibility fence handoff (plan U3 scenario 7)", () => {
  it("plans no epoch advance while the compatibility digest is unchanged", () => {
    expect(
      planCompatibilityAdvance({ currentEpoch: 4, currentDigest: "compat:a", nextDigest: "compat:a" }),
    ).toEqual({ advance: false, reason: "unchanged", epoch: 4, digest: "compat:a" });
  });

  it("plans a deterministic, idempotent advance when the digest changes", () => {
    const plan = planCompatibilityAdvance({
      currentEpoch: 4,
      currentDigest: "compat:a",
      nextDigest: "compat:b",
    });
    expect(plan).toEqual({
      advance: true,
      epoch: 5,
      digest: "compat:b",
      idempotencyKey: "agent-compatibility:5:compat:b",
    });
    expect(
      planCompatibilityAdvance({ currentEpoch: 4, currentDigest: "compat:a", nextDigest: "compat:b" }),
    ).toEqual(plan);
    expect(
      planCompatibilityAdvance({ currentEpoch: 0, currentDigest: undefined, nextDigest: "compat:b" }),
    ).toMatchObject({ advance: true, epoch: 1 });
  });

  it("terminally invalidates a nonterminal run pinned to the old digest and lets a retry start fresh", async () => {
    const t = convexTest(schema, modules);

    const { runId, currentDigest, currentEpoch } = await t.run(async (ctx) => {
      const tenant = await seedTenant(ctx, "compat-fence");
      const created = await seedRun(ctx, tenant, { compatibilityDigest: "compat:a" });
      await markAgentRunRunningWithCtx(ctx, { runId: created.runId, now: TEST_NOW });
      const epoch = await getCurrentCompatibilityEpochWithCtx(ctx);
      return {
        runId: created.runId,
        tenant,
        currentDigest: epoch.digest === "" ? undefined : epoch.digest,
        currentEpoch: epoch.epoch,
      };
    });

    const comparison = compareCompatibility(currentDigest, "compat:b");
    expect(comparison.requiresEpochAdvance).toBe(true);
    const plan = planCompatibilityAdvance({ currentEpoch, currentDigest, nextDigest: "compat:b" });
    expect(plan.advance).toBe(true);
    if (!plan.advance) return;

    const outcome = await t.run(async (ctx) =>
      advanceCompatibilityEpochWithCtx(ctx, {
        epoch: plan.epoch,
        digest: plan.digest,
        idempotencyKey: plan.idempotencyKey,
        reason: "u3_compatibility_digest_changed",
        now: TEST_NOW + 1,
      }),
    );
    expect(outcome.outcome).toBe("advanced");

    const repaired = await t.run(async (ctx) => repairFencedRunsWithCtx(ctx, { now: TEST_NOW + 2 }));
    expect(repaired.canceled).toBeGreaterThanOrEqual(1);

    const after = await t.run(async (ctx) => ctx.db.get("intelligenceRun", runId));
    expect(after?.status).toBe("canceled");

    const retry = await t.run(async (ctx) => {
      const tenant = await seedTenant(ctx, "compat-fence-retry");
      return seedRun(ctx, tenant, {
        compatibilityDigest: "compat:b",
        runIdempotencyKey: "turn-2",
        now: TEST_NOW + 3,
      });
    });
    expect(retry.compatibilityEpoch).toBe(plan.epoch);
    expect(retry.runId).not.toBe(runId);
  });
});
