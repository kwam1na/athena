import { useState, type ComponentProps } from "react";
import { Calendar as CalendarIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  getLocalDateFromOperatingDate,
  getLocalOperatingDate,
} from "@/lib/operations/operatingDate";
import { getOrigin } from "@/lib/navigationUtils";
import type { ReportSkuSortBy } from "~/shared/reportsContract";
import { FlipNumber } from "@/components/common/FlipNumber";
import { OperationsSummaryMetric } from "@/components/operations/OperationsSummaryMetric";
import { ReportCalendar } from "./ReportCalendar";
import { ReportFreshness } from "./ReportFreshness";
import {
  REPORT_PERIOD_TYPE_LABELS,
  REPORT_PERIOD_TYPES,
  dateRangeForItemsPeriod,
  type ReportPeriodType,
} from "./reportPeriodKeys";
import {
  formatOperatingDate,
  formatReportDateRange,
  formatReportMoney,
  formatUnits,
} from "./reportFormat";

export type ReportsItemsVariant = "card" | "canvas";

export function ReportsItemsPerformance({
  currency,
  periodType,
  periodDate,
  sortBy,
  totalNetSalesMinor,
  totalUnitsSold,
  totalTransactions,
  updatedAt,
  hasActivity,
  isTodayInProgress,
  onPeriodTypeChange,
  onPeriodDateChange,
  onSortByChange,
  orgUrlSlug,
  storeUrlSlug,
  variant,
}: {
  currency: string;
  periodType: ReportPeriodType;
  periodDate: string;
  sortBy: ReportSkuSortBy;
  totalNetSalesMinor?: number;
  totalUnitsSold?: number;
  totalTransactions?: number;
  updatedAt?: number | null;
  hasActivity: boolean;
  isTodayInProgress: boolean;
  onPeriodTypeChange: (periodType: ReportPeriodType) => void;
  onPeriodDateChange: (periodDate: string) => void;
  onSortByChange: (sortBy: ReportSkuSortBy) => void;
  orgUrlSlug: string;
  storeUrlSlug: string;
  variant: ReportsItemsVariant;
}) {
  const periodRange = dateRangeForItemsPeriod(periodType, periodDate);
  const selectedDate = getLocalDateFromOperatingDate(periodDate);
  const [isDatePickerOpen, setIsDatePickerOpen] = useState(false);
  const transactionsSearch = {
    endDate: periodRange.endDate,
    o: getOrigin(),
    startDate: periodRange.startDate,
    ...(periodType === "day" && isTodayInProgress
      ? {}
      : { order: "oldestFirst" as const }),
  };

  return (
    <section
      aria-labelledby="items-sales-title"
      className={cn(
        variant === "card"
          ? "overflow-hidden rounded-xl border border-border bg-surface-raised shadow-surface"
          : "space-y-layout-lg",
      )}
      data-variant={variant}
      data-testid="items-report-workspace"
    >
      <header
        className={cn(
          "space-y-layout-md",
          variant === "card" && "p-layout-md md:p-layout-lg",
        )}
      >
        <div className="space-y-1">
          <h2
            className="text-lg font-semibold tracking-tight text-foreground"
            id="items-sales-title"
          >
            Item sales
          </h2>
          <p className="text-sm leading-6 text-muted-foreground">
            Choose a reporting period and rank items by revenue or units sold.
          </p>
        </div>

        <div
          className="flex w-full min-w-0 flex-col gap-1 rounded-xl border border-border bg-surface-raised p-1 sm:w-fit sm:flex-row sm:items-center"
          data-testid="items-report-controls"
        >
          <div
            aria-labelledby="items-period-controls-label"
            className="flex min-w-0 items-center"
            role="group"
          >
            <span
              className="shrink-0 px-2 text-xs font-medium text-muted-foreground"
              id="items-period-controls-label"
            >
              Period
            </span>
            <Select
              onValueChange={(value) =>
                onPeriodTypeChange(value as ReportPeriodType)
              }
              value={periodType}
            >
              <SelectTrigger
                aria-label="Period type"
                className="h-9 w-28 rounded-lg border-0 bg-transparent px-3 shadow-none focus:ring-2 focus:ring-ring focus:ring-offset-0"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {REPORT_PERIOD_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {REPORT_PERIOD_TYPE_LABELS[type]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span aria-hidden="true" className="mx-1 h-5 w-px bg-border" />
            <span className="shrink-0 px-2 text-xs font-medium text-muted-foreground">
              Date
            </span>
            <Popover
              onOpenChange={setIsDatePickerOpen}
              open={isDatePickerOpen}
            >
              <PopoverTrigger asChild>
                <Button
                  aria-label={`Change date, currently ${formatOperatingDate(periodDate)}`}
                  className="h-9 min-w-0 flex-1 justify-start rounded-lg px-3 text-sm font-medium text-foreground transition-[background-color,transform] duration-100 hover:bg-accent active:scale-[0.98] motion-reduce:transition-none sm:flex-none"
                  variant="ghost"
                >
                  <CalendarIcon className="h-4 w-4 text-muted-foreground" />
                  <span className="truncate">
                    {formatOperatingDate(periodDate)}
                  </span>
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-auto p-0">
                <ReportCalendar
                  defaultMonth={selectedDate}
                  mode="single"
                  onSelect={(date) => {
                    if (!date) return;
                    onPeriodDateChange(getLocalOperatingDate(date));
                    setIsDatePickerOpen(false);
                  }}
                  selected={selectedDate}
                />
              </PopoverContent>
            </Popover>
          </div>

          <span
            aria-hidden="true"
            className="h-px w-full bg-border sm:mx-1 sm:h-5 sm:w-px"
          />
          <div
            aria-labelledby="items-sort-controls-label"
            className="flex w-full items-center gap-1 rounded-lg p-0.5 sm:w-auto"
            role="group"
          >
            <span
              className="shrink-0 px-2 text-xs font-medium text-muted-foreground"
              id="items-sort-controls-label"
            >
              Rank by
            </span>
            {(["revenue", "units"] as const).map((sort) => (
              <Button
                aria-pressed={sortBy === sort}
                className={cn(
                  "h-8 flex-1 rounded-md px-3 transition-[background-color,color,transform,box-shadow] duration-100 active:scale-[0.97] motion-reduce:transition-none sm:flex-none",
                  sortBy !== sort &&
                    "bg-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                )}
                key={sort}
                onClick={() => onSortByChange(sort)}
                size="sm"
                type="button"
                variant={sortBy === sort ? "primary-soft" : "ghost"}
              >
                {sort === "revenue" ? "Revenue" : "Units sold"}
              </Button>
            ))}
          </div>
        </div>

        <div
          aria-hidden={periodType === "day" ? true : undefined}
          className={cn(
            "grid transition-[grid-template-rows,opacity] duration-standard ease-standard motion-reduce:transition-none",
            periodType === "day"
              ? "grid-rows-[0fr] opacity-0"
              : "grid-rows-[1fr] opacity-100",
          )}
          data-testid="items-period-range"
        >
          <div className="min-h-0 overflow-hidden">
            <p className="px-1 pt-layout-xs text-xs leading-5 text-muted-foreground">
              Reporting range{" "}
              <span className="font-medium text-foreground">
                {formatReportDateRange(
                  periodRange.startDate,
                  periodRange.endDate,
                  { includeWeekday: true },
                )}
              </span>
            </p>
          </div>
        </div>
      </header>

      {variant === "canvas" ? (
        <div className="space-y-layout-sm">
          <div
            aria-hidden={hasActivity ? undefined : true}
            className={cn(
              "grid grid-cols-1 gap-layout-sm sm:grid-cols-3",
              !hasActivity && "invisible",
            )}
            data-testid="items-period-metrics-reserved"
          >
            <MetricCard
              formatValue={(value) => formatReportMoney(value, currency)}
              label="Net sales"
              link={{
                ariaLabel: "Open transactions for net sales",
                orgUrlSlug,
                search: transactionsSearch,
                storeUrlSlug,
                to: "/$orgUrlSlug/store/$storeUrlSlug/pos/transactions",
              }}
              testId={hasActivity ? "items-period-net-sales" : undefined}
              value={totalNetSalesMinor ?? 0}
            />
            <MetricCard
              formatValue={formatUnits}
              label="Units sold"
              numberTestId={
                hasActivity ? "items-period-units-number" : undefined
              }
              testId={hasActivity ? "items-period-units-sold" : undefined}
              value={totalUnitsSold ?? 0}
            />
            <MetricCard
              formatValue={formatUnits}
              label="Transactions"
              link={{
                ariaLabel: "Open transactions for transaction count",
                orgUrlSlug,
                search: transactionsSearch,
                storeUrlSlug,
                to: "/$orgUrlSlug/store/$storeUrlSlug/pos/transactions",
              }}
              numberTestId={
                hasActivity ? "items-period-transactions-number" : undefined
              }
              testId={hasActivity ? "items-period-transactions" : undefined}
              value={totalTransactions ?? 0}
            />
          </div>
          <div className="flex justify-end">
            <ReportFreshness
              delayedDataLabel="Item data"
              updatedAt={updatedAt}
            />
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-layout-sm border-t border-border bg-muted/20 px-layout-md py-layout-md sm:flex-row sm:items-end sm:justify-between md:px-layout-lg">
          <div
            aria-hidden={hasActivity ? undefined : true}
            className={cn(
              "flex flex-wrap items-start gap-layout-xl",
              !hasActivity && "invisible",
            )}
            data-testid="items-period-metrics-reserved"
          >
            <Metric
              formatValue={(value) => formatReportMoney(value, currency)}
              label="Net sales"
              testId={hasActivity ? "items-period-net-sales" : undefined}
              value={totalNetSalesMinor ?? 0}
            />
            <Metric
              formatValue={formatUnits}
              label="Units sold"
              numberTestId={
                hasActivity ? "items-period-units-number" : undefined
              }
              testId={hasActivity ? "items-period-units-sold" : undefined}
              value={totalUnitsSold ?? 0}
            />
            <Metric
              formatValue={formatUnits}
              label="Transactions"
              numberTestId={
                hasActivity ? "items-period-transactions-number" : undefined
              }
              testId={hasActivity ? "items-period-transactions" : undefined}
              value={totalTransactions ?? 0}
            />
          </div>
          <ReportFreshness delayedDataLabel="Item data" updatedAt={updatedAt} />
        </div>
      )}
    </section>
  );
}

function MetricCard({
  formatValue,
  label,
  link,
  testId,
  numberTestId,
  value,
}: {
  formatValue: (value: number) => string;
  label: string;
  link?: ComponentProps<typeof OperationsSummaryMetric>["link"];
  testId?: string;
  numberTestId?: string;
  value: number;
}) {
  return (
    <div data-testid={testId}>
      <OperationsSummaryMetric
        label={label}
        link={link}
        value={
          <FlipNumber
            formatValue={formatValue}
            testId={numberTestId}
            transitionFromZero="fade"
            value={value}
          />
        }
      />
    </div>
  );
}

function Metric({
  formatValue,
  label,
  testId,
  numberTestId,
  value,
}: {
  formatValue: (value: number) => string;
  label: string;
  testId?: string;
  numberTestId?: string;
  value: number;
}) {
  return (
    <div data-testid={testId}>
      <p className="text-xs font-medium leading-5 text-muted-foreground">
        {label}
      </p>
      <p className="font-numeric text-2xl font-semibold leading-none tabular-nums text-foreground">
        <FlipNumber
          formatValue={formatValue}
          testId={numberTestId}
          transitionFromZero="fade"
          value={value}
        />
      </p>
    </div>
  );
}
