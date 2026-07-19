import { fireEvent, render, screen } from "@testing-library/react";
import React, { type ReactElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getFunctionName } from "convex/server";
import { api } from "~/convex/_generated/api";

import {
  AppSidebar,
  resetAppSidebarSubmenuStateForTests,
} from "./app-sidebar";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  pathname: "/org/store/main/operations",
  useGetActiveStore: vi.fn(),
  useGetActiveOrganization: vi.fn(),
  usePermissions: vi.fn(),
  useQuery: vi.fn(),
  useSharedDemoContext: vi.fn(),
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
  useLocation: () => ({ pathname: mocks.pathname }),
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

vi.mock("../hooks/useGetCategories", () => ({
  useGetCategories: () => [],
}));

vi.mock("../hooks/usePermissions", () => ({
  usePermissions: mocks.usePermissions,
}));

vi.mock("../hooks/useSharedDemoContext", () => ({
  useSharedDemoContext: mocks.useSharedDemoContext,
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

vi.mock("@radix-ui/react-collapsible", () => {
  const CollapsibleContext = React.createContext<{
    onOpenChange?: (open: boolean) => void;
    open: boolean;
  }>({
    open: false,
  });

  return {
    Root: ({
      children,
      defaultOpen = false,
      onOpenChange,
      open,
    }: {
      children: ReactNode;
      defaultOpen?: boolean;
      onOpenChange?: (open: boolean) => void;
      open?: boolean;
    }) => (
      <CollapsibleContext.Provider
        value={{ onOpenChange, open: open ?? defaultOpen }}
      >
        <div>{children}</div>
      </CollapsibleContext.Provider>
    ),
    Trigger: ({ children }: { children: ReactNode }) => {
      const { onOpenChange, open } = React.useContext(CollapsibleContext);

      if (!React.isValidElement(children)) {
        return <>{children}</>;
      }

      const child = children as ReactElement<{
        disabled?: boolean;
        onClick?: React.MouseEventHandler;
      }>;

      return React.cloneElement(child, {
        onClick: (event: React.MouseEvent) => {
          child.props.onClick?.(event);
          if (!child.props.disabled) {
            onOpenChange?.(!open);
          }
        },
      });
    },
    Content: ({ children }: { children: ReactNode }) => {
      const { open } = React.useContext(CollapsibleContext);

      return open ? <div>{children}</div> : null;
    },
  };
});

describe("AppSidebar capability gates", () => {
  const fullAdminPermissions = {
    canAccessAdmin: () => true,
    canAccessFullAdminSurfaces: () => true,
    canAccessPOS: () => true,
    canAccessOperations: () => true,
    canAccessStoreDaySurfaces: () => true,
    hasFullAdminAccess: true,
    hasFinancialDetailsAccess: true,
    hasStoreDaySurfaceAccess: true,
    isLoading: false,
    role: "full_admin",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    resetAppSidebarSubmenuStateForTests();
    mocks.pathname = "/org/store/main/operations";
    mocks.useGetActiveStore.mockReturnValue({
      activeStore: { _id: "store-1", slug: "main" },
    });
    mocks.useGetActiveOrganization.mockReturnValue({
      activeOrganization: { _id: "org-1", slug: "org" },
    });
    mocks.useQuery.mockReturnValue([]);
    mocks.useSharedDemoContext.mockReturnValue(null);
    mocks.useSidebar.mockReturnValue({
      state: "expanded",
      toggleSidebar: mocks.toggleSidebar,
    });
  });

  it("hides Reports from the application menu", () => {
    mocks.usePermissions.mockReturnValue(fullAdminPermissions);

    render(<AppSidebar />);

    expect(screen.queryByRole("link", { name: /reports/i })).toBeNull();
  });

  it("hides Storefront from the shared demo menu", () => {
    mocks.usePermissions.mockReturnValue(fullAdminPermissions);
    mocks.useSharedDemoContext.mockReturnValue({ kind: "shared_demo" });

    render(<AppSidebar />);

    expect(screen.queryByRole("button", { name: /storefront/i })).toBeNull();
  });

  it("hides Homepage from the shared demo menu", () => {
    mocks.usePermissions.mockReturnValue(fullAdminPermissions);
    mocks.useSharedDemoContext.mockReturnValue({ kind: "shared_demo" });

    render(<AppSidebar />);

    expect(screen.queryByRole("link", { name: /homepage/i })).toBeNull();
  });

  it("renders unresolved catalog work from a trustworthy summary", () => {
    mocks.pathname = "/org/store/main/products";
    mocks.usePermissions.mockReturnValue(fullAdminPermissions);
    mocks.useQuery.mockImplementation((query) =>
      getFunctionName(query) === "inventory/products:getCatalogSummary"
        ? {
            missingInfoProductCount: 7,
            needsRefresh: false,
            updatedAt: 123,
          }
        : [],
    );

    render(<AppSidebar />);

    expect(screen.getByRole("link", { name: /unresolved 7/i })).toBeInTheDocument();
    expect(mocks.useQuery).toHaveBeenNthCalledWith(
      1,
      api.inventory.products.getCatalogSummary,
      { storeId: "store-1" },
    );
  });

  it("renders the consolidated open-work count as muted menu metadata", () => {
    mocks.usePermissions.mockReturnValue(fullAdminPermissions);
    mocks.useQuery.mockImplementation((query) =>
      getFunctionName(query) ===
      "operations/operationalWorkItems:getOpenWorkCountSummary"
        ? { completeness: "complete", count: 20 }
        : [],
    );

    render(<AppSidebar />);

    const openWorkLink = screen.getByRole("link", { name: "Open work 20" });
    const countLabel = screen.getByText("20");

    expect(openWorkLink).toBeInTheDocument();
    expect(countLabel).toHaveClass("text-muted-foreground", "tabular-nums");
    expect(countLabel).not.toHaveClass("rounded-full", "bg-primary");
    expect(mocks.useQuery).toHaveBeenCalledWith(
      api.operations.operationalWorkItems.getOpenWorkCountSummary,
      { storeId: "store-1" },
    );
  });

  it("renders a nonzero pending-approval count as muted menu metadata", () => {
    mocks.usePermissions.mockReturnValue(fullAdminPermissions);
    mocks.useQuery.mockImplementation((query) =>
      getFunctionName(query) ===
      "operations/operationalWorkItems:getPendingApprovalCountSummary"
        ? { completeness: "complete", count: 3 }
        : [],
    );

    render(<AppSidebar />);

    const approvalsLink = screen.getByRole("link", { name: "Approvals 3" });
    const countLabel = approvalsLink.querySelector("span");

    expect(countLabel).toHaveTextContent("3");
    expect(countLabel).toHaveClass("text-muted-foreground", "tabular-nums");
    expect(countLabel).not.toHaveClass("rounded-full", "bg-primary");
  });

  it("hides pending-approval metadata when the count is zero", () => {
    mocks.usePermissions.mockReturnValue(fullAdminPermissions);
    mocks.useQuery.mockImplementation((query) =>
      getFunctionName(query) ===
      "operations/operationalWorkItems:getPendingApprovalCountSummary"
        ? { completeness: "complete", count: 0 }
        : [],
    );

    render(<AppSidebar />);

    expect(screen.getByRole("link", { name: "Approvals" })).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Approvals 0" }),
    ).not.toBeInTheDocument();
  });

  it.each([
    { needsRefresh: true, updatedAt: 123 },
    { needsRefresh: false, updatedAt: 0 },
  ])("hides unresolved work for an untrustworthy summary", (summaryState) => {
    mocks.pathname = "/org/store/main/products";
    mocks.usePermissions.mockReturnValue(fullAdminPermissions);
    mocks.useQuery.mockImplementation((query) =>
      getFunctionName(query) === "inventory/products:getCatalogSummary"
        ? { missingInfoProductCount: 7, ...summaryState }
        : [],
    );

    render(<AppSidebar />);

    expect(screen.queryByRole("link", { name: /unresolved/i })).toBeNull();
  });

  it("keeps manager surfaces disabled for POS-only accounts", () => {
    mocks.usePermissions.mockReturnValue({
      canAccessAdmin: () => false,
      canAccessFullAdminSurfaces: () => false,
      canAccessPOS: () => true,
      canAccessOperations: () => true,
      canAccessStoreDaySurfaces: () => false,
      hasFullAdminAccess: false,
      hasFinancialDetailsAccess: false,
      hasStoreDaySurfaceAccess: false,
      isLoading: false,
      role: "pos_only",
    });

    render(<AppSidebar />);

    expect(screen.getByRole("link", { name: /cash controls/i })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(screen.getByRole("button", { name: /operations/i })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(screen.getByRole("button", { name: /products/i })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(screen.getByRole("link", { name: /open work/i })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(screen.getByRole("link", { name: /approvals/i })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(
      screen.getByRole("link", { name: /stock adjustments/i }),
    ).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("link", { name: /sku activity/i })).toHaveAttribute(
      "aria-disabled",
      "true",
    );

    expect(screen.getByRole("link", { name: /procurement/i })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(screen.queryByRole("link", { name: /reports/i })).toBeNull();
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

  it("lets manager-elevated sessions open Cash Controls, Operations, and Products", () => {
    mocks.usePermissions.mockReturnValue({
      canAccessAdmin: () => false,
      canAccessFullAdminSurfaces: () => false,
      canAccessPOS: () => true,
      canAccessOperations: () => true,
      canAccessStoreDaySurfaces: () => true,
      hasFullAdminAccess: false,
      hasFinancialDetailsAccess: true,
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
    expect(screen.getByRole("button", { name: /products/i })).toHaveAttribute(
      "aria-disabled",
      "false",
    );
  });

  it("renders the contained shell variant full-height on mobile and fit-height on desktop", () => {
    mocks.usePermissions.mockReturnValue({
      canAccessAdmin: () => true,
      canAccessFullAdminSurfaces: () => true,
      canAccessPOS: () => true,
      canAccessOperations: () => true,
      canAccessStoreDaySurfaces: () => true,
      hasFullAdminAccess: true,
      hasFinancialDetailsAccess: true,
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
      hasFinancialDetailsAccess: true,
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
      hasFinancialDetailsAccess: true,
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
    expect(toggle).not.toHaveAttribute("title");
    fireEvent.click(toggle);
    expect(mocks.toggleSidebar).toHaveBeenCalledTimes(1);
  });

  it("preserves opened submenus when the sidebar remounts after POS fullscreen", () => {
    mocks.pathname = "/org/store/main/pos";
    mocks.usePermissions.mockReturnValue({
      canAccessAdmin: () => true,
      canAccessFullAdminSurfaces: () => true,
      canAccessPOS: () => true,
      canAccessOperations: () => true,
      canAccessStoreDaySurfaces: () => true,
      hasFullAdminAccess: true,
      hasFinancialDetailsAccess: true,
      hasStoreDaySurfaceAccess: true,
      isLoading: false,
      role: "full_admin",
    });

    const { unmount } = render(<AppSidebar />);

    expect(screen.queryByRole("link", { name: /assets/i })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /storefront/i }));
    expect(screen.getByRole("link", { name: /assets/i })).toBeInTheDocument();

    unmount();
    render(<AppSidebar />);

    expect(screen.getByRole("link", { name: /assets/i })).toBeInTheDocument();
  });

  it("keeps route defaults for submenus the operator has not changed", () => {
    mocks.pathname = "/org/store/main/pos";
    mocks.usePermissions.mockReturnValue({
      canAccessAdmin: () => true,
      canAccessFullAdminSurfaces: () => true,
      canAccessPOS: () => true,
      canAccessOperations: () => true,
      canAccessStoreDaySurfaces: () => true,
      hasFullAdminAccess: true,
      hasFinancialDetailsAccess: true,
      hasStoreDaySurfaceAccess: true,
      isLoading: false,
      role: "full_admin",
    });

    const { unmount } = render(<AppSidebar />);

    fireEvent.click(screen.getByRole("button", { name: /storefront/i }));

    unmount();
    mocks.pathname = "/org/store/main/operations";
    render(<AppSidebar />);

    expect(
      screen.getByRole("link", { name: /daily operations/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /assets/i })).toBeInTheDocument();
  });

  it("preserves collapsed route submenus when the sidebar remounts after POS fullscreen", () => {
    mocks.usePermissions.mockReturnValue({
      canAccessAdmin: () => true,
      canAccessFullAdminSurfaces: () => true,
      canAccessPOS: () => true,
      canAccessOperations: () => true,
      canAccessStoreDaySurfaces: () => true,
      hasFullAdminAccess: true,
      hasFinancialDetailsAccess: true,
      hasStoreDaySurfaceAccess: true,
      isLoading: false,
      role: "full_admin",
    });

    const { unmount } = render(<AppSidebar />);

    expect(
      screen.getByRole("link", { name: /daily operations/i }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /operations/i }));
    expect(
      screen.queryByRole("link", { name: /daily operations/i }),
    ).toBeNull();

    unmount();
    render(<AppSidebar />);

    expect(
      screen.queryByRole("link", { name: /daily operations/i }),
    ).toBeNull();
  });
});
