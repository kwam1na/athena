import { describe, expect, it } from "vitest";

import type { Id } from "../_generated/dataModel";
import {
  buildHistoricalContextEventQuarantinePatch,
  buildHistoricalImportIdempotencyKey,
  buildHistoricalImportRunQuarantinePatch,
  buildHistoricalStorefrontContextImportRunRecord,
  planHistoricalStorefrontContextImport,
  selectHistoricalStorefrontContextImportRunWriteOperation,
} from "./historicalStorefrontContextImport";
import { compileLegacyStorefrontAnalyticsRow } from "./legacyStorefrontAnalytics";

type LegacyRow = Parameters<typeof compileLegacyStorefrontAnalyticsRow>[0] & {
  storeId: Id<"store">;
  storeFrontActorKind?: "storefrontUser" | "guest";
};

function analyticsRow(overrides: Partial<LegacyRow> = {}): LegacyRow {
  return {
    _id: "analytics_1" as LegacyRow["_id"],
    _creationTime: 1_700_000_000_000,
    action: "viewed_product",
    data: {},
    device: "mobile",
    origin: "web",
    productId: "product_1" as LegacyRow["productId"],
    storeFrontUserId: "guest_1" as LegacyRow["storeFrontUserId"],
    storeId: "store_1" as Id<"store">,
    ...overrides,
  };
}

