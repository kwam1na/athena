import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "~/convex/_generated/api";
import { Id } from "~/convex/_generated/dataModel";
import { currencyFormatter } from "~/src/lib/utils";
import { Tabs, TabsList, TabsTrigger } from "../ui/tabs";
import { OperationsSummaryMetric } from "../operations/OperationsSummaryMetric";

type TimeRange = "day" | "week" | "month" | "all";

interface OrderMetricsPanelProps {
  initialTimeRange?: TimeRange;
  storeId: Id<"store">;
  currency: string;
  onTimeRangeChange: (timeRange: TimeRange) => void;
}

export default function OrderMetricsPanel({
  initialTimeRange = "day",
  storeId,
  currency,
  onTimeRangeChange,
}: OrderMetricsPanelProps) {
  const [selectedTimeRange, setSelectedTimeRange] =
    useState<TimeRange>(initialTimeRange);

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
    <section className="space-y-layout-md">
      <div className="flex flex-col gap-layout-sm lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-layout-2xs">
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
            Order snapshot
          </p>
        </div>
        <div className="self-start lg:self-auto">
          <Tabs value={selectedTimeRange} onValueChange={handleTimeRangeChange}>
            <TabsList>
              <TabsTrigger value="day">Day</TabsTrigger>
              <TabsTrigger value="week">Week</TabsTrigger>
              <TabsTrigger value="month">Month</TabsTrigger>
              <TabsTrigger value="all">All time</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </div>

      {isLoading ? null : (
        <div className="grid gap-layout-sm md:grid-cols-3">
          <OperationsSummaryMetric
            helper="Subtotal before discounts"
            label="Gross sales"
            value={formatter.format((metrics?.grossSales || 0) / 100)}
          />
          <OperationsSummaryMetric
            helper="Subtotal plus fees after discounts"
            label="Net revenue"
            value={formatter.format((metrics?.netRevenue || 0) / 100)}
          />
          <OperationsSummaryMetric
            helper="Open and fulfilled orders"
            label="Orders"
            value={metrics?.totalOrders || 0}
          />
        </div>
      )}
    </section>
  );
}
