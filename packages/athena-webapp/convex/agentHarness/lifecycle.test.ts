/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { describe, expect, it, vi } from "vitest";

import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import schema from "../schema";
import {
  AGENT_CALL_EVIDENCE_BYTE_CEILING,
  AGENT_RUN_STATUSES,
  AGENT_RUN_TRANSITIONS,
  budgetVector,
  evaluateTransition,
} from "../../shared/agentHarness/execution";
import { canTransitionRun } from "../intelligence/lifecycle";
import {
  admitCapabilityCallWithCtx,
  advanceCompatibilityEpochWithCtx,
  beginProgramAttemptWithCtx,
  cancelAgentRunWithCtx,
  completeAgentRunWithCtx,
  getBudgetLedgerForRun,
  getCurrentCompatibilityEpochWithCtx,
  listCapabilityCallsForRun,
  listProgramAttemptsForRun,
  markAgentRunRunningWithCtx,
  markCapabilityCallExecutingWithCtx,
  recoverStaleAttemptsWithCtx,
  repairFencedRunsWithCtx,
  settleCapabilityCallWithCtx,
  transitionAgentRunWithCtx,
  transitionProgramAttemptWithCtx,
} from "./lifecycle";
import { loadProvisionalNarrativeByBindingWithCtx, upsertProvisionalNarrativeWithCtx } from "./provisionalNarrative";
import { TEST_NOW, buildRunInput, seedRun, seedTenant } from "./testSupport";
import { advanceTurnBindingWithCtx, recordTurnIntentWithCtx } from "./turnBindings";

