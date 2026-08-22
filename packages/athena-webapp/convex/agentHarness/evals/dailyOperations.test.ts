// @vitest-environment node
/// <reference types="vite/client" />
/**
 * The release smoke matrix, run against a seeded store.
 *
 * Two things are proven here that the deployed run cannot prove on its own:
 *
 * 1. the matrix's structural checks pass on data whose exact shape is known,
 *    so a green deployed run means the same thing; and
 * 2. the PRODUCTION path — the composition root's admission, seams, extractors
 *    and read-port bindings, gated by the durable enablement switch — carries
 *    a real operator run from grant to cited artifact once the switch is
 *    flipped, and clamps immediately when it is flipped back.
 *
 * No operator turn is created in either case: the smoke records no turn intent,
 * so `agentTurnBinding` stays empty throughout.
 */
import { convexTest, type TestConvex } from "convex-test";
import { beforeEach, describe, expect, it } from "vitest";

import { internal } from "../../_generated/api";
import schema from "../../schema";
import { AGENT_GENERATED_REGISTRY } from "../_generated/registry";
import { agentExecutorSeams } from "../executorSeams";
import { agentDelegatedAdmission } from "../../platform/operationAdmission";
import { setCapabilityEnablementWithCtx, setProfileEnablementWithCtx } from "../deploymentState";
import { cancelAgentRunWithCtx, markAgentRunRunningWithCtx } from "../lifecycle";
import {
  createProgramExecutor,
  type AgentExecuteProgramResult,
  type AgentExecutorCtx,
  type AgentProgramExecutor,
  type AgentProgramExecutorConfig,
} from "../executor";
import { createQuickJsProgramRuntime } from "../programRuntime/quickJsRuntime";
import type { AgentProgramRuntime } from "../programRuntime/types";
import { DAILY_OPERATIONS_PROFILE_ID } from "../profiles/dailyOperations";
import {
  CURRENT_OPERATING_DATE,
  FIXTURE_NOW,
  PRIOR_OPERATING_DATE,
  seedDailyOperationsStore,
} from "./dailyOperations.fixture";
import {
  DIRECT_HARNESS_ADMISSION,
  DIRECT_HARNESS_SEAMS,
  DIRECT_HARNESS_SEAM_REFS,
  startDirectHarnessRunWithCtx,
} from "./directHarness";
import {
  crossPackageProgram,
  runDailyOperationsSmoke,
  type DailyOperationsSmokeDates,
} from "./dailyOperations";

