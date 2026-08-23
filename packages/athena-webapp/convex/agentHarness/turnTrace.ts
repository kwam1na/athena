/**
 * Turn-trace rows (kernel leaf; V8-safe).
 *
 * Authority boundary: this module has none. It owns the row helpers for the
 * `agentTurnTraceEvent` table — append, list by binding,
 * delete by expiry, fit one payload under the per-row cap — plus the capture
 * switch. The recording mutation in `turns.ts` is the enforcement point (it
 * reads the switch, stamps the scope from the binding, and re-fits every
 * payload); `retention.ts` calls the delete helpers from its own transactions.
 *
 * The trace is ENGINEER-ONLY. It is the single deliberate exception to "the
 * model's narrative never enters Athena's durable record": it holds the
 * deltas, the exact tool arguments, and the outcome the model received so a
 * turn can be replayed offline while the agent is being refined. Nothing
 * projects it into thread history, a prompt, a citation, or any
 * operator-admitted query, and no public ingress reads the table.
 *
 * It is a LEAF on purpose: it imports only the generated server/data-model
 * types, so every caller above can reach it without an import cycle. The TTL
 * is its own literal — the same value as the standard retention class,
 * deliberately NOT imported from `shared/agentHarness/execution`, which the
 * leaf allowlist forbids.
 */
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

type ReadCtx = QueryCtx | MutationCtx;

/** Standard retention class: 365 days, expressed as this module's own literal. */
export const AGENT_TURN_TRACE_RETENTION_MS = 365 * 24 * 60 * 60 * 1000;

/** Per-row payload ceiling. One tool argument object or one program result, not a dump. */
export const AGENT_TURN_TRACE_EVENT_PAYLOAD_MAX_BYTES = 32 * 1024;

/**
 * Rows one turn may record. A narrated turn emits deltas at token rate; past
 * this bound the host drops further rows and records one `trace_capped` row,
 * so a runaway turn cannot write an unbounded table.
 */
export const AGENT_TURN_TRACE_MAX_EVENTS_PER_TURN = 4_000;

const DEFAULT_EXPIRY_LIMIT = 100;
const MAX_EXPIRY_LIMIT = 200;

export type AgentTurnTraceSource = "adapter" | "host";

export type AgentTurnTraceEventInput = {
  readonly runId: Id<"intelligenceRun">;
  readonly turnBindingId: Id<"agentTurnBinding">;
  readonly storeId: Id<"store">;
  readonly organizationId: Id<"organization">;
  readonly source: AgentTurnTraceSource;
  readonly sequence: number;
  readonly at: number;
  readonly kind: string;
  readonly payload: unknown;
  readonly truncated: boolean;
  readonly replayPayloadId?: Id<"agentReplayPayload">;
  readonly expiresAt: number;
  readonly createdAt: number;
};

/**
 * The capture switch. Reading it here (rather than at the host) keeps the one
 * decision on the Convex side, where the deployment's environment lives:
 * `AGENT_TURN_TRACE=off|0|false` disables capture; anything else, including an
 * unset variable, captures. Capture-by-default is the point — the trace exists
 * so an engineer can ask what the model saw on a turn nobody predicted.
 */
export function isAgentTurnTraceEnabled(): boolean {
  const raw = process.env.AGENT_TURN_TRACE;
  if (raw === undefined) return true;
  const normalized = raw.trim().toLowerCase();
  return normalized !== "off" && normalized !== "0" && normalized !== "false";
}

const encoder = new TextEncoder();

function encodedByteLength(value: unknown): number {
  const json = JSON.stringify(value);
  return json === undefined ? 0 : encoder.encode(json).byteLength;
}

/**
 * Cut a string at the last whole codepoint at or below `maxBytes` (UTF-8),
 * never at a raw byte offset, so a truncated payload stays well-formed JSON
 * rather than carrying a replacement character.
 */
function cutString(text: string, maxBytes: number): string {
  if (maxBytes <= 0) return "";
  if (encoder.encode(text).byteLength <= maxBytes) return text;
  let bytes = 0;
  let cut = 0;
  for (const codepoint of text) {
    const width = encoder.encode(codepoint).byteLength;
    if (bytes + width > maxBytes) break;
    bytes += width;
    cut += codepoint.length;
  }
  return text.slice(0, cut);
}

type StringLeaf = { readonly container: Record<string, unknown> | unknown[]; readonly key: string | number; readonly bytes: number };

function collectStringLeaves(value: unknown, out: StringLeaf[]): void {
  if (Array.isArray(value)) {
    value.forEach((child, index) => {
      if (typeof child === "string") out.push({ container: value, key: index, bytes: encoder.encode(child).byteLength });
      else collectStringLeaves(child, out);
    });
    return;
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      const child = record[key];
      if (typeof child === "string") out.push({ container: record, key, bytes: encoder.encode(child).byteLength });
      else collectStringLeaves(child, out);
    }
  }
}

