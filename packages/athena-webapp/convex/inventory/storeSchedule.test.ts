/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import schema from "../schema";
import type { Id } from "../_generated/dataModel";
import {
  getMissingStoreScheduleContext,
  nextReportingCycleBoundary,
  resolveStoreScheduleContext,
  validateStoreScheduleDraft,
  type StoreScheduleDraft,
} from "../lib/storeScheduleTime";
import { assertConformsToExportedReturns } from "../lib/returnValidatorContract";
import { backfillStoreSchedulesFromLegacyPolicyWithCtx } from "../migrations/backfillStoreSchedules";
import {
  getActiveStoreScheduleForEmail,
  getStoreScheduleContextForStoreAtWithCtx,
  getStoreScheduleForAdmin,
  getStoreDayContext,
  getStoreScheduleSummary,
  listStoreScheduleVersions,
  resolveStoreOperatingRangeForDateWithCtx,
  upsertStoreScheduleCommand,
  upsertStoreScheduleCommandWithCtx,
} from "./storeSchedule";

const modules = import.meta.glob("../**/*.ts");
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

afterEach(() => vi.useRealTimers());

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
      reportingCycleStartsOn: 1,
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
      assertConformsToExportedReturns(getStoreDayContext, {
        kind: "missing_schedule",
        timezone: null,
        operatingDate: "2026-06-08",
        phase: "unavailable",
        isOpen: false,
        scheduleVersionId: null,
        currentWindow: null,
        nextWindow: null,
      }),
    ).not.toThrow();
    expect(() =>
      assertConformsToExportedReturns(getActiveStoreScheduleForEmail, schedule),
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
        reportingCycleStartsOn: 1,
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
  it("defaults legacy schedules to a Monday reporting-cycle start", () => {
    expect(baseSchedule().reportingCycleStartsOn).toBeUndefined();
    expect(
      validateStoreScheduleDraft(baseSchedule({ reportingCycleStartsOn: 7 })),
    ).toMatchObject({
      ok: false,
      fields: {
        reportingCycleStartsOn: ["Choose a valid reporting-cycle weekday."],
      },
    });
  });

  it("stages anchor changes at the next boundary under the current anchor", () => {
    expect(
      nextReportingCycleBoundary({
        at: Date.parse("2026-07-01T16:00:00.000Z"),
        reportingCycleStartsOn: 1,
        timezone: "America/New_York",
      }),
    ).toBe(Date.parse("2026-07-06T04:00:00.000Z"));
  });

  it("keeps the old schedule active until a changed anchor reaches its boundary", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-01T16:00:00.000Z"));
    const current = baseSchedule({
      effectiveFrom: Date.parse("2026-01-01T00:00:00.000Z"),
      timezone: "America/New_York",
    });
    const ctx = {
      db: {
        get: vi.fn(async (table: string, id: string) =>
          table === "store" ? { _id: id, organizationId: "org-1" } : null,
        ),
        query: vi.fn(() => ({
          withIndex: vi.fn(() => ({
            take: vi.fn(async () => [current]),
            unique: vi.fn(async () => null),
          })),
        })),
        insert: vi.fn(async () => "next-schedule"),
        patch: vi.fn(),
      },
    } as any;

    await upsertStoreScheduleCommandWithCtx(ctx, {
      storeId: "store-1" as any,
      timezone: "America/New_York",
      weeklyClosedDays: [0],
      weeklyWindows: [{ dayOfWeek: 1, startMinute: 540, endMinute: 1020 }],
      dateExceptions: [],
      effectiveFrom: Date.now(),
      reportingCycleStartsOn: 3,
      supersedesScheduleId: "schedule-1" as any,
    });

    expect(ctx.db.insert).toHaveBeenCalledWith(
      "storeSchedule",
      expect.objectContaining({
        effectiveFrom: Date.parse("2026-07-06T04:00:00.000Z"),
        reportingCycleStartsOn: 3,
      }),
    );
    expect(ctx.db.patch).toHaveBeenCalledWith(
      "storeSchedule",
      "schedule-1",
      expect.objectContaining({
        effectiveTo: Date.parse("2026-07-06T04:00:00.000Z"),
      }),
    );
    expect(ctx.db.patch.mock.calls[0][2]).not.toHaveProperty("status");
  });

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
      weeklyWindows: [
        "These hours overlap. Adjust one time range before saving.",
      ],
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
          table === "store" ? { _id: id, organizationId: "org-1" } : null,
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
      weeklyWindows: [
        { dayOfWeek: 1, startMinute: 9 * 60, endMinute: 17 * 60 },
      ],
      dateExceptions: [],
      effectiveFrom: Date.parse("2026-06-01T00:00:00.000Z"),
      source: "admin",
    });

    expect(result).toMatchObject({
      kind: "user_error",
      error: {
        code: "conflict",
        fields: {
          effectiveFrom: [
            "Schedule effective dates overlap an active version.",
          ],
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
    expect(schema).toContain('.index("by_storeId_status_effectiveFrom", [');
    expect(schema).toContain('"effectiveFrom",');
    expect(schema).toContain('.index("by_organizationId_storeId_status", [');
    expect(schema).toContain('"organizationId",');
    expect(schema).toContain('"storeId",');
    expect(schema).toContain('"status",');
    expect(schema).toContain(
      '.index("by_source_status", ["source", "status"])',
    );
  });
});

