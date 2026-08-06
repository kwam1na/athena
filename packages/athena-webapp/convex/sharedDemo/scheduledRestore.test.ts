import { describe, expect, it, vi } from "vitest";

import {
  continueRestoreWithCtx,
  runDailyRestoreWithCtx,
  runHourlyProvisionHealWithCtx,
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
    await expect(runDailyRestoreWithCtx(ctx as never, {
      ATHENA_SHARED_DEMO_ENABLED: "true",
      ATHENA_SHARED_DEMO_STORE_ID: "store-1",
      STAGE: "qa",
    })).resolves.toMatchObject({ epoch: 1, kind: "started" });
    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual(expect.objectContaining({ now: expect.any(Number) }));
    expect(calls[1]).toEqual(expect.objectContaining({ source: "daily", storeId: "store-1" }));
  });

  it("heals the baseline version without beginning a restore lease", async () => {
    // The whole point of the separate hourly job: it repairs the row admission
    // gates on, and touches nothing a visitor did. A second mutation here
    // would mean it was restoring — mid-day — which the daily cadence exists
    // to prevent.
    const calls: Array<Record<string, unknown>> = [];
    const ctx = {
      runMutation: async (_reference: unknown, args: Record<string, unknown>) => {
        calls.push(args);
        return { kind: "migrated", storeId: "store-1" };
      },
    };

    await expect(
      runHourlyProvisionHealWithCtx(ctx as never, {
        ATHENA_SHARED_DEMO_ENABLED: "true",
        ATHENA_SHARED_DEMO_STORE_ID: "store-1",
        STAGE: "qa",
      }),
    ).resolves.toEqual({ kind: "provisioned", storeId: "store-1" });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual(expect.objectContaining({ now: expect.any(Number) }));
    // No lease, so no idempotency key and no source.
    expect(calls[0]).not.toHaveProperty("idempotencyKey");
    expect(calls[0]).not.toHaveProperty("source");
  });

  it("refuses to heal a store other than the configured one", async () => {
    const ctx = {
      runMutation: async () => ({ kind: "created", storeId: "store-2" }),
    };

    await expect(
      runHourlyProvisionHealWithCtx(ctx as never, {
        ATHENA_SHARED_DEMO_ENABLED: "true",
        ATHENA_SHARED_DEMO_STORE_ID: "store-1",
        STAGE: "qa",
      }),
    ).rejects.toThrow("does not match provisioning");
  });

  it("stays disabled when the demo is off, healing nothing", async () => {
    const calls: unknown[] = [];
    const ctx = {
      runMutation: async (reference: unknown) => {
        calls.push(reference);
        return {};
      },
    };

    await expect(
      runHourlyProvisionHealWithCtx(ctx as never, { STAGE: "qa" }),
    ).resolves.toEqual({ kind: "disabled" });
    expect(calls).toHaveLength(0);
  });

  it("buckets the idempotency key by day, so a retry cannot restore twice", async () => {
    // The bucket has to be exactly one reset cycle wide. An hour-wide bucket
    // under a daily cron would let a retried firing restore the baseline a
    // second time, mid-day, on top of a visitor's session.
    async function keyAt(now: number) {
      const calls: Array<Record<string, unknown>> = [];
      const ctx = {
        runMutation: async (
          _reference: unknown,
          args: Record<string, unknown>,
        ) => {
          calls.push(args);
          return calls.length === 1
            ? { kind: "bootstrapped", storeId: "store-1" }
            : { baselineVersion: 6, epoch: 1, kind: "started" };
        },
      };
      vi.spyOn(Date, "now").mockReturnValue(now);
      try {
        await runDailyRestoreWithCtx(ctx as never, {
          ATHENA_SHARED_DEMO_ENABLED: "true",
          ATHENA_SHARED_DEMO_STORE_ID: "store-1",
          STAGE: "qa",
        });
      } finally {
        vi.restoreAllMocks();
      }
      return calls[1]?.idempotencyKey;
    }

    const midnight = Date.UTC(2026, 7, 5, 0, 0, 0);
    expect(await keyAt(midnight)).toBe("daily:20670");
    // An hour later is the SAME day, so a retry dedupes.
    expect(await keyAt(midnight + 3_600_000)).toBe("daily:20670");
    // Late the same day still dedupes; the next midnight does not.
    expect(await keyAt(midnight + 23 * 3_600_000)).toBe("daily:20670");
    expect(await keyAt(midnight + 86_400_000)).toBe("daily:20671");
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
        idempotencyKey: "daily:3",
        source: "daily",
        storeId: "store-1",
      }),
    ).resolves.toEqual({ epoch: 3, kind: "failed" });
    expect(calls).toHaveLength(2);
    expect(calls[1]?.args).toMatchObject({
      epoch: 3,
      idempotencyKey: "daily:3",
      source: "daily",
      storeId: "store-1",
    });
  });
});
