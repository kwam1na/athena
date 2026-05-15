import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import Layout from "./_authed";
import { LOGGED_IN_USER_ID_KEY } from "@/lib/constants";
import { useAppShellFullscreenMode } from "@/contexts/AppShellFullscreenContext";

const mocked = vi.hoisted(() => ({
  OutletComponent: null as (() => ReactNode) | null,
  navigate: vi.fn(),
  signOut: vi.fn().mockResolvedValue(undefined),
  startManagerElevation: vi.fn(),
  endManagerElevation: vi.fn(),
  useAuth: vi.fn(),
  useManagerElevation: vi.fn(),
  usePermissions: vi.fn(),
  useRouterState: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => () => ({}),
  Outlet: () => {
    const OutletComponent = mocked.OutletComponent;
    return OutletComponent ? (
      <OutletComponent />
    ) : (
      <div data-testid="authed-outlet">Authed outlet</div>
    );
  },
  useNavigate: () => mocked.navigate,
  useRouterState: mocked.useRouterState,
}));

vi.mock("../hooks/useAuth", () => ({
  useAuth: mocked.useAuth,
}));

vi.mock("../hooks/usePermissions", () => ({
  usePermissions: mocked.usePermissions,
}));

vi.mock("@convex-dev/auth/react", () => ({
  useAuthActions: () => ({ signOut: mocked.signOut }),
}));

vi.mock("../contexts/PermissionsContext", () => ({
  PermissionsProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("../contexts/ManagerElevationContext", () => ({
  ManagerElevationProvider: ({ children }: { children: ReactNode }) => (
    <>{children}</>
  ),
  useManagerElevation: mocked.useManagerElevation,
}));

vi.mock("../components/ui/sidebar", () => ({
  SidebarProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  SidebarInset: ({ children }: { children: ReactNode }) => <>{children}</>,
  SidebarTrigger: () => null,
  useSidebar: () => ({ state: "expanded" }),
}));

vi.mock("../components/app-sidebar", () => ({
  AppSidebar: () => <div data-testid="app-sidebar">Sidebar</div>,
}));

vi.mock("@/components/Navbar", () => ({
  AppHeader: () => <div data-testid="app-header">App header</div>,
}));

vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({
    children,
    onSelect,
  }: {
    children: ReactNode;
    onSelect?: () => void;
  }) => <button onClick={onSelect}>{children}</button>,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/ui/modals/organization-modal", () => ({
  OrganizationModal: () => <div data-testid="organization-modal" />,
}));

vi.mock("@/components/ui/modals/store-modal", () => ({
  StoreModal: () => <div data-testid="store-modal" />,
}));

function FullscreenOutlet() {
  useAppShellFullscreenMode();
  return <div data-testid="fullscreen-outlet">Fullscreen outlet</div>;
}

