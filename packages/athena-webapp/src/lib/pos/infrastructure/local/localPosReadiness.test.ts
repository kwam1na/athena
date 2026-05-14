import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { PosLocalEntryContext } from "./localPosEntryContext";
import {
  evaluateLocalPosReadiness,
  localReadinessRecordFromSnapshots,
  refreshLocalPosReadinessFromSnapshots,
  useLocalPosReadiness,
} from "./localPosReadiness";
import type { PosLocalStoreDayReadiness } from "./posLocalStore";
import type { PosLocalRegisterReadModel } from "./registerReadModel";

const posLocalStoreMocks = vi.hoisted(() => {
  const state = { currentStore: null as unknown };

  return {
    createIndexedDbPosLocalStorageAdapter: vi.fn(() => ({})),
    createPosLocalStore: vi.fn(() => state.currentStore),
    state,
  };
});

const localRegisterReaderMocks = vi.hoisted(() => ({
  readProjectedLocalRegisterModel: vi.fn(),
}));

vi.mock("./posLocalStore", async (importActual) => {
  const actual =
    await importActual<typeof import("./posLocalStore")>();

  return {
    ...actual,
    createIndexedDbPosLocalStorageAdapter:
      posLocalStoreMocks.createIndexedDbPosLocalStorageAdapter,
    createPosLocalStore: posLocalStoreMocks.createPosLocalStore,
  };
});

vi.mock("./localRegisterReader", async (importActual) => {
  const actual =
    await importActual<typeof import("./localRegisterReader")>();

  return {
    ...actual,
    readProjectedLocalRegisterModel:
      localRegisterReaderMocks.readProjectedLocalRegisterModel,
  };
});

const entryContext: PosLocalEntryContext = {
  status: "ready",
  orgUrlSlug: "acme",
  storeUrlSlug: "downtown",
  storeId: "store-1",
  terminalSeed: null,
  source: "live",
};

const registerReadModel = {
  canSell: false,
  closeoutState: null,
} as PosLocalRegisterReadModel;

const originalIndexedDb = globalThis.indexedDB;

afterEach(() => {
  posLocalStoreMocks.createIndexedDbPosLocalStorageAdapter.mockClear();
  posLocalStoreMocks.createPosLocalStore.mockClear();
  posLocalStoreMocks.state.currentStore = null;
  localRegisterReaderMocks.readProjectedLocalRegisterModel.mockReset();
  Object.defineProperty(globalThis, "indexedDB", {
    configurable: true,
    value: originalIndexedDb,
  });
});

