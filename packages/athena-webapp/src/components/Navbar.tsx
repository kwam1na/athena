import { Link } from "@tanstack/react-router";
import OrganizationSwitcher from "./organization-switcher";
import { useGetOrganizations } from "@/hooks/useGetOrganizations";
import useGetActiveStore from "../hooks/useGetActiveStore";
import { useQuery } from "convex/react";
import { api } from "~/convex/_generated/api";
import { useEffect } from "react";
import { toast } from "sonner";
import { currencyFormatter } from "../lib/utils";

export const AppHeader = () => {
  const organizations = useGetOrganizations();

  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <Link
        to="/"
        className="hidden shrink-0 items-center min-[430px]:flex"
      >
        <p className="font-medium">athena</p>
      </Link>
      <p className="hidden text-muted-foreground sm:block">/</p>
      <OrganizationSwitcher
        className="max-w-[10.75rem] min-[430px]:max-w-[14rem]"
        items={organizations || []}
      />
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
  }, [formatter, newOrder]);

  return (
    <section className={`px-8 border-b w-full flex-none space-y-4`}>
      <Header />
    </section>
  );
};

export default Navbar;
