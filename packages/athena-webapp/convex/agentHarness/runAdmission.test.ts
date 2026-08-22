/// <reference types="vite/client" />
/**
 * Run admission: operator prompt validation with
 * no partial persistence, the per-operator active-run limit, one active turn
 * per thread, and the reserve-then-settle provider-spend ceiling.
 */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";

import type { MutationCtx } from "../_generated/server";
import schema from "../schema";
import { markAgentRunRunningWithCtx, cancelAgentRunWithCtx } from "./lifecycle";
import {
  AGENT_OPERATOR_ACTIVE_RUN_LIMIT,
  AGENT_PROMPT_MAX_BYTES,
  AGENT_PROMPT_MAX_TOKENS,
  AGENT_SPEND_CEILINGS,
  admitTurnStartWithCtx,
  countActiveAgentRunsForOperatorWithCtx,
  estimatePromptTokens,
  findActiveTurnOnThreadWithCtx,
  reserveTurnSpendWithCtx,
  settleTurnSpendWithCtx,
  spendWindowKey,
  validateOperatorPrompt,
} from "./runAdmission";
import { TEST_NOW, seedRun, seedTenant } from "./testSupport";
import { recordTurnIntentWithCtx } from "./turnBindings";
import { buildRunInput } from "./testSupport";

