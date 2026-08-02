import { describe, expect, it } from "vitest";

import { resolveWeeklyPeriod } from "./weeklyPeriods";

const schedule = (overrides = {}) => ({
  _id: "schedule-1",
  effectiveFrom: Date.parse("2026-01-01T00:00:00.000Z"),
  reportingCycleStartsOn: 1,
  weeklyClosedDays: [0],
  dateExceptions: [],
  ...overrides,
});

describe("resolveWeeklyPeriod", () => {
  it("uses schedule days, not operating-hour windows, for Monday-through-Saturday membership", () => {
    const result = resolveWeeklyPeriod({
      referenceAt: Date.parse("2026-07-04T23:30:00.000Z"),
      schedules: [schedule()],
      timezone: "UTC",
      factDates: ["2026-07-04", "2026-07-05"],
    });

    expect(result).toMatchObject({
      kind: "resolved",
      startDate: "2026-06-29",
      endDate: "2026-07-05",
      finalScheduledDate: "2026-07-04",
      includedDates: [
        "2026-06-29",
        "2026-06-30",
        "2026-07-01",
        "2026-07-02",
        "2026-07-03",
        "2026-07-04",
      ],
      outsideScheduleFactDates: ["2026-07-05"],
    });
  });

  it("uses a date exception before recurring closed days", () => {
    const result = resolveWeeklyPeriod({
      referenceAt: Date.parse("2026-07-05T12:00:00.000Z"),
      schedules: [
        schedule({
          dateExceptions: [
            { localDate: "2026-07-05", closed: false, windows: [] },
          ],
        }),
      ],
      timezone: "UTC",
    });

    expect(result).toMatchObject({
      finalScheduledDate: "2026-07-05",
      includedDates: expect.arrayContaining(["2026-07-05"]),
    });
  });

  it("keeps a changed anchor in the next old-anchor frame", () => {
    const result = resolveWeeklyPeriod({
      referenceAt: Date.parse("2026-07-04T12:00:00.000Z"),
      schedules: [
        schedule({ effectiveTo: Date.parse("2026-07-06T00:00:00.000Z") }),
        schedule({
          _id: "schedule-2",
          effectiveFrom: Date.parse("2026-07-06T00:00:00.000Z"),
          reportingCycleStartsOn: 3,
        }),
      ],
      timezone: "UTC",
    });

    expect(result).toMatchObject({
      startDate: "2026-06-29",
      endDate: "2026-07-05",
      finalScheduledDate: "2026-07-04",
    });
  });

  it("returns an explicit unavailable result without schedule or timezone authority", () => {
    expect(
      resolveWeeklyPeriod({
        referenceAt: Date.parse("2026-07-04T12:00:00.000Z"),
        schedules: [],
        timezone: null,
      }),
    ).toEqual({ kind: "unavailable", reason: "missing_timezone" });
  });

  it("withholds automatic finalization when every day in the frame is closed", () => {
    expect(
      resolveWeeklyPeriod({
        referenceAt: Date.parse("2026-07-04T12:00:00.000Z"),
        schedules: [schedule({ weeklyClosedDays: [0, 1, 2, 3, 4, 5, 6] })],
        timezone: "UTC",
      }),
    ).toMatchObject({
      kind: "resolved",
      finalScheduledDate: null,
      automaticFinalizationReason: "no_scheduled_dates",
    });
  });
});
