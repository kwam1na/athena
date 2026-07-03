import { fireEvent, render, screen } from "@testing-library/react";
import React, { type ReactElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AppSidebar } from "./app-sidebar";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  useGetActiveStore: vi.fn(),
  useGetActiveOrganization: vi.fn(),
  usePermissions: vi.fn(),
  useQuery: vi.fn(),
  useSidebar: vi.fn(),
  toggleSidebar: vi.fn(),
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
  const Passthrough = ({
    children,
    className,
  }: {
    children: ReactNode;
    className?: string;
  }) => <div className={className}>{children}</div>;

  return {
    Sidebar: ({
      children,
      className,
      variant,
    }: {
      children: ReactNode;
      className?: string;
      variant?: string;
    }) => (
      <aside className={className} data-sidebar-variant={variant}>
        {children}
      </aside>
    ),
    SidebarContent: ({
      children,
      className,
    }: {
      children: ReactNode;
      className?: string;
    }) => (
      <div className={className} data-testid="sidebar-content">
        {children}
      </div>
    ),
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
    useSidebar: mocks.useSidebar,
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
    mocks.useSidebar.mockReturnValue({
      state: "expanded",
      toggleSidebar: mocks.toggleSidebar,
    });
  });

  it("lets POS-only accounts open store-day surfaces without admin surfaces", () => {
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
    expect(screen.getByRole("link", { name: /sku activity/i })).toHaveAttribute(
      "aria-disabled",
      "false",
    );

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

  it("renders the contained shell variant full-height on mobile and fit-height on desktop", () => {
    mocks.usePermissions.mockReturnValue({
      canAccessAdmin: () => true,
      canAccessFullAdminSurfaces: () => true,
      canAccessPOS: () => true,
      canAccessOperations: () => true,
      canAccessStoreDaySurfaces: () => true,
      hasFullAdminAccess: true,
      hasStoreDaySurfaceAccess: true,
      isLoading: false,
      role: "full_admin",
    });

    render(<AppSidebar shellVariant="contained" />);

    expect(screen.getByTestId("sidebar-content")).toHaveClass(
      "h-full",
      "max-h-full",
      "flex-none",
      "relative",
      "w-full",
      "md:h-fit",
      "md:max-h-[calc(100svh-6rem)]",
      "md:w-[calc(var(--sidebar-width-contained)-theme(spacing.4))]",
      "md:rounded-lg",
      "md:border",
      "border-sidebar-border/60",
      "bg-sidebar",
      "md:shadow-surface",
      "group-data-[collapsible=icon]:w-[var(--sidebar-width-icon)]",
      "group-data-[collapsible=icon]:p-0",
    );
    expect(screen.getByRole("complementary")).toHaveAttribute(
      "data-sidebar-variant",
      "contained",
    );
  });

  it("links full-admin users to settings from the app section", () => {
    mocks.usePermissions.mockReturnValue({
      canAccessAdmin: () => true,
      canAccessFullAdminSurfaces: () => true,
      canAccessPOS: () => true,
      canAccessOperations: () => true,
      canAccessStoreDaySurfaces: () => true,
      hasFullAdminAccess: true,
      hasStoreDaySurfaceAccess: true,
      isLoading: false,
      role: "full_admin",
    });

    render(<AppSidebar />);

    expect(screen.getByRole("link", { name: /^settings$/i })).toHaveAttribute(
      "href",
      "/$orgUrlSlug/store/$storeUrlSlug/app-settings",
    );
  });

  it("places a collapse toggle under the contained desktop sidebar", () => {
    mocks.usePermissions.mockReturnValue({
      canAccessAdmin: () => true,
      canAccessFullAdminSurfaces: () => true,
      canAccessPOS: () => true,
      canAccessOperations: () => true,
      canAccessStoreDaySurfaces: () => true,
      hasFullAdminAccess: true,
      hasStoreDaySurfaceAccess: true,
      isLoading: false,
      role: "full_admin",
    });

    render(<AppSidebar shellVariant="contained" />);

    const toggle = screen.getByRole("button", { name: "Collapse sidebar" });

    expect(toggle).toHaveClass(
      "mt-layout-xs",
      "w-[var(--sidebar-width-icon)]",
      "self-start",
      "md:flex",
    );
    fireEvent.click(toggle);
    expect(mocks.toggleSidebar).toHaveBeenCalledTimes(1);
  });
});
