import { describe, expect, it, vi } from "vitest";

import type { Id } from "../../../_generated/dataModel";
import {
  listCompletedTransactions,
  listCompletedTransactionsForRange,
} from "./transactionRepository";

describe("transactionRepository", () => {
  it("reads the earliest bounded completed and voided transactions when requested", async () => {
    const eq = vi.fn().mockReturnThis();
    const gte = vi.fn().mockReturnThis();
    const lte = vi.fn().mockReturnThis();
    const take = vi
      .fn()
      .mockResolvedValueOnce([
        { _id: "txn-completed", completedAt: 200, status: "completed" },
      ])
      .mockResolvedValueOnce([
        { _id: "txn-void", completedAt: 100, status: "void" },
      ]);
    const order = vi.fn(() => ({ take }));
    const query = {
      withIndex: vi.fn((_indexName, applyIndex) => {
        applyIndex({ eq, gte, lte });
        return { order };
      }),
    };
    const db = { query: vi.fn(() => query) };

    const result = await listCompletedTransactions(
      { db } as never,
      {
        completedFrom: 50,
        completedTo: 250,
        limit: 2,
        order: "oldestFirst",
        storeId: "store-1" as Id<"store">,
      },
    );

    expect(gte).toHaveBeenCalledTimes(2);
    expect(lte).toHaveBeenCalledTimes(2);
    expect(order).toHaveBeenNthCalledWith(1, "asc");
    expect(order).toHaveBeenNthCalledWith(2, "asc");
    expect(result.map((transaction) => transaction._id)).toEqual([
      "txn-void",
      "txn-completed",
    ]);
  });

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
