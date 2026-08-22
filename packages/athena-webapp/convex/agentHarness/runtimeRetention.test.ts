// @vitest-environment node
/// <reference types="vite/client" />
/**
 * Runtime retention: Convex Agent runtime messages obey Athena's 30-day
 * short-lived ceiling through the harness retention sweep (`retention.ts`), store
 * removal follows the Athena turn binding, and cleanup is idempotent across
 * partial adapter state. The real component is registered under convex-test;
 * component state is inspected only to prove deletion.
 */
import { convexTest, type TestConvex } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";

import schema from "../schema";
import { SHORT_LIVED_RETENTION_MS } from "../../shared/agentHarness/execution";
import { opaqueRef } from "../../shared/agentHarness/values";
import { AGENT_COMPONENT, createConvexAgentContractHarness, registerAgentComponent } from "./agentRuntime/convexAgent.contractHarness";
import { removeStoreWithCtx } from "../inventory/stores";
import { TEST_NOW_BASE } from "./delegatedAdmission.testPorts";
import { hasAgentRuntimeCleanupHook, requestRuntimeCleanupWithCtx, resetAgentRuntimeCleanupHooksForTests, runRuntimeCleanupBatchWithCtx, sweepExpiredAgentContentWithCtx } from "./retention";
import { CONVEX_AGENT_ADAPTER_KIND, ensureConvexAgentRuntimeCleanupRegistered } from "./runtimeRetention";
import { buildRunInput, seedTenant } from "./testSupport";
import { recordTurnIntentWithCtx } from "./turnBindings";

vi.mock("../sharedDemo/restore", () => ({
  requireReadySharedDemoWriteWithCtx: vi.fn(),
}));

