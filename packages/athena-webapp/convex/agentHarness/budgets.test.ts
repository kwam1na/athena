/// <reference types="vite/client" />
/**
 * Reservation and settlement policy for the program executor (ticket
 * V26-1264 "reservations cannot overdraw").
 *
 * Pure checks cover the charge/refund table and ceiling derivation; the
 * convex-test checks prove the counter math through the real seams: two
 * reservations cannot overdraw a hard limit (run or attempt scope, counting
 * outstanding reservations, not only settled charges), an idempotency-key
 * replay never reserves twice, and every settlement outcome lands on the
 * ledger exactly as the documented policy says.
 */
import { convexTest, type TestConvex } from "convex-test";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import schema from "../schema";
import {
  AGENT_CALL_EVIDENCE_BYTE_CEILING,
  AGENT_RUN_EVIDENCE_BYTE_CEILING,
  budgetVector,
} from "../../shared/agentHarness/execution";
import { AGENT_PROGRAM_RUNTIME_CEILINGS } from "./programRuntime/types";
import {
  AGENT_CALL_EVIDENCE_CONTENT_CEILING_BYTES,
  AGENT_CALL_EVIDENCE_METADATA_HEADROOM_BYTES,
  clampRunLimitsToEvidenceCeiling,
  deriveExecutionCeilings,
  describeSettlementPolicy,
  settlementOutcomeForProgramEnd,
} from "./budgets";
import {
  SHIFTS_MANIFEST,
  TEST_CLOCK,
  TEST_ENABLEMENT,
  TEST_NOW_BASE,
  TEST_PORT_BEHAVIOR,
  TEST_PROFILE_ID,
  seedDelegatedOperator,
} from "./delegatedAdmission.testPorts";
import { TEST_EXECUTOR_SEAMS, type TestBridgeRequest } from "./executor.testSeams";
import {
  admitCapabilityCallWithCtx,
  beginProgramAttemptWithCtx,
  getBudgetLedgerForRun,
  listCapabilityCallsForRun,
  markAgentRunRunningWithCtx,
  transitionProgramAttemptWithCtx,
} from "./lifecycle";
import { seedRun, seedTenant } from "./testSupport";

// Cuts the module cycle `platform/operationAdmission` -> `sharedDemo/...`, as retention.test.ts does.
vi.mock("../sharedDemo/restore", () => ({
  requireReadySharedDemoWriteWithCtx: vi.fn(),
}));

