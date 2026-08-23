// @vitest-environment node
/// <reference types="vite/client" />
/**
 * Release data-governance gate.
 *
 * The harness deliberately introduces no parallel compliance framework: it
 * reuses Athena's retention classes, the store/organization deletion cascade,
 * and the intelligence run as the durable parent. This suite follows one real
 * cited answer through that machinery — reconstructible, then provenance-only
 * after the short-lived class expires, then gone when the store is removed —
 * and checks that every evidence read is audited and that runtime-side content
 * is cleaned up through the adapter hook rather than by reaching into it.
 *
 * It runs against the published composition, so a governance regression in a
 * domain port or in the kernel blocks enablement.
 */
import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, it } from "vitest";

import type { Id } from "../_generated/dataModel";
import schema from "../schema";
import {
  SHORT_LIVED_RETENTION_MS,
  STANDARD_RETENTION_MS,
} from "../../shared/agentHarness/execution";
import {
  createProgramExecutor,
  type AgentExecutorCtx,
  type AgentProgramExecutor,
  type AgentProgramExecutorConfig,
} from "./executor";
import { createQuickJsProgramRuntime } from "./programRuntime/quickJsRuntime";
import type { AgentProgramRuntime } from "./programRuntime/types";
import { DAILY_OPERATIONS_PROFILE_ID } from "./profiles/dailyOperations";
import {
  AGENT_NOOP_ADAPTER_KIND,
  deleteAgentHarnessContentForOrganizationWithCtx,
  deleteAgentHarnessContentForStoreWithCtx,
  registerAgentRuntimeCleanupHook,
  requestRuntimeCleanupWithCtx,
  runRuntimeCleanupBatchWithCtx,
  sweepExpiredAgentContentWithCtx,
} from "./retention";
import { loadTurnNarrativeTrailByBindingWithCtx, writeTurnNarrativeTrailWithCtx } from "./narrativeTrail";
import { loadProvisionalNarrativeByBindingWithCtx, upsertProvisionalNarrativeWithCtx } from "./provisionalNarrative";
import {
  AGENT_TURN_TRACE_RETENTION_MS,
  appendTurnTraceEventsWithCtx,
  listTurnTraceByBindingWithCtx,
} from "./turnTrace";
import { recordTurnIntentWithCtx } from "./turnBindings";
import {
  CURRENT_OPERATING_DATE,
  FIXTURE_NOW,
  seedDailyOperationsStore,
} from "./evals/dailyOperations.fixture";
import {
  DIRECT_HARNESS_ADMISSION,
  DIRECT_HARNESS_SEAMS,
  DIRECT_HARNESS_SEAM_REFS,
  startDirectHarnessRunWithCtx,
} from "./evals/directHarness";

