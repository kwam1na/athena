import { describe, expect, it } from "vitest";

import {
  getNextReportPeriodSearch,
  reportsSearchSchema,
} from "../reports";

describe("Reports URL state", () => {
  it("accepts presets and complete custom ranges", () => {
    expect(reportsSearchSchema.parse({ preset: "wtd" })).toEqual({ preset: "wtd" });
    expect(reportsSearchSchema.parse({ preset: "custom", start: "2026-07-01", end: "2026-07-11" })).toMatchObject({ preset: "custom" });
  });

  it("rejects incomplete custom ranges", () => {
    expect(() => reportsSearchSchema.parse({ preset: "custom", start: "2026-07-01" })).toThrow();
  });

  it("clears range-run and paging state when the period changes", () => {
    expect(getNextReportPeriodSearch({ cursor: "secret", runId: "run-1", query: "wig" }, "today")).toEqual({ preset: "today", query: "wig" });
  });
});
