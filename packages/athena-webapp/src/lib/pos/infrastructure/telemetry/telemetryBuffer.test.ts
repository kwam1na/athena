import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearPosClientTelemetryBuffer,
  enqueuePosClientEvent,
  normalizePosTelemetryError,
  peekPosClientEventBatch,
  posClientTelemetryBufferSize,
  removePosClientEvents,
} from "./telemetryBuffer";

describe("posClientTelemetryBuffer", () => {
  beforeEach(() => {
    window.localStorage.clear();
    clearPosClientTelemetryBuffer();
  });

  it("enqueues an event with normalized error detail", () => {
    enqueuePosClientEvent({
      level: "error",
      flow: "checkout",
      message: "Checkout failed",
      error: new Error("boom"),
      metadata: { attempt: 2 },
    });

    const [event] = peekPosClientEventBatch(10);
    expect(event).toBeDefined();
    expect(event.level).toBe("error");
    expect(event.flow).toBe("checkout");
    expect(event.message).toBe("Checkout failed");
    expect(event.errorName).toBe("Error");
    expect(event.errorMessage).toBe("boom");
    expect(event.errorStack).toContain("boom");
    expect(event.metadata).toEqual({ attempt: 2 });
    expect(event.clientEventId).toBeTruthy();
    expect(event.occurredAt).toBeGreaterThan(0);
  });

  it("persists the buffer to localStorage for reload durability", () => {
    // The global test setup replaces localStorage with a non-storing mock, so
    // assert on the write itself rather than reading back.
    const setItem = vi.spyOn(window.localStorage, "setItem");
    enqueuePosClientEvent({ level: "warn", message: "before reload" });
    const [key, payload] = setItem.mock.calls.at(-1) ?? [];
    expect(key).toBe("athena-pos-client-telemetry-v1");
    expect(payload).toContain("before reload");
    expect(posClientTelemetryBufferSize()).toBe(1);
  });

  it("caps the buffer as a ring, dropping the oldest events", () => {
    for (let index = 0; index < 205; index += 1) {
      enqueuePosClientEvent({ level: "warn", message: `event-${index}` });
    }
    expect(posClientTelemetryBufferSize()).toBe(200);
    const [oldest] = peekPosClientEventBatch(1);
    expect(oldest.message).toBe("event-5");
  });

  it("removes drained events by id and keeps the rest", () => {
    enqueuePosClientEvent({ level: "warn", message: "first" });
    enqueuePosClientEvent({ level: "warn", message: "second" });
    const [first] = peekPosClientEventBatch(1);
    removePosClientEvents([first.clientEventId]);
    const remaining = peekPosClientEventBatch(10);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].message).toBe("second");
  });

  it("drops non-primitive metadata values and truncates long strings", () => {
    enqueuePosClientEvent({
      level: "warn",
      message: "meta",
      metadata: {
        nested: { not: "allowed" },
        fine: true,
        long: "x".repeat(1000),
        infinite: Number.POSITIVE_INFINITY,
      },
    });
    const [event] = peekPosClientEventBatch(1);
    expect(event.metadata.nested).toBeUndefined();
    expect(event.metadata.infinite).toBeUndefined();
    expect(event.metadata.fine).toBe(true);
    expect((event.metadata.long as string).length).toBe(300);
  });

  it("falls back to memory when localStorage throws", () => {
    const setItem = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("quota exceeded");
      });
    try {
      enqueuePosClientEvent({ level: "error", message: "still captured" });
      expect(posClientTelemetryBufferSize()).toBe(1);
      expect(peekPosClientEventBatch(1)[0].message).toBe("still captured");
    } finally {
      setItem.mockRestore();
    }
  });

  it("normalizes non-Error thrown values", () => {
    expect(normalizePosTelemetryError("plain string")).toEqual({
      errorMessage: "plain string",
    });
    expect(normalizePosTelemetryError({ code: 500 })).toEqual({
      errorMessage: '{"code":500}',
    });
    expect(normalizePosTelemetryError(undefined)).toEqual({});
  });
});
