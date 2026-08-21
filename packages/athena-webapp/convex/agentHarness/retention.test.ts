/// <reference types="vite/client" />

import { readFileSync } from "node:fs";

import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";

import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import schema from "../schema";
import {
  SHORT_LIVED_RETENTION_MS,
  STANDARD_RETENTION_MS,
  budgetVector,
} from "../../shared/agentHarness/execution";
import { removeOrganizationWithCtx } from "../inventory/organizations";
import { removeStoreWithCtx } from "../inventory/stores";
import {
  admitCapabilityCallWithCtx,
  beginProgramAttemptWithCtx,
  completeAgentRunWithCtx,
  markCapabilityCallExecutingWithCtx,
  settleCapabilityCallWithCtx,
  transitionProgramAttemptWithCtx,
} from "./lifecycle";
import {
  AGENT_RUNTIME_CLEANUP_BACKOFF_MS,
  deleteAgentHarnessContentForStoreWithCtx,
  readCitationEvidenceWithCtx,
  recordScratchDescriptorWithCtx,
  registerAgentRuntimeCleanupHook,
  resetAgentRuntimeCleanupHooksForTests,
  runRuntimeCleanupBatchWithCtx,
  sweepExpiredAgentContentWithCtx,
  type AgentRuntimeCleanupDescriptor,
} from "./retention";
import { TEST_NOW, buildRunInput, seedTenant } from "./testSupport";
import { advanceTurnBindingWithCtx, recordTurnIntentWithCtx } from "./turnBindings";

// Cuts the module cycle `platform/operationAdmission` -> `sharedDemo/...`,
// exactly as `inventory/stores.test.ts` does for the same import.
vi.mock("../sharedDemo/restore", () => ({
  requireReadySharedDemoWriteWithCtx: vi.fn(),
}));

