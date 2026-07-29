export const INVENTORY_IMPORT_REVIEW_PAYLOAD_CHUNK_MAX_BYTES = 240 * 1024;
export const INVENTORY_IMPORT_REVIEW_PAYLOAD_MAX_BYTES = 8 * 1024 * 1024;

// Raw content and decisions are packed independently, so an aggregate payload
// can require one partially filled chunk in each lane.
export const INVENTORY_IMPORT_REVIEW_PAYLOAD_MAX_CHUNKS =
  Math.ceil(
    INVENTORY_IMPORT_REVIEW_PAYLOAD_MAX_BYTES /
      INVENTORY_IMPORT_REVIEW_PAYLOAD_CHUNK_MAX_BYTES,
  ) + 1;

export type InventoryImportReviewPayloadChunk<Decision> =
  | {
      kind: "raw_content";
      rawContent: string;
    }
  | {
      kind: "row_decisions";
      rowDecisions: Decision[];
    };

const encoder = new TextEncoder();

export function getUtf8ByteLength(value: string) {
  return encoder.encode(value).byteLength;
}

export function getInventoryImportReviewPayloadChunkByteLength<Decision>(
  chunk: InventoryImportReviewPayloadChunk<Decision>,
) {
  return getUtf8ByteLength(
    chunk.kind === "raw_content"
      ? chunk.rawContent
      : JSON.stringify(chunk.rowDecisions),
  );
}

export function splitInventoryImportReviewRawContent(value: string) {
  const chunks: string[] = [];
  let start = 0;

  while (start < value.length) {
    let low = start + 1;
    let high = Math.min(
      value.length,
      start + INVENTORY_IMPORT_REVIEW_PAYLOAD_CHUNK_MAX_BYTES,
    );
    let end = start;

    while (low <= high) {
      const midpoint = low + Math.floor((high - low) / 2);
      let candidate = midpoint;
      if (
        candidate < value.length &&
        candidate > start &&
        isHighSurrogate(value.charCodeAt(candidate - 1))
      ) {
        candidate -= 1;
      }
      if (candidate <= start) {
        low = midpoint + 1;
        continue;
      }
      if (
        getUtf8ByteLength(value.slice(start, candidate)) <=
        INVENTORY_IMPORT_REVIEW_PAYLOAD_CHUNK_MAX_BYTES
      ) {
        end = candidate;
        low = midpoint + 1;
      } else {
        high = midpoint - 1;
      }
    }

    if (end <= start) {
      throw new RangeError("Review payload item exceeds the chunk byte limit.");
    }
    chunks.push(value.slice(start, end));
    start = end;
  }

  return chunks;
}

export function splitInventoryImportReviewRowDecisions<Decision>(
  decisions: Decision[],
) {
  const chunks: Decision[][] = [];
  let chunk: Decision[] = [];
  let chunkByteLength = 2;

  for (const decision of decisions) {
    const decisionByteLength = getUtf8ByteLength(JSON.stringify(decision));
    if (
      decisionByteLength + 2 >
      INVENTORY_IMPORT_REVIEW_PAYLOAD_CHUNK_MAX_BYTES
    ) {
      throw new RangeError("Review payload item exceeds the chunk byte limit.");
    }

    const separatorByteLength = chunk.length === 0 ? 0 : 1;
    if (
      chunkByteLength + separatorByteLength + decisionByteLength >
      INVENTORY_IMPORT_REVIEW_PAYLOAD_CHUNK_MAX_BYTES
    ) {
      chunks.push(chunk);
      chunk = [];
      chunkByteLength = 2;
    }

    chunk.push(decision);
    chunkByteLength += (chunk.length === 1 ? 0 : 1) + decisionByteLength;
  }

  if (chunk.length > 0) chunks.push(chunk);
  return chunks;
}

export function buildInventoryImportReviewPayload<Decision>(args: {
  rawContent: string;
  rowDecisions: Decision[];
}) {
  const rawContentChunks = splitInventoryImportReviewRawContent(args.rawContent);
  const rowDecisionChunks = splitInventoryImportReviewRowDecisions(
    args.rowDecisions,
  );
  const chunks: InventoryImportReviewPayloadChunk<Decision>[] = [
    ...rawContentChunks.map((rawContent) => ({
      kind: "raw_content" as const,
      rawContent,
    })),
    ...rowDecisionChunks.map((rowDecisions) => ({
      kind: "row_decisions" as const,
      rowDecisions,
    })),
  ];
  const payloadByteLength = chunks.reduce(
    (total, chunk) =>
      total + getInventoryImportReviewPayloadChunkByteLength(chunk),
    0,
  );

  if (
    payloadByteLength > INVENTORY_IMPORT_REVIEW_PAYLOAD_MAX_BYTES ||
    chunks.length > INVENTORY_IMPORT_REVIEW_PAYLOAD_MAX_CHUNKS
  ) {
    throw new RangeError("Review payload exceeds the aggregate byte limit.");
  }

  return {
    chunks,
    payloadByteLength,
    rawContentChunkCount: rawContentChunks.length,
    rowDecisionChunkCount: rowDecisionChunks.length,
  };
}

function isHighSurrogate(value: number) {
  return value >= 0xd800 && value <= 0xdbff;
}
