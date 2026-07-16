import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createAuthRuntimeHandoffCoordinator } from "../../../lib/auth/authRuntimeHandoff";
import { PosRecoveryCodeForm } from "./PosRecoveryCodeForm";
import type { PosRecoveryFrontendAdapter } from "./posRecoveryFlow";

describe("PosRecoveryCodeForm", () => {
  beforeEach(() => {
    window.localStorage.clear();
    Object.defineProperty(window, "sessionStorage", {
      configurable: true,
      value: createMemoryStorage(),
    });
  });

  it("shows setup-required guidance without local terminal evidence", async () => {
    const user = userEvent.setup();
    const onUseAdministratorEmail = vi.fn();
    renderForm({ terminal: null, onUseAdministratorEmail });

    expect(
      screen.getByRole("heading", { name: /setup required/i }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText(/recovery code/i)).toBeNull();
    await user.click(
      screen.getByRole("button", { name: /sign in as administrator/i }),
    );
    expect(onUseAdministratorEmail).toHaveBeenCalledTimes(1);
  });

  it("shows store and terminal identity and never renders a POS account field", async () => {
    const user = userEvent.setup();
    const { adapter } = renderForm();

    expect(await screen.findByText("wigclub")).toBeInTheDocument();
    expect(screen.getByText("Front register")).toBeInTheDocument();
    expect(screen.queryByLabelText(/POS account/i)).toBeNull();
    expect(screen.queryByDisplayValue("pos@wigclub.store")).toBeNull();

    await user.type(screen.getByLabelText(/recovery code/i), "abc-123");
    await user.click(screen.getByRole("button", { name: /continue/i }));

    await waitFor(() => expect(adapter.issue).toHaveBeenCalledTimes(1));
    expect(adapter.issue).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "abc-123",
        terminalId: "terminal-1",
        terminalProof: "terminal-proof",
      }),
    );
    expect(
      await screen.findByText(/checkout station signed in/i),
    ).toBeInTheDocument();
  });

  it("retries activation without issuing a second Auth session", async () => {
    const user = userEvent.setup();
    const adapter = createAdapter();
    adapter.activate = vi
      .fn()
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce(activation);
    renderForm({ adapter });

    await user.type(await screen.findByLabelText(/recovery code/i), "abc-123");
    await user.click(screen.getByRole("button", { name: /continue/i }));
    expect(
      await screen.findByRole("button", { name: /try again/i }),
    ).toBeEnabled();
    await user.click(screen.getByRole("button", { name: /try again/i }));

    expect(
      await screen.findByText(/checkout station signed in/i),
    ).toBeInTheDocument();
    expect(adapter.issue).toHaveBeenCalledTimes(1);
    expect(adapter.activate).toHaveBeenCalledTimes(2);
  });

  it("retries post-promotion verification without issuing or activating again", async () => {
    const user = userEvent.setup();
    const adapter = createAdapter();
    adapter.assertActivatedSession = vi
      .fn()
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce(undefined);
    renderForm({ adapter });

    await user.type(await screen.findByLabelText(/recovery code/i), "abc-123");
    await user.click(screen.getByRole("button", { name: /continue/i }));
    await user.click(await screen.findByRole("button", { name: /try again/i }));

    expect(
      await screen.findByText(/checkout station signed in/i),
    ).toBeInTheDocument();
    expect(adapter.issue).toHaveBeenCalledTimes(1);
    expect(adapter.activate).toHaveBeenCalledTimes(1);
    expect(adapter.assertActivatedSession).toHaveBeenCalledTimes(2);
  });

  it("routes revoked exact evidence to administrator reconnect without POS sign-in", async () => {
    const user = userEvent.setup();
    const adapter = createAdapter();
    const onUseAdministratorEmail = vi.fn();
    adapter.requestDisposition = vi.fn(async () => ({
      disposition: "administrator_reconnect_required" as const,
      expiresAt: Date.now() + 60_000,
      reconnectIntentToken: "opaque-reconnect-token-123456",
    }));
    renderForm({ adapter, onUseAdministratorEmail });

    expect(
      await screen.findByRole("heading", { name: /station disconnected/i }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText(/recovery code/i)).toBeNull();
    await user.click(
      screen.getByRole("button", { name: /sign in as administrator/i }),
    );
    expect(onUseAdministratorEmail).toHaveBeenCalledTimes(1);
    expect(adapter.issue).not.toHaveBeenCalled();
    expect(
      JSON.parse(
        sessionStorage.getItem("athena.posTerminalReconnectIntent.v1") ??
          "null",
      ),
    ).toEqual({
        expiresAt: expect.any(Number),
        reconnectIntentToken: "opaque-reconnect-token-123456",
        version: 1,
      });
  });
});

const activation = {
  authorityExpiresAt: 10_000,
  offlineAuthorityReceipt: "receipt-1",
  posApplicationSessionBindingId: "binding-1",
  servicePrincipalSessionId: "session-1",
  storeId: "store-1",
  terminalId: "terminal-1",
};

function renderForm(
  overrides: Partial<ComponentProps<typeof PosRecoveryCodeForm>> = {},
) {
  const adapter = overrides.adapter ?? createAdapter();
  const authRuntime = overrides.authRuntime ?? createCoordinator();
  const view = render(
    <PosRecoveryCodeForm
      adapter={adapter}
      authRuntime={authRuntime}
      onBack={vi.fn()}
      onUseAdministratorEmail={vi.fn()}
      redirectTo="/wigclub/store/wigclub/pos"
      terminal={{
        browserFingerprintHash: "fingerprint-1",
        displayName: "Front register",
        storeName: "wigclub",
        terminalId: "terminal-1",
        terminalProof: "terminal-proof",
      }}
      {...overrides}
    />,
  );
  return { adapter, authRuntime, view };
}

function createAdapter(): PosRecoveryFrontendAdapter {
  return {
    requestDisposition: vi.fn(async () => ({
      disposition: "recovery_code_required" as const,
    })),
    issue: vi.fn(async () => undefined),
    activate: vi.fn(async () => activation),
    assertActivatedSession: vi.fn(async () => undefined),
    abort: vi.fn(async () => undefined),
  };
}

function createCoordinator() {
  let sequence = 0;
  return createAuthRuntimeHandoffCoordinator({
    now: () => 1_000,
    ownerToken: "form-test-owner",
    randomId: () => `form-generated-${++sequence}-12345678`,
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
