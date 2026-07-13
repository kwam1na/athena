import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import * as Collapsible from "@radix-ui/react-collapsible";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ComponentType,
  type MouseEventHandler,
  type ReactNode,
} from "react";
import {
  BadgePercent,
  CheckCircle,
  CogIcon,
  Image,
  PanelTop,
  RotateCcw,
  ScanBarcode,
  ShoppingBag,
  ShoppingBasket,
  Store,
  Truck,
  Users,
  AlertOctagon,
  PackageCheckIcon,
  PackageOpenIcon,
  ChartNoAxesColumn,
  MessageCircleMore,
  CalendarDays,
  Tag,
  XCircle,
  ShoppingCart,
  Layers,
  Banknote,
  ChevronRight,
  PanelLeftClose,
  PanelLeftOpen,
  Workflow,
} from "lucide-react";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import useGetActiveStore from "../hooks/useGetActiveStore";
import { useGetActiveOrganization } from "../hooks/useGetOrganizations";
import { useNewOrderNotification } from "../hooks/useNewOrderNotification";
import { useQuery } from "convex/react";
import { api } from "~/convex/_generated/api";
// import { useProductWithNoImagesNotification } from "../hooks/useProductWithNoImagesNotification";
import { useGetCategories } from "../hooks/useGetCategories";
import { PermissionGate } from "./PermissionGate";
import { usePermissions } from "../hooks/usePermissions";
import { useSharedDemoContext } from "../hooks/useSharedDemoContext";

type SidebarOrderSummary = {
  status: string;
};

type AppSidebarShellVariant = "classic" | "contained";
type SidebarSubmenuId = "operations" | "orders" | "products" | "storefront";
type SidebarSubmenuOpenState = Record<SidebarSubmenuId, boolean>;

const persistedSidebarSubmenuState = new Map<
  string,
  Partial<SidebarSubmenuOpenState>
>();

export function resetAppSidebarSubmenuStateForTests() {
  persistedSidebarSubmenuState.clear();
}

function getSidebarSubmenuOpenState({
  defaultOpen,
  scopeKey,
}: {
  defaultOpen: SidebarSubmenuOpenState;
  scopeKey: string;
}): SidebarSubmenuOpenState {
  const persistedState = persistedSidebarSubmenuState.get(scopeKey) ?? {};

  return {
    operations: persistedState.operations ?? defaultOpen.operations,
    orders: persistedState.orders ?? defaultOpen.orders,
    products: persistedState.products ?? defaultOpen.products,
    storefront: persistedState.storefront ?? defaultOpen.storefront,
  };
}

function ContainedSidebarToggle() {
  const { state, toggleSidebar } = useSidebar();
  const isCollapsed = state === "collapsed";
  const label = isCollapsed ? "Expand sidebar" : "Collapse sidebar";
  const Icon = isCollapsed ? PanelLeftOpen : PanelLeftClose;

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={toggleSidebar}
      className={cn(
        "mt-layout-xs hidden h-9 w-[var(--sidebar-width-icon)] shrink-0 items-center justify-center self-start rounded-lg border border-sidebar-border/70 bg-sidebar text-sidebar-foreground shadow-surface transition-[background-color,border-color,color,transform] duration-fast ease-standard hover:border-sidebar-border hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring active:scale-[0.96] md:flex",
      )}
    >
      <Icon aria-hidden="true" className="h-4 w-4" />
      <span className="sr-only">{label}</span>
    </button>
  );
}

function SidebarMenuCollapsible({
  icon: Icon,
  label,
  disabled,
  open,
  onOpenChange,
  onClick,
  children,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  disabled?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onClick?: MouseEventHandler<HTMLButtonElement>;
  children: ReactNode;
}) {
  return (
    <SidebarMenuItem>
      <Collapsible.Root
        open={open}
        onOpenChange={onOpenChange}
        className="group/sidebar-collapsible"
      >
        <Collapsible.Trigger asChild>
          <SidebarMenuButton
            disabled={disabled}
            className="w-full"
            onClick={onClick}
          >
            <Icon className="w-4 h-4" />
            <p className="font-medium">{label}</p>
            <ChevronRight className="ml-auto h-4 w-4 transition-transform duration-standard ease-standard group-data-[state=open]/sidebar-collapsible:rotate-90" />
          </SidebarMenuButton>
        </Collapsible.Trigger>
        <Collapsible.Content>{children}</Collapsible.Content>
      </Collapsible.Root>
    </SidebarMenuItem>
  );
}

