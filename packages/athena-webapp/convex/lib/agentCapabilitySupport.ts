/**
 * Server-side support for domain-owned agent read ports (V26-1267).
 *
 * Authority boundary this file enforces:
 *
 * - **Opaque resource references.** A program never sees a Convex document id.
 *   `mintAgentResourceRef` produces `resource:<kind>.<masked>.<digest>` where the
 *   masked half is the document id XOR a keystream derived from the STORE the
 *   ref belongs to, and the digest binds the ref to `(kind, storeId, id)`. A
 *   program that guesses, mutates, or replays another store's ref fails the
 *   digest check and the port answers `unavailable` — never a row. The program
 *   never learns the store id, so it can neither unmask nor forge a token.
 * - **Operating-day boundaries are server-derived.** A filter carries only an
 *   operating date (`YYYY-MM-DD`); this module turns it into an instant window
 *   through `storeTime`'s schedule authority, which owns DST. When a store has
 *   no schedule version governing that date, the window falls back to the
 *   UTC-midnight day the Daily Operations surface already uses, and the caller
 *   is told so explicitly (`derivation: "utc_fallback"`) so the answer can
 *   report reduced authority instead of quietly guessing.
 * - **Cursors** are opaque continuation strings owned by the port; the kernel
 *   wraps them in a run/port-bound opaque cursor ref before a program sees one.
 */
