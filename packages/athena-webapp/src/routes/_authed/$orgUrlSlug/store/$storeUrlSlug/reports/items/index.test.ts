import { describe, expect, it } from "vitest";

import { reportsItemsSearchSchema } from "./index";

describe("reports items search schema", () => {
  it("round-trips an empty search", () => {
    expect(reportsItemsSearchSchema.parse({})).toEqual({});
  });

  it("round-trips a fully populated search", () => {
    const value = {
      periodType: "week" as const,
      periodDate: "2026-07-28",
      sortBy: "units" as const,
      cursor: "opaque-cursor",
    };
    expect(reportsItemsSearchSchema.parse(value)).toEqual(value);
  });

  it("rejects a periodType outside day/week/month", () => {
    expect(() => reportsItemsSearchSchema.parse({ periodType: "quarter" })).toThrow();
  });

  it("rejects a sortBy outside revenue/units", () => {
    expect(() => reportsItemsSearchSchema.parse({ sortBy: "margin" })).toThrow();
  });
});
