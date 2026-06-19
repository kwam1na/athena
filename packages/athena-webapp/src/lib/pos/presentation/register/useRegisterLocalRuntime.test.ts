import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Id } from "~/convex/_generated/dataModel";

import { useRegisterLocalRuntime } from "./useRegisterLocalRuntime";

const mocks = vi.hoisted(() => {
  const localStore = {
    attachStaffProofTokenToPendingEvents: vi.fn(),
    getStaffAuthorityReadiness: vi.fn(),
    listEvents: vi.fn(),
    readProvisionedTerminalSeed: vi.fn(),
  };

  return {
    createIndexedDbPosLocalStorageAdapter: vi.fn(() => ({ kind: "adapter" })),
    createLocalCommandGateway: vi.fn((args) => ({
      kind: "gateway",
      args,
    })),
    createPosLocalStore: vi.fn(() => localStore),
    localStore,
    readProjectedLocalRegisterModel: vi.fn(),
    usePosLocalSyncRuntimeStatus: vi.fn(() => ({
      pendingEventCount: 0,
      status: "synced",
    })),
    usePosTerminalAppSessionRecoveryRuntimeInput: vi.fn(() => ({
      status: "idle",
    })),
    useOptionalUpdateCoordinator: vi.fn(() => null),
  };
});

vi.mock("@/lib/pos/infrastructure/local/posLocalStore", () => ({
  createIndexedDbPosLocalStorageAdapter:
    mocks.createIndexedDbPosLocalStorageAdapter,
  createPosLocalStore: mocks.createPosLocalStore,
}));

vi.mock("@/lib/pos/infrastructure/local/localCommandGateway", () => ({
  createLocalCommandGateway: mocks.createLocalCommandGateway,
}));

vi.mock("@/lib/pos/infrastructure/local/localRegisterReader", () => ({
  readProjectedLocalRegisterModel: mocks.readProjectedLocalRegisterModel,
}));

vi.mock("@/lib/pos/infrastructure/local/usePosLocalSyncRuntime", () => ({
  usePosLocalSyncRuntimeStatus: mocks.usePosLocalSyncRuntimeStatus,
}));

vi.mock("@/lib/app-update", () => ({
  useOptionalUpdateCoordinator: mocks.useOptionalUpdateCoordinator,
}));

vi.mock(
  "@/lib/pos/infrastructure/terminal/posTerminalAppSessionRecoveryContext",
  () => ({
    usePosTerminalAppSessionRecoveryRuntimeInput:
      mocks.usePosTerminalAppSessionRecoveryRuntimeInput,
  }),
);

const storeId = "store-1" as Id<"store">;
const staffProfileId = "staff-1" as Id<"staffProfile">;
const terminal = {
  _id: "terminal-1" as Id<"posTerminal">,
  displayName: "Register 1",
};

function renderRuntime(
  overrides: Partial<Parameters<typeof useRegisterLocalRuntime>[0]> = {},
) {
  const staffProfileIdRef = {
    current: overrides.staffProfileId ?? staffProfileId,
  };
  const staffProofTokenRef = {
    current: overrides.staffProofToken ?? "proof-token",
  };
  const createLocalFallbackId = vi.fn((prefix: string) => `${prefix}-id`);
  const onRetryBootstrap = vi.fn();

  return renderHook(
    (props: Partial<Parameters<typeof useRegisterLocalRuntime>[0]>) =>
      useRegisterLocalRuntime({
        activeStoreId: storeId,
        createLocalFallbackId,
        onRetryBootstrap,
        staffProfileId,
        staffProfileIdRef,
        staffProofToken: "proof-token",
        staffProofTokenRef,
        terminal,
        ...overrides,
        ...props,
      }),
  );
}

