import { useMemo, useState, type ReactNode } from "react";
import {
  Banknote,
  CreditCardIcon,
  Smartphone,
  WalletCards,
  type LucideIcon,
} from "lucide-react";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";

import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { toDisplayAmount } from "~/convex/lib/currency";
import { FinancialValue } from "../common/FinancialValue";
import { ListPagination } from "../common/ListPagination";
import { formatOperationsMetricComparison } from "../operations/operationsMetricFormatting";
import {
  PageWorkspaceGrid,
  PageWorkspaceMain,
  PageWorkspaceRail,
} from "../common/PageLevelHeader";
import { EmptyState } from "../states/empty/empty-state";
import { Badge } from "../ui/badge";
import { Skeleton } from "../ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "../ui/tabs";

export type StorePulseTrendDay = {
  averageTransaction: number;
  date: string;
  hasKnownItemCount?: boolean;
  label: string;
  totalItemsSold: number;
  totalSales: number;
  transactionCount: number;
};

export type StorePulseOperatorSnapshot = {
  busiestHour: {
    hour: number;
    label: string;
    totalSales: number;
    transactionCount: number;
  } | null;
  comparison: {
    averageTransactionDeltaPercent: number;
    currentAverageTransaction: number;
    currentItemsSold: number;
    currentSales: number;
    currentTransactions: number;
    itemsSoldDeltaPercent: number;
    salesDeltaPercent: number;
    transactionDeltaPercent: number;
    yesterdayAverageTransaction: number;
    yesterdayItemsSold: number;
    yesterdaySales: number;
    yesterdayTransactions: number;
  };
  historyDays: number;
  isLimited: boolean;
  paymentMix: Array<{
    count: number;
    label: string;
    method: string;
    share: number;
    total: number;
  }>;
  topItems: Array<{
    name: string;
    productSku: string | null;
    quantity: number;
    totalSales: number;
  }>;
  trend: StorePulseTrendDay[];
  usableHistoryDays: number;
};

export type StorePulseSummary = {
  averageTransaction?: number;
  date?: string;
  operatorSnapshot?: StorePulseOperatorSnapshot;
  totalItemsSold?: number;
  totalSales?: number;
  totalTransactions?: number;
};

export type StorePulseWindow =
  | "today"
  | "this_week"
  | "this_month"
  | "all_time";

const storePulseWindowOptions: Array<{
  label: string;
  value: StorePulseWindow;
}> = [
  { label: "Today", value: "today" },
  { label: "This week", value: "this_week" },
  { label: "This month", value: "this_month" },
  { label: "All time", value: "all_time" },
];

const storePulseWindowCopy: Record<
  StorePulseWindow,
  {
    chartDescription: string;
    comparisonHelper: string | null;
  }
> = {
  today: {
    chartDescription: "Today's completed POS sales.",
    comparisonHelper: "yesterday",
  },
  this_week: {
    chartDescription: "This week's completed POS sales.",
    comparisonHelper: "last week",
  },
  this_month: {
    chartDescription: "This month's completed POS sales.",
    comparisonHelper: "last month",
  },
  all_time: {
    chartDescription: "All synced POS sales.",
    comparisonHelper: null,
  },
};

const salesPulseChartConfig = {
  value: {
    label: "Store pulse",
    color: "hsl(var(--action-workflow))",
  },
} satisfies ChartConfig;

const detailCardClassName =
  "overflow-hidden rounded-lg border border-border bg-surface-raised shadow-surface";
const detailRowClassName = "px-layout-md py-layout-sm";
const topItemsPageSize = 5;
const salesTrendAxisInset = 72;
const chartAxisDateFormatter = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
  weekday: "short",
});
const chartTooltipDateFormatter = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
  weekday: "long",
  year: "numeric",
});

