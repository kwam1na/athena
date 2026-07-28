import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ATHENA_HAS_AUTHENTICATED_KEY,
  LOGGED_IN_USER_ID_KEY,
} from "@/lib/constants";
import { AppEntryDispatcher, AppEntryRoute } from "./-app-entry-route";

const mocked = vi.hoisted(() => ({
  navigate: vi.fn(),
  navigationShortcuts: vi.fn(),
  useAuth: vi.fn(),
  useQuery: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => () => ({}),
  useNavigate: () => mocked.navigate,
}));

vi.mock("../hooks/useAuth", () => ({
  useAuth: mocked.useAuth,
}));

vi.mock("convex/react", () => ({
  useQuery: mocked.useQuery,
}));

vi.mock("@/hooks/use-navigation-keyboard-shortcuts", () => ({
  useNavigationKeyboardShortcuts: mocked.navigationShortcuts,
}));

vi.mock("@/components/app-update/UpdateReadyBanner", () => ({
  UpdateReadyBanner: () => <div data-testid="update-ready-banner" />,
}));

vi.mock("@/components/OrganizationsView", () => ({
  default: () => <div data-testid="organizations-view">Organizations view</div>,
}));

vi.mock("@/components/ui/modals/organization-modal", () => ({
  OrganizationModal: () => <div data-testid="organization-modal" />,
}));

describe("App entry route", () => {
  beforeEach(() => {
    mocked.navigate.mockReset();
    mocked.navigationShortcuts.mockReset();
    mocked.useAuth.mockReset();
    mocked.useQuery.mockReset();
    vi.mocked(window.localStorage.getItem).mockReset();
    vi.mocked(window.localStorage.getItem).mockReturnValue(null);
  });

  it("owns operational chrome exactly once", () => {
    mocked.useAuth.mockReturnValue({ user: undefined, isLoading: true });
    mocked.useQuery.mockReturnValue(undefined);

    render(<AppEntryRoute />);

    expect(screen.getByTestId("update-ready-banner")).toBeInTheDocument();
    expect(mocked.navigationShortcuts).toHaveBeenCalledTimes(1);
  });

  it("stays empty while the authenticated user is loading", () => {
    mocked.useAuth.mockReturnValue({ user: undefined, isLoading: true });
    mocked.useQuery.mockReturnValue(undefined);

    render(<AppEntryDispatcher />);

    expect(screen.queryByTestId("organizations-view")).not.toBeInTheDocument();
    expect(mocked.navigate).not.toHaveBeenCalled();
  });

  it("redirects first-time signed-out visitors to the landing page", async () => {
    mocked.useAuth.mockReturnValue({ user: null, isLoading: false });
    mocked.useQuery.mockReturnValue(undefined);

    render(<AppEntryDispatcher />);

    await waitFor(() =>
      expect(mocked.navigate).toHaveBeenCalledWith({ to: "/landing" }),
    );
  });

  it("preserves the login redirect for returning signed-out users", async () => {
    vi.mocked(window.localStorage.getItem).mockImplementation((key) =>
      key === ATHENA_HAS_AUTHENTICATED_KEY ? "true" : null,
    );
    mocked.useAuth.mockReturnValue({ user: null, isLoading: false });
    mocked.useQuery.mockReturnValue(undefined);

    render(<AppEntryDispatcher />);

    await waitFor(() =>
      expect(mocked.navigate).toHaveBeenCalledWith({ to: "/login" }),
    );
  });

  it("treats the legacy stored user ID as returning-user history", async () => {
    vi.mocked(window.localStorage.getItem).mockImplementation((key) =>
      key === LOGGED_IN_USER_ID_KEY ? "athena-user-1" : null,
    );
    mocked.useAuth.mockReturnValue({ user: null, isLoading: false });
    mocked.useQuery.mockReturnValue(undefined);

    render(<AppEntryDispatcher />);

    await waitFor(() =>
      expect(mocked.navigate).toHaveBeenCalledWith({ to: "/login" }),
    );
  });

  it("preserves the first-organization dispatch", async () => {
    mocked.useAuth.mockReturnValue({
      user: { _id: "athena-user-1" },
      isLoading: false,
    });
    mocked.useQuery.mockReturnValue([{ _id: "org-1", slug: "wigclub" }]);

    render(<AppEntryDispatcher />);

    await waitFor(() =>
      expect(mocked.navigate).toHaveBeenCalledWith({
        to: "/$orgUrlSlug",
        params: { orgUrlSlug: "wigclub" },
      }),
    );
  });

  it("preserves organization selection when the user has no organizations", () => {
    mocked.useAuth.mockReturnValue({
      user: { _id: "athena-user-1" },
      isLoading: false,
    });
    mocked.useQuery.mockReturnValue([]);

    render(<AppEntryDispatcher />);

    expect(screen.getByTestId("organizations-view")).toBeInTheDocument();
    expect(screen.getByTestId("organization-modal")).toBeInTheDocument();
    expect(mocked.navigate).not.toHaveBeenCalled();
  });
});
