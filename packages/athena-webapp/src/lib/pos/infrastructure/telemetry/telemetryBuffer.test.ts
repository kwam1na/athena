import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as posLocalStorageRuntime from "../local/posLocalStorageRuntime";
import * as terminalFingerprint from "../terminal/fingerprint";

import {
  enqueuePosClientEvent,
  flushPosTelemetryWitnessUpgradesForTests,
  peekPosClientEventBatch,
  POS_CLIENT_TELEMETRY_MAX_REMOVAL_TOMBSTONES,
  POS_CLIENT_TELEMETRY_RETENTION_MS,
  POS_CLIENT_TELEMETRY_STORAGE_KEY,
  posClientTelemetryBufferSize,
  readPosTelemetryOccurrenceWitness,
  removePosClientEvents,
  resetPosClientTelemetryBufferForTests,
} from "./telemetryBuffer";
import {
  resetPosRuntimeCounters,
  snapshotPosRuntimeCounters,
} from "./runtimeCounters";
import {
  getPosTelemetryDocumentBootstrapGeneration,
  readPosTerminalIdentityGeneration,
  registerPosTelemetryContext,
} from "./telemetryContext";

describe("posClientTelemetryBuffer", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/acme/store/central/pos/register");
    window.localStorage.clear();
    resetPosRuntimeCounters();
    resetPosClientTelemetryBufferForTests();
    Object.defineProperty(navigator, "locks", {
      configurable: true,
      value: {
        request: vi.fn(
          async (
            _name: string,
            _options: unknown,
            callback: () => Promise<unknown>,
          ) => callback(),
        ),
      },
    });
    vi.spyOn(posLocalStorageRuntime, "getDefaultPosLocalStore").mockReturnValue(
      {
        readProvisionedTerminalSeed: vi.fn(async () => ({
          ok: true as const,
          value: {
            cloudTerminalId: "terminal-1",
            storeId: "store-1",
            telemetryIdentityEpoch: "epoch-1",
          },
        })),
      } as unknown as ReturnType<
        typeof posLocalStorageRuntime.getDefaultPosLocalStore
      >,
    );
    vi.spyOn(
      terminalFingerprint,
      "readStoredTerminalFingerprintHash",
    ).mockReturnValue("fp-1");
  });

  afterEach(() => vi.restoreAllMocks());

  it("enqueues a finite v2 event without arbitrary error text", () => {
    enqueuePosClientEvent({
      level: "error",
      flow: "checkout",
      classification: "unexpected_application_error",
      operation: "app_use_case",
      error: Object.assign(new Error("customer@example.com secret payload"), {
        name: "CustomCustomerFailure",
        stack:
          "CustomCustomerFailure: secret\n    at fn (/assets/index-abc123.js?token=secret:12:34)",
      }),
      metadata: { attempt: 2, customer: "customer@example.com" },
    });

    const [event] = peekPosClientEventBatch(10);
    expect(event).toBeDefined();
    expect(event.version).toBe(2);
    if (event.version !== 2) throw new Error("expected v2 event");
    expect(event.level).toBe("error");
    expect(event.flow).toBe("checkout");
    expect(event.version).toBe(2);
    expect(event.classification).toBe("unexpected_application_error");
    expect(event.operation).toBe("app_use_case");
    expect(event.errorName).toBe("UnknownError");
    expect(event.source).toEqual({
      asset: "index-abc123.js",
      line: 12,
      column: 34,
    });
    expect(event.metadata).toEqual({ attempt: 2 });
    expect(JSON.stringify(event)).not.toContain("customer@example.com");
    expect(JSON.stringify(event)).not.toContain("secret payload");
    expect(event.clientEventId).toBeTruthy();
    expect(event.occurredAt).toBeGreaterThan(0);
  });

  it("persists the buffer to localStorage for reload durability", () => {
    // The global test setup replaces localStorage with a non-storing mock, so
    // assert on the write itself rather than reading back.
    const setItem = vi.spyOn(window.localStorage, "setItem");
    enqueuePosClientEvent({
      level: "warn",
      classification: "continuity_warning",
      operation: "app_use_case",
    });
    const [key, payload] =
      setItem.mock.calls.findLast(([candidate]) =>
        candidate.startsWith(`${POS_CLIENT_TELEMETRY_STORAGE_KEY}:event:`),
      ) ?? [];
    expect(key).toMatch(/^athena-pos-client-telemetry-v1:event:/);
    expect(payload).toContain('"version":2');
    expect(posClientTelemetryBufferSize()).toBe(1);
  });

  it("upgrades a durable binding to an exact v2 identity witness", async () => {
    const storage = installMemoryStorage();
    const owner = getPosTelemetryDocumentBootstrapGeneration();
    const unregister = registerPosTelemetryContext(owner, {
      orgUrlSlug: "acme",
      storeUrlSlug: "central",
      storeId: "store-1",
      telemetryIdentityEpoch: "epoch-1",
      reportedCloudTerminalId: "terminal-1",
      reportedTerminalFingerprint: "fp-1",
    });
    enqueuePosClientEvent({
      level: "error",
      classification: "unexpected_application_error",
    });

    const [pendingEvent] = peekPosClientEventBatch(1);
    expect(
      readPosTelemetryOccurrenceWitness(pendingEvent.clientEventId),
    ).toBeUndefined();

    await flushPosTelemetryWitnessUpgradesForTests();

    const [event] = peekPosClientEventBatch(1);
    if (event.version !== 2) throw new Error("expected v2 event");
    expect(readPosTelemetryOccurrenceWitness(event.clientEventId)).toEqual(
      expect.objectContaining({
        version: 2,
        clientEventId: event.clientEventId,
        occurrenceContextToken: event.occurrenceContextToken,
        terminalIdentityGeneration: event.terminalIdentityGeneration,
        storeId: "store-1",
        telemetryIdentityEpoch: "epoch-1",
        reportedCloudTerminalId: "terminal-1",
        reportedTerminalFingerprint: "fp-1",
        transitionRevision: expect.any(Number),
        transitionStartedAt: expect.any(Number),
      }),
    );
    unregister();
    storage.restore();
  });

  it("witnesses store-level evidence without inventing terminal attribution", async () => {
    const storage = installMemoryStorage();
    const unregister = registerPosTelemetryContext(
      getPosTelemetryDocumentBootstrapGeneration(),
      {
        orgUrlSlug: "acme",
        storeUrlSlug: "central",
        storeId: "store-1",
        telemetryIdentityEpoch: "epoch-1",
      },
    );

    enqueuePosClientEvent({
      level: "error",
      classification: "unexpected_application_error",
    });
    await flushPosTelemetryWitnessUpgradesForTests();

    const [event] = peekPosClientEventBatch(1);
    expect(readPosTelemetryOccurrenceWitness(event.clientEventId)).toEqual(
      expect.objectContaining({
        version: 2,
        clientEventId: event.clientEventId,
        storeId: "store-1",
      }),
    );
    expect(
      readPosTelemetryOccurrenceWitness(event.clientEventId),
    ).not.toHaveProperty("reportedCloudTerminalId");
    unregister();
    storage.restore();
  });

  it.each([
    ["seed read failure", { ok: false as const, error: new Error("denied") }],
    ["missing seed", { ok: true as const, value: null }],
    [
      "different terminal",
      {
        ok: true as const,
        value: { storeId: "store-1", cloudTerminalId: "terminal-2" },
      },
    ],
    [
      "different store",
      {
        ok: true as const,
        value: { storeId: "store-2", cloudTerminalId: "terminal-1" },
      },
    ],
  ])("withholds v2 witness on %s", async (_label, seedResult) => {
    const storage = installMemoryStorage();
    vi.mocked(posLocalStorageRuntime.getDefaultPosLocalStore).mockReturnValue({
      readProvisionedTerminalSeed: vi.fn(async () => seedResult),
    } as unknown as ReturnType<
      typeof posLocalStorageRuntime.getDefaultPosLocalStore
    >);
    const owner = getPosTelemetryDocumentBootstrapGeneration();
    const unregister = registerPosTelemetryContext(owner, {
      orgUrlSlug: "acme",
      storeUrlSlug: "central",
      storeId: "store-1",
      telemetryIdentityEpoch: "epoch-1",
      reportedCloudTerminalId: "terminal-1",
      reportedTerminalFingerprint: "fp-1",
    });

    enqueuePosClientEvent({
      level: "error",
      classification: "unexpected_application_error",
    });
    await flushPosTelemetryWitnessUpgradesForTests();

    const [event] = peekPosClientEventBatch(1);
    expect(
      readPosTelemetryOccurrenceWitness(event.clientEventId),
    ).toBeUndefined();
    unregister();
    storage.restore();
  });

  it("withholds v2 witness when the current fingerprint changed", async () => {
    const storage = installMemoryStorage();
    vi.mocked(
      terminalFingerprint.readStoredTerminalFingerprintHash,
    ).mockReturnValue("fp-2");
    const unregister = registerPosTelemetryContext(
      getPosTelemetryDocumentBootstrapGeneration(),
      {
        orgUrlSlug: "acme",
        storeUrlSlug: "central",
        storeId: "store-1",
        telemetryIdentityEpoch: "epoch-1",
        reportedCloudTerminalId: "terminal-1",
        reportedTerminalFingerprint: "fp-1",
      },
    );
    enqueuePosClientEvent({
      level: "error",
      classification: "unexpected_application_error",
    });
    await flushPosTelemetryWitnessUpgradesForTests();
    const [event] = peekPosClientEventBatch(1);
    expect(
      readPosTelemetryOccurrenceWitness(event.clientEventId),
    ).toBeUndefined();
    unregister();
    storage.restore();
  });

  it("rejects an ABA terminal tuple when its telemetry identity epoch changed", async () => {
    const storage = installMemoryStorage();
    vi.mocked(posLocalStorageRuntime.getDefaultPosLocalStore).mockReturnValue({
      readProvisionedTerminalSeed: vi.fn(async () => ({
        ok: true as const,
        value: {
          cloudTerminalId: "terminal-1",
          storeId: "store-1",
          telemetryIdentityEpoch: "epoch-2",
        },
      })),
    } as unknown as ReturnType<
      typeof posLocalStorageRuntime.getDefaultPosLocalStore
    >);
    const unregister = registerPosTelemetryContext(
      getPosTelemetryDocumentBootstrapGeneration(),
      {
        orgUrlSlug: "acme",
        storeUrlSlug: "central",
        storeId: "store-1",
        telemetryIdentityEpoch: "epoch-0",
        reportedCloudTerminalId: "terminal-1",
        reportedTerminalFingerprint: "fp-1",
      },
    );

    enqueuePosClientEvent({
      level: "error",
      classification: "unexpected_application_error",
    });
    await flushPosTelemetryWitnessUpgradesForTests();

    const [event] = peekPosClientEventBatch(1);
    expect(event).toMatchObject({ telemetryIdentityEpoch: "epoch-0" });
    expect(
      readPosTelemetryOccurrenceWitness(event.clientEventId),
    ).toBeUndefined();
    unregister();
    storage.restore();
  });

  it("withholds v2 witness when the shared lock is unavailable", async () => {
    const storage = installMemoryStorage();
    vi.mocked(navigator.locks.request).mockRejectedValueOnce(
      new Error("lock unavailable"),
    );
    const unregister = registerPosTelemetryContext(
      getPosTelemetryDocumentBootstrapGeneration(),
      {
        orgUrlSlug: "acme",
        storeUrlSlug: "central",
        storeId: "store-1",
        telemetryIdentityEpoch: "epoch-1",
        reportedCloudTerminalId: "terminal-1",
      },
    );
    enqueuePosClientEvent({
      level: "error",
      classification: "unexpected_application_error",
    });
    await flushPosTelemetryWitnessUpgradesForTests();
    const [event] = peekPosClientEventBatch(1);
    expect(
      readPosTelemetryOccurrenceWitness(event.clientEventId),
    ).toBeUndefined();
    unregister();
    storage.restore();
  });

  it("retries a transiently failed witness upgrade from the queued-event lifecycle", async () => {
    const storage = installMemoryStorage();
    const now = Date.now();
    const dateNow = vi.spyOn(Date, "now").mockReturnValue(now);
    let rejectFirstLock!: (error: Error) => void;
    vi.mocked(navigator.locks.request)
      .mockImplementationOnce(
        () =>
          new Promise((_, reject) => {
            rejectFirstLock = reject;
          }),
      )
      .mockImplementationOnce(
        async (
          _name: string,
          _options: LockOptions,
          callback: LockGrantedCallback<unknown>,
        ) => callback({ name: _name, mode: "exclusive" } as Lock),
      );
    const unregister = registerPosTelemetryContext(
      getPosTelemetryDocumentBootstrapGeneration(),
      {
        orgUrlSlug: "acme",
        storeUrlSlug: "central",
        storeId: "store-1",
        telemetryIdentityEpoch: "epoch-1",
        reportedCloudTerminalId: "terminal-1",
        reportedTerminalFingerprint: "fp-1",
      },
    );

    enqueuePosClientEvent({
      level: "error",
      classification: "unexpected_application_error",
    });
    peekPosClientEventBatch(1);
    peekPosClientEventBatch(1);
    expect(navigator.locks.request).toHaveBeenCalledTimes(1);
    rejectFirstLock(new Error("lock unavailable"));
    await flushPosTelemetryWitnessUpgradesForTests();
    const [eventAfterFailure] = peekPosClientEventBatch(1);
    expect(
      readPosTelemetryOccurrenceWitness(eventAfterFailure.clientEventId),
    ).toBeUndefined();
    expect(navigator.locks.request).toHaveBeenCalledTimes(1);

    dateNow.mockReturnValue(now + 30_001);
    peekPosClientEventBatch(1);

    await flushPosTelemetryWitnessUpgradesForTests();

    expect(
      readPosTelemetryOccurrenceWitness(eventAfterFailure.clientEventId),
    ).toEqual(
      expect.objectContaining({
        version: 2,
        clientEventId: eventAfterFailure.clientEventId,
        telemetryIdentityEpoch: "epoch-1",
      }),
    );
    expect(navigator.locks.request).toHaveBeenCalledTimes(2);
    unregister();
    storage.restore();
  });

  it("bounds a full-buffer witness retry pass to one lock request", async () => {
    const storage = installMemoryStorage();
    const generation = readPosTerminalIdentityGeneration();
    const now = Date.now();
    for (let index = 0; index < 200; index += 1) {
      const clientEventId = `retry-${String(index).padStart(3, "0")}`;
      const occurrenceContextToken = `owner-${String(index).padStart(3, "0")}`;
      window.localStorage.setItem(
        `${POS_CLIENT_TELEMETRY_STORAGE_KEY}:event:${clientEventId}`,
        JSON.stringify({
          ...storedV2Event(clientEventId, now + index),
          occurrenceContextToken,
          terminalIdentityGeneration: generation,
          telemetryIdentityEpoch: "epoch-1",
          reportedTerminalFingerprint: "fp-1",
        }),
      );
      window.localStorage.setItem(
        `${POS_CLIENT_TELEMETRY_STORAGE_KEY}:occurrence:${clientEventId}`,
        JSON.stringify({
          version: 1,
          storeId: "store-1",
          occurrenceContextToken,
          terminalIdentityGeneration: generation,
          telemetryIdentityEpoch: "epoch-1",
          reportedCloudTerminalId: "terminal-1",
          reportedTerminalFingerprint: "fp-1",
        }),
      );
    }
    vi.mocked(navigator.locks.request).mockRejectedValue(
      new Error("lock unavailable"),
    );

    expect(peekPosClientEventBatch(200)).toHaveLength(200);
    await flushPosTelemetryWitnessUpgradesForTests();

    expect(navigator.locks.request).toHaveBeenCalledTimes(1);
    storage.restore();
  });

  it("lets a later v1 row retry while the failed oldest row cools down", async () => {
    const storage = installMemoryStorage();
    const generation = readPosTerminalIdentityGeneration();
    const now = Date.now();
    for (const [clientEventId, occurredAt] of [
      ["retry-oldest", now],
      ["retry-next", now + 1],
    ] as const) {
      window.localStorage.setItem(
        `${POS_CLIENT_TELEMETRY_STORAGE_KEY}:event:${clientEventId}`,
        JSON.stringify({
          ...storedV2Event(clientEventId, occurredAt),
          occurrenceContextToken: clientEventId,
          terminalIdentityGeneration: generation,
          telemetryIdentityEpoch: "epoch-1",
          reportedTerminalFingerprint: "fp-1",
        }),
      );
      window.localStorage.setItem(
        `${POS_CLIENT_TELEMETRY_STORAGE_KEY}:occurrence:${clientEventId}`,
        JSON.stringify({
          version: 1,
          storeId: "store-1",
          occurrenceContextToken: clientEventId,
          terminalIdentityGeneration: generation,
          telemetryIdentityEpoch: "epoch-1",
          reportedCloudTerminalId: "terminal-1",
          reportedTerminalFingerprint: "fp-1",
        }),
      );
    }
    vi.mocked(navigator.locks.request).mockRejectedValueOnce(
      new Error("oldest unavailable"),
    );

    peekPosClientEventBatch(2);
    await flushPosTelemetryWitnessUpgradesForTests();
    expect(readPosTelemetryOccurrenceWitness("retry-oldest")).toBeUndefined();

    peekPosClientEventBatch(2);
    await flushPosTelemetryWitnessUpgradesForTests();

    expect(navigator.locks.request).toHaveBeenCalledTimes(2);
    expect(readPosTelemetryOccurrenceWitness("retry-oldest")).toBeUndefined();
    expect(readPosTelemetryOccurrenceWitness("retry-next")).toEqual(
      expect.objectContaining({ version: 2, clientEventId: "retry-next" }),
    );
    storage.restore();
  });

  it("round-robins three failed rows at the exact drain cadence", async () => {
    const storage = installMemoryStorage();
    const generation = readPosTerminalIdentityGeneration();
    const now = Date.now();
    const dateNow = vi.spyOn(Date, "now").mockReturnValue(now);
    for (const [index, clientEventId] of [
      "retry-a",
      "retry-b",
      "retry-c",
    ].entries()) {
      window.localStorage.setItem(
        `${POS_CLIENT_TELEMETRY_STORAGE_KEY}:event:${clientEventId}`,
        JSON.stringify({
          ...storedV2Event(clientEventId, now + index),
          occurrenceContextToken: clientEventId,
          terminalIdentityGeneration: generation,
          telemetryIdentityEpoch: "epoch-1",
          reportedTerminalFingerprint: "fp-1",
        }),
      );
      window.localStorage.setItem(
        `${POS_CLIENT_TELEMETRY_STORAGE_KEY}:occurrence:${clientEventId}`,
        JSON.stringify({
          version: 1,
          storeId: "store-1",
          occurrenceContextToken: clientEventId,
          terminalIdentityGeneration: generation,
          telemetryIdentityEpoch: "epoch-1",
          reportedCloudTerminalId: "terminal-1",
          reportedTerminalFingerprint: "fp-1",
        }),
      );
    }
    const attemptedIds: string[] = [];
    let insideLock = false;
    storage.onEventRead((clientEventId) => {
      if (insideLock) attemptedIds.push(clientEventId);
    });
    vi.mocked(navigator.locks.request).mockImplementation(
      async (
        _name: string,
        _options: LockOptions,
        callback: LockGrantedCallback<unknown>,
      ) => {
        insideLock = true;
        try {
          return await callback({ name: _name, mode: "exclusive" } as Lock);
        } finally {
          insideLock = false;
        }
      },
    );
    vi.mocked(posLocalStorageRuntime.getDefaultPosLocalStore).mockReturnValue({
      readProvisionedTerminalSeed: vi.fn(async () => ({
        ok: false as const,
        error: new Error("seed unavailable"),
      })),
    } as unknown as ReturnType<
      typeof posLocalStorageRuntime.getDefaultPosLocalStore
    >);

    for (let pass = 0; pass < 3; pass += 1) {
      const requestsBefore = vi.mocked(navigator.locks.request).mock.calls
        .length;
      peekPosClientEventBatch(3);
      await flushPosTelemetryWitnessUpgradesForTests();
      expect(
        vi.mocked(navigator.locks.request).mock.calls.length - requestsBefore,
      ).toBe(1);
      dateNow.mockReturnValue(now + (pass + 1) * 30_000);
    }

    expect(navigator.locks.request).toHaveBeenCalledTimes(3);
    expect(attemptedIds).toEqual(["retry-a", "retry-b", "retry-c"]);
    for (const clientEventId of ["retry-a", "retry-b", "retry-c"]) {
      expect(readPosTelemetryOccurrenceWitness(clientEventId)).toBeUndefined();
    }
    storage.restore();
  });

  it("does not leave a witness when the event is removed during seed verification", async () => {
    const storage = installMemoryStorage();
    let resolveSeed!: (value: {
      ok: true;
      value: { storeId: string; cloudTerminalId: string };
    }) => void;
    const seed = new Promise<{
      ok: true;
      value: { storeId: string; cloudTerminalId: string };
    }>((resolve) => {
      resolveSeed = resolve;
    });
    vi.mocked(posLocalStorageRuntime.getDefaultPosLocalStore).mockReturnValue({
      readProvisionedTerminalSeed: vi.fn(() => seed),
    } as unknown as ReturnType<
      typeof posLocalStorageRuntime.getDefaultPosLocalStore
    >);
    const unregister = registerPosTelemetryContext(
      getPosTelemetryDocumentBootstrapGeneration(),
      {
        orgUrlSlug: "acme",
        storeUrlSlug: "central",
        storeId: "store-1",
        telemetryIdentityEpoch: "epoch-1",
        reportedCloudTerminalId: "terminal-1",
      },
    );
    enqueuePosClientEvent({
      level: "error",
      classification: "unexpected_application_error",
    });
    const [event] = peekPosClientEventBatch(1);
    removePosClientEvents([event.clientEventId]);
    resolveSeed({
      ok: true,
      value: { storeId: "store-1", cloudTerminalId: "terminal-1" },
    });
    await flushPosTelemetryWitnessUpgradesForTests();
    expect(
      readPosTelemetryOccurrenceWitness(event.clientEventId),
    ).toBeUndefined();
    unregister();
    storage.restore();
  });

  it("does not upgrade a shard tampered during seed verification", async () => {
    const storage = installMemoryStorage();
    let resolveSeed!: (value: {
      ok: true;
      value: { storeId: string; cloudTerminalId: string };
    }) => void;
    const seed = new Promise<{
      ok: true;
      value: { storeId: string; cloudTerminalId: string };
    }>((resolve) => {
      resolveSeed = resolve;
    });
    vi.mocked(posLocalStorageRuntime.getDefaultPosLocalStore).mockReturnValue({
      readProvisionedTerminalSeed: vi.fn(() => seed),
    } as unknown as ReturnType<
      typeof posLocalStorageRuntime.getDefaultPosLocalStore
    >);
    const unregister = registerPosTelemetryContext(
      getPosTelemetryDocumentBootstrapGeneration(),
      {
        orgUrlSlug: "acme",
        storeUrlSlug: "central",
        storeId: "store-1",
        telemetryIdentityEpoch: "epoch-1",
        reportedCloudTerminalId: "terminal-1",
      },
    );
    enqueuePosClientEvent({
      level: "error",
      classification: "unexpected_application_error",
    });
    const [event] = peekPosClientEventBatch(1);
    const shardKey = `${POS_CLIENT_TELEMETRY_STORAGE_KEY}:event:${event.clientEventId}`;
    const shard = JSON.parse(
      window.localStorage.getItem(shardKey) as string,
    ) as Record<string, unknown>;
    window.localStorage.setItem(
      shardKey,
      JSON.stringify({ ...shard, reportedCloudTerminalId: "terminal-2" }),
    );
    resolveSeed({
      ok: true,
      value: { storeId: "store-1", cloudTerminalId: "terminal-1" },
    });
    await flushPosTelemetryWitnessUpgradesForTests();
    expect(
      readPosTelemetryOccurrenceWitness(event.clientEventId),
    ).toBeUndefined();
    unregister();
    storage.restore();
  });

  it("does not upgrade a v1 binding swapped during seed verification", async () => {
    const storage = installMemoryStorage();
    let resolveSeed!: (value: {
      ok: true;
      value: {
        storeId: string;
        cloudTerminalId: string;
        telemetryIdentityEpoch: string;
      };
    }) => void;
    const seed = new Promise<{
      ok: true;
      value: {
        storeId: string;
        cloudTerminalId: string;
        telemetryIdentityEpoch: string;
      };
    }>((resolve) => {
      resolveSeed = resolve;
    });
    vi.mocked(posLocalStorageRuntime.getDefaultPosLocalStore).mockReturnValue({
      readProvisionedTerminalSeed: vi.fn(() => seed),
    } as unknown as ReturnType<
      typeof posLocalStorageRuntime.getDefaultPosLocalStore
    >);
    const unregister = registerPosTelemetryContext(
      getPosTelemetryDocumentBootstrapGeneration(),
      {
        orgUrlSlug: "acme",
        storeUrlSlug: "central",
        storeId: "store-1",
        telemetryIdentityEpoch: "epoch-1",
        reportedCloudTerminalId: "terminal-1",
      },
    );
    enqueuePosClientEvent({
      level: "error",
      classification: "unexpected_application_error",
    });
    const [event] = peekPosClientEventBatch(1);
    const bindingKey = `${POS_CLIENT_TELEMETRY_STORAGE_KEY}:occurrence:${event.clientEventId}`;
    const binding = JSON.parse(
      window.localStorage.getItem(bindingKey) as string,
    ) as Record<string, unknown>;
    window.localStorage.setItem(
      bindingKey,
      JSON.stringify({ ...binding, telemetryIdentityEpoch: "epoch-2" }),
    );
    resolveSeed({
      ok: true,
      value: {
        storeId: "store-1",
        cloudTerminalId: "terminal-1",
        telemetryIdentityEpoch: "epoch-1",
      },
    });
    await flushPosTelemetryWitnessUpgradesForTests();

    expect(
      readPosTelemetryOccurrenceWitness(event.clientEventId),
    ).toBeUndefined();
    unregister();
    storage.restore();
  });

  it("retains the event but withholds historical eligibility when witness persistence fails", () => {
    const storage = installMemoryStorage();
    const owner = getPosTelemetryDocumentBootstrapGeneration();
    const unregister = registerPosTelemetryContext(owner, {
      orgUrlSlug: "acme",
      storeUrlSlug: "central",
      storeId: "store-1",
      telemetryIdentityEpoch: "epoch-1",
      reportedCloudTerminalId: "terminal-1",
    });
    storage.failNextOccurrenceBindingWrite();
    enqueuePosClientEvent({
      level: "error",
      classification: "unexpected_application_error",
    });

    const [event] = peekPosClientEventBatch(1);
    expect(event).toBeDefined();
    expect(
      readPosTelemetryOccurrenceWitness(event.clientEventId),
    ).toBeUndefined();
    unregister();
    storage.restore();
  });

  it("caps the buffer as a ring, dropping the oldest events", () => {
    vi.useFakeTimers();
    try {
      for (let index = 0; index < 205; index += 1) {
        vi.setSystemTime(1_800_000_000_000 + index);
        enqueuePosClientEvent({
          level: "warn",
          classification: "continuity_warning",
          operation: "app_use_case",
          metadata: { attempt: index },
        });
      }
      expect(posClientTelemetryBufferSize()).toBe(200);
      const retained = peekPosClientEventBatch(205);
      const [oldest] = retained;
      expect(oldest.version).toBe(2);
      expect(retained.map((event) => event.metadata.attempt)).toEqual(
        Array.from({ length: 200 }, (_, index) => index + 5),
      );
      expect(snapshotPosRuntimeCounters()["telemetry.droppedCount"]).toBe(5);
    } finally {
      vi.useRealTimers();
    }
  });

  it("bounds removal fences during a sustained fault storm", () => {
    const storage = installMemoryStorage();
    try {
      for (let index = 0; index < 650; index += 1) {
        enqueuePosClientEvent({
          level: "error",
          classification: "unexpected_application_error",
          metadata: { attempt: index },
        });
      }

      expect(posClientTelemetryBufferSize()).toBe(200);
      expect(
        storage
          .keys()
          .filter((key) =>
            key.startsWith(`${POS_CLIENT_TELEMETRY_STORAGE_KEY}:removed:`),
          ),
      ).toHaveLength(POS_CLIENT_TELEMETRY_MAX_REMOVAL_TOMBSTONES);
      expect(
        storage
          .keys()
          .filter((key) => key.startsWith(POS_CLIENT_TELEMETRY_STORAGE_KEY))
          .length,
      ).toBeLessThanOrEqual(
        200 + POS_CLIENT_TELEMETRY_MAX_REMOVAL_TOMBSTONES,
      );
    } finally {
      storage.restore();
    }
  });

  it("keeps a new removal fence after the clock rolls back", () => {
    const storage = installMemoryStorage();
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    try {
      for (
        let index = 0;
        index < POS_CLIENT_TELEMETRY_MAX_REMOVAL_TOMBSTONES;
        index += 1
      ) {
        window.localStorage.setItem(
          `${POS_CLIENT_TELEMETRY_STORAGE_KEY}:removed:future-${index}`,
          String(1_000_000 + index),
        );
      }

      removePosClientEvents(["current-removal"]);
      posClientTelemetryBufferSize();

      expect(
        window.localStorage.getItem(
          `${POS_CLIENT_TELEMETRY_STORAGE_KEY}:removed:current-removal`,
        ),
      ).toBe("10000");
      expect(
        storage
          .keys()
          .filter((key) =>
            key.startsWith(`${POS_CLIENT_TELEMETRY_STORAGE_KEY}:removed:`),
          ),
      ).toHaveLength(POS_CLIENT_TELEMETRY_MAX_REMOVAL_TOMBSTONES);
    } finally {
      vi.useRealTimers();
      storage.restore();
    }
  });

  it("keeps an overflow fence when its stale shard cannot be cleared", () => {
    const storage = installMemoryStorage();
    const now = Date.now();
    const clientEventId = "stale-survivor";
    const tombstoneKey = `${POS_CLIENT_TELEMETRY_STORAGE_KEY}:removed:${clientEventId}`;
    const shardKey = `${POS_CLIENT_TELEMETRY_STORAGE_KEY}:event:${clientEventId}`;
    try {
      window.localStorage.setItem(
        shardKey,
        JSON.stringify(storedV2Event(clientEventId, now)),
      );
      window.localStorage.setItem(tombstoneKey, String(now - 10));
      for (
        let index = 0;
        index < POS_CLIENT_TELEMETRY_MAX_REMOVAL_TOMBSTONES;
        index += 1
      ) {
        window.localStorage.setItem(
          `${POS_CLIENT_TELEMETRY_STORAGE_KEY}:removed:newer-${index}`,
          String(now + index),
        );
      }
      storage.denyArtifactDeletionFor(clientEventId);

      expect(
        peekPosClientEventBatch(250).some(
          (event) => event.clientEventId === clientEventId,
        ),
      ).toBe(false);
      expect(window.localStorage.getItem(tombstoneKey)).not.toBeNull();
      expect(window.localStorage.getItem(shardKey)).not.toBeNull();
    } finally {
      storage.restore();
    }
  });

  it("orders cross-tab shards by occurrence and evicts the true oldest row", () => {
    const storage = installMemoryStorage();
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    for (let index = 0; index < 200; index += 1) {
      const clientEventId = `older-${String(index).padStart(3, "0")}`;
      window.localStorage.setItem(
        `${POS_CLIENT_TELEMETRY_STORAGE_KEY}:event:${clientEventId}`,
        JSON.stringify(storedV2Event(clientEventId, 1_000 + index)),
      );
    }
    window.localStorage.setItem(
      POS_CLIENT_TELEMETRY_STORAGE_KEY,
      JSON.stringify([
        {
          clientEventId: "legacy-oldest",
          level: "error",
          flow: "checkout",
          message: "legacy quarantine",
          occurredAt: 500,
          metadata: {},
        },
      ]),
    );

    enqueuePosClientEvent({
      level: "warn",
      classification: "continuity_warning",
    });
    resetPosClientTelemetryBufferForTests();
    const rows = peekPosClientEventBatch(205);

    expect(rows).toHaveLength(200);
    expect(rows[0].clientEventId).toBe("older-001");
    expect(rows.at(-1)?.version).toBe(2);
    expect(
      window.localStorage.getItem(
        `${POS_CLIENT_TELEMETRY_STORAGE_KEY}:event:older-000`,
      ),
    ).toBeNull();
    expect(
      window.localStorage.getItem(POS_CLIENT_TELEMETRY_STORAGE_KEY),
    ).toBeNull();
    storage.restore();
    vi.useRealTimers();
  });

  it("breaks identical occurrence-time ties by client event id", () => {
    const storage = installMemoryStorage();
    const occurredAt = Date.now();
    for (const clientEventId of ["event-z", "event-a"]) {
      window.localStorage.setItem(
        `${POS_CLIENT_TELEMETRY_STORAGE_KEY}:event:${clientEventId}`,
        JSON.stringify(storedV2Event(clientEventId, occurredAt)),
      );
    }

    expect(
      peekPosClientEventBatch(10).map((event) => event.clientEventId),
    ).toEqual(["event-a", "event-z"]);
    storage.restore();
  });

  it("merges an event already queued by another tab", () => {
    const storage = installMemoryStorage();
    const now = Date.now();
    const external = storedV2Event("other-tab-event", now);
    window.localStorage.setItem(
      `${POS_CLIENT_TELEMETRY_STORAGE_KEY}:event:${external.clientEventId}`,
      JSON.stringify(external),
    );

    enqueuePosClientEvent({
      level: "warn",
      classification: "continuity_warning",
    });
    resetPosClientTelemetryBufferForTests();

    expect(
      peekPosClientEventBatch(10).map((event) => event.clientEventId),
    ).toEqual(expect.arrayContaining(["other-tab-event", expect.any(String)]));
    storage.restore();
  });

  it("keeps both events when another tab appends during this tab's write", () => {
    const storage = installMemoryStorage();
    const external = storedV2Event("other-tab-event", Date.now());
    storage.beforeNextEventWrite(() => {
      window.localStorage.setItem(
        `${POS_CLIENT_TELEMETRY_STORAGE_KEY}:event:${external.clientEventId}`,
        JSON.stringify(external),
      );
    });

    enqueuePosClientEvent({
      level: "warn",
      classification: "continuity_warning",
    });
    resetPosClientTelemetryBufferForTests();

    expect(
      peekPosClientEventBatch(10).map((event) => event.clientEventId),
    ).toEqual(expect.arrayContaining(["other-tab-event", expect.any(String)]));
    expect(peekPosClientEventBatch(10)).toHaveLength(2);
    storage.restore();
  });

  it("removes drained events by id and keeps the rest", () => {
    enqueuePosClientEvent({
      level: "warn",
      classification: "continuity_warning",
    });
    enqueuePosClientEvent({
      level: "error",
      classification: "route_render_error",
    });
    const first = peekPosClientEventBatch(10).find(
      (event) =>
        event.version === 2 && event.classification === "continuity_warning",
    );
    if (!first) throw new Error("expected continuity event");
    removePosClientEvents([first.clientEventId]);
    const remaining = peekPosClientEventBatch(10);
    expect(remaining).toHaveLength(1);
    if (remaining[0].version !== 2) throw new Error("expected v2 event");
    expect(remaining[0].classification).toBe("route_render_error");
  });

  it("deletes an acknowledged shard even when tombstone allocation is at quota", () => {
    const storage = installMemoryStorage();
    enqueuePosClientEvent({
      level: "error",
      classification: "unexpected_application_error",
    });
    const [event] = peekPosClientEventBatch(1);
    const shardKey = `${POS_CLIENT_TELEMETRY_STORAGE_KEY}:event:${event.clientEventId}`;
    expect(window.localStorage.getItem(shardKey)).not.toBeNull();

    storage.failNextTombstoneWrite();
    removePosClientEvents([event.clientEventId]);
    expect(window.localStorage.getItem(shardKey)).toBeNull();
    resetPosClientTelemetryBufferForTests();
    expect(peekPosClientEventBatch(10)).toEqual([]);
    storage.restore();
  });

  it("durably binds and upgrades a pending event to its first terminal", async () => {
    const storage = installMemoryStorage();
    const identityGeneration = readPosTerminalIdentityGeneration();
    const shardKey = `${POS_CLIENT_TELEMETRY_STORAGE_KEY}:event:pending-event`;
    window.localStorage.setItem(
      shardKey,
      JSON.stringify({
        version: 2,
        clientEventId: "pending-event",
        level: "error",
        flow: "checkout",
        classification: "unexpected_application_error",
        occurredAt: Date.now(),
        orgUrlSlug: "acme",
        storeUrlSlug: "central",
        routeId: "register",
        occurrenceContextToken: "test-owner",
        terminalIdentityGeneration: identityGeneration,
        online: true,
        metadata: {},
      }),
    );
    const originalShard = window.localStorage.getItem(shardKey);
    const unregister = registerPosTelemetryContext("test-owner", {
      orgUrlSlug: "acme",
      storeUrlSlug: "central",
      storeId: "store-1",
      telemetryIdentityEpoch: "epoch-1",
      reportedCloudTerminalId: "terminal-1",
    });

    expect(peekPosClientEventBatch(1)[0]).toMatchObject({
      storeId: "store-1",
      reportedCloudTerminalId: "terminal-1",
    });
    expect(window.localStorage.getItem(shardKey)).toBe(originalShard);
    expect(originalShard).not.toContain("terminal-1");
    const bindingKey = `${POS_CLIENT_TELEMETRY_STORAGE_KEY}:occurrence:pending-event`;
    expect(window.localStorage.getItem(bindingKey)).toContain("terminal-1");
    await flushPosTelemetryWitnessUpgradesForTests();
    expect(readPosTelemetryOccurrenceWitness("pending-event")).toEqual(
      expect.objectContaining({
        version: 2,
        clientEventId: "pending-event",
        storeId: "store-1",
        reportedCloudTerminalId: "terminal-1",
      }),
    );

    resetPosClientTelemetryBufferForTests();
    unregister();
    const unregisterReprovisioned = registerPosTelemetryContext(
      "test-owner-2",
      {
        orgUrlSlug: "acme",
        storeUrlSlug: "central",
        storeId: "store-1",
        reportedCloudTerminalId: "terminal-2",
      },
    );
    expect(peekPosClientEventBatch(1)[0]).toMatchObject({
      storeId: "store-1",
      reportedCloudTerminalId: "terminal-1",
    });
    expect(window.localStorage.getItem(bindingKey)).toContain("terminal-1");

    removePosClientEvents(["pending-event"]);
    expect(window.localStorage.getItem(bindingKey)).toBeNull();
    unregisterReprovisioned();
    storage.restore();
  });

  it("fails closed when the first occurrence binding cannot be persisted", () => {
    const storage = installMemoryStorage();
    const identityGeneration = readPosTerminalIdentityGeneration();
    const shardKey = `${POS_CLIENT_TELEMETRY_STORAGE_KEY}:event:binding-denied`;
    window.localStorage.setItem(
      shardKey,
      JSON.stringify({
        ...storedV2Event("binding-denied", Date.now()),
        occurrenceContextToken: "terminal-1-generation",
        terminalIdentityGeneration: identityGeneration,
        reportedCloudTerminalId: undefined,
      }),
    );
    const unregister = registerPosTelemetryContext("terminal-1-generation", {
      orgUrlSlug: "acme",
      storeUrlSlug: "central",
      storeId: "store-1",
      reportedCloudTerminalId: "terminal-1",
    });
    storage.failNextOccurrenceBindingWrite();

    expect(peekPosClientEventBatch(1)[0]).not.toHaveProperty(
      "reportedCloudTerminalId",
    );
    resetPosClientTelemetryBufferForTests();
    unregister();
    const unregisterReprovisioned = registerPosTelemetryContext(
      "terminal-2-generation",
      {
        orgUrlSlug: "acme",
        storeUrlSlug: "central",
        storeId: "store-1",
        reportedCloudTerminalId: "terminal-2",
      },
    );

    expect(peekPosClientEventBatch(1)[0]).not.toHaveProperty(
      "reportedCloudTerminalId",
    );
    expect(
      window.localStorage.getItem(
        `${POS_CLIENT_TELEMETRY_STORAGE_KEY}:occurrence:binding-denied`,
      ),
    ).toBeNull();
    unregisterReprovisioned();
    storage.restore();
  });

  it("allows only the captured generation to establish the first binding", () => {
    const storage = installMemoryStorage();
    const identityGeneration = readPosTerminalIdentityGeneration();
    window.localStorage.setItem(
      `${POS_CLIENT_TELEMETRY_STORAGE_KEY}:event:generation-fenced`,
      JSON.stringify({
        ...storedV2Event("generation-fenced", Date.now()),
        occurrenceContextToken: "generation-1",
        terminalIdentityGeneration: identityGeneration,
        reportedCloudTerminalId: undefined,
      }),
    );
    const unregisterSecond = registerPosTelemetryContext("generation-2", {
      orgUrlSlug: "acme",
      storeUrlSlug: "central",
      storeId: "store-1",
      reportedCloudTerminalId: "terminal-2",
    });
    expect(peekPosClientEventBatch(1)[0]).not.toHaveProperty(
      "reportedCloudTerminalId",
    );
    unregisterSecond();

    const unregisterFirst = registerPosTelemetryContext("generation-1", {
      orgUrlSlug: "acme",
      storeUrlSlug: "central",
      storeId: "store-1",
      reportedCloudTerminalId: "terminal-1",
    });
    expect(peekPosClientEventBatch(1)[0]).toMatchObject({
      reportedCloudTerminalId: "terminal-1",
    });
    unregisterFirst();

    const unregisterReplacement = registerPosTelemetryContext("generation-2", {
      orgUrlSlug: "acme",
      storeUrlSlug: "central",
      storeId: "store-1",
      reportedCloudTerminalId: "terminal-2",
    });
    expect(peekPosClientEventBatch(1)[0]).toMatchObject({
      reportedCloudTerminalId: "terminal-1",
    });
    unregisterReplacement();
    storage.restore();
  });

  it("lets only this document's host claim its bootstrap event", () => {
    const storage = installMemoryStorage();
    const identityGeneration = readPosTerminalIdentityGeneration();
    const bootstrapGeneration = getPosTelemetryDocumentBootstrapGeneration();
    window.localStorage.setItem(
      `${POS_CLIENT_TELEMETRY_STORAGE_KEY}:event:bootstrap-event`,
      JSON.stringify({
        ...storedV2Event("bootstrap-event", Date.now()),
        occurrenceContextToken: bootstrapGeneration,
        terminalIdentityGeneration: identityGeneration,
        storeId: undefined,
        reportedCloudTerminalId: undefined,
      }),
    );
    const unregisterMismatch = registerPosTelemetryContext("other-document", {
      orgUrlSlug: "acme",
      storeUrlSlug: "central",
      storeId: "store-1",
      reportedCloudTerminalId: "terminal-2",
    });
    expect(peekPosClientEventBatch(1)[0]).not.toHaveProperty("storeId");
    unregisterMismatch();

    const unregisterMatch = registerPosTelemetryContext(bootstrapGeneration, {
      orgUrlSlug: "acme",
      storeUrlSlug: "central",
      storeId: "store-1",
      reportedCloudTerminalId: "terminal-1",
    });
    expect(peekPosClientEventBatch(1)[0]).toMatchObject({
      occurrenceContextToken: bootstrapGeneration,
      storeId: "store-1",
      reportedCloudTerminalId: "terminal-1",
    });
    resetPosClientTelemetryBufferForTests();
    unregisterMatch();
    const unregisterReplacement = registerPosTelemetryContext("later-owner", {
      orgUrlSlug: "acme",
      storeUrlSlug: "central",
      storeId: "store-1",
      reportedCloudTerminalId: "terminal-2",
    });
    expect(peekPosClientEventBatch(1)[0]).toMatchObject({
      occurrenceContextToken: bootstrapGeneration,
      reportedCloudTerminalId: "terminal-1",
    });
    unregisterReplacement();
    storage.restore();
  });

  it("drops non-primitive metadata values and truncates long strings", () => {
    enqueuePosClientEvent({
      level: "warn",
      classification: "unhandled_promise_rejection",
      operation: "promise_runtime",
      metadata: {
        nested: { not: "allowed" },
        printCorrelation: "matched",
        printAttemptId: "attempt-1",
        customer: "must-drop",
        infinite: Number.POSITIVE_INFINITY,
      },
    });
    const [event] = peekPosClientEventBatch(1);
    expect(event.metadata).toEqual({
      printCorrelation: "matched",
      printAttemptId: "attempt-1",
    });
  });

  it("falls back to memory when localStorage throws", () => {
    const setItem = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("quota exceeded");
      });
    try {
      enqueuePosClientEvent({
        level: "error",
        classification: "unexpected_application_error",
      });
      expect(posClientTelemetryBufferSize()).toBe(1);
      const [event] = peekPosClientEventBatch(1);
      if (event.version !== 2) throw new Error("expected v2 event");
      expect(event.classification).toBe("unexpected_application_error");
    } finally {
      setItem.mockRestore();
    }
  });

  it("does not serialize non-Error thrown values", () => {
    enqueuePosClientEvent({
      level: "error",
      classification: "unexpected_application_error",
      error: { customer: "customer@example.com", token: "secret" },
    });
    expect(peekPosClientEventBatch(1)[0]).not.toHaveProperty("errorMessage");
    expect(JSON.stringify(peekPosClientEventBatch(1)[0])).not.toContain(
      "customer@example.com",
    );
  });

  it("keeps valid legacy rows in a sanitized non-deliverable quarantine", () => {
    const storage = installMemoryStorage();
    window.localStorage.setItem(
      POS_CLIENT_TELEMETRY_STORAGE_KEY,
      JSON.stringify([
        {
          clientEventId: "legacy-1",
          level: "error",
          flow: "checkout",
          message: "unsafe legacy message",
          occurredAt: Date.now(),
          metadata: { customer: "unsafe" },
        },
        { malformed: true },
      ]),
    );

    expect(peekPosClientEventBatch(10)).toEqual([
      expect.objectContaining({
        clientEventId: "legacy-1",
        message: "legacy_client_event",
        metadata: {},
      }),
    ]);
    expect(
      window.localStorage.getItem(POS_CLIENT_TELEMETRY_STORAGE_KEY),
    ).toBeNull();
    const quarantined = window.localStorage.getItem(
      `${POS_CLIENT_TELEMETRY_STORAGE_KEY}:quarantine:legacy-1`,
    );
    expect(quarantined).toContain("legacy_client_event");
    expect(quarantined).not.toContain("unsafe legacy message");
    expect(
      window.localStorage.getItem(
        `${POS_CLIENT_TELEMETRY_STORAGE_KEY}:event:legacy-1`,
      ),
    ).toBeNull();
    expect(
      snapshotPosRuntimeCounters()["telemetry.legacyQuarantineCount"],
    ).toBe(1);
    expect(snapshotPosRuntimeCounters()["telemetry.droppedCount"]).toBe(1);
    storage.restore();
  });

  it("retains the exact 30-day boundary and removes strictly older rows", () => {
    const storage = installMemoryStorage();
    vi.useFakeTimers();
    const now = 1_800_000_000_000;
    vi.setSystemTime(now);
    const boundary = storedV2Event(
      "boundary",
      now - POS_CLIENT_TELEMETRY_RETENTION_MS,
    );
    window.localStorage.setItem(
      `${POS_CLIENT_TELEMETRY_STORAGE_KEY}:event:expired-shard`,
      JSON.stringify({
        ...boundary,
        clientEventId: "expired-shard",
        occurredAt: boundary.occurredAt - 1,
      }),
    );
    window.localStorage.setItem(
      `${POS_CLIENT_TELEMETRY_STORAGE_KEY}:event:${boundary.clientEventId}`,
      JSON.stringify(boundary),
    );
    window.localStorage.setItem(
      POS_CLIENT_TELEMETRY_STORAGE_KEY,
      JSON.stringify([
        {
          clientEventId: "legacy-boundary",
          level: "error",
          flow: "checkout",
          message: "legacy",
          occurredAt: boundary.occurredAt,
          metadata: {},
        },
        {
          clientEventId: "legacy-expired",
          level: "error",
          flow: "checkout",
          message: "legacy",
          occurredAt: boundary.occurredAt - 1,
          metadata: {},
        },
      ]),
    );

    try {
      expect(
        peekPosClientEventBatch(10).map((row) => row.clientEventId),
      ).toEqual(["boundary", "legacy-boundary"]);
      expect(
        window.localStorage.getItem(
          `${POS_CLIENT_TELEMETRY_STORAGE_KEY}:event:expired-shard`,
        ),
      ).toBeNull();
      expect(
        window.localStorage.getItem(
          `${POS_CLIENT_TELEMETRY_STORAGE_KEY}:event:boundary`,
        ),
      ).not.toBeNull();
      const quarantine = window.localStorage.getItem(
        `${POS_CLIENT_TELEMETRY_STORAGE_KEY}:quarantine:legacy-boundary`,
      );
      expect(quarantine).toContain("legacy-boundary");
      expect(
        window.localStorage.getItem(
          `${POS_CLIENT_TELEMETRY_STORAGE_KEY}:quarantine:legacy-expired`,
        ),
      ).toBeNull();
    } finally {
      storage.restore();
      vi.useRealTimers();
    }
  });

  it("deletes unsafe legacy storage when every safe write is denied", () => {
    const storage = installMemoryStorage();
    window.localStorage.setItem(
      POS_CLIENT_TELEMETRY_STORAGE_KEY,
      JSON.stringify([
        {
          clientEventId: "legacy-denied",
          level: "error",
          flow: "checkout",
          message: "customer-secret token",
          occurredAt: Date.now(),
          metadata: { customer: "customer-secret" },
        },
      ]),
    );
    storage.denySetItemWrites();

    expect(peekPosClientEventBatch(10)).toHaveLength(1);
    expect(
      window.localStorage.getItem(POS_CLIENT_TELEMETRY_STORAGE_KEY),
    ).toBeNull();
    resetPosClientTelemetryBufferForTests();
    expect(peekPosClientEventBatch(10)).toEqual([]);
    storage.restore();
  });

  it("cannot resurrect a removed row from a concurrent legacy-array cleanup", () => {
    const storage = installMemoryStorage();
    window.localStorage.setItem(
      POS_CLIENT_TELEMETRY_STORAGE_KEY,
      JSON.stringify([
        {
          clientEventId: "legacy-concurrent",
          level: "error",
          flow: "checkout",
          message: "legacy secret",
          occurredAt: Date.now(),
          metadata: {},
        },
      ]),
    );
    storage.beforeNextLegacyRead(() => {
      storage.failNextTombstoneWrite();
      removePosClientEvents(["legacy-concurrent"]);
    });

    expect(peekPosClientEventBatch(10)).toEqual([]);
    resetPosClientTelemetryBufferForTests();
    expect(peekPosClientEventBatch(10)).toEqual([]);
    expect(
      window.localStorage.getItem(
        `${POS_CLIENT_TELEMETRY_STORAGE_KEY}:event:legacy-concurrent`,
      ),
    ).toBeNull();
    storage.restore();
  });

  it("keeps a stale restored quarantine shard removed after the ring drains below capacity", () => {
    const storage = installMemoryStorage();
    const now = Date.now();
    const restoredLegacy = {
      clientEventId: "legacy-restored",
      level: "error",
      flow: "checkout",
      message: "legacy_client_event",
      occurredAt: now - 1,
      metadata: {},
    };
    for (let index = 0; index < 200; index += 1) {
      const clientEventId = `current-${String(index).padStart(3, "0")}`;
      window.localStorage.setItem(
        `${POS_CLIENT_TELEMETRY_STORAGE_KEY}:event:${clientEventId}`,
        JSON.stringify(storedV2Event(clientEventId, now + index)),
      );
    }
    const quarantineKey = `${POS_CLIENT_TELEMETRY_STORAGE_KEY}:quarantine:legacy-restored`;
    window.localStorage.setItem(quarantineKey, JSON.stringify(restoredLegacy));
    storage.failNextTombstoneWrite();

    expect(peekPosClientEventBatch(250)).toHaveLength(200);
    expect(window.localStorage.getItem(quarantineKey)).toBeNull();

    const drainedIds = peekPosClientEventBatch(50).map(
      (event) => event.clientEventId,
    );
    removePosClientEvents(drainedIds);

    // Equivalent to an independent tab resuming with its stale sanitized row
    // after the eviction tab's first tombstone allocation failed and newer
    // rows have since drained below ring capacity.
    window.localStorage.setItem(quarantineKey, JSON.stringify(restoredLegacy));
    resetPosClientTelemetryBufferForTests();
    const afterRestore = peekPosClientEventBatch(250);
    expect(afterRestore).toHaveLength(150);
    expect(
      afterRestore.some((event) => event.clientEventId === "legacy-restored"),
    ).toBe(false);
    expect(window.localStorage.getItem(quarantineKey)).toBeNull();
    storage.restore();
  });
});

