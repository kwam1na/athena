import { describe, expect, it } from "vitest";

import {
  adjacentItemsPeriodDate,
  dateRangeForItemsPeriod,
  dateRangeForOverviewWindow,
  REPORT_DATE_RANGE_PRESET_WINDOWS,
  REPORT_OVERVIEW_WINDOWS,
  tableRangeIncludingSelection,
} from "./reportPeriodKeys";

describe("adjacent item reporting periods", () => {
  it.each([
    ["day", "2026-01-01", -1, "2025-12-31"],
    ["day", "2026-03-08", 1, "2026-03-09"],
    ["week", "2026-01-01", -1, "2025-12-25"],
    ["week", "2026-03-08", 1, "2026-03-15"],
    ["month", "2026-01-31", 1, "2026-02-28"],
    ["month", "2028-03-31", -1, "2028-02-29"],
    ["month", "2026-12-30", 1, "2027-01-30"],
    ["month", "2026-01-30", -1, "2025-12-30"],
  ] as const)(
    "moves %s from %s by %s",
    (periodType, date, direction, expected) => {
      expect(adjacentItemsPeriodDate(periodType, date, direction)).toBe(
        expected,
      );
    },
  );
});

describe("report date-range preset windows", () => {
  it("ships all five preset windows now that every preset surface serves 184 days", () => {
    // U7 final wire, flipped deliberately: the days table, SKU detail, Units
    // moved, and the async mix path all serve the 184-day span, so the
    // trailing-six-months preset may now exist (R3). It is appended last.
    expect(REPORT_DATE_RANGE_PRESET_WINDOWS).toEqual([
      "today",
      "weekToDate",
      "trailing30",
      "trailing3Months",
      "trailing6Months",
    ]);
    expect(REPORT_OVERVIEW_WINDOWS).toEqual([
      "today",
      "weekToDate",
      "trailing30",
      "trailing3Months",
      "trailing6Months",
    ]);
  });
});

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
    expect(
      dateRangeForOverviewWindow("trailing6Months", "2026-07-29"),
    ).toEqual({
      startDate: "2026-02-01",
      endDate: "2026-07-29",
    });
  });

  it("keeps the six-month window calendar-correct across year and leap boundaries", () => {
    // Year boundary: five months back from January reaches into the prior year.
    expect(
      dateRangeForOverviewWindow("trailing6Months", "2026-01-15"),
    ).toEqual({
      startDate: "2025-08-01",
      endDate: "2026-01-15",
    });
    // Leap day anchor: the month-aligned start is unaffected by day arithmetic.
    expect(
      dateRangeForOverviewWindow("trailing6Months", "2028-02-29"),
    ).toEqual({
      startDate: "2027-09-01",
      endDate: "2028-02-29",
    });
    // Aug..Jan is one of the 184-day maximum windows.
    expect(
      dateRangeForOverviewWindow("trailing6Months", "2027-01-31"),
    ).toEqual({
      startDate: "2026-08-01",
      endDate: "2027-01-31",
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

  it("keeps the table stable for contained ranges and safely replaces over-wide scopes", () => {
    expect(
      tableRangeIncludingSelection(
        { startDate: "2026-07-01", endDate: "2026-07-31" },
        { startDate: "2026-07-15", endDate: "2026-07-20" },
      ),
    ).toEqual({ startDate: "2026-07-01", endDate: "2026-07-31" });

    expect(
      tableRangeIncludingSelection(
        { startDate: "2026-07-01", endDate: "2026-07-31" },
        { startDate: "2026-06-15", endDate: "2026-07-20" },
      ),
    ).toEqual({ startDate: "2026-06-15", endDate: "2026-07-31" });

    // Deliberately flipped in U7: this 111-day expansion exceeded the old
    // 92-day ceiling and reset the scope; under the shared 184-day drill-down
    // ceiling it is servable, so the widened scope is now retained.
    expect(
      tableRangeIncludingSelection(
        { startDate: "2026-04-01", endDate: "2026-06-30" },
        { startDate: "2026-07-15", endDate: "2026-07-20" },
      ),
    ).toEqual({ startDate: "2026-04-01", endDate: "2026-07-20" });
  });

  it("honors the full 184-day drill-down span before resetting the table scope", () => {
    // U7 raised the client scope ceiling from 92 to the shared 184-day
    // drill-down constant: an expansion to exactly 184 inclusive days keeps
    // the widened scope; 185 falls back to the bare selection.
    // 2026-01-01 .. 2026-07-03 inclusive is exactly 184 days.
    expect(
      tableRangeIncludingSelection(
        { startDate: "2026-01-01", endDate: "2026-06-30" },
        { startDate: "2026-06-15", endDate: "2026-07-03" },
      ),
    ).toEqual({ startDate: "2026-01-01", endDate: "2026-07-03" });

    // 2026-01-01 .. 2026-07-04 is 185 days — one past the ceiling.
    expect(
      tableRangeIncludingSelection(
        { startDate: "2026-01-01", endDate: "2026-06-30" },
        { startDate: "2026-06-15", endDate: "2026-07-04" },
      ),
    ).toEqual({ startDate: "2026-06-15", endDate: "2026-07-04" });
  });
});
