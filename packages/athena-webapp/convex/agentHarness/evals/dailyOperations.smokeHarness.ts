/**
 * Direct-harness smoke composition for `daily_operations.v1` (V26-1267).
 *
 * Two-dot basename on purpose: never bundled, never linted as ingress.
 *
 * The plan's post-deploy smoke "invokes the harness contracts directly while
 * the profile remains disabled". The published profile is `unpublished`, and
 * `evaluateEnablement` denies an unpublished profile at every capability call —
 * that is exactly the gate the release enable flips. So the smoke composes its own admission
 * over the SAME real manifests, the SAME real handlers, the SAME real authority
 * ports, and the SAME kernel, differing in exactly two declared ways:
 *
 *   1. the profile it registers is the published profile with `lifecycle`
 *      flipped to `enabled`, so the smoke can run before the profile switch
 *      is flipped on for operators, and
 *   2. the read-port index names smoke function paths, because convex-test
 *      resolves function references by module path and the smoke wrappers live
 *      in this module.
 *
 * Nothing else is substituted: the manifests, extractors, handlers, projection
 * policy, budgets, and every kernel check are the production ones. The
 * production BINDING (port key → `internal.*` path) is asserted separately in
 * `dailyOperations.smoke.test.ts` against `agentReadPorts`.
 */
import { anyApi, type FunctionReference } from "convex/server";

import type { Id } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";
import { defineAgentProfile } from "../../../shared/agentHarness/profile";
import { defineAgentReadPort, type AgentReadPortIndex } from "../../../shared/agentHarness/readPort";
import { createNormalUserDelegatedAuthorityPort } from "../../operationAdmission/delegatedAuthority";
import { createSharedDemoDelegatedAuthorityPort } from "../../sharedDemo/delegatedAuthority";
import { createDelegatedAdmission } from "../delegatedAdmission";
import { buildCapabilitySchemaIndex, createAgentExecutorSeams, type AgentExecutorSeamRefs } from "../executorSeams";
import { markAgentRunRunningWithCtx } from "../lifecycle";
import { createAgentReadPortRegistry, type AgentReadPortInvocationBinding } from "../readPorts";
import { baselineEnablement, buildAgentCapabilityRegistry } from "../registry";
import {
  DAILY_OPERATIONS_MANIFESTS,
  DAILY_OPERATIONS_PROFILE,
  DAILY_OPERATIONS_PROFILE_ID,
} from "../profiles/dailyOperations";
import { DAILY_OPERATIONS_EVIDENCE_EXTRACTORS } from "../profiles/dailyOperationsConformance";
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
import { seedDailyOperationsStore, FIXTURE_NOW } from "./dailyOperations.fixture";

const SMOKE_MODULE = "agentHarness/evals/dailyOperationsSmokePorts";

/** Port key → the export name this module registers for it. */
const SMOKE_PORT_EXPORTS = {
  "operations.storeDay": "getStoreDay",
  "operations.attention": "listAttention",
  "operations.approvals": "listApprovals",
  "operations.activity": "listActivity",
  "reports.daySales": "getDaySales",
  "reports.weekPerformance": "getWeekPerformance",
  "reports.storePulse": "getStorePulse",
  "cash.registerSessions": "readRegisterSessions",
  "automation.dailyOperations": "listAutomationEvidence",
  "inventory.positions": "readPositions",
  "inventory.replenishment": "listReplenishment",
} as const;

export type SmokePortKey = keyof typeof SMOKE_PORT_EXPORTS;

/**
 * The published port index with every handler path rewritten to this module.
 * Everything else — capability, verbs, intents, cost, projections, source keys,
 * implementation version — is the published declaration, untouched.
 */
