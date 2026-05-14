import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ingestLocalEvents: vi.fn(),
}));

vi.mock("convex/react", () => ({
  useMutation: () => mocks.ingestLocalEvents,
}));

vi.mock("~/convex/_generated/api", () => ({
  api: {
    pos: { public: { sync: { ingestLocalEvents: "ingestLocalEvents" } } },
  },
}));

import {
  assertPosLocalStoreOk,
  collectServerHeldLocalEventIds,
  collectServerReviewLocalEventIds,
  collectServerSyncedLocalEventIds,
  derivePosLocalRuntimeSyncStatus,
  usePosLocalSyncRuntimeStatus,
} from "./usePosLocalSyncRuntime";
import type { PosLocalEventRecord } from "./posLocalStore";

describe("usePosLocalSyncRuntimeStatus", () => {
  beforeEach(() => {
    vi.resetAllMocks();
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
        onRetrySync: retry,
        storeFactory,
        storeId: "store-1",
        terminalId: "terminal-cloud-1",
      }),
    );

    await waitFor(() => {
      expect(result.current).toEqual(
        expect.objectContaining({
          pendingEventCount: 3,
          status: "pending",
        }),
      );
    });

    act(() => {
      result.current?.onRetrySync?.();
    });

    expect(retry).toHaveBeenCalled();
    await waitFor(() => expect(store.listEvents).toHaveBeenCalledTimes(2));
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
    ], { uploaded: true });
  });

  it("throws local store write failures before the scheduler can clear sync state", () => {
    expect(() =>
      assertPosLocalStoreOk({
        ok: false,
        error: { code: "write_failed", message: "write failed" },
      }),
    ).toThrow("write failed");
  });

  it("marks server-conflicted accepted events for local review instead of sync retry", () => {
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
    ).toEqual(["event-checkout", "event-rejected"]);
    expect(
      collectServerHeldLocalEventIds([
        { localEventId: "event-held" },
        { localEventId: "event-held-later" },
      ]),
    ).toEqual(["event-held", "event-held-later"]);
  });

  it("marks rejected runtime sale responses and embedded local events for review", async () => {
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
        ["event-checkout", "event-session", "event-cart"],
        "Cloud sync needs review before this local event can finish.",
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

  it("returns null when the local store cannot read events", async () => {
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
    expect(result.current).toBeNull();
  });
});

function buildLocalEvent(
  overrides: Partial<PosLocalEventRecord> = {},
): PosLocalEventRecord {
  return {
    createdAt: 1,
    localEventId: "event-1",
    localRegisterSessionId: "register-1",
    payload: {},
    schemaVersion: 1,
    sequence: 1,
    staffProfileId: "staff-1",
    staffProofToken: "proof-token-1",
    storeId: "store-1",
    sync: { status: "pending" },
    terminalId: "local-terminal-1",
    type: "register.opened",
    ...overrides,
  };
}
