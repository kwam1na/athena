import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  buildSkuInsightProjection,
  countActiveDaysInDeclaredWindow,
  summarizeRefundVoidCorrections,
} from "./skuInsights";

describe("SKU insight projection", () => {
  it("persists declared-window velocity, cover, commitment, cost, and lineage", () => {
    expect(
      buildSkuInsightProjection({
        activeDays: 10,
        confirmedInboundQuantity: 4,
        inventoryCostCoverage: "partial",
        revenueCostCoverage: "known",
        coveredEligibleRevenueMinor: 2_500,
        eligibleMerchandiseRevenueMinor: 2_500,
        expectedInboundAt: 500,
        knownCogsMinor: 1_000,
        knownGrossProfitMinor: 1_500,
        knownInventoryValueMinor: 1_200,
        netSoldUnits: 5,
        onHandQuantity: 3,
        sellableQuantity: 2,
        outstandingCommitmentQuantity: 4,
        returnedUnits: 2,
        shortReceipt: true,
        sourceGenerationIds: ["inventory-1", "sku-day-1"],
        sourceWatermark: 900,
        uncostedOnHandQuantity: 1,
        uncoveredEligibleRevenueMinor: 0,
        windowEndDate: "2026-07-10",
        windowStartDate: "2026-07-01",
      }),
    ).toMatchObject({
      activeDays: 10,
      averageUnitsPerActiveDay: 0.5,
      confirmedInboundQuantity: 4,
      inventoryCostCoverage: "partial",
      revenueCostCoverage: "known",
      costCoverageBasisPoints: 10_000,
      marginBasisPoints: 6_000,
      projectedDaysOfCover: 4,
      sourceGenerationIds: ["inventory-1", "sku-day-1"],
      velocitySufficient: true,
    });
  });

  it("withholds cover and preserves mixed-currency and partial coverage", () => {
    expect(
      buildSkuInsightProjection({
        activeDays: 3,
        confirmedInboundQuantity: 0,
        inventoryCostCoverage: "mixed_currency",
        revenueCostCoverage: "mixed_currency",
        coveredEligibleRevenueMinor: 1_000,
        eligibleMerchandiseRevenueMinor: 2_000,
        knownCogsMinor: 500,
        knownGrossProfitMinor: 500,
        knownInventoryValueMinor: null,
        netSoldUnits: 2,
        onHandQuantity: 8,
        sellableQuantity: 5,
        outstandingCommitmentQuantity: 0,
        returnedUnits: 0,
        shortReceipt: false,
        sourceGenerationIds: ["sku-day-1", "inventory-1"],
        sourceWatermark: 900,
        uncostedOnHandQuantity: 8,
        uncoveredEligibleRevenueMinor: 1_000,
        windowEndDate: "2026-07-10",
        windowStartDate: "2026-07-08",
      }),
    ).toMatchObject({
      averageUnitsPerActiveDay: null,
      inventoryCostCoverage: "mixed_currency",
      revenueCostCoverage: "mixed_currency",
      projectedDaysOfCover: null,
      costCoverageBasisPoints: null,
      marginBasisPoints: null,
      velocitySufficient: false,
    });
  });

  it("publishes 90% revenue coverage and covered-basis margin independently of uncosted stock", () => {
    expect(
      buildSkuInsightProjection({
        activeDays: 10,
        confirmedInboundQuantity: 0,
        coveredEligibleRevenueMinor: 9_000,
        eligibleMerchandiseRevenueMinor: 10_000,
        inventoryCostCoverage: "partial",
        knownCogsMinor: 5_400,
        knownGrossProfitMinor: 3_600,
        knownInventoryValueMinor: 500,
        netSoldUnits: 10,
        onHandQuantity: 20,
        outstandingCommitmentQuantity: 0,
        revenueCostCoverage: "partial",
        returnedUnits: 0,
        sellableQuantity: 10,
        shortReceipt: false,
        sourceGenerationIds: ["inventory-1", "sku-day-1"],
        sourceWatermark: 900,
        uncostedOnHandQuantity: 20,
        uncoveredEligibleRevenueMinor: 1_000,
        windowEndDate: "2026-07-10",
        windowStartDate: "2026-07-01",
      }),
    ).toMatchObject({
      costCoverageBasisPoints: 9_000,
      marginBasisPoints: 4_000,
      projectedDaysOfCover: 10,
    });
  });

  it("counts only scheduled open dates and honors closed exceptions", () => {
    expect(
      countActiveDaysInDeclaredWindow({
        windowEndDate: "2026-07-07",
        windowStartDate: "2026-07-01",
        weeklyClosedDays: [0],
        weeklyWindows: [1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({ dayOfWeek })),
        dateExceptions: [
          { closed: true, localDate: "2026-07-03", windows: [] },
        ],
      }),
    ).toBe(5);
  });

  it("counts three low-value canonical corrections for attention", () => {
    expect(
      summarizeRefundVoidCorrections([
        { amountMinor: -10, factType: "refund", status: "canonical" },
        { amountMinor: -20, factType: "void", status: "canonical" },
        { amountMinor: 5, factType: "correction", status: "canonical" },
        { amountMinor: -99, factType: "refund", status: "superseded" },
      ]),
    ).toEqual({ count: 3, valueMinor: -25 });
  });

  it("uses bounded reporting projections and schedules persisted values into attention", () => {
    const source = readFileSync(
      join(process.cwd(), "convex", "reporting", "projections", "skuInsights.ts"),
      "utf8",
    );
    expect(source).toContain("export const materializeSkuInsightBatch = internalMutation");
    expect(source).toContain('.query("reportingSkuDayProjection")');
    expect(source).toContain('.query("reportingCurrentValuationProjection")');
    expect(source).toContain('.query("reportingFact")');
    expect(source).toContain("SKU_INSIGHT_ROW_LIMIT + 1");
    expect(source).toContain("materializeAttentionProjection");
    expect(source).not.toContain('.query("purchaseOrder")');
  });
});
