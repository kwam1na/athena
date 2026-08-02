import { describe, expect, it, vi } from "vitest";

import {
  backfillReportingCycleStartWithCtx,
  verifyReportingCycleStartWithCtx,
} from "./backfillReportingCycleStart";

type Schedule = {
  _id: string;
  reportingCycleStartsOn?: number;
};

function createCtx(initialSchedules: Schedule[]) {
  const schedules = structuredClone(initialSchedules);
  const patch = vi.fn(
    async (_table: string, id: string, value: Record<string, unknown>) => {
      const schedule = schedules.find((candidate) => candidate._id === id);
      if (!schedule) throw new Error(`Missing schedule ${id}`);
      Object.assign(schedule, value);
    },
  );
  const query = vi.fn(() => ({
    paginate: vi.fn(
      async ({
        cursor,
        numItems,
      }: {
        cursor: string | null;
        numItems: number;
      }) => {
        const start = cursor ? Number(cursor) : 0;
        const end = Math.min(start + numItems, schedules.length);
        return {
          continueCursor: String(end),
          isDone: end >= schedules.length,
          page: schedules.slice(start, end),
        };
      },
    ),
  }));

  return { ctx: { db: { patch, query } } as any, patch, schedules };
}

async function finishBackfill(
  ctx: ReturnType<typeof createCtx>["ctx"],
  dryRun: boolean,
) {
  let cursor: string | null = null;
  let changedCount = 0;
  let missingCount = 0;

  while (true) {
    const result = await backfillReportingCycleStartWithCtx(ctx, {
      cursor,
      dryRun,
      limit: 1,
    });
    changedCount += result.changedCount;
    missingCount += result.missingCount;
    if (result.isDone) return { changedCount, missingCount };
    cursor = result.continueCursor;
  }
}

async function finishVerification(ctx: ReturnType<typeof createCtx>["ctx"]) {
  let cursor: string | null = null;
  let missingCount = 0;

  while (true) {
    const result = await verifyReportingCycleStartWithCtx(ctx, {
      cursor,
      limit: 1,
    });
    missingCount += result.missingCount;
    if (result.isDone) return { complete: missingCount === 0, missingCount };
    cursor = result.continueCursor;
  }
}

describe("reporting-cycle start backfill", () => {
  it("dry-runs, resumes, and fills only missing anchors with Monday", async () => {
    const harness = createCtx([
      { _id: "schedule-1" },
      { _id: "schedule-2", reportingCycleStartsOn: 3 },
      { _id: "schedule-3" },
    ]);

    await expect(finishVerification(harness.ctx)).resolves.toEqual({
      complete: false,
      missingCount: 2,
    });
    await expect(finishBackfill(harness.ctx, true)).resolves.toEqual({
      changedCount: 0,
      missingCount: 2,
    });
    expect(harness.patch).not.toHaveBeenCalled();

    await expect(finishBackfill(harness.ctx, false)).resolves.toEqual({
      changedCount: 2,
      missingCount: 2,
    });
    expect(harness.schedules).toEqual([
      { _id: "schedule-1", reportingCycleStartsOn: 1 },
      { _id: "schedule-2", reportingCycleStartsOn: 3 },
      { _id: "schedule-3", reportingCycleStartsOn: 1 },
    ]);
    expect(harness.patch).toHaveBeenCalledTimes(2);
    await expect(finishVerification(harness.ctx)).resolves.toEqual({
      complete: true,
      missingCount: 0,
    });
  });

  it("is idempotent and preserves explicit non-Monday anchors", async () => {
    const harness = createCtx([
      { _id: "schedule-1", reportingCycleStartsOn: 6 },
    ]);

    await expect(finishBackfill(harness.ctx, false)).resolves.toEqual({
      changedCount: 0,
      missingCount: 0,
    });
    expect(harness.patch).not.toHaveBeenCalled();
    expect(harness.schedules[0].reportingCycleStartsOn).toBe(6);
  });
});
