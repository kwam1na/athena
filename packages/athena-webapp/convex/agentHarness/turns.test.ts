/// <reference types="vite/client" />
/**
 * Operator-facing turn entry points: the same handlers the public functions
 * bind, proven against the test
 * package with an admitted actor, plus the executable return-validator
 * contract proofs for every public function (`assertConformsToExportedReturns`).
 */
import { convexTest, type TestConvex } from "convex-test";
import { afterEach, describe, expect, it } from "vitest";

import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { assertConformsToExportedReturns } from "../lib/returnValidatorContract";
import schema from "../schema";
import { TEST_ADMISSION, TEST_CLOCK, TEST_NOW_BASE, TEST_PROFILE_ID, seedDelegatedOperator } from "./delegatedAdmission.testPorts";
import { TEST_EXECUTOR_SEAMS, beginExecutingAttempt, bridgeCall } from "./executor.testSeams";
import { buildAnswerArtifactPayload } from "./historyProjection";
import { markAgentRunRunningWithCtx } from "./lifecycle";
import { AGENT_OPERATOR_ACTIVE_RUN_LIMIT } from "./runAdmission";
import { registerAgentRuntimeCleanupHook, resetAgentRuntimeCleanupHooksForTests } from "./retention";
import {
  acknowledgeTurnAnswer,
  cancelTurn,
  createAgentTurnEntryPoints,
  getThreadHistory,
  getTurnAnswer,
  getTurnView,
  inspectCitationEvidence,
  resumeTurn,
  startTurn,
} from "./turns";
import { TEST_TURN_SEAMS, seedRecordedTurn } from "./turns.testSeams";

