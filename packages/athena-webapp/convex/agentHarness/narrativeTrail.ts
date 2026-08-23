/**
 * Narrative-trail rows (kernel leaf; V8-safe).
 *
 * Authority boundary: this module has none. It owns the row helpers for the
 * `agentTurnNarrativeTrail` table — write once per binding, load by binding,
 * delete by expiry, fit one turn's drafts under the total
 * cap — and nothing else. `turns.ts` is the enforcement point: it decides that
 * a turn committed, stamps the answer's egress class, and applies the read
 * ladder; `retention.ts` calls the delete helpers from its own transactions.
 *
 * The trail is the OPERATOR-READABLE record of a committed turn's finished
 * drafts. It is released and withdrawn with the answer — the same ownership,
 * authority, suppression, and egress gate — so a reload keeps the drafts the
 * operator already watched, and an earlier turn in the thread can show them
 * again. It is never projected into thread history, a prompt, or a citation:
 * the committed answer stays the only checked text, and the engineer-only turn
 * trace stays the full record.
 *
 * It is a LEAF on purpose: it imports only the generated server/data-model
 * types, so `turns.ts` and `retention.ts` can both reach it without an import
 * cycle. The retention bound is its own literal — the same value as the
 * standard retention class, deliberately NOT imported from
 * `shared/agentHarness/execution`, which the leaf allowlist forbids.
 */
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

type ReadCtx = QueryCtx | MutationCtx;

/** Standard retention class: 365 days, expressed as this module's own literal. */
export const AGENT_TURN_NARRATIVE_TRAIL_RETENTION_MS = 365 * 24 * 60 * 60 * 1000;

/**
 * Total ceiling for one turn's drafts. A narrated turn has a handful of
 * drafts, each already bounded at the per-draft display cap; this is the
 * durable row's own bound, applied across all of them at once.
 */
export const AGENT_TURN_NARRATIVE_TRAIL_MAX_BYTES = 96 * 1024;

const DEFAULT_EXPIRY_LIMIT = 100;
const MAX_EXPIRY_LIMIT = 200;

export type AgentTurnNarrativeTrailEntry = {
  readonly draftOrdinal: number;
  readonly text: string;
  readonly truncated: boolean;
};

export type AgentTurnNarrativeTrailInput = {
  readonly runId: Id<"intelligenceRun">;
  readonly turnBindingId: Id<"agentTurnBinding">;
  readonly storeId: Id<"store">;
  readonly organizationId: Id<"organization">;
  readonly entries: readonly AgentTurnNarrativeTrailEntry[];
  /** The committed answer's class, so the trail can never outrank the answer it accompanies. */
  readonly egressClass: string;
  readonly committedAt: number;
  readonly now: number;
};

export type AgentTurnNarrativeTrailWrite =
  | { readonly outcome: "inserted" | "already_present"; readonly id: Id<"agentTurnNarrativeTrail"> }
  | { readonly outcome: "empty" };

const encoder = new TextEncoder();

function byteLengthOf(text: string): number {
  return encoder.encode(text).byteLength;
}

/**
 * Cut text at the last whole codepoint at or below `maxBytes` (UTF-8), never
 * at a raw byte offset, so a stored draft stays well-formed for the renderer's
 * whole-buffer re-parse. Exactly on the cap is not a truncation.
 */
function cutString(text: string, maxBytes: number): string {
  if (maxBytes <= 0) return "";
  if (byteLengthOf(text) <= maxBytes) return text;
  let bytes = 0;
  let cut = 0;
  for (const codepoint of text) {
    const width = byteLengthOf(codepoint);
    if (bytes + width > maxBytes) break;
    bytes += width;
    cut += codepoint.length;
  }
  return text.slice(0, cut);
}

/**
 * Fit one turn's drafts under the row's total cap.
 *
 * It NEVER drops an entry: the trail's whole point is that the operator can
 * see how many drafts there were and in what order, so a missing ordinal would
 * be a worse lie than a shortened one. Over the cap, every entry is cut to one
 * common byte ceiling — the highest ceiling the whole trail still fits under —
 * so the loss lands on the LARGEST drafts and a single runaway draft cannot
 * silently erase its short neighbours. Cuts fall on whole codepoints, and only
 * an entry that actually lost text is flagged; an entry the caller already
 * marked `truncated` keeps that flag.
 */
