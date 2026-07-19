import { beforeEach, describe, expect, it } from "vitest";

import {
  incrementPosRuntimeCounter,
  resetPosRuntimeCounters,
  snapshotPosRuntimeCounters,
} from "./runtimeCounters";

describe("posRuntimeCounters", () => {
  beforeEach(() => {
    resetPosRuntimeCounters();
  });

  it("accumulates per-name counts", () => {
    incrementPosRuntimeCounter("storageHealth.probeFailed");
    incrementPosRuntimeCounter("storageHealth.probeFailed");
    incrementPosRuntimeCounter("runtimeStatus.leaseWriteFailed");

    expect(snapshotPosRuntimeCounters()).toEqual({
      "storageHealth.probeFailed": 2,
      "runtimeStatus.leaseWriteFailed": 1,
    });
  });

  it("returns a detached snapshot", () => {
    incrementPosRuntimeCounter("a");
    const snapshot = snapshotPosRuntimeCounters();
    incrementPosRuntimeCounter("a");

    expect(snapshot).toEqual({ a: 1 });
    expect(snapshotPosRuntimeCounters()).toEqual({ a: 2 });
  });
});
