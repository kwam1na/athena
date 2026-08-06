/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";

import schema from "../schema";
import type { Doc, Id } from "../_generated/dataModel";
import {
  REPORT_TRAILING_SIX_MONTHS_MAX_DAYS,
  unitsPerTransaction,
} from "../../shared/reportsContract";
import {
  anchorDate,
  buildOverviewData,
  comparisonBp,
  emptySnapshot,
  OVERVIEW_DAY_SCAN_LIMIT,
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

  it("carries settled transaction counts onto the trend, leaving open days absent", () => {
    const data = buildOverviewData({
      days,
      fallbackCurrency: "GHS",
      now: 0,
      transactionCountsByDate: new Map([
        ["2026-07-26", 3],
        ["2026-07-27", 12],
      ]),
    });

    const countsByDate = new Map(
      data.dailyTrend.map((point) => [
        point.operatingDate,
        point.transactionCount,
      ]),
    );

    expect(countsByDate.get("2026-07-26")).toBe(3);
    expect(countsByDate.get("2026-07-27")).toBe(12);
    // The open day never closed, so it has no settled count to report.
    expect(countsByDate.get("2026-07-28")).toBeUndefined();
  });

  it("splits week-to-date from the prior ISO week", () => {
    const data = buildOverviewData({ days, fallbackCurrency: "GHS", now: 42 });

    // Week 31 so far: Mon 27th + Tue 28th.
    expect(data.weekToDate.netSalesMinor).toBe(900);
    expect(data.weekToDate.dayCount).toBe(2);
    // Week 30: 20th, 21st, 26th.
    expect(data.priorWeek.netSalesMinor).toBe(600);
    expect(data.priorWeek.dayCount).toBe(3);
    expect(data.today.netSalesMinor).toBe(500);
    expect(data.yesterday.netSalesMinor).toBe(400);
    expect(data.yesterday.unitsSold).toBe(4);
    expect(data.yesterday.dayCount).toBe(1);
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
      unitsSold: 5,
    });
    expect(
      data.dailyTrend.every(
        (point) => point.transactionCount === undefined,
      ),
    ).toBe(true);
    // The trailing-30 snapshot excludes the June day too.
    expect(data.trailing30.dayCount).toBe(5);
    expect(data.trailing30.netSalesMinor).toBe(1500);
    expect(data.trailing3Months.dayCount).toBe(6);
    expect(data.trailing3Months.netSalesMinor).toBe(2499);
  });

  it("materializes adjacent prior snapshots for both rolling windows", () => {
    const data = buildOverviewData({
      days: [
        day("2026-03-01", { netSalesMinor: 100, refundsMinor: 10 }),
        day("2026-06-01", { netSalesMinor: 200 }),
        day("2026-06-03", { netSalesMinor: 400, unitsSold: 4 }),
        day("2026-07-03", { netSalesMinor: 800, unitsSold: 8 }),
        day("2026-08-01", {
          status: "open",
          netSalesMinor: 1_600,
          unitsSold: 16,
        }),
      ],
      fallbackCurrency: "GHS",
      now: 0,
    });

    expect(data.priorTrailing30.netSalesMinor).toBe(400);
    expect(data.priorTrailing30.unitsSold).toBe(4);
    expect(data.trailing30.netSalesMinor).toBe(2_400);
    expect(data.priorTrailing3Months.netSalesMinor).toBe(100);
    expect(data.priorTrailing3Months.refundsMinor).toBe(10);
    expect(data.trailing3Months.netSalesMinor).toBe(3_000);
  });

  it("materializes six-month snapshots with calendar-correct boundaries", () => {
    // Anchor 2026-08-01: the six-calendar-month window starts 2026-03-01;
    // the prior window is 2025-09-01..2026-02-28 ("start minus one day,
    // re-apply the helper"). 2026-02 is a leap-adjacent February (28 days).
    const data = buildOverviewData({
      days: [
        day("2025-08-31", { netSalesMinor: 1 }), // before the prior window
        day("2025-09-01", { netSalesMinor: 2 }), // first day of the prior window
        day("2026-02-28", { netSalesMinor: 4 }), // last day of the prior window
        day("2026-03-01", { netSalesMinor: 8 }), // first day of the current window
        day("2026-08-01", { status: "open", netSalesMinor: 16 }),
      ],
      fallbackCurrency: "GHS",
      now: 0,
    });

    expect(data.trailing6Months.netSalesMinor).toBe(24);
    expect(data.trailing6Months.dayCount).toBe(2);
    expect(data.priorTrailing6Months.netSalesMinor).toBe(6);
    expect(data.priorTrailing6Months.dayCount).toBe(2);
  });

  it("keeps six-month boundaries correct across a leap day and a year boundary", () => {
    // Anchor 2028-02-29 (leap day): window starts 2027-09-01; prior window is
    // 2027-03-01..2027-08-31 — both cross the year boundary from the anchor.
    const data = buildOverviewData({
      days: [
        day("2027-02-28", { netSalesMinor: 1 }), // before the prior window
        day("2027-03-01", { netSalesMinor: 2 }), // first day of the prior window
        day("2027-08-31", { netSalesMinor: 4 }), // last day of the prior window
        day("2027-09-01", { netSalesMinor: 8 }), // first day of the current window
        day("2028-02-29", { status: "open", netSalesMinor: 16 }),
      ],
      fallbackCurrency: "GHS",
      now: 0,
    });

    expect(data.trailing6Months.netSalesMinor).toBe(24);
    expect(data.priorTrailing6Months.netSalesMinor).toBe(6);
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
      yesterday: emptySnapshot(),
      weekToDate: emptySnapshot(),
      priorWeek: emptySnapshot(),
      trailing30: emptySnapshot(),
      priorTrailing30: emptySnapshot(),
      trailing3Months: emptySnapshot(),
      priorTrailing3Months: emptySnapshot(),
      trailing6Months: emptySnapshot(),
      priorTrailing6Months: emptySnapshot(),
      comparisons: { netSalesVsPriorWeekBp: null, unitsSoldVsPriorWeekBp: null },
      dailyTrend: [],
      trust: { reconciledDays: 0, provisionalDays: 0, amendedDays: 0 },
    });
  });
});

