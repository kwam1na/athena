/**
 * Synthetic second surface: `organization_overview` profile.
 *
 * Deliberately non-isomorphic to the first real profile while staying inside
 * the v1 contracts: organization-scoped (not store-scoped), a different
 * context and thread key (`profileId + organizationRef`), a different package
 * mix (`fleet` + `directory`), a single-snapshot `get` next to cursor-bounded
 * `list`s, a full-screen mount with different entry metadata, and different
 * source destinations. It exists to prove that additions expressible in v1
 * need no kernel edit to the capability contracts and still run end to end.
 * It imports only the
 * shared contracts; no product domain and no other profile.
 */
import { budgetVector } from "../../../shared/agentHarness/execution";
import { defineCapabilityManifest } from "../../../shared/agentHarness/manifest";
import { defineAgentProfile, definePresentationAdapter } from "../../../shared/agentHarness/profile";
import { defineAgentReadPort, type AgentReadPortIndex } from "../../../shared/agentHarness/readPort";
import { parseOpaqueRef } from "../../../shared/agentHarness/values";

export const SYNTHETIC_SECOND_SURFACE_PROFILE_ID = "organization_overview";

const LIST_COST = budgetVector({ calls: 1, rows: 50, bytes: 65_536, costUnits: 2, elapsedMs: 1_500 });
const SNAPSHOT_COST = budgetVector({ calls: 1, rows: 1, bytes: 8_192, costUnits: 1, elapsedMs: 800 });

export const FLEET_STORES_MANIFEST = defineCapabilityManifest({
  contractVersion: 1,
  capabilityId: "cap_synthetic_fleet_stores",
  namespace: { package: "fleet", resource: "stores" },
  packageVersion: "1.0.0",
  purpose: "Stores in the organization with their current health band.",
  scope: { kind: "organization" },
  lifecycle: "enabled",
  operations: {
    list: {
      purpose: "Page through the organization's stores.",
      filters: {
        region: {
          kind: "string",
          required: false,
          meaning: "Narrow to stores whose governing IANA timezone identifier matches (e.g. \"Africa/Accra\").",
        },
        health: {
          kind: "enum",
          required: false,
          values: ["healthy", "degraded", "offline"],
          meaning: "Health band partition.",
        },
      },
      bounds: { kind: "collection", maxItemsPerPage: 50, maxPagesPerRun: 2 },
    },
  },
  result: {
    fields: {
      storeRef: { kind: "opaqueRef", refKind: "resource", meaning: "Opaque store ref." },
      name: { kind: "string", meaning: "Store display name." },
      region: { kind: "string", meaning: "The store's governing IANA timezone identifier." },
      health: { kind: "enum", values: ["healthy", "degraded", "offline"], meaning: "Current health band." },
    },
  },
  projections: {},
  freshness: { classes: ["live"], authority: "live_read", rule: "Live organization roster." },
  completeness: { rule: "Complete once every page is consumed.", sourceKeys: ["pages"] },
  citation: { rule: "Cite store refs and capture time.", sourceRefKinds: ["fleet_store"] },
  evidence: { mode: "provenance_only", reason: "Roster rows are references." },
  cost: { worstCasePerCall: LIST_COST },
  egressClass: "operational",
  examples: [
    { title: "Degraded stores", verb: "list", args: { health: "degraded" }, description: "Stores needing attention." },
  ],
  binding: {
    readIntents: ["organization.view", "store.configuration.view"],
    portKey: "fleet.stores",
    implementationVersion: "2",
  },
});