export function AppSidebar({
  shellVariant = "classic",
}: {
  shellVariant?: AppSidebarShellVariant;
}) {
  const { activeStore } = useGetActiveStore();
  const { activeOrganization } = useGetActiveOrganization();
  const location = useLocation();
  const navigate = useNavigate();

  useNewOrderNotification();

  // useProductWithNoImagesNotification();

  const categories = useGetCategories();

  const catalogSummary = useQuery(
    api.inventory.products.getCatalogSummary,
    activeStore?._id ? { storeId: activeStore._id } : "skip",
  );
  const unresolvedProductCount =
    catalogSummary &&
    catalogSummary.updatedAt !== 0 &&
    catalogSummary.needsRefresh !== true
      ? catalogSummary.missingInfoProductCount
      : undefined;

  const orders = useQuery(
    api.storeFront.onlineOrder.getAllOnlineOrders,
    activeStore?._id ? { storeId: activeStore._id } : "skip",
  ) as SidebarOrderSummary[] | undefined;
  const sharedDemoContext = useSharedDemoContext();
  const isSharedDemo = sharedDemoContext?.kind === "shared_demo";

  const openOrders = orders?.filter((order) => order.status === "open")?.length;

  const readyOrders = orders?.filter((order) =>
    order.status.includes("ready"),
  )?.length;

  const outForDeliveryOrders = orders?.filter(
    (order) => order.status === "out-for-delivery",
  )?.length;

  const completedOrders = orders?.filter((order) =>
    ["delivered", "picked-up"].includes(order.status),
  )?.length;

  const refundedOrders = orders?.filter(
    (order) => order.status === "refunded",
  )?.length;

  const cancelledOrders = orders?.filter(
    (order) => order.status === "cancelled",
  )?.length;

  const unapprovedReviewsCount = useQuery(
    api.storeFront.reviews.getUnapprovedReviewsCount,
    activeStore?._id ? { storeId: activeStore._id } : "skip",
  );

  const {
    hasFinancialDetailsAccess,
    hasFullAdminAccess,
  } = usePermissions();
  const isOperationsRoute = location.pathname.includes("/operations");
  const isOrdersRoute = location.pathname.includes("/orders");
  const isProductsRoute = location.pathname.includes("/products");

  const sidebarSubmenuScopeKey = [
    activeOrganization?._id ?? "no-org",
    activeStore?._id ?? "no-store",
  ].join(":");
  const defaultSidebarSubmenuOpenState = useMemo<SidebarSubmenuOpenState>(
    () => ({
      operations: isOperationsRoute,
      orders: isOrdersRoute,
      products: isProductsRoute,
      storefront: false,
    }),
    [isOperationsRoute, isOrdersRoute, isProductsRoute],
  );
  const [sidebarSubmenuOpenState, setSidebarSubmenuOpenState] =
    useState<SidebarSubmenuOpenState>(() =>
      getSidebarSubmenuOpenState({
        defaultOpen: defaultSidebarSubmenuOpenState,
        scopeKey: sidebarSubmenuScopeKey,
      }),
    );

  useEffect(() => {
    setSidebarSubmenuOpenState(
      getSidebarSubmenuOpenState({
        defaultOpen: defaultSidebarSubmenuOpenState,
        scopeKey: sidebarSubmenuScopeKey,
      }),
    );
  }, [defaultSidebarSubmenuOpenState, sidebarSubmenuScopeKey]);

  const setSidebarSubmenuOpen = useCallback(
    (id: SidebarSubmenuId, open: boolean) => {
      setSidebarSubmenuOpenState((currentState) => {
        const currentPersistedState =
          persistedSidebarSubmenuState.get(sidebarSubmenuScopeKey) ?? {};
        const nextState = {
          ...currentState,
          [id]: open,
        };
        persistedSidebarSubmenuState.set(sidebarSubmenuScopeKey, {
          ...currentPersistedState,
          [id]: open,
        });
        return nextState;
      });
    },
    [sidebarSubmenuScopeKey],
  );

  if (!activeStore || !activeOrganization) {
    return null;
  }

  const isContainedShell = shellVariant === "contained";

  return (
    <Sidebar
      collapsible="icon"
      variant={isContainedShell ? "contained" : "sidebar"}
      className={cn(
        "top-16 bottom-auto h-[calc(100svh-4rem)]",
        isContainedShell &&
          "md:top-20 md:bottom-auto md:h-auto md:max-h-[calc(100svh-6rem)] md:flex-col md:px-layout-sm",
      )}
    >
      <SidebarContent
        className={cn(
          isContainedShell &&
            "relative h-full max-h-full w-full shrink-0 flex-none gap-layout-xs border-sidebar-border/60 bg-sidebar text-sidebar-foreground backdrop-blur md:h-fit md:max-h-[calc(100svh-6rem)] md:w-[calc(var(--sidebar-width-contained)-theme(spacing.4))] md:rounded-lg md:border md:p-layout-xs md:shadow-surface group-data-[collapsible=icon]:w-[var(--sidebar-width-icon)] group-data-[collapsible=icon]:p-0 supports-[backdrop-filter]:bg-sidebar/95",
        )}
      >
        {/* Store section */}
        <SidebarGroup>
          <SidebarGroupLabel>Store</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild>
                  <Link
                    to="/$orgUrlSlug/store/$storeUrlSlug/pos"
                    params={(p) => ({
                      ...p,
                      orgUrlSlug: activeOrganization?.slug,
                      storeUrlSlug: activeStore?.slug,
                    })}
                    className="flex items-center"
                  >
                    <ScanBarcode className="w-4 h-4" />
                    <p className="font-medium">Point of Sale</p>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>

              <SidebarMenuItem>
                <SidebarMenuButton
                  disabled={!hasFinancialDetailsAccess}
                  asChild
                >
                  <Link
                    to="/$orgUrlSlug/store/$storeUrlSlug/cash-controls"
                    params={(p) => ({
                      ...p,
                      orgUrlSlug: activeOrganization?.slug,
                      storeUrlSlug: activeStore?.slug,
                    })}
                    className="flex items-center"
                  >
                    <Banknote className="w-4 h-4" />
                    <p className="font-medium">Cash Controls</p>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>

              <SidebarMenuCollapsible
                disabled={!hasFinancialDetailsAccess}
                icon={Workflow}
                label="Operations"
                open={sidebarSubmenuOpenState.operations}
                onOpenChange={(open) =>
                  setSidebarSubmenuOpen("operations", open)
                }
                onClick={() => {
                  void navigate({
                    to: "/$orgUrlSlug/store/$storeUrlSlug/operations",
                    params: {
                      orgUrlSlug: activeOrganization.slug,
                      storeUrlSlug: activeStore.slug,
                    },
                  });
                }}
              >
                <SidebarMenuSub>
                  <SidebarMenuSubItem>
                    <SidebarMenuButton
                      disabled={!hasFinancialDetailsAccess}
                      asChild
                    >
                      <Link
                        to="/$orgUrlSlug/store/$storeUrlSlug/operations"
                        params={(p) => ({
                          ...p,
                          orgUrlSlug: activeOrganization?.slug,
                          storeUrlSlug: activeStore?.slug,
                        })}
                        className="flex items-center"
                      >
                        <p className="font-medium">Daily operations</p>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuSubItem>

                  <SidebarMenuSubItem>
                    <SidebarMenuButton
                      disabled={!hasFinancialDetailsAccess}
                      asChild
                    >
                      <Link
                        to="/$orgUrlSlug/store/$storeUrlSlug/operations/inventory-import"
                        params={(p) => ({
                          ...p,
                          orgUrlSlug: activeOrganization?.slug,
                          storeUrlSlug: activeStore?.slug,
                        })}
                        className="flex items-center"
                      >
                        <p className="font-medium">Inventory import</p>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuSubItem>

                  <SidebarMenuSubItem>
                    <SidebarMenuButton
                      disabled={!hasFinancialDetailsAccess}
                      asChild
                    >
                      <Link
                        to="/$orgUrlSlug/store/$storeUrlSlug/operations/opening"
                        params={(p) => ({
                          ...p,
                          orgUrlSlug: activeOrganization?.slug,
                          storeUrlSlug: activeStore?.slug,
                        })}
                        className="flex items-center"
                      >
                        <p className="font-medium">Opening Handoff</p>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuSubItem>

                  <SidebarMenuSubItem>
                    <SidebarMenuButton
                      disabled={!hasFinancialDetailsAccess}
                      asChild
                    >
                      <Link
                        to="/$orgUrlSlug/store/$storeUrlSlug/operations/daily-close"
                        params={(p) => ({
                          ...p,
                          orgUrlSlug: activeOrganization?.slug,
                          storeUrlSlug: activeStore?.slug,
                        })}
                        className="flex items-center"
                      >
                        <p className="font-medium">EOD Review</p>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuSubItem>

                  <SidebarMenuSubItem>
                    <SidebarMenuButton
                      disabled={!hasFinancialDetailsAccess}
                      asChild
                    >
                      <Link
                        to="/$orgUrlSlug/store/$storeUrlSlug/operations/open-work"
                        params={(p) => ({
                          ...p,
                          orgUrlSlug: activeOrganization?.slug,
                          storeUrlSlug: activeStore?.slug,
                        })}
                        className="flex items-center"
                      >
                        <p className="font-medium">Open work</p>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuSubItem>

                  <SidebarMenuSubItem>
                    <SidebarMenuButton
                      disabled={!hasFinancialDetailsAccess}
                      asChild
                    >
                      <Link
                        to="/$orgUrlSlug/store/$storeUrlSlug/operations/approvals"
                        params={(p) => ({
                          ...p,
                          orgUrlSlug: activeOrganization?.slug,
                          storeUrlSlug: activeStore?.slug,
                        })}
                        className="flex items-center"
                      >
                        <p className="font-medium">Approvals</p>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuSubItem>

                  <SidebarMenuSubItem>
                    <SidebarMenuButton
                      disabled={!hasFinancialDetailsAccess}
                      asChild
                    >
                      <Link
                        to="/$orgUrlSlug/store/$storeUrlSlug/operations/stock-adjustments"
                        params={(p) => ({
                          ...p,
                          orgUrlSlug: activeOrganization?.slug,
                          storeUrlSlug: activeStore?.slug,
                        })}
                        className="flex items-center"
                      >
                        <p className="font-medium">Stock adjustments</p>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuSubItem>

                  <SidebarMenuSubItem>
                    <SidebarMenuButton
                      disabled={!hasFinancialDetailsAccess}
                      asChild
                    >
                      <Link
                        to="/$orgUrlSlug/store/$storeUrlSlug/operations/sku-activity"
                        params={(p) => ({
                          ...p,
                          orgUrlSlug: activeOrganization?.slug,
                          storeUrlSlug: activeStore?.slug,
                        })}
                        className="flex items-center gap-2"
                      >
                        <p className="font-medium">SKU activity</p>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuSubItem>
                </SidebarMenuSub>
              </SidebarMenuCollapsible>

              <SidebarMenuItem>
                <SidebarMenuButton disabled={!hasFullAdminAccess} asChild>
                  <Link
                    to="/$orgUrlSlug/store/$storeUrlSlug/procurement"
                    params={(p) => ({
                      ...p,
                      orgUrlSlug: activeOrganization?.slug,
                      storeUrlSlug: activeStore?.slug,
                    })}
                    className="flex items-center"
                  >
                    <Truck className="w-4 h-4" />
                    <p className="font-medium">Procurement</p>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>

              {/* Reports section */}
              <SidebarMenuItem>
                <SidebarMenuButton disabled={!hasFullAdminAccess} asChild>
                  <Link
                    to="/$orgUrlSlug/store/$storeUrlSlug/reports"
                    params={(p) => ({
                      ...p,
                      orgUrlSlug: activeOrganization?.slug,
                      storeUrlSlug: activeStore?.slug,
                    })}
                    className="flex items-center"
                  >
                    <ChartNoAxesColumn className="w-4 h-4" />
                    <p className="font-medium">Reports</p>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>

              {/* Homepage section */}
              <SidebarMenuItem>
                <SidebarMenuButton disabled={!hasFullAdminAccess} asChild>
                  <Link
                    to="/$orgUrlSlug/store/$storeUrlSlug/home"
                    params={(p) => ({
                      ...p,
                      orgUrlSlug: activeOrganization?.slug,
                      storeUrlSlug: activeStore?.slug,
                    })}
                    className="flex items-center"
                  >
                    <Store className="w-4 h-4" />
                    <p className="font-medium">Homepage</p>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>

              {/* Orders section */}
              <SidebarMenuCollapsible
                icon={ShoppingBag}
                label="Orders"
                disabled={!hasFullAdminAccess}
                open={sidebarSubmenuOpenState.orders}
                onOpenChange={(open) => setSidebarSubmenuOpen("orders", open)}
                onClick={() => {
                  void navigate({
                    to: "/$orgUrlSlug/store/$storeUrlSlug/orders",
                    params: {
                      orgUrlSlug: activeOrganization.slug,
                      storeUrlSlug: activeStore.slug,
                    },
                  });
                }}
              >
                <SidebarMenuSub>
                  <SidebarMenuSubItem>
                    <SidebarMenuButton disabled={!hasFullAdminAccess} asChild>
                      <Link
                        to="/$orgUrlSlug/store/$storeUrlSlug/orders/open"
                        params={(p) => ({
                          ...p,
                          orgUrlSlug: activeOrganization?.slug,
                          storeUrlSlug: activeStore?.slug,
                        })}
                        className="flex items-center justify-between"
                      >
                        <div className="flex items-center">
                          <PackageOpenIcon className="w-4 h-4 mr-2" />
                          <p className="font-medium">Open</p>
                        </div>
                        {Boolean(openOrders) && (
                          <p className="text-xs font-medium">{openOrders}</p>
                        )}
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuSubItem>
                </SidebarMenuSub>

                <SidebarMenuSub>
                  <SidebarMenuSubItem>
                    <SidebarMenuButton disabled={!hasFullAdminAccess} asChild>
                      <Link
                        to="/$orgUrlSlug/store/$storeUrlSlug/orders/ready"
                        params={(p) => ({
                          ...p,
                          orgUrlSlug: activeOrganization?.slug,
                          storeUrlSlug: activeStore?.slug,
                        })}
                        className="flex items-center justify-between"
                      >
                        <div className="flex items-center">
                          <PackageCheckIcon className="w-4 h-4 mr-2" />
                          <p className="font-medium">Ready</p>
                        </div>
                        {Boolean(readyOrders) && (
                          <p className="text-xs font-medium">{readyOrders}</p>
                        )}
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuSubItem>
                </SidebarMenuSub>

                <SidebarMenuSub>
                  <SidebarMenuSubItem>
                    <SidebarMenuButton disabled={!hasFullAdminAccess} asChild>
                      <Link
                        to="/$orgUrlSlug/store/$storeUrlSlug/orders/out-for-delivery"
                        params={(p) => ({
                          ...p,
                          orgUrlSlug: activeOrganization?.slug,
                          storeUrlSlug: activeStore?.slug,
                        })}
                        className="flex items-center justify-between"
                      >
                        <div className="flex items-center">
                          <Truck className="w-4 h-4 mr-2" />
                          <p className="font-medium">Out for delivery</p>
                        </div>

                        {Boolean(outForDeliveryOrders) && (
                          <p className="text-xs font-medium">
                            {outForDeliveryOrders}
                          </p>
                        )}
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuSubItem>
                </SidebarMenuSub>

                <SidebarMenuSub>
                  <SidebarMenuSubItem>
                    <SidebarMenuButton disabled={!hasFullAdminAccess} asChild>
                      <Link
                        to="/$orgUrlSlug/store/$storeUrlSlug/orders/completed"
                        params={(p) => ({
                          ...p,
                          orgUrlSlug: activeOrganization?.slug,
                          storeUrlSlug: activeStore?.slug,
                        })}
                        className="flex items-center justify-between"
                      >
                        <div className="flex items-center">
                          <CheckCircle className="w-4 h-4 mr-2" />
                          <p className="font-medium">Completed</p>
                        </div>

                        {Boolean(completedOrders) && (
                          <p className="text-xs font-medium">
                            {completedOrders}
                          </p>
                        )}
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuSubItem>
                </SidebarMenuSub>

                <SidebarMenuSub>
                  <SidebarMenuSubItem>
                    <SidebarMenuButton disabled={!hasFullAdminAccess} asChild>
                      <Link
                        to="/$orgUrlSlug/store/$storeUrlSlug/orders/refunded"
                        params={(p) => ({
                          ...p,
                          orgUrlSlug: activeOrganization?.slug,
                          storeUrlSlug: activeStore?.slug,
                        })}
                        className="flex items-center justify-between"
                      >
                        <div className="flex items-center">
                          <RotateCcw className="w-4 h-4 mr-2" />
                          <p className="font-medium">Refunded</p>
                        </div>

                        {Boolean(refundedOrders) && (
                          <p className="text-xs font-medium">
                            {refundedOrders}
                          </p>
                        )}
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuSubItem>
                </SidebarMenuSub>

                <SidebarMenuSub>
                  <SidebarMenuSubItem>
                    <SidebarMenuButton disabled={!hasFullAdminAccess} asChild>
                      <Link
                        to="/$orgUrlSlug/store/$storeUrlSlug/orders/cancelled"
                        params={(p) => ({
                          ...p,
                          orgUrlSlug: activeOrganization?.slug,
                          storeUrlSlug: activeStore?.slug,
                        })}
                        className="flex items-center justify-between"
                      >
                        <div className="flex items-center">
                          <XCircle className="w-4 h-4 mr-2" />
                          <p className="font-medium">Cancelled</p>
                        </div>

                        {Boolean(cancelledOrders) && (
                          <p className="text-xs font-medium">
                            {cancelledOrders}
                          </p>
                        )}
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuSubItem>
                </SidebarMenuSub>
              </SidebarMenuCollapsible>

              {/* Products section */}
              <SidebarMenuCollapsible
                disabled={!hasFinancialDetailsAccess}
                icon={Tag}
                label="Products"
                open={sidebarSubmenuOpenState.products}
                onOpenChange={(open) =>
                  setSidebarSubmenuOpen("products", open)
                }
                onClick={() => {
                  void navigate({
                    to: "/$orgUrlSlug/store/$storeUrlSlug/products",
                    params: {
                      orgUrlSlug: activeOrganization.slug,
                      storeUrlSlug: activeStore.slug,
                    },
                  });
                }}
              >
                {categories?.map((category) => (
                  <SidebarMenuSub key={category._id}>
                    <SidebarMenuSubItem>
                      <SidebarMenuButton
                        disabled={!hasFinancialDetailsAccess}
                        asChild
                      >
                        <Link
                          to="/$orgUrlSlug/store/$storeUrlSlug/products"
                          params={(p) => ({
                            ...p,
                            orgUrlSlug: activeOrganization?.slug,
                            storeUrlSlug: activeStore?.slug,
                          })}
                          search={{
                            categorySlug: category.slug,
                          }}
                          className="flex items-center"
                        >
                          <p className="font-medium">{category.name}</p>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuSubItem>
                  </SidebarMenuSub>
                ))}

                {unresolvedProductCount !== undefined &&
                  unresolvedProductCount > 0 && (
                  <SidebarMenuSub>
                    <SidebarMenuSubItem>
                      <SidebarMenuButton
                        disabled={!hasFinancialDetailsAccess}
                        asChild
                      >
                        <Link
                          to="/$orgUrlSlug/store/$storeUrlSlug/products/unresolved"
                          params={(p) => ({
                            ...p,
                            orgUrlSlug: activeOrganization?.slug,
                            storeUrlSlug: activeStore?.slug,
                          })}
                          className="flex items-center justify-between"
                        >
                          <div className="flex items-center">
                            <AlertOctagon className="w-4 h-4 mr-2" />
                            <p className="font-medium">Unresolved</p>
                          </div>
                          <p className="text-xs font-medium">
                            {unresolvedProductCount}
                          </p>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuSubItem>
                  </SidebarMenuSub>
                  )}

                {/* <SidebarMenuSub>
                  <SidebarMenuSubItem>
                    <SidebarMenuButton asChild>
                      <Link
                        to="/$orgUrlSlug/store/$storeUrlSlug/products/complimentary"
                        params={(p) => ({
                          ...p,
                          orgUrlSlug: activeOrganization?.slug,
                          storeUrlSlug: activeStore?.slug,
                        })}
                        className="flex items-center"
                      >
                        <Gift className="w-4 h-4" />
                        <p className="font-medium">Complimentary</p>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuSubItem>
                </SidebarMenuSub> */}
              </SidebarMenuCollapsible>

              {!isSharedDemo ? (
                <>
                  {/* Bulk operations section */}
                  <SidebarMenuItem>
                <SidebarMenuButton disabled={!hasFullAdminAccess} asChild>
                  <Link
                    to="/$orgUrlSlug/store/$storeUrlSlug/bulk-operations"
                    params={(p) => ({
                      ...p,
                      orgUrlSlug: activeOrganization?.slug,
                      storeUrlSlug: activeStore?.slug,
                    })}
                    className="flex items-center"
                  >
                    <Layers className="w-4 h-4" />
                    <p className="font-medium">Bulk Operations</p>
                  </Link>
                </SidebarMenuButton>
                  </SidebarMenuItem>

                  {/* Promo codes section */}
                  <SidebarMenuItem>
                <SidebarMenuButton disabled={!hasFullAdminAccess} asChild>
                  <Link
                    to="/$orgUrlSlug/store/$storeUrlSlug/promo-codes"
                    params={(p) => ({
                      ...p,
                      orgUrlSlug: activeOrganization?.slug,
                      storeUrlSlug: activeStore?.slug,
                    })}
                    className="flex items-center"
                  >
                    <BadgePercent className="w-4 h-4" />
                    <p className="font-medium">Promo codes</p>
                  </Link>
                </SidebarMenuButton>
                  </SidebarMenuItem>
                </>
              ) : null}

              {/* Reviews section */}
              <SidebarMenuItem>
                <SidebarMenuButton disabled={!hasFullAdminAccess} asChild>
                  <Link
                    to="/$orgUrlSlug/store/$storeUrlSlug/reviews/new"
                    params={(p) => ({
                      ...p,
                      orgUrlSlug: activeOrganization?.slug,
                      storeUrlSlug: activeStore?.slug,
                    })}
                    className="flex items-center justify-between"
                  >
                    <div className="flex items-center">
                      <MessageCircleMore className="w-4 h-4 mr-2" />
                      <p className="font-medium">Reviews</p>
                    </div>
                    {Boolean(unapprovedReviewsCount) && (
                      <p className="text-xs font-medium">
                        {unapprovedReviewsCount}
                      </p>
                    )}
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>

              {/* Storefront section */}
              <SidebarMenuCollapsible
                icon={PanelTop}
                label="Storefront"
                disabled={!hasFullAdminAccess}
                open={sidebarSubmenuOpenState.storefront}
                onOpenChange={(open) =>
                  setSidebarSubmenuOpen("storefront", open)
                }
              >
                <SidebarMenuSub>
                  <SidebarMenuSubItem>
                    <SidebarMenuButton disabled={!hasFullAdminAccess} asChild>
                      <Link
                        to="/$orgUrlSlug/store/$storeUrlSlug/assets"
                        params={(p) => ({
                          ...p,
                          orgUrlSlug: activeOrganization?.slug,
                          storeUrlSlug: activeStore?.slug,
                        })}
                        className="flex items-center"
                      >
                        <Image className="w-4 h-4" />
                        <p className="font-medium">Assets</p>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuSubItem>
                </SidebarMenuSub>

                <SidebarMenuSub>
                  <SidebarMenuSubItem>
                    <SidebarMenuButton disabled={!hasFullAdminAccess} asChild>
                      <Link
                        to="/$orgUrlSlug/store/$storeUrlSlug/checkout-sessions"
                        params={(p) => ({
                          ...p,
                          orgUrlSlug: activeOrganization?.slug,
                          storeUrlSlug: activeStore?.slug,
                        })}
                        className="flex items-center"
                      >
                        <ShoppingCart className="w-4 h-4" />
                        <p className="font-medium">Checkout sessions</p>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuSubItem>
                </SidebarMenuSub>

                <SidebarMenuSub>
                  <SidebarMenuSubItem>
                    <SidebarMenuButton disabled={!hasFullAdminAccess} asChild>
                      <Link
                        to="/$orgUrlSlug/store/$storeUrlSlug/configuration"
                        params={(p) => ({
                          ...p,
                          orgUrlSlug: activeOrganization?.slug,
                          storeUrlSlug: activeStore?.slug,
                        })}
                        className="flex items-center"
                      >
                        <CogIcon className="w-4 h-4" />
                        <p className="font-medium">Configuration</p>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuSubItem>
                </SidebarMenuSub>

                <SidebarMenuSub>
                  <SidebarMenuSubItem>
                    <SidebarMenuButton disabled={!hasFullAdminAccess} asChild>
                      <Link
                        to="/$orgUrlSlug/store/$storeUrlSlug/bags"
                        params={(p) => ({
                          ...p,
                          orgUrlSlug: activeOrganization?.slug,
                          storeUrlSlug: activeStore?.slug,
                        })}
                        className="flex items-center"
                      >
                        <ShoppingBasket className="w-4 h-4" />
                        <p className="font-medium">User bags</p>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuSubItem>
                </SidebarMenuSub>
              </SidebarMenuCollapsible>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <PermissionGate requires="full_admin">
          <SidebarGroup>
            <SidebarGroupLabel>Services</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild>
                    <Link
                      to="/$orgUrlSlug/store/$storeUrlSlug/services/intake"
                      params={(p) => ({
                        ...p,
                        orgUrlSlug: activeOrganization?.slug,
                        storeUrlSlug: activeStore?.slug,
                      })}
                      className="flex items-center"
                    >
                      <PackageOpenIcon className="w-4 h-4" />
                      <p className="font-medium">Service Intake</p>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>

                <SidebarMenuItem>
                  <SidebarMenuButton asChild>
                    <Link
                      to="/$orgUrlSlug/store/$storeUrlSlug/services/appointments"
                      params={(p) => ({
                        ...p,
                        orgUrlSlug: activeOrganization?.slug,
                        storeUrlSlug: activeStore?.slug,
                      })}
                      className="flex items-center"
                    >
                      <CalendarDays className="w-4 h-4" />
                      <p className="font-medium">Appointments</p>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>

                <SidebarMenuItem>
                  <SidebarMenuButton asChild>
                    <Link
                      to="/$orgUrlSlug/store/$storeUrlSlug/services/active-cases"
                      params={(p) => ({
                        ...p,
                        orgUrlSlug: activeOrganization?.slug,
                        storeUrlSlug: activeStore?.slug,
                      })}
                      className="flex items-center"
                    >
                      <PackageCheckIcon className="w-4 h-4" />
                      <p className="font-medium">Active Cases</p>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>

                <SidebarMenuItem>
                  <SidebarMenuButton asChild>
                    <Link
                      to="/$orgUrlSlug/store/$storeUrlSlug/services/catalog-management"
                      params={(p) => ({
                        ...p,
                        orgUrlSlug: activeOrganization?.slug,
                        storeUrlSlug: activeStore?.slug,
                      })}
                      className="flex items-center"
                    >
                      <Tag className="w-4 h-4" />
                      <p className="font-medium">Catalog Management</p>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </PermissionGate>

        {!isSharedDemo ? <PermissionGate requires="full_admin">
          <SidebarGroup>
            <SidebarGroupLabel>Organization</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild>
                    <Link
                      to="/$orgUrlSlug/store/$storeUrlSlug/members"
                      params={(p) => ({
                        ...p,
                        orgUrlSlug: activeOrganization?.slug,
                        storeUrlSlug: activeStore?.slug,
                      })}
                      className="flex items-center"
                    >
                      <Users className="w-4 h-4" />
                      <p className="font-medium">Members</p>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </PermissionGate> : null}

        {!isSharedDemo ? <PermissionGate requires="full_admin">
          <SidebarGroup>
            <SidebarGroupLabel>App</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild>
                    <Link
                      to="/$orgUrlSlug/store/$storeUrlSlug/app-settings"
                      params={(p) => ({
                        ...p,
                        orgUrlSlug: activeOrganization?.slug,
                        storeUrlSlug: activeStore?.slug,
                      })}
                      className="flex items-center"
                    >
                      <CogIcon className="w-4 h-4" />
                      <p className="font-medium">Settings</p>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </PermissionGate> : null}
      </SidebarContent>
      {isContainedShell ? <ContainedSidebarToggle /> : <SidebarRail />}
    </Sidebar>
  );
}
