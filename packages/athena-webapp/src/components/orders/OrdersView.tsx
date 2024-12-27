import { useQuery } from "convex/react";
import useGetActiveStore from "@/hooks/useGetActiveStore";
import { api } from "~/convex/_generated/api";
import View from "../View";
import Orders from "./Orders";
import { currencyFormatter } from "~/src/lib/utils";

export default function OrdersView() {
  const Navigation = () => {
    return (
      <div className="flex gap-2 h-[40px]">
        <div className="flex items-center"></div>
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
      <Orders store={activeStore} orders={ordersFormatted} />
    </View>
  );
}
