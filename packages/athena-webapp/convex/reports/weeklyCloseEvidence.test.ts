import { describe, expect, it } from "vitest";

import type { Id } from "../_generated/dataModel";
import { aggregateWeeklyCloseEvidence } from "./weeklyCloseEvidence";

const scheduledDates = [
  "2026-08-03",
  "2026-08-04",
  "2026-08-05",
  "2026-08-06",
  "2026-08-07",
  "2026-08-08",
];

function closeId(index: number) {
  return `close-${index}` as Id<"dailyClose">;
}

function completeClose(
  index: number,
  summary: Record<string, unknown>,
  expenseProductEvidence?: Record<string, unknown>,
) {
  return {
    _id: closeId(index),
    lifecycleStatus: "active" as const,
    operatingDate: scheduledDates[index]!,
    reportSnapshot: {
      summary,
      ...(expenseProductEvidence ? { expenseProductEvidence } : {}),
    },
    status: "completed" as const,
  };
}

function aggregate(
  closes: ReturnType<typeof completeClose>[],
  extraDays: Array<{ closeId: Id<"dailyClose">; operatingDate: string }> = [],
) {
  return aggregateWeeklyCloseEvidence({
    closes: new Map(closes.map((close) => [String(close._id), close])),
    days: [
      ...closes.map((close) => ({
        closeId: close._id,
        operatingDate: close.operatingDate,
      })),
      ...extraDays,
    ],
    scheduledDates,
  });
}

