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
} from "@/components/ui/sidebar";
import * as Collapsible from "@radix-ui/react-collapsible";
import type { ComponentType, MouseEventHandler, ReactNode } from "react";
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
  Workflow,
} from "lucide-react";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import useGetActiveStore from "../hooks/useGetActiveStore";
import { useGetActiveOrganization } from "../hooks/useGetOrganizations";
import { useNewOrderNotification } from "../hooks/useNewOrderNotification";
import { useQuery } from "convex/react";
import { api } from "~/convex/_generated/api";
import { useGetUnresolvedProducts } from "../hooks/useGetProducts";
// import { useProductWithNoImagesNotification } from "../hooks/useProductWithNoImagesNotification";
import { useGetCategories } from "../hooks/useGetCategories";
import { PermissionGate } from "./PermissionGate";
import { usePermissions } from "../hooks/usePermissions";

type SidebarOrderSummary = {
  status: string;
};

function SidebarMenuCollapsible({
  icon: Icon,
  label,
  disabled,
  defaultOpen = false,
  onClick,
  children,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  disabled?: boolean;
  defaultOpen?: boolean;
  onClick?: MouseEventHandler<HTMLButtonElement>;
  children: ReactNode;
}) {
  return (
    <SidebarMenuItem>
      <Collapsible.Root
        defaultOpen={defaultOpen}
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

export function AppSidebar() {
  const { activeStore } = useGetActiveStore();
  const { activeOrganization } = useGetActiveOrganization();
  const location = useLocation();
  const navigate = useNavigate();

  const productsWithNoImages = useGetUnresolvedProducts();

  useNewOrderNotification();

  // useProductWithNoImagesNotification();

  const categories = useGetCategories();

  const orders = useQuery(
    api.storeFront.onlineOrder.getAllOnlineOrders,
    activeStore?._id ? { storeId: activeStore._id } : "skip",
  ) as SidebarOrderSummary[] | undefined;

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

  const { canAccessStoreDaySurfaces, hasFullAdminAccess } = usePermissions();
  const isOperationsRoute = location.pathname.includes("/operations");
  const isOrdersRoute = location.pathname.includes("/orders");
  const isProductsRoute = location.pathname.includes("/products");

  if (!activeStore || !activeOrganization) {
    return null;
  }

  return (
    <Sidebar
      collapsible="icon"
      className="top-16 bottom-auto h-[calc(100svh-4rem)]"
    >
      <SidebarContent>
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
                <SidebarMenuButton disabled={!canAccessStoreDaySurfaces()} asChild>
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
                defaultOpen={isOperationsRoute}
                disabled={!canAccessStoreDaySurfaces()}
                icon={Workflow}
                label="Operations"
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
                      disabled={!canAccessStoreDaySurfaces()}
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
                      disabled={!canAccessStoreDaySurfaces()}
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
                      disabled={!canAccessStoreDaySurfaces()}
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
                      disabled={!canAccessStoreDaySurfaces()}
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
                      disabled={!canAccessStoreDaySurfaces()}
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
                      disabled={!canAccessStoreDaySurfaces()}
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

              {/* Analytics section */}
              <SidebarMenuItem>
                <SidebarMenuButton disabled={!hasFullAdminAccess} asChild>
                  <Link
                    to="/$orgUrlSlug/store/$storeUrlSlug/analytics"
                    params={(p) => ({
                      ...p,
                      orgUrlSlug: activeOrganization?.slug,
                      storeUrlSlug: activeStore?.slug,
                    })}
                    className="flex items-center"
                  >
                    <ChartNoAxesColumn className="w-4 h-4" />
                    <p className="font-medium">Analytics</p>
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
                defaultOpen={isOrdersRoute}
                icon={ShoppingBag}
                label="Orders"
                disabled={!hasFullAdminAccess}
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
                defaultOpen={isProductsRoute}
                icon={Tag}
                label="Products"
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
                      <SidebarMenuButton asChild>
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

                {productsWithNoImages && productsWithNoImages.length > 0 && (
                  <SidebarMenuSub>
                    <SidebarMenuSubItem>
                      <SidebarMenuButton asChild>
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
                            {productsWithNoImages?.length}
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

        <PermissionGate requires="full_admin">
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
        </PermissionGate>
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
  );
}
