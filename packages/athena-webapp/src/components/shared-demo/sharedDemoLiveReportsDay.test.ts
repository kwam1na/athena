import { describe, expect, it } from "vitest";

import type {
  ReportDayMetrics,
  ReportLiveOperatingDay,
  ReportLiveSkuIdentity,
  ReportSkuDayMetrics,
} from "~/shared/reportsContract";
import { SHARED_DEMO_PRODUCTS } from "~/shared/sharedDemoStory";
import {
  SHARED_DEMO_REPORTS_LIVE_SKU_ID_PREFIX,
  SHARED_DEMO_REPORTS_SKU_ID_PREFIX,
  toSharedDemoLiveReportsDay,
  toSharedDemoLiveSkuStock,
} from "./sharedDemoLiveReportsDay";

const TODAY = "2026-08-04";
const FIRST = SHARED_DEMO_PRODUCTS[0]!;
const SECOND = SHARED_DEMO_PRODUCTS[1]!;

function identity(
  overrides: Partial<ReportLiveSkuIdentity> = {},
): ReportLiveSkuIdentity {
  return {
    displayName: FIRST.name,
    netPriceMinor: FIRST.price,
    productId: "jd7realproductid",
    quantityAvailable: 5,
    sku: FIRST.sku,
    unitCostMinor: FIRST.unitCost,
    ...overrides,
  };
}

/** A SKU created at the register: named and priced, never costed. */
function quickAddIdentity(
  overrides: Partial<ReportLiveSkuIdentity> = {},
): ReportLiveSkuIdentity {
  return identity({
    displayName: "Bottled Water",
    netPriceMinor: 500,
    sku: "QUICK-ADD-1",
    unitCostMinor: null,
    ...overrides,
  });
}

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
        identity: identity(),
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

  it("gives a sku with no catalogue story a live fixture id", () => {
    // A quick-add SKU is a real part of the visitor's day. It has no story to
    // be named from, so it takes the live id space and is named from the
    // identity the row carries — it is NOT dropped from the mix.
    const live = toSharedDemoLiveReportsDay({
      result: liveResult({
        skus: [
          {
            identity: quickAddIdentity(),
            metrics: skuMetrics(),
            productSkuId: "kg2quickadd",
            sku: "QUICK-ADD-1",
          },
        ],
      }),
      today: TODAY,
    });

    const fixtureSkuId = `${SHARED_DEMO_REPORTS_LIVE_SKU_ID_PREFIX}kg2quickadd`;
    expect(live?.skus).toEqual([[fixtureSkuId, skuMetrics()]]);
    expect(live?.liveSkuIdentityById.get(fixtureSkuId)?.displayName).toBe(
      "Bottled Water",
    );
    expect(live?.querySkuIdByFixtureSkuId.get(fixtureSkuId)).toBe(
      "kg2quickadd",
    );
  });

  it("carries no story identity for a catalogue sku", () => {
    // The story names its own products everywhere else in the demo; Reports
    // must not become the one surface quoting a different name or price.
    const live = toSharedDemoLiveReportsDay({
      result: liveResult(),
      today: TODAY,
    });

    expect(live?.liveSkuIdentityById.size).toBe(0);
  });

  it("drops a row whose sku document is gone but keeps its revenue", () => {
    // With no identity there is nothing to name the row by. Its money is
    // already inside the day's own metrics, so the day stays whole.
    const live = toSharedDemoLiveReportsDay({
      result: liveResult({
        skus: [
          {
            identity: identity(),
            metrics: skuMetrics(),
            productSkuId: "kg2a",
            sku: FIRST.sku,
          },
          {
            identity: null,
            metrics: skuMetrics(),
            productSkuId: "kg2c",
            sku: null,
          },
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
          {
            identity: identity(),
            metrics: skuMetrics(),
            productSkuId: "kg2a",
            sku: FIRST.sku,
          },
          {
            identity: identity(),
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
          identity: identity({ sku: product.sku }),
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
      {
        identity: identity({ quantityAvailable: 7, sku: FIRST.sku }),
        productSkuId: "kg2a",
        sku: FIRST.sku,
      },
      {
        identity: identity({ quantityAvailable: 3, sku: SECOND.sku }),
        productSkuId: "kg2b",
        sku: SECOND.sku,
      },
    ]);

    expect(
      stock?.get(`${SHARED_DEMO_REPORTS_SKU_ID_PREFIX}${FIRST.slug}`)
        ?.quantityAvailable,
    ).toBe(7);
    expect(
      stock?.get(`${SHARED_DEMO_REPORTS_SKU_ID_PREFIX}${SECOND.slug}`)
        ?.quantityAvailable,
    ).toBe(3);
  });

  it("keeps a genuine zero rather than dropping it", () => {
    // Sold out is a fact worth showing; a falsy check here would hide it.
    const stock = toSharedDemoLiveSkuStock([
      {
        identity: identity({ quantityAvailable: 0 }),
        productSkuId: "kg2a",
        sku: FIRST.sku,
      },
    ]);

    expect(
      stock?.get(`${SHARED_DEMO_REPORTS_SKU_ID_PREFIX}${FIRST.slug}`)
        ?.quantityAvailable,
    ).toBe(0);
  });

  it("leaves a catalogue sku to be named by its story", () => {
    // The live row's name and price are correct, but the story is what every
    // other demo surface quotes — Reports must not diverge from it.
    const stock = toSharedDemoLiveSkuStock([
      { identity: identity(), productSkuId: "kg2a", sku: FIRST.sku },
    ]);

    expect(
      stock?.get(`${SHARED_DEMO_REPORTS_SKU_ID_PREFIX}${FIRST.slug}`)?.identity,
    ).toBeNull();
  });

  it("names a code outside the demo catalogue from the live row", () => {
    const stock = toSharedDemoLiveSkuStock([
      {
        identity: quickAddIdentity({ quantityAvailable: 5 }),
        productSkuId: "kg2quickadd",
        sku: "QUICK-ADD-1",
      },
    ]);

    const entry = stock?.get(
      `${SHARED_DEMO_REPORTS_LIVE_SKU_ID_PREFIX}kg2quickadd`,
    );
    expect(entry?.quantityAvailable).toBe(5);
    expect(entry?.identity?.displayName).toBe("Bottled Water");
    // Priced at the register, never costed — reports disclose that as
    // uncosted revenue rather than as a full margin.
    expect(entry?.identity?.unitCostMinor).toBeNull();
  });

  it("keeps a sku that carries no business code at all", () => {
    const stock = toSharedDemoLiveSkuStock([
      {
        identity: quickAddIdentity({ sku: null }),
        productSkuId: "kg2nocode",
        sku: null,
      },
    ]);

    expect(
      stock?.get(`${SHARED_DEMO_REPORTS_LIVE_SKU_ID_PREFIX}kg2nocode`)
        ?.identity?.displayName,
    ).toBe("Bottled Water");
  });
});
