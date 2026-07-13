import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  assertInventoryCutoverRun,
  boundInventoryCutoverPagination,
  previewInventoryBaseline,
  resolveCutoverBaselinePosition,
} from "./cutover";

describe("reporting inventory cutover", () => {
  it("preserves unknown, known-zero, and known-positive cost distinctly", () => {
    expect(
      previewInventoryBaseline({
        currency: "GHS",
        onHandQuantity: 12,
        sellableQuantity: 10,
        skuId: "sku-unknown",
        storeId: "store-1",
        unitCostMinor: null,
      }),
    ).toMatchObject({
      costStatus: "unknown",
      knownCostPoolMinor: 0,
      uncostedQuantity: 12,
    });
    expect(
      previewInventoryBaseline({
        currency: "GHS",
        onHandQuantity: 12,
        sellableQuantity: 10,
        skuId: "sku-zero",
        storeId: "store-1",
        unitCostMinor: 0,
      }),
    ).toMatchObject({
      costStatus: "known",
      costedQuantity: 12,
      knownCostPoolMinor: 0,
    });
  });

  it("represents legacy-clamped oversell as an explicit deficit", () => {
    expect(
      previewInventoryBaseline({
        currency: "GHS",
        legacyUnresolvedDeficitQuantity: 3,
        onHandQuantity: 0,
        sellableQuantity: 0,
        skuId: "sku-1",
        storeId: "store-1",
        unitCostMinor: null,
      }),
    ).toMatchObject({ signedBookPosition: -3, unresolvedDeficitQuantity: 3 });
  });

  it("preserves reconciled shadow valuation until current-inventory activation", () => {
    expect(
      resolveCutoverBaselinePosition({
        baseline: {
          costedQuantity: 0,
          currency: null,
          knownCostPoolMinor: 0,
          onHandQuantity: 8,
          sellableQuantity: 7,
          uncostedQuantity: 8,
          unresolvedDeficitQuantity: 2,
        },
        existing: {
          costedQuantity: 6,
          currencyCode: "GHS",
          currencyMinorUnitScale: 2,
          knownCostPoolMinor: 3_000,
          lastEffectAt: 90,
          mode: "compatibility_shadow",
          onHandQuantity: 8,
          sellableQuantity: 7,
          uncostedQuantity: 2,
          unresolvedDeficitQuantity: 2,
          version: 4,
        },
        frozenWatermark: 100,
      }),
    ).toEqual(
      expect.objectContaining({
        costedQuantity: 6,
        knownCostPoolMinor: 3_000,
        mode: "compatibility_shadow",
        uncostedQuantity: 2,
        version: 5,
      }),
    );
  });

  it("rejects effects newer than the cutover watermark", () => {
    expect(() =>
      resolveCutoverBaselinePosition({
        baseline: {
          costedQuantity: 0,
          currency: null,
          knownCostPoolMinor: 0,
          onHandQuantity: 8,
          sellableQuantity: 7,
          uncostedQuantity: 8,
          unresolvedDeficitQuantity: 0,
        },
        existing: {
          costedQuantity: 0,
          knownCostPoolMinor: 0,
          lastEffectAt: 101,
          mode: "compatibility_shadow",
          onHandQuantity: 8,
          sellableQuantity: 7,
          uncostedQuantity: 8,
          unresolvedDeficitQuantity: 0,
          version: 1,
        },
        frozenWatermark: 100,
      }),
    ).toThrow("newer than the cutover watermark");
  });

  it("bounds preview pagination and rejects invalid page sizes", () => {
    expect(
      boundInventoryCutoverPagination({ cursor: null, numItems: 1_000 }),
    ).toEqual({ cursor: null, numItems: 100 });
    expect(() =>
      boundInventoryCutoverPagination({ cursor: null, numItems: 0 }),
    ).toThrow("positive safe integer");
  });

  it("rejects cutover runs with invalid scope, operation, status, or versions", () => {
    const run = {
      actorKind: "automation" as const,
      automationIdentity: "reports-cutover",
      factContractVersion: 2,
      frozenWatermark: 100,
      metricContractVersion: 1,
      operation: "inventory_cutover_preview",
      organizationId: "org-1",
      processedCount: 0,
      projectionContractVersion: 2,
      runType: "cutover",
      status: "running",
      storeId: "store-1",
    };
    expect(
      assertInventoryCutoverRun({
        expectedOperation: "inventory_cutover_preview",
        expectedStatus: "running",
        organizationId: "org-1",
        run: run as never,
        storeId: "store-1",
      }),
    ).toBe(run);
    for (const invalid of [
      { ...run, factContractVersion: 99 },
      { ...run, operation: "inventory_cutover_apply" },
      { ...run, organizationId: "org-2" },
      { ...run, status: "completed" },
    ]) {
      expect(() =>
        assertInventoryCutoverRun({
          expectedOperation: "inventory_cutover_preview",
          expectedStatus: "running",
          organizationId: "org-1",
          run: invalid as never,
          storeId: "store-1",
        }),
      ).toThrow("Compatible inventory cutover run not found");
    }
  });

  it("seeds durable baseline and deficit evidence without assigning authority", () => {
    const source = readFileSync(
      "convex/reporting/maintenance/cutover.ts",
      "utf8",
    );

    expect(source).toContain('ctx.db.insert("reportingInventoryEffect"');
    expect(source).toContain(
      'ctx.db.insert("reportingInventoryEffectSourceReference"',
    );
    expect(source).toContain('ctx.db.insert("reportingInventoryDeficitLot"');
    expect(source).toContain('ctx.db.insert("reportingCutoverPreviewItem"');
    expect(source).toContain('.query("reportingCutoverPreviewItem")');
    expect(source).toContain('runType: "cutover"');
    expect(source).toContain("inventory_cutover_preview_completed");
    expect(source).toContain("inventory_cutover_apply_completed");
    expect(source).not.toContain('mode: "authoritative"');
  });
});
