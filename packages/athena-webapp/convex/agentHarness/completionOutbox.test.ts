// @vitest-environment node
/// <reference types="vite/client" />
/**
 * Completion outbox: `completeRun` prepares
 * privately, ONE Athena transaction commits evidence/artifact/run and
 * `operator_release_committed`, and an idempotent outbox projects the
 * committed, currently authorized artifact through the adapter afterwards.
 * Repair retries without duplicating history or reopening the run; revocation
 * between prepare and commit wins; revocation after commit but before an
 * authorized fetch suppresses release, asks the adapter to purge, and keeps
 * the exposure audit.
 */
import { convexTest, type TestConvex } from "convex-test";
import { afterEach, describe, expect, it } from "vitest";

import schema from "../schema";
import { looksLikeRawDocumentId } from "../../shared/agentHarness/values";
import { TEST_ADMISSION, TEST_CLOCK, TEST_NOW_BASE } from "./delegatedAdmission.testPorts";
import { TEST_EXECUTOR_SEAMS, beginExecutingAttempt, bridgeCall, seedDelegatedRun } from "./executor.testSeams";
import { AGENT_OUTBOX_BACKOFF_MS, AGENT_OUTBOX_MAX_ATTEMPTS, createCompletionOutbox } from "./completionOutbox";
import { buildAnswerArtifactPayload } from "./historyProjection";
import { cancelAgentRunWithCtx, failAgentRunWithCtx, listCapabilityCallsForRun } from "./lifecycle";
import { resumeTurnBindingWithCtx } from "./turnBindings";
import { registerAgentRuntimeCleanupHook, resetAgentRuntimeCleanupHooksForTests, type AgentRuntimeCleanupDescriptor } from "./retention";

