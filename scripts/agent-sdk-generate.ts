/**
 * Agent SDK compiler.
 *
 * Discovers domain manifests from the explicit registration points in
 * `convex/agentHarness/manifestRegistrations.ts`, validates the whole
 * capability/read-port binding index, runs the reusable conformance harness
 * against every capability that claims to be enabled, and emits two checked-in
 * artifacts:
 *
 *   - `convex/agentHarness/_generated/registry.ts` — PRIVILEGED. Full
 *     manifests, the read-port dispatch binding (internal function paths),
 *     profile policy, per-port implementation identity, the published
 *     enablement baseline, and the registry/compatibility digests. Never
 *     model-visible.
 *   - `convex/agentHarness/_generated/schemas.ts` — the model-projectable
 *     capability schemas discovery serves after grant filtering. It carries no
 *     binding, port, read-intent, or digest-input material.
 *
 * Publication is atomic: any collision, invalid binding, orphan port, or
 * conformance failure returns issues and writes nothing. Output is byte-stable
 * (sorted keys, no timestamps), so `agent-sdk-check.ts` can prove the
 * committed artifacts match the source.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  buildAgentCapabilityRegistry,
  type AgentCapabilityRegistry,
  type AgentPortImplementationIndex,
} from "../packages/athena-webapp/convex/agentHarness/registry";
import {
  assertCapabilityEnableable,
} from "../packages/athena-webapp/convex/agentHarness/conformance";
import {
  AGENT_ADMISSION_POLICY_VERSION,
  AGENT_MANIFEST_REGISTRATIONS,
  AGENT_SELECTED_RUNTIME_ADAPTER,
  mergeManifestRegistrations,
  type AgentManifestRegistration,
} from "../packages/athena-webapp/convex/agentHarness/manifestRegistrations";
import type { AgentCapabilitySchemaIndex } from "../packages/athena-webapp/convex/agentHarness/discovery";
import {
  namespacePath,
  summarizeCapability,
  type AgentCapabilityDeclaration,
  type AgentCapabilityManifest,
  type AgentCapabilitySummary,
} from "../packages/athena-webapp/shared/agentHarness/manifest";
import { hashCanonical } from "../packages/athena-webapp/shared/agentHarness/agentRuntime";
import type { AgentContractIssue } from "../packages/athena-webapp/shared/agentHarness/values";

const WEBAPP_DIR = path.join("packages", "athena-webapp");
const CONVEX_DIR = path.join(WEBAPP_DIR, "convex");
const GENERATED_DIR = path.join(CONVEX_DIR, "agentHarness", "_generated");

export const AGENT_SDK_REGISTRY_ARTIFACT = path.join(GENERATED_DIR, "registry.ts");
export const AGENT_SDK_SCHEMAS_ARTIFACT = path.join(GENERATED_DIR, "schemas.ts");

/** Order matters: the registry artifact is written and compared first. */
export const AGENT_SDK_GENERATED_ARTIFACTS = [
  AGENT_SDK_REGISTRY_ARTIFACT,
  AGENT_SDK_SCHEMAS_ARTIFACT,
] as const;

export const AGENT_SDK_GENERATE_COMMAND = "bun run agent-sdk:generate";

/** Recorded when a registered port names a handler module that does not exist yet. */
export const AGENT_PORT_SOURCE_ABSENT = "absent";

const REGISTRY_REGION = "AGENT_GENERATED_REGISTRY_JSON";
const SCHEMAS_REGION = "AGENT_GENERATED_SCHEMAS_JSON";

export type AgentSdkArtifact = { readonly path: string; readonly contents: string };

export type AgentSdkGenerationInput = {
  readonly registrations: readonly AgentManifestRegistration[];
  readonly runtimeAdapter: { readonly adapterKind: string; readonly adapterVersion: string };
  readonly admissionPolicyVersion: string;
  /** Source of the module a read port dispatches to; `null` when it does not exist yet. */
  readonly readHandlerSource?: (functionPath: string) => string | null;
  /** Committed artifacts, keyed by path, used for the port version-bump check. */
  readonly previousArtifacts?: { readonly [artifactPath: string]: string };
};

