import { render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { LoginLayout } from "./_layout";
import {
  LOGGED_IN_USER_ID_KEY,
  PENDING_ATHENA_AUTH_SYNC_KEY,
} from "~/src/lib/constants";
import { ok, userError } from "~/shared/commandResult";

const mocked = vi.hoisted(() => ({
  useConvexAuth: vi.fn(),
  useAuthToken: vi.fn(),
  useConvexAuthIdentity: vi.fn(),
  syncAuthenticatedAthenaUser: vi.fn(),
}));

vi.mock("convex/react", () => ({
  useConvexAuth: mocked.useConvexAuth,
  useMutation: () => mocked.syncAuthenticatedAthenaUser,
}));

vi.mock("@convex-dev/auth/react", () => ({
  useAuthToken: mocked.useAuthToken,
}));

vi.mock("@/hooks/useConvexAuthIdentity", () => ({
  useConvexAuthIdentity: mocked.useConvexAuthIdentity,
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => () => ({}),
  Link: ({ children, to, ...props }: { children: ReactNode; to: string }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
  Outlet: () => <div>Mock Login Outlet</div>,
}));

describe("LoginLayout", () => {
  beforeEach(() => {
    mocked.useConvexAuth.mockReset();
    mocked.useAuthToken.mockReset();
    mocked.useConvexAuthIdentity.mockReset();
    mocked.syncAuthenticatedAthenaUser.mockReset();
    mocked.useAuthToken.mockReturnValue(null);
    mocked.useConvexAuthIdentity.mockReturnValue(null);
    window.sessionStorage.clear();
    vi.mocked(window.sessionStorage.getItem).mockReset();
  });

  it("keeps the login outlet mounted while auth state is loading", () => {
    mocked.useConvexAuth.mockReturnValue({
      isAuthenticated: false,
      isLoading: true,
    });

    render(<LoginLayout />);

    expect(screen.getByText("Mock Login Outlet")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /athena/i })).toHaveLength(2);
  });

  it("waits for the Convex session before retrying the pending Athena-user sync", async () => {
    const authState = {
      isAuthenticated: false,
      isLoading: true,
    };

    mocked.useConvexAuth.mockImplementation(() => authState);
    mocked.useAuthToken.mockImplementation(() =>
      authState.isAuthenticated ? "jwt-123" : null
    );
    mocked.syncAuthenticatedAthenaUser
      .mockResolvedValueOnce(
        userError({
          code: "authentication_failed",
          message: "Sign in again to continue.",
          retryable: true,
        })
      )
      .mockResolvedValue(ok({ _id: "user-1" }));
    window.sessionStorage.setItem(PENDING_ATHENA_AUTH_SYNC_KEY, "1");
    vi.mocked(window.sessionStorage.getItem).mockReturnValue("1");

    const view = render(<LoginLayout />);

    expect(mocked.syncAuthenticatedAthenaUser).not.toHaveBeenCalled();

    authState.isLoading = false;
    authState.isAuthenticated = true;
    view.rerender(<LoginLayout />);

    await waitFor(() =>
      expect(mocked.syncAuthenticatedAthenaUser).toHaveBeenCalledTimes(2)
    );
    expect(window.localStorage.setItem).toHaveBeenCalledWith(
      LOGGED_IN_USER_ID_KEY,
      "user-1"
    );
  });

  it("recovers an authenticated Convex session even when the pending sync flag is missing", async () => {
    mocked.useConvexAuth.mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
    });
    mocked.useAuthToken.mockReturnValue("jwt-123");
    mocked.syncAuthenticatedAthenaUser.mockResolvedValue(ok({ _id: "user-2" }));
    vi.mocked(window.sessionStorage.getItem).mockReturnValue(null);

    render(<LoginLayout />);

    await waitFor(() =>
      expect(mocked.syncAuthenticatedAthenaUser).toHaveBeenCalledTimes(1)
    );
    expect(window.localStorage.setItem).toHaveBeenCalledWith(
      LOGGED_IN_USER_ID_KEY,
      "user-2"
    );
  });

  it("surfaces safe auth-sync user errors without storing a bogus Athena user id", async () => {
    mocked.useConvexAuth.mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
    });
    mocked.useAuthToken.mockReturnValue("jwt-123");
    mocked.syncAuthenticatedAthenaUser.mockResolvedValue(
      userError({
        code: "authentication_failed",
        message: "Sign in again to continue.",
      })
    );
    vi.mocked(window.sessionStorage.getItem).mockReturnValue("1");

    render(<LoginLayout />);

    await waitFor(() =>
      expect(
        screen.getByText("Sign in again to continue.")
      ).toBeInTheDocument()
    );
    expect(window.localStorage.setItem).not.toHaveBeenCalledWith(
      LOGGED_IN_USER_ID_KEY,
      undefined
    );
  });

  it("completes auth recovery after the Convex identity settles during an in-flight sync", async () => {
    let resolveDeferred!: (value: { _id: string }) => void;
    const deferred = new Promise<{ _id: string }>((resolve) => {
      resolveDeferred = resolve;
    });
    let authIdentity: null | undefined = undefined;

    mocked.useConvexAuth.mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
    });
    mocked.useAuthToken.mockReturnValue("jwt-123");
    mocked.useConvexAuthIdentity.mockImplementation(() => authIdentity);
    mocked.syncAuthenticatedAthenaUser.mockReturnValue(
      deferred.then((value) => ok(value))
    );
    vi.mocked(window.sessionStorage.getItem).mockReturnValue(null);

    const view = render(<LoginLayout />);

    await waitFor(() =>
      expect(mocked.syncAuthenticatedAthenaUser).toHaveBeenCalledTimes(1)
    );

    authIdentity = null;
    view.rerender(<LoginLayout />);
    resolveDeferred({ _id: "user-3" });

    await waitFor(() =>
      expect(window.localStorage.setItem).toHaveBeenCalledWith(
        LOGGED_IN_USER_ID_KEY,
        "user-3"
      )
    );
  });
});
