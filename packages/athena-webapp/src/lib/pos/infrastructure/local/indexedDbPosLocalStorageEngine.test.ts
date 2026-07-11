import { beforeEach, describe, expect, it, vi } from "vitest";

const engineMocks = vi.hoisted(() => ({
  clear: vi.fn(),
  createAdapter: vi.fn(() => ({})),
  createStore: vi.fn(() => ({})),
}));

vi.mock("./posLocalStore", () => ({
  clearIndexedDbPosLocalStore: engineMocks.clear,
  createIndexedDbPosLocalStorageAdapter: engineMocks.createAdapter,
  createPosLocalStore: engineMocks.createStore,
}));

vi.mock("./posLocalStorageHealth", () => ({
  requestPosLocalPersistentStorage: vi.fn(async () => "granted"),
}));

describe("IndexedDB POS engine maintenance lifecycle", () => {
  beforeEach(() => {
    vi.resetModules();
    engineMocks.clear.mockReset();
  });

  it("keeps failed exclusive maintenance blocked until a retry recovers", async () => {
    const exclusiveLocks: Array<unknown | null> = [{}, {}];
    Object.defineProperty(globalThis.navigator, "locks", {
      configurable: true,
      value: {
        request: vi.fn(
          async (
            _name: string,
            options: { mode: "exclusive" | "shared" },
            callback: (lock: unknown | null) => Promise<unknown>,
          ) =>
            callback(
              options.mode === "exclusive"
                ? (exclusiveLocks.shift() ?? null)
                : {},
            ),
        ),
      },
    });
    engineMocks.clear
      .mockResolvedValueOnce({
        ok: false,
        error: {
          code: "maintenance",
          message: "Protected POS local records remain.",
        },
      })
      .mockResolvedValueOnce({ ok: true, value: null });
    const engine = await import("./indexedDbPosLocalStorageEngine");

    await expect(engine.clearCurrentPosLocalStorageEngine()).resolves.toEqual({
      ok: false,
      error: {
        code: "maintenance",
        message: "Protected POS local records remain.",
      },
    });
    expect(engine.getCurrentPosLocalStorageEngineLifecycleHealth()).toEqual({
      maintenance: "blocked",
      migration: "unknown",
    });

    const operation = vi.fn(async () => ({ ok: true }));
    await expect(
      engine.runCurrentPosLocalStorageEngineOperation(operation),
    ).resolves.toEqual({ ok: true });
    expect(operation).toHaveBeenCalledOnce();

    await expect(engine.clearCurrentPosLocalStorageEngine()).resolves.toEqual({
      ok: true,
      value: null,
    });
    expect(engine.getCurrentPosLocalStorageEngineLifecycleHealth()).toEqual({
      maintenance: "idle",
      migration: "unknown",
    });
  });
});
