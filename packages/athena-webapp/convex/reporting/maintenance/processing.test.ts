import { describe, expect, it } from "vitest";

import { processBoundedBatch } from "./processing";

describe("bounded reporting processing", () => {
  it("persists a cursor and schedules continuation without duplication", () => {
    const result = processBoundedBatch({
      batchSize: 2,
      cursor: null,
      frozenCutoff: 500,
      rows: [
        { id: "1", recordedAt: 100 },
        { id: "2", recordedAt: 200 },
        { id: "3", recordedAt: 300 },
      ],
      status: "running",
    });

    expect(result.processedRows.map((row) => row.id)).toEqual(["1", "2"]);
    expect(result.nextCursor).toBe("2");
    expect(result.scheduleNext).toBe(true);
  });

  it("stops future batches when paused or cancelled", () => {
    for (const status of ["paused", "cancelled"] as const) {
      expect(
        processBoundedBatch({
          batchSize: 2,
          cursor: "1",
          frozenCutoff: 500,
          rows: [{ id: "2", recordedAt: 200 }],
          status,
        }),
      ).toEqual({ nextCursor: "1", processedRows: [], scheduleNext: false });
    }
  });
});