const modules = Object.fromEntries(
  Object.entries(import.meta.glob("../**/*.ts")).map(([path, loader]) => [
    path.startsWith("../") ? path.replace(/^\.\.\//, "./") : path.replace(/^\.\//, "./agentHarness/"),
    loader,
  ]),
);

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

async function executor(): Promise<AgentProgramExecutor> {
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

const PROGRAM = `
const day = await athena.operations.storeDay.get({ operatingDate: "${CURRENT_OPERATING_DATE}" });
const registers = await athena.cash.registerSessions.list({ operatingDate: "${CURRENT_OPERATING_DATE}" });
return {
  stage: day.kind === "result" ? day.envelope.data.lifecycleStage : "unavailable",
  registers: registers.kind === "result" ? registers.envelope.data.length : -1,
};
`;

/** Seed a store, run one cited program, and commit the answer. */
async function seedCompletedRun(t: Harness, key: string) {
  const seeded = await t.run(async (ctx) => {
    const fixture = await seedDailyOperationsStore(ctx, { slug: key });
    const started = await startDirectHarnessRunWithCtx(ctx, {
      profileId: DAILY_OPERATIONS_PROFILE_ID,
      athenaUserId: fixture.userId,
      organizationId: fixture.organizationId,
      storeId: fixture.storeId,
      runIdempotencyKey: `governance-${key}`,
      now: FIXTURE_NOW,
    });
    if (started.kind !== "running") throw new Error(JSON.stringify(started));
    return { fixture, started };
  });

  const result = await (await executor()).executeProgram(executorCtx(t), {
    runId: seeded.started.runId,
    attemptIdempotencyKey: `${key}-1`,
    source: PROGRAM,
  });
  if (result.outcome !== "result") throw new Error(JSON.stringify(result).slice(0, 1_200));

  const completion = await t.run((ctx) =>
    DIRECT_HARNESS_SEAMS.completeRunWithCtx(ctx, {
      runId: seeded.started.runId,
      idempotencyKey: `${key}-complete`,
      citedAttemptRefs: [result.attemptRef],
      citations: result.citations.map((citation) => ({ ref: citation.citation })),
      artifact: { title: "Governance", payload: { headline: "one day" } },
      now: FIXTURE_NOW,
    }),
  );
  if (completion.outcome !== "completed") throw new Error(JSON.stringify(completion).slice(0, 800));
  return { ...seeded, result, completion };
}

const readEvidence = (t: Harness, runId: unknown, citationRef: string, athenaUserId: unknown, now: number) =>
  t.run((ctx) =>
    DIRECT_HARNESS_SEAMS.readCitationEvidenceWithCtx(ctx, {
      runId: runId as never,
      citationRef,
      viewer: { kind: "normal_user", athenaUserId: athenaUserId as never },
      purpose: "governance_check",
      now,
    }),
  );

describe("evidence lifecycle", () => {
  it("is reconstructible while the record classes live, and provenance-only afterwards", async () => {
    const t = convexTest(schema, modules);
    const { fixture, started, result } = await seedCompletedRun(t, "lifecycle");
    const citationRef = result.citations[0]!.citation;

    const fresh = await readEvidence(t, started.runId, citationRef, fixture.userId, FIXTURE_NOW);
    expect(fresh.kind).toBe("evidence");
    if (fresh.kind !== "evidence") throw new Error("unreachable");
    expect(fresh.state).toBe("reconstructible");

    // Past the 30-day short-lived class: the provisional call output and the
    // prompt are swept, and the answer keeps only what completion promoted.
    const afterShortLived = FIXTURE_NOW + SHORT_LIVED_RETENTION_MS + 60_000;
    const sweep = await t.run((ctx) => sweepExpiredAgentContentWithCtx(ctx, { now: afterShortLived, limit: 200 }));
    expect(sweep.deletedPromptPayloads + sweep.deletedReplayPayloads + sweep.deletedScratchDescriptors).toBeGreaterThan(0);

    const later = await readEvidence(t, started.runId, citationRef, fixture.userId, afterShortLived);
    expect(later.kind).toBe("evidence");
    if (later.kind !== "evidence") throw new Error("unreachable");
    // Still reconstructible: `completeRun` promoted the cited attempt's exact
    // validated program, its result, and the minimal claim slice to the
    // standard class. The provisional call bodies are gone.
    expect(later.state).toBe("reconstructible");

    // Past the 365-day standard class as well: only provenance remains.
    const afterStandard = FIXTURE_NOW + STANDARD_RETENTION_MS + 60_000;
    await t.run((ctx) => sweepExpiredAgentContentWithCtx(ctx, { now: afterStandard, limit: 500 }));
    await t.run((ctx) => sweepExpiredAgentContentWithCtx(ctx, { now: afterStandard, limit: 500 }));
    const expired = await readEvidence(t, started.runId, citationRef, fixture.userId, afterStandard);
    expect(expired.kind).toBe("evidence");
    if (expired.kind !== "evidence") throw new Error("unreachable");
    expect(["provenance_only", "evidence_expired"]).toContain(expired.state);
    // Provenance never disappears while the citation exists: the answer can
    // always say what it was grounded in, even when the body is gone.
    expect(expired.citation.resultHash).toBeTruthy();
  });

  it("audits every evidence read without storing the data that was read", async () => {
    const t = convexTest(schema, modules);
    const { fixture, started, result } = await seedCompletedRun(t, "audit");
    const citationRef = result.citations[0]!.citation;
    await readEvidence(t, started.runId, citationRef, fixture.userId, FIXTURE_NOW);
    await readEvidence(t, started.runId, citationRef, fixture.userId, FIXTURE_NOW + 1_000);

    const audits = await t.run(async (ctx) =>
      ctx.db
        .query("agentEvidenceAccessAudit")
        .withIndex("by_runId_accessedAt", (q) => q.eq("runId", started.runId))
        .take(20),
    );
    expect(audits.length).toBe(2);
    for (const audit of audits) {
      expect(audit.purpose).toBe("governance_check");
      // The audit records WHO read WHAT, never the payload itself.
      expect(JSON.stringify(audit)).not.toContain("lifecycleStage");
      expect(JSON.stringify(audit)).not.toContain("close_blocked");
    }
  });

  it("refuses evidence to an operator who has lost authority since the answer was released", async () => {
    const t = convexTest(schema, modules);
    const { fixture, started, result } = await seedCompletedRun(t, "revoked-evidence");
    const citationRef = result.citations[0]!.citation;
    expect((await readEvidence(t, started.runId, citationRef, fixture.userId, FIXTURE_NOW)).kind).toBe("evidence");

    await t.run(async (ctx) => {
      const membership = await ctx.db
        .query("organizationMember")
        .withIndex("by_organizationId_userId", (q) =>
          q.eq("organizationId", fixture.organizationId).eq("userId", fixture.userId),
        )
        .first();
      await ctx.db.delete("organizationMember", membership!._id);
    });

    const after = await readEvidence(t, started.runId, citationRef, fixture.userId, FIXTURE_NOW + 5_000);
    expect(after.kind).toBe("unauthorized");
  });
});

/**
 * A live provisional draft in one scope. It is content of the most sensitive
 * kind — unverified model prose — so the store/organization cascade must take
 * it with everything else rather than leave it behind unindexed.
 */
async function seedProvisionalDraft(t: Harness, fixture: { storeId: Id<"store">; organizationId: Id<"organization">; userId: Id<"athenaUser"> }, key: string) {
  return t.run(async (ctx) => {
    const recorded = await recordTurnIntentWithCtx(ctx, {
      storeId: fixture.storeId,
      organizationId: fixture.organizationId,
      principalKind: "athenaUser",
      actorRef: `athenaUser:${fixture.userId}`,
      visibilityMode: "store_admin",
      profileKey: DAILY_OPERATIONS_PROFILE_ID,
      profileVersion: "1",
      packageKeys: ["operations"],
      grantDigest: "fnv1a64:governance",
      registryDigest: "fnv1a64:governance",
      compatibilityDigest: "fnv1a64:governance",
      adapterKind: AGENT_NOOP_ADAPTER_KIND,
      adapterVersion: "noop.1",
      budgetPolicy: { runLimits: { calls: 4, rows: 100, bytes: 4_096, costUnits: 4, elapsedMs: 1_000 }, maxAttempts: 1 },
      egressClass: "operational",
      turnIdempotencyKey: `provisional-${key}`,
      promptPayload: { question: "cleanup" },
      now: FIXTURE_NOW,
    });
    if (recorded.outcome !== "created") throw new Error(JSON.stringify(recorded));
    await upsertProvisionalNarrativeWithCtx(ctx, {
      runId: recorded.runId,
      turnBindingId: recorded.bindingId,
      storeId: fixture.storeId,
      organizationId: fixture.organizationId,
      text: "Checking the day so far.",
      draftOrdinal: 0,
      truncated: false,
      egressClass: "operational",
      updatedAt: FIXTURE_NOW,
      expiresAt: FIXTURE_NOW + 300_000,
    });
    // The engineer-only trace of the same turn: the deltas and the tool
    // arguments the model exchanged. Scope removal owns it like any content.
    await appendTurnTraceEventsWithCtx(ctx, [
      {
        runId: recorded.runId,
        turnBindingId: recorded.bindingId,
        storeId: fixture.storeId,
        organizationId: fixture.organizationId,
        source: "adapter",
        sequence: 0,
        at: FIXTURE_NOW,
        kind: "narrative_delta",
        payload: { text: "Checking the day so far." },
        truncated: false,
        expiresAt: FIXTURE_NOW + AGENT_TURN_TRACE_RETENTION_MS,
        createdAt: FIXTURE_NOW,
      },
    ]);
    // The operator-readable trail of the same committed turn: content too, and
    // removed through the same scope index as everything else the store owns.
    await writeTurnNarrativeTrailWithCtx(ctx, {
      runId: recorded.runId,
      turnBindingId: recorded.bindingId,
      storeId: fixture.storeId,
      organizationId: fixture.organizationId,
      entries: [{ draftOrdinal: 0, text: "Checking the day so far.", truncated: false }],
      egressClass: "operational",
      committedAt: FIXTURE_NOW,
      now: FIXTURE_NOW,
    });
    return recorded.bindingId;
  });
}

describe("scope removal", () => {
  it("removes the store's agent content and leaves another store's untouched", async () => {
    const t = convexTest(schema, modules);
    const doomed = await seedCompletedRun(t, "doomed");
    const survivor = await seedCompletedRun(t, "survivor");
    const doomedDraft = await seedProvisionalDraft(t, doomed.fixture, "doomed");
    const survivorDraft = await seedProvisionalDraft(t, survivor.fixture, "survivor");

    let removed = 0;
    for (let pass = 0; pass < 20; pass += 1) {
      const removal = await t.run((ctx) =>
        deleteAgentHarnessContentForStoreWithCtx(ctx, doomed.fixture.storeId, FIXTURE_NOW + 1_000),
      );
      removed += removal.deletedRows + removal.markedRows;
      if (!removal.hasMore) break;
    }
    expect(removed).toBeGreaterThan(0);

    const doomedCalls = await t.run(async (ctx) =>
      ctx.db
        .query("agentCapabilityCall")
        .withIndex("by_runId_sequence", (q) => q.eq("runId", doomed.started.runId))
        .take(50),
    );
    expect(doomedCalls).toEqual([]);

    const survivorCalls = await t.run(async (ctx) =>
      ctx.db
        .query("agentCapabilityCall")
        .withIndex("by_runId_sequence", (q) => q.eq("runId", survivor.started.runId))
        .take(50),
    );
    expect(survivorCalls.length).toBeGreaterThan(0);

    // No unverified draft survives the removed store; the other store keeps its own.
    await t.run(async (ctx) => {
      expect(await loadProvisionalNarrativeByBindingWithCtx(ctx, doomedDraft)).toBeNull();
      expect(await loadProvisionalNarrativeByBindingWithCtx(ctx, survivorDraft)).not.toBeNull();
      expect(await ctx.db.query("agentProvisionalNarrative").withIndex("by_storeId", (q) => q.eq("storeId", doomed.fixture.storeId)).take(5)).toEqual([]);
      // Nor does the trace of the removed store's turn survive; the other store keeps its own.
      expect(await listTurnTraceByBindingWithCtx(ctx, doomedDraft, 5)).toEqual([]);
      expect(await listTurnTraceByBindingWithCtx(ctx, survivorDraft, 5)).toHaveLength(1);
      expect(await ctx.db.query("agentTurnTraceEvent").withIndex("by_storeId", (q) => q.eq("storeId", doomed.fixture.storeId)).take(5)).toEqual([]);
      // Nor the durable draft trail: the removed store keeps none of it.
      expect(await loadTurnNarrativeTrailByBindingWithCtx(ctx, doomedDraft)).toBeNull();
      expect(await loadTurnNarrativeTrailByBindingWithCtx(ctx, survivorDraft)).not.toBeNull();
      expect(await ctx.db.query("agentTurnNarrativeTrail").withIndex("by_storeId", (q) => q.eq("storeId", doomed.fixture.storeId)).take(5)).toEqual([]);
    });

    // The removed store's citation now answers as lifecycle-deleted rather
    // than as missing, so an investigation can tell the two apart.
    const evidence = await readEvidence(
      t,
      doomed.started.runId,
      doomed.result.citations[0]!.citation,
      doomed.fixture.userId,
      FIXTURE_NOW + 2_000,
    );
    expect(evidence.kind).toBe("evidence");
    if (evidence.kind !== "evidence") throw new Error("unreachable");
    expect(evidence.state).toBe("evidence_deleted_by_lifecycle");
    // Provenance survives the removal so an investigation can say what the
    // answer was grounded in; the body it was grounded in is gone.
    expect(evidence.citation.resultHash).toBeTruthy();
    // The call ledger row is content and was deleted with the store, so the
    // request identity it carried is gone too.
    expect(evidence.citation.normalizedArgsHash).toBeUndefined();
  });

  it("removes the organization's agent content", async () => {
    const t = convexTest(schema, modules);
    const { fixture, started } = await seedCompletedRun(t, "org-removal");
    const draft = await seedProvisionalDraft(t, fixture, "org-removal");
    const seededCalls = await t.run(async (ctx) =>
      ctx.db
        .query("agentCapabilityCall")
        .withIndex("by_runId_sequence", (q) => q.eq("runId", started.runId))
        .take(50),
    );
    expect(seededCalls.length).toBeGreaterThan(0);
    let removed = 0;
    for (let pass = 0; pass < 20; pass += 1) {
      const removal = await t.run((ctx) =>
        deleteAgentHarnessContentForOrganizationWithCtx(ctx, fixture.organizationId, FIXTURE_NOW + 1_000),
      );
      removed += removal.deletedRows + removal.markedRows;
      if (!removal.hasMore) break;
    }
    expect(removed).toBeGreaterThan(0);
    // Grants are audit, not content: they are marked rather than deleted, and
    // the prompt they pointed at is gone.
    const grants = await t.run(async (ctx) =>
      ctx.db
        .query("agentRunGrant")
        .withIndex("by_runId", (q) => q.eq("runId", started.runId))
        .take(5),
    );
    expect(grants).toHaveLength(1);
    expect(grants[0]!.lifecycle).toBe("deleted_by_lifecycle");
    expect(grants[0]!.promptPayloadState).toBe("deleted_by_lifecycle");
    expect(grants[0]!.promptPayloadId).toBeUndefined();
    const prompts = await t.run(async (ctx) =>
      ctx.db
        .query("agentPromptPayload")
        .withIndex("by_organizationId", (q) => q.eq("organizationId", fixture.organizationId))
        .take(5),
    );
    expect(prompts).toEqual([]);
    // Capability-call rows are content: organization removal deletes them
    // directly, exactly as store removal does.
    const calls = await t.run(async (ctx) =>
      ctx.db
        .query("agentCapabilityCall")
        .withIndex("by_runId_sequence", (q) => q.eq("runId", started.runId))
        .take(50),
    );
    expect(calls).toEqual([]);
    // The provisional draft is content too: deleted through the organization index.
    await t.run(async (ctx) => {
      expect(await loadProvisionalNarrativeByBindingWithCtx(ctx, draft)).toBeNull();
      expect(await ctx.db.query("agentProvisionalNarrative").withIndex("by_organizationId", (q) => q.eq("organizationId", fixture.organizationId)).take(5)).toEqual([]);
      expect(await listTurnTraceByBindingWithCtx(ctx, draft, 5)).toEqual([]);
      expect(await ctx.db.query("agentTurnTraceEvent").withIndex("by_organizationId", (q) => q.eq("organizationId", fixture.organizationId)).take(5)).toEqual([]);
      expect(await loadTurnNarrativeTrailByBindingWithCtx(ctx, draft)).toBeNull();
      expect(await ctx.db.query("agentTurnNarrativeTrail").withIndex("by_organizationId", (q) => q.eq("organizationId", fixture.organizationId)).take(5)).toEqual([]);
    });
  });
});

describe("runtime-side cleanup", () => {
  it("asks the registered adapter hook to delete runtime content and retries a failure", async () => {
    const t = convexTest(schema, modules);
    const { fixture } = await seedCompletedRun(t, "runtime-cleanup");

    // A turn binding is the only handle on runtime-side content, so cleanup is
    // requested through it rather than by reaching into the adapter.
    const bindingId = await t.run(async (ctx) => {
      const recorded = await recordTurnIntentWithCtx(ctx, {
        storeId: fixture.storeId,
        organizationId: fixture.organizationId,
        principalKind: "athenaUser",
        actorRef: `athenaUser:${fixture.userId}`,
        visibilityMode: "store_admin",
        profileKey: DAILY_OPERATIONS_PROFILE_ID,
        profileVersion: "1",
        packageKeys: ["operations"],
        grantDigest: "fnv1a64:governance",
        registryDigest: "fnv1a64:governance",
        compatibilityDigest: "fnv1a64:governance",
        adapterKind: AGENT_NOOP_ADAPTER_KIND,
        adapterVersion: "noop.1",
        budgetPolicy: { runLimits: { calls: 4, rows: 100, bytes: 4_096, costUnits: 4, elapsedMs: 1_000 }, maxAttempts: 1 },
        egressClass: "operational",
        turnIdempotencyKey: "governance-turn",
        promptPayload: { question: "cleanup" },
        now: FIXTURE_NOW,
      });
      if (recorded.outcome !== "created") throw new Error(JSON.stringify(recorded));
      return recorded.bindingId;
    });

    let attempts = 0;
    const unregister = registerAgentRuntimeCleanupHook(AGENT_NOOP_ADAPTER_KIND, async () => {
      attempts += 1;
      return attempts === 1
        ? { ok: false, retryable: true, error: "transient" }
        : { ok: true };
    });
    try {
      const first = await t.run((ctx) => requestRuntimeCleanupWithCtx(ctx, bindingId, FIXTURE_NOW));
      expect(first).toBe("failed");
      const pending = await t.run((ctx) => ctx.db.get("agentTurnBinding", bindingId));
      expect(pending?.runtimeCleanupStatus).toBe("failed");
      expect(pending?.runtimeCleanupNextAttemptAt).toBeGreaterThan(FIXTURE_NOW);

      const batch = await t.run((ctx) =>
        runRuntimeCleanupBatchWithCtx(ctx, { now: pending!.runtimeCleanupNextAttemptAt! + 1, limit: 10 }),
      );
      expect(batch.succeeded).toBe(1);
      const settled = await t.run((ctx) => ctx.db.get("agentTurnBinding", bindingId));
      expect(settled?.runtimeCleanupStatus).toBe("succeeded");
      expect(attempts).toBe(2);
    } finally {
      unregister();
    }
  });

  it("fails closed when no cleanup hook is registered for the adapter", async () => {
    const t = convexTest(schema, modules);
    const { fixture } = await seedCompletedRun(t, "no-hook");
    const bindingId = await t.run(async (ctx) => {
      const recorded = await recordTurnIntentWithCtx(ctx, {
        storeId: fixture.storeId,
        organizationId: fixture.organizationId,
        principalKind: "athenaUser",
        actorRef: `athenaUser:${fixture.userId}`,
        visibilityMode: "store_admin",
        profileKey: DAILY_OPERATIONS_PROFILE_ID,
        profileVersion: "1",
        packageKeys: ["operations"],
        grantDigest: "fnv1a64:governance",
        registryDigest: "fnv1a64:governance",
        compatibilityDigest: "fnv1a64:governance",
        adapterKind: "adapter_without_a_hook",
        adapterVersion: "0",
        budgetPolicy: { runLimits: { calls: 4, rows: 100, bytes: 4_096, costUnits: 4, elapsedMs: 1_000 }, maxAttempts: 1 },
        egressClass: "operational",
        turnIdempotencyKey: "governance-turn-no-hook",
        promptPayload: { question: "cleanup" },
        now: FIXTURE_NOW,
      });
      if (recorded.outcome !== "created") throw new Error(JSON.stringify(recorded));
      return recorded.bindingId;
    });
    const outcome = await t.run((ctx) => requestRuntimeCleanupWithCtx(ctx, bindingId, FIXTURE_NOW));
    expect(outcome).toBe("failed");
    const binding = await t.run((ctx) => ctx.db.get("agentTurnBinding", bindingId));
    // Retryable, never silently "done": an unregistered adapter must not be
    // mistaken for "there was nothing to clean up".
    expect(binding?.runtimeCleanupStatus).toBe("failed");
    expect(binding?.runtimeCleanupLastError).toContain("no_cleanup_hook_registered");
  });
});
