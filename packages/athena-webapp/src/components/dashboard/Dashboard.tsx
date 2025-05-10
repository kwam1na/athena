import React, { useState, useMemo } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import MetricCard from "./MetricCard";
import { useQuery } from "convex/react";
import { api } from "~/convex/_generated/api";
import useGetActiveStore from "@/hooks/useGetActiveStore";
import { currencyFormatter } from "@/lib/utils";
import { Loader2 } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Link } from "@tanstack/react-router";
import { getOrigin } from "~/src/lib/navigationUtils";

// Helper functions moved to the top for better organization
function getPeriodRange(interval: string, offset = 0): [Date, Date] {
  const now = new Date();
  let start: Date, end: Date;
  if (interval === "daily") {
    start = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
    end = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + 1 + offset
    );
  } else if (interval === "weekly") {
    const day = now.getDay();
    start = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() - day + 7 * offset
    );
    end = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() - day + 7 * (offset + 1)
    );
  } else {
    start = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    end = new Date(now.getFullYear(), now.getMonth() + offset + 1, 1);
  }
  return [start, end];
}

// Loading component for better UX
const LoadingSection = () => (
  <div className="flex justify-center items-center h-48">
    <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
  </div>
);

const Dashboard = () => {
  const [interval, setInterval] = useState("daily");
  const { activeStore } = useGetActiveStore();

  // Data fetching
  const orders = useQuery(
    api.storeFront.onlineOrder.getAllOnlineOrders,
    activeStore?._id ? { storeId: activeStore._id } : "skip"
  );
  const ordersLoading = orders === undefined;

  const products = useQuery(
    api.inventory.products.getAll,
    activeStore?._id ? { storeId: activeStore._id } : "skip"
  );
  const productsLoading = products === undefined;

  const users = useQuery(api.storeFront.user.getAll, {});
  const usersLoading = users === undefined;

  const analytics = useQuery(
    api.storeFront.analytics.getAll,
    activeStore?._id ? { storeId: activeStore._id } : "skip"
  );
  const analyticsLoading = analytics === undefined;

  const bestSellers = useQuery(
    api.inventory.bestSeller.getAll,
    activeStore?._id ? { storeId: activeStore._id } : "skip"
  );

  const promoCodes = useQuery(
    api.inventory.promoCode.getAll,
    activeStore?._id ? { storeId: activeStore._id } : "skip"
  );
  const promoCodesLoading = promoCodes === undefined;

  const formatter = currencyFormatter(activeStore?.currency || "GHS");

  const [currentStart, currentEnd] = getPeriodRange(interval, 0);
  const [prevStart, prevEnd] = getPeriodRange(interval, -1);

  // --- Sales & Revenue ---
  const { currentSales, previousSales, currentRevenue, previousRevenue } =
    useMemo(() => {
      if (!orders)
        return {
          currentSales: 0,
          previousSales: 0,
          currentRevenue: 0,
          previousRevenue: 0,
        };
      const getStats = (start: Date, end: Date) => {
        const filtered = orders.filter((o) => {
          const created = new Date(o._creationTime);
          return created >= start && created < end;
        });
        return {
          sales: filtered.length,
          revenue: filtered.reduce((sum, o) => sum + (o.amount || 0), 0),
        };
      };
      const curr = getStats(currentStart, currentEnd);
      const prev = getStats(prevStart, prevEnd);
      return {
        currentSales: curr.sales,
        previousSales: prev.sales,
        currentRevenue: curr.revenue,
        previousRevenue: prev.revenue,
      };
    }, [orders, currentStart, currentEnd, prevStart, prevEnd]);

  const salesChange =
    previousSales === 0
      ? 0
      : ((currentSales - previousSales) / previousSales) * 100;
  const revenueChange =
    previousRevenue === 0
      ? 0
      : ((currentRevenue - previousRevenue) / previousRevenue) * 100;

  // --- Product Metrics ---
  const productMetrics = useMemo(() => {
    if (!products)
      return {
        totalProducts: 0,
        lowStockProducts: 0,
        outOfStockProducts: 0,
        recentlyAddedProduct: "-",
      };

    return {
      totalProducts: products.length,
      lowStockProducts: products.filter(
        (p) =>
          p.quantityAvailable !== undefined &&
          p.quantityAvailable <= 5 &&
          p.quantityAvailable > 0
      ).length,
      outOfStockProducts: products.filter((p) => p.quantityAvailable === 0)
        .length,
      recentlyAddedProduct: products.length
        ? products[products.length - 1]?.name
        : "-",
    };
  }, [products]);

  const {
    totalProducts,
    lowStockProducts,
    outOfStockProducts,
    recentlyAddedProduct,
  } = productMetrics;

  const bestSellerName = bestSellers?.length
    ? bestSellers[0]?.productSku?.productName || "-"
    : "-";

  // --- Order Metrics ---
  const orderMetrics = useMemo(() => {
    if (!orders)
      return {
        totalOrders: 0,
        openOrders: 0,
        completedOrders: 0,
        refundedOrders: 0,
        cancelledOrders: 0,
        avgOrderValue: 0,
        refundRate: 0,
        pendingOrders: 0,
      };

    const total = orders.length;
    const open = orders.filter((o) => o.status === "open").length;
    const completed = orders.filter((o) =>
      ["picked-up", "delivered"].includes(o.status)
    ).length;
    const refunded = orders.filter((o) => o.status === "refunded").length;
    const cancelled = orders.filter((o) => o.status === "cancelled").length;
    const avg = total
      ? orders.reduce((sum, o) => sum + (o.amount || 0), 0) / total
      : 0;
    const refundPercent = total ? (refunded / total) * 100 : 0;

    return {
      totalOrders: total,
      openOrders: open,
      completedOrders: completed,
      refundedOrders: refunded,
      cancelledOrders: cancelled,
      avgOrderValue: avg,
      refundRate: refundPercent,
      pendingOrders: open, // For now, treat open as pending
    };
  }, [orders]);

  const {
    totalOrders,
    openOrders,
    completedOrders,
    refundedOrders,
    cancelledOrders,
    avgOrderValue,
    refundRate,
    pendingOrders,
  } = orderMetrics;

  // --- Customer Metrics ---
  const customerMetrics = useMemo(() => {
    if (!users || !orders)
      return {
        totalCustomers: 0,
        newCustomers: 0,
        repeatCustomers: 0,
      };

    return {
      totalCustomers: users.length,
      // For demo: new customers = users created in current period
      newCustomers: users.filter((u) => {
        const created = new Date(u._creationTime);
        return created >= currentStart && created < currentEnd;
      }).length,
      // Repeat customers: users with >1 order
      repeatCustomers: users.filter((u) => {
        if (!orders) return false;
        const userOrders = orders.filter((o) => o.storeFrontUserId === u._id);
        return userOrders.length > 1;
      }).length,
    };
  }, [users, orders, currentStart, currentEnd]);

  const { totalCustomers, newCustomers, repeatCustomers } = customerMetrics;

  // --- Analytics Metrics (placeholders) ---
  const analyticsMetrics = useMemo(() => {
    if (!analytics)
      return {
        uniqueVisitors: 0,
        sessions: 0,
        productViews: 0,
        addToCart: 0,
        checkout: 0,
        purchase: 0,
        deviceMobile: 0,
        deviceDesktop: 0,
        mostPopularAction: "-",
      };

    const popularActions = analytics.reduce(
      (acc: Record<string, number>, a) => {
        acc[a.action] = (acc[a.action] || 0) + 1;
        return acc;
      },
      {}
    );

    const mostPopular =
      Object.entries(popularActions).sort((a, b) => b[1] - a[1])[0]?.[0] || "-";

    return {
      uniqueVisitors: analytics.length,
      sessions: analytics.filter((a) => a.action === "session").length,
      productViews: analytics.filter((a) => a.action === "viewed_product")
        .length,
      addToCart: analytics.filter((a) => a.action === "add_to_cart").length,
      checkout: analytics.filter((a) => a.action === "checkout").length,
      purchase: analytics.filter((a) => a.action === "purchase").length,
      deviceMobile: analytics.filter((a) => a.device === "mobile").length,
      deviceDesktop: analytics.filter((a) => a.device === "desktop").length,
      mostPopularAction: mostPopular,
    };
  }, [analytics]);

  const {
    uniqueVisitors,
    sessions,
    productViews,
    addToCart,
    checkout,
    purchase,
    deviceMobile,
    deviceDesktop,
    mostPopularAction,
  } = analyticsMetrics;

  // --- Promo Codes ---
  const promoMetrics = useMemo(() => {
    if (!promoCodes)
      return {
        activePromoCodes: 0,
        promoCodeUsage: 0,
      };

    return {
      activePromoCodes: promoCodes.filter((p) => p.active).length,
      promoCodeUsage: promoCodes.reduce((sum, p) => {
        const promoCode = p as any;
        return sum + (promoCode.usageCount || 0);
      }, 0),
    };
  }, [promoCodes]);

  const { activePromoCodes, promoCodeUsage } = promoMetrics;

  // Section rendering with loading states
  const renderSalesSection = () => {
    if (ordersLoading) return <LoadingSection />;
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <MetricCard
          label="Sales"
          value={currentSales.toLocaleString()}
          change={salesChange}
          changeLabel="vs last period"
        />
        <MetricCard
          label="Revenue"
          value={formatter.format(currentRevenue / 100)}
          change={revenueChange}
          changeLabel="vs last period"
        />
      </div>
    );
  };

  const renderProductsSection = () => {
    if (productsLoading) return <LoadingSection />;

    // Add visual indicators for critical metrics
    const lowStockStatus = lowStockProducts > 0 ? -1 : 0;
    const outOfStockStatus = outOfStockProducts > 0 ? -2 : 0;

    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <MetricCard
          label="Total Products"
          value={totalProducts.toString()}
          change={0}
        />
        <MetricCard
          label="Low Stock Products"
          value={lowStockProducts.toString()}
          change={lowStockStatus}
          changeLabel={lowStockProducts > 0 ? "Needs attention" : ""}
        />
        <MetricCard
          label="Out of Stock Products"
          value={outOfStockProducts.toString()}
          change={outOfStockStatus}
          changeLabel={outOfStockProducts > 0 ? "Urgent" : ""}
        />
        <MetricCard label="Best Seller" value={bestSellerName} change={0} />
        <MetricCard
          label="Recently Added Product"
          value={recentlyAddedProduct}
          change={0}
        />
      </div>
    );
  };

  const renderOrdersSection = () => {
    if (ordersLoading) return <LoadingSection />;

    // Add visual indicators for key metrics
    const pendingStatus = pendingOrders > 5 ? -1 : 0;
    const refundStatus = refundRate > 5 ? -1 : 0;

    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <MetricCard
          label="Total Orders"
          value={totalOrders.toString()}
          change={0}
        />
        <MetricCard
          label="Open Orders"
          value={openOrders.toString()}
          change={pendingStatus}
          changeLabel={pendingOrders > 5 ? "Above average" : ""}
        />
        <MetricCard
          label="Completed Orders"
          value={completedOrders.toString()}
          change={0}
        />
        <MetricCard
          label="Refunded Orders"
          value={refundedOrders.toString()}
          change={0}
        />
        <MetricCard
          label="Cancelled Orders"
          value={cancelledOrders.toString()}
          change={0}
        />
        <MetricCard
          label="Average Order Value"
          value={formatter.format(avgOrderValue / 100)}
          change={0}
        />
        <MetricCard
          label="Refund Rate"
          value={`${refundRate.toFixed(2)}%`}
          change={refundStatus}
          changeLabel={refundRate > 5 ? "Above target" : ""}
        />
        <MetricCard
          label="Pending Orders"
          value={pendingOrders.toString()}
          change={pendingStatus}
          changeLabel={pendingOrders > 5 ? "Needs attention" : ""}
        />
      </div>
    );
  };

  const renderCustomersSection = () => {
    if (usersLoading) return <LoadingSection />;
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <MetricCard
          label="Total Customers"
          value={totalCustomers.toString()}
          change={0}
        />
        <MetricCard
          label="New Customers"
          value={newCustomers.toString()}
          change={0}
        />
        <MetricCard
          label="Repeat Customers"
          value={repeatCustomers.toString()}
          change={0}
        />
      </div>
    );
  };

  const renderAnalyticsSection = () => {
    if (analyticsLoading) return <LoadingSection />;

    // Calculate conversion rates
    const cartConversion =
      productViews > 0
        ? ((addToCart / productViews) * 100).toFixed(1) + "%"
        : "0%";
    const checkoutConversion =
      addToCart > 0 ? ((checkout / addToCart) * 100).toFixed(1) + "%" : "0%";
    const purchaseConversion =
      checkout > 0 ? ((purchase / checkout) * 100).toFixed(1) + "%" : "0%";

    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <MetricCard
          label="Unique Visitors"
          value={uniqueVisitors.toString()}
          change={0}
        />
        <MetricCard label="Sessions" value={sessions.toString()} change={0} />
        <MetricCard
          label="Product Views"
          value={productViews.toString()}
          change={0}
        />
        <MetricCard
          label="Add to Cart"
          value={addToCart.toString()}
          change={0}
          changeLabel={`${cartConversion} of views`}
        />
        <MetricCard
          label="Checkout"
          value={checkout.toString()}
          change={0}
          changeLabel={`${checkoutConversion} of carts`}
        />
        <MetricCard
          label="Purchase"
          value={purchase.toString()}
          change={0}
          changeLabel={`${purchaseConversion} of checkouts`}
        />
        <MetricCard
          label="Mobile Sessions"
          value={deviceMobile.toString()}
          change={0}
        />
        <MetricCard
          label="Desktop Sessions"
          value={deviceDesktop.toString()}
          change={0}
        />
        <MetricCard
          label="Most Popular Action"
          value={mostPopularAction}
          change={0}
        />
      </div>
    );
  };

  const renderPromoCodesSection = () => {
    if (promoCodesLoading) return <LoadingSection />;
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <MetricCard
          label="Active Promo Codes"
          value={activePromoCodes.toString()}
          change={0}
        />
        <MetricCard
          label="Promo Code Usage"
          value={promoCodeUsage.toString()}
          change={0}
        />
      </div>
    );
  };

  return (
    <div className="container mx-auto py-8">
      <h1 className="text-2xl font-bold mb-6">Dashboard</h1>
      <Tabs defaultValue="overview" className="w-full">
        <TabsList className="mb-6">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
          <TabsTrigger value="promo">Promo Codes</TabsTrigger>
        </TabsList>
        <TabsContent value="overview">
          <div className="flex justify-end mb-4">
            <Select value={interval} onValueChange={setInterval}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Select interval" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="daily">Daily</SelectItem>
                <SelectItem value="weekly">Weekly</SelectItem>
                <SelectItem value="monthly">Monthly</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="mb-8 p-4 rounded-lg border bg-card">
            {renderSalesSection()}
          </div>
          <div className="mb-8 p-4 rounded-lg border bg-card">
            {renderProductsSection()}
          </div>
          <div className="mb-8 p-4 rounded-lg border bg-card">
            {renderOrdersSection()}
          </div>
          <div className="mb-8 p-4 rounded-lg border bg-card">
            {renderCustomersSection()}
          </div>
        </TabsContent>
        <TabsContent value="analytics">
          <div className="flex justify-end mb-2">
            <Link
              to="/$orgUrlSlug/store/$storeUrlSlug/analytics"
              params={(p) => ({
                ...p,
                orgUrlSlug: p.orgUrlSlug!,
                storeUrlSlug: p.storeUrlSlug!,
              })}
              search={{
                o: getOrigin(),
              }}
            >
              View full analytics
            </Link>
          </div>
          <div className="mb-8 p-4 rounded-lg border bg-card">
            {renderAnalyticsSection()}
          </div>
        </TabsContent>
        <TabsContent value="promo">
          <div className="mb-8 p-4 rounded-lg border bg-card">
            {renderPromoCodesSection()}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default Dashboard;
