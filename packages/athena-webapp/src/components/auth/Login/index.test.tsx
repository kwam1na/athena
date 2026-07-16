import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ATHENA_POS_RECOVERY_CODE_PROVIDER_ID } from "../../../../shared/auth";
import { Login } from "./index";
import { PENDING_ATHENA_AUTH_SYNC_KEY } from "~/src/lib/constants";

function expectPendingAuthSyncRedirect(redirectTo: string) {
  const handoffCall = vi
    .mocked(window.sessionStorage.setItem)
    .mock.calls.find(([key]) => key === PENDING_ATHENA_AUTH_SYNC_KEY);
  expect(handoffCall).toBeDefined();
  const handoff = JSON.parse(String(handoffCall?.[1])) as {
    redirectTo?: string;
    startedAt?: unknown;
  };

  expect(handoff.redirectTo).toBe(redirectTo);
  expect(typeof handoff.startedAt).toBe("number");
}

const mocked = vi.hoisted(() => ({
  checkAppLoginEmailApproval: vi.fn(),
  navigate: vi.fn(),
  readProvisionedTerminalSeed: vi.fn(),
  signIn: vi.fn(),
  useSearch: vi.fn(),
}));

vi.mock("@convex-dev/auth/react", () => ({
  useAuthActions: () => ({ signIn: mocked.signIn }),
}));

vi.mock("convex/react", () => ({
  useConvex: () => ({
    query: mocked.checkAppLoginEmailApproval,
  }),
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mocked.navigate,
  useSearch: mocked.useSearch,
}));

vi.mock("@/lib/pos/infrastructure/local/posLocalStorageRuntime", () => ({
  getDefaultPosLocalStore: () => ({
    readProvisionedTerminalSeed: mocked.readProvisionedTerminalSeed,
  }),
}));

