import { render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { LoginLayout } from "./_layout";
import {
  LOGGED_IN_USER_ID_KEY,
  PENDING_ATHENA_AUTH_SYNC_KEY,
} from "~/src/lib/constants";

const mocked = vi.hoisted(() => ({
  useConvexAuth: vi.fn(),
  syncAuthenticatedAthenaUser: vi.fn(),
}));

vi.mock("convex/react", () => ({
  useConvexAuth: mocked.useConvexAuth,
  useMutation: () => mocked.syncAuthenticatedAthenaUser,
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
    mocked.syncAuthenticatedAthenaUser.mockReset();
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

  it("retries the pending Athena-user sync until the authenticated session is ready", async () => {
    mocked.useConvexAuth.mockReturnValue({
      isAuthenticated: false,
      isLoading: false,
    });
    mocked.syncAuthenticatedAthenaUser
      .mockRejectedValueOnce(new Error("Sign in again to continue."))
      .mockResolvedValue({ _id: "user-1" });
    window.sessionStorage.setItem(PENDING_ATHENA_AUTH_SYNC_KEY, "1");
    vi.mocked(window.sessionStorage.getItem).mockReturnValue("1");

    render(<LoginLayout />);

    await waitFor(() =>
      expect(mocked.syncAuthenticatedAthenaUser).toHaveBeenCalledTimes(2)
    );
    expect(window.localStorage.setItem).toHaveBeenCalledWith(
      LOGGED_IN_USER_ID_KEY,
      "user-1"
    );
  });
});
