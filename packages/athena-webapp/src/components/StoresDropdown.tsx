import {
  Cloud,
  CreditCard,
  Github,
  House,
  Keyboard,
  LifeBuoy,
  LogOut,
  Mail,
  MessageSquare,
  Plus,
  PlusCircle,
  PlusIcon,
  Settings,
  Store,
  User,
  UserPlus,
  Users,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useStoreModal } from "@/hooks/use-store-modal";
import { useGetActiveOrganization } from "@/hooks/useGetOrganizations";
import { Link, useParams } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { api } from "~/convex/_generated/api";

export function StoresDropdown() {
  const storeModal = useStoreModal();

  const { activeOrganization } = useGetActiveOrganization();

  const stores = useQuery(
    api.inventory.stores.getAll,
    activeOrganization?._id
      ? {
          organizationId: activeOrganization._id,
        }
      : "skip"
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline">
          <House className="w-8 h-8 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56">
        <DropdownMenuLabel>Stores</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          {stores?.map((store) => {
            return (
              <Link
                to={"/$orgUrlSlug/store/$storeUrlSlug/products"}
                params={(prev) => ({
                  ...prev,
                  orgUrlSlug: prev.orgUrlSlug!,
                  storeUrlSlug: store.slug,
                })}
                key={store._id}
              >
                <DropdownMenuItem>
                  <Store className="mr-2 h-4 w-4" />
                  <span>{store.name}</span>
                </DropdownMenuItem>
              </Link>
            );
          })}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => storeModal.onOpen()}>
            <Plus className="w-4 h-4 mr-2" />
            <span>Add store</span>
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
