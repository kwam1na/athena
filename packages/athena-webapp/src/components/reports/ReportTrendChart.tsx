import { useMemo, type KeyboardEvent, type ReactNode } from "react";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";

import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { EmptyState } from "@/components/states/empty/empty-state";
import { useIsMobile } from "@/hooks/use-mobile";
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

type TrendChartPoint = ReportTrendPoint & {
  label: string;
  axisLabel: string;
  chartIndex: number;
};

type ActiveTrendDotProps = {
  cx?: number;
  cy?: number;
  payload?: TrendChartPoint;
};

function ActiveTrendDot({
  cx,
  cy,
  onSelect,
  payload,
}: ActiveTrendDotProps & {
  onSelect: (operatingDate: string) => void;
}) {
  if (cx === undefined || cy === undefined || !payload) return <g />;

  const operatingDate = payload.operatingDate;

  function selectDay() {
    onSelect(operatingDate);
  }

  function handleKeyDown(event: KeyboardEvent<SVGGElement>) {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    selectDay();
  }

  return (
    <g
      aria-label={`View item sales for ${payload.label}`}
      className="cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onClick={selectDay}
      onKeyDown={handleKeyDown}
      role="link"
      tabIndex={0}
    >
      <circle cx={cx} cy={cy} fill="transparent" r={12} />
      <circle
        cx={cx}
        cy={cy}
        fill="var(--color-netSalesMinor)"
        r={4}
      />
    </g>
  );
}

/**
 * Axis labels: short weekday + short month + day, matching
 * `StorePulseSummaryView`'s axis. The year is dropped — redundant inside a
 * 30-day window and the main reason the ticks read crammed. The tooltip
 * still carries the full date.
 */
const axisDateFormatter = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
  weekday: "short",
});

/**
 * Evenly spaced tick positions across `length` points, mirroring
 * `StorePulseSummaryView`'s helper. Only the LABELS are sampled — every data
 * point is still plotted, the axis just stops trying to name all of them.
 */
function evenlySpacedTicks(length: number, count: number): number[] | undefined {
  if (length === 0) return undefined;
  if (length <= count) return Array.from({ length }, (_, index) => index);

  return Array.from({ length: count }, (_, index) =>
    Math.round((index * (length - 1)) / (count - 1)),
  );
}

const DESKTOP_TICK_COUNT = 7;
const MOBILE_TICK_COUNT = 3;

/** Same AreaChart/gradient treatment as `StorePulseTimeline` — status stays available in the tooltip. */
export function ReportTrendChart({
  dailyTrend,
  currency,
  onDaySelect,
  summary,
}: {
  dailyTrend: ReportTrendPoint[];
  currency: string;
  onDaySelect: (operatingDate: string) => void;
  summary?: ReactNode;
}) {
  const isMobile = useIsMobile();
  const chartData: TrendChartPoint[] = dailyTrend.map((point, index) => ({
    ...point,
    chartIndex: index,
    label: formatOperatingDate(point.operatingDate),
    axisLabel: axisDateFormatter.format(
      new Date(`${point.operatingDate}T00:00:00.000Z`),
    ),
  }));

  const xAxisTicks = useMemo(
    () =>
      evenlySpacedTicks(
        chartData.length,
        isMobile ? MOBILE_TICK_COUNT : DESKTOP_TICK_COUNT,
      ),
    [chartData.length, isMobile],
  );

  // Remounts the Area whenever the plotted days change, so the CSS draw-in
  // replays on a period switch instead of only on first paint — same replay
  // key idea as `StorePulseTimeline`.
  const chartAnimationKey = useMemo(
    () => chartData.map((point) => point.operatingDate).join("|"),
    [chartData],
  );

  return (
    <section className="space-y-layout-sm">
      <div className="space-y-1">
        <h3 className="text-base font-medium text-foreground">
          Net sales
        </h3>
        {summary}
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
                // Plotted against the point INDEX so ticks can be placed
                // explicitly; the line itself still uses every data point.
                dataKey="chartIndex"
                domain={[0, Math.max(0, chartData.length - 1)]}
                interval="preserveStartEnd"
                tickFormatter={(value: number | string) => {
                  const index = Math.round(Number(value));
                  return chartData[index]?.axisLabel ?? "";
                }}
                tickLine={false}
                tickMargin={8}
                ticks={xAxisTicks}
                type="number"
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
                          {point.unitsSold !== undefined ? (
                            <span className="text-muted-foreground">
                              {point.unitsSold.toLocaleString()}{" "}
                              {point.unitsSold === 1 ? "unit" : "units"} sold
                            </span>
                          ) : null}
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
                activeDot={(props: ActiveTrendDotProps) => (
                  <ActiveTrendDot {...props} onSelect={onDaySelect} />
                )}
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
