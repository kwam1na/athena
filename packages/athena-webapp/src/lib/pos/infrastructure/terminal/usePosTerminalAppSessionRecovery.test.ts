import { act, renderHook, waitFor } from "@testing-library/react";
import { useMutation } from "convex/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Id } from "~/convex/_generated/dataModel";
import {
  LOGGED_IN_USER_ID_KEY,
  POS_APP_ACCOUNT_ID_KEY,
} from "@/lib/constants";
import type { PosLocalEntryContext } from "../local/localPosEntryContext";
import { POS_LOCAL_STORE_SCHEMA_VERSION } from "../local/posLocalStore";
import {
  readStoredPosAppAccountId,
  resetPosTerminalAppSessionRecoveryRuntimeForTests,
  usePosTerminalAppSessionRecovery,
} from "./usePosTerminalAppSessionRecovery";

const mocked = vi.hoisted(() => ({
  recover: vi.fn(),
}));

vi.mock("convex/react", () => ({
  useMutation: vi.fn(),
}));

vi.mock("~/convex/_generated/api", () => ({
  api: {
    pos: {
      public: {
        terminalAppSessions: {
          validateTerminalAppSessionRecovery:
            "validateTerminalAppSessionRecovery",
        },
      },
    },
  },
}));

const terminalSeed = {
  terminalId: "local-terminal-1",
  cloudTerminalId: "terminal-cloud-1",
  syncSecretHash: "sync-secret-1",
  storeId: "store-1",
  registerNumber: "1",
  displayName: "Front register",
  provisionedAt: 1_700,
  schemaVersion: POS_LOCAL_STORE_SCHEMA_VERSION,
};

const readyEntryContext = (
  overrides: Partial<Extract<PosLocalEntryContext, { status: "ready" }>> = {},
): PosLocalEntryContext => ({
  status: "ready",
  orgUrlSlug: "acme",
  storeUrlSlug: "downtown",
  storeId: "store-1",
  terminalSeed,
  source: "local",
  ...overrides,
});

const recoverableResult = (
  overrides: Partial<{
    expiresAt: number;
    routeScope: "pos_hub" | "admin";
    storeId: string;
    terminalId: string;
  }> = {},
) => ({
  status: "recoverable" as const,
  assertion: {
    accountId: "user-1" as Id<"athenaUser">,
    issuedAt: 1_000,
    expiresAt: overrides.expiresAt ?? Date.now() + 60_000,
    recoveryAttemptId: "attempt-1",
    routeScope: overrides.routeScope ?? ("pos_hub" as const),
    storeId: (overrides.storeId ?? "store-1") as Id<"store">,
    terminalId: (overrides.terminalId ??
      "terminal-cloud-1") as Id<"posTerminal">,
  },
  diagnostics: { reason: "validated" as const },
});

function setNavigatorOnline(isOnline: boolean) {
  Object.defineProperty(window.navigator, "onLine", {
    configurable: true,
    value: isOnline,
  });
}

