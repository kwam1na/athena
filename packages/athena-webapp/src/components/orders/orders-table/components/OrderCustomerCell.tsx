import { Link } from "@tanstack/react-router";
import type { Row } from "@tanstack/react-table";

import { useSharedDemoContext } from "@/hooks/useSharedDemoContext";
import { getOrigin } from "~/src/lib/navigationUtils";
import type { OnlineOrder } from "~/types";

export function OrderCustomerCell({ row }: { row: Row<OnlineOrder> }) {
  const sharedDemo = useSharedDemoContext();
  const customer = row.getValue("customerDetails") as Record<string, unknown>;
  const customerEmail =
    typeof customer?.email === "string" ? customer.email : null;

  if (sharedDemo) {
    return <span>{customerEmail}</span>;
  }

  const orderStatus = window.location.pathname.split("/").pop();

  return (
    <Link
      to="/$orgUrlSlug/store/$storeUrlSlug/users/$userId"
      params={(prev) => ({
        ...prev,
        orgUrlSlug: prev.orgUrlSlug!,
        storeUrlSlug: prev.storeUrlSlug!,
        userId: row.original.storeFrontUserId,
      })}
      search={{ orderStatus, o: getOrigin() }}
    >
      {customerEmail}
    </Link>
  );
}