/**
 * Fit one event payload under the per-row cap.
 *
 * The value is normalized through JSON first, so `undefined`-valued keys and
 * anything Convex cannot store are gone before the row is built. An over-cap
 * value loses its LARGEST string leaves first — the program source, the
 * narrative, the capability result body — because those are what actually
 * overflow, and shrinking them keeps the shape (tool id, call id, outcome
 * kind) an engineer navigates by. A value with no string leaf big enough to
 * absorb the excess degrades to an honest `{ omitted: true, byteLength }`
 * marker rather than a silently half-written row.
 */
export function fitTracePayload(value: unknown, maxBytes: number = AGENT_TURN_TRACE_EVENT_PAYLOAD_MAX_BYTES): { payload: unknown; truncated: boolean } {
  const json = JSON.stringify(value);
  if (json === undefined) return { payload: null, truncated: false };
  const normalized: unknown = JSON.parse(json);
  const originalBytes = encoder.encode(json).byteLength;
  if (originalBytes <= maxBytes) return { payload: normalized, truncated: false };

  if (typeof normalized === "string") {
    // Two bytes of the encoding are the quotes around the string itself.
    return { payload: cutString(normalized, Math.max(0, maxBytes - 2)), truncated: true };
  }

  const leaves: StringLeaf[] = [];
  collectStringLeaves(normalized, leaves);
  leaves.sort((left, right) => right.bytes - left.bytes);
  for (const leaf of leaves) {
    const excess = encodedByteLength(normalized) - maxBytes;
    if (excess <= 0) break;
    const current = (leaf.container as Record<string | number, unknown>)[leaf.key] as string;
    (leaf.container as Record<string | number, unknown>)[leaf.key] = cutString(current, Math.max(0, leaf.bytes - excess));
  }
  if (encodedByteLength(normalized) <= maxBytes) return { payload: normalized, truncated: true };
  return { payload: { omitted: true, byteLength: originalBytes }, truncated: true };
}

/** Append rows exactly as given; the caller has already fitted every payload. Returns the count. */
export async function appendTurnTraceEventsWithCtx(ctx: MutationCtx, rows: readonly AgentTurnTraceEventInput[]): Promise<number> {
  for (const row of rows) {
    await ctx.db.insert("agentTurnTraceEvent", {
      runId: row.runId,
      turnBindingId: row.turnBindingId,
      storeId: row.storeId,
      organizationId: row.organizationId,
      source: row.source,
      sequence: row.sequence,
      at: row.at,
      kind: row.kind,
      payload: row.payload,
      truncated: row.truncated,
      ...(row.replayPayloadId ? { replayPayloadId: row.replayPayloadId } : {}),
      retentionClass: "standard",
      expiresAt: row.expiresAt,
      createdAt: row.createdAt,
    });
  }
  return rows.length;
}

/** One turn's rows in sequence order. Bounded by `limit`. */
export async function listTurnTraceByBindingWithCtx(
  ctx: ReadCtx,
  bindingId: Id<"agentTurnBinding">,
  limit: number,
): Promise<Doc<"agentTurnTraceEvent">[]> {
  return ctx.db
    .query("agentTurnTraceEvent")
    .withIndex("by_turnBindingId_sequence", (q) => q.eq("turnBindingId", bindingId))
    .take(limit);
}

/**
 * One page of a turn's rows in sequence order, for the internal investigation
 * query. Paginated rather than `take`-bounded: a narrated turn can hold
 * thousands of rows and an engineer reads them all.
 */
export async function pageTurnTraceByBindingWithCtx(
  ctx: ReadCtx,
  bindingId: Id<"agentTurnBinding">,
  options: { cursor: string | null; numItems: number },
) {
  return ctx.db
    .query("agentTurnTraceEvent")
    .withIndex("by_turnBindingId_sequence", (q) => q.eq("turnBindingId", bindingId))
    .paginate({ numItems: options.numItems, cursor: options.cursor });
}

/**
 * Pure delete over the expiry index: the standard-class sweep's phase for the
 * trace. Bounded; `hasMore` asks the caller to schedule another pass.
 */
export async function deleteExpiredTurnTraceWithCtx(
  ctx: MutationCtx,
  input: { now: number; limit?: number },
): Promise<{ deleted: number; hasMore: boolean }> {
  const limit = Math.min(MAX_EXPIRY_LIMIT, Math.max(1, input.limit ?? DEFAULT_EXPIRY_LIMIT));
  const rows = await ctx.db
    .query("agentTurnTraceEvent")
    .withIndex("by_expiresAt", (q) => q.lte("expiresAt", input.now))
    .take(limit);
  for (const row of rows) await ctx.db.delete("agentTurnTraceEvent", row._id);
  return { deleted: rows.length, hasMore: rows.length === limit };
}
