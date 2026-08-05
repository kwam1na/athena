import { describe, expect, it } from "vitest";

import type {
  ReportDayMetrics,
  ReportLiveOperatingDay,
  ReportSkuDayMetrics,
} from "~/shared/reportsContract";
import { SHARED_DEMO_PRODUCTS } from "~/shared/sharedDemoStory";
import {
  SHARED_DEMO_REPORTS_SKU_ID_PREFIX,
  toSharedDemoLiveReportsDay,
  toSharedDemoLiveSkuStock,
} from "./sharedDemoLiveReportsDay";

const TODAY = "2026-08-04";
const FIRST = SHARED_DEMO_PRODUCTS[0]!;
const SECOND = SHARED_DEMO_PRODUCTS[1]!;

function metrics(overrides: Partial<ReportDayMetrics> = {}): ReportDayMetrics {
  return {
    grossSalesMinor: 12_000,
    netSalesMinor: 12_000,
    refundsMinor: 0,
    unitsSold: 6,
    unitsReturned: 0,
    uncostedRevenueMinor: 0,
    grossProfitMinor: 4_000,
    paymentsCollectedMinor: 12_000,
    paymentsRefundedMinor: 0,
    paymentAllocatedMinor: 12_000,
    ...overrides,
  };
}

function skuMetrics(overrides: Partial<ReportSkuDayMetrics> = {}): ReportSkuDayMetrics {
  return {
    unitsSold: 3,
    unitsReturned: 0,
    grossSalesMinor: 6_000,
    netSalesMinor: 6_000,
    refundsMinor: 0,
    uncostedRevenueMinor: 0,
    grossProfitMinor: 2_000,
    ...overrides,
  };
}

function liveResult(
  overrides: Partial<ReportLiveOperatingDay> = {},
): ReportLiveOperatingDay {
  return {
    day: {
      currency: "GHS",
      factCount: 9,
      lastFactRecordedAt: 1_780_000_000_000,
      metrics: metrics(),
      status: "open" as const,
    },
    operatingDate: TODAY,
    skus: [
      {
        metrics: skuMetrics(),
        productSkuId: "kg2realconvexid",
        sku: FIRST.sku,
      },
    ],
    ...overrides,
  };
}

