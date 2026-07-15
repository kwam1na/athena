import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  planDomainRestore,
  remapDocumentIds,
  requireBoundedBatch,
  requireCurrentBaselineDocuments,
  SHARED_DEMO_MUTABLE_TABLES,
} from "./domainRestore";

describe("shared demo domain restore registry", () => {
  it("covers mutable tables and descendants for every approved demo domain", () => {
    expect([...new Set(SHARED_DEMO_MUTABLE_TABLES.map((entry) => entry.domain))]).toEqual([
      "pos", "inventory", "cash", "orders", "operations", "reporting", "staff",
    ]);
    expect(SHARED_DEMO_MUTABLE_TABLES.map((entry) => entry.tableName)).toEqual(
      expect.arrayContaining([
        "posLocalSyncEvent",
        "posLocalSyncConflict",
        "posPendingCheckoutItem",
        "posSession",
        "posSessionItem",
        "posTransactionItem",
        "productSkuSearch",
        "reportingInventoryPosition",
        "reportingInventoryPositionRevision",
        "reportingInventoryEffect",
        "reportingInventoryEffectSourceReference",
        "reportingInventoryDeficitLedger",
        "reportingInventoryDeficitLot",
        "reportingInventoryDeficitResolutionWork",
        "reportingInventoryOccurrenceReplay",
        "reportingInventoryOccurrenceReplayLot",
        "reportingInventoryOccurrenceReplayOutcome",
        "reportingReconciliationDiscrepancy",
        "stockAdjustmentBatch",
        "cycleCountDraft",
        "cycleCountDraftLine",
        "onlineOrderItem",
        "approvalRequest",
        "approvalProof",
        "approvalRequesterChallenge",
        "managerElevation",
        "operationalWorkItem",
        "reportingIngress",
        "reportingIngressSourceReference",
        "reportingIngressLine",
        "reportingIngressConflict",
        "reportingFact",
        "reportingFactSourceReference",
        "reportingFactProcessingAttempt",
        "reportingQuarantine",
        "reportingProjectionHealth",
        "reportingProjectionGeneration",
        "reportingProjectionActivation",
        "reportingStoreDayProjection",
        "reportingSkuDayProjection",
        "reportingCurrentValuationProjection",
        "reportingWorkspaceMaterializationEpoch",
        "reportingWorkspaceReadModelActivation",
        "reportingReadBundle",
        "reportingReadBundleActivation",
        "staffMessage",
        "staffCredential",
      ]),
    );
    expect(
      SHARED_DEMO_MUTABLE_TABLES.map((entry) => entry.tableName),
    ).not.toContain("posTerminal");
  });

  it("restores changed baseline rows, deletes demo additions, and ignores another tenant", () => {
    const plan = planDomainRestore({
      baseline: [{ _id: "base", storeId: "demo", value: "original" }],
      current: [
        { _id: "base", storeId: "demo", value: "changed" },
        { _id: "added", storeId: "demo", value: "visitor" },
        { _id: "other", storeId: "real", value: "untouched" },
      ],
      storeId: "demo",
    });
    expect(plan.replace).toEqual([{ _id: "base", storeId: "demo", value: "original" }]);
    expect(plan.remove).toEqual(["added"]);
    expect(plan.untouched).toEqual([{ _id: "other", storeId: "real", value: "untouched" }]);
  });

  it.each([
    "cycleCountDraft",
    "cycleCountDraftLine",
    "staffCredential",
    "posPendingCheckoutItem",
    "reportingInventoryDeficitLedger",
    "reportingInventoryDeficitLot",
    "reportingInventoryDeficitResolutionWork",
    "reportingInventoryOccurrenceReplay",
    "reportingInventoryOccurrenceReplayLot",
    "reportingInventoryOccurrenceReplayOutcome",
    "reportingReconciliationDiscrepancy",
  ])("converges visitor-created and mutated %s rows", (tableName) => {
    expect(
      SHARED_DEMO_MUTABLE_TABLES.some((entry) => entry.tableName === tableName),
    ).toBe(true);
    const plan = planDomainRestore({
      baseline: [{ _id: `${tableName}-base`, storeId: "demo", value: "baseline" }],
      current: [
        { _id: `${tableName}-base`, storeId: "demo", value: "visitor-mutated" },
        { _id: `${tableName}-visitor`, storeId: "demo", value: "visitor-created" },
      ],
      storeId: "demo",
    });
    expect(plan.replace).toEqual([
      { _id: `${tableName}-base`, storeId: "demo", value: "baseline" },
    ]);
    expect(plan.remove).toEqual([`${tableName}-visitor`]);
  });

  it("plans recreation when protected baseline rows were destructively removed", () => {
    expect(planDomainRestore({
      baseline: [{ _id: "base", storeId: "demo" }],
      current: [],
      storeId: "demo",
    })).toMatchObject({ missing: [{ _id: "base", storeId: "demo" }] });
  });

  it("rewrites dependent baseline references after recreating a missing row", () => {
    expect(remapDocumentIds({
      nested: { productId: "old-product" },
      productId: "old-product",
      values: ["old-product", "unrelated"],
    }, new Map([["old-product", "new-product"]]))).toEqual({
      nested: { productId: "new-product" },
      productId: "new-product",
      values: ["new-product", "unrelated"],
    });
  });

  it("fails closed instead of silently truncating an over-budget table", () => {
    expect(() => requireBoundedBatch(Array.from({ length: 501 }), "staffMessage")).toThrow("restore batch required");
  });

  it("rejects stale captured documents before restoring a table", () => {
    expect(() => requireCurrentBaselineDocuments([{ baselineVersion: 1 }], "dailyOpening")).toThrow("version mismatch");
    expect(
      requireCurrentBaselineDocuments(
        [{ baselineVersion: 1 }],
        "dailyOpening",
        1,
      ),
    ).toHaveLength(1);
  });

  it("uses the daily opening store-prefix index declared by the schema", () => {
    const source = readFileSync("convex/sharedDemo/domainRestore.ts", "utf8");
    expect(source).toContain('tableName === "dailyOpening"');
    expect(source).toContain('withIndex("by_storeId_operatingDate"');
  });

  it("uses declared store-prefix indexes for reporting ingress descendants", () => {
    const source = readFileSync("convex/sharedDemo/domainRestore.ts", "utf8");
    expect(source).toContain('tableName === "reportingIngress"');
    expect(source).toContain('withIndex("by_storeId_status_acceptedAt"');
    expect(source).toContain('withIndex("by_storeId_sourceType_sourceId"');
    expect(source).toContain('withIndex("by_storeId_productSkuId_createdAt"');
    expect(source).toContain('withIndex("by_storeId_status_detectedAt"');
    expect(source).toContain('withIndex("by_storeId_outcome_startedAt"');
    expect(source).toContain('withIndex("by_storeId_sourceDomain_projectionKind"');
    expect(source).toContain('withIndex("by_storeId_productSkuId_occurrenceAt"');
    expect(source).toContain('withIndex("by_storeId_action_subject"');
    expect(source).toContain('withIndex("by_storeId_terminalId_accountId"');
  });

  it("keeps approved-workflow descendants in the baseline schema", () => {
    const source = readFileSync("convex/schemas/sharedDemo.ts", "utf8");
    for (const tableName of [
      "approvalRequest",
      "approvalProof",
      "approvalRequesterChallenge",
      "managerElevation",
      "operationalWorkItem",
      "stockAdjustmentBatch",
      "cycleCountDraft",
      "cycleCountDraftLine",
      "staffCredential",
      "posPendingCheckoutItem",
      "reportingInventoryPositionRevision",
      "reportingInventoryEffect",
      "reportingInventoryEffectSourceReference",
      "reportingInventoryDeficitLedger",
      "reportingInventoryDeficitLot",
      "reportingInventoryDeficitResolutionWork",
      "reportingInventoryOccurrenceReplay",
      "reportingInventoryOccurrenceReplayLot",
      "reportingInventoryOccurrenceReplayOutcome",
      "reportingReconciliationDiscrepancy",
      "reportingIngress",
      "reportingIngressSourceReference",
      "reportingIngressLine",
      "reportingIngressConflict",
      "reportingFact",
      "reportingFactSourceReference",
      "reportingFactProcessingAttempt",
      "reportingQuarantine",
      "reportingProjectionHealth",
      "reportingProjectionGeneration",
      "reportingProjectionActivation",
      "reportingStoreDayProjection",
      "reportingSkuDayProjection",
      "reportingCurrentValuationProjection",
      "reportingWorkspaceMaterializationEpoch",
      "reportingWorkspaceReadModelActivation",
      "reportingReadBundle",
      "reportingReadBundleActivation",
    ]) {
      expect(source).toContain(`v.literal("${tableName}")`);
    }
  });

  it("walks reporting closure through deployed store and generation indexes", () => {
    const source = readFileSync("convex/sharedDemo/domainRestore.ts", "utf8");
    expect(source).toContain('"by_storeId_projectionKind_status"');
    expect(source).toContain('"by_generationId_periodKey"');
    expect(source).toContain('"by_sourceGenerationId_sourceWatermark"');
    expect(source).not.toContain('.filter((q: any)');
  });

  it("uses indexed ownership traversal for mutable rows without a store index", () => {
    const source = readFileSync("convex/sharedDemo/domainRestore.ts", "utf8");
    expect(source).toContain('tableName === "cycleCountDraftLine"');
    expect(source).toContain('withIndex("by_draftId"');
    expect(source).toContain('tableName === "reportingInventoryDeficitLedger"');
    expect(source).toContain('"by_positionId_status"');
    expect(source).toContain('tableName === "reportingInventoryDeficitLot"');
    expect(source).toContain('"by_positionId"');
    expect(source).toContain('tableName === "reportingInventoryOccurrenceReplayLot"');
    expect(source).toContain('"by_replayId_status_occurredAt_outboundEffectId"');
    expect(source).toContain('tableName === "reportingInventoryOccurrenceReplayOutcome"');
    expect(source).toContain('"by_replayId_status"');
    expect(source).toContain("withIndex(indexName");
  });

  it("routes register-session restore through authority writers", () => {
    const source = readFileSync("convex/sharedDemo/domainRestore.ts", "utf8");
    expect(source).toContain("insertRegisterSessionWithAuthority");
    expect(source).toContain("deleteRegisterSessionWithAuthority");
    expect(source).toContain("replaceRegisterSessionWithAuthority");
  });
});