describe("store schedule version resolution", () => {
  it("resolves the newest effective schedule before applying the version cap", async () => {
    const olderSchedules = Array.from({ length: 100 }, (_, index) =>
      baseSchedule({
        _id: `old-schedule-${index + 1}` as any,
        effectiveFrom: Date.UTC(2026, 0, index + 1),
        weeklyWindows: [
          { dayOfWeek: 1, startMinute: 9 * 60, endMinute: 10 * 60 },
        ],
      }),
    );
    const latestSchedule = baseSchedule({
      _id: "latest-schedule" as any,
      effectiveFrom: Date.parse("2026-06-01T00:00:00.000Z"),
      timezone: "UTC",
      weeklyWindows: [
        { dayOfWeek: 1, startMinute: 12 * 60, endMinute: 13 * 60 },
      ],
    });
    const schedules = [...olderSchedules, latestSchedule];
    const ctx = {
      db: {
        query: vi.fn(() => {
          const filters: Array<[string, unknown | { lte: unknown }]> = [];
          let sortDirection: "asc" | "desc" = "asc";
          const rows = () =>
            schedules
              .filter((schedule) =>
                filters.every(([field, value]) => {
                  if (value && typeof value === "object" && "lte" in value) {
                    return (
                      Number(schedule[field as keyof typeof schedule]) <=
                      Number(value.lte)
                    );
                  }

                  return schedule[field as keyof typeof schedule] === value;
                }),
              )
              .sort((left, right) =>
                sortDirection === "desc"
                  ? right.effectiveFrom - left.effectiveFrom
                  : left.effectiveFrom - right.effectiveFrom,
              );

          const chain = {
            order(direction: "asc" | "desc") {
              sortDirection = direction;
              return chain;
            },
            take: vi.fn(async (limit: number) => rows().slice(0, limit)),
            withIndex: vi.fn(
              (
                _index: string,
                applyIndex: (builder: {
                  eq: (field: string, value: unknown) => typeof builder;
                  lte: (field: string, value: unknown) => typeof builder;
                }) => void,
              ) => {
                const builder = {
                  eq(field: string, value: unknown) {
                    filters.push([field, value]);
                    return builder;
                  },
                  lte(field: string, value: unknown) {
                    filters.push([field, { lte: value }]);
                    return builder;
                  },
                };
                applyIndex(builder);
                return chain;
              },
            ),
          };

          return chain;
        }),
      },
    } as any;

    const result = await resolveStoreOperatingRangeForDateWithCtx(ctx, {
      operatingDate: "2026-06-08",
      storeId: "store-1" as any,
    });

    expect(result.schedule?._id).toBe("latest-schedule");
    expect(result.range).toMatchObject({
      kind: "resolved",
      startAt: Date.parse("2026-06-08T12:00:00.000Z"),
      endAt: Date.parse("2026-06-08T13:00:00.000Z"),
    });
  });
});