describe("useRegisterLocalRuntime", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(globalThis, "indexedDB", {
      configurable: true,
      value: {},
    });
    mocks.localStore.attachStaffProofTokenToPendingEvents.mockResolvedValue({
      ok: true,
      value: 0,
    });
    mocks.localStore.getStaffAuthorityReadiness.mockResolvedValue({
      ok: true,
      value: "ready",
    });
    mocks.localStore.readProvisionedTerminalSeed.mockResolvedValue({
      ok: true,
      value: {
        cloudTerminalId: terminal._id,
        storeId,
        syncSecretHash: "hash",
      },
    });
    mocks.readProjectedLocalRegisterModel.mockResolvedValue({
      ok: true,
      value: { canSell: true },
    });
    mocks.useOptionalUpdateCoordinator.mockReturnValue(null);
  });

  it("creates a stable local store and gateway while terminal identity is unchanged", async () => {
    const { result, rerender } = renderRuntime();

    await waitFor(() => {
      expect(result.current.localStaffAuthorityStatus).toBe("ready");
    });
    const firstStore = result.current.localStore;
    const firstGateway = result.current.localCommandGateway;
    rerender({});

    expect(result.current.localStore).toBe(firstStore);
    expect(result.current.localCommandGateway).toBe(firstGateway);
    expect(mocks.createPosLocalStore).toHaveBeenCalledTimes(1);
    expect(mocks.createLocalCommandGateway).toHaveBeenCalledTimes(1);
  });

  it("reports provisioned seed readiness only for the current store and terminal", async () => {
    const { result } = renderRuntime();

    await waitFor(() => {
      expect(result.current.localStaffAuthorityStatus).toBe("ready");
    });
    await expect(result.current.hasProvisionedLocalSyncSeed()).resolves.toBe(
      true,
    );

    mocks.localStore.readProvisionedTerminalSeed.mockResolvedValueOnce({
      ok: true,
      value: {
        cloudTerminalId: "other-terminal",
        storeId,
        syncSecretHash: "hash",
      },
    });
    await expect(result.current.hasProvisionedLocalSyncSeed()).resolves.toBe(
      false,
    );
  });

  it("increments the local append token when the command gateway appends an event", async () => {
    const { result } = renderRuntime();
    const gatewayArgs = mocks.createLocalCommandGateway.mock.calls[0]?.[0];

    await waitFor(() => {
      expect(result.current.localStaffAuthorityStatus).toBe("ready");
    });
    act(() => {
      gatewayArgs.onEventAppended();
    });

    expect(result.current.localSyncEventAppendToken).toBe(1);
  });

  it("passes the app update coordinator adapter into the local sync runtime", async () => {
    const applyUpdate = vi.fn();
    const getSnapshot = vi.fn();
    mocks.useOptionalUpdateCoordinator.mockReturnValue({
      applyUpdate,
      getSnapshot,
    } as never);

    const { result } = renderRuntime();

    await waitFor(() => {
      expect(result.current.localStaffAuthorityStatus).toBe("ready");
    });
    await waitFor(() => {
      expect(result.current.localRegisterReadModel).toEqual({ canSell: true });
    });

    expect(mocks.usePosLocalSyncRuntimeStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        appUpdateCoordinator: {
          applyUpdate,
          getSnapshot,
        },
      }),
    );
  });

  it("refreshes the projected local register read model through the runtime bridge", async () => {
    const { result } = renderRuntime();

    await act(async () => {
      await result.current.refreshLocalRegisterReadModel();
    });

    expect(mocks.readProjectedLocalRegisterModel).toHaveBeenCalledWith(
      expect.objectContaining({
        store: mocks.localStore,
        storeId,
        terminal,
      }),
    );
    expect(result.current.localRegisterReadModel).toEqual({ canSell: true });
  });

  it("attaches staff proof to pending events and advances the append token", async () => {
    mocks.localStore.attachStaffProofTokenToPendingEvents.mockResolvedValueOnce(
      {
        ok: true,
        value: 2,
      },
    );

    const { result } = renderRuntime();

    await waitFor(() => {
      expect(result.current.localSyncEventAppendToken).toBe(1);
    });
    expect(
      mocks.localStore.attachStaffProofTokenToPendingEvents,
    ).toHaveBeenCalledWith({
      staffProfileId,
      staffProofToken: "proof-token",
    });
  });
});
