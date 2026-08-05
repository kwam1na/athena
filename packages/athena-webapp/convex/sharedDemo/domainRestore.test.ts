import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  isDerivedRestoreTable,
  planBaselineDocumentPromotion,
  planDomainRestore,
  remapDocumentIds,
  requireBoundedBatch,
  requireCurrentBaselineDocuments,
  restoreBatchLimitFor,
  SHARED_DEMO_MUTABLE_TABLES,
} from "./domainRestore";

const DERIVED_REPORT_TABLES = [
  "reportFact",
  "reportDay",
  "reportSkuDay",
  "reportOverview",
  "reportPeriodSkuRollup",
  "reportDirtyDay",
  "reportWeekCurrent",
  "reportWeekAccepted",
  "reportDirtyWeek",
] as const;

const RETIRED_REPORTING_TABLES = [
  "reportingIngress",
  "reportingIngressSourceReference",
  "reportingIngressLine",
  "reportingIngressConflict",
  "reportingFact",
  "reportingFactSourceReference",
  "reportingFactProcessingAttempt",
  "reportingQuarantine",
  "reportingProjectionHealth",
  "reportingReconciliationDiscrepancy",
  "reportingProjectionGeneration",
  "reportingProjectionActivation",
  "reportingStoreDayProjection",
  "reportingStoreIntradayProjection",
  "reportingStoreIntradayScheduleState",
  "reportingSkuDayProjection",
  "reportingCurrentValuationProjection",
  "reportingRangeProjection",
  "reportingAttentionProjection",
  "reportingDailyCloseProjection",
  "reportingSkuInsightProjection",
  "reportingMetricCoverage",
  "reportingStorePeriodSummary",
  "reportingSkuPeriodSummary",
  "reportingSkuPeriodClassification",
  "reportingPeriodRollup",
  "reportingPeriodFacet",
  "reportingInventoryExposureSummary",
  "reportingInventoryMovementSummary",
  "reportingInventoryPeriodSummary",
  "reportingDailyCloseTrust",
  "reportingReadCursorContext",
  "reportingWorkspaceMaterializationEpoch",
  "reportingWorkspaceReadModelActivation",
  "reportingReadBundle",
  "reportingReadBundleActivation",
  "reportingProjectionEvidence",
  "reportingSkuEvidence",
] as const;

