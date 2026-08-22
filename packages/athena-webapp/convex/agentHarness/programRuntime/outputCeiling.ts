/**
 * 240 KiB encoded call-output ceiling.
 *
 * A capability call whose sanitized output would cross the persisted-record
 * ceiling stops at its declared collection boundary and returns typed
 * truncation *before* anything is written. Sizes are UTF-8 encoded bytes of the
 * JSON form (what Convex stores), never UTF-16 code units, so multibyte text is
 * measured honestly and no item is ever split. v1 does not chunk evidence.
 */

export const AGENT_CALL_OUTPUT_TRUNCATION_REASON = "evidence_payload_exceeds_ceiling" as const;

export type AgentCallOutputTruncation = {
  readonly reason: typeof AGENT_CALL_OUTPUT_TRUNCATION_REASON;
  readonly boundary: "collection_item" | "none";
  readonly keptItems: number;
  readonly droppedItems: number;
};

export type AgentCallOutputFit =
  | { readonly kind: "fits"; readonly output: unknown; readonly encodedBytes: number }
  | {
      readonly kind: "truncated";
      readonly output: unknown;
      readonly encodedBytes: number;
      readonly keptItems: number;
      readonly droppedItems: number;
      readonly truncation: AgentCallOutputTruncation;
    }
  | { readonly kind: "rejected"; readonly encodedBytes: number; readonly truncation: AgentCallOutputTruncation };

/** UTF-8 byte length without allocating an encoded copy. */
export function measureUtf8Bytes(text: string): number {
  let bytes = 0;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      // Surrogate pair: one 4-byte code point; skip the low surrogate.
      bytes += 4;
      index += 1;
    } else bytes += 3;
  }
  return bytes;
}

export function measureEncodedBytes(value: unknown): number {
  return measureUtf8Bytes(JSON.stringify(value) ?? "");
}

function readCollection(output: unknown, path: string): unknown[] | undefined {
  const segments = path.split(".");
  let cursor: unknown = output;
  for (const segment of segments) {
    if (typeof cursor !== "object" || cursor === null) return undefined;
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return Array.isArray(cursor) ? cursor : undefined;
}

function withCollection(output: unknown, path: string, items: unknown[]): unknown {
  const segments = path.split(".");
  const clone = (node: unknown, depth: number): unknown => {
    if (depth === segments.length) return items;
    const record = node as Record<string, unknown>;
    return { ...record, [segments[depth]]: clone(record[segments[depth]], depth + 1) };
  };
  return clone(output, 0);
}

export type FitEncodedCallOutputInput = {
  readonly output: unknown;
  /** Dot path to the collection that may be cut at an item boundary (e.g. `items`). */
  readonly collectionPath?: string;
  readonly ceilingBytes: number;
  /** Bytes reserved for validators, index fields, and evidence metadata on the persisted record. */
  readonly metadataHeadroomBytes: number;
};

export function fitEncodedCallOutput(input: FitEncodedCallOutputInput): AgentCallOutputFit {
  const budget = input.ceilingBytes - input.metadataHeadroomBytes;
  const encodedBytes = measureEncodedBytes(input.output);
  if (encodedBytes <= budget) return { kind: "fits", output: input.output, encodedBytes };

  const items = input.collectionPath ? readCollection(input.output, input.collectionPath) : undefined;
  if (!items || !input.collectionPath) {
    return {
      kind: "rejected",
      encodedBytes,
      truncation: { reason: AGENT_CALL_OUTPUT_TRUNCATION_REASON, boundary: "none", keptItems: 0, droppedItems: 0 },
    };
  }

  // Encoded size is monotonic in the kept prefix, so binary search the largest fit.
  const path = input.collectionPath;
  const sizeOf = (count: number) => measureEncodedBytes(withCollection(input.output, path, items.slice(0, count)));
  let low = 0;
  let high = items.length - 1;
  let best = 0;
  let bestBytes = sizeOf(0);
  if (bestBytes > budget) {
    return {
      kind: "rejected",
      encodedBytes,
      truncation: { reason: AGENT_CALL_OUTPUT_TRUNCATION_REASON, boundary: "none", keptItems: 0, droppedItems: items.length },
    };
  }
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const bytes = sizeOf(mid);
    if (bytes <= budget) {
      best = mid;
      bestBytes = bytes;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  const kept = items.slice(0, best);
  return {
    kind: "truncated",
    output: withCollection(input.output, path, kept),
    encodedBytes: bestBytes,
    keptItems: best,
    droppedItems: items.length - best,
    truncation: {
      reason: AGENT_CALL_OUTPUT_TRUNCATION_REASON,
      boundary: "collection_item",
      keptItems: best,
      droppedItems: items.length - best,
    },
  };
}