const modules = Object.fromEntries(
  Object.entries(import.meta.glob("../**/*.ts")).map(([path, loader]) => [
    path.startsWith("../") ? path.replace(/^\.\.\//, "./") : path.replace(/^\.\//, "./agentHarness/"),
    loader,
  ]),
);

type Harness = TestConvex<typeof schema>;

function backend(): Harness {
  return registerAgentComponent(convexTest(schema, modules));
}

afterEach(() => {
  resetAgentRuntimeCleanupHooksForTests();
});

/** One real runtime turn (thread + input + per-turn record + projection) bound to an Athena binding under the `convex_agent` kind. */
async function seedRuntimeTurn(t: Harness, slug: string) {
  const harness = createConvexAgentContractHarness({ backend: t, clock: () => TEST_NOW_BASE });
  const turnKey = `turn-${slug}`;
  harness.scriptTurn(turnKey, [{ kind: "complete", narrative: "done" }]);
  const thread = await harness.adapter.ensureThread({ threadKey: `retention|${slug}`, contextBindingRef: opaqueRef("context_binding", slug), correlation: { operatorRef: "operator:x", profileId: "p" } });
  const input = await harness.adapter.saveInput({
    threadRef: thread.threadRef,
    turnKey,
    prompt: { text: `prompt ${slug}`, egressClass: "operational", promptHash: "sha256:p", untrustedDataLabel: "retrieved_store_data" },
    history: { messages: [], projectionDigest: "sha256:empty", reauthorizedAt: TEST_NOW_BASE },
  });
  const { turnRef } = await harness.adapter.startTurn(
    { threadRef: thread.threadRef, inputRef: input.inputRef, turnKey, tools: [], model: { providerId: "fixture", modelId: "fixture-1", region: "eu" }, limits: { maxToolCalls: 1, maxElapsedMs: 10_000 } },
    { onEvent: () => undefined, dispatchTool: async () => ({ kind: "protocol_violation", callId: "", toolId: "", idempotencyKey: "", code: "unknown_tool", message: "" }) },
  );
  await harness.settle(turnRef);
  const projected = await harness.adapter.projectCompletion({ threadRef: thread.threadRef, turnRef, idempotencyKey: `project-${slug}`, artifact: { artifactRef: "artifact:x", narrative: "answer", egressClass: "operational", citations: [], committedAt: TEST_NOW_BASE } });
  if (projected.kind !== "projected") throw new Error(projected.kind);
  const seeded = await t.run(async (ctx) => {
    const tenant = await seedTenant(ctx, slug);
    const { runIdempotencyKey: _key, ...base } = buildRunInput(tenant, { adapterKind: CONVEX_AGENT_ADAPTER_KIND, adapterVersion: "convex_agent@test" });
    const intent = await recordTurnIntentWithCtx(ctx, { ...base, turnIdempotencyKey: `turn-${slug}`, runtimeThreadRef: thread.threadRef, promptPayload: { question: "q" }, now: TEST_NOW_BASE });
    if (intent.outcome !== "created") throw new Error(intent.outcome);
    await ctx.db.patch("agentTurnBinding", intent.bindingId, { runtimeInputRef: input.inputRef, runtimeProjectionRef: projected.projectionRef, runtimeTurnRef: turnRef });
    return { tenant, bindingId: intent.bindingId, runId: intent.runId };
  });
  return { ...seeded, thread, input, turnRef, projectionRef: projected.projectionRef };
}

async function componentThreads(t: Harness, threadRef: string) {
  const page = await t.query(AGENT_COMPONENT.threads.listThreadsByUserId, { userId: `athena:thread:${threadRef.replace("runtime_thread:", "")}`, paginationOpts: { cursor: null, numItems: 5 } });
  return page.page.length;
}

describe("runtime retention binding (scenario 12)", () => {
  it("registers the convex_agent cleanup hook lazily, once, and survives the test registry reset", () => {
    resetAgentRuntimeCleanupHooksForTests();
    expect(hasAgentRuntimeCleanupHook(CONVEX_AGENT_ADAPTER_KIND)).toBe(false);
    ensureConvexAgentRuntimeCleanupRegistered();
    expect(hasAgentRuntimeCleanupHook(CONVEX_AGENT_ADAPTER_KIND)).toBe(true);
    ensureConvexAgentRuntimeCleanupRegistered();
    resetAgentRuntimeCleanupHooksForTests();
    expect(hasAgentRuntimeCleanupHook(CONVEX_AGENT_ADAPTER_KIND)).toBe(false);
    ensureConvexAgentRuntimeCleanupRegistered();
    expect(hasAgentRuntimeCleanupHook(CONVEX_AGENT_ADAPTER_KIND)).toBe(true);
  });

  it("runtime messages obey the 30-day ceiling: the retention expiry sweep asks the adapter and the component thread is gone", async () => {
    const t = backend();
    const seeded = await seedRuntimeTurn(t, "expiry");
    expect(await componentThreads(t, seeded.thread.threadRef)).toBe(1);
    vi.useFakeTimers();
    try {
      // Before the short-lived class expires: nothing is asked of the adapter.
      const early = await t.run((ctx) => sweepExpiredAgentContentWithCtx(ctx, { now: TEST_NOW_BASE + SHORT_LIVED_RETENTION_MS - 1, limit: 10 }));
      expect(early.runtimeCleanupAttempted).toBe(0);
      const due = await t.run((ctx) => sweepExpiredAgentContentWithCtx(ctx, { now: TEST_NOW_BASE + SHORT_LIVED_RETENTION_MS + 1, limit: 10 }));
      expect(due).toMatchObject({ runtimeCleanupAttempted: 1, runtimeCleanupSucceeded: 1, runtimeCleanupFailed: 0 });
      await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    } finally {
      vi.useRealTimers();
    }
    expect(await t.run((ctx) => ctx.db.get("agentTurnBinding", seeded.bindingId))).toMatchObject({ runtimeCleanupStatus: "succeeded", adapterKind: CONVEX_AGENT_ADAPTER_KIND });
    expect(await componentThreads(t, seeded.thread.threadRef)).toBe(0);
    // The Athena audit rows survive; only runtime payloads were removed.
    expect(await t.run((ctx) => ctx.db.get("intelligenceRun", seeded.runId))).not.toBeNull();
  });

  it("store removal follows the Athena binding and is idempotent across partial adapter state", async () => {
    const t = backend();
    const seeded = await seedRuntimeTurn(t, "removal");
    const orphan = await t.run(async (ctx) => {
      // A binding whose runtime refs point at nothing (a crashed host): cleanup still succeeds without a throw.
      const { runIdempotencyKey: _key, ...base } = buildRunInput(seeded.tenant, { adapterKind: CONVEX_AGENT_ADAPTER_KIND, adapterVersion: "convex_agent@test" });
      const intent = await recordTurnIntentWithCtx(ctx, { ...base, turnIdempotencyKey: "turn-orphan", runtimeThreadRef: "runtime_thread:th_0000000000000000000000000000000000000000", promptPayload: { question: "q" }, now: TEST_NOW_BASE });
      if (intent.outcome !== "created") throw new Error(intent.outcome);
      return intent.bindingId;
    });
    vi.useFakeTimers();
    try {
      await t.run((ctx) => removeStoreWithCtx(ctx, seeded.tenant.storeId));
      await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    } finally {
      vi.useRealTimers();
    }
    expect(await componentThreads(t, seeded.thread.threadRef)).toBe(0);
    const bindings = await t.run(async (ctx) => [await ctx.db.get("agentTurnBinding", seeded.bindingId), await ctx.db.get("agentTurnBinding", orphan)]);
    expect(bindings.map((binding) => binding?.runtimeCleanupStatus)).toEqual(["succeeded", "succeeded"]);
    // Idempotent: asking again over deleted refs reports already cleaned / succeeds without a throw.
    expect(await t.run((ctx) => requestRuntimeCleanupWithCtx(ctx, seeded.bindingId, TEST_NOW_BASE + 10))).toBe("already_succeeded");
    await t.run((ctx) => ctx.db.patch("agentTurnBinding", seeded.bindingId, { runtimeCleanupStatus: "pending", runtimeCleanupNextAttemptAt: TEST_NOW_BASE + 20 }));
    expect(await t.run((ctx) => runRuntimeCleanupBatchWithCtx(ctx, { now: TEST_NOW_BASE + 30, limit: 10 }))).toMatchObject({ attempted: 1, succeeded: 1, failed: 0 });
  });
});
