import { describe, expect, it, vi } from "vitest";

import { createUpdateDetectionSequencer } from "./updateDetectionSequencer";
import type { UpdateStagingDiagnostics } from "./updateCoordinator";

function createDeferredStatus() {
  let resolve!: (status: UpdateStagingDiagnostics) => void;
  const promise = new Promise<UpdateStagingDiagnostics>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}

describe("updateDetectionSequencer", () => {
  it("ignores stale staging completions after a newer detection reports", async () => {
    const first = createDeferredStatus();
    const second = createDeferredStatus();
    const report = vi.fn();
    const stage = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const sequencer = createUpdateDetectionSequencer({ report, stage });

    const firstHandle = sequencer.handle({ pendingBuildId: "build-a" });
    const secondHandle = sequencer.handle({ pendingBuildId: "build-b" });

    second.resolve({ status: "staged" });
    await secondHandle;
    first.resolve({
      reason: "service-worker-timeout",
      status: "unstaged",
    });
    await firstHandle;

    expect(report).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith(
      { pendingBuildId: "build-b" },
      { status: "staged" },
    );
  });

  it("does not report after the sequencer stops", async () => {
    const deferred = createDeferredStatus();
    const report = vi.fn();
    const sequencer = createUpdateDetectionSequencer({
      report,
      stage: () => deferred.promise,
    });

    const handle = sequencer.handle({ pendingBuildId: "build-a" });
    sequencer.stop();
    deferred.resolve({ status: "staged" });
    await handle;

    expect(report).not.toHaveBeenCalled();
  });
});
