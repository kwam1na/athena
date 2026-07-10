import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { assessCurrentInventoryCandidate } from "./inventoryRebuild";

const compatibleVersions = {
  factContractVersion: 1,
  metricContractVersion: 1,
  projectionContractVersion: 1,
};

const validInput = {
  baseline: {
    sourceWatermark: 100,
    status: "accepted" as const,
  },
  baselineRun: {
    ...compatibleVersions,
    frozenWatermark: 100,
  },
  deficitLotQuantity: 2,
  frozenWatermark: 200,
  positionCommittedAt: 150,
  position: {
    lastEffectAt: 150,
    mode: "compatibility_shadow" as const,
    onHandQuantity: 8,
    sellableQuantity: 7,
    unresolvedDeficitQuantity: 2,
  },
  productSku: {
    inventoryCount: 8,
    quantityAvailable: 7,
  },
  runVersions: compatibleVersions,
};

describe("current inventory rebuild", () => {
  it("accepts reconciled shadow state rooted in a compatible frozen baseline", () => {
    expect(assessCurrentInventoryCandidate(validInput)).toEqual({
      reason: null,
      status: "candidate_complete",
    });
  });

  it("copies reconciled authoritative state into an isolated candidate generation", () => {
    expect(
      assessCurrentInventoryCandidate({
        ...validInput,
        position: { ...validInput.position, mode: "authoritative" },
      }),
    ).toEqual({
      reason: null,
      status: "candidate_complete",
    });
  });

  it("rejects missing, stale, version-incompatible, and drifted baselines", () => {
    expect(
      assessCurrentInventoryCandidate({ ...validInput, position: null }),
    ).toEqual({ reason: "missing_inventory_position", status: "rejected" });
    expect(
      assessCurrentInventoryCandidate({ ...validInput, baseline: null }),
    ).toEqual({ reason: "missing_accepted_baseline", status: "rejected" });
    expect(
      assessCurrentInventoryCandidate({
        ...validInput,
        baseline: { sourceWatermark: 201, status: "accepted" },
      }),
    ).toEqual({
      reason: "baseline_after_frozen_watermark",
      status: "rejected",
    });
    expect(
      assessCurrentInventoryCandidate({
        ...validInput,
        baselineRun: {
          ...validInput.baselineRun,
          projectionContractVersion: 2,
        },
      }),
    ).toEqual({ reason: "baseline_version_incompatible", status: "rejected" });
    expect(
      assessCurrentInventoryCandidate({
        ...validInput,
        productSku: { inventoryCount: 9, quantityAvailable: 7 },
      }),
    ).toEqual({
      reason: "product_sku_reconciliation_drift",
      status: "rejected",
    });
    expect(
      assessCurrentInventoryCandidate({
        ...validInput,
        deficitLotQuantity: 1,
      }),
    ).toEqual({ reason: "deficit_reconciliation_drift", status: "rejected" });
  });

  it("cannot certify a valuation until occurrence-order replay resolves it", () => {
    expect(
      assessCurrentInventoryCandidate({
        ...validInput,
        position: {
          ...validInput.position,
          valuationStatus: "rebuild_required" as const,
        },
      }),
    ).toEqual({
      reason: "occurrence_order_rebuild_required",
      status: "rejected",
    });
    expect(
      assessCurrentInventoryCandidate({
        ...validInput,
        position: {
          ...validInput.position,
          valuationStatus: "current" as const,
        },
      }),
    ).toEqual({ reason: null, status: "candidate_complete" });
  });

  it("rejects a position committed after the frozen watermark even when occurrence is older", () => {
    expect(
      assessCurrentInventoryCandidate({
        ...validInput,
        positionCommittedAt: 201,
      }),
    ).toEqual({
      reason: "position_after_frozen_watermark",
      status: "rejected",
    });
  });

  it("catches up tail state and never changes operational authority", () => {
    const source = readFileSync(
      "convex/reporting/maintenance/inventoryRebuild.ts",
      "utf8",
    );

    expect(source).toContain("current_inventory_rebuild_catching_up");
    expect(source).toContain('.query("productSku")');
    expect(source).toContain('.query("reportingInventoryPositionRevision")');
    expect(source).toContain('withIndex("by_storeId"');
    expect(source).toContain('.gt("_creationTime", run.frozenWatermark!)');
    expect(source).not.toContain('withIndex("by_storeId_mode_updatedAt"');
    expect(source).toContain("INVENTORY_REBUILD_PAGE_SIZE = 20");
    expect(source).not.toContain("current_inventory_rebuild_authoritative");
    expect(source).not.toContain('status: "active"');
    expect(source).not.toContain('ctx.db.patch("productSku"');
    expect(source).not.toContain('ctx.db.patch("reportingInventoryPosition"');
  });
});
