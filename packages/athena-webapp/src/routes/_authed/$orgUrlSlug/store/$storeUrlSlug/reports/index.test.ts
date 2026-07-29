import { describe, expect, it } from "vitest";

import { reportsOverviewSearchSchema } from "./index";

describe("reports overview search schema", () => {
  it("round-trips an empty search (all defaults computed in the component)", () => {
    expect(reportsOverviewSearchSchema.parse({})).toEqual({});
  });

  it("round-trips a fully populated search", () => {
    const value = {
      daysStart: "2026-07-01",
      daysEnd: "2026-07-28",
      rangeStart: "2026-06-01",
      rangeEnd: "2026-06-30",
      requestKey: "req-abc",
    };
    expect(reportsOverviewSearchSchema.parse(value)).toEqual(value);
  });

  it("rejects malformed dates", () => {
    expect(() => reportsOverviewSearchSchema.parse({ daysStart: "07/01/2026" })).toThrow();
  });
});
