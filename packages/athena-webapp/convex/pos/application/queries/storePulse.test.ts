import { describe, expect, it } from "vitest";
import type { Id } from "../../../_generated/dataModel";
import type { QueryCtx } from "../../../_generated/server";
import { getStorePulseSummariesForOperatingDateRanges } from "./storePulse";

type TableName = "posTransaction" | "posTransactionItem";
type Row = Record<string, unknown> & { _id: string };

function createDb(seed: Partial<Record<TableName, Row[]>> = {}) {
  const tables = new Map<TableName, Map<string, Row>>();

  const tableFor = (table: TableName) => {
    if (!tables.has(table)) {
      tables.set(table, new Map());
    }

    return tables.get(table)!;
  };

  Object.entries(seed).forEach(([tableName, rows]) => {
    const table = tableFor(tableName as TableName);
    rows?.forEach((row) => table.set(row._id, { ...row }));
  });

  const query = (table: TableName) => {
    const filters: Array<
      [string, unknown | { gte?: number; lte?: number }]
    > = [];
    const filteredRows = () =>
      Array.from(tableFor(table).values()).filter((row) =>
        filters.every(([field, value]) => {
          if (value && typeof value === "object" && !Array.isArray(value)) {
            if (
              "gte" in value &&
              typeof value.gte === "number" &&
              Number(row[field]) < value.gte
            ) {
              return false;
            }

            if (
              "lte" in value &&
              typeof value.lte === "number" &&
              Number(row[field]) > value.lte
            ) {
              return false;
            }

            return true;
          }

          return row[field] === value;
        }),
      );

    const chain = {
      async *[Symbol.asyncIterator]() {
        for (const row of filteredRows()) {
          yield row;
        }
      },
      withIndex(
        _index: string,
        applyIndex: (builder: {
          eq: (field: string, value: unknown) => typeof builder;
          gte: (field: string, value: number) => typeof builder;
          lte: (field: string, value: number) => typeof builder;
        }) => unknown,
      ) {
        const builder = {
          eq(field: string, value: unknown) {
            filters.push([field, value]);
            return builder;
          },
          gte(field: string, value: number) {
            filters.push([field, { gte: value }]);
            return builder;
          },
          lte(field: string, value: number) {
            filters.push([field, { lte: value }]);
            return builder;
          },
        };

        applyIndex(builder);
        return chain;
      },
    };

    return chain;
  };

  return { db: { query } } as unknown as QueryCtx;
}

function transaction({
  completedAt,
  id,
  payments,
  storeId = "store-1",
  total,
}: {
  completedAt: number;
  id: string;
  payments: Array<{ amount: number; method: string }>;
  storeId?: string;
  total: number;
}) {
  return {
    _id: id,
    completedAt,
    paymentMethod: payments[0]?.method,
    payments: payments.map((payment) => ({
      ...payment,
      timestamp: completedAt,
    })),
    status: "completed",
    storeId,
    total,
    totalPaid: total,
  };
}

function item({
  id,
  productName,
  quantity,
  totalPrice,
  transactionId,
}: {
  id: string;
  productName: string;
  quantity: number;
  totalPrice: number;
  transactionId: string;
}) {
  return {
    _id: id,
    productId: `${id}-product`,
    productName,
    productSku: `${id}-sku`,
    productSkuId: `${id}-sku-id`,
    quantity,
    totalPrice,
    transactionId,
  };
}

