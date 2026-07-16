import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createAuthRuntimeHandoffCoordinator } from "../../../lib/auth/authRuntimeHandoff";
import { ATHENA_POS_RECOVERY_CODE_PROVIDER_ID } from "../../../../shared/auth";
import { ProductionPosRecoveryCodeForm } from "./PosRecoveryFrontendAdapter";

const activation = {
  authorityExpiresAt: 10_000,
  offlineAuthorityReceipt: "receipt-1",
  posApplicationSessionBindingId: "binding-1",
  servicePrincipalSessionId: "session-1",
  status: "activated" as const,
  storeId: "store-1",
  terminalId: "terminal-1",
};

const mocked = vi.hoisted(() => ({
  abort: vi.fn(),
  activate: vi.fn(),
  mutationHookCall: 0,
  query: vi.fn(),
  requestDisposition: vi.fn(),
  readSeed: vi.fn(),
  signIn: vi.fn(),
  verifyReceipt: vi.fn(),
  writeSeed: vi.fn(),
}));

vi.mock("@convex-dev/auth/react", () => ({
  ConvexAuthProvider: ({ children }: { children: ReactNode }) => children,
  useAuthActions: () => ({ signIn: mocked.signIn }),
}));
vi.mock("convex/react", () => ({
  ConvexReactClient: class {
    close = vi.fn();
  },
  useMutation: (reference: string) =>
    reference === "requestPosTerminalRecoveryDisposition"
      ? mocked.requestDisposition
      : reference === "activatePreparedPosTerminalSession"
        ? mocked.activate
        : mocked.abort,
}));
vi.mock("~/convex/_generated/api", () => ({
  api: {
    pos: {
      public: {
        posRecoveryCodes: {
          requestPosTerminalRecoveryDisposition:
            "requestPosTerminalRecoveryDisposition",
        },
        terminalAppSessions: {
          abortPreparedPosTerminalSession: "abortPreparedPosTerminalSession",
          activatePreparedPosTerminalSession:
            "activatePreparedPosTerminalSession",
          getCurrentPosTerminalServiceSession:
            "getCurrentPosTerminalServiceSession",
        },
      },
    },
  },
}));
vi.mock("../../../lib/convexClient", () => ({
  convex: { query: mocked.query },
}));
vi.mock("@/lib/pos/security/offlineAuthorityPublicKeys", () => ({
  verifyPosOfflineAuthorityReceipt: mocked.verifyReceipt,
}));
vi.mock("@/lib/pos/infrastructure/local/posLocalStorageRuntime", () => ({
  getDefaultPosLocalStore: () => ({
    readProvisionedTerminalSeed: mocked.readSeed,
    writeProvisionedTerminalSeed: mocked.writeSeed,
  }),
}));

describe("production POS recovery adapter", () => {
  beforeEach(() => {
    mocked.abort.mockReset();
    mocked.activate.mockReset();
    mocked.query.mockReset();
    mocked.requestDisposition.mockReset();
    mocked.readSeed.mockReset();
    mocked.signIn.mockReset();
    mocked.verifyReceipt.mockReset();
    mocked.writeSeed.mockReset();
    mocked.mutationHookCall = 0;
    mocked.signIn.mockResolvedValue({ signingIn: true });
    mocked.requestDisposition.mockResolvedValue({
      disposition: "recovery_code_required",
    });
    mocked.activate.mockResolvedValue(activation);
    mocked.query.mockResolvedValue({ ...activation, authSessionId: "auth-1" });
    mocked.verifyReceipt.mockResolvedValue({
      status: "valid",
      receipt: {
        envelope: "receipt-1",
        payload: { nonce: "nonce-1", version: 1 },
        verifiedAt: 9_000,
      },
    });
    mocked.readSeed.mockResolvedValue({
      ok: true,
      value: {
        cloudTerminalId: "terminal-1",
        displayName: "Front register",
        provisionedAt: 1,
        schemaVersion: 2,
        storeId: "store-1",
        syncSecretHash: "proof",
        terminalId: "fingerprint-1",
      },
    });
    mocked.writeSeed.mockResolvedValue({ ok: true, value: {} });
  });

  it("binds the isolated provider, activation mutation, and remount assertion", async () => {
    const user = userEvent.setup();
    render(
      <ProductionPosRecoveryCodeForm
        authRuntime={createCoordinator()}
        onBack={vi.fn()}
        onUseAdministratorEmail={vi.fn()}
        redirectTo="/wigclub/store/wigclub/pos/register"
        terminal={{
          browserFingerprintHash: "fingerprint-1",
          displayName: "Front register",
          storeName: "wigclub",
          terminalId: "terminal-1",
          terminalProof: "terminal-proof",
        }}
      />,
    );

    await user.type(await screen.findByLabelText(/recovery code/i), "abc-123");
    await user.click(screen.getByRole("button", { name: /continue/i }));

    expect(
      await screen.findByText(/checkout station signed in/i),
    ).toBeInTheDocument();
    expect(mocked.signIn).toHaveBeenCalledWith(
      ATHENA_POS_RECOVERY_CODE_PROVIDER_ID,
      {
        code: "abc-123",
        recoveryCorrelationKey: expect.any(String),
        terminalId: "terminal-1",
        terminalProof: "terminal-proof",
      },
    );
    expect(mocked.requestDisposition).toHaveBeenCalledWith({
      browserFingerprintHash: "fingerprint-1",
      terminalId: "terminal-1",
      terminalProof: "terminal-proof",
    });
    expect(mocked.activate).toHaveBeenCalledWith({});
    expect(mocked.query).toHaveBeenCalledWith(expect.anything(), {});
    expect(mocked.verifyReceipt).toHaveBeenCalledWith({
      envelope: "receipt-1",
      expectedStoreId: "store-1",
      expectedTerminalId: "terminal-1",
    });
    expect(mocked.writeSeed).toHaveBeenCalledWith(
      expect.objectContaining({
        offlineAuthorityReceipt: expect.objectContaining({
          envelope: "receipt-1",
        }),
      }),
    );
  });
});

function createCoordinator() {
  let sequence = 0;
  return createAuthRuntimeHandoffCoordinator({
    now: () => 1_000,
    ownerToken: "adapter-test-owner",
    randomId: () => `adapter-generated-${++sequence}-12345678`,
    storage: createMemoryStorage(),
  });
}

function createMemoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };
}
