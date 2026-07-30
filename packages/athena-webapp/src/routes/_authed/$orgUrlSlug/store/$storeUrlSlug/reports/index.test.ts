import { describe, expect, it } from "vitest";

import { reportsOverviewSearchSchema } from "./index";

describe("reports overview search schema", () => {
  it("round-trips an empty search (all defaults computed in the component)", () => {
    expect(reportsOverviewSearchSchema.parse({})).toEqual({});
  });

  it("round-trips a fully populated search", () => {
    const value = {
      window: "weekToDate" as const,
      daysStart: "2026-07-01",
      daysEnd: "2026-07-28",
      daysPage: 2,
      selectedDay: "2026-07-16",
    };
    expect(reportsOverviewSearchSchema.parse(value)).toEqual(value);
  });

  it("drops legacy custom-range search state from the overview route", () => {
    expect(
      reportsOverviewSearchSchema.parse({
        rangeStart: "2026-06-01",
        rangeEnd: "2026-06-30",
        requestKey: "req-abc",
      }),
    ).toEqual({});
  });

  it("rejects malformed dates", () => {
    expect(() =>
      reportsOverviewSearchSchema.parse({ daysStart: "07/01/2026" }),
    ).toThrow();
    expect(() =>
      reportsOverviewSearchSchema.parse({ selectedDay: "07/16/2026" }),
    ).toThrow();
  });

  it("rejects an unknown overview window", () => {
    expect(() =>
      reportsOverviewSearchSchema.parse({ window: "quarter" }),
    ).toThrow();
  });

  it("rejects invalid day-list pages", () => {
    expect(() => reportsOverviewSearchSchema.parse({ daysPage: 0 })).toThrow();
    expect(() =>
      reportsOverviewSearchSchema.parse({ daysPage: 1.5 }),
    ).toThrow();
  });
});
