// @vitest-environment node
/// <reference types="vite/client" />
/**
 * Direct-harness smoke for `daily_operations.v1` (V26-1267, plan U8 scenario 10).
 *
 * Model-authored TypeScript, the real QuickJS sandbox, the real executor, the
 * real read ports, and a seeded store — with NO operator turn and NO enabling
 * of the published profile. The published profile is asserted `unpublished`
 * here; the smoke composition (`dailyOperations.smokeHarness.ts`) enables an
 * otherwise identical copy so the contracts can be invoked directly, exactly as
 * plan decision 4 describes for the post-deploy smoke.
 *
 * Three representative tasks: one cross-package, one role-restricted, one
 * partial/no-data.
 */
import { convexTest, type TestConvex } from "convex-test";
import { beforeEach, describe, expect, it } from "vitest";

import schema from "../../schema";
import { DAILY_OPERATIONS_PROFILE } from "../profiles/dailyOperations";
import { AGENT_GENERATED_REGISTRY } from "../_generated/registry";
import {
  createProgramExecutor,
  type AgentExecuteProgramResult,
  type AgentExecutorCtx,
  type AgentProgramExecutorConfig,
} from "../executor";
import { createQuickJsProgramRuntime } from "../programRuntime/quickJsRuntime";
import type { AgentProgramRuntime } from "../programRuntime/types";
import { CURRENT_OPERATING_DATE, FIXTURE_NOW, PRIOR_OPERATING_DATE } from "./dailyOperations.fixture";
import {
  SMOKE_CLOCK,
  SMOKE_SEAMS,
  SMOKE_SEAM_REFS,
  seedSmokeRun,
  type SmokeRun,
} from "./dailyOperations.smokeHarness";

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
modules["./agentHarness/evals/dailyOperationsSmokePorts.ts"] =
  modules["./agentHarness/evals/dailyOperations.smokeHarness.ts"];

type Harness = TestConvex<typeof schema>;
type AnyCall = (reference: unknown, args: unknown) => Promise<unknown>;

let runtimePromise: Promise<AgentProgramRuntime> | undefined;
const runtime = () => (runtimePromise ??= createQuickJsProgramRuntime());

function executorCtx(t: Harness): AgentExecutorCtx {
  return {
    runQuery: (reference, args) => (t.query as unknown as AnyCall)(reference, args),
    runMutation: (reference, args) => (t.mutation as unknown as AnyCall)(reference, args),
  };
}

async function makeExecutor() {
  return createProgramExecutor({
    runtime: await runtime(),
    seams: SMOKE_SEAM_REFS,
    dispatchReadPort: ((ctx: never, invocation: never) =>
      SMOKE_SEAMS.dispatchReadPort(ctx, invocation)) as AgentProgramExecutorConfig["dispatchReadPort"],
    clock: () => SMOKE_CLOCK.now,
    heartbeatMs: 10_000,
    ceilingOverrides: { maxElapsedMs: 10_000 },
  });
}

function expectResult(result: AgentExecuteProgramResult) {
  expect(result.outcome, JSON.stringify(result).slice(0, 2_000)).toBe("result");
  if (result.outcome !== "result") throw new Error("unreachable");
  return result;
}

async function runProgram(t: Harness, run: SmokeRun, key: string, source: string) {
  const executor = await makeExecutor();
  return executor.executeProgram(executorCtx(t), {
    runId: run.runId,
    attemptIdempotencyKey: key,
    source,
  });
}

const CROSS_PACKAGE_PROGRAM = `
const day = await athena.operations.storeDay.get({ operatingDate: "${CURRENT_OPERATING_DATE}" });
const registers = await athena.cash.registerSessions.list({ operatingDate: "${CURRENT_OPERATING_DATE}" });
const attention = await athena.operations.attention.list({ operatingDate: "${CURRENT_OPERATING_DATE}" });
const sales = await athena.reports.daySales.get({ operatingDate: "${CURRENT_OPERATING_DATE}" });
const automation = await athena.automation.dailyOperations.list({ operatingDate: "${CURRENT_OPERATING_DATE}" });
const stock = await athena.inventory.positions.list({ stockState: "low" });
const yesterday = await athena.reports.daySales.get({ operatingDate: "${PRIOR_OPERATING_DATE}" });
const openRegisters = registers.kind === "result"
  ? registers.envelope.data.filter((session) => session.status === "open").length
  : -1;
const blocking = attention.kind === "result"
  ? attention.envelope.data.filter((item) => item.status === "blocking").length
  : -1;
return {
  stage: day.kind === "result" ? day.envelope.data.lifecycleStage : "unavailable",
  openRegisters,
  blocking,
  transactions: sales.kind === "result" ? sales.envelope.data.transactionCount : -1,
  salesFreshness: sales.kind === "result" ? sales.envelope.freshness.class : "unavailable",
  automationActions: automation.kind === "result" ? automation.envelope.data.length : -1,
  lowStock: stock.kind === "result" ? stock.envelope.data.length : -1,
  yesterdayFreshness: yesterday.kind === "result" ? yesterday.envelope.freshness.class : "unavailable",
  yesterdayRevision: yesterday.kind === "result" ? yesterday.envelope.data.recordRevision : "none",
};
`;

