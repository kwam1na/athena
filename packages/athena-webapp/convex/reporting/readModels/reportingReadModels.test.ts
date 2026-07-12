import { describe, expect, it } from "vitest";
import {
  buildCursorContextKey,
  decodeReportingCursor,
  encodeReportingCursor,
  buildReportingFacets,
  buildReportingRollups,
  summarizeMetricRows,
} from "./reportingReadModels";
import { buildInventoryExposure, buildInventoryMovement } from "./inventory";

describe("reporting workspace read models", () => {
  const rows = [
    { categoryId: "c1", productId: "p1", productSkuId: "s1", metric: "net_sales", value: 100 },
    { categoryId: "c1", productId: "p1", productSkuId: "s2", metric: "net_sales", value: 50 },
    { categoryId: "c2", productId: "p2", productSkuId: "s3", metric: "net_sales", value: 25 },
  ];

  it("builds exact generation-wide product and category rollups", () => {
    expect(buildReportingRollups(rows)).toEqual([
      { dimension: "category", dimensionId: "c1", metric: "net_sales", value: 150 },
      { dimension: "category", dimensionId: "c2", metric: "net_sales", value: 25 },
      { dimension: "product", dimensionId: "p1", metric: "net_sales", value: 150 },
      { dimension: "product", dimensionId: "p2", metric: "net_sales", value: 25 },
    ]);
  });

  it("computes facets before pagination and preserves valid zero totals", () => {
    expect(buildReportingFacets([
      { classifications: ["fast_mover", "low_cover"], productSkuId: "s1" },
      { classifications: ["fast_mover"], productSkuId: "s2" },
      { classifications: [], productSkuId: "s3" },
    ])).toEqual({ all: 3, fast_mover: 2, low_cover: 1 });
    expect(summarizeMetricRows([{ metric: "net_sales", knownValue: 0 }])).toEqual({ net_sales: 0 });
  });

  it("binds cursor context to every authority and view input", () => {
    expect(buildCursorContextKey({
      contractVersions: "1:1:1", filter: "fast_mover", generationIds: ["g2", "g1"],
      pageKind: "items", period: "2026-07-01:2026-07-11", sort: "revenue:desc",
      stableWatermarks: [20, 10], storeId: "store-1",
    })).toBe("store-1|items|2026-07-01:2026-07-11|fast_mover|revenue:desc|1:1:1|g1,g2|10,20");
  });

  it("rejects a database cursor replayed under different report lineage", () => {
    const token = encodeReportingCursor({ contextKey: "generation-a", cursor: "opaque", version: 1 });
    expect(decodeReportingCursor(token, "generation-a")).toBe("opaque");
    expect(() => decodeReportingCursor(token, "generation-b")).toThrow(
      "does not match this report view",
    );
  });

  it("keeps current exposure separate from selected-period movement", () => {
    expect(buildInventoryExposure({ knownInventoryValueMinor: 0, onHandQuantity: 4, sellableQuantity: 3, uncostedOnHandQuantity: 1 })).toMatchObject({
      exposureSort: 0,
      inventoryCostCoverage: "partial",
    });
    expect(buildInventoryMovement({ receiptUnits: 5, saleUnits: 2, consumedUnits: 1 })).toEqual({
      adjustmentsQuantity: 0, commitmentQuantity: 0, consumedQuantity: 1,
      receiptsQuantity: 5, returnsQuantity: 0, salesQuantity: 2,
    });
  });
});