describe("shared demo domain restore registry", () => {
  it("promotes metadata-only baseline documents without replacing POS sync snapshots", () => {
    const rows = [
      {
        _id: "baseline-credential",
        baselineVersion: 16,
        document: { staffProfileId: "manager-1", username: "kwabena" },
        documentId: "credential-1",
        tableName: "staffCredential",
      },
      {
        _id: "baseline-sync-cursor",
        baselineVersion: 16,
        document: { acceptedThroughSequence: 8 },
        documentId: "cursor-1",
        tableName: "posLocalSyncCursor",
      },
    ];

    expect(
      planBaselineDocumentPromotion({
        fromVersion: 16,
        rows,
        toVersion: 17,
        transformDocument: (row) =>
          row.tableName === "staffCredential"
            ? { ...row.document, username: "kay" }
            : row.document,
      }),
    ).toEqual([
      {
        baselineVersion: 17,
        document: { staffProfileId: "manager-1", username: "kay" },
        rowId: "baseline-credential",
      },
      {
        baselineVersion: 17,
        document: { acceptedThroughSequence: 8 },
        rowId: "baseline-sync-cursor",
      },
    ]);
  });

  it("covers mutable tables and descendants for every approved demo domain", () => {
    expect([...new Set(SHARED_DEMO_MUTABLE_TABLES.map((entry) => entry.domain))]).toEqual([
      "pos", "inventory", "cash", "orders", "operations", "staff", "reports",
    ]);
    expect(SHARED_DEMO_MUTABLE_TABLES.map((entry) => entry.tableName)).toEqual(
      expect.arrayContaining([
        "posLocalSyncEvent",
        "posLocalSyncConflict",
        "posPendingCheckoutItem",
        "posSession",
        "posSessionItem",
        "posTransactionItem",
        "expenseTransaction",
        "expenseTransactionItem",
        "productSkuSearch",
        "reportingInventoryPosition",
        "reportingInventoryPositionRevision",
        "reportingInventoryEffect",
        "reportingInventoryEffectSourceReference",
        "reportingInventoryDeficitLedger",
        "reportingInventoryDeficitLot",
        "reportingInventoryDeficitResolutionWork",
        "stockAdjustmentBatch",
        "cycleCountDraft",
        "cycleCountDraftLine",
        "onlineOrderItem",
        "approvalRequest",
        "approvalProof",
        "approvalRequesterChallenge",
        "managerElevation",
        "operationalWorkItem",
        "paymentAllocation",
        "staffMessage",
        "staffCredential",
      ]),
    );
    expect(
      SHARED_DEMO_MUTABLE_TABLES.map((entry) => entry.tableName),
    ).not.toContain("posTerminal");
  });

  it("does not query occurrence replay tables removed from the deployed schema", () => {
    const tableNames = SHARED_DEMO_MUTABLE_TABLES.map(
      (entry) => entry.tableName,
    );
    const baselineSchema = readFileSync(
      "convex/schemas/sharedDemo.ts",
      "utf8",
    );
    const restoreSource = readFileSync(
      "convex/sharedDemo/domainRestore.ts",
      "utf8",
    );

    for (const tableName of [
      "reportingInventoryOccurrenceReplay",
      "reportingInventoryOccurrenceReplayLot",
      "reportingInventoryOccurrenceReplayOutcome",
    ]) {
      expect(tableNames).not.toContain(tableName);
      expect(restoreSource).not.toContain(`"${tableName}"`);
      expect(baselineSchema).toContain(`v.literal("${tableName}")`);
    }
  });

  it("does not query reporting tables retired by the fact-ledger rebuild", () => {
    const tableNames = SHARED_DEMO_MUTABLE_TABLES.map(
      (entry) => entry.tableName,
    );
    const baselineSchema = readFileSync(
      "convex/schemas/sharedDemo.ts",
      "utf8",
    );
    const restoreSource = readFileSync(
      "convex/sharedDemo/domainRestore.ts",
      "utf8",
    );

    for (const tableName of RETIRED_REPORTING_TABLES) {
      expect(tableNames).not.toContain(tableName);
      expect(restoreSource).not.toContain(`"${tableName}"`);
      expect(baselineSchema).toContain(`v.literal("${tableName}")`);
    }
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

  it("uses declared store-prefix indexes for retained reporting inventory tables", () => {
    const source = readFileSync("convex/sharedDemo/domainRestore.ts", "utf8");
    expect(source).toContain('withIndex("by_storeId_productSkuId_occurrenceAt"');
  });

  it("keeps approved-workflow descendants in the baseline schema", () => {
    const source = readFileSync("convex/schemas/sharedDemo.ts", "utf8");
    for (const tableName of [
      "approvalRequest",
      "approvalProof",
      "approvalRequesterChallenge",
      "managerElevation",
      "operationalWorkItem",
      "paymentAllocation",
      "stockAdjustmentBatch",
      "cycleCountDraft",
      "cycleCountDraftLine",
      "expenseTransaction",
      "expenseTransactionItem",
      "staffCredential",
      "posPendingCheckoutItem",
      "reportingInventoryPositionRevision",
      "reportingInventoryEffect",
      "reportingInventoryEffectSourceReference",
      "reportingInventoryDeficitLedger",
      "reportingInventoryDeficitLot",
      "reportingInventoryDeficitResolutionWork",
    ]) {
      expect(source).toContain(`v.literal("${tableName}")`);
    }
  });

  it("uses indexed ownership traversal for mutable rows without a store index", () => {
    const source = readFileSync("convex/sharedDemo/domainRestore.ts", "utf8");
    expect(source).toContain('tableName === "cycleCountDraftLine"');
    expect(source).toContain('withIndex("by_draftId"');
    expect(source).toContain('tableName === "expenseTransactionItem"');
    expect(source).toContain('ctx.db.query("expenseTransaction")');
    expect(source).toContain('ctx.db.query("expenseTransactionItem").withIndex("by_transactionId"');
    expect(source).toContain('tableName === "reportingInventoryDeficitLedger"');
    expect(source).toContain('"by_positionId_status"');
    expect(source).toContain('tableName === "reportingInventoryDeficitLot"');
    expect(source).toContain('"by_positionId"');
    expect(source).toContain("withIndex(indexName");
  });

  it("registers every reporting table the demo's own sales write", () => {
    const tableNames = SHARED_DEMO_MUTABLE_TABLES.map(
      (entry) => entry.tableName,
    );
    for (const tableName of DERIVED_REPORT_TABLES) {
      expect(tableNames).toContain(tableName);
      expect(
        SHARED_DEMO_MUTABLE_TABLES.find(
          (entry) => entry.tableName === tableName,
        )?.domain,
      ).toBe("reports");
    }
  });

  it("keeps derived reporting rows out of the captured baseline", () => {
    for (const tableName of DERIVED_REPORT_TABLES) {
      expect(isDerivedRestoreTable(tableName)).toBe(true);
    }
    for (const tableName of ["posTransaction", "onlineOrder", "dailyOpening"]) {
      expect(isDerivedRestoreTable(tableName)).toBe(false);
    }
  });

  it("purges every derived reporting row when the baseline holds none", () => {
    // A derived table is never captured, so its baseline is always empty and
    // restore is pure deletion. Facts especially: `foldDay` rebuilds a day from
    // surviving `reportFact` rows, so a fact that outlives the restore would
    // resurrect revenue whose transactions were already wiped.
    const plan = planDomainRestore({
      baseline: [],
      current: [
        { _id: "fact-1", storeId: "demo" },
        { _id: "fact-2", storeId: "demo" },
        { _id: "fact-other-tenant", storeId: "real" },
      ],
      storeId: "demo",
    });
    expect(plan.remove).toEqual(["fact-1", "fact-2"]);
    expect(plan.replace).toEqual([]);
    expect(plan.missing).toEqual([]);
    expect(plan.untouched).toEqual([
      { _id: "fact-other-tenant", storeId: "real" },
    ]);
  });

  it("gives fact rows a ceiling above the per-sale row multiple", () => {
    // One payment fact plus one sale fact per line means `reportFact` crosses
    // the shared 500-row ceiling several times sooner than the transactions
    // that produced it, and an over-budget throw fails the whole restore.
    expect(restoreBatchLimitFor("reportFact")).toBeGreaterThan(
      restoreBatchLimitFor("posTransaction"),
    );
    expect(() =>
      requireBoundedBatch(
        Array.from({ length: 501 }),
        "reportFact",
        restoreBatchLimitFor("reportFact"),
      ),
    ).not.toThrow();
    expect(() =>
      requireBoundedBatch(
        Array.from({ length: restoreBatchLimitFor("reportFact") + 1 }),
        "reportFact",
        restoreBatchLimitFor("reportFact"),
      ),
    ).toThrow("restore batch required");
  });

  it("routes register-session restore through authority writers", () => {
    const source = readFileSync("convex/sharedDemo/domainRestore.ts", "utf8");
    expect(source).toContain("insertRegisterSessionWithAuthority");
    expect(source).toContain("deleteRegisterSessionWithAuthority");
    expect(source).toContain("replaceRegisterSessionWithAuthority");
  });
});