const modules = Object.fromEntries(
  Object.entries(import.meta.glob("../../**/*.ts")).map(([path, loader]) => [
    path.startsWith("../../")
      ? path.replace(/^\.\.\/\.\.\//, "./")
      : path.startsWith("../")
        ? path.replace(/^\.\.\//, "./agentHarness/")
        : path.replace(/^\.\//, "./agentHarness/evals/"),
    loader,
  ]),
);

type Harness = TestConvex<typeof schema>;
type AnyCall = (reference: unknown, args: unknown) => Promise<unknown>;

const DATES: DailyOperationsSmokeDates = {
  operatingDate: CURRENT_OPERATING_DATE,
  priorOperatingDate: PRIOR_OPERATING_DATE,
  emptyOperatingDate: "2019-01-02",
};

let runtimePromise: Promise<AgentProgramRuntime> | undefined;
const runtime = () => (runtimePromise ??= createQuickJsProgramRuntime());

function executorCtx(t: Harness): AgentExecutorCtx {
  return {
    runQuery: (reference, args) => (t.query as unknown as AnyCall)(reference, args),
    runMutation: (reference, args) => (t.mutation as unknown as AnyCall)(reference, args),
  };
}

async function directExecutor(): Promise<AgentProgramExecutor> {
  return createProgramExecutor({
    runtime: await runtime(),
    seams: DIRECT_HARNESS_SEAM_REFS,
    dispatchReadPort: ((ctx: never, invocation: never) =>
      DIRECT_HARNESS_ADMISSION.dispatchReadPort(ctx, invocation)) as AgentProgramExecutorConfig["dispatchReadPort"],
    clock: () => FIXTURE_NOW,
    heartbeatMs: 10_000,
    ceilingOverrides: { maxElapsedMs: 10_000 },
  });
}

/** Aborts as soon as the first port dispatch returns: deterministic mid-flight cancellation. */
async function cancellingExecutor(): Promise<AgentProgramExecutor> {
  const controller = new AbortController();
  const executor = createProgramExecutor({
    runtime: await runtime(),
    seams: DIRECT_HARNESS_SEAM_REFS,
    dispatchReadPort: (async (ctx: never, invocation: never) => {
      const response = await DIRECT_HARNESS_ADMISSION.dispatchReadPort(ctx, invocation);
      controller.abort();
      return response;
    }) as AgentProgramExecutorConfig["dispatchReadPort"],
    clock: () => FIXTURE_NOW,
    heartbeatMs: 10_000,
    ceilingOverrides: { maxElapsedMs: 10_000 },
  });
  return {
    ...executor,
    executeProgram: (ctx, input) => executor.executeProgram(ctx, { ...input, signal: controller.signal }),
  } as AgentProgramExecutor;
}

async function seedDirectRun(t: Harness, key: string, options: { role?: "full_admin" | "pos_only" } = {}) {
  return t.run(async (ctx) => {
    const fixture = await seedDailyOperationsStore(ctx, { slug: key, role: options.role });
    const started = await startDirectHarnessRunWithCtx(ctx, {
      profileId: DAILY_OPERATIONS_PROFILE_ID,
      athenaUserId: fixture.userId,
      organizationId: fixture.organizationId,
      storeId: fixture.storeId,
      runIdempotencyKey: `direct-${key}`,
      now: FIXTURE_NOW,
    });
    if (started.kind !== "running") throw new Error(JSON.stringify(started));
    return { fixture, started, athenaUserId: fixture.userId };
  });
}

describe("daily operations release smoke matrix", () => {
  beforeEach(() => {
    // Nothing to reset: the direct harness overlay is a constant and every
    // durable switch this suite writes lives in a fresh convex-test database.
  });

  it("passes every scenario against a seeded store, without creating an operator turn", async () => {
    const t = convexTest(schema, modules);
    const { fixture, athenaUserId } = await seedDirectRun(t, "matrix");

    const report = await runDailyOperationsSmoke(
      {
        ctx: executorCtx(t),
        executor: await directExecutor(),
        startRun: async (key) =>
          t.run(async (ctx) => {
            const started = await startDirectHarnessRunWithCtx(ctx, {
              profileId: DAILY_OPERATIONS_PROFILE_ID,
              athenaUserId: fixture.userId,
              organizationId: fixture.organizationId,
              storeId: fixture.storeId,
              runIdempotencyKey: key,
              now: FIXTURE_NOW,
            });
            if (started.kind !== "running") throw new Error(JSON.stringify(started));
            return { runId: started.runId, capabilityIds: started.capabilityIds };
          }),
        finishRun: async (runId) => {
          await t.run((ctx) =>
            cancelAgentRunWithCtx(ctx, {
              runId,
              idempotencyKey: `smoke-finished:${runId}`,
              reason: "direct_harness_complete",
              now: FIXTURE_NOW,
            }),
          );
        },
        makeCancellingExecutor: cancellingExecutor,
        setCapabilityEnablement: async (capabilityId, state) => {
          await t.run((ctx) =>
            setCapabilityEnablementWithCtx(ctx, AGENT_GENERATED_REGISTRY.enablement, {
              capabilityId,
              state,
              reason: "release smoke",
              now: FIXTURE_NOW,
            }),
          );
        },
        completeRun: async (input) =>
          (await t.run((ctx) =>
            DIRECT_HARNESS_SEAMS.completeRunWithCtx(ctx, {
              runId: input.runId,
              idempotencyKey: "matrix-complete",
              citedAttemptRefs: [...input.citedAttemptRefs],
              citations: input.citations.map((citation) => ({ ref: citation.ref })),
              artifact: { title: "Release smoke", payload: input.payload },
              now: FIXTURE_NOW,
            }),
          )) as unknown as Record<string, unknown>,
        readCitationEvidence: async (input) =>
          (await t.run((ctx) =>
            DIRECT_HARNESS_SEAMS.readCitationEvidenceWithCtx(ctx, {
              runId: input.runId,
              citationRef: input.citationRef,
              viewer: { kind: "normal_user", athenaUserId },
              purpose: "release_smoke",
              now: FIXTURE_NOW,
            }),
          )) as unknown as Record<string, unknown>,
        probeProductionEnablement: async () => ({ effective: "disabled", operatorsAdmitted: false }),
      },
      { dates: DATES, keyPrefix: "matrix" },
    );

    const failing = report.scenarios.filter((scenario) => !scenario.ok);
    expect(
      failing.map((scenario) => `${scenario.id}: ${scenario.findings.join("; ")}`),
      JSON.stringify(report, null, 2).slice(0, 4_000),
    ).toEqual([]);
    expect(report.scenarios.map((scenario) => scenario.id)).toEqual([
      "cross_package",
      "role_restricted",
      "partial_or_no_data",
      "cancellation",
      "citation_resolution",
      "kill_switch",
    ]);

    const bindings = await t.run(async (ctx) =>
      // eslint-disable-next-line @convex-dev/no-collect-in-query -- test assertion over an empty table
      ctx.db.query("agentTurnBinding").collect(),
    );
    expect(bindings).toEqual([]);
  });

  it("reports the seeded store's figures exactly, so the structural checks are not vacuous", async () => {
    const t = convexTest(schema, modules);
    const { started } = await seedDirectRun(t, "figures");
    const executor = await directExecutor();
    const result = await executor.executeProgram(executorCtx(t), {
      runId: started.runId,
      attemptIdempotencyKey: "figures-1",
      source: crossPackageProgram(DATES),
    });
    expect(result.outcome, JSON.stringify(result).slice(0, 1_500)).toBe("result");
    if (result.outcome !== "result") throw new Error("unreachable");
    expect(result.result.output).toEqual({
      readsAttempted: 7,
      readsReleased: 7,
      stage: "close_blocked",
      openRegisters: 1,
      blocking: 3,
      transactions: 2,
      salesFreshness: "live",
      yesterdayFreshness: "accepted",
      automationActions: 2,
      lowStock: 1,
    });
    expect(result.result.egressClass).toBe("sensitive");
    expect(result.result.freshness.mixed).toBe(true);
  });
});

describe("the production path once the durable switch is on", () => {
  /**
   * The composition root's own admission, seams, read-port bindings and
   * evidence extractors, gated by the durable switch — nothing substituted.
   */
  async function productionExecutor(): Promise<AgentProgramExecutor> {
    return createProgramExecutor({
      runtime: await runtime(),
      seams: {
        prepareAttempt: internal.agentHarness.executorSeams.prepareAttempt as never,
        beginAttempt: internal.agentHarness.executorSeams.beginAttempt as never,
        reserveAndAdmitCall: internal.agentHarness.executorSeams.reserveAndAdmitCall as never,
        settleCall: internal.agentHarness.executorSeams.settleCall as never,
        finishAttempt: internal.agentHarness.executorSeams.finishAttempt as never,
        heartbeatAttempt: internal.agentHarness.executorSeams.heartbeatAttempt as never,
        loadAttemptReplayInputs: internal.agentHarness.executorSeams.loadAttemptReplayInputs as never,
      },
      dispatchReadPort: ((ctx: never, invocation: never) =>
        agentDelegatedAdmission.dispatchReadPort(ctx, invocation)) as AgentProgramExecutorConfig["dispatchReadPort"],
      clock: () => FIXTURE_NOW,
      heartbeatMs: 10_000,
      ceilingOverrides: { maxElapsedMs: 10_000 },
    });
  }

  async function seedProductionRun(t: Harness, key: string) {
    return t.run(async (ctx) => {
      const fixture = await seedDailyOperationsStore(ctx, { slug: key });
      const materialized = await agentDelegatedAdmission.materializeRunGrantWithCtx(ctx, {
        operator: { kind: "normal_user", athenaUserId: fixture.userId },
        profileId: DAILY_OPERATIONS_PROFILE_ID,
        organizationId: fixture.organizationId,
        storeId: fixture.storeId,
        promptPayloadHash: "sha256:production",
        runIdempotencyKey: `production-${key}`,
        now: FIXTURE_NOW,
      });
      return { fixture, materialized };
    });
  }

  const enable = (t: Harness, state: "enabled" | "disabled") =>
    t.run((ctx) =>
      setProfileEnablementWithCtx(ctx, AGENT_GENERATED_REGISTRY.enablement, {
        profileId: DAILY_OPERATIONS_PROFILE_ID,
        state,
        reason: "release smoke",
        now: FIXTURE_NOW,
      }),
    );

  it("refuses a delegated run while the durable switch is off", async () => {
    const t = convexTest(schema, modules);
    const { materialized } = await seedProductionRun(t, "switch-off");
    expect(materialized.kind).toBe("refused");
    if (materialized.kind !== "refused") throw new Error("unreachable");
    expect(materialized.stage).toBe("enablement");
    // Published but not switched on: the operator-facing reason is the switch,
    // not publication.
    expect(materialized.reason).toBe("profile_disabled");
  });

  it("carries a run from grant to cited artifact with claim-support evidence once switched on", async () => {
    const t = convexTest(schema, modules);
    await enable(t, "enabled");
    const { materialized } = await seedProductionRun(t, "switch-on");
    expect(materialized.kind, JSON.stringify(materialized)).toBe("materialized");
    if (materialized.kind !== "materialized") throw new Error("unreachable");
    await t.run((ctx) => markAgentRunRunningWithCtx(ctx, { runId: materialized.runId, now: FIXTURE_NOW }));

    const executor = await productionExecutor();
    const result: AgentExecuteProgramResult = await executor.executeProgram(executorCtx(t), {
      runId: materialized.runId,
      attemptIdempotencyKey: "production-1",
      source: crossPackageProgram(DATES),
    });
    expect(result.outcome, JSON.stringify(result).slice(0, 1_500)).toBe("result");
    if (result.outcome !== "result") throw new Error("unreachable");

    // The composition root's extractor index is wired into the production
    // seams, so a cited call carries a deterministic claim slice rather than
    // degrading to provenance-only.
    const storeDayCitation = result.citations.find((citation) => citation.namespace === "operations.storeDay");
    expect(storeDayCitation).toBeDefined();
    const completion = await t.run((ctx) =>
      agentExecutorSeams.completeRunWithCtx(ctx, {
        runId: materialized.runId,
        idempotencyKey: "production-complete",
        citedAttemptRefs: [result.attemptRef],
        citations: [{ ref: storeDayCitation!.citation }],
        artifact: { title: "Release smoke", payload: { headline: "production path" } },
        now: FIXTURE_NOW,
      }),
    );
    expect(completion.outcome, JSON.stringify(completion).slice(0, 800)).toBe("completed");
    if (completion.outcome !== "completed") throw new Error("unreachable");
    expect(completion.citations.map((citation) => citation.support)).toEqual(["claim_support"]);
  });

  it("clamps active work the moment the switch is flipped back and keeps released evidence", async () => {
    const t = convexTest(schema, modules);
    await enable(t, "enabled");
    const { materialized } = await seedProductionRun(t, "clamp");
    if (materialized.kind !== "materialized") throw new Error(JSON.stringify(materialized));
    await t.run((ctx) => markAgentRunRunningWithCtx(ctx, { runId: materialized.runId, now: FIXTURE_NOW }));

    const executor = await productionExecutor();
    const before = await executor.executeProgram(executorCtx(t), {
      runId: materialized.runId,
      attemptIdempotencyKey: "clamp-1",
      source: crossPackageProgram(DATES),
    });
    expect(before.outcome).toBe("result");

    const flipped = await enable(t, "disabled");
    expect(flipped.outcome).toBe("updated");
    // The run itself is terminalized by the kill switch's bounded cancel pass.
    const run = await t.run((ctx) => ctx.db.get("intelligenceRun", materialized.runId));
    expect(run?.status).toBe("canceled");

    // A further attempt is refused immediately, even though the run pinned a
    // digest that has not changed.
    const after = await executor.executeProgram(executorCtx(t), {
      runId: materialized.runId,
      attemptIdempotencyKey: "clamp-2",
      source: crossPackageProgram(DATES),
    });
    expect(["refused", "denied"]).toContain(after.outcome);

    // Evidence released before the clamp is preserved, not deleted.
    const calls = await t.run(async (ctx) =>
      ctx.db
        .query("agentCapabilityCall")
        .withIndex("by_runId_sequence", (q) => q.eq("runId", materialized.runId))
        .take(50),
    );
    expect(calls.filter((call) => call.status === "succeeded").length).toBeGreaterThan(0);
  });
});
