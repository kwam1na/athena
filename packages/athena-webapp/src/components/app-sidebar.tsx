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
  Clock,
  Package,
} from "lucide-react";
import { AppHeader } from "./Navbar";
import { Link } from "@tanstack/react-router";
import useGetActiveStore from "../hooks/useGetActiveStore";
import { useGetActiveOrganization } from "../hooks/useGetOrganizations";
import { useNewOrderNotification } from "../hooks/useNewOrderNotification";
import { useAuth } from "../hooks/useAuth";
import { GearIcon } from "@radix-ui/react-icons";
import { useQuery } from "convex/react";
import { api } from "~/convex/_generated/api";
import { useGetProductsWithNoImages } from "../hooks/useGetProducts";

export function AppSidebar() {
  const { activeStore } = useGetActiveStore();
  const { activeOrganization } = useGetActiveOrganization();

  const products = useGetProductsWithNoImages();

  const { user } = useAuth();

  useNewOrderNotification();

  const orders = useQuery(
    api.storeFront.onlineOrder.getAllOnlineOrders,
    activeStore?._id ? { storeId: activeStore._id } : "skip"
  );

  const openOrders = orders?.filter((o: any) => o.status === "open")?.length;

  if (!activeStore || !activeOrganization) {
    return null;
  }

  return (
    <Sidebar>
      <SidebarHeader>
        <SidebarGroup>
          <SidebarGroupContent className="px-6">
            <AppHeader />
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
                    to="/$orgUrlSlug/store/$storeUrlSlug/analytics"
                    params={(p) => ({
                      ...p,
                      orgUrlSlug: activeOrganization?.slug,
                      storeUrlSlug: activeStore?.slug,
                    })}
                    className="flex items-center"
                  >
                    <ChartNoAxesCombined className="w-4 h-4" />
                    <p className="font-medium">Analytics</p>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>

              <SidebarMenuItem>
                <SidebarMenuButton asChild>
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

              {/* <SidebarMenuItem>
                <SidebarMenuButton asChild>
                  <Link
                    to="/$orgUrlSlug/store/$storeUrlSlug/logs"
                    params={(p) => ({
                      ...p,
                      orgUrlSlug: activeOrganization?.slug,
                      storeUrlSlug: activeStore?.slug,
                    })}
                    className="flex items-center"
                  >
                    <Logs className="w-4 h-4" />
                    <p className="font-medium">Logs</p>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem> */}

              <SidebarMenuItem>
                <SidebarMenuButton asChild>
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
                    <SidebarMenuButton asChild>
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
                          <Clock className="w-4 h-4 mr-2" />
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
                    <SidebarMenuButton asChild>
                      <Link
                        to="/$orgUrlSlug/store/$storeUrlSlug/orders/ready"
                        params={(p) => ({
                          ...p,
                          orgUrlSlug: activeOrganization?.slug,
                          storeUrlSlug: activeStore?.slug,
                        })}
                        className="flex items-center"
                      >
                        <Package className="w-4 h-4" />
                        <p className="font-medium">Ready</p>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuSubItem>
                </SidebarMenuSub>

                <SidebarMenuSub>
                  <SidebarMenuSubItem>
                    <SidebarMenuButton asChild>
                      <Link
                        to="/$orgUrlSlug/store/$storeUrlSlug/orders/out-for-delivery"
                        params={(p) => ({
                          ...p,
                          orgUrlSlug: activeOrganization?.slug,
                          storeUrlSlug: activeStore?.slug,
                        })}
                        className="flex items-center"
                      >
                        <Truck className="w-4 h-4" />
                        <p className="font-medium">Out for delivery</p>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuSubItem>
                </SidebarMenuSub>

                <SidebarMenuSub>
                  <SidebarMenuSubItem>
                    <SidebarMenuButton asChild>
                      <Link
                        to="/$orgUrlSlug/store/$storeUrlSlug/orders/completed"
                        params={(p) => ({
                          ...p,
                          orgUrlSlug: activeOrganization?.slug,
                          storeUrlSlug: activeStore?.slug,
                        })}
                        className="flex items-center"
                      >
                        <CheckCircle className="w-4 h-4" />
                        <p className="font-medium">Completed</p>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuSubItem>
                </SidebarMenuSub>

                <SidebarMenuSub>
                  <SidebarMenuSubItem>
                    <SidebarMenuButton asChild>
                      <Link
                        to="/$orgUrlSlug/store/$storeUrlSlug/orders/refunded"
                        params={(p) => ({
                          ...p,
                          orgUrlSlug: activeOrganization?.slug,
                          storeUrlSlug: activeStore?.slug,
                        })}
                        className="flex items-center"
                      >
                        <RotateCcw className="w-4 h-4" />
                        <p className="font-medium">Refunded</p>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuSubItem>
                </SidebarMenuSub>
              </SidebarMenuItem>

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
                    <ScanBarcode className="w-4 h-4" />
                    <p className="font-medium">Products</p>
                  </Link>
                </SidebarMenuButton>

                {products && products.length > 0 && (
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
                          <p className="font-medium">Unresolved</p>
                          <p className="text-xs font-medium">
                            {products.length}
                          </p>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuSubItem>
                  </SidebarMenuSub>
                )}

                <SidebarMenuSub>
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
                </SidebarMenuSub>
              </SidebarMenuItem>

              <SidebarMenuItem>
                <SidebarMenuButton asChild>
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

              <SidebarMenuItem>
                <SidebarMenuButton asChild>
                  <div className="flex items-center">
                    <PanelTop className="w-4 h-4" />
                    <p className="font-medium">Storefront</p>
                  </div>
                </SidebarMenuButton>
                <SidebarMenuSub>
                  <SidebarMenuSubItem>
                    <SidebarMenuButton asChild>
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
                    <SidebarMenuButton asChild>
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
              </SidebarMenuItem>

              <SidebarMenuItem>
                <SidebarMenuButton asChild>
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
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

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
      </SidebarContent>

      <SidebarFooter>
        <div className="flex items-center">
          <UserCircle className="w-4 h-4 mr-1" />
          <p className="text-sm font-medium">{user?.email}</p>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
