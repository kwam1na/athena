import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

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

  it("redirects signed-out users to login", async () => {
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
