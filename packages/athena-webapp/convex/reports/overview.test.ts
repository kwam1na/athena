/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";

import schema from "../schema";
import type { Doc, Id } from "../_generated/dataModel";
import {
  anchorDate,
  buildOverviewData,
  comparisonBp,
  emptySnapshot,
  rebuildStoreOverview,
  snapshotForDays,
  trustSummaryForDays,
} from "./overview";

const modules = import.meta.glob("../**/*.ts");

/**
 * Overview correctness is asserted against HAND-BUILT day docs, never against
 * a fold. The overview's job is denormalization: whatever the day docs say,
 * the single doc the dashboard reads must say the same thing.
 */
type DayFields = Omit<Doc<"reportDay">, "_id" | "_creationTime">;

function dayFields(
  operatingDate: string,
  overrides: Partial<DayFields> = {},
): DayFields {
  return {
    storeId: "store-1" as Id<"store">,
    operatingDate,
    currency: "GHS",
    status: "reconciled",
    grossSalesMinor: 0,
    netSalesMinor: 0,
    refundsMinor: 0,
    unitsSold: 0,
    unitsReturned: 0,
    uncostedRevenueMinor: 0,
    grossProfitMinor: 0,
    paymentsCollectedMinor: 0,
    paymentsRefundedMinor: 0,
    paymentAllocatedMinor: 0,
    foldVersion: 1,
    factCount: 0,
    lastFactRecordedAt: 0,
    flags: {
      mixedCurrency: false,
      hasUncostedRevenue: false,
      quarantinedFactCount: 0,
    },
    ...overrides,
  };
}

function day(
  operatingDate: string,
  overrides: Partial<DayFields> = {},
): Doc<"reportDay"> {
  return {
    _id: `day-${operatingDate}` as Id<"reportDay">,
    _creationTime: 0,
    ...dayFields(operatingDate, overrides),
  };
}

describe("overview snapshots", () => {
  it("sums metrics and counts unsettled days", () => {
    const snapshot = snapshotForDays([
      day("2026-07-20", {
        netSalesMinor: 1000,
        grossSalesMinor: 1200,
        unitsSold: 3,
        grossProfitMinor: 400,
      }),
      day("2026-07-21", {
        status: "provisional",
        netSalesMinor: 500,
        grossSalesMinor: 500,
        unitsSold: 2,
        grossProfitMinor: 100,
      }),
    ]);

    expect(snapshot.netSalesMinor).toBe(1500);
    expect(snapshot.grossSalesMinor).toBe(1700);
    expect(snapshot.unitsSold).toBe(5);
    expect(snapshot.grossProfitMinor).toBe(500);
    expect(snapshot.dayCount).toBe(2);
    expect(snapshot.unsettledDayCount).toBe(1);
  });

  it("refuses to report a partial margin as a real one", () => {
    // One uncosted day poisons the sum: 400 would read as the period's margin
    // when part of the revenue has no cost basis at all.
    const snapshot = snapshotForDays([
      day("2026-07-20", { netSalesMinor: 1000, grossProfitMinor: 400 }),
      day("2026-07-21", {
        netSalesMinor: 900,
        grossProfitMinor: null,
        uncostedRevenueMinor: 900,
      }),
    ]);

    expect(snapshot.grossProfitMinor).toBeNull();
    expect(snapshot.uncostedRevenueMinor).toBe(900);
  });

  it("is zero-valued for no days", () => {
    expect(snapshotForDays([])).toEqual(emptySnapshot());
  });
});

describe("comparisons", () => {
  it("expresses relative change in basis points", () => {
    expect(comparisonBp(1500, 1000)).toBe(5000); // +50%
    expect(comparisonBp(900, 1000)).toBe(-1000); // -10%
    expect(comparisonBp(1000, 1000)).toBe(0);
  });

  it("has no opinion when the prior period is zero", () => {
    expect(comparisonBp(1000, 0)).toBeNull();
    expect(comparisonBp(0, 0)).toBeNull();
  });

  it("keeps direction meaningful against a negative prior", () => {
    // A prior week that netted -100 and a current week of 0 is an improvement.
    expect(comparisonBp(0, -100)).toBe(10_000);
  });
});

describe("trust summary", () => {
  it("counts statuses and names the oldest unreconciled day", () => {
    const trust = trustSummaryForDays([
      day("2026-07-20", { status: "reconciled" }),
      day("2026-07-21", { status: "provisional" }),
      day("2026-07-22", { status: "amended" }),
      day("2026-07-23", { status: "provisional" }),
    ]);

    expect(trust).toEqual({
      reconciledDays: 1,
      provisionalDays: 2,
      amendedDays: 1,
      oldestUnreconciledDate: "2026-07-21",
    });
  });

  it("omits the oldest unreconciled date when everything reconciled", () => {
    const trust = trustSummaryForDays([day("2026-07-20"), day("2026-07-21")]);
    expect(trust.oldestUnreconciledDate).toBeUndefined();
    expect(trust.reconciledDays).toBe(2);
  });
});