const SMOKE_READ_PORT_INDEX: AgentReadPortIndex = {
  contractVersion: 1,
  ports: DAILY_OPERATIONS_MANIFESTS.map((manifest) => {
    const portKey = manifest.binding.portKey as SmokePortKey;
    const verbs = (["get", "list"] as const).filter((verb) => manifest.operations[verb] !== undefined);
    return defineAgentReadPort({
      contractVersion: 1,
      portKey,
      capabilityId: manifest.capabilityId,
      verbs,
      scopeKind: manifest.scope.kind,
      readIntents: manifest.binding.readIntents,
      implementationVersion: manifest.binding.implementationVersion,
      declaredCost: manifest.cost.worstCasePerCall,
      handler: { kind: "internal_query", functionPath: `${SMOKE_MODULE}:${SMOKE_PORT_EXPORTS[portKey]}` },
      projections: Object.keys(manifest.projections),
      completenessSourceKeys: manifest.completeness.sourceKeys,
    });
  }),
};

/** The published profile, enabled so the smoke can run before the profile switch is flipped on. */
const SMOKE_PROFILE = defineAgentProfile({ ...DAILY_OPERATIONS_PROFILE, lifecycle: "enabled" });

const build = buildAgentCapabilityRegistry({
  manifests: DAILY_OPERATIONS_MANIFESTS,
  readPorts: SMOKE_READ_PORT_INDEX,
  profiles: [SMOKE_PROFILE],
  runtimeAdapter: { adapterKind: "athena_contract_fake", adapterVersion: "fake.1" },
  admissionPolicyVersion: "u8.smoke",
});
if (!build.ok) {
  throw new Error(`daily operations smoke registry failed to build: ${JSON.stringify(build.issues)}`);
}
export const SMOKE_REGISTRY = build.registry;

const SMOKE_ENABLEMENT = baselineEnablement(DAILY_OPERATIONS_MANIFESTS, [SMOKE_PROFILE]);

type SmokeQueryRef = FunctionReference<"query", "internal">;
const smokePortRef = (exportName: string) =>
  (anyApi as unknown as { agentHarness: { evals: { dailyOperationsSmokePorts: Record<string, SmokeQueryRef> } } })
    .agentHarness.evals.dailyOperationsSmokePorts[exportName];

const SMOKE_BINDINGS: readonly AgentReadPortInvocationBinding[] = (
  Object.entries(SMOKE_PORT_EXPORTS) as [SmokePortKey, string][]
).map(([portKey, exportName]) => ({ portKey, handler: smokePortRef(exportName) }));

export const SMOKE_READ_PORTS = createAgentReadPortRegistry({
  registry: SMOKE_REGISTRY,
  bindings: SMOKE_BINDINGS,
});

export const SMOKE_CLOCK = { now: FIXTURE_NOW };

export const SMOKE_ADMISSION = createDelegatedAdmission({
  registry: SMOKE_REGISTRY,
  readPorts: SMOKE_READ_PORTS,
  authorityPorts: {
    normal_user: createNormalUserDelegatedAuthorityPort(),
    shared_demo: createSharedDemoDelegatedAuthorityPort({
      environment: { ATHENA_SHARED_DEMO_ENABLED: "false", STAGE: "dev" },
    }),
  },
  resolveEnablement: async () => SMOKE_ENABLEMENT,
  now: () => SMOKE_CLOCK.now,
});

export const SMOKE_SCHEMAS = buildCapabilitySchemaIndex(DAILY_OPERATIONS_MANIFESTS);

export const SMOKE_SEAMS = createAgentExecutorSeams({
  admission: SMOKE_ADMISSION,
  schemas: SMOKE_SCHEMAS,
  resolveEvidenceExtractor: (capabilityId) => DAILY_OPERATIONS_EVIDENCE_EXTRACTORS[capabilityId],
});

// --- port queries: the published handlers, bound to the smoke admission ------

const definePort = SMOKE_ADMISSION.defineAgentReadPortQuery;

export const getStoreDay = definePort({ portKey: "operations.storeDay", handler: getStoreDayHandler });
export const listAttention = definePort({ portKey: "operations.attention", handler: listAttentionHandler });
export const listApprovals = definePort({ portKey: "operations.approvals", handler: listApprovalsHandler });
export const listActivity = definePort({ portKey: "operations.activity", handler: listActivityHandler });
export const getDaySales = definePort({ portKey: "reports.daySales", handler: getDaySalesHandler });
export const getWeekPerformance = definePort({
  portKey: "reports.weekPerformance",
  handler: getWeekPerformanceHandler,
});
export const getStorePulse = definePort({ portKey: "reports.storePulse", handler: getStorePulseHandler });
export const readRegisterSessions = definePort({
  portKey: "cash.registerSessions",
  handler: readRegisterSessionsHandler,
});
export const listAutomationEvidence = definePort({
  portKey: "automation.dailyOperations",
  handler: listAutomationEvidenceHandler,
});
export const readPositions = definePort({ portKey: "inventory.positions", handler: readPositionsHandler });
export const listReplenishment = definePort({
  portKey: "inventory.replenishment",
  handler: listReplenishmentHandler,
});

