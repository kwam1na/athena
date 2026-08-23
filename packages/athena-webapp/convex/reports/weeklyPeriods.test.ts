import { describe, expect, it } from "vitest";

import { testId } from "../lib/testIds";
import { resolveWeeklyPeriod } from "./weeklyPeriods";

const schedule = (overrides = {}) => ({
  _id: testId("storeSchedule", "schedule-1"),
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

  it("moves the final scheduled date backward when an exception closes an operational weekday", () => {
    const result = resolveWeeklyPeriod({
      referenceAt: Date.parse("2026-07-04T12:00:00.000Z"),
      schedules: [
        schedule({
          dateExceptions: [
            { localDate: "2026-07-04", closed: true, windows: [] },
          ],
        }),
      ],
      timezone: "UTC",
    });

    expect(result).toMatchObject({
      kind: "resolved",
      startDate: "2026-06-29",
      endDate: "2026-07-05",
      // Saturday is a normal operational weekday here; the closure pulls the
      // finalization anchor back to Friday.
      finalScheduledDate: "2026-07-03",
      includedDates: [
        "2026-06-29",
        "2026-06-30",
        "2026-07-01",
        "2026-07-02",
        "2026-07-03",
      ],
      automaticFinalizationReason: null,
    });
    expect(
      result.kind === "resolved" &&
        result.dates.find((date) => date.localDate === "2026-07-04"),
    ).toMatchObject({ included: false });
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

  it("reports missing_schedule when timezone authority exists but no version covers the frame", () => {
    expect(
      resolveWeeklyPeriod({
        referenceAt: Date.parse("2026-07-04T12:00:00.000Z"),
        schedules: [],
        timezone: "UTC",
      }),
    ).toEqual({ kind: "unavailable", reason: "missing_schedule" });

    // A version that starts mid-frame leaves the earlier dates unversioned:
    // partial schedule coverage is unavailable, never a silently short week.
    expect(
      resolveWeeklyPeriod({
        referenceAt: Date.parse("2026-07-04T12:00:00.000Z"),
        schedules: [
          schedule({
            effectiveFrom: Date.parse("2026-07-02T00:00:00.000Z"),
          }),
        ],
        timezone: "UTC",
      }),
    ).toEqual({ kind: "unavailable", reason: "missing_schedule" });
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
      startDate: "2026-06-29",
      endDate: "2026-07-05",
      includedDates: [],
      finalScheduledDate: null,
      automaticFinalizationReason: "no_scheduled_dates",
    });
  });

  it("ignores operating hours entirely when deciding membership", () => {
    // The resolver's schedule type is a `Pick` that structurally omits
    // `weeklyWindows`, and exception windows are only ever read through the
    // `closed` flag. These two schedules differ only in hours - including an
    // overnight window that crosses midnight - and must resolve identically.
    const dayShift = resolveWeeklyPeriod({
      referenceAt: Date.parse("2026-07-04T12:00:00.000Z"),
      schedules: [
        schedule({
          dateExceptions: [
            {
              localDate: "2026-07-02",
              closed: false,
              windows: [{ startMinute: 9 * 60, endMinute: 17 * 60 }],
            },
          ],
        }),
      ],
      timezone: "UTC",
    });
    const overnight = resolveWeeklyPeriod({
      referenceAt: Date.parse("2026-07-04T12:00:00.000Z"),
      schedules: [
        schedule({
          dateExceptions: [
            {
              localDate: "2026-07-02",
              closed: false,
              // Crosses midnight into 2026-07-03; membership must not follow it.
              windows: [{ startMinute: 22 * 60, endMinute: 2 * 60 }],
            },
          ],
        }),
      ],
      timezone: "UTC",
    });

    expect(overnight).toEqual(dayShift);
    expect(overnight).toMatchObject({
      includedDates: [
        "2026-06-29",
        "2026-06-30",
        "2026-07-01",
        "2026-07-02",
        "2026-07-03",
        "2026-07-04",
      ],
    });

    // Compile-level guard: weekly windows are not part of the resolver input,
    // so a future refactor cannot quietly let hours reach membership.
    type ResolverSchedule = Parameters<
      typeof resolveWeeklyPeriod
    >[0]["schedules"][number];
    const hasWeeklyWindows: "weeklyWindows" extends keyof ResolverSchedule
      ? true
      : false = false;
    expect(hasWeeklyWindows).toBe(false);
  });
});
