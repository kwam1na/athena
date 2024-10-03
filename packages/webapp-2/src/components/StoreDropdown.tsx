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
import { useQuery } from "@tanstack/react-query";
import { getAllStores } from "@/api/stores";

export function StoreDropdown() {
  const storeModal = useStoreModal();

  const { activeOrganization } = useGetActiveOrganization();

  const { data: stores } = useQuery({
    queryKey: ["stores", activeOrganization?.id],
    queryFn: () => getAllStores(activeOrganization!.id),
    enabled: Boolean(activeOrganization),
  });

  const { storeUrlSlug } = useParams({ strict: false });

  const matchedStore = stores?.find((s) => s.slug == storeUrlSlug);

  if (stores?.length == 0 || !stores || !matchedStore) return null;

  const sections = [
    {
      name: "Products",
    },
    {
      name: "Orders",
    },
  ];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline">
          <Store className="w-8 h-8 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56">
        <DropdownMenuLabel>{matchedStore?.name}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          {sections?.map((section, index) => {
            return (
              <Link
                to={"/$orgUrlSlug/store/$storeUrlSlug/products"}
                params={(prev) => ({
                  ...prev,
                  orgUrlSlug: prev.orgUrlSlug!,
                  storeUrlSlug: matchedStore.slug,
                })}
                key={index}
              >
                <DropdownMenuItem>
                  <span>{section.name}</span>
                </DropdownMenuItem>
              </Link>
            );
          })}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
