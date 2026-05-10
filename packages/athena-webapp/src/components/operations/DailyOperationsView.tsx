import { useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import {
  ArrowUpRight,
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  Clock3,
} from "lucide-react";

import { useProtectedAdminPageState } from "@/hooks/useProtectedAdminPageState";
import { getOrigin } from "@/lib/navigationUtils";
import { formatStoredAmount } from "@/lib/pos/displayAmounts";
import { cn } from "@/lib/utils";
import { api } from "~/convex/_generated/api";
import type { Id } from "~/convex/_generated/dataModel";
import { currencyFormatter } from "~/shared/currencyFormatter";
import View from "../View";
import { FadeIn } from "../common/FadeIn";
import {
  PageLevelHeader,
  PageWorkspace,
  PageWorkspaceGrid,
  PageWorkspaceMain,
  PageWorkspaceRail,
} from "../common/PageLevelHeader";
import { EmptyState } from "../states/empty/empty-state";
import { NoPermissionView } from "../states/no-permission/NoPermissionView";
import { ProtectedAdminSignInView } from "../states/signed-out/ProtectedAdminSignInView";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Calendar } from "../ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "../ui/sheet";
import { OperationsSummaryMetric } from "./OperationsSummaryMetric";

type DailyOperationsApi = {
  getDailyOperationsSnapshot?: unknown;
};

const useExpectedDailyOperationsQuery = useQuery as unknown as (
  query: unknown,
  args: unknown,
) => unknown;

export type DailyOperationsLifecycleStatus =
  | "not_opened"
  | "operating"
  | "close_blocked"
  | "ready_to_close"
  | "closed";

export type DailyOperationsLaneStatus =
  | "blocked"
  | "needs_attention"
  | "ready"
  | "closed"
  | "unknown";

export type DailyOperationsSnapshot = {
  attentionItems: Array<{
    id: string;
    label: string;
    message: string;
    owner: "daily_opening" | "daily_close" | "operations_queue";
    params?: Record<string, string>;
    search?: Record<string, string>;
    severity: "critical" | "warning" | "info";
    source: {
      id: string;
      label?: string;
      type: string;
    };
    to?: string;
  }>;
  closeSummary: {
    carriedOverCashTotal: number;
    carriedOverRegisterCount: number;
    currentDayCashTotal: number;
    currentDayCashTransactionCount: number;
    expenseTotal: number;
    expenseTransactionCount: number;
    netCashVariance: number;
    registerVarianceCount: number;
    salesTotal: number;
    transactionCount: number;
  };
  currency: string;
  endAt?: number;
  lanes: Array<{
    count: number;
    countLabel?: string;
    description: string;
    key: string;
    label: string;
    status: DailyOperationsLaneStatus;
    to: string;
  }>;
  lifecycle: {
    description: string;
    label: string;
    status: DailyOperationsLifecycleStatus;
  };
  operatingDate: string;
  primaryAction: {
    label: string;
    to: string;
  };
  startAt?: number;
  storeId: Id<"store">;
  timeline: Array<{
    createdAt: number;
    id: string;
    message: string;
    subject: {
      id: string;
      label?: string;
      type: string;
    };
    type: string;
  }>;
  weekMetrics: Array<{
    currentDayCashTotal: number;
    currentDayCashTransactionCount: number;
    expenseTotal: number;
    expenseTransactionCount: number;
    isClosed: boolean;
    isSelected: boolean;
    operatingDate: string;
    salesTotal: number;
    transactionCount: number;
  }>;
};

type DailyOperationsViewContentProps = {
  currency: string;
  hasFullAdminAccess: boolean;
  isAuthenticated: boolean;
  isLoadingAccess: boolean;
  isLoadingSnapshot: boolean;
  onOperatingDateChange?: (date: Date) => void;
  orgUrlSlug: string;
  snapshot?: DailyOperationsSnapshot;
  storeUrlSlug: string;
};

const TIMELINE_PREVIEW_LIMIT = 5;

function getDailyOperationsApi(): DailyOperationsApi {
  return (
    (
      api.operations as typeof api.operations & {
        dailyOperations?: DailyOperationsApi;
      }
    ).dailyOperations ?? {}
  );
}

function getLocalOperatingDate(date = new Date()) {
  const localDate = new Date(
    date.getTime() - date.getTimezoneOffset() * 60_000,
  );

  return localDate.toISOString().slice(0, 10);
}