describe("toSharedDemoLiveReportsDay", () => {
  it("returns null while the query is still loading", () => {
    expect(
      toSharedDemoLiveReportsDay({ result: undefined, today: TODAY }),
    ).toBeNull();
    expect(toSharedDemoLiveReportsDay({ result: null, today: TODAY })).toBeNull();
  });

  it("discards a payload for any day other than today", () => {
    // The fixture owns every date before today. A stray live row — a late
    // fact, a clock disagreement — must never shadow the shared history.
    expect(
      toSharedDemoLiveReportsDay({
        result: liveResult({ operatingDate: "2026-08-03" }),
        today: TODAY,
      }),
    ).toBeNull();
  });

  it("reads an untouched day as a real, empty open day", () => {
    // Not null: the day EXISTS and has sold nothing yet, which is exactly
    // what the demo should show before the first sale of the session.
    const live = toSharedDemoLiveReportsDay({
      result: liveResult({ day: null, skus: [] }),
      today: TODAY,
    });

    expect(live).toMatchObject({
      factCount: 0,
      operatingDate: TODAY,
      status: "open",
      transactionCount: 0,
    });
    expect(live?.metrics.netSalesMinor).toBe(0);
    expect(live?.metrics.grossProfitMinor).toBe(0);
    expect(live?.skus).toEqual([]);
  });

  it("carries the live day's metrics through unchanged", () => {
    const live = toSharedDemoLiveReportsDay({
      result: liveResult(),
      today: TODAY,
    });

    expect(live?.metrics).toEqual(metrics());
    expect(live?.factCount).toBe(9);
    expect(live?.updatedAt).toBe(1_780_000_000_000);
    expect(live?.status).toBe("open");
  });

  it("rewrites catalogue codes into fixture sku ids", () => {
    // Nothing downstream may see a Convex id: `isSharedDemoReportsSkuId` is
    // the gate that keeps route params away from the throwing resolvers.
    const live = toSharedDemoLiveReportsDay({
      result: liveResult(),
      today: TODAY,
    });

    expect(live?.skus).toEqual([
      [`${SHARED_DEMO_REPORTS_SKU_ID_PREFIX}${FIRST.slug}`, skuMetrics()],
    ]);
    // The identity space carries no Convex id. The real id survives only in
    // the separate query-argument lookup, which is never rendered.
    expect(JSON.stringify(live?.skus)).not.toContain("kg2realconvexid");
    expect(
      live?.querySkuIdByFixtureSkuId.get(
        `${SHARED_DEMO_REPORTS_SKU_ID_PREFIX}${FIRST.slug}`,
      ),
    ).toBe("kg2realconvexid");
  });

  it("drops an unmappable sku row but keeps its revenue in the day", () => {
    // A quick-add SKU has no catalogue story to resolve. Its money is already
    // inside the day's own metrics, so the day stays whole while the mix
    // simply cannot attribute it.
    const live = toSharedDemoLiveReportsDay({
      result: liveResult({
        skus: [
          { metrics: skuMetrics(), productSkuId: "kg2a", sku: FIRST.sku },
          { metrics: skuMetrics(), productSkuId: "kg2b", sku: "QUICK-ADD-1" },
          { metrics: skuMetrics(), productSkuId: "kg2c", sku: null },
        ],
      }),
      today: TODAY,
    });

    expect(live?.skus).toHaveLength(1);
    expect(live?.metrics.netSalesMinor).toBe(12_000);
  });

  it("folds repeated rows for one catalogue code together", () => {
    const live = toSharedDemoLiveReportsDay({
      result: liveResult({
        skus: [
          { metrics: skuMetrics(), productSkuId: "kg2a", sku: FIRST.sku },
          {
            metrics: skuMetrics({ netSalesMinor: 1_000, unitsSold: 1 }),
            productSkuId: "kg2b",
            sku: FIRST.sku,
          },
        ],
      }),
      today: TODAY,
    });

    expect(live?.skus).toHaveLength(1);
    expect(live?.skus[0]![1]).toMatchObject({
      netSalesMinor: 7_000,
      unitsSold: 4,
    });
  });

  it("maps every product in the demo catalogue", () => {
    const live = toSharedDemoLiveReportsDay({
      result: liveResult({
        skus: SHARED_DEMO_PRODUCTS.map((product, index) => ({
          metrics: skuMetrics(),
          productSkuId: `kg2-${index}`,
          sku: product.sku,
        })),
      }),
      today: TODAY,
    });

    expect(live?.skus).toHaveLength(SHARED_DEMO_PRODUCTS.length);
    expect(live?.skus.map(([id]) => id)).toContain(
      `${SHARED_DEMO_REPORTS_SKU_ID_PREFIX}${SECOND.slug}`,
    );
  });

  it("reports no settled transaction count for an open day", () => {
    // Same rule the server applies: a day with no close has no settled count
    // (`reports/transactionCounts.ts`). Inventing one would overstate it.
    const live = toSharedDemoLiveReportsDay({
      result: liveResult(),
      today: TODAY,
    });

    expect(live?.transactionCount).toBe(0);
  });
});

describe("toSharedDemoLiveSkuStock", () => {
  it("returns null while the read is still settling", () => {
    // Null, not an empty map: "no stock known yet" must stay distinguishable
    // from "every SKU is out of stock".
    expect(toSharedDemoLiveSkuStock(undefined)).toBeNull();
    // A payload that is not a settled array is equally "not known yet".
    expect(toSharedDemoLiveSkuStock({} as never)).toBeNull();
  });

  it("keys current stock by fixture sku id", () => {
    const stock = toSharedDemoLiveSkuStock([
      { quantityAvailable: 7, sku: FIRST.sku },
      { quantityAvailable: 3, sku: SECOND.sku },
    ]);

    expect(
      stock?.get(`${SHARED_DEMO_REPORTS_SKU_ID_PREFIX}${FIRST.slug}`),
    ).toBe(7);
    expect(
      stock?.get(`${SHARED_DEMO_REPORTS_SKU_ID_PREFIX}${SECOND.slug}`),
    ).toBe(3);
  });

  it("keeps a genuine zero rather than dropping it", () => {
    // Sold out is a fact worth showing; a falsy check here would hide it.
    const stock = toSharedDemoLiveSkuStock([
      { quantityAvailable: 0, sku: FIRST.sku },
    ]);

    expect(
      stock?.get(`${SHARED_DEMO_REPORTS_SKU_ID_PREFIX}${FIRST.slug}`),
    ).toBe(0);
  });

  it("ignores a code outside the demo catalogue", () => {
    const stock = toSharedDemoLiveSkuStock([
      { quantityAvailable: 5, sku: "QUICK-ADD-1" },
    ]);

    expect(stock?.size).toBe(0);
  });
});
