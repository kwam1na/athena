import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { StoreScheduleDraft } from "../lib/storeScheduleTime";
import {
  buildSameElapsedOperatingComparison,
  resolveReportingOperatingPeriod,
} from "./operatingPeriods";

function schedule(
  overrides: Partial<StoreScheduleDraft> = {},
): StoreScheduleDraft {
  return {
    _id: "schedule-1",
    organizationId: "org-1",
    storeId: "store-1",
    timezone: "America/New_York",
    weeklyWindows: [
      { dayOfWeek: 1, startMinute: 22 * 60, endMinute: 2 * 60 },
    ],
    weeklyClosedDays: [],
    dateExceptions: [],
    effectiveFrom: Date.parse("2026-01-01T00:00:00.000Z"),
    status: "active",
    source: "admin",
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe("reporting operating periods", () => {
  it("owns historical operating-date range resolution on the server", () => {
    const source = readFileSync(join(import.meta.dirname, "operatingPeriods.ts"), "utf8");
    expect(source).toContain("resolveReportingOperatingDateRangeWithCtx");
    expect(source).toContain('(["active", "superseded"] as const)');
    expect(source).toContain("resolveStoreOperatingRangeForDate");
    expect(source).toContain(".take(100)");
  });
  it("pins a cross-midnight occurrence to its historical schedule version", () => {
    expect(
      resolveReportingOperatingPeriod({
        occurrenceAt: Date.parse("2026-07-07T05:00:00.000Z"),
        schedule: schedule(),
      }),
    ).toMatchObject({
      kind: "resolved",
      operatingDate: "2026-07-06",
      scheduleVersionId: "schedule-1",
      timezone: "America/New_York",
    });
  });

  it("uses exception hours and remains stable across DST", () => {
    const result = resolveReportingOperatingPeriod({
      occurrenceAt: Date.parse("2026-03-08T16:30:00.000Z"),
      schedule: schedule({
        dateExceptions: [
          {
            localDate: "2026-03-08",
            closed: false,
            windows: [{ startMinute: 12 * 60, endMinute: 16 * 60 }],
          },
        ],
      }),
    });

    expect(result).toMatchObject({
      kind: "resolved",
      operatingDate: "2026-03-08",
      startsAt: Date.parse("2026-03-08T16:00:00.000Z"),
      endsAt: Date.parse("2026-03-08T20:00:00.000Z"),
    });
  });

  it("compares only the same elapsed scheduled time across split windows", () => {
    const currentSchedule = schedule({
      weeklyWindows: [
        { dayOfWeek: 1, startMinute: 9 * 60, endMinute: 12 * 60 },
        { dayOfWeek: 1, startMinute: 13 * 60, endMinute: 17 * 60 },
      ],
    });
    const comparisonSchedule = schedule({
      _id: "schedule-prior",
      weeklyWindows: [
        { dayOfWeek: 1, startMinute: 8 * 60, endMinute: 12 * 60 },
        { dayOfWeek: 1, startMinute: 13 * 60, endMinute: 18 * 60 },
      ],
    });

    expect(
      buildSameElapsedOperatingComparison({
        asOf: Date.parse("2026-07-06T18:00:00.000Z"),
        comparison: {
          operatingDate: "2026-06-29",
          schedule: comparisonSchedule,
        },
        current: {
          operatingDate: "2026-07-06",
          schedule: currentSchedule,
        },
      }),
    ).toMatchObject({
      comparison: {
        elapsedOperatingMs: 4 * 60 * 60_000,
        partial: true,
        scheduleVersionId: "schedule-prior",
        slices: [
          {
            startsAt: Date.parse("2026-06-29T12:00:00.000Z"),
            endsAt: Date.parse("2026-06-29T16:00:00.000Z"),
          },
        ],
        truncated: false,
      },
      current: {
        elapsedOperatingMs: 4 * 60 * 60_000,
        partial: true,
        scheduleVersionId: "schedule-1",
      },
      equivalent: true,
      kind: "resolved",
    });
  });

  it("uses actual DST-aware operating duration and excludes comparison future time", () => {
    const dstSchedule = schedule({
      _id: "schedule-dst",
      dateExceptions: [
        {
          localDate: "2026-03-08",
          closed: false,
          windows: [{ startMinute: 0, endMinute: 4 * 60 }],
        },
      ],
    });
    const priorSchedule = schedule({
      _id: "schedule-prior",
      dateExceptions: [
        {
          localDate: "2026-03-01",
          closed: false,
          windows: [{ startMinute: 0, endMinute: 4 * 60 }],
        },
      ],
    });

    const result = buildSameElapsedOperatingComparison({
      asOf: Date.parse("2026-03-08T07:00:00.000Z"),
      comparison: { operatingDate: "2026-03-01", schedule: priorSchedule },
      current: { operatingDate: "2026-03-08", schedule: dstSchedule },
    });

    expect(result).toMatchObject({
      comparison: {
        elapsedOperatingMs: 2 * 60 * 60_000,
        partial: true,
        slices: [
          {
            startsAt: Date.parse("2026-03-01T05:00:00.000Z"),
            endsAt: Date.parse("2026-03-01T07:00:00.000Z"),
          },
        ],
      },
      current: {
        elapsedOperatingMs: 2 * 60 * 60_000,
        partial: true,
        totalOperatingMs: 3 * 60 * 60_000,
      },
      equivalent: true,
      kind: "resolved",
    });
  });

  it("withholds comparison when either operating day is closed", () => {
    expect(
      buildSameElapsedOperatingComparison({
        asOf: Date.parse("2026-07-06T18:00:00.000Z"),
        comparison: {
          operatingDate: "2026-07-05",
          schedule: schedule({ weeklyClosedDays: [0] }),
        },
        current: {
          operatingDate: "2026-07-06",
          schedule: schedule({
            weeklyWindows: [
              { dayOfWeek: 1, startMinute: 9 * 60, endMinute: 17 * 60 },
            ],
          }),
        },
      }),
    ).toEqual({
      comparisonKind: "closed",
      currentKind: "resolved",
      kind: "unavailable",
    });
  });
});
