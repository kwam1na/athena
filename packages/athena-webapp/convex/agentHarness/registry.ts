/**
 * Agent capability registry (kernel; product-neutral).
 *
 * Builds the privileged, in-memory registry from domain-owned manifests, the
 * explicit read-port index, and profile definitions: validates every contract,
 * binds read intents to the closed `readIntentCatalog`, composes the SDK view,
 * and derives the registry digest (manifests + SDK view) and compatibility
 * digest (registry digest + harness/runtime protocol versions + selected
 * adapter + admission-policy token + every port implementation version and
 * source digest + profile policy). It also projects a grant-specific
 * declaration set whose packages, capabilities, projections, fields, and
 * examples outside the grant are absent.
 *
 * Lifecycle is deliberately NOT a digest input (plan decision 4). Enabling or
 * disabling must not invalidate runs pinned to a digest: enablement lives in a
 * separate shrink-only overlay (`baselineEnablement` / `narrowEnablement` /
 * `evaluateEnablement`) that every dispatch consults live, so a disabled
 * capability is denied even under a pinned digest. Behavioral change — a port
 * implementation, harness/runtime protocol, adapter, admission policy, profile
 * policy, or schema change — moves the compatibility digest, and
 * `compareCompatibility` is what U7 feeds into the durable epoch fence.
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
  type AgentPresentationAdapter,
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
  type AgentLifecycleState,
} from "../../shared/agentHarness/values";
import type { AgentRuntimeGrant } from "./discovery";

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

/**
 * Behavioral identity of one registered read-port implementation. The version
 * token is declared by the domain; the source digest is computed by the
 * build-time generator over the handler module. A changed source with an
 * unchanged token is the deterministic check U3's generator refuses to write
 * past (plan U3 scenario 8).
 */
export type AgentPortImplementationRecord = {
  readonly implementationVersion: string;
  readonly sourceDigest: string;
};

export type AgentPortImplementationIndex = {
  readonly [portKey: string]: AgentPortImplementationRecord;
};

/** Source digest recorded when nothing computed one (in-memory builds and tests). */
export const AGENT_PORT_SOURCE_DIGEST_UNVERIFIED = "unverified";

/** Presentation metadata that survives serialization (callbacks stay in the profile module). */
export type AgentPresentationRecord = Omit<
  AgentPresentationAdapter,
  "contextLabel" | "resolveSourceDestination" | "threadKeyPolicy"
> & {
  readonly threadKeyPolicy: Omit<AgentPresentationAdapter["threadKeyPolicy"], "compose">;
};

/** Serializable profile: everything the kernel needs, no callbacks. */
export type AgentProfileRecord = Omit<AgentProfileDefinition, "presentation"> & {
  readonly presentation: AgentPresentationRecord;
};

export function toProfileRecord(profile: AgentProfileDefinition): AgentProfileRecord {
  const { contextLabel: _label, resolveSourceDestination: _resolve, threadKeyPolicy, ...presentation } =
    profile.presentation;
  const { compose: _compose, ...threadKey } = threadKeyPolicy;
  return {
    ...profile,
    presentation: { ...presentation, threadKeyPolicy: threadKey },
  };
}

