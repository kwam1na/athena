import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createAuthRuntimeHandoffCoordinator } from "../../../lib/auth/authRuntimeHandoff";
import { Login } from "./index";
import type { PosRecoveryFrontendAdapter } from "./posRecoveryFlow";

const mocked = vi.hoisted(() => ({
  readProvisionedTerminalSeed: vi.fn(),
  generateBrowserFingerprint: vi.fn(),
  useSearch: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({ useSearch: mocked.useSearch }));
vi.mock("convex/react", () => ({
  ConvexReactClient: class {
    query = vi.fn();
  },
  useMutation: vi.fn(),
}));
vi.mock("@convex-dev/auth/react", () => ({
  useAuthActions: () => ({ signIn: vi.fn() }),
}));
vi.mock("@/lib/pos/infrastructure/local/posLocalStorageRuntime", () => ({
  getDefaultPosLocalStore: () => ({
    readProvisionedTerminalSeed: mocked.readProvisionedTerminalSeed,
  }),
}));
vi.mock("@/lib/browserFingerprint", () => ({
  generateBrowserFingerprint: mocked.generateBrowserFingerprint,
}));

describe("Login", () => {
  beforeEach(() => {
    mocked.readProvisionedTerminalSeed.mockReset();
    mocked.generateBrowserFingerprint.mockReset();
    mocked.generateBrowserFingerprint.mockResolvedValue({
      browserInfo: { userAgent: "test" },
      fingerprintHash: "fingerprint-current",
    });
    mocked.useSearch.mockReturnValue({});
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  it("waits for local terminal evidence before choosing a login mode", async () => {
    let resolveSeed!: (value: unknown) => void;
    mocked.readProvisionedTerminalSeed.mockReturnValue(
      new Promise((resolve) => {
        resolveSeed = resolve;
      }),
    );
    renderLogin();

    expect(
      screen.getByText(/checking this checkout station/i),
    ).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /log in/i })).toBeNull();
    await act(async () => {
      resolveSeed({ ok: true, value: null });
    });
    expect(
      await screen.findByRole("heading", { name: /log in/i }),
    ).toBeInTheDocument();
  });

  it("shows setup required when POS recovery has no local enrollment", async () => {
    const user = userEvent.setup();
    mocked.readProvisionedTerminalSeed.mockResolvedValue({
      ok: true,
      value: null,
    });
    renderLogin();

    await user.click(
      await screen.findByRole("button", { name: /pos sign in/i }),
    );
    expect(
      screen.getByRole("heading", { name: /setup required/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /sign in as administrator/i }),
    ).toBeInTheDocument();
  });

  it("opens POS-only terminals directly with local store and terminal identity", async () => {
    mocked.readProvisionedTerminalSeed.mockResolvedValue({
      ok: true,
      value: {
        cloudTerminalId: "terminal-1",
        displayName: "Front register",
        loginMode: "pos_only",
        provisionedAt: 1,
        schemaVersion: 8,
        storeId: "store-1",
        storeUrlSlug: "wigclub",
        syncSecretHash: "terminal-proof",
        terminalId: "fingerprint-1",
      },
    });
    renderLogin();

    expect(
      await screen.findByRole("heading", { name: /pos recovery/i }),
    ).toBeInTheDocument();
    expect(screen.getByText("wigclub")).toBeInTheDocument();
    expect(screen.getByText("Front register")).toBeInTheDocument();
    expect(screen.queryByText("pos@wigclub.store")).toBeNull();
  });
});

function renderLogin() {
  let sequence = 0;
  const authRuntime = createAuthRuntimeHandoffCoordinator({
    now: () => 1_000,
    ownerToken: "login-test-owner",
    randomId: () => `login-generated-${++sequence}-12345678`,
    storage: createMemoryStorage(),
  });
  const recoveryAdapter: PosRecoveryFrontendAdapter = {
    requestDisposition: vi.fn(async () => ({
      disposition: "recovery_code_required" as const,
    })),
    issue: vi.fn(async () => undefined),
    activate: vi.fn(async () => ({
      authorityExpiresAt: 10_000,
      offlineAuthorityReceipt: "receipt-1",
      posApplicationSessionBindingId: "binding-1",
      servicePrincipalSessionId: "session-1",
      storeId: "store-1",
      terminalId: "terminal-1",
    })),
    assertActivatedSession: vi.fn(async () => undefined),
    abort: vi.fn(async () => undefined),
  };
  return render(
    <Login authRuntime={authRuntime} recoveryAdapter={recoveryAdapter} />,
  );
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
