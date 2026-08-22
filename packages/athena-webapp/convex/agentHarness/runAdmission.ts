/**
 * Run admission (kernel; V8).
 *
 * Authority boundary: everything here runs BEFORE a run, runtime thread,
 * prompt payload, or provider request exists, and fails closed with a typed
 * denial that persists nothing:
 * - the operator prompt is validated as UTF-8 text (nonempty after
 *   normalization, at most 16 KiB and 4,000 provider-counted tokens, valid
 *   Unicode, disallowed control/bidi characters rejected, zero-width and line
 *   endings normalized by explicit policy);
 * - the per-operator active-run limit and the one-active-turn-per-thread rule
 *   refuse overload as retryable denials;
 * - provider spend is reserved against a per-operator and per-store UTC-day
 *   window before any provider work and settled to actual cost afterwards
 *   (plan decision 11 applied to provider cost, decision 12 for the ceiling).
 * Nothing here reads a product domain or the runtime adapter.
 */
import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { AGENT_RUN_ACTIVE_STATUSES, isTerminalRunStatus } from "../../shared/agentHarness/execution";
import { AGENT_PROGRAM_RUNTIME_CEILINGS } from "./programRuntime/types";

type ReadCtx = QueryCtx | MutationCtx;

// ---------------------------------------------------------------------------
// Prompt validation
// ---------------------------------------------------------------------------

export const AGENT_PROMPT_MAX_BYTES = 16 * 1024;
export const AGENT_PROMPT_MAX_TOKENS = 4_000;

export const AGENT_PROMPT_REJECTION_CODES = [
  "not_text",
  "empty",
  "too_large",
  "too_many_tokens",
  "invalid_unicode",
  "disallowed_control",
  "disallowed_bidi",
] as const;
export type AgentPromptRejectionCode = (typeof AGENT_PROMPT_REJECTION_CODES)[number];

export const AGENT_PROMPT_NORMALIZATIONS = ["crlf_to_lf", "zero_width_removed", "nfc"] as const;
export type AgentPromptNormalization = (typeof AGENT_PROMPT_NORMALIZATIONS)[number];

export type AgentPromptPolicy = {
  readonly maxPromptBytes?: number;
  readonly maxPromptTokens?: number;
};

export type AgentPromptValidation =
  | {
      readonly ok: true;
      readonly text: string;
      readonly byteLength: number;
      readonly estimatedTokens: number;
      readonly normalizations: readonly AgentPromptNormalization[];
    }
  | { readonly ok: false; readonly code: AgentPromptRejectionCode; readonly message: string };

/** C0 controls except TAB/LF, DEL, and C1 controls: never part of an operator question. */
const DISALLOWED_CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/;
/** Explicit bidi embedding/override/isolate controls: rejected, never normalized away. */
const DISALLOWED_BIDI = /[\u202A-\u202E\u2066-\u2069]/;
/** Zero-width joiners/spaces and the BOM: normalized away, reported. */
const ZERO_WIDTH = /[\u200B-\u200D\u2060\uFEFF]/g;

function isWellFormedUnicode(text: string): boolean {
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return false;
    }
  }
  return true;
}

