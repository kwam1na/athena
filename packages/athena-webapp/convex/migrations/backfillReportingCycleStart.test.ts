import { describe, expect, it, vi } from "vitest";
import type { Validator } from "convex/values";

import type { Id } from "../_generated/dataModel";
import { storeScheduleSchema } from "../schemas/inventory/storeSchedule";
import {
  hasCompletedWeeklyReportingCycleAnchorVerification,
  isWeeklyReportingEnabledForStoreDoc,
} from "../platform/capabilityCatalog";
import {
  backfillReportingCycleStartWithCtx,
  verifyReportingCycleStartWithCtx,
  verifyStoreReportingCycleStartWithCtx,
} from "./backfillReportingCycleStart";

type Schedule = {
  _id: string;
  reportingCycleStartsOn?: number;
};

type AnchorEvidence = {
  status: string;
  missingCount: number;
  startedAt: number;
  completedAt?: number;
};

/** Paginates one store's schedule history and records evidence on the store. */
function createStoreVerificationCtx(initialSchedules: Schedule[]) {
  const schedules = structuredClone(initialSchedules);
  const store = { _id: "store-1" } as {
    _id: string;
    weeklyObservedAtVerification?: AnchorEvidence;
    weeklyReportingCycleAnchorVerification?: AnchorEvidence;
    weeklyReportingAcceptanceFloor?: number;
  };
  const patch = vi.fn(
    async (table: string, id: string, value: Record<string, unknown>) => {
      if (table === "store" && id === store._id) Object.assign(store, value);
      const schedule = schedules.find((candidate) => candidate._id === id);
      if (table === "storeSchedule" && schedule) Object.assign(schedule, value);
    },
  );
  const paginate = vi.fn(
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
  );
  // The store-scoped scan goes through `withIndex`; the global backfill does
  // not. One harness serves both so the ordering can be exercised end to end.
  const query = vi.fn(() => ({
    paginate,
    withIndex: vi.fn(() => ({ paginate })),
  }));

  const runAfter = vi.fn(async (..._args: unknown[]) => "job" as never);
  return {
    ctx: {
      db: { get: vi.fn(async () => store), patch, query },
      scheduler: { runAfter },
    } as any,
    runAfter,
    schedules,
    store,
  };
}

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

  const runAfter = vi.fn(async (..._args: unknown[]) => "job" as never);
  return {
    ctx: { db: { patch, query }, scheduler: { runAfter } } as any,
    patch,
    runAfter,
    schedules,
  };
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

  it("drives itself to completion when autoContinue is set", async () => {
    const harness = createCtx([
      { _id: "schedule-1" },
      { _id: "schedule-2" },
      { _id: "schedule-3", reportingCycleStartsOn: 4 },
    ]);

    const first = await backfillReportingCycleStartWithCtx(harness.ctx, {
      autoContinue: true,
      dryRun: false,
      limit: 2,
    });

    expect(first.isDone).toBe(false);
    // The chain carries the cursor and the running totals, so the last batch
    // can report the whole job rather than its own slice.
    expect(harness.runAfter).toHaveBeenCalledTimes(1);
    const [, , scheduledArgs] = harness.runAfter.mock.calls[0]!;
    expect(scheduledArgs).toMatchObject({
      autoContinue: true,
      changedSoFar: 2,
      cursor: first.continueCursor,
      dryRun: false,
      limit: 2,
      processedSoFar: 2,
    });

    const second = await backfillReportingCycleStartWithCtx(
      harness.ctx,
      scheduledArgs as never,
    );
    expect(second.isDone).toBe(true);
    expect(second.totals).toEqual({
      changedCount: 2,
      missingCount: 2,
      processedCount: 3,
    });
    // A finished chain must not schedule another link.
    expect(harness.runAfter).toHaveBeenCalledTimes(1);
  });

  it("never self-schedules unless autoContinue is requested", async () => {
    const harness = createCtx([{ _id: "schedule-1" }, { _id: "schedule-2" }]);

    const result = await backfillReportingCycleStartWithCtx(harness.ctx, {
      dryRun: true,
      limit: 1,
    });

    expect(result.isDone).toBe(false);
    expect(harness.runAfter).not.toHaveBeenCalled();
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

describe("reporting-cycle anchor capability evidence", () => {
  const OBSERVED_AT_VERIFIED = {
    status: "complete",
    missingCount: 0,
    startedAt: 1,
    completedAt: 2,
  } as const;

  it("keeps the weekly capability off until a store's whole schedule history is anchored", async () => {
    const harness = createStoreVerificationCtx([
      { _id: "schedule-1", reportingCycleStartsOn: 1 },
      { _id: "schedule-2" },
    ]);
    harness.store.weeklyObservedAtVerification = { ...OBSERVED_AT_VERIFIED };

    // Allowlisted and observedAt-verified, but never anchor-verified: off.
    expect(
      isWeeklyReportingEnabledForStoreDoc("store-1", harness.store, "store-1"),
    ).toBe(false);

    await expect(
      verifyStoreReportingCycleStartWithCtx(harness.ctx, {
        limit: 25,
        storeId: "store-1" as Id<"store">,
      }),
    ).resolves.toMatchObject({
      complete: false,
      isDone: true,
      missingCount: 1,
    });
    expect(harness.store.weeklyReportingCycleAnchorVerification).toMatchObject({
      status: "incomplete",
      missingCount: 1,
    });
    expect(hasCompletedWeeklyReportingCycleAnchorVerification(harness.store)).toBe(
      false,
    );
    expect(
      isWeeklyReportingEnabledForStoreDoc("store-1", harness.store, "store-1"),
    ).toBe(false);

    await expect(
      finishBackfill(harness.ctx, false),
    ).resolves.toMatchObject({ changedCount: 1 });
    await expect(
      verifyStoreReportingCycleStartWithCtx(harness.ctx, {
        limit: 25,
        storeId: "store-1" as Id<"store">,
      }),
    ).resolves.toMatchObject({ complete: true, isDone: true, missingCount: 0 });
    expect(harness.store.weeklyReportingCycleAnchorVerification).toMatchObject({
      status: "complete",
      missingCount: 0,
    });
    expect(
      isWeeklyReportingEnabledForStoreDoc("store-1", harness.store, "store-1"),
    ).toBe(true);
  });

  it("continues a store verification to completion under autoContinue", async () => {
    const harness = createStoreVerificationCtx([
      { _id: "schedule-1", reportingCycleStartsOn: 1 },
      { _id: "schedule-2", reportingCycleStartsOn: 1 },
    ]);

    const first = await verifyStoreReportingCycleStartWithCtx(harness.ctx, {
      autoContinue: true,
      limit: 1,
      storeId: "store-1" as Id<"store">,
    });
    expect(first.isDone).toBe(false);
    expect(harness.runAfter).toHaveBeenCalledTimes(1);
    const [, , scheduledArgs] = harness.runAfter.mock.calls[0]!;
    expect(scheduledArgs).toMatchObject({
      autoContinue: true,
      cursor: first.continueCursor,
      storeId: "store-1",
    });

    const second = await verifyStoreReportingCycleStartWithCtx(
      harness.ctx,
      scheduledArgs as never,
    );
    expect(second).toMatchObject({ complete: true, isDone: true });
    // Terminal batch stops the chain.
    expect(harness.runAfter).toHaveBeenCalledTimes(1);
  });

  it("stamps the acceptance floor exactly once, when the second verification completes", async () => {
    const anchored = [{ _id: "schedule-1", reportingCycleStartsOn: 1 }];

    // Completing the anchor check first, without observedAt evidence, does
    // not activate the store.
    const first = createStoreVerificationCtx(anchored);
    await expect(
      verifyStoreReportingCycleStartWithCtx(first.ctx, {
        limit: 25,
        storeId: "store-1" as Id<"store">,
      }),
    ).resolves.toMatchObject({ complete: true });
    expect(first.store.weeklyReportingAcceptanceFloor).toBeUndefined();

    // With observedAt already verified, completion activates and stamps once.
    const second = createStoreVerificationCtx(anchored);
    second.store.weeklyObservedAtVerification = { ...OBSERVED_AT_VERIFIED };
    await expect(
      verifyStoreReportingCycleStartWithCtx(second.ctx, {
        limit: 25,
        storeId: "store-1" as Id<"store">,
      }),
    ).resolves.toMatchObject({ complete: true });
    const floor = second.store.weeklyReportingAcceptanceFloor;
    expect(typeof floor).toBe("number");

    await verifyStoreReportingCycleStartWithCtx(second.ctx, {
      limit: 25,
      storeId: "store-1" as Id<"store">,
    });
    expect(second.store.weeklyReportingAcceptanceFloor).toBe(floor);
  });

  it("accumulates stragglers across a resumed scan and never completes early", async () => {
    const harness = createStoreVerificationCtx([
      { _id: "schedule-1" },
      { _id: "schedule-2", reportingCycleStartsOn: 1 },
      { _id: "schedule-3" },
    ]);

    const first = await verifyStoreReportingCycleStartWithCtx(harness.ctx, {
      limit: 2,
      storeId: "store-1" as Id<"store">,
    });
    expect(first).toMatchObject({ complete: false, isDone: false });
    expect(harness.store.weeklyReportingCycleAnchorVerification).toMatchObject({
      status: "running",
      missingCount: 1,
    });

    await expect(
      verifyStoreReportingCycleStartWithCtx(harness.ctx, {
        cursor: first.continueCursor,
        limit: 2,
        storeId: "store-1" as Id<"store">,
      }),
    ).resolves.toMatchObject({
      complete: false,
      isDone: true,
      missingCount: 2,
    });
    expect(harness.store.weeklyReportingCycleAnchorVerification).toMatchObject({
      status: "incomplete",
      missingCount: 2,
    });
  });
});

describe("reporting-cycle anchor narrowing gate", () => {
  it("keeps the persisted anchor widened while the backfill is still the mechanism", () => {
    const fields = (
      storeScheduleSchema as unknown as {
        fields: Record<string, Validator<any, any, any> & { isOptional: string }>;
      }
    ).fields;
    expect(fields.reportingCycleStartsOn.isOptional).toBe("optional");
  });

  it("GUARD: narrowing must not land while the completion check can still find stragglers", async () => {
    // The check demonstrably distinguishes the two worlds, which is exactly why
    // it is still the mechanism — a deployment may hold un-backfilled rows.
    await expect(
      finishVerification(createCtx([{ _id: "legacy" }]).ctx),
    ).resolves.toEqual({ complete: false, missingCount: 1 });
    await expect(
      finishVerification(
        createCtx([{ _id: "stamped", reportingCycleStartsOn: 1 }]).ctx,
      ),
    ).resolves.toEqual({ complete: true, missingCount: 0 });

    const fields = (
      storeScheduleSchema as unknown as {
        fields: Record<string, Validator<any, any, any> & { isOptional: string }>;
      }
    ).fields;
    // Narrowing `reportingCycleStartsOn` to required is only safe once every
    // deployment has reported zero missing anchors AND this completion check
    // has been retired. Retire the check in the same change, or this fails.
    expect(fields.reportingCycleStartsOn.isOptional).toBe("optional");
  });
});