describe("getStorePulseSummariesForOperatingDateRanges", () => {
  it("returns no summaries when no date ranges are provided", async () => {
    await expect(
      getStorePulseSummariesForOperatingDateRanges(createDb(), {
        dateRanges: [],
        storeId: "store-1" as Id<"store">,
      }),
    ).resolves.toEqual([]);
  });

  it("aggregates completed transactions into sorted operating-date buckets", async () => {
    const dayOneStart = Date.UTC(2026, 5, 21, 0);
    const dayTwoStart = Date.UTC(2026, 5, 22, 0);
    const dayThreeStart = Date.UTC(2026, 5, 23, 0);
    const outsideRange = Date.UTC(2026, 5, 23, 2);
    const ctx = createDb({
      posTransaction: [
        transaction({
          completedAt: dayOneStart + 9 * 60 * 60 * 1000,
          id: "txn-day-one",
          payments: [{ amount: 1000, method: "cash" }],
          total: 1000,
        }),
        transaction({
          completedAt: dayTwoStart + 13 * 60 * 60 * 1000,
          id: "txn-day-two-mobile",
          payments: [{ amount: 2500, method: "mobile_money" }],
          total: 2500,
        }),
        transaction({
          completedAt: dayTwoStart + 13 * 60 * 60 * 1000 + 5,
          id: "txn-day-two-cash",
          payments: [{ amount: 1500, method: "cash" }],
          total: 1500,
        }),
        transaction({
          completedAt: outsideRange,
          id: "txn-outside-bucket",
          payments: [{ amount: 5000, method: "cash" }],
          total: 5000,
        }),
      ],
      posTransactionItem: [
        item({
          id: "item-day-one",
          productName: "Day one item",
          quantity: 1,
          totalPrice: 1000,
          transactionId: "txn-day-one",
        }),
        item({
          id: "item-day-two-mobile",
          productName: "Mobile item",
          quantity: 2,
          totalPrice: 2500,
          transactionId: "txn-day-two-mobile",
        }),
        item({
          id: "item-day-two-cash",
          productName: "Cash item",
          quantity: 3,
          totalPrice: 1500,
          transactionId: "txn-day-two-cash",
        }),
        item({
          id: "item-outside",
          productName: "Outside item",
          quantity: 10,
          totalPrice: 5000,
          transactionId: "txn-outside-bucket",
        }),
      ],
    });

    const summaries = await getStorePulseSummariesForOperatingDateRanges(ctx, {
      dateRanges: [
        {
          endAt: dayOneStart,
          operatingDate: "2026-06-20",
          startAt: dayOneStart - 24 * 60 * 60 * 1000,
        },
        {
          endAt: dayThreeStart,
          operatingDate: "2026-06-22",
          startAt: dayTwoStart,
        },
        {
          endAt: dayTwoStart,
          operatingDate: "2026-06-21",
          startAt: dayOneStart,
        },
      ],
      storeId: "store-1" as Id<"store">,
    });

    expect(summaries.map((summary) => summary.date)).toEqual([
      "2026-06-20",
      "2026-06-21",
      "2026-06-22",
    ]);
    expect(summaries[0]).toMatchObject({
      averageTransaction: 0,
      totalItemsSold: 0,
      totalSales: 0,
      totalTransactions: 0,
    });
    expect(summaries[0]?.operatorSnapshot).toMatchObject({
      busiestHour: null,
      paymentMix: [],
      topItems: [],
      usableHistoryDays: 0,
    });
    expect(summaries[1]).toMatchObject({
      averageTransaction: 1000,
      totalItemsSold: 1,
      totalSales: 1000,
      totalTransactions: 1,
    });
    expect(summaries[1]?.operatorSnapshot.paymentMix).toEqual([
      expect.objectContaining({ count: 1, method: "cash", share: 100, total: 1000 }),
    ]);
    expect(summaries[1]?.operatorSnapshot.topItems).toEqual([
      expect.objectContaining({
        name: "Day one item",
        quantity: 1,
        totalSales: 1000,
      }),
    ]);
    expect(summaries[2]).toMatchObject({
      averageTransaction: 2000,
      totalItemsSold: 5,
      totalSales: 4000,
      totalTransactions: 2,
    });
    expect(summaries[2]?.operatorSnapshot.busiestHour).toMatchObject({
      hour: 13,
      totalSales: 4000,
      transactionCount: 2,
    });
    expect(summaries[2]?.operatorSnapshot.paymentMix).toEqual([
      expect.objectContaining({
        count: 1,
        method: "mobile_money",
        share: 63,
        total: 2500,
      }),
      expect.objectContaining({ count: 1, method: "cash", share: 38, total: 1500 }),
    ]);
    expect(summaries[2]?.operatorSnapshot.topItems).toEqual([
      expect.objectContaining({
        name: "Cash item",
        quantity: 3,
        totalSales: 1500,
      }),
      expect.objectContaining({
        name: "Mobile item",
        quantity: 2,
        totalSales: 2500,
      }),
    ]);
    expect(
      summaries
        .flatMap((summary) => summary.operatorSnapshot.topItems)
        .map((topItem) => topItem.name),
    ).not.toContain("Outside item");
  });
});
