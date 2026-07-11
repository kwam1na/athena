import { describe, expect, it } from "vitest";

import { resolveReportPeriod } from "./periods";

describe("report periods", () => {
  const asOf = Date.parse("2026-07-08T18:37:00.000Z");

  it("resolves WTD and its same-weekday prior comparison in store time", () => {
    expect(resolveReportPeriod({ asOf, preset: "week_to_date", timezone: "America/New_York" })).toMatchObject({
      current: { startDate: "2026-07-06", endDate: "2026-07-08" },
      comparison: { startDate: "2026-06-29", endDate: "2026-07-01" },
      partialOperatingDates: ["2026-07-08"],
    });
  });

  it("resolves today from store time rather than browser time", () => {
    expect(resolveReportPeriod({
      asOf: Date.parse("2026-07-08T02:00:00.000Z"),
      preset: "today",
      timezone: "America/New_York",
    }).current).toEqual({ startDate: "2026-07-07", endDate: "2026-07-07" });
  });

  it("uses resolved operating-date and schedule lineage for overnight periods", () => {
    expect(resolveReportPeriod({
      asOf: Date.parse("2026-07-08T02:00:00.000Z"),
      operatingDate: "2026-07-07",
      operatingDayStartsAt: Date.parse("2026-07-07T14:00:00.000Z"),
      preset: "today",
      scheduleVersionId: "schedule-4",
      timezone: "America/New_York",
    })).toMatchObject({
      current: { startDate: "2026-07-07", endDate: "2026-07-07" },
      operatingDate: "2026-07-07",
      sameElapsed: { currentCutoffAt: Date.parse("2026-07-08T02:00:00.000Z"), elapsedOperatingMs: 43_200_000 },
      scheduleVersionId: "schedule-4",
    });
  });

  it("validates custom range ordering", () => {
    expect(() => resolveReportPeriod({
      asOf,
      preset: "custom",
      timezone: "America/New_York",
      customRange: { startDate: "2026-07-09", endDate: "2026-07-08" },
    })).toThrow("start date");
  });
});
