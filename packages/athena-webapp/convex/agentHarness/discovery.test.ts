/**
 * Model-visible discovery surface (plan U3 scenarios 3 and 4).
 *
 * Default model context is compact, grant-filtered summaries. Detailed
 * declarations appear only after an authorized discover call, and everything
 * outside the grant — packages, capabilities, operations, projections, fields,
 * examples — is structurally absent rather than redacted. The privileged
 * registry (bindings, read intents, port handlers, digest inputs) must be
 * unreachable from this module's import graph.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  AGENT_CAPABILITY_SCHEMAS,
  createRunDiscoverySurface,
  describeCapability,
  discoverCapabilities,
  projectRunDeclarations,
  projectRunFacadeShape,
  type AgentRuntimeGrant,
} from "./discovery";
import { buildAgentCapabilityRegistry, projectGrant, toRuntimeGrant } from "./registry";
import {
  FLEET_STORE_HEALTH_MANIFEST,
  SYNTHETIC_SECOND_SURFACE_MANIFESTS,
  SYNTHETIC_SECOND_SURFACE_PROFILE,
  SYNTHETIC_SECOND_SURFACE_READ_PORTS,
} from "./profiles/syntheticSecondSurface";

const HARNESS_DIR = path.dirname(fileURLToPath(import.meta.url));

const registryBuild = buildAgentCapabilityRegistry({
  manifests: SYNTHETIC_SECOND_SURFACE_MANIFESTS,
  readPorts: SYNTHETIC_SECOND_SURFACE_READ_PORTS,
  profiles: [SYNTHETIC_SECOND_SURFACE_PROFILE],
  runtimeAdapter: { adapterKind: "athena_contract_fake", adapterVersion: "fake.1" },
  admissionPolicyVersion: "u4.0",
});

if (!registryBuild.ok) throw new Error("registry fixture failed to build");
const registry = registryBuild.registry;

const ALL_INTENTS = [
  "organization.view",
  "platform.health.view",
  "store.configuration.view",
  "staff.view",
];

function grantFor(options: {
  packages?: readonly string[];
  intents?: readonly string[];
  tier?: "member" | "manager" | "full_admin";
}): AgentRuntimeGrant {
  const projection = projectGrant(registry, {
    profileId: "organization_overview",
    grantedPackages: [...(options.packages ?? ["fleet", "directory"])],
    grantedReadIntents: [...(options.intents ?? ALL_INTENTS)],
    authorityTier: options.tier ?? "full_admin",
  });
  if (projection.kind !== "projected") throw new Error(`grant fixture failed: ${projection.kind}`);
  return toRuntimeGrant(projection);
}

const schemas = {
  declarations: Object.fromEntries(
    SYNTHETIC_SECOND_SURFACE_MANIFESTS.map((manifest) => {
      const { binding: _binding, ...declaration } = manifest;
      return [manifest.capabilityId, declaration];
    }),
  ),
  summaries: Object.fromEntries(
    SYNTHETIC_SECOND_SURFACE_MANIFESTS.map((manifest) => [
      manifest.capabilityId,
      {
        capabilityId: manifest.capabilityId,
        namespace: `${manifest.namespace.package}.${manifest.namespace.resource}`,
        purpose: manifest.purpose,
        verbs: Object.keys(manifest.operations),
        scopeKind: manifest.scope.kind,
      },
    ]),
  ),
  namespaceIndex: Object.fromEntries(
    SYNTHETIC_SECOND_SURFACE_MANIFESTS.map((manifest) => [
      `${manifest.namespace.package}.${manifest.namespace.resource}`,
      manifest.capabilityId,
    ]),
  ),
  packageIndex: Object.fromEntries(
    SYNTHETIC_SECOND_SURFACE_MANIFESTS.map((manifest) => [manifest.capabilityId, manifest.namespace.package]),
  ),
} as unknown as typeof AGENT_CAPABILITY_SCHEMAS;

const options = { schemas };

describe("grant-filtered discovery", () => {
  it("discovers compact summaries only, never fields, examples, or bindings", () => {
    const summaries = discoverCapabilities(grantFor({}), options);
    expect(summaries.map((summary) => summary.namespace).sort()).toEqual([
      "directory.teams",
      "fleet.storeHealth",
      "fleet.stores",
    ]);
    const serialized = JSON.stringify(summaries);
    expect(serialized).not.toContain("incidentNotes");
    expect(serialized).not.toContain("portKey");
    expect(serialized).not.toContain("readIntents");
    expect(serialized).not.toContain("functionPath");
    expect(Object.keys(summaries[0]).sort()).toEqual([
      "capabilityId",
      "namespace",
      "purpose",
      "scopeKind",
      "verbs",
    ]);
  });

  it("omits packages and capabilities outside the grant", () => {
    const fleetOnly = discoverCapabilities(grantFor({ packages: ["fleet"] }), options);
    expect(fleetOnly.map((summary) => summary.namespace)).not.toContain("directory.teams");

    const noStaff = discoverCapabilities(
      grantFor({ intents: ["organization.view", "platform.health.view", "store.configuration.view"] }),
      options,
    );
    expect(noStaff.map((summary) => summary.namespace).sort()).toEqual(["fleet.storeHealth", "fleet.stores"]);
  });

  it("returns a detailed declaration only after an authorized discover call", async () => {
    const surface = createRunDiscoverySurface(grantFor({}), options);
    expect(await surface.describe("fleet.storeHealth")).toEqual({
      kind: "discovery_required",
      namespace: "fleet.storeHealth",
    });
    await surface.discover();
    const described = await surface.describe("fleet.storeHealth");
    expect(described.kind).toBe("declaration");
    if (described.kind !== "declaration") return;
    expect(described.declaration.capabilityId).toBe(FLEET_STORE_HEALTH_MANIFEST.capabilityId);
    expect(Object.keys(described.declaration.result.fields)).toContain("uptimePercent");
    expect(described.declaration).not.toHaveProperty("binding");
  });

  it("hides ungranted capabilities behind unknown_namespace instead of confirming they exist", async () => {
    const surface = createRunDiscoverySurface(grantFor({ packages: ["fleet"] }), options);
    await surface.discover();
    expect(await surface.describe("directory.teams")).toEqual({
      kind: "unknown_namespace",
      namespace: "directory.teams",
    });
    expect(await surface.describe("operations.storeDay")).toEqual({
      kind: "unknown_namespace",
      namespace: "operations.storeDay",
    });
  });

  it("omits ungranted projections, fields, and examples from the per-run declarations", () => {
    const admin = projectRunDeclarations(grantFor({ tier: "full_admin" }), options);
    const adminHealth = admin.find((declaration) => declaration.namespace.resource === "storeHealth");
    expect(adminHealth && Object.keys(adminHealth.result.fields)).toContain("incidentNotes");
    expect(adminHealth && Object.keys(adminHealth.projections)).toContain("incidentDetails");

    const manager = projectRunDeclarations(grantFor({ tier: "manager" }), options);
    const managerHealth = manager.find((declaration) => declaration.namespace.resource === "storeHealth");
    expect(managerHealth && Object.keys(managerHealth.result.fields)).not.toContain("incidentNotes");
    expect(JSON.stringify(manager)).not.toContain("incidentDetails");
    expect(JSON.stringify(manager)).not.toContain("Till drawer");
  });

  it("projects a facade shape whose packages, resources, verbs, and fields follow the grant", () => {
    const facade = projectRunFacadeShape(grantFor({ packages: ["fleet"], tier: "manager" }), options);
    expect(Object.keys(facade.packages)).toEqual(["fleet"]);
    expect(Object.keys(facade.packages.fleet.resources).sort()).toEqual(["storeHealth", "stores"]);
    expect(facade.packages.fleet.resources.stores.verbs).toEqual(["list"]);
    expect(facade.packages.fleet.resources.storeHealth.verbs).toEqual(["get"]);
    expect(Object.keys(facade.packages.fleet.resources.storeHealth.resultFields)).not.toContain("incidentNotes");
    expect(Object.keys(facade.packages.fleet.resources.stores.args.list).sort()).toEqual([
      "cursor",
      "health",
      "region",
    ]);
    expect(JSON.stringify(facade)).not.toContain("propose");
    expect(JSON.stringify(facade)).not.toContain("mutate");
  });

  it("carries the pinned identities so the executor can fence a stale run", () => {
    const grant = grantFor({});
    expect(grant.compatibilityDigest).toBe(registry.compatibilityDigest);
    expect(grant.registryDigest).toBe(registry.registryDigest);
    expect(grant.grantDigest).toEqual(expect.any(String));
    expect(JSON.stringify(grant)).not.toContain("functionPath");
    expect(JSON.stringify(grant)).not.toContain("organization.view");
  });
});

/**
 * Modules that are allowed to import the privileged generated registry. It is
 * empty today: U4 binds ports and U7 fences epochs from it, and each addition
 * must be a conscious edit here plus proof that nothing model-visible reaches
 * the module transitively.
 */
