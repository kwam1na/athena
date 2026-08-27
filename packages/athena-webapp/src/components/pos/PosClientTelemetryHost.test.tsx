import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearPosClientTelemetryBuffer,
  enqueuePosClientEvent,
  peekPosClientEventBatch,
} from "@/lib/pos/infrastructure/telemetry/telemetryBuffer";
import {
  clearPosTelemetryContextForTests,
  markPosTerminalIdentityUncoordinated,
  POS_TERMINAL_IDENTITY_GENERATION_STORAGE_KEY,
  POS_TERMINAL_IDENTITY_REFRESH_REQUEST_EVENT,
  POS_TERMINAL_IDENTITY_TRANSITION_LEASE_MS,
  POS_TERMINAL_IDENTITY_UNCOORDINATED_QUIESCENCE_MS,
  readPosTerminalIdentityTransition,
  rotatePosTerminalIdentityGeneration,
  signalPosTerminalIdentityChange,
} from "@/lib/pos/infrastructure/telemetry/telemetryContext";
import { FINGERPRINT_STORAGE_KEY } from "@/lib/constants";
import {
  resetPosRuntimeCounters,
  snapshotPosRuntimeCounters,
} from "@/lib/pos/infrastructure/telemetry/runtimeCounters";
import { selectOldestEligiblePosTelemetryScope } from "@/lib/pos/infrastructure/telemetry/usePosClientTelemetryDrain";

const mocks = vi.hoisted(() => ({
  activeStore: { _id: "store-1" } as { _id: string } | undefined,
  fingerprint: "fingerprint-1" as string | null,
  readSeed: vi.fn(),
  allowIdentityLock: false,
  useDrain: vi.fn(),
}));

vi.mock("@/hooks/useGetActiveStore", () => ({
  default: () => ({ activeStore: mocks.activeStore }),
}));
vi.mock("@/lib/pos/infrastructure/local/posLocalStorageRuntime", () => ({
  getDefaultPosLocalStore: () => ({
    readProvisionedTerminalSeed: mocks.readSeed,
  }),
}));
vi.mock("@/lib/pos/infrastructure/terminal/fingerprint", () => ({
  readStoredTerminalFingerprintHash: () => mocks.fingerprint,
}));
vi.mock(
  "@/lib/pos/infrastructure/telemetry/usePosClientTelemetryDrain",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("@/lib/pos/infrastructure/telemetry/usePosClientTelemetryDrain")
    >()),
    usePosClientTelemetryDrain: mocks.useDrain,
  }),
);

import { PosClientTelemetryHost } from "./PosClientTelemetryHost";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