export function fitNarrativeTrail(
  entries: readonly AgentTurnNarrativeTrailEntry[],
  options: { maxBytes?: number } = {},
): { entries: AgentTurnNarrativeTrailEntry[]; byteLength: number } {
  const maxBytes = Math.max(0, options.maxBytes ?? AGENT_TURN_NARRATIVE_TRAIL_MAX_BYTES);
  const working = entries.map((entry) => ({ draftOrdinal: entry.draftOrdinal, text: entry.text, truncated: entry.truncated === true }));
  const sizes = working.map((entry) => byteLengthOf(entry.text));
  const total = sizes.reduce((sum, bytes) => sum + bytes, 0);
  if (total <= maxBytes) return { entries: working, byteLength: total };

  // The highest per-entry ceiling the whole trail still fits under.
  const under = (ceiling: number) => sizes.reduce((sum, bytes) => sum + Math.min(bytes, ceiling), 0);
  let low = 0;
  let high = sizes.reduce((widest, bytes) => Math.max(widest, bytes), 0);
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (under(middle) <= maxBytes) low = middle;
    else high = middle - 1;
  }

  let byteLength = 0;
  working.forEach((entry, index) => {
    if (sizes[index] > low) {
      entry.text = cutString(entry.text, low);
      entry.truncated = true;
    }
    byteLength += byteLengthOf(entry.text);
  });
  return { entries: working, byteLength };
}

export async function loadTurnNarrativeTrailByBindingWithCtx(
  ctx: ReadCtx,
  bindingId: Id<"agentTurnBinding">,
): Promise<Doc<"agentTurnNarrativeTrail"> | null> {
  return ctx.db
    .query("agentTurnNarrativeTrail")
    .withIndex("by_turnBindingId", (q) => q.eq("turnBindingId", bindingId))
    .first();
}

/**
 * Write one binding's trail. Insert-once: a re-finalize of the same turn (a
 * retried host, a commit-then-failure path that finalizes twice) finds the row
 * and leaves the record exactly as it was first committed. An empty trail
 * writes nothing — a turn that never narrated has no drafts to keep.
 */
export async function writeTurnNarrativeTrailWithCtx(
  ctx: MutationCtx,
  input: AgentTurnNarrativeTrailInput,
): Promise<AgentTurnNarrativeTrailWrite> {
  if (input.entries.length === 0) return { outcome: "empty" };
  const existing = await loadTurnNarrativeTrailByBindingWithCtx(ctx, input.turnBindingId);
  if (existing) return { outcome: "already_present", id: existing._id };
  const fitted = fitNarrativeTrail(input.entries);
  const id = await ctx.db.insert("agentTurnNarrativeTrail", {
    runId: input.runId,
    turnBindingId: input.turnBindingId,
    storeId: input.storeId,
    organizationId: input.organizationId,
    entries: fitted.entries,
    byteLength: fitted.byteLength,
    egressClass: input.egressClass,
    retentionClass: "standard",
    expiresAt: input.now + AGENT_TURN_NARRATIVE_TRAIL_RETENTION_MS,
    committedAt: input.committedAt,
    createdAt: input.now,
  });
  return { outcome: "inserted", id };
}

/**
 * Pure delete over the expiry index: the standard-class sweep's phase for the
 * trail. Bounded; `hasMore` asks the caller to schedule another pass.
 */
export async function deleteExpiredTurnNarrativeTrailWithCtx(
  ctx: MutationCtx,
  input: { now: number; limit?: number },
): Promise<{ deleted: number; hasMore: boolean }> {
  const limit = Math.min(MAX_EXPIRY_LIMIT, Math.max(1, input.limit ?? DEFAULT_EXPIRY_LIMIT));
  const rows = await ctx.db
    .query("agentTurnNarrativeTrail")
    .withIndex("by_expiresAt", (q) => q.lte("expiresAt", input.now))
    .take(limit);
  for (const row of rows) await ctx.db.delete("agentTurnNarrativeTrail", row._id);
  return { deleted: rows.length, hasMore: rows.length === limit };
}
