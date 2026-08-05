import { describe, expect, it, vi } from "vitest";

import {
  createSharedDemoDailyOperationsFixture,
  createSharedDemoPointOfSaleStorePulseSummary,
  overlaySharedDemoPointOfSaleTodayWithFixtureYesterday,
} from "./sharedDemoOperationsFixture";
import { createSharedDemoDailyCloseFixture } from "./sharedDemoDailyCloseFixture";
import { createSharedDemoDailyOpeningFixture } from "./sharedDemoDailyOpeningFixture";
import { getSharedDemoTransactionFixture } from "./sharedDemoTransactionsFixture";

describe("createSharedDemoDailyOperationsFixture", () => {
  it("opens every historic fixture day through Athena", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 21, 12));

    const openings = Array.from({ length: 21 }, (_, index) => {
      const operatingDate = new Date(2026, 5, 30 + index)
        .toISOString()
        .slice(0, 10);
      return createSharedDemoDailyOpeningFixture({
        operatingDate,
        orgUrlSlug: "demo",
        storeId: "store-1" as never,
        storeUrlSlug: "central",
      });
    });

    expect(openings.every(Boolean)).toBe(true);
    expect(
      openings.every(
        (opening) =>
          opening?.snapshot?.status === "started" &&
          opening.snapshot.startedOpening?.actorType === "automation" &&
          opening.snapshot.automationStatus?.outcome === "applied",
      ),
    ).toBe(true);
    expect(openings.at(-1)?.snapshot).toMatchObject({
      operatingDate: "2026-07-20",
      priorClose: { operatingDate: "2026-07-19" },
      readyItems: [
        expect.objectContaining({
          message: "The prior store day has a completed end of day review.",
          title: "Prior EOD Review completed",
        }),
      ],
    });
    expect(openings.at(-1)?.snapshot?.priorClose?.completedAt).toBe(
      createSharedDemoDailyCloseFixture({
        operatingDate: "2026-07-19",
        orgUrlSlug: "demo",
        storeId: "store-1" as never,
        storeUrlSlug: "central",
      })?.snapshot?.completedClose?.completedAt,
    );

    vi.useRealTimers();
  });

  it("renders current-day Opening Handoff from the prior fixture close", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 21, 12));

    expect(
      createSharedDemoDailyOpeningFixture({
        operatingDate: "2026-07-21",
        orgUrlSlug: "demo",
        storeId: "store-1" as never,
        storeUrlSlug: "central",
      }),
    ).toMatchObject({
      snapshot: {
        operatingDate: "2026-07-21",
        priorClose: { operatingDate: "2026-07-20" },
        readyItems: [
          expect.objectContaining({
            title: "Prior EOD Review completed",
          }),
        ],
        status: "started",
      },
    });

    vi.useRealTimers();
  });

  it("uses the same historic store-day totals in Daily Operations and EOD Review", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 21, 12));

    const fixtureArgs = {
      operatingDate: "2026-07-15",
      orgUrlSlug: "demo",
      storeId: "store-1" as never,
      storeUrlSlug: "central",
    };
    const operations = createSharedDemoDailyOperationsFixture(fixtureArgs);
    const dailyClose = createSharedDemoDailyCloseFixture(fixtureArgs);

    expect(dailyClose?.snapshot?.summary).toMatchObject(
      operations.snapshot?.closeSummary ?? {},
    );
    expect(dailyClose?.snapshot).toMatchObject({
      completedClose: {
        actorType: "automation",
        policyReviewedItemKeys: [
          "synced_sale_inventory_review:demo-2026-07-15",
        ],
      },
      operatingDate: "2026-07-15",
      status: "completed",
    });
    expect(
      dailyClose?.snapshot?.readyItems
        .filter((item) => item.category === "sale")
        .reduce(
          (total, item) =>
            total + Number((item.metadata as { total?: number })?.total ?? 0),
          0,
        ),
    ).toBe(operations.snapshot?.closeSummary.salesTotal);
    expect(
      dailyClose?.snapshot?.readyItems
        .filter((item) => item.category === "sale")
        .reduce(
          (total, item) =>
            total +
            Number((item.metadata as { itemCount?: number })?.itemCount ?? 0),
          0,
        ),
    ).toBe(
      operations.snapshot?.storePulse?.operatorSnapshot?.trend.at(-1)
        ?.totalItemsSold,
    );
    const transactionItems = dailyClose?.snapshot?.readyItems.filter((item) =>
      ["expense", "sale"].includes(item.category ?? ""),
    );
    expect(transactionItems).not.toHaveLength(0);
    expect(transactionItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          link: expect.objectContaining({
            to: "/$orgUrlSlug/store/$storeUrlSlug/pos/transactions/$transactionId",
          }),
          metadata: expect.objectContaining({ owner: "Afua O." }),
        }),
      ]),
    );
    expect(
      transactionItems?.every((item) => {
        const metadata = item.metadata as {
          owner?: string;
          report?: string;
          transaction?: string;
          transactionId?: string;
        };
        const transactionNumber = metadata.transaction ?? metadata.report;
        const fixtureTransaction = metadata.transactionId
          ? getSharedDemoTransactionFixture(metadata.transactionId)
          : undefined;
        return (
          /^\d{6}$/.test(transactionNumber ?? "") &&
          metadata.owner === "Afua O." &&
          (item.category !== "sale" ||
            (fixtureTransaction?.transactionNumber === transactionNumber &&
              item.link?.params?.transactionId === metadata.transactionId))
        );
      }),
    ).toBe(true);

    vi.useRealTimers();
  });

  it("does not fixture current-day EOD Review", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 21, 12));

    expect(
      createSharedDemoDailyCloseFixture({
        operatingDate: "2026-07-21",
        orgUrlSlug: "demo",
        storeId: "store-1" as never,
        storeUrlSlug: "central",
      }),
    ).toBeUndefined();

    vi.useRealTimers();
  });

  it("keeps today zero while presenting 14 relative historical operating days", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 21, 12));

    const fixture = createSharedDemoDailyOperationsFixture({
      orgUrlSlug: "demo",
      storeId: "store-1" as never,
      storeUrlSlug: "central",
    });

    expect(fixture.snapshot?.operatingDate).toBe("2026-07-21");
    expect(fixture.snapshot?.closeSummary.salesTotal).toBe(0);
    expect(fixture.snapshot?.closeSummary.transactionCount).toBe(0);
    expect(fixture.snapshot?.primaryAction).toEqual({
      label: "Start EOD Review",
      to: "/$orgUrlSlug/store/$storeUrlSlug/operations/daily-close",
    });
    expect(fixture.snapshot?.storePulse?.operatorSnapshot?.trend).toHaveLength(
      14,
    );
    expect(
      fixture.snapshot?.storePulse?.operatorSnapshot?.trend.at(-1)?.date,
    ).toBe("2026-07-21");
    expect(fixture.storePulseWindow).toBe("this_week");
    expect(
      fixture.snapshot?.storePulse?.operatorSnapshot?.trend.filter((day) =>
        ["2026-07-12", "2026-07-19"].includes(day.date),
      ),
    ).toEqual([
      expect.objectContaining({ totalSales: 0, transactionCount: 0 }),
      expect.objectContaining({ totalSales: 0, transactionCount: 0 }),
    ]);
    expect(
      fixture.snapshot?.weekMetrics.map((metric) => metric.operatingDate),
    ).toEqual([
      "2026-07-19",
      "2026-07-20",
      "2026-07-21",
      "2026-07-22",
      "2026-07-23",
      "2026-07-24",
      "2026-07-25",
    ]);
    const trendByDate = new Map(
      fixture.snapshot?.storePulse?.operatorSnapshot?.trend.map((day) => [
        day.date,
        day,
      ]),
    );
    fixture.snapshot?.weekMetrics
      .filter((metric) => trendByDate.has(metric.operatingDate))
      .forEach((metric) => {
        expect(trendByDate.get(metric.operatingDate)).toMatchObject({
          totalSales: metric.salesTotal,
          transactionCount: metric.transactionCount,
        });
      });

    vi.useRealTimers();
  });

  it("builds every pulse window on every weekday, including Monday", () => {
    // The `this_week` window starts at Monday, so on a Monday it holds exactly
    // one day. `buildStorePulseSummary` used to reach for `history.at(-2)!` and
    // get `undefined`, throwing on `.salesTotal`. The pre-existing coverage
    // pinned the clock to a Thursday, so it never saw this; CI hit it the first
    // time the suite ran on a Monday. 2026-08-03 is a Monday.
    const week = [
      "2026-08-03",
      "2026-08-04",
      "2026-08-05",
      "2026-08-06",
      "2026-08-07",
      "2026-08-08",
      "2026-08-09",
    ] as const;
    const windows = ["today", "this_week", "this_month", "all_time"] as const;

    for (const today of week) {
      for (const pulseWindow of windows) {
        const summary = createSharedDemoPointOfSaleStorePulseSummary(
          pulseWindow,
          today,
        );
        expect(summary, `${pulseWindow} on ${today}`).toBeDefined();
        expect(
          Number.isFinite(summary.totalSales),
          `${pulseWindow} on ${today} totalSales`,
        ).toBe(true);
      }
    }
  });

  it("aligns shared-demo POS pulse chart windows to live period behavior", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 23, 12));

    const todayPulse = createSharedDemoPointOfSaleStorePulseSummary("today");
    const weekPulse = createSharedDemoPointOfSaleStorePulseSummary("this_week");
    const monthPulse =
      createSharedDemoPointOfSaleStorePulseSummary("this_month");
    const allTimePulse =
      createSharedDemoPointOfSaleStorePulseSummary("all_time");

    expect(todayPulse.operatorSnapshot?.trend.map((day) => day.date)).toEqual([
      "2026-07-22",
      "2026-07-23",
    ]);
    expect(
      todayPulse.operatorSnapshot?.comparison.yesterdaySales,
    ).toBeGreaterThan(0);
    expect(weekPulse.operatorSnapshot?.trend.map((day) => day.date)).toEqual([
      "2026-07-20",
      "2026-07-21",
      "2026-07-22",
      "2026-07-23",
    ]);
    expect(monthPulse.operatorSnapshot?.trend.at(0)?.date).toBe("2026-07-10");
    expect(monthPulse.operatorSnapshot?.trend.at(-1)?.date).toBe("2026-07-23");
    expect(allTimePulse.operatorSnapshot?.trend).toHaveLength(14);

    vi.useRealTimers();
  });

  it("keeps shared-demo POS current day at zero while comparing against yesterday", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 23, 12));

    const todayPulse = createSharedDemoPointOfSaleStorePulseSummary("today");

    expect(todayPulse.totalSales).toBe(0);
    expect(todayPulse.totalTransactions).toBe(0);
    expect(todayPulse.operatorSnapshot?.comparison.currentSales).toBe(0);
    expect(
      todayPulse.operatorSnapshot?.comparison.yesterdayTransactions,
    ).toBeGreaterThan(0);

    vi.useRealTimers();
  });

  it("carries live shared-demo POS sales into every wider pulse window", () => {
    // The demo's fixture history stops at yesterday and today is live, so a
    // window that CONTAINS today must fold the live day in. Leaving it as the
    // fixture's empty current day zeroed the trend's last point and made every
    // comparison read -100%, because the comparison's "current" IS that day.
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 23, 12));

    const liveToday = {
      currentDayCashTotal: 19_600,
      currentDayCashTransactionCount: 1,
      paymentTotals: [
        { amount: 19_600, method: "cash", transactionCount: 1 },
      ],
      salesTotal: 19_600,
      totalItemsSold: 110,
      transactionCount: 1,
    };

    for (const pulseWindow of ["this_week", "this_month", "all_time"] as const) {
      const withLive = createSharedDemoPointOfSaleStorePulseSummary(
        pulseWindow,
        undefined,
        liveToday,
      );
      const withoutLive =
        createSharedDemoPointOfSaleStorePulseSummary(pulseWindow);
      const trend = withLive.operatorSnapshot!.trend;
      const currentPoint = trend.at(-1)!;

      expect(currentPoint.date, pulseWindow).toBe("2026-07-23");
      expect(currentPoint.totalSales, pulseWindow).toBe(19_600);
      expect(currentPoint.transactionCount, pulseWindow).toBe(1);
      expect(currentPoint.totalItemsSold, pulseWindow).toBe(110);

      // Window totals include the live day.
      expect(withLive.totalSales, pulseWindow).toBe(
        (withoutLive.totalSales ?? 0) + 19_600,
      );
      expect(withLive.totalItemsSold, pulseWindow).toBe(
        (withoutLive.totalItemsSold ?? 0) + 110,
      );
      expect(withLive.totalTransactions, pulseWindow).toBe(
        (withoutLive.totalTransactions ?? 0) + 1,
      );

      // The comparison's "current" is the live day, not an empty one, so a
      // window with real sales can no longer report a -100% collapse.
      const comparison = withLive.operatorSnapshot!.comparison;
      expect(comparison.currentSales, pulseWindow).toBe(19_600);
      expect(comparison.salesDeltaPercent, pulseWindow).not.toBe(-100);

      // Payment mix sums the same history, so the live day's cash lands too.
      const cash = withLive.operatorSnapshot!.paymentMix.find(
        (entry) => entry.method === "cash",
      )!;
      const cashWithoutLive = withoutLive.operatorSnapshot!.paymentMix.find(
        (entry) => entry.method === "cash",
      )!;
      expect(cash.total, pulseWindow).toBe(cashWithoutLive.total + 19_600);
    }

    vi.useRealTimers();
  });

  it("leaves the history untouched when no live day is supplied", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 23, 12));

    const summary = createSharedDemoPointOfSaleStorePulseSummary("this_week");
    expect(summary.operatorSnapshot!.trend.at(-1)!.totalSales).toBe(0);

    vi.useRealTimers();
  });

  it("shows the live current day in the week rail of a historical day", () => {
    // Selecting a fixture day must not blank today: the week rail spans it,
    // and "Week sales" reduces the same array. Left empty, a day with real
    // sales read GH0 beside days that had none.
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 23, 12));

    const liveToday = {
      salesTotal: 30_360,
      totalItemsSold: 110,
      transactionCount: 2,
    };
    const args = {
      operatingDate: "2026-07-21",
      orgUrlSlug: "acme",
      storeId: "store-1" as never,
      storeUrlSlug: "downtown",
    };

    const withLive = createSharedDemoDailyOperationsFixture({
      ...args,
      liveCurrentDay: liveToday,
    });
    const withoutLive = createSharedDemoDailyOperationsFixture(args);

    const todayCell = withLive.cachedWeekMetrics!.find(
      (metric) => metric.operatingDate === "2026-07-23",
    )!;
    expect(todayCell.salesTotal).toBe(30_360);
    expect(todayCell.transactionCount).toBe(2);

    // The selected historical day is untouched by the live injection.
    const selectedWith = withLive.cachedWeekMetrics!.find(
      (metric) => metric.operatingDate === "2026-07-21",
    )!;
    const selectedWithout = withoutLive.cachedWeekMetrics!.find(
      (metric) => metric.operatingDate === "2026-07-21",
    )!;
    expect(selectedWith).toEqual(selectedWithout);

    // Week sales reduces this array, so the total moves with it.
    const total = (metrics: typeof withLive.cachedWeekMetrics) =>
      (metrics ?? []).reduce((sum, metric) => sum + metric.salesTotal, 0);
    expect(total(withLive.cachedWeekMetrics)).toBe(
      total(withoutLive.cachedWeekMetrics) + 30_360,
    );

    // The snapshot's own copy feeds the same rail and must not diverge.
    expect(withLive.snapshot!.weekMetrics).toEqual(withLive.cachedWeekMetrics);

    vi.useRealTimers();
  });

  it("leaves the week rail's current day empty when nothing is live yet", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 23, 12));

    const fixture = createSharedDemoDailyOperationsFixture({
      operatingDate: "2026-07-21",
      orgUrlSlug: "acme",
      storeId: "store-1" as never,
      storeUrlSlug: "downtown",
    });
    const todayCell = fixture.cachedWeekMetrics!.find(
      (metric) => metric.operatingDate === "2026-07-23",
    )!;

    expect(todayCell.salesTotal).toBe(0);
    expect(todayCell.transactionCount).toBe(0);

    vi.useRealTimers();
  });

  it("overlays fixture yesterday onto live shared-demo POS today", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 23, 12));

    const liveToday = createSharedDemoPointOfSaleStorePulseSummary("today");
    const liveOperatorSnapshot = liveToday.operatorSnapshot!;
    liveToday.totalSales = 38_000;
    liveToday.totalTransactions = 1;
    liveToday.totalItemsSold = 4;
    liveToday.operatorSnapshot = {
      ...liveOperatorSnapshot,
      comparison: {
        ...liveOperatorSnapshot.comparison,
        currentSales: 38_000,
        currentTransactions: 1,
        currentItemsSold: 4,
        yesterdayAverageTransaction: 0,
        yesterdayItemsSold: 0,
        yesterdaySales: 0,
        yesterdayTransactions: 0,
      },
      trend: [
        {
          averageTransaction: 38_000,
          date: "2026-07-23",
          label: "Today",
          totalItemsSold: 4,
          totalSales: 38_000,
          transactionCount: 1,
        },
      ],
    };

    const overlaid =
      overlaySharedDemoPointOfSaleTodayWithFixtureYesterday(liveToday);

    expect(overlaid?.totalSales).toBe(38_000);
    expect(overlaid?.totalTransactions).toBe(1);
    expect(overlaid?.operatorSnapshot?.comparison.currentSales).toBe(38_000);
    expect(
      overlaid?.operatorSnapshot?.comparison.yesterdaySales,
    ).toBeGreaterThan(0);
    expect(overlaid?.operatorSnapshot?.trend.map((day) => day.date)).toEqual([
      "2026-07-22",
      "2026-07-23",
    ]);
    expect(overlaid?.operatorSnapshot?.trend.at(0)?.totalSales).toBeGreaterThan(
      0,
    );
    expect(overlaid?.operatorSnapshot?.trend.at(1)?.totalSales).toBe(38_000);

    vi.useRealTimers();
  });

  it("keeps fixture history available through the selected operating date", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 21, 12));

    const fixture = createSharedDemoDailyOperationsFixture({
      operatingDate: "2026-07-15",
      orgUrlSlug: "demo",
      storeId: "store-1" as never,
      storeUrlSlug: "central",
      weekEndOperatingDate: "2026-07-18",
    });
    const trend = fixture.snapshot?.storePulse?.operatorSnapshot?.trend;

    expect(trend).toHaveLength(14);
    expect(trend?.[0]?.date).toBe("2026-07-02");
    expect(trend?.at(-1)?.date).toBe("2026-07-15");
    expect(fixture.snapshot?.weekMetrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          operatingDate: "2026-07-15",
          salesTotal: trend?.at(-1)?.totalSales,
          transactionCount: trend?.at(-1)?.transactionCount,
        }),
      ]),
    );

    vi.useRealTimers();
  });

  it("caps seeded historical activity at three weeks before today", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 21, 12));

    const beforeHistory = createSharedDemoDailyOperationsFixture({
      operatingDate: "2026-06-29",
      orgUrlSlug: "demo",
      storeId: "store-1" as never,
      storeUrlSlug: "central",
    });
    const firstHistoryDay = createSharedDemoDailyOperationsFixture({
      operatingDate: "2026-06-30",
      orgUrlSlug: "demo",
      storeId: "store-1" as never,
      storeUrlSlug: "central",
    });

    expect(beforeHistory.snapshot?.closeSummary.salesTotal).toBe(0);
    expect(beforeHistory.snapshot?.lifecycle.status).toBe("operating");
    expect(firstHistoryDay.snapshot?.closeSummary.salesTotal).toBeGreaterThan(
      0,
    );
    expect(firstHistoryDay.snapshot?.lifecycle.status).toBe("closed");
    expect(
      firstHistoryDay.snapshot?.weekMetrics.filter(
        (metric) => metric.operatingDate < "2026-06-30",
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ salesTotal: 0, transactionCount: 0 }),
      ]),
    );

    vi.useRealTimers();
  });

  it("attributes each selected historical close to Athena", () => {
    const fixture = createSharedDemoDailyOperationsFixture({
      operatingDate: "2026-07-20",
      orgUrlSlug: "demo",
      storeId: "store-1" as never,
      storeUrlSlug: "central",
    });

    expect(fixture.snapshot?.lifecycle.status).toBe("closed");
    expect(fixture.snapshot?.completedClose).toMatchObject({
      actorType: "automation",
    });
    expect(fixture.snapshot?.timeline).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: "Athena completed EOD Review under store policy.",
        }),
      ]),
    );
  });

  it("renders a legitimate, unlinked store-day timeline for historic trading days", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 21, 12));

    const fixture = createSharedDemoDailyOperationsFixture({
      operatingDate: "2026-07-17",
      orgUrlSlug: "demo",
      storeId: "store-1" as never,
      storeUrlSlug: "central",
    });
    const timeline = fixture.snapshot?.timeline ?? [];

    expect(timeline.map((event) => event.message)).toEqual(
      expect.arrayContaining([
        "Opening Handoff is complete.",
        "Completed POS sales recorded.",
        "Athena completed EOD Review under store policy.",
      ]),
    );
    expect(timeline).toHaveLength(3);
    expect(timeline.map((event) => event.createdAt)).toEqual(
      [...timeline]
        .sort((left, right) => right.createdAt - left.createdAt)
        .map((event) => event.createdAt),
    );
    expect(
      timeline.every(
        (event) =>
          !("transactionLink" in event) &&
          !("productLink" in event) &&
          !("registerLink" in event),
      ),
    ).toBe(true);

    const inventoryReviewCount = Array.from({ length: 21 }, (_, index) => {
      const operatingDate = new Date(2026, 5, 30 + index)
        .toISOString()
        .slice(0, 10);
      return createSharedDemoDailyOperationsFixture({
        operatingDate,
        orgUrlSlug: "demo",
        storeId: "store-1" as never,
        storeUrlSlug: "central",
      }).snapshot?.timeline.filter(
        (event) => event.message === "Synced sale inventory review completed.",
      ).length;
    }).reduce<number>((total, count) => total + (count ?? 0), 0);

    expect(inventoryReviewCount).toBe(2);

    vi.useRealTimers();
  });

  it("uses catalog-price granularity for every demo payment split", () => {
    const fixture = createSharedDemoDailyOperationsFixture({
      operatingDate: "2026-07-20",
      orgUrlSlug: "demo",
      storeId: "store-1" as never,
      storeUrlSlug: "central",
    });

    const paymentAmounts = [
      ...(fixture.snapshot?.closeSummary.paymentTotals ?? []).map(
        ({ amount }) => amount,
      ),
      ...(fixture.snapshot?.storePulse?.operatorSnapshot?.paymentMix ?? []).map(
        ({ total }) => total,
      ),
    ];

    expect(paymentAmounts).not.toHaveLength(0);
    expect(paymentAmounts.every((amount) => amount % 500 === 0)).toBe(true);
  });

  it("ties shared-demo daily operations pulse detail to the selected operating date", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 21, 12));

    const sundayFixture = createSharedDemoDailyOperationsFixture({
      operatingDate: "2026-07-19",
      orgUrlSlug: "demo",
      storeId: "store-1" as never,
      storeUrlSlug: "central",
      weekEndOperatingDate: "2026-07-25",
    });
    const sundayPulse = sundayFixture.snapshot?.storePulse;

    expect(sundayFixture.snapshot?.closeSummary.transactionCount).toBe(0);
    expect(sundayPulse?.totalTransactions).toBe(0);
    expect(sundayPulse?.totalItemsSold).toBe(0);
    expect(sundayPulse?.operatorSnapshot?.topItems).toEqual([]);
    expect(sundayPulse?.operatorSnapshot?.paymentMix).toEqual([]);
    expect(
      sundayPulse?.operatorSnapshot?.trend.some(
        (day) => day.transactionCount > 0,
      ),
    ).toBe(true);

    const mondayFixture = createSharedDemoDailyOperationsFixture({
      operatingDate: "2026-07-20",
      orgUrlSlug: "demo",
      storeId: "store-1" as never,
      storeUrlSlug: "central",
      weekEndOperatingDate: "2026-07-25",
    });
    const mondayPulse = mondayFixture.snapshot?.storePulse;

    expect(
      mondayFixture.snapshot?.closeSummary.transactionCount,
    ).toBeGreaterThan(0);
    expect(mondayPulse?.totalTransactions).toBe(
      mondayFixture.snapshot?.closeSummary.transactionCount,
    );
    expect(mondayPulse?.operatorSnapshot?.topItems.length).toBeGreaterThan(0);
    expect(
      mondayPulse?.operatorSnapshot?.paymentMix.map(({ method }) => method),
    ).toEqual(
      mondayFixture.snapshot?.closeSummary.paymentTotals?.map(
        ({ method }) => method,
      ),
    );

    vi.useRealTimers();
  });

  it("varies historic metrics independently across operating days", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 21, 12));

    const createFixture = (operatingDate: string) =>
      createSharedDemoDailyOperationsFixture({
        operatingDate,
        orgUrlSlug: "demo",
        storeId: "store-1" as never,
        storeUrlSlug: "central",
      });
    const history = createFixture(
      "2026-07-20",
    ).snapshot?.storePulse?.operatorSnapshot?.trend.filter(
      (day) => day.transactionCount > 0,
    );
    const cashShare = (operatingDate: string) => {
      const snapshot = createFixture(operatingDate).snapshot;
      return (
        (snapshot?.closeSummary.paymentTotals?.find(
          ({ method }) => method === "cash",
        )?.amount ?? 0) / (snapshot?.closeSummary.salesTotal ?? 1)
      );
    };

    expect(history).toBeDefined();
    expect(
      history?.slice(1).some((day, index) => {
        const priorDay = history[index]!;
        return (
          Math.sign(day.totalSales - priorDay.totalSales) !==
          Math.sign(day.transactionCount - priorDay.transactionCount)
        );
      }),
    ).toBe(true);
    expect(cashShare("2026-07-14")).not.toBe(cashShare("2026-07-15"));

    vi.useRealTimers();
  });

  it("keeps the week strip scoped to the requested Sunday-to-Saturday week", () => {
    const fixture = createSharedDemoDailyOperationsFixture({
      operatingDate: "2026-07-16",
      orgUrlSlug: "demo",
      storeId: "store-1" as never,
      storeUrlSlug: "central",
      weekEndOperatingDate: "2026-07-17",
    });

    expect(
      fixture.snapshot?.weekMetrics.map((metric) => metric.operatingDate),
    ).toEqual([
      "2026-07-12",
      "2026-07-13",
      "2026-07-14",
      "2026-07-15",
      "2026-07-16",
      "2026-07-17",
      "2026-07-18",
    ]);
    expect(
      fixture.snapshot?.weekMetrics.find((metric) => metric.isSelected)
        ?.operatingDate,
    ).toBe("2026-07-16");
  });
});
