import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  getMissingStoreScheduleContext,
  resolveStoreScheduleContext,
  validateStoreScheduleDraft,
  type StoreScheduleDraft,
} from "../lib/storeScheduleTime";
import { assertConformsToExportedReturns } from "../lib/returnValidatorContract";
import { backfillStoreSchedulesFromLegacyPolicyWithCtx } from "../migrations/backfillStoreSchedules";
import {
  getStoreScheduleForAdmin,
  getStoreDayContext,
  getStoreScheduleSummary,
  listStoreScheduleVersions,
  upsertStoreScheduleCommand,
  upsertStoreScheduleCommandWithCtx,
} from "./storeSchedule";

const projectRoot = process.cwd();

const readProjectFile = (...segments: string[]) =>
  readFileSync(join(projectRoot, ...segments), "utf8");

const baseSchedule = (
  overrides: Partial<StoreScheduleDraft> = {},
): StoreScheduleDraft => ({
  _id: "schedule-1" as any,
  organizationId: "org-1" as any,
  storeId: "store-1" as any,
  timezone: "America/New_York",
  status: "active",
  source: "admin",
  effectiveFrom: Date.parse("2026-01-01T00:00:00.000Z"),
  weeklyClosedDays: [0],
  weeklyWindows: [
    { dayOfWeek: 1, startMinute: 9 * 60, endMinute: 18 * 60 },
    { dayOfWeek: 2, startMinute: 9 * 60, endMinute: 18 * 60 },
    { dayOfWeek: 3, startMinute: 9 * 60, endMinute: 18 * 60 },
    { dayOfWeek: 4, startMinute: 9 * 60, endMinute: 18 * 60 },
    { dayOfWeek: 5, startMinute: 9 * 60, endMinute: 18 * 60 },
    { dayOfWeek: 6, startMinute: 10 * 60, endMinute: 14 * 60 },
  ],
  dateExceptions: [],
  createdAt: Date.parse("2026-01-01T00:00:00.000Z"),
  updatedAt: Date.parse("2026-01-01T00:00:00.000Z"),
  ...overrides,
});

