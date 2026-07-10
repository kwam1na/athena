import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Id } from "~/convex/_generated/dataModel";
import type { RegisterLifecycleAuthorityRuntimeState } from "@/lib/pos/infrastructure/local/useRegisterLifecycleAuthorityRuntime";

import { useRegisterLocalRuntime } from "./useRegisterLocalRuntime";

const mocks = vi.hoisted(() => {
  const localStore = {
    attachStaffProofTokenToPendingEvents: vi.fn(),
    getStaffAuthorityReadiness: vi.fn(),
    listEvents: vi.fn(),
    readProvisionedTerminalSeed: vi.fn(),
    resetRegisterOperationalStateForAuthorityCutover: vi.fn(),
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
    useRegisterLifecycleAuthorityRuntime: vi.fn<
      (input: unknown) => RegisterLifecycleAuthorityRuntimeState
    >(() => ({
        authorization: { status: "authorized" },
        candidates: { candidates: [], status: "empty" },
        persistence: { status: "ready" },
        retry: vi.fn(),
      })),
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

vi.mock(
  "@/lib/pos/infrastructure/local/useRegisterLifecycleAuthorityRuntime",
  () => ({
    useRegisterLifecycleAuthorityRuntime:
      mocks.useRegisterLifecycleAuthorityRuntime,
  }),
);

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
    mocks.useRegisterLifecycleAuthorityRuntime.mockReturnValue({
      authorization: { status: "authorized" },
      candidates: { candidates: [], status: "empty" },
      persistence: { status: "ready" },
      retry: vi.fn(),
    });
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
    mocks.localStore.resetRegisterOperationalStateForAuthorityCutover.mockResolvedValue(
      {
        ok: true,
        value: { resetAt: 1_000, status: "already_applied" },
      },
    );
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
    act(() => rerender({}));

    expect(result.current.localStore).toBe(firstStore);
    expect(result.current.localCommandGateway).toBe(firstGateway);
    expect(mocks.createPosLocalStore).toHaveBeenCalledTimes(1);
    expect(mocks.createLocalCommandGateway).toHaveBeenCalledTimes(1);
  });

  it("keeps the authority refresh bridge stable across equivalent terminal objects", async () => {
    const { rerender, result } = renderRuntime();
    await waitFor(() => {
      expect(result.current.localStaffAuthorityStatus).toBe("ready");
    });
    const initialInput = mocks.useRegisterLifecycleAuthorityRuntime.mock.calls.at(
      -1,
    )?.[0] as
      | { refreshLocalRegisterReadModel: () => Promise<void> }
      | undefined;

    act(() =>
      rerender({
        terminal: { ...terminal },
      }),
    );
    const rerenderedInput = mocks.useRegisterLifecycleAuthorityRuntime.mock.calls.at(
      -1,
    )?.[0] as
      | { refreshLocalRegisterReadModel: () => Promise<void> }
      | undefined;

    expect(rerenderedInput?.refreshLocalRegisterReadModel).toBe(
      initialInput?.refreshLocalRegisterReadModel,
    );
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
        terminal: {
          _id: terminal._id,
          cloudTerminalId: undefined,
          localTerminalId: undefined,
        },
      }),
    );
    expect(result.current.localRegisterReadModel).toEqual({ canSell: true });
  });

  it("blocks commands until the targeted register reset succeeds while keeping sync mounted", async () => {
    let resolveReset: ((value: unknown) => void) | undefined;
    mocks.localStore.resetRegisterOperationalStateForAuthorityCutover.mockReturnValue(
      new Promise((resolve) => {
        resolveReset = resolve;
      }),
    );

    const { result } = renderRuntime();
    const gatewayOptions = mocks.createLocalCommandGateway.mock.calls[0]?.[0];

    await waitFor(() => {
      expect(
        mocks.localStore.resetRegisterOperationalStateForAuthorityCutover,
      ).toHaveBeenCalled();
    });
    expect(result.current.localRegisterReadModel).toBeNull();
    expect(gatewayOptions.authorityPersistenceFailed()).toBe(true);
    expect(mocks.readProjectedLocalRegisterModel).not.toHaveBeenCalled();
    expect(mocks.usePosLocalSyncRuntimeStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        storeFactory: expect.any(Function),
        storeId: undefined,
        terminalId: terminal._id,
      }),
    );

    await act(async () => {
      resolveReset?.({
        ok: true,
        value: {
          deletedAuthorityCount: 1,
          deletedEventCount: 1,
          deletedMappingCount: 1,
          resetAt: 1_000,
          status: "applied",
        },
      });
    });

    await waitFor(() => {
      expect(result.current.localRegisterReadModel).toEqual({ canSell: true });
    });
    expect(gatewayOptions.authorityPersistenceFailed()).toBe(false);
    expect(mocks.usePosLocalSyncRuntimeStatus).toHaveBeenLastCalledWith(
      expect.objectContaining({ storeId }),
    );
    expect(
      mocks.localStore.resetRegisterOperationalStateForAuthorityCutover,
    ).toHaveBeenCalled();
  });

  it("retries a transient reset failure without requiring a page reload", async () => {
    mocks.localStore.resetRegisterOperationalStateForAuthorityCutover
      .mockResolvedValueOnce({
        error: { code: "write_failed", message: "transaction aborted" },
        ok: false,
      })
      .mockResolvedValueOnce({
        ok: true,
        value: {
          deletedAuthorityCount: 1,
          deletedEventCount: 2,
          deletedMappingCount: 1,
          resetAt: 1_000,
          status: "applied",
        },
      });

    const { result } = renderRuntime();

    await waitFor(() => {
      expect(result.current.localRegisterReadModel).toEqual({ canSell: true });
    });
    expect(
      mocks.localStore.resetRegisterOperationalStateForAuthorityCutover,
    ).toHaveBeenCalledTimes(2);
    const gatewayOptions = mocks.createLocalCommandGateway.mock.calls[0]?.[0];
    expect(gatewayOptions.authorityPersistenceFailed()).toBe(false);
  });

  it("mounts lifecycle authority independently and shares its persistence guard", async () => {
    mocks.useRegisterLifecycleAuthorityRuntime.mockReturnValue({
      authorization: { status: "authorized" },
      candidates: {
        candidates: [
          { localRegisterSessionId: "local-register-1" },
        ],
        status: "ready",
      },
      persistence: { reason: "write_failed", status: "failed" },
      retry: vi.fn(),
    });

    const { result } = renderRuntime();

    await waitFor(() => {
      expect(result.current.registerLifecycleAuthority.persistence.status).toBe(
        "failed",
      );
    });
    expect(mocks.useRegisterLifecycleAuthorityRuntime).toHaveBeenCalledWith(
      expect.objectContaining({
        localRegisterReadModel: expect.anything(),
        refreshLocalRegisterReadModel: expect.any(Function),
        store: mocks.localStore,
        storeId,
        terminal: { _id: terminal._id },
      }),
    );
    const gatewayOptions = mocks.createLocalCommandGateway.mock.calls[0]?.[0];
    expect(gatewayOptions.authorityPersistenceFailed()).toBe(true);
  });

  it("keeps the persistence command guard latched until a retry is durably ready", async () => {
    const retry = vi.fn();
    mocks.useRegisterLifecycleAuthorityRuntime.mockReturnValue({
      authorization: { status: "authorized" },
      candidates: { candidates: [], status: "empty" },
      persistence: { reason: "write_failed", status: "failed" },
      retry,
    });
    const { result, rerender } = renderRuntime();
    await waitFor(() => {
      expect(result.current.localStaffAuthorityStatus).toBe("ready");
    });
    const gatewayOptions = mocks.createLocalCommandGateway.mock.calls[0]?.[0];
    expect(gatewayOptions.authorityPersistenceFailed()).toBe(true);

    mocks.useRegisterLifecycleAuthorityRuntime.mockReturnValue({
      authorization: { status: "authorized" },
      candidates: { candidates: [], status: "empty" },
      persistence: { status: "applying" },
      retry,
    });
    act(() => rerender({}));
    expect(gatewayOptions.authorityPersistenceFailed()).toBe(true);

    mocks.useRegisterLifecycleAuthorityRuntime.mockReturnValue({
      authorization: { status: "authorized" },
      candidates: { candidates: [], status: "empty" },
      persistence: { status: "ready" },
      retry,
    });
    act(() => rerender({}));
    expect(gatewayOptions.authorityPersistenceFailed()).toBe(false);
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