const modules = Object.fromEntries(
  Object.entries(import.meta.glob("../**/*.ts")).map(([path, loader]) => [
    path.startsWith("../")
      ? path.replace(/^\.\.\//, "./")
      : path.replace(/^\.\//, "./agentHarness/"),
    loader,
  ]),
);

type Tenant = Awaited<ReturnType<typeof seedTenant>>;
const ADAPTER = "fake_runtime";
const DAY = 86_400_000;

afterEach(() => {
  resetAgentRuntimeCleanupHooksForTests();
});

async function seedCompletedTurn(
  ctx: MutationCtx,
  tenant: Tenant,
  key: string,
  options: { withClaimSupport?: boolean; complete?: boolean } = {},
) {
  const { runIdempotencyKey: _k, promptPayloadHash: _h, ...base } = buildRunInput(tenant);
  const intent = await recordTurnIntentWithCtx(ctx, {
    ...base,
    turnIdempotencyKey: key,
    runtimeThreadRef: `thread:${tenant.storeId}`,
    promptPayload: { prompt: `question ${key}` },
  });
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
  const begun = await beginProgramAttemptWithCtx(ctx, { runId: intent.runId, attemptIdempotencyKey: `${key}-a1`, programSource: "return athena.sales.list();", now: TEST_NOW });
  if (begun.outcome === "denied") throw new Error(begun.denial.code);
  await transitionProgramAttemptWithCtx(ctx, { attemptId: begun.attemptId, to: "validating", now: TEST_NOW });
  await transitionProgramAttemptWithCtx(ctx, { attemptId: begun.attemptId, to: "executing", now: TEST_NOW });
  const admitted = await admitCapabilityCallWithCtx(ctx, {
    runId: intent.runId,
    attemptId: begun.attemptId,
    callIdempotencyKey: `${key}-c1`,
    capabilityId: "cap.sales.list",
    normalizedArgsHash: "args:1",
    normalizedArgs: { day: "2026-08-21" },
    requested: budgetVector({ calls: 1, rows: 10 }),
    now: TEST_NOW,
  });
  if (admitted.outcome === "denied") throw new Error(admitted.denial.code);
  await markCapabilityCallExecutingWithCtx(ctx, { callId: admitted.callId, now: TEST_NOW });
  await settleCapabilityCallWithCtx(ctx, {
    callId: admitted.callId,
    outcome: "succeeded",
    actual: { rows: 1 },
    resultHash: "result:1",
    freshness: "current",
    sourceRefs: [{ table: "sale", id: "sale-1" }],
    output: { rows: [{ id: "sale-1", total: 10 }] },
    now: TEST_NOW,
  });
  await transitionProgramAttemptWithCtx(ctx, { attemptId: begun.attemptId, to: "result_produced", now: TEST_NOW, result: { resultHash: "program:1", payload: { total: 10 } } });
  await recordScratchDescriptorWithCtx(ctx, { runId: intent.runId, attemptId: begun.attemptId, scratchKey: "notes", content: { note: "scratch" }, now: TEST_NOW });
  if (options.complete === false) {
    return { ...intent, attemptId: begun.attemptId, callId: admitted.callId, artifactId: undefined, citationBindingId: undefined };
  }
  const completed = await completeAgentRunWithCtx(ctx, {
    runId: intent.runId,
    idempotencyKey: `${key}-complete`,
    now: TEST_NOW,
    citedAttemptIds: [begun.attemptId],
    artifact: { summary: "ok", payload: { answer: "ok" } },
    citations: [
      {
        citationKey: "k1",
        callId: admitted.callId,
        resultHash: "result:1",
        sourceRef: { table: "sale", id: "sale-1" },
        claimDigest: "claim:1",
        ...(options.withClaimSupport
          ? { claimSupport: { extractorKey: "sales.total", extractorVersion: "1", slice: { total: 10 } } }
          : {}),
      },
    ],
  });
  if (completed.outcome !== "completed") throw new Error(completed.outcome);
  return { ...intent, attemptId: begun.attemptId, callId: admitted.callId, artifactId: completed.artifactId, citationBindingId: completed.citationBindingIds[0] };
}

async function contentCounts(ctx: QueryCtx, storeId: Id<"store">) {
  const take = 50;
  const [prompts, replays, scratch, claims, retainedCitations, retainedGrants] = await Promise.all([
    ctx.db.query("agentPromptPayload").withIndex("by_storeId", (q) => q.eq("storeId", storeId)).take(take),
    ctx.db.query("agentReplayPayload").withIndex("by_storeId", (q) => q.eq("storeId", storeId)).take(take),
    ctx.db.query("agentScratchDescriptor").withIndex("by_storeId", (q) => q.eq("storeId", storeId)).take(take),
    ctx.db.query("agentClaimSupport").withIndex("by_storeId", (q) => q.eq("storeId", storeId)).take(take),
    ctx.db.query("agentCitationBinding").withIndex("by_storeId_evidenceLifecycle", (q) => q.eq("storeId", storeId).eq("evidenceLifecycle", "retained")).take(take),
    ctx.db.query("agentRunGrant").withIndex("by_storeId_lifecycle", (q) => q.eq("storeId", storeId).eq("lifecycle", "retained")).take(take),
  ]);
  return {
    prompts: prompts.length,
    replays: replays.length,
    scratch: scratch.length,
    claims: claims.length,
    retainedCitations: retainedCitations.length,
    retainedGrants: retainedGrants.length,
  };
}

const viewer = { principalKind: "athenaUser" as const, actorRef: "athenaUser:auditor" };

describe("agent harness retention registration", () => {
  it("registers the bounded retention and repair sweeps in crons.ts", () => {
    const source = readFileSync("convex/crons.ts", "utf8");
    expect(source).toContain('"agent-harness-retention-sweep"');
    expect(source).toContain("internal.agentHarness.retention.sweepExpiredAgentContent");
    expect(source).toContain('"agent-harness-repair-sweep"');
    expect(source).toContain("internal.agentHarness.retention.repairSweep");
  });
});

describe("prompt/content expiry (scenario 8)", () => {
  it("deletes short-lived payloads after 30 days while the grant hash and audit metadata stay intact", async () => {
    const t = convexTest(schema, modules);
    const seeded = await t.run(async (ctx) => {
      const tenant = await seedTenant(ctx, "expiry");
      const turn = await seedCompletedTurn(ctx, tenant, "t1");
      const grant = await ctx.db.query("agentRunGrant").withIndex("by_runId", (q) => q.eq("runId", turn.runId)).unique();
      return { tenant, turn, grantBefore: grant! };
    });

    await t.run(async (ctx) => {
      const before = await contentCounts(ctx, seeded.tenant.storeId);
      // prompt + (source, result promoted, call output) replay payloads + scratch
      expect(before).toMatchObject({ prompts: 1, replays: 3, scratch: 1, retainedCitations: 1, retainedGrants: 1 });
      // Nothing expires early.
      expect(await sweepExpiredAgentContentWithCtx(ctx, { now: TEST_NOW + SHORT_LIVED_RETENTION_MS - 1, limit: 10 })).toMatchObject({ deletedPromptPayloads: 0, deletedReplayPayloads: 0, hasMore: false });
      const result = await sweepExpiredAgentContentWithCtx(ctx, { now: TEST_NOW + SHORT_LIVED_RETENTION_MS, limit: 10 });
      expect(result).toMatchObject({ deletedPromptPayloads: 1, deletedReplayPayloads: 1, deletedScratchDescriptors: 1, hasMore: false });

      const after = await contentCounts(ctx, seeded.tenant.storeId);
      expect(after).toMatchObject({ prompts: 0, replays: 2, scratch: 0, retainedCitations: 1, retainedGrants: 1 });
      const grant = await ctx.db.get("agentRunGrant", seeded.grantBefore._id);
      expect(grant).toMatchObject({ promptPayloadState: "expired", promptPayloadHash: seeded.grantBefore.promptPayloadHash, grantDigest: seeded.grantBefore.grantDigest, createdAt: seeded.grantBefore.createdAt });
      expect(grant?.promptPayloadId).toBeUndefined();
      const run = await ctx.db.get("intelligenceRun", seeded.turn.runId);
      expect(run).toMatchObject({ status: "completed", snapshotHash: `grant:abc:${seeded.grantBefore.promptPayloadHash}`, artifactId: seeded.turn.artifactId });
      // Promoted program source/result survive in the standard class; the call output did not promote.
      const promoted = await ctx.db.query("agentReplayPayload").withIndex("by_runId", (q) => q.eq("runId", seeded.turn.runId)).take(10);
      expect(promoted.map((p) => [p.subjectKind, p.retentionClass]).sort()).toEqual([["program_result", "standard"], ["program_source", "standard"]]);
    });
  });

  it("reports reconstructible, provenance_only, and evidence_expired honestly and audits every lookup", async () => {
    const t = convexTest(schema, modules);
    const seeded = await t.run(async (ctx) => {
      const tenant = await seedTenant(ctx, "evidence");
      const supported = await seedCompletedTurn(ctx, tenant, "supported", { withClaimSupport: true });
      const bare = await seedCompletedTurn(ctx, tenant, "bare");
      return { tenant, supported, bare };
    });

    await t.run(async (ctx) => {
      const read = (citationBindingId: Id<"agentCitationBinding">, now: number) =>
        readCitationEvidenceWithCtx(ctx, { citationBindingId, viewer, purpose: "investigation", now });
      expect(await read(seeded.supported.citationBindingId!, TEST_NOW + 1)).toMatchObject({
        state: "reconstructible",
        citation: { resultHash: "result:1", capabilityId: "cap.sales.list", normalizedArgsHash: "args:1", freshness: "current", sourceRef: { table: "sale", id: "sale-1" } },
      });
      expect(await read(seeded.bare.citationBindingId!, TEST_NOW + 1)).toMatchObject({ state: "reconstructible" });

      await sweepExpiredAgentContentWithCtx(ctx, { now: TEST_NOW + SHORT_LIVED_RETENTION_MS, limit: 20 });
      expect(await read(seeded.supported.citationBindingId!, TEST_NOW + SHORT_LIVED_RETENTION_MS + 1)).toMatchObject({ state: "reconstructible" });
      expect(await read(seeded.bare.citationBindingId!, TEST_NOW + SHORT_LIVED_RETENTION_MS + 1)).toMatchObject({ state: "provenance_only" });

      const standard = await sweepExpiredAgentContentWithCtx(ctx, { now: TEST_NOW + STANDARD_RETENTION_MS, limit: 20 });
      expect(standard).toMatchObject({ expiredCitations: 2, deletedClaimSupport: 1, deletedReplayPayloads: 4 });
      expect(await read(seeded.supported.citationBindingId!, TEST_NOW + STANDARD_RETENTION_MS + 1)).toMatchObject({ state: "evidence_expired", citation: { resultHash: "result:1" } });

      const audits = await ctx.db.query("agentEvidenceAccessAudit").withIndex("by_runId_accessedAt", (q) => q.eq("runId", seeded.supported.runId)).take(10);
      expect(audits.map((a) => a.evidenceState)).toEqual(["reconstructible", "reconstructible", "evidence_expired"]);
      expect(audits[0]).toMatchObject({ viewerActorRef: "athenaUser:auditor", viewerPrincipalKind: "athenaUser", purpose: "investigation", storeId: seeded.tenant.storeId, citationBindingId: seeded.supported.citationBindingId });
    });
  });

  it("store removal deletes scoped agent content, marks evidence deleted, asks the adapter to clean up, and leaves other stores intact", async () => {
    const t = convexTest(schema, modules);
    const cleaned: AgentRuntimeCleanupDescriptor[] = [];
    registerAgentRuntimeCleanupHook(ADAPTER, async (_ctx, descriptor) => {
      cleaned.push(descriptor);
      return { ok: true };
    });
    const seeded = await t.run(async (ctx) => {
      const removed = await seedTenant(ctx, "removed");
      const retained = await seedTenant(ctx, "retained");
      const removedTurn = await seedCompletedTurn(ctx, removed, "r1", { withClaimSupport: true });
      const activeTurn = await seedCompletedTurn(ctx, removed, "r2", { complete: false });
      const retainedTurn = await seedCompletedTurn(ctx, retained, "k1", { withClaimSupport: true });
      const grantBefore = await ctx.db.query("agentRunGrant").withIndex("by_runId", (q) => q.eq("runId", removedTurn.runId)).unique();
      return { removed, retained, removedTurn, activeTurn, retainedTurn, grantBefore: grantBefore! };
    });

    const completed = await t.run((ctx) => removeStoreWithCtx(ctx, seeded.removed.storeId));
    expect(completed).toBe(true);

    await t.run(async (ctx) => {
      expect(await ctx.db.get("store", seeded.removed.storeId)).toBeNull();
      expect(await contentCounts(ctx, seeded.removed.storeId)).toEqual({ prompts: 0, replays: 0, scratch: 0, claims: 0, retainedCitations: 0, retainedGrants: 0 });
      expect(await contentCounts(ctx, seeded.retained.storeId)).toMatchObject({ prompts: 1, replays: 3, scratch: 1, claims: 1, retainedCitations: 1, retainedGrants: 1 });
      const grant = await ctx.db.query("agentRunGrant").withIndex("by_runId", (q) => q.eq("runId", seeded.removedTurn.runId)).unique();
      // Audit metadata survives: only the lifecycle markers changed.
      expect(grant).toMatchObject({
        lifecycle: "deleted_by_lifecycle",
        promptPayloadState: "deleted_by_lifecycle",
        promptPayloadHash: seeded.grantBefore.promptPayloadHash,
        grantDigest: seeded.grantBefore.grantDigest,
        compatibilityDigest: seeded.grantBefore.compatibilityDigest,
        createdAt: seeded.grantBefore.createdAt,
      });
      expect(grant?.promptPayloadId).toBeUndefined();
      // The still-running turn was canceled rather than left dangling.
      expect((await ctx.db.get("intelligenceRun", seeded.activeTurn.runId))?.status).toBe("canceled");
      // Adapter cleanup ran once per removed binding, keyed by the binding.
      expect(cleaned.map((d) => d.bindingId).sort()).toEqual([seeded.removedTurn.bindingId, seeded.activeTurn.bindingId].sort());
      expect(cleaned[0]).toMatchObject({ adapterKind: ADAPTER, runtimeThreadRef: `thread:${seeded.removed.storeId}` });
      const binding = await ctx.db.get("agentTurnBinding", seeded.removedTurn.bindingId);
      expect(binding).toMatchObject({ runtimeCleanupStatus: "succeeded", runtimeCleanupAttempts: 1 });
      expect(await readCitationEvidenceWithCtx(ctx, { citationBindingId: seeded.removedTurn.citationBindingId!, viewer, purpose: "investigation", now: TEST_NOW })).toMatchObject({ state: "evidence_deleted_by_lifecycle" });
      expect(await readCitationEvidenceWithCtx(ctx, { citationBindingId: seeded.retainedTurn.citationBindingId!, viewer, purpose: "investigation", now: TEST_NOW })).toMatchObject({ state: "reconstructible" });
      // Running the hook again is a no-op: nothing left to delete, nothing re-requested.
      expect(await deleteAgentHarnessContentForStoreWithCtx(ctx, seeded.removed.storeId, TEST_NOW)).toEqual({ deletedRows: 0, markedRows: 0, cleanupRequested: 0, hasMore: false });
    });
  });

  it("organization removal cleans every store's agent content", async () => {
    const t = convexTest(schema, modules);
    registerAgentRuntimeCleanupHook(ADAPTER, async () => ({ ok: true }));
    const seeded = await t.run(async (ctx) => {
      const removed = await seedTenant(ctx, "org-removed");
      const sibling = await ctx.db.insert("store", { createdByUserId: removed.userId, currency: "GHS", name: "sibling", organizationId: removed.organizationId, slug: "sibling" });
      const other = await seedTenant(ctx, "org-other");
      await seedCompletedTurn(ctx, removed, "o1");
      await seedCompletedTurn(ctx, { ...removed, storeId: sibling }, "o2");
      await seedCompletedTurn(ctx, other, "x1");
      return { removed, sibling, other };
    });

    vi.useFakeTimers();
    try {
      await t.run((ctx) => removeOrganizationWithCtx(ctx, seeded.removed.organizationId));
      await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    } finally {
      vi.useRealTimers();
    }

    await t.run(async (ctx) => {
      expect(await ctx.db.get("organization", seeded.removed.organizationId)).toBeNull();
      expect(await contentCounts(ctx, seeded.removed.storeId)).toEqual({ prompts: 0, replays: 0, scratch: 0, claims: 0, retainedCitations: 0, retainedGrants: 0 });
      expect(await contentCounts(ctx, seeded.sibling)).toEqual({ prompts: 0, replays: 0, scratch: 0, claims: 0, retainedCitations: 0, retainedGrants: 0 });
      expect(await contentCounts(ctx, seeded.other.storeId)).toMatchObject({ prompts: 1, retainedCitations: 1, retainedGrants: 1 });
      const orphaned = await ctx.db.query("agentRunGrant").withIndex("by_organizationId_lifecycle", (q) => q.eq("organizationId", seeded.removed.organizationId).eq("lifecycle", "retained")).take(5);
      expect(orphaned).toHaveLength(0);
    });
  });
});

describe("bounded retention batches and adapter cleanup retries (scenario 9)", () => {
  it("respects the batch limit, continues through scheduled batches, and never reprocesses deleted rows", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const tenant = await seedTenant(ctx, "batches");
      for (const key of ["b1", "b2", "b3"]) await seedCompletedTurn(ctx, tenant, key, { complete: false });
    });
    const now = TEST_NOW + SHORT_LIVED_RETENTION_MS;

    const first = await t.run((ctx) => sweepExpiredAgentContentWithCtx(ctx, { now, limit: 2 }));
    expect(first).toMatchObject({ deletedPromptPayloads: 2, hasMore: true });
    const remaining = await t.run((ctx) => ctx.db.query("agentPromptPayload").withIndex("by_retentionClass_expiresAt", (q) => q.eq("retentionClass", "short_lived")).take(10));
    expect(remaining).toHaveLength(1);

    vi.useFakeTimers();
    try {
      const scheduled = await t.mutation(internal.agentHarness.retention.sweepExpiredAgentContent, { now, limit: 2 });
      expect(scheduled).toMatchObject({ deletedPromptPayloads: 1 });
      await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    } finally {
      vi.useRealTimers();
    }
    await t.run(async (ctx) => {
      expect(await ctx.db.query("agentPromptPayload").withIndex("by_retentionClass_expiresAt", (q) => q.eq("retentionClass", "short_lived")).take(10)).toHaveLength(0);
      expect(await ctx.db.query("agentScratchDescriptor").withIndex("by_retentionClass_expiresAt", (q) => q.eq("retentionClass", "short_lived")).take(10)).toHaveLength(0);
      // Every grant recorded the expiry exactly once; the hash is still there.
      const grants = await ctx.db.query("agentRunGrant").withIndex("by_compatibilityEpoch_createdAt", (q) => q.eq("compatibilityEpoch", 0)).take(10);
      expect(grants.map((g) => g.promptPayloadState)).toEqual(["expired", "expired", "expired"]);
      expect(await sweepExpiredAgentContentWithCtx(ctx, { now: now + 1, limit: 2 })).toMatchObject({ deletedPromptPayloads: 0, deletedScratchDescriptors: 0, hasMore: false });
    });
  });

  it("retries a failing adapter cleanup with backoff without re-deleting Athena rows", async () => {
    const t = convexTest(schema, modules);
    const calls: Array<{ bindingId: Id<"agentTurnBinding">; attempt: number }> = [];
    let mode: "throw" | "fail" | "ok" = "throw";
    registerAgentRuntimeCleanupHook(ADAPTER, async (_ctx, descriptor) => {
      calls.push({ bindingId: descriptor.bindingId, attempt: calls.length + 1 });
      if (mode === "throw") throw new Error("runtime unreachable");
      if (mode === "fail") return { ok: false, retryable: true, error: "runtime_busy" };
      return { ok: true };
    });
    const seeded = await t.run(async (ctx) => {
      const tenant = await seedTenant(ctx, "retry");
      const turn = await seedCompletedTurn(ctx, tenant, "r1");
      return { tenant, turn };
    });

    const firstPass = await t.run((ctx) => deleteAgentHarnessContentForStoreWithCtx(ctx, seeded.tenant.storeId, TEST_NOW));
    expect(firstPass).toMatchObject({ cleanupRequested: 1, hasMore: false });
    expect(firstPass.deletedRows).toBeGreaterThan(0);
    await t.run(async (ctx) => {
      const binding = await ctx.db.get("agentTurnBinding", seeded.turn.bindingId);
      expect(binding).toMatchObject({ runtimeCleanupStatus: "failed", runtimeCleanupAttempts: 1, runtimeCleanupLastError: "runtime unreachable", runtimeCleanupNextAttemptAt: TEST_NOW + AGENT_RUNTIME_CLEANUP_BACKOFF_MS[0] });
      // Athena rows were deleted in the same pass and are not re-deleted by the retry path.
      expect(await contentCounts(ctx, seeded.tenant.storeId)).toMatchObject({ prompts: 0, replays: 0, scratch: 0 });
      expect(await deleteAgentHarnessContentForStoreWithCtx(ctx, seeded.tenant.storeId, TEST_NOW + 1)).toEqual({ deletedRows: 0, markedRows: 0, cleanupRequested: 0, hasMore: false });
      expect(calls).toHaveLength(1);
    });

    mode = "fail";
    await t.run(async (ctx) => {
      // Not due yet: no attempt.
      expect(await runRuntimeCleanupBatchWithCtx(ctx, { now: TEST_NOW + 1, limit: 10 })).toEqual({ attempted: 0, succeeded: 0, failed: 0, hasMore: false });
      expect(await runRuntimeCleanupBatchWithCtx(ctx, { now: TEST_NOW + AGENT_RUNTIME_CLEANUP_BACKOFF_MS[0], limit: 10 })).toEqual({ attempted: 1, succeeded: 0, failed: 1, hasMore: false });
      const binding = await ctx.db.get("agentTurnBinding", seeded.turn.bindingId);
      expect(binding).toMatchObject({ runtimeCleanupStatus: "failed", runtimeCleanupAttempts: 2, runtimeCleanupLastError: "runtime_busy", runtimeCleanupNextAttemptAt: TEST_NOW + AGENT_RUNTIME_CLEANUP_BACKOFF_MS[0] + AGENT_RUNTIME_CLEANUP_BACKOFF_MS[1] });
    });

    mode = "ok";
    await t.run(async (ctx) => {
      const due = TEST_NOW + AGENT_RUNTIME_CLEANUP_BACKOFF_MS[0] + AGENT_RUNTIME_CLEANUP_BACKOFF_MS[1];
      expect(await runRuntimeCleanupBatchWithCtx(ctx, { now: due, limit: 10 })).toEqual({ attempted: 1, succeeded: 1, failed: 0, hasMore: false });
      const binding = await ctx.db.get("agentTurnBinding", seeded.turn.bindingId);
      expect(binding).toMatchObject({ runtimeCleanupStatus: "succeeded", runtimeCleanupAttempts: 3, runtimeCleanupCompletedAt: due });
      expect(binding?.runtimeCleanupNextAttemptAt).toBeUndefined();
      expect(calls).toHaveLength(3);
      // Done: nothing is attempted again.
      expect(await runRuntimeCleanupBatchWithCtx(ctx, { now: due + DAY, limit: 10 })).toEqual({ attempted: 0, succeeded: 0, failed: 0, hasMore: false });
    });
  });

  it("asks the adapter to clean a turn's runtime payloads when its short-lived class expires, and fails closed without a hook", async () => {
    const t = convexTest(schema, modules);
    const seeded = await t.run(async (ctx) => {
      const tenant = await seedTenant(ctx, "runtime-expiry");
      return seedCompletedTurn(ctx, tenant, "e1");
    });
    await t.run(async (ctx) => {
      expect(await runRuntimeCleanupBatchWithCtx(ctx, { now: TEST_NOW + SHORT_LIVED_RETENTION_MS - 1, limit: 10 })).toMatchObject({ attempted: 0 });
      // No hook registered for this adapter kind: recorded as a retryable failure, never silently succeeded.
      expect(await runRuntimeCleanupBatchWithCtx(ctx, { now: TEST_NOW + SHORT_LIVED_RETENTION_MS, limit: 10 })).toMatchObject({ attempted: 1, failed: 1 });
      expect(await ctx.db.get("agentTurnBinding", seeded.bindingId)).toMatchObject({ runtimeCleanupStatus: "failed", runtimeCleanupLastError: "no_cleanup_hook_registered" });
    });
    registerAgentRuntimeCleanupHook(ADAPTER, async () => ({ ok: true }));
    await t.run(async (ctx) => {
      const due = TEST_NOW + SHORT_LIVED_RETENTION_MS + AGENT_RUNTIME_CLEANUP_BACKOFF_MS[0];
      expect(await sweepExpiredAgentContentWithCtx(ctx, { now: due, limit: 10 })).toMatchObject({ runtimeCleanupSucceeded: 1 });
      expect(await ctx.db.get("agentTurnBinding", seeded.bindingId)).toMatchObject({ runtimeCleanupStatus: "succeeded" });
    });
  });
});