describe("store schedule resolver", () => {
  it("keeps public store schedule returns aligned with exported validators", () => {
    const context = resolveStoreScheduleContext({
      schedule: baseSchedule(),
      at: Date.parse("2026-06-29T14:30:00.000Z"),
    });
    const schedule = {
      scheduleVersionId: "schedule-1",
      organizationId: "org-1",
      storeId: "store-1",
      timezone: "America/New_York",
      weeklyWindows: [{ dayOfWeek: 1, startMinute: 540, endMinute: 1080 }],
      weeklyClosedDays: [0],
      dateExceptions: [],
      effectiveFrom: Date.parse("2026-01-01T00:00:00.000Z"),
      effectiveTo: null,
      status: "active",
      source: "admin",
      createdAt: Date.parse("2026-01-01T00:00:00.000Z"),
      updatedAt: Date.parse("2026-01-01T00:00:00.000Z"),
    };

    expect(() =>
      assertConformsToExportedReturns(upsertStoreScheduleCommand, {
        kind: "ok",
        data: schedule,
      }),
    ).not.toThrow();
    expect(() =>
      assertConformsToExportedReturns(getStoreDayContext, context),
    ).not.toThrow();
    expect(() =>
      assertConformsToExportedReturns(getStoreScheduleSummary, {
        schedule,
        context,
      }),
    ).not.toThrow();
    expect(() =>
      assertConformsToExportedReturns(getStoreScheduleForAdmin, {
        adminConfirmed: true,
        confirmationStatus: "admin_confirmed",
        exceptions: [],
        nextCloseLabel: "6:00 PM",
        nextOpenLabel: "9:00 AM",
        source: "admin",
        scheduleVersionId: "schedule-1",
        summary: {
          nextCloseLabel: "6:00 PM",
          nextOpenLabel: "9:00 AM",
          todayScheduleLabel: "Open until 6:00 PM.",
          timezoneLabel: "America/New_York",
        },
        timezone: "America/New_York",
        todayScheduleLabel: "Open until 6:00 PM.",
        weeklyHours: [
          {
            closed: false,
            day: "monday",
            windows: [{ openTime: "09:00", closeTime: "18:00" }],
          },
        ],
      }),
    ).not.toThrow();
    expect(() =>
      assertConformsToExportedReturns(listStoreScheduleVersions, [schedule]),
    ).not.toThrow();
  });

  it("resolves weekday store-local time to the active window and operating date", () => {
    const context = resolveStoreScheduleContext({
      schedule: baseSchedule(),
      at: Date.parse("2026-06-29T14:30:00.000Z"),
    });

    expect(context.kind).toBe("resolved");
    expect(context.timezone).toBe("America/New_York");
    expect(context.operatingDate).toBe("2026-06-29");
    expect(context.phase).toBe("during_window");
    expect(context.isOpen).toBe(true);
    expect(context.scheduleVersionId).toBe("schedule-1");
    expect(context.currentWindow).toMatchObject({
      localDate: "2026-06-29",
      startMinute: 540,
      endMinute: 1080,
      startsAt: Date.parse("2026-06-29T13:00:00.000Z"),
      endsAt: Date.parse("2026-06-29T22:00:00.000Z"),
    });
  });

  it("returns the next window before the first window starts", () => {
    const context = resolveStoreScheduleContext({
      schedule: baseSchedule(),
      at: Date.parse("2026-06-29T12:00:00.000Z"),
    });

    expect(context.phase).toBe("before_first_window");
    expect(context.isOpen).toBe(false);
    expect(context.currentWindow).toBeNull();
    expect(context.nextWindow).toMatchObject({
      localDate: "2026-06-29",
      startsAt: Date.parse("2026-06-29T13:00:00.000Z"),
    });
  });

  it("returns after-hours context and the next applicable window after close", () => {
    const context = resolveStoreScheduleContext({
      schedule: baseSchedule(),
      at: Date.parse("2026-06-29T23:00:00.000Z"),
    });

    expect(context.phase).toBe("after_last_window");
    expect(context.isOpen).toBe(false);
    expect(context.operatingDate).toBe("2026-06-29");
    expect(context.nextWindow).toMatchObject({
      localDate: "2026-06-30",
      startsAt: Date.parse("2026-06-30T13:00:00.000Z"),
    });
  });

  it("maps early-morning overnight activity to the prior operating date", () => {
    const context = resolveStoreScheduleContext({
      schedule: baseSchedule({
        weeklyClosedDays: [],
        weeklyWindows: [
          { dayOfWeek: 1, startMinute: 22 * 60, endMinute: 2 * 60 },
        ],
      }),
      at: Date.parse("2026-07-07T05:00:00.000Z"),
    });

    expect(context.phase).toBe("during_window");
    expect(context.isOpen).toBe(true);
    expect(context.operatingDate).toBe("2026-07-06");
    expect(context.currentWindow).toMatchObject({
      localDate: "2026-07-06",
      startMinute: 1320,
      endMinute: 120,
      crossesDateBoundary: true,
      startsAt: Date.parse("2026-07-07T02:00:00.000Z"),
      endsAt: Date.parse("2026-07-07T06:00:00.000Z"),
    });
  });

  it("keeps the prior operating date after an overnight window closes", () => {
    const context = resolveStoreScheduleContext({
      schedule: baseSchedule({
        weeklyClosedDays: [],
        weeklyWindows: [
          { dayOfWeek: 1, startMinute: 22 * 60, endMinute: 2 * 60 },
        ],
      }),
      at: Date.parse("2026-07-07T06:30:00.000Z"),
    });

    expect(context.phase).toBe("after_last_window");
    expect(context.isOpen).toBe(false);
    expect(context.operatingDate).toBe("2026-07-06");
  });

  it("uses closed days and date exceptions before weekly windows", () => {
    const closedContext = resolveStoreScheduleContext({
      schedule: baseSchedule(),
      at: Date.parse("2026-07-05T16:00:00.000Z"),
    });

    const exceptionContext = resolveStoreScheduleContext({
      schedule: baseSchedule({
        dateExceptions: [
          {
            localDate: "2026-07-05",
            closed: false,
            windows: [{ startMinute: 11 * 60, endMinute: 15 * 60 }],
            note: "Special hours",
          },
        ],
      }),
      at: Date.parse("2026-07-05T16:00:00.000Z"),
    });

    expect(closedContext.phase).toBe("closed");
    expect(closedContext.isOpen).toBe(false);
    expect(exceptionContext.phase).toBe("during_window");
    expect(exceptionContext.isOpen).toBe(true);
    expect(exceptionContext.currentWindow).toMatchObject({
      localDate: "2026-07-05",
      startsAt: Date.parse("2026-07-05T15:00:00.000Z"),
    });
  });

  it("returns compatibility context when no schedule exists", () => {
    expect(
      getMissingStoreScheduleContext({
        at: Date.parse("2026-06-29T14:30:00.000Z"),
      }),
    ).toEqual({
      kind: "missing_schedule",
      timezone: null,
      operatingDate: "2026-06-29",
      phase: "unavailable",
      isOpen: false,
      scheduleVersionId: null,
      currentWindow: null,
      nextWindow: null,
    });
  });
});

