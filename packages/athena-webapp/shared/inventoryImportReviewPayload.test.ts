import { describe, expect, it } from "vitest";

import {
  buildInventoryImportReviewPayload,
  getInventoryImportReviewPayloadChunkByteLength,
  INVENTORY_IMPORT_REVIEW_PAYLOAD_CHUNK_MAX_BYTES,
  INVENTORY_IMPORT_REVIEW_PAYLOAD_MAX_BYTES,
  INVENTORY_IMPORT_REVIEW_PAYLOAD_MAX_CHUNKS,
  splitInventoryImportReviewRawContent,
} from "./inventoryImportReviewPayload";

describe("inventory import review payload", () => {
  it("splits raw content by UTF-8 bytes without separating surrogate pairs", () => {
    const rawContent =
      "a".repeat(INVENTORY_IMPORT_REVIEW_PAYLOAD_CHUNK_MAX_BYTES - 1) +
      "🧾" +
      "é";

    const chunks = splitInventoryImportReviewRawContent(rawContent);

    expect(chunks.join("")).toBe(rawContent);
    expect(chunks).toHaveLength(2);
    expect(
      chunks.every(
        (chunk) =>
          getInventoryImportReviewPayloadChunkByteLength({
            kind: "raw_content",
            rawContent: chunk,
          }) <= INVENTORY_IMPORT_REVIEW_PAYLOAD_CHUNK_MAX_BYTES,
      ),
    ).toBe(true);
  });

  it("packs decisions by their serialized UTF-8 byte length", () => {
    const rowDecisions = [
      { productName: "é".repeat(70_000), rowNumber: 1 },
      { productName: "🧾".repeat(40_000), rowNumber: 2 },
    ];

    const payload = buildInventoryImportReviewPayload({
      rawContent: "sku,cost\nA,4",
      rowDecisions,
    });

    expect(payload.rowDecisionChunkCount).toBe(2);
    expect(
      payload.chunks.every(
        (chunk) =>
          getInventoryImportReviewPayloadChunkByteLength(chunk) <=
          INVENTORY_IMPORT_REVIEW_PAYLOAD_CHUNK_MAX_BYTES,
      ),
    ).toBe(true);
  });

  it("keeps the independent-lane chunk allowance at the eight MiB boundary", () => {
    const rowDecisions = [0];
    const serializedDecisionBytes = 3;
    const rawContent = "x".repeat(
      INVENTORY_IMPORT_REVIEW_PAYLOAD_MAX_BYTES - serializedDecisionBytes,
    );

    const payload = buildInventoryImportReviewPayload({
      rawContent,
      rowDecisions,
    });

    expect(payload.payloadByteLength).toBe(
      INVENTORY_IMPORT_REVIEW_PAYLOAD_MAX_BYTES,
    );
    expect(payload.chunks).toHaveLength(36);
    expect(INVENTORY_IMPORT_REVIEW_PAYLOAD_MAX_CHUNKS).toBe(36);
    expect(() =>
      buildInventoryImportReviewPayload({
        rawContent: `${rawContent}x`,
        rowDecisions,
      }),
    ).toThrow("aggregate byte limit");
  });
});