function getLocalOperatingDateRange(date = new Date()) {
  const localStart = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  );
  const localEnd = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate() + 1,
  );

  return {
    endAt: localEnd.getTime(),
    operatingDate: getLocalOperatingDate(date),
    startAt: localStart.getTime(),
  };
}

function getLocalDateFromOperatingDate(operatingDate: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(operatingDate);

  if (!match) return undefined;

  const [, year, month, day] = match;
  const parsed = new Date(Number(year), Number(month) - 1, Number(day));

  if (
    parsed.getFullYear() !== Number(year) ||
    parsed.getMonth() !== Number(month) - 1 ||
    parsed.getDate() !== Number(day)
  ) {
    return undefined;
  }

  return parsed;
}

function shiftLocalOperatingDate(operatingDate: string, offsetDays: number) {
  const parsed = getLocalDateFromOperatingDate(operatingDate);

  if (!parsed) return operatingDate;

  parsed.setDate(parsed.getDate() + offsetDays);
  return getLocalOperatingDate(parsed);
}

function getSundayWeekStartOperatingDate(operatingDate: string) {
  const parsed = getLocalDateFromOperatingDate(operatingDate);

  if (!parsed) return operatingDate;

  parsed.setDate(parsed.getDate() - parsed.getDay());
  return getLocalOperatingDate(parsed);
}

function getSaturdayWeekEndOperatingDate(operatingDate: string) {
  return shiftLocalOperatingDate(getSundayWeekStartOperatingDate(operatingDate), 6);
}

function getLocalOperatingDateRangeFromSearch(operatingDate?: unknown) {
  if (typeof operatingDate === "string") {
    const localDate = getLocalDateFromOperatingDate(operatingDate);

    if (localDate) {
      return getLocalOperatingDateRange(localDate);
    }
  }

  return getLocalOperatingDateRange();
}