describe("overview day scan limit", () => {
  it("covers the current AND prior six-month windows (2 x 184 days)", () => {
    expect(OVERVIEW_DAY_SCAN_LIMIT).toBe(
      2 * REPORT_TRAILING_SIX_MONTHS_MAX_DAYS,
    );
    expect(OVERVIEW_DAY_SCAN_LIMIT).toBe(368);
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

  it("scans deep enough for a complete prior six-month comparison", async () => {
    const t = convexTest(schema, modules);

    const { storeId } = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("athenaUser", {
        email: "scan-depth@example.test",
      });
      const organizationId = await ctx.db.insert("organization", {
        createdByUserId: userId,
        name: "Scan depth",
        slug: "scan-depth",
      });
      const storeId = await ctx.db.insert("store", {
        createdByUserId: userId,
        currency: "GHS",
        name: "Scan depth",
        organizationId,
        slug: "scan-depth",
      });

      // 396 consecutive days ending 2026-07-31 — more history than the scan
      // window, so a too-shallow read would silently truncate the prior
      // six-month window (2025-08-01..2026-01-31).
      const cursor = new Date("2025-07-01T00:00:00.000Z");
      const end = new Date("2026-07-31T00:00:00.000Z");
      while (cursor.getTime() <= end.getTime()) {
        await ctx.db.insert("reportDay", {
          ...dayFields(cursor.toISOString().slice(0, 10), {
            netSalesMinor: 1,
          }),
          storeId,
        });
        cursor.setUTCDate(cursor.getUTCDate() + 1);
      }

      return { storeId };
    });

    await t.run(async (ctx) => {
      await rebuildStoreOverview(ctx, storeId, 1_000);
    });

    const overview = await t.run(async (ctx) =>
      ctx.db
        .query("reportOverview")
        .withIndex("by_storeId", (q) => q.eq("storeId", storeId))
        .unique(),
    );

    // Current window 2026-02-01..2026-07-31 = 181 days; prior window
    // 2025-08-01..2026-01-31 = 184 days — the calendar maximum, complete.
    expect(overview?.trailing6Months?.dayCount).toBe(181);
    expect(overview?.trailing6Months?.netSalesMinor).toBe(181);
    expect(overview?.priorTrailing6Months?.dayCount).toBe(184);
    expect(overview?.priorTrailing6Months?.netSalesMinor).toBe(184);
  });

  it("reads the trend's transaction counts from each day's register close", async () => {
    const t = convexTest(schema, modules);

    const { storeId } = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("athenaUser", {
        email: "counts@example.test",
      });
      const organizationId = await ctx.db.insert("organization", {
        createdByUserId: userId,
        name: "Counts",
        slug: "counts",
      });
      const storeId = await ctx.db.insert("store", {
        createdByUserId: userId,
        currency: "GHS",
        name: "Counts",
        organizationId,
        slug: "counts",
      });

      const closeId = await ctx.db.insert("dailyClose", {
        storeId,
        organizationId,
        operatingDate: "2026-07-27",
        status: "completed",
        isCurrent: false,
        readiness: {
          status: "ready",
          blockerCount: 0,
          reviewCount: 0,
          carryForwardCount: 0,
          readyCount: 0,
        },
        summary: { transactionCount: 17 },
        sourceSubjects: [],
        carryForwardWorkItemIds: [],
        createdAt: 0,
        updatedAt: 0,
      });

      // The closed day resolves a count; the open day has no close at all.
      await ctx.db.insert("reportDay", {
        ...dayFields("2026-07-27", { netSalesMinor: 400 }),
        closeId,
        storeId,
      });
      await ctx.db.insert("reportDay", {
        ...dayFields("2026-07-28", { netSalesMinor: 500, status: "open" }),
        storeId,
      });

      return { storeId };
    });

    await t.run(async (ctx) => {
      await rebuildStoreOverview(ctx, storeId, 1_000);
    });

    const trend = await t.run(async (ctx) => {
      const overview = await ctx.db
        .query("reportOverview")
        .withIndex("by_storeId", (q) => q.eq("storeId", storeId))
        .unique();
      return overview?.dailyTrend ?? [];
    });

    expect(
      trend.find((point) => point.operatingDate === "2026-07-27")
        ?.transactionCount,
    ).toBe(17);
    expect(
      trend.find((point) => point.operatingDate === "2026-07-28")
        ?.transactionCount,
    ).toBeUndefined();
  });
});