export function measurePromptBytes(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

/**
 * Conservative proxy for provider-counted tokens. Providers count roughly one
 * token per four bytes of prose and more for short or unusual words, so the
 * estimate is the larger of bytes/4 and 1.3 tokens per whitespace-separated
 * word; exact provider counts arrive afterwards as usage evidence and can
 * only confirm, never relax, an admission decision.
 */
export function estimatePromptTokens(text: string): number {
  const bytes = measurePromptBytes(text);
  const words = text.split(/\s+/).filter((word) => word.length > 0).length;
  return Math.max(Math.ceil(bytes / 4), Math.ceil(words * 1.3));
}

export function validateOperatorPrompt(raw: unknown, policy: AgentPromptPolicy = {}): AgentPromptValidation {
  if (typeof raw !== "string") {
    return { ok: false, code: "not_text", message: "Type a question to ask." };
  }
  if (!isWellFormedUnicode(raw)) {
    return { ok: false, code: "invalid_unicode", message: "The question contains text that cannot be read. Retype it and try again." };
  }
  if (DISALLOWED_CONTROL.test(raw)) {
    return { ok: false, code: "disallowed_control", message: "The question contains hidden control characters. Retype it and try again." };
  }
  if (DISALLOWED_BIDI.test(raw)) {
    return { ok: false, code: "disallowed_bidi", message: "The question contains text-direction controls that are not allowed. Retype it and try again." };
  }
  const normalizations: AgentPromptNormalization[] = [];
  let text = raw;
  if (/\r\n?/.test(text)) {
    text = text.replace(/\r\n?/g, "\n");
    normalizations.push("crlf_to_lf");
  }
  if (ZERO_WIDTH.test(text)) {
    ZERO_WIDTH.lastIndex = 0;
    text = text.replace(ZERO_WIDTH, "");
    normalizations.push("zero_width_removed");
  }
  ZERO_WIDTH.lastIndex = 0;
  const nfc = text.normalize("NFC");
  if (nfc !== text) {
    text = nfc;
    normalizations.push("nfc");
  }
  text = text.trim();
  if (text.length === 0) {
    return { ok: false, code: "empty", message: "Type a question to ask." };
  }
  const maxBytes = Math.min(AGENT_PROMPT_MAX_BYTES, policy.maxPromptBytes ?? AGENT_PROMPT_MAX_BYTES);
  const byteLength = measurePromptBytes(text);
  if (byteLength > maxBytes) {
    return { ok: false, code: "too_large", message: "The question is too long. Shorten it and try again." };
  }
  const maxTokens = Math.min(AGENT_PROMPT_MAX_TOKENS, policy.maxPromptTokens ?? AGENT_PROMPT_MAX_TOKENS);
  const estimatedTokens = estimatePromptTokens(text);
  if (estimatedTokens > maxTokens) {
    return { ok: false, code: "too_many_tokens", message: "The question is too long. Shorten it and try again." };
  }
  return { ok: true, text, byteLength, estimatedTokens, normalizations };
}

// ---------------------------------------------------------------------------
// Active-run limit and one active turn per thread
// ---------------------------------------------------------------------------

/** Active agent runs one operator may hold across stores; a second submission is blocked, never queued. */
export const AGENT_OPERATOR_ACTIVE_RUN_LIMIT = 2;

export async function countActiveAgentRunsForOperatorWithCtx(ctx: ReadCtx, actorRef: string, limit: number): Promise<number> {
  let count = 0;
  for (const status of AGENT_RUN_ACTIVE_STATUSES) {
    const rows = await ctx.db
      .query("intelligenceRun")
      .withIndex("by_actorRef_status", (q) => q.eq("actorRef", actorRef).eq("status", status))
      .take(limit + 1);
    count += rows.filter((run) => run.harnessKind === "agent").length;
    if (count > limit) return count;
  }
  return count;
}

/** The most recent non-terminal turn on an Athena thread, if any. */
export async function findActiveTurnOnThreadWithCtx(
  ctx: ReadCtx,
  input: { storeId: Id<"store">; threadKey: string; limit?: number },
): Promise<{ bindingId: Id<"agentTurnBinding">; runId: Id<"intelligenceRun"> } | null> {
  const bindings = await ctx.db
    .query("agentTurnBinding")
    .withIndex("by_storeId_threadKey_createdAt", (q) => q.eq("storeId", input.storeId).eq("threadKey", input.threadKey))
    .order("desc")
    .take(input.limit ?? 5);
  for (const binding of bindings) {
    if (binding.abandonedAt !== undefined) continue;
    const run = await ctx.db.get("intelligenceRun", binding.runId);
    if (run && !isTerminalRunStatus(run.status)) return { bindingId: binding._id, runId: run._id };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Provider-spend ceiling (reserve before work, settle afterwards)
// ---------------------------------------------------------------------------

/** Cost units (Athena's `calculateUsageCost` units) per UTC day. */
export const AGENT_SPEND_CEILINGS = Object.freeze({
  operatorDailyCostUnits: 20_000,
  storeDailyCostUnits: 100_000,
});

export function spendWindowKey(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

function operatorScopeKey(actorRef: string): string {
  return `operator:${actorRef}`;
}

function storeScopeKey(storeId: Id<"store">): string {
  return `store:${storeId}`;
}

async function loadSpendWindow(ctx: ReadCtx, scopeKey: string, windowKey: string) {
  return ctx.db
    .query("agentSpendWindow")
    .withIndex("by_scopeKey_windowKey", (q) => q.eq("scopeKey", scopeKey).eq("windowKey", windowKey))
    .unique();
}

export type AgentSpendReservation =
  | { readonly ok: true; readonly windowKey: string; readonly reservedCostUnits: number }
  | { readonly ok: false; readonly code: "spend_ceiling"; readonly scope: "operator" | "store"; readonly message: string; readonly retryable: true };

/**
 * Reserve the turn's maximum provider cost against both windows in one
 * transaction. Either ceiling refuses before a row is touched; a reservation
 * counts until it is settled.
 */
export async function reserveTurnSpendWithCtx(
  ctx: MutationCtx,
  input: { actorRef: string; storeId: Id<"store">; costUnits: number; now: number },
): Promise<AgentSpendReservation> {
  const windowKey = spendWindowKey(input.now);
  const scopes = [
    { scope: "operator" as const, key: operatorScopeKey(input.actorRef), ceiling: AGENT_SPEND_CEILINGS.operatorDailyCostUnits },
    { scope: "store" as const, key: storeScopeKey(input.storeId), ceiling: AGENT_SPEND_CEILINGS.storeDailyCostUnits },
  ];
  const rows = [];
  for (const entry of scopes) {
    const row = await loadSpendWindow(ctx, entry.key, windowKey);
    const used = (row?.reservedCostUnits ?? 0) + (row?.settledCostUnits ?? 0);
    if (used + input.costUnits > entry.ceiling) {
      return {
        ok: false,
        code: "spend_ceiling",
        scope: entry.scope,
        message: "Athena has reached today's usage limit for this " + (entry.scope === "operator" ? "account" : "store") + ". Try again later.",
        retryable: true,
      };
    }
    rows.push({ entry, row });
  }
  for (const { entry, row } of rows) {
    if (row) {
      await ctx.db.patch("agentSpendWindow", row._id, {
        reservedCostUnits: row.reservedCostUnits + input.costUnits,
        runCount: row.runCount + 1,
        updatedAt: input.now,
      });
    } else {
      await ctx.db.insert("agentSpendWindow", {
        scopeKey: entry.key,
        windowKey,
        reservedCostUnits: input.costUnits,
        settledCostUnits: 0,
        runCount: 1,
        updatedAt: input.now,
      });
    }
  }
  return { ok: true, windowKey, reservedCostUnits: input.costUnits };
}

/** Provider cost units reserved per turn before any provider work. */
export function turnProviderCostReservation(): number {
  return AGENT_PROGRAM_RUNTIME_CEILINGS.maxProviderCostUnits;
}

/**
 * Release a fixed reservation and book the actual cost. The amount is not
 * carried per reservation, so a second call for the same turn would decrement
 * a DIFFERENT turn's reservation: callers must settle a turn exactly once
 * (`settleTurnSpendOnceWithCtx` is that guard).
 */
export async function settleTurnSpendWithCtx(
  ctx: MutationCtx,
  input: { actorRef: string; storeId: Id<"store">; windowKey: string; reservedCostUnits: number; actualCostUnits: number; now: number },
): Promise<void> {
  for (const key of [operatorScopeKey(input.actorRef), storeScopeKey(input.storeId)]) {
    const row = await loadSpendWindow(ctx, key, input.windowKey);
    if (!row || row.reservedCostUnits < input.reservedCostUnits) continue;
    await ctx.db.patch("agentSpendWindow", row._id, {
      reservedCostUnits: row.reservedCostUnits - input.reservedCostUnits,
      settledCostUnits: row.settledCostUnits + Math.max(0, input.actualCostUnits),
      updatedAt: input.now,
    });
  }
}

/**
 * Settle one turn's reservation exactly once, whatever ended it.
 *
 * Every admitted turn reserves `turnProviderCostReservation()` before any
 * provider work, so every terminal outcome — completed, failed, canceled,
 * refused before the model ran, swept after its host died — must release it or
 * the operator's daily ceiling erodes. `spendSettledAt` is the once-only guard
 * and is patched in the same mutation as the settle.
 *
 * A binding finalized before `spendSettledAt` existed settled through the
 * provider invocation row and carries no marker, so an already-terminal
 * invocation row this mutation did not itself terminalize means the old path
 * paid out: the marker is stamped and nothing is released. Callers that
 * terminalize that row themselves pass the status they read before doing so.
 */
export async function settleTurnSpendOnceWithCtx(
  ctx: MutationCtx,
  input: {
    bindingId: Id<"agentTurnBinding">;
    actualCostUnits: number;
    now: number;
    invocationStatusBefore?: "started" | "succeeded" | "failed" | null;
  },
): Promise<{ settled: boolean }> {
  const binding = await ctx.db.get("agentTurnBinding", input.bindingId);
  if (!binding || binding.spendSettledAt !== undefined) return { settled: false };
  const run = await ctx.db.get("intelligenceRun", binding.runId);
  const grant = run?.runGrantId ? await ctx.db.get("agentRunGrant", run.runGrantId) : null;
  if (!run || !grant) return { settled: false };
  const invocationStatus =
    input.invocationStatusBefore !== undefined
      ? input.invocationStatusBefore
      : ((await ctx.db.query("intelligenceProviderInvocation").withIndex("by_runId", (q) => q.eq("runId", run._id)).take(1))[0]?.status ?? null);
  if (invocationStatus === "succeeded" || invocationStatus === "failed") {
    await ctx.db.patch("agentTurnBinding", binding._id, { spendSettledAt: input.now, updatedAt: input.now });
    return { settled: false };
  }
  await settleTurnSpendWithCtx(ctx, {
    actorRef: grant.initiatingActorRef,
    storeId: grant.storeId,
    // The reservation was taken against the window of the day the run started.
    windowKey: spendWindowKey(run.createdAt),
    reservedCostUnits: turnProviderCostReservation(),
    actualCostUnits: input.actualCostUnits,
    now: input.now,
  });
  await ctx.db.patch("agentTurnBinding", binding._id, { spendSettledAt: input.now, updatedAt: input.now });
  return { settled: true };
}

// ---------------------------------------------------------------------------
// Turn-start admission
// ---------------------------------------------------------------------------

export type AgentTurnAdmission =
  | { readonly ok: true; readonly spend: { readonly windowKey: string; readonly reservedCostUnits: number } }
  | {
      readonly ok: false;
      readonly code: "active_run_limit" | "thread_busy" | "spend_ceiling";
      readonly message: string;
      readonly retryable: true;
    };

/**
 * Admit a turn start: active-run limit → one active turn per thread → spend
 * reservation. The reservation is the only write and happens last, so a
 * denial leaves nothing behind.
 */
export async function admitTurnStartWithCtx(
  ctx: MutationCtx,
  input: { actorRef: string; storeId: Id<"store">; threadKey: string; maxProviderCostUnits: number; now: number; activeRunLimit?: number },
): Promise<AgentTurnAdmission> {
  const limit = input.activeRunLimit ?? AGENT_OPERATOR_ACTIVE_RUN_LIMIT;
  const active = await countActiveAgentRunsForOperatorWithCtx(ctx, input.actorRef, limit);
  if (active >= limit) {
    return { ok: false, code: "active_run_limit", message: "Athena is still working on an earlier question. Wait for it to finish or cancel it.", retryable: true };
  }
  const busy = await findActiveTurnOnThreadWithCtx(ctx, { storeId: input.storeId, threadKey: input.threadKey });
  if (busy) {
    return { ok: false, code: "thread_busy", message: "Athena is still answering the previous question in this conversation. Wait for it or cancel it first.", retryable: true };
  }
  const spend = await reserveTurnSpendWithCtx(ctx, { actorRef: input.actorRef, storeId: input.storeId, costUnits: input.maxProviderCostUnits, now: input.now });
  if (!spend.ok) return spend;
  return { ok: true, spend: { windowKey: spend.windowKey, reservedCostUnits: spend.reservedCostUnits } };
}
