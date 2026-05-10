import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import Layout from "./_authed";
import { LOGGED_IN_USER_ID_KEY } from "@/lib/constants";

const mocked = vi.hoisted(() => ({
  navigate: vi.fn(),
  signOut: vi.fn().mockResolvedValue(undefined),
  startManagerElevation: vi.fn(),
  endManagerElevation: vi.fn(),
  useAuth: vi.fn(),
  useManagerElevation: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => () => ({}),
  Outlet: () => <div data-testid="authed-outlet">Authed outlet</div>,
  useNavigate: () => mocked.navigate,
}));

vi.mock("../hooks/useAuth", () => ({
  useAuth: mocked.useAuth,
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

describe("Authed layout", () => {
  beforeEach(() => {
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
    expect(screen.getByText("Manager: Adjoa Mensah")).toBeInTheDocument();

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
});
