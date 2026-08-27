import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PosClientTelemetryV2Event } from "./telemetryBuffer";
import {
  resetPosRuntimeCounters,
  snapshotPosRuntimeCounters,
} from "./runtimeCounters";

const mocks = vi.hoisted(() => ({
  enqueue: vi.fn(),
  events: [] as PosClientTelemetryV2Event[],
  remove: vi.fn(),
  recordClientEvents: vi.fn(),
  readSeed: vi.fn(),
  readWitness: vi.fn(),
  fingerprint: "fp-1" as string | null,
  transition: {
    generation: "pos-identity-coordinated-generation",
    phase: "changed" as const,
    ownerDocumentId: "pos-bootstrap-test-document",
    revision: 1,
    startedAt: 1,
    updatedAt: 1,
  },
  sink: null as null | ((report: Record<string, unknown>) => void),
}));

vi.mock("convex/react", () => ({
  useMutation: () => mocks.recordClientEvents,
}));
vi.mock("@/lib/pos/application/errorTelemetry", () => ({
  setPosErrorTelemetrySink: (sink: typeof mocks.sink) => {
    mocks.sink = sink;
  },
}));
vi.mock("@/lib/pos/infrastructure/local/posLocalStorageRuntime", () => ({
  getDefaultPosLocalStore: () => ({
    readProvisionedTerminalSeed: mocks.readSeed,
  }),
}));
vi.mock("@/lib/pos/infrastructure/terminal/fingerprint", () => ({
  readStoredTerminalFingerprintHash: () => mocks.fingerprint,
}));
vi.mock("./telemetryContext", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./telemetryContext")>()),
  readPosTerminalIdentityTransition: () => ({ ...mocks.transition }),
}));
vi.mock("./telemetryBuffer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./telemetryBuffer")>();
  return {
    ...actual,
    enqueuePosClientEvent: mocks.enqueue,
    peekPosClientEventBatch: () => mocks.events,
    readPosTelemetryOccurrenceWitness: mocks.readWitness,
    removePosClientEvents: mocks.remove,
  };
});

import {
  POS_CLIENT_TELEMETRY_BACKOFF_STORAGE_KEY,
  selectOldestEligiblePosTelemetryScope,
  resetPosClientTelemetryBackoffForTests,
  usePosClientTelemetryDrain,
} from "./usePosClientTelemetryDrain";

function event(
  overrides: Partial<PosClientTelemetryV2Event> = {},
): PosClientTelemetryV2Event {
  return {
    version: 2,
    clientEventId: "event-1",
    level: "error",
    flow: "register",
    classification: "unexpected_application_error",
    occurredAt: 1,
    orgUrlSlug: "acme",
    storeUrlSlug: "central",
    routeId: "register",
    occurrenceContextToken: "pos-context-test-owner",
    online: false,
    storeId: "store-1",
    terminalIdentityGeneration: "pos-identity-coordinated-generation",
    reportedCloudTerminalId: "terminal-1",
    reportedTerminalFingerprint: "fp-1",
    metadata: {},
    ...overrides,
  };
}

function occurrenceWitness(candidate: PosClientTelemetryV2Event) {
  return {
    version: 2 as const,
    clientEventId: candidate.clientEventId,
    storeId: candidate.storeId as string,
    occurrenceContextToken: candidate.occurrenceContextToken as string,
    terminalIdentityGeneration: candidate.terminalIdentityGeneration as string,
    telemetryIdentityEpoch: candidate.telemetryIdentityEpoch as string,
    reportedCloudTerminalId: candidate.reportedCloudTerminalId,
    reportedTerminalFingerprint: candidate.reportedTerminalFingerprint,
    transitionRevision: 1,
    transitionStartedAt: 1,
  };
}

