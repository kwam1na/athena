/**
 * Agent SDK composition root — the explicit registration points the build-time
 * generator discovers manifests from.
 *
 * This module is NOT a kernel module and the Convex runtime never reads it:
 * the runtime reads the generated artifacts under `_generated/`. Only
 * `scripts/agent-sdk-generate.ts` (and its tests) import it, which is why it
 * may reach profile and domain capability modules that the kernel must not.
 *
 * Adding a package is a data change here and nothing else: append one
 * registration with its manifests, read-port index, profiles, conformance
 * fixtures, and evidence extractors, then run `bun run agent-sdk:generate`.
 * The Daily Operations packages register exactly this way.
 */
import type { AgentCapabilityManifest } from "../../shared/agentHarness/manifest";
import type { AgentProfileDefinition } from "../../shared/agentHarness/profile";
import type { AgentReadPortIndex } from "../../shared/agentHarness/readPort";
import {
  CONVEX_AGENT_ADAPTER_KIND,
  CONVEX_AGENT_ADAPTER_VERSION,
} from "./agentRuntime/convexAgentKind";
import type { AgentConformanceProbe, AgentEvidenceExtractor } from "./conformance";
import {
  SYNTHETIC_SECOND_SURFACE_MANIFESTS,
  SYNTHETIC_SECOND_SURFACE_PROFILE,
  SYNTHETIC_SECOND_SURFACE_READ_PORTS,
} from "./profiles/syntheticSecondSurface";
import {
  SYNTHETIC_SECOND_SURFACE_CONFORMANCE,
  SYNTHETIC_SECOND_SURFACE_EVIDENCE_EXTRACTORS,
} from "./profiles/syntheticSecondSurfaceConformance";
import {
  DAILY_OPERATIONS_MANIFESTS,
  DAILY_OPERATIONS_PROFILE,
  DAILY_OPERATIONS_READ_PORTS,
} from "./profiles/dailyOperations";
import {
  DAILY_OPERATIONS_CONFORMANCE,
  DAILY_OPERATIONS_EVIDENCE_EXTRACTORS,
} from "./profiles/dailyOperationsConformance";

/** Probes and the optional evidence extractor that gate enabling one capability. */
export type AgentCapabilityConformanceFixture = {
  readonly probes: readonly AgentConformanceProbe[];
  readonly extractor?: AgentEvidenceExtractor;
};

export type AgentManifestRegistration = {
  /** Stable identity of the registration point; must be unique. */
  readonly sourceKey: string;
  readonly manifests: readonly AgentCapabilityManifest[];
  readonly readPorts: AgentReadPortIndex;
  readonly profiles: readonly AgentProfileDefinition[];
  /** Keyed by capability id; every `enabled` capability needs an entry. */
  readonly conformance: { readonly [capabilityId: string]: AgentCapabilityConformanceFixture };
};

/**
 * Runtime adapter the generated compatibility identity is bound to: the
 * production Convex Agent adapter, named through its environment-neutral
 * identity module so the build-time generator never loads the Node adapter or
 * the AI SDK. Changing either token changes the compatibility digest and
 * therefore requires the pre-deploy epoch fence
 * (`bun run agent-harness:fence`).
 */
export const AGENT_SELECTED_RUNTIME_ADAPTER = {
  adapterKind: CONVEX_AGENT_ADAPTER_KIND,
  adapterVersion: CONVEX_AGENT_ADAPTER_VERSION,
} as const;

/** Version token of the delegated-admission policy; bumped on admission behavior change. */
export const AGENT_ADMISSION_POLICY_VERSION = "u4.0";

export const SYNTHETIC_SECOND_SURFACE_REGISTRATION: AgentManifestRegistration = {
  sourceKey: "agentHarness/profiles/syntheticSecondSurface",
  manifests: SYNTHETIC_SECOND_SURFACE_MANIFESTS,
  readPorts: SYNTHETIC_SECOND_SURFACE_READ_PORTS,
  profiles: [SYNTHETIC_SECOND_SURFACE_PROFILE],
  conformance: SYNTHETIC_SECOND_SURFACE_CONFORMANCE,
};

