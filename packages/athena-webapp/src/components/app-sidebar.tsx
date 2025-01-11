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
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar";
import {
  Calendar,
  ChevronDown,
  Home,
  Inbox,
  PanelTop,
  Search,
  Settings,
  ShoppingBag,
  ShoppingBasket,
  ShoppingCart,
  Store,
} from "lucide-react";
import { AppHeader } from "./Navbar";
import { Link } from "@tanstack/react-router";
import useGetActiveStore from "../hooks/useGetActiveStore";
import { useGetActiveOrganization } from "../hooks/useGetOrganizations";
import { useNewOrderNotification } from "../hooks/useNewOrderNotification";

export function AppSidebar() {
  const { activeStore } = useGetActiveStore();
  const { activeOrganization } = useGetActiveOrganization();

  useNewOrderNotification();

  if (!activeStore || !activeOrganization) {
    return null;
  }

  return (
    <Sidebar>
      <SidebarHeader />
      <Sidebar>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent className="px-6">
              <AppHeader />
            </SidebarGroupContent>
          </SidebarGroup>

          {/* Store section */}
          <SidebarGroup>
            <SidebarGroupLabel>Store</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
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

                <SidebarMenuItem>
                  <SidebarMenuButton asChild>
                    <Link
                      to="/$orgUrlSlug/store/$storeUrlSlug/orders"
                      params={(p) => ({
                        ...p,
                        orgUrlSlug: activeOrganization?.slug,
                        storeUrlSlug: activeStore?.slug,
                      })}
                      className="flex items-center"
                    >
                      <ShoppingCart className="w-4 h-4" />
                      <p className="font-medium">Orders</p>
                    </Link>
                  </SidebarMenuButton>
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
                      <ShoppingBasket className="w-4 h-4" />
                      <p className="font-medium">Products</p>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>

                <SidebarMenuItem>
                  <SidebarGroupLabel>Configuration</SidebarGroupLabel>
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
                          <p className="font-medium">Store</p>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuSubItem>
                  </SidebarMenuSub>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
      </Sidebar>
      <SidebarFooter />
    </Sidebar>
  );
}
