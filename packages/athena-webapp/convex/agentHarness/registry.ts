/**
 * Agent capability registry (kernel; product-neutral).
 *
 * Builds the privileged, in-memory registry from domain-owned manifests, the
 * explicit read-port index, and profile definitions: validates every contract,
 * binds read intents to the closed `readIntentCatalog`, composes the SDK view,
 * and derives the registry digest (manifests + SDK view) and compatibility
 * digest (registry digest + harness/runtime protocol versions + selected
 * adapter + admission-policy token + every port implementation version). It
 * also projects a grant-specific declaration set whose packages, capabilities,
 * projections, fields, and examples outside the grant are absent.
 *
 * U3 generates the checked-in registry from these functions; U4 binds the
 * ports' internal function references at the admission composition root. The
 * registry never imports a product domain or a profile: profiles are inputs.
 */
import { isAthenaReadIntent } from "../platform/readIntentCatalog";
import { hashCanonical, AGENT_RUNTIME_PROTOCOL_VERSION } from "../../shared/agentHarness/agentRuntime";
import {
  composeCapabilityPackages,
  manifestEgressClass,
  namespacePath,
  projectManifestForGrant,
  summarizeCapability,
  supportedVerbs,
  validateCapabilityManifest,
  type AgentCapabilityDeclaration,
  type AgentCapabilityManifest,
  type AgentCapabilitySummary,
  type AgentSdkResourceView,
  type AgentSdkView,
} from "../../shared/agentHarness/manifest";
import {
  assertProfileSelection,
  validateProfileDefinition,
  type AgentProfileDefinition,
} from "../../shared/agentHarness/profile";
import {
  validateReadPortIndex,
  type AgentReadPortDefinition,
  type AgentReadPortIndex,
} from "../../shared/agentHarness/readPort";
import {
  AGENT_HARNESS_CONTRACT_VERSION,
  AGENT_HARNESS_PROTOCOL_VERSION,
  authorityTierRank,
  deepFreezeContract,
  maxEgressClass,
  type AgentAuthorityTier,
  type AgentContractIssue,
  type AgentEgressClass,
  type AgentHarnessContractVersion,
} from "../../shared/agentHarness/values";

export type AgentRegistryValidation =
  | { readonly ok: true }
  | { readonly ok: false; readonly issues: readonly AgentContractIssue[] };

const readIntentOptions = { isKnownReadIntent: isAthenaReadIntent };

function unknownIntentIssues(intents: readonly string[], path: string): AgentContractIssue[] {
  return intents
    .filter((intent) => !isAthenaReadIntent(intent))
    .map((intent) => ({
      code: "read_intent_unknown",
      path,
      message: `"${intent}" is not in the closed read-intent catalog; catalog changes are reviewed on their own.`,
    }));
}

/**
 * Manifest conformance at the registry boundary: the shared validation plus
 * the closed read-intent vocabulary for the binding and every projection.
 * U3 grows this into the generated conformance harness; U8 runs it per
 * manifest before a capability may be enabled.
 */
export function assertManifestConformance(manifest: AgentCapabilityManifest): AgentRegistryValidation {
  const validation = validateCapabilityManifest(manifest);
  if (!validation.ok) return validation;
  const issues: AgentContractIssue[] = [
    ...unknownIntentIssues(manifest.binding.readIntents, "binding.readIntents"),
  ];
  for (const [key, policy] of Object.entries(manifest.projections)) {
    issues.push(...unknownIntentIssues(policy.requires.readIntents ?? [], `projections.${key}.requires.readIntents`));
  }
  return issues.length === 0 ? { ok: true } : { ok: false, issues };
}

/**
 * Profile conformance: the profile validates, every selected package exists
 * at the selected version with matching scope and egress reach, and the
 * read-port index covers every capability of the selected packages.
 */
