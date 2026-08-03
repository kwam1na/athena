import { describe, expect, it } from "vitest";

import { getLocalOperatingDate } from "@/lib/operations/operatingDate";
import { REPORT_SKU_PAGE_SIZE } from "~/shared/reportsContract";
import { SHARED_DEMO_PRODUCTS } from "~/shared/sharedDemoStory";
import {
  getSharedDemoHistoricalDayFixture,
  getSharedDemoHistoryStartOperatingDate,
  SHARED_DEMO_HISTORY_DAYS,
} from "./sharedDemoOperationsFixture";
import { createSharedDemoTransactionFixtures } from "./sharedDemoTransactionsFixture";
import {
  createSharedDemoPeriodSkus,
  createSharedDemoReportDays,
  createSharedDemoReportSkuMix,
  createSharedDemoReportsOverview,
  createSharedDemoSkuDayTransactions,
  createSharedDemoSkuDetail,
  createSharedDemoWeeklyBriefing,
  isSharedDemoReportsSkuId,
  SHARED_DEMO_REPORTS_SKU_ID_PREFIX,
} from "./sharedDemoReportsFixture";

/** 2026-08-03 is a Monday; the sweep runs Monday through Sunday. */
const WEEKDAY_SWEEP = [
  "2026-08-03",
  "2026-08-04",
  "2026-08-05",
  "2026-08-06",
  "2026-08-07",
  "2026-08-08",
  "2026-08-09",
] as const;
const TODAY = "2026-08-06";