const modules = Object.fromEntries(
  Object.entries(import.meta.glob("../**/*.ts")).map(([path, loader]) => [
    path.startsWith("../") ? path.replace(/^\.\.\//, "./") : path.replace(/^\.\//, "./agentHarness/"),
    loader,
  ]),
);
modules["./agentHarness/testPorts.ts"] = modules["./agentHarness/delegatedAdmission.testPorts.ts"];
modules["./agentHarness/testSeams.ts"] = modules["./agentHarness/executor.testSeams.ts"];
modules["./agentHarness/testTurns.ts"] = modules["./agentHarness/turns.testSeams.ts"];

const scheduled: { drive: Id<"agentTurnBinding">[]; repair: Id<"agentTurnBinding">[] } = { drive: [], repair: [] };
let clockNow = TEST_NOW_BASE + 1_000;
const entry = createAgentTurnEntryPoints({
  seams: TEST_TURN_SEAMS,
  readCitationEvidence: (ctx, input) => TEST_EXECUTOR_SEAMS.readCitationEvidenceWithCtx(ctx, input),
  scheduleDriveTurn: async (_ctx, bindingId) => {
    scheduled.drive.push(bindingId);
  },
  scheduleOutboxRepair: async (_ctx, bindingId) => {
    scheduled.repair.push(bindingId);
  },
  now: () => (clockNow += 1),
});

function admitted<C extends MutationCtx>(ctx: C, athenaUserId: Id<"athenaUser">) {
  return Object.assign(ctx, { operationAdmission: { actor: { kind: "normal_user" as const, athenaUserId } } });
}

afterEach(() => {
  resetAgentRuntimeCleanupHooksForTests();
  scheduled.drive.length = 0;
  scheduled.repair.length = 0;
  clockNow = TEST_NOW_BASE + 1_000;
  TEST_CLOCK.now = TEST_NOW_BASE;
});

const baseArgs = (storeId: Id<"store">, overrides: Partial<{ profileId: string; threadKey: string; turnIdempotencyKey: string; prompt: string; context: Record<string, string> }> = {}) => ({
  storeId,
  profileId: TEST_PROFILE_ID,
  threadKey: "thread-1",
  turnIdempotencyKey: "turn-1",
  prompt: "Which shifts are open?",
  context: { operatingDate: "2026-08-21" },
  ...overrides,
});

describe("startTurn (scenarios 7, 9, 15)", () => {
  it("records intent once, schedules the host, and resumes the same turn on a duplicate key", async () => {
    const t = convexTest(schema, modules);
    const operator = await t.run((ctx) => seedDelegatedOperator(ctx, "start", { role: "full_admin" }));
    const started = await t.run((ctx) => entry.startTurn(admitted(ctx, operator.userId), baseArgs(operator.storeId)));
    expect(started).toMatchObject({ outcome: "started", threadKey: "thread-1" });
    assertConformsToExportedReturns(startTurn, started);
    if (started.outcome !== "started") return;
    expect(scheduled.drive).toEqual([started.bindingId]);
    const again = await t.run((ctx) => entry.startTurn(admitted(ctx, operator.userId), baseArgs(operator.storeId, { prompt: "changed" })));
    expect(again).toMatchObject({ outcome: "resumed", bindingId: started.bindingId, runId: started.runId, step: "intent_recorded", runStatus: "context_captured", terminal: false });
    assertConformsToExportedReturns(startTurn, again);
    expect(scheduled.drive).toHaveLength(1);
    await t.run(async (ctx) => {
      const binding = await ctx.db.get("agentTurnBinding", started.bindingId);
      expect(binding).toMatchObject({ threadKey: "thread-1", step: "intent_recorded" });
      const run = await ctx.db.get("intelligenceRun", started.runId);
      expect(run).toMatchObject({ status: "context_captured", actorRef: `athenaUser:${operator.userId}`, harnessKind: "agent" });
      const grant = await ctx.db.query("agentRunGrant").withIndex("by_runId", (q) => q.eq("runId", started.runId)).unique();
      expect(grant?.delegation).toMatchObject({ athenaUserId: operator.userId, operatorKind: "normal_user", authorityTier: "full_admin" });
      const prompts = await ctx.db.query("agentPromptPayload").withIndex("by_runId", (q) => q.eq("runId", started.runId)).take(2);
      expect(prompts[0].payload).toMatchObject({ question: "Which shifts are open?", context: { operatingDate: "2026-08-21" } });
      const windows = await ctx.db.query("agentSpendWindow").withIndex("by_scopeKey_windowKey", (q) => q.eq("scopeKey", `operator:athenaUser:${operator.userId}`)).take(2);
      expect(windows[0]).toMatchObject({ reservedCostUnits: 2_000, runCount: 1 });
    });
  });

  it("denies invalid prompts, unknown profiles, bad keys, and operators without authority before anything is persisted", async () => {
    const t = convexTest(schema, modules);
    const operator = await t.run((ctx) => seedDelegatedOperator(ctx, "deny", { role: "full_admin" }));
    const stranger = await t.run((ctx) => seedDelegatedOperator(ctx, "stranger", null));
    const cases: Array<[Parameters<typeof entry.startTurn>[1], string, Id<"athenaUser">]> = [
      [baseArgs(operator.storeId, { prompt: "   " }), "prompt_empty", operator.userId],
      [baseArgs(operator.storeId, { prompt: "a".repeat(5_000) }), "prompt_too_large", operator.userId],
      [baseArgs(operator.storeId, { prompt: "bidi ‮" }), "prompt_disallowed_bidi", operator.userId],
      [baseArgs(operator.storeId, { profileId: "ghost" }), "profile_unavailable", operator.userId],
      [baseArgs(operator.storeId, { threadKey: "bad key!" }), "thread_key_invalid", operator.userId],
      [baseArgs(operator.storeId, { context: { "bad key": "x" } }), "context_invalid", operator.userId],
      [baseArgs(operator.storeId), "operator_unauthorized", stranger.userId],
    ];
    for (const [args, code, userId] of cases) {
      const result = await t.run((ctx) => entry.startTurn(admitted(ctx, userId), args));
      expect(result, code).toMatchObject({ outcome: "denied", code });
      assertConformsToExportedReturns(startTurn, result);
    }
    await t.run(async (ctx) => {
      expect(await ctx.db.query("agentTurnBinding").withIndex("by_storeId_turnIdempotencyKey", (q) => q.eq("storeId", operator.storeId).eq("turnIdempotencyKey", "turn-1")).take(2)).toEqual([]);
      expect(await ctx.db.query("intelligenceRun").withIndex("by_actorRef_status", (q) => q.eq("actorRef", `athenaUser:${operator.userId}`).eq("status", "context_captured")).take(2)).toEqual([]);
      expect(await ctx.db.query("agentSpendWindow").withIndex("by_scopeKey_windowKey", (q) => q.eq("scopeKey", `operator:athenaUser:${operator.userId}`)).take(2)).toEqual([]);
    });
    expect(scheduled.drive).toEqual([]);
  });

  it("blocks a second submission on an active thread and enforces the per-operator active-run limit as retryable denials", async () => {
    const t = convexTest(schema, modules);
    const operator = await t.run((ctx) => seedDelegatedOperator(ctx, "limits", { role: "full_admin" }));
    const first = await t.run((ctx) => entry.startTurn(admitted(ctx, operator.userId), baseArgs(operator.storeId)));
    expect(first.outcome).toBe("started");
    expect(await t.run((ctx) => entry.startTurn(admitted(ctx, operator.userId), baseArgs(operator.storeId, { turnIdempotencyKey: "turn-2" })))).toMatchObject({ outcome: "denied", code: "thread_busy", retryable: true });
    for (let index = 1; index < AGENT_OPERATOR_ACTIVE_RUN_LIMIT; index += 1) {
      expect(await t.run((ctx) => entry.startTurn(admitted(ctx, operator.userId), baseArgs(operator.storeId, { turnIdempotencyKey: `turn-x${index}`, threadKey: `thread-x${index}` })))).toMatchObject({ outcome: "started" });
    }
    expect(await t.run((ctx) => entry.startTurn(admitted(ctx, operator.userId), baseArgs(operator.storeId, { turnIdempotencyKey: "turn-over", threadKey: "thread-over" })))).toMatchObject({ outcome: "denied", code: "active_run_limit", retryable: true });
  });

  /** A second full admin in the operator's organization: authority passes, so only per-operator rules separate the two. */
  async function seedColleague(t: TestConvex<typeof schema>, operator: Awaited<ReturnType<typeof seedDelegatedOperator>>, slug: string) {
    return t.run(async (ctx) => {
      const colleagueId = await ctx.db.insert("athenaUser", { email: `${slug}-colleague@test` });
      await ctx.db.insert("organizationMember", { organizationId: operator.organizationId, userId: colleagueId, role: "full_admin", operationalRoles: [] });
      return colleagueId;
    });
  }

  it("admits a colleague's turn on the same thread key while this operator's turn is active, and still blocks each operator's own second submission", async () => {
    const t = convexTest(schema, modules);
    const operator = await t.run((ctx) => seedDelegatedOperator(ctx, "two-op", { role: "full_admin" }));
    const colleagueId = await seedColleague(t, operator, "two-op");
    const shared = (turnIdempotencyKey: string) => baseArgs(operator.storeId, { threadKey: "thread-shared", turnIdempotencyKey });

    const first = await t.run((ctx) => entry.startTurn(admitted(ctx, operator.userId), shared("turn-a1")));
    expect(first).toMatchObject({ outcome: "started" });
    const second = await t.run((ctx) => entry.startTurn(admitted(ctx, colleagueId), shared("turn-b1")));
    expect(second).toMatchObject({ outcome: "started" });
    expect(await t.run((ctx) => entry.startTurn(admitted(ctx, operator.userId), shared("turn-a2")))).toMatchObject({ outcome: "denied", code: "thread_busy", retryable: true });
    expect(await t.run((ctx) => entry.startTurn(admitted(ctx, colleagueId), shared("turn-b2")))).toMatchObject({ outcome: "denied", code: "thread_busy", retryable: true });
    expect(scheduled.drive).toHaveLength(2);

    // Each operator's history on the shared key is their own turn and nothing else.
    if (first.outcome !== "started" || second.outcome !== "started") throw new Error("unreachable");
    const ownerHistory = await t.run((ctx) => entry.getThreadHistory(admitted(ctx, operator.userId), { storeId: operator.storeId, profileId: TEST_PROFILE_ID, threadKey: "thread-shared" }));
    expect(ownerHistory).toMatchObject({ kind: "history", entries: [{ bindingId: first.bindingId, state: "active" }] });
    const colleagueHistory = await t.run((ctx) => entry.getThreadHistory(admitted(ctx, colleagueId), { storeId: operator.storeId, profileId: TEST_PROFILE_ID, threadKey: "thread-shared" }));
    expect(colleagueHistory).toMatchObject({ kind: "history", entries: [{ bindingId: second.bindingId, state: "active" }] });
  });

  it("denies a colleague who reuses another operator's turn key instead of resuming that operator's turn", async () => {
    const t = convexTest(schema, modules);
    const operator = await t.run((ctx) => seedDelegatedOperator(ctx, "key-conflict", { role: "full_admin" }));
    const colleagueId = await seedColleague(t, operator, "key-conflict");

    const first = await t.run((ctx) => entry.startTurn(admitted(ctx, operator.userId), baseArgs(operator.storeId, { threadKey: "thread-owner", turnIdempotencyKey: "turn-shared-key" })));
    expect(first).toMatchObject({ outcome: "started" });
    if (first.outcome !== "started") throw new Error("unreachable");

    const conflict = await t.run((ctx) => entry.startTurn(admitted(ctx, colleagueId), baseArgs(operator.storeId, { threadKey: "thread-colleague", turnIdempotencyKey: "turn-shared-key" })));
    expect(conflict).toMatchObject({ outcome: "denied", code: "turn_key_conflict", retryable: false });
    assertConformsToExportedReturns(startTurn, conflict);
    expect(JSON.stringify(conflict)).not.toContain(first.bindingId);
    expect(JSON.stringify(conflict)).not.toContain(first.runId);

    // Nothing was persisted for the colleague; the owner still resumes their own turn on the key.
    const bindings = await t.run((ctx) => ctx.db.query("agentTurnBinding").withIndex("by_storeId_turnIdempotencyKey", (q) => q.eq("storeId", operator.storeId).eq("turnIdempotencyKey", "turn-shared-key")).take(3));
    expect(bindings.map((binding) => binding._id)).toEqual([first.bindingId]);
    expect(scheduled.drive).toEqual([first.bindingId]);
    expect(await t.run((ctx) => entry.startTurn(admitted(ctx, operator.userId), baseArgs(operator.storeId, { threadKey: "thread-owner", turnIdempotencyKey: "turn-shared-key" })))).toMatchObject({ outcome: "resumed", bindingId: first.bindingId });
  });

  it("a POS-only member with nothing granted is refused with no_granted_capabilities; a disabled profile fails closed", async () => {
    const t = convexTest(schema, modules);
    // Revoke the member intent the test package binds by narrowing the profile instead: profile switch off.
    const operator = await t.run((ctx) => seedDelegatedOperator(ctx, "switch-off", { role: "full_admin" }));
    const disabledEntry = createAgentTurnEntryPoints({
      seams: { ...TEST_TURN_SEAMS, config: { ...TEST_TURN_SEAMS.config, admission: { ...TEST_ADMISSION, prepareRunGrantWithCtx: async () => ({ kind: "refused" as const, stage: "enablement" as const, reason: "profile_disabled", message: "off", retryable: false, result: { kind: "unauthorized" as const, code: "capability_disabled" as const, message: "off" } }) } } },
      readCitationEvidence: (ctx, input) => TEST_EXECUTOR_SEAMS.readCitationEvidenceWithCtx(ctx, input),
      scheduleDriveTurn: async () => undefined,
      scheduleOutboxRepair: async () => undefined,
    });
    expect(await t.run((ctx) => disabledEntry.startTurn(admitted(ctx, operator.userId), baseArgs(operator.storeId)))).toMatchObject({ outcome: "denied", code: "profile_unavailable" });
    const emptyEntry = createAgentTurnEntryPoints({
      seams: { ...TEST_TURN_SEAMS, config: { ...TEST_TURN_SEAMS.config, admission: { ...TEST_ADMISSION, prepareRunGrantWithCtx: async (ctx, request) => {
        const prepared = await TEST_ADMISSION.prepareRunGrantWithCtx(ctx, request);
        if (prepared.kind !== "prepared") return prepared;
        return { ...prepared, projection: { ...prepared.projection, capabilities: [] } };
      } } } },
      readCitationEvidence: (ctx, input) => TEST_EXECUTOR_SEAMS.readCitationEvidenceWithCtx(ctx, input),
      scheduleDriveTurn: async () => undefined,
      scheduleOutboxRepair: async () => undefined,
    });
    expect(await t.run((ctx) => emptyEntry.startTurn(admitted(ctx, operator.userId), baseArgs(operator.storeId)))).toMatchObject({ outcome: "denied", code: "no_granted_capabilities" });
  });
});

/** A committed, released answer on a recorded turn (what the host leaves behind after `completeRun`). */
async function commitAnswer(t: TestConvex<typeof schema>, seeded: Awaited<ReturnType<typeof seedRecordedTurn>>, narrative = "One shift is open.") {
  await t.run((ctx) => markAgentRunRunningWithCtx(ctx, { runId: seeded.runId, now: TEST_NOW_BASE + 5 }));
  const attempt = await t.run((ctx) => beginExecutingAttempt(ctx, seeded, { source: "const r = await athena.ops.shifts.list({ status: 'open' });\nreturn { open: r.kind };" }));
  const call = await bridgeCall(t, seeded, attempt.attemptId, { capabilityId: "cap_test_ops_shifts", namespace: "ops.shifts", verb: "list", args: { status: "open" } });
  if (call.settled?.outcome !== "released") throw new Error(JSON.stringify(call.settled));
  const finished = await t.run((ctx) => TEST_EXECUTOR_SEAMS.finishAttemptWithCtx(ctx, { attemptId: attempt.attemptId, end: { status: "completed", output: { open: 1 }, diagnostics: { elapsedMs: 1, hostCalls: 1, maxInFlight: 1, bridgeArgsBytes: 1, bridgeOutputBytes: 1, resultBytes: 1, sourceBytes: 1 } }, now: TEST_NOW_BASE + 20 }));
  if (finished.outcome !== "result") throw new Error(JSON.stringify(finished));
  const citation = finished.citations[0].citation;
  await t.run((ctx) => ctx.db.patch("agentTurnBinding", seeded.bindingId, { step: "running", runtimeThreadRef: "runtime_thread:t", runtimeInputRef: "runtime_input:i", runtimeScheduleRef: "runtime_schedule:s", runtimeTurnRef: "runtime_turn:u" }));
  await t.run((ctx) => TEST_TURN_SEAMS.outbox.prepareCompletionWithCtx(ctx, { bindingId: seeded.bindingId, runId: seeded.runId, preparedCompletionRef: "completion:1", now: TEST_NOW_BASE + 30 }));
  const committed = await t.run((ctx) =>
    TEST_EXECUTOR_SEAMS.completeRunWithCtx(ctx, {
      runId: seeded.runId,
      idempotencyKey: "completion:1",
      citedAttemptRefs: [finished.attemptRef],
      citations: [{ ref: citation, claim: narrative }],
      artifact: { title: "Open shifts", summary: narrative, payload: buildAnswerArtifactPayload({ outcome: "answer", narrative, egressClass: "sensitive", citations: [{ ref: citation, namespace: "ops.shifts" }] }) },
      now: TEST_NOW_BASE + 40,
    }),
  );
  if (committed.outcome !== "completed") throw new Error(JSON.stringify(committed));
  return { citation, attemptId: attempt.attemptId };
}

describe("turn view, answer, acknowledgement, cancel, resume, history, evidence (scenarios 1, 2, 13, 17)", () => {
  it("serves a reactive view and a reauthorized answer only to the initiating operator; acknowledging records the view once", async () => {
    const t = convexTest(schema, modules);
    const seeded = await t.run((ctx) => seedRecordedTurn(ctx, "view"));
    const other = await t.run((ctx) => seedDelegatedOperator(ctx, "view-other", { role: "full_admin" }));
    const args = { storeId: seeded.operator.storeId, bindingId: seeded.bindingId };

    const queued = await t.run((ctx) => entry.getTurnView(admitted(ctx, seeded.operator.userId), args));
    expect(queued).toMatchObject({ kind: "view", phase: "queued", step: "intent_recorded", question: "Which shifts are open?", context: { operatingDate: "2026-08-21" }, promptState: "retained", answer: { available: false, suppressed: false }, canCancel: true, milestones: [] });
    assertConformsToExportedReturns(getTurnView, queued);
    expect(await t.run((ctx) => entry.getTurnView(admitted(ctx, other.userId), args))).toEqual({ kind: "unavailable", reason: "not_your_turn" });
    expect(await t.run((ctx) => entry.getTurnView(admitted(ctx, seeded.operator.userId), { ...args, storeId: other.storeId }))).toEqual({ kind: "unavailable", reason: "not_found" });
    expect(await t.run((ctx) => entry.getTurnAnswer(admitted(ctx, seeded.operator.userId), args))).toEqual({ kind: "unavailable", reason: "not_ready" });

    await t.run((ctx) => TEST_TURN_SEAMS.recordTurnProgressWithCtx(ctx, { bindingId: seeded.bindingId, milestone: "checking_sources", now: TEST_NOW_BASE + 3 }));
    const { citation } = await commitAnswer(t, seeded);
    const completed = await t.run((ctx) => entry.getTurnView(admitted(ctx, seeded.operator.userId), args));
    expect(completed).toMatchObject({ kind: "view", phase: "completed", step: "athena_committed", milestones: [{ milestone: "checking_sources" }], answer: { available: true, outcome: "answer", suppressed: false }, canCancel: false });
    assertConformsToExportedReturns(getTurnView, completed);
    const answer = await t.run((ctx) => entry.getTurnAnswer(admitted(ctx, seeded.operator.userId), args));
    expect(answer).toMatchObject({ kind: "answer", outcome: "answer", title: "Open shifts", narrative: "One shift is open.", egressClass: "sensitive", committedAt: TEST_NOW_BASE + 40, citations: [{ citationRef: citation, namespace: "ops.shifts" }] });
    assertConformsToExportedReturns(getTurnAnswer, answer);
    expect((answer as { viewedAt?: number }).viewedAt).toBeUndefined();

    const acknowledged = await t.run((ctx) => entry.acknowledgeTurnAnswer(admitted(ctx, seeded.operator.userId), args));
    expect(acknowledged).toMatchObject({ kind: "acknowledged", answer: { kind: "answer", narrative: "One shift is open." } });
    assertConformsToExportedReturns(acknowledgeTurnAnswer, acknowledged);
    const viewedAt = (acknowledged as { operatorViewedAt: number }).operatorViewedAt;
    expect(await t.run((ctx) => entry.acknowledgeTurnAnswer(admitted(ctx, seeded.operator.userId), args))).toMatchObject({ kind: "acknowledged", operatorViewedAt: viewedAt });
    expect(await t.run((ctx) => entry.getTurnView(admitted(ctx, seeded.operator.userId), args))).toMatchObject({ answer: { available: true, viewedAt } });
    expect(await t.run((ctx) => ctx.db.get("agentTurnBinding", seeded.bindingId))).toMatchObject({ operatorViewedAt: viewedAt, operatorViewedByActorRef: `athenaUser:${seeded.operator.userId}` });

    const evidence = await t.run((ctx) => entry.inspectCitationEvidence(admitted(ctx, seeded.operator.userId), { ...args, citationRef: citation }));
    expect(evidence).toMatchObject({ kind: "evidence", state: "reconstructible", citation: { citationRef: citation, namespace: "ops.shifts", capability: "cap_test_ops_shifts" } });
    assertConformsToExportedReturns(inspectCitationEvidence, evidence);
    expect(JSON.stringify(evidence)).not.toContain(String(seeded.runId));
    expect(await t.run((ctx) => entry.inspectCitationEvidence(admitted(ctx, other.userId), { ...args, citationRef: citation }))).toEqual({ kind: "unauthorized", reason: "not_your_turn" });
    expect(await t.run((ctx) => entry.inspectCitationEvidence(admitted(ctx, seeded.operator.userId), { ...args, citationRef: "citation:v1.9.9.nope" }))).toEqual({ kind: "not_found" });

    const history = await t.run((ctx) => entry.getThreadHistory(admitted(ctx, seeded.operator.userId), { storeId: seeded.operator.storeId, profileId: TEST_PROFILE_ID, threadKey: "thread-view" }));
    expect(history).toMatchObject({ kind: "history", entries: [{ state: "answered", question: "Which shifts are open?", answer: { narrative: "One shift is open.", citations: [{ citationRef: citation }] } }] });
    assertConformsToExportedReturns(getThreadHistory, history);
    expect(await t.run((ctx) => entry.getThreadHistory(admitted(ctx, other.userId), { storeId: seeded.operator.storeId, profileId: TEST_PROFILE_ID, threadKey: "thread-view" }))).toEqual({ kind: "unavailable", reason: "membership_revoked" });
  });

  it("revocation after commit but before the first authorized fetch suppresses the answer and purges; after a recorded view it cannot be recalled", async () => {
    const t = convexTest(schema, modules);
    const purged: string[] = [];
    registerAgentRuntimeCleanupHook("athena_contract_fake", async (_ctx, descriptor) => {
      purged.push(descriptor.runtimeThreadRef ?? "");
      return { ok: true };
    });
    const seeded = await t.run((ctx) => seedRecordedTurn(ctx, "late-revoke"));
    const args = { storeId: seeded.operator.storeId, bindingId: seeded.bindingId };
    await commitAnswer(t, seeded);
    // Role downgrade: the sensitive answer is beyond a POS-only member's current authority.
    await t.run((ctx) => ctx.db.patch("organizationMember", seeded.operator.membershipId!, { role: "pos_only", operationalRoles: [] }));
    expect(await t.run((ctx) => entry.getTurnAnswer(admitted(ctx, seeded.operator.userId), args))).toEqual({ kind: "unavailable", reason: "egress_beyond_authority" });
    const suppressed = await t.run((ctx) => entry.acknowledgeTurnAnswer(admitted(ctx, seeded.operator.userId), args));
    expect(suppressed).toEqual({ kind: "suppressed", reason: "egress_beyond_authority" });
    assertConformsToExportedReturns(acknowledgeTurnAnswer, suppressed);
    expect(purged).toEqual(["runtime_thread:t"]);
    const view = await t.run((ctx) => entry.getTurnView(admitted(ctx, seeded.operator.userId), args));
    expect(view).toMatchObject({ kind: "view", phase: "completed", answer: { available: false, suppressed: true } });
    expect((view as { answer: { viewedAt?: number } }).answer.viewedAt).toBeUndefined();
    // Even after the role is restored, a suppressed release stays suppressed.
    await t.run((ctx) => ctx.db.patch("organizationMember", seeded.operator.membershipId!, { role: "full_admin" }));
    expect(await t.run((ctx) => entry.getTurnAnswer(admitted(ctx, seeded.operator.userId), args))).toEqual({ kind: "unavailable", reason: "suppressed" });

    // Membership loss on another turn that was already viewed: the view stands as audit, the answer is no longer served.
    const viewed = await t.run((ctx) => seedRecordedTurn(ctx, "viewed", { threadKey: "thread-viewed", key: "turn-viewed", operator: seeded.operator }));
    await commitAnswer(t, viewed, "Viewed answer.");
    const viewedArgs = { storeId: seeded.operator.storeId, bindingId: viewed.bindingId };
    expect(await t.run((ctx) => entry.acknowledgeTurnAnswer(admitted(ctx, seeded.operator.userId), viewedArgs))).toMatchObject({ kind: "acknowledged" });
    await t.run((ctx) => ctx.db.delete("organizationMember", seeded.operator.membershipId!));
    expect(await t.run((ctx) => entry.acknowledgeTurnAnswer(admitted(ctx, seeded.operator.userId), viewedArgs))).toEqual({ kind: "unavailable", reason: "membership_revoked" });
    expect(await t.run((ctx) => ctx.db.get("agentTurnBinding", viewed.bindingId))).toMatchObject({ operatorViewedAt: expect.any(Number) });
    expect((await t.run((ctx) => ctx.db.get("agentTurnBinding", viewed.bindingId)))?.releaseSuppressedAt).toBeUndefined();
    expect(purged).toHaveLength(1);
  });

  it("cancels an active turn once, never reopens a terminal one, and resume repairs stale rungs and pending projections without duplication", async () => {
    const t = convexTest(schema, modules);
    const seeded = await t.run((ctx) => seedRecordedTurn(ctx, "cancel"));
    const args = { storeId: seeded.operator.storeId, bindingId: seeded.bindingId };
    const fresh = await t.run((ctx) => entry.resumeTurn(admitted(ctx, seeded.operator.userId), args));
    expect(fresh).toMatchObject({ outcome: "continue", step: "intent_recorded", runStatus: "context_captured" });
    assertConformsToExportedReturns(resumeTurn, fresh);
    // A stale pre-running rung is re-driven, once.
    await t.run((ctx) => ctx.db.patch("agentTurnBinding", seeded.bindingId, { stepUpdatedAt: TEST_NOW_BASE - 10 * 60_000 }));
    const retried = await t.run((ctx) => entry.resumeTurn(admitted(ctx, seeded.operator.userId), args));
    expect(retried).toMatchObject({ outcome: "retry_scheduled", step: "intent_recorded" });
    expect(scheduled.drive).toEqual([seeded.bindingId]);

    const canceled = await t.run((ctx) => entry.cancelTurn(admitted(ctx, seeded.operator.userId), args));
    expect(canceled).toEqual({ outcome: "canceled" });
    assertConformsToExportedReturns(cancelTurn, canceled);
    expect(await t.run((ctx) => entry.cancelTurn(admitted(ctx, seeded.operator.userId), args))).toEqual({ outcome: "already_terminal", runStatus: "canceled" });
    expect(await t.run((ctx) => entry.getTurnView(admitted(ctx, seeded.operator.userId), args))).toMatchObject({ kind: "view", phase: "canceled", canCancel: false, error: { code: "canceled", headline: "Stopped." } });
    expect(await t.run((ctx) => entry.resumeTurn(admitted(ctx, seeded.operator.userId), args))).toMatchObject({ outcome: "abandoned", runStatus: "canceled" });
    // A duplicate start with the same key resumes the terminal turn instead of creating a run.
    expect(await t.run((ctx) => entry.startTurn(admitted(ctx, seeded.operator.userId), baseArgs(seeded.operator.storeId, { turnIdempotencyKey: "turn-cancel", threadKey: "thread-cancel" })))).toMatchObject({ outcome: "resumed", bindingId: seeded.bindingId, terminal: true, runStatus: "canceled" });

    // A committed but unprojected turn: resume schedules the outbox repair.
    const committed = await t.run((ctx) => seedRecordedTurn(ctx, "cancel", { threadKey: "thread-c2", key: "turn-c2", operator: seeded.operator }));
    await commitAnswer(t, committed);
    const projection = await t.run((ctx) => entry.resumeTurn(admitted(ctx, seeded.operator.userId), { storeId: seeded.operator.storeId, bindingId: committed.bindingId }));
    expect(projection).toMatchObject({ outcome: "projection_scheduled", step: "athena_committed", runStatus: "completed" });
    expect(scheduled.repair).toEqual([committed.bindingId]);
    expect(await t.run((ctx) => entry.cancelTurn(admitted(ctx, seeded.operator.userId), { storeId: seeded.operator.storeId, bindingId: committed.bindingId }))).toEqual({ outcome: "already_terminal", runStatus: "completed" });
  });
});
