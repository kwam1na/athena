import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  boundCustomRangePagination,
  buildCustomRangeRequestKey,
  classifyCustomRangeSourceRow,
  CUSTOM_RANGE_MAX_DAYS,
  CUSTOM_RANGE_RESULT_PAGE_SIZE_MAX,
  customRangeResultBelongsToStore,
  customRangeSourcesAreAuthoritative,
  decideCustomRangeRequest,
  customRangeResultIdentity,
  customRangeSkuSourceTerminalIsCurrent,
  nextCustomRangeWork,
} from "./customRangeRequests";

const request = {
  endOperatingDate: "2026-07-09",
  metricVersion: 1,
  requestedWatermark: 500,
  sourceGenerationId: "generation-1",
  startOperatingDate: "2026-07-01",
  storeId: "store-1",
};

describe("custom reporting range requests", () => {
  it("rejects new item range authority after a post-activation conflict", () => {
    expect(
      customRangeSkuSourceTerminalIsCurrent({
        cursor: {
          latestActivatedSequence: 1,
          latestAppliedSequence: 1,
          latestMaterialSequence: 2,
        },
        runTerminal: 1,
        skuGenerationTerminal: 1,
      }),
    ).toBe(false);
    expect(
      customRangeSkuSourceTerminalIsCurrent({
        cursor: {
          latestActivatedSequence: 2,
          latestAppliedSequence: 2,
          latestMaterialSequence: 2,
        },
        runTerminal: 2,
        skuGenerationTerminal: 2,
      }),
    ).toBe(true);
  });
  it("uses one full source-authority predicate across store and SKU generations", () => {
    const authority = { factContractVersion: 1, metricContractVersion: 1, organizationId: "org-1", projectionContractVersion: 1, stableWatermark: 100, storeId: "store-1" };
    const member = { generationId: "store-generation", projectionKind: "store_day" };
    const generation = { ...authority, generationId: "store-generation", projectionKind: "store_day", sourceWatermark: 100, status: "active" };
    const input = { authority, skuMember: { generationId: "sku-generation", projectionKind: "sku_day" }, skuGeneration: { ...generation, generationId: "sku-generation", projectionKind: "sku_day" }, storeMember: member, storeGeneration: generation };
    expect(customRangeSourcesAreAuthoritative(input)).toBe(true);
    expect(customRangeSourcesAreAuthoritative({ ...input, skuGeneration: { ...input.skuGeneration, stableWatermark: 99 } })).toBe(false);
    expect(customRangeSourcesAreAuthoritative({ ...input, storeGeneration: { ...input.storeGeneration, status: "superseded" } })).toBe(true);
    expect(customRangeSourcesAreAuthoritative({
      ...input,
      skuGeneration: { ...input.skuGeneration, status: "superseded" },
      storeGeneration: { ...input.storeGeneration, status: "superseded" },
    })).toBe(true);
    expect(customRangeSourcesAreAuthoritative({ ...input, skuMember: { ...input.skuMember, generationId: "other" } })).toBe(false);
    expect(customRangeSourcesAreAuthoritative({ ...input, storeGeneration: { ...input.storeGeneration, organizationId: "foreign" } })).toBe(false);
  });
  it("uses idempotent identities for every persisted result family", () => {
    expect(customRangeResultIdentity({ family: "sku", metric: "net_sales", productSkuId: "sku-1" })).toBe("sku:sku-1:net_sales");
    expect(customRangeResultIdentity({ dimensionId: "category-1", family: "category_rollup", metric: "units_sold" })).toBe("category_rollup:category-1:units_sold");
  });

  it("resumes store, SKU, and derivation phases without skipping work", () => {
    expect(nextCustomRangeWork({ date: "2026-07-01", endDate: "2026-07-02", pageDone: true, phase: "store" })).toEqual({ date: "2026-07-01", phase: "sku" });
    expect(nextCustomRangeWork({ date: "2026-07-01", endDate: "2026-07-02", pageDone: true, phase: "sku" })).toEqual({ date: "2026-07-02", phase: "store" });
    expect(nextCustomRangeWork({ date: "2026-07-02", endDate: "2026-07-02", pageDone: true, phase: "sku" })).toEqual({ date: "2026-07-02", phase: "derive" });
  });
  it("uses one deterministic identity for matching work", () => {
    expect(buildCustomRangeRequestKey(request)).toBe(
      "store-1:2026-07-01:2026-07-09:v1:w500:ggeneration-1",
    );
    expect(
      decideCustomRangeRequest({
        activeRuns: [],
        existingRun: {
          requestKey: buildCustomRangeRequestKey(request),
          status: "building",
        },
        request,
      }),
    ).toEqual({
      requestKey: buildCustomRangeRequestKey(request),
      status: "reused",
    });
  });

  it("enforces the per-store candidate cap", () => {
    expect(() =>
      decideCustomRangeRequest({
        activeRuns: [
          { requestKey: "one", status: "building", storeId: "store-1" },
          { requestKey: "two", status: "catching_up", storeId: "store-1" },
        ],
        existingRun: null,
        request,
      }),
    ).toThrow("custom range concurrency limit reached");
  });

  it("rejects invalid or reversed operating dates", () => {
    expect(() =>
      buildCustomRangeRequestKey({
        ...request,
        startOperatingDate: "2026-07-10",
      }),
    ).toThrow("invalid operating date range");
    expect(() =>
      buildCustomRangeRequestKey({
        ...request,
        startOperatingDate: "2026-99-99",
      }),
    ).toThrow("invalid operating date range");
    expect(() =>
      buildCustomRangeRequestKey({
        ...request,
        endOperatingDate: "2037-07-01",
        startOperatingDate: "2026-07-01",
      }),
    ).toThrow("custom range exceeds supported day limit");
    expect(CUSTOM_RANGE_MAX_DAYS).toBeGreaterThan(365);
  });

  it("clamps result pages to the public reporting budget", () => {
    expect(
      boundCustomRangePagination({ cursor: "cursor-1", numItems: 50_000 }),
    ).toEqual({
      cursor: "cursor-1",
      numItems: CUSTOM_RANGE_RESULT_PAGE_SIZE_MAX,
    });
    expect(boundCustomRangePagination({ cursor: null, numItems: 0 })).toEqual({
      cursor: null,
      numItems: 1,
    });
  });

  it("freezes membership to complete rows from the verified source generation", () => {
    const snapshot = {
      frozenWatermark: 500,
      metricContractVersion: 1,
    };
    const row = {
      completeness: "complete",
      metricContractVersion: 1,
      sourceWatermark: 500,
    };

    expect(classifyCustomRangeSourceRow(row, snapshot)).toEqual({
      eligible: true,
      limited: false,
    });
    expect(
      classifyCustomRangeSourceRow({ ...row, sourceWatermark: 501 }, snapshot),
    ).toEqual({ eligible: false, limited: true });
    expect(
      classifyCustomRangeSourceRow(
        { ...row, metricContractVersion: 2 },
        snapshot,
      ),
    ).toEqual({ eligible: false, limited: true });
    expect(
      classifyCustomRangeSourceRow(
        { ...row, completeness: "partial" },
        snapshot,
      ),
    ).toEqual({ eligible: true, limited: true });
  });

  it("does not expose a foreign run or a foreign range generation", () => {
    const run = {
      generationId: "generation-1",
      rangeEndDate: "2026-07-09",
      rangeStartDate: "2026-07-01",
      runId: "run-1",
      runType: "custom_range",
      status: "completed",
      storeId: "store-1",
    };
    const generation = {
      generationId: "generation-1",
      projectionKind: "custom_range",
      rangeEndDate: "2026-07-09",
      rangeStartDate: "2026-07-01",
      runId: "run-1",
      status: "verified",
      storeId: "store-1",
    };
    expect(
      customRangeResultBelongsToStore({ generation, run, storeId: "store-1" }),
    ).toBe(true);
    expect(
      customRangeResultBelongsToStore({ generation, run, storeId: "store-2" }),
    ).toBe(false);
    expect(
      customRangeResultBelongsToStore({
        generation: { ...generation, runId: "foreign-run" },
        run,
        storeId: "store-1",
      }),
    ).toBe(false);
  });

  it("reads completed results through auth and bounded currency segments", () => {
    const source = readFileSync(
      "convex/reporting/customRangeRequests.ts",
      "utf8",
    );
    expect(source).toContain("getCustomRangeResult = action");
    expect(source).toContain("readCustomRangeResult = internalQuery");
    expect(source).toContain("preflightReportingRunAccess");
    expect(source).toContain("requireReportingStoreAccess");
    expect(source).toContain("paginationOptsValidator");
    expect(source).toContain(
      ".paginate(boundCustomRangePagination(args.paginationOpts))",
    );
    expect(source).toContain(
      "by_generationId_metric_currencyCode_productSkuId",
    );
    expect(source).toContain(
      '.query("reportingStoreDayProjection")',
    );
    expect(source).toContain(
      'withIndex("by_generationId_operatingDate_metric"',
    );
    expect(source).toContain("classifyCustomRangeSourceRow(sourceRow");
    expect(source).toContain(
      "sourceGeneration.sourceWatermark !== sourceGeneration.stableWatermark",
    );
    expect(source).toContain('"custom_range_source_generation_changed"');
    expect(source).toContain("processCustomRangeRequestMutation");
    expect(source).toContain("recordCustomRangeFailure");
    expect(source).not.toContain('.query("reportingFact")');
    expect(source).toContain('.query("reportingSkuDayProjection")');
    expect(source).toContain('family: "sku"');
    expect(source).toContain('family: "product_rollup"');
    expect(source).toContain('family: "category_rollup"');
    expect(source).toContain('family: "facet"');
    expect(source).toContain('family: "movement"');
    expect(source).toContain("run.sourceGenerationIds");
    expect(source).toContain("skuSourceGeneration.storeId !== run.storeId");
    expect(source).toContain("skuSourceGeneration.stableWatermark !== run.frozenWatermark");
    expect(source).toContain("getActiveReadBundleWithCtx");
    expect(source).toContain("getExactActiveWorkspaceEpochWithCtx");
    expect(source).not.toContain("Custom range SKU source generation is no longer active");
    expect(source).toContain("resultFamily: v.optional(customRangeResultFamilyValidator)");
  });
});