describe("PosClientTelemetryHost occurrence scope", () => {
  let storage: ReturnType<typeof installMemoryStorage>;
  let originalLocks: PropertyDescriptor | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState({}, "", "/acme/store/central/pos/register");
    window.localStorage.clear();
    clearPosTelemetryContextForTests();
    clearPosClientTelemetryBuffer();
    resetPosRuntimeCounters();
    storage = installMemoryStorage();
    originalLocks = Object.getOwnPropertyDescriptor(navigator, "locks");
    Object.defineProperty(navigator, "locks", {
      configurable: true,
      value: {
        request: async (
          _name: string,
          _options: LockOptions,
          callback: (lock: Lock) => Promise<unknown>,
        ) => {
          if (!mocks.allowIdentityLock) throw new Error("lock unavailable");
          return callback({ name: _name, mode: "exclusive" } as Lock);
        },
      },
    });
    mocks.activeStore = { _id: "store-1" };
    mocks.fingerprint = "fingerprint-1";
    mocks.allowIdentityLock = false;
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
    clearPosTelemetryContextForTests();
    storage.restore();
    if (originalLocks) Object.defineProperty(navigator, "locks", originalLocks);
    else Reflect.deleteProperty(navigator, "locks");
  });

  it("resolves a pending event with the authorized store and matching terminal identity", async () => {
    const seed = deferred<{
      ok: true;
      value: {
        cloudTerminalId: string;
        storeId: string;
        telemetryIdentityEpoch: string;
      };
    }>();
    mocks.readSeed.mockReturnValueOnce(seed.promise);
    render(<PosClientTelemetryHost />);

    expect(mocks.useDrain).toHaveBeenLastCalledWith({ identityReady: false });

    enqueuePosClientEvent({
      classification: "unexpected_application_error",
      level: "error",
    });
    expect(peekPosClientEventBatch(1)[0]).toMatchObject({ storeId: "store-1" });
    expect(peekPosClientEventBatch(1)[0]).not.toHaveProperty(
      "reportedCloudTerminalId",
    );

    await act(async () => {
      seed.resolve({
        ok: true,
        value: {
          cloudTerminalId: "terminal-1",
          storeId: "store-1",
          telemetryIdentityEpoch: "epoch-1",
        },
      });
      await seed.promise;
    });

    await waitFor(() =>
      expect(peekPosClientEventBatch(1)[0]).toMatchObject({
        storeId: "store-1",
        telemetryIdentityEpoch: "epoch-1",
        reportedCloudTerminalId: "terminal-1",
        reportedTerminalFingerprint: "fingerprint-1",
      }),
    );
    expect(mocks.useDrain).toHaveBeenLastCalledWith({ identityReady: true });
  });

  it("claims a tokenless bootstrap event after the matching host mounts", async () => {
    enqueuePosClientEvent({
      classification: "unexpected_application_error",
      level: "error",
    });
    expect(peekPosClientEventBatch(1)[0]).not.toHaveProperty("storeId");
    expect(peekPosClientEventBatch(1)[0]).toMatchObject({
      occurrenceContextToken: expect.stringMatching(/^pos-bootstrap-/),
    });
    mocks.readSeed.mockResolvedValueOnce({
      ok: true,
      value: { cloudTerminalId: "terminal-1", storeId: "store-1" },
    });

    render(<PosClientTelemetryHost />);
    await waitFor(() =>
      expect(peekPosClientEventBatch(1)[0]).toMatchObject({
        storeId: "store-1",
        reportedCloudTerminalId: "terminal-1",
        occurrenceContextToken: expect.stringMatching(/^pos-bootstrap-/),
      }),
    );
    expect(mocks.useDrain).toHaveBeenLastCalledWith({ identityReady: true });
  });

  it("keeps authorized store scoping when the optional seed read rejects", async () => {
    mocks.readSeed.mockRejectedValueOnce(new Error("indexeddb unavailable"));
    render(<PosClientTelemetryHost />);
    await waitFor(() =>
      expect(mocks.useDrain).toHaveBeenLastCalledWith({ identityReady: true }),
    );

    enqueuePosClientEvent({
      classification: "unexpected_application_error",
      level: "error",
    });

    expect(peekPosClientEventBatch(1)[0]).toMatchObject({ storeId: "store-1" });
    expect(peekPosClientEventBatch(1)[0]).not.toHaveProperty(
      "reportedCloudTerminalId",
    );
  });

  it("does not claim a terminal from another store", async () => {
    mocks.readSeed.mockResolvedValueOnce({
      ok: true,
      value: { cloudTerminalId: "terminal-2", storeId: "store-2" },
    });
    render(<PosClientTelemetryHost />);
    await waitFor(() => expect(mocks.readSeed).toHaveBeenCalledTimes(1));

    enqueuePosClientEvent({
      classification: "unexpected_application_error",
      level: "error",
    });
    expect(peekPosClientEventBatch(1)[0]).toMatchObject({
      storeId: "store-1",
      reportedTerminalFingerprint: "fingerprint-1",
    });
    expect(peekPosClientEventBatch(1)[0]).not.toHaveProperty(
      "reportedCloudTerminalId",
    );
  });

  it("drops a stale fingerprint when the stored identity is removed", async () => {
    mocks.readSeed.mockResolvedValue({
      ok: true,
      value: { cloudTerminalId: "terminal-1", storeId: "store-1" },
    });
    render(<PosClientTelemetryHost />);
    await waitFor(() =>
      expect(mocks.useDrain).toHaveBeenLastCalledWith({ identityReady: true }),
    );

    mocks.fingerprint = null;
    window.dispatchEvent(
      new StorageEvent("storage", { key: FINGERPRINT_STORAGE_KEY }),
    );
    await waitFor(() => expect(mocks.readSeed).toHaveBeenCalledTimes(2));

    enqueuePosClientEvent({
      classification: "unexpected_application_error",
      level: "error",
    });
    expect(peekPosClientEventBatch(1)[0]).toMatchObject({
      storeId: "store-1",
      reportedCloudTerminalId: "terminal-1",
    });
    expect(peekPosClientEventBatch(1)[0]).not.toHaveProperty(
      "reportedTerminalFingerprint",
    );
  });

  it("cannot register stale context after unmounting during the seed read", async () => {
    const seed = deferred<{
      ok: true;
      value: { cloudTerminalId: string; storeId: string };
    }>();
    mocks.readSeed.mockReturnValueOnce(seed.promise);
    const view = render(<PosClientTelemetryHost />);
    view.unmount();

    await act(async () => {
      seed.resolve({
        ok: true,
        value: { cloudTerminalId: "terminal-1", storeId: "store-1" },
      });
      await seed.promise;
    });
    enqueuePosClientEvent({
      classification: "unexpected_application_error",
      level: "error",
    });

    expect(peekPosClientEventBatch(1)[0]).not.toHaveProperty("storeId");
  });

  it("ignores unrelated storage writes and coalesces fingerprint refreshes", async () => {
    const seed = deferred<{
      ok: true;
      value: { cloudTerminalId: string; storeId: string };
    }>();
    mocks.readSeed
      .mockReturnValueOnce(seed.promise)
      .mockResolvedValue({ ok: true, value: null });
    render(<PosClientTelemetryHost />);

    window.dispatchEvent(
      new StorageEvent("storage", { key: "athena-pos-client-telemetry-v1" }),
    );
    window.dispatchEvent(
      new StorageEvent("storage", { key: FINGERPRINT_STORAGE_KEY }),
    );
    window.dispatchEvent(
      new Event(POS_TERMINAL_IDENTITY_REFRESH_REQUEST_EVENT),
    );
    window.dispatchEvent(
      new StorageEvent("storage", { key: FINGERPRINT_STORAGE_KEY }),
    );
    expect(mocks.readSeed).toHaveBeenCalledTimes(1);

    await act(async () => {
      seed.resolve({
        ok: true,
        value: { cloudTerminalId: "terminal-1", storeId: "store-1" },
      });
      await seed.promise;
    });
    await waitFor(() => expect(mocks.readSeed).toHaveBeenCalledTimes(2));
  });

  it("polls with a non-reporting read and records persistent failures only in counters", async () => {
    vi.useFakeTimers();
    mocks.readSeed.mockResolvedValue({
      ok: false,
      error: { code: "unavailable", message: "Storage is unavailable" },
    });
    render(<PosClientTelemetryHost />);

    await act(async () => Promise.resolve());
    for (let index = 0; index < 3; index += 1) {
      await act(async () => {
        vi.advanceTimersByTime(5_000);
        await Promise.resolve();
      });
    }

    expect(mocks.readSeed).toHaveBeenCalledTimes(4);
    expect(mocks.readSeed).toHaveBeenCalledWith({ reportFailure: false });
    expect(peekPosClientEventBatch(10)).toEqual([]);
    expect(snapshotPosRuntimeCounters()).toMatchObject({
      "telemetry.identityRefreshFailureCount": 4,
      "telemetry.lastIdentityRefreshFailureAt": expect.any(Number),
    });
    vi.useRealTimers();
  });

  it("fences the previous terminal while same-tab reprovisioning resolves", async () => {
    const nextSeed = deferred<{
      ok: true;
      value: { cloudTerminalId: string; storeId: string };
    }>();
    mocks.readSeed
      .mockResolvedValueOnce({
        ok: true,
        value: { cloudTerminalId: "terminal-1", storeId: "store-1" },
      })
      .mockReturnValueOnce(nextSeed.promise);
    render(<PosClientTelemetryHost />);
    await waitFor(() =>
      expect(mocks.useDrain).toHaveBeenLastCalledWith({ identityReady: true }),
    );

    act(() => signalPosTerminalIdentityChange("changing"));
    expect(mocks.useDrain).toHaveBeenLastCalledWith({ identityReady: false });
    act(() => signalPosTerminalIdentityChange("changed"));
    enqueuePosClientEvent({
      classification: "unexpected_application_error",
      level: "error",
    });
    expect(peekPosClientEventBatch(1)[0]).not.toHaveProperty(
      "reportedCloudTerminalId",
    );

    await act(async () => {
      nextSeed.resolve({
        ok: true,
        value: { cloudTerminalId: "terminal-2", storeId: "store-1" },
      });
      await nextSeed.promise;
    });
    await waitFor(() =>
      expect(peekPosClientEventBatch(1)[0]).toMatchObject({
        reportedCloudTerminalId: "terminal-2",
      }),
    );
    expect(peekPosClientEventBatch(1)[0]).not.toMatchObject({
      reportedCloudTerminalId: "terminal-1",
    });
  });

  it("rotates the occurrence generation when refresh observes another tab's identity change", async () => {
    mocks.readSeed
      .mockResolvedValueOnce({
        ok: true,
        value: { cloudTerminalId: "terminal-1", storeId: "store-1" },
      })
      .mockResolvedValueOnce({
        ok: true,
        value: { cloudTerminalId: "terminal-2", storeId: "store-1" },
      });
    render(<PosClientTelemetryHost />);
    await waitFor(() => expect(mocks.readSeed).toHaveBeenCalledTimes(1));
    enqueuePosClientEvent({
      classification: "unexpected_application_error",
      level: "error",
    });
    const first = peekPosClientEventBatch(1)[0];
    if (first.version !== 2) throw new Error("expected v2 event");

    rotatePosTerminalIdentityGeneration();
    enqueuePosClientEvent({
      classification: "unexpected_application_error",
      level: "error",
    });
    const pending = peekPosClientEventBatch(10).find(
      (event) => event.clientEventId !== first.clientEventId,
    );
    if (pending?.version !== 2) throw new Error("expected pending v2 event");
    expect(pending).not.toHaveProperty("storeId");
    expect(pending).not.toHaveProperty("reportedCloudTerminalId");
    expect(
      selectOldestEligiblePosTelemetryScope({
        events: [pending],
        backoffByScope: new Map(),
        now: Date.now(),
      }),
    ).toBeUndefined();

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await Promise.resolve();
    });
    expect(mocks.readSeed).toHaveBeenCalledTimes(1);
    expect(mocks.useDrain).toHaveBeenLastCalledWith({ identityReady: false });
    await act(async () => {
      signalPosTerminalIdentityChange("changed");
      await Promise.resolve();
    });
    expect(mocks.readSeed).toHaveBeenCalledTimes(2);
    await waitFor(() =>
      expect(mocks.useDrain).toHaveBeenLastCalledWith({ identityReady: true }),
    );
    enqueuePosClientEvent({
      classification: "unexpected_application_error",
      level: "error",
    });
    const rows = peekPosClientEventBatch(10);
    const second = rows.find(
      (event) =>
        event.clientEventId !== first.clientEventId &&
        event.clientEventId !== pending.clientEventId,
    );
    if (second?.version !== 2) throw new Error("expected second v2 event");

    expect(first.reportedCloudTerminalId).toBe("terminal-1");
    expect(
      rows.find((event) => event.clientEventId === pending.clientEventId),
    ).toMatchObject({ reportedCloudTerminalId: "terminal-2" });
    expect(second.reportedCloudTerminalId).toBe("terminal-2");
    expect(second.occurrenceContextToken).not.toBe(
      first.occurrenceContextToken,
    );
  });

  it("recovers a stale changing lease after a writer crash or denied changed write", async () => {
    mocks.readSeed
      .mockResolvedValueOnce({
        ok: true,
        value: { cloudTerminalId: "terminal-1", storeId: "store-1" },
      })
      .mockResolvedValueOnce({
        ok: true,
        value: { cloudTerminalId: "terminal-2", storeId: "store-1" },
      });
    render(<PosClientTelemetryHost />);
    await waitFor(() => expect(mocks.readSeed).toHaveBeenCalledTimes(1));

    const current = readPosTerminalIdentityTransition({
      forceSharedRead: true,
    });
    const staleChanging = {
      generation: "pos-identity-abandoned-writer-generation",
      phase: "changing" as const,
      ownerDocumentId: "pos-bootstrap-abandoned-writer-document",
      revision: current.revision + 1,
      startedAt: Date.now() - POS_TERMINAL_IDENTITY_TRANSITION_LEASE_MS - 1,
      updatedAt: Date.now() - POS_TERMINAL_IDENTITY_TRANSITION_LEASE_MS - 1,
    };
    storage.setValue(
      POS_TERMINAL_IDENTITY_GENERATION_STORAGE_KEY,
      JSON.stringify(staleChanging),
    );
    mocks.allowIdentityLock = true;

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(mocks.readSeed.mock.calls.length).toBeGreaterThanOrEqual(2),
    );
    await waitFor(() =>
      expect(mocks.useDrain).toHaveBeenLastCalledWith({ identityReady: true }),
    );
    expect(
      readPosTerminalIdentityTransition({ forceSharedRead: true }),
    ).toMatchObject({
      generation: staleChanging.generation,
      phase: "changed",
      revision: staleChanging.revision,
    });

    enqueuePosClientEvent({
      classification: "unexpected_application_error",
      level: "error",
    });
    expect(peekPosClientEventBatch(1)[0]).toMatchObject({
      reportedCloudTerminalId: "terminal-2",
    });
  });

  it("keeps no-lock telemetry unattributed until coordinated refresh establishes a fresh generation", async () => {
    const workingLocks = Object.getOwnPropertyDescriptor(navigator, "locks");
    Reflect.deleteProperty(navigator, "locks");
    markPosTerminalIdentityUncoordinated();
    mocks.readSeed.mockResolvedValue({
      ok: true,
      value: { cloudTerminalId: "terminal-2", storeId: "store-1" },
    });
    render(<PosClientTelemetryHost />);
    await act(async () => Promise.resolve());

    enqueuePosClientEvent({
      classification: "unexpected_application_error",
      level: "error",
    });
    expect(mocks.readSeed).not.toHaveBeenCalled();
    expect(mocks.useDrain).toHaveBeenLastCalledWith({ identityReady: false });
    expect(peekPosClientEventBatch(1)[0]).toMatchObject({
      orgUrlSlug: "acme",
      storeUrlSlug: "central",
    });
    expect(peekPosClientEventBatch(1)[0]).not.toHaveProperty("storeId");
    expect(peekPosClientEventBatch(1)[0]).not.toHaveProperty(
      "reportedCloudTerminalId",
    );

    mocks.allowIdentityLock = true;
    if (workingLocks) Object.defineProperty(navigator, "locks", workingLocks);
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(mocks.useDrain).toHaveBeenLastCalledWith({ identityReady: true }),
    );
    enqueuePosClientEvent({
      classification: "unexpected_application_error",
      level: "error",
    });
    const events = peekPosClientEventBatch(10);
    expect(events.at(-1)).toMatchObject({
      storeId: "store-1",
      reportedCloudTerminalId: "terminal-2",
    });
    expect(events[0]).not.toHaveProperty("storeId");
  });

  it("stabilizes a settled lockless generation after quiescence and reload", async () => {
    const workingLocks = Object.getOwnPropertyDescriptor(navigator, "locks");
    Reflect.deleteProperty(navigator, "locks");
    markPosTerminalIdentityUncoordinated("in_flight");
    const settled = markPosTerminalIdentityUncoordinated("settled");
    const quiescentAt =
      Date.now() - POS_TERMINAL_IDENTITY_UNCOORDINATED_QUIESCENCE_MS - 1;
    const reloadedTransition = {
      ...settled,
      revision: settled.revision + 1,
      startedAt: quiescentAt,
      updatedAt: quiescentAt,
      uncoordinatedSettledAt: quiescentAt,
    };
    storage.setValue(
      POS_TERMINAL_IDENTITY_GENERATION_STORAGE_KEY,
      JSON.stringify(reloadedTransition),
    );
    clearPosTelemetryContextForTests();
    enqueuePosClientEvent({
      classification: "unexpected_application_error",
      level: "error",
    });
    const quarantined = peekPosClientEventBatch(1)[0];
    expect(quarantined).not.toHaveProperty("storeId");
    mocks.readSeed.mockResolvedValue({
      ok: true,
      value: { cloudTerminalId: "terminal-3", storeId: "store-1" },
    });

    render(<PosClientTelemetryHost />);
    await waitFor(() =>
      expect(mocks.useDrain).toHaveBeenLastCalledWith({ identityReady: true }),
    );
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      window.dispatchEvent(new Event("focus"));
      await Promise.resolve();
    });
    expect(readPosTerminalIdentityTransition()).toMatchObject({
      phase: "changed",
      revision: reloadedTransition.revision + 1,
    });
    expect(peekPosClientEventBatch(10)[0]).not.toHaveProperty("storeId");

    enqueuePosClientEvent({
      classification: "unexpected_application_error",
      level: "error",
    });
    expect(peekPosClientEventBatch(10).at(-1)).toMatchObject({
      storeId: "store-1",
      reportedCloudTerminalId: "terminal-3",
    });
    if (workingLocks) Object.defineProperty(navigator, "locks", workingLocks);
  });

  it("adopts a changed generation after the initial seed read recovers", async () => {
    mocks.readSeed
      .mockResolvedValueOnce({
        ok: false,
        error: { code: "unavailable", message: "Storage is unavailable" },
      })
      .mockResolvedValueOnce({ ok: true, value: null });
    render(<PosClientTelemetryHost />);
    await waitFor(() =>
      expect(mocks.useDrain).toHaveBeenLastCalledWith({ identityReady: true }),
    );

    rotatePosTerminalIdentityGeneration();
    enqueuePosClientEvent({
      classification: "unexpected_application_error",
      level: "error",
    });
    const pending = peekPosClientEventBatch(1)[0];
    expect(pending).not.toHaveProperty("storeId");

    await act(async () => {
      signalPosTerminalIdentityChange("changed");
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(peekPosClientEventBatch(1)[0]).toMatchObject({
        storeId: "store-1",
      }),
    );
    const [recovered] = peekPosClientEventBatch(1);
    expect(recovered).not.toHaveProperty("reportedCloudTerminalId");
    expect(
      selectOldestEligiblePosTelemetryScope({
        events: [recovered],
        backoffByScope: new Map(),
        now: Date.now(),
      }),
    ).toBeDefined();
  });
});

