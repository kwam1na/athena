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
  metricsOverride?: {
    grossSales: number;
    netRevenue: number;
    totalOrders: number;
  };
}

export default function OrderMetricsPanel({
  initialTimeRange = "day",
  storeId,
  currency,
  onTimeRangeChange,
  metricsOverride,
}: OrderMetricsPanelProps) {
  const [selectedTimeRange, setSelectedTimeRange] =
    useState<TimeRange>(initialTimeRange);

  const metrics = useQuery(
    api.storeFront.onlineOrder.getOrderMetrics,
    metricsOverride ? "skip" : { storeId, timeRange: selectedTimeRange },
  );
  const effectiveMetrics = metricsOverride ?? metrics;

  const formatter = currencyFormatter(currency);

  const handleTimeRangeChange = (value: string) => {
    const newTimeRange = value as TimeRange;
    setSelectedTimeRange(newTimeRange);
    onTimeRangeChange(newTimeRange);
  };

  const isLoading = !metricsOverride && metrics === undefined;

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
            value={formatter.format((effectiveMetrics?.grossSales || 0) / 100)}
          />
          <OperationsSummaryMetric
            helper="Subtotal plus fees after discounts"
            label="Net revenue"
            value={formatter.format((effectiveMetrics?.netRevenue || 0) / 100)}
          />
          <OperationsSummaryMetric
            helper="Open and fulfilled orders"
            label="Orders"
            value={effectiveMetrics?.totalOrders || 0}
          />
        </div>
      )}
    </section>
  );
}