export const FLEET_STORE_HEALTH_MANIFEST = defineCapabilityManifest({
  contractVersion: 1,
  capabilityId: "cap_synthetic_fleet_store_health",
  namespace: { package: "fleet", resource: "storeHealth" },
  packageVersion: "1.0.0",
  purpose: "One store's health snapshot: uptime, last incident, and review notes.",
  scope: { kind: "organization" },
  lifecycle: "enabled",
  operations: {
    get: {
      purpose: "One health snapshot for a store.",
      filters: {
        storeRef: { kind: "opaqueRef", refKind: "resource", required: true, meaning: "Opaque store ref." },
      },
      bounds: { kind: "snapshot" },
    },
  },
  result: {
    fields: {
      storeRef: { kind: "opaqueRef", refKind: "resource", meaning: "Opaque store ref." },
      uptimePercent: { kind: "percentage", meaning: "Uptime over the trailing week." },
      lastIncidentRef: { kind: "opaqueRef", refKind: "source", optional: true, meaning: "Most recent incident." },
      incidentNotes: {
        kind: "text",
        meaning: "Incident review notes.",
        projection: "incidentDetails",
        valueState: true,
      },
    },
  },
  projections: {
    incidentDetails: {
      requires: { tier: "full_admin", readIntents: ["platform.health.view"] },
      egressClass: "sensitive",
      meaning: "Incident review notes, full admins with platform health access only.",
    },
  },
  freshness: {
    classes: ["live", "derived"],
    authority: "derived",
    rule: "Uptime is derived from health samples; incident refs are live.",
  },
  completeness: { rule: "Both the sample window and incident feed must be covered.", sourceKeys: ["samples", "incidents"] },
  citation: { rule: "Cite the sample window hash and incident refs.", sourceRefKinds: ["health_sample_window", "incident"] },
  evidence: {
    mode: "extractor",
    extractorKey: "fleet.storeHealth",
    extractorVersion: "1",
    claimShapes: ["uptimePercent"],
  },
  cost: { worstCasePerCall: SNAPSHOT_COST },
  egressClass: "operational",
  examples: [
    { title: "Store health", verb: "get", args: { storeRef: "resource:store-7" }, description: "One store." },
  ],
  binding: {
    readIntents: ["organization.view", "platform.health.view"],
    portKey: "fleet.storeHealth",
    implementationVersion: "2",
  },
});

export const DIRECTORY_TEAMS_MANIFEST = defineCapabilityManifest({
  contractVersion: 1,
  capabilityId: "cap_synthetic_directory_teams",
  namespace: { package: "directory", resource: "teams" },
  packageVersion: "1.0.0",
  purpose: "Teams across the organization and their headcount.",
  scope: { kind: "organization" },
  lifecycle: "enabled",
  operations: {
    list: {
      purpose: "Page through teams.",
      filters: {
        role: { kind: "enum", required: false, values: ["managers", "cashiers", "support"], meaning: "Role partition." },
      },
      bounds: { kind: "collection", maxItemsPerPage: 50, maxPagesPerRun: 1 },
    },
  },
  result: {
    fields: {
      teamRef: { kind: "opaqueRef", refKind: "resource", meaning: "Opaque team ref." },
      name: { kind: "string", meaning: "Team name." },
      memberCount: { kind: "integer", meaning: "Active members." },
    },
  },
  projections: {},
  freshness: { classes: ["live"], authority: "live_read", rule: "Live directory." },
  completeness: { rule: "Complete once the single page is consumed.", sourceKeys: ["pages"] },
  citation: { rule: "Cite team refs.", sourceRefKinds: ["directory_team"] },
  evidence: { mode: "provenance_only", reason: "Directory rows are references." },
  cost: { worstCasePerCall: LIST_COST },
  egressClass: "operational",
  examples: [{ title: "Managers", verb: "list", args: { role: "managers" }, description: "Manager teams." }],
  binding: {
    readIntents: ["organization.view", "staff.view"],
    portKey: "directory.teams",
    implementationVersion: "2",
  },
});

export const SYNTHETIC_SECOND_SURFACE_MANIFESTS = [
  FLEET_STORES_MANIFEST,
  FLEET_STORE_HEALTH_MANIFEST,
  DIRECTORY_TEAMS_MANIFEST,
] as const;