function installMemoryStorage() {
  const values = new Map<string, string>();
  const originalKey = Object.getOwnPropertyDescriptor(
    window.localStorage,
    "key",
  );
  const originalLength = Object.getOwnPropertyDescriptor(
    window.localStorage,
    "length",
  );
  const getItem = vi
    .spyOn(window.localStorage, "getItem")
    .mockImplementation((key) => values.get(key) ?? null);
  const setItem = vi
    .spyOn(window.localStorage, "setItem")
    .mockImplementation((key, value) => void values.set(key, value));
  const removeItem = vi
    .spyOn(window.localStorage, "removeItem")
    .mockImplementation((key) => void values.delete(key));
  Object.defineProperty(window.localStorage, "key", {
    configurable: true,
    value: (index: number) => [...values.keys()][index] ?? null,
  });
  Object.defineProperty(window.localStorage, "length", {
    configurable: true,
    get: () => values.size,
  });
  return {
    setValue(key: string, value: string) {
      values.set(key, value);
    },
    restore() {
      getItem.mockRestore();
      setItem.mockRestore();
      removeItem.mockRestore();
      if (originalKey)
        Object.defineProperty(window.localStorage, "key", originalKey);
      else Reflect.deleteProperty(window.localStorage, "key");
      if (originalLength)
        Object.defineProperty(window.localStorage, "length", originalLength);
      else Reflect.deleteProperty(window.localStorage, "length");
    },
  };
}
