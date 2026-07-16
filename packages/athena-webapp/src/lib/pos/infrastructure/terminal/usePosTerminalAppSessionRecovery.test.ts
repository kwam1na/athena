import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PosLocalEntryContext } from "../local/localPosEntryContext";
import {
  usePosTerminalAppSessionRecovery,
} from "./usePosTerminalAppSessionRecovery";

const mocked = vi.hoisted(() => ({ verifyReceipt: vi.fn() }));

vi.mock("@/lib/pos/security/offlineAuthorityPublicKeys", () => ({
  POS_OFFLINE_AUTHORITY_PUBLIC_KEYS: [],
  verifyPosOfflineAuthorityReceipt: mocked.verifyReceipt,
}));

const verifiedReceipt = {
  envelope: "receipt-1",
  payload: {
    audience: "athena.pos.offline" as const,
    capabilityId: "pos.application" as const,
    capabilityRevision: 3,
    credentialRevision: 5,
    expiresAt: 61_000,
    issuedAt: 1_000,
    issuer: "athena-test",
    keyVersion: 1,
    nonce: "nonce-1",
    posApplicationSessionBindingId: "binding-1",
    principalLifecycleRevision: 2,
    servicePrincipalId: "principal-1",
    servicePrincipalSessionId: "session-1",
    storeId: "store-1",
    terminalId: "terminal-cloud-1",
    terminalLifecycleRevision: 7,
    terminalProofRevision: 11,
    version: 1 as const,
  },
  verifiedAt: 2_000,
};

const readyEntryContext = (
  overrides: Partial<Extract<PosLocalEntryContext, { status: "ready" }>> = {},
): Extract<PosLocalEntryContext, { status: "ready" }> => ({
  status: "ready",
  orgUrlSlug: "acme",
  storeUrlSlug: "downtown",
  storeId: "store-1",
  terminalSeed: {
    terminalId: "local-terminal-1",
    cloudTerminalId: "terminal-cloud-1",
    syncSecretHash: "sync-secret-1",
    storeId: "store-1",
    registerNumber: "1",
    displayName: "Front register",
    provisionedAt: 1_700,
    schemaVersion: 2,
    offlineAuthorityReceipt: verifiedReceipt,
  },
  source: "local",
  ...overrides,
});

describe("usePosTerminalAppSessionRecovery", () => {
  beforeEach(() => {
    mocked.verifyReceipt.mockReset();
    mocked.verifyReceipt.mockResolvedValue({
      status: "valid",
      receipt: verifiedReceipt,
    });
    localStorage.clear();
  });

  it("recovers only from a cryptographically verified, exact-scope receipt", async () => {
    const { result } = renderHook(() =>
      usePosTerminalAppSessionRecovery({
        routeIntent: "pos_hub",
        isAppUserMissing: true,
        localEntryContext: readyEntryContext(),
        now: () => 2_000,
      }),
    );

    await waitFor(() => expect(result.current.status).toBe("recoverable"));
    expect(mocked.verifyReceipt).toHaveBeenCalledWith({
      envelope: "receipt-1",
      expectedStoreId: "store-1",
      expectedTerminalId: "terminal-cloud-1",
      now: 2_000,
      publicKeys: [],
    });
    expect(result.current).toMatchObject({
      assertion: {
        expiresAt: 61_000,
        nonce: "nonce-1",
        receiptVersion: 1,
        storeId: "store-1",
        terminalId: "terminal-cloud-1",
      },
      reason: null,
    });
  });

  it("never converts a stored legacy account ID or unsigned seed into authority", async () => {
    const context = readyEntryContext({
      terminalSeed: {
        ...readyEntryContext().terminalSeed!,
        offlineAuthorityReceipt: undefined,
      },
    });
    const { result } = renderHook(() =>
      usePosTerminalAppSessionRecovery({
        routeIntent: "pos_hub",
        isAppUserMissing: true,
        localEntryContext: context,
        storedAppAccountId: "legacy-user-1",
      }),
    );

    await waitFor(() => expect(result.current.status).toBe("blocked"));
    expect(result.current).toEqual({
      assertion: null,
      reason: "pos_recovery_required",
      status: "blocked",
    });
    expect(mocked.verifyReceipt).not.toHaveBeenCalled();
  });

  it.each([
    ["outside_lease", "stale_assertion"],
    ["unknown_key", "receipt_invalid"],
    ["revoked_key", "receipt_invalid"],
    ["scope_mismatch", "receipt_invalid"],
  ] as const)("maps %s receipt denial to %s", async (reason, expectedReason) => {
    mocked.verifyReceipt.mockResolvedValue({ status: "rejected", reason });
    const { result } = renderHook(() =>
      usePosTerminalAppSessionRecovery({
        routeIntent: "pos_hub",
        isAppUserMissing: true,
        localEntryContext: readyEntryContext(),
      }),
    );

    await waitFor(() => expect(result.current.status).toBe("blocked"));
    expect(result.current).toEqual({
      assertion: null,
      reason: expectedReason,
      status: "blocked",
    });
  });

  it("rejects a store switch before receipt verification", async () => {
    const { result } = renderHook(() =>
      usePosTerminalAppSessionRecovery({
        routeIntent: "pos_hub",
        isAppUserMissing: true,
        localEntryContext: readyEntryContext({ storeId: "store-2" }),
      }),
    );
    await waitFor(() => expect(result.current.status).toBe("blocked"));
    expect(result.current).toEqual({
      assertion: null,
      reason: "store_mismatch",
      status: "blocked",
    });
    expect(mocked.verifyReceipt).not.toHaveBeenCalled();
  });

  it("expires local continuation at the end of the inclusive lease", async () => {
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() =>
        usePosTerminalAppSessionRecovery({
          routeIntent: "pos_hub",
          isAppUserMissing: true,
          localEntryContext: readyEntryContext(),
          now: () => 60_999,
        }),
      );
      await act(async () => Promise.resolve());
      expect(result.current.status).toBe("recoverable");
      act(() => vi.advanceTimersByTime(2));
      expect(result.current).toEqual({
        assertion: null,
        reason: "stale_assertion",
        status: "blocked",
      });
    } finally {
      vi.useRealTimers();
    }
  });

});
