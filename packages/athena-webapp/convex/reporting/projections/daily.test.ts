import { describe, expect, it } from "vitest";

import { buildDailyProjection } from "./daily";

describe("daily reporting projection", () => {
  it("separates known profit from uncovered merchandise revenue", () => {
    const projection = buildDailyProjection({
      factVersion: 1,
      facts: [
        {
          channel: "pos",
          cogsKnownMinor: 5_000,
          currency: "GHS",
          eligibleMerchandiseRevenueMinor: 8_000,
          factId: "fact-1",
          grossRevenueMinor: 10_000,
          netRevenueMinor: 10_000,
          quantity: 2,
          recognizedAt: 100,
          returnedQuantity: 0,
        },
        {
          channel: "storefront",
          cogsKnownMinor: null,
          currency: "GHS",
          eligibleMerchandiseRevenueMinor: 2_000,
          factId: "fact-2",
          grossRevenueMinor: 2_000,
          netRevenueMinor: 2_000,
          quantity: 1,
          recognizedAt: 110,
          returnedQuantity: 0,
        },
      ],
      generationId: "generation-1",
      metricVersion: 1,
      operatingDate: "2026-07-09",
      scheduleVersionId: "schedule-1",
      sourceWatermark: 110,
      storeId: "store-1",
    });

    expect(projection.status).toBe("partial");
    expect(projection.currency).toBe("GHS");
    expect(projection.knownCogsMinor).toBe(5_000);
    expect(projection.knownGrossProfitMinor).toBe(3_000);
    expect(projection.uncoveredMerchandiseRevenueMinor).toBe(2_000);
    expect(projection.costCoverageBasisPoints).toBe(8_000);
    expect(projection.unitsSold).toBe(3);
  });

  it("withholds unified money totals for mixed currencies", () => {
    const projection = buildDailyProjection({
      factVersion: 1,
      facts: [
        {
          channel: "pos",
          cogsKnownMinor: 100,
          currency: "GHS",
          eligibleMerchandiseRevenueMinor: 200,
          factId: "fact-1",
          grossRevenueMinor: 200,
          netRevenueMinor: 200,
          quantity: 1,
          recognizedAt: 100,
          returnedQuantity: 0,
        },
        {
          channel: "storefront",
          cogsKnownMinor: 100,
          currency: "USD",
          eligibleMerchandiseRevenueMinor: 200,
          factId: "fact-2",
          grossRevenueMinor: 200,
          netRevenueMinor: 200,
          quantity: 1,
          recognizedAt: 110,
          returnedQuantity: 0,
        },
      ],
      generationId: "generation-1",
      metricVersion: 1,
      operatingDate: "2026-07-09",
      scheduleVersionId: "schedule-1",
      sourceWatermark: 110,
      storeId: "store-1",
    });

    expect(projection.status).toBe("incompatible");
    expect(projection.currency).toBeNull();
    expect(projection.netRevenueMinor).toBeNull();
    expect(projection.currencySegments).toEqual([
      expect.objectContaining({ currency: "GHS", netRevenueMinor: 200 }),
      expect.objectContaining({ currency: "USD", netRevenueMinor: 200 }),
    ]);
  });
});