describe("localPosReadiness", () => {
  it("allows POS from a started local store day when live snapshots are unavailable", () => {
    expect(
      evaluateLocalPosReadiness({
        entryContext,
        operatingDate: "2026-05-14",
        localReadiness: {
          storeId: "store-1",
          operatingDate: "2026-05-14",
          status: "started",
          source: "daily_opening",
          updatedAt: 1_000,
        },
        registerReadModel,
      }),
    ).toEqual({
      status: "ready",
      source: "local_readiness",
      storeDayStatus: "started",
    });
  });

  it("blocks POS when the local store day is completed and not reopened", () => {
    expect(
      evaluateLocalPosReadiness({
        entryContext,
        operatingDate: "2026-05-14",
        localReadiness: {
          storeId: "store-1",
          operatingDate: "2026-05-14",
          status: "closed",
          source: "daily_close",
          updatedAt: 1_000,
        },
        registerReadModel,
      }),
    ).toMatchObject({
      status: "blocked",
      reason: "closed",
    });
  });

  it("blocks POS after local drawer closeout until a reopen is recorded", () => {
    expect(
      evaluateLocalPosReadiness({
        entryContext,
        operatingDate: "2026-05-14",
        localReadiness: {
          storeId: "store-1",
          operatingDate: "2026-05-14",
          status: "started",
          source: "daily_opening",
          updatedAt: 1_000,
        },
        registerReadModel: {
          canSell: false,
          closeoutState: {
            status: "closed_locally",
            localRegisterSessionId: "local-register-1",
            updatedAt: 1_100,
          },
        } as PosLocalRegisterReadModel,
      }),
    ).toMatchObject({
      status: "blocked",
      reason: "local_closeout",
    });
  });

  it("treats unknown store-day readiness as blocked unless local register state proves selling is open", () => {
    expect(
      evaluateLocalPosReadiness({
        entryContext,
        operatingDate: "2026-05-14",
        registerReadModel,
      }),
    ).toMatchObject({
      status: "blocked",
      reason: "unknown",
    });

    expect(
      evaluateLocalPosReadiness({
        entryContext,
        operatingDate: "2026-05-14",
        registerReadModel: {
          canSell: true,
          closeoutState: { status: "open" },
        } as PosLocalRegisterReadModel,
      }),
    ).toEqual({
      status: "ready",
      source: "local_register",
      storeDayStatus: "started",
    });
  });

  it("uses live completed close snapshots as the blocking authority", () => {
    expect(
      evaluateLocalPosReadiness({
        closeSnapshot: { status: "completed" },
        entryContext,
        operatingDate: "2026-05-14",
        localReadiness: {
          storeId: "store-1",
          operatingDate: "2026-05-14",
          status: "started",
          source: "daily_opening",
          updatedAt: 1_000,
        },
        openingSnapshot: { status: "started" },
        registerReadModel: {
          canSell: true,
          closeoutState: { status: "open" },
        } as PosLocalRegisterReadModel,
      }),
    ).toMatchObject({
      status: "blocked",
      reason: "closed",
    });
  });

  it("allows POS from resolved live opening and non-blocking close snapshots", () => {
    expect(
      evaluateLocalPosReadiness({
        closeSnapshot: { status: "ready" },
        entryContext,
        openingSnapshot: { status: "started" },
        operatingDate: "2026-05-14",
        registerReadModel,
      }),
    ).toEqual({
      status: "ready",
      source: "live",
      storeDayStatus: "started",
    });
  });

  it("treats reopened completed close snapshots as live reopened readiness", () => {
    expect(
      evaluateLocalPosReadiness({
        closeSnapshot: {
          existingClose: { lifecycleStatus: "reopened" },
          status: "completed",
        },
        entryContext,
        openingSnapshot: { status: "started" },
        operatingDate: "2026-05-14",
        registerReadModel,
      }),
    ).toEqual({
      status: "ready",
      source: "live",
      storeDayStatus: "reopened",
    });
  });

  it("does not allow POS from a partial live opening snapshot until close posture resolves", () => {
    expect(
      evaluateLocalPosReadiness({
        entryContext,
        operatingDate: "2026-05-14",
        localReadiness: {
          storeId: "store-1",
          operatingDate: "2026-05-14",
          status: "started",
          source: "daily_opening",
          updatedAt: 1_000,
        },
        openingSnapshot: { status: "started" },
        registerReadModel: {
          canSell: true,
          closeoutState: { status: "open" },
        } as PosLocalRegisterReadModel,
      }),
    ).toEqual({ status: "loading" });
  });

  it("does not persist started local readiness before the close snapshot resolves", async () => {
    const writes: unknown[] = [];

    await expect(
      refreshLocalPosReadinessFromSnapshots({
        clock: () => 2_050,
        entryContext,
        openingSnapshot: { status: "started" },
        operatingDate: "2026-05-14",
        store: {
          writeStoreDayReadiness: async (readiness) => {
            writes.push(readiness);
            return { ok: true, value: readiness };
          },
        },
      }),
    ).resolves.toEqual({
      ok: true,
      value: null,
    });

    expect(writes).toEqual([]);
  });

  it("keeps a local closed-day block while waiting for the live close snapshot", () => {
    expect(
      evaluateLocalPosReadiness({
        entryContext,
        operatingDate: "2026-05-14",
        localReadiness: {
          storeId: "store-1",
          operatingDate: "2026-05-14",
          status: "closed",
          source: "daily_close",
          updatedAt: 1_000,
        },
        openingSnapshot: { status: "started" },
        registerReadModel: {
          canSell: true,
          closeoutState: { status: "open" },
        } as PosLocalRegisterReadModel,
      }),
    ).toMatchObject({
      status: "blocked",
      reason: "closed",
    });
  });

  it("ignores local readiness records from another store day", () => {
    expect(
      evaluateLocalPosReadiness({
        entryContext,
        localReadiness: {
          storeId: "store-2",
          operatingDate: "2026-05-14",
          status: "started",
          source: "daily_opening",
          updatedAt: 1_000,
        },
        operatingDate: "2026-05-14",
        registerReadModel,
      }),
    ).toMatchObject({
      status: "blocked",
      reason: "unknown",
    });

    expect(
      evaluateLocalPosReadiness({
        entryContext,
        localReadiness: {
          storeId: "store-1",
          operatingDate: "2026-05-13",
          status: "started",
          source: "daily_opening",
          updatedAt: 1_000,
        },
        operatingDate: "2026-05-14",
        registerReadModel,
      }),
    ).toMatchObject({
      status: "blocked",
      reason: "unknown",
    });
  });

  it("waits for local register state before returning live-ready readiness", async () => {
    Object.defineProperty(globalThis, "indexedDB", {
      configurable: true,
      value: {},
    });

    let resolveRegisterRead:
      | ((result: { ok: true; value: PosLocalRegisterReadModel }) => void)
      | null = null;
    const closedLocalRegisterReadModel = {
      canSell: false,
      closeoutState: {
        status: "closed_locally",
        localRegisterSessionId: "local-register-1",
        updatedAt: 1_100,
      },
    } as PosLocalRegisterReadModel;
    const registerRead = new Promise<{ ok: true; value: PosLocalRegisterReadModel }>(
      (resolve) => {
        resolveRegisterRead = resolve;
      },
    );
    localRegisterReaderMocks.readProjectedLocalRegisterModel
      .mockReturnValueOnce(registerRead)
      .mockResolvedValue({ ok: true, value: closedLocalRegisterReadModel });
    posLocalStoreMocks.state.currentStore = {
      readStoreDayReadiness: vi.fn().mockResolvedValue({
        ok: true,
        value: null,
      }),
      writeStoreDayReadiness: vi.fn().mockResolvedValue({
        ok: true,
        value: {
          storeId: "store-1",
          operatingDate: "2026-05-14",
          status: "started",
          source: "daily_opening",
          updatedAt: 2_000,
        },
      }),
    };

    const { result } = renderHook(() =>
      useLocalPosReadiness({
        closeSnapshot: { status: "ready" },
        entryContext,
        openingSnapshot: { status: "started" },
        operatingDate: "2026-05-14",
      }),
    );

    expect(result.current).toEqual({ status: "loading" });

    await act(async () => {
      resolveRegisterRead?.({
        ok: true,
        value: closedLocalRegisterReadModel,
      });
      await registerRead;
    });

    await waitFor(() => {
      expect(result.current).toMatchObject({
        status: "blocked",
        reason: "local_closeout",
      });
    });
  });

  it("rereads persisted live readiness when snapshots disappear during the same mount", async () => {
    Object.defineProperty(globalThis, "indexedDB", {
      configurable: true,
      value: {},
    });

    let storedReadiness: PosLocalStoreDayReadiness | null = null;
    const store = {
      readStoreDayReadiness: vi.fn().mockImplementation(async () => ({
        ok: true,
        value: storedReadiness,
      })),
      writeStoreDayReadiness: vi.fn().mockImplementation(async (readiness) => {
        storedReadiness = readiness;
        return { ok: true, value: readiness };
      }),
    };
    posLocalStoreMocks.state.currentStore = store;
    localRegisterReaderMocks.readProjectedLocalRegisterModel.mockResolvedValue({
      ok: true,
      value: registerReadModel,
    });

    type HookProps = {
      closeSnapshot?: { status: "ready" };
      openingSnapshot?: { status: "started" };
    };

    const { result, rerender } = renderHook<
      ReturnType<typeof useLocalPosReadiness>,
      HookProps
    >(
      ({ closeSnapshot, openingSnapshot }: HookProps) =>
        useLocalPosReadiness({
          closeSnapshot,
          entryContext,
          openingSnapshot,
          operatingDate: "2026-05-14",
        }),
      {
        initialProps: {
          closeSnapshot: { status: "ready" } as const,
          openingSnapshot: { status: "started" } as const,
        } satisfies HookProps,
      },
    );

    await waitFor(() => {
      expect(result.current).toMatchObject({
        status: "ready",
        source: "live",
      });
    });
    await waitFor(() => {
      expect(store.writeStoreDayReadiness).toHaveBeenCalled();
      expect(store.readStoreDayReadiness).toHaveBeenCalledTimes(2);
    });

    rerender({});

    await waitFor(() => {
      expect(result.current).toEqual({
        status: "ready",
        source: "local_readiness",
        storeDayStatus: "started",
      });
    });
  });


  it("converts live daily-operation snapshots into local store-day readiness records", () => {
    expect(
      localReadinessRecordFromSnapshots({
        clock: () => 2_000,
        closeSnapshot: {
          existingClose: { lifecycleStatus: "reopened" },
          status: "completed",
        },
        openingSnapshot: { status: "started" },
        operatingDate: "2026-05-14",
        storeId: "store-1",
      }),
    ).toEqual({
      storeId: "store-1",
      operatingDate: "2026-05-14",
      status: "reopened",
      source: "daily_close",
      updatedAt: 2_000,
      closeLifecycleStatus: "reopened",
    });
  });

  it("persists a live completed close snapshot so later offline readiness blocks sales", async () => {
    const writes: unknown[] = [];

    await expect(
      refreshLocalPosReadinessFromSnapshots({
        clock: () => 2_100,
        closeSnapshot: { status: "completed" },
        entryContext,
        openingSnapshot: { status: "started" },
        operatingDate: "2026-05-14",
        store: {
          writeStoreDayReadiness: async (readiness) => {
            writes.push(readiness);
            return { ok: true, value: readiness };
          },
        },
      }),
    ).resolves.toEqual({
      ok: true,
      value: {
        storeId: "store-1",
        operatingDate: "2026-05-14",
        status: "closed",
        source: "daily_close",
        updatedAt: 2_100,
      },
    });

    expect(writes).toEqual([
      {
        storeId: "store-1",
        operatingDate: "2026-05-14",
        status: "closed",
        source: "daily_close",
        updatedAt: 2_100,
      },
    ]);
    expect(
      evaluateLocalPosReadiness({
        entryContext,
        operatingDate: "2026-05-14",
        localReadiness: writes[0] as never,
        registerReadModel: {
          canSell: true,
          closeoutState: { status: "open" },
        } as PosLocalRegisterReadModel,
      }),
    ).toMatchObject({
      status: "blocked",
      reason: "closed",
    });
  });
});
