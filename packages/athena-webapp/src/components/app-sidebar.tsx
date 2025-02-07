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
  Cog,
  CogIcon,
  Image,
  PanelBottom,
  PanelTop,
  PersonStanding,
  ShoppingBasket,
  ShoppingCart,
  Store,
  UserCircle,
  UserCircle2,
  Users,
} from "lucide-react";
import { AppHeader } from "./Navbar";
import { Link } from "@tanstack/react-router";
import useGetActiveStore from "../hooks/useGetActiveStore";
import { useGetActiveOrganization } from "../hooks/useGetOrganizations";
import { useNewOrderNotification } from "../hooks/useNewOrderNotification";
import { useAuth } from "../hooks/useAuth";
import { GearIcon } from "@radix-ui/react-icons";

export function AppSidebar() {
  const { activeStore } = useGetActiveStore();
  const { activeOrganization } = useGetActiveOrganization();

  const { user } = useAuth();

  useNewOrderNotification();

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
