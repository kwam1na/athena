import { describe, expect, it, vi } from "vitest";

import { backfillStoreTimezoneAuthorityWithCtx } from "./backfillStoreTimezoneAuthority";

function createCtx(args: {
  schedules: Array<Record<string, unknown>>;
  versions?: Array<Record<string, unknown>>;
}) {
  const ctx = {
    db: {
      query: vi.fn((table: string) => {
        if (table === "store") {
          return {
            paginate: vi.fn(async () => ({
              page: [{ _id: "store-1", organizationId: "org-1" }],
              isDone: true,
              continueCursor: "",
            })),
          };
        }
        return {
          withIndex: vi.fn(() => ({
            take: vi.fn(async () =>
              table === "storeSchedule" ? args.schedules : (args.versions ?? []),
            ),
          })),
        };
      }),
      insert: vi.fn(async () => "timezone-version-new"),
      patch: vi.fn(async () => null),
    },
  } as any;

  return ctx;
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
};

describe("store timezone authority backfill", () => {
  it("previews and applies missing schedule-derived authority idempotently", async () => {
    const previewCtx = createCtx({ schedules: [schedule] });
    const preview = await backfillStoreTimezoneAuthorityWithCtx(previewCtx, {
      dryRun: true,
      limit: 10,
    });

    expect(preview.rows).toEqual([
      expect.objectContaining({
        action: "would_insert",
        storeId: "store-1",
        timezone: "Africa/Accra",
      }),
    ]);
    expect(previewCtx.db.insert).not.toHaveBeenCalled();

    const applyCtx = createCtx({ schedules: [schedule] });
    const applied = await backfillStoreTimezoneAuthorityWithCtx(applyCtx, {
      dryRun: false,
      limit: 10,
    });

    expect(applied.insertedCount).toBe(1);
    expect(applyCtx.db.insert).toHaveBeenCalledTimes(1);
    expect(applyCtx.db.patch).toHaveBeenCalledWith(
      "storeSchedule",
      "schedule-1",
      { timezoneVersionId: "timezone-version-new" },
    );
  });

  it("requires review when historical schedules disagree on timezone", async () => {
    const ctx = createCtx({
      schedules: [
        schedule,
        { ...schedule, _id: "schedule-2", timezone: "America/New_York" },
      ],
    });

    const result = await backfillStoreTimezoneAuthorityWithCtx(ctx, {
      dryRun: false,
    });

    expect(result.rows).toEqual([
      expect.objectContaining({ action: "needs_review" }),
    ]);
    expect(ctx.db.insert).not.toHaveBeenCalled();
  });
});
