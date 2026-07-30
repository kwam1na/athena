import { describe, expect, it } from "vitest";

import {
  reportsSkuDetailSearchSchema,
  resolveSkuDetailDateRange,
} from "./$productSkuId";

describe("reports sku detail search schema", () => {
  it("round-trips an empty search", () => {
    expect(reportsSkuDetailSearchSchema.parse({})).toEqual({});
  });

  it("round-trips a populated search", () => {
    const value = {
      periodType: "week" as const,
      periodDate: "2026-07-29",
      startDate: "2026-06-01",
      endDate: "2026-07-01",
      page: 2,
      transactionDate: "2026-06-30",
      o: "encoded-origin",
    };
    expect(reportsSkuDetailSearchSchema.parse(value)).toEqual(value);
  });

  it("rejects malformed dates", () => {
    expect(() =>
      reportsSkuDetailSearchSchema.parse({ startDate: "not-a-date" }),
    ).toThrow();
  });

  it("rejects invalid page numbers", () => {
    expect(() => reportsSkuDetailSearchSchema.parse({ page: 0 })).toThrow();
    expect(() => reportsSkuDetailSearchSchema.parse({ page: 1.5 })).toThrow();
  });

  it("applies day, week, and month periods from the items report", () => {
    expect(
      resolveSkuDetailDateRange({
        periodType: "day",
        periodDate: "2026-07-29",
      }),
    ).toEqual({
      startDate: "2026-07-29",
      endDate: "2026-07-29",
    });
    expect(
      resolveSkuDetailDateRange({
        periodType: "week",
        periodDate: "2026-07-29",
      }),
    ).toEqual({
      startDate: "2026-07-27",
      endDate: "2026-08-02",
    });
    expect(
      resolveSkuDetailDateRange({
        periodType: "month",
        periodDate: "2026-07-29",
      }),
    ).toEqual({
      startDate: "2026-07-01",
      endDate: "2026-07-31",
    });
  });
});
