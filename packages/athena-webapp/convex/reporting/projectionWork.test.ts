import { describe, expect, it } from "vitest";

import {
  completedProjectionWorkPatch,
  failedProjectionWorkPatch,
  pendingProjectionWorkPatch,
  processFactProjectionBatch,
  processInventoryEffectProjection,
  resumePendingProjectionWorkForStore,
} from "./projectionWork";

describe("reporting projection work", () => {
  it("keeps scheduler failures durable and retryable", () => {
    expect(pendingProjectionWorkPatch({}, 100)).toEqual({
      projectionAttemptCount: 1,
      projectionLastAttemptAt: 100,
      projectionStatus: "pending",
    });
    expect(
      pendingProjectionWorkPatch({ projectionAttemptCount: 1 }, 200),
    ).toEqual({
      projectionAttemptCount: 2,
      projectionLastAttemptAt: 200,
      projectionStatus: "pending",
    });
    expect(
      failedProjectionWorkPatch(
        { projectionAttemptCount: 2, projectionLastAttemptAt: 200 },
        210,
        "projection_worker_failed",
      ),
    ).toEqual({
      projectionAttemptCount: 2,
      projectionLastAttemptAt: 200,
      projectionLatestFailureAt: 210,
      projectionLatestFailureCode: "projection_worker_failed",
      projectionStatus: "failed",
    });
  });

  it("records completed projection work without leaving a failure reason", () => {
    expect(
      completedProjectionWorkPatch(
        { projectionAttemptCount: 3, projectionLastAttemptAt: 250 },
        300,
      ),
    ).toMatchObject({
      projectionAttemptCount: 3,
      projectionLastAttemptAt: 250,
      projectionStatus: "completed",
      projectedAt: 300,
    });
  });

  it("records fact worker failures through the durable wrapper action", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const handler = (
      processFactProjectionBatch as unknown as { _handler: Function }
    )._handler;
    await handler(
      {
        runMutation: async (
          _reference: unknown,
          args: Record<string, unknown>,
        ) => {
          calls.push(args);
          if (calls.length === 1) throw new Error("projection failed");
        },
      },
      { factIds: ["fact-1"] },
    );
    expect(calls).toEqual([
      { factIds: ["fact-1"] },
      { factIds: ["fact-1"], safeCode: "projection_worker_failed" },
    ]);
  });

  it("records inventory worker failures through the durable wrapper action", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const handler = (
      processInventoryEffectProjection as unknown as { _handler: Function }
    )._handler;
    await handler(
      {
        runMutation: async (
          _reference: unknown,
          args: Record<string, unknown>,
        ) => {
          calls.push(args);
          if (calls.length === 1) throw new Error("projection failed");
        },
      },
      { effectId: "effect-1" },
    );
    expect(calls).toEqual([
      { effectId: "effect-1" },
      { effectId: "effect-1", safeCode: "projection_worker_failed" },
    ]);
  });

  it("recovers the oldest bounded fact or effect without starving effects", async () => {
    const rows = {
      reportingFact: [
        {
          _id: "fact-newer",
          createdAt: 20,
          projectionStatus: "pending",
          status: "canonical",
          storeId: "store-1",
        },
      ],
      reportingInventoryEffect: [
        {
          _id: "effect-older",
          createdAt: 10,
          projectionStatus: "failed",
          storeId: "store-1",
        },
      ],
    };
    const scheduled: Array<Record<string, unknown>> = [];
    const ctx = {
      db: {
        get: async (table: keyof typeof rows, id: string) =>
          rows[table].find((row) => row._id === id) ?? null,
        patch: async () => undefined,
        query: (table: keyof typeof rows) => ({
          withIndex: (_index: string, apply: Function) => {
            const filters: Array<[string, unknown]> = [];
            const builder = {
              eq(field: string, value: unknown) {
                filters.push([field, value]);
                return builder;
              },
            };
            apply(builder);
            const matches = rows[table].filter((row) =>
              filters.every(([field, value]) =>
                field in row ? row[field as keyof typeof row] === value : false,
              ),
            );
            const chain = {
              order: () => chain,
              take: async (limit: number) => matches.slice(0, limit),
            };
            return chain;
          },
        }),
      },
      scheduler: {
        runAfter: async (
          _delay: number,
          _reference: unknown,
          args: Record<string, unknown>,
        ) => {
          scheduled.push(args);
        },
      },
    };
    const handler = (
      resumePendingProjectionWorkForStore as unknown as { _handler: Function }
    )._handler;

    await expect(
      handler(ctx, { limit: 1, storeId: "store-1" }),
    ).resolves.toMatchObject({ inspectedCount: 1, scheduledCount: 1 });
    expect(scheduled).toEqual([{ effectId: "effect-older" }]);
  });
});