/** Independent label arithmetic, so the fixture's own copy is not the oracle. */
function addDaysToDate(operatingDate: string, days: number) {
  const date = new Date(`${operatingDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function isoWeekStart(operatingDate: string) {
  const isoDay = new Date(`${operatingDate}T00:00:00.000Z`).getUTCDay() || 7;
  return addDaysToDate(operatingDate, 1 - isoDay);
}

function skuIdFor(slug: string) {
  return `${SHARED_DEMO_REPORTS_SKU_ID_PREFIX}${slug}`;
}

function historyDates(today: string) {
  const start = getSharedDemoHistoryStartOperatingDate(today);
  return Array.from({ length: SHARED_DEMO_HISTORY_DAYS }, (_, index) =>
    addDaysToDate(start, index),
  );
}

function expectFiniteNumbers(value: unknown, path: string) {
  if (typeof value === "number") {
    expect(Number.isFinite(value), `${path} is finite`).toBe(true);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      expectFiniteNumbers(entry, `${path}[${index}]`),
    );
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      expectFiniteNumbers(entry, `${path}.${key}`);
    }
  }
}

describe("shared demo reports fixture", () => {
  describe("weekday sweep", () => {
    it.each(WEEKDAY_SWEEP)(
      "returns defined, finite results for every surface on %s",
      (today) => {
        const weekStart = isoWeekStart(today);
        const overview = createSharedDemoReportsOverview(today);
        const days = createSharedDemoReportDays({
          startDate: weekStart,
          endDate: today,
          today,
        });
        const mix = createSharedDemoReportSkuMix({
          startDate: weekStart,
          endDate: today,
          today,
        });
        const items = createSharedDemoPeriodSkus({
          periodKey: `d:${today}`,
          sortBy: "revenue",
          today,
        });
        const skuId = skuIdFor(SHARED_DEMO_PRODUCTS[0]!.slug);
        const detail = createSharedDemoSkuDetail({
          productSkuId: skuId,
          startDate: weekStart,
          endDate: today,
          today,
        });
        const evidence = createSharedDemoSkuDayTransactions({
          productSkuId: skuId,
          operatingDate: addDaysToDate(today, -1),
          today,
        });
        const weekly = createSharedDemoWeeklyBriefing(today);

        for (const [name, result] of [
          ["overview", overview],
          ["days", days],
          ["mix", mix],
          ["items", items],
          ["detail", detail],
          ["evidence", evidence],
          ["weekly", weekly],
        ] as const) {
          expect(result, name).toBeDefined();
          expectFiniteNumbers(result, name);
        }

        // Today is always empty in the shared history: a legitimate zero, and
        // on a Monday the whole week to date is that one empty day.
        expect(overview.today.dayCount).toBe(1);
        expect(overview.today.netSalesMinor).toBe(0);
        expect(overview.today.unsettledDayCount).toBe(1);
        expect(days.at(-1)?.operatingDate).toBe(today);
        expect(weekly.status).toBe("available");
        if (weekly.status !== "available") throw new Error("unreachable");
        expect(weekly.current.scheduleLineage).toHaveLength(7);
        expect(weekly.current.cycleStartDate).toBe(weekStart);
        if (today === WEEKDAY_SWEEP[0]) {
          expect(weekly.current.total.netSalesMinor).toBe(0);
          expect(days).toHaveLength(1);
        }
      },
    );
  });

  describe("reconciliation with operations and transactions", () => {
    it("matches the operations day fixture for every historical date", () => {
      for (const operatingDate of historyDates(TODAY)) {
        const operations = getSharedDemoHistoricalDayFixture(
          operatingDate,
          TODAY,
        )!;
        const [row] = createSharedDemoReportDays({
          startDate: operatingDate,
          endDate: operatingDate,
          today: TODAY,
        });

        expect(row, operatingDate).toBeDefined();
        expect(row!.netSalesMinor, operatingDate).toBe(operations.salesTotal);
        expect(row!.grossSalesMinor, operatingDate).toBe(operations.salesTotal);
        expect(row!.unitsSold, operatingDate).toBe(operations.totalItemsSold);
        expect(row!.paymentsCollectedMinor, operatingDate).toBe(
          operations.salesTotal,
        );
      }
    });

    it("matches the transactions fixture for every historical date", () => {
      const transactions = createSharedDemoTransactionFixtures(TODAY);

      for (const operatingDate of historyDates(TODAY)) {
        const completed = transactions.filter(
          (transaction) =>
            transaction.status === "completed" &&
            getLocalOperatingDate(new Date(transaction.completedAt)) ===
              operatingDate,
        );
        const expectedNet = completed.reduce(
          (total, transaction) => total + transaction.total,
          0,
        );
        const expectedUnits = completed.reduce(
          (total, transaction) => total + transaction.itemCount,
          0,
        );
        const [row] = createSharedDemoReportDays({
          startDate: operatingDate,
          endDate: operatingDate,
          today: TODAY,
        });

        expect(row!.netSalesMinor, operatingDate).toBe(expectedNet);
        expect(row!.unitsSold, operatingDate).toBe(expectedUnits);
      }
    });

    it("keeps SKU rollups, mix, and detail summing to the day rows", () => {
      const dates = historyDates(TODAY);
      const startDate = dates[0]!;
      const endDate = dates.at(-1)!;
      const dayRows = createSharedDemoReportDays({
        startDate,
        endDate,
        today: TODAY,
      });
      const totalNet = dayRows.reduce(
        (total, row) => total + row.netSalesMinor,
        0,
      );
      const totalUnits = dayRows.reduce((total, row) => total + row.unitsSold, 0);

      const mix = createSharedDemoReportSkuMix({
        startDate,
        endDate,
        today: TODAY,
      });
      expect(mix.totalUnitsSold).toBe(totalUnits);
      expect(mix.rows.reduce((total, row) => total + row.unitsSold, 0)).toBe(
        totalUnits,
      );

      const detailNet = SHARED_DEMO_PRODUCTS.reduce((total, product) => {
        const detail = createSharedDemoSkuDetail({
          productSkuId: skuIdFor(product.slug),
          startDate,
          endDate,
          today: TODAY,
        })!;
        return total + (detail.totals?.netSalesMinor ?? 0);
      }, 0);
      expect(detailNet).toBe(totalNet);
    });

    it("sums SKU-day evidence back to the SKU day", () => {
      const operatingDate = addDaysToDate(TODAY, -2);
      for (const product of SHARED_DEMO_PRODUCTS) {
        const productSkuId = skuIdFor(product.slug);
        const evidence = createSharedDemoSkuDayTransactions({
          productSkuId,
          operatingDate,
          today: TODAY,
        });
        const detail = createSharedDemoSkuDetail({
          productSkuId,
          startDate: operatingDate,
          endDate: operatingDate,
          today: TODAY,
        })!;

        expect(evidence.truncated).toBe(false);
        expect(
          evidence.transactions.reduce(
            (total, transaction) => total + transaction.netSalesMinor,
            0,
          ),
        ).toBe(detail.totals?.netSalesMinor ?? 0);
        expect(
          evidence.transactions.reduce(
            (total, transaction) => total + transaction.quantity,
            0,
          ),
        ).toBe(detail.totals?.unitsSold ?? 0);
      }
    });
  });

  describe("determinism", () => {
    it("returns deeply equal results for the same today", () => {
      const range = { endDate: TODAY, startDate: addDaysToDate(TODAY, -6) };
      expect(createSharedDemoReportsOverview(TODAY)).toEqual(
        createSharedDemoReportsOverview(TODAY),
      );
      expect(createSharedDemoReportDays({ ...range, today: TODAY })).toEqual(
        createSharedDemoReportDays({ ...range, today: TODAY }),
      );
      expect(createSharedDemoReportSkuMix({ ...range, today: TODAY })).toEqual(
        createSharedDemoReportSkuMix({ ...range, today: TODAY }),
      );
      expect(
        createSharedDemoPeriodSkus({
          periodKey: `w:${"2026-W32"}`,
          sortBy: "units",
          today: TODAY,
        }),
      ).toEqual(
        createSharedDemoPeriodSkus({
          periodKey: `w:${"2026-W32"}`,
          sortBy: "units",
          today: TODAY,
        }),
      );
      expect(createSharedDemoWeeklyBriefing(TODAY)).toEqual(
        createSharedDemoWeeklyBriefing(TODAY),
      );
    });
  });

  describe("items paging", () => {
    const periodKey = `d:${addDaysToDate(TODAY, -1)}`;

    it("reports a terminal page for the demo catalogue", () => {
      const page = createSharedDemoPeriodSkus({
        periodKey,
        sortBy: "revenue",
        today: TODAY,
      });

      // Eight demo SKUs never fill a ten-row page, so the demo mints no cursor.
      expect(page.rows.length).toBeLessThanOrEqual(REPORT_SKU_PAGE_SIZE);
      expect(page.continueCursor).toBeNull();
      expect(page.rows.every((row) => row.periodKey === periodKey)).toBe(true);
      expect(
        page.rows.map((row) => row.netSalesMinor),
      ).toEqual(
        [...page.rows.map((row) => row.netSalesMinor)].sort((a, b) => b - a),
      );
    });

    it("round-trips a cursor into a gapless, overlap-free next page", () => {
      const full = createSharedDemoPeriodSkus({
        periodKey,
        sortBy: "revenue",
        today: TODAY,
      });
      expect(full.rows.length).toBeGreaterThan(2);
      const boundary = full.rows[1]!;
      // The cursor format is the module's own contract: it only ever has to be
      // read back by `createSharedDemoPeriodSkus` itself.
      const cursor = btoa(
        JSON.stringify({
          v: 1,
          periodKey,
          sortBy: "revenue",
          afterSkuId: boundary.productSkuId,
        }),
      );
      const next = createSharedDemoPeriodSkus({
        periodKey,
        sortBy: "revenue",
        cursor,
        today: TODAY,
      });

      const firstIds = full.rows.slice(0, 2).map((row) => row.productSkuId);
      const nextIds = next.rows.map((row) => row.productSkuId);
      expect(nextIds.some((id) => firstIds.includes(id))).toBe(false);
      expect([...firstIds, ...nextIds]).toEqual(
        full.rows.map((row) => row.productSkuId),
      );
      expect(next.continueCursor).toBeNull();
      expect(next.totalNetSalesMinor).toBe(full.totalNetSalesMinor);
    });

    it("falls back to the first page for garbage and foreign cursors", () => {
      const first = createSharedDemoPeriodSkus({
        periodKey,
        sortBy: "revenue",
        today: TODAY,
      });
      const foreign = btoa(
        JSON.stringify({
          v: 1,
          periodKey: "d:1999-01-01",
          sortBy: "revenue",
          afterSkuId: first.rows[0]?.productSkuId ?? "x",
        }),
      );
      const wrongSort = btoa(
        JSON.stringify({
          v: 1,
          periodKey,
          sortBy: "units",
          afterSkuId: first.rows[0]?.productSkuId ?? "x",
        }),
      );
      const stale = btoa(
        JSON.stringify({
          v: 1,
          periodKey,
          sortBy: "revenue",
          afterSkuId: skuIdFor("demo-does-not-exist"),
        }),
      );

      for (const cursor of ["not-base64", "", foreign, wrongSort, stale]) {
        expect(() =>
          createSharedDemoPeriodSkus({
            periodKey,
            sortBy: "revenue",
            cursor,
            today: TODAY,
          }),
        ).not.toThrow();
        expect(
          createSharedDemoPeriodSkus({
            periodKey,
            sortBy: "revenue",
            cursor,
            today: TODAY,
          }),
        ).toEqual(first);
      }
    });

    it("marks a selected today as in progress and a past day as settled", () => {
      expect(
        createSharedDemoPeriodSkus({
          periodKey: `d:${TODAY}`,
          sortBy: "revenue",
          today: TODAY,
        }).isTodayInProgress,
      ).toBe(true);
      expect(
        createSharedDemoPeriodSkus({
          periodKey,
          sortBy: "revenue",
          today: TODAY,
        }).isTodayInProgress,
      ).toBe(false);
    });
  });

  describe("unknown sku ids", () => {
    it("recognises only the demo prefix", () => {
      expect(isSharedDemoReportsSkuId(skuIdFor("demo-shea-butter"))).toBe(true);
      expect(isSharedDemoReportsSkuId("kg2abcdef")).toBe(false);
    });

    it("returns null instead of throwing for an unknown sku", () => {
      for (const productSkuId of [
        skuIdFor("demo-not-a-real-slug"),
        "kg2abcdef",
        "",
      ]) {
        expect(
          createSharedDemoSkuDetail({
            productSkuId,
            startDate: addDaysToDate(TODAY, -6),
            endDate: TODAY,
            today: TODAY,
          }),
        ).toBeNull();
        expect(
          createSharedDemoSkuDayTransactions({
            productSkuId,
            operatingDate: addDaysToDate(TODAY, -1),
            today: TODAY,
          }),
        ).toEqual({ transactions: [], truncated: false });
      }
    });

    it("returns an empty detail rather than throwing on an inverted range", () => {
      const detail = createSharedDemoSkuDetail({
        productSkuId: skuIdFor("demo-shea-butter"),
        startDate: TODAY,
        endDate: addDaysToDate(TODAY, -6),
        today: TODAY,
      })!;
      expect(detail.days).toEqual([]);
      expect(detail.totals).toBeNull();
      expect(detail.identity?.sku).toBe(
        SHARED_DEMO_PRODUCTS.find(
          (product) => product.slug === "demo-shea-butter",
        )!.sku,
      );
    });
  });

  describe("merchandise margin", () => {
    it("derives gross profit from the story unit costs", () => {
      const transactions = createSharedDemoTransactionFixtures(TODAY);

      for (const operatingDate of historyDates(TODAY)) {
        const expectedProfit = transactions
          .filter(
            (transaction) =>
              transaction.status === "completed" &&
              getLocalOperatingDate(new Date(transaction.completedAt)) ===
                operatingDate,
          )
          .flatMap((transaction) => transaction.items)
          .reduce((total, item) => {
            const product = SHARED_DEMO_PRODUCTS.find(
              (candidate) => candidate.sku === item.productSku,
            )!;
            return total + (product.price - product.unitCost) * item.quantity;
          }, 0);
        const [row] = createSharedDemoReportDays({
          startDate: operatingDate,
          endDate: operatingDate,
          today: TODAY,
        });

        expect(row!.grossProfitMinor, operatingDate).toBe(expectedProfit);
        // Every shared-demo SKU carries a unit cost, so no demo revenue is
        // uncovered — and the flag must say so rather than being silently true.
        expect(row!.uncostedRevenueMinor, operatingDate).toBe(0);
        expect(row!.flags.hasUncostedRevenue, operatingDate).toBe(false);
      }
    });

    it("reports no cost basis as null rather than as zero profit", () => {
      const evidence = createSharedDemoSkuDayTransactions({
        productSkuId: skuIdFor("demo-shea-butter"),
        operatingDate: addDaysToDate(TODAY, -2),
        today: TODAY,
      });
      for (const transaction of evidence.transactions) {
        // Cost is a number or null — never a placeholder zero standing in for
        // an unknown, which would read as a 100% margin.
        expect(
          transaction.costMinor === null ||
            Number.isFinite(transaction.costMinor),
        ).toBe(true);
        if (transaction.costMinor === null) {
          expect(transaction.grossProfitMinor).toBeNull();
        } else {
          expect(transaction.grossProfitMinor).toBe(
            transaction.netSalesMinor - transaction.costMinor,
          );
        }
      }
    });
  });

  describe("weekly honesty", () => {
    it.each(WEEKDAY_SWEEP)("emits a live week-to-date only on %s", (today) => {
      const briefing = createSharedDemoWeeklyBriefing(today);
      expect(briefing.status).toBe("available");
      if (briefing.status !== "available") throw new Error("unreachable");

      expect(briefing.acceptedBaseline).toBeNull();
      expect(briefing.current.lifecyclePosture).toBe("live");
      expect(briefing.current.amendmentPosture).toBe("none");
      // Accepted-only fields are server-earned from a register close and an
      // observed-at cutoff. A client cannot produce them, so it must not.
      for (const field of [
        "closePosture",
        "amendment",
        "acceptedAt",
        "cutoffObservedAt",
        "closeId",
        "reportId",
      ]) {
        expect(field in briefing.current, field).toBe(false);
      }
    });

    it("splits the closed Sunday into the outside-schedule lane", () => {
      const sunday = "2026-08-09";
      const briefing = createSharedDemoWeeklyBriefing(sunday);
      if (briefing.status !== "available") throw new Error("unreachable");
      const lineage = briefing.current.scheduleLineage;

      expect(lineage.filter((entry) => entry.included)).toHaveLength(6);
      expect(lineage.at(-1)?.included).toBe(false);
      expect(lineage.at(-1)?.localDate).toBe(sunday);
      // Sunday sells nothing in the shared history, and today is always empty.
      expect(briefing.current.outsideSchedule.netSalesMinor).toBe(0);
      expect(briefing.current.total.netSalesMinor).toBe(
        briefing.current.included.netSalesMinor,
      );
      expect(briefing.current.ownerRoutes.dailyClose).toEqual({
        to: "/$orgUrlSlug/store/$storeUrlSlug/operations/daily-close",
        search: { operatingDate: "2026-08-08" },
      });
    });

    it("totals the week from the same day rows Reports lists", () => {
      const briefing = createSharedDemoWeeklyBriefing(TODAY);
      if (briefing.status !== "available") throw new Error("unreachable");
      const rows = createSharedDemoReportDays({
        startDate: briefing.current.cycleStartDate,
        endDate: TODAY,
        today: TODAY,
      });

      expect(briefing.current.total.netSalesMinor).toBe(
        rows.reduce((total, row) => total + row.netSalesMinor, 0),
      );
      expect(briefing.current.total.unitsSold).toBe(
        rows.reduce((total, row) => total + row.unitsSold, 0),
      );
      expect(briefing.current.completeness.complete).toBe(true);
      expect(briefing.current.totalCompleteness.complete).toBe(true);
      // Today is still open, so the week's close coverage is honestly partial.
      expect(briefing.current.variancePosture?.coverage).toBe("partial");
      expect(briefing.current.priorPeriod?.comparabilityReason).toBe(
        "comparable",
      );
      expect(briefing.current.priorPeriod?.netSalesChange).not.toBeNull();
    });
  });

  describe("overview", () => {
    it("compares week to date against the prior week without dividing by zero", () => {
      for (const today of WEEKDAY_SWEEP) {
        const overview = createSharedDemoReportsOverview(today);
        const { netSalesVsPriorWeekBp, unitsSoldVsPriorWeekBp } =
          overview.comparisons;

        for (const value of [netSalesVsPriorWeekBp, unitsSoldVsPriorWeekBp]) {
          expect(value === null || Number.isFinite(value), today).toBe(true);
        }
        expect(overview.currency).toBe("GHS");
        expect(overview.dailyTrend.length).toBeGreaterThan(0);
        expect(overview.dailyTrend.at(-1)?.operatingDate).toBe(today);
        expect(overview.dailyTrend.at(-1)?.status).toBe("open");
        // An in-progress day has no settled transaction count to report.
        expect(overview.dailyTrend.at(-1)?.transactionCount).toBeUndefined();
        expect(overview.trust.oldestUnreconciledDate).toBe(today);
        expect(overview.priorTrailing30.dayCount).toBe(0);
      }
    });

    it("keeps trailing windows consistent with the day rows", () => {
      const overview = createSharedDemoReportsOverview(TODAY);
      const rows = createSharedDemoReportDays({
        startDate: addDaysToDate(TODAY, -29),
        endDate: TODAY,
        today: TODAY,
      });

      expect(overview.trailing30.netSalesMinor).toBe(
        rows.reduce((total, row) => total + row.netSalesMinor, 0),
      );
      expect(overview.trailing30.dayCount).toBe(rows.length);
      expect(overview.yesterday.netSalesMinor).toBe(
        createSharedDemoReportDays({
          startDate: addDaysToDate(TODAY, -1),
          endDate: addDaysToDate(TODAY, -1),
          today: TODAY,
        })[0]!.netSalesMinor,
      );
    });
  });
});