function formatOperatingDate(operatingDate?: string | null) {
  if (!operatingDate) return "Not available";

  const parsed = new Date(`${operatingDate}T00:00:00`);

  if (Number.isNaN(parsed.getTime())) {
    return operatingDate;
  }

  return parsed.toLocaleDateString([], {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function formatOperatingDateWithWeekday(operatingDate?: string | null) {
  if (!operatingDate) return "Not available";

  const parsed = new Date(`${operatingDate}T00:00:00`);

  if (Number.isNaN(parsed.getTime())) {
    return operatingDate;
  }

  return parsed.toLocaleDateString([], {
    day: "numeric",
    month: "long",
    weekday: "long",
    year: "numeric",
  });
}

function buildDailyCloseSearch(operatingDate: string) {
  return {
    ...(operatingDate !== getLocalOperatingDate() ? { operatingDate } : {}),
  };
}

function buildDailyOperationsSearch({
  operatingDate,
  weekEndOperatingDate,
}: {
  operatingDate: string;
  weekEndOperatingDate?: string;
}) {
  const currentOperatingDate = getLocalOperatingDate();
  const search = {
    ...(operatingDate !== currentOperatingDate ? { operatingDate } : {}),
    ...(weekEndOperatingDate && weekEndOperatingDate !== currentOperatingDate
      ? { weekEndOperatingDate }
      : {}),
  };

  return Object.keys(search).length > 0 ? search : undefined;
}

function buildOperationsTransactionSearch({
  operatingDate,
  paymentMethod,
}: {
  operatingDate: string;
  paymentMethod?: string;
}) {
  return {
    o: getOrigin(),
    ...(operatingDate !== getLocalOperatingDate() ? { operatingDate } : {}),
    ...(paymentMethod ? { paymentMethod } : {}),
  };
}

function getDailyOperationsMetricLabels(operatingDate: string) {
  const isCurrentOperatingDate = operatingDate === getLocalOperatingDate();

  return {
    cash: isCurrentOperatingDate ? "Today's cash" : "Cash",
    netSales: isCurrentOperatingDate ? "Today's net sales" : "Net sales",
  };
}

function isHistoricalOperatingDate(operatingDate: string) {
  return operatingDate !== getLocalOperatingDate();
}

function getWeekEndOperatingDateFromSearch(weekEndOperatingDate?: unknown) {
  if (
    typeof weekEndOperatingDate === "string" &&
    getLocalDateFromOperatingDate(weekEndOperatingDate)
  ) {
    return getSaturdayWeekEndOperatingDate(weekEndOperatingDate);
  }

  return getSaturdayWeekEndOperatingDate(getLocalOperatingDate());
}

function shouldShowPrimaryAction(snapshot: DailyOperationsSnapshot) {
  return !isHistoricalOperatingDate(snapshot.operatingDate);
}

function getWorkflowSearch(to: string, operatingDate: string) {
  const search = {
    o: getOrigin(),
    ...(to.includes("/operations/daily-close")
      ? buildDailyCloseSearch(operatingDate)
      : {}),
  };

  return Object.keys(search).length > 0 ? search : undefined;
}

function formatEventTime(timestamp: number) {
  return new Intl.DateTimeFormat([], {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

function formatTimelineMessage(message: string) {
  return message.replace(
    /\b(\d{4})-(\d{2})-(\d{2})\b/g,
    (value, year, month, day) => {
      const parsed = new Date(
        Number(year),
        Number(month) - 1,
        Number(day),
      );

      if (Number.isNaN(parsed.getTime())) {
        return value;
      }

      return parsed.toLocaleDateString([], {
        day: "numeric",
        month: "long",
        year: "numeric",
      });
    },
  );
}

function formatWeekdayLabel(operatingDate: string) {
  const parsed = getLocalDateFromOperatingDate(operatingDate);

  if (!parsed) return operatingDate;

  return parsed.toLocaleDateString([], { weekday: "short" });
}

function formatWeekdayDate(operatingDate: string) {
  const parsed = getLocalDateFromOperatingDate(operatingDate);

  if (!parsed) return operatingDate;

  return parsed.toLocaleDateString([], { day: "numeric", month: "short" });
}

function formatEntityCount(
  value: number,
  singular: string,
  plural = `${singular}s`,
) {
  if (value === 0) return `No ${plural}`;
  if (value === 1) return `1 ${singular}`;
  return `${value} ${plural}`;
}

function formatTodayCashTransactionCount(value: number) {
  if (value === 0) return "No cash transactions";
  if (value === 1) return "1 cash transaction";
  return `${value} cash transactions`;
}

function formatCarriedOverRegisterCount(value: number) {
  if (value === 0) return "No registers from prior days";
  if (value === 1) return "1 register from a prior day";
  return `${value} registers from prior days`;
}

function formatRegisterVarianceCount(value: number) {
  if (value === 0) return "No register variances";
  if (value === 1) return "1 register variance";
  return `${value} register variances`;
}

function formatMoney(currency: string, amount: number) {
  return formatStoredAmount(currencyFormatter(currency), amount);
}

function statusClassName(status: DailyOperationsLaneStatus) {
  if (status === "blocked") return "border-danger/30 bg-danger/10 text-danger";
  if (status === "needs_attention") {
    return "border-warning/40 bg-warning/10 text-warning-foreground";
  }
  if (status === "closed" || status === "ready") {
    return "border-success/30 bg-success/10 text-success";
  }

  return "border-border bg-background text-muted-foreground";
}

function statusLabel(status: DailyOperationsLaneStatus) {
  if (status === "needs_attention") return "Needs attention";
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function buildParams(
  orgUrlSlug: string,
  storeUrlSlug: string,
  params?: Record<string, string>,
) {
  return {
    ...(params ?? {}),
    orgUrlSlug,
    storeUrlSlug,
  };
}

function LoadingWorkspace() {
  return (
    <div className="grid gap-layout-lg lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="space-y-layout-md">
        <div className="h-28 animate-pulse rounded-lg bg-surface" />
        <div className="grid gap-layout-sm md:grid-cols-2">
          <div className="h-32 animate-pulse rounded-lg bg-surface" />
          <div className="h-32 animate-pulse rounded-lg bg-surface" />
        </div>
      </div>
      <div className="h-64 animate-pulse rounded-lg bg-surface" />
    </div>
  );
}

function TimelineEventItem({
  event,
}: {
  event: DailyOperationsSnapshot["timeline"][number];
}) {
  return (
    <article className="border-l border-border py-layout-xs pl-layout-md">
      <p className="text-xs text-muted-foreground">
        {formatEventTime(event.createdAt)}
      </p>
      <p className="mt-1 text-sm text-foreground">
        {formatTimelineMessage(event.message)}
      </p>
    </article>
  );
}

function LaneCard({
  lane,
  operatingDate,
  orgUrlSlug,
  storeUrlSlug,
}: {
  lane: DailyOperationsSnapshot["lanes"][number];
  operatingDate: string;
  orgUrlSlug: string;
  storeUrlSlug: string;
}) {
  return (
    <article className="rounded-md border border-border/70 bg-background/60 px-layout-md py-layout-sm transition-colors hover:bg-background">
      <div className="flex items-start justify-between gap-layout-sm">
        <div className="min-w-0">
          <h3 className="text-sm font-medium text-foreground">{lane.label}</h3>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            {lane.description}
          </p>
        </div>
        <Badge
          className={cn("shrink-0 border", statusClassName(lane.status))}
          size="sm"
        >
          {statusLabel(lane.status)}
        </Badge>
      </div>
      <div className="mt-layout-sm flex items-center justify-between">
        <span className="font-numeric text-lg tabular-nums text-foreground">
          {lane.countLabel ?? lane.count}
        </span>
        <Button asChild className="h-8 px-2 text-xs" size="sm" variant="ghost">
          <Link
            aria-label={`Open ${lane.label}`}
            params={buildParams(orgUrlSlug, storeUrlSlug)}
            search={getWorkflowSearch(lane.to, operatingDate) as never}
            to={lane.to}
          >
            Open
            <ArrowUpRight aria-hidden="true" className="h-3.5 w-3.5" />
          </Link>
        </Button>
      </div>
    </article>
  );
}

function HistoricalWorkflowPanel({
  orgUrlSlug,
  snapshot,
  storeUrlSlug,
}: {
  orgUrlSlug: string;
  snapshot: DailyOperationsSnapshot;
  storeUrlSlug: string;
}) {
  const isClosed = snapshot.lifecycle.status === "closed";

  return (
    <section className="space-y-layout-md">
      <h3 className="text-base font-medium text-foreground">
        {isClosed ? "Closed store-day record" : "Historical store-day view"}
      </h3>
      <div className="rounded-lg border border-border bg-surface-raised p-layout-md shadow-surface">
        {isClosed ? (
          <Button asChild size="sm" variant="outline">
            <Link
              params={buildParams(orgUrlSlug, storeUrlSlug)}
              search={
                getWorkflowSearch(
                  "/$orgUrlSlug/store/$storeUrlSlug/operations/daily-close",
                  snapshot.operatingDate,
                ) as never
              }
              to="/$orgUrlSlug/store/$storeUrlSlug/operations/daily-close"
            >
              Review End-of-Day Review
              <ArrowUpRight aria-hidden="true" className="h-4 w-4" />
            </Link>
          </Button>
        ) : (
          <>
            <p className="text-sm leading-6 text-foreground">
              This historical operating date is view-only. Workflow actions are
              available only on the current operating date.
            </p>
            <p className="mt-layout-xs text-sm leading-6 text-muted-foreground">
              Metrics and timeline remain available for this historical day.
            </p>
          </>
        )}
      </div>
    </section>
  );
}

function OperatingDatePicker({
  disabled = false,
  latestSelectableDate: latestSelectableDateProp,
  operatingDate,
  onChange,
}: {
  disabled?: boolean;
  latestSelectableDate?: Date;
  operatingDate: string;
  onChange?: (date: Date) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const selectedDate = getLocalDateFromOperatingDate(operatingDate);
  const latestSelectableDate = useMemo(() => {
    if (latestSelectableDateProp) return latestSelectableDateProp;

    const today = new Date();

    return new Date(today.getFullYear(), today.getMonth(), today.getDate());
  }, [latestSelectableDateProp]);

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button
          aria-label={`Change operating date, currently ${formatOperatingDateWithWeekday(
            operatingDate,
          )}`}
          className="h-auto justify-start rounded-lg px-layout-md py-layout-sm text-sm font-normal text-muted-foreground shadow-surface"
          disabled={disabled || !onChange}
          variant="outline"
        >
          <CalendarIcon className="mr-2 h-4 w-4 shrink-0" />
          Operating date{" "}
          <span className="font-medium text-foreground">
            {formatOperatingDateWithWeekday(operatingDate)}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-auto p-0">
        <Calendar
          disabled={{ after: latestSelectableDate }}
          mode="single"
          onSelect={(date) => {
            if (!date) return;

            onChange?.(date);
            setIsOpen(false);
          }}
          selected={selectedDate}
        />
      </PopoverContent>
    </Popover>
  );
}

function WeekMetricsStrip({
  currency,
  metrics,
  orgUrlSlug,
  storeUrlSlug,
}: {
  currency: string;
  metrics: DailyOperationsSnapshot["weekMetrics"];
  orgUrlSlug: string;
  storeUrlSlug: string;
}) {
  if (metrics.length === 0) return null;

  const currentOperatingDate = getLocalOperatingDate();
  const weekEndOperatingDate = metrics[metrics.length - 1].operatingDate;
  const previousWeekEndOperatingDate = shiftLocalOperatingDate(
    weekEndOperatingDate,
    -7,
  );
  const previousWeekStartOperatingDate = getSundayWeekStartOperatingDate(
    previousWeekEndOperatingDate,
  );
  const nextWeekEndOperatingDate = shiftLocalOperatingDate(
    weekEndOperatingDate,
    7,
  );
  const nextWeekStartOperatingDate =
    getSundayWeekStartOperatingDate(nextWeekEndOperatingDate);
  const canMoveNext = nextWeekStartOperatingDate <= getLocalOperatingDate();
  const weekSalesTotal = metrics.reduce(
    (total, metric) => total + metric.salesTotal,
    0,
  );

  return (
    <section className="space-y-layout-sm">
      <div className="flex flex-col gap-layout-xs sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h3 className="text-base font-medium text-foreground">
            Week at a glance
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Seven days ending {formatOperatingDate(weekEndOperatingDate)}.
          </p>
        </div>
        <div className="flex items-center gap-layout-sm">
          <p className="flex items-baseline gap-2 text-sm text-muted-foreground">
            <span>Week sales</span>
            <span className="font-numeric text-base font-semibold tabular-nums text-foreground">
              {formatMoney(currency, weekSalesTotal)}
            </span>
          </p>
          <div className="flex items-center gap-1">
            <Button
              asChild
              aria-label={`Previous week, seven days ending ${formatOperatingDate(
                previousWeekEndOperatingDate,
              )}`}
              className="h-8 w-8"
              size="icon"
              variant="outline"
            >
              <Link
                params={buildParams(orgUrlSlug, storeUrlSlug)}
                search={buildDailyOperationsSearch({
                  operatingDate: previousWeekStartOperatingDate,
                  weekEndOperatingDate: previousWeekEndOperatingDate,
                })}
                to="/$orgUrlSlug/store/$storeUrlSlug/operations"
              >
                <ChevronLeft aria-hidden="true" className="h-4 w-4" />
              </Link>
            </Button>
            {canMoveNext ? (
              <Button
                asChild
                aria-label={`Next week, seven days ending ${formatOperatingDate(
                  nextWeekEndOperatingDate,
                )}`}
                className="h-8 w-8"
                size="icon"
                variant="outline"
              >
                <Link
                  params={buildParams(orgUrlSlug, storeUrlSlug)}
                  search={buildDailyOperationsSearch({
                    operatingDate: nextWeekStartOperatingDate,
                    weekEndOperatingDate: nextWeekEndOperatingDate,
                  })}
                  to="/$orgUrlSlug/store/$storeUrlSlug/operations"
                >
                  <ChevronRight aria-hidden="true" className="h-4 w-4" />
                </Link>
              </Button>
            ) : (
              <Button
                aria-label="Next operating date unavailable"
                className="h-8 w-8"
                disabled
                size="icon"
                type="button"
                variant="outline"
              >
                <ChevronRight aria-hidden="true" className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </div>
      <div className="overflow-x-auto rounded-lg border border-border bg-surface-raised p-layout-sm shadow-surface">
        <div className="grid min-w-[42rem] grid-cols-7 gap-layout-xs">
          {metrics.map((metric) => {
            const isFutureDate = metric.operatingDate > currentOperatingDate;
            const cardClassName = cn(
              "rounded-md border px-layout-sm py-layout-sm text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              metric.isSelected
                ? "border-primary/40 bg-background text-foreground"
                : "border-transparent text-muted-foreground",
              isFutureDate
                ? "cursor-not-allowed opacity-60"
                : "hover:bg-background",
            );
            const content = (
              <>
                <div className="flex items-center justify-between gap-layout-xs">
                  <span className="text-xs font-medium uppercase tracking-wide">
                    {formatWeekdayLabel(metric.operatingDate)}
                  </span>
                  {metric.isClosed ? (
                    <span className="rounded-full bg-success/10 px-1.5 py-0.5 text-[10px] font-medium text-success">
                      Closed
                    </span>
                  ) : null}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {formatWeekdayDate(metric.operatingDate)}
                </p>
                <p className="mt-layout-sm font-numeric text-lg tabular-nums text-foreground">
                  {formatMoney(currency, metric.salesTotal)}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {formatEntityCount(metric.transactionCount, "transaction")}
                </p>
              </>
            );

            if (isFutureDate) {
              return (
                <div
                  aria-disabled="true"
                  aria-label={`${formatOperatingDate(metric.operatingDate)} operations unavailable`}
                  className={cardClassName}
                  key={metric.operatingDate}
                >
                  {content}
                </div>
              );
            }

            return (
              <Link
                aria-current={metric.isSelected ? "date" : undefined}
                aria-label={`View ${formatOperatingDate(metric.operatingDate)} operations`}
                className={cardClassName}
                key={metric.operatingDate}
                params={buildParams(orgUrlSlug, storeUrlSlug)}
                search={buildDailyOperationsSearch({
                  operatingDate: metric.operatingDate,
                  weekEndOperatingDate,
                })}
                to="/$orgUrlSlug/store/$storeUrlSlug/operations"
              >
                {content}
              </Link>
            );
          })}
        </div>
      </div>
    </section>
  );
}

export function DailyOperationsViewContent({
  currency,
  hasFullAdminAccess,
  isAuthenticated,
  isLoadingAccess,
  isLoadingSnapshot,
  onOperatingDateChange,
  orgUrlSlug,
  snapshot,
  storeUrlSlug,
}: DailyOperationsViewContentProps) {
  const [isTimelineSheetOpen, setIsTimelineSheetOpen] = useState(false);

  if (isLoadingAccess) {
    return (
      <View hideBorder hideHeaderBottomBorder scrollMode="page">
        <FadeIn className="container mx-auto py-layout-xl">
          <LoadingWorkspace />
        </FadeIn>
      </View>
    );
  }

  if (!isAuthenticated) {
    return (
      <ProtectedAdminSignInView description="Your Athena session needs to reconnect before Daily Operations can load protected store-day data." />
    );
  }

  if (!hasFullAdminAccess) {
    return <NoPermissionView />;
  }

  const previewTimeline = snapshot?.timeline.slice(0, TIMELINE_PREVIEW_LIMIT);
  const hasMoreTimelineEvents =
    (snapshot?.timeline.length ?? 0) > TIMELINE_PREVIEW_LIMIT;
  const metricLabels = snapshot
    ? getDailyOperationsMetricLabels(snapshot.operatingDate)
    : undefined;
  const showPrimaryAction = snapshot ? shouldShowPrimaryAction(snapshot) : false;
  const isHistoricalDate = snapshot
    ? isHistoricalOperatingDate(snapshot.operatingDate)
    : false;

  return (
    <View hideBorder hideHeaderBottomBorder scrollMode="page">
      <FadeIn className="container mx-auto py-layout-xl">
        <PageWorkspace>
          <PageLevelHeader
            eyebrow="Store Ops"
            title="Daily Operations"
            description="Review the store day, see what needs attention, and move into the workflow that owns the next action."
          />

          {isLoadingSnapshot || !snapshot ? (
            <LoadingWorkspace />
          ) : (
            <PageWorkspace>
              <section className="space-y-layout-2xl">
                <div className="flex flex-col gap-layout-sm lg:flex-row lg:items-center lg:justify-end">
                  <div className="flex flex-col gap-layout-sm sm:flex-row sm:items-center">
                    <OperatingDatePicker
                      operatingDate={snapshot.operatingDate}
                      onChange={onOperatingDateChange}
                    />
                    {showPrimaryAction ? (
                      <Button
                        asChild
                        className="w-full sm:w-auto"
                        variant="outline"
                      >
                        <Link
                          params={buildParams(orgUrlSlug, storeUrlSlug)}
                          search={
                            getWorkflowSearch(
                              snapshot.primaryAction.to,
                              snapshot.operatingDate,
                            ) as never
                          }
                          to={snapshot.primaryAction.to}
                        >
                          {snapshot.primaryAction.label}
                          <ArrowUpRight
                            aria-hidden="true"
                            className="ml-2 h-4 w-4"
                          />
                        </Link>
                      </Button>
                    ) : null}
                  </div>
                </div>

                <div className="grid gap-layout-sm md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5">
                  <OperationsSummaryMetric
                    helper={formatEntityCount(
                      snapshot.closeSummary.transactionCount,
                      "transaction",
                    )}
                    label={metricLabels?.netSales ?? "Net sales"}
                    link={{
                      ariaLabel: "Open transactions",
                      orgUrlSlug,
                      search: buildOperationsTransactionSearch({
                        operatingDate: snapshot.operatingDate,
                      }),
                      storeUrlSlug,
                      to: "/$orgUrlSlug/store/$storeUrlSlug/pos/transactions",
                    }}
                    value={formatMoney(
                      snapshot.currency ?? currency,
                      snapshot.closeSummary.salesTotal,
                    )}
                  />
                  <OperationsSummaryMetric
                    helper={formatTodayCashTransactionCount(
                      snapshot.closeSummary.currentDayCashTransactionCount,
                    )}
                    label={metricLabels?.cash ?? "Cash"}
                    link={{
                      ariaLabel: "Open cash transactions",
                      orgUrlSlug,
                      search: buildOperationsTransactionSearch({
                        operatingDate: snapshot.operatingDate,
                        paymentMethod: "cash",
                      }),
                      storeUrlSlug,
                      to: "/$orgUrlSlug/store/$storeUrlSlug/pos/transactions",
                    }}
                    value={formatMoney(
                      snapshot.currency ?? currency,
                      snapshot.closeSummary.currentDayCashTotal,
                    )}
                  />
                  <OperationsSummaryMetric
                    helper={formatCarriedOverRegisterCount(
                      snapshot.closeSummary.carriedOverRegisterCount,
                    )}
                    label="Carried-over cash"
                    value={formatMoney(
                      snapshot.currency ?? currency,
                      snapshot.closeSummary.carriedOverCashTotal,
                    )}
                  />
                  <OperationsSummaryMetric
                    helper={formatEntityCount(
                      snapshot.closeSummary.expenseTransactionCount,
                      "expense transaction",
                    )}
                    label="Expenses"
                    value={formatMoney(
                      snapshot.currency ?? currency,
                      snapshot.closeSummary.expenseTotal,
                    )}
                  />
                  <OperationsSummaryMetric
                    helper={formatRegisterVarianceCount(
                      snapshot.closeSummary.registerVarianceCount,
                    )}
                    label="Variance"
                    value={formatMoney(
                      snapshot.currency ?? currency,
                      snapshot.closeSummary.netCashVariance,
                    )}
                  />
                </div>

                <WeekMetricsStrip
                  currency={snapshot.currency ?? currency}
                  metrics={snapshot.weekMetrics}
                  orgUrlSlug={orgUrlSlug}
                  storeUrlSlug={storeUrlSlug}
                />
              </section>

              <PageWorkspaceGrid>
                <PageWorkspaceMain>
                  {isHistoricalDate ? (
                    <HistoricalWorkflowPanel
                      orgUrlSlug={orgUrlSlug}
                      snapshot={snapshot}
                      storeUrlSlug={storeUrlSlug}
                    />
                  ) : (
                    <section className="space-y-layout-lg">
                      <div>
                        <h3 className="text-base font-medium text-foreground">
                          Workflow status
                        </h3>
                      </div>
                      <div className="grid gap-layout-xs rounded-lg border border-border bg-surface-raised p-layout-sm shadow-surface md:grid-cols-2 xl:grid-cols-3">
                        {snapshot.lanes.map((lane) => (
                          <LaneCard
                            key={lane.key}
                            lane={lane}
                            operatingDate={snapshot.operatingDate}
                            orgUrlSlug={orgUrlSlug}
                            storeUrlSlug={storeUrlSlug}
                          />
                        ))}
                      </div>
                    </section>
                  )}
                </PageWorkspaceMain>

                <PageWorkspaceRail>
                  <section
                    aria-label="Store-day timeline"
                    className="rounded-lg border border-border bg-surface p-layout-md shadow-surface"
                  >
                    <h3 className="flex items-center gap-layout-xs font-medium text-foreground">
                      <Clock3 aria-hidden="true" className="h-4 w-4" />
                      Store-day timeline
                    </h3>
                    <div className="mt-layout-md space-y-layout-md">
                      {snapshot.timeline.length === 0 ? (
                        <EmptyState
                          description="No operational events have been recorded for this store day."
                          title="No timeline yet"
                        />
                      ) : (
                        previewTimeline?.map((event) => (
                          <TimelineEventItem event={event} key={event.id} />
                        ))
                      )}
                    </div>
                    {hasMoreTimelineEvents ? (
                      <Button
                        className="mt-layout-md w-full"
                        onClick={() => setIsTimelineSheetOpen(true)}
                        size="sm"
                        type="button"
                        variant="outline"
                      >
                        Show more
                      </Button>
                    ) : null}
                  </section>
                </PageWorkspaceRail>
              </PageWorkspaceGrid>
              <Sheet
                open={isTimelineSheetOpen}
                onOpenChange={setIsTimelineSheetOpen}
              >
                <SheetContent
                  className="flex w-[min(100vw,30rem)] max-w-[calc(100vw-1rem)] flex-col overflow-hidden border-border bg-surface-raised p-0 shadow-overlay sm:max-w-md"
                  side="right"
                >
                  <SheetHeader className="border-b border-border px-layout-lg py-layout-md">
                    <SheetTitle>Store-day timeline</SheetTitle>
                    <SheetDescription>
                      All recorded events for{" "}
                      {formatOperatingDateWithWeekday(snapshot.operatingDate)}.
                    </SheetDescription>
                  </SheetHeader>
                  <div className="min-h-0 flex-1 overflow-y-auto px-layout-lg py-layout-md">
                    <div className="space-y-layout-md">
                      {snapshot.timeline.map((event) => (
                        <TimelineEventItem event={event} key={event.id} />
                      ))}
                    </div>
                  </div>
                </SheetContent>
              </Sheet>
            </PageWorkspace>
          )}
        </PageWorkspace>
      </FadeIn>
    </View>
  );
}

function DailyOperationsApiPendingView() {
  return (
    <View hideBorder hideHeaderBottomBorder scrollMode="page">
      <FadeIn className="container mx-auto py-layout-xl">
        <PageWorkspace>
          <PageLevelHeader
            eyebrow="Store Ops"
            title="Daily Operations"
            description="Daily Operations is waiting for the current store-day view."
          />
          <EmptyState
            description="Refresh this page after the operations workspace is ready."
            title="Daily Operations unavailable"
          />
        </PageWorkspace>
      </FadeIn>
    </View>
  );
}

function DailyOperationsConnectedView({
  getDailyOperationsSnapshot,
}: {
  getDailyOperationsSnapshot: unknown;
}) {
  const {
    activeStore,
    canAccessProtectedSurface,
    canQueryProtectedData,
    hasFullAdminAccess,
    isAuthenticated,
    isLoadingAccess,
  } = useProtectedAdminPageState({ surface: "store_day" });
  const canAccessSurface = canAccessProtectedSurface ?? hasFullAdminAccess;
  const params = useParams({ strict: false }) as
    | {
        orgUrlSlug?: string;
        storeUrlSlug?: string;
      }
    | undefined;
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as {
    operatingDate?: unknown;
    weekEndOperatingDate?: unknown;
  };
  const operatingDateRange = useMemo(
    () => getLocalOperatingDateRangeFromSearch(search.operatingDate),
    [search.operatingDate],
  );
  const weekEndOperatingDate = useMemo(
    () => getWeekEndOperatingDateFromSearch(search.weekEndOperatingDate),
    [search.weekEndOperatingDate],
  );
  const snapshot = useExpectedDailyOperationsQuery(
    getDailyOperationsSnapshot,
    canQueryProtectedData
      ? {
          ...operatingDateRange,
          storeId: activeStore!._id,
          weekEndOperatingDate,
        }
      : "skip",
  ) as DailyOperationsSnapshot | undefined;

  const handleOperatingDateChange = (date: Date) => {
    const nextRange = getLocalOperatingDateRange(date);
    const nextWeekEndOperatingDate = getSaturdayWeekEndOperatingDate(
      nextRange.operatingDate,
    );

    void navigate({
      search: ((current: Record<string, unknown>) => ({
        ...current,
        operatingDate: nextRange.operatingDate,
        weekEndOperatingDate: nextWeekEndOperatingDate,
      })) as never,
    });
  };

  return (
    <DailyOperationsViewContent
      currency={activeStore?.currency ?? "GHS"}
      hasFullAdminAccess={canAccessSurface}
      isAuthenticated={isAuthenticated}
      isLoadingAccess={isLoadingAccess}
      isLoadingSnapshot={snapshot === undefined}
      onOperatingDateChange={handleOperatingDateChange}
      orgUrlSlug={params?.orgUrlSlug ?? ""}
      snapshot={snapshot}
      storeUrlSlug={params?.storeUrlSlug ?? ""}
    />
  );
}

export function DailyOperationsView() {
  const dailyOperationsApi = getDailyOperationsApi();

  if (!dailyOperationsApi.getDailyOperationsSnapshot) {
    return <DailyOperationsApiPendingView />;
  }

  return (
    <DailyOperationsConnectedView
      getDailyOperationsSnapshot={dailyOperationsApi.getDailyOperationsSnapshot}
    />
  );
}
