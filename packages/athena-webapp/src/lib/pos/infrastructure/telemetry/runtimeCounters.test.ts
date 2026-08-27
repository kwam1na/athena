import { beforeEach, describe, expect, it } from "vitest";

import {
  incrementPosRuntimeCounter,
  resetPosRuntimeCounters,
  setPosRuntimeCounter,
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

  it("sets bounded gauges and timestamps without inventing missing evidence", () => {
    setPosRuntimeCounter("telemetry.bufferDepth", 4.8);
    setPosRuntimeCounter("telemetry.lastAcceptedAt", 1_700_000_000_000);
    setPosRuntimeCounter("telemetry.invalid", Number.POSITIVE_INFINITY);

    expect(snapshotPosRuntimeCounters()).toEqual({
      "telemetry.bufferDepth": 4,
      "telemetry.lastAcceptedAt": 1_700_000_000_000,
    });
    expect(snapshotPosRuntimeCounters()).not.toHaveProperty(
      "telemetry.pendingScopeCount",
    );
  });
});