export type AgentRegistryBuildInput = {
  readonly manifests: readonly AgentCapabilityManifest[];
  readonly readPorts: AgentReadPortIndex;
  readonly profiles: readonly AgentProfileDefinition[];
  readonly runtimeAdapter: { readonly adapterKind: string; readonly adapterVersion: string };
  /** Version token of the delegated-admission policy (U4). */
  readonly admissionPolicyVersion: string;
  /** Per-port implementation identity; the generator supplies real source digests. */
  readonly portImplementations?: AgentPortImplementationIndex;
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
  readonly profiles: { readonly [profileId: string]: AgentProfileRecord };
  readonly readPorts: { readonly [portKey: string]: AgentReadPortDefinition };
  readonly portByCapability: { readonly [capabilityId: string]: string };
  readonly portImplementations: AgentPortImplementationIndex;
  /** Published lifecycle baseline; the live overlay may only shrink it. */
  readonly enablement: AgentEnablementOverlay;
  /** Digest of manifest semantics and the SDK view, lifecycle excluded. */
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

  const profiles: Record<string, AgentProfileRecord> = {};
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
    profiles[profile.profileId] = toProfileRecord(profile);
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

  const portImplementations: Record<string, AgentPortImplementationRecord> = {};
  for (const port of Object.values(readPorts)) {
    const declared = input.portImplementations?.[port.portKey];
    portImplementations[port.portKey] = {
      implementationVersion: port.implementationVersion,
      sourceDigest: declared?.sourceDigest ?? AGENT_PORT_SOURCE_DIGEST_UNVERIFIED,
    };
  }

  const enablement = baselineEnablement(input.manifests, input.profiles);

  const registryDigest = hashCanonical({
    contractVersion: AGENT_HARNESS_CONTRACT_VERSION,
    capabilities: Object.fromEntries(
      Object.entries(capabilities).map(([capabilityId, manifest]) => [
        capabilityId,
        withoutLifecycle(manifest),
      ]),
    ),
    sdkView: composed.view,
  });
  const compatibilityDigest = hashCanonical({
    registryDigest,
    harnessProtocol: AGENT_HARNESS_PROTOCOL_VERSION,
    runtimeProtocol: AGENT_RUNTIME_PROTOCOL_VERSION,
    runtimeAdapter: input.runtimeAdapter,
    admissionPolicy: input.admissionPolicyVersion,
    portImplementations,
    readPortBindings: Object.fromEntries(
      Object.values(readPorts).map((port) => [
        port.portKey,
        {
          capabilityId: port.capabilityId,
          handler: port.handler,
          readIntents: [...port.readIntents].sort(),
          scopeKind: port.scopeKind,
          verbs: [...port.verbs].sort(),
        },
      ]),
    ),
    profiles: Object.fromEntries(
      Object.values(profiles).map((profile) => [profile.profileId, withoutLifecycle(profile)]),
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
      portImplementations,
      enablement,
      registryDigest,
      compatibilityDigest,
    }),
  };
}

// ---------------------------------------------------------------------------
// Enablement overlay (live kill switch) and compatibility identity
// ---------------------------------------------------------------------------

export type AgentEnablementOverlay = {
  readonly capabilities: { readonly [capabilityId: string]: AgentLifecycleState };
  readonly profiles: { readonly [profileId: string]: AgentLifecycleState };
};

export type AgentEnablementOverrides = {
  readonly capabilities?: { readonly [capabilityId: string]: AgentLifecycleState };
  readonly profiles?: { readonly [profileId: string]: AgentLifecycleState };
};

export type AgentEnablementNarrowing =
  | { readonly ok: true; readonly overlay: AgentEnablementOverlay }
  | { readonly ok: false; readonly issues: readonly AgentContractIssue[] };

export type AgentEnablementDecision =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly code:
        | "profile_unknown"
        | "profile_unpublished"
        | "profile_disabled"
        | "capability_unknown"
        | "capability_unpublished"
        | "capability_disabled";
    };

/** Strictly decreasing access: `enabled` > `unpublished` > `disabled`. */
const ENABLEMENT_RANK: { readonly [state in AgentLifecycleState]: number } = {
  enabled: 2,
  unpublished: 1,
  disabled: 0,
};

function withoutLifecycle<T extends { readonly lifecycle: AgentLifecycleState }>(value: T) {
  const { lifecycle: _lifecycle, ...rest } = value;
  return rest;
}

