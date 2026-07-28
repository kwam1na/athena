import { describe, expect, it } from "vitest";

import { reportsSkuDetailSearchSchema } from "./$productSkuId";

describe("reports sku detail search schema", () => {
  it("round-trips an empty search", () => {
    expect(reportsSkuDetailSearchSchema.parse({})).toEqual({});
  });

  it("round-trips a populated search", () => {
    const value = { startDate: "2026-06-01", endDate: "2026-07-01" };
    expect(reportsSkuDetailSearchSchema.parse(value)).toEqual(value);
  });

  it("rejects malformed dates", () => {
    expect(() => reportsSkuDetailSearchSchema.parse({ startDate: "not-a-date" })).toThrow();
  });
});
