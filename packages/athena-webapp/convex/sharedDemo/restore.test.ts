import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import {
  applyRestoreLeaseWithCtx,
  beginRestoreLeaseWithCtx,
  assertSharedDemoWriteEpoch,
  beginRestore,
  completeRestoreLeaseWithCtx,
  completeRestore,
  failRestoreLeaseWithCtx,
  requireCurrentSharedDemoBaseline,
  requireReadySharedDemoWriteWithCtx,
  SHARED_DEMO_BASELINE,
  SHARED_DEMO_RESTORE_FAILURE_CODE,
} from "./restore";

describe("shared demo restore", () => {
  it("starts an idempotent restore lease and serializes overlap", () => {
    const initial = { baselineVersion: 1, epoch: 4, status: "ready" as const };
    const first = beginRestore(initial, { idempotencyKey: "hour-1", now: 100 });
    expect(first).toMatchObject({
      kind: "started",
      state: { epoch: 5, status: "restoring" },
    });
    expect(
      beginRestore(first.state, { idempotencyKey: "hour-1", now: 101 }),
    ).toMatchObject({ kind: "existing", epoch: 5 });
    expect(
      beginRestore(first.state, { idempotencyKey: "manual-1", now: 101 }),
    ).toMatchObject({ kind: "busy", epoch: 5 });
  });

  it("requires provisioning to own every baseline version migration", () => {
    expect(() => requireCurrentSharedDemoBaseline(null)).toThrow(
      "requires provisioning",
    );
    expect(() =>
      requireCurrentSharedDemoBaseline({
        baselineVersion: 1,
        epoch: 2,
        status: "ready",
      }),
    ).toThrow("requires provisioning");
    expect(
      requireCurrentSharedDemoBaseline({
        baselineVersion: SHARED_DEMO_BASELINE.version,
        epoch: 3,
        status: "ready",
      }),
    ).toMatchObject({ epoch: 3 });
  });

  it("requires the same ready epoch in the business-write transaction", () => {
    const ready = { baselineVersion: 1, epoch: 8, status: "ready" as const };
    expect(assertSharedDemoWriteEpoch(ready, 8)).toBe(ready);
    expect(() =>
      assertSharedDemoWriteEpoch({ ...ready, status: "restoring" }, 8),
    ).toThrow();
    expect(() => assertSharedDemoWriteEpoch(ready, 7)).toThrow();
  });

  it.each(["restoring", "failed"] as const)(
    "rejects %s state when an existing workflow reads the fence without a client epoch",
    async (status) => {
      const ctx = {
        db: {
          query: () => ({
            withIndex: () => ({
              unique: async () => ({ baselineVersion: 1, epoch: 8, status }),
            }),
          }),
        },
      } as never;
      await expect(
        requireReadySharedDemoWriteWithCtx(ctx, { storeId: "store" as never }),
      ).rejects.toThrow("The demo is being restored");
    },
  );

  it("publishes ready only after baseline invariants match", () => {
    const restoring = beginRestore(
      { baselineVersion: 1, epoch: 1, status: "ready" as const },
      { idempotencyKey: "x", now: 10 },
    );
    if (restoring.kind !== "started") throw new Error("expected restore");
    expect(() =>
      completeRestore(restoring.state, {
        actualCounts: {},
        expectedCounts: { pos: 1 },
        now: 20,
      }),
    ).toThrow("Demo baseline verification failed.");
    expect(
      completeRestore(restoring.state, {
        actualCounts: SHARED_DEMO_BASELINE.expectedCounts,
        expectedCounts: SHARED_DEMO_BASELINE.expectedCounts,
        now: 20,
      }),
    ).toMatchObject({ status: "ready", completedAt: 20 });
  });

  it("persists the restoring lease before apply and records a stable failure", async () => {
    const state = {
      _id: "restore-state",
      baselineVersion: SHARED_DEMO_BASELINE.version,
      completedAt: 50,
      epoch: 4,
      status: "ready" as const,
      storeId: "store",
    };
    const audits: Array<Record<string, unknown>> = [];
    const schedules: Array<Record<string, unknown>> = [];
    const ctx = restoreStateContext(state, audits, schedules);

    const begun = await beginRestoreLeaseWithCtx(ctx as never, {
      idempotencyKey: "manual-restore-1",
      now: 100,
      source: "manual",
      storeId: "store" as never,
    });
    expect(begun).toEqual({
      baselineVersion: SHARED_DEMO_BASELINE.version,
      epoch: 5,
      kind: "started",
    });
    expect(state).toMatchObject({
      completedAt: undefined,
      epoch: 5,
      idempotencyKey: "manual-restore-1",
      status: "restoring",
    });
    expect(schedules).toHaveLength(1);
    await beginRestoreLeaseWithCtx(ctx as never, {
      idempotencyKey: "manual-restore-1",
      now: 101,
      source: "manual",
      storeId: "store" as never,
    });
    expect(schedules).toHaveLength(2);

    await expect(
      completeRestoreLeaseWithCtx(ctx as never, {
        appliedAt: 101,
        epoch: 5,
        idempotencyKey: "manual-restore-1",
        source: "manual",
        storeId: "store" as never,
      }),
    ).rejects.toThrow("has not been applied");

    await expect(
      failRestoreLeaseWithCtx(ctx as never, {
        epoch: 5,
        idempotencyKey: "manual-restore-1",
        now: 102,
        source: "manual",
        storeId: "store" as never,
      }),
    ).resolves.toEqual({ kind: "failed" });
    expect(state).toMatchObject({
      failureCode: SHARED_DEMO_RESTORE_FAILURE_CODE,
      status: "failed",
    });
    expect(audits).toContainEqual(
      expect.objectContaining({ epoch: 5, outcome: "failed" }),
    );
  });

  it("returns the stable apply receipt to duplicate coordinators", async () => {
    const state = {
      _id: "restore-state",
      appliedAt: 101,
      baselineVersion: SHARED_DEMO_BASELINE.version,
      epoch: 5,
      idempotencyKey: "manual-restore-1",
      phase: "applied" as const,
      restoredDocuments: 42,
      status: "restoring" as const,
      storeId: "store",
    };
    const ctx = restoreStateContext(state, []);
    await expect(applyRestoreLeaseWithCtx(ctx as never, {
      epoch: 5,
      idempotencyKey: "manual-restore-1",
      source: "manual",
      storeId: "store" as never,
    })).resolves.toEqual({ appliedAt: 101, restoredDocuments: 42 });
  });

  it("processes terminal cleanup appended after domain apply before ready", async () => {
    const state = {
      _id: "restore-state",
      appliedAt: 101,
      baselineVersion: SHARED_DEMO_BASELINE.version,
      cleanupTerminalIds: ["terminal-1"],
      epoch: 5,
      idempotencyKey: "manual-restore-1",
      phase: "applied" as const,
      restoredDocuments: 42,
      status: "restoring" as const,
      storeId: "store",
    };
    const deleted: string[] = [];
    const ctx = {
      db: {
        delete: async (_tableName: string, id: string) => deleted.push(id),
        get: async () => ({ _id: "terminal-1", storeId: "store" }),
        patch: async (_tableName: string, _id: string, value: Record<string, unknown>) => Object.assign(state, value),
        query: (tableName: string) => ({
          withIndex: () => tableName === "sharedDemoRestoreState"
            ? { unique: async () => state }
            : { take: async () => [] },
        }),
      },
    };
    await expect(applyRestoreLeaseWithCtx(ctx as never, {
      epoch: 5,
      idempotencyKey: "manual-restore-1",
      source: "manual",
      storeId: "store" as never,
    })).resolves.toEqual({ appliedAt: 101, restoredDocuments: 42 });
    expect(deleted).toEqual(["terminal-1"]);
    expect(state.cleanupTerminalIds).toBeUndefined();
  });

  it("does not publish ready while terminal cleanup remains pending", async () => {
    const state = {
      _id: "restore-state",
      appliedAt: 101,
      baselineVersion: SHARED_DEMO_BASELINE.version,
      cleanupTerminalIds: ["terminal-1"],
      epoch: 5,
      idempotencyKey: "manual-restore-1",
      phase: "applied" as const,
      restoredDocuments: 42,
      status: "restoring" as const,
      storeId: "store",
    };
    await expect(completeRestoreLeaseWithCtx(
      restoreStateContext(state, []) as never,
      {
        appliedAt: 101,
        epoch: 5,
        idempotencyKey: "manual-restore-1",
        source: "manual",
        storeId: "store" as never,
      },
    )).rejects.toThrow("has not been applied");
    expect(state.status).toBe("restoring");
  });

  it("does not let a stale coordinator fail a newer restore epoch", async () => {
    const state = {
      _id: "restore-state",
      baselineVersion: SHARED_DEMO_BASELINE.version,
      epoch: 6,
      idempotencyKey: "newer-restore",
      status: "restoring" as const,
      storeId: "store",
    };
    const audits: Array<Record<string, unknown>> = [];
    const ctx = restoreStateContext(state, audits);
    await expect(
      failRestoreLeaseWithCtx(ctx as never, {
        epoch: 5,
        idempotencyKey: "older-restore",
        source: "hourly",
        storeId: "store" as never,
      }),
    ).resolves.toEqual({ kind: "stale" });
    expect(state.status).toBe("restoring");
    expect(audits).toEqual([]);
  });

  it("keeps domain apply atomic and moves failure persistence to the coordinator", () => {
    const source = readFileSync("convex/sharedDemo/restore.ts", "utf8");
    const domainRestoreIndex = source.indexOf(
      "restoreMutableDemoStoreRowsWithCtx(",
    );
    const openingRollIndex = source.indexOf(
      "rollSharedDemoOpeningBaselineWithCtx(ctx",
    );
    expect(source).toContain("actualCounts: domainRestore.actualCounts");
    expect(source).toContain("expectedCounts: domainRestore.expectedCounts");
    expect(domainRestoreIndex).toBeGreaterThan(-1);
    expect(openingRollIndex).toBeGreaterThan(domainRestoreIndex);
    expect(source).toContain("export async function beginRestoreLeaseWithCtx");
    expect(source).toContain("export async function applyRestoreLeaseWithCtx");
    expect(source).toContain("export async function failRestoreLeaseWithCtx");
    expect(source).toContain("failureCode: SHARED_DEMO_RESTORE_FAILURE_CODE");
    expect(source).toContain('outcome: "failed"');
    expect(source).not.toContain("} catch {");
    expect(source).not.toContain('await import("../_generated/api")');
    expect(source).toContain("phase: \"applied\"");
    expect(source).not.toContain("materializeActiveReportsWorkspaceForStore");
  });
});

function restoreStateContext(
  state: Record<string, unknown>,
  audits: Array<Record<string, unknown>>,
  schedules: Array<Record<string, unknown>> = [],
) {
  return {
    db: {
      insert: async (tableName: string, value: Record<string, unknown>) => {
        if (tableName === "sharedDemoRestoreAudit") audits.push(value);
        return `${tableName}-id`;
      },
      patch: async (
        tableName: string,
        _id: string,
        value: Record<string, unknown>,
      ) => {
        if (tableName === "sharedDemoRestoreState") Object.assign(state, value);
      },
      query: () => ({
        withIndex: () => ({ unique: async () => state }),
      }),
    },
    scheduler: {
      runAfter: async (
        _delay: number,
        _reference: unknown,
        args: Record<string, unknown>,
      ) => {
        schedules.push(args);
      },
    },
  };
}