function formatComparisonHelper({
  deltaPercent,
  priorValue,
  priorWindowLabel,
}: {
  deltaPercent?: number;
  priorValue?: number;
  priorWindowLabel: string;
}) {
  return formatOperationsMetricComparison({
    deltaPercent,
    missingComparisonLabel: `No ${priorWindowLabel}`,
    priorValue,
    priorWindowLabel,
  });
}

function StorePulseMetric({
  helper,
  label,
  value,
}: {
  helper?: ReactNode;
  label: string;
  value: ReactNode;
}) {
  return (
    <div className="min-w-max rounded-lg border border-border bg-surface px-layout-md py-layout-sm shadow-surface">
      <div className="flex items-start justify-between gap-layout-sm">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        <span aria-hidden="true" className="-mr-1 -mt-1 h-7 w-7 shrink-0" />
      </div>
      <p className="mt-1 font-numeric text-2xl tabular-nums text-foreground">
        {value}
      </p>
      {helper ? (
        <p className="mt-1 whitespace-nowrap text-xs leading-5 text-muted-foreground [&>span]:flex-nowrap">
          {helper}
        </p>
      ) : null}
    </div>
  );
}

function formatEntityCount(count: number, singular: string) {
  return `${count} ${count === 1 ? singular : `${singular}s`}`;
}

function getDateFromOperatingDate(date: string) {
  const parsed = Date.parse(`${date}T00:00:00.000Z`);
  return Number.isFinite(parsed) ? new Date(parsed) : null;
}

function formatChartAxisDate(date: string) {
  const parsedDate = getDateFromOperatingDate(date);
  return parsedDate ? chartAxisDateFormatter.format(parsedDate) : date;
}

function formatChartTooltipDate(date: string) {
  const parsedDate = getDateFromOperatingDate(date);
  return parsedDate ? chartTooltipDateFormatter.format(parsedDate) : date;
}

function getTrendAxisLabel({
  date,
  index,
  pulseWindow,
  trendLength,
}: {
  date: string;
  index: number;
  pulseWindow: StorePulseWindow;
  trendLength: number;
}) {
  if (pulseWindow === "today") {
    if (index === trendLength - 1) return "Today";
    if (index === trendLength - 2) return "Yesterday";
  }

  return formatChartAxisDate(date);
}

function formatProductName(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .map((word) => {
      const normalizedWord = word.toLowerCase();

      return normalizedWord.charAt(0).toUpperCase() + normalizedWord.slice(1);
    })
    .join(" ");
}

function getPaymentMethodIcon(payment: {
  label: string;
  method: string;
}): LucideIcon {
  const key = `${payment.method} ${payment.label}`.toLowerCase();

  if (key.includes("mobile") || key.includes("momo")) return Smartphone;
  if (key.includes("cash")) return Banknote;
  if (key.includes("card")) return CreditCardIcon;

  return WalletCards;
}

function formatPaymentSharePercent(share: number) {
  const roundedShare = Math.round(share * 10) / 10;

  return `${Number.isInteger(roundedShare) ? roundedShare : roundedShare.toFixed(1)}%`;
}

function formatCompactChartValue({
  canViewFinancialDetails,
  currencyFormatter,
  value,
}: {
  canViewFinancialDetails: boolean;
  currencyFormatter: Intl.NumberFormat;
  value: number;
}) {
  if (!canViewFinancialDetails) return String(value);

  if (value >= 1_000_000) {
    return `${currencyFormatter.format(Math.round(value / 1_000_000))}m`;
  }

  if (value >= 1_000) {
    return `${currencyFormatter.format(Math.round(value / 1_000))}k`;
  }

  return currencyFormatter.format(value);
}

function getTrendValue({
  canViewFinancialDetails,
  day,
}: {
  canViewFinancialDetails: boolean;
  day: StorePulseTrendDay;
}) {
  return canViewFinancialDetails
    ? toDisplayAmount(day.totalSales)
    : day.transactionCount;
}

