import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  boundReportingPagination,
  boundReportingWorkspacePagination,
  buildReportingOverview,
  customRangeSkuTerminalIsReadable,
  REPORTING_PUBLIC_PAGE_SIZE_MAX,
  publicPeriodLineage,
  presentReportItemMetrics,
  presentCurrentValuationResult,
  reportingGenerationHasReadableStableWatermark,
  reportingGenerationAttributionTerminalIsCurrent,
} from "./public";

describe("public reporting overview contract", () => {
  it("keeps custom overview money readable while stale item results fail closed", () => {
    const staleCursor = {
      latestActivatedSequence: 1,
      latestAppliedSequence: 1,
      latestMaterialSequence: 2,
    };
    expect(
      customRangeSkuTerminalIsReadable({
        cursor: null,
        generationTerminal: 1,
        requestedSurface: "overview",
        runTerminal: 1,
        workspaceTerminal: 1,
      }),
    ).toBe(true);
    expect(
      customRangeSkuTerminalIsReadable({
        cursor: staleCursor,
        generationTerminal: 1,
        requestedSurface: "sku_dependent",
        runTerminal: 1,
        workspaceTerminal: 1,
      }),
    ).toBe(false);
    expect(
      customRangeSkuTerminalIsReadable({
        cursor: {
          latestActivatedSequence: 2,
          latestAppliedSequence: 2,
          latestMaterialSequence: 2,
        },
        generationTerminal: 2,
        requestedSurface: "sku_dependent",
        runTerminal: 2,
        workspaceTerminal: 2,
      }),
    ).toBe(true);
  });
  it("fails stale post-conflict SKU reads closed without hiding store money", () => {
    const cursor = {
      latestActivatedSequence: 1,
      latestAppliedSequence: 1,
      latestMaterialSequence: 2,
    };
    expect(
      reportingGenerationAttributionTerminalIsCurrent({
        cursor,
        projectionKind: "sku_day",
        terminal: 1,
      }),
    ).toBe(false);
    expect(
      reportingGenerationAttributionTerminalIsCurrent({
        cursor,
        projectionKind: "store_day",
        terminal: undefined,
      }),
    ).toBe(true);
  });
  it("serializes schedule, timezone, and policy lineage as distinguishable browser-safe segments", () => {
    expect(publicPeriodLineage({ scheduleVersionId: "schedule-1" as never })).toEqual({
      kind: "store_schedule",
      id: "schedule-1",
    });
    expect(
      publicPeriodLineage({
        timezoneVersionId: "timezone-1" as never,
        timezoneVersionHash: "timezone-hash-1",
      }),
    ).toEqual({
      kind: "store_timezone",
      id: "timezone-1",
      hash: "timezone-hash-1",
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

  it("keeps hydrated workspace pages within the 350-document transition budget", () => {
    expect(boundReportingWorkspacePagination({ cursor: null, numItems: 10_000 })).toEqual({
      cursor: null,
      numItems: 25,
    });
  });

  it("uses persisted indexed classification filters and store-wide movement totals", () => {
    const source = readFileSync(join(process.cwd(), "convex", "reporting", "public.ts"), "utf8");
    expect(source).toContain("classification: v.union(");
    expect(source).toContain("by_epoch_period_class_revenue_sku");
    expect(source).toContain('.eq("classification", args.classification)');
    expect(source).toContain('.query("reportingSkuPeriodClassification")');
    expect(source).toContain("filter: args.classification");
    expect(source).toContain("cursorContextKey");
    expect(source).toContain('.query("reportingInventoryPeriodSummary")');
    expect(source).toContain("movementSummary");
    expect(source).not.toContain("movementSummary: hydrated.reduce");
  });

  it("binds workspace reads to active authority and serves custom presentation DTOs", () => {
    const source = readFileSync(join(process.cwd(), "convex", "reporting", "public.ts"), "utf8");
    expect(source).toContain('generation.status !== "active"');
    expect(source).toContain("decodeReportingCursor(args.paginationOpts.cursor, cursorContextKey)");
    expect(source).toContain("getReportsCustomRangePresentation = query");
    expect(source).toContain('v.literal("item_detail")');
    expect(source).toContain('inventoryLimitingReason: currentInventory && !inventoryCompatible');
  });

  it("keeps bundle-selected superseded members readable during atomic cutover and rollback", () => {
    const source = readFileSync(join(process.cwd(), "convex", "reporting", "public.ts"), "utf8");
    expect(source).toContain('(generation.status !== "active" && generation.status !== "superseded")');
    expect(source).not.toContain("generation.supersededAt !== undefined");
  });

  it("keeps the last activated stable snapshot readable while newer facts wait", () => {
    expect(
      reportingGenerationHasReadableStableWatermark({
        sourceWatermark: 200,
        stableWatermark: 100,
      }),
    ).toBe(true);
    expect(
      reportingGenerationHasReadableStableWatermark({
        sourceWatermark: 100,
        stableWatermark: 100,
      }),
    ).toBe(true);
    expect(
      reportingGenerationHasReadableStableWatermark({
        sourceWatermark: 100,
        stableWatermark: 200,
      }),
    ).toBe(false);
    expect(
      reportingGenerationHasReadableStableWatermark({
        sourceWatermark: 100,
        stableWatermark: undefined,
      }),
    ).toBe(false);
  });

  it("presents persisted item metrics with the browser DTO field names", () => {
    expect(
      presentReportItemMetrics({
        cost_coverage_basis_points: 8000,
        inventory_value: 75_000,
        merchandise_profit: 50_000,
        net_sales: 125_000,
        on_hand_units: 6,
        projected_days_of_cover: 5,
        units_returned: 1,
        units_sold: 4,
      }),
    ).toEqual({
      costCoverageBasisPoints: 8000,
      inventoryValueMinor: 75_000,
      knownGrossProfitMinor: 50_000,
      netRevenueMinor: 125_000,
      netSoldUnits: 3,
      onHandQuantity: 6,
      projectedDaysOfCover: 5,
    });
  });

  it("returns persisted currency code and minor-unit scale on item and inventory money DTOs", () => {
    const schemaSource = readFileSync(join(process.cwd(), "convex", "schemas", "reporting", "projections.ts"), "utf8");
    expect(schemaSource).toContain("revenueCurrencyCode: v.optional(v.string())");
    expect(schemaSource).toContain("revenueCurrencyMinorUnitScale: v.optional(v.number())");
    expect(schemaSource).toContain("valuationCurrencyCode: v.optional(v.string())");
    expect(schemaSource).toContain("valuationCurrencyMinorUnitScale: v.optional(v.number())");
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

  it("exposes certified current inventory source absence explicitly", () => {
    expect(
      presentCurrentValuationResult({
        generation: {
          _id: "generation-1",
          completeness: "unavailable",
          limitingReason: "source_incomplete",
          status: "active",
        },
        rows: [],
      }),
    ).toEqual({
      completeness: "unavailable",
      generationId: "generation-1",
      limitingReason: "source_incomplete",
      rows: [],
      status: "unavailable",
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
