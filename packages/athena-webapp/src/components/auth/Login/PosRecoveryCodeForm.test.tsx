import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ATHENA_POS_RECOVERY_CODE_PROVIDER_ID } from "../../../../shared/auth";
import {
  ATHENA_AUTH_SYNC_FAILED_EVENT,
  PENDING_ATHENA_AUTH_SYNC_KEY,
} from "~/src/lib/constants";
import { PosRecoveryCodeForm } from "./PosRecoveryCodeForm";

const mocked = vi.hoisted(() => ({
  navigate: vi.fn(),
  signIn: vi.fn(),
}));

vi.mock("@convex-dev/auth/react", () => ({
  useAuthActions: () => ({ signIn: mocked.signIn }),
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mocked.navigate,
}));

describe("PosRecoveryCodeForm", () => {
  beforeEach(() => {
    mocked.navigate.mockReset();
    mocked.signIn.mockReset();
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  it("signs in the POS account and starts the shared Athena auth-sync handoff", async () => {
    const user = userEvent.setup();
    mocked.signIn.mockResolvedValue({ signingIn: true });

    render(
      <PosRecoveryCodeForm
        orgUrlSlug="wigclub"
        redirectTo="/wigclub/store/wigclub/pos/register"
        storeUrlSlug="wigclub"
        onBack={vi.fn()}
      />,
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
          storeUrlSlug: "wigclub",
        },
      ),
    );
    expect(window.sessionStorage.setItem).toHaveBeenCalledWith(
      PENDING_ATHENA_AUTH_SYNC_KEY,
      "1",
    );
    expect(mocked.navigate).toHaveBeenCalledWith({
      to: "/wigclub/store/wigclub/pos/register",
    });
    expect(window.localStorage.setItem).not.toHaveBeenCalledWith(
      expect.any(String),
      "abc-123",
    );
    expect(window.sessionStorage.setItem).not.toHaveBeenCalledWith(
      expect.any(String),
      "abc-123",
    );
  });

  it("uses generic failure copy for rejected recovery sign-in", async () => {
    const user = userEvent.setup();
    mocked.signIn.mockResolvedValue({ signingIn: false });

    render(
      <PosRecoveryCodeForm
        orgUrlSlug="wigclub"
        storeUrlSlug="wigclub"
        onBack={vi.fn()}
      />,
    );

    await user.type(screen.getByLabelText(/recovery code/i), "wrong-code");
    await user.click(screen.getByRole("button", { name: /continue/i }));

    expect(
      await screen.findByText(
        "Sign-in details not recognized. Enter the recovery code again.",
      ),
    ).toBeInTheDocument();
    expect(mocked.navigate).not.toHaveBeenCalled();
  });

  it("reenables the form when auth sync fails after provider success", async () => {
    const user = userEvent.setup();
    mocked.signIn.mockResolvedValue({ signingIn: true });

    render(
      <PosRecoveryCodeForm storeId="store-1" onBack={vi.fn()} />,
    );

    await user.type(screen.getByLabelText(/recovery code/i), "abc-123");
    await user.click(screen.getByRole("button", { name: /continue/i }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /continue/i })).toBeDisabled(),
    );

    act(() => {
      window.dispatchEvent(new Event(ATHENA_AUTH_SYNC_FAILED_EVENT));
    });

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /continue/i })).toBeEnabled(),
    );
  });

  it("falls back to home when the redirect target is external", async () => {
    const user = userEvent.setup();
    mocked.signIn.mockResolvedValue({ signingIn: true });

    render(
      <PosRecoveryCodeForm
        orgUrlSlug="wigclub"
        redirectTo="//attacker.example/pos"
        storeUrlSlug="wigclub"
        onBack={vi.fn()}
      />,
    );

    await user.type(screen.getByLabelText(/recovery code/i), "abc-123");
    await user.click(screen.getByRole("button", { name: /continue/i }));

    await waitFor(() => expect(mocked.navigate).toHaveBeenCalledWith({ to: "/" }));
  });

  it("navigates query-bearing recovery redirects with separate search params", async () => {
    const user = userEvent.setup();
    mocked.signIn.mockResolvedValue({ signingIn: true });

    render(
      <PosRecoveryCodeForm
        orgUrlSlug="wigclub"
        redirectTo="/wigclub/store/wigclub/pos/register?drawer=front"
        storeUrlSlug="wigclub"
        onBack={vi.fn()}
      />,
    );

    await user.type(screen.getByLabelText(/recovery code/i), "abc-123");
    await user.click(screen.getByRole("button", { name: /continue/i }));

    await waitFor(() =>
      expect(mocked.navigate).toHaveBeenCalledWith({
        to: "/wigclub/store/wigclub/pos/register",
        search: { drawer: "front" },
      }),
    );
  });
});