describe("overview snapshots — settled transaction coverage", () => {
  it("sums only days that carry a count, and records how many those were", () => {
    // The pair is the point: a bare sum would look like a whole-period total
    // while silently omitting the open day beside it.
    const snapshot = snapshotForDays([
      day("2026-08-03", { transactionCount: 9, unitsSold: 20 }),
      day("2026-08-04", { transactionCount: 6, unitsSold: 15 }),
      day("2026-08-05", { status: "open", unitsSold: 25 }),
    ]);

    expect(snapshot.transactionCount).toBe(15);
    expect(snapshot.transactionCoveredDayCount).toBe(2);
    expect(snapshot.dayCount).toBe(3);
    // Units still span every day — which is exactly why the basket is withheld.
    expect(snapshot.unitsSold).toBe(60);
    expect(unitsPerTransaction(snapshot)).toBeNull();
  });

  it("states the basket once every day in the window is closed", () => {
    const snapshot = snapshotForDays([
      day("2026-08-03", { transactionCount: 9, unitsSold: 20 }),
      day("2026-08-04", { transactionCount: 6, unitsSold: 25 }),
    ]);

    expect(snapshot.transactionCoveredDayCount).toBe(snapshot.dayCount);
    expect(unitsPerTransaction(snapshot)).toBe(3);
  });

  it("keeps a closed day that sold nothing in the coverage count", () => {
    // Zero is a settled fact. Dropping it would make the window look fully
    // covered by fewer days than it has, and state a basket off a short sum.
    const snapshot = snapshotForDays([
      day("2026-08-03", { transactionCount: 0, unitsSold: 0 }),
      day("2026-08-04", { transactionCount: 4, unitsSold: 12 }),
    ]);

    expect(snapshot.transactionCount).toBe(4);
    expect(snapshot.transactionCoveredDayCount).toBe(2);
    expect(unitsPerTransaction(snapshot)).toBe(3);
  });

  it("reports an empty window as covered by nothing", () => {
    const snapshot = snapshotForDays([]);

    expect(snapshot.transactionCount).toBe(0);
    expect(snapshot.transactionCoveredDayCount).toBe(0);
    expect(unitsPerTransaction(snapshot)).toBeNull();
  });
});
