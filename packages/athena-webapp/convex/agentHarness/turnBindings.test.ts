/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";

import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import schema from "../schema";
import { budgetVector } from "../../shared/agentHarness/execution";
import {
  admitCapabilityCallWithCtx,
  beginProgramAttemptWithCtx,
  cancelAgentRunWithCtx,
  completeAgentRunWithCtx,
  markCapabilityCallExecutingWithCtx,
  settleCapabilityCallWithCtx,
  transitionProgramAttemptWithCtx,
} from "./lifecycle";
import { reserveTurnSpendWithCtx, spendWindowKey, turnProviderCostReservation } from "./runAdmission";
import { TEST_NOW, buildRunInput, seedTenant } from "./testSupport";
import {
  AGENT_TURN_BINDING_ABANDON_AFTER_MS,
  AGENT_TURN_STEP_STALE_AFTER_MS,
  acknowledgeOperatorViewWithCtx,
  advanceTurnBindingWithCtx,
  listTurnBindingsForThread,
  recordTurnIntentWithCtx,
  resolveTurnWithCtx,
  resumeTurnBindingWithCtx,
  sweepStaleTurnBindingsWithCtx,
  type RecordTurnIntentInput,
} from "./turnBindings";

const modules = Object.fromEntries(
  Object.entries(import.meta.glob("../**/*.ts")).map(([path, loader]) => [
    path.startsWith("../")
      ? path.replace(/^\.\.\//, "./")
      : path.replace(/^\.\//, "./agentHarness/"),
    loader,
  ]),
);

type Tenant = Awaited<ReturnType<typeof seedTenant>>;

/** Narrow an intent result to the created/resumed shape or fail loudly. */
function bound(result: Awaited<ReturnType<typeof recordTurnIntentWithCtx>>) {
  if (result.outcome === "rejected") throw new Error(result.denial.code);
  return result;
}

function intentInput(tenant: Tenant, overrides: Partial<RecordTurnIntentInput> = {}): RecordTurnIntentInput {
  const { runIdempotencyKey: _ignored, ...base } = buildRunInput(tenant);
  return {
    ...base,
    turnIdempotencyKey: "turn-1",
    runtimeThreadRef: "thread:alpha",
    promptPayload: { prompt: "What needs attention today?" },
    ...overrides,
  };
}

async function driveToRunning(ctx: MutationCtx, bindingId: Id<"agentTurnBinding">) {
  for (const [step, refs] of [
    ["runtime_thread_bound", { runtimeThreadRef: "thread:alpha" }],
    ["runtime_input_saved", { runtimeInputRef: "message:1" }],
    ["scheduled", { runtimeScheduleRef: "job:1" }],
    ["running", {}],
  ] as const) {
    const result = await advanceTurnBindingWithCtx(ctx, {
      bindingId,
      step,
      idempotencyKey: `${step}-1`,
      now: TEST_NOW,
      ...refs,
    });
    if (result.outcome === "rejected") throw new Error(result.denial.code);
  }
}

async function produceCitedResult(ctx: MutationCtx, runId: Id<"intelligenceRun">) {
  const begun = await beginProgramAttemptWithCtx(ctx, { runId, attemptIdempotencyKey: "a1", programSource: "return 1;", now: TEST_NOW });
  if (begun.outcome === "denied") throw new Error(begun.denial.code);
  await transitionProgramAttemptWithCtx(ctx, { attemptId: begun.attemptId, to: "validating", now: TEST_NOW });
  await transitionProgramAttemptWithCtx(ctx, { attemptId: begun.attemptId, to: "executing", now: TEST_NOW });
  const admitted = await admitCapabilityCallWithCtx(ctx, {
    runId,
    attemptId: begun.attemptId,
    callIdempotencyKey: "c1",
    capabilityId: "cap.sales.list",
    normalizedArgsHash: "args",
    requested: budgetVector({ calls: 1, rows: 10 }),
    now: TEST_NOW,
  });
  if (admitted.outcome === "denied") throw new Error(admitted.denial.code);
  await markCapabilityCallExecutingWithCtx(ctx, { callId: admitted.callId, now: TEST_NOW });
  await settleCapabilityCallWithCtx(ctx, { callId: admitted.callId, outcome: "succeeded", actual: { rows: 1 }, resultHash: "r1", output: { ok: true }, now: TEST_NOW });
  await transitionProgramAttemptWithCtx(ctx, { attemptId: begun.attemptId, to: "result_produced", now: TEST_NOW, result: { resultHash: "p1" } });
  return { attemptId: begun.attemptId, callId: admitted.callId };
}

describe("turn bindings: duplicate submission and resume (scenario 6)", () => {
  it("records intent once per key and resumes the same binding, run, and prompt on duplicates", async () => {
    const t = convexTest(schema, modules);
    const seeded = await t.run(async (ctx) => {
      const tenant = await seedTenant(ctx, "dup");
      const first = bound(await recordTurnIntentWithCtx(ctx, intentInput(tenant)));
      const second = bound(await recordTurnIntentWithCtx(ctx, intentInput(tenant, { promptPayload: { prompt: "changed" }, promptPayloadHash: "sha256:other" })));
      return { tenant, first, second };
    });
    expect(seeded.first.outcome).toBe("created");
    expect(seeded.second).toMatchObject({ outcome: "resumed", bindingId: seeded.first.bindingId, runId: seeded.first.runId, step: "intent_recorded" });

    await t.run(async (ctx) => {
      const bindings = await ctx.db
        .query("agentTurnBinding")
        .withIndex("by_storeId_turnIdempotencyKey", (q) => q.eq("storeId", seeded.tenant.storeId).eq("turnIdempotencyKey", "turn-1"))
        .take(5);
      expect(bindings).toHaveLength(1);
      const prompts = await ctx.db.query("agentPromptPayload").withIndex("by_runId", (q) => q.eq("runId", seeded.first.runId)).take(5);
      expect(prompts).toHaveLength(1);
      expect(prompts[0]).toMatchObject({ payload: { prompt: "What needs attention today?" }, retentionClass: "short_lived" });
      const runs = await ctx.db
        .query("intelligenceRun")
        .withIndex("by_storeId_idempotencyKey", (q) => q.eq("storeId", seeded.tenant.storeId).eq("idempotencyKey", "turn-1"))
        .take(5);
      expect(runs).toHaveLength(1);
      expect(runs[0]).toMatchObject({ turnBindingId: seeded.first.bindingId, runtimeThreadRef: "thread:alpha", status: "context_captured" });
      // The grant is immutable: the second submission did not rewrite the prompt hash.
      const grant = await ctx.db.query("agentRunGrant").withIndex("by_runId", (q) => q.eq("runId", seeded.first.runId)).unique();
      expect(grant).toMatchObject({ promptPayloadHash: "sha256:prompt", promptPayloadId: prompts[0]._id });
    });
  });

  it("resumes after failures following thread creation, input save, and scheduling without duplicating a step", async () => {
    const t = convexTest(schema, modules);
    const seeded = await t.run(async (ctx) => {
      const tenant = await seedTenant(ctx, "resume");
      const created = bound(await recordTurnIntentWithCtx(ctx, intentInput(tenant, { runtimeThreadRef: undefined })));
      return { tenant, created };
    });
    const bindingId = seeded.created.bindingId;

    await t.run(async (ctx) => {
      // Thread created, then the caller crashed before saving input.
      expect(await advanceTurnBindingWithCtx(ctx, { bindingId, step: "runtime_thread_bound", idempotencyKey: "thread-1", now: TEST_NOW, runtimeThreadRef: "thread:new" })).toMatchObject({ outcome: "advanced", step: "runtime_thread_bound" });
      // Resume: the same intent resolves to the same binding at the reached step.
      const resumed = await recordTurnIntentWithCtx(ctx, intentInput(seeded.tenant, { runtimeThreadRef: undefined }));
      expect(resumed).toMatchObject({ outcome: "resumed", bindingId, step: "runtime_thread_bound" });
      // Re-applying the thread binding (retry of the incomplete transition) is a no-op and cannot change the ref.
      expect(await advanceTurnBindingWithCtx(ctx, { bindingId, step: "runtime_thread_bound", idempotencyKey: "thread-2", now: TEST_NOW + 1, runtimeThreadRef: "thread:duplicate" })).toMatchObject({ outcome: "already_reached", step: "runtime_thread_bound" });
      expect((await ctx.db.get("agentTurnBinding", bindingId))?.runtimeThreadRef).toBe("thread:new");
      // Skipping a rung is rejected: scheduling before the input was saved.
      expect(await advanceTurnBindingWithCtx(ctx, { bindingId, step: "scheduled", idempotencyKey: "sched-early", now: TEST_NOW, runtimeScheduleRef: "job:early" })).toMatchObject({ outcome: "rejected", denial: { code: "binding_step_skipped" } });
      // A rung without its runtime reference is rejected.
      expect(await advanceTurnBindingWithCtx(ctx, { bindingId, step: "runtime_input_saved", idempotencyKey: "input-0", now: TEST_NOW })).toMatchObject({ outcome: "rejected" });
      expect(await advanceTurnBindingWithCtx(ctx, { bindingId, step: "runtime_input_saved", idempotencyKey: "input-1", now: TEST_NOW, runtimeInputRef: "message:1" })).toMatchObject({ outcome: "advanced" });
      expect(await advanceTurnBindingWithCtx(ctx, { bindingId, step: "runtime_input_saved", idempotencyKey: "input-2", now: TEST_NOW, runtimeInputRef: "message:2" })).toMatchObject({ outcome: "already_reached" });
      expect((await ctx.db.get("agentTurnBinding", bindingId))?.runtimeInputRef).toBe("message:1");
      expect(await advanceTurnBindingWithCtx(ctx, { bindingId, step: "scheduled", idempotencyKey: "sched-1", now: TEST_NOW, runtimeScheduleRef: "job:1" })).toMatchObject({ outcome: "advanced" });
      expect(await advanceTurnBindingWithCtx(ctx, { bindingId, step: "scheduled", idempotencyKey: "sched-2", now: TEST_NOW, runtimeScheduleRef: "job:2" })).toMatchObject({ outcome: "already_reached" });
      const binding = await ctx.db.get("agentTurnBinding", bindingId);
      expect(binding).toMatchObject({ step: "scheduled", runtimeScheduleRef: "job:1", runtimeThreadRef: "thread:new" });
      expect((await ctx.db.get("intelligenceRun", seeded.created.runId))?.runtimeThreadRef).toBe("thread:new");
    });

    await t.run(async (ctx) => {
      // Resume-on-read: a scheduled turn whose job never ran asks for the step to be retried, once stale.
      expect(await resumeTurnBindingWithCtx(ctx, { bindingId, now: TEST_NOW + 1_000 })).toMatchObject({ action: "continue", step: "scheduled" });
      const stale = await resumeTurnBindingWithCtx(ctx, { bindingId, now: TEST_NOW + AGENT_TURN_STEP_STALE_AFTER_MS + 1 });
      expect(stale).toMatchObject({ action: "retry_step", step: "scheduled" });
      expect((await ctx.db.get("agentTurnBinding", bindingId))?.repairCount).toBe(1);
      // The retry is still the same binding and run: nothing new was created.
      const bindings = await listTurnBindingsForThread(ctx, "thread:new");
      expect(bindings.map((b) => b._id)).toEqual([bindingId]);
      expect(await advanceTurnBindingWithCtx(ctx, { bindingId, step: "running", idempotencyKey: "run-1", now: TEST_NOW + 2_000 })).toMatchObject({ outcome: "advanced", step: "running" });
      expect((await ctx.db.get("intelligenceRun", seeded.created.runId))?.status).toBe("running");
    });
  });
});

describe("turn bindings: thread cardinality and terminal runs (scenario 7)", () => {
  it("creates a new run for a later prompt on the same thread, resumes an active turn, and never reopens a terminal run", async () => {
    const t = convexTest(schema, modules);
    const seeded = await t.run(async (ctx) => {
      const tenant = await seedTenant(ctx, "thread");
      const first = bound(await recordTurnIntentWithCtx(ctx, intentInput(tenant, { turnIdempotencyKey: "turn-1" })));
      await driveToRunning(ctx, first.bindingId);
      return { tenant, first };
    });

    await t.run(async (ctx) => {
      // Reloading the active turn resumes its existing run.
      expect(await resolveTurnWithCtx(ctx, { storeId: seeded.tenant.storeId, turnIdempotencyKey: "turn-1" })).toMatchObject({ kind: "active", runId: seeded.first.runId, step: "running", runStatus: "running" });
      expect(await recordTurnIntentWithCtx(ctx, intentInput(seeded.tenant, { turnIdempotencyKey: "turn-1" }))).toMatchObject({ outcome: "resumed", runId: seeded.first.runId });

      // A later prompt on the same runtime thread is a new turn with its own run.
      const second = bound(await recordTurnIntentWithCtx(ctx, intentInput(seeded.tenant, { turnIdempotencyKey: "turn-2" })));
      expect(second.outcome).toBe("created");
      expect(second.runId).not.toBe(seeded.first.runId);
      const bindings = await listTurnBindingsForThread(ctx, "thread:alpha");
      expect(bindings.map((b) => b.turnIdempotencyKey)).toEqual(["turn-1", "turn-2"]);
      expect(new Set(bindings.map((b) => b.runId)).size).toBe(2);
      expect(await resolveTurnWithCtx(ctx, { storeId: seeded.tenant.storeId, turnIdempotencyKey: "turn-3" })).toEqual({ kind: "none" });
    });

    const completion = await t.run(async (ctx) => {
      const produced = await produceCitedResult(ctx, seeded.first.runId);
      const prepared = await advanceTurnBindingWithCtx(ctx, { bindingId: seeded.first.bindingId, step: "completion_prepared", idempotencyKey: "prep-1", now: TEST_NOW, preparedCompletionRef: "draft:1" });
      expect(prepared).toMatchObject({ outcome: "advanced", step: "completion_prepared" });
      // Only completeRun may commit; the rung cannot be claimed directly.
      expect(await advanceTurnBindingWithCtx(ctx, { bindingId: seeded.first.bindingId, step: "athena_committed", idempotencyKey: "commit-direct", now: TEST_NOW })).toMatchObject({ outcome: "rejected" });
      const completed = await completeAgentRunWithCtx(ctx, {
        runId: seeded.first.runId,
        idempotencyKey: "complete-1",
        now: TEST_NOW + 10,
        citedAttemptIds: [produced.attemptId],
        artifact: { summary: "Done.", payload: { answer: "done" } },
        citations: [{ citationKey: "k1", callId: produced.callId, resultHash: "r1", sourceRef: { table: "sale", id: "s1" } }],
      });
      if (completed.outcome !== "completed") throw new Error(completed.outcome);
      return completed;
    });

    await t.run(async (ctx) => {
      const binding = await ctx.db.get("agentTurnBinding", seeded.first.bindingId);
      expect(binding).toMatchObject({ step: "athena_committed", operatorReleaseCommittedAt: TEST_NOW + 10, stepIdempotencyKey: "complete-1" });
      expect(binding?.operatorViewedAt).toBeUndefined();
      // Terminal run: the same intent resumes as terminal and nothing reopens.
      expect(await resolveTurnWithCtx(ctx, { storeId: seeded.tenant.storeId, turnIdempotencyKey: "turn-1" })).toMatchObject({ kind: "terminal", runStatus: "completed", artifactId: completion.artifactId });
      expect(await recordTurnIntentWithCtx(ctx, intentInput(seeded.tenant, { turnIdempotencyKey: "turn-1" }))).toMatchObject({ outcome: "resumed", runId: seeded.first.runId, runStatus: "completed" });
      expect(await resumeTurnBindingWithCtx(ctx, { bindingId: seeded.first.bindingId, now: TEST_NOW + 20 })).toMatchObject({ action: "await_projection", step: "athena_committed" });
      // Projection is the outbox rung after commit; it is idempotent and keeps the artifact untouched.
      expect(await advanceTurnBindingWithCtx(ctx, { bindingId: seeded.first.bindingId, step: "runtime_projected", idempotencyKey: "proj-1", now: TEST_NOW + 30, runtimeProjectionRef: "message:answer" })).toMatchObject({ outcome: "advanced" });
      expect(await advanceTurnBindingWithCtx(ctx, { bindingId: seeded.first.bindingId, step: "runtime_projected", idempotencyKey: "proj-2", now: TEST_NOW + 31, runtimeProjectionRef: "message:other" })).toMatchObject({ outcome: "already_reached" });
      expect(await resumeTurnBindingWithCtx(ctx, { bindingId: seeded.first.bindingId, now: TEST_NOW + 40 })).toMatchObject({ action: "terminal", step: "runtime_projected", artifactId: completion.artifactId });
      const artifacts = await ctx.db.query("intelligenceArtifact").withIndex("by_runId", (q) => q.eq("runId", seeded.first.runId)).take(5);
      expect(artifacts).toHaveLength(1);
      expect(artifacts[0]).toMatchObject({ status: "ready", turnBindingId: seeded.first.bindingId });
      // Viewing is acknowledged separately and only after release committed.
      expect(await acknowledgeOperatorViewWithCtx(ctx, { bindingId: seeded.first.bindingId, viewerActorRef: "athenaUser:operator-1", now: TEST_NOW + 50 })).toMatchObject({ acknowledged: true });
      expect(await acknowledgeOperatorViewWithCtx(ctx, { bindingId: seeded.first.bindingId, viewerActorRef: "athenaUser:operator-1", now: TEST_NOW + 60 })).toMatchObject({ acknowledged: true, operatorViewedAt: TEST_NOW + 50 });
    });
  });

  it("abandons the binding when its run ends early and refuses further rungs", async () => {
    const t = convexTest(schema, modules);
    const seeded = await t.run(async (ctx) => {
      const tenant = await seedTenant(ctx, "abandon");
      const created = bound(await recordTurnIntentWithCtx(ctx, intentInput(tenant)));
      await advanceTurnBindingWithCtx(ctx, { bindingId: created.bindingId, step: "runtime_thread_bound", idempotencyKey: "t", now: TEST_NOW, runtimeThreadRef: "thread:alpha" });
      return { tenant, created };
    });

    await t.run(async (ctx) => {
      // Queued-without-work for too long: the bounded sweeper closes the turn without duplicating anything.
      expect(await sweepStaleTurnBindingsWithCtx(ctx, { now: TEST_NOW + 1_000, limit: 10 })).toEqual({ failed: 0, hasMore: false });
      expect(await sweepStaleTurnBindingsWithCtx(ctx, { now: TEST_NOW + AGENT_TURN_STEP_STALE_AFTER_MS * 3 + 1, limit: 10 })).toEqual({ failed: 1, hasMore: false });
      const run = await ctx.db.get("intelligenceRun", seeded.created.runId);
      expect(run).toMatchObject({ status: "failed", error: { code: "turn_binding_stalled", retryable: true } });
      const binding = await ctx.db.get("agentTurnBinding", seeded.created.bindingId);
      expect(binding?.abandonedAt).toBeDefined();
      expect(await advanceTurnBindingWithCtx(ctx, { bindingId: seeded.created.bindingId, step: "runtime_input_saved", idempotencyKey: "late", now: TEST_NOW, runtimeInputRef: "message:late" })).toMatchObject({ outcome: "rejected", denial: { code: "binding_abandoned" } });
      expect(await resumeTurnBindingWithCtx(ctx, { bindingId: seeded.created.bindingId, now: TEST_NOW })).toMatchObject({ action: "abandoned" });
      expect(await acknowledgeOperatorViewWithCtx(ctx, { bindingId: seeded.created.bindingId, viewerActorRef: "x", now: TEST_NOW })).toMatchObject({ acknowledged: false });
      // The same intent key stays bound to the failed run; the operator asks again with a new turn.
      expect(await recordTurnIntentWithCtx(ctx, intentInput(seeded.tenant))).toMatchObject({ outcome: "resumed", runStatus: "failed", abandoned: true });
      const bindings = await listTurnBindingsForThread(ctx, "thread:alpha");
      expect(bindings).toHaveLength(1);
    });
  });
});

describe("bounded sweeper: a host that died mid-turn", () => {
  it("fails and abandons a binding parked at running past the abandon window, and leaves a younger one alone", async () => {
    const t = convexTest(schema, modules);
    const seeded = await t.run(async (ctx) => {
      const tenant = await seedTenant(ctx, "host-stalled");
      const created = bound(await recordTurnIntentWithCtx(ctx, intentInput(tenant)));
      await driveToRunning(ctx, created.bindingId);
      return { tenant, created };
    });

    await t.run(async (ctx) => {
      // A live host can still own a binding this young; the sweep must not touch it.
      expect(await sweepStaleTurnBindingsWithCtx(ctx, { now: TEST_NOW + AGENT_TURN_BINDING_ABANDON_AFTER_MS - 1, limit: 10 })).toEqual({ failed: 0, hasMore: false });
      expect(await ctx.db.get("intelligenceRun", seeded.created.runId)).toMatchObject({ status: "running" });
      expect((await ctx.db.get("agentTurnBinding", seeded.created.bindingId))?.abandonedAt).toBeUndefined();

      // Past the window the host is gone: the run fails retryable, the binding
      // is abandoned, and the turn's spend reservation is released.
      const sweptAt = TEST_NOW + AGENT_TURN_BINDING_ABANDON_AFTER_MS + 1;
      expect(await sweepStaleTurnBindingsWithCtx(ctx, { now: sweptAt, limit: 10 })).toEqual({ failed: 1, hasMore: false });
      expect(await ctx.db.get("intelligenceRun", seeded.created.runId)).toMatchObject({ status: "failed", error: { code: "turn_host_stalled", retryable: true } });
      expect(await ctx.db.get("agentTurnBinding", seeded.created.bindingId)).toMatchObject({ step: "running", abandonedAt: sweptAt, abandonReason: "turn_host_stalled", spendSettledAt: sweptAt });
      // The thread is free again and nothing is reopened.
      expect(await resumeTurnBindingWithCtx(ctx, { bindingId: seeded.created.bindingId, now: sweptAt + 1 })).toMatchObject({ action: "abandoned", runStatus: "failed" });
      expect(await sweepStaleTurnBindingsWithCtx(ctx, { now: sweptAt + 2, limit: 10 })).toEqual({ failed: 0, hasMore: false });
    });
  });
});

describe("resume-on-read: a binding abandoned by run terminalization", () => {
  it("releases the turn's spend reservation on the next read when no host ever came back", async () => {
    const t = convexTest(schema, modules);
    const seeded = await t.run(async (ctx) => {
      const tenant = await seedTenant(ctx, "abandoned-spend");
      const created = bound(await recordTurnIntentWithCtx(ctx, intentInput(tenant)));
      await driveToRunning(ctx, created.bindingId);
      const reserved = await reserveTurnSpendWithCtx(ctx, { actorRef: "athenaUser:operator-1", storeId: tenant.storeId, costUnits: turnProviderCostReservation(), now: TEST_NOW });
      if (!reserved.ok) throw new Error(reserved.code);
      return { tenant, created };
    });

    /** The reservation still held on the operator and store windows. */
    const reserved = async (ctx: MutationCtx) => {
      const windowKey = spendWindowKey(TEST_NOW);
      const rows = await Promise.all(
        ["operator:athenaUser:operator-1", `store:${seeded.tenant.storeId}`].map((scopeKey) =>
          ctx.db.query("agentSpendWindow").withIndex("by_scopeKey_windowKey", (q) => q.eq("scopeKey", scopeKey).eq("windowKey", windowKey)).unique(),
        ),
      );
      return rows.map((row) => row?.reservedCostUnits);
    };

    await t.run(async (ctx) => {
      // The kill switch cancels the run: terminalization abandons the binding,
      // which puts it past every sweep target while the host is already gone.
      await cancelAgentRunWithCtx(ctx, { runId: seeded.created.runId, idempotencyKey: "switch", reason: "profile_disabled", now: TEST_NOW + 10 });
      expect((await ctx.db.get("agentTurnBinding", seeded.created.bindingId))?.abandonedAt).toBe(TEST_NOW + 10);
      expect(await reserved(ctx)).toEqual([turnProviderCostReservation(), turnProviderCostReservation()]);
      expect(await sweepStaleTurnBindingsWithCtx(ctx, { now: TEST_NOW + AGENT_TURN_BINDING_ABANDON_AFTER_MS + 1, limit: 10 })).toEqual({ failed: 0, hasMore: false });

      expect(await resumeTurnBindingWithCtx(ctx, { bindingId: seeded.created.bindingId, now: TEST_NOW + 20 })).toMatchObject({ action: "abandoned", runStatus: "canceled" });
      expect(await reserved(ctx)).toEqual([0, 0]);
      expect(await ctx.db.get("agentTurnBinding", seeded.created.bindingId)).toMatchObject({ spendSettledAt: TEST_NOW + 20 });
      // A second read settles nothing more: the marker is the once-only guard.
      expect(await resumeTurnBindingWithCtx(ctx, { bindingId: seeded.created.bindingId, now: TEST_NOW + 30 })).toMatchObject({ action: "abandoned" });
      expect(await ctx.db.get("agentTurnBinding", seeded.created.bindingId)).toMatchObject({ spendSettledAt: TEST_NOW + 20 });
    });
  });
});