const modules = Object.fromEntries(
  Object.entries(import.meta.glob("../**/*.ts")).map(([path, loader]) => [
    path.startsWith("../") ? path.replace(/^\.\.\//, "./") : path.replace(/^\.\//, "./agentHarness/"),
    loader,
  ]),
);

function ok(result: ReturnType<typeof validateOperatorPrompt>) {
  if (!result.ok) throw new Error(`expected ok, got ${result.code}`);
  return result;
}

function rejected(result: ReturnType<typeof validateOperatorPrompt>) {
  if (result.ok) throw new Error("expected rejection");
  return result;
}

describe("operator prompt validation (scenario 15)", () => {
  it("accepts a normal question and reports its size", () => {
    const result = ok(validateOperatorPrompt("What needs attention today?"));
    expect(result.text).toBe("What needs attention today?");
    expect(result.byteLength).toBe(27);
    expect(result.estimatedTokens).toBeGreaterThan(0);
    expect(result.normalizations).toEqual([]);
  });

  it("rejects empty, whitespace-only, and non-text prompts before anything is persisted", () => {
    expect(rejected(validateOperatorPrompt("")).code).toBe("empty");
    expect(rejected(validateOperatorPrompt("   \n\t ")).code).toBe("empty");
    expect(rejected(validateOperatorPrompt(null)).code).toBe("not_text");
    expect(rejected(validateOperatorPrompt({ text: "hi" })).code).toBe("not_text");
    expect(rejected(validateOperatorPrompt(42)).code).toBe("not_text");
  });

  it("enforces the 16 KiB byte ceiling and the profile's lower ceiling", () => {
    expect(AGENT_PROMPT_MAX_BYTES).toBe(16 * 1024);
    // Both ceilings are independent: 12 KiB of prose is ~3,072 tokens and passes;
    // exactly 16 KiB is over the token ceiling; one byte more is over the byte ceiling first.
    expect(ok(validateOperatorPrompt("a".repeat(12 * 1024))).byteLength).toBe(12 * 1024);
    expect(rejected(validateOperatorPrompt("a".repeat(AGENT_PROMPT_MAX_BYTES))).code).toBe("too_many_tokens");
    expect(rejected(validateOperatorPrompt("a".repeat(AGENT_PROMPT_MAX_BYTES + 1))).code).toBe("too_large");
    // Multibyte: bytes, not characters, are what the ceiling counts.
    expect(rejected(validateOperatorPrompt("é".repeat(AGENT_PROMPT_MAX_BYTES / 2 + 1))).code).toBe("too_large");
    expect(rejected(validateOperatorPrompt("a".repeat(5_000), { maxPromptBytes: 4_096 })).code).toBe("too_large");
  });

  it("enforces the 4,000 provider-counted token ceiling with a conservative estimator", () => {
    expect(AGENT_PROMPT_MAX_TOKENS).toBe(4_000);
    // The estimator never under-counts relative to bytes/4 and words * 1.3.
    expect(estimatePromptTokens("a".repeat(4_000))).toBeGreaterThanOrEqual(1_000);
    expect(estimatePromptTokens("one two three four five")).toBeGreaterThanOrEqual(5);
    // 16 KiB of short words is far more than 4,000 tokens.
    const wordy = Array.from({ length: 5_000 }, () => "ab").join(" ");
    expect(rejected(validateOperatorPrompt(wordy)).code).toBe("too_many_tokens");
    expect(rejected(validateOperatorPrompt("word ".repeat(900), { maxPromptTokens: 1_000 })).code).toBe("too_many_tokens");
  });

  it("rejects malformed Unicode and disallowed control characters", () => {
    expect(rejected(validateOperatorPrompt("bad \uD83D surrogate")).code).toBe("invalid_unicode");
    expect(rejected(validateOperatorPrompt("bad \uDC00 surrogate")).code).toBe("invalid_unicode");
    expect(rejected(validateOperatorPrompt("null\u0000byte")).code).toBe("disallowed_control");
    expect(rejected(validateOperatorPrompt("bell\u0007")).code).toBe("disallowed_control");
    expect(rejected(validateOperatorPrompt("c1\u0085control")).code).toBe("disallowed_control");
  });

  it("rejects bidi overrides by explicit policy and normalizes line endings, NFC, and zero-width characters", () => {
    expect(rejected(validateOperatorPrompt("swap \u202Ereversed\u202C")).code).toBe("disallowed_bidi");
    expect(rejected(validateOperatorPrompt("isolate \u2066x\u2069")).code).toBe("disallowed_bidi");
    const normalized = ok(validateOperatorPrompt("line one\r\nline\ttwo\u200B e\u0301\uFEFF"));
    expect(normalized.text).toBe("line one\nline\ttwo \u00E9");
    expect(normalized.normalizations).toEqual(["crlf_to_lf", "zero_width_removed", "nfc"]);
  });
});

describe("per-operator active-run limit, one active turn per thread, and spend ceiling (scenario 9)", () => {
  async function seedOperatorRuns(ctx: MutationCtx, slug: string, count: number) {
    const tenant = await seedTenant(ctx, slug);
    const runs = [];
    for (let index = 0; index < count; index += 1) {
      const created = await seedRun(ctx, tenant, { runIdempotencyKey: `turn-${index}`, actorRef: `athenaUser:${slug}` });
      await markAgentRunRunningWithCtx(ctx, { runId: created.runId, now: TEST_NOW });
      runs.push(created);
    }
    return { tenant, runs };
  }

  it("counts only active agent runs of the operator and denies at the limit without persisting anything", async () => {
    const t = convexTest(schema, modules);
    const seeded = await t.run((ctx) => seedOperatorRuns(ctx, "limit", AGENT_OPERATOR_ACTIVE_RUN_LIMIT));
    await t.run(async (ctx) => {
      // A legacy (non-agent) run and a terminal run under the same actor never count.
      await ctx.db.insert("intelligenceRun", {
        storeId: seeded.tenant.storeId,
        organizationId: seeded.tenant.organizationId,
        capability: "storeInsights",
        providerKey: "fake",
        idempotencyKey: "legacy",
        status: "running",
        trigger: "operator",
        principalKind: "athenaUser",
        actorRef: "athenaUser:limit",
        visibilityMode: "store_admin",
        sourceRefs: [],
        attemptCount: 1,
        createdAt: TEST_NOW,
        updatedAt: TEST_NOW,
      });
      expect(await countActiveAgentRunsForOperatorWithCtx(ctx, "athenaUser:limit", 10)).toBe(AGENT_OPERATOR_ACTIVE_RUN_LIMIT);
      const denied = await admitTurnStartWithCtx(ctx, {
        actorRef: "athenaUser:limit",
        storeId: seeded.tenant.storeId,
        threadKey: "thread-a",
        maxProviderCostUnits: 100,
        now: TEST_NOW,
      });
      expect(denied).toMatchObject({ ok: false, code: "active_run_limit", retryable: true });
      const windows = await ctx.db.query("agentSpendWindow").withIndex("by_scopeKey_windowKey", (q) => q.eq("scopeKey", "operator:athenaUser:limit")).take(5);
      expect(windows).toHaveLength(0);
    });
    await t.run(async (ctx) => {
      await cancelAgentRunWithCtx(ctx, { runId: seeded.runs[0].runId, idempotencyKey: "c", reason: "test", now: TEST_NOW + 1 });
      expect(await countActiveAgentRunsForOperatorWithCtx(ctx, "athenaUser:limit", 10)).toBe(AGENT_OPERATOR_ACTIVE_RUN_LIMIT - 1);
      const admitted = await admitTurnStartWithCtx(ctx, {
        actorRef: "athenaUser:limit",
        storeId: seeded.tenant.storeId,
        threadKey: "thread-a",
        maxProviderCostUnits: 100,
        now: TEST_NOW + 1,
      });
      expect(admitted).toMatchObject({ ok: true, spend: { windowKey: spendWindowKey(TEST_NOW + 1), reservedCostUnits: 100 } });
    });
  });

  it("blocks the operator's own second submission on a thread with an active turn (never queues), not a colleague's, and frees it when the turn ends", async () => {
    const t = convexTest(schema, modules);
    const seeded = await t.run(async (ctx) => {
      const tenant = await seedTenant(ctx, "busy");
      const { runIdempotencyKey: _key, ...base } = buildRunInput(tenant, { actorRef: "athenaUser:busy" });
      const intent = await recordTurnIntentWithCtx(ctx, { ...base, turnIdempotencyKey: "turn-1", threadKey: "thread-busy", promptPayload: { prompt: "hi" } });
      if (intent.outcome !== "created") throw new Error(intent.outcome);
      return { tenant, intent };
    });
    await t.run(async (ctx) => {
      // A colleague's active turn on the same store thread key is not this operator's turn.
      expect(
        await admitTurnStartWithCtx(ctx, { actorRef: "athenaUser:other", storeId: seeded.tenant.storeId, threadKey: "thread-busy", maxProviderCostUnits: 10, now: TEST_NOW }),
      ).toMatchObject({ ok: true });
      expect(
        await admitTurnStartWithCtx(ctx, { actorRef: "athenaUser:busy", storeId: seeded.tenant.storeId, threadKey: "thread-busy", maxProviderCostUnits: 10, now: TEST_NOW }),
      ).toMatchObject({ ok: false, code: "thread_busy", retryable: true });
      expect(
        await admitTurnStartWithCtx(ctx, { actorRef: "athenaUser:busy", storeId: seeded.tenant.storeId, threadKey: "thread-free", maxProviderCostUnits: 10, now: TEST_NOW }),
      ).toMatchObject({ ok: true });
      await cancelAgentRunWithCtx(ctx, { runId: seeded.intent.runId, idempotencyKey: "c", reason: "done", now: TEST_NOW + 1 });
      expect(
        await admitTurnStartWithCtx(ctx, { actorRef: "athenaUser:busy", storeId: seeded.tenant.storeId, threadKey: "thread-busy", maxProviderCostUnits: 10, now: TEST_NOW + 2 }),
      ).toMatchObject({ ok: true });
    });
  });

  it("finds the operator's own active turn even when colleagues' newer turns sit in front of it on the thread key", async () => {
    const t = convexTest(schema, modules);
    const seeded = await t.run(async (ctx) => {
      const tenant = await seedTenant(ctx, "buried");
      const { runIdempotencyKey: _key, ...base } = buildRunInput(tenant, { actorRef: "athenaUser:buried" });
      const own = await recordTurnIntentWithCtx(ctx, { ...base, turnIdempotencyKey: "turn-own", threadKey: "thread-shared", promptPayload: { prompt: "hi" }, now: TEST_NOW });
      if (own.outcome !== "created") throw new Error(own.outcome);
      for (let index = 0; index < 6; index += 1) {
        const { runIdempotencyKey: _k, ...other } = buildRunInput(tenant, { actorRef: `athenaUser:colleague-${index}` });
        const intent = await recordTurnIntentWithCtx(ctx, { ...other, turnIdempotencyKey: `turn-colleague-${index}`, threadKey: "thread-shared", promptPayload: { prompt: "hi" }, now: TEST_NOW + 1 + index });
        if (intent.outcome !== "created") throw new Error(intent.outcome);
      }
      return { tenant, own };
    });
    await t.run(async (ctx) => {
      expect(await findActiveTurnOnThreadWithCtx(ctx, { actorRef: "athenaUser:buried", storeId: seeded.tenant.storeId, threadKey: "thread-shared" })).toEqual({ bindingId: seeded.own.bindingId, runId: seeded.own.runId });
      expect(
        await admitTurnStartWithCtx(ctx, { actorRef: "athenaUser:buried", storeId: seeded.tenant.storeId, threadKey: "thread-shared", maxProviderCostUnits: 10, now: TEST_NOW + 10 }),
      ).toMatchObject({ ok: false, code: "thread_busy" });
      // A different thread key in the same store is free for the same operator.
      expect(await findActiveTurnOnThreadWithCtx(ctx, { actorRef: "athenaUser:buried", storeId: seeded.tenant.storeId, threadKey: "thread-elsewhere" })).toBeNull();
    });
  });

  it("reserves provider spend per operator and store window, refuses beyond the ceiling, and settles to actual cost", async () => {
    const t = convexTest(schema, modules);
    const tenant = await t.run((ctx) => seedTenant(ctx, "spend"));
    await t.run(async (ctx) => {
      const windowKey = spendWindowKey(TEST_NOW);
      expect(windowKey).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      const first = await reserveTurnSpendWithCtx(ctx, { actorRef: "athenaUser:spend", storeId: tenant.storeId, costUnits: AGENT_SPEND_CEILINGS.operatorDailyCostUnits - 1, now: TEST_NOW });
      expect(first).toMatchObject({ ok: true, reservedCostUnits: AGENT_SPEND_CEILINGS.operatorDailyCostUnits - 1 });
      const second = await reserveTurnSpendWithCtx(ctx, { actorRef: "athenaUser:spend", storeId: tenant.storeId, costUnits: 2, now: TEST_NOW });
      expect(second).toMatchObject({ ok: false, code: "spend_ceiling", scope: "operator", retryable: true });
      // Settling the first reservation to its actual (smaller) cost frees headroom; settlement is idempotent.
      await settleTurnSpendWithCtx(ctx, { actorRef: "athenaUser:spend", storeId: tenant.storeId, windowKey, reservedCostUnits: AGENT_SPEND_CEILINGS.operatorDailyCostUnits - 1, actualCostUnits: 10, now: TEST_NOW + 1 });
      const window = await ctx.db.query("agentSpendWindow").withIndex("by_scopeKey_windowKey", (q) => q.eq("scopeKey", "operator:athenaUser:spend").eq("windowKey", windowKey)).unique();
      expect(window).toMatchObject({ reservedCostUnits: 0, settledCostUnits: 10, runCount: 1 });
      const third = await reserveTurnSpendWithCtx(ctx, { actorRef: "athenaUser:spend", storeId: tenant.storeId, costUnits: 2, now: TEST_NOW });
      expect(third).toMatchObject({ ok: true });
      // A new UTC day is a fresh window.
      const tomorrow = await reserveTurnSpendWithCtx(ctx, { actorRef: "athenaUser:spend", storeId: tenant.storeId, costUnits: AGENT_SPEND_CEILINGS.operatorDailyCostUnits, now: TEST_NOW + 86_400_000 });
      expect(tomorrow).toMatchObject({ ok: true });
    });
  });

  it("applies the store ceiling across operators", async () => {
    const t = convexTest(schema, modules);
    const tenant = await t.run((ctx) => seedTenant(ctx, "store-spend"));
    await t.run(async (ctx) => {
      const perOperator = AGENT_SPEND_CEILINGS.operatorDailyCostUnits;
      let reserved = 0;
      let operator = 0;
      let outcome: Awaited<ReturnType<typeof reserveTurnSpendWithCtx>> | undefined;
      while (reserved <= AGENT_SPEND_CEILINGS.storeDailyCostUnits) {
        outcome = await reserveTurnSpendWithCtx(ctx, { actorRef: `athenaUser:op-${operator}`, storeId: tenant.storeId, costUnits: perOperator, now: TEST_NOW });
        if (!outcome.ok) break;
        reserved += perOperator;
        operator += 1;
      }
      expect(outcome).toMatchObject({ ok: false, code: "spend_ceiling", scope: "store" });
    });
  });
});