const modules = Object.fromEntries(
  Object.entries(import.meta.glob("../**/*.ts")).map(([path, loader]) => [
    path.startsWith("../")
      ? path.replace(/^\.\.\//, "./")
      : path.replace(/^\.\//, "./agentHarness/"),
    loader,
  ]),
);

type Tenant = Awaited<ReturnType<typeof seedTenant>>;

async function seedRunningRun(
  ctx: MutationCtx,
  tenant: Tenant,
  overrides: Parameters<typeof seedRun>[2] = {},
) {
  const created = await seedRun(ctx, tenant, overrides);
  await markAgentRunRunningWithCtx(ctx, { runId: created.runId, now: TEST_NOW });
  return created;
}

async function seedExecutingAttempt(
  ctx: MutationCtx,
  runId: Id<"intelligenceRun">,
  key = "attempt-1",
) {
  const begun = await beginProgramAttemptWithCtx(ctx, {
    runId,
    attemptIdempotencyKey: key,
    programSource: "return athena.sales.list();",
    now: TEST_NOW,
  });
  if (begun.outcome === "denied") throw new Error(begun.denial.code);
  await transitionProgramAttemptWithCtx(ctx, {
    attemptId: begun.attemptId,
    to: "validating",
    now: TEST_NOW,
  });
  await transitionProgramAttemptWithCtx(ctx, {
    attemptId: begun.attemptId,
    to: "executing",
    now: TEST_NOW,
    leaseMs: 30_000,
  });
  return begun.attemptId;
}

async function admitAndSettleCall(
  ctx: MutationCtx,
  input: {
    runId: Id<"intelligenceRun">;
    attemptId: Id<"agentProgramAttempt">;
    key: string;
    resultHash?: string;
    sourceRef?: { table: string; id: string };
  },
) {
  const admitted = await admitCapabilityCallWithCtx(ctx, {
    runId: input.runId,
    attemptId: input.attemptId,
    callIdempotencyKey: input.key,
    capabilityId: "cap.sales.list",
    normalizedArgsHash: "args:1",
    requested: budgetVector({ calls: 1, rows: 100, bytes: 10_000, costUnits: 5, elapsedMs: 5_000 }),
    now: TEST_NOW,
  });
  if (admitted.outcome === "denied") throw new Error(admitted.denial.code);
  await markCapabilityCallExecutingWithCtx(ctx, { callId: admitted.callId, now: TEST_NOW });
  await settleCapabilityCallWithCtx(ctx, {
    callId: admitted.callId,
    outcome: "succeeded",
    actual: { rows: 10, bytes: 1_000, costUnits: 1, elapsedMs: 100 },
    resultHash: input.resultHash ?? "result:1",
    sourceRefs: [input.sourceRef ?? { table: "sale", id: "sale-1" }],
    output: { rows: [{ id: "sale-1", total: 10 }] },
    now: TEST_NOW,
  });
  return admitted.callId;
}

function completionInput(
  runId: Id<"intelligenceRun">,
  attemptId: Id<"agentProgramAttempt">,
  callId: Id<"agentCapabilityCall">,
  idempotencyKey = "complete-1",
) {
  return {
    runId,
    idempotencyKey,
    now: TEST_NOW + 1_000,
    citedAttemptIds: [attemptId],
    artifact: { title: "Answer", summary: "Sales were fine.", payload: { answer: "ok" } },
    citations: [
      {
        citationKey: "c1",
        callId,
        resultHash: "result:1",
        sourceRef: { table: "sale", id: "sale-1" },
      },
    ],
  };
}

describe("agent run creation and context metadata", () => {
  it("creates the business run with exactly one immutable grant and ledger pinned to the current epoch", async () => {
    const t = convexTest(schema, modules);
    const created = await t.run(async (ctx) => {
      const tenant = await seedTenant(ctx, "grant-store");
      return seedRun(ctx, tenant);
    });

    await t.run(async (ctx) => {
      const run = await ctx.db.get("intelligenceRun", created.runId);
      expect(run).toMatchObject({
        status: "context_captured",
        harnessKind: "agent",
        compatibilityEpoch: 0,
        runGrantId: created.grantId,
        capability: "agent:daily_operations",
      });
      const grants = await ctx.db
        .query("agentRunGrant")
        .withIndex("by_runId", (q) => q.eq("runId", created.runId))
        .take(5);
      expect(grants).toHaveLength(1);
      expect(grants[0]).toMatchObject({
        grantKind: "agent_delegation",
        promptPayloadHash: "sha256:prompt",
        promptPayloadState: "stored",
        lifecycle: "retained",
        compatibilityEpoch: 0,
        adapterKind: "fake_runtime",
      });
      const ledger = await getBudgetLedgerForRun(ctx, created.runId);
      expect(ledger).toMatchObject({
        charged: budgetVector({}),
        outstanding: budgetVector({}),
        limits: budgetVector({ calls: 5, rows: 1_000, bytes: 100_000, costUnits: 50, elapsedMs: 60_000 }),
      });
    });
  });

  it("keeps the shared run table in step with the intelligence lifecycle", () => {
    for (const from of AGENT_RUN_STATUSES) {
      for (const to of AGENT_RUN_STATUSES) {
        if (from === to) continue;
        expect(
          evaluateTransition(AGENT_RUN_TRANSITIONS, from, to).kind === "advance",
          `${from} -> ${to}`,
        ).toBe(canTransitionRun(from, to));
      }
    }
  });
});

describe("run transitions (scenarios 1-3)", () => {
  it("advances legal transitions once and replays terminal transitions idempotently", async () => {
    const t = convexTest(schema, modules);
    const { runId } = await t.run(async (ctx) => {
      const tenant = await seedTenant(ctx, "transitions");
      return seedRun(ctx, tenant);
    });

    await t.run(async (ctx) => {
      expect(
        await transitionAgentRunWithCtx(ctx, { runId, to: "running", idempotencyKey: "run-1", now: TEST_NOW }),
      ).toMatchObject({ outcome: "advanced", status: "running" });
      expect(
        await transitionAgentRunWithCtx(ctx, { runId, to: "running", idempotencyKey: "run-2", now: TEST_NOW }),
      ).toMatchObject({ outcome: "already_in_state", status: "running" });
      const failed = await transitionAgentRunWithCtx(ctx, {
        runId,
        to: "failed",
        idempotencyKey: "fail-1",
        now: TEST_NOW,
        error: { code: "sandbox_failure", message: "The program could not run." },
      });
      expect(failed).toMatchObject({ outcome: "advanced", status: "failed" });
      // Same terminal request again: idempotent, no error.
      expect(
        await transitionAgentRunWithCtx(ctx, { runId, to: "failed", idempotencyKey: "fail-1", now: TEST_NOW + 1 }),
      ).toMatchObject({ outcome: "already_in_state", status: "failed" });
      const run = await ctx.db.get("intelligenceRun", runId);
      expect(run).toMatchObject({ status: "failed", terminalIdempotencyKey: "fail-1" });
      expect(run?.completedAt).toBe(TEST_NOW);
    });
  });

  it("rejects every regression out of a terminal run state", async () => {
    const t = convexTest(schema, modules);
    const { runId } = await t.run(async (ctx) => {
      const tenant = await seedTenant(ctx, "regression");
      const created = await seedRunningRun(ctx, tenant);
      await cancelAgentRunWithCtx(ctx, { runId: created.runId, idempotencyKey: "cancel-1", reason: "operator", now: TEST_NOW });
      return created;
    });

    await t.run(async (ctx) => {
      for (const to of ["queued", "context_captured", "running", "completed", "failed"] as const) {
        const result = await transitionAgentRunWithCtx(ctx, { runId, to, idempotencyKey: `x-${to}`, now: TEST_NOW });
        expect(result.outcome, to).toBe("already_terminal");
        expect(result.status).toBe("canceled");
      }
      expect((await ctx.db.get("intelligenceRun", runId))?.status).toBe("canceled");
    });
  });

  it("rejects illegal non-terminal jumps with a typed denial", async () => {
    const t = convexTest(schema, modules);
    const { runId } = await t.run(async (ctx) => {
      const tenant = await seedTenant(ctx, "illegal");
      return seedRun(ctx, tenant);
    });
    await t.run(async (ctx) => {
      const result = await transitionAgentRunWithCtx(ctx, { runId, to: "completed", idempotencyKey: "c", now: TEST_NOW });
      expect(result).toMatchObject({ outcome: "rejected", denial: { code: "run_not_running" } });
      expect((await ctx.db.get("intelligenceRun", runId))?.status).toBe("context_captured");
    });
  });

  it("never produces two terminal outcomes when cancellation races completion", async () => {
    const t = convexTest(schema, modules);
    const seeded = await t.run(async (ctx) => {
      const tenant = await seedTenant(ctx, "race");
      const a = await seedRunningRun(ctx, tenant, { runIdempotencyKey: "turn-a" });
      const b = await seedRunningRun(ctx, tenant, { runIdempotencyKey: "turn-b" });
      const aAttempt = await seedExecutingAttempt(ctx, a.runId);
      const aCall = await admitAndSettleCall(ctx, { runId: a.runId, attemptId: aAttempt, key: "call-a" });
      await transitionProgramAttemptWithCtx(ctx, { attemptId: aAttempt, to: "result_produced", now: TEST_NOW, result: { resultHash: "program:a" } });
      const bAttempt = await seedExecutingAttempt(ctx, b.runId);
      const bCall = await admitAndSettleCall(ctx, { runId: b.runId, attemptId: bAttempt, key: "call-b" });
      await transitionProgramAttemptWithCtx(ctx, { attemptId: bAttempt, to: "result_produced", now: TEST_NOW, result: { resultHash: "program:b" } });
      return { a, b, aAttempt, aCall, bAttempt, bCall };
    });

    // Order 1: completion wins, cancellation arrives late.
    await t.run(async (ctx) => {
      const completed = await completeAgentRunWithCtx(ctx, completionInput(seeded.a.runId, seeded.aAttempt, seeded.aCall));
      expect(completed.outcome).toBe("completed");
      const canceled = await cancelAgentRunWithCtx(ctx, { runId: seeded.a.runId, idempotencyKey: "cancel-late", reason: "operator", now: TEST_NOW + 2_000 });
      expect(canceled).toMatchObject({ outcome: "already_terminal", status: "completed" });
      // Replaying the winning completion key is a no-op that returns the same artifact.
      const replay = await completeAgentRunWithCtx(ctx, completionInput(seeded.a.runId, seeded.aAttempt, seeded.aCall));
      expect(replay).toMatchObject({ outcome: "already_terminal", status: "completed" });
      if (completed.outcome === "completed" && replay.outcome === "already_terminal") {
        expect(replay.artifactId).toBe(completed.artifactId);
      }
      const artifacts = await ctx.db
        .query("intelligenceArtifact")
        .withIndex("by_runId", (q) => q.eq("runId", seeded.a.runId))
        .take(5);
      expect(artifacts).toHaveLength(1);
      expect(artifacts[0]).toMatchObject({ kind: "agent_answer", status: "ready", runGrantId: seeded.a.grantId });
    });

    // Order 2: cancellation wins, completion arrives late.
    await t.run(async (ctx) => {
      const canceled = await cancelAgentRunWithCtx(ctx, { runId: seeded.b.runId, idempotencyKey: "cancel-first", reason: "operator", now: TEST_NOW + 500 });
      expect(canceled).toMatchObject({ outcome: "advanced", status: "canceled" });
      const completed = await completeAgentRunWithCtx(ctx, completionInput(seeded.b.runId, seeded.bAttempt, seeded.bCall));
      expect(completed).toMatchObject({ outcome: "already_terminal", status: "canceled" });
      const artifacts = await ctx.db
        .query("intelligenceArtifact")
        .withIndex("by_runId", (q) => q.eq("runId", seeded.b.runId))
        .take(5);
      expect(artifacts).toHaveLength(0);
      const citations = await ctx.db
        .query("agentCitationBinding")
        .withIndex("by_runId_citationKey", (q) => q.eq("runId", seeded.b.runId))
        .take(5);
      expect(citations).toHaveLength(0);
      expect((await ctx.db.get("intelligenceRun", seeded.b.runId))?.terminalIdempotencyKey).toBe("cancel-first");
    });
  });

  it("refuses to cite attempts or calls that are not in the successful set", async () => {
    const t = convexTest(schema, modules);
    const seeded = await t.run(async (ctx) => {
      const tenant = await seedTenant(ctx, "citations");
      const run = await seedRunningRun(ctx, tenant);
      const attempt = await seedExecutingAttempt(ctx, run.runId);
      const call = await admitAndSettleCall(ctx, { runId: run.runId, attemptId: attempt, key: "call-1" });
      return { run, attempt, call };
    });

    await t.run(async (ctx) => {
      // Attempt still executing: not a successful attempt.
      const rejected = await completeAgentRunWithCtx(ctx, completionInput(seeded.run.runId, seeded.attempt, seeded.call));
      expect(rejected).toMatchObject({ outcome: "rejected", denial: { code: "citation_not_supported" } });
      await transitionProgramAttemptWithCtx(ctx, { attemptId: seeded.attempt, to: "result_produced", now: TEST_NOW, result: { resultHash: "program:1" } });
      // Wrong result hash: the citation is not bound to data actually returned.
      const input = completionInput(seeded.run.runId, seeded.attempt, seeded.call);
      input.citations[0].resultHash = "result:forged";
      expect(await completeAgentRunWithCtx(ctx, input)).toMatchObject({ outcome: "rejected", denial: { code: "citation_not_supported" } });
      expect((await ctx.db.get("intelligenceRun", seeded.run.runId))?.status).toBe("running");
      expect(await completeAgentRunWithCtx(ctx, completionInput(seeded.run.runId, seeded.attempt, seeded.call))).toMatchObject({ outcome: "completed" });
    });
  });
});

describe("terminal clamp and the provisional narrative", () => {
  /** A running turn with a binding (so the clamp has something to key on) and one provisional row. */
  async function seedStreamingTurn(ctx: MutationCtx, tenant: Tenant, key: string) {
    const { runIdempotencyKey: _k, promptPayloadHash: _h, ...base } = buildRunInput(tenant);
    const intent = await recordTurnIntentWithCtx(ctx, { ...base, turnIdempotencyKey: key, runtimeThreadRef: `thread:${key}`, promptPayload: { prompt: key } });
    if (intent.outcome !== "created") throw new Error(intent.outcome);
    for (const [step, refs] of [
      ["runtime_thread_bound", {}],
      ["runtime_input_saved", { runtimeInputRef: `message:${key}` }],
      ["scheduled", { runtimeScheduleRef: `job:${key}` }],
      ["running", {}],
    ] as const) {
      const result = await advanceTurnBindingWithCtx(ctx, { bindingId: intent.bindingId, step, idempotencyKey: `${key}-${step}`, now: TEST_NOW, ...refs });
      if (result.outcome === "rejected") throw new Error(result.denial.code);
    }
    await upsertProvisionalNarrativeWithCtx(ctx, {
      runId: intent.runId,
      turnBindingId: intent.bindingId,
      storeId: tenant.storeId,
      organizationId: tenant.organizationId,
      text: "Checking the day.",
      draftOrdinal: 0,
      truncated: false,
      egressClass: "operational",
      updatedAt: TEST_NOW,
      expiresAt: TEST_NOW + 60_000,
    });
    return intent;
  }

  it("deletes the row atomically with every non-completed terminal transition, keyed on the run's binding", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const tenant = await seedTenant(ctx, "clamp");
      const canceled = await seedStreamingTurn(ctx, tenant, "c1");
      const failed = await seedStreamingTurn(ctx, tenant, "f1");
      // The binding is abandoned by the same clamp: the row delete must not sit
      // inside that guard, so a second terminal write on an already-abandoned
      // binding still has nothing left to leak.
      expect(await cancelAgentRunWithCtx(ctx, { runId: canceled.runId, idempotencyKey: "cancel", reason: "operator_canceled", now: TEST_NOW + 1 })).toMatchObject({ outcome: "advanced" });
      expect(await loadProvisionalNarrativeByBindingWithCtx(ctx, canceled.bindingId)).toBeNull();
      expect(await ctx.db.get("agentTurnBinding", canceled.bindingId)).toMatchObject({ abandonedAt: TEST_NOW + 1 });

      expect(await transitionAgentRunWithCtx(ctx, { runId: failed.runId, to: "failed", idempotencyKey: "fail", now: TEST_NOW + 2, error: { code: "provider_failure", message: "x", retryable: true } })).toMatchObject({ outcome: "advanced" });
      expect(await loadProvisionalNarrativeByBindingWithCtx(ctx, failed.bindingId)).toBeNull();
    });
  });

  it("leaves the row to finalize on a successful commit: the commit transaction itself ends in the clamp", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const tenant = await seedTenant(ctx, "clamp-commit");
      const turn = await seedStreamingTurn(ctx, tenant, "k1");
      const attemptId = await seedExecutingAttempt(ctx, turn.runId);
      const callId = await admitAndSettleCall(ctx, { runId: turn.runId, attemptId, key: "call-1" });
      await transitionProgramAttemptWithCtx(ctx, { attemptId, to: "result_produced", now: TEST_NOW, result: { resultHash: "program:1" } });
      const completed = await completeAgentRunWithCtx(ctx, completionInput(turn.runId, attemptId, callId));
      expect(completed.outcome).toBe("completed");
      expect(await ctx.db.get("intelligenceRun", turn.runId)).toMatchObject({ status: "completed" });
      expect(await ctx.db.get("agentTurnBinding", turn.bindingId)).toMatchObject({ step: "athena_committed" });
      expect(await loadProvisionalNarrativeByBindingWithCtx(ctx, turn.bindingId)).not.toBeNull();
    });
  });
});

