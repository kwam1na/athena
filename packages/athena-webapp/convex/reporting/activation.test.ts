import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  activateGeneration,
  activationFreshnessAuthority,
  activationOperationMatchesProjectionKind,
  assertActivationRunLineage,
  identityMigrationRunIsActivationReady,
  rollbackGeneration,
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

  it("rolls back only to a compatible retained generation", () => {
    expect(
      rollbackGeneration({
        currentGenerationId: "generation-2",
        expectedCurrentGenerationId: "generation-2",
        requiredContractVersion: 1,
        requiredMetricVersion: 1,
        target: {
          ...verified,
          generationId: "generation-1",
          status: "superseded",
        },
      }),
    ).toEqual({
      activatedGenerationId: "generation-1",
      supersededGenerationId: "generation-2",
    });
  });

  it("rejects rollback when the active pointer changed", () => {
    expect(() =>
      rollbackGeneration({
        currentGenerationId: "generation-3",
        expectedCurrentGenerationId: "generation-2",
        requiredContractVersion: 1,
        requiredMetricVersion: 1,
        target: {
          ...verified,
          generationId: "generation-1",
          status: "superseded",
        },
      }),
    ).toThrow("active generation changed");
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

  it("persists rollback as an internal deployment-owned run and activation event", () => {
    const source = readFileSync("convex/reporting/activation.ts", "utf8");
    expect(source).toContain("rollbackToVerifiedGeneration = internalMutation");
    expect(source).not.toContain("requireReportingStoreAccess");
    expect(source).toContain("automationIdentity: v.string()");
    expect(source).toContain(
      "rollback target is not the prior active generation",
    );
    expect(source).toContain("rollback target has no prior activation lineage");
    expect(source).toContain('runType: "rollback"');
    expect(source).toContain('eventType: "rollback_started"');
    expect(source).toContain('eventType: "rollback_completed"');
    expect(source).toContain("expectedCurrentGenerationId");
  });
});