/** Names a resource only a full admin holds; a POS-only facade cannot express it. */
const ROLE_ADMIN_PROGRAM = `
const registers = await athena.cash.registerSessions.list({ operatingDate: "${CURRENT_OPERATING_DATE}" });
const sales = await athena.reports.daySales.get({ operatingDate: "${CURRENT_OPERATING_DATE}" });
const rows = registers.kind === "result" ? registers.envelope.data : [];
return {
  registerCount: rows.length,
  withVariance: rows.filter((session) => session.variance !== undefined).length,
  salesOutcome: sales.kind,
};
`;

/** Names only resources both roles hold, so the same program runs for both. */
const ROLE_SHARED_PROGRAM = `
const registers = await athena.cash.registerSessions.list({ operatingDate: "${CURRENT_OPERATING_DATE}" });
const positions = await athena.inventory.positions.list({});
const rows = registers.kind === "result" ? registers.envelope.data : [];
const stock = positions.kind === "result" ? positions.envelope.data : [];
return {
  registerCount: rows.length,
  withVariance: rows.filter((session) => session.variance !== undefined).length,
  positionCount: stock.length,
  withUnitCost: stock.filter((position) => position.unitCost !== undefined).length,
};
`;

const NO_DATA_PROGRAM = `
const sales = await athena.reports.daySales.get({ operatingDate: "2026-01-01" });
const activity = await athena.operations.activity.list({ operatingDate: "2026-01-01" });
return {
  recordState: sales.kind === "result" ? sales.envelope.data.recordState : "unavailable",
  completeness: sales.kind === "result" ? sales.envelope.completeness.status : "unavailable",
  unavailableSources: sales.kind === "result"
    ? sales.envelope.completeness.sources.filter((source) => source.status === "unavailable").length
    : -1,
  activityRows: activity.kind === "result" ? activity.envelope.data.length : -1,
};
`;

beforeEach(() => {
  SMOKE_CLOCK.now = FIXTURE_NOW;
});