describe("Authed layout", () => {
  beforeEach(() => {
    mocked.OutletComponent = null;
    window.history.replaceState({}, "", "/wigclub/store/wigclub/products");
    Object.defineProperty(window.navigator, "onLine", {
      configurable: true,
      value: true,
    });
    vi.mocked(window.localStorage.getItem).mockReset();
    vi.mocked(window.localStorage.getItem).mockReturnValue(null);
    mocked.navigate.mockReset();
    mocked.signOut.mockClear();
    mocked.startManagerElevation.mockReset();
    mocked.endManagerElevation.mockReset();
    mocked.useAuth.mockReset();
    mocked.useManagerElevation.mockReturnValue({
      activeElevation: null,
      endManagerElevation: mocked.endManagerElevation,
      isManagerElevated: false,
      startManagerElevation: mocked.startManagerElevation,
    });
    mocked.usePermissions.mockReturnValue({
      hasFullAdminAccess: false,
    });
    mocked.useRouterState.mockImplementation(({ select }) =>
      select({ location: { pathname: "/wigclub/store/wigclub/products" } }),
    );
  });

  it("stays empty while auth is still loading", () => {
    mocked.useAuth.mockReturnValue({
      user: undefined,
      isLoading: true,
    });

    const { container } = render(<Layout />);

    expect(container).toBeEmptyDOMElement();
    expect(mocked.navigate).not.toHaveBeenCalled();
  });

  it("renders the POS shell offline when Convex auth is still reconnecting", () => {
    Object.defineProperty(window.navigator, "onLine", {
      configurable: true,
      value: false,
    });
    vi.mocked(window.localStorage.getItem).mockImplementation((key) =>
      key === LOGGED_IN_USER_ID_KEY ? "user-1" : null,
    );
    mocked.useAuth.mockReturnValue({
      user: undefined,
      isLoading: true,
    });
    mocked.useRouterState.mockImplementation(({ select }) =>
      select({ location: { pathname: "/wigclub/store/wigclub/pos/register" } }),
    );

    render(<Layout />);

    expect(screen.getByTestId("app-sidebar")).toBeInTheDocument();
    expect(screen.getByTestId("authed-outlet")).toBeInTheDocument();
    expect(mocked.navigate).not.toHaveBeenCalled();
  });

  it("keeps non-POS routes blocked while offline auth is still loading", () => {
    Object.defineProperty(window.navigator, "onLine", {
      configurable: true,
      value: false,
    });
    vi.mocked(window.localStorage.getItem).mockImplementation((key) =>
      key === LOGGED_IN_USER_ID_KEY ? "user-1" : null,
    );
    mocked.useAuth.mockReturnValue({
      user: undefined,
      isLoading: true,
    });

    const { container } = render(<Layout />);

    expect(container).toBeEmptyDOMElement();
    expect(mocked.navigate).not.toHaveBeenCalled();
  });

  it("redirects to login instead of rendering the authed shell when the session is gone", async () => {
    mocked.useAuth.mockReturnValue({
      user: null,
      isLoading: false,
    });

    const { container } = render(<Layout />);

    expect(container).toBeEmptyDOMElement();
    await waitFor(() => expect(mocked.navigate).toHaveBeenCalledWith({ to: "/login" }));
    expect(screen.queryByTestId("app-sidebar")).not.toBeInTheDocument();
  });

  it("redirects instead of rendering POS offline when Convex auth settles without a user", async () => {
    Object.defineProperty(window.navigator, "onLine", {
      configurable: true,
      value: false,
    });
    vi.mocked(window.localStorage.getItem).mockImplementation((key) =>
      key === LOGGED_IN_USER_ID_KEY ? "user-1" : null,
    );
    mocked.useAuth.mockReturnValue({
      user: null,
      isLoading: false,
    });
    mocked.useRouterState.mockImplementation(({ select }) =>
      select({ location: { pathname: "/wigclub/store/wigclub/pos/register" } }),
    );

    const { container } = render(<Layout />);

    expect(container).toBeEmptyDOMElement();
    await waitFor(() => expect(mocked.navigate).toHaveBeenCalledWith({ to: "/login" }));
    expect(screen.queryByTestId("app-sidebar")).not.toBeInTheDocument();
  });

  it("renders the authed shell once the user is available", () => {
    mocked.useAuth.mockReturnValue({
      user: { _id: "user-1" },
      isLoading: false,
    });

    render(<Layout />);

    expect(screen.getByTestId("app-sidebar")).toBeInTheDocument();
    expect(screen.getByTestId("app-header")).toBeInTheDocument();
    expect(screen.getByTestId("store-modal")).toBeInTheDocument();
    expect(screen.getByTestId("organization-modal")).toBeInTheDocument();
    expect(screen.getByTestId("authed-outlet")).toBeInTheDocument();
  });

  it("signs out from the user menu", async () => {
    const user = userEvent.setup();

    mocked.useAuth.mockReturnValue({
      user: { _id: "user-1", email: "kwami.nuh@gmail.com" },
      isLoading: false,
    });

    render(<Layout />);

    await user.click(screen.getByRole("button", { name: /sign out/i }));

    await waitFor(() => expect(mocked.signOut).toHaveBeenCalled());
    expect(window.localStorage.removeItem).toHaveBeenCalledWith(
      LOGGED_IN_USER_ID_KEY
    );
    expect(mocked.navigate).toHaveBeenCalledWith({ to: "/login" });
  });

  it("keeps the account email visible while manager elevation is active", async () => {
    const user = userEvent.setup();
    mocked.useAuth.mockReturnValue({
      user: { _id: "user-1", email: "operator@example.com" },
      isLoading: false,
    });
    mocked.useManagerElevation.mockReturnValue({
      activeElevation: {
        displayName: "Adjoa Mensah",
        startedAt: 123,
        staffProfileId: "staff-manager-1",
      },
      endManagerElevation: mocked.endManagerElevation,
      isManagerElevated: true,
      startManagerElevation: mocked.startManagerElevation,
    });

    render(<Layout />);

    expect(screen.getByText("operator@example.com")).toBeInTheDocument();
    expect(
      screen.getByText("Elevated session: Adjoa Mensah"),
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: /end manager elevation/i }),
    );

    expect(mocked.endManagerElevation).toHaveBeenCalled();
  });

  it("starts manager elevation from the user menu", async () => {
    const user = userEvent.setup();
    mocked.useAuth.mockReturnValue({
      user: { _id: "user-1", email: "operator@example.com" },
      isLoading: false,
    });

    render(<Layout />);

    await user.click(
      screen.getByRole("button", { name: /start manager elevation/i }),
    );

    expect(mocked.startManagerElevation).toHaveBeenCalled();
  });

  it("hides manager elevation start for full-admin accounts", () => {
    mocked.useAuth.mockReturnValue({
      user: { _id: "user-1", email: "admin@example.com" },
      isLoading: false,
    });
    mocked.usePermissions.mockReturnValue({
      hasFullAdminAccess: true,
    });

    render(<Layout />);

    expect(
      screen.queryByRole("button", { name: /start manager elevation/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /sign out/i })).toBeInTheDocument();
  });

  it("starts fullscreen when the POS register route becomes active", () => {
    mocked.useAuth.mockReturnValue({
      user: { _id: "user-1", email: "operator@example.com" },
      isLoading: false,
    });
    mocked.useRouterState.mockImplementation(({ select }) =>
      select({
        location: { pathname: "/wigclub/store/wigclub/pos/register" },
      }),
    );

    render(<Layout />);

    expect(screen.queryByTestId("app-header")).not.toBeInTheDocument();
    expect(screen.getByTestId("app-sidebar")).toBeInTheDocument();
  });

  it("starts fullscreen from the browser pathname on first register render", () => {
    mocked.useAuth.mockReturnValue({
      user: { _id: "user-1", email: "operator@example.com" },
      isLoading: false,
    });
    mocked.useRouterState.mockImplementation(({ select }) =>
      select({ location: { pathname: "/" } }),
    );
    window.history.replaceState({}, "", "/wigclub/store/wigclub/pos/register");

    render(<Layout />);

    expect(screen.queryByTestId("app-header")).not.toBeInTheDocument();
    expect(screen.getByTestId("app-sidebar")).toBeInTheDocument();
  });

  it("toggles the mounted register flow with F", () => {
    mocked.useAuth.mockReturnValue({
      user: { _id: "user-1", email: "operator@example.com" },
      isLoading: false,
    });
    mocked.useRouterState.mockImplementation(({ select }) =>
      select({
        location: { pathname: "/wigclub/store/wigclub/pos/register" },
      }),
    );
    mocked.OutletComponent = FullscreenOutlet;

    render(<Layout />);

    expect(screen.queryByTestId("app-header")).not.toBeInTheDocument();

    fireEvent.keyDown(document, { key: "f" });

    expect(screen.getByTestId("app-header")).toBeInTheDocument();
    expect(screen.getByTestId("app-sidebar")).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "F" });

    expect(screen.queryByTestId("app-header")).not.toBeInTheDocument();
  });

  it("uses the route default again after toggling away and returning to the register flow", () => {
    mocked.useAuth.mockReturnValue({
      user: { _id: "user-1", email: "operator@example.com" },
      isLoading: false,
    });
    let pathname = "/wigclub/store/wigclub/pos/register";
    mocked.useRouterState.mockImplementation(({ select }) =>
      select({ location: { pathname } }),
    );
    mocked.OutletComponent = FullscreenOutlet;

    const { rerender } = render(<Layout />);

    fireEvent.keyDown(document, { key: "f" });
    expect(screen.getByTestId("app-header")).toBeInTheDocument();

    pathname = "/wigclub/store/wigclub/pos";
    rerender(<Layout />);
    expect(screen.getByTestId("app-header")).toBeInTheDocument();

    pathname = "/wigclub/store/wigclub/pos/register";
    rerender(<Layout />);
    expect(screen.queryByTestId("app-header")).not.toBeInTheDocument();
  });

  it("shows the global nav after leaving the register flow even if the browser pathname is stale", () => {
    mocked.useAuth.mockReturnValue({
      user: { _id: "user-1", email: "operator@example.com" },
      isLoading: false,
    });
    mocked.useRouterState.mockImplementation(({ select }) =>
      select({ location: { pathname: "/wigclub/store/wigclub/pos" } }),
    );
    window.history.replaceState({}, "", "/wigclub/store/wigclub/pos/register");

    render(<Layout />);

    expect(screen.getByTestId("app-header")).toBeInTheDocument();
  });

  it("keeps F available for typing while the register flow is mounted", () => {
    mocked.useAuth.mockReturnValue({
      user: { _id: "user-1", email: "operator@example.com" },
      isLoading: false,
    });
    mocked.useRouterState.mockImplementation(({ select }) =>
      select({
        location: { pathname: "/wigclub/store/wigclub/pos/register" },
      }),
    );
    mocked.OutletComponent = FullscreenOutlet;

    render(<Layout />);

    const input = document.createElement("input");
    document.body.appendChild(input);

    fireEvent.keyDown(input, { key: "f" });

    expect(screen.queryByTestId("app-header")).not.toBeInTheDocument();

    input.remove();
  });

  it("does not toggle fullscreen outside the register flow without a mounted fullscreen outlet", () => {
    mocked.useAuth.mockReturnValue({
      user: { _id: "user-1", email: "operator@example.com" },
      isLoading: false,
    });

    render(<Layout />);

    fireEvent.keyDown(document, { key: "f" });

    expect(screen.getByTestId("app-header")).toBeInTheDocument();
  });
});
