import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  coordinateSharedDemoRuntime,
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

  it("queues a newer epoch behind the active bootstrap", async () => {
    const first = deferred();
    const order: string[] = [];
    const firstRun = coordinateSharedDemoRuntime("store-1", 4, async () => {
      order.push("epoch-4-start");
      await first.promise;
      order.push("epoch-4-end");
    });
    const secondRun = coordinateSharedDemoRuntime("store-1", 5, async () => {
      order.push("epoch-5");
    });

    await Promise.resolve();
    expect(order).toEqual(["epoch-4-start"]);
    first.resolve();
    await Promise.all([firstRun, secondRun]);
    expect(order).toEqual(["epoch-4-start", "epoch-4-end", "epoch-5"]);
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
