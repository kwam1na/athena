import { describe, expect, it } from "vitest";

import { evaluateAttention } from "./attentionRules";

describe("reporting attention rules", () => {
  it("retains all applicable SKU reasons and selects the declared primary", () => {
    const result = evaluateAttention({
      activeDays: 10,
      acceptedCloudLagMs: 7 * 60_000,
      confirmedInboundQuantity: 5,
      expectedInboundAt: Date.UTC(2026, 6, 1),
      grossRecognizedSalesMinor: 100_00,
      netSoldUnits: 12,
      now: Date.UTC(2026, 6, 9),
      projectedDaysOfCover: 3,
      refundVoidCorrectionCount: 3,
      refundVoidCorrectionMinor: 600,
      requiredSourceCoverageComplete: true,
      shortReceipt: true,
      skuId: "sku-1",
      uncostedEligibleRevenueMinor: 2_000,
      uncostedOnHandQuantity: 1,
    });

    expect(result.primaryReason).toBe("source_integrity");
    expect(result.reasons.map((reason) => reason.code)).toEqual([
      "source_integrity",
      "missing_cost",
      "refund_void_correction",
      "late_inbound",
      "short_receipt",
      "missing_inbound_cover",
      "low_cover",
    ]);
    expect(result.reasons.every((reason) => reason.ruleVersion === 2)).toBe(true);
    expect(result.reasons.find((reason) => reason.code === "missing_cost")).toEqual(
      expect.objectContaining({ route: "product_edit" }),
    );
  });

  it("requires sufficient velocity evidence before low-cover attention", () => {
    const result = evaluateAttention({
      activeDays: 6,
      confirmedInboundQuantity: 0,
      grossRecognizedSalesMinor: 10_000,
      netSoldUnits: 20,
      now: Date.UTC(2026, 6, 9),
      projectedDaysOfCover: 2,
      refundVoidCorrectionCount: 0,
      refundVoidCorrectionMinor: 0,
      requiredSourceCoverageComplete: true,
      skuId: "sku-1",
      uncostedEligibleRevenueMinor: 0,
      uncostedOnHandQuantity: 0,
    });

    expect(result.reasons).toEqual([]);
    expect(result.primaryReason).toBeNull();
  });

  it("emits cash variance as a store-level route", () => {
    const result = evaluateAttention({
      activeDays: 0,
      cashVarianceMinor: -50,
      confirmedInboundQuantity: 0,
      grossRecognizedSalesMinor: 0,
      netSoldUnits: 0,
      now: 0,
      refundVoidCorrectionCount: 0,
      refundVoidCorrectionMinor: 0,
      requiredSourceCoverageComplete: true,
      uncostedEligibleRevenueMinor: 0,
      uncostedOnHandQuantity: 0,
    });

    expect(result.storeReasons).toEqual([
      expect.objectContaining({ code: "cash_variance", route: "cash_controls" }),
    ]);
  });

  it("does not infer ratio or low-cover attention from incomplete coverage", () => {
    const result = evaluateAttention({
      activeDays: 10,
      confirmedInboundQuantity: 20,
      grossRecognizedSalesMinor: 10_000,
      netSoldUnits: 10,
      now: 0,
      projectedDaysOfCover: 2,
      refundVoidCorrectionCount: 1,
      refundVoidCorrectionMinor: 600,
      requiredSourceCoverageComplete: false,
      uncostedEligibleRevenueMinor: 0,
      uncostedOnHandQuantity: 0,
    });

    expect(result.reasons.map((reason) => reason.code)).toEqual([
      "source_integrity",
    ]);
  });
});
