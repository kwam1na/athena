import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createPosLocalSyncScheduler,
  type PosLocalPendingEvent,
} from "./syncScheduler";

const baseEvent = (
  overrides: Partial<PosLocalPendingEvent>,
): PosLocalPendingEvent => ({
  id: "event-1",
  terminalId: "terminal-1",
  localRegisterSessionId: "local-drawer-1",
  createdAt: 1000,
  sequence: 1,
  ...overrides,
});

describe("syncScheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("collapses repeated triggers without concurrent sync runs", async () => {
    let releaseSync: (() => void) | undefined;
    const uploadBatch = vi.fn(
      () =>
        new Promise<{ syncedEventIds: string[] }>((resolve) => {
          releaseSync = () => resolve({ syncedEventIds: ["event-1"] });
        }),
    );
    const scheduler = createPosLocalSyncScheduler({
      loadPendingEvents: vi.fn().mockResolvedValue([baseEvent({})]),
      uploadBatch,
      markSynced: vi.fn().mockResolvedValue(undefined),
      isOnline: () => true,
    });

    scheduler.trigger("route-entry");
    await vi.runOnlyPendingTimersAsync();
    scheduler.trigger("event-appended");
    scheduler.trigger("online");

    expect(uploadBatch).toHaveBeenCalledTimes(1);
    releaseSync?.();
    await vi.runAllTimersAsync();

    expect(uploadBatch).toHaveBeenCalledTimes(2);
  });

  it("syncs pending events oldest-first in complete register-session batches", async () => {
    const markSynced = vi.fn().mockResolvedValue(undefined);
    const uploadBatch = vi
      .fn()
      .mockResolvedValueOnce({ syncedEventIds: ["older-1", "older-2"] })
      .mockResolvedValueOnce({ syncedEventIds: ["newer-1"] });
    const scheduler = createPosLocalSyncScheduler({
      loadPendingEvents: vi
        .fn()
        .mockResolvedValueOnce([
          baseEvent({
            id: "newer-1",
            localRegisterSessionId: "local-drawer-2",
            createdAt: 3000,
            sequence: 1,
          }),
          baseEvent({
            id: "older-2",
            createdAt: 2000,
            sequence: 2,
          }),
          baseEvent({
            id: "older-1",
            createdAt: 1000,
            sequence: 1,
          }),
        ])
        .mockResolvedValueOnce([
          baseEvent({
            id: "newer-1",
            localRegisterSessionId: "local-drawer-2",
            createdAt: 3000,
            sequence: 1,
          }),
        ]),
      uploadBatch,
      markSynced,
      isOnline: () => true,
      maxBatchSize: 10,
    });

    scheduler.trigger("route-entry");
    await vi.runAllTimersAsync();

    expect(
      uploadBatch.mock.calls[0]?.[0].map(
        (event: PosLocalPendingEvent) => event.id,
      ),
    ).toEqual(["older-1", "older-2"]);
    expect(
      uploadBatch.mock.calls[1]?.[0].map(
        (event: PosLocalPendingEvent) => event.id,
      ),
    ).toEqual(["newer-1"]);
    expect(markSynced).toHaveBeenNthCalledWith(1, ["older-1", "older-2"]);
    expect(markSynced).toHaveBeenNthCalledWith(2, ["newer-1"]);
  });

  it("keeps events pending after failure, applies backoff, and lets manual retry bypass it", async () => {
    const uploadBatch = vi
      .fn()
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce({ syncedEventIds: ["event-1"] });
    const scheduler = createPosLocalSyncScheduler({
      loadPendingEvents: vi.fn().mockResolvedValue([baseEvent({})]),
      uploadBatch,
      markSynced: vi.fn().mockResolvedValue(undefined),
      isOnline: () => true,
      now: () => 0,
      baseBackoffMs: 30_000,
    });

    scheduler.trigger("route-entry");
    await vi.runAllTimersAsync();

    expect(scheduler.getStatus()).toEqual(
      expect.objectContaining({
        lastFailure: "network down",
        backoffUntil: 30_000,
      }),
    );

    scheduler.trigger("event-appended");
    await vi.advanceTimersByTimeAsync(29_000);
    expect(uploadBatch).toHaveBeenCalledTimes(1);

    scheduler.trigger("manual-retry");
    await vi.runAllTimersAsync();

    expect(uploadBatch).toHaveBeenCalledTimes(2);
    expect(scheduler.getStatus().lastFailure).toBeNull();
  });

  it("treats mark-synced failures as sync failures with backoff", async () => {
    const markSynced = vi.fn().mockRejectedValue(new Error("local write failed"));
    const scheduler = createPosLocalSyncScheduler({
      loadPendingEvents: vi.fn().mockResolvedValue([baseEvent({})]),
      uploadBatch: vi.fn().mockResolvedValue({ syncedEventIds: ["event-1"] }),
      markSynced,
      isOnline: () => true,
      now: () => 0,
      baseBackoffMs: 30_000,
    });

    scheduler.trigger("route-entry");
    await vi.runAllTimersAsync();

    expect(markSynced).toHaveBeenCalledWith(["event-1"]);
    expect(scheduler.getStatus()).toEqual(
      expect.objectContaining({
        lastFailure: "local write failed",
        backoffUntil: 30_000,
      }),
    );
  });

  it("marks server-acknowledged conflicts for review before clearing synced events", async () => {
    const markNeedsReview = vi.fn().mockResolvedValue(undefined);
    const markSynced = vi.fn().mockResolvedValue(undefined);
    const scheduler = createPosLocalSyncScheduler({
      loadPendingEvents: vi.fn().mockResolvedValue([baseEvent({})]),
      uploadBatch: vi.fn().mockResolvedValue({
        reviewEventIds: ["event-conflicted"],
        syncedEventIds: ["event-1"],
      }),
      markNeedsReview,
      markSynced,
      isOnline: () => true,
    });

    scheduler.trigger("route-entry");
    await vi.runAllTimersAsync();

    expect(markNeedsReview).toHaveBeenCalledWith(["event-conflicted"]);
    expect(markSynced).toHaveBeenCalledWith(["event-1"]);
  });

  it("does not write empty synced batches", async () => {
    const markNeedsReview = vi.fn().mockResolvedValue(undefined);
    const markSynced = vi.fn().mockResolvedValue(undefined);
    const scheduler = createPosLocalSyncScheduler({
      loadPendingEvents: vi.fn().mockResolvedValue([baseEvent({})]),
      uploadBatch: vi.fn().mockResolvedValue({
        reviewEventIds: ["event-held"],
        syncedEventIds: [],
      }),
      markNeedsReview,
      markSynced,
      isOnline: () => true,
    });

    scheduler.trigger("route-entry");
    await vi.runAllTimersAsync();

    expect(markNeedsReview).toHaveBeenCalledWith(["event-held"]);
    expect(markSynced).not.toHaveBeenCalled();
  });

  it("keeps held events retryable with backoff instead of marking local state", async () => {
    const markNeedsReview = vi.fn().mockResolvedValue(undefined);
    const markSynced = vi.fn().mockResolvedValue(undefined);
    const scheduler = createPosLocalSyncScheduler({
      loadPendingEvents: vi.fn().mockResolvedValue([baseEvent({})]),
      uploadBatch: vi.fn().mockResolvedValue({
        heldEventIds: ["event-held"],
        syncedEventIds: [],
      }),
      markNeedsReview,
      markSynced,
      isOnline: () => true,
      now: () => 0,
      baseBackoffMs: 30_000,
    });

    scheduler.trigger("route-entry");
    await vi.runAllTimersAsync();

    expect(markNeedsReview).not.toHaveBeenCalled();
    expect(markSynced).not.toHaveBeenCalled();
    expect(scheduler.getStatus()).toEqual(
      expect.objectContaining({
        lastFailure: "Earlier POS history must sync before this event.",
        backoffUntil: 30_000,
      }),
    );
  });

  it("clears accepted history before backing off held events in mixed responses", async () => {
    const markNeedsReview = vi.fn().mockResolvedValue(undefined);
    const markSynced = vi.fn().mockResolvedValue(undefined);
    const scheduler = createPosLocalSyncScheduler({
      loadPendingEvents: vi.fn().mockResolvedValue([
        baseEvent({ id: "event-accepted", sequence: 1 }),
        baseEvent({ id: "event-held", sequence: 2 }),
      ]),
      uploadBatch: vi.fn().mockResolvedValue({
        heldEventIds: ["event-held"],
        syncedEventIds: ["event-accepted"],
      }),
      markNeedsReview,
      markSynced,
      isOnline: () => true,
      now: () => 0,
      baseBackoffMs: 30_000,
    });

    scheduler.trigger("route-entry");
    await vi.runAllTimersAsync();

    expect(markNeedsReview).not.toHaveBeenCalled();
    expect(markSynced).toHaveBeenCalledWith(["event-accepted"]);
    expect(scheduler.getStatus()).toEqual(
      expect.objectContaining({
        lastFailure: "Earlier POS history must sync before this event.",
        backoffUntil: 30_000,
      }),
    );
  });

  it("treats needs-review write failures as sync failures before clearing synced events", async () => {
    const markNeedsReview = vi
      .fn()
      .mockRejectedValue(new Error("review write failed"));
    const markSynced = vi.fn().mockResolvedValue(undefined);
    const scheduler = createPosLocalSyncScheduler({
      loadPendingEvents: vi.fn().mockResolvedValue([baseEvent({})]),
      uploadBatch: vi.fn().mockResolvedValue({
        reviewEventIds: ["event-conflicted"],
        syncedEventIds: ["event-1"],
      }),
      markNeedsReview,
      markSynced,
      isOnline: () => true,
      now: () => 0,
      baseBackoffMs: 30_000,
    });

    scheduler.trigger("route-entry");
    await vi.runAllTimersAsync();

    expect(markNeedsReview).toHaveBeenCalledWith(["event-conflicted"]);
    expect(markSynced).not.toHaveBeenCalled();
    expect(scheduler.getStatus()).toEqual(
      expect.objectContaining({
        lastFailure: "review write failed",
        backoffUntil: 30_000,
      }),
    );
  });

  it("registers online and visibility triggers for POS foreground sync", async () => {
    const uploadBatch = vi
      .fn()
      .mockResolvedValue({ syncedEventIds: ["event-1"] });
    const win = new EventTarget();
    const doc = new EventTarget() as Document;
    Object.defineProperty(doc, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    const scheduler = createPosLocalSyncScheduler({
      loadPendingEvents: vi.fn().mockResolvedValue([baseEvent({})]),
      uploadBatch,
      markSynced: vi.fn().mockResolvedValue(undefined),
      isOnline: () => true,
      windowTarget: win,
      documentTarget: doc,
    });

    const stop = scheduler.startForegroundTriggers();
    win.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(250);
    doc.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(250);
    stop();

    expect(uploadBatch).toHaveBeenCalledTimes(2);
  });

  it("does not upload while offline and waits for the online trigger", async () => {
    let online = false;
    const uploadBatch = vi
      .fn()
      .mockResolvedValue({ syncedEventIds: ["event-1"] });
    const scheduler = createPosLocalSyncScheduler({
      loadPendingEvents: vi.fn().mockResolvedValue([baseEvent({})]),
      uploadBatch,
      markSynced: vi.fn().mockResolvedValue(undefined),
      isOnline: () => online,
    });

    scheduler.trigger("route-entry");
    await vi.runAllTimersAsync();
    expect(uploadBatch).not.toHaveBeenCalled();

    online = true;
    scheduler.trigger("online");
    await vi.runAllTimersAsync();

    expect(uploadBatch).toHaveBeenCalledTimes(1);
  });

  it("ignores hidden-tab visibility changes", async () => {
    const uploadBatch = vi
      .fn()
      .mockResolvedValue({ syncedEventIds: ["event-1"] });
    const doc = new EventTarget() as Document;
    Object.defineProperty(doc, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    const scheduler = createPosLocalSyncScheduler({
      loadPendingEvents: vi.fn().mockResolvedValue([baseEvent({})]),
      uploadBatch,
      markSynced: vi.fn().mockResolvedValue(undefined),
      isOnline: () => true,
      documentTarget: doc,
      foregroundIntervalMs: 60_000,
    });

    const stop = scheduler.startForegroundTriggers();
    doc.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(250);
    stop();

    expect(uploadBatch).not.toHaveBeenCalled();
  });

  it("schedules closeout as an immediate high-priority sync trigger", async () => {
    const uploadBatch = vi
      .fn()
      .mockResolvedValue({ syncedEventIds: ["event-1"] });
    const scheduler = createPosLocalSyncScheduler({
      loadPendingEvents: vi.fn().mockResolvedValue([baseEvent({})]),
      uploadBatch,
      markSynced: vi.fn().mockResolvedValue(undefined),
      isOnline: () => true,
      debounceMs: 2_000,
    });

    scheduler.trigger("closeout", { priority: "high" });
    await vi.advanceTimersByTimeAsync(0);

    expect(uploadBatch).toHaveBeenCalledTimes(1);
  });
});