describe("anchor day", () => {
  it("prefers the open day", () => {
    expect(
      anchorDate([
        day("2026-07-20"),
        day("2026-07-21", { status: "open" }),
        day("2026-07-22"),
      ]),
    ).toBe("2026-07-21");
  });

  it("falls back to the most recent day on record", () => {
    expect(anchorDate([day("2026-07-20"), day("2026-07-22")])).toBe(
      "2026-07-22",
    );
  });

  it("is null for a store with no days", () => {
    expect(anchorDate([])).toBeNull();
  });
});

describe("buildOverviewData", () => {
  // 2026-07-27 is a Monday (ISO week 31); 2026-07-20..26 is week 30.
  const days = [
    day("2026-07-20", { netSalesMinor: 100, unitsSold: 1 }),
    day("2026-07-21", { netSalesMinor: 200, unitsSold: 2 }),
    day("2026-07-26", { netSalesMinor: 300, unitsSold: 3 }),
    day("2026-07-27", { netSalesMinor: 400, unitsSold: 4 }),
    day("2026-07-28", { status: "open", netSalesMinor: 500, unitsSold: 5 }),
  ];

  it("splits week-to-date from the prior ISO week", () => {
    const data = buildOverviewData({ days, fallbackCurrency: "GHS", now: 42 });

    // Week 31 so far: Mon 27th + Tue 28th.
    expect(data.weekToDate.netSalesMinor).toBe(900);
    expect(data.weekToDate.dayCount).toBe(2);
    // Week 30: 20th, 21st, 26th.
    expect(data.priorWeek.netSalesMinor).toBe(600);
    expect(data.priorWeek.dayCount).toBe(3);
    expect(data.today.netSalesMinor).toBe(500);
    expect(data.updatedAt).toBe(42);
    expect(data.currency).toBe("GHS");
  });

  it("compares week-to-date against the prior week in basis points", () => {
    const data = buildOverviewData({ days, fallbackCurrency: "GHS", now: 0 });

    expect(data.comparisons.netSalesVsPriorWeekBp).toBe(
      comparisonBp(900, 600),
    );
    expect(data.comparisons.unitsSoldVsPriorWeekBp).toBe(comparisonBp(9, 6));
  });

  it("emits the trend ascending and windowed to 30 days", () => {
    const wide = [
      day("2026-06-01", { netSalesMinor: 999 }), // 57 days before the anchor
      ...days,
    ];
    const data = buildOverviewData({
      days: wide,
      fallbackCurrency: "GHS",
      now: 0,
    });

    expect(data.dailyTrend.map((point) => point.operatingDate)).toEqual([
      "2026-07-20",
      "2026-07-21",
      "2026-07-26",
      "2026-07-27",
      "2026-07-28",
    ]);
    expect(data.dailyTrend.at(-1)).toEqual({
      operatingDate: "2026-07-28",
      netSalesMinor: 500,
      status: "open",
    });
    // The trailing-30 snapshot excludes the June day too.
    expect(data.trailing30.dayCount).toBe(5);
    expect(data.trailing30.netSalesMinor).toBe(1500);
  });

  it("is an empty-but-valid document for a store with no days", () => {
    const data = buildOverviewData({
      days: [],
      fallbackCurrency: "GHS",
      now: 7,
    });

    expect(data).toEqual({
      updatedAt: 7,
      currency: "GHS",
      today: emptySnapshot(),
      weekToDate: emptySnapshot(),
      priorWeek: emptySnapshot(),
      trailing30: emptySnapshot(),
      comparisons: { netSalesVsPriorWeekBp: null, unitsSoldVsPriorWeekBp: null },
      dailyTrend: [],
      trust: { reconciledDays: 0, provisionalDays: 0, amendedDays: 0 },
    });
  });
});

describe("rebuildStoreOverview", () => {
  it("upserts one singleton doc per store", async () => {
    const t = convexTest(schema, modules);

    const { storeId } = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("athenaUser", {
        email: "overview@example.test",
      });
      const organizationId = await ctx.db.insert("organization", {
        createdByUserId: userId,
        name: "Overview",
        slug: "overview",
      });
      const storeId = await ctx.db.insert("store", {
        createdByUserId: userId,
        currency: "GHS",
        name: "Overview",
        organizationId,
        slug: "overview",
      });

      for (const [date, netSalesMinor] of [
        ["2026-07-27", 400],
        ["2026-07-28", 500],
      ] as const) {
        await ctx.db.insert("reportDay", {
          ...dayFields(date, { netSalesMinor }),
          storeId,
        });
      }

      return { storeId };
    });

    await t.run(async (ctx) => {
      await rebuildStoreOverview(ctx, storeId, 1_000);
      await rebuildStoreOverview(ctx, storeId, 2_000);
    });

    const overviews = await t.run(async (ctx) =>
      // eslint-disable-next-line @convex-dev/no-collect-in-query -- convex-test fixture read, not a production query
      ctx.db.query("reportOverview").collect(),
    );

    expect(overviews).toHaveLength(1);
    expect(overviews[0].updatedAt).toBe(2_000);
    expect(overviews[0].weekToDate.netSalesMinor).toBe(900);
    expect(overviews[0].dailyTrend).toHaveLength(2);
  });
});
