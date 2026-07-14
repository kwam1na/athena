import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useGetTerminal } from "./useGetTerminal";

const mockUseConvexTerminalByFingerprint = vi.fn();
const mockReadStoredTerminalFingerprintHash = vi.fn();
const mockReadProvisionedTerminalSeed = vi.fn();
const mockUseQuery = vi.fn();
let mockActiveStore: { _id: string } | null = { _id: "store-1" };

vi.mock("@/lib/pos/infrastructure/convex/registerGateway", () => ({
  useConvexTerminalByFingerprint: (...args: unknown[]) =>
    mockUseConvexTerminalByFingerprint(...args),
}));
vi.mock("convex/react", () => ({
  useQuery: (...args: unknown[]) => mockUseQuery(...args),
}));
vi.mock("~/convex/_generated/api", () => ({
  api: {
    sharedDemo: { public: { getRegisterBootstrap: "getRegisterBootstrap" } },
  },
}));

vi.mock("@/lib/pos/infrastructure/terminal/fingerprint", () => ({
  readStoredTerminalFingerprintHash: () =>
    mockReadStoredTerminalFingerprintHash(),
}));

vi.mock("@/lib/pos/infrastructure/local/posLocalStorageRuntime", () => ({
  getDefaultPosLocalStore: vi.fn(() => ({
    readProvisionedTerminalSeed: mockReadProvisionedTerminalSeed,
  })),
}));

vi.mock("./useGetActiveStore", () => ({
  default: () => ({
    activeStore: mockActiveStore,
  }),
}));

describe("useGetTerminal", () => {
  beforeEach(() => {
    mockUseConvexTerminalByFingerprint.mockReset();
    mockUseConvexTerminalByFingerprint.mockReturnValue(undefined);
    mockUseQuery.mockReset();
    mockUseQuery.mockReturnValue(null);
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
    mockActiveStore = { _id: "store-1" };
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

  it("prefers a provisioned browser terminal over the shared demo fallback", () => {
    mockUseQuery.mockReturnValue({
      kind: "shared_demo",
      storeId: "store-1",
      staff: {
        activeRoles: ["cashier"],
        displayName: "Ama Mensah",
        staffProfileId: "staff-demo",
      },
      terminal: {
        _id: "terminal-demo",
        displayName: "Demo Front Register",
        status: "active",
      },
    });
    mockUseConvexTerminalByFingerprint.mockReturnValue({
      _id: "terminal-browser",
      displayName: "Demo Register",
      registerNumber: "WEB-123456",
      status: "active",
    });

    const { result } = renderHook(() => useGetTerminal());

    expect(result.current).toMatchObject({
      _id: "terminal-browser",
      displayName: "Demo Register",
      sharedDemoStaff: {
        staffProfileId: "staff-demo",
      },
    });
  });

  it("uses the server-owned shared demo register without a device fingerprint", () => {
    mockReadStoredTerminalFingerprintHash.mockReturnValue(null);
    mockUseQuery.mockReturnValue({
      kind: "shared_demo",
      storeId: "store-1",
      staff: {
        activeRoles: ["cashier"],
        displayName: "Ama Mensah",
        staffProfileId: "staff-demo",
      },
      terminal: {
        _id: "terminal-demo",
        displayName: "Demo Front Register",
        registerNumber: "DEMO-01",
        status: "active",
      },
    });

    const { result } = renderHook(() => useGetTerminal());

    expect(result.current).toEqual({
      _id: "terminal-demo",
      displayName: "Demo Front Register",
      registerNumber: "DEMO-01",
      sharedDemoStaff: {
        activeRoles: ["cashier"],
        displayName: "Ama Mensah",
        staffProfileId: "staff-demo",
      },
      status: "active",
    });
  });

  it("falls back to the provisioned local terminal seed when active store is unavailable", async () => {
    mockActiveStore = null;

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

    await waitFor(() =>
      expect(mockReadProvisionedTerminalSeed).toHaveBeenCalled(),
    );
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

    await waitFor(() =>
      expect(mockReadProvisionedTerminalSeed).toHaveBeenCalled(),
    );
    expect(result.current).toBeNull();
  });
});
