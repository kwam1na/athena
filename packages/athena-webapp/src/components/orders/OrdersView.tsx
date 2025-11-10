import { useState } from "react";
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
import { FadeIn } from "../common/FadeIn";
import OrderMetricsPanel from "./OrderMetricsPanel";
import { getAmountPaidForOrder } from "./utils";
import { ProtectedRoute } from "../ProtectedRoute";

type TimeRange = "day" | "week" | "month" | "all";

export default function OrdersView({ status }: { status?: string }) {
  const { activeStore } = useGetActiveStore();
  const [selectedTimeRange, setSelectedTimeRange] = useState<TimeRange>("all");

  const orders = useQuery(
    api.storeFront.onlineOrder.getAllOnlineOrders,
    activeStore?._id ? { storeId: activeStore._id } : "skip"
  );

  if (!activeStore || !orders) return null;

  const formatter = currencyFormatter(activeStore.currency);

  // Calculate time filter based on selected time range
  const getTimeFilter = (timeRange: TimeRange): number | undefined => {
    const now = Date.now();
    switch (timeRange) {
      case "day":
        return now - 24 * 60 * 60 * 1000;
      case "week":
        return now - 7 * 24 * 60 * 60 * 1000;
      case "month":
        return now - 30 * 24 * 60 * 60 * 1000;
      case "all":
        return undefined;
    }
  };

  const timeFilter = getTimeFilter(selectedTimeRange);

  const ordersFormatted = orders
    .filter((o: OnlineOrder) => {
      // Apply status filter based on the page
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
      // Calculate net amount (amount paid after discounts and including fees)
      const netAmount = getAmountPaidForOrder(order);

      return {
        ...order,
        amountValue: netAmount,
        amount: formatter.format(netAmount / 100),
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

  const handleTimeRangeChange = (timeRange: TimeRange) => {
    setSelectedTimeRange(timeRange);
  };

  return (
    <div>
      <ProtectedRoute requires="full_admin">
        <OrderMetricsPanel
          storeId={activeStore._id}
          currency={activeStore.currency}
          onTimeRangeChange={handleTimeRangeChange}
        />
        <View
          hideBorder
          hideHeaderBottomBorder
          className="bg-background"
          header={hasOrders && <Navigation />}
        >
          <FadeIn>
            <OrdersTableToolbarProvider>
              <Orders
                store={activeStore}
                status={status || "open"}
                orders={ordersFormatted}
              />
            </OrdersTableToolbarProvider>
          </FadeIn>
        </View>
      </ProtectedRoute>
    </div>
  );
}
