import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  allocateDeferredCoveredRevenue,
  allocateDeferredDeficitCost,
  DEFICIT_REVENUE_COVERAGE_EVIDENCE_LIMIT,
  DEFICIT_RESOLUTION_WORK_LIMIT,
} from "./deficitResolutionWork";

describe("durable deficit resolution work", () => {
  it("allocates known receipt cost exactly across multiple bounded batches", () => {
    let allocatedCostMinor = 0;
    let resolvedQuantity = 0;
    const partCosts: number[] = [];
    for (const nextQuantity of [20, 5]) {
      const allocation = allocateDeferredDeficitCost({
        allocatedCostMinor,
        nextQuantity,
        resolvedQuantity,
        totalReceiptCostMinor: 2_501,
        totalReceiptQuantity: 25,
      });
      allocatedCostMinor = allocation.allocatedCostMinor;
      resolvedQuantity += nextQuantity;
      partCosts.push(allocation.partCostMinor);
    }

    expect(partCosts).toEqual([2_001, 500]);
    expect(partCosts.reduce((sum, part) => sum + part, 0)).toBe(2_501);
  });

  it("keeps uncosted continuation allocation at zero", () => {
    expect(
      allocateDeferredDeficitCost({
        allocatedCostMinor: 0,
        nextQuantity: 20,
        resolvedQuantity: 0,
        totalReceiptQuantity: 25,
      }),
    ).toEqual({ allocatedCostMinor: 0, partCostMinor: 0 });
  });

  it("allocates covered revenue cumulatively and converges exact minor units", () => {
    const parts: number[] = [];
    const priorResolutionQuantities: number[] = [];
    let priorCoveredRevenueMinor = 0;
    for (const nextQuantity of [1, 1, 1]) {
      const allocation = allocateDeferredCoveredRevenue({
        nextQuantity,
        originalAmountMinor: 100,
        originalCostedQuantity: 0,
        originalCoveredRevenueMinor: 0,
        originalQuantity: 3,
        priorCoveredRevenueMinor,
        priorResolutionQuantities,
      });
      parts.push(allocation.partCoveredRevenueMinor);
      priorCoveredRevenueMinor += allocation.partCoveredRevenueMinor;
      priorResolutionQuantities.push(nextQuantity);
    }

    expect(parts).toEqual([33, 34, 33]);
    expect(parts.reduce((sum, part) => sum + part, 0)).toBe(100);
  });

  it("repairs prior per-fragment rounding from actual allocated coverage", () => {
    const final = allocateDeferredCoveredRevenue({
      nextQuantity: 1,
      originalAmountMinor: 100,
      originalCostedQuantity: 0,
      originalCoveredRevenueMinor: 0,
      originalQuantity: 3,
      priorCoveredRevenueMinor: 66,
      priorResolutionQuantities: [1, 1],
    });

    expect(final.partCoveredRevenueMinor).toBe(34);
    expect(66 + final.partCoveredRevenueMinor).toBe(100);
  });

  it("allocates only the originally uncovered revenue for partial cost", () => {
    const first = allocateDeferredCoveredRevenue({
      nextQuantity: 1,
      originalAmountMinor: 100,
      originalCostedQuantity: 2,
      originalCoveredRevenueMinor: 40,
      originalQuantity: 5,
      priorResolutionQuantities: [],
    });
    const second = allocateDeferredCoveredRevenue({
      nextQuantity: 2,
      originalAmountMinor: 100,
      originalCostedQuantity: 2,
      originalCoveredRevenueMinor: 40,
      originalQuantity: 5,
      priorResolutionQuantities: [1],
    });

    expect(first.partCoveredRevenueMinor).toBe(20);
    expect(second.partCoveredRevenueMinor).toBe(40);
  });

  it("accepts 100 prior fragments and rejects the 101st before allocation", () => {
    const accepted = allocateDeferredCoveredRevenue({
      nextQuantity: 1,
      originalAmountMinor: 10_100,
      originalCostedQuantity: 0,
      originalCoveredRevenueMinor: 0,
      originalQuantity: 101,
      priorResolutionQuantities: Array.from(
        { length: DEFICIT_REVENUE_COVERAGE_EVIDENCE_LIMIT },
        () => 1,
      ),
    });
    expect(accepted.partCoveredRevenueMinor).toBe(100);

    expect(() =>
      allocateDeferredCoveredRevenue({
        nextQuantity: 1,
        originalAmountMinor: 10_200,
        originalCostedQuantity: 0,
        originalCoveredRevenueMinor: 0,
        originalQuantity: 102,
        priorResolutionQuantities: Array.from(
          { length: DEFICIT_REVENUE_COVERAGE_EVIDENCE_LIMIT + 1 },
          () => 1,
        ),
      }),
    ).toThrow("evidence exceeds the supported limit");
  });

  it("rejects cumulative resolution beyond the originally unknown quantity", () => {
    expect(() =>
      allocateDeferredCoveredRevenue({
        nextQuantity: 2,
        originalAmountMinor: 100,
        originalCostedQuantity: 3,
        originalCoveredRevenueMinor: 60,
        originalQuantity: 5,
        priorResolutionQuantities: [1],
      }),
    ).toThrow("exceeds eligible unknown quantity");
  });

  it("owns bounded continuation, idempotency, failure, and resume paths", () => {
    const source = readFileSync(
      "convex/reporting/inventory/deficitResolutionWork.ts",
      "utf8",
    );
    expect(DEFICIT_RESOLUTION_WORK_LIMIT).toBe(20);
    expect(source).toContain(".take(DEFICIT_RESOLUTION_WORK_LIMIT)");
    expect(source).toContain("if (!completed)");
    expect(source).toContain("processDeficitResolutionWork");
    expect(source).toContain("by_storeId_sourceDomain_businessEventKey");
    expect(source).toContain("by_linkedOutboundEffectId_effectType");
    expect(source).toContain("revenueCurrencyCode");
    expect(source).toContain("valuationCurrencyCode");
    expect(source).toMatch(
      /quantity:\s*input\.lot\.costLane === "inventory_consumed" \? 0 : input\.quantity/,
    );
    expect(source).toContain("if (existing) return");
    expect(source).toContain("recordDeficitResolutionWorkFailure");
    expect(source).toContain("resumeDeficitResolutionWorkForStore");
    expect(source).toContain('.eq("status", "failed")');
  });
});
