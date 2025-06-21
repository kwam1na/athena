import { useState, useMemo } from "react";
import { useQuery } from "convex/react";
import { api } from "~/convex/_generated/api";
import useGetActiveStore from "@/hooks/useGetActiveStore";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../ui/card";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";
import {
  TrendingUp,
  Users,
  ShoppingCart,
  CreditCard,
  Eye,
  Monitor,
  Smartphone,
  DollarSign,
  BarChart3,
  Calendar,
} from "lucide-react";
import { formatNumber } from "../../utils/formatNumber";
import { ConversionFunnelChart } from "./ConversionFunnelChart";
import { RevenueChart } from "./RevenueChart";
import { VisitorChart } from "./VisitorChart";
import { ActivityTimeline } from "./ActivityTimeline";

type DateRange = "7d" | "30d" | "90d" | "all";

const getDateRangeMilliseconds = (range: DateRange) => {
  const now = Date.now();
  switch (range) {
    case "7d":
      return { startDate: now - 7 * 24 * 60 * 60 * 1000, endDate: now };
    case "30d":
      return { startDate: now - 30 * 24 * 60 * 60 * 1000, endDate: now };
    case "90d":
      return { startDate: now - 90 * 24 * 60 * 60 * 1000, endDate: now };
    case "all":
      return { startDate: undefined, endDate: undefined };
  }
};

const dateRangeLabels = {
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
  all: "All time",
};

interface MetricCardProps {
  title: string;
  value: string | number;
  icon: React.ReactNode;
  trend?: string;
  description?: string;
}

const MetricCard = ({
  title,
  value,
  icon,
  trend,
  description,
}: MetricCardProps) => (
  <Card>
    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
      <CardTitle className="text-sm font-medium">{title}</CardTitle>
      {icon}
    </CardHeader>
    <CardContent>
      <div className="text-2xl font-bold">{formatNumber(value as number)}</div>
      {trend && <p className="text-xs text-muted-foreground">{trend}</p>}
      {description && (
        <p className="text-xs text-muted-foreground mt-1">{description}</p>
      )}
    </CardContent>
  </Card>
);

