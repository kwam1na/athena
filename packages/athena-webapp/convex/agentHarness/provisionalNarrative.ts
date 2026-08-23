/**
 * Provisional narrative rows (kernel leaf; V8-safe).
 *
 * Authority boundary: this module has none. It owns the row helpers for the
 * `agentProvisionalNarrative` table — overwrite, delete by binding, delete by
 * expiry, cut at the text cap — and nothing else. The flush in `turns.ts` is
 * the enforcement point (policy, reauthorization, egress rank, insert guard);
 * `lifecycle.ts`, `completionOutbox.ts`, `retention.ts`, and `turns.ts` call
 * the delete helpers from their own transactions on every terminal cause.
 *
 * It is a LEAF on purpose: it imports only the generated server/data-model
 * types, so every caller above can reach it without an import cycle (the
 * five call sites span the whole kernel). The TTL is its own literal — the
 * same value as the step-staleness window, deliberately NOT imported from
 * `turnBindings.ts`, which would close a cycle through `lifecycle.ts`.
 */
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

type ReadCtx = QueryCtx | MutationCtx;

/** Exposure bound of a provisional row: refreshed by every flush; past it the preview refuses and the repair sweep deletes. */
export const AGENT_PROVISIONAL_NARRATIVE_TTL_MS = 5 * 60 * 1000;

const DEFAULT_EXPIRY_LIMIT = 100;
const MAX_EXPIRY_LIMIT = 200;
/** A binding holds at most one row; a small bound makes any duplicate visible and deletable. */
const ROWS_PER_BINDING_BOUND = 4;

export type AgentProvisionalNarrativeInput = {
  readonly runId: Id<"intelligenceRun">;
  readonly turnBindingId: Id<"agentTurnBinding">;
  readonly storeId: Id<"store">;
  readonly organizationId: Id<"organization">;
  readonly text: string;
  readonly draftOrdinal: number;
  readonly truncated: boolean;
  /** Stamped once on insert from the turn's provider-invocation row; an update never re-stamps it. */
  readonly egressClass: string;
  readonly updatedAt: number;
  readonly expiresAt: number;
};

/**
 * Cut text at the last whole codepoint at or below `maxBytes` (UTF-8), never
 * at a raw byte offset, so the stored text stays well-formed for the
 * renderer's whole-buffer re-parse. Exactly on the cap is not a truncation.
 */
export function fitProvisionalNarrative(text: string, maxBytes: number): { text: string; truncated: boolean } {
  const encoder = new TextEncoder();
  if (encoder.encode(text).byteLength <= maxBytes) return { text, truncated: false };
  let bytes = 0;
  let cut = 0;
  for (const codepoint of text) {
    const width = encoder.encode(codepoint).byteLength;
    if (bytes + width > maxBytes) break;
    bytes += width;
    cut += codepoint.length;
  }
  return { text: text.slice(0, cut), truncated: true };
}

export async function loadProvisionalNarrativeByBindingWithCtx(
  ctx: ReadCtx,
  bindingId: Id<"agentTurnBinding">,
): Promise<Doc<"agentProvisionalNarrative"> | null> {
  return ctx.db
    .query("agentProvisionalNarrative")
    .withIndex("by_turnBindingId", (q) => q.eq("turnBindingId", bindingId))
    .first();
}

/** Full overwrite of the binding's one row; inserts it when absent. */
export async function upsertProvisionalNarrativeWithCtx(
  ctx: MutationCtx,
  input: AgentProvisionalNarrativeInput,
): Promise<{ outcome: "inserted" | "updated"; id: Id<"agentProvisionalNarrative"> }> {
  const existing = await loadProvisionalNarrativeByBindingWithCtx(ctx, input.turnBindingId);
  if (existing) {
    await ctx.db.patch("agentProvisionalNarrative", existing._id, {
      text: input.text,
      draftOrdinal: input.draftOrdinal,
      truncated: input.truncated,
      updatedAt: input.updatedAt,
      expiresAt: input.expiresAt,
    });
    return { outcome: "updated", id: existing._id };
  }
  const id = await ctx.db.insert("agentProvisionalNarrative", {
    runId: input.runId,
    turnBindingId: input.turnBindingId,
    storeId: input.storeId,
    organizationId: input.organizationId,
    text: input.text,
    draftOrdinal: input.draftOrdinal,
    truncated: input.truncated,
    egressClass: input.egressClass,
    retentionClass: "short_lived",
    updatedAt: input.updatedAt,
    expiresAt: input.expiresAt,
  });
  return { outcome: "inserted", id };
}

/** Delete every row of one binding (at most one exists); returns the count. Idempotent. */
export async function deleteProvisionalNarrativeByBindingWithCtx(ctx: MutationCtx, bindingId: Id<"agentTurnBinding">): Promise<number> {
  const rows = await ctx.db
    .query("agentProvisionalNarrative")
    .withIndex("by_turnBindingId", (q) => q.eq("turnBindingId", bindingId))
    .take(ROWS_PER_BINDING_BOUND);
  for (const row of rows) await ctx.db.delete("agentProvisionalNarrative", row._id);
  return rows.length;
}

/**
 * Pure delete over the expiry index: a row at or past `expiresAt` belongs to
 * a host that stopped flushing (dead host, or a turn that stalled past the
 * TTL). Bounded; `hasMore` asks the caller to schedule another pass.
 */
export async function deleteExpiredProvisionalNarrativesWithCtx(
  ctx: MutationCtx,
  input: { now: number; limit?: number },
): Promise<{ deleted: number; hasMore: boolean }> {
  const limit = Math.min(MAX_EXPIRY_LIMIT, Math.max(1, input.limit ?? DEFAULT_EXPIRY_LIMIT));
  const rows = await ctx.db
    .query("agentProvisionalNarrative")
    .withIndex("by_expiresAt", (q) => q.lte("expiresAt", input.now))
    .take(limit);
  for (const row of rows) await ctx.db.delete("agentProvisionalNarrative", row._id);
  return { deleted: rows.length, hasMore: rows.length === limit };
}
