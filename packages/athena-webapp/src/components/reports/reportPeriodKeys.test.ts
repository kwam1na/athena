import { describe, expect, it } from "vitest";

import {
  dateRangeForItemsPeriod,
  dateRangeForOverviewWindow,
} from "./reportPeriodKeys";

describe("report period date ranges", () => {
  it("maps overview windows to inclusive operating-date ranges", () => {
    expect(dateRangeForOverviewWindow("today", "2026-07-29")).toEqual({
      startDate: "2026-07-29",
      endDate: "2026-07-29",
    });
    expect(dateRangeForOverviewWindow("weekToDate", "2026-07-29")).toEqual({
      startDate: "2026-07-27",
      endDate: "2026-07-29",
    });
    expect(dateRangeForOverviewWindow("trailing30", "2026-07-29")).toEqual({
      startDate: "2026-06-30",
      endDate: "2026-07-29",
    });
    expect(
      dateRangeForOverviewWindow("trailing3Months", "2026-07-29"),
    ).toEqual({
      startDate: "2026-05-01",
      endDate: "2026-07-29",
    });
  });

  it("maps day, ISO week, and month selections to inclusive ranges", () => {
    expect(dateRangeForItemsPeriod("day", "2026-07-29")).toEqual({
      startDate: "2026-07-29",
      endDate: "2026-07-29",
    });
    expect(dateRangeForItemsPeriod("week", "2026-01-01")).toEqual({
      startDate: "2025-12-29",
      endDate: "2026-01-04",
    });
    expect(dateRangeForItemsPeriod("month", "2024-02-10")).toEqual({
      startDate: "2024-02-01",
      endDate: "2024-02-29",
    });
    expect(dateRangeForItemsPeriod("month", "2026-02-10")).toEqual({
      startDate: "2026-02-01",
      endDate: "2026-02-28",
    });
  });
});
