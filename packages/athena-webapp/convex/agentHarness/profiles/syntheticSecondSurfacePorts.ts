/**
 * Read ports of the synthetic second surface (`organization_overview`).
 *
 * Authority boundary: each port is defined through the composition root's
 * `defineAgentReadPortQuery`, so it is reauthorized inside its own
 * transaction, scoped from the verified grant, field-stripped against the
 * granted projections, and envelope-checked exactly like every product port.
 * The organization scope is the point of the surface: nothing here takes a
 * store from arguments, and a store outside the caller's organization is
 * structurally absent rather than refused.
 *
 * The reads are deliberately small and bounded — this package exists to prove
 * that a second, non-isomorphic profile needs no kernel change — but they are
 * real indexed reads of real Athena rows, not fixtures:
 *
 * - `fleet.stores`      the organization's stores; `region` is the store's
 *                       governing timezone, `health` is terminal reachability.
 * - `fleet.storeHealth`  one store's heartbeat coverage over the trailing week.
 * - `directory.teams`    operational role assignments across those stores.
 *
 * Health vocabulary, stated once so an answer can be read literally: a store is
 * `healthy` when a POS terminal reported within the live window, `degraded`
 * when the newest heartbeat is older than that but inside a day, and `offline`
 * when nothing has reported for longer than a day — including a store that has
 * never had a terminal report at all, which is the honest reading of "no
 * terminal is online".
 */
import type { Doc, Id } from "../../_generated/dataModel";
import type { QueryCtx } from "../../_generated/server";
import { mintAgentResourceRef, mintAgentSourceRef, pageOf, resolveAgentResourceRef } from "../../lib/agentCapabilitySupport";
import { defineAgentReadPortQuery } from "../../platform/operationAdmission";
import type { AgentReadPortHandler, AgentReadPortHandlerOutput } from "../readPorts";
import { known, unknown, type AgentSourceCompleteness } from "../../../shared/agentHarness/results";

/** Newest heartbeat at most this old means the store's terminals are live. */
const LIVE_HEARTBEAT_MS = 15 * 60 * 1000;
/** Newest heartbeat at most this old means degraded rather than offline. */
const DEGRADED_HEARTBEAT_MS = 24 * 60 * 60 * 1000;
/** Trailing window `uptimePercent` is measured over. */
const UPTIME_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const UPTIME_BUCKET_MS = 60 * 60 * 1000;
const UPTIME_BUCKETS = UPTIME_WINDOW_MS / UPTIME_BUCKET_MS;
/** Bounded sample read; saturating it reports the window as truncated, never as complete. */
const HEARTBEAT_SAMPLE_CAP = 400;
/** Bounded store read: the organization roster the surface pages through. */
const STORE_SCAN_CAP = 200;
/** Bounded role read per store. */
const ROLE_SCAN_CAP = 200;

const STORE_REF_KIND = "fleet_store";
const TEAM_REF_KIND = "directory_team";

type HealthBand = "healthy" | "degraded" | "offline";

function bandOf(newestReportedAt: number | undefined, now: number): HealthBand {
  if (newestReportedAt === undefined) return "offline";
  const age = now - newestReportedAt;
  if (age <= LIVE_HEARTBEAT_MS) return "healthy";
  if (age <= DEGRADED_HEARTBEAT_MS) return "degraded";
  return "offline";
}

async function listOrganizationStores(ctx: QueryCtx, organizationId: Id<"organization">): Promise<Doc<"store">[]> {
  return ctx.db
    .query("store")
    .withIndex("by_organizationId_slug", (q) => q.eq("organizationId", organizationId))
    .take(STORE_SCAN_CAP);
}

async function newestHeartbeatAt(ctx: QueryCtx, storeId: Id<"store">): Promise<number | undefined> {
  const newest = await ctx.db
    .query("posTerminalRuntimeStatus")
    .withIndex("by_store_reportedAt", (q) => q.eq("storeId", storeId))
    .order("desc")
    .take(1);
  return newest[0]?.reportedAt;
}

/** The store's governing timezone, used as the surface's region label. */
async function regionOf(ctx: QueryCtx, storeId: Id<"store">, now: number): Promise<string> {
  const versions = await ctx.db
    .query("storeTimezoneVersion")
    .withIndex("by_storeId_effectiveFrom", (q) => q.eq("storeId", storeId).lte("effectiveFrom", now))
    .order("desc")
    .take(1);
  return versions[0]?.timezone ?? "unassigned";
}

// ---------------------------------------------------------------------------
// fleet.stores
// ---------------------------------------------------------------------------

