import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import schema from "../schema";

function indexes(tableName: string) {
  return ((schema as any).tables[tableName]?.indexes ?? []) as Array<{
    indexDescriptor: string;
    fields: string[];
  }>;
}

describe("reporting schema indexes", () => {
  it("keeps unknown ingress-line cost unknown instead of fabricating zero", () => {
    const source = readFileSync(
      join(process.cwd(), "convex", "schemas", "reporting", "facts.ts"),
      "utf8",
    );
    expect(source).toContain("cogsKnownMinor: v.optional(v.number())");
    expect(source).toContain("cogsKnownQuantity: v.optional(v.number())");
    expect(source).toContain("cogsUncoveredQuantity: v.optional(v.number())");
    expect(source).toContain('v.literal("partial")');
    const valuationSource = readFileSync(
      join(
        process.cwd(),
        "convex",
        "schemas",
        "reporting",
        "inventoryValuation.ts",
      ),
      "utf8",
    );
    expect(valuationSource).toMatch(
      /reportingCutoverBaselineSchema[\s\S]*uncostedQuantity: v\.number\(\),\s+unresolvedDeficitQuantity: v\.number\(\)/,
    );
  });

  it("owns ingress identity, fact ordering, generation, and child evidence indexes", () => {
    expect(indexes("reportingIngress")).toContainEqual({
      indexDescriptor: "by_storeId_sourceDomain_businessEventKey",
      fields: ["storeId", "sourceDomain", "businessEventKey"],
    });
    expect(indexes("reportingFact")).toContainEqual({
      indexDescriptor: "by_storeId_recognitionAt",
      fields: ["storeId", "recognitionAt"],
    });
    expect(indexes("reportingFact")).toContainEqual({
      indexDescriptor: "by_storeId_productSkuId_factType_operatingDate",
      fields: ["storeId", "productSkuId", "factType", "operatingDate"],
    });
    expect(indexes("reportingFact")).toContainEqual({
      indexDescriptor: "by_storeId_acceptedAt",
      fields: ["storeId", "acceptedAt"],
    });
    expect(indexes("reportingFact")).toContainEqual({
      indexDescriptor: "by_storeId_productSkuId_recognitionAt",
      fields: ["storeId", "productSkuId", "recognitionAt"],
    });
    expect(indexes("reportingFact")).toContainEqual({
      indexDescriptor: "by_storeId_canonicalProductSkuId_recognitionAt",
      fields: ["storeId", "canonicalProductSkuId", "recognitionAt"],
    });
    expect(indexes("reportingFact")).toContainEqual({
      indexDescriptor: "by_storeId_pendingCheckoutItemId_recognitionAt",
      fields: ["storeId", "pendingCheckoutItemId", "recognitionAt"],
    });
    expect(indexes("reportingFact")).toContainEqual({
      indexDescriptor: "by_inventoryEffectId",
      fields: ["inventoryEffectId"],
    });
    expect(indexes("reportingFact")).toContainEqual({
      indexDescriptor: "by_storeId_productSkuId_sourceDomain_recognitionAt",
      fields: ["storeId", "productSkuId", "sourceDomain", "recognitionAt"],
    });
    expect(indexes("reportingIngressLine")).toContainEqual({
      indexDescriptor: "by_ingressId_lineKey",
      fields: ["ingressId", "lineKey"],
    });
    expect(indexes("reportingIngressLine")).toContainEqual({
      indexDescriptor: "by_storeId_productSkuId_createdAt",
      fields: ["storeId", "productSkuId", "createdAt"],
    });
    expect(indexes("reportingFactSourceReference")).toContainEqual({
      indexDescriptor: "by_factId",
      fields: ["factId"],
    });
    expect(indexes("reportingInventoryDeficitLot")).toContainEqual({
      indexDescriptor: "by_positionId_status_occurredAt",
      fields: ["positionId", "status", "occurredAt"],
    });
    expect(indexes("reportingInventoryDeficitLot")).toContainEqual({
      indexDescriptor: "by_positionId_status_occurredAt_outboundEffectId",
      fields: ["positionId", "status", "occurredAt", "outboundEffectId"],
    });
    expect(indexes("reportingInventoryPosition")).toContainEqual({
      indexDescriptor: "by_storeId_mode_lastEffectAt",
      fields: ["storeId", "mode", "lastEffectAt"],
    });
    expect(indexes("reportingInventoryPosition")).toContainEqual({
      indexDescriptor: "by_storeId_mode_updatedAt",
      fields: ["storeId", "mode", "updatedAt"],
    });
    expect(indexes("reportingFact")).toContainEqual({
      indexDescriptor: "by_storeId_createdAt",
      fields: ["storeId", "createdAt"],
    });
    expect(indexes("reportingSkuValuationCorrection")).toContainEqual({
      indexDescriptor: "by_storeId_requestKey",
      fields: ["storeId", "requestKey"],
    });
    expect(indexes("reportingSkuValuationCorrection")).toContainEqual({
      indexDescriptor: "by_storeId_productSkuId_occurredAt",
      fields: ["storeId", "productSkuId", "occurredAt"],
    });
    expect(indexes("reportingProjectionGeneration")).toContainEqual({
      indexDescriptor: "by_storeId_projectionKind_status",
      fields: ["storeId", "projectionKind", "status"],
    });
    expect(indexes("athenaUser")).toContainEqual({
      indexDescriptor: "by_normalizedEmail",
      fields: ["normalizedEmail"],
    });
    expect(indexes("paymentAllocation")).toContainEqual({
      indexDescriptor: "by_storeId_businessEventKey",
      fields: ["storeId", "businessEventKey"],
    });
    expect(indexes("paymentAllocation")).toContainEqual({
      indexDescriptor: "by_storeId_recordedAt",
      fields: ["storeId", "recordedAt"],
    });
    expect(indexes("onlineOrder")).toContainEqual({
      indexDescriptor: "by_storeId_status_completedAt",
      fields: ["storeId", "status", "completedAt"],
    });
    expect(indexes("serviceCase")).toContainEqual({
      indexDescriptor: "by_storeId_status_completedAt",
      fields: ["storeId", "status", "completedAt"],
    });
    expect(indexes("reportingSkuDayProjection")).toContainEqual({
      indexDescriptor: "by_generationId_operatingDate_productSkuId_metric",
      fields: ["generationId", "operatingDate", "productSkuId", "metric"],
    });
    expect(indexes("reportingStoreDayProjection")).toContainEqual({
      indexDescriptor:
        "by_gen_date_metric_schedule",
      fields: [
        "generationId",
        "operatingDate",
        "metric",
        "scheduleVersionId",
      ],
    });
    expect(indexes("reportingStoreDayProjection")).toContainEqual({
      indexDescriptor:
        "by_gen_date_metric_policy",
      fields: [
        "generationId",
        "operatingDate",
        "metric",
        "historicalInterpretationPolicyId",
      ],
    });
    expect(indexes("reportingSkuDayProjection")).toContainEqual({
      indexDescriptor:
        "by_gen_sku_date_metric_schedule",
      fields: [
        "generationId",
        "productSkuId",
        "operatingDate",
        "metric",
        "scheduleVersionId",
      ],
    });
    expect(indexes("reportingSkuDayProjection")).toContainEqual({
      indexDescriptor:
        "by_gen_sku_date_metric_policy",
      fields: [
        "generationId",
        "productSkuId",
        "operatingDate",
        "metric",
        "historicalInterpretationPolicyId",
      ],
    });
    expect(indexes("reportingDailyCloseProjection")).toContainEqual({
      indexDescriptor: "by_gen_close_source",
      fields: ["generationId", "acceptedCloseSourceId"],
    });
    expect(indexes("reportingDailyCloseProjection")).toContainEqual({
      indexDescriptor: "by_gen_date_close_version_source",
      fields: [
        "generationId",
        "operatingDate",
        "acceptedCloseVersion",
        "acceptedCloseSourceId",
      ],
    });
    expect(indexes("reportingDailyCloseProjection")).toContainEqual({
      indexDescriptor:
        "by_gen_date_schedule_close",
      fields: [
        "generationId",
        "operatingDate",
        "scheduleVersionId",
        "acceptedCloseVersion",
      ],
    });
    expect(indexes("reportingDailyCloseProjection")).toContainEqual({
      indexDescriptor:
        "by_gen_date_policy_close",
      fields: [
        "generationId",
        "operatingDate",
        "historicalInterpretationPolicyId",
        "acceptedCloseVersion",
      ],
    });
    expect(indexes("reportingProjectionEvidence")).toContainEqual({
      indexDescriptor: "by_generationId_productSkuId_recognitionAt_factId",
      fields: ["generationId", "productSkuId", "recognitionAt", "factId"],
    });
    expect(indexes("reportingSkuEvidence")).toContainEqual({
      indexDescriptor: "by_storeId_productSkuId_recognitionAt_identityKey",
      fields: ["storeId", "productSkuId", "recognitionAt", "identityKey"],
    });
    expect(indexes("reportingSkuAttribution")).toContainEqual({
      indexDescriptor: "by_storeId_pendingCheckoutItemId",
      fields: ["storeId", "pendingCheckoutItemId"],
    });
    expect(indexes("reportingSkuAttribution")).toContainEqual({
      indexDescriptor: "by_storeId_status_updatedAt",
      fields: ["storeId", "status", "updatedAt"],
    });
    expect(indexes("reportingSkuEvidence")).toContainEqual({
      indexDescriptor: "by_storeId_identityKey",
      fields: ["storeId", "identityKey"],
    });
    expect(indexes("reportingProjectionEvidence")).toContainEqual({
      indexDescriptor: "by_storeId_factId",
      fields: ["storeId", "factId"],
    });
    expect(indexes("reportingProjectionEvidence")).toContainEqual({
      indexDescriptor: "by_generationId_factId_metric",
      fields: ["generationId", "factId", "metric"],
    });
    expect(indexes("reportingProjectionEvidence")).toContainEqual({
      indexDescriptor: "by_generationId_inventoryEffectId_metric",
      fields: ["generationId", "inventoryEffectId", "metric"],
    });
    expect(indexes("reportingProjectionEvidence")).toContainEqual({
      indexDescriptor: "by_storeId_inventoryEffectId",
      fields: ["storeId", "inventoryEffectId"],
    });
    expect(indexes("reportingRun")).toContainEqual({
      indexDescriptor: "by_storeId_runType_requestKey",
      fields: ["storeId", "runType", "requestKey"],
    });
    expect(indexes("reportingReconciliationAccumulator")).toContainEqual({
      indexDescriptor: "by_runId_source_logicalKey_currencyKey",
      fields: ["runId", "source", "logicalKey", "currencyKey"],
    });
    expect(indexes("reportingReconciliationAccumulator")).toContainEqual({
      indexDescriptor: "by_runId_source",
      fields: ["runId", "source"],
    });
    expect(indexes("reportingReconciliationDiscrepancy")).toContainEqual({
      indexDescriptor: "by_runId_reconciliationKey",
      fields: ["runId", "reconciliationKey"],
    });
    expect(indexes("reportingReconciliationDiscrepancy")).toContainEqual({
      indexDescriptor: "by_runId_invariant",
      fields: ["runId", "invariant"],
    });
    expect(indexes("reportingReconciliationDiscrepancy")).toContainEqual({
      indexDescriptor: "by_reconciliationKey",
      fields: ["reconciliationKey"],
    });
    expect(indexes("reportingQuarantine")).toContainEqual({
      indexDescriptor: "by_inventoryEffectId",
      fields: ["inventoryEffectId"],
    });
    expect(indexes("reportingRangeProjection")).toContainEqual({
      indexDescriptor: "by_generationId_metric_currencyCode_productSkuId",
      fields: ["generationId", "metric", "currencyCode", "productSkuId"],
    });
    expect(indexes("reportingRun")).toContainEqual({
      indexDescriptor: "by_runType_status_expiresAt",
      fields: ["runType", "status", "expiresAt"],
    });
    expect(indexes("reportingExportChunk")).toContainEqual({
      indexDescriptor: "by_runId_sequence",
      fields: ["runId", "sequence"],
    });
    expect(indexes("reportingExportChunk")).toContainEqual({
      indexDescriptor: "by_storeId_runId_sequence",
      fields: ["storeId", "runId", "sequence"],
    });
    expect(indexes("reportingAttentionProjection")).toContainEqual({
      indexDescriptor: "by_generationId_scope_productSkuId",
      fields: ["generationId", "scope", "productSkuId"],
    });
    expect(indexes("reportingAttentionProjection")).toContainEqual({
      indexDescriptor: "by_storeId_scope_primaryReason",
      fields: ["storeId", "scope", "primaryReason"],
    });
    expect(indexes("reportingDailyCloseProjection")).toContainEqual({
      indexDescriptor: "by_generationId_operatingDate_acceptedCloseVersion",
      fields: ["generationId", "operatingDate", "acceptedCloseVersion"],
    });
    expect(indexes("reportingSkuInsightProjection")).toContainEqual({
      indexDescriptor: "by_generationId_productSkuId",
      fields: ["generationId", "productSkuId"],
    });
    expect(indexes("reportingSkuInsightProjection")).toContainEqual({
      indexDescriptor: "by_generationId_projectedDaysOfCover_productSkuId",
      fields: ["generationId", "projectedDaysOfCover", "productSkuId"],
    });
  });

  it("allows projection evidence to link facts or inventory effects", () => {
    const source = readFileSync(
      join(process.cwd(), "convex", "schemas", "reporting", "projections.ts"),
      "utf8",
    );
    expect(source).toContain('factId: v.optional(v.id("reportingFact"))');
    expect(source).toContain("factType: v.optional(reportingFactTypeSchema)");
    expect(source).toContain(
      'inventoryEffectId: v.optional(v.id("reportingInventoryEffect"))',
    );
    expect(source).toContain("effectType: v.optional(");
    expect(source).toContain("revenueCurrencyCode: v.optional(v.string())");
    expect(source).toContain("valuationCurrencyCode: v.optional(v.string())");
  });

  it("indexes historical policy, durable provenance, and bounded manifests", () => {
    expect(indexes("reportingHistoricalInterpretationPolicy")).toContainEqual({
      indexDescriptor: "by_storeId_status_intervalStart",
      fields: ["storeId", "status", "intervalStart"],
    });
    expect(indexes("reportingHistoricalInterpretationPolicy")).toContainEqual({
      indexDescriptor: "by_storeId_version",
      fields: ["storeId", "version"],
    });
    expect(indexes("reportingHistoricalInterpretationEvidence")).toContainEqual({
      indexDescriptor: "by_storeId_factId",
      fields: ["storeId", "factId"],
    });
    expect(indexes("reportingBackfillApplyManifest")).toContainEqual({
      indexDescriptor: "by_storeId_status_cleanupEligibleAt",
      fields: ["storeId", "status", "cleanupEligibleAt"],
    });
    expect(indexes("reportingBackfillApplyManifestItem")).toContainEqual({
      indexDescriptor: "by_manifestId_sequence",
      fields: ["manifestId", "sequence"],
    });
  });
});
