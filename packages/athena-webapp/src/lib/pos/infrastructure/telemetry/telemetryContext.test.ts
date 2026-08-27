import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  beginPosTerminalIdentityTransition,
  capturePosTelemetryOccurrenceContext,
  clearPosTelemetryContextForTests,
  markPosTerminalIdentityUncoordinated,
  POS_TERMINAL_IDENTITY_CHANGE_EVENT,
  POS_TERMINAL_IDENTITY_GENERATION_STORAGE_KEY,
  POS_TERMINAL_IDENTITY_UNCOORDINATED_QUIESCENCE_MS,
  readPosTerminalIdentityTransition,
  registerPosTelemetryContext,
  settlePosTerminalIdentityTransition,
  signalPosTerminalIdentityChange,
  POS_TERMINAL_IDENTITY_LOCK_WAIT_MS,
  withPosTerminalIdentityWriteLock,
} from "./telemetryContext";

describe("pos telemetry occurrence context", () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    vi.mocked(window.localStorage.getItem).mockImplementation(
      (key) => values.get(key) ?? null,
    );
    vi.mocked(window.localStorage.setItem).mockImplementation(
      (key, value) => void values.set(key, value),
    );
    vi.mocked(window.localStorage.removeItem).mockImplementation(
      (key) => void values.delete(key),
    );
    vi.mocked(window.localStorage.clear).mockImplementation(() =>
      values.clear(),
    );
    clearPosTelemetryContextForTests();
  });

  it("fails closed when an exclusive identity lock cannot be acquired in time", async () => {
    vi.useFakeTimers();
    const previousLocks = navigator.locks;
    Object.defineProperty(navigator, "locks", {
      configurable: true,
      value: {
        request: vi.fn(
          async (
            _name: string,
            options: { signal?: AbortSignal },
          ): Promise<never> =>
            await new Promise((_, reject) => {
              options.signal?.addEventListener("abort", () =>
                reject(new DOMException("aborted", "AbortError")),
              );
            }),
        ),
      },
    });
    try {
      const result = withPosTerminalIdentityWriteLock(async () => "unused");
      await vi.advanceTimersByTimeAsync(POS_TERMINAL_IDENTITY_LOCK_WAIT_MS);
      await expect(result).resolves.toEqual({ acquired: false });
    } finally {
      Object.defineProperty(navigator, "locks", {
        configurable: true,
        value: previousLocks,
      });
      vi.useRealTimers();
    }
  });

  it("maps dynamic POS paths to closed route ids and strips query state", () => {
    expect(
      capturePosTelemetryOccurrenceContext(
        "/acme/store/central/pos/transactions/txn-customer-secret?receipt=secret#x",
      ),
    ).toEqual({
      orgUrlSlug: "acme",
      storeUrlSlug: "central",
      routeId: "transaction_detail",
      occurrenceContextToken: expect.stringMatching(/^pos-bootstrap-/),
      terminalIdentityGeneration: expect.stringMatching(/^pos-identity-/),
    });
  });

  it("attaches authorized context only to the exact route pair", () => {
    registerPosTelemetryContext("owner-a", {
      orgUrlSlug: "acme",
      storeUrlSlug: "central",
      storeId: "store-1",
      reportedCloudTerminalId: "terminal-1",
      reportedTerminalFingerprint: "fp-1",
    });

    expect(
      capturePosTelemetryOccurrenceContext("/acme/store/central/pos/register"),
    ).toMatchObject({
      storeId: "store-1",
      reportedCloudTerminalId: "terminal-1",
      reportedTerminalFingerprint: "fp-1",
    });
    expect(
      capturePosTelemetryOccurrenceContext("/acme/store/other/pos/register"),
    ).not.toHaveProperty("storeId");
  });

  it("does not let stale cleanup clear a newer owner", () => {
    const clearA = registerPosTelemetryContext("owner-a", {
      orgUrlSlug: "acme",
      storeUrlSlug: "central",
      storeId: "store-1",
    });
    registerPosTelemetryContext("owner-b", {
      orgUrlSlug: "acme",
      storeUrlSlug: "central",
      storeId: "store-2",
    });
    clearA();

    expect(
      capturePosTelemetryOccurrenceContext("/acme/store/central/pos"),
    ).toMatchObject({ storeId: "store-2" });
  });

  it("rejects transition records that predate the lease contract", () => {
    window.localStorage.setItem(
      POS_TERMINAL_IDENTITY_GENERATION_STORAGE_KEY,
      JSON.stringify({
        generation: "pos-identity-pre-lease-transition",
        phase: "changing",
      }),
    );

    expect(
      readPosTerminalIdentityTransition({ forceSharedRead: true }).generation,
    ).not.toBe("pos-identity-pre-lease-transition");
  });

  it("reconciles transient storage failures and later adopts a newer other-tab transition", () => {
    let stored = JSON.stringify(
      readPosTerminalIdentityTransition({ forceSharedRead: true }),
    );
    let denyReads = true;
    let denyWrites = true;
    const getItem = vi
      .spyOn(window.localStorage, "getItem")
      .mockImplementation((key) => {
        if (key !== POS_TERMINAL_IDENTITY_GENERATION_STORAGE_KEY) return null;
        if (denyReads) throw new Error("storage read denied");
        return stored;
      });
    const setItem = vi
      .spyOn(window.localStorage, "setItem")
      .mockImplementation((key, value) => {
        if (
          key === POS_TERMINAL_IDENTITY_GENERATION_STORAGE_KEY &&
          denyWrites
        ) {
          throw new Error("storage denied");
        }
        if (key === POS_TERMINAL_IDENTITY_GENERATION_STORAGE_KEY)
          stored = value;
      });
    const transitions: Array<{
      generation: string;
      phase: string;
      revision: number;
    }> = [];
    const listener = (event: Event) => {
      transitions.push(
        (
          event as CustomEvent<{
            generation: string;
            phase: string;
            revision: number;
          }>
        ).detail,
      );
    };
    window.addEventListener(POS_TERMINAL_IDENTITY_CHANGE_EVENT, listener);
    try {
      signalPosTerminalIdentityChange("changing");
      signalPosTerminalIdentityChange("changed");
      signalPosTerminalIdentityChange("changing");
      signalPosTerminalIdentityChange("changing");
      expect(transitions).toHaveLength(3);
      const highestPrivateRevision = transitions.at(-1)?.revision ?? 0;

      denyReads = false;
      denyWrites = false;
      const recoveredLease = beginPosTerminalIdentityTransition();
      expect(recoveredLease).toBeDefined();
      if (!recoveredLease) throw new Error("expected recovered lease");
      expect(recoveredLease.revision).toBeLessThan(highestPrivateRevision);
      const recovered = settlePosTerminalIdentityTransition(recoveredLease);
      expect(recovered.generation).not.toBe(transitions[0].generation);
      expect(JSON.parse(stored)).toEqual(recovered);

      const otherTabTransition = {
        ...recovered,
        generation: "pos-identity-other-tab-generation",
        ownerDocumentId: "pos-bootstrap-other-tab-document",
        revision: recovered.revision + 1,
        startedAt: recovered.updatedAt + 1,
        updatedAt: recovered.updatedAt + 1,
      };
      stored = JSON.stringify(otherTabTransition);
      expect(
        readPosTerminalIdentityTransition({ forceSharedRead: true }),
      ).toEqual(otherTabTransition);
    } finally {
      window.removeEventListener(POS_TERMINAL_IDENTITY_CHANGE_EVENT, listener);
      getItem.mockRestore();
      setItem.mockRestore();
    }
  });

  it("keeps the durable changing lease recoverable when the changed write is denied", () => {
    let stored: string | null = null;
    let denyWrites = false;
    const getItem = vi
      .spyOn(window.localStorage, "getItem")
      .mockImplementation((key) =>
        key === POS_TERMINAL_IDENTITY_GENERATION_STORAGE_KEY ? stored : null,
      );
    const setItem = vi
      .spyOn(window.localStorage, "setItem")
      .mockImplementation((key, value) => {
        if (key !== POS_TERMINAL_IDENTITY_GENERATION_STORAGE_KEY) return;
        if (denyWrites) throw new Error("changed marker denied");
        stored = value;
      });
    try {
      signalPosTerminalIdentityChange("changing");
      const durableChanging = JSON.parse(stored ?? "null") as {
        generation: string;
        phase: string;
        revision: number;
      };
      expect(durableChanging.phase).toBe("changing");

      denyWrites = true;
      signalPosTerminalIdentityChange("changed");

      expect(JSON.parse(stored ?? "null")).toEqual(durableChanging);
      expect(readPosTerminalIdentityTransition()).toMatchObject({
        generation: durableChanging.generation,
        phase: "changing",
        revision: durableChanging.revision,
      });
    } finally {
      getItem.mockRestore();
      setItem.mockRestore();
    }
  });

  it("does not let an old writer settle over a recovered newer revision", () => {
    const oldLease = beginPosTerminalIdentityTransition();
    expect(oldLease).toBeDefined();
    if (!oldLease) throw new Error("expected old lease");

    const recovered = settlePosTerminalIdentityTransition(oldLease);
    expect(recovered.phase).toBe("changed");
    const newLease = beginPosTerminalIdentityTransition();
    expect(newLease).toBeDefined();
    if (!newLease) throw new Error("expected new lease");

    expect(settlePosTerminalIdentityTransition(oldLease)).toEqual(newLease);
    expect(
      readPosTerminalIdentityTransition({ forceSharedRead: true }),
    ).toEqual(newLease);
  });

  it("converges settled lockless documents without resetting quiescence and adopts later stabilization", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-27T12:00:00.000Z"));
    try {
      markPosTerminalIdentityUncoordinated("in_flight");
      const tabASettled = markPosTerminalIdentityUncoordinated("settled");

      vi.advanceTimersByTime(1_000);
      vi.resetModules();
      const tabB = await import("./telemetryContext");
      expect(
        tabB.readPosTerminalIdentityTransition({ forceSharedRead: true }),
      ).toEqual(tabASettled);
      tabB.markPosTerminalIdentityUncoordinated("in_flight");
      const durableWinner =
        tabB.markPosTerminalIdentityUncoordinated("settled");
      const originalSettledAt = durableWinner.uncoordinatedSettledAt;

      for (let index = 0; index < 3; index += 1) {
        expect(
          readPosTerminalIdentityTransition({ forceSharedRead: true }),
        ).toEqual(durableWinner);
        expect(
          tabB.readPosTerminalIdentityTransition({ forceSharedRead: true }),
        ).toEqual(durableWinner);
      }
      expect(durableWinner.uncoordinatedSettledAt).toBe(originalSettledAt);

      vi.advanceTimersByTime(
        POS_TERMINAL_IDENTITY_UNCOORDINATED_QUIESCENCE_MS + 1,
      );
      const stabilized = tabB.stabilizePosTerminalIdentityUncoordinated(
        tabB.readPosTerminalIdentityTransition({ forceSharedRead: true }),
      );
      expect(stabilized).toMatchObject({
        phase: "changed",
        revision: durableWinner.revision + 1,
      });
      expect(
        readPosTerminalIdentityTransition({ forceSharedRead: true }),
      ).toEqual(stabilized);
    } finally {
      vi.useRealTimers();
    }
  });
});
