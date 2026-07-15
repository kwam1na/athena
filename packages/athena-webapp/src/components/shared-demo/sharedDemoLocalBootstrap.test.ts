import { describe, expect, it } from "vitest";

import {
  getSharedDemoTerminalName,
  getSharedDemoRegisterNumber,
  getSharedDemoRestoreEpochStorageKey,
  planSharedDemoLocalBootstrap,
  resolveSharedDemoRegisterBootstrapAction,
  resetSharedDemoFirstVisitBrowserState,
} from "./sharedDemoLocalBootstrap";

describe("planSharedDemoLocalBootstrap", () => {
  it("reuses terminal foundation when the current restore epoch is already applied", () => {
    expect(
      planSharedDemoLocalBootstrap({
        currentEpoch: 4,
        hasMatchingTerminalSeed: true,
        hasMatchingRegisterNumber: true,
        hasTerminalSeed: true,
        priorEpoch: 4,
      }),
    ).toEqual({
      bindRegisterBaseline: false,
      provisionTerminal: false,
      resetOperationalState: false,
    });
  });

  it("resets operations without reprovisioning terminal identity after an epoch change", () => {
    expect(
      planSharedDemoLocalBootstrap({
        currentEpoch: 5,
        hasMatchingTerminalSeed: true,
        hasMatchingRegisterNumber: true,
        hasTerminalSeed: true,
        priorEpoch: 4,
      }),
    ).toEqual({
      bindRegisterBaseline: true,
      provisionTerminal: false,
      resetOperationalState: true,
    });
  });

  it("provisions only when this browser has no matching terminal seed", () => {
    expect(
      planSharedDemoLocalBootstrap({
        currentEpoch: 5,
        hasMatchingTerminalSeed: false,
        hasMatchingRegisterNumber: false,
        hasTerminalSeed: false,
        priorEpoch: 4,
      }),
    ).toEqual({
      bindRegisterBaseline: true,
      provisionTerminal: true,
      resetOperationalState: true,
    });
  });

  it("clears local operations before replacing a seed from another store", () => {
    expect(
      planSharedDemoLocalBootstrap({
        currentEpoch: 5,
        hasMatchingTerminalSeed: false,
        hasMatchingRegisterNumber: false,
        hasTerminalSeed: true,
        priorEpoch: 5,
      }),
    ).toEqual({
      bindRegisterBaseline: true,
      provisionTerminal: true,
      resetOperationalState: true,
    });
  });

  it("reprovisions a matching terminal when its register number uses the legacy seed", () => {
    expect(
      planSharedDemoLocalBootstrap({
        currentEpoch: 5,
        hasMatchingRegisterNumber: false,
        hasMatchingTerminalSeed: true,
        hasTerminalSeed: true,
        priorEpoch: 5,
      }),
    ).toEqual({
      bindRegisterBaseline: true,
      provisionTerminal: true,
      resetOperationalState: true,
    });
  });
});

describe("resolveSharedDemoRegisterBootstrapAction", () => {
  it("preserves a closed drawer after first setup instead of cloning the baseline", () => {
    expect(
      resolveSharedDemoRegisterBootstrapAction({
        bindRegisterBaseline: false,
        hasUsableLocalSession: false,
      }),
    ).toBe("preserve");
  });

  it("still binds the baseline during first setup or a restore", () => {
    expect(
      resolveSharedDemoRegisterBootstrapAction({
        bindRegisterBaseline: true,
        hasUsableLocalSession: false,
      }),
    ).toBe("bind");
  });

  it("reuses the existing drawer when it is still active", () => {
    expect(
      resolveSharedDemoRegisterBootstrapAction({
        bindRegisterBaseline: false,
        hasUsableLocalSession: true,
      }),
    ).toBe("reuse");
  });
});

describe("getSharedDemoRegisterNumber", () => {
  it("creates a stable numeric register number from the browser fingerprint", () => {
    expect(getSharedDemoRegisterNumber("7d5339abcdef")).toBe("213305");
    expect(getSharedDemoRegisterNumber("7d5339abcdef")).toMatch(/^\d{6}$/);
  });
});

describe("getSharedDemoTerminalName", () => {
  it("selects a stable playful name from the browser fingerprint", () => {
    expect(getSharedDemoTerminalName("7d5339abcdef")).toBe("Barcode Bandit");
    expect(getSharedDemoTerminalName("7d5339abcdef")).toBe(
      getSharedDemoTerminalName("7d5339abcdef"),
    );
    expect(getSharedDemoTerminalName("abcdef123456")).toBe("Counter Culture");
  });
});

describe("resetSharedDemoFirstVisitBrowserState", () => {
  it("resets first-visit demo state without clearing unrelated browser storage", async () => {
    const values = new Map<string, string>([
      [getSharedDemoRestoreEpochStorageKey("store-1"), "4"],
      [getSharedDemoRestoreEpochStorageKey("store-2"), "8"],
      ["unrelated:localhost:state", "keep-me"],
      ["athena.pos.fingerprint", "remove-terminal-identity"],
    ]);
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      removeItem: (key: string) => void values.delete(key),
      setItem: (key: string, value: string) => void values.set(key, value),
    };
    let resetCount = 0;

    await resetSharedDemoFirstVisitBrowserState({
      localStore: {
        resetSharedDemoFirstVisitState: async () => {
          resetCount += 1;
          return { ok: true as const, value: null };
        },
      },
      storage,
      storeId: "store-1",
    });

    expect(resetCount).toBe(1);
    expect(values.get(getSharedDemoRestoreEpochStorageKey("store-1"))).toBeUndefined();
    expect(values.get(getSharedDemoRestoreEpochStorageKey("store-2"))).toBe("8");
    expect(values.get("unrelated:localhost:state")).toBe("keep-me");
    expect(values.get("athena.pos.fingerprint")).toBeUndefined();
  });

  it("keeps the epoch marker when the local demo reset fails", async () => {
    const key = getSharedDemoRestoreEpochStorageKey("store-1");
    const values = new Map<string, string>([[key, "4"]]);

    await expect(
      resetSharedDemoFirstVisitBrowserState({
        localStore: {
          resetSharedDemoFirstVisitState: async () => ({
            ok: false as const,
            error: { code: "storage_failed", message: "reset failed" },
          }),
        },
        storage: {
          getItem: (storageKey: string) => values.get(storageKey) ?? null,
          removeItem: (storageKey: string) => void values.delete(storageKey),
          setItem: (storageKey: string, value: string) =>
            void values.set(storageKey, value),
        },
        storeId: "store-1",
      }),
    ).rejects.toThrow("reset failed");

    expect(values.get(key)).toBe("4");
  });
});
