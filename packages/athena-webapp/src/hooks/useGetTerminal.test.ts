import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useGetTerminal } from "./useGetTerminal";

const mockUseConvexTerminalByFingerprint = vi.fn();
const mockReadStoredTerminalFingerprintHash = vi.fn();
const mockReadProvisionedTerminalSeed = vi.fn();

vi.mock("@/lib/pos/infrastructure/convex/registerGateway", () => ({
  useConvexTerminalByFingerprint: (...args: unknown[]) =>
    mockUseConvexTerminalByFingerprint(...args),
}));

vi.mock("@/lib/pos/infrastructure/terminal/fingerprint", () => ({
  readStoredTerminalFingerprintHash: () =>
    mockReadStoredTerminalFingerprintHash(),
}));

vi.mock("@/lib/pos/infrastructure/local/posLocalStore", () => ({
  createIndexedDbPosLocalStorageAdapter: vi.fn(() => ({})),
  createPosLocalStore: vi.fn(() => ({
    readProvisionedTerminalSeed: mockReadProvisionedTerminalSeed,
  })),
}));

vi.mock("./useGetActiveStore", () => ({
  default: () => ({
    activeStore: { _id: "store-1" },
  }),
}));

describe("useGetTerminal", () => {
  beforeEach(() => {
    mockUseConvexTerminalByFingerprint.mockReset();
    mockUseConvexTerminalByFingerprint.mockReturnValue(undefined);
    mockReadStoredTerminalFingerprintHash.mockReset();
    mockReadStoredTerminalFingerprintHash.mockReturnValue("fingerprint-1");
    mockReadProvisionedTerminalSeed.mockReset();
    mockReadProvisionedTerminalSeed.mockResolvedValue({
      ok: true,
      value: {
        terminalId: "fingerprint-1",
        cloudTerminalId: "terminal-1",
        syncSecretHash: "secret",
        storeId: "store-1",
        registerNumber: "1",
        displayName: "Front Counter",
        provisionedAt: 1_000,
        schemaVersion: 1,
      },
    });
    (globalThis as typeof globalThis & { indexedDB?: IDBFactory }).indexedDB =
      {} as IDBFactory;
  });

  it("falls back to the provisioned local terminal seed while Convex is unavailable", async () => {
    const { result } = renderHook(() => useGetTerminal());

    await waitFor(() =>
      expect(result.current).toEqual({
        _id: "terminal-1",
        cloudTerminalId: "terminal-1",
        displayName: "Front Counter",
        localTerminalId: "fingerprint-1",
        registerNumber: "1",
        status: "local",
      }),
    );
  });

  it("prefers the Convex terminal when it is available", () => {
    mockUseConvexTerminalByFingerprint.mockReturnValue({
      _id: "terminal-cloud",
      displayName: "Cloud terminal",
      registerNumber: "2",
      status: "active",
    });

    const { result } = renderHook(() => useGetTerminal());

    expect(result.current).toEqual({
      _id: "terminal-cloud",
      displayName: "Cloud terminal",
      registerNumber: "2",
      status: "active",
    });
  });

  it("rejects a provisioned local terminal seed for another store", async () => {
    mockReadProvisionedTerminalSeed.mockResolvedValue({
      ok: true,
      value: {
        terminalId: "fingerprint-1",
        cloudTerminalId: "terminal-1",
        syncSecretHash: "secret",
        storeId: "store-other",
        registerNumber: "1",
        displayName: "Front Counter",
        provisionedAt: 1_000,
        schemaVersion: 1,
      },
    });

    const { result } = renderHook(() => useGetTerminal());

    await waitFor(() => expect(mockReadProvisionedTerminalSeed).toHaveBeenCalled());
    expect(result.current).toBeNull();
  });

  it("rejects a provisioned local terminal seed for another fingerprint", async () => {
    mockReadProvisionedTerminalSeed.mockResolvedValue({
      ok: true,
      value: {
        terminalId: "fingerprint-other",
        cloudTerminalId: "terminal-1",
        syncSecretHash: "secret",
        storeId: "store-1",
        registerNumber: "1",
        displayName: "Front Counter",
        provisionedAt: 1_000,
        schemaVersion: 1,
      },
    });

    const { result } = renderHook(() => useGetTerminal());

    await waitFor(() => expect(mockReadProvisionedTerminalSeed).toHaveBeenCalled());
    expect(result.current).toBeNull();
  });
});