describe("daily_operations.v1 direct-harness smoke", () => {
  it("keeps the published profile disabled and never creates an operator turn", async () => {
    expect(DAILY_OPERATIONS_PROFILE.lifecycle).toBe("unpublished");
    expect(AGENT_GENERATED_REGISTRY.enablement.profiles["daily_operations"]).toBe("unpublished");
    // Every published capability is `enabled`: they pass the conformance gate,
    // and only the profile switch stands between them and an operator.
    for (const capabilityId of Object.keys(AGENT_GENERATED_REGISTRY.enablement.capabilities)) {
      if (!capabilityId.startsWith("cap_dailyops_")) continue;
      expect(AGENT_GENERATED_REGISTRY.enablement.capabilities[capabilityId], capabilityId).toBe("enabled");
    }

    const t = convexTest(schema, modules);
    const run = await t.run((ctx) => seedSmokeRun(ctx, { slug: "no-turn" }));
    const bindings = await t.run(async (ctx) =>
      // eslint-disable-next-line @convex-dev/no-collect-in-query -- test assertion over an empty table
      ctx.db.query("agentTurnBinding").collect(),
    );
    expect(bindings).toEqual([]);
    expect(run.runId).toBeDefined();
  });

  it("composes readiness, registers, work, sales, automation, and stock in one program", async () => {
    const t = convexTest(schema, modules);
    const run = await t.run((ctx) => seedSmokeRun(ctx, { slug: "cross" }));
    const result = expectResult(await runProgram(t, run, "cross-1", CROSS_PACKAGE_PROGRAM));

    expect(result.result.output).toEqual({
      stage: "close_blocked",
      openRegisters: 1,
      blocking: 3,
      transactions: 2,
      salesFreshness: "live",
      automationActions: 2,
      lowStock: 1,
      yesterdayFreshness: "accepted",
      yesterdayRevision: "7",
    });
    // Six capability calls across five packages, all released.
    expect(result.calls.map((call) => call.namespace)).toEqual([
      "operations.storeDay",
      "cash.registerSessions",
      "operations.attention",
      "reports.daySales",
      "automation.dailyOperations",
      "inventory.positions",
      "reports.daySales",
    ]);
    expect(result.calls.every((call) => call.outcome === "result")).toBe(true);
    expect(result.citations.length).toBe(7);
    // The attempt inherits the maximum egress class of every input it read.
    expect(result.result.egressClass).toBe("sensitive");
    // Mixed authority is reported honestly rather than flattened.
    expect(result.result.freshness.mixed).toBe(true);
    expect(result.providerEgress).toMatchObject({ state: "committed" });
  });

  it("gives a POS-only operator structurally different declarations and results", async () => {
    const t = convexTest(schema, modules);
    const admin = await t.run((ctx) => seedSmokeRun(ctx, { slug: "role-admin" }));
    const pos = await t.run((ctx) =>
      seedSmokeRun(ctx, { slug: "role-pos", role: "pos_only", key: "smoke-role-pos" }),
    );

    const adminResult = expectResult(await runProgram(t, admin, "role-1", ROLE_ADMIN_PROGRAM));
    const adminOutput = adminResult.result.output as Record<string, unknown>;
    expect(adminOutput.registerCount).toBe(2);
    // The full admin sees the closed drawer's variance and the sales record.
    expect(adminOutput.withVariance).toBe(2);
    expect(adminOutput.salesOutcome).toBe("result");

    // The SAME program is not even expressible for a POS-only operator: the
    // resource is absent from their facade, so Athena's validator rejects it
    // before a single read happens.
    const unexpressible = await runProgram(t, pos, "role-2", ROLE_ADMIN_PROGRAM);
    expect(unexpressible.outcome).toBe("rejected");
    if (unexpressible.outcome !== "rejected") throw new Error("unreachable");
    expect(JSON.stringify(unexpressible.issues)).toContain("reports");

    // A program over resources both roles hold runs for both, and the results
    // differ structurally: no cash figure and no cost overlay exists on any row.
    const adminShared = expectResult(await runProgram(t, admin, "role-3", ROLE_SHARED_PROGRAM));
    expect(adminShared.result.output).toMatchObject({ withVariance: 2, withUnitCost: 2 });
    const posShared = expectResult(await runProgram(t, pos, "role-4", ROLE_SHARED_PROGRAM));
    expect(posShared.result.output).toMatchObject({
      registerCount: 2,
      withVariance: 0,
      positionCount: 2,
      withUnitCost: 0,
    });

    // The declarations the two runs are given differ structurally.
    const declarations = async (run: SmokeRun) => {
      const prepared = await t.run((ctx) =>
        SMOKE_SEAMS.prepareAttemptWithCtx(ctx, { runId: run.runId, now: SMOKE_CLOCK.now }),
      );
      if (prepared.outcome !== "ready") throw new Error(JSON.stringify(prepared));
      return prepared.facade.map((entry) => `${entry.package}.${entry.resource}`).sort();
    };
    const adminFacade = await declarations(admin);
    const posFacade = await declarations(pos);
    expect(adminFacade).toHaveLength(11);
    expect(posFacade.length).toBeLessThan(adminFacade.length);
    expect(posFacade).not.toContain("reports.daySales");
    expect(adminFacade).toContain("reports.daySales");
  });

  it("answers a day with no data as partial, without inventing figures", async () => {
    const t = convexTest(schema, modules);
    const run = await t.run((ctx) => seedSmokeRun(ctx, { slug: "nodata" }));
    const result = expectResult(await runProgram(t, run, "nodata-1", NO_DATA_PROGRAM));

    expect(result.result.output).toEqual({
      recordState: "absent",
      completeness: "partial",
      unavailableSources: 3,
      activityRows: 0,
    });
    // The attempt-level completeness inherits the partial inputs.
    expect(result.result.completeness.status).toBe("partial");
  });
});