const modules = Object.fromEntries(
  Object.entries(import.meta.glob("../**/*.ts")).map(([path, loader]) => [
    path.startsWith("../") ? path.replace(/^\.\.\//, "./") : path.replace(/^\.\//, "./agentHarness/"),
    loader,
  ]),
);
modules["./agentHarness/testPorts.ts"] = modules["./agentHarness/delegatedAdmission.testPorts.ts"];
modules["./agentHarness/testSeams.ts"] = modules["./agentHarness/executor.testSeams.ts"];

const outbox = createCompletionOutbox({ admission: TEST_ADMISSION });
const SOURCE = "const r = await athena.ops.shifts.list({ status: 'open' });\nreturn { open: r.kind };";

afterEach(() => {
  resetAgentRuntimeCleanupHooksForTests();
  TEST_CLOCK.now = TEST_NOW_BASE;
});

/** A running delegated run with one released read, bound to a thread and with runtime refs recorded. */
async function seedReleasedRun(t: TestConvex<typeof schema>, slug: string) {
  const run = await t.run((ctx) => seedDelegatedRun(ctx, slug, { withBinding: true }));
  const attempt = await t.run((ctx) => beginExecutingAttempt(ctx, run, { source: SOURCE }));
  const call = await bridgeCall(t, run, attempt.attemptId, { capabilityId: "cap_test_ops_shifts", namespace: "ops.shifts", verb: "list", args: { status: "open" } });
  if (call.settled?.outcome !== "released") throw new Error(JSON.stringify(call.settled));
  const finished = await t.run((ctx) => TEST_EXECUTOR_SEAMS.finishAttemptWithCtx(ctx, { attemptId: attempt.attemptId, end: { status: "completed", output: { open: 1 }, diagnostics: { elapsedMs: 1, hostCalls: 1, maxInFlight: 1, bridgeArgsBytes: 1, bridgeOutputBytes: 1, resultBytes: 1, sourceBytes: 1 } }, now: TEST_NOW_BASE + 20 }));
  if (finished.outcome !== "result") throw new Error(JSON.stringify(finished));
  await t.run((ctx) =>
    ctx.db.patch("agentTurnBinding", run.bindingId!, {
      step: "running",
      runtimeThreadRef: `runtime_thread:${slug}`,
      runtimeInputRef: `runtime_input:${slug}`,
      runtimeScheduleRef: `runtime_schedule:${slug}`,
      runtimeTurnRef: `runtime_turn:${slug}`,
      stepUpdatedAt: TEST_NOW_BASE + 20,
    }),
  );
  return { run, attempt, finished, citation: finished.citations[0].citation };
}

function completionRequest(finished: Awaited<ReturnType<typeof seedReleasedRun>>["finished"], citation: string) {
  return {
    citedAttemptRefs: [finished.attemptRef],
    citations: [{ ref: citation, claim: "One shift is open." }],
    artifact: {
      title: "Open shifts",
      summary: "One shift is open.",
      payload: buildAnswerArtifactPayload({ outcome: "answer", narrative: "One shift is open.", egressClass: "operational", citations: [{ ref: citation, namespace: "ops.shifts", label: "Shifts" }] }),
    },
  };
}

describe("prepare → one-transaction commit → idempotent projection (scenario 18)", () => {
  it("prepares privately, commits once, projects the committed artifact once, and replays the projection on repair", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seedReleasedRun(t, "outbox");
    const bindingId = seeded.run.bindingId!;
    const request = completionRequest(seeded.finished, seeded.citation);

    const prepared = await t.run((ctx) => outbox.prepareCompletionWithCtx(ctx, { bindingId, runId: seeded.run.runId, preparedCompletionRef: "completion:abc", now: TEST_NOW_BASE + 30 }));
    expect(prepared).toEqual({ outcome: "prepared", preparedCompletionRef: "completion:abc" });
    expect(await t.run((ctx) => outbox.prepareCompletionWithCtx(ctx, { bindingId, runId: seeded.run.runId, preparedCompletionRef: "completion:abc", now: TEST_NOW_BASE + 31 }))).toEqual({ outcome: "already_prepared", preparedCompletionRef: "completion:abc" });
    // Nothing is visible before the commit.
    expect(await t.run((ctx) => outbox.loadProjectionWithCtx(ctx, { bindingId, now: TEST_NOW_BASE + 32 }))).toEqual({ kind: "not_committed", step: "completion_prepared" });
    expect(await t.run((ctx) => ctx.db.query("intelligenceArtifact").withIndex("by_runId", (q) => q.eq("runId", seeded.run.runId)).take(2))).toHaveLength(0);

    const committed = await t.run((ctx) => TEST_EXECUTOR_SEAMS.completeRunWithCtx(ctx, { runId: seeded.run.runId, idempotencyKey: "completion:abc", ...request, now: TEST_NOW_BASE + 40 }));
    expect(committed.outcome).toBe("completed");
    const binding = await t.run((ctx) => ctx.db.get("agentTurnBinding", bindingId));
    expect(binding).toMatchObject({ step: "athena_committed", operatorReleaseCommittedAt: TEST_NOW_BASE + 40, preparedCompletionRef: "completion:abc" });
    expect(binding?.operatorViewedAt).toBeUndefined();

    // The outbox sees it as due and loads the reauthorized artifact with opaque refs only.
    expect(await t.run((ctx) => outbox.listOutboxDueWithCtx(ctx, { now: TEST_NOW_BASE + 41, limit: 10 }))).toEqual([bindingId]);
    const loaded = await t.run((ctx) => outbox.loadProjectionWithCtx(ctx, { bindingId, now: TEST_NOW_BASE + 41 }));
    expect(loaded).toMatchObject({
      kind: "ready",
      threadRef: "runtime_thread:outbox",
      turnRef: "runtime_turn:outbox",
      artifact: { narrative: "One shift is open.", egressClass: "operational", committedAt: TEST_NOW_BASE + 40, citations: [{ citationKey: seeded.citation, label: "Shifts" }] },
    });
    if (loaded.kind !== "ready") throw new Error(loaded.kind);
    expect(looksLikeRawDocumentId(loaded.artifact.artifactRef.replace(/^artifact:/, ""))).toBe(false);
    expect(JSON.stringify(loaded)).not.toContain(String(seeded.run.runId));

    expect(await t.run((ctx) => outbox.recordProjectionWithCtx(ctx, { bindingId, projectionRef: "runtime_projection:outbox", now: TEST_NOW_BASE + 42 }))).toEqual({ outcome: "projected", step: "runtime_projected" });
    const projected = await t.run((ctx) => ctx.db.get("agentTurnBinding", bindingId));
    expect(projected).toMatchObject({ step: "runtime_projected", runtimeProjectionRef: "runtime_projection:outbox" });
    expect(projected?.outboxNextAttemptAt).toBeUndefined();
    // Repair after the fact: replayed, nothing duplicated, run not reopened.
    expect(await t.run((ctx) => outbox.loadProjectionWithCtx(ctx, { bindingId, now: TEST_NOW_BASE + 50 }))).toEqual({ kind: "already_projected", projectionRef: "runtime_projection:outbox" });
    expect(await t.run((ctx) => outbox.recordProjectionWithCtx(ctx, { bindingId, projectionRef: "runtime_projection:other", now: TEST_NOW_BASE + 51 }))).toEqual({ outcome: "already_projected", step: "runtime_projected" });
    expect(await t.run((ctx) => outbox.listOutboxDueWithCtx(ctx, { now: TEST_NOW_BASE + 60, limit: 10 }))).toEqual([]);
    expect(await t.run((ctx) => ctx.db.query("intelligenceArtifact").withIndex("by_runId", (q) => q.eq("runId", seeded.run.runId)).take(3))).toHaveLength(1);
    expect(await t.run((ctx) => ctx.db.get("intelligenceRun", seeded.run.runId))).toMatchObject({ status: "completed" });
  });

  it("backs off a failed projection and retries it later without touching the commit", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seedReleasedRun(t, "outbox-retry");
    const bindingId = seeded.run.bindingId!;
    await t.run((ctx) => outbox.prepareCompletionWithCtx(ctx, { bindingId, runId: seeded.run.runId, preparedCompletionRef: "completion:r", now: TEST_NOW_BASE + 30 }));
    await t.run((ctx) => TEST_EXECUTOR_SEAMS.completeRunWithCtx(ctx, { runId: seeded.run.runId, idempotencyKey: "completion:r", ...completionRequest(seeded.finished, seeded.citation), now: TEST_NOW_BASE + 40 }));
    expect(await t.run((ctx) => outbox.recordProjectionFailureWithCtx(ctx, { bindingId, error: "thread_mismatch", now: TEST_NOW_BASE + 41 }))).toEqual({ outcome: "scheduled", attempts: 1, nextAttemptAt: TEST_NOW_BASE + 41 + AGENT_OUTBOX_BACKOFF_MS[0] });
    expect(await t.run((ctx) => outbox.listOutboxDueWithCtx(ctx, { now: TEST_NOW_BASE + 42, limit: 10 }))).toEqual([]);
    expect(await t.run((ctx) => outbox.listOutboxDueWithCtx(ctx, { now: TEST_NOW_BASE + 41 + AGENT_OUTBOX_BACKOFF_MS[0], limit: 10 }))).toEqual([bindingId]);
    expect(await t.run((ctx) => ctx.db.get("agentTurnBinding", bindingId))).toMatchObject({ step: "athena_committed", outboxAttempts: 1, outboxLastError: "thread_mismatch" });
    expect(await t.run((ctx) => ctx.db.get("intelligenceRun", seeded.run.runId))).toMatchObject({ status: "completed" });
  });

  it("stops retrying a projection that cannot succeed and resumes the committed turn as terminal", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seedReleasedRun(t, "outbox-cap");
    const bindingId = seeded.run.bindingId!;
    await t.run((ctx) => outbox.prepareCompletionWithCtx(ctx, { bindingId, runId: seeded.run.runId, preparedCompletionRef: "completion:c", now: TEST_NOW_BASE + 30 }));
    await t.run((ctx) => TEST_EXECUTOR_SEAMS.completeRunWithCtx(ctx, { runId: seeded.run.runId, idempotencyKey: "completion:c", ...completionRequest(seeded.finished, seeded.citation), now: TEST_NOW_BASE + 40 }));

    // A host that died before terminalizing its runtime turn leaves that turn
    // pending forever, so every later attempt is rejected the same way.
    for (let attempt = 1; attempt <= AGENT_OUTBOX_MAX_ATTEMPTS; attempt += 1) {
      expect(await t.run((ctx) => outbox.recordProjectionFailureWithCtx(ctx, { bindingId, error: "turn_not_terminal", now: TEST_NOW_BASE + 40 + attempt }))).toMatchObject({ outcome: "scheduled", attempts: attempt });
    }
    expect(await t.run((ctx) => outbox.recordProjectionFailureWithCtx(ctx, { bindingId, error: "turn_not_terminal", now: TEST_NOW_BASE + 100 }))).toEqual({ outcome: "exhausted", attempts: AGENT_OUTBOX_MAX_ATTEMPTS + 1 });
    expect(await t.run((ctx) => ctx.db.get("agentTurnBinding", bindingId))).toMatchObject({ step: "athena_committed", outboxLastError: "outbox_exhausted: turn_not_terminal" });
    expect((await t.run((ctx) => ctx.db.get("agentTurnBinding", bindingId)))?.outboxNextAttemptAt).toBeUndefined();
    // Never due again, however far the clock runs.
    expect(await t.run((ctx) => outbox.listOutboxDueWithCtx(ctx, { now: TEST_NOW_BASE + 30 * 24 * 60 * 60_000, limit: 10 }))).toEqual([]);
    // The committed answer stays released; only the runtime mirror is given up.
    expect(await t.run((ctx) => resumeTurnBindingWithCtx(ctx, { bindingId, now: TEST_NOW_BASE + 200 }))).toMatchObject({ action: "terminal", step: "athena_committed", runStatus: "completed" });
    expect(await t.run((ctx) => ctx.db.get("intelligenceRun", seeded.run.runId))).toMatchObject({ status: "completed" });
    expect(await t.run((ctx) => ctx.db.query("intelligenceArtifact").withIndex("by_runId", (q) => q.eq("runId", seeded.run.runId)).take(3))).toHaveLength(1);
  });
});

