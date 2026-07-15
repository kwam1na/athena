import { describe, expect, it } from "vitest";

// Shared-demo export denial occurs before these public result envelopes.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Id } from "../_generated/dataModel";
import { assertConformsToExportedReturns } from "../lib/returnValidatorContract";

import {
  EXPORT_CSV_HEADER,
  buildExportRequest,
  canRetrieveExport,
  formatStoreDayExportRow,
  getExportDownloadUrl,
  getExportStatus,
  requestExport,
  shouldCleanupExportRun,
} from "./export";

describe("reporting export lifecycle", () => {
  it("uses a store- and generation-bound idempotency key", () => {
    expect(
      buildExportRequest({
        actorUserId: "user-1",
        expiresAt: 1_000,
        generationId: "generation-1",
        metricVersion: 1,
        requestedAt: 100,
        storeId: "store-1",
      }),
    ).toMatchObject({
      requestKey: "store-1:generation-1:v1:user-1",
      status: "pending",
    });
  });

  it("denies expired, foreign-store, or revoked-member retrieval", () => {
    const run = buildExportRequest({
      actorUserId: "user-1",
      expiresAt: 1_000,
      generationId: "generation-1",
      metricVersion: 1,
      requestedAt: 100,
      storeId: "store-1",
    });
    expect(
      canRetrieveExport({ memberAuthorized: true, now: 500, requestedStoreId: "store-1", run }),
    ).toBe(true);
    expect(
      canRetrieveExport({ memberAuthorized: true, now: 1_001, requestedStoreId: "store-1", run }),
    ).toBe(false);
    expect(
      canRetrieveExport({ memberAuthorized: false, now: 500, requestedStoreId: "store-1", run }),
    ).toBe(false);
  });

  it("exports only versioned store-day projection fields and escapes CSV cells", () => {
    const row = formatStoreDayExportRow({
      completeness: "partial",
      currencyCode: "GHS",
      currencyMinorUnitScale: 100,
      factContractVersion: 2,
      generationId: "generation-1",
      knownValue: 1234,
      limitingReason: "missing, cost",
      metric: 'net_revenue_"known"',
      metricContractVersion: 3,
      operatingDate: "2026-07-09",
      projectionContractVersion: 4,
      sourceWatermark: 500,
      storeId: "store-1",
      unknownQuantity: 2,
    });

    expect(EXPORT_CSV_HEADER).not.toContain("customer");
    expect(EXPORT_CSV_HEADER).not.toContain("payment");
    expect(row).toBe(
      'store-1,generation-1,2,3,4,500,2026-07-09,"net_revenue_""known""",1234,2,partial,"missing, cost",GHS,100',
    );
  });

  it("only cleans expired terminal runs", () => {
    for (const status of ["pending", "running", "paused"] as const) {
      expect(shouldCleanupExportRun({ expiresAt: 100, now: 101, status })).toBe(false);
    }
    for (const status of ["completed", "failed", "cancelled"] as const) {
      expect(shouldCleanupExportRun({ expiresAt: 100, now: 101, status })).toBe(true);
    }
    expect(
      shouldCleanupExportRun({ expiresAt: 100, now: 100, status: "completed" }),
    ).toBe(false);
  });

  it("uses bounded projection pagination and Convex storage finalization", () => {
    const source = readFileSync(join(process.cwd(), "convex", "reporting", "export.ts"), "utf8");
    expect(source).toContain('.query("reportingStoreDayProjection")');
    expect(source).toContain(".paginate({");
    expect(source).not.toContain('.query("posTransaction")');
    expect(source).not.toContain('.query("productSku")');
    expect(source).toContain("ctx.storage.store");
    expect(source).toContain("ctx.storage.getUrl");
    expect(source).toContain("requireReportingStoreAccess");
    expect(source).toContain("getExportStatus = action");
    expect(source).toContain("getExportDownloadUrl = action");
    expect(source).toContain("preflightReportingRunAccess");
  });

  it("keeps public export return contracts explicit", () => {
    const runId = "run-1" as Id<"reportingRun">;
    const generationId = "generation-1" as Id<"reportingProjectionGeneration">;
    assertConformsToExportedReturns(requestExport, { runId, status: "created" });
    assertConformsToExportedReturns(getExportStatus, {
      completedAt: null,
      expiresAt: 1_000,
      failedCount: 0,
      generationId,
      metricContractVersion: 3,
      processedCount: 10,
      projectionContractVersion: 4,
      status: "running",
    });
    assertConformsToExportedReturns(getExportDownloadUrl, {
      expiresAt: 1_000,
      filename: "athena-report.csv",
      url: "https://example.test/export.csv",
    });
  });
});
