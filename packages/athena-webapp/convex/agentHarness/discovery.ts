/**
 * Model-visible discovery surface (kernel; product-neutral).
 *
 * This is the ONLY agent-harness module whose output may reach the model, so
 * it reads only the generated, model-projectable capability schemas
 * (`_generated/schemas.ts`) and a compact runtime grant. It never imports the
 * privileged generated registry, the manifest composition root, or a profile:
 * read intents, port keys, handler function paths, implementation versions,
 * and digest inputs simply are not reachable from here
 * (`discovery.test.ts` asserts the import graph).
 *
 * Progressive disclosure: the default model context is compact grant-filtered
 * summaries. A detailed declaration is served only after an authorized
 * discover call disclosed that namespace, and a namespace outside the grant is
 * reported as unknown rather than as forbidden, so discovery cannot be used to
 * enumerate what the operator may not see.
 */
import {
  projectManifestForGrant,
  summarizeCapability,
  supportedVerbs,
  type AgentCapabilityDeclaration,
  type AgentCapabilityManifest,
  type AgentCapabilitySummary,
  type AgentFieldRecord,
  type AgentFilterRecord,
} from "../../shared/agentHarness/manifest";
import type { AgentDescribeOutcome } from "../../shared/agentHarness/bridge";
import type { AgentEgressClass, AgentReadVerb, AgentScopeKind } from "../../shared/agentHarness/values";
import { AGENT_GENERATED_CAPABILITY_SCHEMAS } from "./_generated/schemas";

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/**
 * The compact, serializable grant a run carries. `registry.toRuntimeGrant`
 * mints it from the privileged projection; it names capability ids and granted
 * projections only.
 */
export type AgentRuntimeGrant = {
  readonly profileId: string;
  readonly profileVersion: string;
  readonly packages: readonly string[];
  readonly capabilityIds: readonly string[];
  readonly grantedProjectionsByCapability: { readonly [capabilityId: string]: readonly string[] };
  readonly egressClass: AgentEgressClass;
  readonly registryDigest: string;
  readonly compatibilityDigest: string;
  readonly grantDigest: string;
};

/** Model-projectable schemas: declarations and summaries, never bindings. */
export type AgentCapabilitySchemaIndex = {
  readonly declarations: { readonly [capabilityId: string]: AgentCapabilityDeclaration };
  readonly summaries: { readonly [capabilityId: string]: AgentCapabilitySummary };
  readonly namespaceIndex: { readonly [namespace: string]: string };
  readonly packageIndex: { readonly [capabilityId: string]: string };
};

/** The checked-in generated schemas the runtime serves by default. */
export const AGENT_CAPABILITY_SCHEMAS: AgentCapabilitySchemaIndex = AGENT_GENERATED_CAPABILITY_SCHEMAS;

export type AgentDiscoveryOptions = {
  readonly schemas?: AgentCapabilitySchemaIndex;
};

function schemasOf(options: AgentDiscoveryOptions | undefined): AgentCapabilitySchemaIndex {
  return options?.schemas ?? AGENT_CAPABILITY_SCHEMAS;
}

/**
 * Capability ids the grant admits, in a stable order, restricted to schemas
 * that actually exist. A grant naming a capability the generated schemas do
 * not carry is simply skipped: the run can never describe or call it.
 */
function grantedCapabilityIds(
  grant: AgentRuntimeGrant,
  schemas: AgentCapabilitySchemaIndex,
): readonly string[] {
  const packages = new Set(grant.packages);
  return [...grant.capabilityIds]
    .filter((capabilityId) => {
      const declaration = schemas.declarations[capabilityId];
      if (!declaration) return false;
      return packages.has(schemas.packageIndex[capabilityId] ?? declaration.namespace.package);
    })
    .sort();
}

// ---------------------------------------------------------------------------
// Discover, describe, and the per-run declarations
// ---------------------------------------------------------------------------

/** Compact catalog: what exists under this grant, never what fields it carries. */
export function discoverCapabilities(
  grant: AgentRuntimeGrant,
  options?: AgentDiscoveryOptions,
): readonly AgentCapabilitySummary[] {
  const schemas = schemasOf(options);
  return grantedCapabilityIds(grant, schemas).map((capabilityId) => {
    const summary = schemas.summaries[capabilityId];
    if (summary) return summary;
    // Defensive: derive from the declaration rather than inventing metadata.
    return summarizeCapability(asManifest(schemas.declarations[capabilityId]));
  });
}

/** Detailed declarations for the whole grant, with ungranted material absent. */
export function projectRunDeclarations(
  grant: AgentRuntimeGrant,
  options?: AgentDiscoveryOptions,
): readonly AgentCapabilityDeclaration[] {
  const schemas = schemasOf(options);
  return grantedCapabilityIds(grant, schemas).map((capabilityId) =>
    projectDeclaration(schemas.declarations[capabilityId], grant.grantedProjectionsByCapability[capabilityId] ?? []),
  );
}

export type AgentDiscoveryDescribeOutcome =
  | AgentDescribeOutcome
  /** The namespace is granted but has not been disclosed by a discover call yet. */
  | { readonly kind: "discovery_required"; readonly namespace: string };

