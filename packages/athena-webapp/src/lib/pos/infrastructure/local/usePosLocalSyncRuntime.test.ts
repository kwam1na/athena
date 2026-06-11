import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ingestLocalEvents: vi.fn(),
  reportTerminalRuntimeStatus: vi.fn(),
}));

vi.mock("convex/react", () => ({
  useMutation: (mutation: string) =>
    mutation === "reportTerminalRuntimeStatus"
      ? mocks.reportTerminalRuntimeStatus
      : mocks.ingestLocalEvents,
}));

vi.mock("~/convex/_generated/api", () => ({
  api: {
    pos: {
      public: {
        sync: { ingestLocalEvents: "ingestLocalEvents" },
        terminals: { reportTerminalRuntimeStatus: "reportTerminalRuntimeStatus" },
      },
    },
  },
}));

import {
  assertPosLocalStoreOk,
  collectLocallySettledSkippedReviewEventIds,
  collectSyncedLocalEventIds,
  collectServerHeldLocalEventIds,
  collectServerReviewLocalEventIds,
  collectServerSettledLocalEventIds,
  collectServerSyncedLocalEventIds,
  derivePosLocalRuntimeSyncStatus,
  getRuntimeStatusSignature,
  usePosLocalSyncRuntimeStatus,
  writeReturnedLocalCloudMappings,
} from "./usePosLocalSyncRuntime";
import type {
  PosLocalEventRecord,
  PosTerminalIntegrityState,
} from "./posLocalStore";
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
    vi.resetAllMocks();
    mocks.reportTerminalRuntimeStatus.mockResolvedValue({
      kind: "ok",
      data: {},
    });
    Object.defineProperty(globalThis.navigator, "onLine", {
      configurable: true,
      value: true,
    });
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
    expect(store.markEventsSynced).toHaveBeenCalledWith([
      "event-checkout",
      "event-session",
      "event-cart",
      "event-payment",
      "event-clear",
    ], { uploaded: true });
    expect(store.writeLocalCloudMapping).toHaveBeenCalledWith({
      entity: "posSession",
      localId: "local-session-1",
      cloudId: "session-1",
      mappedAt: 10,
    });
    expect(store.writeLocalCloudMapping).toHaveBeenCalledWith({
      entity: "posTransaction",
      localId: "local-txn-1",
      cloudId: "transaction-1",
      mappedAt: 11,
    });
    expect(store.writeLocalCloudMapping).toHaveBeenCalledWith({
      entity: "registerSession",
      localId: "register-1",
      cloudId: "register-session-1",
      mappedAt: 12,
    });
    expect(store.writeLocalCloudMapping.mock.calls.length).toBeGreaterThanOrEqual(3);
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
          terminalId: storeId === "store-1" ? "terminal-cloud-1" : "terminal-cloud-2",
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
      expect(result.current).toEqual(
        expect.objectContaining({
          status: "needs_review",
        }),
      ),
    );
    expect(mocks.ingestLocalEvents).not.toHaveBeenCalled();

    act(() => {
      result.current?.onRetrySync?.();
    });

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

  it("does not manually retry review events that were never uploaded", async () => {
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
          status: "needs_review",
        }),
      ),
    );
    act(() => {
      result.current?.onRetrySync?.();
    });

    await waitFor(() => expect(store.listEvents.mock.calls.length).toBeGreaterThan(1));
    expect(mocks.ingestLocalEvents).not.toHaveBeenCalled();
    expect(store.markEventsSynced).not.toHaveBeenCalled();
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

    await waitFor(() => expect(store.readTerminalIntegrityState).toHaveBeenCalled());
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
              flags: [
                "app-session-unverified",
                "cloud-validation-uncertain",
              ],
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
              flags: [
                "app-session-unverified",
                "cloud-validation-uncertain",
              ],
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
    expect(store.markEventsSynced).toHaveBeenCalledWith(["event-offline-sale"], {
      uploaded: true,
    });
  });

  it("returns failure when local cloud mapping persistence fails", async () => {
    const store = {
      writeLocalCloudMapping: vi.fn(async () => ({
        ok: false,
        error: { code: "write_failed", message: "mapping write failed" },
      })),
    };

    const result = await writeReturnedLocalCloudMappings(
      store as never,
      [
        {
          cloudId: "session-1",
          createdAt: 10,
          localId: "local-session-1",
          localIdKind: "posSession",
        },
      ],
    );

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

  it("writes drawer authority when mapping persistence fails during runtime upload", async () => {
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
    expect(store.writeDrawerAuthorityState).toHaveBeenCalledWith(
      expect.objectContaining({
        localRegisterSessionId: "register-1",
        reason: "authority_unknown",
        status: "blocked",
        storeId: "store-1",
        terminalId: "local-terminal-1",
      }),
    );
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
      readDrawerAuthorityState: vi.fn(async (input: {
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
      JSON.stringify(mocks.reportTerminalRuntimeStatus.mock.calls[0]?.[0].status),
    ).not.toContain("proof-token-a");
    expect(
      JSON.stringify(mocks.reportTerminalRuntimeStatus.mock.calls[0]?.[0].status),
    ).not.toContain("payload-proof-token");
    expect(
      JSON.stringify(mocks.reportTerminalRuntimeStatus.mock.calls[0]?.[0].status),
    ).not.toContain("sync-secret-1");
    await waitFor(() => expect(mocks.ingestLocalEvents).toHaveBeenCalled());
    expect(store.markEventsSynced).toHaveBeenCalledWith(["event-open"], {
      uploaded: true,
    });
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
      JSON.stringify(mocks.reportTerminalRuntimeStatus.mock.calls[0]?.[0].status),
    ).not.toContain("app_account_not_pos_scoped");
    expect(JSON.stringify(result.current)).not.toContain(
      "app_account_not_pos_scoped",
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
    mocks.reportTerminalRuntimeStatus
      .mockReturnValueOnce(oldCheckIn.promise);
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
      readDrawerAuthorityState: vi.fn(async (input: { terminalId: string }) => ({
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
    expect(uploadedEvents.map((event: { sequence: number }) => event.sequence))
      .toEqual([1, 2]);
  });

  it("keeps server-conflicted events in review and settles server-rejected events locally", () => {
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
      collectServerSettledLocalEventIds([
        { localEventId: "event-checkout", status: "conflicted" },
        { localEventId: "event-open", status: "projected" },
        { localEventId: "event-held", status: "held" },
        { localEventId: "event-rejected", status: "rejected" },
      ]),
    ).toEqual(["event-open", "event-rejected"]);
    expect(
      collectServerHeldLocalEventIds([
        { localEventId: "event-held" },
        { localEventId: "event-held-later" },
      ]),
    ).toEqual(["event-held", "event-held-later"]);
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
    ).toEqual(
      ["event-clear", "event-session", "event-cart", "event-payment"],
    );
  });

  it("marks rejected runtime sale responses and embedded local events as settled", async () => {
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
      expect(store.markEventsSynced).toHaveBeenCalledWith(
        ["event-checkout", "event-session", "event-cart", "event-payment"],
        { uploaded: true },
      ),
    );
    expect(store.markEventsNeedsReview).not.toHaveBeenCalled();
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

  it("presents closeout reconciliation conflicts as needs review", () => {
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
    ).toEqual(
      expect.objectContaining({
        pendingEventCount: 0,
        status: "needs_review",
      }),
    );
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

  it("presents terminal-blocking uploaded review events from another staff profile", () => {
    expect(
      derivePosLocalRuntimeSyncStatus(
        [
          buildLocalEvent({
            localEventId: "event-other-staff-open",
            staffProfileId: "staff-2",
            sync: { status: "needs_review", uploaded: true },
            type: "register.opened",
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
