/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import schema from "../../schema";
import { findAuthoritativeInventoryRevisionAfterWithCtx } from "../activation";
import {
  assessSkuWithCtx,
  assessCurrentInventoryCandidate,
  inventoryAuthorityFootprintDisposition,
  inventoryAuthorityFootprintWithCtx,
} from "./inventoryRebuild";

const modules = import.meta.glob("../../**/*.ts");

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
  it("certifies only globally absent inventory authority as unavailable", () => {
    expect(
      inventoryAuthorityFootprintDisposition({
        acceptedBaselineExists: false,
        authoritativePositionExists: false,
        authoritativePositionRevisionExists: false,
        eligibleSkuExists: true,
      }),
    ).toBe("unavailable");

    for (const present of [
      "acceptedBaselineExists",
      "authoritativePositionExists",
      "authoritativePositionRevisionExists",
    ] as const) {
      expect(
        inventoryAuthorityFootprintDisposition({
          acceptedBaselineExists: present === "acceptedBaselineExists",
          authoritativePositionExists:
            present === "authoritativePositionExists",
          authoritativePositionRevisionExists:
            present === "authoritativePositionRevisionExists",
          eligibleSkuExists: true,
        }),
      ).toBe("reconcile");
    }
    expect(
      inventoryAuthorityFootprintDisposition({
        acceptedBaselineExists: false,
        authoritativePositionExists: false,
        authoritativePositionRevisionExists: false,
        eligibleSkuExists: false,
      }),
    ).toBe("reconcile");
  });

  it("ignores legacy compatibility shadows and their revisions as authority", () => {
    expect(
      inventoryAuthorityFootprintDisposition({
        acceptedBaselineExists: false,
        authoritativePositionExists: false,
        authoritativePositionRevisionExists: false,
        compatibilityShadowPositionExists: true,
        compatibilityShadowRevisionExists: true,
        eligibleSkuExists: true,
      }),
    ).toBe("unavailable");
    expect(
      inventoryAuthorityFootprintDisposition({
        acceptedBaselineExists: false,
        authoritativePositionExists: true,
        authoritativePositionRevisionExists: false,
        compatibilityShadowPositionExists: true,
        compatibilityShadowRevisionExists: true,
        eligibleSkuExists: true,
      }),
    ).toBe("reconcile");
  });

  it("queries only new-design authoritative positions for the authority footprint", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const userId = await ctx.db.insert("athenaUser", {
        email: "inventory-footprint@example.test",
      });
      const organizationId = await ctx.db.insert("organization", {
        createdByUserId: userId,
        name: "Inventory Footprint",
        slug: "inventory-footprint",
      });
      const storeId = await ctx.db.insert("store", {
        createdByUserId: userId,
        currency: "GHS",
        name: "Inventory Footprint",
        organizationId,
        slug: "inventory-footprint",
      });
      const categoryId = await ctx.db.insert("category", {
        name: "Category",
        slug: "category",
        storeId,
      });
      const subcategoryId = await ctx.db.insert("subcategory", {
        categoryId,
        name: "Subcategory",
        slug: "subcategory",
        storeId,
      });
      const productId = await ctx.db.insert("product", {
        availability: "live",
        categoryId,
        createdByUserId: userId,
        currency: "GHS",
        inventoryCount: 0,
        name: "Product",
        organizationId,
        slug: "product",
        storeId,
        subcategoryId,
      });
      const productSkuId = await ctx.db.insert("productSku", {
        attributes: {},
        images: [],
        inventoryCount: 0,
        price: 100,
        productId,
        quantityAvailable: 0,
        sku: "SKU-FOOTPRINT",
        storeId,
      });
      const shadowPositionId = await ctx.db.insert(
        "reportingInventoryPosition",
        {
          costedQuantity: 0,
          knownCostPoolMinor: 0,
          lastEffectAt: 1,
          mode: "compatibility_shadow",
          onHandQuantity: 0,
          organizationId,
          productSkuId,
          sellableQuantity: 0,
          storeId,
          uncostedQuantity: 0,
          unresolvedDeficitQuantity: 0,
          updatedAt: 1,
          version: 1,
        },
      );
      await ctx.db.insert("reportingInventoryPositionRevision", {
        organizationId,
        positionId: shadowPositionId,
        productSkuId,
        recordedAt: 1,
        revisionKind: "rebuild_applied",
        storeId,
      });
      const frozenWatermark = Date.now() + 1_000;
      expect(
        await inventoryAuthorityFootprintWithCtx(ctx, {
          frozenWatermark,
          storeId,
        }),
      ).toBe("unavailable");
      expect(
        await findAuthoritativeInventoryRevisionAfterWithCtx(ctx, {
          stableWatermark: 0,
          storeId,
        }),
      ).toBeNull();

      const authoritativePositionId = await ctx.db.insert(
        "reportingInventoryPosition",
        {
        costedQuantity: 0,
        knownCostPoolMinor: 0,
        lastEffectAt: 1,
        mode: "authoritative",
        onHandQuantity: 0,
        organizationId,
        productSkuId,
        sellableQuantity: 0,
        storeId,
        uncostedQuantity: 0,
        unresolvedDeficitQuantity: 0,
        updatedAt: 1,
        version: 1,
        },
      );
      expect(
        await inventoryAuthorityFootprintWithCtx(ctx, {
          frozenWatermark,
          storeId,
        }),
      ).toBe("reconcile");
      const productSku = await ctx.db.get("productSku", productSkuId);
      if (!productSku) throw new Error("SKU fixture missing");
      const assessed = await assessSkuWithCtx(ctx, {
        frozenWatermark,
        run: {
          _id: "run-fixture",
          factContractVersion: 2,
          metricContractVersion: 1,
          organizationId,
          projectionContractVersion: 2,
          storeId,
        } as never,
        sku: productSku,
      });
      expect(assessed.position?._id).toBe(authoritativePositionId);
      expect(assessed.assessment.reason).toBe("missing_accepted_baseline");

      await ctx.db.insert("reportingInventoryPositionRevision", {
        organizationId,
        positionId: authoritativePositionId,
        productSkuId,
        recordedAt: 2,
        revisionKind: "rebuild_applied",
        storeId,
      });
      expect(
        await findAuthoritativeInventoryRevisionAfterWithCtx(ctx, {
          stableWatermark: 0,
          storeId,
        }),
      ).toMatchObject({ positionId: authoritativePositionId });
    });
  });

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

  it("propagates verified POS census lineage and its exact frozen watermark", () => {
    const source = readFileSync(
      "convex/reporting/maintenance/inventoryRebuild.ts",
      "utf8",
    );
    expect(source).toContain("projectionRebuildLineage({");
    expect(source).toContain("requireVerifiedPosBackfillLineageWithCtx(ctx, {");
    expect(source).toContain("backfillAuthorizationGrantId: lineage?.backfillAuthorizationGrantId");
    expect(source).toContain("censusToken: lineage?.censusToken");
    expect(source).toContain("sourceScope: lineage?.sourceScope");
    expect(source).toContain("sourceCensusHash: lineage?.sourceCensusHash");
    expect(source).toContain("factSnapshotWatermark: lineage?.factSnapshotWatermark");
    expect(source).toContain(
      "orphanPaymentCorrectionCount:\n        certifiedPosLineage?.orphanPaymentCorrectionCount",
    );
    expect(source).not.toContain("orphanPaymentCorrectionCount: args.");
    expect(source).toContain("lineage?.factSnapshotWatermark ?? Math.max(0, now - 1)");
    expect(source).toContain("if (!catchingUp && !run.backfillAuthorizationGrantId)");
    expect(source).toContain("reporting.activation.activateVerifiedGeneration");
    expect(source).toContain('defaultCompleteness: "unavailable"');
    expect(source).toContain('completeness: "unavailable"');
    expect(source).toContain('limitingReason: "source_incomplete"');
    expect(source).toMatch(
      /assessment\.reason === "position_after_frozen_watermark" &&\s+!run\.backfillAuthorizationGrantId/,
    );
  });
});
