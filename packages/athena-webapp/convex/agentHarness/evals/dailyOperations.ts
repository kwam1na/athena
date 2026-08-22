"use node";
/**
 * The Daily Operations release smoke: a small deterministic matrix of
 * model-shaped programs run through the real sandbox, the real executor, and
 * the real read ports, with no operator turn and no released answer.
 *
 * It exists to be run twice: once here, under `convex-test` against a seeded
 * store (`dailyOperations.test.ts`), and once on the deployment through
 * `runSmoke` before the profile switch is flipped for operators. Both use the
 * same scenario definitions and the same structural checks, so "it passed on
 * the deployment" means the same thing as "it passed in the suite".
 *
 * Every check is structural, never value-exact: the matrix must be meaningful
 * on a seeded fixture and on a real store with whatever data it happens to
 * hold. Exact figures for the seeded fixture are asserted in the suite, next
 * to the fixture that produces them.
 */
import { v } from "convex/values";

import { internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import { internalAction } from "../../_generated/server";
import { AGENT_GENERATED_CAPABILITY_SCHEMAS } from "../_generated/schemas";
// eslint-disable-next-line @convex-dev/import-wrong-runtime -- this module carries the Node directive itself; the rule never inspects the importer's own runtime
import {
  createProgramExecutor,
  type AgentExecuteProgramResult,
  type AgentExecutorCtx,
  type AgentProgramExecutor,
} from "../executor";
// eslint-disable-next-line @convex-dev/import-wrong-runtime -- same: the sandbox is Node-only and so is this module
import { createQuickJsProgramRuntime } from "../programRuntime/quickJsRuntime";
import { DAILY_OPERATIONS_PROFILE_ID } from "../profiles/dailyOperations";
import { DIRECT_HARNESS_ADMISSION, DIRECT_HARNESS_SEAM_REFS } from "./directHarness";

// ---------------------------------------------------------------------------
// Scenario definitions
// ---------------------------------------------------------------------------

export const DAILY_OPERATIONS_SMOKE_SCENARIO_IDS = [
  "cross_package",
  "role_restricted",
  "partial_or_no_data",
  "cancellation",
  "citation_resolution",
  "kill_switch",
] as const;

export type DailyOperationsSmokeScenarioId = (typeof DAILY_OPERATIONS_SMOKE_SCENARIO_IDS)[number];

export type DailyOperationsSmokeDates = {
  /** The operating day the smoke asks about. */
  readonly operatingDate: string;
  /** A day before it, used to show mixed freshness across sources. */
  readonly priorOperatingDate: string;
  /** A day the store cannot have data for, used for the partial/no-data case. */
  readonly emptyOperatingDate: string;
};

/**
 * One question spanning five packages. It is the shape of a real operator
 * question ("what is holding up the close, and how does today compare") and it
 * is the case that proves cross-domain composition with one bounded program.
 */
export function crossPackageProgram(dates: DailyOperationsSmokeDates): string {
  return `
const day = await athena.operations.storeDay.get({ operatingDate: "${dates.operatingDate}" });
const registers = await athena.cash.registerSessions.list({ operatingDate: "${dates.operatingDate}" });
const attention = await athena.operations.attention.list({ operatingDate: "${dates.operatingDate}" });
const sales = await athena.reports.daySales.get({ operatingDate: "${dates.operatingDate}" });
const automation = await athena.automation.dailyOperations.list({ operatingDate: "${dates.operatingDate}" });
const stock = await athena.inventory.positions.list({ stockState: "low" });
const yesterday = await athena.reports.daySales.get({ operatingDate: "${dates.priorOperatingDate}" });
const results = [day, registers, attention, sales, automation, stock, yesterday];
const openRegisters = registers.kind === "result"
  ? registers.envelope.data.filter((session) => session.status === "open").length
  : -1;
const blocking = attention.kind === "result"
  ? attention.envelope.data.filter((item) => item.status === "blocking").length
  : -1;
return {
  readsAttempted: results.length,
  readsReleased: results.filter((entry) => entry.kind === "result").length,
  stage: day.kind === "result" ? day.envelope.data.lifecycleStage : "unavailable",
  openRegisters,
  blocking,
  transactions: sales.kind === "result" ? sales.envelope.data.transactionCount : -1,
  salesFreshness: sales.kind === "result" ? sales.envelope.freshness.class : "unavailable",
  yesterdayFreshness: yesterday.kind === "result" ? yesterday.envelope.freshness.class : "unavailable",
  automationActions: automation.kind === "result" ? automation.envelope.data.length : -1,
  lowStock: stock.kind === "result" ? stock.envelope.data.length : -1,
};
`;
}

/**
 * Only resources both a full admin and a POS-only operator hold, so the same
 * program runs for either and the DIFFERENCE is in the rows, not in whether it
 * runs. The program reports the union of keys it observed; the runner checks
 * every observed key against the manifest and the run's granted projections.
 */
export function roleRestrictedProgram(dates: DailyOperationsSmokeDates): string {
  return `
const registers = await athena.cash.registerSessions.list({ operatingDate: "${dates.operatingDate}" });
const positions = await athena.inventory.positions.list({});
const keysOf = (rows) => {
  const seen = {};
  for (const row of rows) {
    for (const key of Object.keys(row)) seen[key] = true;
  }
  return Object.keys(seen).sort();
};
const registerRows = registers.kind === "result" ? registers.envelope.data : [];
const positionRows = positions.kind === "result" ? positions.envelope.data : [];
return {
  registerOutcome: registers.kind,
  positionOutcome: positions.kind,
  registerCount: registerRows.length,
  positionCount: positionRows.length,
  registerKeys: keysOf(registerRows),
  positionKeys: keysOf(positionRows),
};
`;
}

/** A day the store cannot have data for: nothing may be invented for it. */
export function partialOrNoDataProgram(dates: DailyOperationsSmokeDates): string {
  return `
const sales = await athena.reports.daySales.get({ operatingDate: "${dates.emptyOperatingDate}" });
const attention = await athena.operations.attention.list({ operatingDate: "${dates.emptyOperatingDate}" });
return {
  salesOutcome: sales.kind,
  recordState: sales.kind === "result" ? sales.envelope.data.recordState : "unavailable",
  completeness: sales.kind === "result" ? sales.envelope.completeness.status : "unavailable",
  unavailableSources: sales.kind === "result"
    ? sales.envelope.completeness.sources.filter((source) => source.status === "unavailable").length
    : -1,
  attentionRows: attention.kind === "result" ? attention.envelope.data.length : -1,
};
`;
}

/** Two reads; the runner aborts as soon as the first port dispatch returns. */
export function cancellationProgram(dates: DailyOperationsSmokeDates): string {
  return `
const first = await athena.operations.attention.list({ operatingDate: "${dates.operatingDate}" });
const second = await athena.operations.storeDay.get({ operatingDate: "${dates.operatingDate}" });
return { first: first.kind, second: second.kind };
`;
}

/** One read of the capability the kill-switch scenario disables. */
export function killSwitchProgram(dates: DailyOperationsSmokeDates): string {
  return `
const attention = await athena.operations.attention.list({ operatingDate: "${dates.operatingDate}" });
return {
  outcome: attention.kind,
  code: attention.kind === "result" ? "released" : (attention.code ?? attention.reason ?? "unknown"),
};
`;
}

/** The capability the kill-switch scenario flips; both roles hold it. */
export const KILL_SWITCH_CAPABILITY_NAMESPACE = "operations.attention";

// ---------------------------------------------------------------------------
// Result shape
// ---------------------------------------------------------------------------

export type SmokeScenarioReport = {
  readonly id: DailyOperationsSmokeScenarioId;
  readonly ok: boolean;
  readonly findings: readonly string[];
  readonly detail: Record<string, unknown>;
};

export type DailyOperationsSmokeReport = {
  readonly profileId: string;
  readonly dates: DailyOperationsSmokeDates;
  readonly grant: { readonly capabilityIds: readonly string[]; readonly namespaces: readonly string[] };
  readonly production: Record<string, unknown>;
  readonly scenarios: readonly SmokeScenarioReport[];
  readonly ok: boolean;
  readonly elapsedMs: number;
};

function namespaceOf(capabilityId: string): string {
  return AGENT_GENERATED_CAPABILITY_SCHEMAS.summaries[capabilityId]?.namespace ?? capabilityId;
}

function declaredFieldsOf(namespace: string): readonly string[] {
  const capabilityId = AGENT_GENERATED_CAPABILITY_SCHEMAS.namespaceIndex[namespace];
  const declaration = capabilityId ? AGENT_GENERATED_CAPABILITY_SCHEMAS.declarations[capabilityId] : undefined;
  return declaration ? Object.keys(declaration.result.fields) : [];
}

function report(
  id: DailyOperationsSmokeScenarioId,
  findings: readonly string[],
  detail: Record<string, unknown>,
): SmokeScenarioReport {
  return { id, ok: findings.length === 0, findings, detail };
}

/** Compact, id-free view of an execution outcome, safe to print in a release log. */
function summarize(result: AgentExecuteProgramResult): Record<string, unknown> {
  if (result.outcome === "result") {
    return {
      outcome: result.outcome,
      output: result.result.output,
      calls: result.calls.map((call) => `${call.namespace}:${call.outcome}`),
      citations: result.citations.length,
      egressClass: result.result.egressClass,
      completeness: result.result.completeness.status,
      freshnessMixed: result.result.freshness.mixed,
      providerEgress: result.providerEgress.state,
      elapsedMs: result.diagnostics.elapsedMs,
      hostCalls: result.diagnostics.hostCalls,
    };
  }
  if (result.outcome === "rejected") return { outcome: result.outcome, issues: result.issues.map((issue) => issue.code) };
  if (result.outcome === "failed" || result.outcome === "canceled") {
    return {
      outcome: result.outcome,
      error: result.error.code,
      calls: result.calls.map((call) => `${call.namespace}:${call.outcome}`),
      hostCalls: result.diagnostics.hostCalls,
    };
  }
  if (result.outcome === "denied") return { outcome: result.outcome, code: result.code };
  if (result.outcome === "refused") return { outcome: result.outcome, stage: result.stage, reason: result.reason };
  return { outcome: result.outcome };
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

export type SmokeStartedRun = {
  readonly runId: Id<"intelligenceRun">;
  readonly capabilityIds: readonly string[];
};

export type SmokeRunnerDeps = {
  readonly ctx: AgentExecutorCtx;
  readonly executor: AgentProgramExecutor;
  /**
   * One delegated run per scenario. A run's attempt cap is a real budget, so
   * sharing one run across the matrix would exhaust it and report a budget
   * denial as a scenario failure.
   */
  readonly startRun: (key: string) => Promise<SmokeStartedRun>;
  /** Terminalize a smoke run so it does not hold an operator's active-run slot. */
  readonly finishRun: (runId: Id<"intelligenceRun">) => Promise<void>;
  /** Abort controller factory so the cancellation scenario is deterministic. */
  readonly makeCancellingExecutor: () => Promise<AgentProgramExecutor>;
  readonly setCapabilityEnablement: (capabilityId: string, state: "enabled" | "disabled") => Promise<void>;
  readonly completeRun: (input: {
    readonly runId: Id<"intelligenceRun">;
    readonly citedAttemptRefs: readonly string[];
    readonly citations: readonly { readonly ref: string }[];
    readonly payload: Record<string, unknown>;
  }) => Promise<Record<string, unknown>>;
  readonly readCitationEvidence: (input: {
    readonly runId: Id<"intelligenceRun">;
    readonly citationRef: string;
  }) => Promise<Record<string, unknown>>;
  readonly probeProductionEnablement: () => Promise<Record<string, unknown>>;
};

export type SmokeRunContext = {
  readonly dates: DailyOperationsSmokeDates;
  readonly keyPrefix: string;
};

export async function runDailyOperationsSmoke(
  deps: SmokeRunnerDeps,
  run: SmokeRunContext,
  only?: readonly DailyOperationsSmokeScenarioId[],
): Promise<DailyOperationsSmokeReport> {
  const startedAt = Date.now();
  const wanted = new Set<DailyOperationsSmokeScenarioId>(only ?? DAILY_OPERATIONS_SMOKE_SCENARIO_IDS);
  const scenarios: SmokeScenarioReport[] = [];
  let citedAttemptRef: string | undefined;
  let citationRef: string | undefined;
  let citationRunId: Id<"intelligenceRun"> | undefined;

  const startedRunIds: Id<"intelligenceRun">[] = [];
  const startRun = async (key: string) => {
    const started = await deps.startRun(key);
    startedRunIds.push(started.runId);
    return started;
  };

  const grant = await startRun(`${run.keyPrefix}:grant`);
  const namespaces = grant.capabilityIds.map(namespaceOf).sort();

  const execute = (
    runId: Id<"intelligenceRun">,
    key: string,
    source: string,
    executor?: AgentProgramExecutor,
  ) =>
    (executor ?? deps.executor).executeProgram(deps.ctx, {
      runId,
      attemptIdempotencyKey: `${run.keyPrefix}:${key}`,
      source,
    });

  // 1. cross-package composition
  if (wanted.has("cross_package")) {
    const scenarioRun = await startRun(`${run.keyPrefix}:cross`);
    const result = await execute(scenarioRun.runId, "cross", crossPackageProgram(run.dates));
    const findings: string[] = [];
    if (result.outcome !== "result") {
      findings.push(`cross-package program did not produce a result (${result.outcome})`);
    } else {
      const output = result.result.output as Record<string, unknown>;
      if (output.readsReleased !== output.readsAttempted) {
        findings.push(`only ${output.readsReleased}/${output.readsAttempted} reads were released`);
      }
      if (new Set(result.calls.map((call) => call.namespace.split(".")[0])).size < 5) {
        findings.push("fewer than five packages were composed");
      }
      if (result.citations.length === 0) findings.push("no citation was minted from released data");
      if (result.providerEgress.state !== "committed") findings.push("provider egress was not committed");
      citedAttemptRef = result.attemptRef;
      citationRef = result.citations[0]?.citation;
      citationRunId = scenarioRun.runId;
    }
    scenarios.push(report("cross_package", findings, summarize(result)));
  }

  // 2. role-restricted output
  if (wanted.has("role_restricted")) {
    const scenarioRun = await startRun(`${run.keyPrefix}:role`);
    const result = await execute(scenarioRun.runId, "role", roleRestrictedProgram(run.dates));
    const findings: string[] = [];
    const detail = summarize(result);
    if (result.outcome !== "result") {
      findings.push(`role-restricted program did not produce a result (${result.outcome})`);
    } else {
      const output = result.result.output as { registerKeys?: string[]; positionKeys?: string[] };
      for (const [namespace, keys] of [
        ["cash.registerSessions", output.registerKeys ?? []],
        ["inventory.positions", output.positionKeys ?? []],
      ] as const) {
        const declared = new Set(declaredFieldsOf(namespace));
        for (const key of keys) {
          if (!declared.has(key)) findings.push(`${namespace} returned an undeclared field ${key}`);
        }
      }
      detail.grantedCapabilities = scenarioRun.capabilityIds.map(namespaceOf).sort();
    }
    scenarios.push(report("role_restricted", findings, detail));
  }

  // 3. partial / no data
  if (wanted.has("partial_or_no_data")) {
    const scenarioRun = await startRun(`${run.keyPrefix}:nodata`);
    const result = await execute(scenarioRun.runId, "nodata", partialOrNoDataProgram(run.dates));
    const findings: string[] = [];
    if (result.outcome !== "result") {
      findings.push(`no-data program did not produce a result (${result.outcome})`);
    } else {
      const output = result.result.output as Record<string, unknown>;
      if (output.completeness === "complete") {
        findings.push("a day with no records was reported as complete");
      }
      if (result.result.completeness.status === "complete") {
        findings.push("the attempt inherited `complete` from partial inputs");
      }
    }
    scenarios.push(report("partial_or_no_data", findings, summarize(result)));
  }

  // 4. cancellation
  if (wanted.has("cancellation")) {
    const scenarioRun = await startRun(`${run.keyPrefix}:cancel`);
    const executor = await deps.makeCancellingExecutor();
    const result = await execute(scenarioRun.runId, "cancel", cancellationProgram(run.dates), executor);
    const findings: string[] = [];
    if (result.outcome !== "canceled" && result.outcome !== "failed") {
      findings.push(`cancellation did not terminate the attempt (${result.outcome})`);
    }
    scenarios.push(report("cancellation", findings, summarize(result)));
  }

  // 5. citation resolution
  if (wanted.has("citation_resolution")) {
    const findings: string[] = [];
    const detail: Record<string, unknown> = {};
    if (!citedAttemptRef || !citationRef || !citationRunId) {
      findings.push("no citation was available to resolve (the cross-package scenario must run first)");
    } else {
      const completion = await deps.completeRun({
        runId: citationRunId,
        citedAttemptRefs: [citedAttemptRef],
        citations: [{ ref: citationRef }],
        payload: { headline: "release smoke", scenario: "citation_resolution" },
      });
      detail.completion = completion.outcome;
      if (completion.outcome !== "completed") findings.push(`completion refused: ${JSON.stringify(completion).slice(0, 300)}`);
      const grounded = await deps.readCitationEvidence({ runId: citationRunId, citationRef });
      detail.grounded = grounded.kind;
      detail.groundedState = grounded.state;
      if (grounded.kind !== "evidence") findings.push(`a grounded citation did not resolve (${grounded.kind})`);
      const forged = await deps.readCitationEvidence({
        runId: citationRunId,
        citationRef: `${citationRef}0`,
      });
      detail.forged = forged.kind;
      if (forged.kind === "evidence") findings.push("a forged citation resolved to evidence");
    }
    scenarios.push(report("citation_resolution", findings, detail));
  }

  // 6. kill switch
  if (wanted.has("kill_switch")) {
    const findings: string[] = [];
    const detail: Record<string, unknown> = {};
    const scenarioRun = await startRun(`${run.keyPrefix}:kill`);
    const capabilityId = scenarioRun.capabilityIds.find(
      (id) => namespaceOf(id) === KILL_SWITCH_CAPABILITY_NAMESPACE,
    );
    detail.production = await deps.probeProductionEnablement();
    if (!capabilityId) {
      findings.push(`${KILL_SWITCH_CAPABILITY_NAMESPACE} is not in this run's grant`);
    } else {
      await deps.setCapabilityEnablement(capabilityId, "disabled");
      try {
        const denied = await execute(scenarioRun.runId, "killswitch-off", killSwitchProgram(run.dates));
        detail.whileDisabled = summarize(denied);
        const output = denied.outcome === "result" ? (denied.result.output as Record<string, unknown>) : undefined;
        if (output?.outcome === "result") findings.push("a disabled capability still released data");
      } finally {
        await deps.setCapabilityEnablement(capabilityId, "enabled");
      }
      const restoredRun = await startRun(`${run.keyPrefix}:kill-restored`);
      const restored = await execute(restoredRun.runId, "killswitch-on", killSwitchProgram(run.dates));
      detail.afterRestore = summarize(restored);
      if (restored.outcome !== "result") findings.push("the capability did not recover after the switch was restored");
      // Evidence released before the switch must survive the clamp.
      if (citationRef && citationRunId) {
        const preserved = await deps.readCitationEvidence({ runId: citationRunId, citationRef });
        detail.preservedEvidence = preserved.kind;
        if (preserved.kind !== "evidence") findings.push("evidence released before the kill switch was lost");
      }
    }
    scenarios.push(report("kill_switch", findings, detail));
  }

  // Leave nothing running: the smoke is finished, and an operator's
  // active-run slots belong to operators.
  for (const runId of startedRunIds) await deps.finishRun(runId);

  return {
    profileId: DAILY_OPERATIONS_PROFILE_ID,
    dates: run.dates,
    grant: { capabilityIds: grant.capabilityIds, namespaces },
    production: (scenarios.find((scenario) => scenario.id === "kill_switch")?.detail.production ??
      {}) as Record<string, unknown>,
    scenarios,
    ok: scenarios.every((scenario) => scenario.ok),
    elapsedMs: Date.now() - startedAt,
  };
}

// ---------------------------------------------------------------------------
// Deployed driver
// ---------------------------------------------------------------------------

function shiftDate(operatingDate: string, days: number): string {
  const [year, month, day] = operatingDate.split("-").map((part) => Number.parseInt(part, 10));
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return shifted.toISOString().slice(0, 10);
}

/**
 * `bunx convex run agentHarness/evals/dailyOperations:runSmoke '{...}'`
 *
 * The release smoke, on the deployment, while the operator switch is off. It
 * creates an Athena run and program attempts, reads through the production
 * ports, and completes into an Athena artifact — but it never records a turn
 * intent, so there is nothing for an operator to see and nothing to release.
 */
export const runSmoke = internalAction({
  args: {
    organizationSlug: v.string(),
    storeSlug: v.string(),
    operatorEmail: v.string(),
    operatingDate: v.string(),
    keyPrefix: v.optional(v.string()),
    scenarios: v.optional(v.array(v.string())),
  },
  returns: v.any(),
  handler: async (ctx, args): Promise<Record<string, unknown>> => {
    const target = (await ctx.runQuery(internal.agentHarness.evals.directHarness.resolveTarget, {
      organizationSlug: args.organizationSlug,
      storeSlug: args.storeSlug,
      operatorEmail: args.operatorEmail,
    })) as Record<string, unknown>;
    if (target.kind !== "resolved") return { ok: false, target };

    const keyPrefix = args.keyPrefix ?? `smoke-${args.operatingDate}-${Date.now()}`;
    const startRun = async (key: string) => {
      const started = (await ctx.runMutation(internal.agentHarness.evals.directHarness.startRun, {
        profileId: DAILY_OPERATIONS_PROFILE_ID,
        athenaUserId: target.athenaUserId as Id<"athenaUser">,
        organizationId: target.organizationId as Id<"organization">,
        storeId: target.storeId as Id<"store">,
        runIdempotencyKey: key,
      })) as Record<string, unknown>;
      if (started.kind !== "running") throw new Error(`direct harness run refused: ${JSON.stringify(started)}`);
      return {
        runId: started.runId as Id<"intelligenceRun">,
        capabilityIds: started.capabilityIds as string[],
      };
    };

    const runtime = await createQuickJsProgramRuntime();
    const executorCtx: AgentExecutorCtx = {
      runQuery: (reference, callArgs) => ctx.runQuery(reference as never, callArgs as never),
      runMutation: (reference, callArgs) => ctx.runMutation(reference as never, callArgs as never),
    };
    const executor = createProgramExecutor({
      runtime,
      seams: DIRECT_HARNESS_SEAM_REFS,
      dispatchReadPort: DIRECT_HARNESS_ADMISSION.dispatchReadPort,
    });

    const report = await runDailyOperationsSmoke(
      {
        ctx: executorCtx,
        executor,
        startRun,
        finishRun: async (runId) => {
          await ctx.runMutation(internal.agentHarness.evals.directHarness.finishRun, { runId });
        },
        makeCancellingExecutor: async () => {
          // Deterministic cancellation: abort the moment the first port
          // dispatch returns, so an in-flight read is always clamped.
          const controller = new AbortController();
          const cancelling = createProgramExecutor({
            runtime,
            seams: DIRECT_HARNESS_SEAM_REFS,
            dispatchReadPort: async (dispatchCtx, invocation) => {
              const response = await DIRECT_HARNESS_ADMISSION.dispatchReadPort(dispatchCtx, invocation);
              controller.abort();
              return response;
            },
          });
          return {
            ...cancelling,
            executeProgram: (executorArgs, input) =>
              cancelling.executeProgram(executorArgs, { ...input, signal: controller.signal }),
          } as AgentProgramExecutor;
        },
        setCapabilityEnablement: async (capabilityId, state) => {
          await ctx.runMutation(internal.agentHarness.deploymentState.setCapabilityEnablement, {
            capabilityId,
            state,
            reason: `release smoke ${keyPrefix}`,
          });
        },
        completeRun: async (input) =>
          (await ctx.runMutation(internal.agentHarness.evals.directHarness.completeRun, {
            runId: input.runId,
            idempotencyKey: `${keyPrefix}:complete`,
            citedAttemptRefs: [...input.citedAttemptRefs],
            citations: input.citations.map((citation) => ({ ref: citation.ref })),
            artifact: { title: "Release smoke", payload: input.payload },
          })) as Record<string, unknown>,
        readCitationEvidence: async (input) =>
          (await ctx.runMutation(internal.agentHarness.evals.directHarness.readCitationEvidence, {
            runId: input.runId,
            citationRef: input.citationRef,
            viewer: { kind: "normal_user", athenaUserId: target.athenaUserId as Id<"athenaUser"> },
            purpose: "release_smoke",
          })) as Record<string, unknown>,
        probeProductionEnablement: async () =>
          (await ctx.runQuery(internal.agentHarness.evals.directHarness.probeProductionEnablement, {
            profileId: DAILY_OPERATIONS_PROFILE_ID,
          })) as Record<string, unknown>,
      },
      {
        dates: {
          operatingDate: args.operatingDate,
          priorOperatingDate: shiftDate(args.operatingDate, -1),
          emptyOperatingDate: shiftDate(args.operatingDate, -3650),
        },
        keyPrefix,
      },
      args.scenarios as readonly DailyOperationsSmokeScenarioId[] | undefined,
    );

    return {
      ...report,
      ok: report.ok,
      store: { organizationSlug: args.organizationSlug, storeSlug: args.storeSlug, storeName: target.storeName },
      operator: { membershipRole: target.membershipRole, operationalRoles: target.operationalRoles },
    };
  },
});