describe("store schedule validation", () => {
  it("rejects invalid timezones and overlapping weekly windows", () => {
    const result = validateStoreScheduleDraft(
      baseSchedule({
        timezone: "Not/AZone",
        weeklyWindows: [
          { dayOfWeek: 1, startMinute: 9 * 60, endMinute: 12 * 60 },
          { dayOfWeek: 1, startMinute: 11 * 60, endMinute: 15 * 60 },
        ],
      }),
    );

    expect(result.ok).toBe(false);
    expect(result.fields).toMatchObject({
      timezone: ["Choose a valid store timezone."],
      weeklyWindows: ["These hours overlap. Adjust one time range before saving."],
    });
  });

  it("rejects overlapping exception windows and DST-ambiguous exception inputs", () => {
    const overlapResult = validateStoreScheduleDraft(
      baseSchedule({
        dateExceptions: [
          {
            localDate: "2026-07-03",
            closed: false,
            windows: [
              { startMinute: 10 * 60, endMinute: 13 * 60 },
              { startMinute: 12 * 60, endMinute: 14 * 60 },
            ],
          },
        ],
      }),
    );

    const springResult = validateStoreScheduleDraft(
      baseSchedule({
        dateExceptions: [
          {
            localDate: "2026-03-08",
            closed: false,
            windows: [{ startMinute: 2 * 60 + 30, endMinute: 4 * 60 }],
          },
        ],
      }),
    );

    const fallResult = validateStoreScheduleDraft(
      baseSchedule({
        dateExceptions: [
          {
            localDate: "2026-11-01",
            closed: false,
            windows: [{ startMinute: 1 * 60 + 30, endMinute: 3 * 60 }],
          },
        ],
      }),
    );

    expect(overlapResult.ok).toBe(false);
    expect(overlapResult.fields).toMatchObject({
      dateExceptions: [
        "These hours overlap. Adjust one time range before saving.",
      ],
    });
    expect(springResult.ok).toBe(false);
    expect(springResult.fields.dateExceptions).toContain(
      "Some exception hours do not exist in the selected timezone.",
    );
    expect(fallResult.ok).toBe(false);
    expect(fallResult.fields.dateExceptions).toContain(
      "Some exception hours are ambiguous in the selected timezone.",
    );
  });

  it("rejects overlapping effective ranges in the command boundary", async () => {
    const ctx = {
      db: {
        get: vi.fn(async (table: string, id: string) =>
          table === "store"
            ? { _id: id, organizationId: "org-1" }
            : null,
        ),
        query: vi.fn(() => ({
          withIndex: vi.fn(() => ({
            take: vi.fn(async () => [
              baseSchedule({
                _id: "existing-schedule" as any,
                effectiveFrom: Date.parse("2026-01-01T00:00:00.000Z"),
                effectiveTo: Date.parse("2026-07-01T00:00:00.000Z"),
              }),
            ]),
          })),
        })),
        insert: vi.fn(),
        patch: vi.fn(),
      },
    } as any;

    const result = await upsertStoreScheduleCommandWithCtx(ctx, {
      storeId: "store-1" as any,
      timezone: "America/New_York",
      weeklyClosedDays: [],
      weeklyWindows: [{ dayOfWeek: 1, startMinute: 9 * 60, endMinute: 17 * 60 }],
      dateExceptions: [],
      effectiveFrom: Date.parse("2026-06-01T00:00:00.000Z"),
      source: "admin",
    });

    expect(result).toMatchObject({
      kind: "user_error",
      error: {
        code: "conflict",
        fields: {
          effectiveFrom: ["Schedule effective dates overlap an active version."],
        },
      },
    });
    expect(ctx.db.insert).not.toHaveBeenCalled();
    expect(ctx.db.patch).not.toHaveBeenCalled();
  });
});

describe("store schedule schema indexes", () => {
  it("adds the indexes needed for store/status/effective resolution", () => {
    const schema = readProjectFile("convex", "schema.ts");

    expect(schema).toContain("storeSchedule: defineTable(storeScheduleSchema)");
    expect(schema).toContain(
      '.index("by_storeId_status_effectiveFrom", ["storeId", "status", "effectiveFrom"])',
    );
    expect(schema).toContain('.index("by_organizationId_storeId_status", [');
    expect(schema).toContain('"organizationId",');
    expect(schema).toContain('"storeId",');
    expect(schema).toContain('"status",');
    expect(schema).toContain(
      '.index("by_source_status", ["source", "status"])',
    );
  });
});

