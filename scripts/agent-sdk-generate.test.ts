import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  AGENT_SDK_GENERATED_ARTIFACTS,
  AGENT_SDK_GENERATE_COMMAND,
  generateAgentSdkArtifacts,
  readGeneratedRegistry,
  type AgentSdkGenerationInput,
} from "./agent-sdk-generate";
import { checkAgentSdkArtifacts } from "./agent-sdk-check";

import {
  AGENT_MANIFEST_REGISTRATIONS,
  AGENT_ADMISSION_POLICY_VERSION,
  AGENT_SELECTED_RUNTIME_ADAPTER,
} from "../packages/athena-webapp/convex/agentHarness/manifestRegistrations";
import type { AgentCapabilityManifest } from "../packages/athena-webapp/shared/agentHarness/manifest";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");

const baseInput = (): AgentSdkGenerationInput => ({
  registrations: AGENT_MANIFEST_REGISTRATIONS,
  runtimeAdapter: AGENT_SELECTED_RUNTIME_ADAPTER,
  admissionPolicyVersion: AGENT_ADMISSION_POLICY_VERSION,
  readHandlerSource: () => null,
});

const [SYNTHETIC] = AGENT_MANIFEST_REGISTRATIONS;

function codes(result: { ok: boolean; issues?: readonly { code: string }[] }) {
  return result.ok ? [] : [...new Set((result.issues ?? []).map((issue) => issue.code))].sort();
}

function withManifests(manifests: readonly AgentCapabilityManifest[]): AgentSdkGenerationInput {
  return { ...baseInput(), registrations: [{ ...SYNTHETIC, manifests }] };
}