/**
 * Daily Operations (V26-1267) — the first real product surface. The manifests,
 * evidence extractors, and read ports live next to the domain read code; this
 * registration is the only place that names them for the generator.
 */
export const DAILY_OPERATIONS_REGISTRATION: AgentManifestRegistration = {
  sourceKey: "agentHarness/profiles/dailyOperations",
  manifests: DAILY_OPERATIONS_MANIFESTS,
  readPorts: DAILY_OPERATIONS_READ_PORTS,
  profiles: [DAILY_OPERATIONS_PROFILE],
  conformance: DAILY_OPERATIONS_CONFORMANCE,
};

/**
 * Manifest-declared evidence extractors by capability id. The kernel never
 * imports a domain, so `convex/platform/operationAdmission.ts` re-exports this
 * as `resolveAgentEvidenceExtractor` and the executor seams resolve through it.
 */
export const AGENT_EVIDENCE_EXTRACTORS: {
  readonly [capabilityId: string]: AgentEvidenceExtractor;
} = {
  ...DAILY_OPERATIONS_EVIDENCE_EXTRACTORS,
  ...SYNTHETIC_SECOND_SURFACE_EVIDENCE_EXTRACTORS,
};

/** Every registration point the generator compiles. Order does not matter. */
export const AGENT_MANIFEST_REGISTRATIONS: readonly AgentManifestRegistration[] = [
  SYNTHETIC_SECOND_SURFACE_REGISTRATION,
  DAILY_OPERATIONS_REGISTRATION,
];

export type AgentRegistrationMerge = {
  readonly sourceKeys: readonly string[];
  readonly manifests: readonly AgentCapabilityManifest[];
  readonly readPorts: AgentReadPortIndex;
  readonly profiles: readonly AgentProfileDefinition[];
  readonly conformance: { readonly [capabilityId: string]: AgentCapabilityConformanceFixture };
  readonly duplicateSourceKeys: readonly string[];
};

/**
 * Byte-stable ordering for the generated artifacts: compare UTF-16 code units
 * rather than `localeCompare`, whose result depends on the host's ICU locale.
 */
function byToken(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Merge registrations deterministically; duplicate source keys are reported, never merged. */
export function mergeManifestRegistrations(
  registrations: readonly AgentManifestRegistration[],
): AgentRegistrationMerge {
  const ordered = [...registrations].sort((left, right) => byToken(left.sourceKey, right.sourceKey));
  const seen = new Set<string>();
  const duplicateSourceKeys: string[] = [];
  const manifests: AgentCapabilityManifest[] = [];
  const ports = [];
  const profiles: AgentProfileDefinition[] = [];
  const conformance: Record<string, AgentCapabilityConformanceFixture> = {};

  for (const registration of ordered) {
    if (seen.has(registration.sourceKey)) {
      duplicateSourceKeys.push(registration.sourceKey);
      continue;
    }
    seen.add(registration.sourceKey);
    manifests.push(...registration.manifests);
    ports.push(...registration.readPorts.ports);
    profiles.push(...registration.profiles);
    for (const [capabilityId, fixture] of Object.entries(registration.conformance)) {
      conformance[capabilityId] = fixture;
    }
  }

  return {
    sourceKeys: ordered.map((registration) => registration.sourceKey),
    manifests: [...manifests].sort((left, right) => byToken(left.capabilityId, right.capabilityId)),
    readPorts: {
      contractVersion: 1,
      ports: [...ports].sort((left, right) => byToken(left.portKey, right.portKey)),
    },
    profiles: [...profiles].sort((left, right) => byToken(left.profileId, right.profileId)),
    conformance,
    duplicateSourceKeys,
  };
}
