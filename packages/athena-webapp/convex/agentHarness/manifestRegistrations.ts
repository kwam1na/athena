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
 * U8 registers the Daily Operations packages exactly this way.
 */
import type { AgentCapabilityManifest } from "../../shared/agentHarness/manifest";
import type { AgentProfileDefinition } from "../../shared/agentHarness/profile";
import type { AgentReadPortIndex } from "../../shared/agentHarness/readPort";
import type { AgentConformanceProbe, AgentEvidenceExtractor } from "./conformance";
import {
  SYNTHETIC_SECOND_SURFACE_MANIFESTS,
  SYNTHETIC_SECOND_SURFACE_PROFILE,
  SYNTHETIC_SECOND_SURFACE_READ_PORTS,
} from "./profiles/syntheticSecondSurface";
import { SYNTHETIC_SECOND_SURFACE_CONFORMANCE } from "./profiles/syntheticSecondSurfaceConformance";

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
 * Runtime adapter the generated compatibility identity is bound to. U5 owns
 * the real `convex_agent` adapter; changing either token here changes the
 * compatibility digest and therefore requires U7's pre-deploy epoch fence.
 */
export const AGENT_SELECTED_RUNTIME_ADAPTER = {
  adapterKind: "athena_contract_fake",
  adapterVersion: "fake.1",
} as const;

/** Version token of the delegated-admission policy; U4 bumps it on behavior change. */
export const AGENT_ADMISSION_POLICY_VERSION = "u4.0";

export const SYNTHETIC_SECOND_SURFACE_REGISTRATION: AgentManifestRegistration = {
  sourceKey: "agentHarness/profiles/syntheticSecondSurface",
  manifests: SYNTHETIC_SECOND_SURFACE_MANIFESTS,
  readPorts: SYNTHETIC_SECOND_SURFACE_READ_PORTS,
  profiles: [SYNTHETIC_SECOND_SURFACE_PROFILE],
  conformance: SYNTHETIC_SECOND_SURFACE_CONFORMANCE,
};

/** Every registration point the generator compiles. Order does not matter. */
export const AGENT_MANIFEST_REGISTRATIONS: readonly AgentManifestRegistration[] = [
  SYNTHETIC_SECOND_SURFACE_REGISTRATION,
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
