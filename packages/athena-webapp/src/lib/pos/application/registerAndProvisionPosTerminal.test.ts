import { describe, expect, it, vi } from "vitest";

import type { PosProvisionedTerminalSeed } from "./posLocalStoreTypes";
import { reactivateAndProvisionPosTerminal } from "./registerAndProvisionPosTerminal";

const seed: PosProvisionedTerminalSeed = {
  terminalId: "fingerprint-1",
  cloudTerminalId: "terminal-1",
  syncSecretHash: "old-proof",
  storeId: "store-1",
  orgUrlSlug: "org",
  registerNumber: "1",
  displayName: "Front register",
  provisionedAt: 1,
  schemaVersion: 1,
  storeUrlSlug: "store",
  offlineAuthorityReceipt: {
    envelope: "stale-receipt",
    payload: {} as never,
    verifiedAt: 1,
  },
};

describe("reactivateAndProvisionPosTerminal", () => {
  it("rotates only proof metadata while preserving the same local terminal lineage", async () => {
    const writeProvisionedTerminalSeed = vi.fn(async (nextSeed) => ({
      ok: true as const,
      value: nextSeed,
    }));
    const store = {
      readProvisionedTerminalSeed: vi.fn(async () => ({
        ok: true as const,
        value: seed,
      })),
      writeProvisionedTerminalSeed,
      readTerminalIntegrityState: vi.fn(),
      writeTerminalIntegrityState: vi.fn(),
      clearTerminalIntegrityState: vi.fn(async () => ({ ok: true as const, value: null })),
    };
    const reactivateTerminalMutation = vi.fn(async (args) => ({
      kind: "ok" as const,
      data: {
        _id: "terminal-1",
        _creationTime: 1,
        storeId: "store-1",
        fingerprintHash: "fingerprint-1",
        syncSecretHash: args.nextSyncSecretHash,
        displayName: "Front register",
        registeredByUserId: "user-1",
        browserInfo: { userAgent: "test" },
        registeredAt: 1,
        status: "active" as const,
      },
    }));

    await reactivateAndProvisionPosTerminal({
      expectedStoreId: "store-1" as never,
      expectedTerminalId: "terminal-1" as never,
      fingerprintHash: "fingerprint-1",
      reactivateTerminalMutation: reactivateTerminalMutation as never,
      reconnectIntentToken: "intent",
      storeFactory: () => store as never,
      now: () => 200,
    });

    expect(reactivateTerminalMutation).toHaveBeenCalledWith(
      expect.objectContaining({
        browserFingerprintHash: "fingerprint-1",
        reconnectIntentToken: "intent",
      }),
    );
    expect(writeProvisionedTerminalSeed).toHaveBeenCalledWith(
      expect.objectContaining({
        cloudTerminalId: "terminal-1",
        provisionedAt: 200,
      }),
    );
    expect(writeProvisionedTerminalSeed.mock.calls[0]?.[0]).not.toHaveProperty(
      "offlineAuthorityReceipt",
    );
    expect(store.clearTerminalIntegrityState).toHaveBeenCalledWith({
      storeId: "store-1",
      terminalId: "fingerprint-1",
    });
  });

  it("refuses a replacement terminal row and leaves local state untouched", async () => {
    const writeProvisionedTerminalSeed = vi.fn();
    const store = {
      readProvisionedTerminalSeed: vi.fn(async () => ({
        ok: true as const,
        value: seed,
      })),
      writeProvisionedTerminalSeed,
    };

    await expect(
      reactivateAndProvisionPosTerminal({
        expectedStoreId: "store-1" as never,
        expectedTerminalId: "terminal-1" as never,
        fingerprintHash: "fingerprint-1",
        reactivateTerminalMutation: async () => ({
          kind: "ok",
          data: {
            _id: "replacement-terminal",
            _creationTime: 2,
            storeId: "store-1",
            fingerprintHash: "fingerprint-1",
            syncSecretHash: "fresh-proof",
            displayName: "Front register",
            registeredByUserId: "user-1",
            browserInfo: { userAgent: "test" },
            registeredAt: 2,
            status: "active",
          },
        } as never),
        reconnectIntentToken: "intent",
        storeFactory: () => store as never,
      }),
    ).rejects.toThrow("same terminal record");
    expect(writeProvisionedTerminalSeed).not.toHaveBeenCalled();
  });
});
