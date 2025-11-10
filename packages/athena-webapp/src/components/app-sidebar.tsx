import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubItem,
  SidebarRail,
} from "@/components/ui/sidebar";
import {
  BadgePercent,
  ChartNoAxesCombined,
  CheckCircle,
  CogIcon,
  Gift,
  Image,
  PanelTop,
  RotateCcw,
  ScanBarcode,
  ShoppingBag,
  ShoppingBasket,
  Store,
  Truck,
  UserCircle,
  Users,
  AlertOctagon,
  PackageCheckIcon,
  PackageOpenIcon,
  ChartNoAxesColumn,
  MessageCircle,
  MessageCircleDashed,
  MessageCircleMore,
  Tag,
  XCircle,
  ChevronDown,
  ShoppingCart,
} from "lucide-react";
import { AppHeader } from "./Navbar";
import { Link } from "@tanstack/react-router";
import useGetActiveStore from "../hooks/useGetActiveStore";
import { useGetActiveOrganization } from "../hooks/useGetOrganizations";
import { useNewOrderNotification } from "../hooks/useNewOrderNotification";
import { useAuth } from "../hooks/useAuth";
import { useQuery } from "convex/react";
import { api } from "~/convex/_generated/api";
import { useGetProductsWithNoImages } from "../hooks/useGetProducts";
import { useProductWithNoImagesNotification } from "../hooks/useProductWithNoImagesNotification";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@radix-ui/react-collapsible";
import { useGetCategories } from "../hooks/useGetCategories";
import { PermissionGate } from "./PermissionGate";
import { usePermissions } from "../hooks/usePermissions";

export function AppSidebar() {
  const { activeStore } = useGetActiveStore();
  const { activeOrganization } = useGetActiveOrganization();

  const productsWithNoImages = useGetProductsWithNoImages();

  const { user } = useAuth();

  useNewOrderNotification();

  useProductWithNoImagesNotification();

  const categories = useGetCategories();

  const orders = useQuery(
    api.storeFront.onlineOrder.getAllOnlineOrders,
    activeStore?._id ? { storeId: activeStore._id } : "skip"
  );

  const openOrders = orders?.filter((o: any) => o.status === "open")?.length;

  const readyOrders = orders?.filter((o: any) =>
    o.status.includes("ready")
  )?.length;

  const outForDeliveryOrders = orders?.filter(
    (o: any) => o.status === "out-for-delivery"
  )?.length;

  const completedOrders = orders?.filter((o: any) =>
    ["delivered", "picked-up"].includes(o.status)
  )?.length;

  const refundedOrders = orders?.filter(
    (o: any) => o.status === "refunded"
  )?.length;

  const cancelledOrders = orders?.filter(
    (o: any) => o.status === "cancelled"
  )?.length;

  const unapprovedReviewsCount = useQuery(
    api.storeFront.reviews.getUnapprovedReviewsCount,
    activeStore?._id ? { storeId: activeStore._id } : "skip"
  );

  const { hasFullAdmin } = usePermissions();

  const hasFullAdminAccess = hasFullAdmin();

  if (!activeStore || !activeOrganization) {
    return null;
  }

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarGroup>
          <SidebarGroupContent>
            {/* Shows AppHeader when expanded, icon when collapsed */}
            <div className="group-data-[collapsible=icon]:hidden px-6">
              <AppHeader />
            </div>
            {/* <div className="hidden group-data-[collapsible=icon]:block">
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    asChild
                    tooltip={`${activeOrganization.name} - ${activeStore.name}`}
                  >
                    <Link to="/">
                      <Store className="w-4 h-4" />
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </div> */}
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarHeader>
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
              <SidebarMenuItem>
                <SidebarMenuButton disabled={!hasFullAdminAccess} asChild>
                  <Link
                    to="/$orgUrlSlug/store/$storeUrlSlug/orders/all"
                    params={(p) => ({
                      ...p,
                      orgUrlSlug: activeOrganization?.slug,
                      storeUrlSlug: activeStore?.slug,
                    })}
                    className="flex items-center"
                  >
                    <ShoppingBag className="w-4 h-4" />
                    <p className="font-medium">Orders</p>
                  </Link>
                </SidebarMenuButton>

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
              </SidebarMenuItem>

              {/* Products section */}
              <SidebarMenuItem>
                <SidebarMenuButton asChild>
                  <Link
                    to="/$orgUrlSlug/store/$storeUrlSlug/products"
                    params={(p) => ({
                      ...p,
                      orgUrlSlug: activeOrganization?.slug,
                      storeUrlSlug: activeStore?.slug,
                    })}
                    className="flex items-center"
                  >
                    <Tag className="w-4 h-4" />
                    <p className="font-medium">Products</p>
                  </Link>
                </SidebarMenuButton>

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
              <SidebarMenuItem>
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
                    <PanelTop className="w-4 h-4" />
                    <p className="font-medium">Storefront</p>
                  </Link>
                </SidebarMenuButton>

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
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

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

      <SidebarFooter>
        {/* User Footer - Shows email when expanded, icon when collapsed */}
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip={user?.email}
              className="group-data-[collapsible=icon]:justify-center"
            >
              <UserCircle className="w-4 h-4 shrink-0" />
              <div className="group-data-[collapsible=icon]:hidden">
                <p className="text-sm font-medium truncate">{user?.email}</p>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