function storedV2Event(clientEventId: string, occurredAt: number) {
  return {
    version: 2 as const,
    clientEventId,
    level: "error" as const,
    flow: "checkout" as const,
    classification: "unexpected_application_error" as const,
    occurredAt,
    orgUrlSlug: "acme",
    storeUrlSlug: "central",
    routeId: "register" as const,
    online: true,
    storeId: "store-1",
    reportedCloudTerminalId: "terminal-1",
    metadata: {},
  };
}

function installMemoryStorage() {
  const values = new Map<string, string>();
  let beforeEventWrite: (() => void) | undefined;
  let beforeLegacyRead: (() => void) | undefined;
  let failNextTombstoneWrite = false;
  let failNextOccurrenceBindingWrite = false;
  let denySetItemWrites = false;
  let artifactDeletionDeniedFor: string | undefined;
  let onEventRead: ((clientEventId: string) => void) | undefined;
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
    .mockImplementation((key) => {
      if (key.startsWith(`${POS_CLIENT_TELEMETRY_STORAGE_KEY}:event:`)) {
        onEventRead?.(
          key.slice(`${POS_CLIENT_TELEMETRY_STORAGE_KEY}:event:`.length),
        );
      }
      if (beforeLegacyRead && key === POS_CLIENT_TELEMETRY_STORAGE_KEY) {
        const action = beforeLegacyRead;
        beforeLegacyRead = undefined;
        action();
      }
      return values.get(key) ?? null;
    });
  const setItem = vi
    .spyOn(window.localStorage, "setItem")
    .mockImplementation((key, value) => {
      if (denySetItemWrites) throw new Error("storage writes denied");
      if (
        artifactDeletionDeniedFor &&
        key.endsWith(artifactDeletionDeniedFor) &&
        value === ""
      ) {
        throw new Error("artifact clearing denied");
      }
      if (
        failNextTombstoneWrite &&
        key.startsWith(`${POS_CLIENT_TELEMETRY_STORAGE_KEY}:removed:`)
      ) {
        failNextTombstoneWrite = false;
        throw new Error("quota exceeded");
      }
      if (
        failNextOccurrenceBindingWrite &&
        key.startsWith(`${POS_CLIENT_TELEMETRY_STORAGE_KEY}:occurrence:`)
      ) {
        failNextOccurrenceBindingWrite = false;
        throw new Error("quota exceeded");
      }
      if (
        beforeEventWrite &&
        key.startsWith(`${POS_CLIENT_TELEMETRY_STORAGE_KEY}:event:`)
      ) {
        const action = beforeEventWrite;
        beforeEventWrite = undefined;
        action();
      }
      values.set(key, value);
    });
  const removeItem = vi
    .spyOn(window.localStorage, "removeItem")
    .mockImplementation((key) => {
      if (artifactDeletionDeniedFor && key.endsWith(artifactDeletionDeniedFor))
        return;
      values.delete(key);
    });
  Object.defineProperty(window.localStorage, "key", {
    configurable: true,
    value: (index: number) => [...values.keys()][index] ?? null,
  });
  Object.defineProperty(window.localStorage, "length", {
    configurable: true,
    get: () => values.size,
  });
  return {
    keys() {
      return [...values.keys()];
    },
    beforeNextEventWrite(action: () => void) {
      beforeEventWrite = action;
    },
    beforeNextLegacyRead(action: () => void) {
      beforeLegacyRead = action;
    },
    failNextTombstoneWrite() {
      failNextTombstoneWrite = true;
    },
    failNextOccurrenceBindingWrite() {
      failNextOccurrenceBindingWrite = true;
    },
    denySetItemWrites() {
      denySetItemWrites = true;
    },
    denyArtifactDeletionFor(clientEventId: string) {
      artifactDeletionDeniedFor = clientEventId;
    },
    onEventRead(action: (clientEventId: string) => void) {
      onEventRead = action;
    },
    restore() {
      getItem.mockRestore();
      setItem.mockRestore();
      removeItem.mockRestore();
      if (originalKey) {
        Object.defineProperty(window.localStorage, "key", originalKey);
      } else {
        Reflect.deleteProperty(window.localStorage, "key");
      }
      if (originalLength) {
        Object.defineProperty(window.localStorage, "length", originalLength);
      } else {
        Reflect.deleteProperty(window.localStorage, "length");
      }
    },
  };
}
