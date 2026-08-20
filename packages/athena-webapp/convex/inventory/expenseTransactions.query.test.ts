import { describe, expect, it, vi } from "vitest";

vi.mock("../platform/operationAdmission", () => ({
  admitPublicMutation: (_definition: unknown, handler: unknown) => handler,
  admitPublicQuery: (_definition: unknown, handler: unknown) => handler,
}));

import { getExpenseTransactions } from "./expenseTransactions";

describe("getExpenseTransactions", () => {
  it("keeps status-filtered history scoped to the authorized store", async () => {
    const rows = [
      {
        _id: "expense-a",
        _creationTime: 2,
        completedAt: 200,
        sessionId: "session-a",
        staffProfileId: "staff-a",
        status: "completed",
        storeId: "store-a",
        totalValue: 100,
        transactionNumber: "EXP-A",
      },
      {
        _id: "expense-b",
        _creationTime: 1,
        completedAt: 100,
        sessionId: "session-b",
        staffProfileId: "staff-b",
        status: "completed",
        storeId: "store-b",
        totalValue: 200,
        transactionNumber: "EXP-B",
      },
    ];
    const usedIndexes: string[] = [];
    const ctx = {
      db: {
        get: vi.fn(async () => null),
        query: vi.fn((tableName: string) => ({
          withIndex: (
            indexName: string,
            apply: (builder: {
              eq: (field: string, value: unknown) => unknown;
            }) => void,
          ) => {
            usedIndexes.push(indexName);
            const filters: Array<[string, unknown]> = [];
            const builder = {
              eq(field: string, value: unknown) {
                filters.push([field, value]);
                return builder;
              },
            };
            apply(builder);
            const matches =
              tableName === "expenseTransaction"
                ? rows.filter((row) =>
                    filters.every(
                      ([field, value]) =>
                        row[field as keyof typeof row] === value,
                    ),
                  )
                : [];
            return {
              collect: async () => [],
              order: () => ({
                take: async (limit: number) => matches.slice(0, limit),
              }),
            };
          },
        })),
      },
    };

    const handler = (
      getExpenseTransactions as unknown as {
        _handler: (
          ctx: unknown,
          args: Record<string, unknown>,
        ) => Promise<Array<{ storeId: string }>>;
      }
    )._handler;
    const result = await handler(ctx, {
      limit: 50,
      status: "completed",
      storeId: "store-a",
    });

    expect(usedIndexes).toContain("by_storeId_status_completedAt");
    expect(result.map((transaction) => transaction.storeId)).toEqual([
      "store-a",
    ]);
  });
});
