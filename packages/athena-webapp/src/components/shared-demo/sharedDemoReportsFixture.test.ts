import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { getLocalOperatingDate } from "@/lib/operations/operatingDate";
import {
  movementAbsNetUnitsSortKey,
  movementPageCount,
  REPORT_MOVEMENT_PAGE_SIZE,
  REPORT_SKU_PAGE_SIZE,
  trailingSixMonthsStart,
  unitsPerTransaction,
} from "~/shared/reportsContract";
import { SHARED_DEMO_PRODUCTS } from "~/shared/sharedDemoStory";
import type { SharedDemoLiveReportsDay } from "./sharedDemoLiveReportsDay";
import {
  getSharedDemoHistoricalDayFixture,
  getSharedDemoHistoryStartOperatingDate,
  SHARED_DEMO_HISTORY_DAYS,
} from "./sharedDemoOperationsFixture";
import { createSharedDemoTransactionFixtures } from "./sharedDemoTransactionsFixture";
import {
  createSharedDemoPeriodSkus,
  createSharedDemoReportDays,
  createSharedDemoReportMixLifecycle,
  createSharedDemoReportMovementPage,
  createSharedDemoReportSkuMix,
  createSharedDemoReportSkuMovement,
  createSharedDemoReportsOverview,
  createSharedDemoSkuDayTransactions,
  createSharedDemoSkuDetail,
  createSharedDemoWeeklyBriefing,
  isSharedDemoReportsSkuId,
  rankSignedMovementRows,
  SHARED_DEMO_REPORTS_LIVE_SKU_ID_PREFIX,
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
        const movement = createSharedDemoReportSkuMovement({
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
          ["movement", movement],
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

      const movement = createSharedDemoReportSkuMovement({
        startDate,
        endDate,
        today: TODAY,
      });
      expect(movement.rows).toHaveLength(SHARED_DEMO_PRODUCTS.length);
      expect(movement.rows.some((row) => row.key === "other")).toBe(false);
      expect(movement.totalUnitsSold).toBe(totalUnits);
      expect(movement.netUnits).toBe(
        movement.totalUnitsSold - movement.totalUnitsReturned,
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

    it("reports stock from the live rows, never the story constant", () => {
      // The demo's real `productSku` rows are decremented by a visitor's sale
      // like any other store's, so a fixed catalogue number would contradict
      // the stock the same visitor just moved.
      const skuId = skuIdFor("demo-shea-butter");
      const detail = createSharedDemoSkuDetail({
        productSkuId: skuId,
        startDate: addDaysToDate(TODAY, -6),
        endDate: TODAY,
        liveStock: new Map([[skuId, { identity: null, quantityAvailable: 4 }]]),
        today: TODAY,
      })!;

      expect(detail.identity?.quantityAvailable).toBe(4);
    });

    it("keeps a sold-out zero rather than falling back", () => {
      const skuId = skuIdFor("demo-shea-butter");
      const detail = createSharedDemoSkuDetail({
        productSkuId: skuId,
        startDate: addDaysToDate(TODAY, -6),
        endDate: TODAY,
        liveStock: new Map([[skuId, { identity: null, quantityAvailable: 0 }]]),
        today: TODAY,
      })!;

      expect(detail.identity?.quantityAvailable).toBe(0);
    });

    it("omits stock entirely until the live read settles", () => {
      // Absent, not a story constant: an unknown figure must not render as a
      // confident one that the next tick contradicts.
      const detail = createSharedDemoSkuDetail({
        productSkuId: skuIdFor("demo-shea-butter"),
        startDate: addDaysToDate(TODAY, -6),
        endDate: TODAY,
        today: TODAY,
      })!;

      expect(detail.identity).toBeDefined();
      expect(detail.identity?.quantityAvailable).toBeUndefined();
    });

    it("identifies the owning product the way the product route resolves it", () => {
      // `identity.productId` exists to link out to the product detail page,
      // and that route resolves its param by id OR slug against the store's
      // real rows (`inventory/products:getByIdOrSlug`). The demo's provisioned
      // product carries the story slug, so the slug is what resolves — a
      // fixture-invented id matches nothing and renders "This product has
      // been deleted".
      for (const product of SHARED_DEMO_PRODUCTS) {
        const detail = createSharedDemoSkuDetail({
          productSkuId: skuIdFor(product.slug),
          startDate: addDaysToDate(TODAY, -6),
          endDate: TODAY,
          today: TODAY,
        })!;

        expect(detail.identity?.productId, product.slug).toBe(product.slug);
        expect(detail.identity?.productId, product.slug).not.toMatch(
          /^shared-demo-product-/,
        );
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

    it("routes the EOD review to the last CLOSED day, not the last scheduled one", () => {
      // Mid-week, the final scheduled date has not happened yet and today is
      // still open. Routing to either would land an owner on a review that
      // does not exist — the link says "View EOD Review".
      const thursday = "2026-08-06";
      const briefing = createSharedDemoWeeklyBriefing(thursday);
      if (briefing.status !== "available") throw new Error("unreachable");
      const lineage = briefing.current.scheduleLineage;

      // The week still SCHEDULES through Saturday, and today is open.
      expect(lineage.filter((entry) => entry.included).at(-1)?.localDate).toBe(
        "2026-08-08",
      );
      expect(
        lineage.find((entry) => entry.localDate === thursday)?.dayStatus,
      ).toBe("open");
      expect(
        lineage.find((entry) => entry.localDate === thursday)?.dayClosed,
      ).toBe(false);

      expect(briefing.current.ownerRoutes.dailyClose).toEqual({
        to: "/$orgUrlSlug/store/$storeUrlSlug/operations/daily-close",
        search: { operatingDate: "2026-08-05" },
      });
    });

    it("omits the EOD review link when no day in the week is closed", () => {
      // Monday: the only scheduled day on record is today, and it is open.
      // The weekly view renders no link rather than a dead one.
      const monday = "2026-08-03";
      const briefing = createSharedDemoWeeklyBriefing(monday);
      if (briefing.status !== "available") throw new Error("unreachable");

      expect(
        briefing.current.scheduleLineage.every((entry) => !entry.dayClosed),
      ).toBe(true);
      expect(briefing.current.ownerRoutes.dailyClose).toBeNull();
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

    it("renders the trailing six-month window from the same 21 days trailing30 already does (U6 horizon convention)", () => {
      const overview = createSharedDemoReportsOverview(TODAY);
      const sixMonthsStart = trailingSixMonthsStart(TODAY);
      const rows = createSharedDemoReportDays({
        startDate: sixMonthsStart,
        endDate: TODAY,
        today: TODAY,
      });

      expect(overview.trailing6Months.netSalesMinor).toBe(
        rows.reduce((total, row) => total + row.netSalesMinor, 0),
      );
      expect(overview.trailing6Months.unitsSold).toBe(
        rows.reduce((total, row) => total + row.unitsSold, 0),
      );
      expect(overview.trailing6Months.dayCount).toBe(rows.length);
      // The demo horizon (21 days + the open current day) is far shorter than
      // any six-month window, so the six-month snapshot can only ever see
      // every day the fixture holds — the same partial data trailing30
      // already renders from, per the established demo convention.
      expect(overview.trailing6Months.dayCount).toBe(
        SHARED_DEMO_HISTORY_DAYS + 1,
      );
      expect(overview.trailing6Months).toEqual(overview.trailing30);
      // The prior six-month window ends well before the fixture's history
      // starts, so it is legitimately empty — not a truncation bug.
      expect(overview.priorTrailing6Months.dayCount).toBe(0);
    });
  });

  describe("SKU mix lifecycle (U6)", () => {
    const dates = historyDates(TODAY);
    const fullRangeStart = dates[0]!;
    const fullRangeEnd = dates.at(-1)!;

    it("is pure/local: no Convex imports, no network", () => {
      const modulePath = join(
        process.cwd(),
        "src/components/shared-demo/sharedDemoReportsFixture.ts",
      );
      const source = readFileSync(modulePath, "utf8");
      expect(source).not.toMatch(/from ["']convex\//);
      expect(source).not.toMatch(/ConvexReactClient|useQuery|useMutation|fetch\(/);
    });

    it("parity: matches createSharedDemoReportSkuMix's rows, totals, and SKU count on the same range", () => {
      const legacy = createSharedDemoReportSkuMix({
        startDate: fullRangeStart,
        endDate: fullRangeEnd,
        today: TODAY,
      });
      const lifecycle = createSharedDemoReportMixLifecycle({
        startDate: fullRangeStart,
        endDate: fullRangeEnd,
        today: TODAY,
      });

      expect(lifecycle.data).toEqual(legacy);
      expect(lifecycle.lifecycle.state).toBe("completed");
      expect(lifecycle.lifecycle.totals).toEqual({
        totalUnitsSold: legacy.totalUnitsSold,
        skuCount: legacy.skuCount,
      });
      expect(lifecycle.lifecycle.completedAt).toBeGreaterThan(0);
    });

    it("is immediately completed and deterministic across calls", () => {
      const first = createSharedDemoReportMixLifecycle({
        startDate: fullRangeStart,
        endDate: fullRangeEnd,
        today: TODAY,
      });
      const second = createSharedDemoReportMixLifecycle({
        startDate: fullRangeStart,
        endDate: fullRangeEnd,
        today: TODAY,
      });

      expect(first).toEqual(second);
      expect(first.lifecycle.state).toBe("completed");
    });

    it("Other bucket: absent when every SKU with activity fits in the top 5", () => {
      // A single historical day sells at most a handful of the 8 demo SKUs,
      // so this range is a plausible day where visible rows already cover
      // every active SKU and the Other bucket is legitimately absent.
      const singleDay = dates[0]!;
      const lifecycle = createSharedDemoReportMixLifecycle({
        startDate: singleDay,
        endDate: singleDay,
        today: TODAY,
      });

      if (lifecycle.data.skuCount <= 5) {
        expect(lifecycle.data.rows.some((row) => row.key === "other")).toBe(
          false,
        );
      }
      expect(lifecycle.data.rows.length).toBeLessThanOrEqual(6);
    });

    it("Other bucket: present and dominant-shaped when the full catalogue is active over 21 days", () => {
      const lifecycle = createSharedDemoReportMixLifecycle({
        startDate: fullRangeStart,
        endDate: fullRangeEnd,
        today: TODAY,
      });

      // 8 demo SKUs over 21 days activate every SKU; the top 5 plus Other
      // covers the full catalogue and Other's share is the complement of the
      // visible rows' share.
      expect(lifecycle.data.skuCount).toBe(SHARED_DEMO_PRODUCTS.length);
      const other = lifecycle.data.rows.find((row) => row.key === "other");
      expect(other).toBeDefined();
      expect(other?.productSkuId).toBeUndefined();
      expect(other?.identity).toBeUndefined();
      const visibleShare = lifecycle.data.rows
        .filter((row) => row.key !== "other")
        .reduce((total, row) => total + row.shareBasisPoints, 0);
      expect(visibleShare + (other?.shareBasisPoints ?? 0)).toBeLessThanOrEqual(
        10_000,
      );
      expect(
        lifecycle.data.rows.reduce((total, row) => total + row.unitsSold, 0),
      ).toBe(lifecycle.data.totalUnitsSold);
    });
  });

  describe("movement page (U4)", () => {
    const dates = historyDates(TODAY);
    const startDate = dates[0]!;
    const endDate = dates.at(-1)!;

    it("is pure/local: no Convex imports, no network", () => {
      const modulePath = join(
        process.cwd(),
        "src/components/shared-demo/sharedDemoReportsFixture.ts",
      );
      const source = readFileSync(modulePath, "utf8");
      expect(source).not.toMatch(/from ["']convex\//);
      expect(source).not.toMatch(/ConvexReactClient|useQuery|useMutation|fetch\(/);
    });

    it("parity: page-1 ordering/count/totals match the legacy full movement data recomputed under absolute-net ordering", () => {
      const legacy = createSharedDemoReportSkuMovement({
        startDate,
        endDate,
        today: TODAY,
      });
      const page = createSharedDemoReportMovementPage({
        startDate,
        endDate,
        page: 1,
        today: TODAY,
      });

      const expectedOrder = [...legacy.rows].sort(
        (left, right) =>
          movementAbsNetUnitsSortKey(left.netUnits) -
            movementAbsNetUnitsSortKey(right.netUnits) ||
          left.productSkuId.localeCompare(right.productSkuId),
      );

      expect(page.lifecycle.state).toBe("completed");
      expect(page.lifecycle.totals.skuCount).toBe(legacy.skuCount);
      expect(page.lifecycle.totals.unitsSold).toBe(legacy.totalUnitsSold);
      expect(page.lifecycle.totals.unitsReturned).toBe(
        legacy.totalUnitsReturned,
      );
      expect(page.lifecycle.totals.netUnits).toBe(legacy.netUnits);
      expect(page.lifecycle.pageCount).toBe(
        movementPageCount(legacy.skuCount),
      );
      expect(page.page).toBe(1);
      expect(page.rows.map((row) => row.productSkuId)).toEqual(
        expectedOrder
          .slice(0, REPORT_MOVEMENT_PAGE_SIZE)
          .map((row) => row.productSkuId),
      );
    });

    it("direction: net-return SKUs keep negative netUnits and rank by magnitude among positives (synthetic — the demo catalogue never returns a unit)", () => {
      const ranked = rankSignedMovementRows([
        { productSkuId: "sku-big-return", unitsSold: 2, unitsReturned: 26 },
        { productSkuId: "sku-small-sale", unitsSold: 5, unitsReturned: 0 },
        { productSkuId: "sku-big-sale", unitsSold: 18, unitsReturned: 0 },
      ]);

      expect(ranked.map((row) => row.productSkuId)).toEqual([
        "sku-big-return",
        "sku-big-sale",
        "sku-small-sale",
      ]);
      expect(ranked[0]!.netUnits).toBe(-24);
      expect(ranked[0]!.netUnits).toBeLessThan(0);
      expect(ranked[1]!.netUnits).toBe(18);
    });

    it("zero-net: a SKU with equal sold and returned units stays in count and ordering (synthetic)", () => {
      const ranked = rankSignedMovementRows([
        { productSkuId: "sku-cancelled", unitsSold: 4, unitsReturned: 4 },
        { productSkuId: "sku-active", unitsSold: 1, unitsReturned: 0 },
        { productSkuId: "sku-untouched", unitsSold: 0, unitsReturned: 0 },
      ]);

      expect(ranked.map((row) => row.productSkuId)).toEqual([
        "sku-active",
        "sku-cancelled",
      ]);
      expect(ranked.find((row) => row.productSkuId === "sku-cancelled")!.netUnits).toBe(0);
      expect(
        ranked.some((row) => row.productSkuId === "sku-untouched"),
      ).toBe(false);
    });

    it("pagination: deterministic, bounded to 20, and consistent with movementPageCount", () => {
      const first = createSharedDemoReportMovementPage({
        startDate,
        endDate,
        page: 1,
        today: TODAY,
      });
      const again = createSharedDemoReportMovementPage({
        startDate,
        endDate,
        page: 1,
        today: TODAY,
      });

      expect(again).toEqual(first);
      expect(first.rows.length).toBeLessThanOrEqual(REPORT_MOVEMENT_PAGE_SIZE);
      expect(first.lifecycle.pageCount).toBe(
        movementPageCount(first.lifecycle.totals.skuCount),
      );
      // The demo catalogue has 8 SKUs — under one page, so page 1 is also the
      // (short) last page.
      expect(first.lifecycle.pageCount).toBe(1);
      expect(first.rows.length).toBe(first.lifecycle.totals.skuCount);
    });

    it("pagination: out-of-range pages canonicalize to the nearest valid page", () => {
      const pageCount = createSharedDemoReportMovementPage({
        startDate,
        endDate,
        today: TODAY,
      }).lifecycle.pageCount;

      for (const requested of [0, -1, -100, 0.5, NaN, Infinity, 9_999]) {
        const page = createSharedDemoReportMovementPage({
          startDate,
          endDate,
          page: requested,
          today: TODAY,
        });
        expect(page.page).toBeGreaterThanOrEqual(1);
        expect(page.page).toBeLessThanOrEqual(pageCount);
      }

      expect(
        createSharedDemoReportMovementPage({
          startDate,
          endDate,
          page: 9_999,
          today: TODAY,
        }).page,
      ).toBe(pageCount);
    });

    it("top movers (page 1) rows are a prefix of the same absolute-net ordering", () => {
      const topMovers = createSharedDemoReportMovementPage({
        startDate,
        endDate,
        today: TODAY,
      });
      const fullyRanked = rankSignedMovementRows(
        createSharedDemoReportSkuMovement({
          startDate,
          endDate,
          today: TODAY,
        }).rows.map((row) => ({
          productSkuId: row.productSkuId,
          unitsSold: row.unitsSold,
          unitsReturned: row.unitsReturned,
        })),
      );

      expect(topMovers.page).toBe(1);
      expect(topMovers.rows.map((row) => row.productSkuId)).toEqual(
        fullyRanked
          .slice(0, REPORT_MOVEMENT_PAGE_SIZE)
          .map((row) => row.productSkuId),
      );
    });
  });

describe("live current day", () => {
  const LIVE_SKU_ID = skuIdFor(SHARED_DEMO_PRODUCTS[0]!.slug);

  function liveDay(
    overrides: Partial<SharedDemoLiveReportsDay> = {},
  ): SharedDemoLiveReportsDay {
    return {
      factCount: 5,
      metrics: {
        grossSalesMinor: 48_000,
        netSalesMinor: 48_000,
        refundsMinor: 0,
        unitsSold: 12,
        unitsReturned: 0,
        uncostedRevenueMinor: 0,
        grossProfitMinor: 16_000,
        paymentsCollectedMinor: 48_000,
        paymentsRefundedMinor: 0,
        paymentAllocatedMinor: 48_000,
      },
      operatingDate: TODAY,
      querySkuIdByFixtureSkuId: new Map(),
      liveSkuIdentityById: new Map(),
      skus: [
        [
          LIVE_SKU_ID,
          {
            unitsSold: 12,
            unitsReturned: 0,
            grossSalesMinor: 48_000,
            netSalesMinor: 48_000,
            refundsMinor: 0,
            uncostedRevenueMinor: 0,
            grossProfitMinor: 16_000,
          },
        ],
      ],
      status: "open",
      transactionCount: 0,
      updatedAt: 1_780_000_000_000,
      ...overrides,
    };
  }

  describe("a sku created at the register", () => {
    // POS quick add mints a real `productSku` that no story describes. It is a
    // genuine part of the visitor's day, so Reports names it from the identity
    // the live reads carry rather than declining to show it at all.
    const QUICK_ADD_SKU_ID = `${SHARED_DEMO_REPORTS_LIVE_SKU_ID_PREFIX}kg2quickadd`;
    const QUICK_ADD_METRICS = {
      unitsSold: 4,
      unitsReturned: 0,
      grossSalesMinor: 2_000,
      netSalesMinor: 2_000,
      refundsMinor: 0,
      uncostedRevenueMinor: 2_000,
      grossProfitMinor: null,
    };
    const QUICK_ADD_IDENTITY = {
      displayName: "Bottled Water",
      netPriceMinor: 500,
      productId: "jd7quickaddproduct",
      quantityAvailable: 11,
      sku: "QUICK-ADD-1",
      // Priced at the register, never costed.
      unitCostMinor: null,
    };

    function quickAddDay() {
      return liveDay({
        querySkuIdByFixtureSkuId: new Map([[QUICK_ADD_SKU_ID, "kg2quickadd"]]),
        liveSkuIdentityById: new Map([[QUICK_ADD_SKU_ID, QUICK_ADD_IDENTITY]]),
        skus: [[QUICK_ADD_SKU_ID, QUICK_ADD_METRICS]],
      });
    }

    it("names it in the day's sku mix", () => {
      const mix = createSharedDemoReportSkuMix({
        startDate: TODAY,
        endDate: TODAY,
        liveDay: quickAddDay(),
        today: TODAY,
      });
      const row = mix.rows.find((entry) => entry.productSkuId === QUICK_ADD_SKU_ID);

      expect(row).toBeDefined();
      expect(row?.identity?.displayName).toBe("Bottled Water");
      expect(row?.unitsSold).toBe(4);
    });

    it("makes the mix sum to the day it belongs to", () => {
      // The gap this closes: its money was always in the day's totals, so a
      // breakdown that omitted it could never sum to the number beside it.
      const mix = createSharedDemoReportSkuMix({
        startDate: TODAY,
        endDate: TODAY,
        liveDay: quickAddDay(),
        today: TODAY,
      });

      expect(mix.totalUnitsSold).toBe(4);
      expect(
        mix.rows.reduce((total, row) => total + row.unitsSold, 0),
      ).toBe(4);
    });

    it("gives it a detail page rather than an empty one", () => {
      const detail = createSharedDemoSkuDetail({
        productSkuId: QUICK_ADD_SKU_ID,
        startDate: addDaysToDate(TODAY, -6),
        endDate: TODAY,
        liveDay: quickAddDay(),
        today: TODAY,
      });

      expect(detail).not.toBeNull();
      expect(detail?.identity?.displayName).toBe("Bottled Water");
      expect(detail?.identity?.netPriceMinor).toBe(500);
      expect(detail?.identity?.quantityAvailable).toBe(11);
      // No cost basis, so no invented margin: the revenue is disclosed as
      // uncosted instead.
      expect(detail?.identity?.unitCostMinor).toBeUndefined();
      expect(detail?.totals?.grossProfitMinor).toBeNull();
      expect(detail?.totals?.uncostedRevenueMinor).toBe(2_000);
      // It exists only from today: the fixture history never contained it.
      expect(detail?.days.map((day) => day.operatingDate)).toEqual([TODAY]);
    });

    it("is a shared-demo sku id, so no route param reaches a story lookup", () => {
      expect(isSharedDemoReportsSkuId(QUICK_ADD_SKU_ID)).toBe(true);
      expect(isSharedDemoReportsSkuId("kg2rawconvexid")).toBe(false);
    });

    it("has no fixture evidence, deferring to the live read for today", () => {
      // The 21-day history contains story SKUs only, so the detail view reads
      // today's evidence from the server via `querySkuIdByFixtureSkuId`.
      expect(
        createSharedDemoSkuDayTransactions({
          productSkuId: QUICK_ADD_SKU_ID,
          operatingDate: TODAY,
          liveDay: quickAddDay(),
          today: TODAY,
        }),
      ).toEqual({ transactions: [], truncated: false });
      expect(
        quickAddDay().querySkuIdByFixtureSkuId.get(QUICK_ADD_SKU_ID),
      ).toBe("kg2quickadd");
    });

    it("still refuses an id in neither space", () => {
      expect(
        createSharedDemoSkuDetail({
          productSkuId: "kg2rawconvexid",
          startDate: addDaysToDate(TODAY, -6),
          endDate: TODAY,
          liveDay: quickAddDay(),
          today: TODAY,
        }),
      ).toBeNull();
    });
  });

  it("counts today's live transactions toward the basket size", () => {
    // Parity with a real store: the live day carries its own running count,
    // so the demo's units-per-sale moves during the trading day instead of
    // waiting on a close that a demo visitor never performs.
    const overview = createSharedDemoReportsOverview(
      TODAY,
      liveDay({ transactionCount: 3 }),
    );

    expect(overview.today.transactionCount).toBe(3);
    expect(overview.today.transactionCoveredDayCount).toBe(
      overview.today.dayCount,
    );
    expect(unitsPerTransaction(overview.today)).toBeCloseTo(12 / 3, 5);
  });

  it("reports an untouched live day as a real zero, not as unknown", () => {
    // Zero transactions on a day that exists is a measurement. Coverage stays
    // whole, and the basket is withheld for want of a denominator — not for
    // want of evidence.
    const overview = createSharedDemoReportsOverview(
      TODAY,
      liveDay({ transactionCount: 0 }),
    );

    expect(overview.today.transactionCount).toBe(0);
    expect(overview.today.transactionCoveredDayCount).toBe(
      overview.today.dayCount,
    );
    expect(unitsPerTransaction(overview.today)).toBeNull();
  });

  it("moves today's snapshot off zero without touching the history", () => {
    const withLive = createSharedDemoReportsOverview(TODAY, liveDay());
    const withoutLive = createSharedDemoReportsOverview(TODAY);

    expect(withLive.today.netSalesMinor).toBe(48_000);
    expect(withLive.today.unitsSold).toBe(12);
    expect(withLive.today.dayCount).toBe(1);
    expect(withLive.today.unsettledDayCount).toBe(1);
    expect(withLive.yesterday).toEqual(withoutLive.yesterday);
    expect(withLive.priorWeek).toEqual(withoutLive.priorWeek);
  });

  it("keeps the current day open and unsettled", () => {
    const overview = createSharedDemoReportsOverview(TODAY, liveDay());
    const anchor = overview.dailyTrend.at(-1);

    expect(anchor?.operatingDate).toBe(TODAY);
    expect(anchor?.status).toBe("open");
    expect(anchor?.netSalesMinor).toBe(48_000);
    expect(anchor?.unitsSold).toBe(12);
    // An open day still has no settled transaction count to report.
    expect(anchor).not.toHaveProperty("transactionCount");
  });

  it("carries the live day into every window that contains it", () => {
    const withLive = createSharedDemoReportsOverview(TODAY, liveDay());
    const withoutLive = createSharedDemoReportsOverview(TODAY);

    for (const window of ["weekToDate", "trailing30", "trailing3Months"] as const) {
      expect(withLive[window].netSalesMinor).toBe(
        withoutLive[window].netSalesMinor + 48_000,
      );
      expect(withLive[window].unitsSold).toBe(
        withoutLive[window].unitsSold + 12,
      );
    }
  });

  it("shows the live numbers on the days rail", () => {
    const rows = createSharedDemoReportDays({
      startDate: addDaysToDate(TODAY, -2),
      endDate: TODAY,
      liveDay: liveDay(),
      today: TODAY,
    });
    const todayRow = rows.at(-1);

    expect(todayRow?.operatingDate).toBe(TODAY);
    expect(todayRow?.status).toBe("open");
    expect(todayRow?.netSalesMinor).toBe(48_000);
    expect(todayRow?.factCount).toBe(5);
    expect(todayRow).not.toHaveProperty("closeVarianceMinor");
  });

  it("attributes the live day's units in the sku mix", () => {
    const range = { endDate: TODAY, startDate: TODAY };
    const withLive = createSharedDemoReportSkuMix({
      ...range,
      liveDay: liveDay(),
      today: TODAY,
    });
    const withoutLive = createSharedDemoReportSkuMix({
      ...range,
      today: TODAY,
    });

    expect(withoutLive.rows).toHaveLength(0);
    expect(withLive.rows.map((row) => row.productSkuId)).toEqual([LIVE_SKU_ID]);
    expect(withLive.rows[0]!.unitsSold).toBe(12);
  });

  it("ranks the live day's sku inside the items period", () => {
    const result = createSharedDemoPeriodSkus({
      periodKey: `d:${TODAY}`,
      liveDay: liveDay(),
      sortBy: "revenue",
      today: TODAY,
    });

    expect(result.totalNetSalesMinor).toBe(48_000);
    expect(result.totalUnitsSold).toBe(12);
    expect(result.isTodayInProgress).toBe(true);
    expect(result.rows[0]!.productSkuId).toBe(LIVE_SKU_ID);
    expect(result.rows[0]!.identity?.sku).toBe(SHARED_DEMO_PRODUCTS[0]!.sku);
  });

  it("reports the live day as the freshest thing reporting has seen", () => {
    // `updatedAt` is a high-water mark, so a live sale advances it and a
    // stale live payload can never drag it back behind the history.
    const historyUpdatedAt = createSharedDemoReportsOverview(TODAY).updatedAt;
    const newer = historyUpdatedAt + 60_000;

    expect(
      createSharedDemoReportsOverview(TODAY, liveDay({ updatedAt: newer }))
        .updatedAt,
    ).toBe(newer);
    expect(
      createSharedDemoReportsOverview(TODAY, liveDay({ updatedAt: 0 }))
        .updatedAt,
    ).toBe(historyUpdatedAt);
  });

  it("ignores a live payload aimed at a day outside the rail", () => {
    const stray = liveDay({ operatingDate: "2020-01-01" });

    expect(createSharedDemoReportsOverview(TODAY, stray)).toEqual(
      createSharedDemoReportsOverview(TODAY),
    );
  });

  it("never lets a live merge leak into a later fixture-only read", () => {
    // The history model is cached per `today`; the live day is folded on top
    // per call. A merge that mutated the cache would poison every later read.
    createSharedDemoReportsOverview(TODAY, liveDay());

    expect(createSharedDemoReportsOverview(TODAY).today.netSalesMinor).toBe(0);
    expect(
      createSharedDemoReportDays({
        startDate: TODAY,
        endDate: TODAY,
        today: TODAY,
      })[0]!.netSalesMinor,
    ).toBe(0);
  });

  it("keeps the weekly briefing's current cycle whole", () => {
    const withLive = createSharedDemoWeeklyBriefing(TODAY, liveDay());
    const withoutLive = createSharedDemoWeeklyBriefing(TODAY);
    if (withLive.status !== "available" || withoutLive.status !== "available") {
      throw new Error("unreachable");
    }

    expect(withLive.current.total.netSalesMinor).toBe(
      withoutLive.current.total.netSalesMinor + 48_000,
    );
    expect(withLive.current.scheduleLineage).toHaveLength(7);
    expect(withLive.current.cycleStartDate).toBe(
      withoutLive.current.cycleStartDate,
    );
  });
});
});
