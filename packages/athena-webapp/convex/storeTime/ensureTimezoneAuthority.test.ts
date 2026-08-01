import { describe, expect, it, vi } from "vitest";

import { ensureTimezoneAuthorityForScheduleWithCtx } from "./ensureTimezoneAuthority";

function createCtx(existingVersions: Array<Record<string, unknown>> = []) {
  let insertedVersion: Record<string, unknown> | null = null;
  const ctx = {
    db: {
      query: vi.fn((table: string) => {
        expect(table).toBe("storeTimezoneVersion");
        return {
          withIndex: vi.fn(() => ({
            take: vi.fn(async () => existingVersions),
          })),
        };
      }),
      insert: vi.fn(async (_table: string, value: Record<string, unknown>) => {
        insertedVersion = value;
        return "timezone-version-new";
      }),
      patch: vi.fn(async () => null),
    },
  } as any;

  return { ctx, getInsertedVersion: () => insertedVersion };
}

const schedule = {
  _id: "schedule-1",
  organizationId: "org-1",
  storeId: "store-1",
  timezone: "Africa/Accra",
  effectiveFrom: Date.parse("2026-06-01T00:00:00.000Z"),
  status: "active",
  source: "admin",
  createdAt: Date.parse("2026-06-01T00:00:00.000Z"),
  updatedAt: Date.parse("2026-06-01T00:00:00.000Z"),
  createdByUserId: "user-1",
  updatedByUserId: "user-1",
};

describe("schedule-derived timezone authority", () => {
  it("creates and links authority when an authorized schedule has none", async () => {
    const { ctx, getInsertedVersion } = createCtx();

    const result = await ensureTimezoneAuthorityForScheduleWithCtx(ctx, {
      schedule: schedule as any,
      actorUserId: "user-1" as any,
    });

    expect(result).toEqual({
      action: "inserted",
      timezoneVersionId: "timezone-version-new",
    });
    expect(getInsertedVersion()).toMatchObject({
      organizationId: "org-1",
      storeId: "store-1",
      timezone: "Africa/Accra",
      effectiveFrom: schedule.effectiveFrom,
      source: "schedule_evidence",
      authorizedByUserId: "user-1",
      evidenceHash: "store-schedule:schedule-1",
    });
    expect(ctx.db.patch).toHaveBeenCalledWith(
      "storeSchedule",
      "schedule-1",
      { timezoneVersionId: "timezone-version-new" },
    );
  });

  it("reuses matching authority and remains idempotent", async () => {
    const existing = {
      _id: "timezone-version-existing",
      organizationId: "org-1",
      storeId: "store-1",
      timezone: "Africa/Accra",
      effectiveFrom: schedule.effectiveFrom,
      contentHash: "store-timezone-v1:Africa%2FAccra:1780272000000",
      source: "schedule_evidence",
      authorizedByUserId: "user-1",
      authorizedAt: schedule.createdAt,
      createdAt: schedule.createdAt,
    };
    const { ctx } = createCtx([existing]);

    const result = await ensureTimezoneAuthorityForScheduleWithCtx(ctx, {
      schedule: schedule as any,
      actorUserId: "user-1" as any,
    });

    expect(result).toEqual({
      action: "reused",
      timezoneVersionId: "timezone-version-existing",
    });
    expect(ctx.db.insert).not.toHaveBeenCalled();
    expect(ctx.db.patch).toHaveBeenCalledWith(
      "storeSchedule",
      "schedule-1",
      { timezoneVersionId: "timezone-version-existing" },
    );
  });

  it("refuses to infer authority across conflicting schedule timezones", async () => {
    const { ctx } = createCtx([
      {
        _id: "timezone-version-existing",
        organizationId: "org-1",
        storeId: "store-1",
        timezone: "America/New_York",
        effectiveFrom: schedule.effectiveFrom,
        contentHash: "hash",
        source: "admin_authorized",
        authorizedByUserId: "user-1",
        authorizedAt: schedule.createdAt,
        createdAt: schedule.createdAt,
      },
    ]);

    await expect(
      ensureTimezoneAuthorityForScheduleWithCtx(ctx, {
        schedule: schedule as any,
        actorUserId: "user-1" as any,
      }),
    ).rejects.toThrow("explicit timezone authorization");
    expect(ctx.db.insert).not.toHaveBeenCalled();
    expect(ctx.db.patch).not.toHaveBeenCalled();
  });
});