export const listStoresHandler: AgentReadPortHandler = async (ctx, input): Promise<AgentReadPortHandlerOutput> => {
  const organizationId = input.scope.organizationId as Id<"organization"> | undefined;
  if (!organizationId) {
    return { kind: "unavailable", reason: "organization_scope_missing", retryable: false, sourceKey: "pages" };
  }
  const stores = await listOrganizationStores(ctx, organizationId);
  const ordered = [...stores].sort((left, right) => (left.slug < right.slug ? -1 : left.slug > right.slug ? 1 : 0));

  const requestedRegion = typeof input.args.region === "string" ? input.args.region : undefined;
  const requestedHealth = typeof input.args.health === "string" ? (input.args.health as HealthBand) : undefined;

  const described = [];
  for (const store of ordered) {
    const region = await regionOf(ctx, store._id, input.now);
    const health = bandOf(await newestHeartbeatAt(ctx, store._id), input.now);
    if (requestedRegion !== undefined && region !== requestedRegion) continue;
    if (requestedHealth !== undefined && health !== requestedHealth) continue;
    described.push({ store, region, health });
  }

  const page = pageOf(described, input.pageIndex * input.pageSize, input.pageSize);
  const rosterTruncated = stores.length === STORE_SCAN_CAP;
  const sources: AgentSourceCompleteness[] = [
    {
      sourceKey: "pages",
      status: page.hasMore || rosterTruncated ? "partial" : "complete",
      reason: rosterTruncated ? "store_roster_scan_bounded" : page.hasMore ? "more_pages_available" : undefined,
      capturedAt: input.now,
    },
  ];

  return {
    kind: "data",
    data: page.items.map(({ store, region, health }) => ({
      storeRef: mintAgentResourceRef(STORE_REF_KIND, String(organizationId), String(store._id)),
      name: store.name,
      region,
      health,
    })),
    observedAt: input.now,
    freshness: { class: "live", authority: "live_read" },
    sources,
    warnings: rosterTruncated
      ? [
          {
            code: "store_roster_bounded",
            message: "Only the first stores of the organization were read; the roster is reported as partial.",
            sourceKey: "pages",
          },
        ]
      : [],
    sourceRefs: page.items.map(({ store }) => ({
      ref: mintAgentSourceRef(STORE_REF_KIND, String(organizationId), String(store._id)),
      kind: STORE_REF_KIND,
      label: store.name,
      capturedAt: input.now,
    })),
    page: { hasMore: page.hasMore, rawCursor: page.rawCursor },
  };
};

// ---------------------------------------------------------------------------
// fleet.storeHealth
// ---------------------------------------------------------------------------

export const getStoreHealthHandler: AgentReadPortHandler = async (ctx, input): Promise<AgentReadPortHandlerOutput> => {
  const organizationId = input.scope.organizationId as Id<"organization"> | undefined;
  if (!organizationId) {
    return { kind: "unavailable", reason: "organization_scope_missing", retryable: false, sourceKey: "samples" };
  }
  const storeId = resolveAgentResourceRef(STORE_REF_KIND, String(organizationId), input.args.storeRef);
  const store = storeId ? await ctx.db.get("store", storeId as Id<"store">) : null;
  // A ref minted for another organization cannot be unmasked here, and a store
  // that belongs elsewhere is not this organization's to describe: both answer
  // as an absent snapshot rather than as a refusal that would confirm it exists.
  const inScope = store !== null && String(store.organizationId) === String(organizationId);

  const capturedSources: AgentSourceCompleteness[] = [];
  if (!inScope) {
    // Structurally absent, never zeroed: an empty snapshot whose sources are
    // both `unavailable`. A store this organization does not own answers
    // exactly like a store that does not exist, so the reference cannot be
    // used to confirm one.
    return {
      kind: "data",
      data: {},
      observedAt: input.now,
      freshness: { class: "derived", authority: "derived" },
      sources: [
        { sourceKey: "samples", status: "unavailable", reason: "store_not_in_organization", capturedAt: input.now },
        { sourceKey: "incidents", status: "unavailable", reason: "store_not_in_organization", capturedAt: input.now },
      ],
      warnings: [],
      sourceRefs: [],
    };
  }

  const windowStart = input.now - UPTIME_WINDOW_MS;
  const samples = await ctx.db
    .query("posTerminalRuntimeStatus")
    .withIndex("by_store_reportedAt", (q) => q.eq("storeId", store!._id).gte("reportedAt", windowStart))
    .order("desc")
    .take(HEARTBEAT_SAMPLE_CAP);
  const samplesTruncated = samples.length === HEARTBEAT_SAMPLE_CAP;

  const buckets = new Set<number>();
  let newestAlerts: Record<string, number> | undefined;
  let newestReportedAt: number | undefined;
  for (const sample of samples) {
    buckets.add(Math.floor((sample.reportedAt - windowStart) / UPTIME_BUCKET_MS));
    if (newestReportedAt === undefined || sample.reportedAt > newestReportedAt) {
      newestReportedAt = sample.reportedAt;
      newestAlerts = sample.healthAlerts;
    }
  }
  const uptimePercent = Math.round((buckets.size / UPTIME_BUCKETS) * 100);

  capturedSources.push({
    sourceKey: "samples",
    status: samplesTruncated ? "truncated" : samples.length === 0 ? "unavailable" : "complete",
    reason: samplesTruncated
      ? "heartbeat_sample_scan_bounded"
      : samples.length === 0
        ? "no_heartbeat_in_window"
        : undefined,
    capturedAt: input.now,
  });

  const alertNames = Object.keys(newestAlerts ?? {}).sort();
  capturedSources.push({
    sourceKey: "incidents",
    status: newestReportedAt === undefined ? "unavailable" : "complete",
    reason: newestReportedAt === undefined ? "no_heartbeat_in_window" : undefined,
    capturedAt: input.now,
  });

  const sourceRefs = [
    {
      ref: mintAgentSourceRef("health_sample_window", String(organizationId), `${store!._id}:${windowStart}`),
      kind: "health_sample_window",
      label: store!.name,
      version: String(buckets.size),
      capturedAt: input.now,
    },
  ];

  return {
    kind: "data",
    data: {
      storeRef: mintAgentResourceRef(STORE_REF_KIND, String(organizationId), String(store!._id)),
      uptimePercent,
      ...(alertNames.length > 0
        ? {
            lastIncidentRef: mintAgentSourceRef(
              "incident",
              String(organizationId),
              `${store!._id}:${newestReportedAt}`,
            ),
          }
        : {}),
      incidentNotes:
        alertNames.length > 0
          ? known(`Terminal health alerts on the newest heartbeat: ${alertNames.join(", ")}.`)
          : unknown("not_recorded"),
    },
    observedAt: input.now,
    freshness: { class: "derived", authority: "derived" },
    sources: capturedSources,
    warnings: samplesTruncated
      ? [
          {
            code: "heartbeat_window_bounded",
            message: "Only the newest heartbeats in the window were read; coverage is reported as truncated.",
            sourceKey: "samples",
          },
        ]
      : [],
    sourceRefs: alertNames.length > 0
      ? [
          ...sourceRefs,
          {
            ref: mintAgentSourceRef("incident", String(organizationId), `${store!._id}:${newestReportedAt}`),
            kind: "incident",
            label: alertNames.join(", "),
            capturedAt: input.now,
          },
        ]
      : sourceRefs,
  };
};