function StorePulseTimeline({
  canViewFinancialDetails,
  description,
  currencyFormatter,
  pulseWindow,
  snapshot,
}: {
  canViewFinancialDetails: boolean;
  description: string;
  currencyFormatter: Intl.NumberFormat;
  pulseWindow: StorePulseWindow;
  snapshot: StorePulseOperatorSnapshot;
}) {
  const chartData = useMemo(
    () =>
      snapshot.trend.map((day, index, trend) => ({
        ...day,
        displayDate: formatChartTooltipDate(day.date),
        displayLabel: getTrendAxisLabel({
          date: day.date,
          index,
          pulseWindow,
          trendLength: trend.length,
        }),
        value: getTrendValue({ canViewFinancialDetails, day }),
      })),
    [canViewFinancialDetails, pulseWindow, snapshot.trend],
  );
  const xAxisTicks = useMemo(() => {
    if (
      (pulseWindow !== "this_month" && pulseWindow !== "all_time") ||
      chartData.length <= 7
    ) {
      return undefined;
    }

    return Array.from({ length: 7 }, (_, index) => {
      const chartIndex = Math.round((index * (chartData.length - 1)) / (7 - 1));

      return chartData[chartIndex]?.displayLabel;
    }).filter((label): label is string => Boolean(label));
  }, [chartData, pulseWindow]);
  const chartLabel = canViewFinancialDetails ? "Sales" : "Transactions";

  return (
    <section className="space-y-layout-sm">
      <div className="flex flex-col gap-layout-xs sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h3 className="text-base font-medium text-foreground">Sales trend</h3>
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        </div>
        <div className="flex items-center gap-layout-xs">
          <Badge variant="outline">Synced POS history</Badge>
          {snapshot.isLimited ? (
            <Badge variant="outline">Recent sample</Badge>
          ) : null}
        </div>
      </div>
      <div className="overflow-hidden rounded-lg border border-border bg-surface-raised p-8 shadow-surface">
        <ChartContainer
          config={salesPulseChartConfig}
          className="h-[22rem] w-full"
        >
          <AreaChart
            data={chartData}
            margin={{ left: 0, right: salesTrendAxisInset, top: 0, bottom: 0 }}
          >
            <defs>
              <linearGradient
                id="store-pulse-sales-fill"
                x1="0"
                x2="0"
                y1="0"
                y2="1"
              >
                <stop
                  offset="5%"
                  stopColor="var(--color-value)"
                  stopOpacity={0.2}
                />
                <stop
                  offset="95%"
                  stopColor="var(--color-value)"
                  stopOpacity={0.03}
                />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="displayLabel"
              axisLine={false}
              interval="preserveStartEnd"
              tickMargin={8}
              tickLine={false}
              ticks={xAxisTicks}
            />
            <YAxis
              width={salesTrendAxisInset}
              axisLine={false}
              tickLine={false}
              tickFormatter={(value) =>
                formatCompactChartValue({
                  canViewFinancialDetails,
                  currencyFormatter,
                  value: Number(value),
                })
              }
            />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  hideIndicator
                  labelFormatter={(_, payload) => {
                    const day = payload?.[0]?.payload as
                      | (StorePulseTrendDay & {
                          displayDate: string;
                          value: number;
                        })
                      | undefined;
                    return day?.displayDate ?? "";
                  }}
                  formatter={(value, _name, item) => {
                    const day = item.payload as StorePulseTrendDay & {
                      value: number;
                    };
                    const displayValue = canViewFinancialDetails
                      ? currencyFormatter.format(Number(value))
                      : String(value);

                    return (
                      <div className="grid gap-1">
                        <span className="font-numeric text-foreground">
                          {displayValue} {chartLabel.toLowerCase()}
                        </span>
                        <span className="text-muted-foreground">
                          {formatEntityCount(
                            day.transactionCount,
                            "transaction",
                          )}
                          {day.hasKnownItemCount === false ? null : (
                            <>
                              {" "}
                              · {formatEntityCount(day.totalItemsSold, "item")}
                            </>
                          )}
                        </span>
                      </div>
                    );
                  }}
                />
              }
            />
            <Area
              dataKey="value"
              fill="url(#store-pulse-sales-fill)"
              fillOpacity={1}
              name={chartLabel}
              type="monotone"
              stroke="var(--color-value)"
              strokeWidth={3}
              dot={false}
              activeDot={false}
            />
          </AreaChart>
        </ChartContainer>
      </div>
    </section>
  );
}