export const PRIVILEGED_REGISTRY_CONSUMERS: readonly string[] = [
  // U7: the durable profile switch and the pre-deploy fence read the published
  // enablement baseline and the deployed compatibility digest. Nothing
  // model-visible imports it (the reachability test below stays green).
  "deploymentState.ts",
];

describe("privileged registry isolation", () => {
  const localImports = (relativePath: string): string[] => {
    const absolute = path.join(HARNESS_DIR, relativePath);
    if (!existsSync(absolute)) return [];
    const source = readFileSync(absolute, "utf8");
    const specifiers: string[] = [];
    for (const match of source.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']\s*\)?/g)) {
      if (match[1].startsWith(".")) specifiers.push(match[1]);
    }
    return specifiers;
  };

  const reachableFrom = (entry: string): Set<string> => {
    const seen = new Set<string>();
    const queue = [entry];
    while (queue.length > 0) {
      const current = queue.pop()!;
      if (seen.has(current)) continue;
      seen.add(current);
      for (const specifier of localImports(current)) {
        const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(current), specifier));
        for (const candidate of [`${resolved}.ts`, `${resolved}/index.ts`]) {
          if (existsSync(path.join(HARNESS_DIR, candidate))) {
            queue.push(candidate);
            break;
          }
        }
      }
    }
    return seen;
  };

  it("has no agent-harness module importing the privileged registry outside the allowlist", () => {
    const importers = readdirSync(HARNESS_DIR)
      .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
      .filter((name) => localImports(name).some((specifier) => specifier.includes("_generated/registry")));
    expect(importers.sort()).toEqual([...PRIVILEGED_REGISTRY_CONSUMERS].sort());
  });

  it("cannot reach the privileged registry, the composition root, or a profile from discovery", () => {
    const reachable = reachableFrom("discovery.ts");
    expect(reachable).toContain("discovery.ts");
    expect([...reachable].filter((file) => file.includes("_generated/registry"))).toEqual([]);
    expect([...reachable].filter((file) => file.includes("manifestRegistrations"))).toEqual([]);
    expect([...reachable].filter((file) => file.startsWith("profiles/"))).toEqual([]);
    expect([...reachable].filter((file) => file === "registry.ts")).toEqual([]);
    expect([...reachable].filter((file) => file.includes("_generated/schemas"))).toHaveLength(1);
  });

  it("keeps binding, port, and digest material out of the generated model-visible schemas", () => {
    const schemasPath = path.join(HARNESS_DIR, "_generated", "schemas.ts");
    expect(existsSync(schemasPath)).toBe(true);
    const source = readFileSync(schemasPath, "utf8");
    for (const forbidden of [
      "functionPath",
      "portKey",
      "readIntents",
      "implementationVersion",
      "compatibilityDigest",
      "internal_query",
      "internal_action",
      "admissionPolicy",
      "sourceDigest",
    ]) {
      expect(source, `generated schemas must not carry ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("keeps the generated privileged registry out of every model-visible export", () => {
    const registryPath = path.join(HARNESS_DIR, "_generated", "registry.ts");
    expect(existsSync(registryPath)).toBe(true);
    const source = readFileSync(registryPath, "utf8");
    expect(source).toContain("functionPath");
    expect(source).toMatch(/GENERATED|generated/);
    const declarations = projectRunDeclarations(grantFor({}));
    expect(JSON.stringify(declarations)).not.toContain("functionPath");
    expect(JSON.stringify(discoverCapabilities(grantFor({})))).not.toContain("functionPath");
  });

  it("serves the same capabilities from the checked-in generated schemas", () => {
    const summaries = discoverCapabilities(grantFor({}));
    expect(summaries.map((summary) => summary.namespace).sort()).toEqual([
      "directory.teams",
      "fleet.storeHealth",
      "fleet.stores",
    ]);
    // The generated schemas carry every REGISTERED package (V26-1267 added the
    // Daily Operations one); the grant above selects only the synthetic
    // profile's, which is why the summaries above are unchanged.
    const declared = Object.keys(AGENT_CAPABILITY_SCHEMAS.declarations);
    for (const manifest of SYNTHETIC_SECOND_SURFACE_MANIFESTS) {
      expect(declared).toContain(manifest.capabilityId);
    }
  });
});