describe("store schedule version staging and coexistence", () => {
  const SCHEDULE_TIMEZONE = "America/New_York";

  async function seedStore(t: ReturnType<typeof convexTest>) {
    return t.run(async (ctx) => {
      const createdByUserId = await ctx.db.insert("athenaUser", {
        email: "schedule-versioning@test",
      });
      const organizationId = await ctx.db.insert("organization", {
        createdByUserId,
        name: "schedule-versioning",
        slug: "schedule-versioning",
      });
      const storeId = await ctx.db.insert("store", {
        createdByUserId,
        currency: "GHS",
        name: "schedule-versioning",
        organizationId,
        slug: "schedule-versioning",
      });
      return { organizationId, storeId };
    });
  }

  async function insertVersion(
    t: ReturnType<typeof convexTest>,
    args: {
      organizationId: Id<"organization">;
      storeId: Id<"store">;
      effectiveFrom: number;
      effectiveTo?: number;
      reportingCycleStartsOn?: number;
      status?: "active" | "superseded" | "candidate";
      weeklyClosedDays?: number[];
    },
  ) {
    return t.run(async (ctx) =>
      ctx.db.insert("storeSchedule", {
        organizationId: args.organizationId,
        storeId: args.storeId,
        timezone: SCHEDULE_TIMEZONE,
        weeklyWindows: [
          { dayOfWeek: 1, startMinute: 9 * 60, endMinute: 18 * 60 },
        ],
        weeklyClosedDays: args.weeklyClosedDays ?? [0],
        dateExceptions: [],
        reportingCycleStartsOn: args.reportingCycleStartsOn ?? 1,
        effectiveFrom: args.effectiveFrom,
        effectiveTo: args.effectiveTo,
        status: args.status ?? "active",
        source: "admin",
        createdAt: args.effectiveFrom,
        updatedAt: args.effectiveFrom,
      }),
    );
  }

  const resolveAt = (
    t: ReturnType<typeof convexTest>,
    storeId: Id<"store">,
    at: number,
  ) =>
    t.run(async (ctx) =>
      getStoreScheduleContextForStoreAtWithCtx(ctx, { storeId, at }),
    );

  const listVersions = (t: ReturnType<typeof convexTest>) =>
    t.run(async (ctx) =>
      // eslint-disable-next-line @convex-dev/no-collect-in-query -- convex-test fixture read, not a production query
      ctx.db.query("storeSchedule").collect(),
    );

  const getHandler = (definition: unknown) =>
    (definition as { _handler: Function })._handler;

  // The exported command used to probe admission with `resolveWriteAdmission`
  // and only then run `admitPublicMutation`, admitting twice per call. The
  // denial is now mapped in a catch around the single wrapper call, and the
  // caller-visible `CommandResult` must be byte-for-byte what it was: a
  // `user_error`, never a throw, and no schedule row written.
  it("maps a rail admission denial on the public command to the store-hours userError", async () => {
    const t = convexTest(schema, modules);
    const { storeId } = await seedStore(t);

    // No identity on the ctx, so the rail denies before the domain body runs.
    const result = await t.run(async (ctx) =>
      getHandler(upsertStoreScheduleCommand)(ctx, {
        storeId,
        timezone: SCHEDULE_TIMEZONE,
        weeklyClosedDays: [0],
        weeklyWindows: [
          { dayOfWeek: 1, startMinute: 9 * 60, endMinute: 18 * 60 },
        ],
        dateExceptions: [],
        effectiveFrom: Date.now(),
        reportingCycleStartsOn: 1,
      }),
    );

    expect(result).toEqual({
      kind: "user_error",
      error: {
        code: "authorization_failed",
        message: "You do not have access to manage store hours.",
      },
    });
    expect(await listVersions(t)).toEqual([]);
  });

  it("hands over at the boundary even when the truncated version keeps a stale active status", async () => {
    const t = convexTest(schema, modules);
    const { organizationId, storeId } = await seedStore(t);
    const boundary = Date.parse("2026-07-06T04:00:00.000Z");
    // Deliberately stale: the truncated version is still `active`, as it is
    // between the staging write and its boundary, and as it would remain if
    // status cleanup never ran. Effective ranges, not status, decide handover.
    const currentId = await insertVersion(t, {
      organizationId,
      storeId,
      effectiveFrom: Date.parse("2026-01-01T00:00:00.000Z"),
      effectiveTo: boundary,
      reportingCycleStartsOn: 1,
      status: "active",
    });
    const futureId = await insertVersion(t, {
      organizationId,
      storeId,
      effectiveFrom: boundary,
      reportingCycleStartsOn: 3,
      status: "active",
    });

    expect(
      (await listVersions(t)).every((version) => version.status === "active"),
    ).toBe(true);

    const before = await resolveAt(t, storeId, boundary - 1);
    const atBoundary = await resolveAt(t, storeId, boundary);
    const after = await resolveAt(t, storeId, boundary + 60_000);

    expect(before.schedule?._id).toBe(currentId);
    expect(before.schedule?.reportingCycleStartsOn).toBe(1);
    expect(atBoundary.schedule?._id).toBe(futureId);
    expect(after.schedule?._id).toBe(futureId);
    expect(after.schedule?.reportingCycleStartsOn).toBe(3);
    // Coexistence never means ambiguity: every instant resolves one version.
    expect(before.context.kind).toBe("resolved");
    expect(after.context.kind).toBe("resolved");
  });

  it("stops resolving a truncated version past its end even while it reads active", async () => {
    const t = convexTest(schema, modules);
    const { organizationId, storeId } = await seedStore(t);
    const boundary = Date.parse("2026-07-06T04:00:00.000Z");
    // The successor is missing, so only the `effectiveTo` bound - not the
    // index's `effectiveFrom` ordering - can keep a stale `active` version
    // from answering for time it no longer covers.
    await insertVersion(t, {
      organizationId,
      storeId,
      effectiveFrom: Date.parse("2026-01-01T00:00:00.000Z"),
      effectiveTo: boundary,
      status: "active",
    });

    expect((await resolveAt(t, storeId, boundary - 1)).schedule).not.toBeNull();
    expect((await resolveAt(t, storeId, boundary)).schedule).toBeNull();
    expect((await resolveAt(t, storeId, boundary)).context).toMatchObject({
      kind: "missing_schedule",
    });
  });

  it("stages every submitted operational field with an anchor change, not just the anchor", async () => {
    const t = convexTest(schema, modules);
    const { organizationId, storeId } = await seedStore(t);
    const currentId = await insertVersion(t, {
      organizationId,
      storeId,
      effectiveFrom: Date.parse("2026-01-01T00:00:00.000Z"),
      reportingCycleStartsOn: 1,
    });

    const now = Date.now();
    const expectedBoundary = nextReportingCycleBoundary({
      at: now,
      reportingCycleStartsOn: 1,
      timezone: SCHEDULE_TIMEZONE,
    });
    const submittedWindows = [
      { dayOfWeek: 2, startMinute: 8 * 60, endMinute: 12 * 60 },
      { dayOfWeek: 4, startMinute: 13 * 60, endMinute: 21 * 60 },
    ];
    const submittedExceptions = [
      { localDate: "2026-12-25", closed: true, windows: [], note: "Holiday" },
    ];

    const result = await t.run(async (ctx) =>
      upsertStoreScheduleCommandWithCtx(ctx, {
        storeId,
        timezone: SCHEDULE_TIMEZONE,
        weeklyClosedDays: [0, 3],
        weeklyWindows: submittedWindows,
        dateExceptions: submittedExceptions,
        effectiveFrom: now,
        reportingCycleStartsOn: 3,
        supersedesScheduleId: currentId,
      }),
    );

    expect(result.kind).toBe("ok");
    const versions = await listVersions(t);
    const staged = versions.find((version) => version._id !== currentId);
    expect(staged).toMatchObject({
      effectiveFrom: expectedBoundary,
      reportingCycleStartsOn: 3,
      // The whole submission rides the boundary; hours and closed days do not
      // silently apply ahead of the anchor they were saved with.
      weeklyClosedDays: [0, 3],
      weeklyWindows: submittedWindows,
      dateExceptions: submittedExceptions,
    });

    const truncated = versions.find((version) => version._id === currentId);
    expect(truncated?.effectiveTo).toBe(expectedBoundary);
    expect(truncated?.status).toBe("active");
    expect((await resolveAt(t, storeId, now)).schedule?._id).toBe(currentId);
    expect((await resolveAt(t, storeId, expectedBoundary!)).schedule?._id).toBe(
      staged?._id,
    );
  });

  it("applies an operational-only save immediately at the submitted effective instant", async () => {
    const t = convexTest(schema, modules);
    const { organizationId, storeId } = await seedStore(t);
    const currentId = await insertVersion(t, {
      organizationId,
      storeId,
      effectiveFrom: Date.parse("2026-01-01T00:00:00.000Z"),
      reportingCycleStartsOn: 1,
    });

    const now = Date.now();
    const result = await t.run(async (ctx) =>
      upsertStoreScheduleCommandWithCtx(ctx, {
        storeId,
        timezone: SCHEDULE_TIMEZONE,
        weeklyClosedDays: [0, 2],
        weeklyWindows: [
          { dayOfWeek: 1, startMinute: 7 * 60, endMinute: 15 * 60 },
        ],
        dateExceptions: [],
        effectiveFrom: now,
        reportingCycleStartsOn: 1,
        supersedesScheduleId: currentId,
      }),
    );

    expect(result.kind).toBe("ok");
    const versions = await listVersions(t);
    const saved = versions.find((version) => version._id !== currentId);
    // No anchor change means no staging: the edit is live from `now`.
    expect(saved?.effectiveFrom).toBe(now);
    expect(saved?.weeklyClosedDays).toEqual([0, 2]);
    const superseded = versions.find((version) => version._id === currentId);
    expect(superseded).toMatchObject({
      effectiveTo: now,
      status: "superseded",
      supersededByScheduleId: saved?._id,
    });
    expect((await resolveAt(t, storeId, now)).schedule?._id).toBe(saved?._id);
    // The truncated range still covers the instant before the save, but the
    // resolver reads the `active` index only, so a superseded version stops
    // answering for its own past. Pinned as current behaviour: historical
    // resolution across a same-instant supersede is not served here.
    expect(superseded?.effectiveTo).toBe(now);
    expect((await resolveAt(t, storeId, now - 1)).schedule).toBeNull();
  });

  it("leaves the prior version fully resolvable with no effective-range gap when a save is rejected", async () => {
    const t = convexTest(schema, modules);
    const { organizationId, storeId } = await seedStore(t);
    const currentId = await insertVersion(t, {
      organizationId,
      storeId,
      effectiveFrom: Date.parse("2026-01-01T00:00:00.000Z"),
      reportingCycleStartsOn: 1,
    });
    const now = Date.now();

    // Validation runs before any write, so the insert/truncate pair is never
    // half-applied on a rejected draft. Convex mutations are additionally
    // transactional, so a failure between the insert and the patch rolls both
    // back - partial state is not constructible here by design, and the
    // observable guarantee is the one asserted below.
    const rejected = await t.run(async (ctx) =>
      upsertStoreScheduleCommandWithCtx(ctx, {
        storeId,
        timezone: SCHEDULE_TIMEZONE,
        weeklyClosedDays: [],
        weeklyWindows: [
          { dayOfWeek: 1, startMinute: 9 * 60, endMinute: 12 * 60 },
          { dayOfWeek: 1, startMinute: 11 * 60, endMinute: 15 * 60 },
        ],
        dateExceptions: [],
        effectiveFrom: now,
        reportingCycleStartsOn: 1,
        supersedesScheduleId: currentId,
      }),
    );

    expect(rejected).toMatchObject({
      kind: "user_error",
      error: { code: "validation_failed" },
    });

    const versions = await listVersions(t);
    expect(versions).toHaveLength(1);
    expect(versions[0]).toMatchObject({
      _id: currentId,
      status: "active",
    });
    expect(versions[0].effectiveTo).toBeUndefined();

    for (const at of [
      Date.parse("2026-01-01T00:00:00.000Z"),
      now,
      now + 365 * 86_400_000,
    ]) {
      const resolved = await resolveAt(t, storeId, at);
      expect(resolved.schedule?._id).toBe(currentId);
      expect(resolved.context.kind).toBe("resolved");
    }
  });

  it("rolls back the staged insert and the truncation together when the mutation fails", async () => {
    const t = convexTest(schema, modules);
    const { organizationId, storeId } = await seedStore(t);
    const currentId = await insertVersion(t, {
      organizationId,
      storeId,
      effectiveFrom: Date.parse("2026-01-01T00:00:00.000Z"),
      reportingCycleStartsOn: 1,
    });
    const now = Date.now();

    await expect(
      t.run(async (ctx) => {
        const result = await upsertStoreScheduleCommandWithCtx(ctx, {
          storeId,
          timezone: SCHEDULE_TIMEZONE,
          weeklyClosedDays: [0],
          weeklyWindows: [
            { dayOfWeek: 1, startMinute: 9 * 60, endMinute: 18 * 60 },
          ],
          dateExceptions: [],
          effectiveFrom: now,
          reportingCycleStartsOn: 3,
          supersedesScheduleId: currentId,
        });
        expect(result.kind).toBe("ok");
        // Fail after the insert+truncate pair has been written.
        throw new Error("post-write failure");
      }),
    ).rejects.toThrow("post-write failure");

    const versions = await listVersions(t);
    expect(versions).toHaveLength(1);
    expect(versions[0]._id).toBe(currentId);
    expect(versions[0].effectiveTo).toBeUndefined();
    expect((await resolveAt(t, storeId, now)).schedule?._id).toBe(currentId);
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
