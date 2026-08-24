/**
 * Direct harness: the release smoke's way into the published contracts while
 * every operator-facing switch stays off.
 *
 * The rollout sequence is "deploy, smoke while the profile is switched off,
 * then enable broadly with one reversible switch". The smoke therefore cannot
 * go through an operator turn — and it cannot go through the production
 * enablement overlay either, because that overlay is default-off and denies
 * every capability call for a switched-off profile — and neither can a
 * production port query, which reauthorizes through that same overlay inside
 * its own transaction. So this module composes a second delegated admission
 * over EXACTLY the production parts:
 *
 *   - the registered manifests, budgets, projections, and profile policy,
 *   - the same domain read handlers, wrapped by the same kernel port query,
 *   - the composition root's authority ports (same membership re-derivation),
 *   - the composition root's evidence extractors,
 *
 * differing in exactly two declared ways, both of them the point:
 *
 *   1. every published profile is registered `enabled`, so a
 *      published-but-switched-off profile is reachable here and nowhere else;
 *   2. the read-port index names this module's wrappers, because a Convex
 *      function reference resolves by module path and the wrappers must carry
 *      the harness admission rather than the production one.
 *
 * Every CAPABILITY kill switch is still read live from the durable overlay, so
 * disabling a capability clamps the smoke exactly as it clamps an operator —
 * which is how the release smoke proves the kill switch on the deployment
 * rather than against mutable module state a Convex isolate is free to discard.
 * The production port BINDINGS are proven separately, against `agentReadPorts`.
 *
 * Nothing here can release an answer: there is no turn binding, no completion
 * outbox, and no operator-visible artifact path — only run creation, program
 * attempts, capability calls, and completion into an Athena artifact.
 */
import { v } from "convex/values";

import { internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import { internalMutation, internalQuery, type MutationCtx, type QueryCtx } from "../../_generated/server";
import { resolveAgentEvidenceExtractor } from "../../platform/operationAdmission";
import { createNormalUserDelegatedAuthorityPort } from "../../operationAdmission/delegatedAuthority";
import { createSharedDemoDelegatedAuthorityPort } from "../../sharedDemo/delegatedAuthority";
import { defineAgentProfile } from "../../../shared/agentHarness/profile";
import { defineAgentReadPort, type AgentReadPortIndex } from "../../../shared/agentHarness/readPort";
import { AGENT_GENERATED_REGISTRY } from "../_generated/registry";
import { createDelegatedAdmission } from "../delegatedAdmission";
import { createAgentExecutorSeams, type AgentExecutorSeamRefs } from "../executorSeams";
import { resolveDurableEnablementWithCtx } from "../deploymentState";
import { cancelAgentRunWithCtx, markAgentRunRunningWithCtx } from "../lifecycle";
import {
  AGENT_ADMISSION_POLICY_VERSION,
  AGENT_MANIFEST_REGISTRATIONS,
  AGENT_SELECTED_RUNTIME_ADAPTER,
  mergeManifestRegistrations,
} from "../manifestRegistrations";
import {
  createAgentReadPortRegistry,
  type AgentReadPortInvocationBinding,
} from "../readPorts";
import { buildAgentCapabilityRegistry, evaluateEnablement, type AgentEnablementOverlay } from "../registry";
import { agentTurnEntryPoints } from "../turns";
import { pageTurnTraceByBindingWithCtx, takeRecentTurnTraceEventsWithCtx } from "../turnTrace";
import { listAutomationEvidenceHandler } from "../../automation/agentCapabilities/evidencePorts";
import { readRegisterSessionsHandler } from "../../cashControls/agentCapabilities/registersPorts";
import { listActivityHandler } from "../../operations/agentCapabilities/activityPorts";
import { getStoreDayHandler } from "../../operations/agentCapabilities/storeDayPorts";
import { listApprovalsHandler, listAttentionHandler } from "../../operations/agentCapabilities/workPorts";
import {
  getDaySalesHandler,
  getStorePulseHandler,
  getWeekPerformanceHandler,
} from "../../reports/agentCapabilities/salesPorts";
import {
  listReplenishmentHandler,
  readPositionsHandler,
} from "../../stockOps/agentCapabilities/inventoryPorts";
import {
  getStoreHealthHandler,
  listStoresHandler,
  listTeamsHandler,
} from "../profiles/syntheticSecondSurfacePorts";

const DIRECT_HARNESS_MODULE = "agentHarness/evals/directHarness";

/** Port key → the wrapper this module exports for it. */
const PORT_EXPORTS = {
  "operations.storeDay": "portStoreDay",
  "operations.attention": "portAttention",
  "operations.approvals": "portApprovals",
  "operations.activity": "portActivity",
  "reports.daySales": "portDaySales",
  "reports.weekPerformance": "portWeekPerformance",
  "reports.storePulse": "portStorePulse",
  "cash.registerSessions": "portRegisterSessions",
  "automation.dailyOperations": "portAutomation",
  "inventory.positions": "portPositions",
  "inventory.replenishment": "portReplenishment",
  "fleet.stores": "portFleetStores",
  "fleet.storeHealth": "portFleetStoreHealth",
  "directory.teams": "portDirectoryTeams",
} as const;

type DirectHarnessPortKey = keyof typeof PORT_EXPORTS;

const registrations = mergeManifestRegistrations(AGENT_MANIFEST_REGISTRATIONS);

/**
 * The published port index with every handler path rewritten to this module.
 * Capability, verbs, intents, scope, cost, projections, completeness source
 * keys, and implementation version are the published declarations, untouched.
 */
const DIRECT_HARNESS_PORT_INDEX: AgentReadPortIndex = {
  contractVersion: 1,
  ports: registrations.readPorts.ports.map((port) =>
    defineAgentReadPort({
      ...port,
      handler: {
        kind: "internal_query",
        functionPath: `${DIRECT_HARNESS_MODULE}:${PORT_EXPORTS[port.portKey as DirectHarnessPortKey]}`,
      },
    }),
  ),
};

/** Every published profile, registered `enabled` so the smoke can reach it. */
const DIRECT_HARNESS_PROFILES = registrations.profiles.map((profile) =>
  defineAgentProfile({ ...profile, lifecycle: "enabled" }),
);

const build = buildAgentCapabilityRegistry({
  manifests: registrations.manifests,
  readPorts: DIRECT_HARNESS_PORT_INDEX,
  profiles: DIRECT_HARNESS_PROFILES,
  runtimeAdapter: AGENT_SELECTED_RUNTIME_ADAPTER,
  admissionPolicyVersion: AGENT_ADMISSION_POLICY_VERSION,
});
if (!build.ok) {
  throw new Error(`direct harness registry failed to build: ${JSON.stringify(build.issues)}`);
}

export const DIRECT_HARNESS_REGISTRY = build.registry;

/** The published baseline: what MAY be enabled, before the durable switch narrows it. */
const PUBLISHED_BASELINE: AgentEnablementOverlay = AGENT_GENERATED_REGISTRY.enablement;

/**
 * Named one by one rather than resolved from a table: the admission checker
 * reads `internal.<module>.<export>` references literally, and a function
 * reference built by indexing the api root is indistinguishable from an
 * unadmitted ingress call.
 */
const PORT_BINDINGS: readonly AgentReadPortInvocationBinding[] = [
  { portKey: "operations.storeDay", handler: internal.agentHarness.evals.directHarness.portStoreDay },
  { portKey: "operations.attention", handler: internal.agentHarness.evals.directHarness.portAttention },
  { portKey: "operations.approvals", handler: internal.agentHarness.evals.directHarness.portApprovals },
  { portKey: "operations.activity", handler: internal.agentHarness.evals.directHarness.portActivity },
  { portKey: "reports.daySales", handler: internal.agentHarness.evals.directHarness.portDaySales },
  { portKey: "reports.weekPerformance", handler: internal.agentHarness.evals.directHarness.portWeekPerformance },
  { portKey: "reports.storePulse", handler: internal.agentHarness.evals.directHarness.portStorePulse },
  { portKey: "cash.registerSessions", handler: internal.agentHarness.evals.directHarness.portRegisterSessions },
  { portKey: "automation.dailyOperations", handler: internal.agentHarness.evals.directHarness.portAutomation },
  { portKey: "inventory.positions", handler: internal.agentHarness.evals.directHarness.portPositions },
  { portKey: "inventory.replenishment", handler: internal.agentHarness.evals.directHarness.portReplenishment },
  { portKey: "fleet.stores", handler: internal.agentHarness.evals.directHarness.portFleetStores },
  { portKey: "fleet.storeHealth", handler: internal.agentHarness.evals.directHarness.portFleetStoreHealth },
  { portKey: "directory.teams", handler: internal.agentHarness.evals.directHarness.portDirectoryTeams },
];

export const DIRECT_HARNESS_READ_PORTS = createAgentReadPortRegistry({
  registry: DIRECT_HARNESS_REGISTRY,
  bindings: PORT_BINDINGS,
});

export const DIRECT_HARNESS_ADMISSION = createDelegatedAdmission({
  registry: DIRECT_HARNESS_REGISTRY,
  readPorts: DIRECT_HARNESS_READ_PORTS,
  authorityPorts: {
    normal_user: createNormalUserDelegatedAuthorityPort(),
    shared_demo: createSharedDemoDelegatedAuthorityPort(),
  },
  resolveEnablement: async (ctx) => {
    const live = await resolveDurableEnablementWithCtx(ctx, PUBLISHED_BASELINE);
    return {
      capabilities: live.capabilities,
      profiles: DIRECT_HARNESS_REGISTRY.enablement.profiles,
    };
  },
});

const definePort = DIRECT_HARNESS_ADMISSION.defineAgentReadPortQuery;

export const portStoreDay = definePort({ portKey: "operations.storeDay", handler: getStoreDayHandler });
export const portAttention = definePort({ portKey: "operations.attention", handler: listAttentionHandler });
export const portApprovals = definePort({ portKey: "operations.approvals", handler: listApprovalsHandler });
export const portActivity = definePort({ portKey: "operations.activity", handler: listActivityHandler });
export const portDaySales = definePort({ portKey: "reports.daySales", handler: getDaySalesHandler });
export const portWeekPerformance = definePort({ portKey: "reports.weekPerformance", handler: getWeekPerformanceHandler });
export const portStorePulse = definePort({ portKey: "reports.storePulse", handler: getStorePulseHandler });
export const portRegisterSessions = definePort({ portKey: "cash.registerSessions", handler: readRegisterSessionsHandler });
export const portAutomation = definePort({ portKey: "automation.dailyOperations", handler: listAutomationEvidenceHandler });
export const portPositions = definePort({ portKey: "inventory.positions", handler: readPositionsHandler });
export const portReplenishment = definePort({ portKey: "inventory.replenishment", handler: listReplenishmentHandler });
export const portFleetStores = definePort({ portKey: "fleet.stores", handler: listStoresHandler });
export const portFleetStoreHealth = definePort({ portKey: "fleet.storeHealth", handler: getStoreHealthHandler });
export const portDirectoryTeams = definePort({ portKey: "directory.teams", handler: listTeamsHandler });

export const DIRECT_HARNESS_SEAMS = createAgentExecutorSeams({
  admission: DIRECT_HARNESS_ADMISSION,
  resolveEvidenceExtractor: resolveAgentEvidenceExtractor,
});

export const prepareAttempt = DIRECT_HARNESS_SEAMS.functions.prepareAttempt;
export const beginAttempt = DIRECT_HARNESS_SEAMS.functions.beginAttempt;
export const reserveAndAdmitCall = DIRECT_HARNESS_SEAMS.functions.reserveAndAdmitCall;
export const settleCall = DIRECT_HARNESS_SEAMS.functions.settleCall;
export const finishAttempt = DIRECT_HARNESS_SEAMS.functions.finishAttempt;
export const completeRun = DIRECT_HARNESS_SEAMS.functions.completeRun;
export const heartbeatAttempt = DIRECT_HARNESS_SEAMS.functions.heartbeatAttempt;
export const loadAttemptReplayInputs = DIRECT_HARNESS_SEAMS.functions.loadAttemptReplayInputs;
export const recordScratch = DIRECT_HARNESS_SEAMS.functions.recordScratch;

export const DIRECT_HARNESS_SEAM_REFS: AgentExecutorSeamRefs = {
  prepareAttempt: internal.agentHarness.evals.directHarness.prepareAttempt as unknown as AgentExecutorSeamRefs["prepareAttempt"],
  beginAttempt: internal.agentHarness.evals.directHarness.beginAttempt as unknown as AgentExecutorSeamRefs["beginAttempt"],
  reserveAndAdmitCall: internal.agentHarness.evals.directHarness.reserveAndAdmitCall as unknown as AgentExecutorSeamRefs["reserveAndAdmitCall"],
  settleCall: internal.agentHarness.evals.directHarness.settleCall as unknown as AgentExecutorSeamRefs["settleCall"],
  finishAttempt: internal.agentHarness.evals.directHarness.finishAttempt as unknown as AgentExecutorSeamRefs["finishAttempt"],
  heartbeatAttempt: internal.agentHarness.evals.directHarness.heartbeatAttempt as unknown as AgentExecutorSeamRefs["heartbeatAttempt"],
  loadAttemptReplayInputs: internal.agentHarness.evals.directHarness.loadAttemptReplayInputs as unknown as AgentExecutorSeamRefs["loadAttemptReplayInputs"],
};

export type DirectHarnessRun = {
  readonly runId: Id<"intelligenceRun">;
  readonly grantId: Id<"agentRunGrant">;
  readonly capabilityIds: readonly string[];
};

export type DirectHarnessRunInput = {
  readonly profileId: string;
  readonly athenaUserId: Id<"athenaUser">;
  readonly organizationId: Id<"organization">;
  /** Authority is always anchored to a store the operator holds, even for an organization-scoped profile. */
  readonly storeId: Id<"store">;
  readonly runIdempotencyKey: string;
  readonly now: number;
};

export type DirectHarnessRunOutcome =
  | ({ readonly kind: "running" } & DirectHarnessRun)
  | { readonly kind: "refused"; readonly stage: string; readonly reason: string; readonly message: string };

/**
 * Materialize a delegated grant and mark the run running, with no turn binding
 * and no prompt: the smoke is not an operator turn and can never release an
 * answer to one.
 */
export async function startDirectHarnessRunWithCtx(
  ctx: MutationCtx,
  input: DirectHarnessRunInput,
): Promise<DirectHarnessRunOutcome> {
  const materialized = await DIRECT_HARNESS_ADMISSION.materializeRunGrantWithCtx(ctx, {
    operator: { kind: "normal_user", athenaUserId: input.athenaUserId },
    profileId: input.profileId,
    organizationId: input.organizationId,
    storeId: input.storeId,
    promptPayloadHash: `sha256:direct-harness:${input.runIdempotencyKey}`,
    runIdempotencyKey: input.runIdempotencyKey,
    now: input.now,
  });
  if (materialized.kind !== "materialized") {
    return {
      kind: "refused",
      stage: materialized.stage,
      reason: materialized.reason,
      message: materialized.message,
    };
  }
  await markAgentRunRunningWithCtx(ctx, { runId: materialized.runId, now: input.now });
  return {
    kind: "running",
    runId: materialized.runId,
    grantId: materialized.grantId,
    capabilityIds: [...materialized.runtimeGrant.capabilityIds],
  };
}

// ---------------------------------------------------------------------------
// Registered functions the deployed smoke driver calls
// ---------------------------------------------------------------------------

export const readCitationEvidence = DIRECT_HARNESS_SEAMS.functions.readCitationEvidence;

/**
 * Resolve the smoke's target from human-readable identifiers, so the deployed
 * command names an organization slug, a store slug, and an operator email
 * rather than raw document ids.
 */
export const resolveTarget = internalQuery({
  args: {
    organizationSlug: v.string(),
    storeSlug: v.string(),
    operatorEmail: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const organization = await ctx.db
      .query("organization")
      .withIndex("by_slug", (q) => q.eq("slug", args.organizationSlug))
      .unique();
    if (!organization) return { kind: "not_found", missing: "organization" };
    const store = await ctx.db
      .query("store")
      .withIndex("by_organizationId_slug", (q) =>
        q.eq("organizationId", organization._id).eq("slug", args.storeSlug),
      )
      .unique();
    if (!store) return { kind: "not_found", missing: "store" };
    const operator = await ctx.db
      .query("athenaUser")
      .withIndex("by_normalizedEmail", (q) => q.eq("normalizedEmail", args.operatorEmail.trim().toLowerCase()))
      .unique();
    if (!operator) return { kind: "not_found", missing: "operator" };
    const membership = await ctx.db
      .query("organizationMember")
      .withIndex("by_organizationId_userId", (q) =>
        q.eq("organizationId", organization._id).eq("userId", operator._id),
      )
      .first();
    if (!membership) return { kind: "not_found", missing: "membership" };
    return {
      kind: "resolved",
      organizationId: organization._id,
      storeId: store._id,
      athenaUserId: operator._id,
      storeName: store.name,
      membershipRole: membership.role,
      operationalRoles: membership.operationalRoles ?? [],
    };
  },
});

/**
 * Terminalize a smoke run. The direct harness must not leave runs `running`:
 * an operator has a small active-run limit, and a smoke that squatted on it
 * would deny the first real turn.
 */
export const finishRun = internalMutation({
  args: { runId: v.id("intelligenceRun"), reason: v.optional(v.string()), now: v.optional(v.number()) },
  returns: v.any(),
  handler: async (ctx, args) =>
    cancelAgentRunWithCtx(ctx, {
      runId: args.runId,
      idempotencyKey: `direct-harness-finished:${args.runId}`,
      reason: args.reason ?? "direct_harness_complete",
      now: args.now ?? Date.now(),
    }),
});

export const startRun = internalMutation({
  args: {
    profileId: v.string(),
    athenaUserId: v.id("athenaUser"),
    organizationId: v.id("organization"),
    storeId: v.id("store"),
    runIdempotencyKey: v.string(),
    now: v.optional(v.number()),
  },
  returns: v.any(),
  handler: async (ctx, args) =>
    startDirectHarnessRunWithCtx(ctx, { ...args, now: args.now ?? Date.now() }),
});

/**
 * What the PRODUCTION admission answers for this profile right now: the live
 * shrink-only overlay the operator rail consults, read through the same
 * durable switch. The smoke uses it to state plainly that operators are still
 * switched off while the direct harness is running.
 */
export const probeProductionEnablement = internalQuery({
  args: { profileId: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => {
    const live = await resolveDurableEnablementWithCtx(ctx, PUBLISHED_BASELINE);
    const verdict = evaluateEnablement(live, { profileId: args.profileId });
    return {
      profileId: args.profileId,
      published: PUBLISHED_BASELINE.profiles[args.profileId] ?? "unknown",
      effective: live.profiles[args.profileId] ?? "unknown",
      operatorsAdmitted: verdict.ok,
      deniedBecause: verdict.ok ? undefined : verdict.code,
    };
  },
});

/**
 * Which stores an operator can be smoked against, by slug. Exists so the
 * release runbook and the browser validation recipe name the same
 * organization/store slugs the deployment actually has, rather than guessing.
 */
export const describeSmokeTargets = internalQuery({
  args: { operatorEmail: v.string(), limit: v.optional(v.number()) },
  returns: v.any(),
  handler: async (ctx, args) => {
    const operator = await ctx.db
      .query("athenaUser")
      .withIndex("by_normalizedEmail", (q) => q.eq("normalizedEmail", args.operatorEmail.trim().toLowerCase()))
      .unique();
    if (!operator) return { kind: "not_found", missing: "operator" };
    const memberships = await ctx.db
      .query("organizationMember")
      .withIndex("by_userId", (q) => q.eq("userId", operator._id))
      .take(Math.min(20, Math.max(1, args.limit ?? 10)));
    const organizations = [];
    for (const membership of memberships) {
      const organization = await ctx.db.get("organization", membership.organizationId);
      if (!organization) continue;
      const stores = await ctx.db
        .query("store")
        .withIndex("by_organizationId_slug", (q) => q.eq("organizationId", organization._id))
        .take(10);
      organizations.push({
        organizationSlug: organization.slug,
        membershipRole: membership.role,
        operationalRoles: membership.operationalRoles ?? [],
        stores: stores.map((store) => ({ storeSlug: store.slug, storeName: store.name, currency: store.currency })),
      });
    }
    return { kind: "resolved", operatorEmail: args.operatorEmail, organizations };
  },
});

// ---------------------------------------------------------------------------
// Operator-turn driver (release verification only)
// ---------------------------------------------------------------------------

/**
 * The release runbook has to prove ONE real operator turn end to end on a
 * deployment before the profile is trusted, and a turn starts at a public
 * mutation whose actor the admission rail resolves from the caller's session.
 * A command-line runbook has no session, so this driver calls the SAME entry
 * points the public wrappers call, with the actor the rail would have
 * resolved — an operator who already holds membership in the organization that
 * owns the store, looked up here rather than supplied.
 *
 * It is internal (never ingress), it grants nothing the operator does not
 * already hold, and it refuses to run in production, where a real session is
 * always available.
 */
function assertDriverAllowed(): void {
  if (process.env.STAGE === "prod") {
    throw new Error("The operator-turn driver is a pre-release verification tool and is not available in production.");
  }
}

type DriverTarget = {
  readonly athenaUserId: Id<"athenaUser">;
  readonly storeId: Id<"store">;
};

async function resolveDriverTarget(
  ctx: QueryCtx,
  args: { organizationSlug: string; storeSlug: string; operatorEmail: string },
): Promise<DriverTarget | { readonly kind: "not_found"; readonly missing: string }> {
  const organization = await ctx.db
    .query("organization")
    .withIndex("by_slug", (q) => q.eq("slug", args.organizationSlug))
    .unique();
  if (!organization) return { kind: "not_found", missing: "organization" };
  const store = await ctx.db
    .query("store")
    .withIndex("by_organizationId_slug", (q) => q.eq("organizationId", organization._id).eq("slug", args.storeSlug))
    .unique();
  if (!store) return { kind: "not_found", missing: "store" };
  const operator = await ctx.db
    .query("athenaUser")
    .withIndex("by_normalizedEmail", (q) => q.eq("normalizedEmail", args.operatorEmail.trim().toLowerCase()))
    .unique();
  if (!operator) return { kind: "not_found", missing: "operator" };
  const membership = await ctx.db
    .query("organizationMember")
    .withIndex("by_organizationId_userId", (q) => q.eq("organizationId", organization._id).eq("userId", operator._id))
    .first();
  if (!membership) return { kind: "not_found", missing: "membership" };
  return { athenaUserId: operator._id, storeId: store._id };
}

const driverArgs = {
  organizationSlug: v.string(),
  storeSlug: v.string(),
  operatorEmail: v.string(),
};

export const startOperatorTurn = internalMutation({
  args: {
    ...driverArgs,
    profileId: v.string(),
    threadKey: v.string(),
    turnIdempotencyKey: v.string(),
    prompt: v.string(),
    context: v.optional(v.record(v.string(), v.string())),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    assertDriverAllowed();
    const target = await resolveDriverTarget(ctx, args);
    if ("kind" in target) return target;
    return agentTurnEntryPoints.startTurn(
      { ...ctx, operationAdmission: { actor: { kind: "normal_user", athenaUserId: target.athenaUserId } } } as never,
      {
        storeId: target.storeId,
        profileId: args.profileId,
        threadKey: args.threadKey,
        turnIdempotencyKey: args.turnIdempotencyKey,
        prompt: args.prompt,
        context: args.context,
      },
    );
  },
});

export const readOperatorTurn = internalQuery({
  args: { ...driverArgs, bindingId: v.id("agentTurnBinding"), include: v.optional(v.string()) },
  returns: v.any(),
  handler: async (ctx, args) => {
    assertDriverAllowed();
    const target = await resolveDriverTarget(ctx, args);
    if ("kind" in target) return target;
    const admitted = {
      ...ctx,
      operationAdmission: { actor: { kind: "normal_user", athenaUserId: target.athenaUserId } },
    } as never;
    const view = await agentTurnEntryPoints.getTurnView(admitted, {
      storeId: target.storeId,
      bindingId: args.bindingId,
    });
    if (args.include === "preview") {
      // The rollout's provisional-streaming check, on the admitted path: the
      // same ladder the browser reads, under the driver's resolved operator.
      const preview = await agentTurnEntryPoints.previewTurnNarrative(admitted, {
        storeId: target.storeId,
        bindingId: args.bindingId,
      });
      return { view, preview };
    }
    if (args.include === "trail") {
      // The committed turn's drafts on the same admitted path as the answer.
      const trail = await agentTurnEntryPoints.getTurnNarrativeTrail(admitted, {
        storeId: target.storeId,
        bindingId: args.bindingId,
      });
      return { view, trail };
    }
    if (args.include !== "answer") return view;
    const answer = await agentTurnEntryPoints.getTurnAnswer(admitted, {
      storeId: target.storeId,
      bindingId: args.bindingId,
    });
    return { view, answer };
  },
});

export const acknowledgeOperatorTurn = internalMutation({
  args: { ...driverArgs, bindingId: v.id("agentTurnBinding") },
  returns: v.any(),
  handler: async (ctx, args) => {
    assertDriverAllowed();
    const target = await resolveDriverTarget(ctx, args);
    if ("kind" in target) return target;
    return agentTurnEntryPoints.acknowledgeTurnAnswer(
      { ...ctx, operationAdmission: { actor: { kind: "normal_user", athenaUserId: target.athenaUserId } } } as never,
      { storeId: target.storeId, bindingId: args.bindingId },
    );
  },
});

export const inspectOperatorCitation = internalMutation({
  args: { ...driverArgs, bindingId: v.id("agentTurnBinding"), citationRef: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => {
    assertDriverAllowed();
    const target = await resolveDriverTarget(ctx, args);
    if ("kind" in target) return target;
    return agentTurnEntryPoints.inspectCitationEvidence(
      { ...ctx, operationAdmission: { actor: { kind: "normal_user", athenaUserId: target.athenaUserId } } } as never,
      { storeId: target.storeId, bindingId: args.bindingId, citationRef: args.citationRef },
    );
  },
});

/**
 * Compact, id-free investigation view of one run: what the model attempted,
 * what the validator said, which capabilities were read, and how the turn
 * ended. The operator surface deliberately shows none of this; an investigator
 * needs it, and printing it is cheaper than reading four tables by hand.
 */
export const describeRunDiagnostics = internalQuery({
  args: { runId: v.id("intelligenceRun"), limit: v.optional(v.number()) },
  returns: v.any(),
  handler: async (ctx, args) => {
    const limit = Math.min(50, Math.max(1, args.limit ?? 20));
    const run = await ctx.db.get("intelligenceRun", args.runId);
    if (!run) return { kind: "not_found" };
    const attempts = await ctx.db
      .query("agentProgramAttempt")
      .withIndex("by_runId_sequence", (q) => q.eq("runId", args.runId))
      .take(limit);
    const calls = await ctx.db
      .query("agentCapabilityCall")
      .withIndex("by_runId_sequence", (q) => q.eq("runId", args.runId))
      .take(limit * 4);
    const ledger = await ctx.db
      .query("agentBudgetLedger")
      .withIndex("by_runId", (q) => q.eq("runId", args.runId))
      .unique();
    // The authored program, while its short-lived payload lives: what the
    // model actually wrote is the first thing an investigator wants.
    const payloads = (
      await ctx.db
        .query("agentReplayPayload")
        .withIndex("by_runId", (q) => q.eq("runId", args.runId))
        .take(limit * 4)
    ).filter((payload) => payload.subjectKind === "program_source");
    return {
      kind: "diagnostics",
      run: { status: run.status, error: run.error, compatibilityEpoch: run.compatibilityEpoch },
      programs: payloads.map((payload) => {
        const content = payload.content as { authored?: unknown } | string | undefined;
        const authored = typeof content === "string" ? content : content?.authored;
        return typeof authored === "string" ? authored.slice(0, 2_000) : undefined;
      }),
      charged: ledger?.charged,
      attempts: attempts.map((attempt) => ({
        sequence: attempt.sequence,
        status: attempt.status,
        error: attempt.error,
        diagnostic: attempt.error?.diagnostic?.slice(0, 600),
        providerEgress: attempt.providerEgress?.state,
      })),
      calls: calls.map((call) => ({
        sequence: call.sequence,
        capability: call.capabilityId,
        status: call.status,
        error: call.error,
        refusal: call.delegation?.refusal,
      })),
    };
  },
});

/**
 * The engineer's "what did the model see" read: one driven turn's trace, in
 * order, page by page.
 *
 * This is the only read path onto `agentTurnTraceEvent`, and it lives here —
 * in the non-production driver module — on purpose: the trace holds the
 * model's narrative deltas and the exact arguments of every tool call, which
 * no operator surface may ever render. It is an internal query, so it is
 * reachable from `bunx convex run` and the export script and from nothing on
 * the ingress rail.
 *
 * Pass `bindingId` for one turn, or `runId` for the run's turn (one turn owns
 * one run). `cursor` continues a listing; `isDone` says when it is exhausted.
 */
export const listTurnTrace = internalQuery({
  args: {
    bindingId: v.optional(v.id("agentTurnBinding")),
    runId: v.optional(v.id("intelligenceRun")),
    cursor: v.optional(v.union(v.string(), v.null())),
    limit: v.optional(v.number()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const limit = Math.min(TURN_TRACE_PAGE_MAX, Math.max(1, args.limit ?? TURN_TRACE_PAGE_DEFAULT));
    if ((args.bindingId === undefined) === (args.runId === undefined)) {
      return { kind: "invalid_args", message: "Pass exactly one of bindingId or runId." };
    }
    const bindingId = args.bindingId ?? (await resolveTraceBinding(ctx, args.runId!));
    if (!bindingId) return { kind: "not_found", missing: "turn binding" };
    const page = await pageTurnTraceByBindingWithCtx(ctx, bindingId, { cursor: args.cursor ?? null, numItems: limit });
    return {
      kind: "trace",
      bindingId,
      isDone: page.isDone,
      cursor: page.continueCursor,
      events: page.page.map((row) => ({
        source: row.source,
        sequence: row.sequence,
        at: row.at,
        kind: row.kind,
        truncated: row.truncated,
        replayPayloadId: row.replayPayloadId,
        payload: row.payload,
      })),
    };
  },
});

const TURN_TRACE_PAGE_DEFAULT = 200;
const TURN_TRACE_PAGE_MAX = 1_000;

/** One turn owns one run, so the run's binding is the trace's binding. */
async function resolveTraceBinding(ctx: QueryCtx, runId: Id<"intelligenceRun">): Promise<Id<"agentTurnBinding"> | null> {
  const binding = await ctx.db
    .query("agentTurnBinding")
    .withIndex("by_runId", (q) => q.eq("runId", runId))
    .first();
  return binding?._id ?? null;
}

export const cancelOperatorTurn = internalMutation({
  args: { ...driverArgs, bindingId: v.id("agentTurnBinding") },
  returns: v.any(),
  handler: async (ctx, args) => {
    assertDriverAllowed();
    const target = await resolveDriverTarget(ctx, args);
    if ("kind" in target) return target;
    return agentTurnEntryPoints.cancelTurn(
      { ...ctx, operationAdmission: { actor: { kind: "normal_user", athenaUserId: target.athenaUserId } } } as never,
      { storeId: target.storeId, bindingId: args.bindingId },
    );
  },
});
