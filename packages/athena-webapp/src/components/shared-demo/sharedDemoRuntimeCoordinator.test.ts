import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  coordinateSharedDemoRuntime,
  observeSharedDemoRuntimeEpoch,
  resetSharedDemoRuntimeCoordinatorForTests,
} from "./sharedDemoRuntimeCoordinator";

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

describe("shared demo runtime coordinator", () => {
  beforeEach(resetSharedDemoRuntimeCoordinatorForTests);

  it("joins duplicate bootstrap work for the same store and epoch", async () => {
    const pending = deferred();
    const run = vi.fn(() => pending.promise);

    const first = coordinateSharedDemoRuntime("store-1", 4, run);
    const second = coordinateSharedDemoRuntime("store-1", 4, run);
    await Promise.resolve();
    expect(run).toHaveBeenCalledTimes(1);

    pending.resolve();
    await Promise.all([first, second]);
  });

  it("queues a newer epoch while allowing the active bootstrap to abort", async () => {
    const first = deferred();
    const order: string[] = [];
    const firstRun = coordinateSharedDemoRuntime(
      "store-1",
      4,
      async (assertCurrent) => {
        order.push("epoch-4-start");
        await first.promise;
        assertCurrent();
        order.push("epoch-4-end");
      },
    );
    await Promise.resolve();
    const secondRun = coordinateSharedDemoRuntime("store-1", 5, async () => {
      order.push("epoch-5");
    });

    expect(order).toEqual(["epoch-4-start"]);
    first.resolve();
    await expect(firstRun).rejects.toThrow("restore epoch changed");
    await expect(secondRun).resolves.toBeUndefined();
    expect(order).toEqual(["epoch-4-start", "epoch-5"]);
  });

  it("lets superseded bootstrap work abort before a stale side effect", async () => {
    const first = deferred();
    const staleSideEffect = vi.fn();
    const firstRun = coordinateSharedDemoRuntime(
      "store-1",
      4,
      async (assertCurrent) => {
        await first.promise;
        assertCurrent();
        staleSideEffect();
      },
    );
    const secondRun = coordinateSharedDemoRuntime(
      "store-1",
      5,
      async () => undefined,
    );

    first.resolve();
    await expect(firstRun).rejects.toThrow("restore epoch changed");
    await expect(secondRun).resolves.toBeUndefined();
    expect(staleSideEffect).not.toHaveBeenCalled();
  });

  it.each(["restoring", "failed"])(
    "invalidates an old ready job when a newer observed epoch is %s",
    async () => {
      const oldRead = deferred();
      const staleLocalMutation = vi.fn();
      const oldJob = coordinateSharedDemoRuntime(
        "store-1",
        4,
        async (assertCurrent) => {
          await oldRead.promise;
          assertCurrent();
          staleLocalMutation();
        },
      );
      await Promise.resolve();

      observeSharedDemoRuntimeEpoch("store-1", 5);
      oldRead.resolve();

      await expect(oldJob).rejects.toThrow("restore epoch changed");
      expect(staleLocalMutation).not.toHaveBeenCalled();
    },
  );

  it("queues ready work for an observed epoch behind the invalidated predecessor", async () => {
    const oldRead = deferred();
    const order: string[] = [];
    const oldJob = coordinateSharedDemoRuntime(
      "store-1",
      4,
      async (assertCurrent) => {
        order.push("old-start");
        await oldRead.promise;
        assertCurrent();
      },
    );
    await Promise.resolve();
    observeSharedDemoRuntimeEpoch("store-1", 5);
    const readyJob = coordinateSharedDemoRuntime("store-1", 5, async () => {
      order.push("new-ready");
    });

    expect(order).toEqual(["old-start"]);
    oldRead.resolve();
    await expect(oldJob).rejects.toThrow("restore epoch changed");
    await expect(readyJob).resolves.toBeUndefined();
    expect(order).toEqual(["old-start", "new-ready"]);
  });

  it("allows retry after a failed bootstrap", async () => {
    const failure = new Error("failed");
    await expect(
      coordinateSharedDemoRuntime("store-1", 4, async () => {
        throw failure;
      }),
    ).rejects.toThrow(failure);

    const retry = vi.fn(async () => undefined);
    await coordinateSharedDemoRuntime("store-1", 4, retry);
    expect(retry).toHaveBeenCalledTimes(1);
  });
});