describe("aggregateWeeklyCloseEvidence", () => {
  it("keeps cash, payment, and expense coverage independent", () => {
    const closes = scheduledDates.slice(0, 4).map((_, index) =>
      completeClose(
        index,
        {
          ...(index < 4 ? { netCashVariance: index + 1 } : {}),
          ...(index < 3 ? { transactionCount: index + 2 } : {}),
          ...(index < 3
            ? {
                paymentTotals: [
                  { amount: 100, method: "cash", transactionCount: 1 },
                ],
              }
            : {}),
        },
        index < 2
          ? {
              contractVersion: 1,
              expenseTotal: 0,
              products: [],
              sourceItemCount: 0,
              sourceTransactionCount: 0,
              status: "complete",
            }
          : undefined,
      ),
    );

    const evidence = aggregate(closes);

    expect(evidence.cash.coverage).toEqual({
      scheduledDayCount: 6,
      status: "partial",
      usableDayCount: 4,
    });
    expect(evidence.payments.coverage).toMatchObject({
      status: "partial",
      usableDayCount: 3,
    });
    expect(evidence.transactions).toEqual({
      coverage: {
        scheduledDayCount: 6,
        status: "partial",
        usableDayCount: 3,
      },
      transactionCount: 9,
    });
    expect(evidence.expenses.coverage).toMatchObject({
      status: "partial",
      usableDayCount: 2,
    });
    expect(evidence.expenses.coveredSpendMinor).toBe(0);
  });

  it("sorts payment value first and persists stable independently-rounded shares", () => {
    const evidence = aggregate([
      completeClose(0, {
        netCashVariance: 0,
        paymentTotals: [
          { amount: 1, method: "card", transactionCount: 2 },
          { amount: 1, method: "cash", transactionCount: 1 },
          { amount: 1, method: "momo", transactionCount: 3 },
        ],
      }),
    ]);

    expect(evidence.payments.coveredTenderValueMinor).toBe(3);
    expect(evidence.payments.rows).toEqual([
      { amountMinor: 1, method: "card", shareBasisPoints: 3333, tenderUseCount: 2 },
      { amountMinor: 1, method: "cash", shareBasisPoints: 3333, tenderUseCount: 1 },
      { amountMinor: 1, method: "momo", shareBasisPoints: 3333, tenderUseCount: 3 },
    ]);
  });

  it("nets mixed-sign daily cash variance into one sign-cancelling weekly total", () => {
    const evidence = aggregate([
      completeClose(0, { netCashVariance: 6_500 }),
      completeClose(1, { netCashVariance: -1_000 }),
      completeClose(2, { netCashVariance: -5_500 }),
    ]);

    // Overages and shortages cancel; coverage still discloses only 3 of 6
    // days spoke, so the zero is not readable as "nothing to see".
    expect(evidence.cash).toEqual({
      cashVarianceMinor: 0,
      coverage: { scheduledDayCount: 6, status: "partial", usableDayCount: 3 },
    });
  });

  it("aggregates method labels case-insensitively under the latest close's spelling", () => {
    const evidence = aggregate([
      completeClose(0, {
        paymentTotals: [
          { amount: 100, method: "cash", transactionCount: 1 },
          { amount: 40, method: "MoMo", transactionCount: 1 },
        ],
      }),
      completeClose(1, {
        paymentTotals: [{ amount: 50, method: "Cash", transactionCount: 2 }],
      }),
    ]);

    expect(evidence.payments.coveredTenderValueMinor).toBe(190);
    expect(evidence.payments.rows).toEqual([
      { amountMinor: 150, method: "Cash", shareBasisPoints: 7895, tenderUseCount: 3 },
      { amountMinor: 40, method: "MoMo", shareBasisPoints: 2105, tenderUseCount: 1 },
    ]);
  });

  it("treats same-day labels that collapse under normalization as malformed", () => {
    const evidence = aggregate([
      completeClose(0, {
        paymentTotals: [
          { amount: 100, method: "cash", transactionCount: 1 },
          { amount: 50, method: "Cash", transactionCount: 1 },
        ],
      }),
    ]);

    expect(evidence.payments).toMatchObject({
      coveredTenderValueMinor: 0,
      rows: [],
      coverage: { status: "unavailable", usableDayCount: 0 },
    });
  });

  it("counts a certified empty payment array as covered zero", () => {
    const evidence = aggregate([
      completeClose(0, { netCashVariance: 0, paymentTotals: [] }),
    ]);

    expect(evidence.payments).toEqual({
      coveredTenderValueMinor: 0,
      coverage: {
        scheduledDayCount: 6,
        status: "partial",
        usableDayCount: 1,
      },
      rows: [],
    });
  });

  it("withholds a malformed payment day instead of partially consuming it", () => {
    const evidence = aggregate([
      completeClose(0, {
        paymentTotals: [
          { amount: 100, method: "cash", transactionCount: 1 },
          { amount: 50, method: "cash", transactionCount: 1 },
        ],
      }),
      completeClose(1, {
        paymentTotals: [
          { amount: Number.MAX_SAFE_INTEGER, method: "card", transactionCount: 1 },
          { amount: 1, method: "momo", transactionCount: 1 },
        ],
      }),
      completeClose(2, {
        paymentTotals: [
          { amount: 25, method: "cash", transactionCount: 1 },
        ],
      }),
    ]);

    expect(evidence.payments).toMatchObject({
      coveredTenderValueMinor: 0,
      rows: [],
      coverage: { status: "unavailable", usableDayCount: 0 },
    });
  });

  it("withholds the payment lane when otherwise valid daily totals overflow weekly arithmetic", () => {
    const evidence = aggregate([
      completeClose(0, {
        paymentTotals: [
          {
            amount: Number.MAX_SAFE_INTEGER,
            method: "cash",
            transactionCount: 1,
          },
        ],
      }),
      completeClose(1, {
        paymentTotals: [
          { amount: 1, method: "cash", transactionCount: 1 },
        ],
      }),
    ]);

    expect(evidence.payments).toMatchObject({
      coveredTenderValueMinor: 0,
      rows: [],
      coverage: { status: "unavailable", usableDayCount: 0 },
    });
  });

  it("builds independent top-five expense rankings and reconciling remainders", () => {
    const products = [
      ["a", 12, 120],
      ["b", 11, 110],
      ["c", 10, 100],
      ["d", 9, 90],
      ["e", 8, 80],
      ["f", 100, 1],
    ].map(([id, quantity, spend]) => ({
      productName: `Product ${id}`,
      productSku: `SKU-${id}`,
      productSkuId: id as Id<"productSku">,
      quantity,
      spend,
    }));
    const evidence = aggregate([
      completeClose(
        0,
        {},
        {
          contractVersion: 1,
          expenseTotal: 501,
          products,
          sourceItemCount: 6,
          sourceTransactionCount: 1,
          status: "complete",
        },
      ),
    ]);

    expect(evidence.expenses.bySpend.map((row) => row.productSkuId)).toEqual([
      "a",
      "b",
      "c",
      "d",
      "e",
    ]);
    expect(evidence.expenses.spendRemainder).toEqual({
      productCount: 1,
      quantity: 100,
      spendMinor: 1,
    });
    expect(evidence.expenses.byQuantity.map((row) => row.productSkuId)).toEqual([
      "f",
      "a",
      "b",
      "c",
      "d",
    ]);
    expect(evidence.expenses.quantityRemainder).toEqual({
      productCount: 1,
      quantity: 8,
      spendMinor: 80,
    });
  });

  it("excludes outside-schedule and superseded lineage", () => {
    const outsideId = "outside" as Id<"dailyClose">;
    const evidence = aggregateWeeklyCloseEvidence({
      scheduledDates,
      days: [
        { closeId: closeId(0), operatingDate: scheduledDates[0]! },
        { closeId: outsideId, operatingDate: "2026-08-09" },
      ],
      closes: new Map([
        [
          String(closeId(0)),
          {
            ...completeClose(0, { netCashVariance: 50, paymentTotals: [] }),
            lifecycleStatus: "superseded" as const,
          },
        ],
        [
          String(outsideId),
          {
            ...completeClose(0, { netCashVariance: 900, paymentTotals: [] }),
            _id: outsideId,
            operatingDate: "2026-08-09",
          },
        ],
      ]),
    });

    expect(evidence.cash).toMatchObject({
      cashVarianceMinor: 0,
      coverage: { status: "unavailable", usableDayCount: 0 },
    });
    expect(evidence.payments.coverage.usableDayCount).toBe(0);
  });
});
