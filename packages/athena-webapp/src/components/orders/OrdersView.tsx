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
import {
  PageLevelHeader,
  PageWorkspace,
  PageWorkspaceMain,
} from "../common/PageLevelHeader";

type TimeRange = "day" | "week" | "month" | "all";

export default function OrdersView({ status = "all" }: { status?: string }) {
  const { activeStore } = useGetActiveStore();
  const initialTimeRange: TimeRange = "all";
  const [selectedTimeRange, setSelectedTimeRange] =
    useState<TimeRange>(initialTimeRange);

  const orders = useQuery(
    api.storeFront.onlineOrder.getAllOnlineOrders,
    activeStore?._id ? { storeId: activeStore._id } : "skip",
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
      if (timeFilter !== undefined && o._creationTime < timeFilter) {
        return false;
      }

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
    .map((order: OnlineOrder) => {
      // Calculate net amount (amount paid after discounts and including fees)
      const netAmount = getAmountPaidForOrder(order);

      return {
        ...order,
        amountValue: netAmount,
        amount: formatter.format(netAmount / 100),
      };
    });

  const title =
    status && status !== "all"
      ? `${capitalizeFirstLetter(slugToWords(status))} orders`
      : "Online orders";

  const handleTimeRangeChange = (timeRange: TimeRange) => {
    setSelectedTimeRange(timeRange);
  };

  return (
    <ProtectedRoute requires="full_admin">
      <View hideBorder hideHeaderBottomBorder scrollMode="page">
        <FadeIn className="container mx-auto py-layout-xl">
          <PageWorkspace>
            <PageLevelHeader
              eyebrow="Commerce Ops"
              title={title}
              description="Review online order volume, revenue, and fulfillment work without leaving the store operations flow."
            />

            <PageWorkspaceMain>
              <OrderMetricsPanel
                initialTimeRange={initialTimeRange}
                storeId={activeStore._id}
                currency={activeStore.currency}
                onTimeRangeChange={handleTimeRangeChange}
              />

              <OrdersTableToolbarProvider>
                <Orders status={status} orders={ordersFormatted} />
              </OrdersTableToolbarProvider>
            </PageWorkspaceMain>
          </PageWorkspace>
        </FadeIn>
      </View>
    </ProtectedRoute>
  );
}
