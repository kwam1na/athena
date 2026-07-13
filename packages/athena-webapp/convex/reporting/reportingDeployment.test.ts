import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { activateGeneration } from "./activation";
import { summarizeReportingHealth } from "./health";
import { processBoundedBatch } from "./maintenance/processing";
import { buildReportingOverview } from "./public";

function source(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

function countMatches(contents: string, pattern: RegExp) {
  return [...contents.matchAll(pattern)].length;
}

function reportingWriteTargets(contents: string) {
  return [
    ...contents.matchAll(
      /ctx\.db\.(?:insert|patch|replace|delete)\(\s*"([^"]+)"/g,
    ),
  ].map((match) => match[1]);
}

const verifiedGeneration = {
  contractVersion: 1,
  generationId: "generation-candidate",
  metricVersion: 1,
  reconciliationDifferenceCount: 0,
  requiredCoverageComplete: true,
  stableWatermark: true,
  status: "verified" as const,
};

describe("reporting shadow deployment architecture", () => {
  it("keeps generic reporting writes additive and canonicalization asynchronous", () => {
    const ingress = source("./ingress.ts");
    const runLedger = source("./maintenance/runLedger.ts");
    const genericWriteTargets = [
      ...reportingWriteTargets(ingress),
      ...reportingWriteTargets(runLedger),
    ];

    expect(genericWriteTargets.length).toBeGreaterThan(0);
    expect(
      genericWriteTargets.every((tableName) =>
        tableName.startsWith("reporting"),
      ),
    ).toBe(true);
    expect(ingress).toContain("scheduleReportingWorkBestEffort(");
    expect(ingress).toContain("processPendingIngress");
    expect(ingress).toContain("resumePendingIngressForStore");
    expect(ingress).not.toMatch(
      /ctx\.db\.(?:insert|patch|replace|delete)\(\s*"(?:posTransaction|onlineOrder|serviceCase|purchaseOrder|dailyClose)"/,
    );
  });

  it("keeps legacy compatibility writes inside reporting-owned tables", () => {
    const backfill = source("./maintenance/backfill.ts");
    const compatibility = source("./maintenance/legacyCompatibility.ts");
    const targets = [
      ...reportingWriteTargets(backfill),
      ...reportingWriteTargets(compatibility),
    ];
    expect(targets.length).toBeGreaterThan(0);
    expect(targets.every((table) => table.startsWith("reporting"))).toBe(true);
    expect(backfill).not.toMatch(
      /ctx\.db\.(?:patch|replace|delete)\(\s*"(?:posTransaction|paymentAllocation|expenseTransaction|purchaseOrder|onlineOrder|serviceCase|productSku)"/,
    );
  });

  it("defaults inventory migration to provisional compatibility shadow", () => {
    const effects = source("./inventory/effects.ts");

    expect(effects).toContain(
      "const mode = await inventoryAuthorityMode(ctx, args.storeId);",
    );
    expect(effects).toContain('generation.status === "active"');
    expect(effects).toContain(
      'generation.projectionKind === "current_inventory"',
    );
    expect(effects).toContain('mode === "compatibility_shadow"');
    expect(effects).toMatch(
      /mode === "compatibility_shadow"\s*\?\s*"provisional"\s*:\s*args\.completeness/,
    );
    expect(effects).toContain("args.compatibilityBalance");
  });

  it("keeps operational commands independent from report projections and activation", () => {
    const operationalSources = [
      "../pos/application/commands/completeTransaction.ts",
      "../pos/application/sync/projectLocalEvents.ts",
      "../storeFront/onlineOrder.ts",
      "../serviceOps/serviceCases.ts",
      "../stockOps/receiving.ts",
      "../inventory/expenseTransactions.ts",
      "../operations/dailyClose.ts",
    ];

    for (const path of operationalSources) {
      expect(source(path), path).not.toMatch(
        /reporting\/(?:activation|projections|public)/,
      );
    }
  });

  it("requires store access and indexed bounded reads on every public surface", () => {
    const publicModule = source("./public.ts");
    const evidenceModule = source("./evidence.ts");
    const accessModule = source("./access.ts");

    const publicQueryCount = countMatches(
      publicModule,
      /export const \w+ = query\(/g,
    );
    expect(publicQueryCount).toBeGreaterThan(0);
    expect(
      countMatches(publicModule, /await requireReportingStoreAccess\(/g),
    ).toBe(publicQueryCount);
    // Seven indexed statements probe ingress plus pending/failed fact and
    // inventory-effect projection work for the fixed source-domain registry.
    const publicDatabaseQueryCount = countMatches(
      publicModule,
      /ctx\.db\s*\.query\(/g,
    );
    expect(publicDatabaseQueryCount).toBeGreaterThan(0);
    expect(countMatches(publicModule, /\.withIndex\(/g)).toBeGreaterThanOrEqual(
      publicDatabaseQueryCount,
    );
    expect(publicModule).toContain("const REPORTING_SOURCE_DOMAINS = [");
    expect(publicModule).toContain("getReportingSourceActivity");
    expect(publicModule).not.toContain(".collect(");
    expect(publicModule).toContain(
      ".paginate(boundReportingPagination(args.paginationOpts))",
    );
    expect(publicModule).toContain(".take(100)");
    expect(publicModule).toContain(".take(50)");
    expect(publicModule).toContain(".take(2)");

    expect(countMatches(evidenceModule, /export const \w+ = action\(/g)).toBe(1);
    expect(
      countMatches(evidenceModule, /export const \w+ = internalQuery\(/g),
    ).toBe(1);
    expect(
      countMatches(evidenceModule, /export const \w+ = internalMutation\(/g),
    ).toBe(5);
    expect(
      countMatches(evidenceModule, /await requireReportingStoreAccess\(/g),
    ).toBe(3);
    const evidenceQueryCount = countMatches(
      evidenceModule,
      /ctx\.db\s*\.query\(/g,
    );
    expect(evidenceQueryCount).toBeGreaterThanOrEqual(2);
    expect(countMatches(evidenceModule, /\.withIndex\(/g)).toBe(
      evidenceQueryCount,
    );
    expect(evidenceModule).not.toContain(".collect(");
    expect(evidenceModule).toContain(
      ".paginate({ cursor: args.databaseCursor, numItems: args.numItems })",
    );

    expect(accessModule).toContain('.withIndex("by_organizationId_userId"');
    expect(accessModule).toContain(".take(2)");
    expect(accessModule).toContain('membership.role !== "full_admin"');
  });

  it("bounds replay work and preserves the active generation across failure and rollback", () => {
    const rows = Array.from({ length: 10_000 }, (_, index) => ({
      id: String(index).padStart(5, "0"),
      recordedAt: index,
    }));
    const batch = processBoundedBatch({
      batchSize: 200,
      cursor: null,
      frozenCutoff: rows.length,
      rows,
      status: "running",
    });

    expect(batch.processedRows).toHaveLength(200);
    expect(batch.scheduleNext).toBe(true);
    expect(
      processBoundedBatch({
        batchSize: 200,
        cursor: batch.nextCursor,
        frozenCutoff: rows.length,
        rows,
        status: "paused",
      }).processedRows,
    ).toEqual([]);

    expect(() =>
      activateGeneration({
        candidate: { ...verifiedGeneration, status: "failed" },
        currentGenerationId: "generation-active",
        expectedCurrentGenerationId: "generation-active",
        requiredContractVersion: 1,
        requiredMetricVersion: 1,
      }),
    ).toThrow("candidate is not verified");
    expect(
      buildReportingOverview({
        generation: {
          generationId: "generation-active",
          netRevenueMinor: 12_300,
          status: "verified",
        },
        health: { status: "failed" },
        storeId: "store-1",
      }),
    ).toMatchObject({
      generationId: "generation-active",
      health: { status: "failed" },
      status: "verified",
    });
    expect(
      summarizeReportingHealth({
        activated: true,
        failedRunCount: 1,
        latestAcceptedSourceAt: 10_000,
        latestProjectedSourceAt: 5_000,
        now: 20_000,
        projectionUpdatedAt: 5_000,
        quarantineCount: 0,
        requiredCoverageComplete: true,
      }).status,
    ).toBe("failed");
    const activationSource = source("./activation.ts");
    const bundleSource = source("./readModels/readBundle.ts");
    expect(activationSource).not.toContain("rollbackToVerifiedGeneration");
    expect(bundleSource).toContain("rollbackReportsReadBundle");
    expect(bundleSource).toContain("expectedCurrentBundleId");
  });
});
