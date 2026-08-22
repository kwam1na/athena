/**
 * Conformance fixtures for the synthetic second surface.
 *
 * Every published capability ships probes next to its manifest: one in-scope
 * observation per declared verb, one foreign-scope observation that must
 * return nothing, and — where the manifest declares extractor evidence — the
 * deterministic extractor itself. The generator refuses to publish an
 * `enabled` capability whose probes do not pass `runCapabilityConformance`,
 * so this file is the template a domain package (U8) copies.
 *
 * The observations are the shapes the read ports must return; U10 implements
 * the ports and keeps them honest against exactly these fixtures.
 */
import { budgetVector } from "../../../shared/agentHarness/execution";
import { opaqueRef } from "../../../shared/agentHarness/values";
import type { AgentReadEnvelope } from "../../../shared/agentHarness/results";
import type { AgentConformanceProbe, AgentEvidenceExtractor } from "../conformance";
import type { AgentCapabilityConformanceFixture } from "../manifestRegistrations";
import {
  DIRECTORY_TEAMS_MANIFEST,
  FLEET_STORES_MANIFEST,
  FLEET_STORE_HEALTH_MANIFEST,
} from "./syntheticSecondSurface";

const OBSERVED_AT = 1_700_000_000_000;
const HOME_SCOPE = "organization:organization-home";
const FOREIGN_SCOPE = "organization:organization-other";

const listEnvelope = (
  capabilityId: string,
  namespace: string,
  data: readonly unknown[],
  sourceKind: string,
): AgentReadEnvelope<unknown> =>
  ({
    contractVersion: 1,
    capabilityId,
    namespace,
    verb: "list",
    data,
    observedAt: OBSERVED_AT,
    capturedAt: OBSERVED_AT,
    freshness: { class: "live", authority: "live_read", observedAt: OBSERVED_AT, capturedAt: OBSERVED_AT },
    completeness: { status: "complete", sources: [{ sourceKey: "pages", status: "complete" }] },
    warnings: [],
    sourceRefs: data.length === 0 ? [] : [{ ref: opaqueRef("source", "page-1"), kind: sourceKind, capturedAt: OBSERVED_AT }],
    pagination: { hasMore: false, pageIndex: 0, pageSize: data.length, pagesRemainingInRun: 1 },
  }) as AgentReadEnvelope<unknown>;

const LIST_BUDGET = {
  requested: budgetVector({ calls: 1, rows: 50, bytes: 65_536, costUnits: 2, elapsedMs: 1_500 }),
  settled: budgetVector({ calls: 1, rows: 2, bytes: 1_024, costUnits: 1, elapsedMs: 45 }),
};

const SNAPSHOT_BUDGET = {
  requested: budgetVector({ calls: 1, rows: 1, bytes: 8_192, costUnits: 1, elapsedMs: 800 }),
  settled: budgetVector({ calls: 1, rows: 1, bytes: 512, costUnits: 1, elapsedMs: 30 }),
};

const STORE_ROWS = [
  {
    storeRef: opaqueRef("resource", "store-osu"),
    name: "Osu",
    region: "Greater Accra",
    health: "degraded",
  },
  {
    storeRef: opaqueRef("resource", "store-east-legon"),
    name: "East Legon",
    region: "Greater Accra",
    health: "healthy",
  },
];

const storesProbes: readonly AgentConformanceProbe[] = [
  {
    label: "degraded stores in the caller's organization",
    verb: "list",
    args: { health: "degraded" },
    scopeRef: HOME_SCOPE,
    grantedProjections: [],
    envelope: listEnvelope(FLEET_STORES_MANIFEST.capabilityId, "fleet.stores", STORE_ROWS, "fleet_store"),
    repeat: listEnvelope(FLEET_STORES_MANIFEST.capabilityId, "fleet.stores", STORE_ROWS, "fleet_store"),
    budget: LIST_BUDGET,
  },
  {
    label: "another organization's stores are invisible",
    verb: "list",
    args: {},
    scopeRef: FOREIGN_SCOPE,
    grantedProjections: [],
    foreignScope: true,
    envelope: listEnvelope(FLEET_STORES_MANIFEST.capabilityId, "fleet.stores", [], "fleet_store"),
    budget: LIST_BUDGET,
  },
];

const HEALTH_SNAPSHOT = {
  storeRef: opaqueRef("resource", "store-osu"),
  uptimePercent: 97,
  lastIncidentRef: opaqueRef("source", "incident-114"),
};

const healthEnvelope = (data: unknown): AgentReadEnvelope<unknown> =>
  ({
    contractVersion: 1,
    capabilityId: FLEET_STORE_HEALTH_MANIFEST.capabilityId,
    namespace: "fleet.storeHealth",
    verb: "get",
    data,
    observedAt: OBSERVED_AT,
    capturedAt: OBSERVED_AT,
    freshness: { class: "derived", authority: "derived", observedAt: OBSERVED_AT, capturedAt: OBSERVED_AT },
    completeness: {
      status: "complete",
      sources: [
        { sourceKey: "samples", status: "complete" },
        { sourceKey: "incidents", status: "complete" },
      ],
    },
    warnings: [],
    sourceRefs: [
      { ref: opaqueRef("source", "sample-window-31"), kind: "health_sample_window", capturedAt: OBSERVED_AT },
    ],
  }) as AgentReadEnvelope<unknown>;