/** The published lifecycle of every manifest and profile, before any kill switch. */
export function baselineEnablement(
  manifests: readonly AgentCapabilityManifest[],
  profiles: readonly (AgentProfileDefinition | AgentProfileRecord)[],
): AgentEnablementOverlay {
  const capabilities: Record<string, AgentLifecycleState> = {};
  for (const manifest of [...manifests].sort((a, b) => a.capabilityId.localeCompare(b.capabilityId))) {
    capabilities[manifest.capabilityId] = manifest.lifecycle;
  }
  const profileStates: Record<string, AgentLifecycleState> = {};
  for (const profile of [...profiles].sort((a, b) => a.profileId.localeCompare(b.profileId))) {
    profileStates[profile.profileId] = profile.lifecycle;
  }
  return deepFreezeContract({ capabilities, profiles: profileStates });
}

/**
 * Apply a kill switch. Overrides may only shrink access: `enabled → disabled`
 * and `unpublished → disabled` are allowed, anything that widens is rejected,
 * and an unknown subject fails rather than creating one.
 */
export function narrowEnablement(
  overlay: AgentEnablementOverlay,
  overrides: AgentEnablementOverrides,
): AgentEnablementNarrowing {
  const issues: AgentContractIssue[] = [];
  const capabilities = { ...overlay.capabilities };
  const profiles = { ...overlay.profiles };

  const apply = (
    target: Record<string, AgentLifecycleState>,
    requested: { readonly [key: string]: AgentLifecycleState } | undefined,
    kind: "capabilities" | "profiles",
  ) => {
    for (const [key, next] of Object.entries(requested ?? {})) {
      const current = target[key];
      if (current === undefined) {
        issues.push({
          code: "enablement_subject_unknown",
          path: `${kind}.${key}`,
          message: `"${key}" is not registered; the kill switch may not create a subject.`,
        });
        continue;
      }
      if (ENABLEMENT_RANK[next] > ENABLEMENT_RANK[current]) {
        issues.push({
          code: "kill_switch_widens_access",
          path: `${kind}.${key}`,
          message: `The live overlay may only shrink access; "${key}" cannot move ${current} → ${next}.`,
        });
        continue;
      }
      target[key] = next;
    }
  };

  apply(capabilities, overrides.capabilities, "capabilities");
  apply(profiles, overrides.profiles, "profiles");

  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, overlay: deepFreezeContract({ capabilities, profiles }) };
}

/**
 * Live enablement check. Every dispatch, result release, and completion runs
 * this against the current overlay, so a run pinned to a digest that still
 * describes the capability is denied the moment the capability or its profile
 * is disabled.
 */
export function evaluateEnablement(
  overlay: AgentEnablementOverlay,
  subject: { readonly profileId: string; readonly capabilityId?: string },
): AgentEnablementDecision {
  const profileState = overlay.profiles[subject.profileId];
  if (profileState === undefined) return { ok: false, code: "profile_unknown" };
  if (profileState === "disabled") return { ok: false, code: "profile_disabled" };
  if (profileState === "unpublished") return { ok: false, code: "profile_unpublished" };
  if (subject.capabilityId === undefined) return { ok: true };
  const capabilityState = overlay.capabilities[subject.capabilityId];
  if (capabilityState === undefined) return { ok: false, code: "capability_unknown" };
  if (capabilityState === "disabled") return { ok: false, code: "capability_disabled" };
  if (capabilityState === "unpublished") return { ok: false, code: "capability_unpublished" };
  return { ok: true };
}

export type AgentCompatibilityComparison = {
  readonly changed: boolean;
  /** U7 advances the durable epoch and terminalizes nonterminal old-digest runs. */
  readonly requiresEpochAdvance: boolean;
  readonly previousDigest: string | undefined;
  readonly nextDigest: string;
};

/**
 * Pure old/new comparison metadata. U3 owns the identity; U1 owns the durable
 * epoch (`advanceCompatibilityEpochWithCtx`) and U7 owns the one-command
 * pre-deploy fence that consumes this.
 */
export function compareCompatibility(
  previousDigest: string | undefined,
  nextDigest: string,
): AgentCompatibilityComparison {
  const changed = previousDigest !== nextDigest;
  return { changed, requiresEpochAdvance: changed, previousDigest, nextDigest };
}

