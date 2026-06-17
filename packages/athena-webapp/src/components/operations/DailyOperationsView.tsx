import { useCallback, useMemo, useState } from "react";
import {
  Link,
  useNavigate,
  useParams,
  useSearch,
} from "@tanstack/react-router";
import { useQuery } from "convex/react";
import {
  Activity,
  ArrowUpRight,
  Archive,
  Ban,
  Bot,
  Calendar as CalendarIcon,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Clock3,
  PackageSearch,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { useProtectedAdminPageState } from "@/hooks/useProtectedAdminPageState";
import { getOrigin } from "@/lib/navigationUtils";
import { formatStoredAmount } from "@/lib/pos/displayAmounts";
import { cn } from "@/lib/utils";
import { api } from "~/convex/_generated/api";
import type { Id } from "~/convex/_generated/dataModel";
import { currencyFormatter } from "~/shared/currencyFormatter";
import View from "../View";
import { FadeIn } from "../common/FadeIn";
import { FinancialValue } from "../common/FinancialValue";
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

type OperationsWorkspaceLink = {
  description: string;
  icon: LucideIcon;
  label: string;
  to: string;
};

const SUPPORTING_OPERATIONS_WORKSPACE_LINKS: OperationsWorkspaceLink[] = [
  {
    description: "Review completed close records for prior store days.",
    icon: Archive,
    label: "Close history",
    to: "/$orgUrlSlug/store/$storeUrlSlug/operations/daily-close-history",
  },
  {
    description: "Count stock, record adjustments, and reconcile variance.",
    icon: PackageSearch,
    label: "Stock adjustments",
    to: "/$orgUrlSlug/store/$storeUrlSlug/operations/stock-adjustments",
  },
  {
    description: "Trace SKU movements across sales and stock operations.",
    icon: Activity,
    label: "SKU activity",
    to: "/$orgUrlSlug/store/$storeUrlSlug/operations/sku-activity",
  },
];

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

type DailyOperationsAutomationOutcome =
  | "applied"
  | "prepared"
  | "skipped"
  | "failed"
  | "dry_run"
  | "disabled"
  | "eligible";

type DailyOperationsAutomationStatus = {
  id: string;
  lane: "opening" | "close";
  occurredAt?: number | null;
  outcome: DailyOperationsAutomationOutcome;
  reviewEvidence?: Array<{
    id: string;
    label: string;
    message?: string | null;
    source?: {
      id: string;
      label?: string;
      type: string;
    };
    sourceLink?: {
      params?: Record<string, string>;
      search?: Record<string, string>;
      to?: string;
    };
  }>;
  sourceLink?: {
    params?: Record<string, string>;
    search?: Record<string, string>;
    to?: string;
  };
};

type DailyOperationsReviewEvidence = NonNullable<
  DailyOperationsAutomationStatus["reviewEvidence"]
>[number];

export type DailyOperationsSnapshot = {
  automationStatuses?: DailyOperationsAutomationStatus[];
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
    paymentTotals?: Array<{
      amount: number;
      method: string;
      transactionCount?: number;
    }>;
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
    productLink?: {
      label?: string;
      params?: Record<string, string>;
      search?: Record<string, string>;
      to?: string;
    };
    registerLink?: {
      label?: string;
      params?: Record<string, string>;
      search?: Record<string, string>;
      to?: string;
    };
    transactionLink?: {
      label?: string;
      params?: Record<string, string>;
      search?: Record<string, string>;
      to?: string;
    };
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
    isReopened?: boolean;
    isSelected: boolean;
    operatingDate: string;
    salesTotal: number;
    transactionCount: number;
  }>;
};

