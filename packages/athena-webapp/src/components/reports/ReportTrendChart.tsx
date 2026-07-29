import { useMemo } from "react";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";

import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { EmptyState } from "@/components/states/empty/empty-state";
import type { ReportTrendPoint } from "~/shared/reportsContract";
import {
  formatCompactReportMoney,
  formatOperatingDate,
  formatReportMoney,
  reportDayStatusPresentation,
} from "./reportFormat";

const trendChartConfig = {
  netSalesMinor: {
    label: "Net sales",
    color: "hsl(var(--primary))",
  },
} satisfies ChartConfig;

type TrendChartPoint = ReportTrendPoint & { label: string };

/** Same AreaChart/gradient treatment as `StorePulseTimeline` — status stays available in the tooltip. */
export function ReportTrendChart({
  dailyTrend,
  currency,
}: {
  dailyTrend: ReportTrendPoint[];
  currency: string;
}) {
  const chartData: TrendChartPoint[] = dailyTrend.map((point) => ({
    ...point,
    label: formatOperatingDate(point.operatingDate),
  }));

  // Remounts the Area whenever the plotted days change, so the CSS draw-in
  // replays on a period switch instead of only on first paint — same replay
  // key idea as `StorePulseTimeline`.
  const chartAnimationKey = useMemo(
    () => chartData.map((point) => point.operatingDate).join("|"),
    [chartData],
  );

  return (
    <section className="space-y-layout-sm">
      <div>
        <h3 className="text-base font-medium text-foreground">
          Net sales — last 30 days
        </h3>
      </div>
      <div className="overflow-hidden rounded-lg border border-border bg-surface-raised px-layout-sm py-8 shadow-surface sm:p-8">
        {chartData.length === 0 ? (
          <EmptyState
            description="No trend data yet."
            title="No trend data"
          />
        ) : (
          <ChartContainer
            className="report-trend-chart h-64 w-full"
            config={trendChartConfig}
          >
            <AreaChart
              data={chartData}
              margin={{ left: 0, right: 12, top: 8, bottom: 0 }}
            >
              <defs>
                <linearGradient
                  id="report-net-sales-fill"
                  x1="0"
                  x2="0"
                  y1="0"
                  y2="1"
                >
                  <stop
                    offset="5%"
                    stopColor="var(--color-netSalesMinor)"
                    stopOpacity={0.2}
                  />
                  <stop
                    offset="95%"
                    stopColor="var(--color-netSalesMinor)"
                    stopOpacity={0.03}
                  />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} />
              <XAxis
                axisLine={false}
                dataKey="label"
                tickLine={false}
                tickMargin={8}
              />
              <YAxis
                axisLine={false}
                tickFormatter={(value: number) =>
                  formatCompactReportMoney(value, currency)
                }
                tickLine={false}
                width={64}
              />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    formatter={(value, _name, item) => {
                      const point = item.payload as TrendChartPoint;
                      const presentation = reportDayStatusPresentation(
                        point.status,
                      );
                      return (
                        <div className="grid gap-1">
                          <span className="font-numeric text-foreground">
                            {formatReportMoney(Number(value), currency)}
                          </span>
                          <span className="text-muted-foreground">
                            {presentation.label}
                          </span>
                        </div>
                      );
                    }}
                    hideIndicator
                    labelFormatter={(_label, payload) => {
                      const point = payload?.[0]?.payload as
                        | TrendChartPoint
                        | undefined;
                      return point ? formatOperatingDate(point.operatingDate) : "";
                    }}
                  />
                }
              />
              <Area
                activeDot={{ r: 4 }}
                dataKey="netSalesMinor"
                data-replay-key={chartAnimationKey}
                dot={false}
                fill="url(#report-net-sales-fill)"
                fillOpacity={1}
                // Recharts' own animation is off: the draw-in is CSS on
                // .report-trend-chart (see index.css), which respects
                // prefers-reduced-motion. `pathLength={1}` normalizes the
                // curve so stroke-dashoffset can animate it.
                isAnimationActive={false}
                key={chartAnimationKey}
                name="Net sales"
                pathLength={1}
                stroke="var(--color-netSalesMinor)"
                strokeWidth={2}
                type="monotone"
              />
            </AreaChart>
          </ChartContainer>
        )}
      </div>
    </section>
  );
}