describe("attempts, calls, and budgets", () => {
  it("reserves before work, settles once per idempotency key, and denies beyond the run budget", async () => {
    const t = convexTest(schema, modules);
    const seeded = await t.run(async (ctx) => {
      const tenant = await seedTenant(ctx, "budget");
      const run = await seedRunningRun(ctx, tenant, {
        budgetPolicy: {
          runLimits: budgetVector({ calls: 3, rows: 150, bytes: 100_000, costUnits: 50, elapsedMs: 60_000 }),
          maxAttempts: 3,
        },
      });
      const attempt = await seedExecutingAttempt(ctx, run.runId);
      return { run, attempt };
    });
    const requested = budgetVector({ calls: 1, rows: 100, bytes: 10_000, costUnits: 5, elapsedMs: 5_000 });

    await t.run(async (ctx) => {
      const first = await admitCapabilityCallWithCtx(ctx, {
        runId: seeded.run.runId,
        attemptId: seeded.attempt,
        callIdempotencyKey: "call-1",
        capabilityId: "cap.sales.list",
        normalizedArgsHash: "args:1",
        requested,
        now: TEST_NOW,
      });
      expect(first).toMatchObject({ outcome: "admitted" });
      // Retry with the same key: no second reservation, no double spend.
      const retry = await admitCapabilityCallWithCtx(ctx, {
        runId: seeded.run.runId,
        attemptId: seeded.attempt,
        callIdempotencyKey: "call-1",
        capabilityId: "cap.sales.list",
        normalizedArgsHash: "args:1",
        requested,
        now: TEST_NOW,
      });
      expect(retry).toMatchObject({ outcome: "resumed" });
      if (first.outcome !== "denied" && retry.outcome !== "denied") {
        expect(retry.callId).toBe(first.callId);
        expect(retry.reservationId).toBe(first.reservationId);
      }
      let ledger = await getBudgetLedgerForRun(ctx, seeded.run.runId);
      expect(ledger).toMatchObject({ outstanding: requested, charged: budgetVector({}), reservationCount: 1 });

      // A second concurrent call would exceed rows (100 outstanding + 100 > 150): denied, charged one call attempt only.
      const denied = await admitCapabilityCallWithCtx(ctx, {
        runId: seeded.run.runId,
        attemptId: seeded.attempt,
        callIdempotencyKey: "call-2",
        capabilityId: "cap.sales.list",
        normalizedArgsHash: "args:2",
        requested,
        now: TEST_NOW,
      });
      expect(denied).toMatchObject({ outcome: "denied", denial: { code: "budget_exceeded", detail: { exceeded: ["rows"] } } });
      ledger = await getBudgetLedgerForRun(ctx, seeded.run.runId);
      expect(ledger?.charged).toEqual(budgetVector({ calls: 1 }));
      expect(ledger?.outstanding).toEqual(requested);
      const deniedCall = denied.outcome === "denied" && denied.callId ? await ctx.db.get("agentCapabilityCall", denied.callId) : null;
      expect(deniedCall).toMatchObject({ status: "denied", charged: budgetVector({ calls: 1 }) });

      // Settle the first call: actual usage charged, remainder refunded, exactly once.
      if (first.outcome === "denied") throw new Error("unexpected");
      await markCapabilityCallExecutingWithCtx(ctx, { callId: first.callId, now: TEST_NOW });
      const settled = await settleCapabilityCallWithCtx(ctx, {
        callId: first.callId,
        outcome: "succeeded",
        actual: { rows: 40, bytes: 4_000, costUnits: 2, elapsedMs: 1_200 },
        resultHash: "result:1",
        sourceRefs: [{ table: "sale", id: "sale-1" }],
        output: { rows: [] },
        now: TEST_NOW + 10,
      });
      expect(settled).toMatchObject({ outcome: "settled", status: "succeeded" });
      const again = await settleCapabilityCallWithCtx(ctx, {
        callId: first.callId,
        outcome: "succeeded",
        actual: { rows: 40, bytes: 4_000, costUnits: 2, elapsedMs: 1_200 },
        resultHash: "result:1",
        now: TEST_NOW + 20,
      });
      expect(again).toMatchObject({ outcome: "already_settled", status: "succeeded" });
      ledger = await getBudgetLedgerForRun(ctx, seeded.run.runId);
      expect(ledger).toMatchObject({
        charged: budgetVector({ calls: 2, rows: 40, bytes: 4_000, costUnits: 2, elapsedMs: 1_200 }),
        outstanding: budgetVector({}),
        // The denied call is an audit-visible settled reservation too.
        reservationCount: 2,
        settledCount: 2,
      });
      // The refund makes room for a new call (rows 40 + 100 <= 150) but a third call attempt reaches the call cap afterwards.
      const third = await admitCapabilityCallWithCtx(ctx, {
        runId: seeded.run.runId,
        attemptId: seeded.attempt,
        callIdempotencyKey: "call-3",
        capabilityId: "cap.sales.list",
        normalizedArgsHash: "args:3",
        requested,
        now: TEST_NOW,
      });
      expect(third).toMatchObject({ outcome: "admitted" });
      const fourth = await admitCapabilityCallWithCtx(ctx, {
        runId: seeded.run.runId,
        attemptId: seeded.attempt,
        callIdempotencyKey: "call-4",
        capabilityId: "cap.sales.list",
        normalizedArgsHash: "args:4",
        requested,
        now: TEST_NOW,
      });
      expect(fourth).toMatchObject({ outcome: "denied", denial: { code: "budget_exceeded" } });
    });
  });

  it("applies the denial, unavailable, timeout, and cancel settlement rules to the ledger", async () => {
    const t = convexTest(schema, modules);
    const seeded = await t.run(async (ctx) => {
      const tenant = await seedTenant(ctx, "settlement");
      const run = await seedRunningRun(ctx, tenant, {
        budgetPolicy: { runLimits: budgetVector({ calls: 10, rows: 10_000, bytes: 1_000_000, costUnits: 500, elapsedMs: 600_000 }), maxAttempts: 3 },
      });
      const attempt = await seedExecutingAttempt(ctx, run.runId);
      return { run, attempt };
    });
    const requested = budgetVector({ calls: 1, rows: 100, bytes: 10_000, costUnits: 5, elapsedMs: 5_000 });

    await t.run(async (ctx) => {
      const admit = async (key: string) => {
        const result = await admitCapabilityCallWithCtx(ctx, {
          runId: seeded.run.runId,
          attemptId: seeded.attempt,
          callIdempotencyKey: key,
          capabilityId: "cap.sales.list",
          normalizedArgsHash: `args:${key}`,
          requested,
          now: TEST_NOW,
        });
        if (result.outcome === "denied") throw new Error(result.denial.code);
        await markCapabilityCallExecutingWithCtx(ctx, { callId: result.callId, now: TEST_NOW });
        return result.callId;
      };
      const unavailable = await admit("u");
      await settleCapabilityCallWithCtx(ctx, { callId: unavailable, outcome: "unavailable", actual: { elapsedMs: 700 }, now: TEST_NOW });
      const timeout = await admit("t");
      await settleCapabilityCallWithCtx(ctx, { callId: timeout, outcome: "timeout", now: TEST_NOW });
      const canceled = await admit("c");
      await settleCapabilityCallWithCtx(ctx, { callId: canceled, outcome: "canceled", actual: { rows: 10 }, now: TEST_NOW });

      const ledger = await getBudgetLedgerForRun(ctx, seeded.run.runId);
      expect(ledger?.charged).toEqual(
        budgetVector({
          calls: 3,
          rows: 0 + 100 + 10,
          bytes: 0 + 10_000 + 10_000,
          costUnits: 0 + 5 + 5,
          elapsedMs: 700 + 5_000 + 5_000,
        }),
      );
      expect(ledger?.outstanding).toEqual(budgetVector({}));
      const calls = await listCapabilityCallsForRun(ctx, seeded.run.runId);
      expect(calls.map((call) => call.status).sort()).toEqual(["canceled", "failed", "unavailable"].sort());
      const reservations = await ctx.db
        .query("agentBudgetReservation")
        .withIndex("by_runId_status", (q) => q.eq("runId", seeded.run.runId).eq("status", "settled"))
        .take(10);
      expect(reservations).toHaveLength(3);
      expect(reservations.filter((r) => r.conservative)).toHaveLength(2);
    });
  });

  it("stores bounded call output as short-lived replay evidence and omits output over the ceiling", async () => {
    const t = convexTest(schema, modules);
    const seeded = await t.run(async (ctx) => {
      const tenant = await seedTenant(ctx, "ceiling");
      const run = await seedRunningRun(ctx, tenant, {
        budgetPolicy: { runLimits: budgetVector({ calls: 10, rows: 10_000, bytes: 1_000_000, costUnits: 500, elapsedMs: 600_000 }), maxAttempts: 3 },
      });
      const attempt = await seedExecutingAttempt(ctx, run.runId);
      return { run, attempt };
    });

    await t.run(async (ctx) => {
      const small = await admitAndSettleCall(ctx, { runId: seeded.run.runId, attemptId: seeded.attempt, key: "small" });
      const smallCall = await ctx.db.get("agentCapabilityCall", small);
      expect(smallCall?.replayPayloadId).toBeDefined();
      const payload = smallCall?.replayPayloadId ? await ctx.db.get("agentReplayPayload", smallCall.replayPayloadId) : null;
      expect(payload).toMatchObject({ subjectKind: "call_output", retentionClass: "short_lived", callId: small });
      expect(payload?.expiresAt).toBe(TEST_NOW + 30 * 86_400_000);

      const admitted = await admitCapabilityCallWithCtx(ctx, {
        runId: seeded.run.runId,
        attemptId: seeded.attempt,
        callIdempotencyKey: "large",
        capabilityId: "cap.sales.list",
        normalizedArgsHash: "args:large",
        requested: budgetVector({ calls: 1, rows: 100, bytes: 500_000, costUnits: 5, elapsedMs: 5_000 }),
        now: TEST_NOW,
      });
      if (admitted.outcome === "denied") throw new Error(admitted.denial.code);
      await markCapabilityCallExecutingWithCtx(ctx, { callId: admitted.callId, now: TEST_NOW });
      const settled = await settleCapabilityCallWithCtx(ctx, {
        callId: admitted.callId,
        outcome: "succeeded",
        actual: { rows: 1, bytes: 300_000, costUnits: 1, elapsedMs: 10 },
        resultHash: "result:large",
        output: { blob: "x".repeat(AGENT_CALL_EVIDENCE_BYTE_CEILING + 1) },
        now: TEST_NOW,
      });
      expect(settled).toMatchObject({ outcome: "settled", status: "succeeded" });
      const largeCall = await ctx.db.get("agentCapabilityCall", admitted.callId);
      expect(largeCall?.replayPayloadId).toBeUndefined();
      expect(largeCall?.outputOmittedReason).toBe("evidence_payload_exceeds_ceiling");
      expect(largeCall?.resultHash).toBe("result:large");
    });
  });

  it("recovers a stale executing attempt without reopening the run budget (scenario 4)", async () => {
    const t = convexTest(schema, modules);
    const seeded = await t.run(async (ctx) => {
      const tenant = await seedTenant(ctx, "stale");
      const run = await seedRunningRun(ctx, tenant);
      const attempt = await seedExecutingAttempt(ctx, run.runId);
      const admitted = await admitCapabilityCallWithCtx(ctx, {
        runId: run.runId,
        attemptId: attempt,
        callIdempotencyKey: "in-flight",
        capabilityId: "cap.sales.list",
        normalizedArgsHash: "args:1",
        requested: budgetVector({ calls: 1, rows: 100, bytes: 10_000, costUnits: 5, elapsedMs: 5_000 }),
        now: TEST_NOW,
      });
      if (admitted.outcome === "denied") throw new Error(admitted.denial.code);
      await markCapabilityCallExecutingWithCtx(ctx, { callId: admitted.callId, now: TEST_NOW });
      return { run, attempt, callId: admitted.callId };
    });

    await t.run(async (ctx) => {
      const before = await getBudgetLedgerForRun(ctx, seeded.run.runId);
      // Before the lease expires nothing is recovered.
      expect(await recoverStaleAttemptsWithCtx(ctx, { now: TEST_NOW + 29_000, limit: 10 })).toEqual({ recovered: 0, hasMore: false });
      const recovered = await recoverStaleAttemptsWithCtx(ctx, { now: TEST_NOW + 31_000, limit: 10 });
      expect(recovered).toEqual({ recovered: 1, hasMore: false });

      const attempt = await ctx.db.get("agentProgramAttempt", seeded.attempt);
      expect(attempt).toMatchObject({ status: "failed", error: { code: "stale_execution", retryable: true } });
      const call = await ctx.db.get("agentCapabilityCall", seeded.callId);
      expect(call?.status).toBe("canceled");
      const after = await getBudgetLedgerForRun(ctx, seeded.run.runId);
      // Outstanding reservation settled conservatively: moved to charged, never refunded.
      expect(after?.outstanding).toEqual(budgetVector({}));
      expect(after?.charged).toEqual(before?.outstanding);
      expect(after?.limits).toEqual(before?.limits);
      // The run is still running and a fresh attempt can proceed with the remaining budget only.
      expect((await ctx.db.get("intelligenceRun", seeded.run.runId))?.status).toBe("running");
      const next = await beginProgramAttemptWithCtx(ctx, {
        runId: seeded.run.runId,
        attemptIdempotencyKey: "attempt-2",
        programSource: "return 1;",
        now: TEST_NOW + 31_000,
      });
      expect(next).toMatchObject({ outcome: "created", sequence: 2 });
      // Recovery is idempotent.
      expect(await recoverStaleAttemptsWithCtx(ctx, { now: TEST_NOW + 32_000, limit: 10 })).toEqual({ recovered: 0, hasMore: false });
    });
  });

  it("caps attempts per run and never grants a retry a fresh budget", async () => {
    const t = convexTest(schema, modules);
    const seeded = await t.run(async (ctx) => {
      const tenant = await seedTenant(ctx, "attempt-cap");
      const run = await seedRunningRun(ctx, tenant, {
        budgetPolicy: { runLimits: budgetVector({ calls: 10, rows: 10_000, bytes: 1_000_000, costUnits: 500, elapsedMs: 600_000 }), maxAttempts: 2 },
      });
      return run;
    });
    await t.run(async (ctx) => {
      const first = await beginProgramAttemptWithCtx(ctx, { runId: seeded.runId, attemptIdempotencyKey: "a1", programSource: "1", now: TEST_NOW });
      expect(first).toMatchObject({ outcome: "created", sequence: 1 });
      expect(await beginProgramAttemptWithCtx(ctx, { runId: seeded.runId, attemptIdempotencyKey: "a1", programSource: "1", now: TEST_NOW })).toMatchObject({ outcome: "resumed", sequence: 1 });
      expect(await beginProgramAttemptWithCtx(ctx, { runId: seeded.runId, attemptIdempotencyKey: "a2", programSource: "2", now: TEST_NOW })).toMatchObject({ outcome: "created", sequence: 2 });
      expect(await beginProgramAttemptWithCtx(ctx, { runId: seeded.runId, attemptIdempotencyKey: "a3", programSource: "3", now: TEST_NOW })).toMatchObject({ outcome: "denied", denial: { code: "attempt_cap_exceeded" } });
      const ledger = await getBudgetLedgerForRun(ctx, seeded.runId);
      expect(ledger?.attemptCount).toBe(2);
      const attempts = await listProgramAttemptsForRun(ctx, seeded.runId);
      expect(attempts.map((a) => a.sequence)).toEqual([1, 2]);
      // Attempt rows never carry their own limits: there is one ledger per run.
      const ledgers = await ctx.db.query("agentBudgetLedger").withIndex("by_runId", (q) => q.eq("runId", seeded.runId)).take(5);
      expect(ledgers).toHaveLength(1);
    });
  });
});

