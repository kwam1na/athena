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
    getDefaultPosLocalStore: vi.fn(() => localStore),
    indexedDbAdapter,
    localStore,
    memoryAdapter,
    usePosLocalSyncRuntimeStatus: vi.fn<
      (input?: {
        eventAppendToken?: number;
        onLocalEventsChanged?: () => void;
      }) => null
    >(() => null),
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

vi.mock("@/lib/pos/infrastructure/local/posLocalStorageRuntime", () => ({
  getDefaultPosLocalStore: runtimeMocks.getDefaultPosLocalStore,
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

    expect(runtimeMocks.getDefaultPosLocalStore).toHaveBeenCalled();
    expect(
      runtimeMocks.createMemoryPosLocalStorageAdapter,
    ).not.toHaveBeenCalled();
    expect(runtimeMocks.createPosLocalStore).not.toHaveBeenCalled();
  });

  it("never selects an in-memory store when IndexedDB is unavailable", async () => {
    Object.defineProperty(globalThis, "indexedDB", {
      configurable: true,
      value: undefined,
    });
    const { useExpenseLocalRuntime } = await importRuntime();

    renderRuntime(useExpenseLocalRuntime);

    expect(runtimeMocks.getDefaultPosLocalStore).toHaveBeenCalled();
    expect(
      runtimeMocks.createMemoryPosLocalStorageAdapter,
    ).not.toHaveBeenCalled();
    expect(runtimeMocks.createPosLocalStore).not.toHaveBeenCalled();
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

  it("does not re-arm the sync trigger when the runtime reports settled events", async () => {
    Object.defineProperty(globalThis, "indexedDB", {
      configurable: true,
      value: {},
    });

    // Reproduce a drain that settles events on every trigger: whenever the sync runtime
    // receives a changed append token, it calls onLocalEventsChanged (as the real drain
    // does). The trigger token fed to the runtime must still stabilise — if a settle
    // re-armed it, this would loop into "Maximum update depth exceeded".
    const seenTriggerTokens: number[] = [];
    runtimeMocks.usePosLocalSyncRuntimeStatus.mockImplementation((input) => {
      const token = input?.eventAppendToken ?? 0;
      const isNewToken = seenTriggerTokens.at(-1) !== token;
      seenTriggerTokens.push(token);
      if (isNewToken && seenTriggerTokens.length < 200) {
        input?.onLocalEventsChanged?.();
      }
      return null;
    });

    const { useExpenseLocalRuntime } = await importRuntime();

    const { result } = renderRuntime(useExpenseLocalRuntime);
    await act(async () => {
      await Promise.resolve();
    });

    // The append-only trigger token settled to 0 (no real appends), so the runtime saw a
    // bounded number of renders rather than a runaway loop.
    expect(seenTriggerTokens.length).toBeLessThan(50);
    expect(seenTriggerTokens.at(-1)).toBe(0);
    // The exposed signal still advanced from the settle refresh.
    expect(result.current.eventAppendToken).toBeGreaterThan(0);
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
