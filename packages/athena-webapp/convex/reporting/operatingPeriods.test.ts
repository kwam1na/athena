import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { StoreScheduleDraft } from "../lib/storeScheduleTime";
import {
  buildSameElapsedOperatingComparison,
  resolveReportingFinancialPeriod,
  resolveReportingFinancialPeriodWithCtx,
  resolveReportingOperatingPeriod,
  resolveReportingReferencePeriod,
  resolveReportingReferencePeriodWithCtx,
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
  it("attributes money to the timezone-local date when no schedule exists", () => {
    expect(
      resolveReportingFinancialPeriod({
        occurrenceAt: Date.parse("2026-07-12T00:30:00.000Z"),
        schedule: null,
        timezoneAuthority: {
          timezone: "America/New_York",
          timezoneVersionHash: "hash-1",
          timezoneVersionId: "timezone-1",
        },
      }),
    ).toEqual({
      kind: "resolved",
      occurrenceAt: Date.parse("2026-07-12T00:30:00.000Z"),
      recognitionAt: Date.parse("2026-07-12T00:30:00.000Z"),
      reportingDate: "2026-07-11",
      scheduleContext: { kind: "unavailable" },
      timezone: "America/New_York",
      timezoneVersionHash: "hash-1",
      timezoneVersionId: "timezone-1",
    });
  });

  it("keeps closed and after-hours schedule state as non-blocking context", () => {
    const timezoneAuthority = {
      timezone: "Africa/Accra",
      timezoneVersionHash: "hash-1",
      timezoneVersionId: "timezone-1",
    };
    const closed = resolveReportingFinancialPeriod({
      occurrenceAt: Date.parse("2026-07-12T12:00:00.000Z"),
      schedule: schedule({
        timezone: "Africa/Accra",
        weeklyClosedDays: [0],
        weeklyWindows: [],
      }),
      timezoneAuthority,
    });
    const afterHours = resolveReportingFinancialPeriod({
      occurrenceAt: Date.parse("2026-07-06T21:00:00.000Z"),
      schedule: schedule({
        timezone: "Africa/Accra",
        weeklyWindows: [
          { dayOfWeek: 1, startMinute: 9 * 60, endMinute: 17 * 60 },
        ],
      }),
      timezoneAuthority,
    });

    expect(closed).toMatchObject({
      kind: "resolved",
      reportingDate: "2026-07-12",
      scheduleContext: { kind: "closed" },
    });
    expect(afterHours).toMatchObject({
      kind: "resolved",
      reportingDate: "2026-07-06",
      scheduleContext: { kind: "outside_hours" },
    });
  });

  it("rejects missing timezone authority and degrades conflicting schedule context", () => {
    expect(
      resolveReportingFinancialPeriod({
        occurrenceAt: Date.parse("2026-07-12T00:30:00.000Z"),
        schedule: null,
        timezoneAuthority: null,
      }),
    ).toEqual({
      kind: "missing_timezone_authority",
      occurrenceAt: Date.parse("2026-07-12T00:30:00.000Z"),
    });
    expect(
      resolveReportingFinancialPeriod({
        occurrenceAt: Date.parse("2026-07-12T00:30:00.000Z"),
        schedule: schedule({ timezone: "Africa/Accra" }),
        timezoneAuthority: {
          timezone: "America/New_York",
          timezoneVersionHash: "hash-1",
          timezoneVersionId: "timezone-1",
        },
      }),
    ).toMatchObject({
      kind: "resolved",
      reportingDate: "2026-07-11",
      scheduleContext: { kind: "unavailable" },
      timezone: "America/New_York",
    });
    expect(
      resolveReportingFinancialPeriod({
        occurrenceAt: Date.parse("2026-07-12T00:30:00.000Z"),
        schedule: null,
        timezoneAuthority: {
          timezone: "Not/A_Real_Zone",
          timezoneVersionHash: "hash-1",
          timezoneVersionId: "timezone-1",
        },
      }),
    ).toEqual({
      kind: "invalid_timezone_authority",
      occurrenceAt: Date.parse("2026-07-12T00:30:00.000Z"),
      timezoneVersionId: "timezone-1",
    });
  });

  it("loads timezone authority independently when no schedule row exists", async () => {
    const timezoneVersion = {
      _id: "timezone-1",
      organizationId: "org-1",
      storeId: "store-1",
      timezone: "America/New_York",
      effectiveFrom: Date.parse("2026-01-01T00:00:00.000Z"),
      contentHash: "hash-1",
      source: "admin_authorized",
      authorizedByUserId: "user-1",
      authorizedAt: 1,
      createdAt: 1,
    };
    const ctx = {
      db: {
        query: (table: string) => {
          const chain = {
            first: async () => null,
            order: () => chain,
            take: async () =>
              table === "storeTimezoneVersion" ? [timezoneVersion] : [],
            withIndex: (_name: string, apply: (q: unknown) => unknown) => {
              const builder = {
                eq: () => builder,
                lte: () => builder,
              };
              apply(builder);
              return chain;
            },
          };
          return chain;
        },
      },
    };

    await expect(
      resolveReportingFinancialPeriodWithCtx(ctx as never, {
        occurrenceAt: Date.parse("2026-07-12T00:30:00.000Z"),
        organizationId: "org-1" as never,
        storeId: "store-1" as never,
      }),
    ).resolves.toMatchObject({
      kind: "resolved",
      reportingDate: "2026-07-11",
      scheduleContext: { kind: "unavailable" },
      timezoneVersionId: "timezone-1",
    });
  });
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

  it("anchors Reports presets to the latest operating day when the store is closed", () => {
    expect(
      resolveReportingReferencePeriod({
        occurrenceAt: Date.parse("2026-07-12T12:00:00.000Z"),
        schedule: schedule({
          timezone: "Africa/Accra",
          weeklyClosedDays: [0],
          weeklyWindows: [
            { dayOfWeek: 6, startMinute: 9 * 60, endMinute: 19 * 60 },
          ],
        }),
      }),
    ).toMatchObject({
      kind: "resolved",
      operatingDate: "2026-07-11",
      referenceAt: Date.parse("2026-07-11T19:00:00.000Z"),
      startsAt: Date.parse("2026-07-11T09:00:00.000Z"),
      endsAt: Date.parse("2026-07-11T19:00:00.000Z"),
    });
  });

  it("uses the schedule version that governed the fallback operating day", async () => {
    const currentSchedule = schedule({
      _id: "schedule-current",
      effectiveFrom: Date.parse("2026-07-12T00:00:00.000Z"),
      timezone: "Africa/Accra",
      weeklyClosedDays: [0, 6],
      weeklyWindows: [
        { dayOfWeek: 5, startMinute: 10 * 60, endMinute: 18 * 60 },
      ],
    });
    const historicalSchedule = schedule({
      _id: "schedule-historical",
      effectiveTo: Date.parse("2026-07-12T00:00:00.000Z"),
      status: "superseded",
      timezone: "Africa/Accra",
      weeklyClosedDays: [0],
      weeklyWindows: [
        { dayOfWeek: 6, startMinute: 9 * 60, endMinute: 19 * 60 },
      ],
    });
    const schedules = {
      active: [currentSchedule],
      superseded: [historicalSchedule],
    };
    const ctx = {
      db: {
        query: () => {
          let status: keyof typeof schedules = "active";
          const chain = {
            first: async () => schedules[status][0] ?? null,
            order: () => chain,
            take: async () => schedules[status],
            withIndex: (
              _name: string,
              apply: (q: { eq: (field: string, value: string) => unknown }) => unknown,
            ) => {
              const builder = {
                eq: (field: string, value: string) => {
                  if (field === "status") status = value as keyof typeof schedules;
                  return builder;
                },
                lte: () => builder,
              };
              apply(builder);
              return chain;
            },
          };
          return chain;
        },
      },
    };

    await expect(
      resolveReportingReferencePeriodWithCtx(ctx as never, {
        occurrenceAt: Date.parse("2026-07-12T12:00:00.000Z"),
        storeId: "store-1" as never,
      }),
    ).resolves.toMatchObject({
      kind: "resolved",
      operatingDate: "2026-07-11",
      referenceAt: Date.parse("2026-07-11T19:00:00.000Z"),
      scheduleVersionId: "schedule-historical",
    });
  });
});