// ---------------------------------------------------------------------------
// directory.teams
// ---------------------------------------------------------------------------

/** The surface's three teams, each a closed set of operational roles. */
const TEAMS = [
  { key: "managers", name: "Managers", roles: ["manager"] },
  { key: "cashiers", name: "Cashiers", roles: ["cashier"] },
  { key: "support", name: "Support", roles: ["front_desk", "stylist", "technician"] },
] as const;

export const listTeamsHandler: AgentReadPortHandler = async (ctx, input): Promise<AgentReadPortHandlerOutput> => {
  const organizationId = input.scope.organizationId as Id<"organization"> | undefined;
  if (!organizationId) {
    return { kind: "unavailable", reason: "organization_scope_missing", retryable: false, sourceKey: "pages" };
  }
  const stores = await listOrganizationStores(ctx, organizationId);
  const requestedTeam = typeof input.args.role === "string" ? input.args.role : undefined;
  const teams = requestedTeam ? TEAMS.filter((team) => team.key === requestedTeam) : [...TEAMS];

  let scanTruncated = stores.length === STORE_SCAN_CAP;
  const counts = new Map<string, number>(teams.map((team) => [team.key, 0]));
  for (const store of stores) {
    for (const team of teams) {
      for (const role of team.roles) {
        const assignments = await ctx.db
          .query("staffRoleAssignment")
          .withIndex("by_storeId_role", (q) => q.eq("storeId", store._id).eq("role", role))
          .take(ROLE_SCAN_CAP);
        if (assignments.length === ROLE_SCAN_CAP) scanTruncated = true;
        counts.set(team.key, (counts.get(team.key) ?? 0) + assignments.filter((row) => row.status === "active").length);
      }
    }
  }

  const rows = teams.map((team) => ({
    teamRef: mintAgentResourceRef(TEAM_REF_KIND, String(organizationId), team.key),
    name: team.name,
    memberCount: counts.get(team.key) ?? 0,
  }));
  const page = pageOf(rows, input.pageIndex * input.pageSize, input.pageSize);

  return {
    kind: "data",
    data: page.items,
    observedAt: input.now,
    freshness: { class: "live", authority: "live_read" },
    sources: [
      {
        sourceKey: "pages",
        status: page.hasMore || scanTruncated ? "partial" : "complete",
        reason: scanTruncated ? "role_assignment_scan_bounded" : page.hasMore ? "more_pages_available" : undefined,
        capturedAt: input.now,
      },
    ],
    warnings: [],
    sourceRefs: page.items.map((row) => ({
      ref: mintAgentSourceRef(TEAM_REF_KIND, String(organizationId), row.name),
      kind: TEAM_REF_KIND,
      label: row.name,
      capturedAt: input.now,
    })),
    page: { hasMore: page.hasMore, rawCursor: page.rawCursor },
  };
};

export const listStores = defineAgentReadPortQuery({ portKey: "fleet.stores", handler: listStoresHandler });
export const getStoreHealth = defineAgentReadPortQuery({ portKey: "fleet.storeHealth", handler: getStoreHealthHandler });
export const listTeams = defineAgentReadPortQuery({ portKey: "directory.teams", handler: listTeamsHandler });