export type AgentSdkGenerationResult =
  | {
      readonly ok: true;
      readonly artifacts: readonly AgentSdkArtifact[];
      readonly registry: AgentCapabilityRegistry;
      readonly schemas: AgentCapabilitySchemaIndex;
    }
  | { readonly ok: false; readonly issues: readonly AgentContractIssue[] };

// ---------------------------------------------------------------------------
// Deterministic serialization
// ---------------------------------------------------------------------------

function canonicalJson(value: unknown): string {
  const canonical = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(canonical);
    if (input && typeof input === "object") {
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(input as Record<string, unknown>).sort()) {
        const child = (input as Record<string, unknown>)[key];
        if (child === undefined) continue;
        out[key] = canonical(child);
      }
      return out;
    }
    return input;
  };
  return JSON.stringify(canonical(value), null, 2);
}

function region(name: string, body: string): string {
  return `// #region ${name}\n${body}\n// #endregion ${name}\n`;
}

/** Read a value emitted inside a generated region back out of the artifact. */
function readRegionJson<T>(source: string, name: string): T | null {
  const start = source.indexOf(`// #region ${name}\n`);
  const end = source.indexOf(`\n// #endregion ${name}`, start);
  if (start < 0 || end < 0) return null;
  const body = source.slice(start + `// #region ${name}\n`.length, end);
  const assignment = body.indexOf(" = ");
  if (assignment < 0) return null;
  const json = body.slice(assignment + 3).replace(/;\s*$/, "");
  try {
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}

export function readGeneratedRegistry(source: string): AgentCapabilityRegistry | null {
  return readRegionJson<AgentCapabilityRegistry>(source, REGISTRY_REGION);
}

export function readGeneratedSchemas(source: string): AgentCapabilitySchemaIndex | null {
  return readRegionJson<AgentCapabilitySchemaIndex>(source, SCHEMAS_REGION);
}

const GENERATED_HEADER = (subject: string, notes: readonly string[]) =>
  [
    "/**",
    ` * GENERATED FILE — do not edit. Run \`${AGENT_SDK_GENERATE_COMMAND}\`.`,
    " *",
    ` * ${subject}`,
    ...notes.map((note) => (note.length > 0 ? ` * ${note}` : " *")),
    " */",
    "",
  ].join("\n");

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

export function generateAgentSdkArtifacts(input: AgentSdkGenerationInput): AgentSdkGenerationResult {
  const issues: AgentContractIssue[] = [];
  const merged = mergeManifestRegistrations(input.registrations);

  for (const sourceKey of merged.duplicateSourceKeys) {
    issues.push({
      code: "registration_source_duplicate",
      path: `registrations.${sourceKey}`,
      message: `Registration source "${sourceKey}" is registered more than once.`,
    });
  }

  const readSource = input.readHandlerSource ?? (() => null);
  const portImplementations: Record<string, { implementationVersion: string; sourceDigest: string }> = {};
  for (const port of merged.readPorts.ports) {
    const source = readSource(port.handler.functionPath);
    portImplementations[port.portKey] = {
      implementationVersion: port.implementationVersion,
      sourceDigest:
        source === null ? AGENT_PORT_SOURCE_ABSENT : `sha256:${createHash("sha256").update(source).digest("hex")}`,
    };
  }

  issues.push(...portVersionIssues(portImplementations, input.previousArtifacts));

  const build = buildAgentCapabilityRegistry({
    manifests: merged.manifests,
    readPorts: merged.readPorts,
    profiles: merged.profiles,
    runtimeAdapter: input.runtimeAdapter,
    admissionPolicyVersion: input.admissionPolicyVersion,
    portImplementations,
  });
  if (!build.ok) {
    return { ok: false, issues: [...issues, ...build.issues] };
  }
  const registry = build.registry;

  // Conformance gates enabling. Unpublished and disabled capabilities stay in
  // the artifact (they are part of the schema identity) but are not gated.
  for (const manifest of Object.values(registry.capabilities)) {
    if (registry.enablement.capabilities[manifest.capabilityId] !== "enabled") continue;
    const portKey = registry.portByCapability[manifest.capabilityId];
    const port = portKey ? registry.readPorts[portKey] : undefined;
    if (!port) continue; // already reported by the coverage invariant
    const fixture = merged.conformance[manifest.capabilityId];
    const conformance = assertCapabilityEnableable({
      manifest,
      port,
      probes: fixture?.probes ?? [],
      extractor: fixture?.extractor,
    });
    if (!conformance.ok) issues.push(...conformance.issues);
  }

  if (issues.length > 0) return { ok: false, issues };

  const schemas = projectCapabilitySchemas(registry);

  return {
    ok: true,
    registry,
    schemas,
    artifacts: [
      { path: AGENT_SDK_REGISTRY_ARTIFACT, contents: renderRegistryArtifact(registry, merged.sourceKeys) },
      { path: AGENT_SDK_SCHEMAS_ARTIFACT, contents: renderSchemasArtifact(schemas) },
    ],
  };
}

function portVersionIssues(
  next: AgentPortImplementationIndex,
  previousArtifacts: AgentSdkGenerationInput["previousArtifacts"],
): AgentContractIssue[] {
  const previousSource = previousArtifacts?.[AGENT_SDK_REGISTRY_ARTIFACT];
  if (!previousSource) return [];
  const previous = readGeneratedRegistry(previousSource)?.portImplementations;
  if (!previous) return [];
  const issues: AgentContractIssue[] = [];
  for (const [portKey, record] of Object.entries(next)) {
    const before = previous[portKey];
    if (!before) continue;
    if (before.sourceDigest === AGENT_PORT_SOURCE_ABSENT) continue;
    if (record.sourceDigest === AGENT_PORT_SOURCE_ABSENT) continue;
    if (before.sourceDigest === record.sourceDigest) continue;
    if (before.implementationVersion !== record.implementationVersion) continue;
    issues.push({
      code: "port_implementation_version_stale",
      path: `readPorts.${portKey}.implementationVersion`,
      message:
        `Read port "${portKey}" changed behaviorally (${before.sourceDigest} → ${record.sourceDigest}) while its ` +
        `implementation version stayed "${record.implementationVersion}". Bump the version on both the manifest ` +
        "binding and the port so the compatibility digest and the deployment epoch fence can see the change.",
    });
  }
  return issues;
}

/**
 * The model-projectable subset: declarations (manifest minus binding) and
 * compact summaries. Grant filtering happens per run in
 * `convex/agentHarness/discovery.ts`.
 */
function projectCapabilitySchemas(registry: AgentCapabilityRegistry): AgentCapabilitySchemaIndex {
  const declarations: Record<string, AgentCapabilityDeclaration> = {};
  const summaries: Record<string, AgentCapabilitySummary> = {};
  const namespaceIndex: Record<string, string> = {};
  const packageIndex: Record<string, string> = {};
  for (const manifest of Object.values(registry.capabilities) as AgentCapabilityManifest[]) {
    const { binding: _binding, ...declaration } = manifest;
    // Minimize further than the declaration contract requires: which read
    // intent gates a projection is admission material, not model context. The
    // authority tier stays so an honest answer can say why a field is absent.
    declarations[manifest.capabilityId] = {
      ...declaration,
      projections: Object.fromEntries(
        Object.entries(manifest.projections).map(([key, policy]) => [
          key,
          { ...policy, requires: { tier: policy.requires.tier } },
        ]),
      ),
    };
    summaries[manifest.capabilityId] = summarizeCapability(manifest);
    namespaceIndex[namespacePath(manifest.namespace)] = manifest.capabilityId;
    packageIndex[manifest.capabilityId] = manifest.namespace.package;
  }
  return { declarations, summaries, namespaceIndex, packageIndex };
}

function renderRegistryArtifact(registry: AgentCapabilityRegistry, sourceKeys: readonly string[]): string {
  return [
    GENERATED_HEADER("Privileged agent capability registry.", [
      "",
      "Full manifests, the read-port dispatch binding, profile policy, per-port",
      "implementation identity, the published enablement baseline, and the",
      "registry/compatibility digests. This module is NEVER model-visible and",
      "must not be imported by `convex/agentHarness/discovery.ts` or by any",
      "path that renders model context.",
      "",
      "Registration sources:",
      ...sourceKeys.map((key) => `  - ${key}`),
    ]),
    'import type { AgentCapabilityRegistry } from "../registry";',
    "",
    region(
      REGISTRY_REGION,
      `export const AGENT_GENERATED_REGISTRY: AgentCapabilityRegistry = ${canonicalJson(registry)};`,
    ),
    "",
    `export const AGENT_GENERATED_SOURCE_KEYS: readonly string[] = ${canonicalJson(sourceKeys)};`,
    "",
    "/** What a run pins; the deployment epoch fence compares it with the durable epoch digest. */",
    `export const AGENT_GENERATED_COMPATIBILITY_DIGEST = ${JSON.stringify(registry.compatibilityDigest)};`,
    "",
    "/** Schema identity only; unchanged when a capability is enabled or disabled. */",
    `export const AGENT_GENERATED_REGISTRY_DIGEST = ${JSON.stringify(registry.registryDigest)};`,
    "",
  ].join("\n");
}

function renderSchemasArtifact(schemas: AgentCapabilitySchemaIndex): string {
  return [
    GENERATED_HEADER("Model-projectable capability schemas.", [
      "",
      "Declarations and compact summaries only: no capability binding, no read",
      "port, no dispatch target, and no compatibility identity. Grant filtering",
      "happens per run in `convex/agentHarness/discovery.ts`, which imports this",
      "module and never the privileged registry.",
    ]),
    'import type { AgentCapabilitySchemaIndex } from "../discovery";',
    "",
    region(
      SCHEMAS_REGION,
      `export const AGENT_GENERATED_CAPABILITY_SCHEMAS: AgentCapabilitySchemaIndex = ${canonicalJson(schemas)};`,
    ),
    "",
    "/** Identity of the model-visible schema set; changes whenever a declaration changes. */",
    `export const AGENT_GENERATED_SCHEMAS_DIGEST = ${JSON.stringify(hashCanonical(schemas))};`,
    "",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Filesystem wiring
// ---------------------------------------------------------------------------

export async function readCommittedAgentSdkArtifacts(
  rootDir: string,
): Promise<{ [artifactPath: string]: string }> {
  const committed: { [artifactPath: string]: string } = {};
  for (const artifactPath of AGENT_SDK_GENERATED_ARTIFACTS) {
    try {
      committed[artifactPath] = await readFile(path.join(rootDir, artifactPath), "utf8");
    } catch {
      // A missing artifact is reported by the caller, not treated as drift input.
    }
  }
  return committed;
}

export function readHandlerSourceFrom(rootDir: string) {
  return (functionPath: string): string | null => {
    const [modulePath] = functionPath.split(":");
    for (const extension of [".ts", ".js"]) {
      try {
        return readFileSync(path.join(rootDir, CONVEX_DIR, `${modulePath}${extension}`), "utf8");
      } catch {
        continue;
      }
    }
    return null;
  };
}

export async function buildAgentSdkGeneration(
  rootDir: string,
  overrides: Partial<AgentSdkGenerationInput> = {},
): Promise<AgentSdkGenerationResult> {
  return generateAgentSdkArtifacts({
    registrations: AGENT_MANIFEST_REGISTRATIONS,
    runtimeAdapter: AGENT_SELECTED_RUNTIME_ADAPTER,
    admissionPolicyVersion: AGENT_ADMISSION_POLICY_VERSION,
    readHandlerSource: readHandlerSourceFrom(rootDir),
    previousArtifacts: await readCommittedAgentSdkArtifacts(rootDir),
    ...overrides,
  });
}

export function formatGenerationIssues(issues: readonly AgentContractIssue[]): string {
  return [
    "[agent-sdk] Generation refused; no artifact was written:",
    ...issues.map((issue) => `  - [${issue.code}] ${issue.path}: ${issue.message}`),
  ].join("\n");
}

export async function writeAgentSdkArtifacts(rootDir: string) {
  const result = await buildAgentSdkGeneration(rootDir);
  if (!result.ok) throw new Error(formatGenerationIssues(result.issues));
  await mkdir(path.join(rootDir, GENERATED_DIR), { recursive: true });
  for (const artifact of result.artifacts) {
    await writeFile(path.join(rootDir, artifact.path), artifact.contents, "utf8");
  }
  return result;
}

if (import.meta.main) {
  writeAgentSdkArtifacts(process.cwd())
    .then((result) => {
      if (!result.ok) return;
      console.log(
        `[agent-sdk] Wrote ${result.artifacts.length} artifacts; compatibility digest ${result.registry.compatibilityDigest}.`,
      );
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    });
}
