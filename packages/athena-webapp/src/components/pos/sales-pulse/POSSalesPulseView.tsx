import { useMemo, useState } from "react";
import {
  ArrowDownRight,
  ArrowUpRight,
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
import { FinancialValue } from "../../common/FinancialValue";
import { ListPagination } from "../../common/ListPagination";
import {
  PageWorkspaceGrid,
  PageWorkspaceMain,
  PageWorkspaceRail,
} from "../../common/PageLevelHeader";
import { OperationsSummaryMetric } from "../../operations/OperationsSummaryMetric";
import { EmptyState } from "../../states/empty/empty-state";
import { Badge } from "../../ui/badge";
import { Skeleton } from "../../ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "../../ui/tabs";

type POSSalesTrendDay = {
  averageTransaction: number;
  date: string;
  label: string;
  totalItemsSold: number;
  totalSales: number;
  transactionCount: number;
};

export type POSOperatorSnapshot = {
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
  trend: POSSalesTrendDay[];
  usableHistoryDays: number;
};

export type POSStorePulseSummary = {
  averageTransaction?: number;
  date?: string;
  operatorSnapshot?: POSOperatorSnapshot;
  totalItemsSold?: number;
  totalSales?: number;
  totalTransactions?: number;
};

export type POSStorePulseWindow =
  | "today"
  | "this_week"
  | "this_month"
  | "all_time";

const storePulseWindowOptions: Array<{
  label: string;
  value: POSStorePulseWindow;
}> = [
  { label: "Today", value: "today" },
  { label: "This week", value: "this_week" },
  { label: "This month", value: "this_month" },
  { label: "All time", value: "all_time" },
];

const storePulseWindowCopy: Record<
  POSStorePulseWindow,
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

function formatDeltaPercent(value: number) {
  if (!Number.isFinite(value) || value === 0) return "In line";
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${value}%`;
}

function formatComparisonHelper({
  deltaPercent,
  priorValue,
  priorWindowLabel,
}: {
  deltaPercent?: number;
  priorValue?: number;
  priorWindowLabel: string;
}) {
  if (!priorValue) return `No ${priorWindowLabel}`;

  const hasTrend = Boolean(deltaPercent && deltaPercent !== 0);
  const trendClassName = hasTrend
    ? deltaPercent! > 0
      ? "text-success"
      : "text-destructive"
    : "text-muted-foreground";
  const TrendIcon =
    hasTrend && deltaPercent! > 0 ? ArrowUpRight : ArrowDownRight;

  return (
    <>
      <span className={`inline-flex items-center gap-1 ${trendClassName}`}>
        {hasTrend ? <TrendIcon aria-hidden="true" className="h-3 w-3" /> : null}
        <span>{formatDeltaPercent(deltaPercent ?? 0)}</span>
      </span>{" "}
      vs {priorWindowLabel}
    </>
  );
}

function formatEntityCount(count: number, singular: string) {
  return `${count} ${count === 1 ? singular : `${singular}s`}`;
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
  day: POSSalesTrendDay;
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
  pulseWindow: POSStorePulseWindow;
  snapshot: POSOperatorSnapshot;
}) {
  const chartData = useMemo(
    () =>
      snapshot.trend.map((day) => ({
        ...day,
        value: getTrendValue({ canViewFinancialDetails, day }),
      })),
    [canViewFinancialDetails, snapshot.trend],
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

      return chartData[chartIndex]?.label;
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
            margin={{ left: 0, right: 0, top: 0, bottom: 0 }}
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
              dataKey="label"
              axisLine={false}
              interval="preserveStartEnd"
              tickMargin={8}
              tickLine={false}
              ticks={xAxisTicks}
            />
            <YAxis
              width={72}
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
                      | (POSSalesTrendDay & { value: number })
                      | undefined;
                    return day?.date ?? "";
                  }}
                  formatter={(value, _name, item) => {
                    const day = item.payload as POSSalesTrendDay & {
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
                          )}{" "}
                          · {formatEntityCount(day.totalItemsSold, "item")}
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
}: {
  canViewFinancialDetails: boolean;
  currencyFormatter: Intl.NumberFormat;
  snapshot: POSOperatorSnapshot;
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

  return (
    <section className="space-y-layout-md">
      <div>
        <h3 className="text-base font-medium text-foreground">Top items</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Highest-volume items in the current history window.
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

function PaymentMethodsPanel({ snapshot }: { snapshot: POSOperatorSnapshot }) {
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
                      {payment.share}%
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-action-workflow-soft">
                    <div
                      className="h-full rounded-full bg-action-workflow"
                      style={{ width: `${Math.max(4, payment.share)}%` }}
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

function StorePulseRail({ snapshot }: { snapshot: POSOperatorSnapshot }) {
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
  showDetailSection,
}: {
  showDetailSection: boolean;
}) {
  return (
    <div
      aria-label="Store pulse loading"
      className="min-w-0 space-y-layout-xl md:space-y-layout-2xl"
    >
      <section className="space-y-layout-2xl">
        <div className="grid gap-layout-sm sm:grid-cols-2 xl:grid-cols-4">
          {loadingMetrics.map((metric) => (
            <OperationsSummaryMetric
              helper={metric.helper}
              key={metric.label}
              label={metric.label}
              value="-"
            />
          ))}
        </div>

        {showDetailSection ? <StorePulseChartSkeleton /> : null}
      </section>

      {showDetailSection ? (
        <PageWorkspaceGrid className="xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <PageWorkspaceMain>
            <StorePulseDetailSkeleton
              description="Highest-volume items in the current history window."
              rowCount={5}
              title="Top items"
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

export function POSStorePulseSection({
  currencyFormatter,
  hasFullAdminAccess,
  onPulseWindowChange,
  pulseWindow,
  todaySummary,
}: {
  currencyFormatter: Intl.NumberFormat;
  hasFullAdminAccess: boolean;
  onPulseWindowChange: (pulseWindow: POSStorePulseWindow) => void;
  pulseWindow: POSStorePulseWindow;
  todaySummary: POSStorePulseSummary | undefined;
}) {
  const snapshot = todaySummary?.operatorSnapshot;
  const comparison = snapshot?.comparison;
  const copy = storePulseWindowCopy[pulseWindow];
  const totalSales = todaySummary?.totalSales ?? 0;
  const totalTransactions = todaySummary?.totalTransactions ?? 0;
  const totalItemsSold = todaySummary?.totalItemsSold ?? 0;
  const averageTransaction = todaySummary?.averageTransaction ?? 0;

  return (
    <section
      aria-label="Store pulse"
      className="space-y-layout-xl md:space-y-layout-2xl"
    >
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

      {!snapshot ? (
        <StorePulseSkeleton showDetailSection={hasFullAdminAccess} />
      ) : (
        <div className="min-w-0 space-y-layout-xl md:space-y-layout-2xl">
          <section className="space-y-layout-2xl">
            <div className="grid gap-layout-sm sm:grid-cols-2 xl:grid-cols-4">
              <OperationsSummaryMetric
                helper={
                  hasFullAdminAccess
                    ? copy.comparisonHelper
                      ? formatComparisonHelper({
                          deltaPercent: comparison?.salesDeltaPercent,
                          priorValue: comparison?.yesterdaySales,
                          priorWindowLabel: copy.comparisonHelper,
                        })
                      : "-"
                    : "Revenue hidden"
                }
                label="Sales"
                value={
                  <FinancialValue
                    canView={hasFullAdminAccess}
                    label="Sales"
                  >
                    {currencyFormatter.format(toDisplayAmount(totalSales))}
                  </FinancialValue>
                }
              />
              <OperationsSummaryMetric
                helper={
                  hasFullAdminAccess
                    ? copy.comparisonHelper
                      ? formatComparisonHelper({
                          deltaPercent:
                            comparison?.averageTransactionDeltaPercent,
                          priorValue: comparison?.yesterdayAverageTransaction,
                          priorWindowLabel: copy.comparisonHelper,
                        })
                      : "-"
                    : "Revenue hidden"
                }
                label="Average sale"
                value={
                  <FinancialValue
                    canView={hasFullAdminAccess}
                    label="Average sale"
                  >
                    {currencyFormatter.format(
                      toDisplayAmount(averageTransaction),
                    )}
                  </FinancialValue>
                }
              />
              <OperationsSummaryMetric
                helper={
                  copy.comparisonHelper
                    ? formatComparisonHelper({
                        deltaPercent: comparison?.transactionDeltaPercent,
                        priorValue: comparison?.yesterdayTransactions,
                        priorWindowLabel: copy.comparisonHelper,
                      })
                    : "-"
                }
                label="Transactions"
                value={totalTransactions}
              />
              <OperationsSummaryMetric
                helper={
                  copy.comparisonHelper
                    ? formatComparisonHelper({
                        deltaPercent: comparison?.itemsSoldDeltaPercent,
                        priorValue: comparison?.yesterdayItemsSold,
                        priorWindowLabel: copy.comparisonHelper,
                      })
                    : "-"
                }
                label="Items sold"
                value={totalItemsSold}
              />
            </div>

            {hasFullAdminAccess ? (
              <StorePulseTimeline
                canViewFinancialDetails={hasFullAdminAccess}
                description={copy.chartDescription}
                currencyFormatter={currencyFormatter}
                pulseWindow={pulseWindow}
                snapshot={snapshot}
              />
            ) : null}
          </section>

          {hasFullAdminAccess ? (
            <PageWorkspaceGrid className="xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <PageWorkspaceMain>
                <TopItemsPanel
                  canViewFinancialDetails={hasFullAdminAccess}
                  currencyFormatter={currencyFormatter}
                  snapshot={snapshot}
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
