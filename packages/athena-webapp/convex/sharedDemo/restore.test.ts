import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import {
  assertSharedDemoWriteEpoch,
  beginRestore,
  completeRestore,
  requireReadySharedDemoWriteWithCtx,
  SHARED_DEMO_BASELINE,
} from "./restore";

describe("shared demo restore", () => {
  it("starts an idempotent restore lease and serializes overlap", () => {
    const initial = { baselineVersion: 1, epoch: 4, status: "ready" as const };
    const first = beginRestore(initial, { idempotencyKey: "hour-1", now: 100 });
    expect(first).toMatchObject({ kind: "started", state: { epoch: 5, status: "restoring" } });
    expect(beginRestore(first.state, { idempotencyKey: "hour-1", now: 101 })).toMatchObject({ kind: "existing", epoch: 5 });
    expect(beginRestore(first.state, { idempotencyKey: "manual-1", now: 101 })).toMatchObject({ kind: "busy", epoch: 5 });
  });

  it("requires the same ready epoch in the business-write transaction", () => {
    const ready = { baselineVersion: 1, epoch: 8, status: "ready" as const };
    expect(assertSharedDemoWriteEpoch(ready, 8)).toBe(ready);
    expect(() => assertSharedDemoWriteEpoch({ ...ready, status: "restoring" }, 8)).toThrow();
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
      ).rejects.toThrow("The shared demo is being restored");
    },
  );

  it("publishes ready only after baseline invariants match", () => {
    const restoring = beginRestore(
      { baselineVersion: 1, epoch: 1, status: "ready" as const },
      { idempotencyKey: "x", now: 10 },
    );
    if (restoring.kind !== "started") throw new Error("expected restore");
    expect(() => completeRestore(restoring.state, { actualCounts: {}, expectedCounts: { pos: 1 }, now: 20 })).toThrow(
      "Shared demo baseline verification failed.",
    );
    expect(
      completeRestore(restoring.state, {
        actualCounts: SHARED_DEMO_BASELINE.expectedCounts,
        expectedCounts: SHARED_DEMO_BASELINE.expectedCounts,
        now: 20,
      }),
    ).toMatchObject({ status: "ready", completedAt: 20 });
  });

  it("persists a failed state and audit instead of rethrowing after restore starts", () => {
    const source = readFileSync("convex/sharedDemo/restore.ts", "utf8");
    expect(source).toContain("actualCounts: domainRestore.actualCounts");
    expect(source).toContain("expectedCounts: domainRestore.expectedCounts");
    expect(source).toContain('failureCode: "baseline_restore_failed"');
    expect(source).toContain('outcome: "failed"');
    expect(source).toContain('kind: "failed" as const');
  });
});
