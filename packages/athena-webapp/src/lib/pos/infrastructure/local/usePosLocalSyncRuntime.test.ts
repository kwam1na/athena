import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  acknowledgeTerminalRecoveryCommand: vi.fn(),
  claimTerminalRecoveryCommand: vi.fn(),
  ingestLocalEvents: vi.fn(),
  ingestRegisterSessionActivity: vi.fn(),
  listTerminalRecoveryCommands: vi.fn(),
  getTerminalRuntimeConfig: vi.fn(),
  reportTerminalRuntimeStatus: vi.fn(),
  refreshTerminalStaffAuthority: vi.fn(),
}));

vi.mock("convex/react", () => ({
  useMutation: (mutation: string) => {
    if (mutation === "reportTerminalRuntimeStatus") {
      return mocks.reportTerminalRuntimeStatus;
    }
    if (mutation === "claimTerminalRecoveryCommand") {
      return mocks.claimTerminalRecoveryCommand;
    }
    if (mutation === "acknowledgeTerminalRecoveryCommand") {
      return mocks.acknowledgeTerminalRecoveryCommand;
    }
    if (mutation === "refreshTerminalStaffAuthority") {
      return mocks.refreshTerminalStaffAuthority;
    }
    if (mutation === "ingestRegisterSessionActivity") {
      return mocks.ingestRegisterSessionActivity;
    }
    return mocks.ingestLocalEvents;
  },
  useQuery: (query: string, args: unknown) =>
    query === "listTerminalRecoveryCommands"
      ? mocks.listTerminalRecoveryCommands(args)
      : query === "getTerminalRuntimeConfig"
        ? mocks.getTerminalRuntimeConfig(args)
        : undefined,
}));

vi.mock("~/convex/_generated/api", () => ({
  api: {
    pos: {
      public: {
        sync: {
          ingestLocalEvents: "ingestLocalEvents",
          ingestRegisterSessionActivity: "ingestRegisterSessionActivity",
        },
        terminals: {
          acknowledgeTerminalRecoveryCommand:
            "acknowledgeTerminalRecoveryCommand",
          claimTerminalRecoveryCommand: "claimTerminalRecoveryCommand",
          getTerminalRuntimeConfig: "getTerminalRuntimeConfig",
          listTerminalRecoveryCommands: "listTerminalRecoveryCommands",
          reportTerminalRuntimeStatus: "reportTerminalRuntimeStatus",
        },
      },
    },
    operations: {
      staffCredentials: {
        refreshTerminalStaffAuthority: "refreshTerminalStaffAuthority",
      },
    },
  },
}));

import {
  assertPosLocalStoreOk,
  collectLocallySettledSkippedReviewEventIds,
  collectSyncedLocalEventIds,
  collectServerHeldLocalEventIds,
  collectServerRejectedLocalEventIds,
  collectServerReviewLocalEventIds,
  collectServerSettledLocalEventIds,
  collectServerSyncedLocalEventIds,
  derivePosLocalRuntimeSyncStatus,
  getRuntimeStatusSignature,
  isPosLocalRuntimeDrainCandidate,
  resetRuntimeStatusPublishStateForTests,
  usePosLocalSyncRuntimeStatus,
  writeReturnedLocalCloudMappings,
} from "./usePosLocalSyncRuntime";
import type {
  PosDrawerAuthorityState,
  PosLocalEventRecord,
  PosTerminalIntegrityState,
} from "./posLocalStore";
import {
  createMemoryPosLocalStorageAdapter,
  createPosLocalStore,
} from "./posLocalStore";
import {
  RUNTIME_STATUS_FRESHNESS_PUBLISH_INTERVAL_MS,
  RUNTIME_STATUS_FRESHNESS_WAKEUP_INTERVAL_MS,
  getRuntimeStatusPublishMaterialSignature,
  shouldPublishRuntimeStatus,
  shouldDelayTransientSyncingRuntimeStatusPublish,
  startRuntimeStatusFreshnessHeartbeat,
} from "./runtimeStatusPublisher";
import { buildPosLocalSyncUploadEvents } from "./syncContract";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });

  return { promise, resolve };
}

