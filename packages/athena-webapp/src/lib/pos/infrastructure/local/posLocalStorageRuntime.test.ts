import { describe, expect, it, vi } from "vitest";
import type { PosLocalStoreResult } from "@/lib/pos/application/posLocalStoreTypes";

const defaultStorageMocks = vi.hoisted(() => {
  const store = {
    initializeStorage: vi.fn(async () => ({
      ok: true,
      value: { logicalRecordVersion: 1 },
    })),
    listLocalCloudMappings: vi.fn(async () => ({ ok: true, value: [] })),
    writeProvisionedTerminalSeed: vi.fn(
      async (seed: unknown): Promise<PosLocalStoreResult<unknown>> => ({
        ok: true,
        value: seed,
      }),
    ),
  };
  return {
    adapter: {},
    createIndexedDbPosLocalStorageAdapter: vi.fn(() => ({})),
    createPosLocalStore: vi.fn(() => store),
    store,
  };
});

vi.mock("./posLocalStore", () => ({
  createIndexedDbPosLocalStorageAdapter:
    defaultStorageMocks.createIndexedDbPosLocalStorageAdapter,
  createPosLocalStore: defaultStorageMocks.createPosLocalStore,
}));

import {
  createPosLocalStoreRuntimePort,
  createPosLocalStorageRuntime,
  getDefaultPosLocalStorageLifecycleHealth,
  getDefaultPosLocalStorageRuntime,
  getDefaultPosLocalStore,
} from "./posLocalStorageRuntime";
import type { PosLocalStorePort } from "@/lib/pos/application/posLocalStorePort";

