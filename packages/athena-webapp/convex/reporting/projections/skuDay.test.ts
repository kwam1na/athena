import { describe, expect, it } from "vitest";

import { buildSkuDayProjection } from "./skuDay";

describe("SKU-day reporting projection", () => {
  it("rolls trusted aliases into one canonical SKU while retaining evidence IDs", () => {
    const result = buildSkuDayProjection({
      activeDays: 10,
      facts: [
        {
          canonicalSkuId: "sku-1",
          cogsKnownMinor: 500,
          factId: "fact-1",
          netRevenueMinor: 1_000,
          originalSkuReference: "sku-1",
          quantity: 2,
          returnedQuantity: 0,
        },
        {
          canonicalSkuId: "sku-1",
          cogsKnownMinor: null,
          factId: "fact-2",
          netRevenueMinor: 500,
          originalSkuReference: "provisional-9",
          quantity: 1,
          returnedQuantity: 0,
        },
      ],
      generationId: "generation-1",
      onHandQuantity: 12,
      operatingDate: "2026-07-09",
      skuId: "sku-1",
      storeId: "store-1",
    });

    expect(result).toMatchObject({
      canonicalSkuId: "sku-1",
      costStatus: "partial",
      netRevenueMinor: 1_500,
      netSoldUnits: 3,
      projectedDaysOfCover: 40,
    });
    expect(result.evidenceFactIds).toEqual(["fact-1", "fact-2"]);
    expect(result.originalSkuReferences).toEqual(["provisional-9", "sku-1"]);
  });

  it("withholds velocity and cover with insufficient evidence", () => {
    const result = buildSkuDayProjection({
      activeDays: 3,
      facts: [],
      generationId: "generation-1",
      onHandQuantity: 12,
      operatingDate: "2026-07-09",
      skuId: "sku-1",
      storeId: "store-1",
    });

    expect(result.velocitySufficient).toBe(false);
    expect(result.projectedDaysOfCover).toBeNull();
  });
});