/**
 * Describe one namespace. `disclosed` is the set of namespaces an authorized
 * discover call already returned in this run; without it the caller gets
 * `discovery_required`, and a namespace outside the grant is indistinguishable
 * from one that does not exist.
 */
export function describeCapability(
  grant: AgentRuntimeGrant,
  namespace: string,
  disclosed: ReadonlySet<string>,
  options?: AgentDiscoveryOptions,
): AgentDiscoveryDescribeOutcome {
  const schemas = schemasOf(options);
  const capabilityId = schemas.namespaceIndex[namespace];
  const granted = new Set(grantedCapabilityIds(grant, schemas));
  if (!capabilityId || !granted.has(capabilityId)) return { kind: "unknown_namespace", namespace };
  if (!disclosed.has(namespace)) return { kind: "discovery_required", namespace };
  return {
    kind: "declaration",
    declaration: projectDeclaration(
      schemas.declarations[capabilityId],
      grant.grantedProjectionsByCapability[capabilityId] ?? [],
    ),
  };
}

export type AgentRunDiscoverySurface = {
  readonly discover: () => Promise<readonly AgentCapabilitySummary[]>;
  readonly describe: (namespace: string) => Promise<AgentDiscoveryDescribeOutcome>;
  readonly disclosedNamespaces: () => readonly string[];
};

/**
 * The per-run surface the fixed `athena.discover` / `athena.describe` tool
 * handlers call. Disclosure state lives in the run, not in the model: a
 * describe before an authorized discover is refused.
 */
export function createRunDiscoverySurface(
  grant: AgentRuntimeGrant,
  options?: AgentDiscoveryOptions,
): AgentRunDiscoverySurface {
  const disclosed = new Set<string>();
  return {
    discover: async () => {
      const summaries = discoverCapabilities(grant, options);
      for (const summary of summaries) disclosed.add(summary.namespace);
      return summaries;
    },
    describe: async (namespace: string) => describeCapability(grant, namespace, disclosed, options),
    disclosedNamespaces: () => [...disclosed].sort(),
  };
}

// ---------------------------------------------------------------------------
// Facade shape
// ---------------------------------------------------------------------------

export type AgentFacadeResourceShape = {
  readonly capabilityId: string;
  readonly verbs: readonly AgentReadVerb[];
  readonly scopeKind: AgentScopeKind;
  /** Argument schema per verb; `list` always carries the cursor. */
  readonly args: { readonly [verb: string]: AgentFilterRecord };
  readonly resultFields: AgentFieldRecord;
};

export type AgentFacadeShape = {
  readonly packages: {
    readonly [packageKey: string]: {
      readonly version: string;
      readonly resources: { readonly [resource: string]: AgentFacadeResourceShape };
    };
  };
};

/**
 * The `athena.<package>.<resource>.get|list` shape the program is given for
 * this run. Only granted packages, resources, verbs, and fields exist on it;
 * there is no command surface to omit because none is ever generated.
 */
export function projectRunFacadeShape(
  grant: AgentRuntimeGrant,
  options?: AgentDiscoveryOptions,
): AgentFacadeShape {
  const packages: Record<
    string,
    { version: string; resources: Record<string, AgentFacadeResourceShape> }
  > = {};
  for (const declaration of projectRunDeclarations(grant, options)) {
    const pkg = (packages[declaration.namespace.package] ??= {
      version: declaration.packageVersion,
      resources: {},
    });
    const args: Record<string, AgentFilterRecord> = {};
    for (const verb of supportedVerbs(asManifest(declaration))) {
      const operation = declaration.operations[verb];
      if (!operation) continue;
      args[verb] =
        verb === "list"
          ? {
              ...operation.filters,
              cursor: {
                kind: "opaqueRef",
                refKind: "cursor",
                required: false,
                meaning: "Cursor from the previous page of this collection.",
              },
            }
          : operation.filters;
    }
    pkg.resources[declaration.namespace.resource] = {
      capabilityId: declaration.capabilityId,
      verbs: supportedVerbs(asManifest(declaration)),
      scopeKind: declaration.scope.kind,
      args,
      resultFields: declaration.result.fields,
    };
  }
  return { packages };
}

// ---------------------------------------------------------------------------
// Projection helpers
// ---------------------------------------------------------------------------

/**
 * A declaration is a manifest without its binding. `projectManifestForGrant`
 * is the single omission implementation, so the empty binding here is a
 * placeholder that the same function strips again on the way out.
 */
const ABSENT_BINDING = {
  readIntents: [],
  portKey: "",
  implementationVersion: "",
} as const;

function asManifest(declaration: AgentCapabilityDeclaration): AgentCapabilityManifest {
  return { ...declaration, binding: ABSENT_BINDING } as AgentCapabilityManifest;
}

function projectDeclaration(
  declaration: AgentCapabilityDeclaration,
  grantedProjections: readonly string[],
): AgentCapabilityDeclaration {
  return projectManifestForGrant(asManifest(declaration), { grantedProjections });
}
