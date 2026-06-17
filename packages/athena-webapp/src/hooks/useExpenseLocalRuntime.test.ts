import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Id } from "~/convex/_generated/dataModel";

const runtimeMocks = vi.hoisted(() => {
  const indexedDbAdapter = { kind: "indexeddb-adapter" };
  const memoryAdapter = { kind: "memory-adapter" };
  const localStore = { kind: "local-store" };
  return {
    createExpenseLocalCommandGateway: vi.fn(() => ({ kind: "gateway" })),
    createIndexedDbPosLocalStorageAdapter: vi.fn(() => indexedDbAdapter),
    createMemoryPosLocalStorageAdapter: vi.fn(() => memoryAdapter),
    createPosLocalStore: vi.fn(() => localStore),
    indexedDbAdapter,
    localStore,
    memoryAdapter,
    usePosLocalSyncRuntimeStatus: vi.fn(() => null),
  };
});

vi.mock("@/lib/pos/infrastructure/local/expenseLocalCommandGateway", () => ({
  createExpenseLocalCommandGateway:
    runtimeMocks.createExpenseLocalCommandGateway,
}));

vi.mock("@/lib/pos/infrastructure/local/posLocalStore", () => ({
  createIndexedDbPosLocalStorageAdapter:
    runtimeMocks.createIndexedDbPosLocalStorageAdapter,
  createMemoryPosLocalStorageAdapter:
    runtimeMocks.createMemoryPosLocalStorageAdapter,
  createPosLocalStore: runtimeMocks.createPosLocalStore,
}));

vi.mock("@/lib/pos/infrastructure/local/usePosLocalSyncRuntime", () => ({
  usePosLocalSyncRuntimeStatus: runtimeMocks.usePosLocalSyncRuntimeStatus,
}));

const originalIndexedDbDescriptor = Object.getOwnPropertyDescriptor(
  globalThis,
  "indexedDB",
);

async function importRuntime() {
  vi.resetModules();
  return import("./useExpenseLocalRuntime");
}

function renderRuntime(
  useExpenseLocalRuntime: typeof import("./useExpenseLocalRuntime").useExpenseLocalRuntime,
  overrides: Partial<Parameters<typeof useExpenseLocalRuntime>[0]> = {},
) {
  return renderHook(() =>
    useExpenseLocalRuntime({
      staffProfileId: "staff-1" as Id<"staffProfile">,
      storeId: "store-1" as Id<"store">,
      terminalId: "terminal-1" as Id<"posTerminal">,
      ...overrides,
    }),
  );
}

describe("useExpenseLocalRuntime", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (originalIndexedDbDescriptor) {
      Object.defineProperty(
        globalThis,
        "indexedDB",
        originalIndexedDbDescriptor,
      );
    } else {
      Reflect.deleteProperty(globalThis, "indexedDB");
    }
  });

  it("uses the persistent IndexedDB local store when browser storage is available", async () => {
    Object.defineProperty(globalThis, "indexedDB", {
      configurable: true,
      value: {},
    });
    const { useExpenseLocalRuntime } = await importRuntime();

    renderRuntime(useExpenseLocalRuntime);

    expect(
      runtimeMocks.createIndexedDbPosLocalStorageAdapter,
    ).toHaveBeenCalled();
    expect(
      runtimeMocks.createMemoryPosLocalStorageAdapter,
    ).not.toHaveBeenCalled();
    expect(runtimeMocks.createPosLocalStore).toHaveBeenCalledWith({
      adapter: runtimeMocks.indexedDbAdapter,
    });
  });

  it("falls back to an in-memory local store when IndexedDB is unavailable", async () => {
    Object.defineProperty(globalThis, "indexedDB", {
      configurable: true,
      value: undefined,
    });
    const { useExpenseLocalRuntime } = await importRuntime();

    renderRuntime(useExpenseLocalRuntime);

    expect(runtimeMocks.createMemoryPosLocalStorageAdapter).toHaveBeenCalled();
    expect(
      runtimeMocks.createIndexedDbPosLocalStorageAdapter,
    ).not.toHaveBeenCalled();
    expect(runtimeMocks.createPosLocalStore).toHaveBeenCalledWith({
      adapter: runtimeMocks.memoryAdapter,
    });
  });

  it("can provide the local gateway without owning sync draining", async () => {
    Object.defineProperty(globalThis, "indexedDB", {
      configurable: true,
      value: {},
    });
    const { useExpenseLocalRuntime } = await importRuntime();

    renderRuntime(useExpenseLocalRuntime, { syncEnabled: false });

    expect(runtimeMocks.createExpenseLocalCommandGateway).toHaveBeenCalled();
    expect(runtimeMocks.usePosLocalSyncRuntimeStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        drainOnAppend: false,
        mode: "status-only",
        staffProfileId: null,
        storeId: undefined,
        terminalId: undefined,
      }),
    );
  });

  it("uses the POS append-triggered sync runtime when sync is enabled", async () => {
    Object.defineProperty(globalThis, "indexedDB", {
      configurable: true,
      value: {},
    });
    const { useExpenseLocalRuntime } = await importRuntime();

    renderRuntime(useExpenseLocalRuntime);

    expect(runtimeMocks.usePosLocalSyncRuntimeStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        drainOnAppend: true,
        mode: "status-only",
        onLocalEventsChanged: expect.any(Function),
        staffProfileId: "staff-1",
        storeFactory: expect.any(Function),
        storeId: "store-1",
        terminalId: "terminal-1",
      }),
    );
  });

  it("notifies every expense runtime consumer when any gateway appends an event", async () => {
    Object.defineProperty(globalThis, "indexedDB", {
      configurable: true,
      value: {},
    });
    const { useExpenseLocalRuntime } = await importRuntime();

    const firstRuntime = renderRuntime(useExpenseLocalRuntime);
    const secondRuntime = renderRuntime(useExpenseLocalRuntime);
    const gatewayCalls = runtimeMocks.createExpenseLocalCommandGateway.mock
      .calls as unknown as Array<[{ onEventAppended?: () => void }]>;
    const firstGatewayOptions = gatewayCalls[0]?.[0];

    expect(firstRuntime.result.current.eventAppendToken).toBe(0);
    expect(secondRuntime.result.current.eventAppendToken).toBe(0);
    expect(firstGatewayOptions?.onEventAppended).toBeTypeOf("function");

    act(() => {
      firstGatewayOptions?.onEventAppended?.();
    });

    expect(firstRuntime.result.current.eventAppendToken).toBe(1);
    expect(secondRuntime.result.current.eventAppendToken).toBe(1);
  });
});