describe("tenant, store, and run isolation (scenario 5)", () => {
  it("keeps child evidence addressable by run and store indexes only and refuses cross-run use", async () => {
    const t = convexTest(schema, modules);
    const seeded = await t.run(async (ctx) => {
      const tenantA = await seedTenant(ctx, "tenant-a");
      const tenantB = await seedTenant(ctx, "tenant-b");
      const runA = await seedRunningRun(ctx, tenantA, { runIdempotencyKey: "a" });
      const runB = await seedRunningRun(ctx, tenantB, { runIdempotencyKey: "b" });
      const attemptA = await seedExecutingAttempt(ctx, runA.runId);
      const attemptB = await seedExecutingAttempt(ctx, runB.runId);
      const callA = await admitAndSettleCall(ctx, { runId: runA.runId, attemptId: attemptA, key: "a-1" });
      const callB = await admitAndSettleCall(ctx, { runId: runB.runId, attemptId: attemptB, key: "b-1" });
      return { tenantA, tenantB, runA, runB, attemptA, attemptB, callA, callB };
    });

    await t.run(async (ctx) => {
      const callsA = await listCapabilityCallsForRun(ctx, seeded.runA.runId);
      expect(callsA.map((c) => c._id)).toEqual([seeded.callA]);
      const attemptsB = await listProgramAttemptsForRun(ctx, seeded.runB.runId);
      expect(attemptsB.map((a) => a._id)).toEqual([seeded.attemptB]);
      // Every child carries the tenant keys of its run.
      for (const call of callsA) {
        expect(call.storeId).toBe(seeded.tenantA.storeId);
        expect(call.organizationId).toBe(seeded.tenantA.organizationId);
      }
      const storeBCalls = await ctx.db
        .query("agentCapabilityCall")
        .withIndex("by_storeId_capabilityId_createdAt", (q) => q.eq("storeId", seeded.tenantB.storeId).eq("capabilityId", "cap.sales.list"))
        .take(10);
      expect(storeBCalls.map((c) => c._id)).toEqual([seeded.callB]);

      // Run A cannot admit a call on run B's attempt.
      const crossed = await admitCapabilityCallWithCtx(ctx, {
        runId: seeded.runA.runId,
        attemptId: seeded.attemptB,
        callIdempotencyKey: "crossed",
        capabilityId: "cap.sales.list",
        normalizedArgsHash: "args:x",
        requested: budgetVector({ calls: 1 }),
        now: TEST_NOW,
      });
      expect(crossed).toMatchObject({ outcome: "denied", denial: { code: "attempt_not_owned_by_run" } });
      // Run A cannot cite run B's call.
      await transitionProgramAttemptWithCtx(ctx, { attemptId: seeded.attemptA, to: "result_produced", now: TEST_NOW, result: { resultHash: "program:a" } });
      const input = completionInput(seeded.runA.runId, seeded.attemptA, seeded.callB);
      expect(await completeAgentRunWithCtx(ctx, input)).toMatchObject({ outcome: "rejected", denial: { code: "citation_not_supported" } });
      // Ledgers are independent.
      const ledgerA = await getBudgetLedgerForRun(ctx, seeded.runA.runId);
      const ledgerB = await getBudgetLedgerForRun(ctx, seeded.runB.runId);
      expect(ledgerA?.charged.calls).toBe(1);
      expect(ledgerB?.charged.calls).toBe(1);
    });
  });
});