import type { Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { sha256Hex } from "../../shared/agentHarness/digest";
import {
  isOperatingDate,
  opaqueRef,
  parseOpaqueRef,
  type MoneyValue,
  type OpaqueRef,
  type QuantityValue,
} from "../../shared/agentHarness/values";
import { resolveReportingOperatingDateRangeWithCtx } from "../storeTime/operatingPeriods";

const REF_VERSION = "r1";
const DAY_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Opaque resource references
// ---------------------------------------------------------------------------

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Store-scoped keystream. Long enough for any Convex id (32 chars); derived
 * from the store id, which never leaves the server, so the masked half of a ref
 * is not reversible by anything that only holds the ref.
 */
function keystream(kind: string, scopeToken: string, length: number): Uint8Array {
  const out = new Uint8Array(length);
  let produced = 0;
  let counter = 0;
  while (produced < length) {
    const block = hexToBytes(sha256Hex(`${REF_VERSION}|mask|${kind}|${scopeToken}|${counter}`));
    const take = Math.min(block.length, length - produced);
    out.set(block.subarray(0, take), produced);
    produced += take;
    counter += 1;
  }
  return out;
}

function bindingDigest(kind: string, scopeToken: string, identity: string): string {
  return sha256Hex(`${REF_VERSION}|bind|${kind}|${scopeToken}|${identity}`).slice(0, 24);
}

/**
 * Mint an opaque, store-bound reference to one domain row.
 *
 * `kind` separates ref families (a session ref can never resolve as a SKU ref),
 * `scopeId` is the store the ref is only ever valid inside, and `identity` is
 * the raw document id, which is masked rather than encoded.
 */
export function mintAgentResourceRef(
  kind: string,
  scopeId: string,
  identity: string,
): OpaqueRef<"resource"> {
  const bytes = new TextEncoder().encode(identity);
  const mask = keystream(kind, scopeId, bytes.length);
  const masked = new Uint8Array(bytes.length);
  for (let index = 0; index < bytes.length; index += 1) masked[index] = bytes[index] ^ mask[index];
  return opaqueRef(
    "resource",
    `${kind}.${toHex(masked)}.${bindingDigest(kind, scopeId, identity)}`,
  );
}

/**
 * Resolve a reference back to its document id, or `null` for anything that was
 * not minted for this kind and this store. Fails closed on every malformed,
 * guessed, cross-kind, cross-store, or tampered token.
 */
export function resolveAgentResourceRef(
  kind: string,
  scopeId: string,
  ref: unknown,
): string | null {
  if (typeof ref !== "string") return null;
  const parsed = parseOpaqueRef(ref);
  if (!parsed || parsed.kind !== "resource") return null;
  const parts = parsed.token.split(".");
  if (parts.length !== 3 || parts[0] !== kind) return null;
  const [, maskedHex, digest] = parts;
  if (maskedHex.length === 0 || maskedHex.length % 2 !== 0 || !/^[0-9a-f]+$/.test(maskedHex)) return null;
  const masked = hexToBytes(maskedHex);
  const mask = keystream(kind, scopeId, masked.length);
  const bytes = new Uint8Array(masked.length);
  for (let index = 0; index < masked.length; index += 1) bytes[index] = masked[index] ^ mask[index];
  let identity: string;
  try {
    identity = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
  if (bindingDigest(kind, scopeId, identity) !== digest) return null;
  return identity;
}

/**
 * Opaque source reference for a citation. Source refs are provenance, never
 * lookup keys, so the token is a one-way digest of the subject plus whatever
 * label the domain wants to keep readable in audit (`kind` only).
 */
export function mintAgentSourceRef(
  kind: string,
  scopeId: string,
  subject: string,
): OpaqueRef<"source"> {
  return opaqueRef("source", `${kind}.${sha256Hex(`${REF_VERSION}|src|${kind}|${scopeId}|${subject}`).slice(0, 32)}`);
}

// ---------------------------------------------------------------------------
// Operating-day windows (server-owned, DST-aware)
// ---------------------------------------------------------------------------

export type AgentOperatingWindow = {
  readonly operatingDate: string;
  readonly startAt: number;
  readonly endAt: number;
  /** `schedule` = a store schedule version governed this date; `utc_fallback` = none did. */
  readonly derivation: "schedule" | "utc_fallback";
  readonly timezone?: string;
  readonly scheduleVersion?: string;
};

/** UTC-midnight day — the window the Daily Operations surface uses when a store has no schedule. */
export function utcOperatingWindow(operatingDate: string): { startAt: number; endAt: number } {
  const startAt = Date.parse(`${operatingDate}T00:00:00.000Z`);
  if (!Number.isFinite(startAt)) return { startAt: 0, endAt: 0 };
  return { startAt, endAt: startAt + DAY_MS };
}

/**
 * Resolve the instant window for one operating date. This is the ONLY way a
 * port turns an agent-supplied date into a time range: the schema rejects
 * timestamps, offsets, and windows, and this function refuses a date that is
 * not `YYYY-MM-DD` outright.
 */
export async function resolveAgentOperatingWindowWithCtx(
  ctx: Pick<QueryCtx, "db">,
  args: { operatingDate: string; storeId: Id<"store"> },
): Promise<AgentOperatingWindow | null> {
  if (!isOperatingDate(args.operatingDate)) return null;
  const range = await resolveReportingOperatingDateRangeWithCtx(ctx, {
    operatingDate: args.operatingDate,
    storeId: args.storeId,
  });
  if (range.kind === "resolved") {
    return {
      operatingDate: args.operatingDate,
      startAt: range.startAt,
      endAt: range.endAt,
      derivation: "schedule",
      timezone: range.timezone,
      scheduleVersion: String(range.scheduleVersionId),
    };
  }
  const fallback = utcOperatingWindow(args.operatingDate);
  if (fallback.endAt === 0) return null;
  return { operatingDate: args.operatingDate, ...fallback, derivation: "utc_fallback" };
}

/** Shift an operating date by whole days without touching a wall clock. */
export function shiftOperatingDate(operatingDate: string, offsetDays: number): string {
  return new Date(Date.parse(`${operatingDate}T12:00:00.000Z`) + offsetDays * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

// ---------------------------------------------------------------------------
// Canonical values
// ---------------------------------------------------------------------------

export function money(amount: number, currency: string): MoneyValue {
  return { amount: Math.round(amount), currency };
}

export function units(value: number): QuantityValue {
  return { value, unit: "unit" };
}

// ---------------------------------------------------------------------------
// Port-owned continuation cursors
// ---------------------------------------------------------------------------

/**
 * Ports page over a fixed ordering with a plain offset. The kernel wraps this
 * string in a run/port-bound opaque cursor, so the value here never has to
 * defend itself against a hostile caller — but it is still validated, because
 * a corrupt cursor must page nothing rather than page everything.
 */
export function encodeOffsetCursor(offset: number): string {
  return `o${offset}`;
}

export function decodeOffsetCursor(cursor: string | undefined): number {
  if (cursor === undefined) return 0;
  if (!/^o\d+$/.test(cursor)) return -1;
  const offset = Number.parseInt(cursor.slice(1), 10);
  return Number.isSafeInteger(offset) && offset >= 0 ? offset : -1;
}

/** One page of an in-memory ordering plus the continuation the kernel will mint. */
export function pageOf<T>(
  rows: readonly T[],
  offset: number,
  pageSize: number,
): { items: T[]; hasMore: boolean; rawCursor: string | null } {
  const items = rows.slice(offset, offset + pageSize);
  const hasMore = rows.length > offset + pageSize;
  return { items, hasMore, rawCursor: hasMore ? encodeOffsetCursor(offset + pageSize) : null };
}
