import { useQuery } from "convex/react";
import useGetActiveStore from "@/hooks/useGetActiveStore";
import { api } from "~/convex/_generated/api";
import View from "../View";
import Orders from "./Orders";
import { currencyFormatter } from "~/src/lib/utils";
import { OrdersTableToolbarProvider } from "./orders-table/components/data-table-toolbar-provider";

export default function OrdersView() {
  const Navigation = () => {
    return (
      <div className="container mx-auto flex gap-2 h-[40px]">
        <div className="flex items-center">
          <p className="text-sm">Orders</p>
        </div>
      </div>
    );
  };

  const { activeStore } = useGetActiveStore();

  const orders = useQuery(
    api.storeFront.onlineOrder.getAllOnlineOrders,
    activeStore?._id ? { storeId: activeStore._id } : "skip"
  );

  if (!activeStore || !orders) return null;

  const formatter = currencyFormatter(activeStore.currency);

  const ordersFormatted = orders.map((order: any) => {
    return {
      ...order,
      amountValue: order.amount,
      amount: formatter.format(order.amount / 100),
    };
  });

  return (
    <View
      hideBorder
      hideHeaderBottomBorder
      className="bg-background"
      header={<Navigation />}
    >
      <OrdersTableToolbarProvider>
        <Orders store={activeStore} orders={ordersFormatted} />
      </OrdersTableToolbarProvider>
    </View>
  );
}