const storeHealthProbes: readonly AgentConformanceProbe[] = [
  {
    label: "snapshot without the incident-details projection",
    verb: "get",
    args: { storeRef: opaqueRef("resource", "store-osu") },
    scopeRef: HOME_SCOPE,
    grantedProjections: [],
    envelope: healthEnvelope(HEALTH_SNAPSHOT),
    repeat: healthEnvelope(HEALTH_SNAPSHOT),
    budget: SNAPSHOT_BUDGET,
  },
  {
    label: "snapshot with the incident-details projection granted",
    verb: "get",
    args: { storeRef: opaqueRef("resource", "store-osu") },
    scopeRef: HOME_SCOPE,
    grantedProjections: ["incidentDetails"],
    envelope: healthEnvelope({
      ...HEALTH_SNAPSHOT,
      incidentNotes: { state: "known", value: "Till drawer left open overnight; reviewed with the manager." },
    }),
    budget: SNAPSHOT_BUDGET,
  },
  {
    label: "a store outside the organization has no health snapshot",
    verb: "get",
    args: { storeRef: opaqueRef("resource", "store-elsewhere") },
    scopeRef: FOREIGN_SCOPE,
    grantedProjections: [],
    foreignScope: true,
    // An empty snapshot, not a null one: the fields are structurally absent
    // and both sources report `unavailable`, which is what the port returns.
    envelope: healthEnvelope({}),
    budget: SNAPSHOT_BUDGET,
  },
];

/**
 * Deterministic, field-minimizing, authorization-preserving extractor: it
 * copies one already-authorized number out of the snapshot and nothing else.
 * An arbitrary transform it cannot substantiate returns `unsupported`, which
 * downgrades the citation to provenance-only after replay expiry.
 */
export const STORE_HEALTH_UPTIME_EXTRACTOR: AgentEvidenceExtractor = {
  extractorKey: "fleet.storeHealth",
  extractorVersion: "1",
  claimShapes: ["uptimePercent"],
  extract: (input) => {
    const data = input.data as { readonly uptimePercent?: unknown } | null;
    if (!data || typeof data.uptimePercent !== "number") {
      return { unsupported: "uptime_not_present_in_result" };
    }
    return { claim: { uptimePercent: data.uptimePercent } };
  },
};

const TEAM_ROWS = [
  { teamRef: opaqueRef("resource", "team-support"), name: "Support", memberCount: 4 },
  { teamRef: opaqueRef("resource", "team-managers"), name: "Managers", memberCount: 2 },
];

const teamsProbes: readonly AgentConformanceProbe[] = [
  {
    label: "teams in the caller's organization",
    verb: "list",
    args: { role: "managers" },
    scopeRef: HOME_SCOPE,
    grantedProjections: [],
    envelope: listEnvelope(DIRECTORY_TEAMS_MANIFEST.capabilityId, "directory.teams", TEAM_ROWS, "directory_team"),
    repeat: listEnvelope(DIRECTORY_TEAMS_MANIFEST.capabilityId, "directory.teams", TEAM_ROWS, "directory_team"),
    budget: LIST_BUDGET,
  },
  {
    label: "another organization's teams are invisible",
    verb: "list",
    args: {},
    scopeRef: FOREIGN_SCOPE,
    grantedProjections: [],
    foreignScope: true,
    envelope: listEnvelope(DIRECTORY_TEAMS_MANIFEST.capabilityId, "directory.teams", [], "directory_team"),
    budget: LIST_BUDGET,
  },
];

export const SYNTHETIC_SECOND_SURFACE_CONFORMANCE: {
  readonly [capabilityId: string]: AgentCapabilityConformanceFixture;
} = {
  [FLEET_STORES_MANIFEST.capabilityId]: { probes: storesProbes },
  [FLEET_STORE_HEALTH_MANIFEST.capabilityId]: {
    probes: storeHealthProbes,
    extractor: STORE_HEALTH_UPTIME_EXTRACTOR,
  },
  [DIRECTORY_TEAMS_MANIFEST.capabilityId]: { probes: teamsProbes },
};

/**
 * Runtime-side extractor index for this package, keyed by capability id. The
 * admission composition root re-exports the union of every package's index as
 * `resolveAgentEvidenceExtractor`, which the executor seams resolve through
 * when they mint claim support at completion.
 */
export const SYNTHETIC_SECOND_SURFACE_EVIDENCE_EXTRACTORS: {
  readonly [capabilityId: string]: AgentEvidenceExtractor;
} = {
  [FLEET_STORE_HEALTH_MANIFEST.capabilityId]: STORE_HEALTH_UPTIME_EXTRACTOR,
};
