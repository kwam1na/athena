import {
  Link,
  useLoaderData,
  useNavigate,
  useParams,
  useRouterState,
} from "@tanstack/react-router";
import OrganizationSwitcher from "./organization-switcher";
import { StoreAccordion } from "./StoreAccordion";
import { Button } from "./ui/button";
import { ArrowLeftIcon, ChevronLeftIcon } from "@radix-ui/react-icons";
import { useGetOrganizations } from "@/hooks/useGetOrganizations";
import useGetActiveStore from "../hooks/useGetActiveStore";
import { useQuery } from "convex/react";
import { api } from "~/convex/_generated/api";
import { useEffect } from "react";
import { toast } from "sonner";
import { currencyFormatter } from "../lib/utils";

function SettingsHeader() {
  const navigate = useNavigate();
  const { storeUrlSlug, orgUrlSlug } = useParams({ strict: false });

  const handleGoBack = () => {
    if (storeUrlSlug) {
      navigate({
        to: "/$orgUrlSlug/store/$storeUrlSlug",
        params: (prev) => {
          return {
            ...prev,
            orgUrlSlug: prev.orgUrlSlug!,
            storeUrlSlug,
          };
        },
      });
    } else {
      navigate({
        to: "/$orgUrlSlug/store",
        params: (prev) => ({
          ...prev,
          orgUrlSlug: prev.orgUrlSlug!,
        }),
      });
    }
  };

  return (
    <div className="flex items-center gap-1 h-[56px] px-2">
      <Button
        variant="ghost"
        className="h-8 px-2 lg:px-3"
        onClick={handleGoBack}
      >
        <ChevronLeftIcon className="h-4 w-4" />
      </Button>
      <p className="text-sm">Settings</p>
    </div>
  );
}

export const AppHeader = () => {
  const organizations = useGetOrganizations();

  return (
    <div className="flex items-center gap-2">
      <Link to="/" className="flex items-center">
        <p className="font-medium">athena</p>
      </Link>
      <p className="text-muted-foreground">/</p>
      <OrganizationSwitcher items={organizations || []} />
    </div>
  );
};

export const Header = () => {
  const organizations = useGetOrganizations();

  return (
    <div className="flex items-center justify-between h-[56px]">
      <div className="flex items-center gap-2">
        <Link to={"/"} className="flex items-center">
          <p className="font-medium">athena</p>
        </Link>
        <p className="text-muted-foreground">/</p>
        <OrganizationSwitcher items={organizations || []} />

        <div className="flex items-center gap-8 text-sm ml-8">
          <Link
            to="/$orgUrlSlug/store/$storeUrlSlug"
            params={(p) => ({
              ...p,
              orgUrlSlug: p.orgUrlSlug!,
              storeUrlSlug: p.storeUrlSlug!,
            })}
            className="flex items-center"
          >
            <p className="font-medium">Store</p>
          </Link>
          <Link
            to="/$orgUrlSlug/store/$storeUrlSlug/orders"
            params={(p) => ({
              ...p,
              orgUrlSlug: p.orgUrlSlug!,
              storeUrlSlug: p.storeUrlSlug!,
            })}
            className="flex items-center"
          >
            <p className="font-medium">Orders</p>
          </Link>
        </div>
      </div>
    </div>
  );
};

const Navbar = () => {
  const { activeStore } = useGetActiveStore();

  const ORDER_ID_LOCAL_STORAGE_KEY = "order_id";

  const newOrder = useQuery(
    api.storeFront.onlineOrder.newOrder,
    activeStore?._id ? { storeId: activeStore._id } : "skip"
  );

  const formatter = currencyFormatter(activeStore?.currency || "USD");

  useEffect(() => {
    if (newOrder) {
      const { customerDetails } = newOrder;

      const previousOrderId = localStorage.getItem(ORDER_ID_LOCAL_STORAGE_KEY);

      if (previousOrderId == newOrder._id) return;

      localStorage.setItem(ORDER_ID_LOCAL_STORAGE_KEY, newOrder._id);

      toast(`Order for ${formatter.format(newOrder.amount / 100)} received`, {
        description: `${customerDetails.email} placed an order`,
        position: "top-right",
        duration: 4000,
      });
    }
  }, [newOrder]);

  return (
    <section className={`px-8 border-b w-full flex-none space-y-4`}>
      <Header />
    </section>
  );
};

export default Navbar;
