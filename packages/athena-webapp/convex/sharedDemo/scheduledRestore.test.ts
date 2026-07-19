import { describe, expect, it } from "vitest";

import {
  continueRestoreWithCtx,
  runHourlyRestoreWithCtx,
  sharedDemoRestoreEnabled,
} from "./scheduledRestore";

describe("shared demo scheduled restore environment gate", () => {
  it("requires the flag in an allowed deployment environment", () => {
    expect(
      sharedDemoRestoreEnabled({
        ATHENA_SHARED_DEMO_ENABLED: "true",
        STAGE: "qa",
      }),
    ).toBe(true);
    expect(
      sharedDemoRestoreEnabled({
        ATHENA_SHARED_DEMO_ENABLED: "true",
        STAGE: "preview",
      }),
    ).toBe(false);
    expect(
      sharedDemoRestoreEnabled({
        STAGE: "qa",
      }),
    ).toBe(false);
  });

  it("provisions first and acquires a lease whose continuation is scheduled atomically", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const ctx = {
      runMutation: async (_reference: unknown, args: Record<string, unknown>) => {
        calls.push(args);
        return calls.length === 1
          ? { kind: "bootstrapped", storeId: "store-1" }
          : { baselineVersion: 6, epoch: 1, kind: "started" };
      },
    };
    await expect(runHourlyRestoreWithCtx(ctx as never, {
      ATHENA_SHARED_DEMO_ENABLED: "true",
      ATHENA_SHARED_DEMO_STORE_ID: "store-1",
      STAGE: "qa",
    })).resolves.toMatchObject({ epoch: 1, kind: "started" });
    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual(expect.objectContaining({ now: expect.any(Number) }));
    expect(calls[1]).toEqual(expect.objectContaining({ source: "hourly", storeId: "store-1" }));
  });

  it("persists a fenced failure when the atomic apply transaction rejects", async () => {
    const calls: Array<{ args: Record<string, unknown>; reference: unknown }> =
      [];
    const ctx = {
      runMutation: async (
        reference: unknown,
        args: Record<string, unknown>,
      ) => {
        calls.push({ args, reference });
        if (calls.length === 1) throw new Error("apply failed");
        return { kind: "failed" };
      },
    };
    await expect(
      continueRestoreWithCtx(ctx as never, {
        epoch: 3,
        idempotencyKey: "hourly:3",
        source: "hourly",
        storeId: "store-1",
      }),
    ).resolves.toEqual({ epoch: 3, kind: "failed" });
    expect(calls).toHaveLength(2);
    expect(calls[1]?.args).toMatchObject({
      epoch: 3,
      idempotencyKey: "hourly:3",
      source: "hourly",
      storeId: "store-1",
    });
  });
});