describe("createPosLocalStorageRuntime", () => {
  it("keeps the engine store behind one runtime-gated semantic facade", async () => {
    const port = getDefaultPosLocalStore();
    const result = await port.listLocalCloudMappings();
    const runtimeStore = getDefaultPosLocalStorageRuntime().getSnapshot().store;

    expect(getDefaultPosLocalStore()).toBe(port);
    expect(runtimeStore).toBe(defaultStorageMocks.store);
    expect(port).not.toBe(runtimeStore);
    await expect(Promise.resolve(port)).resolves.toBe(port);
    expect(result).toEqual({ ok: true, value: [] });
    expect(getDefaultPosLocalStorageLifecycleHealth()).toMatchObject({
      maintenance: "idle",
      migration: "idle",
    });
    expect(defaultStorageMocks.createPosLocalStore).toHaveBeenCalledTimes(1);
    expect(defaultStorageMocks.store.initializeStorage).toHaveBeenCalledTimes(
      1,
    );
    expect(
      defaultStorageMocks.store.listLocalCloudMappings,
    ).toHaveBeenCalledTimes(1);
  });

  it("does not dispatch a semantic operation until the selected engine is ready", async () => {
    let resolveOpen!: (store: PosLocalStorePort) => void;
    const listLocalCloudMappings = vi.fn(async () => ({
      ok: true as const,
      value: [],
    }));
    const runtime = createPosLocalStorageRuntime<PosLocalStorePort>({
      engine: {
        durability: "durable",
        id: "sqlite-worker-fixture",
        open: () =>
          new Promise((resolve) => {
            resolveOpen = resolve;
          }),
      },
    });
    const port = createPosLocalStoreRuntimePort(runtime);

    const result = port.listLocalCloudMappings();
    expect(listLocalCloudMappings).not.toHaveBeenCalled();

    resolveOpen({ listLocalCloudMappings } as unknown as PosLocalStorePort);
    await expect(result).resolves.toEqual({ ok: true, value: [] });
    expect(listLocalCloudMappings).toHaveBeenCalledTimes(1);
  });

  it("publishes durable commit failures centrally and clears them after recovery", async () => {
    const port = getDefaultPosLocalStore();
    defaultStorageMocks.store.writeProvisionedTerminalSeed
      .mockResolvedValueOnce({
        ok: false,
        error: {
          code: "quota_exceeded",
          message: "POS local storage capacity is exhausted.",
        },
      })
      .mockResolvedValueOnce({ ok: true, value: { terminalId: "terminal-1" } });

    await port.writeProvisionedTerminalSeed({
      terminalId: "terminal-1",
    } as never);
    expect(getDefaultPosLocalStorageLifecycleHealth()).toMatchObject({
      engineReadiness: "unavailable",
      lastDurableFailure: { code: "quota_exceeded" },
    });

    await port.writeProvisionedTerminalSeed({
      terminalId: "terminal-1",
    } as never);
    expect(getDefaultPosLocalStorageLifecycleHealth()).toMatchObject({
      engineReadiness: "ready",
    });
    expect(
      getDefaultPosLocalStorageLifecycleHealth().lastDurableFailure,
    ).toBeUndefined();
  });

  it("shares one asynchronous initialization and publishes one ready generation", async () => {
    const store = { name: "durable-store" };
    const open = vi.fn(async () => store);
    const runtime = createPosLocalStorageRuntime({
      engine: { durability: "durable", id: "fixture", open },
    });

    const first = runtime.start();
    const second = runtime.start();

    await expect(Promise.all([first, second])).resolves.toEqual([store, store]);
    expect(open).toHaveBeenCalledTimes(1);
    expect(runtime.getSnapshot()).toMatchObject({
      generation: 1,
      status: "ready",
      store,
    });
  });

  it("does not expose a half-open store and retries with a new generation", async () => {
    const store = { name: "recovered-store" };
    const open = vi
      .fn<() => Promise<typeof store>>()
      .mockRejectedValueOnce(new Error("private engine detail"))
      .mockResolvedValueOnce(store);
    const runtime = createPosLocalStorageRuntime({
      engine: { durability: "durable", id: "fixture", open },
    });

    await expect(runtime.start()).rejects.toMatchObject({
      code: "unavailable",
      message: "POS local storage is unavailable.",
    });
    expect(runtime.getSnapshot()).toEqual({
      error: {
        code: "unavailable",
        message: "POS local storage is unavailable.",
      },
      generation: 1,
      status: "failed",
      store: null,
    });

    await expect(runtime.retry()).resolves.toBe(store);
    expect(runtime.getSnapshot()).toMatchObject({
      generation: 2,
      status: "ready",
      store,
    });
  });

  it("rejects ephemeral engines in production composition", async () => {
    const runtime = createPosLocalStorageRuntime({
      engine: {
        durability: "ephemeral",
        id: "memory",
        open: async () => ({ name: "memory" }),
      },
    });

    await expect(runtime.start()).rejects.toMatchObject({
      code: "ephemeral_engine_rejected",
    });
    expect(runtime.getSnapshot()).toMatchObject({
      status: "failed",
      store: null,
    });
  });

  it("accepts an injected durable engine without IndexedDB", async () => {
    const store = { name: "sqlite-worker" };
    const runtime = createPosLocalStorageRuntime({
      engine: {
        durability: "durable",
        id: "sqlite-worker",
        open: async () => store,
      },
    });

    await expect(runtime.start()).resolves.toBe(store);
    expect(runtime.getSnapshot().status).toBe("ready");
  });

  it("disposes a late store instead of publishing it", async () => {
    let resolveOpen!: (store: { name: string }) => void;
    const opened = new Promise<{ name: string }>((resolve) => {
      resolveOpen = resolve;
    });
    const close = vi.fn(async () => undefined);
    const runtime = createPosLocalStorageRuntime({
      engine: { close, durability: "durable", id: "slow", open: () => opened },
    });

    const start = runtime.start();
    await runtime.dispose();
    resolveOpen({ name: "late-store" });

    await expect(start).rejects.toMatchObject({
      code: "initialization_cancelled",
    });
    expect(close).toHaveBeenCalledWith({ name: "late-store" });
    expect(runtime.getSnapshot()).toEqual({
      generation: 2,
      status: "disposed",
      store: null,
    });
  });

  it("closes a selected store and cannot restart after disposal", async () => {
    const store = { name: "selected-store" };
    const close = vi.fn(async () => undefined);
    const runtime = createPosLocalStorageRuntime({
      engine: {
        close,
        durability: "durable",
        id: "fixture",
        open: async () => store,
      },
    });

    await runtime.start();
    await runtime.dispose();

    expect(close).toHaveBeenCalledWith(store);
    await expect(runtime.start()).rejects.toMatchObject({
      code: "initialization_cancelled",
    });
  });
});