describe("store schedule legacy policy backfill", () => {
  const now = Date.parse("2026-06-27T12:00:00.000Z");
  const stores = [
    {
      _id: "store-1",
      _creationTime: 1,
      name: "Store 1",
      organizationId: "org-1",
    },
    {
      _id: "store-2",
      _creationTime: 2,
      name: "Store 2",
      organizationId: "org-1",
    },
  ];

  const policy = (
    storeId: string,
    action: "opening.auto_start" | "eod.auto_complete",
    overrides: Record<string, unknown> = {},
  ) => ({
    _id: `${storeId}-${action}`,
    _creationTime: 1,
    storeId,
    organizationId: "org-1",
    domain: "daily_operations",
    action,
    mode: "enabled",
    policyVersion: "daily-operations.v1",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  });

  function createBackfillCtx(args: {
    policies?: unknown[];
    schedules?: unknown[];
    stores?: unknown[];
  }) {
    const inserted: unknown[] = [];
    const rows = {
      automationPolicy: args.policies ?? [],
      store: args.stores ?? stores,
      storeSchedule: args.schedules ?? [],
    };

    const ctx = {
      db: {
        query: vi.fn((table: keyof typeof rows) => ({
          paginate: vi.fn(async ({ cursor, numItems }) => {
            const offset = cursor ? Number(cursor) : 0;
            const page = rows[table].slice(offset, offset + numItems);
            const next = offset + page.length;
            return {
              page,
              isDone: next >= rows[table].length,
              continueCursor: next >= rows[table].length ? null : String(next),
            };
          }),
          withIndex: vi.fn((_indexName: string, builder: unknown) => {
            const eqValues: unknown[] = [];
            if (typeof builder === "function") {
              builder({
                eq: (_field: string, value: unknown) => {
                  eqValues.push(value);
                  return {
                    eq: (_nextField: string, nextValue: unknown) => {
                      eqValues.push(nextValue);
                      return {
                        eq: (_lastField: string, lastValue: unknown) => {
                          eqValues.push(lastValue);
                          return {};
                        },
                      };
                    },
                  };
                },
              });
            }

            return {
              take: vi.fn(async () => {
                if (table === "automationPolicy") {
                  return rows.automationPolicy.filter(
                    (row: any) =>
                      row.storeId === eqValues[0] &&
                      row.domain === eqValues[1] &&
                      row.action === eqValues[2],
                  );
                }

                if (table === "storeSchedule") {
                  return rows.storeSchedule.filter(
                    (row: any) => row.storeId === eqValues[0],
                  );
                }

                return rows[table];
              }),
            };
          }),
        })),
        insert: vi.fn(async (_table: string, row: unknown) => {
          inserted.push(row);
          return `schedule-${inserted.length}`;
        }),
      },
    } as any;

    return { ctx, inserted };
  }

  it("dry-runs candidate schedules from opening policy without writing", async () => {
    const { ctx, inserted } = createBackfillCtx({
      policies: [
        policy("store-1", "opening.auto_start", {
          openingLocalStartMinutes: 9 * 60,
          operatingTimezoneOffsetMinutes: 0,
        }),
        policy("store-1", "eod.auto_complete", {
          eodLocalCompletionWindowMinutes: 22 * 60,
        }),
      ],
    });

    const result = await backfillStoreSchedulesFromLegacyPolicyWithCtx(ctx, {
      candidateCloseMinute: 18 * 60,
      cursor: null,
      dryRun: true,
      effectiveFrom: now,
      limit: 1,
      trustedTimezones: [
        {
          source: "store-admin-audit",
          storeId: "store-1" as any,
          timezone: "America/New_York",
        },
      ],
    });

    expect(result).toMatchObject({
      dryRun: true,
      processedCount: 1,
      insertedCount: 0,
      candidateCount: 1,
      compatibilityOnlyCount: 0,
      skippedExistingScheduleCount: 0,
      isDone: false,
      cursor: "1",
    });
    expect(result.rows[0]).toMatchObject({
      action: "would_insert_candidate",
      storeId: "store-1",
      timezone: "America/New_York",
      weeklyWindows: expect.arrayContaining([
        { dayOfWeek: 0, startMinute: 540, endMinute: 1080 },
        { dayOfWeek: 1, startMinute: 540, endMinute: 1080 },
      ]),
      compatibilityMetadata: {
        eodLocalCompletionWindowMinutes: 1320,
      },
    });
    expect(inserted).toHaveLength(0);
    expect(ctx.db.insert).not.toHaveBeenCalled();
  });

  it("inserts candidate schedules idempotently and keeps EOD windows out of close time", async () => {
    const { ctx, inserted } = createBackfillCtx({
      policies: [
        policy("store-1", "opening.auto_start", {
          openingLocalStartMinutes: 8 * 60,
        }),
        policy("store-1", "eod.auto_complete", {
          eodLocalCompletionWindowMinutes: 23 * 60 + 30,
        }),
      ],
    });

    const result = await backfillStoreSchedulesFromLegacyPolicyWithCtx(ctx, {
      candidateCloseMinute: 17 * 60,
      dryRun: false,
      effectiveFrom: now,
      limit: 10,
      trustedTimezones: [
        {
          source: "store-admin-audit",
          storeId: "store-1" as any,
          timezone: "America/New_York",
        },
      ],
    });

    expect(result.rows[0]).toMatchObject({
      action: "inserted_candidate",
      compatibilityMetadata: {
        eodLocalCompletionWindowMinutes: 1410,
      },
    });
    expect(inserted[0]).toMatchObject({
      storeId: "store-1",
      timezone: "America/New_York",
      status: "candidate",
      source: "seed",
      weeklyWindows: expect.arrayContaining([
        { dayOfWeek: 1, startMinute: 480, endMinute: 1020 },
      ]),
    });
    expect((inserted[0] as any).weeklyWindows).not.toContainEqual(
      expect.objectContaining({ endMinute: 1410 }),
    );
  });

  it("skips stores with existing active or admin schedules", async () => {
    const { ctx } = createBackfillCtx({
      policies: [
        policy("store-1", "opening.auto_start", {
          openingLocalStartMinutes: 9 * 60,
        }),
      ],
      schedules: [
        baseSchedule({
          _id: "existing-active" as any,
          source: "admin",
          status: "active",
          storeId: "store-1" as any,
        }),
      ],
    });

    const result = await backfillStoreSchedulesFromLegacyPolicyWithCtx(ctx, {
      candidateCloseMinute: 18 * 60,
      dryRun: false,
      effectiveFrom: now,
      limit: 10,
      trustedTimezones: [
        {
          source: "store-admin-audit",
          storeId: "store-1" as any,
          timezone: "America/New_York",
        },
      ],
    });

    expect(result).toMatchObject({
      insertedCount: 0,
      skippedExistingScheduleCount: 1,
    });
    expect(result.rows[0]).toMatchObject({
      action: "skipped_existing_schedule",
      existingScheduleId: "existing-active",
    });
    expect(ctx.db.insert).not.toHaveBeenCalled();
  });

  it("reports compatibility-only rows when only static offsets or no timing policy exist", async () => {
    const { ctx } = createBackfillCtx({
      policies: [
        policy("store-1", "opening.auto_start", {
          openingLocalStartMinutes: 9 * 60,
          operatingTimezoneOffsetMinutes: 15 * 60,
        }),
        policy("store-2", "opening.auto_start", {
          operatingTimezoneOffsetMinutes: 15 * 60,
        }),
      ],
    });

    const result = await backfillStoreSchedulesFromLegacyPolicyWithCtx(ctx, {
      candidateCloseMinute: 18 * 60,
      dryRun: true,
      effectiveFrom: now,
      limit: 10,
      trustedTimezones: [
        {
          source: "store-admin-audit",
          storeId: "store-2" as any,
          timezone: "Not/AZone",
        },
      ],
    });

    expect(result).toMatchObject({
      compatibilityOnlyCount: 2,
      insertedCount: 0,
    });
    expect(result.rows).toEqual([
      expect.objectContaining({
        action: "compatibility_only",
        reason: "missing_trusted_timezone",
        storeId: "store-1",
        compatibilityMetadata: expect.objectContaining({
          operatingTimezoneOffsetMinutes: 900,
        }),
      }),
      expect.objectContaining({
        action: "compatibility_only",
        reason: "missing_opening_start",
        storeId: "store-2",
        compatibilityMetadata: {
          operatingTimezoneOffsetMinutes: 900,
        },
      }),
    ]);
    expect(ctx.db.insert).not.toHaveBeenCalled();
  });
});