describe("historical storefront context import planning", () => {
  it("produces a dry-run discovery report without append writes", () => {
    const plan = planHistoricalStorefrontContextImport({
      importRunId: "import_1",
      mode: "dry_run",
      storeId: "store_1" as Id<"store">,
      rows: [
        analyticsRow({
          data: {
            categorySlug: "wigs",
            email: "customer@example.com",
          },
        }),
        analyticsRow({
          _id: "analytics_bad" as LegacyRow["_id"],
          productId: undefined,
          data: {},
        }),
      ],
    });

    expect(plan.appendArgs).toEqual([]);
    expect(plan.report).toMatchObject({
      importRunId: "import_1",
      mode: "dry_run",
      scannedRowCount: 2,
      importableRowCount: 1,
      rejectedRowCount: 1,
      omittedFieldCount: 1,
      eventFamilyCounts: {
        "storefront.product_viewed": 1,
      },
      actionCounts: {
        viewed_product: 2,
      },
      payloadKeyCounts: {
        categorySlug: 1,
        email: 1,
      },
      rejectionReasons: {
        unmappable_or_missing_required_context: 1,
      },
    });
  });

  it("requires mapping approval before write mode produces append args", () => {
    const plan = planHistoricalStorefrontContextImport({
      importRunId: "import_1",
      mode: "write",
      storeId: "store_1" as Id<"store">,
      rows: [analyticsRow()],
    });

    expect(plan.appendArgs).toEqual([]);
    expect(plan.report).toMatchObject({
      stopped: true,
      stopReason: "write_requires_mapping_approval",
    });
  });

  it("builds imported context append args with run lineage and no raw legacy payload", () => {
    const plan = planHistoricalStorefrontContextImport({
      importRunId: "import_1",
      mode: "write",
      storeId: "store_1" as Id<"store">,
      rows: [
        analyticsRow({
          data: {
            categorySlug: "wigs",
            email: "customer@example.com",
            nested: { unsafe: true },
          },
        }),
      ],
      approval: {
        approvedBy: "operator_1",
        approvedAt: 1_700_000_000_500,
        mappingVersion: "v1",
      },
      now: 1_700_000_000_700,
    });

    expect(plan.appendArgs).toHaveLength(1);
    expect(plan.appendArgs[0]).toMatchObject({
      eventId: "storefront.product_viewed",
      payload: {
        productId: "product_1",
        categorySlug: "wigs",
      },
      historicalImportRunId: "import_1",
      historicalImportStatus: "active",
      actorRef: undefined,
      sourceRefs: [
        {
          table: "analytics",
          id: "analytics_1",
          redaction: "historical_import_no_raw_payload",
        },
        {
          table: "contextEventImportRun",
          id: "import_1",
          redaction: "metadata_only",
        },
      ],
    });
    expect(JSON.stringify(plan.appendArgs[0])).not.toContain("customer@example.com");
    expect(JSON.stringify(plan.appendArgs[0])).not.toContain("nested");
  });

  it("only attaches historical actors when the import row has an explicit actor kind", () => {
    const plan = planHistoricalStorefrontContextImport({
      importRunId: "import_1",
      mode: "write",
      storeId: "store_1" as Id<"store">,
      rows: [
        analyticsRow({
          storeFrontUserId: "guest_actual_convex_id" as LegacyRow["storeFrontUserId"],
          storeFrontActorKind: "guest",
        }),
      ],
      approval: {
        approvedBy: "operator_1",
        approvedAt: 1,
        mappingVersion: "v1",
      },
    });

    expect(plan.appendArgs[0]).toMatchObject({
      actorRef: {
        kind: "guest",
        id: "guest_actual_convex_id",
      },
    });
  });

  it("reports duplicates and conflicts without hiding partial resume state", () => {
    const compiled = compileLegacyStorefrontAnalyticsRow(analyticsRow())!;
    const duplicateKey = buildHistoricalImportIdempotencyKey("import_1", compiled);

    const plan = planHistoricalStorefrontContextImport({
      importRunId: "import_1",
      mode: "write",
      storeId: "store_1" as Id<"store">,
      rows: [
        analyticsRow(),
        analyticsRow({
          _id: "analytics_conflict" as LegacyRow["_id"],
          productId: "product_2" as LegacyRow["productId"],
        }),
      ],
      existingIdempotencyKeys: new Set([duplicateKey]),
      conflictIdempotencyKeys: new Set([
        "historical_storefront_analytics:analytics:analytics_conflict:storefront.product_viewed:1",
      ]),
      approval: {
        approvedBy: "operator_1",
        approvedAt: 1,
        mappingVersion: "v1",
      },
    });

    expect(plan.report).toMatchObject({
      scannedRowCount: 2,
      duplicateRowCount: 1,
      conflictRowCount: 1,
      importableRowCount: 0,
    });
    expect(plan.appendArgs).toEqual([]);
  });

  it("uses stable source idempotency across import run retries", () => {
    const compiled = compileLegacyStorefrontAnalyticsRow(analyticsRow())!;

    expect(buildHistoricalImportIdempotencyKey("import_1", compiled)).toBe(
      buildHistoricalImportIdempotencyKey("import_2", compiled),
    );
  });

  it("builds import run records for insert and retry patch branches", () => {
    expect(selectHistoricalStorefrontContextImportRunWriteOperation(null)).toBe(
      "insert",
    );
    expect(
      selectHistoricalStorefrontContextImportRunWriteOperation({
        _id: "context_event_import_run_1",
        createdAt: 1_699_999_999_000,
      }),
    ).toBe("patch");

    expect(
      buildHistoricalStorefrontContextImportRunRecord({
        importRunId: "import_1",
        importBatchId: "batch_1",
        runKey: "run_key_1",
        storeId: "store_1" as Id<"store">,
        mode: "write",
        status: "write_applied",
        report: { importableRowCount: 1 },
        reviewedMappingApproval: {
          approvedBy: "operator_1",
          approvedAt: 1,
          mappingVersion: "v1",
        },
        now: 1_700_000_000_000,
      }),
    ).toMatchObject({
      importRunId: "import_1",
      importBatchId: "batch_1",
      runKey: "run_key_1",
      status: "write_applied",
      report: { importableRowCount: 1 },
      updatedAt: 1_700_000_000_000,
    });
  });

  it("builds quarantine patches that remove imported events from compiler trust", () => {
    expect(buildHistoricalContextEventQuarantinePatch("revoked")).toEqual({
      historicalImportStatus: "revoked",
      nonCompilable: true,
    });
    expect(
      buildHistoricalImportRunQuarantinePatch({
        status: "quarantined",
        reason: "mapping_review_failed",
        now: 1_700_000_000_000,
      }),
    ).toEqual({
      status: "quarantined",
      quarantineReason: "mapping_review_failed",
      updatedAt: 1_700_000_000_000,
    });
  });

  it("stops write batches when rejection thresholds are exceeded", () => {
    const plan = planHistoricalStorefrontContextImport({
      importRunId: "import_1",
      mode: "write",
      storeId: "store_1" as Id<"store">,
      rows: [
        analyticsRow({ productId: undefined, data: {} }),
        analyticsRow({
          _id: "analytics_bad_2" as LegacyRow["_id"],
          productId: undefined,
          data: {},
        }),
      ],
      stopThresholds: { maxRejectedRows: 0 },
      approval: {
        approvedBy: "operator_1",
        approvedAt: 1,
        mappingVersion: "v1",
      },
    });

    expect(plan.report).toMatchObject({
      scannedRowCount: 1,
      rejectedRowCount: 1,
      stopped: true,
      stopReason: "rejected_threshold_exceeded",
    });
  });

  it("stops write batches when conflict thresholds are exceeded", () => {
    const plan = planHistoricalStorefrontContextImport({
      importRunId: "import_1",
      mode: "write",
      storeId: "store_1" as Id<"store">,
      rows: [analyticsRow()],
      conflictIdempotencyKeys: new Set([
        "historical_storefront_analytics:analytics:analytics_1:storefront.product_viewed:1",
      ]),
      stopThresholds: { maxConflictRows: 0 },
      approval: {
        approvedBy: "operator_1",
        approvedAt: 1,
        mappingVersion: "v1",
      },
    });

    expect(plan.report).toMatchObject({
      scannedRowCount: 1,
      conflictRowCount: 1,
      stopped: true,
      stopReason: "conflict_threshold_exceeded",
    });
    expect(plan.appendArgs).toEqual([]);
  });
});