export const AGENT_COMPATIBILITY_ADVANCE_KEY_PREFIX = "agent-compatibility";

export type AgentCompatibilityAdvancePlan =
  | { readonly advance: false; readonly reason: "unchanged"; readonly epoch: number; readonly digest: string }
  | {
      readonly advance: true;
      readonly epoch: number;
      readonly digest: string;
      /** Deterministic, so a retried fence command is idempotent. */
      readonly idempotencyKey: string;
    };

/**
 * Turn a digest comparison into exactly the input U1's
 * `advanceCompatibilityEpochWithCtx` expects. This is the whole of U3's part
 * in the fence: U7 runs one command that disables the profile and applies this
 * plan, and the existing bounded repair pass terminalizes nonterminal runs
 * still pinned to the old epoch.
 */
export function planCompatibilityAdvance(input: {
  readonly currentEpoch: number;
  readonly currentDigest: string | undefined;
  readonly nextDigest: string;
}): AgentCompatibilityAdvancePlan {
  const comparison = compareCompatibility(input.currentDigest, input.nextDigest);
  if (!comparison.requiresEpochAdvance) {
    return { advance: false, reason: "unchanged", epoch: input.currentEpoch, digest: input.nextDigest };
  }
  const epoch = input.currentEpoch + 1;
  return {
    advance: true,
    epoch,
    digest: input.nextDigest,
    idempotencyKey: `${AGENT_COMPATIBILITY_ADVANCE_KEY_PREFIX}:${epoch}:${input.nextDigest}`,
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

export type AgentGrantProjectionOptions = {
  /**
   * Live enablement overlay. Defaults to the published baseline; a kill switch
   * may only shrink it. A disabled profile refuses to project at all, and a
   * capability that is not `enabled` is absent from the projection. An
   * `unpublished` profile still projects, because U10's direct-harness smoke
   * runs the contracts before the profile is enabled for operators; admission
   * for a real turn goes through `evaluateEnablement`.
   */
  readonly enablement?: AgentEnablementOverlay;
};

/**
 * Project the registry for one grant: only capabilities in packages selected
 * by the profile AND granted to the operator, enabled in the live overlay, and
 * whose bound read intents the operator holds; only projections whose tier and
 * read intents the operator satisfies. Everything else is absent from the
 * projection.
 */
export function projectGrant(
  registry: AgentCapabilityRegistry,
  grant: AgentGrantInput,
  options: AgentGrantProjectionOptions = {},
): AgentGrantProjectionOutcome {
  const profile = registry.profiles[grant.profileId];
  if (!profile) return { kind: "profile_unknown", profileId: grant.profileId };
  const enablement = options.enablement ?? registry.enablement;
  if ((enablement.profiles[profile.profileId] ?? profile.lifecycle) === "disabled") {
    return { kind: "profile_disabled", profileId: grant.profileId };
  }

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
    if ((enablement.capabilities[manifest.capabilityId] ?? manifest.lifecycle) !== "enabled") continue;
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

/**
 * Reduce a grant projection to the compact, serializable grant the
 * model-visible discovery surface consumes. It names capability ids and
 * granted projections only: no manifests, no bindings, no port handlers, no
 * read intents. `convex/agentHarness/discovery.ts` never reaches the
 * privileged registry, so this is the only way a grant crosses that boundary.
 */
export function toRuntimeGrant(projection: AgentGrantProjection): AgentRuntimeGrant {
  return deepFreezeContract({
    profileId: projection.profileId,
    profileVersion: projection.profileVersion,
    packages: [...projection.packages],
    capabilityIds: projection.capabilities.map((capability) => capability.capabilityId).sort(),
    grantedProjectionsByCapability: projection.grantedProjectionsByCapability,
    egressClass: projection.egressClass,
    registryDigest: projection.registryDigest,
    compatibilityDigest: projection.compatibilityDigest,
    grantDigest: projection.grantDigest,
  });
}