describe("agent SDK generation", () => {
  it("produces byte-stable artifacts and a stable digest for identical inputs", () => {
    const first = generateAgentSdkArtifacts(baseInput());
    const second = generateAgentSdkArtifacts(baseInput());
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.artifacts.map((artifact) => artifact.path)).toEqual([...AGENT_SDK_GENERATED_ARTIFACTS]);
    for (const [index, artifact] of first.artifacts.entries()) {
      expect(artifact.contents).toBe(second.artifacts[index].contents);
    }
    expect(first.registry.compatibilityDigest).toBe(second.registry.compatibilityDigest);
    expect(first.registry.registryDigest).toBe(second.registry.registryDigest);
    for (const artifact of first.artifacts) {
      expect(artifact.contents).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
      expect(artifact.contents.endsWith("\n")).toBe(true);
    }
  });

  it("keeps the privileged binding in the registry artifact and out of the schemas artifact", () => {
    const result = generateAgentSdkArtifacts(baseInput());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [registryArtifact, schemasArtifact] = result.artifacts;
    expect(registryArtifact.contents).toContain("functionPath");
    expect(registryArtifact.contents).toContain("portImplementations");
    expect(schemasArtifact.contents).not.toContain("functionPath");
    expect(schemasArtifact.contents).not.toContain("portKey");
    expect(schemasArtifact.contents).not.toContain("implementationVersion");
    expect(schemasArtifact.contents).not.toContain("compatibilityDigest");

    const parsed = readGeneratedRegistry(registryArtifact.contents);
    expect(parsed?.compatibilityDigest).toBe(result.registry.compatibilityDigest);
    expect(Object.keys(parsed?.readPorts ?? {}).length).toBeGreaterThan(0);
  });

  it("fails atomically on namespace collisions, capability id collisions, and duplicate sources", () => {
    const [stores] = SYNTHETIC.manifests;
    const collidingNamespace = { ...stores, capabilityId: "cap_synthetic_other" } as AgentCapabilityManifest;
    const collision = generateAgentSdkArtifacts(withManifests([...SYNTHETIC.manifests, collidingNamespace]));
    expect(codes(collision)).toContain("namespace_collision");
    expect(collision.ok).toBe(false);

    const duplicateId = {
      ...stores,
      namespace: { package: "fleet", resource: "storesCopy" },
    } as AgentCapabilityManifest;
    expect(codes(generateAgentSdkArtifacts(withManifests([...SYNTHETIC.manifests, duplicateId])))).toContain(
      "capability_id_collision",
    );

    const duplicateSource = generateAgentSdkArtifacts({
      ...baseInput(),
      registrations: [SYNTHETIC, SYNTHETIC],
    });
    expect(codes(duplicateSource)).toContain("registration_source_duplicate");
  });

  it("fails on a missing admitted-operation binding and on an orphan port", () => {
    const [stores, ...rest] = SYNTHETIC.manifests;
    const unbound = {
      ...stores,
      binding: { ...stores.binding, portKey: "fleet.storesMissing" },
    } as AgentCapabilityManifest;
    expect(codes(generateAgentSdkArtifacts(withManifests([unbound, ...rest])))).toContain("capability_port_missing");

    const orphan = generateAgentSdkArtifacts(withManifests(rest));
    expect(codes(orphan)).toContain("port_orphaned");
  });

  it("fails on an unbounded collection operation", () => {
    const [stores, ...rest] = SYNTHETIC.manifests;
    const unbounded = {
      ...stores,
      operations: {
        list: {
          ...stores.operations.list,
          bounds: { kind: "collection", maxPagesPerRun: 1 },
        },
      },
    } as unknown as AgentCapabilityManifest;
    expect(codes(generateAgentSdkArtifacts(withManifests([unbounded, ...rest])))).toContain("bounds_invalid");
  });

  it("refuses to enable a capability whose conformance harness fails", () => {
    const withoutProbes = generateAgentSdkArtifacts({
      ...baseInput(),
      registrations: [{ ...SYNTHETIC, conformance: {} }],
    });
    expect(codes(withoutProbes)).toContain("conformance_probe_missing");
    expect(withoutProbes.ok).toBe(false);
  });

  it("leaves an unpublished capability out of the conformance gate but inside the artifact", () => {
    const [stores, ...rest] = SYNTHETIC.manifests;
    const unpublished = { ...stores, lifecycle: "unpublished" } as AgentCapabilityManifest;
    const result = generateAgentSdkArtifacts({
      ...baseInput(),
      registrations: [
        {
          ...SYNTHETIC,
          manifests: [unpublished, ...rest],
          conformance: Object.fromEntries(
            Object.entries(SYNTHETIC.conformance).filter(([capabilityId]) => capabilityId !== stores.capabilityId),
          ),
        },
      ],
    });
    expect(codes(result)).toEqual([]);
    if (!result.ok) return;
    expect(result.registry.enablement.capabilities[stores.capabilityId]).toBe("unpublished");
    expect(Object.keys(result.registry.capabilities)).toContain(stores.capabilityId);
  });

  it("requires an implementation version bump when a registered port's source changes", () => {
    const previousSources: Record<string, string> = {
      "agentHarness/profiles/syntheticSecondSurfacePorts": "export const listStores = 1;\n",
    };
    const before = generateAgentSdkArtifacts({
      ...baseInput(),
      readHandlerSource: (functionPath) => previousSources[functionPath.split(":")[0]] ?? null,
    });
    expect(before.ok).toBe(true);
    if (!before.ok) return;

    const committed = Object.fromEntries(
      before.artifacts.map((artifact) => [artifact.path, artifact.contents]),
    );

    const changed = generateAgentSdkArtifacts({
      ...baseInput(),
      readHandlerSource: () => "export const listStores = 2;\n",
      previousArtifacts: committed,
    });
    expect(codes(changed)).toContain("port_implementation_version_stale");
    expect(changed.ok).toBe(false);

    const bumped = generateAgentSdkArtifacts({
      ...baseInput(),
      registrations: [
        {
          ...SYNTHETIC,
          // Any version above whatever the package currently publishes; the
          // point is that it MOVED, not the number.
          manifests: SYNTHETIC.manifests.map(
            (manifest) =>
              ({
                ...manifest,
                binding: { ...manifest.binding, implementationVersion: "99" },
              }) as AgentCapabilityManifest,
          ),
          readPorts: {
            ...SYNTHETIC.readPorts,
            ports: SYNTHETIC.readPorts.ports.map((port) => ({ ...port, implementationVersion: "99" })),
          },
        },
      ],
      readHandlerSource: () => "export const listStores = 2;\n",
      previousArtifacts: committed,
    });
    expect(codes(bumped)).toEqual([]);
    if (!bumped.ok) return;
    expect(bumped.registry.compatibilityDigest).not.toBe(before.registry.compatibilityDigest);
    expect(bumped.registry.registryDigest).not.toBe(before.registry.registryDigest);
  });

  it("does not demand a bump for a port whose handler module does not exist yet", () => {
    const before = generateAgentSdkArtifacts(baseInput());
    expect(before.ok).toBe(true);
    if (!before.ok) return;
    const committed = Object.fromEntries(before.artifacts.map((artifact) => [artifact.path, artifact.contents]));
    const implemented = generateAgentSdkArtifacts({
      ...baseInput(),
      readHandlerSource: () => "export const listStores = 1;\n",
      previousArtifacts: committed,
    });
    expect(codes(implemented)).toEqual([]);
    if (!implemented.ok) return;
    expect(implemented.registry.compatibilityDigest).not.toBe(before.registry.compatibilityDigest);
  });
});

describe("agent SDK drift check", () => {
  it("passes against the committed artifacts", async () => {
    const result = await checkAgentSdkArtifacts(REPO_ROOT);
    expect(result.issues).toEqual([]);
    expect(result.stale).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("reports drift with the regenerate command", async () => {
    const result = await checkAgentSdkArtifacts(REPO_ROOT, {
      readArtifact: async () => "// stale\n",
    });
    expect(result.ok).toBe(false);
    expect(result.stale).toEqual([...AGENT_SDK_GENERATED_ARTIFACTS]);
    expect(result.message).toContain(AGENT_SDK_GENERATE_COMMAND);
  });

  it("reports a missing artifact instead of silently regenerating it", async () => {
    const result = await checkAgentSdkArtifacts(REPO_ROOT, {
      readArtifact: async () => null,
    });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("missing");
  });
});