export function assertProfileConformance(
  profile: AgentProfileDefinition,
  input: { readonly manifests: readonly AgentCapabilityManifest[]; readonly readPorts: AgentReadPortIndex },
): AgentRegistryValidation {
  const issues: AgentContractIssue[] = [];
  const profileValidation = validateProfileDefinition(profile);
  if (!profileValidation.ok) issues.push(...profileValidation.issues);
  for (const manifest of input.manifests) {
    const conformance = assertManifestConformance(manifest);
    if (!conformance.ok) {
      issues.push(...conformance.issues.map((issue) => ({ ...issue, path: `${namespacePath(manifest.namespace)}.${issue.path}` })));
    }
  }
  if (issues.length > 0) return { ok: false, issues };
  const composed = composeCapabilityPackages(input.manifests);
  if (!composed.ok) return composed;
  const selection = assertProfileSelection(profile, composed.view, input.manifests);
  if (!selection.ok) issues.push(...selection.issues);
  const selectedPackages = new Set(profile.packages.map((selection) => selection.packageKey));
  const selectedManifests = input.manifests.filter((manifest) => selectedPackages.has(manifest.namespace.package));
  const coverage = validateReadPortIndex(
    {
      contractVersion: input.readPorts.contractVersion,
      ports: input.readPorts.ports.filter((port) =>
        selectedManifests.some((manifest) => manifest.capabilityId === port.capabilityId),
      ),
    },
    selectedManifests,
    readIntentOptions,
  );
  if (!coverage.ok) issues.push(...coverage.issues);
  return issues.length === 0 ? { ok: true } : { ok: false, issues };
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export type AgentRegistryBuildInput = {
  readonly manifests: readonly AgentCapabilityManifest[];
  readonly readPorts: AgentReadPortIndex;
  readonly profiles: readonly AgentProfileDefinition[];
  readonly runtimeAdapter: { readonly adapterKind: string; readonly adapterVersion: string };
  /** Version token of the delegated-admission policy (U4). */
  readonly admissionPolicyVersion: string;
};

export type AgentCapabilityRegistry = {
  readonly contractVersion: AgentHarnessContractVersion;
  readonly protocolVersions: {
    readonly harness: typeof AGENT_HARNESS_PROTOCOL_VERSION;
    readonly runtime: typeof AGENT_RUNTIME_PROTOCOL_VERSION;
    readonly runtimeAdapter: { readonly adapterKind: string; readonly adapterVersion: string };
    readonly admissionPolicy: string;
  };
  readonly capabilities: { readonly [capabilityId: string]: AgentCapabilityManifest };
  readonly namespaces: { readonly [namespace: string]: string };
  readonly sdkView: AgentSdkView;
  readonly profiles: { readonly [profileId: string]: AgentProfileDefinition };
  readonly readPorts: { readonly [portKey: string]: AgentReadPortDefinition };
  readonly portByCapability: { readonly [capabilityId: string]: string };
  /** Digest of manifests and the SDK view (what the model could be shown). */
  readonly registryDigest: string;
  /** Digest of the registry plus every behavioral version token (what a run pins). */
  readonly compatibilityDigest: string;
};

export type AgentRegistryBuild =
  | { readonly ok: true; readonly registry: AgentCapabilityRegistry }
  | { readonly ok: false; readonly issues: readonly AgentContractIssue[] };

export function buildAgentCapabilityRegistry(input: AgentRegistryBuildInput): AgentRegistryBuild {
  const issues: AgentContractIssue[] = [];

  input.manifests.forEach((manifest, index) => {
    const conformance = assertManifestConformance(manifest);
    if (!conformance.ok) {
      issues.push(...conformance.issues.map((issue) => ({ ...issue, path: `manifests[${index}].${issue.path}` })));
    }
  });
  if (issues.length > 0) return { ok: false, issues };

  const composed = composeCapabilityPackages(input.manifests);
  if (!composed.ok) return composed;

  const coverage = validateReadPortIndex(input.readPorts, input.manifests, readIntentOptions);
  if (!coverage.ok) issues.push(...coverage.issues);

  const profiles: Record<string, AgentProfileDefinition> = {};
  input.profiles.forEach((profile, index) => {
    const validation = validateProfileDefinition(profile);
    if (!validation.ok) {
      issues.push(...validation.issues.map((issue) => ({ ...issue, path: `profiles[${index}].${issue.path}` })));
      return;
    }
    if (profiles[profile.profileId]) {
      issues.push({
        code: "profile_id_collision",
        path: `profiles[${index}].profileId`,
        message: `Profile "${profile.profileId}" is declared more than once.`,
      });
      return;
    }
    const selection = assertProfileSelection(profile, composed.view, input.manifests);
    if (!selection.ok) {
      issues.push(...selection.issues.map((issue) => ({ ...issue, path: `profiles[${index}].${issue.path}` })));
      return;
    }
    profiles[profile.profileId] = profile;
  });
  if (issues.length > 0) return { ok: false, issues };

  const capabilities: Record<string, AgentCapabilityManifest> = {};
  const namespaces: Record<string, string> = {};
  for (const manifest of [...input.manifests].sort((a, b) => a.capabilityId.localeCompare(b.capabilityId))) {
    capabilities[manifest.capabilityId] = manifest;
    namespaces[namespacePath(manifest.namespace)] = manifest.capabilityId;
  }
  const readPorts: Record<string, AgentReadPortDefinition> = {};
  const portByCapability: Record<string, string> = {};
  for (const port of [...input.readPorts.ports].sort((a, b) => a.portKey.localeCompare(b.portKey))) {
    readPorts[port.portKey] = port;
    portByCapability[port.capabilityId] = port.portKey;
  }

  const registryDigest = hashCanonical({
    contractVersion: AGENT_HARNESS_CONTRACT_VERSION,
    capabilities,
    sdkView: composed.view,
  });
  const compatibilityDigest = hashCanonical({
    registryDigest,
    harnessProtocol: AGENT_HARNESS_PROTOCOL_VERSION,
    runtimeProtocol: AGENT_RUNTIME_PROTOCOL_VERSION,
    runtimeAdapter: input.runtimeAdapter,
    admissionPolicy: input.admissionPolicyVersion,
    portImplementations: Object.fromEntries(
      Object.values(readPorts).map((port) => [port.portKey, port.implementationVersion]),
    ),
    profiles: Object.fromEntries(
      Object.values(profiles).map((profile) => [profile.profileId, profile.profileVersion]),
    ),
  });

  return {
    ok: true,
    registry: deepFreezeContract({
      contractVersion: AGENT_HARNESS_CONTRACT_VERSION,
      protocolVersions: {
        harness: AGENT_HARNESS_PROTOCOL_VERSION,
        runtime: AGENT_RUNTIME_PROTOCOL_VERSION,
        runtimeAdapter: input.runtimeAdapter,
        admissionPolicy: input.admissionPolicyVersion,
      },
      capabilities,
      namespaces,
      sdkView: composed.view,
      profiles,
      readPorts,
      portByCapability,
      registryDigest,
      compatibilityDigest,
    }),
  };
}

// ---------------------------------------------------------------------------
// Grant projection
// ---------------------------------------------------------------------------

export type AgentGrantInput = {
  readonly profileId: string;
  /** Packages the operator's current authority intersects with the profile selection. */
  readonly grantedPackages: readonly string[];
  /** Read intents the operator currently holds (closed vocabulary). */
  readonly grantedReadIntents: readonly string[];
  readonly authorityTier: AgentAuthorityTier;
};

export type AgentGrantProjection = {
  readonly kind: "projected";
  readonly profileId: string;
  readonly profileVersion: string;
  readonly packages: readonly string[];
  readonly sdkView: AgentSdkView;
  readonly summaries: readonly AgentCapabilitySummary[];
  readonly capabilities: readonly AgentCapabilityDeclaration[];
  readonly grantedProjectionsByCapability: { readonly [capabilityId: string]: readonly string[] };
  readonly egressClass: AgentEgressClass;
  readonly registryDigest: string;
  readonly compatibilityDigest: string;
  readonly grantDigest: string;
};

export type AgentGrantProjectionOutcome =
  | AgentGrantProjection
  | { readonly kind: "profile_unknown"; readonly profileId: string }
  | { readonly kind: "profile_disabled"; readonly profileId: string };

/**
 * Project the registry for one grant: only capabilities in packages selected
 * by the profile AND granted to the operator, enabled, and whose bound read
 * intents the operator holds; only projections whose tier and read intents
 * the operator satisfies. Everything else is absent from the projection.
 */
export function projectGrant(registry: AgentCapabilityRegistry, grant: AgentGrantInput): AgentGrantProjectionOutcome {
  const profile = registry.profiles[grant.profileId];
  if (!profile) return { kind: "profile_unknown", profileId: grant.profileId };
  if (profile.lifecycle === "disabled") return { kind: "profile_disabled", profileId: grant.profileId };

  const selected = new Set(profile.packages.map((selection) => selection.packageKey));
  const packages = [...new Set(grant.grantedPackages)].filter((key) => selected.has(key)).sort();
  const packageSet = new Set(packages);
  const intents = new Set(grant.grantedReadIntents);
  const tierRank = authorityTierRank(grant.authorityTier);

  const capabilities: AgentCapabilityDeclaration[] = [];
  const summaries: AgentCapabilitySummary[] = [];
  const grantedProjectionsByCapability: Record<string, readonly string[]> = {};
  const viewPackages: Record<string, { version: string; resources: Record<string, AgentSdkResourceView> }> = {};
  let egressClass: AgentEgressClass = "operational";

  for (const manifest of Object.values(registry.capabilities)) {
    if (!packageSet.has(manifest.namespace.package)) continue;
    if (manifest.lifecycle !== "enabled") continue;
    if (!manifest.binding.readIntents.every((intent) => intents.has(intent))) continue;
    const grantedProjections = Object.entries(manifest.projections)
      .filter(
        ([, policy]) =>
          authorityTierRank(policy.requires.tier) <= tierRank &&
          (policy.requires.readIntents ?? []).every((intent) => intents.has(intent)),
      )
      .map(([key]) => key)
      .sort();
    grantedProjectionsByCapability[manifest.capabilityId] = grantedProjections;
    capabilities.push(projectManifestForGrant(manifest, { grantedProjections }));
    summaries.push(summarizeCapability(manifest));
    egressClass = maxEgressClass(egressClass, manifestEgressClass(manifest, grantedProjections));
    const pkg = (viewPackages[manifest.namespace.package] ??= {
      version: manifest.packageVersion,
      resources: {},
    });
    pkg.resources[manifest.namespace.resource] = {
      capabilityId: manifest.capabilityId,
      verbs: supportedVerbs(manifest),
      scopeKind: manifest.scope.kind,
    };
  }

  const sdkView: AgentSdkView = { contractVersion: AGENT_HARNESS_CONTRACT_VERSION, packages: viewPackages };
  const grantDigest = hashCanonical({
    profileId: profile.profileId,
    profileVersion: profile.profileVersion,
    packages: Object.keys(viewPackages).sort(),
    capabilities: capabilities.map((capability) => capability.capabilityId),
    grantedProjectionsByCapability,
    authorityTier: grant.authorityTier,
    registryDigest: registry.registryDigest,
  });

  return deepFreezeContract({
    kind: "projected",
    profileId: profile.profileId,
    profileVersion: profile.profileVersion,
    packages: Object.keys(viewPackages).sort(),
    sdkView,
    summaries,
    capabilities,
    grantedProjectionsByCapability,
    egressClass,
    registryDigest: registry.registryDigest,
    compatibilityDigest: registry.compatibilityDigest,
    grantDigest,
  });
}
