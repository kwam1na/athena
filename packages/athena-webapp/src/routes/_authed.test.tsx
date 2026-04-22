import { render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import Layout from "./_authed";

const mocked = vi.hoisted(() => ({
  navigate: vi.fn(),
  useAuth: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => () => ({}),
  Outlet: () => <div data-testid="authed-outlet">Authed outlet</div>,
  useNavigate: () => mocked.navigate,
}));

vi.mock("../hooks/useAuth", () => ({
  useAuth: mocked.useAuth,
}));

vi.mock("../contexts/PermissionsContext", () => ({
  PermissionsProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("../components/ui/sidebar", () => ({
  SidebarProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  SidebarInset: ({ children }: { children: ReactNode }) => <>{children}</>,
  SidebarTrigger: () => null,
}));

vi.mock("../components/app-sidebar", () => ({
  AppSidebar: () => <div data-testid="app-sidebar">Sidebar</div>,
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
    mocked.useAuth.mockReset();
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
    expect(screen.getByTestId("store-modal")).toBeInTheDocument();
    expect(screen.getByTestId("organization-modal")).toBeInTheDocument();
    expect(screen.getByTestId("authed-outlet")).toBeInTheDocument();
  });
});