function TopItemsPanel({
  canViewFinancialDetails,
  currencyFormatter,
  snapshot,
  title = "Top items",
}: {
  canViewFinancialDetails: boolean;
  currencyFormatter: Intl.NumberFormat;
  snapshot: StorePulseOperatorSnapshot;
  title?: string;
}) {
  const [page, setPage] = useState(1);
  const topItemCount = snapshot.topItems.length;
  const pageCount = Math.max(1, Math.ceil(topItemCount / topItemsPageSize));
  const currentPage = Math.min(page, pageCount);
  const pageStartIndex = (currentPage - 1) * topItemsPageSize;
  const isPaginated = topItemCount > topItemsPageSize;
  const visibleTopItems = snapshot.topItems.slice(
    pageStartIndex,
    pageStartIndex + topItemsPageSize,
  );
  const totalItemsSold = snapshot.comparison.currentItemsSold;

  return (
    <section className="space-y-layout-md">
      <div className="flex flex-col gap-layout-xs sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-base font-medium text-foreground">{title}</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Highest-volume items in the current history window.
          </p>
        </div>
        <p
          aria-label={`Total items sold: ${totalItemsSold}`}
          className="inline-flex items-baseline gap-1.5 text-sm text-muted-foreground sm:justify-end sm:text-right"
        >
          <span>Total items sold</span>
          <span className="font-numeric font-medium tabular-nums text-foreground">
            {totalItemsSold}
          </span>
        </p>
      </div>
      <div
        className={
          isPaginated
            ? `${detailCardClassName} flex min-h-[23.5rem] flex-col`
            : detailCardClassName
        }
      >
        {snapshot.topItems.length ? (
          <>
            <div
              className={`divide-y divide-border/70 ${
                isPaginated ? "flex-1" : ""
              }`}
            >
              {visibleTopItems.map((item, index) => {
                const displayName = formatProductName(item.name);
                const rank = pageStartIndex + index + 1;

                return (
                  <div
                    className={`${detailRowClassName} grid gap-2 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-center`}
                    key={`${item.name}:${item.productSku ?? rank}`}
                  >
                    <span className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-border bg-surface text-xs font-medium text-muted-foreground">
                      {rank}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">
                        {displayName}
                      </p>
                      <p className="flex flex-wrap items-center gap-x-layout-xs text-xs text-muted-foreground">
                        <span>
                          {formatEntityCount(item.quantity, "unit")} sold
                        </span>
                        <span aria-hidden="true">·</span>
                        <span className="font-numeric tabular-nums">
                          <FinancialValue
                            canView={canViewFinancialDetails}
                            label={`${displayName} sales`}
                          >
                            {currencyFormatter.format(
                              toDisplayAmount(item.totalSales),
                            )}
                          </FinancialValue>
                        </span>
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
            {isPaginated ? (
              <ListPagination
                onPageChange={setPage}
                page={currentPage}
                pageCount={pageCount}
                pageSize={topItemsPageSize}
                totalItems={topItemCount}
              />
            ) : null}
          </>
        ) : (
          <EmptyState
            description="Completed POS sales will populate item movement here."
            title="No item history yet"
          />
        )}
      </div>
    </section>
  );
}

function PaymentMethodsPanel({
  snapshot,
}: {
  snapshot: StorePulseOperatorSnapshot;
}) {
  const totalPaymentTransactions = snapshot.paymentMix.reduce(
    (total, payment) => total + payment.count,
    0,
  );

  return (
    <section aria-label="Payment methods" className="space-y-layout-md">
      <div>
        <h3 className="text-base font-medium text-foreground">
          How customers paid
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Share of synced POS sales by payment method.
        </p>
      </div>
      <div className={detailCardClassName}>
        <div className="divide-y divide-border/70">
          {snapshot.paymentMix.length ? (
            snapshot.paymentMix.map((payment) => {
              const PaymentIcon = getPaymentMethodIcon(payment);
              const paymentShare =
                totalPaymentTransactions > 0
                  ? (payment.count / totalPaymentTransactions) * 100
                  : 0;

              return (
                <div
                  className={`${detailRowClassName} grid gap-1`}
                  key={payment.method}
                >
                  <div className="flex items-center justify-between gap-layout-sm text-sm">
                    <span className="inline-flex min-w-0 items-center gap-2 font-medium text-foreground">
                      <PaymentIcon
                        aria-hidden="true"
                        className="h-4 w-4 shrink-0 text-action-workflow"
                      />
                      <span className="truncate">{payment.label}</span>
                    </span>
                    <span className="font-numeric tabular-nums text-muted-foreground">
                      {formatPaymentSharePercent(paymentShare)}
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-action-workflow-soft">
                    <div
                      className="h-full rounded-full bg-action-workflow"
                      style={{ width: `${Math.max(4, paymentShare)}%` }}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {formatEntityCount(payment.count, "transaction")}
                  </p>
                </div>
              );
            })
          ) : (
            <EmptyState
              description="Payment method shares will appear after completed sales sync."
              title="No payment mix yet"
            />
          )}
        </div>
      </div>
    </section>
  );
}

function StorePulseRail({ snapshot }: { snapshot: StorePulseOperatorSnapshot }) {
  return (
    <PageWorkspaceRail>
      <PaymentMethodsPanel snapshot={snapshot} />
    </PageWorkspaceRail>
  );
}

const loadingMetrics = [
  { helper: "-", label: "Sales" },
  { helper: "-", label: "Average sale" },
  { helper: "-", label: "Transactions" },
  { helper: "-", label: "Items sold" },
] as const;

function StorePulseChartSkeleton() {
  return (
    <section aria-label="Sales trend loading" className="space-y-layout-sm">
      <div className="flex flex-col gap-layout-xs sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h3 className="text-base font-medium text-foreground">Sales trend</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Last 14 days of completed POS sales.
          </p>
        </div>
        <Skeleton className="h-6 w-28 rounded-sm" />
      </div>
      <div className="overflow-hidden rounded-lg border border-border bg-surface-raised p-8 shadow-surface">
        <div className="relative h-[22rem] w-full">
          <div className="absolute inset-y-0 left-0 flex w-16 flex-col justify-between py-1">
            {Array.from({ length: 5 }).map((_, index) => (
              <Skeleton className="h-3 w-12 rounded-sm" key={index} />
            ))}
          </div>
          <div className="absolute inset-y-0 left-20 right-0 flex flex-col justify-between">
            {Array.from({ length: 5 }).map((_, index) => (
              <Skeleton className="h-px w-full rounded-sm" key={index} />
            ))}
          </div>
          <Skeleton className="absolute left-20 right-4 top-1/2 h-1 -translate-y-1/2 rounded-sm" />
          <div className="absolute bottom-0 left-20 right-0 grid grid-cols-7 gap-layout-sm">
            {Array.from({ length: 7 }).map((_, index) => (
              <Skeleton className="h-3 rounded-sm" key={index} />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function StorePulseDetailSkeleton({
  description,
  rowCount,
  title,
}: {
  description: string;
  rowCount: number;
  title: string;
}) {
  return (
    <section aria-label={`${title} loading`} className="space-y-layout-md">
      <div>
        <h3 className="text-base font-medium text-foreground">{title}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      <div className={detailCardClassName}>
        <div className="divide-y divide-border/70">
          {Array.from({ length: rowCount }).map((_, index) => (
            <div
              className={`${detailRowClassName} grid gap-2 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-center`}
              key={index}
            >
              <Skeleton className="h-6 w-6 rounded-sm" />
              <div className="min-w-0">
                <Skeleton className="h-4 w-32 rounded-sm" />
                <Skeleton className="mt-2 h-3 w-44 rounded-sm" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function StorePulseSkeleton({
  showFinancialSalesCards,
  showSummaryMetrics,
  topItemsTitle = "Top items",
}: {
  showFinancialSalesCards: boolean;
  showSummaryMetrics: boolean;
  topItemsTitle?: string;
}) {
  const visibleLoadingMetrics = showFinancialSalesCards
    ? loadingMetrics
    : loadingMetrics.slice(2);

  return (
    <div
      aria-label="Store pulse loading"
      className="min-w-0 space-y-layout-xl md:space-y-layout-2xl"
    >
      <section className="space-y-layout-2xl">
        {showSummaryMetrics ? (
          <div className="grid gap-layout-sm sm:grid-cols-2 xl:grid-cols-4">
            {visibleLoadingMetrics.map((metric) => (
              <StorePulseMetric
                helper={metric.helper}
                key={metric.label}
                label={metric.label}
                value="-"
              />
            ))}
          </div>
        ) : null}

        {showFinancialSalesCards ? <StorePulseChartSkeleton /> : null}
      </section>

      {showFinancialSalesCards ? (
        <PageWorkspaceGrid className="xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <PageWorkspaceMain>
            <StorePulseDetailSkeleton
              description="Highest-volume items in the current history window."
              rowCount={5}
              title={topItemsTitle}
            />
          </PageWorkspaceMain>

          <PageWorkspaceRail>
            <StorePulseDetailSkeleton
              description="Share of synced POS sales by payment method."
              rowCount={3}
              title="How customers paid"
            />
          </PageWorkspaceRail>
        </PageWorkspaceGrid>
      ) : null}
    </div>
  );
}

export function StorePulseSummaryView({
  canViewFinancialDetails,
  currencyFormatter,
  onPulseWindowChange,
  pulseWindow,
  showPulseWindowFilter = true,
  showSummaryMetrics = true,
  summary,
  topItemsTitle = "Top items",
}: {
  canViewFinancialDetails: boolean;
  currencyFormatter: Intl.NumberFormat;
  onPulseWindowChange: (pulseWindow: StorePulseWindow) => void;
  pulseWindow: StorePulseWindow;
  showPulseWindowFilter?: boolean;
  showSummaryMetrics?: boolean;
  summary: StorePulseSummary | undefined;
  topItemsTitle?: string;
}) {
  const snapshot = summary?.operatorSnapshot;
  const comparison = snapshot?.comparison;
  const copy = storePulseWindowCopy[pulseWindow];
  const totalSales = summary?.totalSales ?? 0;
  const totalTransactions = summary?.totalTransactions ?? 0;
  const totalItemsSold = summary?.totalItemsSold ?? 0;
  const averageTransaction = summary?.averageTransaction ?? 0;

  return (
    <section
      aria-label="Store pulse"
      className="space-y-layout-xl md:space-y-layout-2xl"
    >
      {canViewFinancialDetails && showPulseWindowFilter ? (
        <div className="flex justify-end">
          <Tabs
            onValueChange={(nextValue) => {
              if (
                nextValue === "today" ||
                nextValue === "this_week" ||
                nextValue === "this_month" ||
                nextValue === "all_time"
              ) {
                onPulseWindowChange(nextValue);
              }
            }}
            value={pulseWindow}
          >
            <TabsList
              aria-label="Store pulse time range"
              className="h-auto flex-wrap justify-start gap-1 border border-border bg-surface-raised p-1 text-muted-foreground shadow-surface"
              size="sm"
            >
              {storePulseWindowOptions.map((option) => (
                <TabsTrigger
                  className="min-h-8 px-3 data-[state=active]:bg-action-workflow-soft data-[state=active]:text-action-workflow data-[state=active]:shadow-none"
                  key={option.value}
                  size="sm"
                  value={option.value}
                >
                  {option.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>
      ) : null}

      {!snapshot ? (
        <StorePulseSkeleton
          showFinancialSalesCards={canViewFinancialDetails}
          showSummaryMetrics={showSummaryMetrics}
          topItemsTitle={topItemsTitle}
        />
      ) : (
        <div className="min-w-0 space-y-layout-xl md:space-y-layout-2xl">
          <section className="space-y-layout-2xl">
            {showSummaryMetrics ? (
              <div className="grid gap-layout-sm sm:grid-cols-2 xl:grid-cols-4">
                {canViewFinancialDetails ? (
                  <>
                    <StorePulseMetric
                      helper={
                        copy.comparisonHelper
                          ? formatComparisonHelper({
                              deltaPercent: comparison?.salesDeltaPercent,
                              priorValue: comparison?.yesterdaySales,
                              priorWindowLabel: copy.comparisonHelper,
                            })
                          : "-"
                      }
                      label="Sales"
                      value={
                        <FinancialValue
                          canView={canViewFinancialDetails}
                          label="Sales"
                        >
                          {currencyFormatter.format(toDisplayAmount(totalSales))}
                        </FinancialValue>
                      }
                    />
                    <StorePulseMetric
                      helper={
                        copy.comparisonHelper
                          ? formatComparisonHelper({
                              deltaPercent:
                                comparison?.averageTransactionDeltaPercent,
                              priorValue:
                                comparison?.yesterdayAverageTransaction,
                              priorWindowLabel: copy.comparisonHelper,
                            })
                          : "-"
                      }
                      label="Average sale"
                      value={
                        <FinancialValue
                          canView={canViewFinancialDetails}
                          label="Average sale"
                        >
                          {currencyFormatter.format(
                            toDisplayAmount(averageTransaction),
                          )}
                        </FinancialValue>
                      }
                    />
                  </>
                ) : null}
                <StorePulseMetric
                  helper={
                    canViewFinancialDetails
                      ? copy.comparisonHelper
                        ? formatComparisonHelper({
                            deltaPercent: comparison?.transactionDeltaPercent,
                            priorValue: comparison?.yesterdayTransactions,
                            priorWindowLabel: copy.comparisonHelper,
                          })
                        : "-"
                      : undefined
                  }
                  label="Transactions"
                  value={totalTransactions}
                />
                <StorePulseMetric
                  helper={
                    canViewFinancialDetails
                      ? copy.comparisonHelper
                        ? formatComparisonHelper({
                            deltaPercent: comparison?.itemsSoldDeltaPercent,
                            priorValue: comparison?.yesterdayItemsSold,
                            priorWindowLabel: copy.comparisonHelper,
                          })
                        : "-"
                      : undefined
                  }
                  label="Items sold"
                  value={totalItemsSold}
                />
              </div>
            ) : null}

            {canViewFinancialDetails ? (
              <StorePulseTimeline
                canViewFinancialDetails={canViewFinancialDetails}
                description={copy.chartDescription}
                currencyFormatter={currencyFormatter}
                pulseWindow={pulseWindow}
                snapshot={snapshot}
              />
            ) : null}
          </section>

          {canViewFinancialDetails ? (
            <PageWorkspaceGrid className="xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <PageWorkspaceMain>
                <TopItemsPanel
                  canViewFinancialDetails={canViewFinancialDetails}
                  currencyFormatter={currencyFormatter}
                  snapshot={snapshot}
                  title={topItemsTitle}
                />
              </PageWorkspaceMain>

              <StorePulseRail snapshot={snapshot} />
            </PageWorkspaceGrid>
          ) : null}
        </div>
      )}
    </section>
  );
}