export const SYNTHETIC_SECOND_SURFACE_READ_PORTS: AgentReadPortIndex = {
  contractVersion: 1,
  ports: [
    defineAgentReadPort({
      contractVersion: 1,
      portKey: "fleet.stores",
      capabilityId: FLEET_STORES_MANIFEST.capabilityId,
      verbs: ["list"],
      scopeKind: "organization",
      readIntents: FLEET_STORES_MANIFEST.binding.readIntents,
      implementationVersion: "2",
      declaredCost: FLEET_STORES_MANIFEST.cost.worstCasePerCall,
      handler: { kind: "internal_query", functionPath: "agentHarness/profiles/syntheticSecondSurfacePorts:listStores" },
      projections: [],
      completenessSourceKeys: ["pages"],
    }),
    defineAgentReadPort({
      contractVersion: 1,
      portKey: "fleet.storeHealth",
      capabilityId: FLEET_STORE_HEALTH_MANIFEST.capabilityId,
      verbs: ["get"],
      scopeKind: "organization",
      readIntents: FLEET_STORE_HEALTH_MANIFEST.binding.readIntents,
      implementationVersion: "2",
      declaredCost: FLEET_STORE_HEALTH_MANIFEST.cost.worstCasePerCall,
      handler: { kind: "internal_query", functionPath: "agentHarness/profiles/syntheticSecondSurfacePorts:getStoreHealth" },
      projections: ["incidentDetails"],
      completenessSourceKeys: ["samples", "incidents"],
    }),
    defineAgentReadPort({
      contractVersion: 1,
      portKey: "directory.teams",
      capabilityId: DIRECTORY_TEAMS_MANIFEST.capabilityId,
      verbs: ["list"],
      scopeKind: "organization",
      readIntents: DIRECTORY_TEAMS_MANIFEST.binding.readIntents,
      implementationVersion: "2",
      declaredCost: DIRECTORY_TEAMS_MANIFEST.cost.worstCasePerCall,
      handler: { kind: "internal_query", functionPath: "agentHarness/profiles/syntheticSecondSurfacePorts:listTeams" },
      projections: [],
      completenessSourceKeys: ["pages"],
    }),
  ],
};

export const SYNTHETIC_SECOND_SURFACE_PRESENTATION = definePresentationAdapter({
  contractVersion: 1,
  profileId: SYNTHETIC_SECOND_SURFACE_PROFILE_ID,
  contextBinding: { scopeKind: "organization", keys: ["organizationRef"] },
  contextLabel: (context) => `${context.organizationRef} · all stores`,
  entry: { label: "Ask Athena about the organization", location: "organization.overview.toolbar" },
  mountMode: "full_screen_sheet",
  starterIntents: [
    {
      id: "degraded_stores",
      label: "Which stores are degraded?",
      prompt: "Which stores are degraded or offline right now, and since when?",
      requiresPackages: ["fleet"],
    },
  ],
  resolveSourceDestination: (sourceRef) => {
    if (sourceRef.kind !== "fleet_store") return null;
    const parsed = parseOpaqueRef(sourceRef.ref);
    if (!parsed) return null;
    return { kind: "internal_route", route: `/organization/stores/${parsed.token}`, label: "Open store" };
  },
  threadKeyPolicy: {
    parts: ["profileId", "organizationRef"],
    onContextChange: "confirm_before_next_turn",
    activeTurnPolicy: "block_second_submission",
  },
});

export const SYNTHETIC_SECOND_SURFACE_PROFILE = defineAgentProfile({
  contractVersion: 1,
  profileId: SYNTHETIC_SECOND_SURFACE_PROFILE_ID,
  profileVersion: "1",
  lifecycle: "unpublished",
  scope: { kind: "organization" },
  packages: [
    { packageKey: "fleet", packageVersion: "1.0.0" },
    { packageKey: "directory", packageVersion: "1.0.0" },
  ],
  budgetPolicy: {
    runLimits: budgetVector({ calls: 12, rows: 1_000, bytes: 524_288, costUnits: 120, elapsedMs: 45_000 }),
    maxAttempts: 2,
    maxInFlightCalls: 3,
  },
  promptPolicy: {
    intent: "Answer bounded read-only questions about the organization's stores and teams.",
    untrustedDataLabel: "retrieved_organization_data",
    maxPromptBytes: 8_192,
    maxPromptTokens: 2_000,
  },
  egressPolicy: {
    maxClass: "sensitive",
    providers: [{ providerId: "athena_contract_fake", modelId: "fake-1", region: "local", maxClass: "sensitive" }],
  },
  runtimeAdapterKind: "athena_contract_fake",
  presentation: SYNTHETIC_SECOND_SURFACE_PRESENTATION,
  evaluation: {
    scenarios: [
      {
        id: "fleet_and_teams",
        kind: "cross_package",
        prompt: "Which degraded stores have the smallest support teams?",
        expects: ["fleet.stores", "fleet.storeHealth", "directory.teams"],
      },
      {
        id: "incident_notes_restricted",
        kind: "role_restricted",
        prompt: "Show the incident notes for store 7.",
        expects: ["incidentNotes absent without incidentDetails"],
      },
      {
        id: "unknown_region",
        kind: "partial_or_no_data",
        prompt: "How are stores in Atlantis doing?",
        expects: ["no_usable_sources"],
      },
    ],
  },
});