const modules = Object.fromEntries(
  Object.entries(import.meta.glob("../**/*.ts")).map(([path, loader]) => [
    path.startsWith("../") ? path.replace(/^\.\.\//, "./") : path.replace(/^\.\//, "./agentHarness/"),
    loader,
  ]),
);
modules["./agentHarness/testPorts.ts"] = modules["./agentHarness/delegatedAdmission.testPorts.ts"];
modules["./agentHarness/testSeams.ts"] = modules["./agentHarness/executor.testSeams.ts"];

type Harness = TestConvex<typeof schema>;
type AnyCall = (reference: unknown, args: unknown) => Promise<unknown>;

const shiftsRequest = (args: Record<string, unknown> = { status: "open" }): TestBridgeRequest => ({
  capabilityId: SHIFTS_MANIFEST.capabilityId,
  namespace: "ops.shifts",
  verb: "list",
  args: args as never,
});

async function seedExecutingRun(ctx: MutationCtx, slug: string, options: { attemptRows?: number } = {}) {
  const operator = await seedDelegatedOperator(ctx, slug, { role: "full_admin" });
  const prepared = await TEST_EXECUTOR_SEAMS.admission.prepareRunGrantWithCtx(ctx, {
    operator: { kind: "normal_user", athenaUserId: operator.userId },
    profileId: TEST_PROFILE_ID,
    organizationId: operator.organizationId,
    storeId: operator.storeId,
    now: TEST_NOW_BASE,
  });
  if (prepared.kind !== "prepared") throw new Error(JSON.stringify(prepared));
  const run = await seedRun(ctx, operator, {
    ...prepared.runInput,
    budgetPolicy: {
      ...prepared.runInput.budgetPolicy,
      attemptLimits: options.attemptRows === undefined ? undefined : budgetVector({ calls: 8, rows: options.attemptRows, bytes: 262_144, costUnits: 40, elapsedMs: 30_000 }),
    },
    promptPayloadHash: "sha256:prompt",
    runIdempotencyKey: `turn-${slug}`,
  });
  await markAgentRunRunningWithCtx(ctx, { runId: run.runId, now: TEST_NOW_BASE });
  const begun = await beginProgramAttemptWithCtx(ctx, {
    runId: run.runId,
    attemptIdempotencyKey: "attempt-1",
    programSource: "return 1;",
    now: TEST_NOW_BASE,
  });
  if (begun.outcome !== "created") throw new Error(begun.outcome);
  await transitionProgramAttemptWithCtx(ctx, { attemptId: begun.attemptId, to: "validating", now: TEST_NOW_BASE });
  await transitionProgramAttemptWithCtx(ctx, { attemptId: begun.attemptId, to: "executing", now: TEST_NOW_BASE, leaseMs: 30_000 });
  return { operator, runId: run.runId, attemptId: begun.attemptId };
}

function reserve(t: Harness, run: { runId: Id<"intelligenceRun">; attemptId: Id<"agentProgramAttempt"> }, key: string, request = shiftsRequest()) {
  return t.run((ctx) =>
    TEST_EXECUTOR_SEAMS.reserveAndAdmitCallWithCtx(ctx, {
      runId: run.runId,
      attemptId: run.attemptId,
      callIdempotencyKey: key,
      request: request as never,
      now: TEST_NOW_BASE + 1,
    }),
  );
}

beforeEach(() => {
  TEST_ENABLEMENT.reset();
  TEST_CLOCK.now = TEST_NOW_BASE;
  TEST_PORT_BEHAVIOR.shifts = "normal";
});

describe("charge/refund policy (plan decision 11)", () => {
  it("documents exactly which dimensions each settlement outcome charges", () => {
    expect(describeSettlementPolicy("denied")).toEqual({ charges: ["calls"], refunds: ["rows", "bytes", "costUnits", "elapsedMs"], conservative: false });
    expect(describeSettlementPolicy("unavailable")).toEqual({ charges: ["calls", "elapsedMs"], refunds: ["rows", "bytes", "costUnits"], conservative: false });
    expect(describeSettlementPolicy("failed")).toEqual({ charges: ["calls", "elapsedMs"], refunds: ["rows", "bytes", "costUnits"], conservative: false });
    expect(describeSettlementPolicy("timeout")).toEqual({ charges: ["calls", "rows", "bytes", "costUnits", "elapsedMs"], refunds: [], conservative: true });
    expect(describeSettlementPolicy("canceled")).toEqual({ charges: ["calls", "rows", "bytes", "costUnits", "elapsedMs"], refunds: [], conservative: true });
    expect(describeSettlementPolicy("succeeded")).toEqual({ charges: ["calls", "rows", "bytes", "costUnits", "elapsedMs"], refunds: [], conservative: false });
  });

  it("maps how a program ended onto the settlement of its still-open calls", () => {
    expect(settlementOutcomeForProgramEnd({ status: "failed", code: "timeout" })).toBe("timeout");
    expect(settlementOutcomeForProgramEnd({ status: "canceled" })).toBe("canceled");
    expect(settlementOutcomeForProgramEnd({ status: "failed", code: "runtime_error" })).toBe("canceled");
    expect(settlementOutcomeForProgramEnd({ status: "failed", code: "detached_call" })).toBe("canceled");
  });
});

describe("ceilings", () => {
  it("keeps the run evidence ceiling at 2 MiB and the per-call content ceiling under 240 KiB including metadata headroom", () => {
    expect(AGENT_RUN_EVIDENCE_BYTE_CEILING).toBe(2 * 1024 * 1024);
    expect(AGENT_CALL_EVIDENCE_METADATA_HEADROOM_BYTES).toBeGreaterThanOrEqual(4 * 1024);
    expect(AGENT_CALL_EVIDENCE_CONTENT_CEILING_BYTES).toBe(AGENT_CALL_EVIDENCE_BYTE_CEILING - AGENT_CALL_EVIDENCE_METADATA_HEADROOM_BYTES);
    expect(clampRunLimitsToEvidenceCeiling(budgetVector({ bytes: 3 * 1024 * 1024, calls: 9 }))).toEqual(budgetVector({ bytes: AGENT_RUN_EVIDENCE_BYTE_CEILING, calls: 9 }));
    expect(clampRunLimitsToEvidenceCeiling(budgetVector({ bytes: 1024 }))).toEqual(budgetVector({ bytes: 1024 }));
  });

  it("derives execution ceilings from the run's budget policy without exceeding the runtime defaults", () => {
    const ceilings = deriveExecutionCeilings({
      runLimits: budgetVector({ calls: 8, rows: 200, bytes: 262_144, costUnits: 40, elapsedMs: 30_000 }),
      maxAttempts: 2,
      maxInFlightCalls: 2,
    });
    expect(ceilings).toMatchObject({
      maxElapsedMs: 30_000,
      maxAttempts: 2,
      maxCapabilityCalls: 8,
      maxInFlightCalls: 2,
      maxRows: 200,
      maxRunBridgeBytes: 262_144,
      maxCallOutputBytes: AGENT_PROGRAM_RUNTIME_CEILINGS.maxCallOutputBytes,
      maxResultBytes: AGENT_CALL_EVIDENCE_CONTENT_CEILING_BYTES,
    });
    const wide = deriveExecutionCeilings({
      runLimits: budgetVector({ calls: 500, rows: 50_000, bytes: 8 * 1024 * 1024, costUnits: 40, elapsedMs: 600_000 }),
      maxAttempts: 9,
    });
    expect(wide).toMatchObject({
      maxElapsedMs: AGENT_PROGRAM_RUNTIME_CEILINGS.maxElapsedMs,
      maxAttempts: AGENT_PROGRAM_RUNTIME_CEILINGS.maxAttempts,
      maxCapabilityCalls: AGENT_PROGRAM_RUNTIME_CEILINGS.maxCapabilityCalls,
      maxInFlightCalls: AGENT_PROGRAM_RUNTIME_CEILINGS.maxInFlightCalls,
      maxRows: AGENT_PROGRAM_RUNTIME_CEILINGS.maxRows,
      maxRunBridgeBytes: AGENT_RUN_EVIDENCE_BYTE_CEILING,
    });
  });

  it("clamps a run ledger's byte limit to the evidence ceiling at creation so the reservation counter enforces it", async () => {
    const t = convexTest(schema, modules);
    const ledger = await t.run(async (ctx) => {
      const tenant = await seedTenant(ctx, "ceiling");
      const run = await seedRun(ctx, tenant, {
        budgetPolicy: { runLimits: budgetVector({ calls: 100, rows: 10, bytes: 3 * 1024 * 1024, costUnits: 10, elapsedMs: 1_000 }), maxAttempts: 1 },
      });
      return getBudgetLedgerForRun(ctx, run.runId);
    });
    expect(ledger?.limits.bytes).toBe(AGENT_RUN_EVIDENCE_BYTE_CEILING);
  });
});

describe("reservations cannot overdraw (scenario 8)", () => {
  it("counts outstanding reservations against the attempt cap, not only settled charges", async () => {
    const t = convexTest(schema, modules);
    const run = await t.run((ctx) => seedExecutingRun(ctx, "attempt-cap", { attemptRows: 15 }));
    // Each shifts read reserves 10 rows. Two concurrent reservations must not both fit under 15.
    const first = await reserve(t, run, "c1", shiftsRequest({ status: "open" }));
    const second = await reserve(t, run, "c2", shiftsRequest({}));
    expect(first.outcome).toBe("admitted");
    expect(second).toMatchObject({ outcome: "refused", stage: "budget", result: { kind: "denied", code: "budget_exceeded", detail: { scope: "attempt", exceeded: ["rows"] } } });
    const ledger = await t.run((ctx) => getBudgetLedgerForRun(ctx, run.runId));
    expect(ledger?.outstanding.rows).toBe(10);
    // The denial consumed exactly one call attempt and nothing else.
    expect(ledger?.charged).toEqual(budgetVector({ calls: 1 }));
    const calls = await t.run((ctx) => listCapabilityCallsForRun(ctx, run.runId));
    expect(calls.map((call) => [call.callIdempotencyKey, call.status])).toEqual([
      ["c1", "executing"],
      ["c2", "denied"],
    ]);
  });

  it("never lets two reservations exceed the run limit and replays an idempotency key without a second reservation", async () => {
    const t = convexTest(schema, modules);
    const run = await t.run(async (ctx) => {
      const seeded = await seedExecutingRun(ctx, "run-cap");
      const ledger = await getBudgetLedgerForRun(ctx, seeded.runId);
      // Leave room for exactly one more shifts reservation (10 rows).
      await ctx.db.patch("agentBudgetLedger", ledger!._id, { limits: { ...ledger!.limits, rows: 15 } });
      return seeded;
    });
    const first = await reserve(t, run, "k1");
    const replay = await reserve(t, run, "k1");
    const second = await reserve(t, run, "k2", shiftsRequest({}));
    expect(first.outcome).toBe("admitted");
    expect(replay).toMatchObject({ outcome: "resumed", status: "executing" });
    expect(second).toMatchObject({ outcome: "refused", result: { kind: "denied", code: "budget_exceeded", detail: { scope: "run" } } });
    const ledger = await t.run((ctx) => getBudgetLedgerForRun(ctx, run.runId));
    expect(ledger).toMatchObject({ reservationCount: 2, outstanding: budgetVector({ calls: 1, rows: 10, bytes: 16_384, costUnits: 2, elapsedMs: 1_000 }) });
    expect(ledger!.charged.rows + ledger!.outstanding.rows).toBeLessThanOrEqual(ledger!.limits.rows);
  });

  it("refuses at the evidence ceiling through the same counter even when the profile limit is larger", async () => {
    const t = convexTest(schema, modules);
    const run = await t.run(async (ctx) => {
      const seeded = await seedExecutingRun(ctx, "evidence-cap");
      const ledger = await getBudgetLedgerForRun(ctx, seeded.runId);
      await ctx.db.patch("agentBudgetLedger", ledger!._id, {
        limits: { ...ledger!.limits, bytes: AGENT_RUN_EVIDENCE_BYTE_CEILING },
        charged: { ...ledger!.charged, bytes: AGENT_RUN_EVIDENCE_BYTE_CEILING - 1_000 },
      });
      return seeded;
    });
    const denied = await reserve(t, run, "over");
    expect(denied).toMatchObject({ outcome: "refused", result: { kind: "denied", code: "budget_exceeded", detail: { exceeded: ["bytes"] } } });
  });
});

describe("settlement lands on the ledger per outcome (scenario 8)", () => {
  async function settle(
    t: Harness,
    run: { runId: Id<"intelligenceRun">; attemptId: Id<"agentProgramAttempt"> },
    key: string,
    response: Parameters<typeof TEST_EXECUTOR_SEAMS.settleCallWithCtx>[1]["response"],
  ) {
    const admit = await reserve(t, run, key);
    if (admit.outcome !== "admitted") throw new Error(JSON.stringify(admit));
    const settled = await t.run((ctx) =>
      TEST_EXECUTOR_SEAMS.settleCallWithCtx(ctx, { callId: admit.callId, response, elapsedMs: 40, now: TEST_NOW_BASE + 2 }),
    );
    const call = await t.run((ctx) => ctx.db.get("agentCapabilityCall", admit.callId));
    return { admit, settled, call };
  }

  it("charges conservatively on timeout and cancel, refunds rows/bytes/cost on unavailable and failure, and charges actuals on success", async () => {
    const t = convexTest(schema, modules);
    const run = await t.run((ctx) => seedExecutingRun(ctx, "settle"));
    const reserved = budgetVector({ calls: 1, rows: 10, bytes: 16_384, costUnits: 2, elapsedMs: 1_000 });

    const timeout = await settle(t, run, "t", { kind: "timeout" });
    expect(timeout.settled).toMatchObject({ outcome: "withheld", reason: "timeout" });
    expect(timeout.call).toMatchObject({ status: "failed", charged: reserved, error: { code: "timeout" } });

    const canceled = await settle(t, run, "c", { kind: "canceled", reason: "program_aborted" });
    expect(canceled.call).toMatchObject({ status: "canceled", charged: reserved });

    const unavailable = await settle(t, run, "u", { kind: "unavailable", reason: "shift_source_offline", retryable: true, sourceKey: "shifts" });
    expect(unavailable.settled).toMatchObject({ outcome: "withheld", result: { kind: "unavailable" } });
    expect(unavailable.call).toMatchObject({ status: "unavailable", charged: budgetVector({ calls: 1, elapsedMs: 40 }) });

    const failed = await settle(t, run, "f", { kind: "failed", error: { code: "port_threw", message: "boom" } });
    expect(failed.call).toMatchObject({ status: "failed", charged: budgetVector({ calls: 1, elapsedMs: 40 }) });

    const admit = await reserve(t, run, "s");
    if (admit.outcome !== "admitted") throw new Error("expected admission");
    const response = await TEST_EXECUTOR_SEAMS.dispatchReadPort({ runQuery: (reference, args) => (t.query as unknown as AnyCall)(reference, args) as never }, admit.invocation);
    const released = await t.run((ctx) => TEST_EXECUTOR_SEAMS.settleCallWithCtx(ctx, { callId: admit.callId, response, elapsedMs: 12, now: TEST_NOW_BASE + 3 }));
    expect(released).toMatchObject({ outcome: "released" });
    expect(released.outcome === "released" ? released.truncation : "x").toBeUndefined();
    const call = await t.run((ctx) => ctx.db.get("agentCapabilityCall", admit.callId));
    expect(call).toMatchObject({ status: "succeeded", charged: { calls: 1, rows: 1, costUnits: 2, elapsedMs: 12 } });
    expect(call!.charged.bytes).toBeGreaterThan(0);
    expect(call!.charged.bytes).toBeLessThan(16_384);

    const ledger = await t.run((ctx) => getBudgetLedgerForRun(ctx, run.runId));
    expect(ledger?.outstanding).toEqual(budgetVector({}));
    expect(ledger?.settledCount).toBe(5);
    expect(ledger?.charged.calls).toBe(5);
    expect(ledger?.charged.rows).toBe(10 + 10 + 1);
  });

  it("records a denied admission as one consumed call attempt through the lifecycle ledger even when a program keeps retrying", async () => {
    const t = convexTest(schema, modules);
    const run = await t.run((ctx) => seedExecutingRun(ctx, "denied"));
    await t.run(async (ctx) => {
      // Exhaust the call budget directly (8 calls) so the next bridge call is denied at the run scope.
      for (let index = 0; index < 8; index += 1) {
        const admitted = await admitCapabilityCallWithCtx(ctx, {
          runId: run.runId,
          attemptId: run.attemptId,
          callIdempotencyKey: `fill-${index}`,
          capabilityId: SHIFTS_MANIFEST.capabilityId,
          normalizedArgsHash: `fill:${index}`,
          requested: budgetVector({ calls: 1 }),
          now: TEST_NOW_BASE,
        });
        if (admitted.outcome !== "admitted") throw new Error(JSON.stringify(admitted));
      }
    });
    const denied = await reserve(t, run, "denied-1");
    expect(denied).toMatchObject({ outcome: "refused", result: { kind: "denied", code: "budget_exceeded", detail: { exceeded: ["calls"] } } });
    const ledger = await t.run((ctx) => getBudgetLedgerForRun(ctx, run.runId));
    expect(ledger?.charged.calls).toBe(1);
    expect(ledger?.outstanding.calls).toBe(8);
  });
});