describe("usePosTerminalAppSessionRecovery", () => {
  beforeEach(() => {
    mocked.recover.mockReset();
    vi.mocked(useMutation).mockReset();
    vi.mocked(useMutation).mockReturnValue(
      mocked.recover as unknown as ReturnType<typeof useMutation>,
    );
    resetPosTerminalAppSessionRecoveryRuntimeForTests();
    setNavigatorOnline(true);
  });

  it("starts recovery once for a POS hub route with missing app user state and scoped local terminal readiness", async () => {
    let resolveRecovery:
      | ((value: ReturnType<typeof recoverableResult>) => void)
      | null = null;
    mocked.recover.mockReturnValue(
      new Promise((resolve) => {
        resolveRecovery = resolve;
      }),
    );
    const input = {
      routeIntent: "pos_hub",
      isAppUserMissing: true,
      storedAppAccountId: "user-1" as Id<"athenaUser">,
      localEntryContext: readyEntryContext(),
    };

    const { rerender } = renderHook(
      ({ recoveryInput }) => usePosTerminalAppSessionRecovery(recoveryInput),
      { initialProps: { recoveryInput: input } },
    );

    rerender({ recoveryInput: { ...input } });

    expect(mocked.recover).toHaveBeenCalledTimes(1);
    expect(mocked.recover).toHaveBeenCalledWith({
      accountId: "user-1",
      routeIntent: "pos_hub",
      storeId: "store-1",
      terminalId: "terminal-cloud-1",
      terminalProof: "sync-secret-1",
      metadata: {
        orgUrlSlug: "acme",
        source: "local",
        storeUrlSlug: "downtown",
      },
    });

    await act(async () => {
      resolveRecovery?.(recoverableResult());
    });
  });

  it("starts a distinct recovery when the local terminal proof changes", async () => {
    let resolveFirstRecovery:
      | ((value: ReturnType<typeof recoverableResult>) => void)
      | null = null;
    let resolveSecondRecovery:
      | ((value: ReturnType<typeof recoverableResult>) => void)
      | null = null;
    mocked.recover
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveFirstRecovery = resolve;
        }),
      )
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveSecondRecovery = resolve;
        }),
      );
    const input = {
      routeIntent: "pos_hub",
      isAppUserMissing: true,
      storedAppAccountId: "user-1" as Id<"athenaUser">,
      localEntryContext: readyEntryContext(),
    };

    const { rerender, result } = renderHook(
      ({ recoveryInput }) => usePosTerminalAppSessionRecovery(recoveryInput),
      { initialProps: { recoveryInput: input } },
    );

    await waitFor(() => expect(mocked.recover).toHaveBeenCalledTimes(1));

    rerender({
      recoveryInput: {
        ...input,
        localEntryContext: readyEntryContext({
          terminalSeed: {
            ...terminalSeed,
            syncSecretHash: "sync-secret-2",
          },
        }),
      },
    });

    await waitFor(() => expect(mocked.recover).toHaveBeenCalledTimes(2));
    expect(mocked.recover).toHaveBeenLastCalledWith(
      expect.objectContaining({ terminalProof: "sync-secret-2" }),
    );

    await act(async () => {
      resolveFirstRecovery?.(recoverableResult());
    });
    expect(result.current.status).toBe("validating");

    await act(async () => {
      resolveSecondRecovery?.(recoverableResult());
    });
    await waitFor(() => expect(result.current.status).toBe("recoverable"));
  });

  it("retries retryable recovery results with bounded backoff", async () => {
    const scheduledRetries: Array<() => void> = [];
    const scheduleRetry = vi.fn((_: number, retry: () => void) => {
      scheduledRetries.push(retry);
      return () => undefined;
    });
    mocked.recover
      .mockResolvedValueOnce({
        status: "retryable",
        diagnostics: { reason: "transient_failure" },
      })
      .mockResolvedValueOnce(recoverableResult());

    const { result } = renderHook(() =>
      usePosTerminalAppSessionRecovery({
        routeIntent: "pos_hub",
        isAppUserMissing: true,
        storedAppAccountId: "user-1" as Id<"athenaUser">,
        localEntryContext: readyEntryContext(),
        retryDelaysMs: [25],
        scheduleRetry,
      }),
    );

    await waitFor(() =>
      expect(scheduleRetry).toHaveBeenCalledWith(25, expect.any(Function)),
    );
    expect(result.current.status).toBe("retrying");

    await act(async () => {
      scheduledRetries[0]?.();
    });

    await waitFor(() => expect(result.current.status).toBe("recoverable"));
    expect(mocked.recover).toHaveBeenCalledTimes(2);
  });

  it("retries when recovery validation does not settle before the timeout", async () => {
    const scheduledRetries: Array<() => void> = [];
    const scheduledTimeouts: Array<() => void> = [];
    const scheduleRetry = vi.fn((_: number, retry: () => void) => {
      scheduledRetries.push(retry);
      return () => undefined;
    });
    const scheduleValidationTimeout = vi.fn((_: number, timeout: () => void) => {
      scheduledTimeouts.push(timeout);
      return () => undefined;
    });
    mocked.recover
      .mockReturnValueOnce(new Promise(() => undefined))
      .mockResolvedValueOnce(recoverableResult());

    const { result } = renderHook(() =>
      usePosTerminalAppSessionRecovery({
        routeIntent: "pos_hub",
        isAppUserMissing: true,
        storedAppAccountId: "user-1" as Id<"athenaUser">,
        localEntryContext: readyEntryContext(),
        retryDelaysMs: [25],
        scheduleRetry,
        scheduleValidationTimeout,
        validationTimeoutMs: 10,
      }),
    );

    await waitFor(() =>
      expect(scheduleValidationTimeout).toHaveBeenCalledWith(
        10,
        expect.any(Function),
      ),
    );
    expect(result.current.status).toBe("validating");

    await act(async () => {
      scheduledTimeouts[0]?.();
    });

    await waitFor(() =>
      expect(scheduleRetry).toHaveBeenCalledWith(25, expect.any(Function)),
    );
    expect(result.current.status).toBe("retrying");

    await act(async () => {
      scheduledRetries[0]?.();
    });

    await waitFor(() => expect(result.current.status).toBe("recoverable"));
    expect(mocked.recover).toHaveBeenCalledTimes(2);
  });

  it("waits for network when a scheduled retry fires while offline and resumes on reconnect", async () => {
    const scheduledRetries: Array<() => void> = [];
    const scheduleRetry = vi.fn((_: number, retry: () => void) => {
      scheduledRetries.push(retry);
      return () => undefined;
    });
    mocked.recover
      .mockResolvedValueOnce({
        status: "retryable",
        diagnostics: { reason: "transient_failure" },
      })
      .mockResolvedValueOnce(recoverableResult());

    const { result } = renderHook(() =>
      usePosTerminalAppSessionRecovery({
        routeIntent: "pos_hub",
        isAppUserMissing: true,
        storedAppAccountId: "user-1" as Id<"athenaUser">,
        localEntryContext: readyEntryContext(),
        retryDelaysMs: [25],
        scheduleRetry,
      }),
    );

    await waitFor(() =>
      expect(scheduleRetry).toHaveBeenCalledWith(25, expect.any(Function)),
    );

    setNavigatorOnline(false);
    await act(async () => {
      scheduledRetries[0]?.();
    });

    expect(result.current.status).toBe("waiting_for_network");
    expect(mocked.recover).toHaveBeenCalledTimes(1);

    await act(async () => {
      window.dispatchEvent(new Event("offline"));
    });
    setNavigatorOnline(true);
    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });

    await waitFor(() => expect(result.current.status).toBe("recoverable"));
    expect(mocked.recover).toHaveBeenCalledTimes(2);
  });

  it("blocks recovery after bounded retries are exhausted", async () => {
    const scheduledRetries: Array<() => void> = [];
    const scheduleRetry = vi.fn((_: number, retry: () => void) => {
      scheduledRetries.push(retry);
      return () => undefined;
    });
    mocked.recover.mockResolvedValue({
      status: "retryable",
      diagnostics: { reason: "transient_failure" },
    });

    const { result } = renderHook(() =>
      usePosTerminalAppSessionRecovery({
        routeIntent: "pos_hub",
        isAppUserMissing: true,
        storedAppAccountId: "user-1" as Id<"athenaUser">,
        localEntryContext: readyEntryContext(),
        retryDelaysMs: [25],
        scheduleRetry,
      }),
    );

    await waitFor(() =>
      expect(scheduleRetry).toHaveBeenCalledWith(25, expect.any(Function)),
    );

    await act(async () => {
      scheduledRetries[0]?.();
    });

    await waitFor(() => expect(result.current.status).toBe("blocked"));
    expect(result.current.reason).toBe("retry_exhausted");
    expect(mocked.recover).toHaveBeenCalledTimes(2);
    expect(scheduleRetry).toHaveBeenCalledTimes(1);
  });

  it("blocks recovery after bounded mutation rejections are exhausted", async () => {
    const scheduledRetries: Array<() => void> = [];
    const scheduleRetry = vi.fn((_: number, retry: () => void) => {
      scheduledRetries.push(retry);
      return () => undefined;
    });
    mocked.recover.mockRejectedValue(new Error("Convex unavailable"));

    const { result } = renderHook(() =>
      usePosTerminalAppSessionRecovery({
        routeIntent: "pos_hub",
        isAppUserMissing: true,
        storedAppAccountId: "user-1" as Id<"athenaUser">,
        localEntryContext: readyEntryContext(),
        retryDelaysMs: [25],
        scheduleRetry,
      }),
    );

    await waitFor(() =>
      expect(scheduleRetry).toHaveBeenCalledWith(25, expect.any(Function)),
    );

    await act(async () => {
      scheduledRetries[0]?.();
    });

    await waitFor(() => expect(result.current.status).toBe("blocked"));
    expect(result.current.reason).toBe("retry_exhausted");
    expect(mocked.recover).toHaveBeenCalledTimes(2);
    expect(scheduleRetry).toHaveBeenCalledTimes(1);
  });

  it("blocks recovery when an accepted assertion expires", async () => {
    mocked.recover.mockResolvedValue(
      recoverableResult({ expiresAt: Date.now() + 250 }),
    );

    const { result } = renderHook(() =>
      usePosTerminalAppSessionRecovery({
        routeIntent: "pos_hub",
        isAppUserMissing: true,
        storedAppAccountId: "user-1" as Id<"athenaUser">,
        localEntryContext: readyEntryContext(),
      }),
    );

    await waitFor(() => expect(result.current.status).toBe("recoverable"));
    await waitFor(() => expect(result.current.status).toBe("blocked"));
    expect(result.current.reason).toBe("stale_assertion");
  });

  it("surfaces blocked recovery without retrying", async () => {
    mocked.recover.mockResolvedValue({
      status: "blocked",
      reason: "terminal_revoked",
      diagnostics: { reason: "terminal_revoked" },
    });

    const { result } = renderHook(() =>
      usePosTerminalAppSessionRecovery({
        routeIntent: "pos_hub",
        isAppUserMissing: true,
        storedAppAccountId: "user-1" as Id<"athenaUser">,
        localEntryContext: readyEntryContext(),
      }),
    );

    await waitFor(() => expect(result.current.status).toBe("blocked"));

    expect(result.current.reason).toBe("terminal_revoked");
    expect(mocked.recover).toHaveBeenCalledTimes(1);
  });

  it("waits for network while offline instead of calling recovery", async () => {
    setNavigatorOnline(false);

    const { result } = renderHook(() =>
      usePosTerminalAppSessionRecovery({
        routeIntent: "pos_hub",
        isAppUserMissing: true,
        storedAppAccountId: "user-1" as Id<"athenaUser">,
        localEntryContext: readyEntryContext(),
      }),
    );

    expect(result.current.status).toBe("waiting_for_network");
    expect(mocked.recover).not.toHaveBeenCalled();

    mocked.recover.mockResolvedValue(recoverableResult());
    setNavigatorOnline(true);

    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });

    await waitFor(() => expect(mocked.recover).toHaveBeenCalledTimes(1));
  });

  it.each([
    {
      name: "wrong-store",
      assertion: recoverableResult({
        storeId: "store-2",
      }),
    },
    {
      name: "wrong-terminal",
      assertion: recoverableResult({
        terminalId: "terminal-cloud-2",
      }),
    },
    {
      name: "expired",
      assertion: recoverableResult({
        expiresAt: Date.now() - 1,
      }),
    },
  ])("rejects $name recoverable assertions as stale", async ({ assertion }) => {
    mocked.recover.mockResolvedValue(
      assertion,
    );

    const { result } = renderHook(() =>
      usePosTerminalAppSessionRecovery({
        routeIntent: "pos_hub",
        isAppUserMissing: true,
        storedAppAccountId: "user-1" as Id<"athenaUser">,
        localEntryContext: readyEntryContext(),
      }),
    );

    await waitFor(() => expect(result.current.status).toBe("blocked"));

    expect(result.current.reason).toBe("stale_assertion");
    expect(result.current.assertion).toBeNull();
  });

  it.each([
    { status: "missing_seed" as const },
    {
      status: "unsupported_schema" as const,
      message: "Local POS schema 1 is not supported.",
    },
  ])(
    "does not start recovery when local terminal continuity is $status",
    (localEntryContext) => {
      renderHook(() =>
        usePosTerminalAppSessionRecovery({
          routeIntent: "pos_hub",
          isAppUserMissing: true,
          storedAppAccountId: "user-1" as Id<"athenaUser">,
          localEntryContext,
        }),
      );

      expect(mocked.recover).not.toHaveBeenCalled();
    },
  );

  it("does not start outside POS hub recovery preconditions", () => {
    renderHook(() =>
      usePosTerminalAppSessionRecovery({
        routeIntent: "admin",
        isAppUserMissing: true,
        storedAppAccountId: "user-1" as Id<"athenaUser">,
        localEntryContext: readyEntryContext(),
      }),
    );
    renderHook(() =>
      usePosTerminalAppSessionRecovery({
        routeIntent: "pos_hub",
        isAppUserMissing: false,
        storedAppAccountId: "user-1" as Id<"athenaUser">,
        localEntryContext: readyEntryContext(),
      }),
    );
    renderHook(() =>
      usePosTerminalAppSessionRecovery({
        routeIntent: "pos_hub",
        isAppUserMissing: true,
        storedAppAccountId: "user-1" as Id<"athenaUser">,
        localEntryContext: {
          status: "mismatched_store",
          expectedStoreId: "store-1",
          seedStoreId: "store-2",
        },
      }),
    );

    expect(mocked.recover).not.toHaveBeenCalled();
  });

  it("prefers the POS app account cache when generic auth state is cleared", () => {
    vi.mocked(window.localStorage.getItem).mockImplementation((key) =>
      key === POS_APP_ACCOUNT_ID_KEY
        ? "pos-account-1"
        : key === LOGGED_IN_USER_ID_KEY
          ? "generic-user-1"
          : null,
    );

    expect(readStoredPosAppAccountId()).toBe("pos-account-1");
  });

  it("migrates the legacy logged-in account into the POS app account cache", () => {
    vi.mocked(window.localStorage.getItem).mockImplementation((key) =>
      key === LOGGED_IN_USER_ID_KEY ? "legacy-user-1" : null,
    );

    expect(readStoredPosAppAccountId()).toBe("legacy-user-1");
    expect(window.localStorage.setItem).toHaveBeenCalledWith(
      POS_APP_ACCOUNT_ID_KEY,
      "legacy-user-1",
    );
  });
});
