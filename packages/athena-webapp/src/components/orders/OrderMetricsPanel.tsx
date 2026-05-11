import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "~/convex/_generated/api";
import { Id } from "~/convex/_generated/dataModel";
import View from "../View";
import { currencyFormatter } from "~/src/lib/utils";
import { Tabs, TabsList, TabsTrigger } from "../ui/tabs";
import { FadeIn } from "../common/FadeIn";

type TimeRange = "day" | "week" | "month" | "all";

interface OrderMetricsPanelProps {
  storeId: Id<"store">;
  currency: string;
  onTimeRangeChange: (timeRange: TimeRange) => void;
}

export default function OrderMetricsPanel({
  storeId,
  currency,
  onTimeRangeChange,
}: OrderMetricsPanelProps) {
  const [selectedTimeRange, setSelectedTimeRange] = useState<TimeRange>("day");

  const metrics = useQuery(api.storeFront.onlineOrder.getOrderMetrics, {
    storeId,
    timeRange: selectedTimeRange,
  });

  const formatter = currencyFormatter(currency);

  const handleTimeRangeChange = (value: string) => {
    const newTimeRange = value as TimeRange;
    setSelectedTimeRange(newTimeRange);
    onTimeRangeChange(newTimeRange);
  };

  const isLoading = metrics === undefined;

  return (
    <View
      hideBorder
      hideHeaderBottomBorder
      fullHeight={false}
      lockDocumentScroll={false}
      className="bg-background mb-6"
    >
      <FadeIn className="container mx-auto py-6">
        <div className="flex items-center justify-between mb-6">
          {/* <h2 className="text-lg font-semibold">Order Metrics</h2> */}
          <Tabs value={selectedTimeRange} onValueChange={handleTimeRangeChange}>
            <TabsList>
              <TabsTrigger value="day">Day</TabsTrigger>
              <TabsTrigger value="week">Week</TabsTrigger>
              <TabsTrigger value="month">Month</TabsTrigger>
              <TabsTrigger value="all">All Time</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        {isLoading ? null : (
          <div className="grid grid-cols-3 gap-6">
            {/* Gross Sales Card */}
            <div className="border rounded-lg p-6">
              <p className="text-sm text-muted-foreground mb-2">Gross Sales</p>
              <p className="text-3xl font-bold">
                {formatter.format((metrics?.grossSales || 0) / 100)}
              </p>
            </div>

            {/* Total Discounts Card */}
            {/* <div className="border rounded-lg p-6">
              <p className="text-sm text-muted-foreground mb-2">
                Total Discounts
              </p>
              <p className="text-3xl font-bold">
                {formatter.format((metrics?.totalDiscounts || 0) / 100)}
              </p>
            </div> */}

            {/* Net Revenue Card */}
            <div className="border rounded-lg p-6">
              <p className="text-sm text-muted-foreground mb-2">Net Revenue</p>
              <p className="text-3xl font-bold">
                {formatter.format((metrics?.netRevenue || 0) / 100)}
              </p>
            </div>

            {/* Total Orders Card */}
            <div className="border rounded-lg p-6">
              <p className="text-sm text-muted-foreground mb-2">Total Orders</p>
              <p className="text-3xl font-bold">{metrics?.totalOrders || 0}</p>
            </div>
          </div>
        )}
      </FadeIn>
    </View>
  );
}
