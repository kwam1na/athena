import { describe, expect, it, vi } from "vitest";

import type { Id } from "../../../_generated/dataModel";
import { listCompletedTransactionsForRange } from "./transactionRepository";

describe("transactionRepository", () => {
  it("reads every completed transaction in a closed completedAt range", async () => {
    const rows = [
      { _id: "txn-1", completedAt: 100, status: "completed", total: 1000 },
      { _id: "txn-2", completedAt: 200, status: "completed", total: 2000 },
    ];
    const eq = vi.fn().mockReturnThis();
    const gte = vi.fn().mockReturnThis();
    const lte = vi.fn().mockReturnThis();
    const query = {
      [Symbol.asyncIterator]: async function* () {
        yield* rows;
      },
      withIndex: vi.fn((_indexName, applyIndex) => {
        applyIndex({ eq, gte, lte });
        return query;
      }),
    };
    const db = {
      query: vi.fn(() => query),
    };

    const result = await listCompletedTransactionsForRange(
      { db } as never,
      {
        completedFrom: 100,
        completedTo: 200,
        storeId: "store-1" as Id<"store">,
      },
    );

    expect(db.query).toHaveBeenCalledWith("posTransaction");
    expect(query.withIndex).toHaveBeenCalledWith(
      "by_storeId_status_completedAt",
      expect.any(Function),
    );
    expect(eq).toHaveBeenNthCalledWith(1, "storeId", "store-1");
    expect(eq).toHaveBeenNthCalledWith(2, "status", "completed");
    expect(gte).toHaveBeenCalledWith("completedAt", 100);
    expect(lte).toHaveBeenCalledWith("completedAt", 200);
    expect(result).toEqual(rows);
  });
});
