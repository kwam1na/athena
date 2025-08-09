import { useParams } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { api } from "~/convex/_generated/api";
import { Id } from "~/convex/_generated/dataModel";
import { GenericDataTable } from "../base/table/data-table";
import { orderColumns } from "../orders/orders-table/components/orderColumns";
import useGetActiveStore from "~/src/hooks/useGetActiveStore";
import { currencyFormatter } from "~/src/lib/utils";
import { OnlineOrder } from "~/types";

export const UserOnlineOrders = () => {
  const { userId } = useParams({ strict: false });

  const { activeStore } = useGetActiveStore();

  const onlineOrders = useQuery(
    api.storeFront.onlineOrder.getAllOnlineOrdersByStoreFrontUserId,
    userId
      ? { storeFrontUserId: userId as Id<"storeFrontUser"> | Id<"guest"> }
      : "skip"
  );

  if (!onlineOrders || !activeStore) return null;

  const formatter = currencyFormatter(activeStore.currency);

  const ordersFormatted = onlineOrders?.map((order: any) => {
    return {
      ...order,
      amountValue: order.amount,
      amount: formatter.format(order.amount / 100),
    };
  });

  const hasOrders = ordersFormatted.length > 0;

  if (!hasOrders)
    return (
      <p className="text-sm text-muted-foreground">
        This user has no online orders.
      </p>
    );

  return (
    <GenericDataTable
      data={ordersFormatted}
      columns={orderColumns}
      tableId="user-online-orders"
    />
  );
};