export default function EnhancedAnalyticsView() {
  const { activeStore } = useGetActiveStore();
  const [dateRange, setDateRange] = useState<DateRange>("30d");

  const { startDate, endDate } = useMemo(
    () => getDateRangeMilliseconds(dateRange),
    [dateRange]
  );

  // OPTIMIZATION: Use single consolidated query instead of 4 separate queries
  const consolidatedAnalytics = useQuery(
    api.storeFront.analytics.getConsolidatedAnalytics,
    activeStore?._id
      ? {
          storeId: activeStore._id,
          startDate,
          endDate,
        }
      : "skip"
  );

  // Check if query is loading or has errors
  const isLoading = !activeStore || consolidatedAnalytics === undefined;
  const hasErrors = consolidatedAnalytics === null;

  if (!activeStore) {
    return <div>No active store</div>;
  }

  if (isLoading) {
    return (
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <div className="animate-pulse bg-gray-200 h-10 w-32 rounded"></div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className="animate-pulse bg-gray-200 h-24 rounded"
            ></div>
          ))}
        </div>
      </div>
    );
  }

  if (hasErrors) {
    return (
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Dashboard</h1>
        </div>
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <h3 className="text-red-800 font-medium">Error Loading Analytics</h3>
          <p className="text-red-600 text-sm mt-1">
            There was an error loading the analytics data. Please try refreshing
            the page.
          </p>
        </div>
      </div>
    );
  }

  const { overview, conversions, deviceBreakdown, revenue, visitors } =
    consolidatedAnalytics;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <p className="text-muted-foreground">
            {dateRangeLabels[dateRange]} • {activeStore.name}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Select
            value={dateRange}
            onValueChange={(value) => setDateRange(value as DateRange)}
          >
            <SelectTrigger className="w-[160px]">
              <Calendar className="w-4 h-4 mr-2" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7d">Last 7 days</SelectItem>
              <SelectItem value="30d">Last 30 days</SelectItem>
              <SelectItem value="90d">Last 90 days</SelectItem>
              <SelectItem value="all">All time</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          title="Total Visitors"
          value={overview.uniqueVisitors}
          icon={<Users className="h-4 w-4 text-muted-foreground" />}
          description={`${visitors.newVisitors} new, ${visitors.returningVisitors} returning`}
        />

        <MetricCard
          title="Product Views"
          value={overview.productViews}
          icon={<Eye className="h-4 w-4 text-muted-foreground" />}
        />

        <MetricCard
          title="Total Revenue"
          value={`$${formatNumber(revenue.totalRevenue)}`}
          icon={<DollarSign className="h-4 w-4 text-muted-foreground" />}
          description={`${revenue.totalOrders} orders`}
        />

        <MetricCard
          title="Conversion Rate"
          value={`${isNaN(conversions.overallConversionRate) ? 0 : conversions.overallConversionRate}%`}
          icon={<TrendingUp className="h-4 w-4 text-muted-foreground" />}
          description="Views to purchases"
        />
      </div>

      {/* Secondary Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          title="Cart Actions"
          value={overview.cartActions}
          icon={<ShoppingCart className="h-4 w-4 text-muted-foreground" />}
          description={`${isNaN(conversions.viewToCartRate) ? 0 : conversions.viewToCartRate}% from views`}
        />

        <MetricCard
          title="Checkouts Started"
          value={overview.checkoutActions}
          icon={<CreditCard className="h-4 w-4 text-muted-foreground" />}
          description={`${isNaN(conversions.cartToCheckoutRate) ? 0 : conversions.cartToCheckoutRate}% from cart`}
        />

        <MetricCard
          title="Average Order Value"
          value={`$${formatNumber(revenue.averageOrderValue)}`}
          icon={<BarChart3 className="h-4 w-4 text-muted-foreground" />}
        />

        <MetricCard
          title="Device Split"
          value={`${Math.round(
            deviceBreakdown.mobile + deviceBreakdown.desktop > 0
              ? (deviceBreakdown.mobile /
                  (deviceBreakdown.mobile + deviceBreakdown.desktop)) *
                  100
              : 0
          )}%`}
          icon={<Smartphone className="h-4 w-4 text-muted-foreground" />}
          description="Mobile usage"
        />
      </div>

      {/* Charts Section */}
      <Tabs defaultValue="funnel" className="space-y-4">
        <TabsList>
          <TabsTrigger value="funnel">Conversion Funnel</TabsTrigger>
          <TabsTrigger value="revenue">Revenue Trends</TabsTrigger>
          <TabsTrigger value="visitors">Visitor Patterns</TabsTrigger>
        </TabsList>

        <TabsContent value="funnel">
          <ConversionFunnelChart
            conversions={conversions}
            overview={overview}
          />
        </TabsContent>

        <TabsContent value="revenue">
          <RevenueChart revenueData={revenue.revenueByDay} />
        </TabsContent>

        <TabsContent value="visitors">
          <VisitorChart visitorData={visitors.visitorsByHour} />
        </TabsContent>
      </Tabs>

      {/* Additional Insights */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Device Breakdown */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Monitor className="h-5 w-5" />
              Device Usage
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Monitor className="h-4 w-4 text-muted-foreground" />
                <span>Desktop</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-medium">{deviceBreakdown.desktop}</span>
                <Badge variant="secondary">
                  {Math.round(
                    overview.totalViews > 0
                      ? (deviceBreakdown.desktop / overview.totalViews) * 100
                      : 0
                  )}
                  %
                </Badge>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Smartphone className="h-4 w-4 text-muted-foreground" />
                <span>Mobile</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-medium">{deviceBreakdown.mobile}</span>
                <Badge variant="secondary">
                  {Math.round(
                    overview.totalViews > 0
                      ? (deviceBreakdown.mobile / overview.totalViews) * 100
                      : 0
                  )}
                  %
                </Badge>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Visitor Insights */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              Visitor Insights
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <span>New Visitors</span>
              <div className="flex items-center gap-2">
                <span className="font-medium">{visitors.newVisitors}</span>
                <Badge variant="outline">
                  {Math.round(
                    visitors.totalVisitors > 0
                      ? (visitors.newVisitors / visitors.totalVisitors) * 100
                      : 0
                  )}
                  %
                </Badge>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <span>Returning Visitors</span>
              <div className="flex items-center gap-2">
                <span className="font-medium">
                  {visitors.returningVisitors}
                </span>
                <Badge variant="outline">
                  {Math.round(
                    visitors.totalVisitors > 0
                      ? (visitors.returningVisitors / visitors.totalVisitors) *
                          100
                      : 0
                  )}
                  %
                </Badge>
              </div>
            </div>

            {visitors.peakHour && (
              <div className="flex items-center justify-between">
                <span>Peak Hour</span>
                <Badge variant="secondary">{visitors.peakHour}:00</Badge>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Activity Timeline */}
        <ActivityTimeline
          storeId={activeStore._id}
          timeRange={
            dateRange === "7d" ? "7d" : dateRange === "30d" ? "30d" : "24h"
          }
        />
      </div>
    </div>
  );
}