describe("Login", () => {
  beforeEach(() => {
    mocked.checkAppLoginEmailApproval.mockReset();
    mocked.checkAppLoginEmailApproval.mockResolvedValue({ approved: true });
    mocked.navigate.mockReset();
    mocked.readProvisionedTerminalSeed.mockReset();
    mocked.readProvisionedTerminalSeed.mockResolvedValue({
      ok: true,
      value: null,
    });
    mocked.signIn.mockReset();
    mocked.useSearch.mockReset();
    vi.stubGlobal("indexedDB", {});
    window.sessionStorage.clear();
    vi.mocked(window.sessionStorage.setItem).mockReset();
  });

  it("passes POS route scope from redirectTo into recovery-code sign-in", async () => {
    const user = userEvent.setup();
    mocked.signIn.mockResolvedValue({ signingIn: true });
    mocked.useSearch.mockReturnValue({
      redirectTo: "/wigclub/store/wigclub/pos/register",
    });
    mocked.readProvisionedTerminalSeed.mockResolvedValue({
      ok: true,
      value: {
        cloudTerminalId: "terminal-1",
        displayName: "Front register",
        provisionedAt: 1,
        schemaVersion: 7,
        storeId: "store-1",
        syncSecretHash: "secret-hash",
        terminalId: "fingerprint-1",
      },
    });

    render(<Login />);

    await user.click(
      await screen.findByRole("button", {
        name: "Sign in to Front register",
      }),
    );
    await user.type(screen.getByLabelText(/recovery code/i), "abc-123");
    await user.click(screen.getByRole("button", { name: /continue/i }));

    await waitFor(() =>
      expect(mocked.signIn).toHaveBeenCalledWith(
        ATHENA_POS_RECOVERY_CODE_PROVIDER_ID,
        {
          code: "abc-123",
          email: "pos@wigclub.store",
          orgUrlSlug: "wigclub",
          storeId: "store-1",
          storeUrlSlug: "wigclub",
        },
      ),
    );
    expectPendingAuthSyncRedirect("/wigclub/store/wigclub/pos/register");
    expect(mocked.navigate).not.toHaveBeenCalled();
  });

  it("uses the provisioned local terminal seed for generic login recovery", async () => {
    const user = userEvent.setup();
    mocked.signIn.mockResolvedValue({ signingIn: true });
    mocked.useSearch.mockReturnValue({});
    mocked.readProvisionedTerminalSeed.mockResolvedValue({
      ok: true,
      value: {
        cloudTerminalId: "terminal-1",
        displayName: "Front register",
        orgUrlSlug: "wigclub",
        provisionedAt: 1,
        schemaVersion: 7,
        storeId: "store-1",
        storeUrlSlug: "wigclub",
        syncSecretHash: "secret-hash",
        terminalId: "fingerprint-1",
      },
    });

    render(<Login />);

    await user.click(
      await screen.findByRole("button", {
        name: "Sign in to Front register",
      }),
    );
    expect(
      screen.getByText("Sign in to Front register with the recovery code."),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(
        screen.queryByText("Open recovery from the store login route."),
      ).not.toBeInTheDocument(),
    );
    await user.type(screen.getByLabelText(/recovery code/i), "abc-123");
    await user.click(screen.getByRole("button", { name: /continue/i }));

    await waitFor(() =>
      expect(mocked.signIn).toHaveBeenCalledWith(
        ATHENA_POS_RECOVERY_CODE_PROVIDER_ID,
        {
          code: "abc-123",
          email: "pos@wigclub.store",
          orgUrlSlug: "wigclub",
          storeId: "store-1",
          storeUrlSlug: "wigclub",
        },
      ),
    );
    expectPendingAuthSyncRedirect("/wigclub/store/wigclub/pos");
    expect(mocked.navigate).not.toHaveBeenCalled();
  });

  it("defaults POS-only provisioned terminals to POS recovery while keeping email secondary", async () => {
    mocked.useSearch.mockReturnValue({});
    mocked.readProvisionedTerminalSeed.mockResolvedValue({
      ok: true,
      value: {
        cloudTerminalId: "terminal-1",
        displayName: "Front register",
        loginMode: "pos_only",
        orgUrlSlug: "wigclub",
        provisionedAt: 1,
        schemaVersion: 8,
        storeId: "store-1",
        storeUrlSlug: "wigclub",
        syncSecretHash: "secret-hash",
        terminalId: "fingerprint-1",
      },
    });

    render(<Login />);

    expect(
      await screen.findByRole("heading", { name: /pos recovery/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /use email code/i }),
    ).toBeInTheDocument();
  });

  it("uses an existing provisioned terminal seed without slugs for store-scoped recovery", async () => {
    const user = userEvent.setup();
    mocked.signIn.mockResolvedValue({ signingIn: true });
    mocked.useSearch.mockReturnValue({});
    mocked.readProvisionedTerminalSeed.mockResolvedValue({
      ok: true,
      value: {
        cloudTerminalId: "terminal-1",
        displayName: "Front register",
        provisionedAt: 1,
        schemaVersion: 7,
        storeId: "store-1",
        syncSecretHash: "secret-hash",
        terminalId: "fingerprint-1",
      },
    });

    render(<Login />);

    await user.click(
      await screen.findByRole("button", {
        name: "Sign in to Front register",
      }),
    );
    await waitFor(() =>
      expect(
        screen.queryByText("Open recovery from the store login route."),
      ).not.toBeInTheDocument(),
    );
    await user.type(screen.getByLabelText(/recovery code/i), "abc-123");
    await user.click(screen.getByRole("button", { name: /continue/i }));

    await waitFor(() =>
      expect(mocked.signIn).toHaveBeenCalledWith(
        ATHENA_POS_RECOVERY_CODE_PROVIDER_ID,
        {
          code: "abc-123",
          email: "pos@wigclub.store",
          storeId: "store-1",
        },
      ),
    );
    expectPendingAuthSyncRedirect("/");
    expect(mocked.navigate).not.toHaveBeenCalled();
  });

  it("hides POS sign-in when the browser has no provisioned terminal seed", async () => {
    mocked.useSearch.mockReturnValue({ redirectTo: "/login" });

    render(<Login />);

    await waitFor(() =>
      expect(mocked.readProvisionedTerminalSeed).toHaveBeenCalledOnce(),
    );
    expect(
      screen.queryByTestId("athena-login-pos-sign-in"),
    ).not.toBeInTheDocument();
    expect(mocked.signIn).not.toHaveBeenCalled();
  });
});
