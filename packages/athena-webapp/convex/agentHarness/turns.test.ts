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
import {
  TEST_ADMISSION,
  TEST_BUFFERED_PROFILE_ID,
  TEST_CLOCK,
  TEST_ENABLEMENT,
  TEST_NOW_BASE,
  TEST_PROFILE_ID,
  TEST_REGISTRY,
  seedDelegatedOperator,
} from "./delegatedAdmission.testPorts";
import { TEST_EXECUTOR_SEAMS, beginExecutingAttempt, bridgeCall } from "./executor.testSeams";
import { buildAnswerArtifactPayload } from "./historyProjection";
import { advanceCompatibilityEpochWithCtx, cancelAgentRunWithCtx, failAgentRunWithCtx, getCurrentCompatibilityEpochWithCtx, markAgentRunRunningWithCtx } from "./lifecycle";
import { AGENT_TURN_NARRATIVE_TRAIL_RETENTION_MS, loadTurnNarrativeTrailByBindingWithCtx } from "./narrativeTrail";
import { AGENT_PROVISIONAL_NARRATIVE_TTL_MS, loadProvisionalNarrativeByBindingWithCtx, upsertProvisionalNarrativeWithCtx } from "./provisionalNarrative";
import { AGENT_TURN_TRACE_EVENT_PAYLOAD_MAX_BYTES, AGENT_TURN_TRACE_RETENTION_MS, listTurnTraceByBindingWithCtx } from "./turnTrace";
import { advanceTurnBindingWithCtx, markProvisionalReleaseWithCtx } from "./turnBindings";
import { AGENT_OPERATOR_ACTIVE_RUN_LIMIT } from "./runAdmission";
import { registerAgentRuntimeCleanupHook, resetAgentRuntimeCleanupHooksForTests } from "./retention";
import { AGENT_TOOL_NARRATIVE_MAX_BYTES } from "./tools";
import {
  acknowledgeProvisionalView,
  acknowledgeTurnAnswer,
  cancelTurn,
  createAgentTurnEntryPoints,
  describeTurnExposureWithCtx,
  flushProvisionalNarrative,
  getThreadHistory,
  getTurnAnswer,
  getTurnNarrativeTrail,
  getTurnView,
  inspectCitationEvidence,
  previewTurnNarrative,
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
  TEST_ENABLEMENT.reset();
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

describe("narrative policy across the test profiles", () => {
  it("carries both policies in the digest-pinned registry and starts a real turn on the buffered profile", async () => {
    expect(TEST_REGISTRY.profiles[TEST_PROFILE_ID].narrativePolicy).toBe("provisional_streaming");
    expect(TEST_REGISTRY.profiles[TEST_BUFFERED_PROFILE_ID].narrativePolicy).toBe("buffered");
    expect(TEST_ENABLEMENT.current().profiles[TEST_BUFFERED_PROFILE_ID]).toBe("enabled");

    const t = convexTest(schema, modules);
    const seeded = await t.run((ctx) => seedRecordedTurn(ctx, "buffered", { profileId: TEST_BUFFERED_PROFILE_ID }));
    const grantFor = (runId: Id<"intelligenceRun">) =>
      t.run(async (ctx) => (await ctx.db.query("agentRunGrant").withIndex("by_runId", (q) => q.eq("runId", runId)).take(1))[0]);
    const grant = await grantFor(seeded.runId);
    expect(grant).toMatchObject({
      profileKey: TEST_BUFFERED_PROFILE_ID,
      compatibilityDigest: TEST_REGISTRY.compatibilityDigest,
    });

    // The production preparation ladder runs unchanged for a `buffered` profile.
    const prepared = await t.run((ctx) => TEST_TURN_SEAMS.prepareTurnWithCtx(ctx, { bindingId: seeded.bindingId, now: TEST_NOW_BASE + 1 }));
    expect(prepared, JSON.stringify(prepared)).toMatchObject({ kind: "ready", plan: { profileId: TEST_BUFFERED_PROFILE_ID, step: "intent_recorded" } });
    // Walk the binding ladder exactly as the host does; each rung carries the
    // opaque runtime ref the next one depends on.
    const rungs = [
      { step: "runtime_thread_bound" as const, runtimeThreadRef: "runtime_thread:buffered" },
      { step: "runtime_input_saved" as const, runtimeInputRef: "runtime_input:buffered" },
      { step: "scheduled" as const, runtimeScheduleRef: "runtime_schedule:buffered" },
    ];
    for (const rung of rungs) {
      const advanced = await t.run((ctx) =>
        advanceTurnBindingWithCtx(ctx, { bindingId: seeded.bindingId, idempotencyKey: `buffered:${rung.step}`, now: TEST_NOW_BASE + 2, ...rung }),
      );
      expect(advanced, JSON.stringify(advanced)).toMatchObject({ outcome: "advanced", step: rung.step });
    }
    const running = await t.run((ctx) => TEST_TURN_SEAMS.markTurnRunningWithCtx(ctx, { bindingId: seeded.bindingId, now: TEST_NOW_BASE + 3 }));
    expect(running).toMatchObject({ outcome: "running" });
    const view = await t.run((ctx) => entry.getTurnView(admitted(ctx, seeded.operator.userId), { storeId: seeded.operator.storeId, bindingId: seeded.bindingId }));
    expect(view).toMatchObject({ kind: "view", phase: "running" });

    // The shared test profile every other host and turn test pins is untouched.
    const shared = await t.run((ctx) => seedRecordedTurn(ctx, "buffered-peer", { threadKey: "thread-peer", key: "turn-peer", operator: seeded.operator }));
    const sharedGrant = await grantFor(shared.runId);
    expect(sharedGrant).toMatchObject({ profileKey: TEST_PROFILE_ID });
  });
});

// ---------------------------------------------------------------------------
// Provisional narrative: flush, preview ladder, acknowledgement, deletion, exposure
// ---------------------------------------------------------------------------

/** Walk a recorded turn to `running` the way the host does (prepare stamps the provider-invocation row). */
async function startStreamingTurn(t: TestConvex<typeof schema>, seeded: Awaited<ReturnType<typeof seedRecordedTurn>>) {
  const prepared = await t.run((ctx) => TEST_TURN_SEAMS.prepareTurnWithCtx(ctx, { bindingId: seeded.bindingId, now: TEST_NOW_BASE + 1 }));
  if (prepared.kind !== "ready") throw new Error(JSON.stringify(prepared));
  for (const rung of [
    { step: "runtime_thread_bound" as const, runtimeThreadRef: `runtime_thread:${seeded.bindingId}` },
    { step: "runtime_input_saved" as const, runtimeInputRef: `runtime_input:${seeded.bindingId}` },
  ]) {
    const advanced = await t.run((ctx) => advanceTurnBindingWithCtx(ctx, { bindingId: seeded.bindingId, idempotencyKey: `stream:${rung.step}`, now: TEST_NOW_BASE + 2, ...rung }));
    if (advanced.outcome === "rejected") throw new Error(advanced.denial.code);
  }
  const running = await t.run((ctx) => TEST_TURN_SEAMS.markTurnRunningWithCtx(ctx, { bindingId: seeded.bindingId, now: TEST_NOW_BASE + 3 }));
  if (running.outcome !== "running") throw new Error(JSON.stringify(running));
  return prepared.plan;
}

const flush = (t: TestConvex<typeof schema>, bindingId: Id<"agentTurnBinding">, text: string, draftOrdinal = 0, now = clockNow + 1) =>
  t.run((ctx) => TEST_TURN_SEAMS.flushProvisionalNarrativeWithCtx(ctx, { bindingId, draftOrdinal, text, now }));
const row = (t: TestConvex<typeof schema>, bindingId: Id<"agentTurnBinding">) => t.run((ctx) => loadProvisionalNarrativeByBindingWithCtx(ctx, bindingId));
const binding = (t: TestConvex<typeof schema>, bindingId: Id<"agentTurnBinding">) => t.run((ctx) => ctx.db.get("agentTurnBinding", bindingId));
const preview = (t: TestConvex<typeof schema>, userId: Id<"athenaUser">, args: { storeId: Id<"store">; bindingId: Id<"agentTurnBinding"> }) =>
  t.run(async (ctx) => {
    const result = await entry.previewTurnNarrative(admitted(ctx, userId), args);
    assertConformsToExportedReturns(previewTurnNarrative, result);
    return result;
  });
const acknowledge = (t: TestConvex<typeof schema>, userId: Id<"athenaUser">, args: { storeId: Id<"store">; bindingId: Id<"agentTurnBinding"> }) =>
  t.run(async (ctx) => {
    const result = await entry.acknowledgeProvisionalView(admitted(ctx, userId), args);
    assertConformsToExportedReturns(acknowledgeProvisionalView, result);
    return result;
  });
const exposure = (t: TestConvex<typeof schema>, bindingId: Id<"agentTurnBinding">) => t.run((ctx) => describeTurnExposureWithCtx(ctx, bindingId));
/** A stray row, as a host that died mid-flush could leave one: the deletion paths must remove it regardless of who wrote it. */
const plantRow = (t: TestConvex<typeof schema>, seeded: Awaited<ReturnType<typeof seedRecordedTurn>>, text = "planted draft") =>
  t.run((ctx) =>
    upsertProvisionalNarrativeWithCtx(ctx, {
      runId: seeded.runId,
      turnBindingId: seeded.bindingId,
      storeId: seeded.operator.storeId,
      organizationId: seeded.operator.organizationId,
      text,
      draftOrdinal: 9,
      truncated: false,
      egressClass: "sensitive",
      updatedAt: clockNow,
      expiresAt: TEST_CLOCK.now + AGENT_PROVISIONAL_NARRATIVE_TTL_MS,
    }),
  );

describe("provisional narrative: flush, preview ladder, acknowledgement, and terminal deletion", () => {
  it("streams to the owner only, overwrites per draft, refreshes expiry from the server clock, releases the binding once, and is superseded by the commit then deleted by finalize", async () => {
    const t = convexTest(schema, modules);
    const seeded = await t.run((ctx) => seedRecordedTurn(ctx, "stream"));
    const other = await t.run((ctx) => seedDelegatedOperator(ctx, "stream-other", { role: "full_admin" }));
    const args = { storeId: seeded.operator.storeId, bindingId: seeded.bindingId };

    // Queued: nothing released, no invocation row yet, so the egress rung is skipped and the ladder falls through.
    expect(await preview(t, seeded.operator.userId, args)).toEqual({ state: "awaiting_first_text", released: false });
    // A flush before the run is running is refused (the grant reauthorization covers run state) and writes nothing.
    expect(await flush(t, seeded.bindingId, "too early")).toMatchObject({ outcome: "refused", reason: "run_context_captured" });
    expect(await row(t, seeded.bindingId)).toBeNull();
    // The flush is host-only: an internal mutation, never public ingress; the preview and acknowledgement are public.
    expect({ isInternal: flushProvisionalNarrative.isInternal, isMutation: flushProvisionalNarrative.isMutation, public: Object.hasOwn(flushProvisionalNarrative, "isPublic") }).toEqual({ isInternal: true, isMutation: true, public: false });
    expect({ isPublic: previewTurnNarrative.isPublic, isQuery: previewTurnNarrative.isQuery }).toEqual({ isPublic: true, isQuery: true });
    expect({ isPublic: acknowledgeProvisionalView.isPublic, isMutation: acknowledgeProvisionalView.isMutation }).toEqual({ isPublic: true, isMutation: true });

    const plan = await startStreamingTurn(t, seeded);
    expect(plan.egressClass).toBe("sensitive");
    expect(await preview(t, seeded.operator.userId, args)).toEqual({ state: "awaiting_first_text", released: false });

    // Whitespace-only text never creates a row or releases anything.
    expect(await flush(t, seeded.bindingId, "   \n\t")).toMatchObject({ outcome: "refused", reason: "empty_text" });
    expect(await row(t, seeded.bindingId)).toBeNull();
    expect((await binding(t, seeded.bindingId))?.provisionalReleasedAt).toBeUndefined();

    const firstAt = clockNow + 10;
    expect(await flush(t, seeded.bindingId, "Checking which shifts are open", 0, firstAt)).toEqual({ outcome: "stored", truncated: false });
    const stored = await row(t, seeded.bindingId);
    // The egress class is stamped from the provider-invocation row (the turn class), the expiry from the server clock.
    expect(stored).toMatchObject({ text: "Checking which shifts are open", draftOrdinal: 0, truncated: false, egressClass: "sensitive", retentionClass: "short_lived", updatedAt: firstAt, expiresAt: TEST_CLOCK.now + AGENT_PROVISIONAL_NARRATIVE_TTL_MS });
    const afterFirst = await binding(t, seeded.bindingId);
    expect(afterFirst).toMatchObject({ provisionalReleasedAt: firstAt, updatedAt: firstAt });
    const streaming = await preview(t, seeded.operator.userId, args);
    expect(streaming).toMatchObject({ state: "streaming", released: true, text: "Checking which shifts are open", truncated: false, draftOrdinal: 0, updatedAt: firstAt, expiresAt: TEST_CLOCK.now + AGENT_PROVISIONAL_NARRATIVE_TTL_MS });
    expect((streaming as { ttlMs: number }).ttlMs).toBe(TEST_CLOCK.now + AGENT_PROVISIONAL_NARRATIVE_TTL_MS - clockNow);
    // The turn view projects the release marker for hosts whose preview subscription has ended.
    const view = await t.run((ctx) => entry.getTurnView(admitted(ctx, seeded.operator.userId), args));
    expect(view).toMatchObject({ kind: "view", phase: "running", provisionalReleasedAt: firstAt });
    assertConformsToExportedReturns(getTurnView, view);

    // Nobody else: a colleague in the same store and the owner against another store both get the bare pre-ownership arm.
    expect(await preview(t, other.userId, args)).toEqual({ state: "not_found" });
    expect(await preview(t, seeded.operator.userId, { ...args, storeId: other.storeId })).toEqual({ state: "not_found" });
    expect(await acknowledge(t, other.userId, args)).toEqual({ kind: "unavailable", reason: "not_your_turn" });
    expect(await row(t, seeded.bindingId)).not.toBeNull();

    // Later flushes overwrite the one row and never touch the binding again; a new draft replaces the old text.
    const secondAt = clockNow + 20;
    expect(await flush(t, seeded.bindingId, "Checking which shifts are open right now.", 0, secondAt)).toEqual({ outcome: "stored", truncated: false });
    expect(await flush(t, seeded.bindingId, "One shift is open.", 1, secondAt + 1)).toEqual({ outcome: "stored", truncated: false });
    expect(await preview(t, seeded.operator.userId, args)).toMatchObject({ state: "streaming", text: "One shift is open.", draftOrdinal: 1, updatedAt: secondAt + 1 });
    expect(await t.run((ctx) => ctx.db.query("agentProvisionalNarrative").withIndex("by_turnBindingId", (q) => q.eq("turnBindingId", seeded.bindingId)).take(3))).toHaveLength(1);
    expect(await binding(t, seeded.bindingId)).toMatchObject({ provisionalReleasedAt: firstAt, updatedAt: afterFirst!.updatedAt });

    // Over the cap: cut server-side at a codepoint boundary, flagged, still streaming.
    const huge = "é".repeat(AGENT_TOOL_NARRATIVE_MAX_BYTES);
    expect(await flush(t, seeded.bindingId, huge, 1)).toEqual({ outcome: "stored", truncated: true });
    const truncated = await preview(t, seeded.operator.userId, args);
    expect(truncated).toMatchObject({ state: "streaming", truncated: true });
    expect(new TextEncoder().encode((truncated as { text: string }).text).byteLength).toBe(AGENT_TOOL_NARRATIVE_MAX_BYTES);

    // First paint: acknowledged once, first write wins.
    const acknowledged = await acknowledge(t, seeded.operator.userId, args);
    expect(acknowledged).toMatchObject({ kind: "acknowledged" });
    const viewedAt = (acknowledged as { provisionalViewedAt: number }).provisionalViewedAt;
    expect(await acknowledge(t, seeded.operator.userId, args)).toEqual({ kind: "acknowledged", provisionalViewedAt: viewedAt });
    expect(await binding(t, seeded.bindingId)).toMatchObject({ provisionalViewedAt: viewedAt, provisionalViewedByActorRef: `athenaUser:${seeded.operator.userId}` });
    expect(await exposure(t, seeded.bindingId)).toMatchObject({ provisionalExposurePresumed: true, provisionalReleasedAt: firstAt, provisionalViewed: true, provisionalViewedAt: viewedAt, revokedAfterProvisionalExposure: false, operatorReleaseCommitted: false });

    // The commit flips the run mid-turn; the row survives until finalize, and a completed run never reads as a withdrawal.
    await commitAnswer(t, seeded);
    expect(await row(t, seeded.bindingId)).not.toBeNull();
    expect(await preview(t, seeded.operator.userId, args)).toEqual({ state: "superseded", released: true });
    // A late flush after the commit is refused and deletes rather than inserts.
    expect(await flush(t, seeded.bindingId, "late draft", 2)).toMatchObject({ outcome: "refused", reason: "run_completed" });
    expect(await row(t, seeded.bindingId)).toBeNull();
    await plantRow(t, seeded);
    // Commit, then the provider fails before the turn ends: finalize still deletes, above its already-terminal path.
    expect(await t.run((ctx) => TEST_TURN_SEAMS.finalizeTurnWithCtx(ctx, { bindingId: seeded.bindingId, outcome: "failed", error: { code: "provider_failure", message: "x", retryable: true }, now: clockNow + 50 }))).toMatchObject({ outcome: "completed", runStatus: "completed" });
    expect(await row(t, seeded.bindingId)).toBeNull();
    expect(await preview(t, seeded.operator.userId, args)).toEqual({ state: "superseded", released: true });
    expect(await exposure(t, seeded.bindingId)).toMatchObject({ provisionalExposurePresumed: true, revokedAfterProvisionalExposure: false, operatorReleaseCommitted: true, releaseSuppressed: false });
  });

  it("a buffered profile never stores a row: the preview reports disabled before a release and policy_disabled after one", async () => {
    const t = convexTest(schema, modules);
    const seeded = await t.run((ctx) => seedRecordedTurn(ctx, "buffered-stream", { profileId: TEST_BUFFERED_PROFILE_ID }));
    const args = { storeId: seeded.operator.storeId, bindingId: seeded.bindingId };
    await startStreamingTurn(t, seeded);
    expect(await preview(t, seeded.operator.userId, args)).toEqual({ state: "disabled", released: false });
    expect(await flush(t, seeded.bindingId, "Checking shifts")).toMatchObject({ outcome: "refused", reason: "policy_buffered" });
    expect(await row(t, seeded.bindingId)).toBeNull();
    expect((await binding(t, seeded.bindingId))?.provisionalReleasedAt).toBeUndefined();
    expect(await preview(t, seeded.operator.userId, args)).toEqual({ state: "disabled", released: false });
    // Acknowledging before any release is refused and writes nothing.
    expect(await acknowledge(t, seeded.operator.userId, args)).toEqual({ kind: "unavailable", reason: "not_released" });
    expect((await binding(t, seeded.bindingId))?.provisionalViewedAt).toBeUndefined();
    // A profile flipped to buffered after text was on screen withdraws with a notice instead of vanishing silently.
    await t.run((ctx) => markProvisionalReleaseWithCtx(ctx, { bindingId: seeded.bindingId, now: clockNow }));
    expect(await preview(t, seeded.operator.userId, args)).toEqual({ state: "withdrawn", reason: "policy_disabled", released: true });
  });

  it("withdraws the moment membership is revoked: the preview refuses with no payload, the next flush deletes, the revoked owner's acknowledgement deletes, and the clamp records the revocation", async () => {
    const t = convexTest(schema, modules);
    const seeded = await t.run((ctx) => seedRecordedTurn(ctx, "revoke-stream"));
    const args = { storeId: seeded.operator.storeId, bindingId: seeded.bindingId };
    await startStreamingTurn(t, seeded);
    expect(await flush(t, seeded.bindingId, "Checking shifts")).toEqual({ outcome: "stored", truncated: false });
    expect(await preview(t, seeded.operator.userId, args)).toMatchObject({ state: "streaming" });

    await t.run((ctx) => ctx.db.delete("organizationMember", seeded.operator.membershipId!));
    const withdrawn = await preview(t, seeded.operator.userId, args);
    expect(withdrawn).toEqual({ state: "withdrawn", reason: "membership_revoked", released: true });
    expect(Object.keys(withdrawn).sort()).toEqual(["reason", "released", "state"]);
    // The row is still at rest until a writer runs; the refused reader cannot watch it.
    expect(await row(t, seeded.bindingId)).not.toBeNull();
    expect(await flush(t, seeded.bindingId, "Checking shifts and cash")).toMatchObject({ outcome: "refused", reason: "membership_revoked" });
    expect(await row(t, seeded.bindingId)).toBeNull();
    // A refused acknowledgement on the caller's own turn deletes whatever is at rest.
    await plantRow(t, seeded);
    expect(await acknowledge(t, seeded.operator.userId, args)).toEqual({ kind: "unavailable", reason: "membership_revoked" });
    expect(await row(t, seeded.bindingId)).toBeNull();
    expect((await binding(t, seeded.bindingId))?.provisionalViewedAt).toBeUndefined();
    // The authority revocation ends the run moments later; this zero-attempt turn is reported as revoked after exposure.
    await t.run((ctx) => cancelAgentRunWithCtx(ctx, { runId: seeded.runId, idempotencyKey: "revoked", reason: "authority_revoked", now: clockNow + 5 }));
    expect(await preview(t, seeded.operator.userId, args)).toEqual({ state: "withdrawn", reason: "membership_revoked", released: true });
    expect(await exposure(t, seeded.bindingId)).toMatchObject({ runStatus: "canceled", binding: "abandoned", provisionalExposurePresumed: true, provisionalViewed: false, revokedAfterProvisionalExposure: true });
  });

  it("withdraws on profile disablement and on an epoch advance while deltas continue", async () => {
    const t = convexTest(schema, modules);
    const disabled = await t.run((ctx) => seedRecordedTurn(ctx, "disable-stream"));
    const fenced = await t.run((ctx) => seedRecordedTurn(ctx, "fence-stream"));
    await startStreamingTurn(t, disabled);
    await startStreamingTurn(t, fenced);
    for (const seeded of [disabled, fenced]) expect(await flush(t, seeded.bindingId, "Checking")).toEqual({ outcome: "stored", truncated: false });

    TEST_ENABLEMENT.narrow({ profiles: { [TEST_PROFILE_ID]: "disabled" } });
    expect(await preview(t, disabled.operator.userId, { storeId: disabled.operator.storeId, bindingId: disabled.bindingId })).toEqual({ state: "withdrawn", reason: "profile_disabled", released: true });
    expect(await flush(t, disabled.bindingId, "Checking more")).toMatchObject({ outcome: "refused", reason: "profile_disabled" });
    expect(await row(t, disabled.bindingId)).toBeNull();
    TEST_ENABLEMENT.reset();

    await t.run(async (ctx) => {
      const current = await getCurrentCompatibilityEpochWithCtx(ctx);
      await advanceCompatibilityEpochWithCtx(ctx, { epoch: current.epoch + 1, digest: "fnv1a64:next", idempotencyKey: "deploy-next", now: clockNow });
    });
    expect(await preview(t, fenced.operator.userId, { storeId: fenced.operator.storeId, bindingId: fenced.bindingId })).toEqual({ state: "withdrawn", reason: "compatibility_epoch_fenced", released: true });
    expect(await flush(t, fenced.bindingId, "Checking more")).toMatchObject({ outcome: "refused", reason: "compatibility_epoch_fenced" });
    expect(await row(t, fenced.bindingId)).toBeNull();
  });

  it("refuses provisional text to an operator whose live egress class ranks below the turn's stamped class, while a mere capability narrowing keeps streaming", async () => {
    const t = convexTest(schema, modules);
    // Narrowing: the audit trail (operational) is switched off; the full admin still holds the sensitive projections.
    const narrowed = await t.run((ctx) => seedRecordedTurn(ctx, "narrow-stream"));
    const narrowedArgs = { storeId: narrowed.operator.storeId, bindingId: narrowed.bindingId };
    await startStreamingTurn(t, narrowed);
    expect(await flush(t, narrowed.bindingId, "Checking")).toEqual({ outcome: "stored", truncated: false });
    TEST_ENABLEMENT.narrow({ capabilities: { cap_test_ops_audit_trail: "disabled" } });
    expect(await flush(t, narrowed.bindingId, "Checking shifts")).toEqual({ outcome: "stored", truncated: false });
    expect(await preview(t, narrowed.operator.userId, narrowedArgs)).toMatchObject({ state: "streaming", text: "Checking shifts" });
    TEST_ENABLEMENT.reset();

    // Downgrade mid-turn: the turn was stamped sensitive for a full admin; a POS-only member ranks below it.
    await t.run((ctx) => ctx.db.patch("organizationMember", narrowed.operator.membershipId!, { role: "pos_only", operationalRoles: [] }));
    const withdrawn = await preview(t, narrowed.operator.userId, narrowedArgs);
    expect(withdrawn).toEqual({ state: "withdrawn", reason: "egress_beyond_authority", released: true });
    expect(await flush(t, narrowed.bindingId, "Checking shifts and revenue")).toMatchObject({ outcome: "refused", reason: "egress_beyond_authority" });
    expect(await row(t, narrowed.bindingId)).toBeNull();
    // The verdict survives the deletion: a remount still sees the withdrawal, never a stall.
    expect(await preview(t, narrowed.operator.userId, narrowedArgs)).toEqual({ state: "withdrawn", reason: "egress_beyond_authority", released: true });
    // The downgraded owner's acknowledgement is refused and deletes whatever is at rest.
    await plantRow(t, narrowed);
    expect(await acknowledge(t, narrowed.operator.userId, narrowedArgs)).toEqual({ kind: "unavailable", reason: "egress_beyond_authority" });
    expect(await row(t, narrowed.bindingId)).toBeNull();

    // Stamped before any flush: the very first flush is refused and nothing is ever released; the preview withdraws on an otherwise healthy turn.
    const early = await t.run((ctx) => seedRecordedTurn(ctx, "early-downgrade"));
    const earlyArgs = { storeId: early.operator.storeId, bindingId: early.bindingId };
    await startStreamingTurn(t, early);
    await t.run((ctx) => ctx.db.patch("organizationMember", early.operator.membershipId!, { role: "pos_only", operationalRoles: [] }));
    expect(await flush(t, early.bindingId, "Checking")).toMatchObject({ outcome: "refused", reason: "egress_beyond_authority" });
    expect(await row(t, early.bindingId)).toBeNull();
    expect((await binding(t, early.bindingId))?.provisionalReleasedAt).toBeUndefined();
    expect(await preview(t, early.operator.userId, earlyArgs)).toEqual({ state: "withdrawn", reason: "egress_beyond_authority", released: false });
    // The committed answer still follows the answer surface's own rules.
    await commitAnswer(t, early);
    expect(await t.run((ctx) => entry.getTurnAnswer(admitted(ctx, early.operator.userId), earlyArgs))).toEqual({ kind: "unavailable", reason: "egress_beyond_authority" });

    // An invocation row with no egress class at all refuses the flush (fail closed), and an unknown class normalizes to restricted.
    const missing = await t.run((ctx) => seedRecordedTurn(ctx, "egress-missing"));
    await startStreamingTurn(t, missing);
    await t.run(async (ctx) => {
      const invocation = (await ctx.db.query("intelligenceProviderInvocation").withIndex("by_runId", (q) => q.eq("runId", missing.runId)).take(1))[0];
      await ctx.db.patch("intelligenceProviderInvocation", invocation._id, { requestSummary: { ...invocation.requestSummary, egressClass: "mystery" } });
    });
    expect(await flush(t, missing.bindingId, "Checking")).toMatchObject({ outcome: "refused", reason: "egress_beyond_authority" });
    expect(await preview(t, missing.operator.userId, { storeId: missing.operator.storeId, bindingId: missing.bindingId })).toEqual({ state: "withdrawn", reason: "egress_beyond_authority", released: false });
    await t.run(async (ctx) => {
      const invocation = (await ctx.db.query("intelligenceProviderInvocation").withIndex("by_runId", (q) => q.eq("runId", missing.runId)).take(1))[0];
      await ctx.db.delete("intelligenceProviderInvocation", invocation._id);
    });
    expect(await flush(t, missing.bindingId, "Checking")).toMatchObject({ outcome: "refused", reason: "egress_class_missing" });
    expect(await row(t, missing.bindingId)).toBeNull();

    // A stamp that goes missing AFTER text was released fails closed on the
    // preview as well: the skip covers only turns that never released.
    const unstamped = await t.run((ctx) => seedRecordedTurn(ctx, "egress-unstamped"));
    const unstampedArgs = { storeId: unstamped.operator.storeId, bindingId: unstamped.bindingId };
    await startStreamingTurn(t, unstamped);
    expect(await flush(t, unstamped.bindingId, "Checking")).toEqual({ outcome: "stored", truncated: false });
    await t.run(async (ctx) => {
      const invocation = (await ctx.db.query("intelligenceProviderInvocation").withIndex("by_runId", (q) => q.eq("runId", unstamped.runId)).take(1))[0];
      await ctx.db.delete("intelligenceProviderInvocation", invocation._id);
    });
    const unstampedPreview = await preview(t, unstamped.operator.userId, unstampedArgs);
    expect(unstampedPreview).toEqual({ state: "withdrawn", reason: "egress_beyond_authority", released: true });
    expect(Object.keys(unstampedPreview).sort()).toEqual(["reason", "released", "state"]);
  });

  it("reports stalled past the expiry bound, withdrawn for canceled, failed, and suppressed turns, and the exposure truth table for a post-commit suppression", async () => {
    const t = convexTest(schema, modules);
    const stalled = await t.run((ctx) => seedRecordedTurn(ctx, "stalled-stream"));
    const stalledArgs = { storeId: stalled.operator.storeId, bindingId: stalled.bindingId };
    await startStreamingTurn(t, stalled);
    expect(await flush(t, stalled.bindingId, "Checking")).toEqual({ outcome: "stored", truncated: false });
    // The expiry bound is a server fact: past it the row is unreadable even though it is still at rest.
    await t.run(async (ctx) => {
      const current = await loadProvisionalNarrativeByBindingWithCtx(ctx, stalled.bindingId);
      await ctx.db.patch("agentProvisionalNarrative", current!._id, { expiresAt: clockNow });
    });
    const stalledPreview = await preview(t, stalled.operator.userId, stalledArgs);
    expect(stalledPreview).toEqual({ state: "stalled", released: true });
    // A released turn whose row is gone is also stalled, never awaiting_first_text.
    await t.run(async (ctx) => {
      const current = await loadProvisionalNarrativeByBindingWithCtx(ctx, stalled.bindingId);
      await ctx.db.delete("agentProvisionalNarrative", current!._id);
    });
    expect(await preview(t, stalled.operator.userId, stalledArgs)).toEqual({ state: "stalled", released: true });
    // The next flush refreshes the bound and streaming returns.
    expect(await flush(t, stalled.bindingId, "Checking again", 1)).toEqual({ outcome: "stored", truncated: false });
    expect(await preview(t, stalled.operator.userId, stalledArgs)).toMatchObject({ state: "streaming", text: "Checking again", draftOrdinal: 1 });

    // A commit prepared and then refused leaves the binding at
    // `completion_prepared`: the insert guard admits that step too, so a
    // resumed draft is not frozen out of the pane.
    const prepared = await t.run((ctx) => advanceTurnBindingWithCtx(ctx, { bindingId: stalled.bindingId, step: "completion_prepared", idempotencyKey: "prepared-once", preparedCompletionRef: "prepared:1", now: clockNow }));
    expect(prepared.outcome).not.toBe("rejected");
    expect(await flush(t, stalled.bindingId, "Retrying the citation.", 2)).toEqual({ outcome: "stored", truncated: false });
    expect(await preview(t, stalled.operator.userId, stalledArgs)).toMatchObject({ state: "streaming", text: "Retrying the citation.", draftOrdinal: 2 });

    // Operator cancel: the clamp deletes in the same transaction; the earlier acknowledgement is preserved as audit.
    expect(await acknowledge(t, stalled.operator.userId, stalledArgs)).toMatchObject({ kind: "acknowledged" });
    expect(await t.run((ctx) => entry.cancelTurn(admitted(ctx, stalled.operator.userId), stalledArgs))).toEqual({ outcome: "canceled" });
    expect(await row(t, stalled.bindingId)).toBeNull();
    expect(await binding(t, stalled.bindingId)).toMatchObject({ provisionalViewedAt: expect.any(Number), provisionalReleasedAt: expect.any(Number) });
    expect(await preview(t, stalled.operator.userId, stalledArgs)).toEqual({ state: "withdrawn", reason: "run_canceled", released: true });
    expect(await flush(t, stalled.bindingId, "late", 2)).toMatchObject({ outcome: "refused", reason: "run_canceled" });
    expect(await row(t, stalled.bindingId)).toBeNull();

    const failed = await t.run((ctx) => seedRecordedTurn(ctx, "failed-stream", { threadKey: "thread-failed", key: "turn-failed", operator: stalled.operator }));
    const failedArgs = { storeId: failed.operator.storeId, bindingId: failed.bindingId };
    await startStreamingTurn(t, failed);
    expect(await flush(t, failed.bindingId, "Checking")).toEqual({ outcome: "stored", truncated: false });
    await t.run((ctx) => failAgentRunWithCtx(ctx, { runId: failed.runId, idempotencyKey: "fail", error: { code: "provider_failure", message: "x", retryable: true }, now: clockNow + 1 }));
    expect(await row(t, failed.bindingId)).toBeNull();
    expect(await preview(t, failed.operator.userId, failedArgs)).toEqual({ state: "withdrawn", reason: "run_failed", released: true });
    expect(await exposure(t, failed.bindingId)).toMatchObject({ runStatus: "failed", provisionalExposurePresumed: true, revokedAfterProvisionalExposure: true });

    // Post-commit suppression: committed binding, yet the draft is withdrawn and the exposure records the recall.
    const suppressed = await t.run((ctx) => seedRecordedTurn(ctx, "suppressed-stream", { threadKey: "thread-suppressed", key: "turn-suppressed", operator: stalled.operator }));
    const suppressedArgs = { storeId: suppressed.operator.storeId, bindingId: suppressed.bindingId };
    await startStreamingTurn(t, suppressed);
    expect(await flush(t, suppressed.bindingId, "Checking")).toEqual({ outcome: "stored", truncated: false });
    await commitAnswer(t, suppressed);
    expect(await preview(t, suppressed.operator.userId, suppressedArgs)).toEqual({ state: "superseded", released: true });
    await t.run((ctx) => TEST_TURN_SEAMS.outbox.suppressReleaseWithCtx(ctx, { bindingId: suppressed.bindingId, reason: "membership_revoked", now: clockNow + 2 }));
    expect(await row(t, suppressed.bindingId)).toBeNull();
    expect(await preview(t, suppressed.operator.userId, suppressedArgs)).toEqual({ state: "withdrawn", reason: "suppressed", released: true });
    expect(await exposure(t, suppressed.bindingId)).toMatchObject({ runStatus: "completed", operatorReleaseCommitted: true, releaseSuppressed: true, provisionalExposurePresumed: true, revokedAfterProvisionalExposure: true });
    // A never-released binding is never reported as exposed, whatever happened later.
    const untouched = await t.run((ctx) => seedRecordedTurn(ctx, "untouched-stream", { threadKey: "thread-untouched", key: "turn-untouched", operator: stalled.operator }));
    await t.run((ctx) => cancelAgentRunWithCtx(ctx, { runId: untouched.runId, idempotencyKey: "cancel", reason: "operator_canceled", now: clockNow + 3 }));
    expect(await exposure(t, untouched.bindingId)).toMatchObject({ runStatus: "canceled", provisionalExposurePresumed: false, revokedAfterProvisionalExposure: false });
    // A binding that no longer exists has no exposure to report.
    await t.run((ctx) => ctx.db.delete("agentTurnBinding", untouched.bindingId));
    expect(await exposure(t, untouched.bindingId)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Turn trace: the engineer-only record of what the model and the harness exchanged
// ---------------------------------------------------------------------------

const traceRows = (t: TestConvex<typeof schema>, bindingId: Id<"agentTurnBinding">) => t.run((ctx) => listTurnTraceByBindingWithCtx(ctx, bindingId, 50));

const recordTrace = (t: TestConvex<typeof schema>, bindingId: Id<"agentTurnBinding">, events: Parameters<typeof TEST_TURN_SEAMS.recordTurnTraceWithCtx>[1]["events"]) =>
  t.run((ctx) => TEST_TURN_SEAMS.recordTurnTraceWithCtx(ctx, { bindingId, events }));

const traceEvent = (overrides: Partial<Parameters<typeof TEST_TURN_SEAMS.recordTurnTraceWithCtx>[1]["events"][number]> = {}) => ({
  source: "adapter" as const,
  sequence: 0,
  at: TEST_NOW_BASE + 5,
  kind: "narrative_delta",
  payload: { text: "Checking which shifts are open." },
  ...overrides,
});

describe("turn trace recording", () => {
  afterEach(() => {
    delete process.env.AGENT_TURN_TRACE;
  });

  it("stamps every row with the binding's run and scope and keeps the order it was given", async () => {
    const t = convexTest(schema, modules);
    const seeded = await t.run((ctx) => seedRecordedTurn(ctx, "trace-scope"));
    const recorded = await recordTrace(t, seeded.bindingId, [
      traceEvent({ sequence: 0, kind: "turn_started", payload: {} }),
      traceEvent({ sequence: 1 }),
      traceEvent({ source: "host", sequence: 2, kind: "tool_dispatch", payload: { toolId: "athena.executeProgram", args: { source: "return 1;" }, outcome: { kind: "success", result: { open: 1 } } } }),
    ]);
    expect(recorded).toEqual({ recorded: 3, enabled: true });

    const rows = await traceRows(t, seeded.bindingId);
    expect(rows.map((row) => [row.source, row.sequence, row.kind])).toEqual([
      ["adapter", 0, "turn_started"],
      ["adapter", 1, "narrative_delta"],
      ["host", 2, "tool_dispatch"],
    ]);
    for (const row of rows) {
      expect(row).toMatchObject({ runId: seeded.runId, storeId: seeded.operator.storeId, organizationId: seeded.operator.organizationId, retentionClass: "standard", truncated: false });
      expect(row.expiresAt).toBe(row.createdAt + AGENT_TURN_TRACE_RETENTION_MS);
    }
    // The point of the table: the deltas, the exact arguments, and the outcome
    // the model received are all replayable from it.
    expect(rows[1].payload).toEqual({ text: "Checking which shifts are open." });
    expect(rows[2].payload).toMatchObject({ toolId: "athena.executeProgram", args: { source: "return 1;" }, outcome: { kind: "success", result: { open: 1 } } });
  });

  it("re-fits an over-cap payload server-side rather than trusting the host", async () => {
    const t = convexTest(schema, modules);
    const seeded = await t.run((ctx) => seedRecordedTurn(ctx, "trace-cap"));
    const oversized = "x".repeat(AGENT_TURN_TRACE_EVENT_PAYLOAD_MAX_BYTES * 2);
    expect(await recordTrace(t, seeded.bindingId, [traceEvent({ kind: "tool_dispatch", source: "host", payload: { toolId: "athena.executeProgram", args: { source: oversized } } })])).toEqual({ recorded: 1, enabled: true });
    const [row] = await traceRows(t, seeded.bindingId);
    expect(row.truncated).toBe(true);
    expect(new TextEncoder().encode(JSON.stringify(row.payload)).byteLength).toBeLessThanOrEqual(AGENT_TURN_TRACE_EVENT_PAYLOAD_MAX_BYTES);
    expect((row.payload as { toolId: string }).toolId).toBe("athena.executeProgram");
  });

  it("writes nothing when the capture switch is off", async () => {
    const t = convexTest(schema, modules);
    const seeded = await t.run((ctx) => seedRecordedTurn(ctx, "trace-off"));
    process.env.AGENT_TURN_TRACE = "off";
    expect(await recordTrace(t, seeded.bindingId, [traceEvent()])).toEqual({ recorded: 0, enabled: false });
    expect(await traceRows(t, seeded.bindingId)).toEqual([]);
    delete process.env.AGENT_TURN_TRACE;
    expect(await recordTrace(t, seeded.bindingId, [traceEvent()])).toEqual({ recorded: 1, enabled: true });
  });

  it("links a program tool outcome to the stored program result so the full body is one hop away", async () => {
    const t = convexTest(schema, modules);
    const seeded = await t.run((ctx) => seedRecordedTurn(ctx, "trace-replay"));
    const replayPayloadId = await t.run((ctx) =>
      ctx.db.insert("agentReplayPayload", {
        runId: seeded.runId,
        storeId: seeded.operator.storeId,
        organizationId: seeded.operator.organizationId,
        subjectKind: "program_result",
        contentHash: "fnv1a64:result",
        content: { open: 1 },
        byteLength: 12,
        retentionClass: "short_lived",
        expiresAt: TEST_NOW_BASE + 100_000,
        createdAt: TEST_NOW_BASE + 5,
      }),
    );
    await recordTrace(t, seeded.bindingId, [
      traceEvent({ sequence: 0, kind: "tool_call_completed", payload: { toolId: "athena.executeProgram", callId: "c1", outcomeKind: "success" } }),
      traceEvent({ sequence: 1, kind: "tool_call_completed", payload: { toolId: "athena.completeRun", callId: "c2", outcomeKind: "success" } }),
    ]);
    const rows = await traceRows(t, seeded.bindingId);
    expect(rows[0].replayPayloadId).toBe(replayPayloadId);
    expect(rows[1].replayPayloadId).toBeUndefined();
  });

  it("records nothing for a binding that no longer exists", async () => {
    const t = convexTest(schema, modules);
    const seeded = await t.run((ctx) => seedRecordedTurn(ctx, "trace-missing"));
    await t.run((ctx) => ctx.db.delete("agentTurnBinding", seeded.bindingId));
    expect(await recordTrace(t, seeded.bindingId, [traceEvent()])).toEqual({ recorded: 0, enabled: true });
  });
});

// ---------------------------------------------------------------------------
// Narrative trail: the committed turn's finished drafts, released with the answer
// ---------------------------------------------------------------------------

const trailRow = (t: TestConvex<typeof schema>, bindingId: Id<"agentTurnBinding">) => t.run((ctx) => loadTurnNarrativeTrailByBindingWithCtx(ctx, bindingId));

const readTrail = (t: TestConvex<typeof schema>, userId: Id<"athenaUser">, args: { storeId: Id<"store">; bindingId: Id<"agentTurnBinding"> }) =>
  t.run(async (ctx) => {
    const result = await entry.getTurnNarrativeTrail(admitted(ctx, userId), args);
    assertConformsToExportedReturns(getTurnNarrativeTrail, result);
    return result;
  });

const DRAFTS = [
  { draftOrdinal: 0, text: "Checking which shifts are open.", truncated: false },
  { draftOrdinal: 1, text: "One shift is open, writing it up.", truncated: false },
];

const finalizeCompleted = (t: TestConvex<typeof schema>, bindingId: Id<"agentTurnBinding">, trail = DRAFTS, now = clockNow + 60) =>
  t.run((ctx) => TEST_TURN_SEAMS.finalizeTurnWithCtx(ctx, { bindingId, outcome: "completed", trail, now }));

describe("narrative trail: written at commit, released and withdrawn with the answer", () => {
  it("keeps a completed turn's drafts and serves them to the owner alone, on the answer's own gate", async () => {
    const t = convexTest(schema, modules);
    const seeded = await t.run((ctx) => seedRecordedTurn(ctx, "trail"));
    const other = await t.run((ctx) => seedDelegatedOperator(ctx, "trail-other", { role: "full_admin" }));
    const args = { storeId: seeded.operator.storeId, bindingId: seeded.bindingId };
    await startStreamingTurn(t, seeded);

    // Before the commit there is nothing to read: the same reason the answer mints.
    expect(await readTrail(t, seeded.operator.userId, args)).toEqual({ kind: "unavailable", reason: "not_ready" });
    expect(await trailRow(t, seeded.bindingId)).toBeNull();

    await flush(t, seeded.bindingId, DRAFTS[0].text, 0);
    await commitAnswer(t, seeded);
    // The commit alone writes nothing; the trail is a finalize-time record.
    // In the window between the two the read is honest rather than refusing:
    // the answer is readable, so the trail answers with the drafts it has.
    expect(await trailRow(t, seeded.bindingId)).toBeNull();
    const committedBinding = await t.run((ctx) => ctx.db.get("agentTurnBinding", seeded.bindingId));
    expect(await readTrail(t, seeded.operator.userId, args)).toEqual({ kind: "trail", committedAt: committedBinding!.operatorReleaseCommittedAt, entries: [] });

    const finalized = await finalizeCompleted(t, seeded.bindingId);
    expect(finalized).toMatchObject({ outcome: "completed", runStatus: "completed" });
    // The provisional row is still deleted by the same transaction.
    expect(await row(t, seeded.bindingId)).toBeNull();

    const stored = await trailRow(t, seeded.bindingId);
    // The class is the COMMITTED ANSWER's, so the trail can never outrank it.
    expect(stored).toMatchObject({ runId: seeded.runId, storeId: seeded.operator.storeId, organizationId: seeded.operator.organizationId, egressClass: "sensitive", retentionClass: "standard" });
    expect(stored!.expiresAt).toBe(stored!.createdAt + AGENT_TURN_NARRATIVE_TRAIL_RETENTION_MS);

    const binding = await t.run((ctx) => ctx.db.get("agentTurnBinding", seeded.bindingId));
    const served = await readTrail(t, seeded.operator.userId, args);
    expect(served).toEqual({ kind: "trail", committedAt: binding!.operatorReleaseCommittedAt, entries: DRAFTS });

    // Nobody else: a colleague in the same store and the owner against another store.
    expect(await readTrail(t, other.userId, args)).toEqual({ kind: "unavailable", reason: "not_your_turn" });
    expect(await readTrail(t, seeded.operator.userId, { ...args, storeId: other.storeId })).toEqual({ kind: "unavailable", reason: "not_found" });

    // Insert-once: a second finalize never rewrites the record, and the read never writes.
    await finalizeCompleted(t, seeded.bindingId, [{ draftOrdinal: 0, text: "REWRITTEN", truncated: false }], clockNow + 70);
    expect(JSON.stringify(await trailRow(t, seeded.bindingId))).not.toContain("REWRITTEN");
    await readTrail(t, seeded.operator.userId, args);
    expect(await t.run((ctx) => ctx.db.query("agentTurnNarrativeTrail").withIndex("by_turnBindingId", (q) => q.eq("turnBindingId", seeded.bindingId)).take(3))).toHaveLength(1);

    // The read is a public query, admitted on the same rail as the answer.
    expect({ isPublic: getTurnNarrativeTrail.isPublic, isQuery: getTurnNarrativeTrail.isQuery }).toEqual({ isPublic: true, isQuery: true });
  });

  it("refuses the trail on a buffered profile, written or not, with the reason the preview uses", async () => {
    const t = convexTest(schema, modules);
    const seeded = await t.run((ctx) => seedRecordedTurn(ctx, "trail-buffered", { profileId: TEST_BUFFERED_PROFILE_ID }));
    const args = { storeId: seeded.operator.storeId, bindingId: seeded.bindingId };
    await startStreamingTurn(t, seeded);
    await commitAnswer(t, seeded);
    await finalizeCompleted(t, seeded.bindingId);
    // The answer itself is readable; the drafts are not a thing this profile serves.
    expect(await readTrail(t, seeded.operator.userId, args)).toEqual({ kind: "unavailable", reason: "policy_disabled" });
  });

  it("writes nothing for a canceled or a failed turn, and nothing when the turn narrated nothing", async () => {
    const t = convexTest(schema, modules);
    const canceled = await t.run((ctx) => seedRecordedTurn(ctx, "trail-cancel"));
    await startStreamingTurn(t, canceled);
    expect(await t.run((ctx) => TEST_TURN_SEAMS.finalizeTurnWithCtx(ctx, { bindingId: canceled.bindingId, outcome: "canceled", trail: DRAFTS, error: { code: "operator_canceled", message: "stopped", retryable: false }, now: clockNow + 5 }))).toMatchObject({ outcome: "canceled" });
    expect(await trailRow(t, canceled.bindingId)).toBeNull();
    expect(await readTrail(t, canceled.operator.userId, { storeId: canceled.operator.storeId, bindingId: canceled.bindingId })).toEqual({ kind: "unavailable", reason: "not_ready" });

    const failed = await t.run((ctx) => seedRecordedTurn(ctx, "trail-fail", { threadKey: "thread-trail-fail", key: "turn-trail-fail", operator: canceled.operator }));
    await startStreamingTurn(t, failed);
    expect(await t.run((ctx) => TEST_TURN_SEAMS.finalizeTurnWithCtx(ctx, { bindingId: failed.bindingId, outcome: "failed", trail: DRAFTS, error: { code: "provider_failure", message: "x", retryable: true }, now: clockNow + 6 }))).toMatchObject({ outcome: "failed" });
    expect(await trailRow(t, failed.bindingId)).toBeNull();

    // A committed turn the host narrated nothing on: no trail, and the read says so honestly with an empty one.
    const silent = await t.run((ctx) => seedRecordedTurn(ctx, "trail-silent", { threadKey: "thread-trail-silent", key: "turn-trail-silent", operator: canceled.operator }));
    const silentArgs = { storeId: silent.operator.storeId, bindingId: silent.bindingId };
    await startStreamingTurn(t, silent);
    await commitAnswer(t, silent);
    expect(await finalizeCompleted(t, silent.bindingId, [], clockNow + 7)).toMatchObject({ outcome: "completed" });
    expect(await trailRow(t, silent.bindingId)).toBeNull();
    const binding = await t.run((ctx) => ctx.db.get("agentTurnBinding", silent.bindingId));
    expect(await readTrail(t, silent.operator.userId, silentArgs)).toEqual({ kind: "trail", committedAt: binding!.operatorReleaseCommittedAt, entries: [] });
  });

  it("refuses the trail after a release is suppressed, after membership is revoked, and on an egress downgrade — the row stays at rest", async () => {
    const t = convexTest(schema, modules);
    const suppressed = await t.run((ctx) => seedRecordedTurn(ctx, "trail-suppress"));
    const suppressedArgs = { storeId: suppressed.operator.storeId, bindingId: suppressed.bindingId };
    await startStreamingTurn(t, suppressed);
    await commitAnswer(t, suppressed);
    await finalizeCompleted(t, suppressed.bindingId);
    expect(await readTrail(t, suppressed.operator.userId, suppressedArgs)).toMatchObject({ kind: "trail" });

    // Suppression never deletes the row — it refuses the ladder, exactly as the answer does.
    await t.run((ctx) => TEST_TURN_SEAMS.outbox.suppressReleaseWithCtx(ctx, { bindingId: suppressed.bindingId, reason: "membership_revoked", now: clockNow + 80 }));
    expect(await trailRow(t, suppressed.bindingId)).not.toBeNull();
    expect(await readTrail(t, suppressed.operator.userId, suppressedArgs)).toEqual({ kind: "unavailable", reason: "suppressed" });
    expect(await t.run((ctx) => entry.getTurnAnswer(admitted(ctx, suppressed.operator.userId), suppressedArgs))).toEqual({ kind: "unavailable", reason: "suppressed" });

    // Membership revoked: the trail refuses before ownership facts are served.
    const revoked = await t.run((ctx) => seedRecordedTurn(ctx, "trail-revoke"));
    const revokedArgs = { storeId: revoked.operator.storeId, bindingId: revoked.bindingId };
    await startStreamingTurn(t, revoked);
    await commitAnswer(t, revoked);
    await finalizeCompleted(t, revoked.bindingId);
    expect(await readTrail(t, revoked.operator.userId, revokedArgs)).toMatchObject({ kind: "trail" });
    await t.run((ctx) => ctx.db.delete("organizationMember", revoked.operator.membershipId!));
    expect(await readTrail(t, revoked.operator.userId, revokedArgs)).toEqual({ kind: "unavailable", reason: "membership_revoked" });
    expect(await trailRow(t, revoked.bindingId)).not.toBeNull();

    // Egress downgrade: the trail carries the answer's class, so both refuse together.
    const downgraded = await t.run((ctx) => seedRecordedTurn(ctx, "trail-downgrade"));
    const downgradedArgs = { storeId: downgraded.operator.storeId, bindingId: downgraded.bindingId };
    await startStreamingTurn(t, downgraded);
    await commitAnswer(t, downgraded);
    await finalizeCompleted(t, downgraded.bindingId);
    expect(await readTrail(t, downgraded.operator.userId, downgradedArgs)).toMatchObject({ kind: "trail" });
    await t.run((ctx) => ctx.db.patch("organizationMember", downgraded.operator.membershipId!, { role: "pos_only", operationalRoles: [] }));
    expect(await readTrail(t, downgraded.operator.userId, downgradedArgs)).toEqual({ kind: "unavailable", reason: "egress_beyond_authority" });
    expect(await t.run((ctx) => entry.getTurnAnswer(admitted(ctx, downgraded.operator.userId), downgradedArgs))).toEqual({ kind: "unavailable", reason: "egress_beyond_authority" });
  });
});
