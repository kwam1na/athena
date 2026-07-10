import { describe, expect, it } from "vitest";

import { buildCustomRangeProjection } from "./customRange";

describe("custom range reporting projection", () => {
  it("combines verified daily projections without raw history", () => {
    expect(
      buildCustomRangeProjection({
        days: [
          {
            currency: "GHS",
            knownCogsMinor: 300,
            netRevenueMinor: 1_000,
            operatingDate: "2026-07-08",
            status: "verified",
            uncoveredMerchandiseRevenueMinor: 0,
            unitsSold: 2,
          },
          {
            currency: "GHS",
            knownCogsMinor: 200,
            netRevenueMinor: 500,
            operatingDate: "2026-07-09",
            status: "verified",
            uncoveredMerchandiseRevenueMinor: 100,
            unitsSold: 1,
          },
        ],
        endOperatingDate: "2026-07-09",
        generationId: "range-1",
        metricVersion: 1,
        sourceWatermark: 500,
        startOperatingDate: "2026-07-08",
        storeId: "store-1",
      }),
    ).toMatchObject({
      currency: "GHS",
      knownCogsMinor: 500,
      netRevenueMinor: 1_500,
      status: "partial",
      uncoveredMerchandiseRevenueMinor: 100,
      unitsSold: 3,
    });
  });

  it("rejects unverified or mixed-currency daily inputs", () => {
    expect(() =>
      buildCustomRangeProjection({
        days: [
          {
            currency: "GHS",
            knownCogsMinor: 0,
            netRevenueMinor: 1,
            operatingDate: "2026-07-09",
            status: "building",
            uncoveredMerchandiseRevenueMinor: 0,
            unitsSold: 0,
          },
        ],
        endOperatingDate: "2026-07-09",
        generationId: "range-1",
        metricVersion: 1,
        sourceWatermark: 500,
        startOperatingDate: "2026-07-09",
        storeId: "store-1",
      }),
    ).toThrow("daily projection is not verified");
    expect(() =>
      buildCustomRangeProjection({
        days: [
          {
            currency: "GHS",
            knownCogsMinor: 0,
            netRevenueMinor: 1,
            operatingDate: "2026-07-08",
            status: "verified",
            uncoveredMerchandiseRevenueMinor: 0,
            unitsSold: 0,
          },
          {
            currency: "USD",
            knownCogsMinor: 0,
            netRevenueMinor: 1,
            operatingDate: "2026-07-09",
            status: "verified",
            uncoveredMerchandiseRevenueMinor: 0,
            unitsSold: 0,
          },
        ],
        endOperatingDate: "2026-07-09",
        generationId: "range-1",
        metricVersion: 1,
        sourceWatermark: 500,
        startOperatingDate: "2026-07-08",
        storeId: "store-1",
      }),
    ).toThrow("mixed currencies cannot be combined");
  });
});
