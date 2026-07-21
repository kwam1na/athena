import { describe, expect, it, vi } from "vitest";

import { createSharedDemoDailyOperationsFixture } from "./sharedDemoOperationsFixture";
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

  it("keeps current-day Opening Handoff on the connected workflow", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 21, 12));

    expect(
      createSharedDemoDailyOpeningFixture({
        operatingDate: "2026-07-21",
        orgUrlSlug: "demo",
        storeId: "store-1" as never,
        storeUrlSlug: "central",
      }),
    ).toBeUndefined();

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