describe("revocation ordering (scenario 13)", () => {
  it("revocation between prepare and commit wins: nothing commits, nothing is exposed", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seedReleasedRun(t, "outbox-revoke");
    const bindingId = seeded.run.bindingId!;
    await t.run((ctx) => outbox.prepareCompletionWithCtx(ctx, { bindingId, runId: seeded.run.runId, preparedCompletionRef: "completion:x", now: TEST_NOW_BASE + 30 }));
    await t.run((ctx) => ctx.db.delete("organizationMember", seeded.run.operator.membershipId!));
    const committed = await t.run((ctx) => TEST_EXECUTOR_SEAMS.completeRunWithCtx(ctx, { runId: seeded.run.runId, idempotencyKey: "completion:x", ...completionRequest(seeded.finished, seeded.citation), now: TEST_NOW_BASE + 40 }));
    expect(committed).toMatchObject({ outcome: "refused", reason: "membership_revoked" });
    expect(await t.run((ctx) => ctx.db.get("agentTurnBinding", bindingId))).toMatchObject({ step: "completion_prepared" });
    expect(await t.run((ctx) => ctx.db.query("intelligenceArtifact").withIndex("by_runId", (q) => q.eq("runId", seeded.run.runId)).take(2))).toHaveLength(0);
    expect(await t.run((ctx) => outbox.loadProjectionWithCtx(ctx, { bindingId, now: TEST_NOW_BASE + 41 }))).toEqual({ kind: "not_committed", step: "completion_prepared" });
    // The turn ends as canceled; the prior provider exposure stays on the attempt as evidence.
    await t.run((ctx) => cancelAgentRunWithCtx(ctx, { runId: seeded.run.runId, idempotencyKey: "c", reason: "authority_revoked", now: TEST_NOW_BASE + 42 }));
    expect(await t.run((ctx) => outbox.listOutboxDueWithCtx(ctx, { now: TEST_NOW_BASE + 60, limit: 10 }))).toEqual([]);
    const exposure = await t.run((ctx) => TEST_EXECUTOR_SEAMS.describeAttemptExposureWithCtx(ctx, seeded.attempt.attemptId));
    expect(exposure).toMatchObject({ providerExposed: true, operatorReleaseCommitted: false, operatorViewed: false, revokedAfterProviderExposure: true });
  });

  it("revocation after commit but before an authorized fetch suppresses release, asks the adapter to purge, and keeps the exposure audit", async () => {
    const t = convexTest(schema, modules);
    const purged: AgentRuntimeCleanupDescriptor[] = [];
    registerAgentRuntimeCleanupHook("athena_contract_fake", async (_ctx, descriptor) => {
      purged.push(descriptor);
      return { ok: true };
    });
    const seeded = await seedReleasedRun(t, "outbox-late");
    const bindingId = seeded.run.bindingId!;
    await t.run((ctx) => outbox.prepareCompletionWithCtx(ctx, { bindingId, runId: seeded.run.runId, preparedCompletionRef: "completion:l", now: TEST_NOW_BASE + 30 }));
    await t.run((ctx) => TEST_EXECUTOR_SEAMS.completeRunWithCtx(ctx, { runId: seeded.run.runId, idempotencyKey: "completion:l", ...completionRequest(seeded.finished, seeded.citation), now: TEST_NOW_BASE + 40 }));
    await t.run((ctx) => ctx.db.delete("organizationMember", seeded.run.operator.membershipId!));
    expect(await t.run((ctx) => outbox.loadProjectionWithCtx(ctx, { bindingId, now: TEST_NOW_BASE + 41 }))).toEqual({ kind: "suppressed", reason: "membership_revoked" });
    expect(await t.run((ctx) => outbox.suppressReleaseWithCtx(ctx, { bindingId, reason: "membership_revoked", now: TEST_NOW_BASE + 42 }))).toEqual({ outcome: "suppressed", cleanup: "succeeded" });
    expect(await t.run((ctx) => outbox.suppressReleaseWithCtx(ctx, { bindingId, reason: "membership_revoked", now: TEST_NOW_BASE + 43 }))).toEqual({ outcome: "already_suppressed", cleanup: "already_succeeded" });
    expect(purged).toHaveLength(1);
    expect(purged[0]).toMatchObject({ bindingId, runtimeThreadRef: "runtime_thread:outbox-late", runtimeInputRef: "runtime_input:outbox-late" });
    const binding = await t.run((ctx) => ctx.db.get("agentTurnBinding", bindingId));
    expect(binding).toMatchObject({ releaseSuppressedAt: TEST_NOW_BASE + 42, releaseSuppressedReason: "membership_revoked", runtimeCleanupStatus: "succeeded", step: "athena_committed" });
    expect(binding?.operatorViewedAt).toBeUndefined();
    expect(binding?.outboxNextAttemptAt).toBeUndefined();
    // The commit itself is untouched (audit), only release is suppressed; the outbox no longer retries it.
    expect(await t.run((ctx) => ctx.db.get("intelligenceRun", seeded.run.runId))).toMatchObject({ status: "completed" });
    expect(await t.run((ctx) => outbox.listOutboxDueWithCtx(ctx, { now: TEST_NOW_BASE + 100, limit: 10 }))).toEqual([]);
    expect(await t.run((ctx) => TEST_EXECUTOR_SEAMS.describeAttemptExposureWithCtx(ctx, seeded.attempt.attemptId))).toMatchObject({ providerExposed: true, operatorReleaseCommitted: true, operatorViewed: false });
    expect(await t.run((ctx) => listCapabilityCallsForRun(ctx, seeded.run.runId))).toHaveLength(1);
  });

  it("a completion failure before the commit exposes nothing: the turn fails typed and the outbox never sees it", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seedReleasedRun(t, "outbox-fail");
    const bindingId = seeded.run.bindingId!;
    await t.run((ctx) => outbox.prepareCompletionWithCtx(ctx, { bindingId, runId: seeded.run.runId, preparedCompletionRef: "completion:f", now: TEST_NOW_BASE + 30 }));
    await t.run((ctx) => failAgentRunWithCtx(ctx, { runId: seeded.run.runId, idempotencyKey: "fail", error: { code: "provider_failure", message: "x", retryable: true }, now: TEST_NOW_BASE + 31 }));
    expect(await t.run((ctx) => outbox.loadProjectionWithCtx(ctx, { bindingId, now: TEST_NOW_BASE + 32 }))).toEqual({ kind: "not_committed", step: "completion_prepared" });
    expect(await t.run((ctx) => outbox.listOutboxDueWithCtx(ctx, { now: TEST_NOW_BASE + 60, limit: 10 }))).toEqual([]);
    expect(await t.run((ctx) => outbox.prepareCompletionWithCtx(ctx, { bindingId, runId: seeded.run.runId, preparedCompletionRef: "completion:g", now: TEST_NOW_BASE + 33 }))).toMatchObject({ outcome: "already_prepared" });
    expect(await t.run((ctx) => ctx.db.query("intelligenceArtifact").withIndex("by_runId", (q) => q.eq("runId", seeded.run.runId)).take(2))).toHaveLength(0);
  });
});