describe("usePosLocalSyncRuntimeStatus", () => {
  beforeEach(() => {
    Object.defineProperty(globalThis.navigator, "locks", {
      configurable: true,
      value: undefined,
    });
    vi.resetAllMocks();
    vi.unstubAllEnvs();
    mocks.reportTerminalRuntimeStatus.mockResolvedValue({
      kind: "ok",
      data: {},
    });
    mocks.ingestRegisterSessionActivity.mockResolvedValue({
      kind: "ok",
      data: {
        accepted: [],
        skipped: [],
        checkpoint: {
          localRegisterSessionId: "register-1",
          reportedThroughSequence: 0,
          skippedCounts: {},
        },
      },
    });
    mocks.listTerminalRecoveryCommands.mockReturnValue(undefined);
    mocks.getTerminalRuntimeConfig.mockReturnValue({
      heartbeatEnabled: true,
    });
    mocks.claimTerminalRecoveryCommand.mockResolvedValue({
      kind: "user_error",
      error: {
        code: "not_found",
        message: "No recovery command is available.",
      },
    });
    mocks.acknowledgeTerminalRecoveryCommand.mockResolvedValue({
      kind: "ok",
      data: {},
    });
    mocks.refreshTerminalStaffAuthority.mockResolvedValue({
      kind: "ok",
      data: [],
    });
    Object.defineProperty(globalThis.navigator, "onLine", {
      configurable: true,
      value: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetRuntimeStatusPublishStateForTests();
    localStorage.clear();
    vi.useRealTimers();
  });

  it("reads local events through the terminal seed and exposes retry refresh", async () => {
    const retry = vi.fn();
    mocks.ingestLocalEvents.mockResolvedValue({
      kind: "ok",
      data: {
        accepted: [
          {
            localEventId: "event-checkout",
            sequence: 1,
            status: "projected",
          },
        ],
        held: [],
        mappings: [
          {
            _id: "mapping-1",
            storeId: "store-1",
            terminalId: "terminal-cloud-1",
            localRegisterSessionId: "register-1",
            localEventId: "event-checkout",
            localIdKind: "posSession",
            localId: "local-session-1",
            cloudTable: "posSession",
            cloudId: "session-1",
            createdAt: 10,
          },
          {
            _id: "mapping-2",
            storeId: "store-1",
            terminalId: "terminal-cloud-1",
            localRegisterSessionId: "register-1",
            localEventId: "event-checkout",
            localIdKind: "transaction",
            localId: "local-txn-1",
            cloudTable: "posTransaction",
            cloudId: "transaction-1",
            createdAt: 11,
          },
          {
            _id: "mapping-3",
            storeId: "store-1",
            terminalId: "terminal-cloud-1",
            localRegisterSessionId: "register-1",
            localEventId: "event-open",
            localIdKind: "registerSession",
            localId: "register-1",
            cloudTable: "registerSession",
            cloudId: "register-session-1",
            createdAt: 12,
          },
          {
            _id: "mapping-4",
            storeId: "store-1",
            terminalId: "terminal-cloud-1",
            localRegisterSessionId: "register-1",
            localEventId: "event-checkout",
            localIdKind: "payment",
            localId: "payment-1",
            cloudTable: "paymentAllocation",
            cloudId: "allocation-1",
            createdAt: 13,
          },
        ],
        conflicts: [],
        syncCursor: {
          localRegisterSessionId: "register-1",
          acceptedThroughSequence: 1,
        },
      },
    });
    const store = {
      listEvents: vi.fn(async () => ({
        ok: true,
        value: [
          buildLocalEvent({
            localEventId: "event-session",
            localPosSessionId: "local-session-1",
            sequence: 1,
            storeId: "store-1",
            terminalId: "local-terminal-1",
            type: "session.started",
          }),
          buildLocalEvent({
            localEventId: "event-cart",
            localPosSessionId: "local-session-1",
            payload: {
              localItemId: "local-item-1",
              productId: "product-1",
              productSkuId: "sku-1",
              productName: "Wig Cap",
              productSku: "CAP-1",
              quantity: 1,
              price: 25,
            },
            sequence: 2,
            storeId: "store-1",
            terminalId: "local-terminal-1",
            type: "cart.item_added",
          }),
          buildLocalEvent({
            localEventId: "event-payment",
            localPosSessionId: "local-session-1",
            payload: {
              localPosSessionId: "local-session-1",
              payments: [{ method: "cash", amount: 25, timestamp: 2 }],
              stage: "paymentAdded",
            },
            sequence: 3,
            storeId: "store-1",
            terminalId: "local-terminal-1",
            type: "session.payments_updated",
          }),
          buildLocalEvent({
            localEventId: "event-clear",
            localPosSessionId: "local-session-1",
            payload: {
              localPosSessionId: "local-session-1",
              stage: "cartCleared",
            },
            sequence: 4,
            storeId: "store-1",
            terminalId: "local-terminal-1",
            type: "cart.cleared",
          }),
          buildLocalEvent({
            localEventId: "event-checkout",
            localPosSessionId: "local-session-1",
            localTransactionId: "local-txn-1",
            payload: {
              localPosSessionId: "local-session-1",
              localTransactionId: "local-txn-1",
              receiptNumber: "LOCAL-1-000001",
              subtotal: 25,
              tax: 0,
              total: 25,
              payments: [{ method: "cash", amount: 25, timestamp: 2 }],
            },
            sequence: 5,
            storeId: "store-1",
            terminalId: "local-terminal-1",
            type: "transaction.completed",
          }),
          buildLocalEvent({
            localEventId: "event-2",
            storeId: "store-1",
            terminalId: "other-terminal",
          }),
        ],
      })),
      markEventsSynced: vi.fn(async () => ({
        ok: true,
        value: [],
      })),
      writeLocalCloudMapping: vi.fn(async () => ({
        ok: true,
        value: {
          entity: "posSession",
          localId: "local-session-1",
          cloudId: "session-1",
          mappedAt: 10,
        },
      })),
      readProvisionedTerminalSeed: vi.fn(async () => ({
        ok: true,
        value: {
          cloudTerminalId: "terminal-cloud-1",
          displayName: "Front",
          provisionedAt: 1,
          schemaVersion: 1,
          syncSecretHash: "sync-secret-1",
          storeId: "store-1",
          terminalId: "local-terminal-1",
        },
      })),
      writeTerminalIntegrityState: vi.fn(async () => ({
        ok: true,
        value: null,
      })),
    };
    const storeFactory = () => store as never;
    const onLocalEventsChanged = vi.fn();

    const { result } = renderHook(() =>
      usePosLocalSyncRuntimeStatus({
        onLocalEventsChanged,
        onRetrySync: retry,
        storeFactory,
        storeId: "store-1",
        terminalId: "terminal-cloud-1",
      }),
    );

    await waitFor(() => {
      expect(result.current).toEqual(
        expect.objectContaining({
          debug: expect.objectContaining({
            lastTrigger: "route-entry",
            lastTriggerAt: expect.any(Number),
            lastTriggerPriority: "normal",
          }),
          pendingEventCount: 5,
          status: "pending",
        }),
      );
    });

    await act(async () => {
      result.current?.onRetrySync?.();
    });

    expect(retry).toHaveBeenCalled();
    await waitFor(() =>
      expect(store.listEvents.mock.calls.length).toBeGreaterThanOrEqual(2),
    );
    await waitFor(() =>
      expect(mocks.ingestLocalEvents).toHaveBeenCalledWith(
        expect.objectContaining({
          storeId: "store-1",
          terminalId: "terminal-cloud-1",
          syncSecretHash: "sync-secret-1",
          events: [
            expect.objectContaining({
              eventType: "sale_completed",
              localEventId: "event-checkout",
            }),
          ],
        }),
      ),
    );
    expect(store.markEventsSynced).toHaveBeenCalledWith(
      [
        "event-checkout",
        "event-session",
        "event-cart",
        "event-payment",
        "event-clear",
      ],
      { uploaded: true },
    );
    expect(store.writeLocalCloudMapping).toHaveBeenCalledWith({
      entity: "posSession",
      localId: "local-session-1",
      cloudId: "session-1",
      mappedAt: 10,
      storeId: "store-1",
      terminalId: "local-terminal-1",
    });
    expect(store.writeLocalCloudMapping).toHaveBeenCalledWith({
      entity: "posTransaction",
      localId: "local-txn-1",
      cloudId: "transaction-1",
      mappedAt: 11,
      storeId: "store-1",
      terminalId: "local-terminal-1",
    });
    expect(store.writeLocalCloudMapping).toHaveBeenCalledWith({
      entity: "registerSession",
      localId: "register-1",
      cloudId: "register-session-1",
      mappedAt: 12,
      registerCandidateState: "current",
      storeId: "store-1",
      terminalId: "local-terminal-1",
    });
    expect(
      store.writeLocalCloudMapping.mock.calls.length,
    ).toBeGreaterThanOrEqual(3);
    expect(onLocalEventsChanged).toHaveBeenCalled();
  });

  it("uploads pending events after the append token changes", async () => {
    let localEvents: PosLocalEventRecord[] = [];
    mocks.ingestLocalEvents.mockResolvedValue({
      kind: "ok",
      data: {
        accepted: [
          {
            localEventId: "event-open",
            sequence: 1,
            status: "projected",
          },
        ],
        held: [],
        mappings: [],
        conflicts: [],
        syncCursor: {
          localRegisterSessionId: "register-1",
          acceptedThroughSequence: 1,
        },
      },
    });
    const store = {
      listEvents: vi.fn(async () => ({
        ok: true,
        value: localEvents,
      })),
      markEventsSynced: vi.fn(async () => ({
        ok: true,
        value: [],
      })),
      writeLocalCloudMapping: vi.fn(async () => ({
        ok: true,
        value: {
          entity: "registerSession",
          localId: "register-1",
          cloudId: "register-session-1",
          mappedAt: 10,
        },
      })),
      readProvisionedTerminalSeed: vi.fn(async () => ({
        ok: true,
        value: {
          cloudTerminalId: "terminal-cloud-1",
          displayName: "Front",
          provisionedAt: 1,
          schemaVersion: 1,
          syncSecretHash: "sync-secret-1",
          storeId: "store-1",
          terminalId: "local-terminal-1",
        },
      })),
      writeTerminalIntegrityState: vi.fn(async () => ({
        ok: true,
        value: null,
      })),
    };
    const storeFactory = () => store as never;

    const { result, rerender } = renderHook(
      ({ eventAppendToken }: { eventAppendToken: number }) =>
        usePosLocalSyncRuntimeStatus({
          eventAppendToken,
          storeFactory,
          storeId: "store-1",
          terminalId: "terminal-cloud-1",
        }),
      {
        initialProps: { eventAppendToken: 0 },
      },
    );

    await waitFor(() => expect(store.listEvents).toHaveBeenCalled());
    expect(mocks.ingestLocalEvents).not.toHaveBeenCalled();

    localEvents = [
      buildLocalEvent({
        localEventId: "event-open",
        payload: {
          openingFloat: 100,
          status: "open",
        },
        sequence: 1,
        type: "register.opened",
      }),
    ];

    rerender({ eventAppendToken: 1 });

    await waitFor(() =>
      expect(result.current?.debug).toEqual(
        expect.objectContaining({
          lastTrigger: "event-appended",
          lastTriggerAt: expect.any(Number),
          lastTriggerPriority: "high",
        }),
      ),
    );
    await waitFor(() =>
      expect(mocks.ingestLocalEvents).toHaveBeenCalledWith(
        expect.objectContaining({
          events: [
            expect.objectContaining({
              eventType: "register_opened",
              localEventId: "event-open",
            }),
          ],
        }),
      ),
    );
    expect(store.markEventsSynced).toHaveBeenCalledWith(["event-open"], {
      uploaded: true,
    });
  });

  it("ignores stale upload results after the runtime scope changes", async () => {
    const pendingIngest = deferred<{
      kind: "error";
      error: { code: string; message: string };
    }>();
    mocks.ingestLocalEvents.mockReturnValue(pendingIngest.promise);
    const oldStore = {
      listEvents: vi.fn(async () => ({
        ok: true,
        value: [
          buildLocalEvent({
            localEventId: "event-open",
            payload: {
              openingFloat: 100,
              status: "open",
            },
            sequence: 1,
            storeId: "store-1",
            type: "register.opened",
          }),
        ],
      })),
      markEventsNeedsReview: vi.fn(async () => ({
        ok: true,
        value: undefined,
      })),
      markEventsSynced: vi.fn(async () => ({
        ok: true,
        value: [],
      })),
      writeLocalCloudMapping: vi.fn(async () => ({
        ok: true,
        value: {},
      })),
      readProvisionedTerminalSeed: vi.fn(async () => ({
        ok: true,
        value: {
          cloudTerminalId: "terminal-cloud-1",
          displayName: "Front",
          provisionedAt: 1,
          schemaVersion: 1,
          syncSecretHash: "sync-secret-1",
          storeId: "store-1",
          terminalId: "local-terminal-1",
        },
      })),
    };
    const newStore = {
      listEvents: vi.fn(async () => ({
        ok: true,
        value: [
          buildLocalEvent({
            localEventId: "event-open",
            sequence: 1,
            type: "register.opened",
          }),
        ],
      })),
      markEventsNeedsReview: vi.fn(async () => ({
        ok: true,
        value: undefined,
      })),
      markEventsSynced: vi.fn(async () => ({
        ok: true,
        value: [],
      })),
      writeLocalCloudMapping: vi.fn(async () => ({
        ok: true,
        value: {},
      })),
      readProvisionedTerminalSeed: vi.fn(async () => ({
        ok: true,
        value: {
          cloudTerminalId: "terminal-cloud-2",
          displayName: "Back",
          provisionedAt: 1,
          schemaVersion: 1,
          syncSecretHash: "sync-secret-2",
          storeId: "store-2",
          terminalId: "local-terminal-2",
        },
      })),
    };
    const onLocalEventsChanged = vi.fn();
    let currentStore: typeof oldStore | typeof newStore = oldStore;
    const storeFactory = () => currentStore as never;

    const { result, rerender } = renderHook(
      ({
        eventAppendToken,
        storeId,
      }: {
        eventAppendToken: number;
        storeId: "store-1" | "store-2";
      }) =>
        usePosLocalSyncRuntimeStatus({
          eventAppendToken,
          onLocalEventsChanged,
          storeFactory,
          storeId,
          terminalId:
            storeId === "store-1" ? "terminal-cloud-1" : "terminal-cloud-2",
        }),
      {
        initialProps: {
          eventAppendToken: 0,
          storeId: "store-1" as "store-1" | "store-2",
        },
      },
    );

    await waitFor(() => {
      expect(result.current).toEqual(
        expect.objectContaining({
          pendingEventCount: 1,
          status: "pending",
        }),
      );
    });
    await act(async () => {
      result.current?.onRetrySync?.();
    });
    await waitFor(() => expect(oldStore.listEvents).toHaveBeenCalled());
    await waitFor(() => expect(mocks.ingestLocalEvents).toHaveBeenCalled(), {
      timeout: 5000,
    });

    currentStore = newStore;
    rerender({ eventAppendToken: 0, storeId: "store-2" });
    pendingIngest.resolve({
      kind: "error",
      error: { code: "unavailable", message: "Old upload failed." },
    });

    await waitFor(() => expect(newStore.listEvents).toHaveBeenCalled());
    await act(async () => {
      await pendingIngest.promise;
    });

    expect(oldStore.markEventsNeedsReview).not.toHaveBeenCalled();
    expect(onLocalEventsChanged).not.toHaveBeenCalled();
  });

  it("treats an already-incremented append token as an immediate event trigger on first observation", async () => {
    mocks.ingestLocalEvents.mockResolvedValue({
      kind: "ok",
      data: {
        accepted: [
          {
            localEventId: "event-open",
            sequence: 1,
            status: "projected",
          },
        ],
        held: [],
        mappings: [
          {
            _id: "mapping-open",
            storeId: "store-1",
            terminalId: "terminal-cloud-1",
            localRegisterSessionId: "register-1",
            localEventId: "event-open",
            localIdKind: "registerSession",
            localId: "register-1",
            cloudTable: "registerSession",
            cloudId: "register-session-1",
            createdAt: 12,
          },
        ],
        conflicts: [],
        syncCursor: {
          localRegisterSessionId: "register-1",
          acceptedThroughSequence: 1,
        },
      },
    });
    const store = {
      listEvents: vi.fn(async () => ({
        ok: true,
        value: [
          buildLocalEvent({
            localEventId: "event-open",
            payload: {
              openingFloat: 100,
              status: "open",
            },
            sequence: 1,
            type: "register.opened",
          }),
        ],
      })),
      markEventsSynced: vi.fn(async () => ({
        ok: true,
        value: [],
      })),
      writeLocalCloudMapping: vi.fn(async () => ({
        ok: true,
        value: {},
      })),
      readProvisionedTerminalSeed: vi.fn(async () => ({
        ok: true,
        value: {
          cloudTerminalId: "terminal-cloud-1",
          displayName: "Front",
          provisionedAt: 1,
          schemaVersion: 1,
          syncSecretHash: "sync-secret-1",
          storeId: "store-1",
          terminalId: "local-terminal-1",
        },
      })),
    };
    const storeFactory = () => store as never;

    const { result } = renderHook(() =>
      usePosLocalSyncRuntimeStatus({
        eventAppendToken: 1,
        storeFactory,
        storeId: "store-1",
        terminalId: "terminal-cloud-1",
      }),
    );

    await waitFor(() =>
      expect(result.current?.debug).toEqual(
        expect.objectContaining({
          lastTrigger: "event-appended",
          lastTriggerAt: expect.any(Number),
          lastTriggerPriority: "high",
        }),
      ),
    );
    await waitFor(() =>
      expect(mocks.ingestLocalEvents).toHaveBeenCalledWith(
        expect.objectContaining({
          events: [
            expect.objectContaining({
              eventType: "register_opened",
              localEventId: "event-open",
            }),
          ],
        }),
      ),
    );
  });

  it("retries uploaded review events from status-only manual retry so projected server settlement clears local review", async () => {
    mocks.ingestLocalEvents.mockResolvedValue({
      kind: "ok",
      data: {
        accepted: [
          {
            localEventId: "event-closeout",
            sequence: 1,
            status: "projected",
          },
        ],
        held: [],
        mappings: [
          {
            _id: "mapping-closeout",
            storeId: "store-1",
            terminalId: "terminal-cloud-1",
            localRegisterSessionId: "register-1",
            localEventId: "event-closeout",
            localIdKind: "closeout",
            localId: "event-closeout",
            cloudTable: "registerSession",
            cloudId: "register-session-1",
            createdAt: 12,
          },
        ],
        conflicts: [],
        syncCursor: {
          localRegisterSessionId: "register-1",
          acceptedThroughSequence: 1,
        },
      },
    });
    const store = {
      listEvents: vi.fn(async () => ({
        ok: true,
        value: [
          buildLocalEvent({
            localEventId: "event-closeout",
            payload: {
              countedCash: 100,
              notes: "End of day",
            },
            sequence: 1,
            sync: { status: "needs_review", uploaded: true },
            type: "register.closeout_started",
          }),
        ],
      })),
      markEventsSynced: vi.fn(async () => ({
        ok: true,
        value: [],
      })),
      markEventsNeedsReview: vi.fn(async () => ({
        ok: true,
        value: [],
      })),
      clearDrawerAuthorityState: vi.fn(async () => ({
        ok: true,
        value: null,
      })),
      readDrawerAuthorityState: vi.fn(async () => ({
        ok: true,
        value: {
          localRegisterSessionId: "register-1",
          observedAt: 1,
          reason: "lifecycle_rejected",
          status: "blocked",
          storeId: "store-1",
          terminalId: "local-terminal-1",
        },
      })),
      writeLocalCloudMapping: vi.fn(async () => ({
        ok: true,
        value: {},
      })),
      readProvisionedTerminalSeed: vi.fn(async () => ({
        ok: true,
        value: {
          cloudTerminalId: "terminal-cloud-1",
          displayName: "Front",
          provisionedAt: 1,
          schemaVersion: 1,
          syncSecretHash: "sync-secret-1",
          storeId: "store-1",
          terminalId: "local-terminal-1",
        },
      })),
      writeTerminalIntegrityState: vi.fn(async () => ({
        ok: true,
        value: null,
      })),
    };
    const storeFactory = () => store as never;

    const { result } = renderHook(() =>
      usePosLocalSyncRuntimeStatus({
        mode: "status-only",
        storeFactory,
        storeId: "store-1",
        terminalId: "terminal-cloud-1",
      }),
    );

    await waitFor(() =>
      expect(result.current?.runtimeStatus?.sync).toEqual(
        expect.objectContaining({
          reviewEventCount: 1,
          status: "idle",
          uploadableEventCount: 1,
        }),
      ),
    );
    expect(result.current?.debug?.reviewEventCount).toBe(1);
    expect(mocks.ingestLocalEvents).not.toHaveBeenCalled();

    await act(async () => {
      result.current?.onRetrySync?.();
    });

    await waitFor(() =>
      expect(result.current?.debug).toEqual(
        expect.objectContaining({
          lastTrigger: "manual-retry",
        }),
      ),
    );
    await waitFor(() =>
      expect(mocks.ingestLocalEvents).toHaveBeenCalledWith(
        expect.objectContaining({
          events: [
            expect.objectContaining({
              eventType: "register_closed",
              localEventId: "event-closeout",
            }),
          ],
        }),
      ),
    );
    await waitFor(() =>
      expect(store.markEventsSynced).toHaveBeenCalledWith(["event-closeout"], {
        uploaded: true,
      }),
    );
    expect(store.markEventsNeedsReview).not.toHaveBeenCalled();
    expect(store.clearDrawerAuthorityState).toHaveBeenCalledWith({
      localRegisterSessionId: "register-1",
      storeId: "store-1",
      terminalId: "local-terminal-1",
    });
  });

  it("selects syncable local review events for support-triggered review drains", () => {
    const reviewEvent = buildLocalEvent({
      localEventId: "event-closeout",
      payload: {
        countedCash: 100,
        notes: "End of day",
      },
      sequence: 1,
      sync: { status: "needs_review" },
      type: "register.closeout_started",
    });

    expect(
      isPosLocalRuntimeDrainCandidate(reviewEvent, {
        includeReviewEvents: true,
        onlyReviewEvents: true,
      }),
    ).toBe(true);
    expect(
      isPosLocalRuntimeDrainCandidate(reviewEvent, {
        includeUploadedReviewEvents: true,
        onlyUploadedReviewEvents: true,
      }),
    ).toBe(false);
  });

  it("self-heals uploaded register open reviews from status-only route entry", async () => {
    mocks.ingestLocalEvents.mockResolvedValue({
      kind: "ok",
      data: {
        accepted: [
          {
            localEventId: "event-open",
            sequence: 1,
            status: "projected",
          },
        ],
        held: [],
        mappings: [
          {
            _id: "mapping-open",
            storeId: "store-1",
            terminalId: "terminal-cloud-1",
            localRegisterSessionId: "register-1",
            localEventId: "event-open",
            localIdKind: "registerSession",
            localId: "register-1",
            cloudTable: "registerSession",
            cloudId: "register-session-1",
            createdAt: 12,
          },
        ],
        conflicts: [],
        syncCursor: {
          localRegisterSessionId: "register-1",
          acceptedThroughSequence: 1,
        },
      },
    });
    const store = {
      listEvents: vi.fn(async () => ({
        ok: true,
        value: [
          buildLocalEvent({
            localEventId: "event-open",
            payload: {
              openingFloat: 100,
              registerNumber: "1",
            },
            sequence: 1,
            sync: { status: "needs_review", uploaded: true },
            type: "register.opened",
          }),
          buildLocalEvent({
            localEventId: "event-closeout",
            payload: {
              countedCash: 90,
            },
            sequence: 2,
            sync: { status: "needs_review", uploaded: true },
            type: "register.closeout_started",
          }),
        ],
      })),
      markEventsSynced: vi.fn(async () => ({
        ok: true,
        value: [],
      })),
      markEventsNeedsReview: vi.fn(async () => ({
        ok: true,
        value: [],
      })),
      clearDrawerAuthorityState: vi.fn(async () => ({
        ok: true,
        value: null,
      })),
      readDrawerAuthorityState: vi.fn(async () => ({
        ok: true,
        value: {
          localRegisterSessionId: "register-1",
          observedAt: 1,
          reason: "lifecycle_rejected",
          status: "blocked",
          storeId: "store-1",
          terminalId: "local-terminal-1",
        },
      })),
      writeLocalCloudMapping: vi.fn(async () => ({
        ok: true,
        value: {},
      })),
      readProvisionedTerminalSeed: vi.fn(async () => ({
        ok: true,
        value: {
          cloudTerminalId: "terminal-cloud-1",
          displayName: "Front",
          provisionedAt: 1,
          schemaVersion: 1,
          syncSecretHash: "sync-secret-1",
          storeId: "store-1",
          terminalId: "local-terminal-1",
        },
      })),
    };

    renderHook(() =>
      usePosLocalSyncRuntimeStatus({
        mode: "status-only",
        storeFactory: () => store as never,
        storeId: "store-1",
        terminalId: "terminal-cloud-1",
      }),
    );

    await waitFor(() =>
      expect(mocks.ingestLocalEvents).toHaveBeenCalledWith(
        expect.objectContaining({
          events: [
            expect.objectContaining({
              eventType: "register_opened",
              localEventId: "event-open",
            }),
          ],
        }),
      ),
    );
    expect(mocks.ingestLocalEvents.mock.calls[0]?.[0].events).toHaveLength(1);
    await waitFor(() =>
      expect(store.markEventsSynced).toHaveBeenCalledWith(["event-open"], {
        uploaded: true,
      }),
    );
    expect(store.markEventsNeedsReview).not.toHaveBeenCalled();
  });

  it("manually retries syncable review events even when they were never marked uploaded", async () => {
    mocks.ingestLocalEvents.mockResolvedValue({
      kind: "ok",
      data: {
        accepted: [
          {
            localEventId: "event-closeout",
            sequence: 1,
            status: "projected",
          },
        ],
        held: [],
        mappings: [],
        conflicts: [],
        syncCursor: {
          localRegisterSessionId: "register-1",
          acceptedThroughSequence: 1,
        },
      },
    });
    const store = {
      listEvents: vi.fn(async () => ({
        ok: true,
        value: [
          buildLocalEvent({
            localEventId: "event-closeout",
            payload: {
              countedCash: 100,
              notes: "End of day",
            },
            sequence: 1,
            sync: { status: "needs_review" },
            type: "register.closeout_started",
          }),
        ],
      })),
      markEventsSynced: vi.fn(async () => ({
        ok: true,
        value: [],
      })),
      markEventsNeedsReview: vi.fn(async () => ({
        ok: true,
        value: [],
      })),
      readProvisionedTerminalSeed: vi.fn(async () => ({
        ok: true,
        value: {
          cloudTerminalId: "terminal-cloud-1",
          displayName: "Front",
          provisionedAt: 1,
          schemaVersion: 1,
          syncSecretHash: "sync-secret-1",
          storeId: "store-1",
          terminalId: "local-terminal-1",
        },
      })),
    };
    const storeFactory = () => store as never;

    const { result } = renderHook(() =>
      usePosLocalSyncRuntimeStatus({
        mode: "status-only",
        storeFactory,
        storeId: "store-1",
        terminalId: "terminal-cloud-1",
      }),
    );

    await waitFor(() =>
      expect(result.current).toEqual(
        expect.objectContaining({
          runtimeStatus: expect.objectContaining({
            sync: expect.objectContaining({
              reviewEventCount: 1,
              status: "idle",
              uploadableEventCount: 0,
            }),
          }),
        }),
      ),
    );
    expect(result.current?.debug?.reviewEventCount).toBe(1);
    act(() => {
      result.current?.onRetrySync?.();
    });

    await waitFor(() =>
      expect(store.listEvents.mock.calls.length).toBeGreaterThan(1),
    );
    await waitFor(() =>
      expect(mocks.ingestLocalEvents).toHaveBeenCalledWith(
        expect.objectContaining({
          events: [
            expect.objectContaining({
              eventType: "register_closed",
              localEventId: "event-closeout",
            }),
          ],
        }),
      ),
    );
    await waitFor(() =>
      expect(store.markEventsSynced).toHaveBeenCalledWith(["event-closeout"], {
        uploaded: true,
      }),
    );
    expect(store.markEventsNeedsReview).not.toHaveBeenCalled();
  });

  it("identifies superseded review rows that are skipped when retrying the later sale", () => {
    const events = [
      buildLocalEvent({
        localEventId: "event-clear",
        localPosSessionId: "local-session-1",
        payload: {
          localPosSessionId: "local-session-1",
          stage: "cartCleared",
        },
        sequence: 1,
        sync: { status: "needs_review", uploaded: true },
        type: "cart.cleared",
      }),
      buildLocalEvent({
        localEventId: "event-checkout",
        localPosSessionId: "local-session-1",
        localTransactionId: "local-txn-1",
        payload: {
          localPosSessionId: "local-session-1",
          localTransactionId: "local-txn-1",
          receiptNumber: "LOCAL-1-000001",
          subtotal: 25,
          tax: 0,
          total: 25,
          payments: [{ method: "cash", amount: 25, timestamp: 2 }],
        },
        sequence: 2,
        sync: { status: "needs_review", uploaded: true },
        type: "transaction.completed",
      }),
    ];
    const uploadEvents = buildPosLocalSyncUploadEvents(events, events);

    expect(uploadEvents.map((event) => event.localEventId)).toEqual([
      "event-checkout",
    ]);
    expect(
      collectLocallySettledSkippedReviewEventIds(events, uploadEvents),
    ).toEqual(["event-clear"]);
  });

  it("settles inventory-review sale conflicts and their local precursor rows during manual retry", async () => {
    mocks.ingestLocalEvents.mockResolvedValue({
      kind: "ok",
      data: {
        accepted: [
          {
            localEventId: "event-checkout",
            sequence: 5,
            status: "conflicted",
          },
        ],
        held: [],
        mappings: [
          {
            _id: "mapping-transaction",
            storeId: "store-1",
            terminalId: "terminal-cloud-1",
            localRegisterSessionId: "register-1",
            localEventId: "event-checkout",
            localIdKind: "transaction",
            localId: "local-txn-1",
            cloudTable: "posTransaction",
            cloudId: "transaction-1",
            createdAt: 12,
          },
          {
            _id: "mapping-inventory-review",
            storeId: "store-1",
            terminalId: "terminal-cloud-1",
            localRegisterSessionId: "register-1",
            localEventId: "event-checkout",
            localIdKind: "inventoryReviewWorkItem",
            localId: "local-txn-1:inventory-review",
            cloudTable: "operationalWorkItem",
            cloudId: "work-item-1",
            createdAt: 12,
          },
        ],
        conflicts: [
          {
            _id: "conflict-inventory",
            storeId: "store-1",
            terminalId: "terminal-cloud-1",
            localRegisterSessionId: "register-1",
            localEventId: "event-checkout",
            sequence: 5,
            conflictType: "inventory",
            status: "needs_review",
            summary:
              "Inventory needs manager review for a synced offline sale.",
            details: {},
            createdAt: 12,
          },
        ],
        syncCursor: {
          localRegisterSessionId: "register-1",
          acceptedThroughSequence: 5,
        },
      },
    });
    const store = {
      listEvents: vi.fn(async () => ({
        ok: true,
        value: [
          buildLocalEvent({
            localEventId: "event-session",
            localPosSessionId: "local-sale-1",
            sequence: 1,
            sync: { status: "needs_review", uploaded: true },
            type: "session.started",
            uploadSequence: undefined,
          }),
          buildLocalEvent({
            localEventId: "event-cart",
            localPosSessionId: "local-sale-1",
            sequence: 2,
            sync: { status: "needs_review", uploaded: true },
            type: "cart.item_added",
            uploadSequence: undefined,
          }),
          buildLocalEvent({
            localEventId: "event-payment",
            localPosSessionId: "local-sale-1",
            sequence: 3,
            sync: { status: "needs_review", uploaded: true },
            type: "session.payments_updated",
            uploadSequence: undefined,
          }),
          buildLocalEvent({
            localEventId: "event-checkout",
            localPosSessionId: "local-sale-1",
            localTransactionId: "local-txn-1",
            payload: {
              localPosSessionId: "local-sale-1",
              localTransactionId: "local-txn-1",
              receiptNumber: "LOCAL-1-000001",
              subtotal: 25,
              tax: 0,
              total: 25,
              payments: [{ method: "cash", amount: 25, timestamp: 2 }],
            },
            sequence: 5,
            sync: { status: "needs_review", uploaded: true },
            type: "transaction.completed",
            uploadSequence: 5,
          }),
        ],
      })),
      markEventsSynced: vi.fn(async () => ({
        ok: true,
        value: [],
      })),
      markEventsNeedsReview: vi.fn(async () => ({
        ok: true,
        value: [],
      })),
      readProvisionedTerminalSeed: vi.fn(async () => ({
        ok: true,
        value: {
          cloudTerminalId: "terminal-cloud-1",
          displayName: "Front",
          provisionedAt: 1,
          schemaVersion: 1,
          syncSecretHash: "sync-secret-1",
          storeId: "store-1",
          terminalId: "local-terminal-1",
        },
      })),
      writeLocalCloudMapping: vi.fn(async () => ({
        ok: true,
        value: {},
      })),
    };
    const storeFactory = () => store as never;

    const { result } = renderHook(() =>
      usePosLocalSyncRuntimeStatus({
        mode: "status-only",
        storeFactory,
        storeId: "store-1",
        terminalId: "terminal-cloud-1",
      }),
    );

    await waitFor(() =>
      expect(result.current).toEqual(
        expect.objectContaining({
          runtimeStatus: expect.objectContaining({
            sync: expect.objectContaining({
              reviewEventCount: 4,
              status: "needs_review",
              uploadableEventCount: 1,
            }),
          }),
        }),
      ),
    );
    act(() => {
      result.current?.onRetrySync?.();
    });

    await waitFor(() =>
      expect(mocks.ingestLocalEvents).toHaveBeenCalledWith(
        expect.objectContaining({
          events: [
            expect.objectContaining({
              eventType: "sale_completed",
              localEventId: "event-checkout",
            }),
          ],
        }),
      ),
    );
    await waitFor(() =>
      expect(store.markEventsSynced).toHaveBeenCalledWith(
        ["event-checkout", "event-session", "event-cart", "event-payment"],
        { uploaded: true },
      ),
    );
    expect(store.markEventsNeedsReview).not.toHaveBeenCalled();
  });

  it("marks uploaded events for review when the server rejects the batch", async () => {
    mocks.ingestLocalEvents.mockResolvedValue({
      kind: "user_error",
      error: { message: "Sync secret is no longer valid." },
    });
    const store = {
      listEvents: vi.fn(async () => ({
        ok: true,
        value: [
          buildLocalEvent({
            localEventId: "event-session",
            localPosSessionId: "local-session-1",
            sequence: 1,
            type: "session.started",
          }),
          buildLocalEvent({
            localEventId: "event-cart",
            localPosSessionId: "local-session-1",
            payload: {
              localItemId: "local-item-1",
              productId: "product-1",
              productSkuId: "sku-1",
              productName: "Wig Cap",
              productSku: "CAP-1",
              quantity: 1,
              price: 25,
            },
            sequence: 2,
            type: "cart.item_added",
          }),
          buildLocalEvent({
            localEventId: "event-checkout",
            localPosSessionId: "local-session-1",
            localTransactionId: "local-txn-1",
            payload: {
              localPosSessionId: "local-session-1",
              localTransactionId: "local-txn-1",
              receiptNumber: "LOCAL-1-000001",
              subtotal: 25,
              tax: 0,
              total: 25,
              payments: [{ method: "cash", amount: 25, timestamp: 2 }],
            },
            sequence: 3,
            type: "transaction.completed",
          }),
        ],
      })),
      markEventsNeedsReview: vi.fn(async () => ({
        ok: true,
        value: [],
      })),
      markEventsSynced: vi.fn(async () => ({
        ok: true,
        value: [],
      })),
      writeDrawerAuthorityState: vi.fn(async () => ({
        ok: true,
        value: null,
      })),
      readProvisionedTerminalSeed: vi.fn(async () => ({
        ok: true,
        value: {
          cloudTerminalId: "terminal-cloud-1",
          displayName: "Front",
          provisionedAt: 1,
          schemaVersion: 1,
          syncSecretHash: "sync-secret-1",
          storeId: "store-1",
          terminalId: "local-terminal-1",
        },
      })),
    };

    const storeFactory = () => store as never;

    renderHook(() =>
      usePosLocalSyncRuntimeStatus({
        storeFactory,
        storeId: "store-1",
        terminalId: "terminal-cloud-1",
      }),
    );

    await waitFor(() => expect(mocks.ingestLocalEvents).toHaveBeenCalled(), {
      timeout: 5000,
    });
    await waitFor(() =>
      expect(store.markEventsNeedsReview).toHaveBeenCalledWith(
        ["event-checkout", "event-session", "event-cart"],
        "Cloud sync needs review before this local event can finish.",
        { uploaded: true },
      ),
    );
    expect(store.markEventsSynced).not.toHaveBeenCalled();
    expect(store.writeDrawerAuthorityState).not.toHaveBeenCalled();
  });

  it("persists terminal integrity instead of marking events for review when sync authorization fails", async () => {
    mocks.ingestLocalEvents.mockResolvedValue({
      kind: "user_error",
      error: {
        code: "authorization_failed",
        message: "Sync secret is no longer valid.",
        metadata: { terminalAuthorizationFailure: true },
      },
    });
    const store = {
      listEvents: vi.fn(async () => ({
        ok: true,
        value: [
          buildLocalEvent({
            localEventId: "event-open",
            sequence: 1,
            type: "register.opened",
            uploadSequence: 1,
          }),
        ],
      })),
      markEventsNeedsReview: vi.fn(async () => ({
        ok: true,
        value: [],
      })),
      markEventsSynced: vi.fn(async () => ({
        ok: true,
        value: [],
      })),
      readProvisionedTerminalSeed: vi.fn(async () => ({
        ok: true,
        value: {
          cloudTerminalId: "terminal-cloud-1",
          displayName: "Front",
          provisionedAt: 1,
          registerNumber: "1",
          schemaVersion: 1,
          syncSecretHash: "sync-secret-1",
          storeId: "store-1",
          terminalId: "local-terminal-1",
        },
      })),
      writeTerminalIntegrityState: vi.fn(async () => ({
        ok: true,
        value: null,
      })),
    };
    const storeFactory = () => store as never;

    renderHook(() =>
      usePosLocalSyncRuntimeStatus({
        storeFactory,
        storeId: "store-1",
        terminalId: "terminal-cloud-1",
      }),
    );

    await waitFor(() => expect(mocks.ingestLocalEvents).toHaveBeenCalled(), {
      timeout: 3_000,
    });
    expect(store.writeTerminalIntegrityState).toHaveBeenCalledWith(
      expect.objectContaining({
        cloudTerminalId: "terminal-cloud-1",
        reason: "authorization_failed",
        status: "requires_reprovision",
        storeId: "store-1",
        terminalId: "local-terminal-1",
      }),
    );
    expect(store.markEventsNeedsReview).not.toHaveBeenCalled();
    expect(store.markEventsSynced).not.toHaveBeenCalled();
  });

  it("does not persist terminal integrity for generic sync authorization failures", async () => {
    mocks.ingestLocalEvents.mockResolvedValue({
      kind: "user_error",
      error: {
        code: "authorization_failed",
        message: "User session expired.",
      },
    });
    const store = {
      listEvents: vi.fn(async () => ({
        ok: true,
        value: [
          buildLocalEvent({
            localEventId: "event-open",
            sequence: 1,
            type: "register.opened",
            uploadSequence: 1,
          }),
        ],
      })),
      markEventsNeedsReview: vi.fn(async () => ({
        ok: true,
        value: [],
      })),
      markEventsSynced: vi.fn(async () => ({
        ok: true,
        value: [],
      })),
      readProvisionedTerminalSeed: vi.fn(async () => ({
        ok: true,
        value: {
          cloudTerminalId: "terminal-cloud-1",
          displayName: "Front",
          provisionedAt: 1,
          registerNumber: "1",
          schemaVersion: 1,
          syncSecretHash: "sync-secret-1",
          storeId: "store-1",
          terminalId: "local-terminal-1",
        },
      })),
      writeDrawerAuthorityState: vi.fn(async () => ({
        ok: true,
        value: null,
      })),
      writeTerminalIntegrityState: vi.fn(async () => ({
        ok: true,
        value: null,
      })),
    };

    renderHook(() =>
      usePosLocalSyncRuntimeStatus({
        storeFactory: () => store as never,
        storeId: "store-1",
        terminalId: "terminal-cloud-1",
      }),
    );

    await waitFor(() => expect(mocks.ingestLocalEvents).toHaveBeenCalled(), {
      timeout: 5_000,
    });
    expect(store.markEventsNeedsReview).not.toHaveBeenCalled();
    expect(store.markEventsSynced).not.toHaveBeenCalled();
    expect(store.writeDrawerAuthorityState).not.toHaveBeenCalled();
    expect(store.writeTerminalIntegrityState).not.toHaveBeenCalled();
  });

  it("skips upload attempts while terminal integrity is blocked", async () => {
    const store = {
      listEvents: vi.fn(async () => ({
        ok: true,
        value: [
          buildLocalEvent({
            localEventId: "event-open",
            sequence: 1,
            type: "register.opened",
            uploadSequence: 1,
          }),
        ],
      })),
      markEventsSynced: vi.fn(async () => ({
        ok: true,
        value: [],
      })),
      readProvisionedTerminalSeed: vi.fn(async () => ({
        ok: true,
        value: {
          cloudTerminalId: "terminal-cloud-1",
          displayName: "Front",
          provisionedAt: 1,
          registerNumber: "1",
          schemaVersion: 1,
          syncSecretHash: "sync-secret-1",
          storeId: "store-1",
          terminalId: "local-terminal-1",
        },
      })),
      readTerminalIntegrityState: vi.fn(async () => ({
        ok: true,
        value: {
          cloudTerminalId: "terminal-cloud-1",
          observedAt: 1,
          reason: "authorization_failed",
          status: "requires_reprovision",
          storeId: "store-1",
          terminalId: "local-terminal-1",
        },
      })),
    };

    renderHook(() =>
      usePosLocalSyncRuntimeStatus({
        storeFactory: () => store as never,
        storeId: "store-1",
        terminalId: "terminal-cloud-1",
      }),
    );

    await waitFor(() =>
      expect(store.readTerminalIntegrityState).toHaveBeenCalled(),
    );
    expect(mocks.ingestLocalEvents).not.toHaveBeenCalled();
    expect(store.markEventsSynced).not.toHaveBeenCalled();
  });

  it("defers app-session-unverified uploads while recovery is waiting for network", async () => {
    const appSessionRecovery = {
      assertion: "present" as const,
      status: "waiting_for_network" as const,
    };
    const store = {
      listEvents: vi.fn(async () => ({
        ok: true,
        value: [
          buildLocalEvent({
            localEventId: "event-offline-sale",
            localPosSessionId: "local-session-1",
            localTransactionId: "local-txn-1",
            payload: {
              localPosSessionId: "local-session-1",
              localTransactionId: "local-txn-1",
              receiptNumber: "LOCAL-1-000001",
              subtotal: 25,
              tax: 0,
              total: 25,
              customerEmail: "customer@example.com",
              payments: [{ method: "cash", amount: 25, timestamp: 2 }],
            },
            sequence: 1,
            type: "transaction.completed",
            validationMetadata: {
              flags: ["app-session-unverified", "cloud-validation-uncertain"],
              observedAt: 2_000,
              uploadDeferredUntil: "app-session-validated",
            },
          }),
        ],
      })),
      markEventsSynced: vi.fn(async () => ({
        ok: true,
        value: [],
      })),
      readProvisionedTerminalSeed: vi.fn(async () => ({
        ok: true,
        value: {
          cloudTerminalId: "terminal-cloud-1",
          displayName: "Front",
          provisionedAt: 1,
          schemaVersion: 1,
          syncSecretHash: "sync-secret-1",
          storeId: "store-1",
          terminalId: "local-terminal-1",
        },
      })),
    };

    const { result } = renderHook(() =>
      usePosLocalSyncRuntimeStatus({
        appSessionRecovery,
        storeFactory: () => store as never,
        storeId: "store-1",
        terminalId: "terminal-cloud-1",
      }),
    );

    await waitFor(() =>
      expect(mocks.reportTerminalRuntimeStatus).toHaveBeenCalled(),
    );
    await waitFor(() =>
      expect(result.current?.debug).toEqual(
        expect.objectContaining({
          appSessionUnverifiedEventCount: 1,
          cloudValidationUncertainEventCount: 1,
          deferredUploadEventCount: 1,
          pendingUploadEventCount: 0,
        }),
      ),
    );
    expect(result.current?.copyDiagnostics?.counts).toEqual(
      expect.objectContaining({
        appSessionUnverifiedEventCount: 1,
        cloudValidationUncertainEventCount: 1,
        deferredUploadEventCount: 1,
      }),
    );
    expect(mocks.ingestLocalEvents).not.toHaveBeenCalled();
    expect(store.markEventsSynced).not.toHaveBeenCalled();
    expect(JSON.stringify(result.current?.copyDiagnostics)).not.toContain(
      "customer@example.com",
    );
    expect(JSON.stringify(result.current?.copyDiagnostics)).not.toContain(
      "payments",
    );
  });

  it("uploads app-session-unverified history after supported recovery is present", async () => {
    const appSessionRecovery = {
      assertion: "present" as const,
      status: "recoverable" as const,
    };
    mocks.ingestLocalEvents.mockResolvedValue({
      kind: "ok",
      data: {
        accepted: [
          {
            localEventId: "event-offline-sale",
            sequence: 1,
            status: "projected",
          },
        ],
        held: [],
        mappings: [],
        conflicts: [],
        syncCursor: {
          localRegisterSessionId: "register-1",
          acceptedThroughSequence: 1,
        },
      },
    });
    const store = {
      listEvents: vi.fn(async () => ({
        ok: true,
        value: [
          buildLocalEvent({
            localEventId: "event-offline-sale",
            localPosSessionId: "local-session-1",
            localTransactionId: "local-txn-1",
            payload: {
              localPosSessionId: "local-session-1",
              localTransactionId: "local-txn-1",
              receiptNumber: "LOCAL-1-000001",
              subtotal: 25,
              tax: 0,
              total: 25,
              payments: [{ method: "cash", amount: 25, timestamp: 2 }],
            },
            sequence: 1,
            type: "transaction.completed",
            validationMetadata: {
              flags: ["app-session-unverified", "cloud-validation-uncertain"],
              observedAt: 2_000,
              uploadDeferredUntil: "app-session-validated",
            },
          }),
        ],
      })),
      markEventsSynced: vi.fn(async () => ({
        ok: true,
        value: [],
      })),
      readProvisionedTerminalSeed: vi.fn(async () => ({
        ok: true,
        value: {
          cloudTerminalId: "terminal-cloud-1",
          displayName: "Front",
          provisionedAt: 1,
          schemaVersion: 1,
          syncSecretHash: "sync-secret-1",
          storeId: "store-1",
          terminalId: "local-terminal-1",
        },
      })),
      writeLocalCloudMapping: vi.fn(async () => ({
        ok: true,
        value: {},
      })),
    };

    renderHook(() =>
      usePosLocalSyncRuntimeStatus({
        appSessionRecovery,
        eventAppendToken: 1,
        storeFactory: () => store as never,
        storeId: "store-1",
        terminalId: "terminal-cloud-1",
      }),
    );

    await waitFor(
      () =>
        expect(mocks.ingestLocalEvents).toHaveBeenCalledWith(
          expect.objectContaining({
            events: [
              expect.objectContaining({
                eventType: "sale_completed",
                localEventId: "event-offline-sale",
              }),
            ],
          }),
        ),
      { timeout: 5_000 },
    );
    expect(store.markEventsSynced).toHaveBeenCalledWith(
      ["event-offline-sale"],
      {
        uploaded: true,
      },
    );
  });

  it("returns failure when local cloud mapping persistence fails", async () => {
    const store = {
      writeLocalCloudMapping: vi.fn(async () => ({
        ok: false,
        error: { code: "write_failed", message: "mapping write failed" },
      })),
    };

    const result = await writeReturnedLocalCloudMappings(store as never, [
      {
        cloudId: "session-1",
        createdAt: 10,
        localId: "local-session-1",
        localIdKind: "posSession",
      },
    ]);

    expect(result).toEqual({
      ok: false,
      message: "mapping write failed",
    });
    expect(store.writeLocalCloudMapping).toHaveBeenCalledWith({
      entity: "posSession",
      localId: "local-session-1",
      cloudId: "session-1",
      mappedAt: 10,
    });
  });

  it("persists returned expense session and transaction mappings", async () => {
    const store = {
      writeLocalCloudMapping: vi.fn(async () => ({
        ok: true,
        value: null,
      })),
    };

    const result = await writeReturnedLocalCloudMappings(store as never, [
      {
        cloudId: "expense-session-1",
        createdAt: 10,
        localId: "local-expense-session-1",
        localIdKind: "expenseSession",
      },
      {
        cloudId: "expense-transaction-1",
        createdAt: 11,
        localId: "local-expense-event-1",
        localIdKind: "expenseTransaction",
      },
    ]);

    expect(result).toEqual({ ok: true });
    expect(store.writeLocalCloudMapping).toHaveBeenCalledWith({
      entity: "expenseSession",
      localId: "local-expense-session-1",
      cloudId: "expense-session-1",
      mappedAt: 10,
    });
    expect(store.writeLocalCloudMapping).toHaveBeenCalledWith({
      entity: "expenseTransaction",
      localId: "local-expense-event-1",
      cloudId: "expense-transaction-1",
      mappedAt: 11,
    });
  });

  it("keeps sync-written transaction mappings visible to scoped readers", async () => {
    const store = createPosLocalStore({
      adapter: createMemoryPosLocalStorageAdapter(),
    });

    await expect(
      writeReturnedLocalCloudMappings(
        store,
        [
          {
            cloudId: "cloud-transaction-1",
            createdAt: 10,
            localId: "local-transaction-1",
            localIdKind: "transaction",
          },
        ],
        {
          events: [],
          storeId: "store-1",
          terminalId: "terminal-1",
        },
      ),
    ).resolves.toEqual({ ok: true });

    await expect(
      store.readMappingPage({
        limit: 10,
        storeId: "store-1",
        terminalId: "terminal-1",
      }),
    ).resolves.toEqual({
      ok: true,
      value: {
        items: [
          {
            cloudId: "cloud-transaction-1",
            entity: "posTransaction",
            localId: "local-transaction-1",
            mappedAt: 10,
            storeId: "store-1",
            terminalId: "terminal-1",
          },
        ],
      },
    });
  });

  it("persists returned register mappings as exact scoped current candidates", async () => {
    const store = {
      writeLocalCloudMapping: vi.fn(async () => ({ ok: true, value: null })),
    };

    const result = await writeReturnedLocalCloudMappings(
      store as never,
      [
        {
          cloudId: "cloud-register-2",
          createdAt: 12,
          localId: "local-register-2",
          localIdKind: "registerSession",
        },
      ],
      {
        events: [
          {
            localRegisterSessionId: "local-register-2",
            registerNumber: "2",
            type: "register.opened",
          } as never,
        ],
        registerNumber: "fallback",
        storeId: "store-1",
        terminalId: "local-terminal-1",
      },
    );

    expect(result).toEqual({ ok: true });
    expect(store.writeLocalCloudMapping).toHaveBeenCalledWith({
      cloudId: "cloud-register-2",
      entity: "registerSession",
      localId: "local-register-2",
      mappedAt: 12,
      registerCandidateState: "current",
      registerNumber: "2",
      storeId: "store-1",
      terminalId: "local-terminal-1",
    });
  });

  it("does not write drawer authority when drawer-open mapping persistence fails during runtime upload", async () => {
    mocks.ingestLocalEvents.mockResolvedValue({
      kind: "ok",
      data: {
        accepted: [
          {
            localEventId: "event-open",
            sequence: 1,
            status: "projected",
          },
        ],
        held: [],
        mappings: [
          {
            _id: "mapping-open",
            storeId: "store-1",
            terminalId: "terminal-cloud-1",
            localRegisterSessionId: "register-1",
            localEventId: "event-open",
            localIdKind: "registerSession",
            localId: "register-1",
            cloudTable: "registerSession",
            cloudId: "register-session-1",
            createdAt: 12,
          },
        ],
        conflicts: [],
        syncCursor: {
          localRegisterSessionId: "register-1",
          acceptedThroughSequence: 1,
        },
      },
    });
    const store = {
      listEvents: vi.fn(async () => ({
        ok: true,
        value: [
          buildLocalEvent({
            localEventId: "event-open",
            localRegisterSessionId: "register-1",
            sequence: 1,
            type: "register.opened",
          }),
        ],
      })),
      markEventsNeedsReview: vi.fn(async () => ({
        ok: true,
        value: [],
      })),
      markEventsSynced: vi.fn(async () => ({
        ok: true,
        value: [],
      })),
      readProvisionedTerminalSeed: vi.fn(async () => ({
        ok: true,
        value: {
          cloudTerminalId: "terminal-cloud-1",
          displayName: "Front",
          provisionedAt: 1,
          registerNumber: "1",
          schemaVersion: 1,
          syncSecretHash: "sync-secret-1",
          storeId: "store-1",
          terminalId: "local-terminal-1",
        },
      })),
      writeDrawerAuthorityState: vi.fn(async () => ({
        ok: true,
        value: null,
      })),
      writeLocalCloudMapping: vi.fn(async () => ({
        ok: false,
        error: { code: "write_failed", message: "mapping write failed" },
      })),
    };

    renderHook(() =>
      usePosLocalSyncRuntimeStatus({
        storeFactory: () => store as never,
        storeId: "store-1",
        terminalId: "terminal-cloud-1",
      }),
    );

    await waitFor(
      () =>
        expect(store.markEventsNeedsReview).toHaveBeenCalledWith(
          ["event-open"],
          "Cloud sync needs review before this local event can finish.",
          { uploaded: true },
        ),
      { timeout: 3_000 },
    );
    expect(store.writeDrawerAuthorityState).not.toHaveBeenCalled();
    expect(store.markEventsSynced).not.toHaveBeenCalled();
  });

  it("does not clear hard drawer authority blocks after a blocked closeout sync succeeds", async () => {
    mocks.ingestLocalEvents.mockResolvedValue({
      kind: "ok",
      data: {
        accepted: [
          {
            localEventId: "event-closeout",
            sequence: 1,
            status: "projected",
          },
        ],
        held: [],
        mappings: [],
        conflicts: [],
        syncCursor: {
          localRegisterSessionId: "register-1",
          acceptedThroughSequence: 1,
        },
      },
    });
    const store = {
      listEvents: vi.fn(async () => ({
        ok: true,
        value: [
          buildLocalEvent({
            localEventId: "event-closeout",
            sequence: 1,
            sync: { status: "pending" },
            type: "register.closeout_started",
          }),
        ],
      })),
      clearDrawerAuthorityState: vi.fn(async () => ({
        ok: true,
        value: null,
      })),
      markEventsSynced: vi.fn(async () => ({
        ok: true,
        value: [],
      })),
      readDrawerAuthorityState: vi.fn(async () => ({
        ok: true,
        value: {
          localRegisterSessionId: "register-1",
          observedAt: 1,
          reason: "cloud_closed",
          status: "blocked",
          storeId: "store-1",
          terminalId: "local-terminal-1",
        },
      })),
      readProvisionedTerminalSeed: vi.fn(async () => ({
        ok: true,
        value: {
          cloudTerminalId: "terminal-cloud-1",
          displayName: "Front",
          provisionedAt: 1,
          schemaVersion: 1,
          syncSecretHash: "sync-secret-1",
          storeId: "store-1",
          terminalId: "local-terminal-1",
        },
      })),
      writeLocalCloudMapping: vi.fn(async () => ({
        ok: true,
        value: {},
      })),
    };
    renderHook(() =>
      usePosLocalSyncRuntimeStatus({
        storeFactory: () => store as never,
        storeId: "store-1",
        terminalId: "terminal-cloud-1",
      }),
    );

    await waitFor(() => expect(mocks.ingestLocalEvents).toHaveBeenCalled());
    await waitFor(() => expect(store.markEventsSynced).toHaveBeenCalled());
    expect(store.clearDrawerAuthorityState).not.toHaveBeenCalled();
  });

  it("clears recoverable authority-unknown drawer blocks after retry succeeds", async () => {
    mocks.ingestLocalEvents.mockResolvedValue({
      kind: "ok",
      data: {
        accepted: [
          {
            localEventId: "event-closeout",
            sequence: 1,
            status: "projected",
          },
        ],
        held: [],
        mappings: [],
        conflicts: [],
        syncCursor: {
          localRegisterSessionId: "register-1",
          acceptedThroughSequence: 1,
        },
      },
    });
    const store = {
      listEvents: vi.fn(async () => ({
        ok: true,
        value: [
          buildLocalEvent({
            localEventId: "event-closeout",
            sequence: 1,
            sync: { status: "pending" },
            type: "register.closeout_started",
          }),
        ],
      })),
      clearDrawerAuthorityState: vi.fn(async () => ({
        ok: true,
        value: null,
      })),
      markEventsSynced: vi.fn(async () => ({
        ok: true,
        value: [],
      })),
      readDrawerAuthorityState: vi.fn(async () => ({
        ok: true,
        value: {
          localRegisterSessionId: "register-1",
          observedAt: 1,
          reason: "authority_unknown",
          status: "blocked",
          storeId: "store-1",
          terminalId: "local-terminal-1",
        },
      })),
      readProvisionedTerminalSeed: vi.fn(async () => ({
        ok: true,
        value: {
          cloudTerminalId: "terminal-cloud-1",
          displayName: "Front",
          provisionedAt: 1,
          schemaVersion: 1,
          syncSecretHash: "sync-secret-1",
          storeId: "store-1",
          terminalId: "local-terminal-1",
        },
      })),
      writeLocalCloudMapping: vi.fn(async () => ({
        ok: true,
        value: {},
      })),
    };
    renderHook(() =>
      usePosLocalSyncRuntimeStatus({
        storeFactory: () => store as never,
        storeId: "store-1",
        terminalId: "terminal-cloud-1",
      }),
    );

    await waitFor(() =>
      expect(store.clearDrawerAuthorityState).toHaveBeenCalledWith({
        localRegisterSessionId: "register-1",
        storeId: "store-1",
        terminalId: "local-terminal-1",
      }),
    );
    expect(store.markEventsSynced).toHaveBeenCalledWith(["event-closeout"], {
      uploaded: true,
    });
  });

  it("clears older recoverable drawer blocks when a replacement open maps to the same cloud drawer", async () => {
    mocks.ingestLocalEvents.mockResolvedValue({
      kind: "ok",
      data: {
        accepted: [
          {
            localEventId: "event-new-open",
            sequence: 1,
            status: "projected",
          },
        ],
        held: [],
        mappings: [
          {
            cloudId: "register-cloud-1",
            localId: "register-new",
            localIdKind: "registerSession",
            createdAt: 20,
          },
        ],
        conflicts: [],
        syncCursor: {
          localRegisterSessionId: "register-new",
          acceptedThroughSequence: 1,
        },
      },
    });
    const store = {
      listEvents: vi.fn(async () => ({
        ok: true,
        value: [
          buildLocalEvent({
            createdAt: 1,
            localEventId: "event-old-open",
            localRegisterSessionId: "register-old",
            sequence: 1,
            sync: { status: "synced", uploaded: true },
            type: "register.opened",
          }),
          buildLocalEvent({
            createdAt: 20,
            localEventId: "event-new-open",
            localRegisterSessionId: "register-new",
            payload: { localRegisterSessionId: "register-new" },
            sequence: 2,
            sync: { status: "pending" },
            type: "register.opened",
            uploadSequence: 1,
          }),
        ],
      })),
      clearDrawerAuthorityState: vi.fn(async () => ({
        ok: true,
        value: null,
      })),
      listLocalCloudMappings: vi.fn(async () => ({
        ok: true,
        value: [
          {
            cloudId: "register-cloud-1",
            entity: "registerSession",
            localId: "register-old",
            mappedAt: 1,
          },
        ],
      })),
      markEventsSynced: vi.fn(async () => ({
        ok: true,
        value: [],
      })),
      readDrawerAuthorityState: vi.fn(
        async (input: {
          localRegisterSessionId: string;
          storeId: string;
          terminalId: string;
        }) => ({
          ok: true,
          value:
            input.localRegisterSessionId === "register-old"
              ? {
                  cloudRegisterSessionId: "register-cloud-1",
                  localRegisterSessionId: "register-old",
                  observedAt: 10,
                  reason: "lifecycle_rejected" as const,
                  status: "blocked" as const,
                  storeId: "store-1",
                  terminalId: "local-terminal-1",
                }
              : null,
        }),
      ),
      readProvisionedTerminalSeed: vi.fn(async () => ({
        ok: true,
        value: {
          cloudTerminalId: "terminal-cloud-1",
          displayName: "Front",
          provisionedAt: 1,
          schemaVersion: 1,
          syncSecretHash: "sync-secret-1",
          storeId: "store-1",
          terminalId: "local-terminal-1",
        },
      })),
      writeLocalCloudMapping: vi.fn(async () => ({
        ok: true,
        value: {},
      })),
    };

    renderHook(() =>
      usePosLocalSyncRuntimeStatus({
        storeFactory: () => store as never,
        storeId: "store-1",
        terminalId: "terminal-cloud-1",
      }),
    );

    await waitFor(() =>
      expect(store.clearDrawerAuthorityState).toHaveBeenCalledWith({
        localRegisterSessionId: "register-old",
        storeId: "store-1",
        terminalId: "local-terminal-1",
      }),
    );
    expect(store.markEventsSynced).toHaveBeenCalledWith(["event-new-open"], {
      uploaded: true,
    });
  });

  it("clears stale recoverable drawer blocks when lifecycle events are already settled", async () => {
    const store = {
      listEvents: vi.fn(async () => ({
        ok: true,
        value: [
          buildLocalEvent({
            localEventId: "event-open",
            localRegisterSessionId: "register-1",
            sequence: 1,
            sync: { status: "synced" },
            type: "register.opened",
          }),
          buildLocalEvent({
            localEventId: "event-closeout",
            localRegisterSessionId: "register-1",
            sequence: 2,
            sync: { status: "synced", uploaded: true },
            type: "register.closeout_started",
          }),
        ],
      })),
      clearDrawerAuthorityState: vi.fn(async () => ({
        ok: true,
        value: null,
      })),
      readDrawerAuthorityState: vi.fn(async () => ({
        ok: true,
        value: {
          localRegisterSessionId: "register-1",
          observedAt: 1,
          reason: "lifecycle_rejected",
          status: "blocked",
          storeId: "store-1",
          terminalId: "local-terminal-1",
        },
      })),
      readProvisionedTerminalSeed: vi.fn(async () => ({
        ok: true,
        value: {
          cloudTerminalId: "terminal-cloud-1",
          displayName: "Front",
          provisionedAt: 1,
          schemaVersion: 1,
          syncSecretHash: "sync-secret-1",
          storeId: "store-1",
          terminalId: "local-terminal-1",
        },
      })),
    };
    renderHook(() =>
      usePosLocalSyncRuntimeStatus({
        storeFactory: () => store as never,
        storeId: "store-1",
        terminalId: "terminal-cloud-1",
      }),
    );

    await waitFor(() =>
      expect(store.clearDrawerAuthorityState).toHaveBeenCalledWith({
        localRegisterSessionId: "register-1",
        storeId: "store-1",
        terminalId: "local-terminal-1",
      }),
    );
  });

  it("keeps drawer authority blocked when a same-drawer review event remains", async () => {
    mocks.ingestLocalEvents.mockResolvedValue({
      kind: "ok",
      data: {
        accepted: [
          {
            localEventId: "event-open",
            sequence: 1,
            status: "projected",
          },
          {
            localEventId: "event-closeout",
            sequence: 2,
            status: "conflicted",
          },
        ],
        held: [],
        mappings: [],
        conflicts: [],
        syncCursor: {
          localRegisterSessionId: "register-1",
          acceptedThroughSequence: 2,
        },
      },
    });
    const store = {
      listEvents: vi.fn(async () => ({
        ok: true,
        value: [
          buildLocalEvent({
            localEventId: "event-open",
            sequence: 1,
            type: "register.opened",
          }),
          buildLocalEvent({
            localEventId: "event-closeout",
            sequence: 2,
            type: "register.closeout_started",
          }),
        ],
      })),
      clearDrawerAuthorityState: vi.fn(async () => ({
        ok: true,
        value: null,
      })),
      markEventsNeedsReview: vi.fn(async () => ({
        ok: true,
        value: [],
      })),
      markEventsSynced: vi.fn(async () => ({
        ok: true,
        value: [],
      })),
      readDrawerAuthorityState: vi.fn(async () => ({
        ok: true,
        value: {
          localRegisterSessionId: "register-1",
          observedAt: 1,
          reason: "lifecycle_rejected",
          status: "blocked",
          storeId: "store-1",
          terminalId: "local-terminal-1",
        },
      })),
      readProvisionedTerminalSeed: vi.fn(async () => ({
        ok: true,
        value: {
          cloudTerminalId: "terminal-cloud-1",
          displayName: "Front",
          provisionedAt: 1,
          schemaVersion: 1,
          syncSecretHash: "sync-secret-1",
          storeId: "store-1",
          terminalId: "local-terminal-1",
        },
      })),
      writeDrawerAuthorityState: vi.fn(async () => ({
        ok: true,
        value: null,
      })),
      writeLocalCloudMapping: vi.fn(async () => ({
        ok: true,
        value: {},
      })),
    };

    renderHook(() =>
      usePosLocalSyncRuntimeStatus({
        storeFactory: () => store as never,
        storeId: "store-1",
        terminalId: "terminal-cloud-1",
      }),
    );

    await waitFor(() =>
      expect(store.markEventsNeedsReview).toHaveBeenCalledWith(
        ["event-closeout"],
        "Cloud sync needs review before this local event can finish.",
        { uploaded: true },
      ),
    );
    expect(store.writeDrawerAuthorityState).toHaveBeenCalledWith(
      expect.objectContaining({
        localRegisterSessionId: "register-1",
        reason: "lifecycle_rejected",
        status: "blocked",
      }),
    );
    expect(store.clearDrawerAuthorityState).not.toHaveBeenCalled();
  });

  it("throws local store write failures before the scheduler can clear sync state", () => {
    expect(() =>
      assertPosLocalStoreOk({
        ok: false,
        error: { code: "write_failed", message: "write failed" },
      }),
    ).toThrow("write failed");
  });

  it("does not upload events through a stale terminal seed from another store", async () => {
    const store = {
      listEvents: vi.fn(async () => ({
        ok: true,
        value: [
          buildLocalEvent({
            localEventId: "event-payment",
            localPosSessionId: "local-session-1",
            payload: {
              localPosSessionId: "local-session-1",
              payments: [{ method: "cash", amount: 25, timestamp: 2 }],
              stage: "paymentAdded",
            },
            sequence: 3,
            type: "session.payments_updated",
          }),
          buildLocalEvent({
            localEventId: "event-checkout",
            localPosSessionId: "local-session-1",
            localTransactionId: "local-txn-1",
            payload: {
              localPosSessionId: "local-session-1",
              localTransactionId: "local-txn-1",
              receiptNumber: "LOCAL-1-000001",
              subtotal: 25,
              tax: 0,
              total: 25,
              payments: [{ method: "cash", amount: 25, timestamp: 2 }],
            },
            sequence: 1,
            storeId: "store-2",
            terminalId: "terminal-cloud-2",
            type: "transaction.completed",
          }),
        ],
      })),
      markEventsSynced: vi.fn(async () => ({
        ok: true,
        value: [],
      })),
      readProvisionedTerminalSeed: vi.fn(async () => ({
        ok: true,
        value: {
          cloudTerminalId: "terminal-cloud-1",
          displayName: "Front",
          provisionedAt: 1,
          schemaVersion: 1,
          syncSecretHash: "sync-secret-1",
          storeId: "store-1",
          terminalId: "local-terminal-1",
        },
      })),
    };

    const { result } = renderHook(() =>
      usePosLocalSyncRuntimeStatus({
        storeFactory: () => store as never,
        storeId: "store-2",
        terminalId: "terminal-cloud-2",
      }),
    );

    await waitFor(() => expect(store.listEvents).toHaveBeenCalled());
    expect(result.current).toEqual(
      expect.objectContaining({
        pendingEventCount: 1,
        status: "pending",
      }),
    );
    expect(mocks.ingestLocalEvents).not.toHaveBeenCalled();
    expect(store.markEventsSynced).not.toHaveBeenCalled();
  });

  it("reads status-only diagnostics without uploading on route entry, retry, or append", async () => {
    const store = {
      listEvents: vi.fn(async () => ({
        ok: true,
        value: [
          buildLocalEvent({
            localEventId: "event-open",
            payload: {
              openingFloat: 100,
              status: "open",
            },
            sequence: 1,
            type: "register.opened",
          }),
          buildLocalEvent({
            localEventId: "event-session",
            localPosSessionId: "local-session-1",
            sequence: 2,
            type: "session.started",
          }),
        ],
      })),
      markEventsSynced: vi.fn(async () => ({
        ok: true,
        value: [],
      })),
      readProvisionedTerminalSeed: vi.fn(async () => ({
        ok: true,
        value: {
          cloudTerminalId: "terminal-cloud-1",
          displayName: "Front",
          provisionedAt: 1,
          schemaVersion: 1,
          syncSecretHash: "sync-secret-1",
          storeId: "store-1",
          terminalId: "local-terminal-1",
        },
      })),
    };
    const storeFactory = () => store as never;

    const { result, rerender } = renderHook(
      ({ eventAppendToken }: { eventAppendToken: number }) =>
        usePosLocalSyncRuntimeStatus({
          eventAppendToken,
          mode: "status-only",
          storeFactory,
          storeId: "store-1",
          terminalId: "terminal-cloud-1",
        }),
      {
        initialProps: { eventAppendToken: 0 },
      },
    );

    await waitFor(() =>
      expect(result.current).toEqual(
        expect.objectContaining({
          debug: expect.objectContaining({
            localOnlyEventCount: 1,
            mode: "status-only",
            oldestPendingEventAt: 1,
            oldestPendingEventSequence: 1,
            oldestPendingUploadSequence: 1,
            nextPendingUploadSequence: 1,
            pendingUploadEventCount: 1,
          }),
          pendingEventCount: 1,
          status: "pending",
        }),
      ),
    );

    act(() => {
      result.current?.onRetrySync?.();
    });
    rerender({ eventAppendToken: 1 });

    await waitFor(() =>
      expect(store.listEvents.mock.calls.length).toBeGreaterThanOrEqual(2),
    );
    expect(mocks.ingestLocalEvents).not.toHaveBeenCalled();
    expect(store.markEventsSynced).not.toHaveBeenCalled();
  });

  it("drains already-pending expense completions from status-only mode on route entry", async () => {
    const store = {
      listEvents: vi.fn(async () => ({
        ok: true,
        value: [
          buildLocalEvent({
            localEventId: "event-expense",
            localRegisterSessionId: undefined,
            payload: {
              localExpenseEventId: "local-expense-event-1",
              localExpenseSessionId: "local-expense-session-1",
              subtotal: 1000,
              tax: 0,
              total: 1000,
              items: [],
            },
            sequence: 1,
            type: "expense.completed" as PosLocalEventRecord["type"],
            uploadSequence: 1,
          }),
        ],
      })),
      markEventsSynced: vi.fn(async () => ({
        ok: true,
        value: [],
      })),
      readProvisionedTerminalSeed: vi.fn(async () => ({
        ok: true,
        value: {
          cloudTerminalId: "terminal-cloud-1",
          displayName: "Front",
          provisionedAt: 1,
          schemaVersion: 1,
          syncSecretHash: "sync-secret-1",
          storeId: "store-1",
          terminalId: "local-terminal-1",
        },
      })),
      writeLocalCloudMapping: vi.fn(async () => ({
        ok: true,
        value: {
          cloudId: "expense-transaction-1",
          entity: "expenseTransaction",
          localId: "local-expense-event-1",
          mappedAt: 10,
        },
      })),
    };
    mocks.ingestLocalEvents.mockResolvedValue({
      kind: "ok",
      data: {
        accepted: [
          {
            localEventId: "event-expense",
            sequence: 1,
            status: "projected",
          },
        ],
        held: [],
        mappings: [],
        conflicts: [],
        syncCursor: {
          localRegisterSessionId: "local-expense-session-1",
          acceptedThroughSequence: 1,
        },
      },
    });
    const storeFactory = () => store as never;

    renderHook(() =>
      usePosLocalSyncRuntimeStatus({
        drainOnAppend: true,
        eventAppendToken: 0,
        mode: "status-only",
        storeFactory,
        storeId: "store-1",
        terminalId: "terminal-cloud-1",
      }),
    );

    await waitFor(() =>
      expect(mocks.ingestLocalEvents).toHaveBeenCalledWith(
        expect.objectContaining({
          events: [
            expect.objectContaining({
              eventType: "expense_recorded",
              localEventId: "event-expense",
              sequence: 1,
            }),
          ],
        }),
      ),
    );
    expect(store.markEventsSynced).toHaveBeenCalledWith(["event-expense"], {
      uploaded: true,
    });
  });

  it("runs one immediate upload from status-only mode after a local event append when enabled", async () => {
    const store = {
      listEvents: vi.fn(async () => ({
        ok: true,
        value: [
          buildLocalEvent({
            localEventId: "event-open",
            payload: {
              openingFloat: 100,
              status: "open",
            },
            sequence: 1,
            type: "register.opened",
            uploadSequence: 1,
          }),
        ],
      })),
      markEventsSynced: vi.fn(async () => ({
        ok: true,
        value: [],
      })),
      readProvisionedTerminalSeed: vi.fn(async () => ({
        ok: true,
        value: {
          cloudTerminalId: "terminal-cloud-1",
          displayName: "Front",
          provisionedAt: 1,
          schemaVersion: 1,
          syncSecretHash: "sync-secret-1",
          storeId: "store-1",
          terminalId: "local-terminal-1",
        },
      })),
      writeLocalCloudMapping: vi.fn(async () => ({
        ok: true,
        value: {
          cloudId: "register-session-1",
          entity: "registerSession",
          localId: "register-1",
          mappedAt: 10,
        },
      })),
    };
    mocks.ingestLocalEvents.mockResolvedValue({
      kind: "ok",
      data: {
        accepted: [
          {
            localEventId: "event-open",
            sequence: 1,
            status: "projected",
          },
        ],
        held: [],
        mappings: [],
        conflicts: [],
        syncCursor: {
          localRegisterSessionId: "register-1",
          acceptedThroughSequence: 1,
        },
      },
    });
    const storeFactory = () => store as never;

    const { rerender } = renderHook(
      ({ eventAppendToken }: { eventAppendToken: number }) =>
        usePosLocalSyncRuntimeStatus({
          drainOnAppend: true,
          eventAppendToken,
          mode: "status-only",
          storeFactory,
          storeId: "store-1",
          terminalId: "terminal-cloud-1",
        }),
      {
        initialProps: { eventAppendToken: 0 },
      },
    );

    await waitFor(() => expect(store.listEvents).toHaveBeenCalled());
    expect(mocks.ingestLocalEvents).not.toHaveBeenCalled();

    rerender({ eventAppendToken: 1 });

    await waitFor(() =>
      expect(mocks.ingestLocalEvents).toHaveBeenCalledWith(
        expect.objectContaining({
          events: [
            expect.objectContaining({
              localEventId: "event-open",
              sequence: 1,
            }),
          ],
        }),
      ),
    );
    expect(store.markEventsSynced).toHaveBeenCalledWith(["event-open"], {
      uploaded: true,
    });
  });

  it("publishes runtime check-ins best-effort without blocking local sync upload", async () => {
    mocks.reportTerminalRuntimeStatus.mockRejectedValue(
      new Error("Terminal status endpoint unavailable"),
    );
    mocks.ingestLocalEvents.mockResolvedValue({
      kind: "ok",
      data: {
        accepted: [
          {
            localEventId: "event-open",
            sequence: 1,
            status: "projected",
          },
        ],
        held: [],
        mappings: [],
        conflicts: [],
        syncCursor: {
          localRegisterSessionId: "register-1",
          acceptedThroughSequence: 1,
        },
      },
    });
    const store = {
      listEvents: vi.fn(async () => ({
        ok: true,
        value: [
          buildLocalEvent({
            localEventId: "event-open",
            payload: {
              openingFloat: 100,
              staffProofToken: "payload-proof-token",
            },
            sequence: 1,
            staffProofToken: "proof-token-a",
            type: "register.opened",
            uploadSequence: 1,
          }),
        ],
      })),
      markEventsSynced: vi.fn(async () => ({
        ok: true,
        value: [],
      })),
      readProvisionedTerminalSeed: vi.fn(async () => ({
        ok: true,
        value: {
          cloudTerminalId: "terminal-cloud-1",
          displayName: "Front",
          provisionedAt: 1,
          schemaVersion: 1,
          syncSecretHash: "sync-secret-1",
          storeId: "store-1",
          terminalId: "local-terminal-1",
        },
      })),
      writeLocalCloudMapping: vi.fn(async () => ({
        ok: true,
        value: {
          cloudId: "register-session-1",
          entity: "registerSession",
          localId: "register-1",
          mappedAt: 10,
        },
      })),
    };

    renderHook(() =>
      usePosLocalSyncRuntimeStatus({
        eventAppendToken: 1,
        source: "register",
        storeFactory: () => store as never,
        storeId: "store-1",
        terminalId: "terminal-cloud-1",
      }),
    );

    await waitFor(() =>
      expect(mocks.reportTerminalRuntimeStatus).toHaveBeenCalledWith(
        expect.objectContaining({
          status: expect.objectContaining({
            localStore: expect.objectContaining({
              terminalSeedReady: true,
            }),
            source: "register",
            sync: expect.objectContaining({
              pendingEventCount: 1,
            }),
          }),
          storeId: "store-1",
          syncSecretHash: "sync-secret-1",
          terminalId: "terminal-cloud-1",
        }),
      ),
    );
    expect(
      JSON.stringify(
        mocks.reportTerminalRuntimeStatus.mock.calls[0]?.[0].status,
      ),
    ).not.toContain("proof-token-a");
    expect(
      JSON.stringify(
        mocks.reportTerminalRuntimeStatus.mock.calls[0]?.[0].status,
      ),
    ).not.toContain("payload-proof-token");
    expect(
      JSON.stringify(
        mocks.reportTerminalRuntimeStatus.mock.calls[0]?.[0].status,
      ),
    ).not.toContain("sync-secret-1");
    await waitFor(() => expect(mocks.ingestLocalEvents).toHaveBeenCalled());
    expect(store.markEventsSynced).toHaveBeenCalledWith(["event-open"], {
      uploaded: true,
    });
  });

  it("does not publish a synced local closeout as an active closing register session", async () => {
    const store = {
      listEvents: vi.fn(async () => ({
        ok: true,
        value: [
          buildLocalEvent({
            localEventId: "event-open",
            payload: { openingFloat: 100 },
            sequence: 1,
            sync: { status: "synced", uploaded: true },
            type: "register.opened",
            uploadSequence: 1,
          }),
          buildLocalEvent({
            localEventId: "event-close",
            localRegisterSessionId: "cloud-register-1",
            payload: { countedCash: 100 },
            sequence: 2,
            sync: { status: "synced", uploaded: true },
            type: "register.closeout_started",
            uploadSequence: 2,
          }),
        ],
      })),
      listLocalCloudMappings: vi.fn(async () => ({
        ok: true,
        value: [
          {
            cloudId: "cloud-register-1",
            entity: "registerSession",
            localId: "register-1",
            mappedAt: 10,
          },
        ],
      })),
      readDrawerAuthorityState: vi.fn(async () => ({
        ok: true,
        value: null,
      })),
      readProvisionedTerminalSeed: vi.fn(async () => ({
        ok: true,
        value: {
          cloudTerminalId: "terminal-cloud-1",
          displayName: "Front",
          provisionedAt: 1,
          schemaVersion: 1,
          syncSecretHash: "sync-secret-1",
          storeId: "store-1",
          terminalId: "local-terminal-1",
        },
      })),
    };

    renderHook(() =>
      usePosLocalSyncRuntimeStatus({
        source: "register",
        storeFactory: () => store as never,
        storeId: "store-1",
        terminalId: "terminal-cloud-1",
      }),
    );

    await waitFor(() =>
      expect(mocks.reportTerminalRuntimeStatus).toHaveBeenCalledWith(
        expect.objectContaining({
          status: expect.not.objectContaining({
            activeRegisterSession: expect.anything(),
          }),
        }),
      ),
    );
  });

  it("exposes supplied app-session recovery diagnostics without leaking raw block reasons", async () => {
    const store = {
      listEvents: vi.fn(async () => ({
        ok: true,
        value: [],
      })),
      readProvisionedTerminalSeed: vi.fn(async () => ({
        ok: true,
        value: {
          cloudTerminalId: "terminal-cloud-1",
          displayName: "Front",
          provisionedAt: 1,
          schemaVersion: 1,
          syncSecretHash: "sync-secret-1",
          storeId: "store-1",
          terminalId: "local-terminal-1",
        },
      })),
    };

    const { result } = renderHook(() =>
      usePosLocalSyncRuntimeStatus({
        appSessionRecovery: {
          reason: "app_account_not_pos_scoped",
          status: "blocked",
        },
        mode: "status-only",
        source: "register",
        storeFactory: () => store as never,
        storeId: "store-1",
        terminalId: "terminal-cloud-1",
      }),
    );

    await waitFor(() =>
      expect(result.current?.runtimeStatus?.appSessionRecovery).toEqual({
        status: "blocked_app_account",
      }),
    );
    expect(result.current?.copyDiagnostics?.appSessionRecovery).toEqual({
      status: "blocked_app_account",
    });
    expect(result.current?.copyDiagnostics?.labels.appSessionRecovery).toBe(
      "blocked_app_account",
    );

    await waitFor(() =>
      expect(mocks.reportTerminalRuntimeStatus).toHaveBeenCalled(),
    );
    expect(
      mocks.reportTerminalRuntimeStatus.mock.calls[0]?.[0].status
        .appSessionRecovery,
    ).toEqual({
      status: "blocked_app_account",
    });
    expect(
      JSON.stringify(
        mocks.reportTerminalRuntimeStatus.mock.calls[0]?.[0].status,
      ),
    ).not.toContain("app_account_not_pos_scoped");
    expect(JSON.stringify(result.current)).not.toContain(
      "app_account_not_pos_scoped",
    );
  });

  it("publishes app update coordinator evidence with runtime check-ins", async () => {
    const store = {
      listEvents: vi.fn(async () => ({
        ok: true,
        value: [],
      })),
      readProvisionedTerminalSeed: vi.fn(async () => ({
        ok: true,
        value: {
          cloudTerminalId: "terminal-cloud-1",
          displayName: "Front",
          provisionedAt: 1,
          schemaVersion: 1,
          syncSecretHash: "sync-secret-1",
          storeId: "store-1",
          terminalId: "local-terminal-1",
        },
      })),
    };
    const appUpdateCoordinator = {
      applyUpdate: vi.fn(() => true),
      getSnapshot: vi.fn(() => ({
        blockers: [],
        canApply: true,
        currentBuildId: "build-current",
        pendingBuildId: "build-next",
        staging: {
          assetCount: 17,
          failedAssetCount: 0,
          rejectedAssetCount: 0,
          status: "staged" as const,
        },
        status: "ready" as const,
      })),
    };

    const { result } = renderHook(() =>
      usePosLocalSyncRuntimeStatus({
        appUpdateCoordinator,
        mode: "status-only",
        source: "register",
        storeFactory: () => store as never,
        storeId: "store-1",
        terminalId: "terminal-cloud-1",
      }),
    );

    await waitFor(() =>
      expect(result.current?.runtimeStatus?.appUpdate).toEqual(
        expect.objectContaining({
          canApply: true,
          currentBuildId: "build-current",
          detectorStatus: "ok",
          pendingBuildId: "build-next",
          stagingAssetCount: 17,
          stagingFailedAssetCount: 0,
          stagingRejectedAssetCount: 0,
          stagingStatus: "staged",
          status: "update_ready",
        }),
      ),
    );
    await waitFor(() =>
      expect(mocks.reportTerminalRuntimeStatus).toHaveBeenCalledWith(
        expect.objectContaining({
          status: expect.objectContaining({
            appUpdate: expect.objectContaining({
              pendingBuildId: "build-next",
              stagingAssetCount: 17,
              status: "update_ready",
            }),
          }),
        }),
      ),
    );
  });

  it("publishes app update staging failure diagnostics with runtime check-ins", async () => {
    const store = {
      listEvents: vi.fn(async () => ({
        ok: true,
        value: [],
      })),
      readProvisionedTerminalSeed: vi.fn(async () => ({
        ok: true,
        value: {
          cloudTerminalId: "terminal-cloud-1",
          displayName: "Front",
          provisionedAt: 1,
          schemaVersion: 1,
          syncSecretHash: "sync-secret-1",
          storeId: "store-1",
          terminalId: "local-terminal-1",
        },
      })),
    };
    const appUpdateCoordinator = {
      applyUpdate: vi.fn(() => false),
      getSnapshot: vi.fn(() => ({
        blockers: [],
        canApply: true,
        currentBuildId: "build-current",
        pendingBuildId: "build-next",
        staging: {
          assetCount: 17,
          failedAssetCount: 1,
          reason: "asset-staging-failed" as const,
          rejectedAssetCount: 0,
          status: "unstaged" as const,
        },
        status: "ready-unstaged" as const,
      })),
    };

    renderHook(() =>
      usePosLocalSyncRuntimeStatus({
        appUpdateCoordinator,
        mode: "status-only",
        source: "register",
        storeFactory: () => store as never,
        storeId: "store-1",
        terminalId: "terminal-cloud-1",
      }),
    );

    await waitFor(() =>
      expect(mocks.reportTerminalRuntimeStatus).toHaveBeenCalledWith(
        expect.objectContaining({
          status: expect.objectContaining({
            appUpdate: expect.objectContaining({
              canApply: true,
              pendingBuildId: "build-next",
              stagingAssetCount: 17,
              stagingFailedAssetCount: 1,
              stagingReason: "asset-staging-failed",
              stagingRejectedAssetCount: 0,
              stagingStatus: "unstaged",
              status: "update_ready",
            }),
          }),
        }),
      ),
    );
  });

  it("publishes current app update state when pending build is already running", async () => {
    vi.stubEnv("VITE_ATHENA_WEBAPP_BUILD_SHA", "build-next");
    vi.stubEnv("VITE_ATHENA_WEBAPP_VERSION", "quick-dolphin-prowls");
    const store = {
      listEvents: vi.fn(async () => ({
        ok: true,
        value: [],
      })),
      readProvisionedTerminalSeed: vi.fn(async () => ({
        ok: true,
        value: {
          cloudTerminalId: "terminal-cloud-1",
          displayName: "Front",
          provisionedAt: 1,
          schemaVersion: 1,
          syncSecretHash: "sync-secret-1",
          storeId: "store-1",
          terminalId: "local-terminal-1",
        },
      })),
    };
    const appUpdateCoordinator = {
      applyUpdate: vi.fn(() => false),
      getSnapshot: vi.fn(() => ({
        blockers: [],
        canApply: false,
        currentBuildId: "build-current",
        pendingBuildId: "build-next",
        staging: {
          reason: "service-worker-unavailable" as const,
          status: "unstaged" as const,
        },
        status: "ready-unstaged" as const,
      })),
    };

    renderHook(() =>
      usePosLocalSyncRuntimeStatus({
        appUpdateCoordinator,
        mode: "status-only",
        source: "register",
        storeFactory: () => store as never,
        storeId: "store-1",
        terminalId: "terminal-cloud-1",
      }),
    );

    await waitFor(() =>
      expect(mocks.reportTerminalRuntimeStatus).toHaveBeenCalledWith(
        expect.objectContaining({
          status: expect.objectContaining({
            appUpdate: expect.objectContaining({
              canApply: false,
              currentBuildId: "build-next",
              detectorStatus: "ok",
              stagingStatus: "unknown",
              status: "current",
            }),
            buildSha: "build-next",
          }),
        }),
      ),
    );
    expect(
      mocks.reportTerminalRuntimeStatus.mock.calls[0]?.[0].status.appUpdate,
    ).not.toEqual(
      expect.objectContaining({
        pendingBuildId: "build-next",
        status: "update_ready_unstaged",
      }),
    );
  });

  it("exposes rejected runtime check-in publishes in debug state", async () => {
    mocks.reportTerminalRuntimeStatus.mockResolvedValue({
      kind: "user_error",
      error: {
        code: "authorization_failed",
        message: "You do not have access to update this POS terminal status.",
        metadata: { terminalAuthorizationFailure: true },
      },
    });
    const store = {
      listEvents: vi.fn(async () => ({
        ok: true,
        value: [],
      })),
      readProvisionedTerminalSeed: vi.fn(async () => ({
        ok: true,
        value: {
          cloudTerminalId: "terminal-cloud-1",
          displayName: "Front",
          provisionedAt: 1,
          schemaVersion: 1,
          syncSecretHash: "sync-secret-1",
          storeId: "store-1",
          terminalId: "local-terminal-1",
        },
      })),
      writeTerminalIntegrityState: vi.fn(async () => ({
        ok: true,
        value: null,
      })),
    };

    const storeFactory = () => store as never;
    const { result } = renderHook(() =>
      usePosLocalSyncRuntimeStatus({
        mode: "status-only",
        storeFactory,
        storeId: "store-1",
        terminalId: "terminal-cloud-1",
      }),
    );

    await waitFor(() =>
      expect(result.current?.debug).toEqual(
        expect.objectContaining({
          checkInPublishMessage:
            "You do not have access to update this POS terminal status.",
          checkInPublishReason: "authorization_failed",
          checkInPublishStatus: "rejected",
        }),
      ),
    );
    expect(store.writeTerminalIntegrityState).toHaveBeenCalledWith(
      expect.objectContaining({
        cloudTerminalId: "terminal-cloud-1",
        reason: "authorization_failed",
        status: "requires_reprovision",
        storeId: "store-1",
        terminalId: "local-terminal-1",
      }),
    );
  });

  it("clears stale terminal integrity after an accepted runtime check-in", async () => {
    let terminalIntegrity: PosTerminalIntegrityState | null = {
      cloudTerminalId: "terminal-cloud-1",
      observedAt: 1,
      reason: "authorization_failed" as const,
      status: "requires_reprovision" as const,
      storeId: "store-1",
      terminalId: "local-terminal-1",
    };
    const onLocalEventsChanged = vi.fn();
    const store = {
      clearTerminalIntegrityState: vi.fn(async () => {
        terminalIntegrity = null;
        return {
          ok: true,
          value: null,
        };
      }),
      listEvents: vi.fn(async () => ({
        ok: true,
        value: [],
      })),
      readProvisionedTerminalSeed: vi.fn(async () => ({
        ok: true,
        value: {
          cloudTerminalId: "terminal-cloud-1",
          displayName: "Front",
          provisionedAt: 1,
          schemaVersion: 1,
          syncSecretHash: "sync-secret-1",
          storeId: "store-1",
          terminalId: "local-terminal-1",
        },
      })),
      readTerminalIntegrityState: vi.fn(async () => ({
        ok: true,
        value: terminalIntegrity,
      })),
    };

    renderHook(() =>
      usePosLocalSyncRuntimeStatus({
        mode: "status-only",
        onLocalEventsChanged,
        storeFactory: () => store as never,
        storeId: "store-1",
        terminalId: "terminal-cloud-1",
      }),
    );

    await waitFor(() =>
      expect(store.clearTerminalIntegrityState).toHaveBeenCalledWith({
        storeId: "store-1",
        terminalId: "terminal-cloud-1",
      }),
    );
    expect(store.clearTerminalIntegrityState).toHaveBeenCalledWith({
      storeId: "store-1",
      terminalId: "local-terminal-1",
    });
    expect(onLocalEventsChanged).toHaveBeenCalled();
    await waitFor(() =>
      expect(mocks.reportTerminalRuntimeStatus).toHaveBeenLastCalledWith(
        expect.objectContaining({
          status: expect.not.objectContaining({
            terminalIntegrity: expect.anything(),
          }),
        }),
      ),
    );
  });

  it("ignores stale runtime check-in publish results after the runtime scope is invalidated", async () => {
    const oldCheckIn = deferred<{
      kind: "user_error";
      error: {
        code: string;
        message: string;
        metadata: { terminalAuthorizationFailure: boolean };
      };
    }>();
    mocks.reportTerminalRuntimeStatus.mockReturnValueOnce(oldCheckIn.promise);
    const store = {
      listEvents: vi.fn(async () => ({
        ok: true,
        value: [],
      })),
      readProvisionedTerminalSeed: vi.fn(async () => ({
        ok: true,
        value: {
          cloudTerminalId: "terminal-cloud-1",
          displayName: "Front",
          provisionedAt: 1,
          schemaVersion: 1,
          syncSecretHash: "sync-secret-1",
          storeId: "store-1",
          terminalId: "local-terminal-1",
        },
      })),
      writeTerminalIntegrityState: vi.fn(async () => {
        throw new Error("old scope write failed");
      }),
    };

    const { result, unmount } = renderHook(() =>
      usePosLocalSyncRuntimeStatus({
        mode: "status-only",
        storeFactory: () => store as never,
        storeId: "store-1",
        terminalId: "terminal-cloud-1",
      }),
    );

    await waitFor(() =>
      expect(mocks.reportTerminalRuntimeStatus).toHaveBeenCalledWith(
        expect.objectContaining({
          storeId: "store-1",
          terminalId: "terminal-cloud-1",
        }),
      ),
    );

    unmount();

    oldCheckIn.resolve({
      kind: "user_error",
      error: {
        code: "authorization_failed",
        message: "Old terminal rejected.",
        metadata: { terminalAuthorizationFailure: true },
      },
    });
    await oldCheckIn.promise;
    await Promise.resolve();

    expect(store.writeTerminalIntegrityState).not.toHaveBeenCalled();
    expect(result.current).not.toEqual(
      expect.objectContaining({
        label: "Local sync unavailable",
      }),
    );
  });

  it("publishes drawer authority blocks written under the cloud terminal id", async () => {
    const store = {
      listEvents: vi.fn(async () => ({
        ok: true,
        value: [
          buildLocalEvent({
            localEventId: "event-open",
            localRegisterSessionId: "register-1",
            sequence: 1,
            terminalId: "terminal-cloud-1",
            type: "register.opened",
          }),
        ],
      })),
      readDrawerAuthorityState: vi.fn(
        async (input: { terminalId: string }) => ({
          ok: true,
          value:
            input.terminalId === "terminal-cloud-1"
              ? {
                  localRegisterSessionId: "register-1",
                  observedAt: 1,
                  reason: "cloud_closed",
                  status: "blocked",
                  storeId: "store-1",
                  terminalId: "terminal-cloud-1",
                }
              : null,
        }),
      ),
      readProvisionedTerminalSeed: vi.fn(async () => ({
        ok: true,
        value: {
          cloudTerminalId: "terminal-cloud-1",
          displayName: "Front",
          provisionedAt: 1,
          schemaVersion: 1,
          syncSecretHash: "sync-secret-1",
          storeId: "store-1",
          terminalId: "local-terminal-1",
        },
      })),
    };

    renderHook(() =>
      usePosLocalSyncRuntimeStatus({
        mode: "status-only",
        storeFactory: () => store as never,
        storeId: "store-1",
        terminalId: "terminal-cloud-1",
      }),
    );

    await waitFor(() =>
      expect(mocks.reportTerminalRuntimeStatus).toHaveBeenCalledWith(
        expect.objectContaining({
          status: expect.objectContaining({
            drawerAuthority: expect.objectContaining({
              localRegisterSessionId: "register-1",
              reason: "cloud_closed",
              status: "blocked",
            }),
          }),
        }),
      ),
    );
  });

  it("persists drawer authority directives returned by accepted runtime check-ins", async () => {
    mocks.reportTerminalRuntimeStatus.mockResolvedValue({
      kind: "ok",
      data: {
        drawerAuthorityDirective: {
          cloudRegisterSessionId: "cloud-register-1",
          localRegisterSessionId: "register-1",
          message:
            "The mapped cloud register is closed. Open a register before selling.",
          observedAt: 200,
          reason: "cloud_closed",
          registerNumber: "8",
          status: "blocked",
        },
      },
    });
    const onLocalEventsChanged = vi.fn();
    const store = {
      applyRegisterLifecycleAuthority: vi.fn(async () => ({
        ok: true,
        value: { disposition: "applied", reason: "committed" },
      })),
      listEvents: vi.fn(async () => ({
        ok: true,
        value: [
          buildLocalEvent({
            localEventId: "event-open",
            localRegisterSessionId: "register-1",
            sequence: 1,
            type: "register.opened",
          }),
        ],
      })),
      readDrawerAuthorityState: vi.fn(async () => ({
        ok: true,
        value: null,
      })),
      readProvisionedTerminalSeed: vi.fn(async () => ({
        ok: true,
        value: {
          cloudTerminalId: "terminal-cloud-1",
          displayName: "Front",
          provisionedAt: 1,
          schemaVersion: 1,
          syncSecretHash: "sync-secret-1",
          storeId: "store-1",
          terminalId: "local-terminal-1",
        },
      })),
      writeDrawerAuthorityState: vi.fn(),
    };

    renderHook(() =>
      usePosLocalSyncRuntimeStatus({
        mode: "status-only",
        onLocalEventsChanged,
        storeFactory: () => store as never,
        storeId: "store-1",
        terminalId: "terminal-cloud-1",
      }),
    );

    await waitFor(() =>
      expect(store.applyRegisterLifecycleAuthority).toHaveBeenCalledWith({
        observation: {
          classification: "sale_blocked",
          cloudRegisterSessionId: "cloud-register-1",
          localRegisterSessionId: "register-1",
          message:
            "The mapped cloud register is closed. Open a register before selling.",
          observedAt: 200,
          reason: "cloud_closed",
          registerNumber: "8",
          source: "legacy_runtime_directive",
          status: "blocked",
        },
        storeId: "store-1",
        terminalId: "local-terminal-1",
      }),
    );
    expect(store.writeDrawerAuthorityState).not.toHaveBeenCalled();
    expect(onLocalEventsChanged).toHaveBeenCalled();
  });

  it("seeds a local active drawer from active register directives over stale local closeout history", async () => {
    mocks.reportTerminalRuntimeStatus.mockResolvedValue({
      kind: "ok",
      data: {
        activeRegisterSessionDirective: {
          cloudRegisterSessionId: "cloud-register-1",
          expectedCash: 13_000,
          localRegisterSessionId: "cloud-register-1",
          observedAt: 200,
          openedAt: 100,
          openingFloat: 13_000,
          registerNumber: "8",
          staffProfileId: "staff-1",
          status: "active",
        },
      },
    });
    const events = [
      buildLocalEvent({
        localEventId: "event-open",
        localRegisterSessionId: "old-register-1",
        payload: {
          expectedCash: 9_000,
          localRegisterSessionId: "old-register-1",
          openingFloat: 9_000,
          status: "active",
        },
        sequence: 1,
        sync: { status: "synced", uploaded: true },
        type: "register.opened",
      }),
      {
        createdAt: 2,
        localEventId: "event-close",
        localRegisterSessionId: "old-register-1",
        payload: { countedCash: 9_000, notes: null },
        schemaVersion: 1,
        sequence: 2,
        staffProfileId: "staff-1",
        staffProofToken: "proof-token-1",
        storeId: "store-1",
        sync: { status: "pending" },
        terminalId: "local-terminal-1",
        type: "register.closeout_started",
        uploadSequence: 2,
      } satisfies PosLocalEventRecord,
    ];
    const onLocalEventsChanged = vi.fn();
    const store = {
      appendEvent: vi.fn(async (event) => {
        const localEvent = buildLocalEvent({
          ...event,
          localEventId: "event-seeded-open",
          sequence: events.length + 1,
          sync: { status: event.initialSyncStatus ?? "pending" },
        });
        events.push(localEvent);
        return { ok: true, value: localEvent };
      }),
      listEvents: vi.fn(async () => ({
        ok: true,
        value: [...events],
      })),
      readDrawerAuthorityState: vi.fn(async () => ({
        ok: true,
        value: null,
      })),
      readProvisionedTerminalSeed: vi.fn(async () => ({
        ok: true,
        value: {
          cloudTerminalId: "terminal-cloud-1",
          displayName: "Front",
          provisionedAt: 1,
          registerNumber: "8",
          schemaVersion: 1,
          syncSecretHash: "sync-secret-1",
          storeId: "store-1",
          terminalId: "local-terminal-1",
        },
      })),
      writeLocalCloudMapping: vi.fn(async (mapping) => ({
        ok: true,
        value: mapping,
      })),
    };

    const { result } = renderHook(() =>
      usePosLocalSyncRuntimeStatus({
        mode: "status-only",
        onLocalEventsChanged,
        storeFactory: () => store as never,
        storeId: "store-1",
        terminalId: "terminal-cloud-1",
      }),
    );

    await waitFor(() =>
      expect(store.appendEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          localRegisterSessionId: "cloud-register-1",
          registerNumber: "8",
          staffProfileId: "staff-1",
          storeId: "store-1",
          terminalId: "terminal-cloud-1",
          type: "register.opened",
          initialSyncStatus: "synced",
          payload: expect.objectContaining({
            expectedCash: 13_000,
            localRegisterSessionId: "cloud-register-1",
            openingFloat: 13_000,
            status: "active",
          }),
        }),
      ),
    );
    expect(store.writeLocalCloudMapping).toHaveBeenCalledWith({
      entity: "registerSession",
      localId: "cloud-register-1",
      cloudId: "cloud-register-1",
      mappedAt: expect.any(Number),
    });
    expect(onLocalEventsChanged).toHaveBeenCalled();
    await waitFor(() =>
      expect(result.current?.debug?.activeRegisterSessionRepair).toMatchObject({
        directive: expect.objectContaining({
          localRegisterSessionId: "cloud-register-1",
          status: "active",
        }),
        seedResult: "seeded",
      }),
    );
  });

  it("passively reconciles a pending local closeout when the mapped cloud drawer is closed", async () => {
    mocks.reportTerminalRuntimeStatus.mockResolvedValue({
      kind: "ok",
      data: {
        drawerAuthorityDirective: {
          cloudRegisterSessionId: "cloud-register-1",
          localRegisterSessionId: "local-register-1",
          message:
            "The mapped cloud register is closed. Open a register before selling.",
          observedAt: 200,
          reason: "cloud_closed",
          registerNumber: "8",
          status: "blocked",
        },
      },
    });
    const onLocalEventsChanged = vi.fn();
    const store = {
      listEvents: vi.fn(async () => ({
        ok: true,
        value: [
          buildLocalEvent({
            localEventId: "event-open",
            localRegisterSessionId: "local-register-1",
            payload: {
              expectedCash: 5_000,
              localRegisterSessionId: "local-register-1",
              openingFloat: 5_000,
            },
            sequence: 1,
            sync: { status: "synced", uploaded: true },
            type: "register.opened",
          }),
          buildLocalEvent({
            localEventId: "event-closeout",
            localRegisterSessionId: "local-register-1",
            payload: {
              countedCash: 5_000,
              notes: null,
            },
            sequence: 2,
            sync: { status: "pending", uploaded: false },
            type: "register.closeout_started",
          }),
        ],
      })),
      listLocalCloudMappings: vi.fn(async () => ({
        ok: true,
        value: [
          {
            entity: "registerSession",
            localId: "local-register-1",
            cloudId: "cloud-register-1",
            mappedAt: 100,
          },
        ],
      })),
      readDrawerAuthorityState: vi.fn(async () => ({
        ok: true,
        value: null,
      })),
      readProvisionedTerminalSeed: vi.fn(async () => ({
        ok: true,
        value: {
          cloudTerminalId: "terminal-cloud-1",
          displayName: "Front",
          provisionedAt: 1,
          schemaVersion: 1,
          syncSecretHash: "sync-secret-1",
          storeId: "store-1",
          terminalId: "local-terminal-1",
        },
      })),
      writeDrawerAuthorityState: vi.fn(async () => ({
        ok: true,
        value: null,
      })),
    };

    renderHook(() =>
      usePosLocalSyncRuntimeStatus({
        mode: "status-only",
        onLocalEventsChanged,
        storeFactory: () => store as never,
        storeId: "store-1",
        terminalId: "terminal-cloud-1",
      }),
    );

    await waitFor(() =>
      expect(mocks.reportTerminalRuntimeStatus).toHaveBeenCalledWith(
        expect.objectContaining({
          status: expect.objectContaining({
            activeRegisterSession: expect.objectContaining({
              cloudRegisterSessionId: "cloud-register-1",
              localRegisterSessionId: "local-register-1",
              status: "closing",
            }),
          }),
        }),
      ),
    );
    await waitFor(() =>
      expect(store.writeDrawerAuthorityState).toHaveBeenCalledWith({
        cloudRegisterSessionId: "cloud-register-1",
        localRegisterSessionId: "local-register-1",
        message:
          "The mapped cloud register is closed. Open a register before selling.",
        observedAt: 200,
        reason: "cloud_closed",
        registerNumber: "8",
        status: "blocked",
        storeId: "store-1",
        terminalId: "local-terminal-1",
      }),
    );
    expect(onLocalEventsChanged).toHaveBeenCalled();
  });

  it("does not persist terminal integrity for generic runtime check-in rejections", async () => {
    mocks.reportTerminalRuntimeStatus.mockResolvedValue({
      kind: "user_error",
      error: {
        code: "authorization_failed",
        message: "User session expired.",
      },
    });
    const store = {
      listEvents: vi.fn(async () => ({
        ok: true,
        value: [],
      })),
      readProvisionedTerminalSeed: vi.fn(async () => ({
        ok: true,
        value: {
          cloudTerminalId: "terminal-cloud-1",
          displayName: "Front",
          provisionedAt: 1,
          schemaVersion: 1,
          syncSecretHash: "sync-secret-1",
          storeId: "store-1",
          terminalId: "local-terminal-1",
        },
      })),
      writeTerminalIntegrityState: vi.fn(async () => ({
        ok: true,
        value: null,
      })),
    };

    renderHook(() =>
      usePosLocalSyncRuntimeStatus({
        mode: "status-only",
        storeFactory: () => store as never,
        storeId: "store-1",
        terminalId: "terminal-cloud-1",
      }),
    );

    await waitFor(() =>
      expect(mocks.reportTerminalRuntimeStatus).toHaveBeenCalled(),
    );
    await Promise.resolve();
    expect(store.writeTerminalIntegrityState).not.toHaveBeenCalled();
  });

  it("clears stale completion time while a fresh runtime check-in publish is pending", async () => {
    const nextPublish = deferred<{
      kind: "ok";
      data: Record<string, never>;
    }>();
    mocks.reportTerminalRuntimeStatus
      .mockResolvedValueOnce({
        kind: "ok",
        data: {},
      })
      .mockReturnValueOnce(nextPublish.promise);
    const store = {
      listEvents: vi.fn(async () => ({
        ok: true,
        value: [],
      })),
      readProvisionedTerminalSeed: vi.fn(async () => ({
        ok: true,
        value: {
          cloudTerminalId: "terminal-cloud-1",
          displayName: "Front",
          provisionedAt: 1,
          schemaVersion: 1,
          syncSecretHash: "sync-secret-1",
          storeId: "store-1",
          terminalId: "local-terminal-1",
        },
      })),
    };

    const storeFactory = () => store as never;
    const { result, rerender } = renderHook(
      ({ staffProfileId }) =>
        usePosLocalSyncRuntimeStatus({
          mode: "status-only",
          staffProfileId,
          storeFactory,
          storeId: "store-1",
          terminalId: "terminal-cloud-1",
        }),
      {
        initialProps: { staffProfileId: "staff-1" },
      },
    );

    await waitFor(() =>
      expect(result.current?.debug).toEqual(
        expect.objectContaining({
          checkInPublishCompletedAt: expect.any(Number),
          checkInPublishStatus: "accepted",
        }),
      ),
    );

    rerender({ staffProfileId: "staff-2" });

    await waitFor(() =>
      expect(result.current?.debug).toEqual(
        expect.objectContaining({
          checkInPublishCompletedAt: undefined,
          checkInPublishStatus: "pending",
        }),
      ),
    );
    nextPublish.resolve({
      kind: "ok",
      data: {},
    });
    await waitFor(() =>
      expect(result.current?.debug).toEqual(
        expect.objectContaining({
          checkInPublishCompletedAt: expect.any(Number),
          checkInPublishStatus: "accepted",
        }),
      ),
    );
  });

  it("does not republish runtime check-ins when only publish debug changes", async () => {
    const nextPublish = deferred<{
      kind: "ok";
      data: Record<string, never>;
    }>();
    mocks.reportTerminalRuntimeStatus.mockReturnValueOnce(nextPublish.promise);
    const store = {
      listEvents: vi.fn(async () => ({
        ok: true,
        value: [],
      })),
      readProvisionedTerminalSeed: vi.fn(async () => ({
        ok: true,
        value: {
          cloudTerminalId: "terminal-cloud-1",
          displayName: "Front",
          provisionedAt: 1,
          schemaVersion: 1,
          syncSecretHash: "sync-secret-1",
          storeId: "store-1",
          terminalId: "local-terminal-1",
        },
      })),
    };

    const storeFactory = () => store as never;
    const { result } = renderHook(() =>
      usePosLocalSyncRuntimeStatus({
        mode: "status-only",
        storeFactory,
        storeId: "store-1",
        terminalId: "terminal-cloud-1",
      }),
    );

    await waitFor(() =>
      expect(result.current?.debug).toEqual(
        expect.objectContaining({
          checkInPublishCompletedAt: undefined,
          checkInPublishStatus: "pending",
        }),
      ),
    );
    expect(mocks.reportTerminalRuntimeStatus).toHaveBeenCalledTimes(1);

    nextPublish.resolve({
      kind: "ok",
      data: {},
    });

    await waitFor(() =>
      expect(result.current?.debug).toEqual(
        expect.objectContaining({
          checkInPublishCompletedAt: expect.any(Number),
          checkInPublishStatus: "accepted",
        }),
      ),
    );
    expect(mocks.reportTerminalRuntimeStatus).toHaveBeenCalledTimes(1);
  });

  it("coalesces duplicate runtime check-in publishers for the same terminal", async () => {
    const nextPublish = deferred<{
      kind: "ok";
      data: Record<string, never>;
    }>();
    mocks.reportTerminalRuntimeStatus.mockReturnValue(nextPublish.promise);
    const store = {
      listEvents: vi.fn(async () => ({
        ok: true,
        value: [],
      })),
      readProvisionedTerminalSeed: vi.fn(async () => ({
        ok: true,
        value: {
          cloudTerminalId: "terminal-cloud-1",
          displayName: "Front",
          provisionedAt: 1,
          schemaVersion: 1,
          syncSecretHash: "sync-secret-1",
          storeId: "store-1",
          terminalId: "local-terminal-1",
        },
      })),
    };

    const storeFactory = () => store as never;
    renderHook(() =>
      usePosLocalSyncRuntimeStatus({
        mode: "status-only",
        storeFactory,
        storeId: "store-1",
        terminalId: "terminal-cloud-1",
      }),
    );
    renderHook(() =>
      usePosLocalSyncRuntimeStatus({
        mode: "status-only",
        storeFactory,
        storeId: "store-1",
        terminalId: "terminal-cloud-1",
      }),
    );

    await waitFor(() =>
      expect(mocks.reportTerminalRuntimeStatus).toHaveBeenCalledTimes(1),
    );
    nextPublish.resolve({
      kind: "ok",
      data: {},
    });
    await nextPublish.promise;
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mocks.reportTerminalRuntimeStatus).toHaveBeenCalledTimes(1);
  });

  it("does not replay a changed duplicate publisher while another owner is in flight", async () => {
    const nextPublish = deferred<{
      kind: "ok";
      data: Record<string, never>;
    }>();
    mocks.reportTerminalRuntimeStatus.mockReturnValueOnce(nextPublish.promise);
    const store = {
      listEvents: vi.fn(async () => ({
        ok: true,
        value: [],
      })),
      readProvisionedTerminalSeed: vi.fn(async () => ({
        ok: true,
        value: {
          cloudTerminalId: "terminal-cloud-1",
          displayName: "Front",
          provisionedAt: 1,
          schemaVersion: 1,
          syncSecretHash: "sync-secret-1",
          storeId: "store-1",
          terminalId: "local-terminal-1",
        },
      })),
    };

    const storeFactory = () => store as never;
    renderHook(() =>
      usePosLocalSyncRuntimeStatus({
        mode: "status-only",
        storeFactory,
        storeId: "store-1",
        terminalId: "terminal-cloud-1",
      }),
    );
    renderHook(() =>
      usePosLocalSyncRuntimeStatus({
        appSessionRecovery: {
          reason: "app_account_not_pos_scoped",
          status: "blocked",
        },
        mode: "status-only",
        storeFactory,
        storeId: "store-1",
        terminalId: "terminal-cloud-1",
      }),
    );

    await waitFor(() =>
      expect(mocks.reportTerminalRuntimeStatus).toHaveBeenCalledTimes(1),
    );
    nextPublish.resolve({
      kind: "ok",
      data: {},
    });
    await nextPublish.promise;
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mocks.reportTerminalRuntimeStatus).toHaveBeenCalledTimes(1);
  });

  it("replays follower-only material received while the leader publish is in flight", async () => {
    const nextPublish = deferred<{
      kind: "ok";
      data: Record<string, never>;
    }>();
    mocks.reportTerminalRuntimeStatus
      .mockReturnValueOnce(nextPublish.promise)
      .mockResolvedValue({ kind: "ok", data: {} });
    const store = {
      listEvents: vi.fn(async () => ({
        ok: true,
        value: [],
      })),
      readProvisionedTerminalSeed: vi.fn(async () => ({
        ok: true,
        value: {
          cloudTerminalId: "terminal-cloud-1",
          displayName: "Front",
          provisionedAt: 1,
          schemaVersion: 1,
          syncSecretHash: "sync-secret-1",
          storeId: "store-1",
          terminalId: "local-terminal-1",
        },
      })),
    };
    const storeFactory = () => store as never;
    const leader = renderHook(() =>
      usePosLocalSyncRuntimeStatus({
        mode: "status-only",
        storeFactory,
        storeId: "store-1",
        terminalId: "terminal-cloud-1",
      }),
    );

    try {
      await waitFor(() =>
        expect(mocks.reportTerminalRuntimeStatus).toHaveBeenCalledTimes(1),
      );

      const firstRuntimeStatus = mocks.reportTerminalRuntimeStatus.mock.calls[0]?.[0]
        ?.status;
      const followerRuntimeStatus = {
        ...firstRuntimeStatus,
        appSessionRecovery: { status: "blocked_app_account" },
      };
      act(() => {
        window.dispatchEvent(
          new StorageEvent("storage", {
            key: "athena-pos-runtime-status-material:store-1:terminal-cloud-1",
            newValue: JSON.stringify({
              materialSignature: getRuntimeStatusPublishMaterialSignature({
                runtimeStatus: followerRuntimeStatus,
                storeId: "store-1",
                terminalId: "terminal-cloud-1",
              }),
              ownerId: "follower-context",
              runtimeStatus: followerRuntimeStatus,
              sentAt: Date.now(),
            }),
          }),
        );
      });

      nextPublish.resolve({ kind: "ok", data: {} });

      await waitFor(() =>
        expect(mocks.reportTerminalRuntimeStatus).toHaveBeenCalledTimes(2),
      );
      expect(mocks.reportTerminalRuntimeStatus).toHaveBeenLastCalledWith(
        expect.objectContaining({
          status: expect.objectContaining({
            appSessionRecovery: expect.objectContaining({
              status: "blocked_app_account",
            }),
          }),
        }),
      );
    } finally {
      leader.unmount();
    }
  });

  it("does not replay an unchanged runtime check-in after a stale effect invalidation", async () => {
    const nextPublish = deferred<{
      kind: "ok";
      data: Record<string, never>;
    }>();
    mocks.reportTerminalRuntimeStatus.mockReturnValue(nextPublish.promise);
    const store = {
      listEvents: vi.fn(async () => ({
        ok: true,
        value: [],
      })),
      readProvisionedTerminalSeed: vi.fn(async () => ({
        ok: true,
        value: {
          cloudTerminalId: "terminal-cloud-1",
          displayName: "Front",
          provisionedAt: 1,
          schemaVersion: 1,
          syncSecretHash: "sync-secret-1",
          storeId: "store-1",
          terminalId: "local-terminal-1",
        },
      })),
    };

    const storeFactory = () => store as never;
    const { rerender } = renderHook(
      ({ appSessionRecovery }) =>
        usePosLocalSyncRuntimeStatus({
          appSessionRecovery,
          mode: "status-only",
          storeFactory,
          storeId: "store-1",
          terminalId: "terminal-cloud-1",
        }),
      {
        initialProps: {
          appSessionRecovery: null as
            | null
            | undefined
            | { reason: "app_account_not_pos_scoped"; status: "blocked" },
        },
      },
    );

    await waitFor(() =>
      expect(mocks.reportTerminalRuntimeStatus).toHaveBeenCalledTimes(1),
    );

    rerender({ appSessionRecovery: undefined });

    await act(async () => {
      nextPublish.resolve({
        kind: "ok",
        data: {},
      });
      await nextPublish.promise;
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mocks.reportTerminalRuntimeStatus).toHaveBeenCalledTimes(1);
  });

  it("coalesces same-material runtime check-ins across browser contexts", async () => {
    const store = {
      listEvents: vi.fn(async () => ({
        ok: true,
        value: [],
      })),
      readProvisionedTerminalSeed: vi.fn(async () => ({
        ok: true,
        value: {
          cloudTerminalId: "terminal-cloud-1",
          displayName: "Front",
          provisionedAt: 1,
          schemaVersion: 1,
          syncSecretHash: "sync-secret-1",
          storeId: "store-1",
          terminalId: "local-terminal-1",
        },
      })),
    };
    const firstContext = renderHook(() =>
      usePosLocalSyncRuntimeStatus({
        mode: "status-only",
        storeFactory: () => store as never,
        storeId: "store-1",
        terminalId: "terminal-cloud-1",
      }),
    );

    await waitFor(() =>
      expect(mocks.reportTerminalRuntimeStatus).toHaveBeenCalledTimes(1),
    );

    firstContext.unmount();
    resetRuntimeStatusPublishStateForTests({
      preserveCrossContextClaims: true,
    });

    renderHook(() =>
      usePosLocalSyncRuntimeStatus({
        mode: "status-only",
        storeFactory: () => store as never,
        storeId: "store-1",
        terminalId: "terminal-cloud-1",
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mocks.reportTerminalRuntimeStatus).toHaveBeenCalledTimes(1);
  });

  it("coalesces fresh-context runtime check-ins with different material inside the claim window", async () => {
    const store = {
      listEvents: vi.fn(async () => ({
        ok: true,
        value: [],
      })),
      readProvisionedTerminalSeed: vi.fn(async () => ({
        ok: true,
        value: {
          cloudTerminalId: "terminal-cloud-1",
          displayName: "Front",
          provisionedAt: 1,
          schemaVersion: 1,
          syncSecretHash: "sync-secret-1",
          storeId: "store-1",
          terminalId: "local-terminal-1",
        },
      })),
    };
    const firstContext = renderHook(() =>
      usePosLocalSyncRuntimeStatus({
        mode: "status-only",
        storeFactory: () => store as never,
        storeId: "store-1",
        terminalId: "terminal-cloud-1",
      }),
    );

    await waitFor(() =>
      expect(mocks.reportTerminalRuntimeStatus).toHaveBeenCalledTimes(1),
    );

    firstContext.unmount();
    resetRuntimeStatusPublishStateForTests({
      preserveCrossContextClaims: true,
    });

    renderHook(() =>
      usePosLocalSyncRuntimeStatus({
        appSessionRecovery: {
          reason: "app_account_not_pos_scoped",
          status: "blocked",
        },
        mode: "status-only",
        storeFactory: () => store as never,
        storeId: "store-1",
        terminalId: "terminal-cloud-1",
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mocks.reportTerminalRuntimeStatus).toHaveBeenCalledTimes(1);
  });

  it("starts runtime check-in heartbeat wakeups on the freshness cadence", () => {
    const heartbeat = vi.fn();
    const setIntervalFn = vi.fn(() => "timer-1");
    const clearIntervalFn = vi.fn();

    const stopHeartbeat = startRuntimeStatusFreshnessHeartbeat(heartbeat, {
      clearIntervalFn: clearIntervalFn as never,
      setIntervalFn: setIntervalFn as never,
    });

    expect(setIntervalFn).toHaveBeenCalledWith(
      heartbeat,
      RUNTIME_STATUS_FRESHNESS_WAKEUP_INTERVAL_MS,
    );
    expect(heartbeat).not.toHaveBeenCalled();

    stopHeartbeat();

    expect(clearIntervalFn).toHaveBeenCalledWith("timer-1");
  });

  it("does not publish runtime check-ins when terminal heartbeat is disabled", async () => {
    mocks.getTerminalRuntimeConfig.mockReturnValue({
      heartbeatEnabled: false,
    });
    const store = {
      listEvents: vi.fn(async () => ({
        ok: true,
        value: [],
      })),
      readProvisionedTerminalSeed: vi.fn(async () => ({
        ok: true,
        value: {
          cloudTerminalId: "terminal-cloud-1",
          displayName: "Front",
          provisionedAt: 1,
          schemaVersion: 1,
          syncSecretHash: "sync-secret-1",
          storeId: "store-1",
          terminalId: "local-terminal-1",
        },
      })),
    };

    const { result } = renderHook(() =>
      usePosLocalSyncRuntimeStatus({
        mode: "status-only",
        storeFactory: () => store as never,
        storeId: "store-1",
        terminalId: "terminal-cloud-1",
      }),
    );

    await waitFor(() =>
      expect(result.current?.debug).toEqual(
        expect.objectContaining({
          checkInPublishReason: "disabled",
          checkInPublishStatus: "disabled",
        }),
      ),
    );
    expect(mocks.reportTerminalRuntimeStatus).not.toHaveBeenCalled();
  });

  it("queues changed runtime check-ins while a previous publish is in flight", async () => {
    const firstPublish = deferred<{
      kind: "ok";
      data: Record<string, never>;
    }>();
    const secondPublish = deferred<{
      kind: "ok";
      data: Record<string, never>;
    }>();
    mocks.reportTerminalRuntimeStatus
      .mockReturnValueOnce(firstPublish.promise)
      .mockReturnValueOnce(secondPublish.promise);
    const store = {
      listEvents: vi.fn(async () => ({
        ok: true,
        value: [],
      })),
      readProvisionedTerminalSeed: vi.fn(async () => ({
        ok: true,
        value: {
          cloudTerminalId: "terminal-cloud-1",
          displayName: "Front",
          provisionedAt: 1,
          schemaVersion: 1,
          syncSecretHash: "sync-secret-1",
          storeId: "store-1",
          terminalId: "local-terminal-1",
        },
      })),
    };

    const storeFactory = () => store as never;
    const { rerender } = renderHook(
      ({ staffProfileId }) =>
        usePosLocalSyncRuntimeStatus({
          mode: "status-only",
          staffProfileId,
          storeFactory,
          storeId: "store-1",
          terminalId: "terminal-cloud-1",
        }),
      {
        initialProps: { staffProfileId: "staff-1" },
      },
    );

    await waitFor(() =>
      expect(mocks.reportTerminalRuntimeStatus).toHaveBeenCalledTimes(1),
    );

    rerender({ staffProfileId: "staff-2" });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mocks.reportTerminalRuntimeStatus).toHaveBeenCalledTimes(1);

    await act(async () => {
      firstPublish.resolve({
        kind: "ok",
        data: {},
      });
    });

    await waitFor(() =>
      expect(mocks.reportTerminalRuntimeStatus).toHaveBeenCalledTimes(2),
    );
    expect(mocks.reportTerminalRuntimeStatus).toHaveBeenLastCalledWith(
      expect.objectContaining({
        status: expect.objectContaining({
          staffAuthority: expect.objectContaining({
            staffProfileId: "staff-2",
          }),
        }),
      }),
    );

    await act(async () => {
      secondPublish.resolve({
        kind: "ok",
        data: {},
      });
    });
  });

  it("exposes missing check-in publish prerequisites in debug state", async () => {
    const store = {
      listEvents: vi.fn(async () => ({
        ok: true,
        value: [],
      })),
      readProvisionedTerminalSeed: vi.fn(async () => ({
        ok: true,
        value: null,
      })),
    };

    const { result } = renderHook(() =>
      usePosLocalSyncRuntimeStatus({
        mode: "status-only",
        storeFactory: () => store as never,
        storeId: "store-1",
        terminalId: "terminal-cloud-1",
      }),
    );

    await waitFor(() =>
      expect(result.current?.debug).toEqual(
        expect.objectContaining({
          checkInPublishReason: "missing_sync_secret",
          checkInPublishStatus: "not_ready",
        }),
      ),
    );
    expect(mocks.reportTerminalRuntimeStatus).not.toHaveBeenCalled();
  });

  it("refreshes status-only mode on connectivity changes without uploading", async () => {
    const store = {
      listEvents: vi.fn(async () => ({
        ok: true,
        value: [
          buildLocalEvent({
            localEventId: "event-open",
            sequence: 1,
            type: "register.opened",
          }),
        ],
      })),
      readProvisionedTerminalSeed: vi.fn(async () => ({
        ok: true,
        value: {
          cloudTerminalId: "terminal-cloud-1",
          displayName: "Front",
          provisionedAt: 1,
          schemaVersion: 1,
          syncSecretHash: "sync-secret-1",
          storeId: "store-1",
          terminalId: "local-terminal-1",
        },
      })),
    };

    const { result } = renderHook(() =>
      usePosLocalSyncRuntimeStatus({
        mode: "status-only",
        storeFactory: () => store as never,
        storeId: "store-1",
        terminalId: "local-terminal-1",
      }),
    );

    await waitFor(() =>
      expect(result.current).toEqual(
        expect.objectContaining({
          status: "pending",
        }),
      ),
    );

    Object.defineProperty(globalThis.navigator, "onLine", {
      configurable: true,
      value: false,
    });
    act(() => {
      window.dispatchEvent(new Event("offline"));
    });

    await waitFor(() =>
      expect(result.current).toEqual(
        expect.objectContaining({
          status: "offline",
        }),
      ),
    );
    expect(store.listEvents.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(mocks.ingestLocalEvents).not.toHaveBeenCalled();
  });

  it("keeps reportedAt in runtime status signatures so heartbeat-only freshness publishes", () => {
    const runtimeStatus = {
      localStore: {
        available: true,
        terminalSeedReady: true,
      },
      receivedAt: 100,
      reportedAt: 100,
      snapshots: {},
      source: "sync-runtime",
      staffAuthority: {
        status: "unknown",
      },
      sync: {
        failedEventCount: 0,
        localOnlyEventCount: 0,
        pendingEventCount: 0,
        reviewEventCount: 0,
        status: "idle",
        uploadableEventCount: 0,
      },
    };

    expect(
      getRuntimeStatusSignature({
        runtimeStatus: runtimeStatus as never,
        storeId: "store-1",
        terminalId: "terminal-cloud-1",
      }),
    ).not.toEqual(
      getRuntimeStatusSignature({
        runtimeStatus: {
          ...runtimeStatus,
          reportedAt: 200,
        } as never,
        storeId: "store-1",
        terminalId: "terminal-cloud-1",
      }),
    );
  });

  it("normalizes volatile app-update observation timestamps in publish signatures", () => {
    const runtimeStatus = {
      appUpdate: {
        canApply: true,
        currentBuildId: "build-current",
        detectorStatus: "ok",
        observedAt: 100,
        pendingBuildId: "build-next",
        stagingStatus: "staged",
        status: "update_ready",
      },
      localStore: {
        available: true,
        terminalSeedReady: true,
      },
      reportedAt: 100,
      snapshots: {},
      source: "sync-runtime",
      staffAuthority: {
        status: "unknown",
      },
      sync: {
        failedEventCount: 0,
        localOnlyEventCount: 0,
        pendingEventCount: 0,
        reviewEventCount: 0,
        status: "idle",
        uploadableEventCount: 0,
      },
    };

    expect(
      getRuntimeStatusSignature({
        runtimeStatus: runtimeStatus as never,
        storeId: "store-1",
        terminalId: "terminal-cloud-1",
      }),
    ).toEqual(
      getRuntimeStatusSignature({
        runtimeStatus: {
          ...runtimeStatus,
          appUpdate: {
            ...runtimeStatus.appUpdate,
            observedAt: 200,
          },
        } as never,
        storeId: "store-1",
        terminalId: "terminal-cloud-1",
      }),
    );
  });

  it("normalizes volatile runtime observation timestamps in material publish signatures", () => {
    const runtimeStatus = {
      activeRegisterSession: {
        cloudRegisterSessionId: "register-session-1",
        localRegisterSessionId: "register-session-1",
        observedAt: 100,
        openedAt: 50,
        registerNumber: "1",
        status: "active",
      },
      appShell: {
        observedAt: 100,
        ready: true,
      },
      appUpdate: {
        canApply: false,
        detectorStatus: "ok",
        observedAt: 100,
        stagingStatus: "unknown",
        status: "current",
      },
      localStore: {
        available: true,
        terminalSeedReady: true,
      },
      reportedAt: 100,
      saleAuthority: {
        observedAt: 100,
        staffProfileId: "staff-1",
        status: "ready",
        transactionMode: "products_and_services",
      },
      snapshots: {
        availabilityAgeMs: 100,
        catalogAgeMs: 200,
      },
      source: "sync-runtime",
      staffAuthority: {
        staffProfileId: "staff-1",
        status: "ready",
      },
      sync: {
        failedEventCount: 0,
        lastTrigger: "route-entry",
        localOnlyEventCount: 0,
        pendingEventCount: 0,
        reviewEventCount: 105,
        status: "syncing",
        uploadableEventCount: 34,
      },
    };

    expect(
      getRuntimeStatusPublishMaterialSignature({
        runtimeStatus: runtimeStatus as never,
        storeId: "store-1",
        terminalId: "terminal-cloud-1",
      }),
    ).toEqual(
      getRuntimeStatusPublishMaterialSignature({
        runtimeStatus: {
          ...runtimeStatus,
          activeRegisterSession: {
            ...runtimeStatus.activeRegisterSession,
            observedAt: 200,
          },
          appShell: {
            ...runtimeStatus.appShell,
            observedAt: 200,
          },
          appUpdate: {
            ...runtimeStatus.appUpdate,
            observedAt: 200,
          },
          reportedAt: 200,
          saleAuthority: {
            ...runtimeStatus.saleAuthority,
            observedAt: 200,
          },
          snapshots: {
            availabilityAgeMs: 300,
            catalogAgeMs: 400,
          },
          sync: {
            ...runtimeStatus.sync,
            pendingEventCount: 7,
            lastTrigger: "foreground-interval",
          },
        } as never,
        storeId: "store-1",
        terminalId: "terminal-cloud-1",
      }),
    );
    expect(
      getRuntimeStatusPublishMaterialSignature({
        runtimeStatus: runtimeStatus as never,
        storeId: "store-1",
        terminalId: "terminal-cloud-1",
      }),
    ).not.toEqual(
      getRuntimeStatusPublishMaterialSignature({
        runtimeStatus: {
          ...runtimeStatus,
          sync: {
            ...runtimeStatus.sync,
            status: "needs_review",
          },
        } as never,
        storeId: "store-1",
        terminalId: "terminal-cloud-1",
      }),
    );
  });

  it("throttles freshness-only runtime check-ins without delaying material changes", () => {
    expect(
      shouldPublishRuntimeStatus({
        lastMaterialSignature: "material-a",
        lastPublishedAt: 1_000,
        lastPublishSignature: "publish-a",
        materialSignature: "material-a",
        now: 1_500,
        publishSignature: "publish-b",
      }),
    ).toBe(false);

    expect(
      shouldPublishRuntimeStatus({
        lastMaterialSignature: "material-a",
        lastPublishedAt: 1_000,
        lastPublishSignature: "publish-a",
        materialSignature: "material-a",
        now: 31_000,
        publishSignature: "publish-b",
      }),
    ).toBe(false);

    expect(
      shouldPublishRuntimeStatus({
        lastMaterialSignature: "material-a",
        lastPublishedAt: 1_000,
        lastPublishSignature: "publish-a",
        materialSignature: "material-a",
        now: 1_000 + RUNTIME_STATUS_FRESHNESS_PUBLISH_INTERVAL_MS,
        publishSignature: "publish-b",
      }),
    ).toBe(true);

    expect(
      shouldPublishRuntimeStatus({
        lastMaterialSignature: "material-a",
        lastPublishedAt: 1_000,
        lastPublishSignature: "publish-a",
        materialSignature: "material-b",
        now: 1_500,
        publishSignature: "publish-b",
      }),
    ).toBe(true);
  });

  it("delays fresh transient syncing status publishes until the debounce is ready", () => {
    expect(
      shouldDelayTransientSyncingRuntimeStatusPublish({
        forcePublish: false,
        materialSignature: "syncing-material",
        readyMaterialSignature: null,
        syncStatus: "syncing",
      }),
    ).toBe(true);
  });

  it("does not delay forced, ready, or settled runtime status publishes", () => {
    expect(
      shouldDelayTransientSyncingRuntimeStatusPublish({
        forcePublish: true,
        materialSignature: "syncing-material",
        readyMaterialSignature: null,
        syncStatus: "syncing",
      }),
    ).toBe(false);
    expect(
      shouldDelayTransientSyncingRuntimeStatusPublish({
        forcePublish: false,
        materialSignature: "syncing-material",
        readyMaterialSignature: "syncing-material",
        syncStatus: "syncing",
      }),
    ).toBe(false);
    expect(
      shouldDelayTransientSyncingRuntimeStatusPublish({
        forcePublish: false,
        materialSignature: "idle-material",
        readyMaterialSignature: null,
        syncStatus: "idle",
      }),
    ).toBe(false);
  });

  it("drains persisted-proof multi-staff local history from the hub in stored upload order", async () => {
    const store = {
      listEvents: vi.fn(async () => ({
        ok: true,
        value: [
          buildLocalEvent({
            localEventId: "event-staff-a-open",
            sequence: 1,
            staffProfileId: "staff-a",
            staffProofToken: "proof-token-a",
            type: "register.opened",
            uploadSequence: 1,
          }),
          buildLocalEvent({
            localEventId: "event-staff-b-sale",
            localPosSessionId: "local-session-1",
            localTransactionId: "local-txn-1",
            payload: {
              localPosSessionId: "local-session-1",
              localTransactionId: "local-txn-1",
              receiptNumber: "LOCAL-1-000001",
              subtotal: 25,
              tax: 0,
              total: 25,
              payments: [{ method: "cash", amount: 25, timestamp: 2 }],
            },
            sequence: 2,
            staffProfileId: "staff-b",
            staffProofToken: "proof-token-b",
            type: "transaction.completed",
            uploadSequence: 2,
          }),
        ],
      })),
      markEventsSynced: vi.fn(async () => ({
        ok: true,
        value: [],
      })),
      writeLocalCloudMapping: vi.fn(async () => ({
        ok: true,
        value: {
          entity: "posSession",
          localId: "local-session-1",
          cloudId: "session-1",
          mappedAt: 10,
        },
      })),
      readProvisionedTerminalSeed: vi.fn(async () => ({
        ok: true,
        value: {
          cloudTerminalId: "terminal-cloud-1",
          displayName: "Front",
          provisionedAt: 1,
          schemaVersion: 1,
          syncSecretHash: "sync-secret-1",
          storeId: "store-1",
          terminalId: "local-terminal-1",
        },
      })),
    };
    mocks.ingestLocalEvents.mockResolvedValue({
      kind: "ok",
      data: {
        accepted: [
          {
            localEventId: "event-staff-a-open",
            sequence: 1,
            status: "projected",
          },
          {
            localEventId: "event-staff-b-sale",
            sequence: 2,
            status: "projected",
          },
        ],
        held: [],
        mappings: [],
        conflicts: [],
        syncCursor: {
          localRegisterSessionId: "register-1",
          acceptedThroughSequence: 2,
        },
      },
    });

    renderHook(() =>
      usePosLocalSyncRuntimeStatus({
        mode: "drain-enabled",
        storeFactory: () => store as never,
        storeId: "store-1",
        terminalId: "terminal-cloud-1",
      }),
    );

    await waitFor(
      () =>
        expect(mocks.ingestLocalEvents).toHaveBeenCalledWith(
          expect.objectContaining({
            events: [
              expect.objectContaining({
                localEventId: "event-staff-a-open",
                sequence: 1,
                staffProfileId: "staff-a",
                staffProofToken: "proof-token-a",
              }),
              expect.objectContaining({
                localEventId: "event-staff-b-sale",
                sequence: 2,
                staffProfileId: "staff-b",
              }),
            ],
          }),
        ),
      { timeout: 3000 },
    );
    const uploadedEvents = mocks.ingestLocalEvents.mock.calls[0]?.[0].events;
    expect(
      uploadedEvents.map((event: { sequence: number }) => event.sequence),
    ).toEqual([1, 2]);
  });

  it("maps projected, conflicted, held, and rejected server outcomes distinctly", () => {
    expect(
      collectServerSyncedLocalEventIds([
        { localEventId: "event-checkout", status: "conflicted" },
        { localEventId: "event-open", status: "projected" },
        { localEventId: "event-held", status: "held" },
        { localEventId: "event-rejected", status: "rejected" },
      ]),
    ).toEqual(["event-open"]);
    expect(
      collectServerReviewLocalEventIds([
        { localEventId: "event-checkout", status: "conflicted" },
        { localEventId: "event-open", status: "projected" },
        { localEventId: "event-held", status: "held" },
        { localEventId: "event-rejected", status: "rejected" },
      ]),
    ).toEqual(["event-checkout"]);
    expect(
      collectServerRejectedLocalEventIds([
        { localEventId: "event-checkout", status: "conflicted" },
        { localEventId: "event-open", status: "projected" },
        { localEventId: "event-held", status: "held" },
        { localEventId: "event-rejected", status: "rejected" },
      ]),
    ).toEqual(["event-rejected"]);
    expect(
      collectServerSettledLocalEventIds([
        { localEventId: "event-checkout", status: "conflicted" },
        { localEventId: "event-open", status: "projected" },
        { localEventId: "event-held", status: "held" },
        { localEventId: "event-rejected", status: "rejected" },
      ]),
    ).toEqual(["event-open"]);
    expect(
      collectServerHeldLocalEventIds([
        { localEventId: "event-held" },
        { localEventId: "event-held-later" },
      ]),
    ).toEqual(["event-held", "event-held-later"]);
  });

  it("treats server-owned inventory review sales as locally settled", () => {
    const accepted = [
      { localEventId: "event-sale", status: "conflicted" },
      { localEventId: "event-payment", status: "conflicted" },
    ];
    const mappings = [
      {
        cloudTable: "posTransaction",
        localEventId: "event-sale",
        localIdKind: "transaction",
      },
      {
        cloudTable: "operationalWorkItem",
        localEventId: "event-sale",
        localIdKind: "inventoryReviewWorkItem",
      },
      {
        cloudTable: "posTransaction",
        localEventId: "event-payment",
        localIdKind: "transaction",
      },
    ];
    const conflicts = [
      {
        conflictType: "inventory",
        localEventId: "event-sale",
        status: "needs_review",
      },
      {
        conflictType: "payment",
        localEventId: "event-payment",
        status: "needs_review",
      },
    ];

    expect(
      collectServerSettledLocalEventIds(accepted, mappings, conflicts),
    ).toEqual(["event-sale"]);
    expect(
      collectServerReviewLocalEventIds(accepted, mappings, conflicts),
    ).toEqual(["event-payment"]);
  });

  it("marks cleared-sale local precursors synced when the clear event uploads", () => {
    expect(
      collectSyncedLocalEventIds(
        [
          buildLocalEvent({
            localEventId: "event-session",
            localPosSessionId: "local-session-1",
            sequence: 1,
            type: "session.started",
          }),
          buildLocalEvent({
            localEventId: "event-cart",
            localPosSessionId: "local-session-1",
            sequence: 2,
            type: "cart.item_added",
          }),
          buildLocalEvent({
            localEventId: "event-payment",
            localPosSessionId: "local-session-1",
            sequence: 3,
            type: "session.payments_updated",
          }),
          buildLocalEvent({
            localEventId: "event-clear",
            localPosSessionId: "local-session-1",
            payload: {
              localPosSessionId: "local-session-1",
              reason: "Sale cleared",
            },
            sequence: 4,
            type: "cart.cleared",
          }),
        ],
        ["event-clear"],
      ),
    ).toEqual(["event-clear", "event-session", "event-cart", "event-payment"]);
  });

  it("uploads completed expense events with their scoped upload sequence", async () => {
    const expenseEvent = buildLocalEvent({
      localEventId: "event-expense",
      localExpenseSessionId: "expense-session-1",
      localRegisterSessionId: undefined,
      payload: {
        localExpenseSessionId: "expense-session-1",
        localExpenseEventId: "expense-event-1",
        subtotal: 25,
        tax: 0,
        total: 25,
        items: [
          {
            localItemId: "expense-line-1",
            productId: "product-1",
            productSkuId: "sku-1",
            productName: "Repair kit",
            productSku: "KIT-1",
            quantity: 1,
            price: 25,
          },
        ],
      },
      sequence: 42,
      type: "expense.completed",
      uploadSequence: 1,
    });
    const store = {
      listEvents: vi.fn(async () => ({
        ok: true,
        value: [expenseEvent],
      })),
      listEventsForUpload: vi.fn(async () => ({
        ok: true,
        value: [expenseEvent],
      })),
      markEventsNeedsReview: vi.fn(async () => ({
        ok: true,
        value: [],
      })),
      markEventsSynced: vi.fn(async () => ({
        ok: true,
        value: [],
      })),
      readProvisionedTerminalSeed: vi.fn(async () => ({
        ok: true,
        value: {
          cloudTerminalId: "terminal-cloud-1",
          displayName: "Front",
          provisionedAt: 1,
          schemaVersion: 1,
          syncSecretHash: "sync-secret-1",
          storeId: "store-1",
          terminalId: "local-terminal-1",
        },
      })),
    };
    mocks.ingestLocalEvents.mockResolvedValue({
      kind: "ok",
      data: {
        accepted: [
          {
            localEventId: "event-expense",
            sequence: 1,
            status: "projected",
          },
        ],
        held: [],
        mappings: [],
        conflicts: [],
        syncCursor: {
          localRegisterSessionId: "expense-session-1",
          acceptedThroughSequence: 1,
        },
      },
    });

    renderHook(() =>
      usePosLocalSyncRuntimeStatus({
        mode: "drain-enabled",
        storeFactory: () => store as never,
        storeId: "store-1",
        terminalId: "terminal-cloud-1",
      }),
    );

    await waitFor(() => expect(mocks.ingestLocalEvents).toHaveBeenCalled());
    expect(mocks.ingestLocalEvents).toHaveBeenCalledWith(
      expect.objectContaining({
        events: [
          expect.objectContaining({
            eventType: "expense_recorded",
            localEventId: "event-expense",
            localExpenseSessionId: "expense-session-1",
            sequence: 1,
          }),
        ],
      }),
    );
    expect(store.markEventsSynced).toHaveBeenCalledWith(["event-expense"], {
      uploaded: true,
    });
  });

  it("reports pending register-session activity independently from core sync upload", async () => {
    const cartEvent = buildLocalEvent({
      activity: { status: "pending" },
      localEventId: "event-cart",
      localPosSessionId: "local-session-1",
      payload: {
        productName: "Wig Cap",
        productSku: "CAP-1",
        quantity: 1,
        price: 25,
      },
      sequence: 2,
      sync: { status: "synced" },
      type: "cart.item_added",
      uploadSequence: undefined,
    });
    const store = {
      listEvents: vi.fn(async () => ({
        ok: true,
        value: [cartEvent],
      })),
      listEventsForUpload: vi.fn(async () => ({
        ok: true,
        value: [cartEvent],
      })),
      markEventsActivityFailed: vi.fn(async () => ({
        ok: true,
        value: [],
      })),
      markEventsActivityReported: vi.fn(async () => ({
        ok: true,
        value: [],
      })),
      markEventsSynced: vi.fn(async () => ({
        ok: true,
        value: [],
      })),
      readProvisionedTerminalSeed: vi.fn(async () => ({
        ok: true,
        value: {
          cloudTerminalId: "terminal-cloud-1",
          displayName: "Front",
          provisionedAt: 1,
          schemaVersion: 1,
          syncSecretHash: "sync-secret-1",
          storeId: "store-1",
          terminalId: "local-terminal-1",
        },
      })),
    };
    mocks.ingestRegisterSessionActivity.mockResolvedValue({
      kind: "ok",
      data: {
        accepted: [
          {
            localEventId: "event-cart",
            sequence: 2,
            status: "terminal_reported",
          },
        ],
        skipped: [],
        checkpoint: {
          localRegisterSessionId: "register-1",
          reportedThroughSequence: 2,
          skippedCounts: {},
        },
      },
    });

    renderHook(() =>
      usePosLocalSyncRuntimeStatus({
        mode: "drain-enabled",
        storeFactory: () => store as never,
        storeId: "store-1",
        terminalId: "terminal-cloud-1",
      }),
    );

    await waitFor(() =>
      expect(mocks.ingestRegisterSessionActivity).toHaveBeenCalledWith(
        expect.objectContaining({
          activities: [
            expect.objectContaining({
              category: "cart",
              eventType: "cart.item_added",
              localEventId: "event-cart",
              metadata: expect.objectContaining({
                itemLabel: "Wig Cap",
                productSku: "CAP-1",
              }),
              sequence: 2,
            }),
          ],
          localRegisterSessionId: "register-1",
          reportedThroughSequence: 2,
          storeId: "store-1",
          syncSecretHash: "sync-secret-1",
          terminalId: "terminal-cloud-1",
        }),
      ),
    );
    expect(mocks.ingestLocalEvents).not.toHaveBeenCalled();
    expect(store.markEventsActivityReported).toHaveBeenCalledWith(
      ["event-cart"],
      expect.objectContaining({ status: "reported" }),
    );
    expect(store.markEventsSynced).not.toHaveBeenCalled();
  });

  it("does not block core sync when activity reporting fails for the same event", async () => {
    const saleEvent = buildLocalEvent({
      activity: { status: "pending" },
      localEventId: "event-sale",
      localPosSessionId: "local-session-1",
      localTransactionId: "local-txn-1",
      payload: {
        localPosSessionId: "local-session-1",
        localTransactionId: "local-txn-1",
        receiptNumber: "LOCAL-1-000001",
        subtotal: 25,
        tax: 0,
        total: 25,
        payments: [{ method: "cash", amount: 25, timestamp: 2 }],
      },
      sequence: 3,
      sync: { status: "pending" },
      type: "transaction.completed",
      uploadSequence: 1,
    });
    const store = {
      listEvents: vi.fn(async () => ({
        ok: true,
        value: [saleEvent],
      })),
      listEventsForUpload: vi.fn(async () => ({
        ok: true,
        value: [saleEvent],
      })),
      markEventsActivityFailed: vi.fn(async () => ({
        ok: false,
        error: { code: "write_failed", message: "activity write failed" },
      })),
      markEventsNeedsReview: vi.fn(async () => ({
        ok: true,
        value: [],
      })),
      markEventsSynced: vi.fn(async () => ({
        ok: true,
        value: [],
      })),
      readProvisionedTerminalSeed: vi.fn(async () => ({
        ok: true,
        value: {
          cloudTerminalId: "terminal-cloud-1",
          displayName: "Front",
          provisionedAt: 1,
          schemaVersion: 1,
          syncSecretHash: "sync-secret-1",
          storeId: "store-1",
          terminalId: "local-terminal-1",
        },
      })),
      writeLocalCloudMapping: vi.fn(async () => ({
        ok: true,
        value: {},
      })),
    };
    mocks.ingestRegisterSessionActivity.mockRejectedValue(
      new Error("activity unavailable"),
    );
    mocks.ingestLocalEvents.mockResolvedValue({
      kind: "ok",
      data: {
        accepted: [
          {
            localEventId: "event-sale",
            sequence: 1,
            status: "projected",
          },
        ],
        held: [],
        mappings: [],
        conflicts: [],
        syncCursor: {
          localRegisterSessionId: "register-1",
          acceptedThroughSequence: 1,
        },
      },
    });

    renderHook(() =>
      usePosLocalSyncRuntimeStatus({
        mode: "drain-enabled",
        storeFactory: () => store as never,
        storeId: "store-1",
        terminalId: "terminal-cloud-1",
      }),
    );

    await waitFor(() => expect(mocks.ingestLocalEvents).toHaveBeenCalled());
    expect(mocks.ingestRegisterSessionActivity).toHaveBeenCalled();
    await waitFor(() =>
      expect(store.markEventsSynced).toHaveBeenCalledWith(["event-sale"], {
        uploaded: true,
      }),
    );
  });

  it("uploads completed expense events with different local sessions in separate ingest calls", async () => {
    const expenseOne = buildLocalEvent({
      localEventId: "event-expense-1",
      localExpenseSessionId: "expense-session-1",
      localRegisterSessionId: undefined,
      payload: {
        localExpenseSessionId: "expense-session-1",
        localExpenseEventId: "expense-event-1",
        subtotal: 25,
        tax: 0,
        total: 25,
        items: [
          {
            localItemId: "expense-line-1",
            productId: "product-1",
            productSkuId: "sku-1",
            productName: "Repair kit",
            productSku: "KIT-1",
            quantity: 1,
            price: 25,
          },
        ],
      },
      sequence: 42,
      type: "expense.completed",
      uploadSequence: 1,
    });
    const expenseTwo = buildLocalEvent({
      localEventId: "event-expense-2",
      localExpenseSessionId: "expense-session-2",
      localRegisterSessionId: undefined,
      payload: {
        localExpenseSessionId: "expense-session-2",
        localExpenseEventId: "expense-event-2",
        subtotal: 10,
        tax: 0,
        total: 10,
        items: [
          {
            localItemId: "expense-line-2",
            productId: "product-1",
            productSkuId: "sku-1",
            productName: "Repair kit",
            productSku: "KIT-1",
            quantity: 1,
            price: 10,
          },
        ],
      },
      sequence: 43,
      type: "expense.completed",
      uploadSequence: 1,
    });
    const store = {
      listEvents: vi.fn(async () => ({
        ok: true,
        value: [expenseOne, expenseTwo],
      })),
      listEventsForUpload: vi.fn(async () => ({
        ok: true,
        value: [expenseOne, expenseTwo],
      })),
      markEventsNeedsReview: vi.fn(async () => ({
        ok: true,
        value: [],
      })),
      markEventsSynced: vi.fn(async () => ({
        ok: true,
        value: [],
      })),
      readProvisionedTerminalSeed: vi.fn(async () => ({
        ok: true,
        value: {
          cloudTerminalId: "terminal-cloud-1",
          displayName: "Front",
          provisionedAt: 1,
          schemaVersion: 1,
          syncSecretHash: "sync-secret-1",
          storeId: "store-1",
          terminalId: "local-terminal-1",
        },
      })),
    };
    mocks.ingestLocalEvents
      .mockResolvedValueOnce({
        kind: "ok",
        data: {
          accepted: [
            {
              localEventId: "event-expense-1",
              sequence: 1,
              status: "projected",
            },
          ],
          held: [],
          mappings: [],
          conflicts: [],
          syncCursor: {
            syncScope: "expense",
            localSyncCursorId: "expense-session-1",
            localRegisterSessionId: "expense-session-1",
            localExpenseSessionId: "expense-session-1",
            acceptedThroughSequence: 1,
          },
        },
      })
      .mockResolvedValueOnce({
        kind: "ok",
        data: {
          accepted: [
            {
              localEventId: "event-expense-2",
              sequence: 1,
              status: "projected",
            },
          ],
          held: [],
          mappings: [],
          conflicts: [],
          syncCursor: {
            syncScope: "expense",
            localSyncCursorId: "expense-session-2",
            localRegisterSessionId: "expense-session-2",
            localExpenseSessionId: "expense-session-2",
            acceptedThroughSequence: 1,
          },
        },
      });

    renderHook(() =>
      usePosLocalSyncRuntimeStatus({
        mode: "drain-enabled",
        storeFactory: () => store as never,
        storeId: "store-1",
        terminalId: "terminal-cloud-1",
      }),
    );

    await waitFor(() =>
      expect(mocks.ingestLocalEvents.mock.calls.length).toBeGreaterThanOrEqual(
        2,
      ),
    );
    expect(mocks.ingestLocalEvents.mock.calls[0]?.[0].events).toEqual([
      expect.objectContaining({
        localEventId: "event-expense-1",
        localExpenseSessionId: "expense-session-1",
        sequence: 1,
      }),
    ]);
    expect(mocks.ingestLocalEvents.mock.calls[1]?.[0].events).toEqual([
      expect.objectContaining({
        localEventId: "event-expense-2",
        localExpenseSessionId: "expense-session-2",
        sequence: 1,
      }),
    ]);
  });

  it("marks rejected runtime sale responses reviewable without settling embedded local events", async () => {
    mocks.ingestLocalEvents.mockResolvedValue({
      kind: "ok",
      data: {
        accepted: [
          {
            localEventId: "event-checkout",
            sequence: 1,
            status: "rejected",
          },
        ],
        held: [],
        mappings: [],
        conflicts: [],
        syncCursor: {
          localRegisterSessionId: "register-1",
          acceptedThroughSequence: 2,
        },
      },
    });
    const store = {
      listEvents: vi.fn(async () => ({
        ok: true,
        value: [
          buildLocalEvent({
            localEventId: "event-session",
            localPosSessionId: "local-session-1",
            sequence: 1,
            type: "session.started",
          }),
          buildLocalEvent({
            localEventId: "event-cart",
            localPosSessionId: "local-session-1",
            payload: {
              localItemId: "local-item-1",
              productId: "product-1",
              productSkuId: "sku-1",
              productName: "Wig Cap",
              productSku: "CAP-1",
              quantity: 1,
              price: 25,
            },
            sequence: 2,
            type: "cart.item_added",
          }),
          buildLocalEvent({
            localEventId: "event-payment",
            localPosSessionId: "local-session-1",
            payload: {
              localPosSessionId: "local-session-1",
              payments: [{ method: "cash", amount: 25, timestamp: 2 }],
              stage: "paymentAdded",
            },
            sequence: 3,
            type: "session.payments_updated",
          }),
          buildLocalEvent({
            localEventId: "event-checkout",
            localPosSessionId: "local-session-1",
            localTransactionId: "local-txn-1",
            payload: {
              localPosSessionId: "local-session-1",
              localTransactionId: "local-txn-1",
              receiptNumber: "LOCAL-1-000001",
              subtotal: 25,
              tax: 0,
              total: 25,
              payments: [{ method: "cash", amount: 25, timestamp: 2 }],
            },
            sequence: 4,
            type: "transaction.completed",
          }),
        ],
      })),
      markEventsNeedsReview: vi.fn(async () => ({
        ok: true,
        value: [],
      })),
      markEventsSynced: vi.fn(async () => ({
        ok: true,
        value: [],
      })),
      readProvisionedTerminalSeed: vi.fn(async () => ({
        ok: true,
        value: {
          cloudTerminalId: "terminal-cloud-1",
          displayName: "Front",
          provisionedAt: 1,
          schemaVersion: 1,
          syncSecretHash: "sync-secret-1",
          storeId: "store-1",
          terminalId: "local-terminal-1",
        },
      })),
    };
    const storeFactory = () => store as never;

    const { result } = renderHook(() =>
      usePosLocalSyncRuntimeStatus({
        onRetrySync: vi.fn(),
        storeFactory,
        storeId: "store-1",
        terminalId: "terminal-cloud-1",
      }),
    );

    await waitFor(() =>
      expect(result.current).toEqual(
        expect.objectContaining({
          status: "pending",
        }),
      ),
    );
    act(() => {
      result.current?.onRetrySync?.();
    });

    await waitFor(() => expect(mocks.ingestLocalEvents).toHaveBeenCalled());
    await waitFor(() =>
      expect(store.markEventsNeedsReview).toHaveBeenCalledWith(
        ["event-checkout", "event-session", "event-cart", "event-payment"],
        "Sync rejected; review required",
        { uploaded: true },
      ),
    );
    expect(store.markEventsSynced).not.toHaveBeenCalled();
  });

  it("presents unsynced closeout events as locally closed pending sync", () => {
    expect(
      derivePosLocalRuntimeSyncStatus(
        [
          buildLocalEvent({
            localEventId: "event-closeout",
            type: "register.closeout_started",
          }),
        ],
        { isOnline: true },
      ),
    ).toEqual(
      expect.objectContaining({
        pendingEventCount: 1,
        status: "locally_closed_pending_sync",
      }),
    );
  });

  it("keeps closeout reconciliation conflicts out of POS runtime review status", () => {
    expect(
      derivePosLocalRuntimeSyncStatus(
        [
          buildLocalEvent({
            localEventId: "event-closeout",
            sync: { status: "needs_review" },
            type: "register.closeout_started",
          }),
        ],
        { isOnline: true },
      ),
    ).toBeNull();
  });

  it("keeps drawer-open reconciliation conflicts out of POS runtime review status", () => {
    expect(
      derivePosLocalRuntimeSyncStatus(
        [
          buildLocalEvent({
            localEventId: "event-open",
            sync: { status: "needs_review", uploaded: true },
            type: "register.opened",
          }),
        ],
        { isOnline: true },
      ),
    ).toBeNull();
  });

  it("ignores local cart drafts that are not referenced by a pending completed sale", () => {
    expect(
      derivePosLocalRuntimeSyncStatus(
        [
          buildLocalEvent({
            localEventId: "event-session",
            sequence: 1,
            type: "session.started",
          }),
          buildLocalEvent({
            localEventId: "event-cart",
            localPosSessionId: "local-session-1",
            sequence: 2,
            type: "cart.item_added",
          }),
        ],
        { isOnline: true },
      ),
    ).toBeNull();
  });

  it("scopes presented pending upload counts to the signed-in staff profile", () => {
    expect(
      derivePosLocalRuntimeSyncStatus(
        [
          buildLocalEvent({
            localEventId: "event-other-staff",
            staffProfileId: "staff-2",
            type: "register.opened",
          }),
        ],
        { isOnline: true, staffProfileId: "staff-1" },
      ),
    ).toBeNull();

    expect(
      derivePosLocalRuntimeSyncStatus(
        [
          buildLocalEvent({
            localEventId: "event-current-staff",
            staffProfileId: "staff-1",
            type: "register.opened",
          }),
        ],
        { isOnline: true, staffProfileId: "staff-1" },
      ),
    ).toEqual(
      expect.objectContaining({
        pendingEventCount: 1,
        status: "pending",
      }),
    );
  });

  it("presents terminal-blocking uploaded reopen review events from another staff profile", () => {
    expect(
      derivePosLocalRuntimeSyncStatus(
        [
          buildLocalEvent({
            localEventId: "event-other-staff-reopen",
            staffProfileId: "staff-2",
            sync: { status: "needs_review", uploaded: true },
            type: "register.reopened",
          }),
        ],
        { isOnline: true, staffProfileId: "staff-1" },
      ),
    ).toEqual(
      expect.objectContaining({
        pendingEventCount: 0,
        status: "needs_review",
      }),
    );
  });

  it("persists a cloud-closed drawer authority block for register-not-open sale conflicts", async () => {
    mocks.ingestLocalEvents.mockResolvedValue({
      kind: "ok",
      data: {
        accepted: [
          {
            localEventId: "event-sale-completed",
            sequence: 3,
            status: "conflicted",
          },
        ],
        held: [],
        mappings: [],
        conflicts: [
          {
            _id: "conflict-1",
            conflictType: "permission",
            localEventId: "event-sale-completed",
            localRegisterSessionId: "register-1",
            status: "needs_review",
            summary: "Register was not open before this sale synced.",
          },
        ],
        syncCursor: {
          localRegisterSessionId: "register-1",
          acceptedThroughSequence: 3,
        },
      },
    });
    const store = {
      clearDrawerAuthorityState: vi.fn(async () => ({ ok: true, value: null })),
      listEvents: vi.fn(async () => ({
        ok: true,
        value: [
          buildLocalEvent({
            localEventId: "event-open",
            sequence: 1,
            type: "register.opened",
          }),
          buildLocalEvent({
            localEventId: "event-session",
            localPosSessionId: "session-1",
            payload: {
              localPosSessionId: "session-1",
              status: "active",
            },
            sequence: 2,
            type: "session.started",
          }),
          buildLocalEvent({
            localEventId: "event-sale-completed",
            localPosSessionId: "session-1",
            localTransactionId: "local-txn-1",
            payload: {
              localPosSessionId: "session-1",
              localTransactionId: "local-txn-1",
              payments: [{ amount: 25, method: "cash", timestamp: 2 }],
              receiptNumber: "LOCAL-1-000001",
              subtotal: 25,
              tax: 0,
              total: 25,
            },
            sequence: 3,
            type: "transaction.completed",
          }),
        ],
      })),
      listLocalCloudMappings: vi.fn(async () => ({
        ok: true,
        value: [
          {
            cloudId: "cloud-register-closed-1",
            entity: "registerSession",
            localId: "register-1",
            mappedAt: 1,
          },
        ],
      })),
      markEventsNeedsReview: vi.fn(async () => ({
        ok: true,
        value: [],
      })),
      markEventsSynced: vi.fn(async () => ({
        ok: true,
        value: [],
      })),
      readDrawerAuthorityState: vi.fn(async () => ({ ok: true, value: null })),
      readProvisionedTerminalSeed: vi.fn(async () => ({
        ok: true,
        value: {
          cloudTerminalId: "terminal-cloud-1",
          displayName: "Front",
          provisionedAt: 1,
          schemaVersion: 1,
          syncSecretHash: "sync-secret-1",
          storeId: "store-1",
          terminalId: "local-terminal-1",
        },
      })),
      writeDrawerAuthorityState: vi.fn(async () => ({
        ok: true,
        value: null,
      })),
      writeLocalCloudMapping: vi.fn(async () => ({
        ok: true,
        value: {},
      })),
    };

    renderHook(() =>
      usePosLocalSyncRuntimeStatus({
        mode: "drain-enabled",
        storeFactory: () => store as never,
        storeId: "store-1",
        terminalId: "terminal-cloud-1",
      }),
    );

    await waitFor(() =>
      expect(store.markEventsNeedsReview).toHaveBeenCalledWith(
        ["event-sale-completed", "event-session"],
        "Cloud sync needs review before this local event can finish.",
        { uploaded: true },
      ),
    );
    expect(store.writeDrawerAuthorityState).toHaveBeenCalledWith(
      expect.objectContaining({
        cloudRegisterSessionId: "cloud-register-closed-1",
        localRegisterSessionId: "register-1",
        reason: "cloud_closed",
        status: "blocked",
        storeId: "store-1",
        terminalId: "local-terminal-1",
      }),
    );
  });

  it("does not persist drawer authority blocks for sale inventory review conflicts", async () => {
    mocks.ingestLocalEvents.mockResolvedValue({
      kind: "ok",
      data: {
        accepted: [
          {
            localEventId: "event-sale-completed",
            sequence: 3,
            status: "conflicted",
          },
        ],
        held: [],
        mappings: [],
        conflicts: [
          {
            _id: "conflict-1",
            conflictType: "inventory_mismatch",
            localEventId: "event-sale-completed",
            status: "needs_review",
            summary: "Inventory count mismatch for synced sale.",
          },
        ],
        syncCursor: {
          localRegisterSessionId: "register-1",
          acceptedThroughSequence: 3,
        },
      },
    });
    const store = {
      clearDrawerAuthorityState: vi.fn(async () => ({ ok: true, value: null })),
      listEvents: vi.fn(async () => ({
        ok: true,
        value: [
          buildLocalEvent({
            localEventId: "event-open",
            sequence: 1,
            type: "register.opened",
          }),
          buildLocalEvent({
            localEventId: "event-session",
            localPosSessionId: "session-1",
            payload: {
              localPosSessionId: "session-1",
              status: "active",
            },
            sequence: 2,
            type: "session.started",
          }),
          buildLocalEvent({
            localEventId: "event-sale-completed",
            localPosSessionId: "session-1",
            localTransactionId: "local-txn-1",
            payload: {
              localPosSessionId: "session-1",
              localTransactionId: "local-txn-1",
              receiptNumber: "LOCAL-1-000001",
              subtotal: 25,
              tax: 0,
              total: 25,
              payments: [{ method: "cash", amount: 25, timestamp: 2 }],
            },
            sequence: 3,
            type: "transaction.completed",
          }),
        ],
      })),
      markEventsNeedsReview: vi.fn(async () => ({
        ok: true,
        value: [],
      })),
      markEventsSynced: vi.fn(async () => ({
        ok: true,
        value: [],
      })),
      readDrawerAuthorityState: vi.fn(async () => ({ ok: true, value: null })),
      readProvisionedTerminalSeed: vi.fn(async () => ({
        ok: true,
        value: {
          cloudTerminalId: "terminal-cloud-1",
          displayName: "Front",
          provisionedAt: 1,
          schemaVersion: 1,
          syncSecretHash: "sync-secret-1",
          storeId: "store-1",
          terminalId: "local-terminal-1",
        },
      })),
      writeDrawerAuthorityState: vi.fn(async () => ({
        ok: true,
        value: null,
      })),
      writeLocalCloudMapping: vi.fn(async () => ({
        ok: true,
        value: {},
      })),
    };

    renderHook(() =>
      usePosLocalSyncRuntimeStatus({
        mode: "drain-enabled",
        storeFactory: () => store as never,
        storeId: "store-1",
        terminalId: "terminal-cloud-1",
      }),
    );

    await waitFor(() =>
      expect(store.markEventsNeedsReview).toHaveBeenCalledWith(
        ["event-sale-completed", "event-session"],
        "Cloud sync needs review before this local event can finish.",
        { uploaded: true },
      ),
    );
    expect(store.writeDrawerAuthorityState).not.toHaveBeenCalled();
  });

  it("does not present a reopened local closeout as pending reconciliation", () => {
    expect(
      derivePosLocalRuntimeSyncStatus(
        [
          buildLocalEvent({
            localEventId: "event-closeout",
            sequence: 1,
            type: "register.closeout_started",
          }),
          buildLocalEvent({
            localEventId: "event-reopen",
            sequence: 2,
            type: "register.reopened",
          }),
        ],
        { isOnline: true },
      ),
    ).toEqual(
      expect.objectContaining({
        pendingEventCount: 2,
        status: "pending",
      }),
    );
  });

  it("surfaces a review state when the local store cannot read events", async () => {
    const store = {
      listEvents: vi.fn(async () => ({
        ok: false,
        error: { code: "write_failed", message: "failed" },
      })),
      readProvisionedTerminalSeed: vi.fn(async () => ({
        ok: true,
        value: null,
      })),
    };

    const { result } = renderHook(() =>
      usePosLocalSyncRuntimeStatus({
        storeFactory: () => store as never,
        storeId: "store-1",
        terminalId: "terminal-cloud-1",
      }),
    );

    await waitFor(() => expect(store.listEvents).toHaveBeenCalled());
    expect(result.current).toEqual(
      expect.objectContaining({
        description:
          "Local register activity could not be read. Check this terminal before continuing.",
        label: "Local sync unavailable",
        pendingEventCount: 1,
        status: "needs_review",
      }),
    );
  });

  it("surfaces a review state when foreground sync cannot reread local events", async () => {
    const listEvents = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        value: [
          buildLocalEvent({
            localEventId: "event-checkout",
            localPosSessionId: "local-session-1",
            localTransactionId: "local-txn-1",
            payload: {
              localPosSessionId: "local-session-1",
              localTransactionId: "local-txn-1",
              receiptNumber: "LOCAL-1-000001",
              subtotal: 25,
              tax: 0,
              total: 25,
              payments: [{ method: "cash", amount: 25, timestamp: 2 }],
            },
            sequence: 1,
            type: "transaction.completed",
          }),
        ],
      })
      .mockResolvedValueOnce({
        ok: false,
        error: { code: "write_failed", message: "foreground read failed" },
      });
    const store = {
      listEvents,
      markEventsNeedsReview: vi.fn(async () => ({
        ok: true,
        value: [],
      })),
      markEventsSynced: vi.fn(async () => ({
        ok: true,
        value: [],
      })),
      readProvisionedTerminalSeed: vi.fn(async () => ({
        ok: true,
        value: {
          cloudTerminalId: "terminal-cloud-1",
          displayName: "Front",
          provisionedAt: 1,
          schemaVersion: 1,
          syncSecretHash: "sync-secret-1",
          storeId: "store-1",
          terminalId: "local-terminal-1",
        },
      })),
    };
    const storeFactory = () => store as never;

    const { result } = renderHook(() =>
      usePosLocalSyncRuntimeStatus({
        storeFactory,
        storeId: "store-1",
        terminalId: "terminal-cloud-1",
      }),
    );

    await waitFor(() =>
      expect(result.current).toEqual(
        expect.objectContaining({
          status: "needs_review",
          label: "Local sync unavailable",
        }),
      ),
    );
    expect(mocks.ingestLocalEvents).not.toHaveBeenCalled();
  });

  it("claims, executes, and acknowledges recovery commands for the active terminal", async () => {
    const retry = vi.fn();
    const command = buildRecoveryCommand();
    const commandResult = { kind: "ok", data: [command] };
    mocks.listTerminalRecoveryCommands.mockImplementation((args) =>
      args === "skip" ? undefined : commandResult,
    );
    mocks.claimTerminalRecoveryCommand.mockResolvedValue({
      kind: "ok",
      data: command,
    });
    const store = buildRecoveryCommandStore();

    renderHook(() =>
      usePosLocalSyncRuntimeStatus({
        mode: "status-only",
        onRetrySync: retry,
        storeFactory: () => store as never,
        storeId: "store-1",
        terminalId: "terminal-cloud-1",
      }),
    );

    await waitFor(() =>
      expect(mocks.claimTerminalRecoveryCommand).toHaveBeenCalledWith({
        commandId: "command-1",
        storeId: "store-1",
        syncSecretHash: "sync-secret-1",
        terminalId: "terminal-cloud-1",
      }),
    );
    await waitFor(() =>
      expect(mocks.acknowledgeTerminalRecoveryCommand).toHaveBeenCalledWith({
        commandId: "command-1",
        executionId: "command-1:2000100",
        message: undefined,
        result: "completed",
        storeId: "store-1",
        syncSecretHash: "sync-secret-1",
        terminalId: "terminal-cloud-1",
      }),
    );
    expect(retry).toHaveBeenCalled();
  });

  it("acknowledges update_app only after saving reload correlation", async () => {
    const command = buildRecoveryCommand({
      commandType: "update_app",
      executionId: "command-1:2000100",
    });
    const ack = deferred<{ kind: "ok"; data: Record<string, never> }>();
    const applyUpdate = vi.fn(() => true);
    const appUpdateCoordinator = {
      applyUpdate,
      getSnapshot: () => ({
        blockers: [],
        canApply: true,
        currentBuildId: "build-1",
        pendingBuildId: "build-2",
        status: "ready" as const,
      }),
    };
    const storeFactory = () => buildRecoveryCommandStore() as never;
    const commandResult = { kind: "ok", data: [command] };
    mocks.listTerminalRecoveryCommands.mockImplementation((args) =>
      args === "skip" ? undefined : commandResult,
    );
    mocks.claimTerminalRecoveryCommand.mockResolvedValue({
      kind: "ok",
      data: command,
    });
    mocks.acknowledgeTerminalRecoveryCommand.mockReturnValue(ack.promise);

    renderHook(() =>
      usePosLocalSyncRuntimeStatus({
        appUpdateCoordinator,
        mode: "status-only",
        storeFactory,
        storeId: "store-1",
        terminalId: "terminal-cloud-1",
      }),
    );

    await waitFor(() =>
      expect(mocks.acknowledgeTerminalRecoveryCommand).toHaveBeenCalledWith({
        commandId: "command-1",
        executionId: "command-1:2000100",
        message:
          "App update accepted and will apply when the terminal is safe to refresh.",
        result: "completed",
        storeId: "store-1",
        syncSecretHash: "sync-secret-1",
        terminalId: "terminal-cloud-1",
      }),
    );
    expect(applyUpdate).not.toHaveBeenCalled();

    await act(async () => {
      ack.resolve({ kind: "ok", data: {} });
      await ack.promise;
    });

    await waitFor(() => expect(applyUpdate).toHaveBeenCalledTimes(1));
  });

  it("publishes a fresh runtime observation when update_app apply returns false after acknowledgement", async () => {
    const command = buildRecoveryCommand({
      commandType: "update_app",
      executionId: "command-1:2000100",
    });
    const applyUpdate = vi.fn(() => false);
    const appUpdateCoordinator = {
      applyUpdate,
      getSnapshot: () => ({
        blockers: [],
        canApply: true,
        currentBuildId: "build-1",
        pendingBuildId: "build-2",
        status: "ready" as const,
      }),
    };
    const storeFactory = () => buildRecoveryCommandStore() as never;
    const commandResult = { kind: "ok", data: [command] };
    mocks.listTerminalRecoveryCommands.mockImplementation((args) =>
      args === "skip" ? undefined : commandResult,
    );
    mocks.claimTerminalRecoveryCommand.mockResolvedValue({
      kind: "ok",
      data: command,
    });
    const initialReportCount =
      mocks.reportTerminalRuntimeStatus.mock.calls.length;

    renderHook(() =>
      usePosLocalSyncRuntimeStatus({
        appUpdateCoordinator,
        mode: "status-only",
        storeFactory,
        storeId: "store-1",
        terminalId: "terminal-cloud-1",
      }),
    );

    await waitFor(() => expect(applyUpdate).toHaveBeenCalledTimes(1));
    await waitFor(() => {
      const publishedAppUpdate = mocks.reportTerminalRuntimeStatus.mock.calls
        .slice(initialReportCount)
        .map((call) => call[0]?.status?.appUpdate)
        .find(
          (appUpdate) => appUpdate?.commandExecutionId === "command-1:2000100",
        );

      expect(publishedAppUpdate).toEqual(
        expect.objectContaining({
          commandExecutionId: "command-1:2000100",
          commandId: "command-1",
          status: "update_ready",
        }),
      );
    });
  });

  it("runs update_app post-ack cleanup even when the hook unmounts during acknowledgement", async () => {
    const command = buildRecoveryCommand({
      commandType: "update_app",
      executionId: "command-1:2000100",
    });
    const ack = deferred<{ kind: "ok"; data: Record<string, never> }>();
    const applyUpdate = vi.fn(() => true);
    const storage = {
      getItem: vi.fn(() => null),
      removeItem: vi.fn(),
      setItem: vi.fn(),
    };
    Object.defineProperty(globalThis, "sessionStorage", {
      configurable: true,
      value: storage,
    });
    const appUpdateCoordinator = {
      applyUpdate,
      getSnapshot: () => ({
        blockers: [],
        canApply: true,
        currentBuildId: "build-1",
        pendingBuildId: "build-2",
        status: "ready" as const,
      }),
    };
    const storeFactory = () => buildRecoveryCommandStore() as never;
    const commandResult = { kind: "ok", data: [command] };
    mocks.listTerminalRecoveryCommands.mockImplementation((args) =>
      args === "skip" ? undefined : commandResult,
    );
    mocks.claimTerminalRecoveryCommand.mockResolvedValue({
      kind: "ok",
      data: command,
    });
    mocks.acknowledgeTerminalRecoveryCommand.mockReturnValue(ack.promise);

    const { unmount } = renderHook(() =>
      usePosLocalSyncRuntimeStatus({
        appUpdateCoordinator,
        mode: "status-only",
        storeFactory,
        storeId: "store-1",
        terminalId: "terminal-cloud-1",
      }),
    );

    await waitFor(() =>
      expect(mocks.acknowledgeTerminalRecoveryCommand).toHaveBeenCalled(),
    );
    unmount();

    await act(async () => {
      ack.resolve({ kind: "ok", data: {} });
      await ack.promise;
    });

    expect(storage.setItem).toHaveBeenCalled();
    expect(applyUpdate).toHaveBeenCalledTimes(1);
  });

  it("does not acknowledge or reload when update_app reload correlation cannot be stored", async () => {
    const command = buildRecoveryCommand({
      commandType: "update_app",
      executionId: "command-1:2000100",
    });
    const applyUpdate = vi.fn(() => true);
    Object.defineProperty(globalThis, "sessionStorage", {
      configurable: true,
      value: {
        getItem: vi.fn(() => null),
        removeItem: vi.fn(),
        setItem: vi.fn(() => {
          throw new Error("storage unavailable");
        }),
      },
    });
    const appUpdateCoordinator = {
      applyUpdate,
      getSnapshot: () => ({
        blockers: [],
        canApply: true,
        currentBuildId: "build-1",
        pendingBuildId: "build-2",
        status: "ready" as const,
      }),
    };
    const storeFactory = () => buildRecoveryCommandStore() as never;
    const commandResult = { kind: "ok", data: [command] };
    mocks.listTerminalRecoveryCommands.mockImplementation((args) =>
      args === "skip" ? undefined : commandResult,
    );
    mocks.claimTerminalRecoveryCommand.mockResolvedValue({
      kind: "ok",
      data: command,
    });

    renderHook(() =>
      usePosLocalSyncRuntimeStatus({
        appUpdateCoordinator,
        mode: "status-only",
        storeFactory,
        storeId: "store-1",
        terminalId: "terminal-cloud-1",
      }),
    );

    await waitFor(() =>
      expect(mocks.claimTerminalRecoveryCommand).toHaveBeenCalled(),
    );
    expect(globalThis.sessionStorage.setItem).toHaveBeenCalled();
    expect(mocks.acknowledgeTerminalRecoveryCommand).not.toHaveBeenCalled();
    expect(applyUpdate).not.toHaveBeenCalled();
  });

  it("refreshes drawer authority before publishing the post-recovery check-in", async () => {
    let drawerAuthority: PosDrawerAuthorityState | null = {
      cloudRegisterSessionId: "register-cloud-1",
      localRegisterSessionId: "register-local-1",
      observedAt: 10,
      reason: "cloud_closed",
      status: "blocked",
      storeId: "store-1",
      terminalId: "terminal-cloud-1",
    };
    const command = buildRecoveryCommand({
      commandContext: {
        blockerReason: "cloud_closed",
        cloudRegisterSessionId: "register-cloud-1",
        localEventSettlement: "settled",
        localRegisterSessionId: "register-local-1",
      },
      commandType: "clear_stale_drawer_authority",
    });
    const commandResult = { kind: "ok", data: [command] };
    mocks.listTerminalRecoveryCommands.mockImplementation((args) =>
      args === "skip" ? undefined : commandResult,
    );
    mocks.claimTerminalRecoveryCommand.mockResolvedValue({
      kind: "ok",
      data: command,
    });
    const store = {
      ...buildRecoveryCommandStore(),
      clearDrawerAuthorityState: vi.fn(async () => {
        drawerAuthority = null;
        return { ok: true, value: null };
      }),
      listEvents: vi.fn(async () => ({
        ok: true,
        value: [
          buildLocalEvent({
            localEventId: "event-open",
            localRegisterSessionId: "register-local-1",
            sequence: 1,
            sync: { status: "synced" },
            terminalId: "terminal-cloud-1",
            type: "register.opened",
          }),
        ],
      })),
      listLocalCloudMappings: vi.fn(async () => ({
        ok: true,
        value: [
          {
            cloudId: "register-cloud-1",
            cloudTable: "posSession",
            createdAt: 1,
            localId: "register-local-1",
            localIdKind: "registerSession",
            storeId: "store-1",
            terminalId: "terminal-cloud-1",
          },
        ],
      })),
      readDrawerAuthorityState: vi.fn(async () => ({
        ok: true,
        value: drawerAuthority,
      })),
    };

    renderHook(() =>
      usePosLocalSyncRuntimeStatus({
        mode: "status-only",
        storeFactory: () => store as never,
        storeId: "store-1",
        terminalId: "terminal-cloud-1",
      }),
    );

    await waitFor(() =>
      expect(mocks.acknowledgeTerminalRecoveryCommand).toHaveBeenCalledWith({
        commandId: "command-1",
        executionId: "command-1:2000100",
        message: undefined,
        result: "completed",
        storeId: "store-1",
        syncSecretHash: "sync-secret-1",
        terminalId: "terminal-cloud-1",
      }),
    );
    await waitFor(() =>
      expect(mocks.reportTerminalRuntimeStatus).toHaveBeenCalledWith(
        expect.objectContaining({
          status: expect.not.objectContaining({
            drawerAuthority: expect.objectContaining({ status: "blocked" }),
          }),
        }),
      ),
    );
    expect(store.clearDrawerAuthorityState).toHaveBeenCalledWith({
      localRegisterSessionId: "register-local-1",
      storeId: "store-1",
      terminalId: "terminal-cloud-1",
    });
  });

  it("refreshes staff authority through the terminal recovery command path", async () => {
    const command = buildRecoveryCommand({
      commandType: "refresh_staff_authority",
      expectedEvidence: {
        staffAuthorityStatus: "ready",
      },
    });
    const records = [
      {
        activeRoles: ["cashier"],
        credentialId: "credential-1",
        credentialVersion: 1,
        displayName: "Ato K.",
        expiresAt: Date.now() + 60_000,
        issuedAt: Date.now(),
        organizationId: "org-1",
        refreshedAt: Date.now(),
        staffProfileId: "staff-1",
        status: "active",
        storeId: "store-1",
        terminalId: "terminal-cloud-1",
        username: "ato",
        verifier: {
          algorithm: "PBKDF2-SHA256",
          hash: "hash-1",
          iterations: 120_000,
          salt: "salt-1",
          version: 1,
        },
      },
    ];
    mocks.listTerminalRecoveryCommands.mockImplementation((args) =>
      args === "skip" ? undefined : { kind: "ok", data: [command] },
    );
    mocks.claimTerminalRecoveryCommand.mockResolvedValue({
      kind: "ok",
      data: command,
    });
    mocks.refreshTerminalStaffAuthority.mockResolvedValue({
      kind: "ok",
      data: records,
    });
    const store = {
      ...buildRecoveryCommandStore(),
      getStaffAuthorityReadiness: vi.fn(async () => ({
        ok: true,
        value: "ready",
      })),
      replaceStaffAuthoritySnapshot: vi.fn(async () => ({
        ok: true,
        value: records,
      })),
    };

    renderHook(() =>
      usePosLocalSyncRuntimeStatus({
        mode: "status-only",
        storeFactory: () => store as never,
        storeId: "store-1",
        terminalId: "terminal-cloud-1",
      }),
    );

    await waitFor(() =>
      expect(mocks.refreshTerminalStaffAuthority).toHaveBeenCalledWith({
        storeId: "store-1",
        terminalId: "terminal-cloud-1",
      }),
    );
    expect(store.replaceStaffAuthoritySnapshot).toHaveBeenCalledWith({
      records,
      storeId: "store-1",
      terminalId: "terminal-cloud-1",
    });
    await waitFor(() =>
      expect(mocks.acknowledgeTerminalRecoveryCommand).toHaveBeenCalledWith({
        commandId: "command-1",
        executionId: "command-1:2000100",
        message: "Staff authority refreshed.",
        result: "completed",
        storeId: "store-1",
        syncSecretHash: "sync-secret-1",
        terminalId: "terminal-cloud-1",
      }),
    );
  });

  it("acknowledges safe recovery precondition drift distinctly", async () => {
    const command = buildRecoveryCommand({
      commandContext: {
        cloudRegisterSessionId: "register-cloud-1",
        expectedBlockerType: "cloud_closed",
        localRegisterSessionId: "register-local-1",
      },
      commandType: "clear_stale_drawer_authority",
    });
    const commandResult = { kind: "ok", data: [command] };
    mocks.listTerminalRecoveryCommands.mockImplementation((args) =>
      args === "skip" ? undefined : commandResult,
    );
    mocks.claimTerminalRecoveryCommand.mockResolvedValue({
      kind: "ok",
      data: command,
    });
    const store = {
      ...buildRecoveryCommandStore(),
      clearDrawerAuthorityState: vi.fn(async () => ({
        ok: true,
        value: null,
      })),
      readDrawerAuthorityState: vi.fn(async () => ({
        ok: true,
        value: null,
      })),
    };

    renderHook(() =>
      usePosLocalSyncRuntimeStatus({
        mode: "status-only",
        storeFactory: () => store as never,
        storeId: "store-1",
        terminalId: "terminal-cloud-1",
      }),
    );

    await waitFor(() =>
      expect(mocks.acknowledgeTerminalRecoveryCommand).toHaveBeenCalledWith({
        commandId: "command-1",
        executionId: "command-1:2000100",
        message:
          "Drawer repair expected a blocked drawer authority record, but this terminal no longer reported that same block.",
        result: "precondition_failed",
        storeId: "store-1",
        syncSecretHash: "sync-secret-1",
        terminalId: "terminal-cloud-1",
      }),
    );
    expect(store.clearDrawerAuthorityState).not.toHaveBeenCalled();
  });

  it("reschedules a recovery command after a claim failure", async () => {
    const command = buildRecoveryCommand();
    const commandResult = { kind: "ok", data: [command] };
    mocks.listTerminalRecoveryCommands.mockImplementation((args) =>
      args === "skip" ? undefined : commandResult,
    );
    mocks.claimTerminalRecoveryCommand
      .mockResolvedValueOnce({
        kind: "user_error",
        error: {
          code: "precondition_failed",
          message: "Claim failed.",
        },
      })
      .mockResolvedValueOnce({
        kind: "ok",
        data: command,
      });

    renderHook(() =>
      usePosLocalSyncRuntimeStatus({
        mode: "status-only",
        storeFactory: () => buildRecoveryCommandStore() as never,
        storeId: "store-1",
        terminalId: "terminal-cloud-1",
      }),
    );

    await waitFor(() =>
      expect(mocks.claimTerminalRecoveryCommand).toHaveBeenCalledTimes(2),
    );
    expect(mocks.acknowledgeTerminalRecoveryCommand).toHaveBeenCalledWith({
      commandId: "command-1",
      executionId: "command-1:2000100",
      message: undefined,
      result: "completed",
      storeId: "store-1",
      syncSecretHash: "sync-secret-1",
      terminalId: "terminal-cloud-1",
    });
  });

  it("does not acknowledge a claimed recovery command for another terminal", async () => {
    const command = buildRecoveryCommand({ terminalId: "other-terminal" });
    const commandResult = { kind: "ok", data: [command] };
    mocks.listTerminalRecoveryCommands.mockImplementation((args) =>
      args === "skip" ? undefined : commandResult,
    );
    mocks.claimTerminalRecoveryCommand.mockResolvedValue({
      kind: "ok",
      data: command,
    });
    const store = buildRecoveryCommandStore();

    renderHook(() =>
      usePosLocalSyncRuntimeStatus({
        mode: "status-only",
        storeFactory: () => store as never,
        storeId: "store-1",
        terminalId: "terminal-cloud-1",
      }),
    );

    await waitFor(() =>
      expect(mocks.claimTerminalRecoveryCommand).toHaveBeenCalled(),
    );
    await waitFor(() =>
      expect(mocks.reportTerminalRuntimeStatus).toHaveBeenCalled(),
    );
    expect(mocks.acknowledgeTerminalRecoveryCommand).not.toHaveBeenCalled();
  });
});

function buildLocalEvent(
  overrides: Partial<PosLocalEventRecord> = {},
): PosLocalEventRecord {
  const sequence = overrides.sequence ?? 1;

  return {
    createdAt: 1,
    localEventId: "event-1",
    localRegisterSessionId: "register-1",
    payload: {},
    schemaVersion: 1,
    sequence,
    staffProfileId: "staff-1",
    staffProofToken: "proof-token-1",
    storeId: "store-1",
    sync: { status: "pending" },
    terminalId: "local-terminal-1",
    type: "register.opened",
    uploadSequence: sequence,
    ...overrides,
  };
}

function buildRecoveryCommand(overrides: Record<string, unknown> = {}) {
  return {
    _creationTime: 1,
    _id: "command-1",
    commandContext: {},
    commandType: "retry_sync",
    expectedEvidence: {},
    expiresAt: Date.now() + 60_000,
    executionId: "command-1:2000100",
    issuedAt: 1,
    issuedByUserId: "user-1",
    status: "pending",
    storeId: "store-1",
    terminalId: "terminal-cloud-1",
    verificationStatus: "waiting_for_acknowledgement",
    ...overrides,
  } as never;
}

function buildRecoveryCommandStore() {
  return {
    listEvents: vi.fn(async () => ({
      ok: true,
      value: [],
    })),
    markEventsSynced: vi.fn(async () => ({
      ok: true,
      value: [],
    })),
    readProvisionedTerminalSeed: vi.fn(async () => ({
      ok: true,
      value: {
        cloudTerminalId: "terminal-cloud-1",
        displayName: "Front",
        provisionedAt: 1,
        schemaVersion: 1,
        syncSecretHash: "sync-secret-1",
        storeId: "store-1",
        terminalId: "local-terminal-1",
      },
    })),
  };
}