describe("scoped POS telemetry drain", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    resetPosClientTelemetryBackoffForTests();
    resetPosRuntimeCounters();
    mocks.events = [];
    mocks.sink = null;
    mocks.fingerprint = "fp-1";
    mocks.transition = {
      generation: "pos-identity-coordinated-generation",
      phase: "changed",
      ownerDocumentId: "pos-bootstrap-test-document",
      revision: 1,
      startedAt: 1,
      updatedAt: 1,
    };
    mocks.readSeed.mockResolvedValue({
      ok: true,
      value: { cloudTerminalId: "terminal-1", storeId: "store-1" },
    });
    mocks.readWitness.mockImplementation((clientEventId: string) => {
      const candidate = mocks.events.find(
        (item) => item.clientEventId === clientEventId,
      );
      if (
        !candidate?.storeId ||
        !candidate.occurrenceContextToken ||
        !candidate.terminalIdentityGeneration
      )
        return undefined;
      return {
        version: 2,
        clientEventId,
        storeId: candidate.storeId,
        occurrenceContextToken: candidate.occurrenceContextToken,
        terminalIdentityGeneration: candidate.terminalIdentityGeneration,
        telemetryIdentityEpoch: candidate.telemetryIdentityEpoch,
        reportedCloudTerminalId: candidate.reportedCloudTerminalId,
        reportedTerminalFingerprint: candidate.reportedTerminalFingerprint,
        transitionRevision: 1,
        transitionStartedAt: 1,
      };
    });
    mocks.remove.mockImplementation((ids: string[]) => {
      const removed = new Set(ids);
      mocks.events = mocks.events.filter(
        (candidate) => !removed.has(candidate.clientEventId),
      );
    });
    mocks.recordClientEvents.mockResolvedValue({
      kind: "ok",
      data: { accepted: 1, duplicates: 0 },
    });
    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      value: true,
    });
  });

  afterEach(cleanup);

  it("selects only the oldest eligible occurrence scope", () => {
    const result = selectOldestEligiblePosTelemetryScope({
      events: [
        event(),
        event({ clientEventId: "event-2", storeId: "store-2" }),
        event({ clientEventId: "event-3" }),
      ],
      backoffByScope: new Map(),
      now: 100,
    });
    expect(result?.events.map((row) => row.clientEventId)).toEqual([
      "event-1",
      "event-3",
    ]);
  });

  it("skips a backed-off scope without relabeling it", () => {
    const result = selectOldestEligiblePosTelemetryScope({
      events: [
        event(),
        event({ clientEventId: "event-2", storeId: "store-2" }),
      ],
      backoffByScope: new Map([
        [
          "store-1|terminal-1|fp-1|pos-identity-coordinated-generation|none",
          101,
        ],
      ]),
      now: 100,
    });
    expect(result?.events[0].storeId).toBe("store-2");
  });

  it("keeps same-terminal generations in independent scopes and backoffs", () => {
    const historicalGeneration = "pos-identity-historical-generation";
    const currentGeneration = "pos-identity-coordinated-generation";
    const result = selectOldestEligiblePosTelemetryScope({
      events: [
        event({
          clientEventId: "event-historical",
          terminalIdentityGeneration: historicalGeneration,
        }),
        event({
          clientEventId: "event-current",
          terminalIdentityGeneration: currentGeneration,
        }),
      ],
      backoffByScope: new Map([
        [`store-1|terminal-1|fp-1|${historicalGeneration}|none`, 101],
      ]),
      now: 100,
    });

    expect(result?.scopeKey).toBe(
      `store-1|terminal-1|fp-1|${currentGeneration}|none`,
    );
    expect(result?.events.map((row) => row.clientEventId)).toEqual([
      "event-current",
    ]);
  });

  it("removes only a fully acknowledged scope batch", async () => {
    mocks.events = [event({ telemetryIdentityEpoch: "epoch-1" })];
    mocks.readSeed.mockResolvedValue({
      ok: true,
      value: {
        cloudTerminalId: "terminal-1",
        storeId: "store-1",
        telemetryIdentityEpoch: "epoch-1",
      },
    });
    renderHook(() => usePosClientTelemetryDrain());

    await waitFor(() =>
      expect(mocks.recordClientEvents).toHaveBeenCalledTimes(1),
    );
    expect(mocks.recordClientEvents).toHaveBeenCalledWith(
      expect.objectContaining({
        storeId: "store-1",
        terminalId: "terminal-1",
        terminalFingerprint: "fp-1",
      }),
    );
    expect(mocks.remove).toHaveBeenCalledWith(["event-1"]);
    expect(JSON.stringify(mocks.recordClientEvents.mock.calls[0]?.[0])).not.toContain(
      "telemetryIdentityEpoch",
    );
  });

  it.each([
    [undefined, "epoch-2"],
    ["epoch-1", undefined],
  ])(
    "defers current evidence when event epoch %s and seed epoch %s differ",
    async (eventEpoch, seedEpoch) => {
      mocks.events = [event({ telemetryIdentityEpoch: eventEpoch })];
      mocks.readSeed.mockResolvedValue({
        ok: true,
        value: {
          cloudTerminalId: "terminal-1",
          storeId: "store-1",
          ...(seedEpoch ? { telemetryIdentityEpoch: seedEpoch } : {}),
        },
      });

      renderHook(() => usePosClientTelemetryDrain());
      await waitFor(() => expect(mocks.readSeed).toHaveBeenCalledTimes(1));
      expect(mocks.recordClientEvents).not.toHaveBeenCalled();
      expect(mocks.remove).not.toHaveBeenCalled();
    },
  );

  it("holds reload evidence until terminal identity resolution completes", async () => {
    mocks.events = [event({ reportedCloudTerminalId: undefined })];
    const view = renderHook(
      ({ identityReady }) => usePosClientTelemetryDrain({ identityReady }),
      { initialProps: { identityReady: false } },
    );

    await act(async () => Promise.resolve());
    expect(mocks.recordClientEvents).not.toHaveBeenCalled();

    view.rerender({ identityReady: true });
    await waitFor(() =>
      expect(mocks.recordClientEvents).toHaveBeenCalledTimes(1),
    );
  });

  it("quarantines a T1 batch when authoritative seed is already T2 despite missed transition signaling", async () => {
    mocks.events = [event()];
    mocks.readSeed.mockResolvedValue({
      ok: true,
      value: { cloudTerminalId: "terminal-2", storeId: "store-1" },
    });
    const refreshRequested = vi.fn();
    window.addEventListener(
      "athena:pos-terminal-identity-refresh-request",
      refreshRequested,
    );
    try {
      renderHook(() => usePosClientTelemetryDrain({ identityReady: true }));
      await waitFor(() => expect(mocks.readSeed).toHaveBeenCalledTimes(1));

      expect(mocks.recordClientEvents).not.toHaveBeenCalled();
      expect(mocks.remove).not.toHaveBeenCalled();
      expect(mocks.events).toHaveLength(1);
      expect(refreshRequested).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener(
        "athena:pos-terminal-identity-refresh-request",
        refreshRequested,
      );
    }
  });

  it("quarantines a terminal batch when its recorded fingerprint is no longer current", async () => {
    mocks.events = [event()];
    mocks.fingerprint = "fp-2";
    renderHook(() => usePosClientTelemetryDrain({ identityReady: true }));
    await waitFor(() => expect(mocks.readSeed).toHaveBeenCalledTimes(1));

    expect(mocks.recordClientEvents).not.toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it("uploads immutable storage-failure evidence when the authority seed read also fails", async () => {
    mocks.events = [
      event({
        classification: "local_storage_transaction_failed",
        operation: "readProvisionedTerminalSeed",
        telemetryIdentityEpoch: "epoch-1",
      }),
    ];
    mocks.readSeed.mockResolvedValue({
      ok: false,
      error: {
        code: "read_failed",
        message: "Local POS data could not be read.",
      },
    });

    renderHook(() => usePosClientTelemetryDrain({ identityReady: true }));
    await waitFor(() =>
      expect(mocks.recordClientEvents).toHaveBeenCalledTimes(1),
    );

    expect(mocks.recordClientEvents).toHaveBeenCalledWith(
      expect.objectContaining({
        storeId: "store-1",
        terminalId: "terminal-1",
        terminalFingerprint: "fp-1",
      }),
    );
    expect(snapshotPosRuntimeCounters()).toMatchObject({
      "telemetry.identityRefreshFailureCount": 1,
      "telemetry.lastIdentityRefreshFailureAt": expect.any(Number),
    });
  });

  it("uploads store-level batches from current and completed historical generations", async () => {
    mocks.events = [
      event({
        reportedCloudTerminalId: undefined,
        reportedTerminalFingerprint: undefined,
      }),
    ];
    renderHook(() => usePosClientTelemetryDrain({ identityReady: true }));
    await waitFor(() =>
      expect(mocks.recordClientEvents).toHaveBeenCalledTimes(1),
    );

    cleanup();
    vi.clearAllMocks();
    mocks.events = [
      event({
        clientEventId: "event-stale-generation",
        reportedCloudTerminalId: undefined,
        reportedTerminalFingerprint: undefined,
        terminalIdentityGeneration: "pos-identity-stale-generation",
        telemetryIdentityEpoch: "epoch-historical",
      }),
    ];
    mocks.readSeed.mockResolvedValue({
      ok: true,
      value: { cloudTerminalId: "terminal-1", storeId: "store-1" },
    });
    renderHook(() => usePosClientTelemetryDrain({ identityReady: true }));
    await waitFor(() =>
      expect(mocks.recordClientEvents).toHaveBeenCalledTimes(1),
    );
    expect(mocks.recordClientEvents).toHaveBeenCalledWith(
      expect.objectContaining({
        storeId: "store-1",
        terminalId: undefined,
        terminalFingerprint: undefined,
      }),
    );
  });

  it("uploads terminal-less store evidence when no seed exists", async () => {
    mocks.events = [
      event({
        reportedCloudTerminalId: undefined,
        reportedTerminalFingerprint: undefined,
      }),
    ];
    mocks.readSeed.mockResolvedValue({ ok: true, value: null });

    renderHook(() => usePosClientTelemetryDrain({ identityReady: true }));
    await waitFor(() =>
      expect(mocks.recordClientEvents).toHaveBeenCalledTimes(1),
    );

    expect(mocks.recordClientEvents).toHaveBeenCalledWith(
      expect.objectContaining({
        storeId: "store-1",
        terminalId: undefined,
        terminalFingerprint: undefined,
      }),
    );
  });

  it("uploads a witnessed historical terminal binding across later generations", async () => {
    mocks.events = [
      event({
        terminalIdentityGeneration: "pos-identity-historical-generation",
        telemetryIdentityEpoch: "epoch-historical",
      }),
    ];
    mocks.transition = {
      generation: "pos-identity-third-generation",
      phase: "changed",
      ownerDocumentId: "pos-bootstrap-test-document",
      revision: 3,
      startedAt: 3,
      updatedAt: 3,
    };
    mocks.fingerprint = "fp-2";
    mocks.readSeed.mockResolvedValue({
      ok: true,
      value: { cloudTerminalId: "terminal-2", storeId: "store-1" },
    });

    renderHook(() => usePosClientTelemetryDrain({ identityReady: true }));
    await waitFor(() =>
      expect(mocks.recordClientEvents).toHaveBeenCalledTimes(1),
    );

    expect(mocks.recordClientEvents).toHaveBeenCalledWith(
      expect.objectContaining({
        storeId: "store-1",
        terminalId: "terminal-1",
        terminalFingerprint: "fp-1",
      }),
    );
  });

  it("rejects an unwitnessed prior generation after later transitions", async () => {
    mocks.events = [
      event({ terminalIdentityGeneration: "pos-identity-stale-generation" }),
    ];
    mocks.transition = {
      generation: "pos-identity-third-generation",
      phase: "changed",
      ownerDocumentId: "pos-bootstrap-test-document",
      revision: 3,
      startedAt: 3,
      updatedAt: 3,
    };
    mocks.readWitness.mockReturnValue(undefined);

    renderHook(() => usePosClientTelemetryDrain({ identityReady: true }));
    await waitFor(() => expect(mocks.readSeed).toHaveBeenCalledTimes(1));
    expect(mocks.recordClientEvents).not.toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it("defers a historical batch when a later event has no exact witness", async () => {
    const historicalGeneration = "pos-identity-historical-generation";
    const first = event({
      clientEventId: "event-historical-witnessed",
      terminalIdentityGeneration: historicalGeneration,
      telemetryIdentityEpoch: "epoch-historical",
    });
    const second = event({
      clientEventId: "event-historical-unwitnessed",
      terminalIdentityGeneration: historicalGeneration,
      telemetryIdentityEpoch: "epoch-historical",
    });
    mocks.events = [first, second];
    mocks.transition = {
      ...mocks.transition,
      generation: "pos-identity-current-generation",
      revision: 2,
    };
    mocks.readWitness.mockImplementation((clientEventId: string) =>
      clientEventId === first.clientEventId
        ? occurrenceWitness(first)
        : undefined,
    );

    renderHook(() => usePosClientTelemetryDrain({ identityReady: true }));
    await waitFor(() => expect(mocks.readSeed).toHaveBeenCalledTimes(1));
    expect(mocks.recordClientEvents).not.toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it.each([
    undefined,
    { version: 1 },
    {
      version: 2,
      clientEventId: "event-1",
      storeId: "store-1",
      occurrenceContextToken: "pos-context-test-owner",
      terminalIdentityGeneration: "pos-identity-historical-generation",
      telemetryIdentityEpoch: "epoch-historical",
      reportedCloudTerminalId: "terminal-tampered",
      reportedTerminalFingerprint: "fp-1",
      transitionRevision: 1,
      transitionStartedAt: 1,
    },
  ])(
    "fails closed for a missing, v1, or mismatched historical witness",
    async (witness) => {
      mocks.events = [
        event({
          terminalIdentityGeneration: "pos-identity-historical-generation",
          telemetryIdentityEpoch: "epoch-historical",
        }),
      ];
      mocks.transition = {
        ...mocks.transition,
        generation: "pos-identity-current-generation",
        revision: 2,
      };
      mocks.readWitness.mockReturnValue(witness);

      renderHook(() => usePosClientTelemetryDrain({ identityReady: true }));
      await waitFor(() => expect(mocks.readSeed).toHaveBeenCalledTimes(1));
      expect(mocks.recordClientEvents).not.toHaveBeenCalled();
    },
  );

  it("uses an exact durable witness when the authoritative seed read fails", async () => {
    mocks.events = [event({ telemetryIdentityEpoch: "epoch-1" })];
    mocks.readSeed.mockResolvedValue({
      ok: false,
      error: { code: "unavailable", message: "storage unavailable" },
    });

    renderHook(() => usePosClientTelemetryDrain({ identityReady: true }));
    await waitFor(() =>
      expect(mocks.recordClientEvents).toHaveBeenCalledTimes(1),
    );
    expect(mocks.recordClientEvents.mock.calls[0]?.[0]).not.toHaveProperty(
      "occurrenceWitness",
    );
    expect(
      JSON.stringify(mocks.recordClientEvents.mock.calls[0]?.[0]),
    ).not.toContain("transitionRevision");
    expect(
      JSON.stringify(mocks.recordClientEvents.mock.calls[0]?.[0]),
    ).not.toContain("transitionStartedAt");
  });

  it("defers a seed-read-failure batch when a later witness is mismatched", async () => {
    const first = event({
      clientEventId: "event-seed-failure-witnessed",
      telemetryIdentityEpoch: "epoch-1",
    });
    const second = event({
      clientEventId: "event-seed-failure-mismatched",
      telemetryIdentityEpoch: "epoch-1",
    });
    mocks.events = [first, second];
    mocks.readSeed.mockResolvedValue({
      ok: false,
      error: { code: "unavailable", message: "storage unavailable" },
    });
    mocks.readWitness.mockImplementation((clientEventId: string) => {
      const candidate =
        clientEventId === first.clientEventId ? first : second;
      const witness = occurrenceWitness(candidate);
      return clientEventId === second.clientEventId
        ? { ...witness, reportedTerminalFingerprint: "fp-tampered" }
        : witness;
    });

    renderHook(() => usePosClientTelemetryDrain({ identityReady: true }));
    await waitFor(() => expect(mocks.readSeed).toHaveBeenCalledTimes(1));
    expect(mocks.recordClientEvents).not.toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it("retains a self-diagnostic when the seed read and witness lookup both fail", async () => {
    mocks.events = [event({ telemetryIdentityEpoch: "epoch-1" })];
    mocks.readSeed.mockResolvedValue({
      ok: false,
      error: { code: "unavailable", message: "storage unavailable" },
    });
    mocks.readWitness.mockReturnValue(undefined);

    renderHook(() => usePosClientTelemetryDrain({ identityReady: true }));
    await waitFor(() => expect(mocks.readSeed).toHaveBeenCalledTimes(1));
    expect(mocks.recordClientEvents).not.toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it("retains the full prefix after a partial acknowledgement", async () => {
    mocks.events = [event()];
    mocks.recordClientEvents.mockResolvedValue({
      kind: "ok",
      data: { accepted: 0, duplicates: 0 },
    });
    renderHook(() => usePosClientTelemetryDrain());
    await waitFor(() =>
      expect(mocks.recordClientEvents).toHaveBeenCalledTimes(1),
    );
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it("uses the report flow, operation, and classification in the application sink", () => {
    renderHook(() => usePosClientTelemetryDrain());
    const error = new Error("secret");
    act(() => {
      mocks.sink?.({
        flow: "register",
        operation: "openDrawer",
        classification: "local_storage_transaction_failed",
        error,
        message: "must not be persisted",
      });
    });
    expect(mocks.enqueue).toHaveBeenCalledWith({
      level: "error",
      flow: "register",
      operation: "openDrawer",
      classification: "local_storage_transaction_failed",
      error,
      localRegisterSessionId: undefined,
      metadata: undefined,
    });
  });

  it.each(["user_error", "rejected"] as const)(
    "backs off a %s scope while allowing another scope to drain",
    async (failureKind) => {
      mocks.events = [
        event(),
        event({
          clientEventId: "event-2",
          reportedCloudTerminalId: "terminal-2",
        }),
      ];
      mocks.readSeed
        .mockResolvedValueOnce({
          ok: true,
          value: { cloudTerminalId: "terminal-1", storeId: "store-1" },
        })
        .mockResolvedValue({
          ok: true,
          value: { cloudTerminalId: "terminal-2", storeId: "store-1" },
        });
      if (failureKind === "user_error") {
        mocks.recordClientEvents
          .mockResolvedValueOnce({
            kind: "user_error",
            error: { code: "denied" },
          })
          .mockResolvedValueOnce({
            kind: "ok",
            data: { accepted: 1, duplicates: 0 },
          });
      } else {
        mocks.recordClientEvents
          .mockRejectedValueOnce(new Error("network down"))
          .mockResolvedValueOnce({
            kind: "ok",
            data: { accepted: 1, duplicates: 0 },
          });
      }

      renderHook(() => usePosClientTelemetryDrain());
      await waitFor(() =>
        expect(mocks.recordClientEvents).toHaveBeenCalledTimes(1),
      );
      expect(mocks.remove).not.toHaveBeenCalled();

      act(() => window.dispatchEvent(new Event("online")));
      await waitFor(() =>
        expect(mocks.recordClientEvents).toHaveBeenCalledTimes(2),
      );
      expect(mocks.recordClientEvents.mock.calls[1]?.[0]).toMatchObject({
        terminalId: "terminal-2",
      });
      expect(mocks.remove).toHaveBeenCalledWith(["event-2"]);

      act(() => window.dispatchEvent(new Event("online")));
      await act(async () => Promise.resolve());
      expect(mocks.recordClientEvents).toHaveBeenCalledTimes(2);
      expect(snapshotPosRuntimeCounters()).toMatchObject({
        "telemetry.uploadFailureCount": 1,
        "telemetry.lastFailureAt": expect.any(Number),
      });
    },
  );

  it("preserves a failed scope deadline across hook remounts", async () => {
    mocks.events = [event()];
    mocks.recordClientEvents.mockRejectedValueOnce(new Error("network down"));
    const first = renderHook(() => usePosClientTelemetryDrain());
    await waitFor(() =>
      expect(mocks.recordClientEvents).toHaveBeenCalledTimes(1),
    );
    first.unmount();

    renderHook(() => usePosClientTelemetryDrain());
    await act(async () => Promise.resolve());

    expect(mocks.recordClientEvents).toHaveBeenCalledTimes(1);
  });

  it("persists different scope deadlines independently across documents", async () => {
    const setItem = vi.spyOn(window.localStorage, "setItem");
    mocks.events = [event()];
    mocks.recordClientEvents.mockRejectedValueOnce(new Error("network down"));
    const first = renderHook(() => usePosClientTelemetryDrain());
    await waitFor(() =>
      expect(mocks.recordClientEvents).toHaveBeenCalledTimes(1),
    );
    first.unmount();

    resetPosClientTelemetryBackoffForTests();
    mocks.events = [
      event({
        clientEventId: "event-2",
        reportedCloudTerminalId: "terminal-2",
      }),
    ];
    mocks.readSeed.mockResolvedValue({
      ok: true,
      value: { cloudTerminalId: "terminal-2", storeId: "store-1" },
    });
    mocks.recordClientEvents.mockRejectedValueOnce(new Error("network down"));
    renderHook(() => usePosClientTelemetryDrain());
    await waitFor(() =>
      expect(mocks.recordClientEvents).toHaveBeenCalledTimes(2),
    );

    const persistedKeys = setItem.mock.calls
      .map(([key]) => key)
      .filter((key) => key.includes(":scope:"));
    expect(persistedKeys).toHaveLength(2);
    expect(new Set(persistedKeys).size).toBe(2);
  });

  it("reclaims expired and malformed scope shards while preserving active deadlines", () => {
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
    const prefix = `${POS_CLIENT_TELEMETRY_BACKOFF_STORAGE_KEY}:scope:`;
    const expiredKey = `${prefix}expired`;
    const malformedKey = `${prefix}malformed`;
    const activeKey = `${prefix}active`;
    window.localStorage.setItem(
      POS_CLIENT_TELEMETRY_BACKOFF_STORAGE_KEY,
      "{obsolete-malformed-map",
    );
    window.localStorage.setItem(
      expiredKey,
      JSON.stringify({ scope: "expired-scope", deadline: Date.now() - 1 }),
    );
    window.localStorage.setItem(malformedKey, "{not-json");
    window.localStorage.setItem(
      activeKey,
      JSON.stringify({ scope: "active-scope", deadline: Date.now() + 60_000 }),
    );

    try {
      renderHook(() => usePosClientTelemetryDrain());

      expect(window.localStorage.getItem(expiredKey)).toBeNull();
      expect(window.localStorage.getItem(malformedKey)).toBeNull();
      expect(window.localStorage.getItem(activeKey)).not.toBeNull();
      expect(
        window.localStorage.getItem(POS_CLIENT_TELEMETRY_BACKOFF_STORAGE_KEY),
      ).toBe("{obsolete-malformed-map");
      expect(removeItem).toHaveBeenCalledWith(expiredKey);
      expect(removeItem).toHaveBeenCalledWith(malformedKey);
      expect(removeItem).not.toHaveBeenCalledWith(activeKey);
    } finally {
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
    }
  });

  it("counts storage degradation when a scope deadline cannot persist", async () => {
    const setItem = vi
      .spyOn(window.localStorage, "setItem")
      .mockImplementation((key) => {
        if (key.includes(":scope:")) throw new Error("storage denied");
      });
    try {
      mocks.events = [event()];
      mocks.recordClientEvents.mockRejectedValueOnce(new Error("network down"));
      renderHook(() => usePosClientTelemetryDrain());
      await waitFor(() =>
        expect(mocks.recordClientEvents).toHaveBeenCalledTimes(1),
      );
      expect(snapshotPosRuntimeCounters()).toMatchObject({
        "telemetry.storageFallbackCount": 1,
      });
    } finally {
      setItem.mockRestore();
    }
  });
});