describe("compatibility epoch fence (scenario 10)", () => {
  it("fences old-epoch runs immediately and repairs them in a bounded pass", async () => {
    const t = convexTest(schema, modules);
    const seeded = await t.run(async (ctx) => {
      const tenant = await seedTenant(ctx, "epoch");
      const run = await seedRunningRun(ctx, tenant);
      const attempt = await seedExecutingAttempt(ctx, run.runId);
      const call = await admitAndSettleCall(ctx, { runId: run.runId, attemptId: attempt, key: "call-1" });
      await transitionProgramAttemptWithCtx(ctx, { attemptId: attempt, to: "result_produced", now: TEST_NOW, result: { resultHash: "program:1" } });
      expect(await getCurrentCompatibilityEpochWithCtx(ctx)).toEqual({ epoch: 0, digest: "" });
      return { tenant, run, attempt, call };
    });

    await t.run(async (ctx) => {
      const advanced = await advanceCompatibilityEpochWithCtx(ctx, { epoch: 1, digest: "compat:v2", idempotencyKey: "deploy-2", reason: "incompatible deploy", now: TEST_NOW + 1 });
      expect(advanced).toMatchObject({ outcome: "advanced", epoch: 1 });
      expect(await advanceCompatibilityEpochWithCtx(ctx, { epoch: 1, digest: "compat:v2", idempotencyKey: "deploy-2", now: TEST_NOW + 2 })).toMatchObject({ outcome: "already_applied", epoch: 1 });
      expect(await advanceCompatibilityEpochWithCtx(ctx, { epoch: 0, digest: "compat:v1", idempotencyKey: "rollback", now: TEST_NOW + 3 })).toMatchObject({ outcome: "rejected", epoch: 1 });

      // Before any repair runs, the old run is already fenced at every gate.
      expect((await ctx.db.get("intelligenceRun", seeded.run.runId))?.status).toBe("running");
      const admit = await admitCapabilityCallWithCtx(ctx, {
        runId: seeded.run.runId,
        attemptId: seeded.attempt,
        callIdempotencyKey: "late",
        capabilityId: "cap.sales.list",
        normalizedArgsHash: "args:late",
        requested: budgetVector({ calls: 1 }),
        now: TEST_NOW + 5,
      });
      expect(admit).toMatchObject({ outcome: "denied", denial: { code: "compatibility_epoch_fenced", detail: { runEpoch: 0, currentEpoch: 1 } } });
      const begin = await beginProgramAttemptWithCtx(ctx, { runId: seeded.run.runId, attemptIdempotencyKey: "late-attempt", programSource: "1", now: TEST_NOW + 5 });
      expect(begin).toMatchObject({ outcome: "denied", denial: { code: "compatibility_epoch_fenced" } });
      const complete = await completeAgentRunWithCtx(ctx, completionInput(seeded.run.runId, seeded.attempt, seeded.call));
      expect(complete).toMatchObject({ outcome: "rejected", denial: { code: "compatibility_epoch_fenced" } });

      // A new run pins the new epoch and is not fenced.
      const fresh = await seedRunningRun(ctx, seeded.tenant, { runIdempotencyKey: "fresh" });
      expect((await ctx.db.get("intelligenceRun", fresh.runId))?.compatibilityEpoch).toBe(1);
      expect(await beginProgramAttemptWithCtx(ctx, { runId: fresh.runId, attemptIdempotencyKey: "f1", programSource: "1", now: TEST_NOW + 6 })).toMatchObject({ outcome: "created" });

      // The bounded repair pass cancels old-epoch runs and leaves the new one alone.
      expect(await repairFencedRunsWithCtx(ctx, { now: TEST_NOW + 7, limit: 10 })).toEqual({ canceled: 1, hasMore: false });
      const oldRun = await ctx.db.get("intelligenceRun", seeded.run.runId);
      expect(oldRun).toMatchObject({ status: "canceled", error: { code: "compatibility_epoch_fenced" } });
      expect((await ctx.db.get("intelligenceRun", fresh.runId))?.status).toBe("running");
      // Audit metadata retains the old epoch and digest on the immutable grant.
      const grant = await ctx.db.get("agentRunGrant", seeded.run.grantId);
      expect(grant).toMatchObject({ compatibilityEpoch: 0, compatibilityDigest: "compat:abc" });
      expect(await repairFencedRunsWithCtx(ctx, { now: TEST_NOW + 8, limit: 10 })).toEqual({ canceled: 0, hasMore: false });
    });
  });

  it("exposes the epoch advance and repair as internal mutations that schedule the repair pass", async () => {
    const t = convexTest(schema, modules);
    const seeded = await t.run(async (ctx) => {
      const tenant = await seedTenant(ctx, "epoch-internal");
      const agentRun = await seedRunningRun(ctx, tenant);
      // A provider-backed (non-agent) run carries no epoch and must never be swept by the fence repair.
      const legacyRunId = await ctx.db.insert("intelligenceRun", {
        storeId: tenant.storeId,
        organizationId: tenant.organizationId,
        capability: "store_insights",
        providerKey: "tanstack",
        idempotencyKey: "legacy-1",
        status: "running",
        trigger: "operator",
        principalKind: "athenaUser",
        visibilityMode: "store_admin",
        sourceRefs: [],
        attemptCount: 1,
        createdAt: TEST_NOW,
        updatedAt: TEST_NOW,
      });
      return { ...agentRun, legacyRunId };
    });
    vi.useFakeTimers();
    try {
      const result = await t.mutation(internal.agentHarness.lifecycle.advanceCompatibilityEpoch, {
        epoch: 1,
        digest: "compat:v2",
        idempotencyKey: "deploy-2",
        reason: "incompatible deploy",
      });
      expect(result).toMatchObject({ outcome: "advanced", epoch: 1 });
      await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    } finally {
      vi.useRealTimers();
    }
    const run: Doc<"intelligenceRun"> | null = await t.run((ctx) => ctx.db.get("intelligenceRun", seeded.runId));
    expect(run?.status).toBe("canceled");
    const legacy: Doc<"intelligenceRun"> | null = await t.run((ctx) => ctx.db.get("intelligenceRun", seeded.legacyRunId));
    expect(legacy?.status).toBe("running");

    // The provider-run cancel path refuses agent runs and cancels plain runs idempotently.
    await expect(
      t.mutation(internal.intelligence.runs.cancelRun, { runId: seeded.runId, reason: "operator" }),
    ).rejects.toThrow("Agent harness runs are canceled through the harness lifecycle.");
    expect(await t.mutation(internal.intelligence.runs.cancelRun, { runId: seeded.legacyRunId, reason: "operator" })).toMatchObject({ status: "canceled", canceled: true });
    expect(await t.mutation(internal.intelligence.runs.cancelRun, { runId: seeded.legacyRunId, reason: "operator" })).toMatchObject({ status: "canceled", canceled: false });
  });
});
