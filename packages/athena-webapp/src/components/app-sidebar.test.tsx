import { render, screen } from "@testing-library/react";
import React, { type ReactElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AppSidebar } from "./app-sidebar";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  useGetActiveStore: vi.fn(),
  useGetActiveOrganization: vi.fn(),
  usePermissions: vi.fn(),
  useQuery: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    params,
    search,
    to,
    ...props
  }: {
    children: ReactNode;
    params?: unknown;
    search?: unknown;
    to: string;
  }) => {
    void params;
    void search;

    return (
      <a href={to} {...props}>
        {children}
      </a>
    );
  },
  useLocation: () => ({ pathname: "/org/store/main/operations" }),
  useNavigate: () => mocks.navigate,
}));

vi.mock("convex/react", () => ({
  useQuery: mocks.useQuery,
}));

vi.mock("../hooks/useGetActiveStore", () => ({
  default: mocks.useGetActiveStore,
}));

vi.mock("../hooks/useGetOrganizations", () => ({
  useGetActiveOrganization: mocks.useGetActiveOrganization,
}));

vi.mock("../hooks/useNewOrderNotification", () => ({
  useNewOrderNotification: vi.fn(),
}));

vi.mock("../hooks/useGetProducts", () => ({
  useGetUnresolvedProducts: () => [],
}));

vi.mock("../hooks/useGetCategories", () => ({
  useGetCategories: () => [],
}));

vi.mock("../hooks/usePermissions", () => ({
  usePermissions: mocks.usePermissions,
}));

vi.mock("@/components/ui/sidebar", () => {
  const Passthrough = ({ children }: { children: ReactNode }) => <>{children}</>;

  return {
    Sidebar: Passthrough,
    SidebarContent: Passthrough,
    SidebarGroup: ({ children }: { children: ReactNode }) => (
      <section>{children}</section>
    ),
    SidebarGroupContent: Passthrough,
    SidebarGroupLabel: ({ children }: { children: ReactNode }) => (
      <h2>{children}</h2>
    ),
    SidebarMenu: ({ children }: { children: ReactNode }) => <nav>{children}</nav>,
    SidebarMenuButton: ({
      asChild,
      children,
      disabled,
      onClick,
    }: {
      asChild?: boolean;
      children: ReactNode;
      disabled?: boolean;
      onClick?: () => void;
    }) => {
      if (asChild && React.isValidElement(children)) {
        return React.cloneElement(children as ReactElement, {
          "aria-disabled": disabled ? "true" : "false",
          "data-disabled": disabled ? "true" : "false",
        });
      }

      return (
        <button
          aria-disabled={disabled ? "true" : "false"}
          data-disabled={disabled ? "true" : "false"}
          disabled={disabled}
          onClick={onClick}
          type="button"
        >
          {children}
        </button>
      );
    },
    SidebarMenuItem: Passthrough,
    SidebarMenuSub: Passthrough,
    SidebarMenuSubItem: Passthrough,
    SidebarRail: () => null,
  };
});

vi.mock("@radix-ui/react-collapsible", () => ({
  Root: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Trigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  Content: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

describe("AppSidebar capability gates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.useGetActiveStore.mockReturnValue({
      activeStore: { _id: "store-1", slug: "main" },
    });
    mocks.useGetActiveOrganization.mockReturnValue({
      activeOrganization: { _id: "org-1", slug: "org" },
    });
    mocks.useQuery.mockReturnValue([]);
  });

  it("lets manager elevation expose store-day surfaces without admin surfaces", () => {
    mocks.usePermissions.mockReturnValue({
      canAccessAdmin: () => false,
      canAccessFullAdminSurfaces: () => false,
      canAccessPOS: () => true,
      canAccessOperations: () => true,
      canAccessStoreDaySurfaces: () => true,
      hasFullAdminAccess: false,
      hasStoreDaySurfaceAccess: true,
      isLoading: false,
      role: "pos_only",
    });

    render(<AppSidebar />);

    expect(screen.getByRole("link", { name: /cash controls/i })).toHaveAttribute(
      "aria-disabled",
      "false",
    );
    expect(screen.getByRole("button", { name: /operations/i })).toHaveAttribute(
      "aria-disabled",
      "false",
    );
    expect(screen.getByRole("link", { name: /open work/i })).toHaveAttribute(
      "aria-disabled",
      "false",
    );
    expect(screen.getByRole("link", { name: /approvals/i })).toHaveAttribute(
      "aria-disabled",
      "false",
    );
    expect(
      screen.getByRole("link", { name: /stock adjustments/i }),
    ).toHaveAttribute("aria-disabled", "false");

    expect(screen.getByRole("link", { name: /procurement/i })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(screen.getByRole("link", { name: /analytics/i })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(screen.getByRole("link", { name: /bulk operations/i })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(screen.getByRole("link", { name: /promo codes/i })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(screen.getByRole("link", { name: /reviews/i })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(screen.queryByRole("heading", { name: /services/i })).toBeNull();
    expect(screen.queryByRole("heading", { name: /organization/i })).toBeNull();
  });
});
