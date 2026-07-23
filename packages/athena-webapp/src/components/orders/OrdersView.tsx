import { useEffect, useMemo, useState } from "react";
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
import { getAmountPaidForOrder, getOnlineOrderPlacedAt } from "./utils";
import { ProtectedRoute } from "../ProtectedRoute";
import {
  PageLevelHeader,
  PageWorkspace,
  PageWorkspaceMain,
} from "../common/PageLevelHeader";
import { useSharedDemoContext } from "~/src/hooks/useSharedDemoContext";
import {
  SHARED_DEMO_SESSION_ORDER_CHANGED_EVENT,
  applySharedDemoSessionOrderPatches,
  readSharedDemoSessionOrderPatches,
  type OnlineOrderWithItems,
} from "~/src/contexts/onlineOrderSessionOverlay";

type TimeRange = "day" | "week" | "month" | "all";

export default function OrdersView({ status = "all" }: { status?: string }) {
  const { activeStore } = useGetActiveStore();
  const sharedDemo = useSharedDemoContext();
  const initialTimeRange: TimeRange = "all";
  const [selectedTimeRange, setSelectedTimeRange] =
    useState<TimeRange>(initialTimeRange);
  const [overlayVersion, setOverlayVersion] = useState(0);

  const orders = useQuery(
    api.storeFront.onlineOrder.getAllOnlineOrders,
    activeStore?._id ? { storeId: activeStore._id } : "skip",
  );

  useEffect(() => {
    const handleSessionOrderChange = () => {
      setOverlayVersion((current) => current + 1);
    };
    window.addEventListener(
      SHARED_DEMO_SESSION_ORDER_CHANGED_EVENT,
      handleSessionOrderChange,
    );
    return () => {
      window.removeEventListener(
        SHARED_DEMO_SESSION_ORDER_CHANGED_EVENT,
        handleSessionOrderChange,
      );
    };
  }, []);

  const effectiveOrders = useMemo(() => {
    if (!orders) return [];
    if (sharedDemo?.kind !== "shared_demo") return orders;

    return applySharedDemoSessionOrderPatches(
      orders as OnlineOrderWithItems[],
      readSharedDemoSessionOrderPatches({
        restoreEpoch: sharedDemo.restore.epoch,
        storeId: String(sharedDemo.storeId),
      }),
    );
  }, [orders, overlayVersion, sharedDemo]);

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

  const metricEligibleStatuses = new Set([
    "delivered",
    "open",
    "out-for-delivery",
    "picked-up",
    "ready",
    "ready-for-delivery",
    "ready-for-pickup",
  ]);

  const metricOrders = effectiveOrders.filter((order: OnlineOrder) => {
    if (
      timeFilter !== undefined &&
      getOnlineOrderPlacedAt(order) < timeFilter
    ) {
      return false;
    }
    return metricEligibleStatuses.has(order.status);
  });

  const metricsOverride =
    sharedDemo?.kind === "shared_demo"
      ? {
          grossSales: metricOrders.reduce(
            (total, order) => total + (order.amount ?? 0),
            0,
          ),
          netRevenue: metricOrders.reduce(
            (total, order) => total + getAmountPaidForOrder(order),
            0,
          ),
          totalOrders: metricOrders.length,
        }
      : undefined;

  const ordersFormatted = effectiveOrders
    .filter((o: OnlineOrder) => {
      if (timeFilter !== undefined && getOnlineOrderPlacedAt(o) < timeFilter) {
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
                metricsOverride={metricsOverride}
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
