import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  readProvisionedTerminalSeed: vi.fn(),
  verifyPosOfflineAuthorityReceipt: vi.fn(),
  writeProvisionedTerminalSeed: vi.fn(),
}));

vi.mock("../convexClient", () => ({
  convex: { query: mocks.query },
}));

vi.mock("@/lib/pos/infrastructure/local/posLocalStorageRuntime", () => ({
  getDefaultPosLocalStore: () => ({
    readProvisionedTerminalSeed: mocks.readProvisionedTerminalSeed,
    writeProvisionedTerminalSeed: mocks.writeProvisionedTerminalSeed,
  }),
}));

vi.mock("@/lib/pos/security/offlineAuthorityPublicKeys", () => ({
  verifyPosOfflineAuthorityReceipt: mocks.verifyPosOfflineAuthorityReceipt,
}));

import {
  assertActivatedPosRecoverySession,
  recoverPromotedPosRecoverySession,
} from "./recoverPromotedPosRecoverySession";

const activation = {
  authorityExpiresAt: 5_000,
  offlineAuthorityReceipt: "receipt-1",
  posApplicationSessionBindingId: "binding-1",
  servicePrincipalSessionId: "service-session-1",
  storeId: "store-1",
  terminalId: "terminal-1",
};

function activeSession() {
  return { ...activation, authSessionId: "auth-session-1", status: "active" };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.verifyPosOfflineAuthorityReceipt.mockResolvedValue({
    status: "valid",
    receipt: { envelope: "receipt-1", payload: {}, verifiedAt: 1_000 },
  });
  mocks.readProvisionedTerminalSeed.mockResolvedValue({
    ok: true,
    value: { cloudTerminalId: "terminal-1", storeId: "store-1" },
  });
  mocks.writeProvisionedTerminalSeed.mockResolvedValue({ ok: true });
});

describe("assertActivatedPosRecoverySession", () => {
  it("waits through unauthorized polls without treating them as errors", async () => {
    mocks.query
      .mockResolvedValueOnce({ status: "unavailable" })
      .mockResolvedValueOnce({ status: "unavailable" })
      .mockResolvedValue(activeSession());

    await expect(
      assertActivatedPosRecoverySession(activation),
    ).resolves.toBeUndefined();

    expect(mocks.query).toHaveBeenCalledTimes(3);
    expect(mocks.writeProvisionedTerminalSeed).toHaveBeenCalledTimes(1);
  });

  it("keeps polling until the promoted session matches the expected activation", async () => {
    mocks.query
      .mockResolvedValueOnce({
        ...activeSession(),
        servicePrincipalSessionId: "stale-session",
      })
      .mockResolvedValue(activeSession());

    await expect(
      assertActivatedPosRecoverySession(activation),
    ).resolves.toBeUndefined();

    expect(mocks.query).toHaveBeenCalledTimes(2);
  });
});

describe("recoverPromotedPosRecoverySession", () => {
  it("returns the activation once the remounted provider is authorized", async () => {
    mocks.query
      .mockRejectedValueOnce(new Error("transport interrupted"))
      .mockResolvedValueOnce({ status: "unavailable" })
      .mockResolvedValue(activeSession());

    await expect(recoverPromotedPosRecoverySession()).resolves.toEqual(
      activation,
    );

    expect(mocks.query).toHaveBeenCalledTimes(3);
    expect(mocks.writeProvisionedTerminalSeed).toHaveBeenCalledTimes(1);
  });
});
