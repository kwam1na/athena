import { useQuery } from "convex/react";
import useGetActiveStore from "@/hooks/useGetActiveStore";
import { api } from "~/convex/_generated/api";
import View from "../View";
import Orders from "./Orders";
import {
  capitalizeFirstLetter,
  currencyFormatter,
  slugToWords,
} from "~/src/lib/utils";
import { OrdersTableToolbarProvider } from "./orders-table/components/data-table-toolbar-provider";
import { OnlineOrder } from "~/types";

export default function OrdersView({ status }: { status?: string }) {
  const { activeStore } = useGetActiveStore();

  const orders = useQuery(
    api.storeFront.onlineOrder.getAllOnlineOrders,
    activeStore?._id ? { storeId: activeStore._id } : "skip"
  );

  if (!activeStore || !orders) return null;

  const formatter = currencyFormatter(activeStore.currency);

  const ordersFormatted = orders
    .filter((o: OnlineOrder) => {
      if (status) {
        if (status == "completed") {
          return ["picked-up", "delivered"].includes(o.status);
        }

        if (status == "all") return true;

        return o.status.includes(status);
      }

      return true;
    })
    .map((order: any) => {
      return {
        ...order,
        amountValue: order.amount,
        amount: formatter.format(order.amount / 100),
      };
    });

  const hasOrders = ordersFormatted.length > 0;

  const Navigation = () => {
    return (
      <div className="container mx-auto flex gap-2 h-[40px]">
        <div className="flex items-center">
          {status && hasOrders && (
            <p className="text-xl font-medium">{`${capitalizeFirstLetter(slugToWords(status))} orders`}</p>
          )}
        </div>
      </div>
    );
  };

  return (
    <View
      hideBorder
      hideHeaderBottomBorder
      className="bg-background"
      header={hasOrders && <Navigation />}
    >
      <OrdersTableToolbarProvider>
        <Orders
          store={activeStore}
          status={status || "open"}
          orders={ordersFormatted}
        />
      </OrdersTableToolbarProvider>
    </View>
  );
}
