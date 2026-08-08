import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  correlation: vi.fn(),
  enqueue: vi.fn(),
  recordClientEvents: vi.fn(),
}));

vi.mock("convex/react", () => ({
  useMutation: () => mocks.recordClientEvents,
}));

vi.mock("./telemetryBuffer", () => ({
  enqueuePosClientEvent: mocks.enqueue,
  peekPosClientEventBatch: () => [],
  removePosClientEvents: vi.fn(),
}));

vi.mock("./printAttemptTelemetry", () => ({
  getPrintRejectionMetadata: mocks.correlation,
}));

import { usePosClientTelemetryDrain } from "./usePosClientTelemetryDrain";

function dispatchUnhandledRejection(reason: unknown): void {
  const event = new Event("unhandledrejection");
  Object.defineProperty(event, "reason", { value: reason });
  window.dispatchEvent(event);
}

describe("usePosClientTelemetryDrain print rejection correlation", () => {
  beforeEach(() => {
    mocks.correlation.mockReset();
    mocks.enqueue.mockReset();
    mocks.recordClientEvents.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("attaches the helper snapshot to the existing rejection row", () => {
    const reason = new Error(
      "Failed to execute 'print' on 'Window': The provided callback is no longer runnable.",
    );
    mocks.correlation.mockReturnValue({
      printCorrelation: "matched",
      printAttemptId: "attempt-1",
    });
    renderHook(() =>
      usePosClientTelemetryDrain({ storeId: undefined, terminalId: undefined }),
    );

    dispatchUnhandledRejection(reason);

    expect(mocks.correlation).toHaveBeenCalledWith(reason);
    expect(mocks.enqueue).toHaveBeenCalledWith({
      level: "error",
      flow: "unhandled",
      message: "Unhandled promise rejection",
      error: reason,
      metadata: {
        printCorrelation: "matched",
        printAttemptId: "attempt-1",
      },
    });
  });

  it("leaves unrelated rejections on the existing generic path", () => {
    const reason = new Error("Unrelated failure");
    mocks.correlation.mockReturnValue(undefined);
    renderHook(() =>
      usePosClientTelemetryDrain({ storeId: undefined, terminalId: undefined }),
    );

    dispatchUnhandledRejection(reason);

    expect(mocks.enqueue).toHaveBeenCalledWith({
      level: "error",
      flow: "unhandled",
      message: "Unhandled promise rejection",
      error: reason,
      metadata: undefined,
    });
  });
});
