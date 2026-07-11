import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  boundReportingPagination,
  buildReportingOverview,
  REPORTING_PUBLIC_PAGE_SIZE_MAX,
  publicPeriodLineage,
} from "./public";

describe("public reporting overview contract", () => {
  it("serializes schedule and policy lineage as distinguishable browser-safe segments", () => {
    expect(publicPeriodLineage({ scheduleVersionId: "schedule-1" as never })).toEqual({
      kind: "store_schedule",
      id: "schedule-1",
    });
    expect(
      publicPeriodLineage({
        historicalInterpretationPolicyId: "policy-1" as never,
        historicalInterpretationPolicyHash: "hash-1",
      }),
    ).toEqual({ kind: "historical_policy", id: "policy-1", hash: "hash-1" });
  });
  it("clamps caller page sizes to the public read budget", () => {
    expect(
      boundReportingPagination({ cursor: "cursor-1", numItems: 10_000 }),
    ).toEqual({
      cursor: "cursor-1",
      numItems: REPORTING_PUBLIC_PAGE_SIZE_MAX,
    });
    expect(boundReportingPagination({ cursor: null, numItems: 0 })).toEqual({
      cursor: null,
      numItems: 1,
    });
  });

  it("returns explicit partial state instead of false zeroes", () => {
    expect(
      buildReportingOverview({
        generation: null,
        health: { status: "pre_cutover" },
        storeId: "store-1",
      }),
    ).toEqual({
      data: null,
      generationId: null,
      health: { status: "pre_cutover" },
      status: "pre_cutover",
      storeId: "store-1",
    });
  });

  it("preserves complete verified generation values including legitimate zero", () => {
    expect(
      buildReportingOverview({
        generation: {
          generationId: "generation-1",
          netRevenueMinor: 0,
          status: "verified",
        },
        health: { status: "healthy" },
        storeId: "store-1",
      }),
    ).toMatchObject({
      data: { netRevenueMinor: 0 },
      generationId: "generation-1",
      status: "verified",
    });
  });

  it("reads attention through authenticated active-generation indexes only", () => {
    const source = readFileSync(
      join(process.cwd(), "convex", "reporting", "public.ts"),
      "utf8",
    );
    expect(source).toMatch(
      /getActiveGeneration\([\s\S]*?args\.storeId,[\s\S]*?"attention"/,
    );
    expect(source).toContain('.withIndex("by_generationId_scope_productSkuId"');
    expect(source).toContain("requireReportingStoreAccess(ctx, args.storeId)");
    expect(source).not.toContain('.query("posTransaction")');
    expect(source).not.toContain('.query("purchaseOrder")');
  });

  it("reads bounded coverage from the last activated generation during candidate failure", () => {
    const source = readFileSync(
      join(process.cwd(), "convex", "reporting", "public.ts"),
      "utf8",
    );
    expect(source).toContain("export const listMetricCoverage = query");
    expect(source).toContain("const generation = await getActiveGeneration(");
    expect(source).toContain('.query("reportingMetricCoverage")');
    expect(source).toContain(
      ".paginate(boundReportingPagination(args.paginationOpts))",
    );
    expect(source).not.toContain('status: "failed_candidate"');
  });

  it("serves durable Daily Close and one-row-per-SKU insight contracts", () => {
    const source = readFileSync(
      join(process.cwd(), "convex", "reporting", "public.ts"),
      "utf8",
    );
    expect(source).toMatch(
      /getActiveGeneration\([\s\S]*?args\.storeId,[\s\S]*?"store_day"/,
    );
    expect(source).toContain('.query("reportingDailyCloseProjection")');
    expect(source).toContain("historyPage");
    expect(source).toContain("closeHistoryQuery().paginate(");
    expect(source).toMatch(
      /getActiveGeneration\([\s\S]*?args\.storeId,[\s\S]*?"sku_day"/,
    );
    expect(source).toContain('.query("reportingSkuInsightProjection")');
    expect(source).toContain('.withIndex("by_generationId_productSkuId"');
    expect(source).toContain(
      ".paginate(boundReportingPagination(args.paginationOpts))",
    );
    expect(source).toContain("periodLineage: publicPeriodLineage(row)");
    expect(source).toContain("page: historyPage.page.map(presentDailyClose)");
  });

  it("ages health at read time and probes unprojected ingress through bounded indexes", () => {
    const source = readFileSync(
      join(process.cwd(), "convex", "reporting", "public.ts"),
      "utf8",
    );

    expect(source).toContain("summarizeProjectionHealthRead");
    expect(source).toContain(
      '.withIndex("by_storeId_sourceDomain_status_acceptedAt"',
    );
    expect(source).toContain('.eq("status", "pending")');
    expect(source).toContain('.eq("status", "processing")');
    expect(source).toContain('.eq("status", "processed")');
    expect(source).toContain(".take(101)");
    expect(source).not.toContain('.query("reportingIngress").collect()');
  });
});