type DailyOperationsViewContentProps = {
  currency: string;
  hasFullAdminAccess: boolean;
  hasFinancialDetailsAccess: boolean;
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
  return shiftLocalOperatingDate(
    getSundayWeekStartOperatingDate(operatingDate),
    6,
  );
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

function getOperatingTimezoneOffsetMinutes(operatingDate: string) {
  const localDate = getLocalDateFromOperatingDate(operatingDate);

  return localDate
    ? localDate.getTimezoneOffset()
    : new Date().getTimezoneOffset();
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

function buildOperationsExpenseSearch(operatingDate: string) {
  return {
    o: getOrigin(),
    ...(operatingDate !== getLocalOperatingDate() ? { operatingDate } : {}),
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

function shouldShowHistoricalEodReviewAction(
  snapshot: DailyOperationsSnapshot,
) {
  return (
    snapshot.lifecycle.status === "closed" &&
    isHistoricalOperatingDate(snapshot.operatingDate)
  );
}

function getWorkflowSearch(to: string, operatingDate: string) {
  const search = {
    o: getOrigin(),
    ...(to.endsWith("/operations/daily-close")
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
      const parsed = new Date(Number(year), Number(month) - 1, Number(day));

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

function TimelineMessage({
  event,
  orgUrlSlug,
  storeUrlSlug,
}: {
  event: DailyOperationsSnapshot["timeline"][number];
  orgUrlSlug: string;
  storeUrlSlug: string;
}) {
  const inlineLink =
    event.transactionLink ?? event.registerLink ?? event.productLink;
  const linkLabel = inlineLink?.label?.trim();
  const linkMatch = findTimelineLinkMatch(event.message, linkLabel);

  if (
    !inlineLink?.to ||
    !inlineLink.params ||
    !linkLabel ||
    !linkMatch
  ) {
    return <>{formatTimelineMessage(event.message)}</>;
  }

  const before = event.message.slice(0, linkMatch.index);
  const after = event.message.slice(linkMatch.index + linkMatch.length);

  return (
    <>
      {formatTimelineMessage(before)}
      <Link
        className="inline-flex items-center gap-0.5 font-medium text-link underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        params={{
          ...inlineLink.params,
          orgUrlSlug,
          storeUrlSlug,
        }}
        search={{ o: getOrigin(), ...(inlineLink.search ?? {}) }}
        to={inlineLink.to}
      >
        <span>{linkLabel}</span>
        <ArrowUpRight aria-hidden="true" className="h-3 w-3" />
      </Link>
      {formatTimelineMessage(after)}
    </>
  );
}

function findTimelineLinkMatch(message: string, label: string | undefined) {
  if (!label) return null;

  const exactIndex = message.indexOf(label);
  if (exactIndex >= 0) {
    return { index: exactIndex, length: label.length };
  }

  if (!label.startsWith("#")) return null;

  const plainLabel = label.slice(1);
  const plainIndex = plainLabel ? message.indexOf(plainLabel) : -1;

  if (plainIndex < 0) return null;

  return { index: plainIndex, length: plainLabel.length };
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

function formatPaymentCount(value?: number | null) {
  if (value === undefined || value === null) return "Payment total";
  if (value === 0) return "No payments";
  if (value === 1) return "1 payment";
  return `${value} payments`;
}

function formatPaymentMethodLabel(method: string) {
  return method
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
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

function getOtherPaymentTotals(summary: DailyOperationsSnapshot["closeSummary"]) {
  return (summary.paymentTotals ?? [])
    .filter((paymentTotal) => paymentTotal.method.toLowerCase() !== "cash")
    .sort((left, right) => right.amount - left.amount);
}

function shouldShowExpenseMetric(summary: DailyOperationsSnapshot["closeSummary"]) {
  if (summary.salesTotal <= 0) {
    return true;
  }

  return summary.expenseTransactionCount > 0 || summary.expenseTotal !== 0;
}

function shouldShowVarianceMetric(summary: DailyOperationsSnapshot["closeSummary"]) {
  if (summary.salesTotal <= 0) {
    return true;
  }

  return summary.registerVarianceCount > 0 || summary.netCashVariance !== 0;
}

function formatMoney(currency: string, amount: number) {
  return formatStoredAmount(currencyFormatter(currency), amount);
}

function statusClassName(status: DailyOperationsLaneStatus) {
  if (status === "blocked") return "text-danger";
  if (status === "needs_attention") {
    return "text-warning";
  }
  if (status === "closed" || status === "ready") {
    return "border-success/30 bg-success/10 text-success";
  }

  return "border-border bg-background text-muted-foreground";
}

function SuccessCheckIcon({
  className,
  label,
}: {
  className?: string;
  label: string;
}) {
  return (
    <span
      aria-label={label}
      className={cn(
        "inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-success text-surface",
        className,
      )}
      role="img"
    >
      <Check aria-hidden="true" className="h-3 w-3 stroke-[3]" />
    </span>
  );
}

function LaneStatusIcon({
  className,
  label,
  status,
}: {
  className?: string;
  label: string;
  status: DailyOperationsLaneStatus;
}) {
  const Icon = status === "blocked" ? Ban : CircleAlert;

  return (
    <span
      aria-label={label}
      className={cn(
        "inline-flex h-4 w-4 shrink-0 items-center justify-center",
        statusClassName(status),
        className,
      )}
      role="img"
    >
      <Icon aria-hidden="true" className="h-4 w-4 stroke-[2.5]" />
    </span>
  );
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

function TimelineEventItem({
  event,
  orgUrlSlug,
  storeUrlSlug,
}: {
  event: DailyOperationsSnapshot["timeline"][number];
  orgUrlSlug: string;
  storeUrlSlug: string;
}) {
  return (
    <article className="border-l border-border py-layout-xs pl-layout-md">
      <p className="text-xs text-muted-foreground">
        {formatEventTime(event.createdAt)}
      </p>
      <p className="mt-1 text-sm text-foreground">
        <TimelineMessage
          event={event}
          orgUrlSlug={orgUrlSlug}
          storeUrlSlug={storeUrlSlug}
        />
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
        {["ready", "closed"].includes(lane.status) ? (
          <SuccessCheckIcon className="mt-0.5" label={`${lane.label} ready`} />
        ) : (
          <LaneStatusIcon
            className="mt-0.5"
            label={`${lane.label} ${lane.status === "blocked" ? "blocked" : "needs attention"}`}
            status={lane.status}
          />
        )}
      </div>
      <div className="mt-layout-sm flex items-center justify-end">
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

function isActionableLane(lane: DailyOperationsSnapshot["lanes"][number]) {
  return !["ready", "closed"].includes(lane.status);
}

function WorkflowAllClearPanel() {
  return (
    <div className="rounded-md border border-border/70 bg-background/60 px-layout-md py-layout-sm">
      <div className="flex items-start gap-layout-sm">
        <SuccessCheckIcon className="mt-0.5" label="Workflow clear" />
        <div className="min-w-0">
          <h3 className="text-sm font-medium text-foreground">
            No active workflow blockers
          </h3>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Clear lanes are hidden here. Use the shortcuts below when you need
            to open a supporting workspace.
          </p>
        </div>
      </div>
    </div>
  );
}

function getAutomationLaneLabel(lane: DailyOperationsAutomationStatus["lane"]) {
  return lane === "opening" ? "Opening Handoff" : "EOD Review";
}

function getAutomationStatusMessage(status: DailyOperationsAutomationStatus) {
  const label = getAutomationLaneLabel(status.lane);

  if (
    status.outcome === "applied" &&
    status.lane === "opening" &&
    (status.reviewEvidence?.length ?? 0) > 0
  ) {
    return "Athena started the store day with manager review items.";
  }

  if (status.outcome === "applied" && status.lane === "opening") {
    return "Athena started Opening Handoff.";
  }

  if (status.outcome === "prepared" && status.lane === "close") {
    return "Athena prepared EOD Review for manager review.";
  }

  if (status.outcome === "failed") {
    return `Athena could not finish the ${label} automation check. Open the workflow to review.`;
  }

  if (status.outcome === "dry_run") {
    return `Athena checked ${label} in dry run. No workflow changes were made.`;
  }

  if (status.outcome === "disabled") {
    return `${label} automation is off for this store day.`;
  }

  if (status.outcome === "eligible") {
    return `Athena found ${label} ready for automation. No workflow changes were made.`;
  }

  if (status.outcome === "prepared") {
    return `Athena prepared ${label} for review.`;
  }

  if (status.outcome === "applied") {
    return `Athena updated ${label}.`;
  }

  return `Athena checked ${label}. No change was made.`;
}

function getVisibleAutomationStatuses(snapshot: DailyOperationsSnapshot) {
  const statuses = snapshot.automationStatuses ?? [];

  return statuses.filter((status) => {
    if (
      status.lane === "opening" &&
      snapshot.lifecycle.status !== "not_opened" &&
      status.outcome !== "applied"
    ) {
      return false;
    }

    if (
      status.lane === "close" &&
      snapshot.lifecycle.status === "closed" &&
      !["applied", "prepared"].includes(status.outcome)
    ) {
      return false;
    }

    return true;
  });
}

function AutomationStatusPanel({
  orgUrlSlug,
  snapshot,
  storeUrlSlug,
}: {
  orgUrlSlug: string;
  snapshot: DailyOperationsSnapshot;
  storeUrlSlug: string;
}) {
  const statuses = getVisibleAutomationStatuses(snapshot);

  if (statuses.length === 0) return null;

  return (
    <section className="rounded-lg border border-border bg-surface-raised p-layout-md shadow-surface">
      <h3 className="flex items-center gap-layout-xs text-base font-medium text-foreground">
        <Bot aria-hidden="true" className="h-4 w-4" />
        Athena automation
      </h3>
      <div className="mt-layout-sm space-y-layout-xs">
        {statuses.map((status) => {
          const label = getAutomationLaneLabel(status.lane);
          const link = status.sourceLink;

          return (
            <article
              className="flex flex-col gap-layout-xs rounded-md border border-border/70 bg-background/60 px-layout-md py-layout-sm sm:flex-row sm:items-start sm:justify-between"
              key={status.id}
            >
              <div className="min-w-0">
                <p className="text-sm text-foreground">
                  {getAutomationStatusMessage(status)}
                </p>
                {status.occurredAt ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {formatEventTime(status.occurredAt)}
                  </p>
                ) : null}
              </div>
              {link?.to ? (
                <Button
                  asChild
                  className="h-8 shrink-0 self-start px-2 text-xs"
                  size="sm"
                  variant="ghost"
                >
                  <Link
                    aria-label={`Open ${label} automation source`}
                    params={buildParams(
                      orgUrlSlug,
                      storeUrlSlug,
                      link.params,
                    )}
                    search={
                      {
                        o: getOrigin(),
                        ...(link.search ?? {}),
                      } as never
                    }
                    to={link.to}
                  >
                    Open
                    <ArrowUpRight aria-hidden="true" className="h-3.5 w-3.5" />
                  </Link>
                </Button>
              ) : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}

function AutomationReviewEvidencePanel({
  orgUrlSlug,
  snapshot,
  storeUrlSlug,
}: {
  orgUrlSlug: string;
  snapshot: DailyOperationsSnapshot;
  storeUrlSlug: string;
}) {
  const evidenceItems = (snapshot.automationStatuses ?? []).flatMap((status) =>
    status.lane === "opening" && status.outcome === "applied"
      ? (status.reviewEvidence ?? [])
      : [],
  );

  if (evidenceItems.length === 0) return null;

  return (
    <section className="rounded-lg border border-warning/25 bg-surface-raised p-layout-md shadow-surface">
      <div className="flex flex-col gap-layout-sm sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h3 className="flex items-center gap-layout-xs text-base font-medium text-foreground">
            <CircleAlert aria-hidden="true" className="h-4 w-4 text-warning" />
            Opening review
          </h3>
          <p className="mt-layout-xs text-sm leading-6 text-foreground">
            Store day started. Review the carried-forward items when a manager
            is available.
          </p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            POS stays open while these items remain visible in their owning
            workflows.
          </p>
        </div>
        <Badge
          className="border-warning/30 bg-warning/10 text-warning-foreground shadow-sm"
          variant="outline"
        >
          {evidenceItems.length} to review
        </Badge>
      </div>
      <div className="mt-layout-md divide-y divide-border/70 overflow-hidden rounded-md border border-border/70 bg-background/60">
        {evidenceItems.map((item) => (
          <article
            className="flex flex-col gap-layout-xs px-layout-md py-layout-sm transition-colors hover:bg-surface/80 sm:flex-row sm:items-center sm:justify-between"
            key={item.id}
          >
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">
                {getReviewEvidenceTitle(item)}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {getReviewEvidenceContextLabel(item)}
              </p>
              {getReviewEvidenceDetail(item) ? (
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  {getReviewEvidenceDetail(item)}
                </p>
              ) : null}
            </div>
            {item.sourceLink?.to ? (
              <Button
                asChild
                className="h-8 shrink-0 self-start px-2 text-xs sm:self-center"
                size="sm"
                variant="ghost"
              >
                <Link
                  aria-label={`Open ${item.label} review source`}
                  params={buildParams(
                    orgUrlSlug,
                    storeUrlSlug,
                    item.sourceLink.params,
                  )}
                  search={
                    {
                      o: getOrigin(),
                      ...(item.sourceLink.search ?? {}),
                    } as never
                  }
                  to={item.sourceLink.to}
                >
                  Open
                  <ArrowUpRight aria-hidden="true" className="h-3.5 w-3.5" />
                </Link>
              </Button>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  );
}

const PENDING_CHECKOUT_REVIEW_PREFIX = "Review pending checkout item:";
const DEFAULT_CARRY_FORWARD_DETAIL =
  "This unresolved carry-forward item remains open and must be acknowledged for Opening.";

function getReviewEvidenceTitle(item: DailyOperationsReviewEvidence) {
  if (item.label.startsWith(PENDING_CHECKOUT_REVIEW_PREFIX)) {
    return item.label.slice(PENDING_CHECKOUT_REVIEW_PREFIX.length).trim();
  }

  return item.label;
}

function getReviewEvidenceContextLabel(item: DailyOperationsReviewEvidence) {
  if (item.label.startsWith(PENDING_CHECKOUT_REVIEW_PREFIX)) {
    return "Pending checkout item";
  }

  return item.source?.label ?? "Manager review item";
}

function getReviewEvidenceDetail(item: DailyOperationsReviewEvidence) {
  if (!item.message || item.message === DEFAULT_CARRY_FORWARD_DETAIL) {
    return null;
  }

  return item.message;
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
              Review EOD Review
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

function SupportingWorkspaceLinks({
  operatingDate,
  orgUrlSlug,
  storeUrlSlug,
}: {
  operatingDate: string;
  orgUrlSlug: string;
  storeUrlSlug: string;
}) {
  return (
    <div
      aria-labelledby="supporting-workspaces-heading"
      className="border-t border-border/70 px-layout-md py-layout-md"
    >
      <div className="mt-layout-sm grid gap-layout-xs md:grid-cols-3">
        {SUPPORTING_OPERATIONS_WORKSPACE_LINKS.map((workspace) => {
          const Icon = workspace.icon;

          return (
            <Link
              aria-label={`Open ${workspace.label} workspace`}
              className="group flex min-w-0 items-start gap-layout-sm rounded-md border border-border/70 bg-background/60 px-layout-md py-layout-sm text-left transition-colors hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              key={workspace.label}
              params={buildParams(orgUrlSlug, storeUrlSlug)}
              search={getWorkflowSearch(workspace.to, operatingDate) as never}
              to={workspace.to}
            >
              <span className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border bg-surface text-muted-foreground transition-colors group-hover:text-foreground">
                <Icon aria-hidden="true" className="h-3.5 w-3.5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-foreground">
                  {workspace.label}
                </span>
                <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">
                  {workspace.description}
                </span>
              </span>
              <ArrowUpRight
                aria-hidden="true"
                className="mt-1 h-3.5 w-3.5 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground"
              />
            </Link>
          );
        })}
      </div>
    </div>
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
          className="h-auto w-full min-w-0 justify-start rounded-lg px-layout-md py-layout-sm text-sm font-normal text-muted-foreground shadow-surface sm:w-auto"
          disabled={disabled || !onChange}
          variant="outline"
        >
          <CalendarIcon className="mr-2 h-4 w-4 shrink-0" />
          <span className="shrink-0">Operating date</span>
          <span className="min-w-0 truncate font-medium text-foreground">
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
  hasFinancialDetailsAccess,
  metrics,
  orgUrlSlug,
  storeUrlSlug,
}: {
  currency: string;
  hasFinancialDetailsAccess: boolean;
  metrics: DailyOperationsSnapshot["weekMetrics"];
  orgUrlSlug: string;
  storeUrlSlug: string;
}) {
  const scrollSelectedDayIntoView = useCallback((element: HTMLElement | null) => {
    element?.scrollIntoView({
      behavior: "auto",
      block: "nearest",
      inline: "center",
    });
  }, [metrics]);

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
  const nextWeekStartOperatingDate = getSundayWeekStartOperatingDate(
    nextWeekEndOperatingDate,
  );
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
        <div className="flex flex-col gap-layout-sm sm:flex-row sm:items-center">
          <p className="flex items-baseline justify-between gap-2 text-sm text-muted-foreground sm:justify-start">
            <span>Week sales</span>
            <span className="font-numeric text-base font-semibold tabular-nums text-foreground">
              <FinancialValue canView={hasFinancialDetailsAccess} label="Week sales">
                {formatMoney(currency, weekSalesTotal)}
              </FinancialValue>
            </span>
          </p>
          <div className="flex items-center gap-1 self-start sm:self-auto">
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
        <div className="flex min-w-max snap-x gap-layout-xs md:grid md:min-w-[42rem] md:grid-cols-7">
          {metrics.map((metric) => {
            const isFutureDate = metric.operatingDate > currentOperatingDate;
            const cardClassName = cn(
              "w-[10.5rem] shrink-0 snap-start rounded-md border px-layout-sm py-layout-sm text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:w-auto",
              metric.isSelected
                ? "border-action-workflow-border bg-action-workflow-soft text-foreground ring-1 ring-inset ring-action-workflow-border"
                : "border-transparent text-muted-foreground",
              isFutureDate
                ? "cursor-not-allowed opacity-60"
                : metric.isSelected
                  ? "hover:bg-action-workflow-soft"
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
                  ) : metric.isReopened ? (
                    <span className="rounded-full bg-warning/10 px-1.5 py-0.5 text-[10px] font-medium text-warning">
                      Reopened
                    </span>
                  ) : null}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {formatWeekdayDate(metric.operatingDate)}
                </p>
                <p className="mt-layout-sm font-numeric text-lg tabular-nums text-foreground">
                  {isFutureDate
                    ? "-"
                    : (
                        <FinancialValue
                          canView={hasFinancialDetailsAccess}
                          label={`${formatOperatingDate(metric.operatingDate)} sales`}
                        >
                          {formatMoney(currency, metric.salesTotal)}
                        </FinancialValue>
                      )}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {isFutureDate
                    ? "Upcoming"
                    : formatEntityCount(metric.transactionCount, "transaction")}
                </p>
              </>
            );

            if (isFutureDate) {
              return (
                <div
                  aria-disabled="true"
                  aria-label={`${formatOperatingDate(metric.operatingDate)} operations unavailable`}
                  className={cardClassName}
                  data-week-metric-selected={metric.isSelected ? "true" : undefined}
                  key={metric.operatingDate}
                  ref={metric.isSelected ? scrollSelectedDayIntoView : undefined}
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
                data-week-metric-selected={metric.isSelected ? "true" : undefined}
                key={metric.operatingDate}
                params={buildParams(orgUrlSlug, storeUrlSlug)}
                ref={metric.isSelected ? scrollSelectedDayIntoView : undefined}
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
  hasFinancialDetailsAccess,
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
    return null;
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
  const otherPaymentTotals = snapshot
    ? getOtherPaymentTotals(snapshot.closeSummary)
    : [];
  const showPrimaryAction = snapshot
    ? shouldShowPrimaryAction(snapshot)
    : false;
  const showHistoricalEodReviewAction = snapshot
    ? shouldShowHistoricalEodReviewAction(snapshot)
    : false;
  const isHistoricalDate = snapshot
    ? isHistoricalOperatingDate(snapshot.operatingDate)
    : false;
  const actionableLanes = snapshot
    ? snapshot.lanes.filter(isActionableLane)
    : [];

  return (
    <View hideBorder hideHeaderBottomBorder scrollMode="page">
      <FadeIn className="container mx-auto w-full py-layout-lg md:py-layout-xl">
        <PageWorkspace>
          <PageLevelHeader
            eyebrow="Store Ops"
            title="Daily Operations"
            description="Review the store day, see what needs attention, and move into the workflow that owns the next action."
          />

          {isLoadingSnapshot || !snapshot ? null : (
            <PageWorkspace>
              <section className="space-y-layout-2xl">
                <div className="flex flex-col gap-layout-sm lg:flex-row lg:items-center lg:justify-end">
                  <div className="flex flex-col gap-layout-sm sm:flex-row sm:items-center">
                    <OperatingDatePicker
                      operatingDate={snapshot.operatingDate}
                      onChange={onOperatingDateChange}
                    />
                    {showHistoricalEodReviewAction ? (
                      <Button
                        asChild
                        className="w-full sm:w-auto"
                        variant="outline"
                      >
                        <Link
                          aria-label={`Review EOD Review for ${formatOperatingDateWithWeekday(
                            snapshot.operatingDate,
                          )}`}
                          params={buildParams(orgUrlSlug, storeUrlSlug)}
                          search={
                            getWorkflowSearch(
                              "/$orgUrlSlug/store/$storeUrlSlug/operations/daily-close",
                              snapshot.operatingDate,
                            ) as never
                          }
                          to="/$orgUrlSlug/store/$storeUrlSlug/operations/daily-close"
                        >
                          Review EOD Review
                          <ArrowUpRight
                            aria-hidden="true"
                            className="ml-2 h-4 w-4"
                          />
                        </Link>
                      </Button>
                    ) : null}
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

                <div className="grid gap-layout-sm sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5">
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
                    value={
                      <FinancialValue
                        canView={hasFinancialDetailsAccess}
                        label={metricLabels?.netSales ?? "Net sales"}
                      >
                        {formatMoney(
                          snapshot.currency ?? currency,
                          snapshot.closeSummary.salesTotal,
                        )}
                      </FinancialValue>
                    }
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
                    value={
                      <FinancialValue
                        canView={hasFinancialDetailsAccess}
                        label={metricLabels?.cash ?? "Cash"}
                      >
                        {formatMoney(
                          snapshot.currency ?? currency,
                          snapshot.closeSummary.currentDayCashTotal,
                        )}
                      </FinancialValue>
                    }
                  />
                  {otherPaymentTotals.map((paymentTotal) => {
                    const paymentMethodLabel = formatPaymentMethodLabel(
                      paymentTotal.method,
                    );

                    return (
                      <OperationsSummaryMetric
                        helper={formatPaymentCount(
                          paymentTotal.transactionCount,
                        )}
                        key={paymentTotal.method}
                        label={paymentMethodLabel}
                        link={{
                          ariaLabel: `Open ${paymentMethodLabel} transactions`,
                          orgUrlSlug,
                          search: buildOperationsTransactionSearch({
                            operatingDate: snapshot.operatingDate,
                            paymentMethod: paymentTotal.method,
                          }),
                          storeUrlSlug,
                          to: "/$orgUrlSlug/store/$storeUrlSlug/pos/transactions",
                        }}
                        value={
                          <FinancialValue
                            canView={hasFinancialDetailsAccess}
                            label={paymentMethodLabel}
                          >
                            {formatMoney(
                              snapshot.currency ?? currency,
                              paymentTotal.amount,
                            )}
                          </FinancialValue>
                        }
                      />
                    );
                  })}
                  <OperationsSummaryMetric
                    helper={formatCarriedOverRegisterCount(
                      snapshot.closeSummary.carriedOverRegisterCount,
                    )}
                    label="Carried-over cash"
                    value={
                      <FinancialValue
                        canView={hasFinancialDetailsAccess}
                        label="Carried-over cash"
                      >
                        {formatMoney(
                          snapshot.currency ?? currency,
                          snapshot.closeSummary.carriedOverCashTotal,
                        )}
                      </FinancialValue>
                    }
                  />
                  {shouldShowExpenseMetric(snapshot.closeSummary) ? (
                    <OperationsSummaryMetric
                      helper={formatEntityCount(
                        snapshot.closeSummary.expenseTransactionCount,
                        "expense transaction",
                      )}
                      label="Expenses"
                      link={{
                        ariaLabel: "Open expense reports",
                        orgUrlSlug,
                        search: buildOperationsExpenseSearch(
                          snapshot.operatingDate,
                        ),
                        storeUrlSlug,
                        to: "/$orgUrlSlug/store/$storeUrlSlug/pos/expense-reports",
                      }}
                      value={
                        <FinancialValue
                          canView={hasFinancialDetailsAccess}
                          label="Expenses"
                        >
                          {formatMoney(
                            snapshot.currency ?? currency,
                            snapshot.closeSummary.expenseTotal,
                          )}
                        </FinancialValue>
                      }
                    />
                  ) : null}
                  {shouldShowVarianceMetric(snapshot.closeSummary) ? (
                    <OperationsSummaryMetric
                      helper={formatRegisterVarianceCount(
                        snapshot.closeSummary.registerVarianceCount,
                      )}
                      label="Variance"
                      value={
                        <FinancialValue
                          canView={hasFinancialDetailsAccess}
                          label="Variance"
                        >
                          {formatMoney(
                            snapshot.currency ?? currency,
                            snapshot.closeSummary.netCashVariance,
                          )}
                        </FinancialValue>
                      }
                    />
                  ) : null}
                </div>

                <WeekMetricsStrip
                  currency={snapshot.currency ?? currency}
                  hasFinancialDetailsAccess={hasFinancialDetailsAccess}
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
                      <AutomationStatusPanel
                        orgUrlSlug={orgUrlSlug}
                        snapshot={snapshot}
                        storeUrlSlug={storeUrlSlug}
                      />
                      <AutomationReviewEvidencePanel
                        orgUrlSlug={orgUrlSlug}
                        snapshot={snapshot}
                        storeUrlSlug={storeUrlSlug}
                      />
                      <div>
                        <h3 className="text-base font-medium text-foreground">
                          Workflow status
                        </h3>
                      </div>
                      <div className="overflow-hidden rounded-lg border border-border bg-surface-raised shadow-surface">
                        <div className="grid gap-layout-xs p-layout-sm md:grid-cols-2 xl:grid-cols-3">
                          {actionableLanes.length > 0 ? (
                            actionableLanes.map((lane) => (
                              <LaneCard
                                key={lane.key}
                                lane={lane}
                                operatingDate={snapshot.operatingDate}
                                orgUrlSlug={orgUrlSlug}
                                storeUrlSlug={storeUrlSlug}
                              />
                            ))
                          ) : (
                            <WorkflowAllClearPanel />
                          )}
                        </div>
                        <SupportingWorkspaceLinks
                          operatingDate={snapshot.operatingDate}
                          orgUrlSlug={orgUrlSlug}
                          storeUrlSlug={storeUrlSlug}
                        />
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
                          <TimelineEventItem
                            event={event}
                            key={event.id}
                            orgUrlSlug={orgUrlSlug}
                            storeUrlSlug={storeUrlSlug}
                          />
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
                        <TimelineEventItem
                          event={event}
                          key={event.id}
                          orgUrlSlug={orgUrlSlug}
                          storeUrlSlug={storeUrlSlug}
                        />
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
      <FadeIn className="container mx-auto w-full py-layout-lg md:py-layout-xl">
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
    hasFinancialDetailsAccess,
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
          operatingTimezoneOffsetMinutes: getOperatingTimezoneOffsetMinutes(
            operatingDateRange.operatingDate,
          ),
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
      hasFinancialDetailsAccess={hasFinancialDetailsAccess}
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
