import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  activateGeneration,
  activationFreshnessAuthority,
  activationOperationMatchesProjectionKind,
  assertActivationRunLineage,
  identityMigrationRunIsActivationReady,
  unavailableCurrentInventoryCoverageIsActivatable,
} from "./activation";

const verified = {
  contractVersion: 1,
  generationId: "generation-2",
  metricVersion: 1,
  reconciliationDifferenceCount: 0,
  requiredCoverageComplete: true,
  stableWatermark: true,
  status: "verified" as const,
};

describe("reporting generation activation", () => {
  it("accepts only an empty, discrepancy-free current inventory unavailable certificate", () => {
    const coverage = ["on_hand_units", "sellable_units", "inventory_value"].map(
      (metric) => ({
        completeness: "unavailable" as const,
        failedCount: 0,
        limitingReason: "source_incomplete" as const,
        metric,
        omittedCount: 0,
        quarantinedCount: 0,
        sourceDomain: "inventory",
        truncated: false,
      }),
    );
    const candidate = {
      completeness: "unavailable",
      limitingReason: "source_incomplete",
      projectionKind: "current_inventory",
    } as const;

    expect(
      unavailableCurrentInventoryCoverageIsActivatable({
        candidate,
        coverage,
        discrepancyCount: 0,
        hasProjectionRows: false,
      }),
    ).toBe(true);
    expect(
      unavailableCurrentInventoryCoverageIsActivatable({
        candidate,
        coverage,
        discrepancyCount: 0,
        hasProjectionRows: true,
      }),
    ).toBe(false);
    expect(
      unavailableCurrentInventoryCoverageIsActivatable({
        candidate,
        coverage: coverage.slice(1),
        discrepancyCount: 0,
        hasProjectionRows: false,
      }),
    ).toBe(false);
    expect(
      unavailableCurrentInventoryCoverageIsActivatable({
        candidate: { ...candidate, projectionKind: "store_day" },
        coverage,
        discrepancyCount: 0,
        hasProjectionRows: false,
      }),
    ).toBe(false);
    expect(
      unavailableCurrentInventoryCoverageIsActivatable({
        candidate,
        coverage,
        discrepancyCount: 1,
        hasProjectionRows: false,
      }),
    ).toBe(false);
  });

  it("recognizes intraday projection rebuild lineage", () => {
    expect(
      activationOperationMatchesProjectionKind(
        "projection_rebuild_catching_up",
        "store_intraday",
      ),
    ).toBe(true);
  });
  it("promotes a compatible verified generation with compare-and-swap", () => {
    expect(
      activateGeneration({
        candidate: verified,
        currentGenerationId: "generation-1",
        expectedCurrentGenerationId: "generation-1",
        requiredContractVersion: 1,
        requiredMetricVersion: 1,
      }),
    ).toEqual({
      activatedGenerationId: "generation-2",
      supersededGenerationId: "generation-1",
    });
  });

  it("rejects a late candidate after the active pointer changes", () => {
    expect(() =>
      activateGeneration({
        candidate: verified,
        currentGenerationId: "generation-3",
        expectedCurrentGenerationId: "generation-1",
        requiredContractVersion: 1,
        requiredMetricVersion: 1,
      }),
    ).toThrow("active generation changed");
  });

  it.each([
    ["building", "candidate is not verified"],
    ["failed", "candidate is not verified"],
  ] as const)("rejects %s candidates", (status, message) => {
    expect(() =>
      activateGeneration({
        candidate: { ...verified, status },
        currentGenerationId: null,
        expectedCurrentGenerationId: null,
        requiredContractVersion: 1,
        requiredMetricVersion: 1,
      }),
    ).toThrow(message);
  });

  it("requires exact completed run ownership and versions", () => {
    const candidate = {
      _id: "generation-2",
      runId: "run-2",
      storeId: "store-1",
      organizationId: "org-1",
      stableWatermark: 100,
      verifiedAt: 101,
      factContractVersion: 2,
      metricContractVersion: 3,
      projectionContractVersion: 4,
      projectionKind: "sku_day",
    };
    const run = {
      _id: "run-2",
      generationId: "generation-2",
      storeId: "store-1",
      organizationId: "org-1",
      domain: "reporting",
      runType: "rebuild",
      status: "completed",
      completedAt: 101,
      frozenWatermark: 100,
      factContractVersion: 2,
      metricContractVersion: 3,
      projectionContractVersion: 4,
      operation: "projection_rebuild_catching_up",
    };

    expect(() =>
      assertActivationRunLineage(candidate as never, run as never),
    ).not.toThrow();
    expect(() =>
      assertActivationRunLineage(
        candidate as never,
        { ...run, generationId: "generation-other" } as never,
      ),
    ).toThrow("activation lineage is incompatible");
    expect(() =>
      assertActivationRunLineage(
        candidate as never,
        { ...run, status: "running" } as never,
      ),
    ).toThrow("activation lineage is incompatible");
    expect(() =>
      assertActivationRunLineage(
        candidate as never,
        { ...run, operation: "current_inventory_rebuild_catching_up" } as never,
      ),
    ).toThrow("activation lineage is incompatible");
    expect(
      activationOperationMatchesProjectionKind(
        "current_inventory_rebuild_catching_up",
        "current_inventory",
      ),
    ).toBe(true);
    expect(
      activationOperationMatchesProjectionKind(
        "projection_reconciliation_finalize",
        "store_day",
      ),
    ).toBe(true);
    expect(
      activationOperationMatchesProjectionKind(
        "projection_reconciliation_finalize",
        "sku_day",
      ),
    ).toBe(true);
    for (const operation of [
      "projection_reconciliation_expected",
      "projection_reconciliation_candidate",
      "projection_reconciliation_unrelated",
    ]) {
      expect(
        activationOperationMatchesProjectionKind(operation, "store_day"),
      ).toBe(false);
      expect(
        activationOperationMatchesProjectionKind(operation, "sku_day"),
      ).toBe(false);
    }
  });

  it("requires verified POS source reconciliation for new reset/backfill lineage", () => {
    const source = readFileSync("convex/reporting/activation.ts", "utf8");
    expect(source).toContain("requirePosSourceReconciliationReadinessWithCtx");
    expect(source).toMatch(
      /await requirePosSourceReconciliationReadinessWithCtx\(ctx, \{\s+candidate,\s+run,\s+\}\)/,
    );
  });

  it("requires a completed conflict-free identity migration before activation", () => {
    expect(
      identityMigrationRunIsActivationReady({
        conflictCount: 0,
        coverageComplete: true,
        operation: "apply",
        status: "completed",
      }),
    ).toBe(true);
    expect(
      identityMigrationRunIsActivationReady({
        conflictCount: 1,
        coverageComplete: true,
        operation: "apply",
        status: "completed",
      }),
    ).toBe(false);
    expect(identityMigrationRunIsActivationReady(null)).toBe(false);
  });

  it("binds each projection kind to its mutation-time freshness authority", () => {
    expect(activationFreshnessAuthority("store_day")).toBe("facts");
    expect(activationFreshnessAuthority("sku_day")).toBe("facts");
    expect(activationFreshnessAuthority("current_inventory")).toBe(
      "inventory_positions",
    );
    expect(activationFreshnessAuthority("attention")).toBe(
      "source_generations",
    );
  });

  it("keeps rollback authority exclusively at the atomic read-bundle boundary", () => {
    const activationSource = readFileSync("convex/reporting/activation.ts", "utf8");
    const bundleSource = readFileSync(
      "convex/reporting/readModels/readBundle.ts",
      "utf8",
    );
    expect(activationSource).not.toContain("rollbackToVerifiedGeneration");
    expect(activationSource).not.toContain("rollbackGeneration");
    expect(bundleSource).toContain("rollbackReportsReadBundle = internalMutation");
    expect(bundleSource).toContain("expectedCurrentBundleId");
  });
});
