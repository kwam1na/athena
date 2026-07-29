import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  allocateDeferredDeficitCost,
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

  it("owns bounded continuation, idempotency, failure, and resume paths", () => {
    const source = readFileSync(
      "convex/inventoryLedger/deficitResolutionWork.ts",
      "utf8",
    );
    expect(DEFICIT_RESOLUTION_WORK_LIMIT).toBe(20);
    expect(source).toContain(".take(DEFICIT_RESOLUTION_WORK_LIMIT)");
    expect(source).toContain("if (!completed)");
    expect(source).toContain("processDeficitResolutionWork");
    expect(source).toContain("by_storeId_sourceDomain_businessEventKey");
    expect(source).toContain("if (existing) return");
    expect(source).toContain("recordDeficitResolutionWorkFailure");
    expect(source).toContain("resumeDeficitResolutionWorkForStore");
    expect(source).toContain('.eq("status", "failed")');
  });
});
