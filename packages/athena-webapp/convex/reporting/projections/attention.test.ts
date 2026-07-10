import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  assertAttentionSourceCoverage,
  buildAttentionProjection,
  presentAttentionReason,
} from "./attention";

const verifiedSources = [
  {
    completeness: "complete" as const,
    generationId: "sku-day-1",
    projectionKind: "sku_day" as const,
    sourceWatermark: 500,
    stableWatermark: 500,
    status: "active" as const,
  },
  {
    completeness: "complete" as const,
    generationId: "inventory-1",
    projectionKind: "current_inventory" as const,
    sourceWatermark: 480,
    stableWatermark: 480,
    status: "verified" as const,
  },
];

const attentionInput = {
  activeDays: 10,
  acceptedCloudLagMs: 0,
  confirmedInboundQuantity: 5,
  expectedInboundAt: 100,
  grossRecognizedSalesMinor: 10_000,
  hasFailedOrReviewActivity: false,
  netSoldUnits: 10,
  now: 200,
  projectedDaysOfCover: 3,
  refundVoidCorrectionCount: 3,
  refundVoidCorrectionMinor: 600,
  shortReceipt: true,
  uncostedEligibleRevenueMinor: 2_000,
  uncostedOnHandQuantity: 2,
};

describe("reporting attention projection", () => {
  it("retains deterministic reasons, precedence, versions, inputs, thresholds, and routes", () => {
    const projection = buildAttentionProjection({
      attentionGenerationId: "attention-1",
      factContractVersion: 1,
      metricContractVersion: 1,
      organizationId: "organization-1",
      productSkuId: "sku-1",
      projectionContractVersion: 1,
      scope: "sku",
      sourceInputs: verifiedSources,
      storeId: "store-1",
      values: attentionInput,
    });

    expect(projection.primaryReason).toBe("missing_cost");
    expect(projection.reasons.map((reason) => reason.code)).toEqual([
      "missing_cost",
      "refund_void_correction",
      "late_inbound",
      "short_receipt",
      "missing_inbound_cover",
      "low_cover",
    ]);
    expect(projection.reasons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "missing_cost",
          inputs: expect.objectContaining({ skuId: "sku-1", uncostedOnHandQuantity: 2 }),
          route: "product_edit",
          ruleVersion: 2,
          threshold: { uncostedQuantityOrRevenueGreaterThan: 0 },
        }),
        expect.objectContaining({ code: "late_inbound", route: "procurement" }),
        expect.objectContaining({ code: "refund_void_correction", route: "transactions" }),
      ]),
    );
    expect(projection.sourceGenerationIds).toEqual(["inventory-1", "sku-day-1"]);
    expect(projection.sourceWatermark).toBe(480);
    expect(projection.completeness).toBe("complete");
    expect(projection.factContractVersion).toBe(1);
    expect(projection.metricContractVersion).toBe(1);
    expect(projection.projectionContractVersion).toBe(1);
    expect(presentAttentionReason(projection.reasons[0]!)).toEqual(
      expect.objectContaining({
        destination: { label: "Product editor", type: "product_edit" },
      }),
    );
  });

  it("marks mixed coverage partial and suppresses coverage-sensitive certainty", () => {
    const projection = buildAttentionProjection({
      attentionGenerationId: "attention-1",
      factContractVersion: 1,
      metricContractVersion: 1,
      organizationId: "organization-1",
      productSkuId: "sku-1",
      projectionContractVersion: 1,
      scope: "sku",
      sourceInputs: [
        verifiedSources[0],
        { ...verifiedSources[1], completeness: "partial" as const },
      ],
      storeId: "store-1",
      values: {
        ...attentionInput,
        confirmedInboundQuantity: 20,
        expectedInboundAt: undefined,
        refundVoidCorrectionCount: 1,
        shortReceipt: false,
        uncostedEligibleRevenueMinor: 0,
        uncostedOnHandQuantity: 0,
      },
    });

    expect(projection.completeness).toBe("partial");
    expect(projection.limitingReason).toBe("source_incomplete");
    expect(projection.primaryReason).toBe("source_integrity");
    expect(projection.reasons.map((reason) => reason.code)).toEqual([
      "source_integrity",
    ]);
    expect(projection.reasons[0]?.limitation).toContain("cannot be certified");
  });

  it("materializes store cash variance separately with its typed destination", () => {
    const projection = buildAttentionProjection({
      attentionGenerationId: "attention-1",
      factContractVersion: 1,
      metricContractVersion: 1,
      organizationId: "organization-1",
      projectionContractVersion: 1,
      scope: "store",
      sourceInputs: [verifiedSources[0]],
      storeId: "store-1",
      values: {
        activeDays: 0,
        cashVarianceMinor: -50,
        confirmedInboundQuantity: 0,
        grossRecognizedSalesMinor: 0,
        netSoldUnits: 0,
        now: 200,
        refundVoidCorrectionCount: 0,
        refundVoidCorrectionMinor: 0,
        uncostedEligibleRevenueMinor: 0,
        uncostedOnHandQuantity: 0,
      },
    });

    expect(projection.primaryReason).toBe("cash_variance");
    expect(projection.reasons).toEqual([
      expect.objectContaining({ code: "cash_variance", route: "cash_controls" }),
    ]);
  });

  it("rejects non-stable or non-verified source generations", () => {
    expect(() =>
      buildAttentionProjection({
        attentionGenerationId: "attention-1",
        factContractVersion: 1,
        metricContractVersion: 1,
        organizationId: "organization-1",
        productSkuId: "sku-1",
        projectionContractVersion: 1,
        scope: "sku",
        sourceInputs: [{ ...verifiedSources[0], status: "building" as const }],
        storeId: "store-1",
        values: attentionInput,
      }),
    ).toThrow("verified source generations");
  });

  it("requires caller coverage claims to match persisted generation truth", () => {
    expect(() =>
      assertAttentionSourceCoverage({
        persisted: {
          completeness: "partial",
          limitingReason: "mixed_currency",
        },
        requested: {
          completeness: "complete",
          limitingReason: undefined,
        },
      }),
    ).toThrow("coverage does not match");
    expect(() =>
      assertAttentionSourceCoverage({
        persisted: {
          completeness: "partial",
          limitingReason: "mixed_currency",
        },
        requested: {
          completeness: "partial",
          limitingReason: "mixed_currency",
        },
      }),
    ).not.toThrow();
  });

  it("uses only fixed source IDs and indexed attention rows at runtime", () => {
    const source = readFileSync(
      join(process.cwd(), "convex", "reporting", "projections", "attention.ts"),
      "utf8",
    );
    expect(source).toContain('.query("reportingAttentionProjection")');
    expect(source).toContain('.withIndex("by_generationId_scope_productSkuId"');
    expect(source).toContain("sourceGenerationIds.length > ATTENTION_SOURCE_LIMIT");
    expect(source).toContain("sourceGenerationIds: sortedSourceGenerationIds");
    expect(source).not.toContain('.query("posTransaction")');
    expect(source).not.toContain('.query("onlineOrder")');
    expect(source).not.toContain('.query("purchaseOrder")');
  });

  it("owns a bounded create, rebuild, verify, and activation lifecycle", () => {
    const source = readFileSync(
      join(process.cwd(), "convex", "reporting", "projections", "attention.ts"),
      "utf8",
    );
    expect(source).toContain("startAttentionGeneration = internalMutation");
    expect(source).toContain(
      "processAttentionGenerationBatch = internalMutation",
    );
    expect(source).toContain("ATTENTION_BUILD_PAGE_SIZE = 50");
    expect(source).toContain("ATTENTION_SOURCE_RETRY_LIMIT = 5");
    expect(source).toContain('.paginate({');
    expect(source).toContain('status: "verified"');
    expect(source).toContain("activateVerifiedGeneration");
    expect(source).toContain("expectedPriorGenerationId");
  });

  it("materializes store attention and reuses persisted SKU adjustment signals", () => {
    const source = readFileSync(
      join(process.cwd(), "convex", "reporting", "projections", "attention.ts"),
      "utf8",
    );
    expect(source).toContain('.query("registerSession")');
    expect(source).toContain('scope: "store"');
    expect(source).toContain("cashVarianceMinor");
    expect(source).toContain(
      "refundVoidCorrectionCount: insight.refundVoidCorrectionCount",
    );
    expect(source).toContain(
      "refundVoidCorrectionMinor: insight.refundVoidCorrectionMinor",
    );
    expect(source).toContain("rangeEndDate: reportingPeriod.operatingDate");
    expect(source).not.toContain("toISOString().slice(0, 10)");
  });
});