// --- executor seams ---------------------------------------------------------

export const prepareAttempt = SMOKE_SEAMS.functions.prepareAttempt;
export const beginAttempt = SMOKE_SEAMS.functions.beginAttempt;
export const reserveAndAdmitCall = SMOKE_SEAMS.functions.reserveAndAdmitCall;
export const settleCall = SMOKE_SEAMS.functions.settleCall;
export const finishAttempt = SMOKE_SEAMS.functions.finishAttempt;
export const completeRun = SMOKE_SEAMS.functions.completeRun;
export const heartbeatAttempt = SMOKE_SEAMS.functions.heartbeatAttempt;
export const loadAttemptReplayInputs = SMOKE_SEAMS.functions.loadAttemptReplayInputs;

const seamRefs = (
  anyApi as unknown as { agentHarness: { evals: { dailyOperationsSmokePorts: Record<string, unknown> } } }
).agentHarness.evals.dailyOperationsSmokePorts;

export const SMOKE_SEAM_REFS: AgentExecutorSeamRefs = {
  prepareAttempt: seamRefs.prepareAttempt as AgentExecutorSeamRefs["prepareAttempt"],
  beginAttempt: seamRefs.beginAttempt as AgentExecutorSeamRefs["beginAttempt"],
  reserveAndAdmitCall: seamRefs.reserveAndAdmitCall as AgentExecutorSeamRefs["reserveAndAdmitCall"],
  settleCall: seamRefs.settleCall as AgentExecutorSeamRefs["settleCall"],
  finishAttempt: seamRefs.finishAttempt as AgentExecutorSeamRefs["finishAttempt"],
  heartbeatAttempt: seamRefs.heartbeatAttempt as AgentExecutorSeamRefs["heartbeatAttempt"],
  loadAttemptReplayInputs: seamRefs.loadAttemptReplayInputs as AgentExecutorSeamRefs["loadAttemptReplayInputs"],
};

// --- seeding ---------------------------------------------------------------

export type SmokeRun = {
  readonly runId: Id<"intelligenceRun">;
  readonly grantId: Id<"agentRunGrant">;
  readonly storeId: Id<"store">;
  readonly fixture: Awaited<ReturnType<typeof seedDailyOperationsStore>>;
};

/** Seed the fixture store and a running delegated run for one operator role. */
export async function seedSmokeRun(
  ctx: MutationCtx,
  options: {
    slug?: string;
    role?: "full_admin" | "pos_only";
    operationalRoles?: ("manager" | "cashier")[];
    withSchedule?: boolean;
    key?: string;
  } = {},
): Promise<SmokeRun> {
  const fixture = await seedDailyOperationsStore(ctx, options);
  const materialized = await SMOKE_ADMISSION.materializeRunGrantWithCtx(ctx, {
    operator: { kind: "normal_user", athenaUserId: fixture.userId },
    profileId: DAILY_OPERATIONS_PROFILE_ID,
    organizationId: fixture.organizationId,
    storeId: fixture.storeId,
    promptPayloadHash: "sha256:smoke",
    runIdempotencyKey: options.key ?? `smoke-${options.slug ?? "daily-ops"}`,
    now: SMOKE_CLOCK.now,
  });
  if (materialized.kind !== "materialized") throw new Error(JSON.stringify(materialized));
  await markAgentRunRunningWithCtx(ctx, { runId: materialized.runId, now: SMOKE_CLOCK.now });
  return {
    runId: materialized.runId,
    grantId: materialized.grantId,
    storeId: fixture.storeId,
    fixture,
  };
}
