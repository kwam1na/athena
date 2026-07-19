import {
  useEffect,
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useMemo,
  useState,
} from "react";
import {
  Link,
  useNavigate,
  useParams,
  useSearch,
} from "@tanstack/react-router";
import { useQuery } from "convex/react";
import {
  ArrowUpRight,
  Ban,
  Barcode,
  Bot,
  Calendar as CalendarIcon,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Clock3,
  Coins,
  History,
  PackageSearch,
  RefreshCw,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { useProtectedAdminPageState } from "@/hooks/useProtectedAdminPageState";
import { useIsMobile } from "@/hooks/use-mobile";
import { getOrigin } from "@/lib/navigationUtils";
import {
  getLocalDateFromOperatingDate,
  getLocalOperatingDate,
  getLocalOperatingDateRange,
  getLocalOperatingDateRangeFromSearch,
} from "@/lib/operations/operatingDate";
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
import { formatOperationsMetricHelper } from "./operationsMetricFormatting";
import {
  PaymentMethodsPanel,
  StorePulseSummaryView,
  StorePulseTimeline,
  TopItemsPanel,
  type StorePulseSummary,
  type StorePulseTrendDay,
  type StorePulseWindow,
} from "../store-pulse/StorePulseSummaryView";

type DailyOperationsApi = {
  getDailyOperationsAutomationSnapshot?: unknown;
  getDailyOperationsDetailSnapshot?: unknown;
  getDailyOperationsOpenRegisterSessionsSnapshot?: unknown;
  getDailyOperationsSnapshot?: unknown;
  getDailyOperationsStorePulseSnapshot?: unknown;
  getDailyOperationsStoreRequestsSnapshot?: unknown;
  getDailyOperationsTodayRefreshSnapshot?: unknown;
  getDailyOperationsTimelinePreviewSnapshot?: unknown;
  getDailyOperationsTimelineSnapshot?: unknown;
  getDailyOperationsWeekAnalyticsSnapshot?: unknown;
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
    icon: History,
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
    icon: Barcode,
    label: "SKU activity",
    to: "/$orgUrlSlug/store/$storeUrlSlug/operations/sku-activity",
  },
];

export type DailyOperationsLifecycleStatus =
  "not_opened" | "operating" | "close_blocked" | "ready_to_close" | "closed";

export type DailyOperationsLaneStatus =
  "blocked" | "needs_attention" | "ready" | "closed" | "unknown";

type PrimaryActionEmphasisStatus =
  DailyOperationsLifecycleStatus | "historical_operating";

type DailyOperationsAutomationOutcome =
  | "applied"
  | "prepared"
  | "skipped"
  | "failed"
  | "dry_run"
  | "disabled"
  | "eligible";

type DailyOperationsAutomationStatus = {
  bucket?:
    | "failed"
    | "action_taken"
    | "needs_review"
    | "policy_skipped"
    | "scheduled_later";
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

type DailyOperationsScheduledRunSummary = {
  candidateCount: number;
  completedAt: number;
  cronFamily: string;
  failedCount: number;
  id: string;
  outcome: "applied" | "partial_failure" | "no_candidates";
  processedCount: number;
  skippedCount: number;
  succeededCount: number;
  windowEndAt: number;
  windowStartAt: number;
};

type DailyOperationsCompletedCloseAttribution = {
  actorType?: "human" | "automation";
  automationDecisionReason?: string | null;
  carryForwardCount?: number | null;
  completedAt?: number | null;
  policyReviewedItemKeys?: string[] | null;
  restrictedDetailsRedacted?: boolean | null;
};

type DailyOperationsAutomationUpdate =
  | {
      id: string;
      occurredAt?: number | null;
      status: DailyOperationsAutomationStatus;
      type: "status";
    }
  | {
      completedClose: DailyOperationsCompletedCloseAttribution;
      id: string;
      occurredAt?: number | null;
      type: "completion";
    };

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
    registerSession?: {
      displayLabel: string;
      isOpenedForOperatingDate: boolean;
    };
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
  completedClose?: DailyOperationsCompletedCloseAttribution | null;
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
  priorDayMetric?: DailyOperationsSnapshot["weekMetrics"][number];
  scheduledRunSummaries?: DailyOperationsScheduledRunSummary[];
  startAt?: number;
  storePulse?: StorePulseSummary | null;
  storeId: Id<"store">;
  timeline: Array<{
    approvedProductLink?: {
      label?: string;
      params?: Record<string, string>;
      search?: Record<string, string>;
      to?: string;
    };
    createdAt: number;
    id: string;
    message: string;
    onlineOrderLink?: {
      label?: string;
      matchLabel?: string;
      params?: Record<string, string>;
      search?: Record<string, string>;
      to?: string;
    };
    productLink?: {
      label?: string;
      params?: Record<string, string>;
      search?: Record<string, string>;
      to?: string;
    };
    registerLink?: {
      label?: string;
      matchLabel?: string;
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
  timelineHasMore?: boolean;
  weekMetrics: Array<{
    currentDayCashTotal: number;
    currentDayCashTransactionCount: number;
    expenseTotal: number;
    expenseTransactionCount: number;
    isClosed: boolean;
    isReopened?: boolean;
    isSelected: boolean;
    operatingDate: string;
    paymentTotals?: Array<{
      amount: number;
      method: string;
      transactionCount?: number | null;
    }>;
    salesTotal: number;
    transactionCount: number;
  }>;
  weekStorePulses?: Array<{
    operatingDate: string;
    storePulse?: StorePulseSummary | null;
  }>;
  weekSnapshots?: DailyOperationsSnapshot[];
};

type DailyOperationsViewContentProps = {
  cachedPriorWeekBoundaryMetric?:
    DailyOperationsSnapshot["weekMetrics"][number] | null;
  cachedWeekAnalyticsFetchedAt?: number;
  cachedWeekMetrics?: DailyOperationsSnapshot["weekMetrics"];
  cachedWeekStorePulse?: StorePulseSummary | null;
  currency: string;
  canViewAutomationStatuses?: boolean;
  hasDetailSnapshot: boolean;
  hasFullAdminAccess: boolean;
  hasFinancialDetailsAccess: boolean;
  isLoadingDetailSnapshot?: boolean;
  isLoadingStorePulseSnapshot?: boolean;
  isLoadingTimelinePreviewSnapshot?: boolean;
  isLoadingTimelineSnapshot?: boolean;
  isTimelineSheetOpen?: boolean;
  isRefreshingToday?: boolean;
  isAuthenticated: boolean;
  isLoadingAccess: boolean;
  isLoadingSnapshot: boolean;
  onRequestDetailSnapshot?: () => void;
  onRefreshToday?: () => void;
  onRequestStorePulseSnapshot?: () => void;
  onRequestTimelineSnapshot?: () => void;
  onTimelineSheetOpenChange?: (open: boolean) => void;
  onOperatingDateChange?: (date: Date) => void;
  openRegisterSessionsSnapshot?: DailyOperationsOpenRegisterSessionsSnapshot;
  orgUrlSlug: string;
  snapshot?: DailyOperationsSnapshot;
  storePulseWindow: StorePulseWindow;
  storeUrlSlug: string;
  storePulseSnapshot?: DailyOperationsStorePulseSnapshot;
  storeRequestsSnapshot?: DailyOperationsStoreRequestsSnapshot;
  todayRefreshedAt?: number;
  timelinePreviewSnapshot?: DailyOperationsTimelinePreviewSnapshot;
  timelineSnapshot?: DailyOperationsTimelineSnapshot;
};

type DailyOperationsOpenRegisterSessionsSnapshot = {
  operatingDate: string;
  sessions: Array<{
    displayLabel: string;
    id: string;
  }>;
};

type CachedWeekAnalytics = {
  daySnapshots: Record<
    string,
    {
      hasDetail: boolean;
      snapshot: DailyOperationsSnapshot;
    }
  >;
  fetchedAt: number;
  metrics: DailyOperationsSnapshot["weekMetrics"];
  priorWeekBoundaryMetric?:
    DailyOperationsSnapshot["weekMetrics"][number] | null;
  storePulse?: StorePulseSummary | null;
};

type DailyOperationsStorePulseSnapshot = {
  operatingDate: string;
  storePulse?: StorePulseSummary | null;
};

type DailyOperationsStoreRequestsSnapshot = {
  approvalsLane: DailyOperationsSnapshot["lanes"][number];
  operatingDate: string;
};

type DailyOperationsTimelineSnapshot = {
  operatingDate: string;
  timeline: DailyOperationsSnapshot["timeline"];
};

type DailyOperationsTimelinePreviewSnapshot =
  DailyOperationsTimelineSnapshot & {
    timelineHasMore: boolean;
  };

type DailyOperationsWeekAnalyticsSnapshot = {
  operatingDate: string;
  priorWeekBoundaryMetric?:
    DailyOperationsSnapshot["weekMetrics"][number] | null;
  weekEndOperatingDate: string;
  weekMetrics: DailyOperationsSnapshot["weekMetrics"];
};

type DailyOperationsTodayRefreshSnapshot = Pick<
  DailyOperationsSnapshot,
  | "attentionItems"
  | "closeSummary"
  | "completedClose"
  | "currency"
  | "endAt"
  | "lanes"
  | "lifecycle"
  | "operatingDate"
  | "primaryAction"
  | "startAt"
  | "storeId"
> & {
  priorDayMetric?: DailyOperationsSnapshot["weekMetrics"][number] | null;
  refreshedAt: number;
  refreshRequestedAt?: number | null;
  storePulse?: StorePulseSummary | null;
  weekMetric?: DailyOperationsSnapshot["weekMetrics"][number] | null;
};

type DailyOperationsAutomationSnapshot = {
  automationStatuses?: DailyOperationsAutomationStatus[];
  operatingDate: string;
};

const TIMELINE_PREVIEW_LIMIT = 5;
const TODAY_REFRESH_STALE_MS = 10 * 60 * 1000;

function getDailyOperationsApi(): DailyOperationsApi {
  return (
    (
      api.operations as typeof api.operations & {
        dailyOperations?: DailyOperationsApi;
      }
    ).dailyOperations ?? {}
  );
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
  storePulseWindow,
  weekEndOperatingDate,
}: {
  operatingDate: string;
  storePulseWindow?: StorePulseWindow;
  weekEndOperatingDate?: string;
}) {
  const currentOperatingDate = getLocalOperatingDate();
  const search = {
    ...(operatingDate !== currentOperatingDate ? { operatingDate } : {}),
    ...(storePulseWindow && storePulseWindow !== "today"
      ? { storePulseWindow }
      : {}),
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

function selectWeekMetricsForOperatingDate(
  metrics: DailyOperationsSnapshot["weekMetrics"],
  operatingDate: string,
) {
  return metrics.map((metric) => ({
    ...metric,
    isSelected: metric.operatingDate === operatingDate,
  }));
}

function replaceWeekMetricForOperatingDate(
  metrics: DailyOperationsSnapshot["weekMetrics"] | undefined,
  refreshedMetric:
    DailyOperationsSnapshot["weekMetrics"][number] | null | undefined,
  operatingDate: string,
) {
  if (!metrics || !refreshedMetric) return metrics;

  let didReplace = false;
  const nextMetrics = metrics.map((metric) => {
    if (metric.operatingDate !== operatingDate) {
      return {
        ...metric,
        isSelected: metric.isSelected && metric.operatingDate === operatingDate,
      };
    }

    didReplace = true;
    return {
      ...refreshedMetric,
      isSelected: metric.isSelected,
    };
  });

  return didReplace ? nextMetrics : metrics;
}

function applyTodayRefreshSnapshot(
  snapshot: DailyOperationsSnapshot | undefined,
  refreshSnapshot: DailyOperationsTodayRefreshSnapshot | undefined,
) {
  if (!snapshot || !refreshSnapshot) return snapshot;
  if (snapshot.operatingDate !== refreshSnapshot.operatingDate) return snapshot;

  const weekMetrics =
    replaceWeekMetricForOperatingDate(
      snapshot.weekMetrics,
      refreshSnapshot.weekMetric,
      snapshot.operatingDate,
    ) ?? snapshot.weekMetrics;

  return {
    ...snapshot,
    attentionItems: refreshSnapshot.attentionItems,
    closeSummary: refreshSnapshot.closeSummary,
    completedClose: refreshSnapshot.completedClose ?? undefined,
    currency: refreshSnapshot.currency,
    endAt: refreshSnapshot.endAt,
    lanes: refreshSnapshot.lanes,
    lifecycle: refreshSnapshot.lifecycle,
    primaryAction: refreshSnapshot.primaryAction,
    priorDayMetric: refreshSnapshot.priorDayMetric ?? undefined,
    startAt: refreshSnapshot.startAt,
    storeId: refreshSnapshot.storeId,
    storePulse: refreshSnapshot.storePulse ?? snapshot.storePulse,
    weekMetrics,
  };
}

function applyAutomationSnapshot(
  snapshot: DailyOperationsSnapshot | undefined,
  automationSnapshot: DailyOperationsAutomationSnapshot | undefined,
) {
  if (!snapshot || !automationSnapshot) return snapshot;
  if (snapshot.operatingDate !== automationSnapshot.operatingDate) {
    return snapshot;
  }

  return {
    ...snapshot,
    automationStatuses: automationSnapshot.automationStatuses ?? [],
  };
}

function shouldShowPrimaryAction(snapshot: DailyOperationsSnapshot) {
  return !isHistoricalOperatingDate(snapshot.operatingDate);
}

function shouldShowHistoricalEodReviewAction(
  snapshot: DailyOperationsSnapshot,
) {
  return (
    snapshot.lifecycle.status !== "not_opened" &&
    isHistoricalOperatingDate(snapshot.operatingDate)
  );
}

function getPendingApprovalsLaneFromLanes(
  lanes: DailyOperationsSnapshot["lanes"],
) {
  const approvalsLane = lanes.find((lane) => lane.key === "approvals");

  return approvalsLane && approvalsLane.count > 0 ? approvalsLane : null;
}

function replaceApprovalsLane(
  lanes: DailyOperationsSnapshot["lanes"],
  approvalsLane?: DailyOperationsSnapshot["lanes"][number],
) {
  if (!approvalsLane) return lanes;

  const nextLanes = lanes.map((lane) =>
    lane.key === "approvals" ? approvalsLane : lane,
  );

  return nextLanes.some((lane) => lane.key === "approvals")
    ? nextLanes
    : [...nextLanes, approvalsLane];
}

function getPendingApprovalsCountLabel(
  lane: DailyOperationsSnapshot["lanes"][number],
) {
  return lane.countLabel ?? String(lane.count);
}

function formatPendingApprovalsLabel(
  lane: DailyOperationsSnapshot["lanes"][number],
) {
  const countLabel = getPendingApprovalsCountLabel(lane);
  return `${countLabel} pending approval${lane.count === 1 ? "" : "s"}`;
}

function getWorkflowSearch(to: string, operatingDate: string) {
  const shouldCarryOperatingDate =
    to.endsWith("/operations/daily-close") ||
    to.endsWith("/operations/opening");
  const search = {
    o: getOrigin(),
    ...(shouldCarryOperatingDate ? buildDailyCloseSearch(operatingDate) : {}),
  };

  return Object.keys(search).length > 0 ? search : undefined;
}

function formatEventTime(timestamp: number) {
  return new Intl.DateTimeFormat([], {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

const ONLINE_ORDER_TIMELINE_MESSAGE_TEMPLATES: Record<
  string,
  (orderLabel: string) => string
> = {
  online_order_cancelled: (orderLabel) =>
    `Online order ${orderLabel} cancelled.`,
  online_order_created: (orderLabel) => `Online order ${orderLabel} created.`,
  online_order_delivered: (orderLabel) =>
    `Online order ${orderLabel} delivered.`,
  online_order_exchange_balance_collection: (orderLabel) =>
    `Exchange balance collected for online order ${orderLabel}.`,
  online_order_exchange_processed: (orderLabel) =>
    `Exchange processed for online order ${orderLabel}.`,
  online_order_item_restocked: (orderLabel) =>
    `Returned item restocked for online order ${orderLabel}.`,
  online_order_out_for_delivery: (orderLabel) =>
    `Online order ${orderLabel} out for delivery.`,
  online_order_payment_collected: (orderLabel) =>
    `Payment collected for online order ${orderLabel}.`,
  online_order_payment_verified: (orderLabel) =>
    `Payment verified for online order ${orderLabel}.`,
  online_order_picked_up: (orderLabel) =>
    `Online order ${orderLabel} picked up.`,
  online_order_pickup_exception: (orderLabel) =>
    `Pickup exception recorded for online order ${orderLabel}.`,
  online_order_ready_for_delivery: (orderLabel) =>
    `Online order ${orderLabel} ready for delivery.`,
  online_order_ready_for_pickup: (orderLabel) =>
    `Online order ${orderLabel} ready for pickup.`,
  online_order_refund_submitted: (orderLabel) =>
    `Refund submitted for online order ${orderLabel}.`,
  online_order_reservation_released: (orderLabel) =>
    `Reservation released for online order ${orderLabel}.`,
  online_order_return_approval_requested: (orderLabel) =>
    `Return or exchange for online order ${orderLabel} sent for approval.`,
  online_order_return_processed: (orderLabel) =>
    `Return processed for online order ${orderLabel}.`,
  online_order_return_refund: (orderLabel) =>
    `Refund recorded for online order ${orderLabel}.`,
  online_order_status_changed: (orderLabel) =>
    `Online order ${orderLabel} status changed.`,
};

function formatOnlineOrderTimelineFallbackMessage(message: string) {
  const match = /^(online_order_[a-z_]+) on (.+)$/.exec(message.trim());
  if (!match) return message;

  const [, eventType, subject] = match;
  const template = ONLINE_ORDER_TIMELINE_MESSAGE_TEMPLATES[eventType];
  if (!template) return message;

  const trimmedSubject = subject.trim();
  const orderLabel = trimmedSubject.startsWith("#")
    ? trimmedSubject
    : `#${trimmedSubject}`;

  return template(orderLabel);
}

function formatTimelineMessage(message: string) {
  return formatOnlineOrderTimelineFallbackMessage(message).replace(
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
  const approvedProductLink = event.approvedProductLink;
  const approvedProductLabel = approvedProductLink?.label?.trim();
  const canRenderApprovedProductLink = Boolean(
    approvedProductLink?.to &&
    approvedProductLink.params &&
    approvedProductLabel,
  );
  const inlineLink =
    event.transactionLink ??
    event.registerLink ??
    event.onlineOrderLink ??
    event.productLink;
  const linkLabel = inlineLink?.label?.trim();
  const matchLabel = event.transactionLink
    ? undefined
    : (event.registerLink?.matchLabel ?? event.onlineOrderLink?.matchLabel);
  const displayMessage = formatTimelineMessage(event.message);
  const linkMatch = findTimelineLinkMatch(
    displayMessage,
    linkLabel,
    matchLabel,
  );

  const renderApprovedProductLink = () => {
    if (
      !canRenderApprovedProductLink ||
      !approvedProductLink?.to ||
      !approvedProductLink.params ||
      !approvedProductLabel
    ) {
      return null;
    }

    return (
      <>
        {" "}
        product{" "}
        <Link
          className="inline-flex items-center gap-0.5 font-medium text-link underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          params={{
            ...approvedProductLink.params,
            orgUrlSlug,
            storeUrlSlug,
          }}
          search={{ o: getOrigin(), ...(approvedProductLink.search ?? {}) }}
          to={approvedProductLink.to}
        >
          <span>{approvedProductLabel}</span>
          <ArrowUpRight aria-hidden="true" className="h-3 w-3" />
        </Link>
        .
      </>
    );
  };

  if (!inlineLink?.to || !inlineLink.params || !linkLabel || !linkMatch) {
    if (!canRenderApprovedProductLink) return <>{displayMessage}</>;

    return (
      <>
        {displayMessage.replace(/\.\s*$/, "")}
        {renderApprovedProductLink()}
      </>
    );
  }

  const before = displayMessage.slice(0, linkMatch.index);
  const after = displayMessage.slice(linkMatch.index + linkMatch.length);
  const renderedAfter = canRenderApprovedProductLink
    ? after.replace(/\.\s*$/, "")
    : after;

  return (
    <>
      {before}
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
      {renderedAfter}
      {renderApprovedProductLink()}
    </>
  );
}

function findTimelineLinkMatch(
  message: string,
  label: string | undefined,
  matchLabel?: string,
) {
  const labels = [label, matchLabel]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value));

  for (const candidate of labels) {
    const exactIndex = message.indexOf(candidate);
    if (exactIndex >= 0) {
      return { index: exactIndex, length: candidate.length };
    }

    if (!candidate.startsWith("#")) continue;

    const plainLabel = candidate.slice(1);
    const plainIndex = plainLabel ? message.indexOf(plainLabel) : -1;

    if (plainIndex >= 0) {
      return { index: plainIndex, length: plainLabel.length };
    }
  }

  return null;
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

function formatAnalyticsCacheTimestamp(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
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

function formatMissingTenderComparisonLabel(priorWindowLabel: string) {
  if (priorWindowLabel === "yesterday") return "No payments yesterday";
  if (priorWindowLabel === "prior day") return "No payments on prior day";

  return `No payments for ${priorWindowLabel}`;
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

function getOtherPaymentTotals(
  summary: DailyOperationsSnapshot["closeSummary"],
) {
  return (summary.paymentTotals ?? [])
    .filter((paymentTotal) => paymentTotal.method.toLowerCase() !== "cash")
    .sort(compareSummaryPaymentTotals);
}

function getPaymentMethodDisplayRank(method: string) {
  switch (method.toLowerCase()) {
    case "card":
      return 0;
    case "mobile_money":
      return 1;
    default:
      return 2;
  }
}

function compareSummaryPaymentTotals(
  left: { amount: number; method: string },
  right: { amount: number; method: string },
) {
  const rankDelta =
    getPaymentMethodDisplayRank(left.method) -
    getPaymentMethodDisplayRank(right.method);

  if (rankDelta !== 0) return rankDelta;

  return right.amount - left.amount;
}

function getPaymentTotalAmount(
  summary:
    | {
        paymentTotals?: Array<{
          amount: number;
          method: string;
        }>;
      }
    | undefined,
  method: string,
) {
  return (
    summary?.paymentTotals?.find(
      (paymentTotal) =>
        paymentTotal.method.toLowerCase() === method.toLowerCase(),
    )?.amount ?? 0
  );
}

function getPreviousOperatingDate(operatingDate: string) {
  const date = getLocalDateFromOperatingDate(operatingDate);

  if (!date) return undefined;

  date.setDate(date.getDate() - 1);
  return getLocalOperatingDate(date);
}

function getPriorComparisonMetric(
  snapshot: DailyOperationsSnapshot,
  cachedWeekMetrics?: DailyOperationsSnapshot["weekMetrics"],
  cachedPriorWeekBoundaryMetric?:
    DailyOperationsSnapshot["weekMetrics"][number] | null,
) {
  const previousOperatingDate = getPreviousOperatingDate(
    snapshot.operatingDate,
  );

  if (!previousOperatingDate) return undefined;

  if (snapshot.priorDayMetric?.operatingDate === previousOperatingDate) {
    return snapshot.priorDayMetric;
  }

  if (cachedPriorWeekBoundaryMetric?.operatingDate === previousOperatingDate) {
    return cachedPriorWeekBoundaryMetric;
  }

  return (cachedWeekMetrics ?? snapshot.weekMetrics).find(
    (metric) => metric.operatingDate === previousOperatingDate,
  );
}

function getPriorWindowLabel(operatingDate: string) {
  return operatingDate === getLocalOperatingDate() ? "yesterday" : "prior day";
}

function shouldShowExpenseMetric(
  summary: DailyOperationsSnapshot["closeSummary"],
) {
  if (summary.salesTotal <= 0) {
    return true;
  }

  return summary.expenseTransactionCount > 0 || summary.expenseTotal !== 0;
}

function shouldShowVarianceMetric(
  summary: DailyOperationsSnapshot["closeSummary"],
) {
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

function getPrimaryActionEmphasis(status: PrimaryActionEmphasisStatus) {
  const sharedClassName =
    "transition-[background-color,border-color,box-shadow,transform] duration-150 ease-out active:scale-[0.98]";

  switch (status) {
    case "not_opened":
      return {
        Icon: null,
        className: cn(
          "border-border bg-background text-muted-foreground hover:bg-surface hover:text-foreground",
          sharedClassName,
        ),
        iconClassName: "text-muted-foreground",
      };
    case "operating":
      return {
        Icon: null,
        className: cn(
          "border-primary-border bg-primary-soft text-primary shadow-[0_1px_0_hsl(var(--primary)/0.10)] hover:border-primary/45 hover:bg-primary-soft/75 hover:text-primary",
          sharedClassName,
        ),
        iconClassName: "text-primary",
      };
    case "historical_operating":
      return {
        Icon: Clock3,
        className: cn(
          "border-warning/30 bg-warning/10 text-warning-foreground shadow-[0_1px_0_hsl(var(--warning)/0.10)] hover:border-warning/45 hover:bg-warning/15 hover:text-warning-foreground",
          sharedClassName,
        ),
        iconClassName: "text-warning",
      };
    case "close_blocked":
      return {
        Icon: CircleAlert,
        className: cn(
          "border-danger/30 bg-danger/10 text-danger shadow-[0_1px_0_hsl(var(--danger)/0.10)] hover:border-danger/45 hover:bg-danger/15 hover:text-danger",
          sharedClassName,
        ),
        iconClassName: "text-danger",
      };
    case "ready_to_close":
      return {
        Icon: Check,
        className: cn(
          "border-success/35 bg-success/10 text-success shadow-[0_1px_0_hsl(var(--success)/0.10)] hover:border-success/50 hover:bg-success/15 hover:text-success",
          sharedClassName,
        ),
        iconClassName: "text-success",
      };
    case "closed":
      return {
        Icon: null,
        className: cn(
          "border-success/25 bg-success/10 text-success shadow-[0_1px_0_hsl(var(--success)/0.08)] hover:border-success/40 hover:bg-success/15 hover:text-success",
          sharedClassName,
        ),
        iconClassName: "text-success",
      };
  }

  const exhaustiveStatus: never = status;
  return exhaustiveStatus;
}

function getPrimaryActionEmphasisStatus({
  isHistoricalDate,
  status,
}: {
  isHistoricalDate: boolean;
  status: DailyOperationsLifecycleStatus;
}): PrimaryActionEmphasisStatus {
  if (isHistoricalDate && status === "operating") {
    return "historical_operating";
  }

  return status;
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
    <article className="flex min-w-0 items-center gap-layout-sm rounded-md border border-border/70 bg-background/60 px-layout-sm py-2 transition-colors hover:bg-background">
      {["ready", "closed"].includes(lane.status) ? (
        <SuccessCheckIcon label={`${lane.label} ready`} />
      ) : (
        <LaneStatusIcon
          label={`${lane.label} ${lane.status === "blocked" ? "blocked" : "needs attention"}`}
          status={lane.status}
        />
      )}
      <div className="min-w-0 flex-1">
        <h3 className="text-xs font-medium text-foreground">{lane.label}</h3>
        <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">
          {lane.description}
        </p>
      </div>
      <Button
        asChild
        className="h-7 shrink-0 px-2 text-xs"
        size="sm"
        variant="ghost"
      >
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
    </article>
  );
}

function OpenRegisterSessionsPanel({
  operatingDate,
  orgUrlSlug,
  sessions,
  showTopRule = false,
  storeUrlSlug,
}: {
  operatingDate: string;
  orgUrlSlug: string;
  sessions: DailyOperationsSnapshot["attentionItems"];
  showTopRule?: boolean;
  storeUrlSlug: string;
}) {
  if (sessions.length === 0) return null;

  return (
    <section
      aria-labelledby="open-register-sessions-heading"
      className={cn(
        "px-layout-md",
        showTopRule && "border-t border-border/70 pt-layout-md",
      )}
    >
      <div className="flex items-baseline gap-layout-sm">
        <Coins
          aria-hidden="true"
          className="h-4 w-4 shrink-0 self-center text-muted-foreground"
        />
        <h2
          className="text-sm font-medium text-foreground"
          id="open-register-sessions-heading"
        >
          Open register sessions
        </h2>
        <p className="font-numeric text-xs tabular-nums text-muted-foreground">
          {sessions.length} open
        </p>
      </div>
      <div className="mt-layout-sm flex w-full max-w-md min-w-0 flex-col divide-y divide-border/70">
        {sessions.map((session) => {
          const sessionLabel =
            session.registerSession?.displayLabel ??
            session.source.label ??
            session.label;

          return (
            <article
              className="py-layout-sm first:pt-0 last:pb-0"
              key={session.id}
            >
              <Link
                aria-label={`Open register session ${sessionLabel}`}
                className="inline-flex min-w-0 items-center gap-layout-xs rounded-sm text-sm font-medium text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                params={buildParams(orgUrlSlug, storeUrlSlug, session.params)}
                search={
                  {
                    ...(session.search ?? {}),
                    ...getWorkflowSearch(session.to ?? "", operatingDate),
                  } as never
                }
                to={
                  session.to ?? "/$orgUrlSlug/store/$storeUrlSlug/cash-controls"
                }
              >
                <span className="truncate">{sessionLabel}</span>
                <ArrowUpRight aria-hidden="true" className="h-3.5 w-3.5" />
              </Link>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function getRecentActivityEmptyState(operatingDate: string) {
  const currentOperatingDate = getLocalOperatingDate();

  if (operatingDate < currentOperatingDate) {
    return {
      description: "No operational activity was recorded for this store day.",
      title: "No activity recorded",
    };
  }

  if (operatingDate > currentOperatingDate) {
    return {
      description:
        "Operational activity will appear here once this store day begins.",
      title: "Store day not started",
    };
  }

  return {
    description:
      "Operational activity will appear here as the store day progresses.",
    title: "No activity yet",
  };
}

function getActivityLabel(operatingDate: string) {
  return operatingDate === getLocalOperatingDate()
    ? "Recent activity"
    : "Activity for this day";
}

function StoreDayActivityPanel({
  hasMoreTimelineEvents,
  isLoadingTimelinePreviewSnapshot,
  isLoadingTimelineSnapshot,
  onRequestTimelineSnapshot,
  onShowMore,
  operatingDate,
  orgUrlSlug,
  storeUrlSlug,
  timeline,
}: {
  hasMoreTimelineEvents: boolean;
  isLoadingTimelinePreviewSnapshot: boolean;
  isLoadingTimelineSnapshot: boolean;
  onRequestTimelineSnapshot?: () => void;
  onShowMore: () => void;
  operatingDate: string;
  orgUrlSlug: string;
  storeUrlSlug: string;
  timeline?: DailyOperationsSnapshot["timeline"];
}) {
  const activityLabel = getActivityLabel(operatingDate);
  const emptyState = getRecentActivityEmptyState(operatingDate);
  const showTimelineHeading =
    isLoadingTimelinePreviewSnapshot || Boolean(timeline?.length);

  return (
    <section
      aria-label={activityLabel}
      className="min-w-0 px-layout-md py-layout-sm"
    >
      {showTimelineHeading ? (
        <h3 className="flex shrink-0 items-center gap-layout-xs text-sm font-medium text-foreground">
          <Clock3
            aria-hidden="true"
            className="h-3.5 w-3.5 text-muted-foreground"
          />
          {activityLabel}
        </h3>
      ) : null}
      <div
        className={cn(
          "space-y-layout-md",
          showTimelineHeading && "mt-layout-md",
        )}
      >
        {isLoadingTimelinePreviewSnapshot && !timeline ? (
          Array.from({ length: TIMELINE_PREVIEW_LIMIT }).map((_, index) => (
            <div className="space-y-2" key={index}>
              <span className="block h-3 w-16 rounded-sm bg-muted" />
              <span className="block h-4 w-full rounded-sm bg-muted" />
              <span className="block h-4 w-2/3 rounded-sm bg-muted" />
            </div>
          ))
        ) : !timeline || timeline.length === 0 ? (
          <EmptyState
            description={emptyState.description}
            title={emptyState.title}
          />
        ) : (
          timeline.map((event) => (
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
          aria-busy={isLoadingTimelineSnapshot}
          className="mt-layout-md"
          disabled={isLoadingTimelineSnapshot}
          onClick={() => {
            onRequestTimelineSnapshot?.();
            onShowMore();
          }}
          size="sm"
          type="button"
          variant="outline"
        >
          Show more
        </Button>
      ) : null}
    </section>
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

  if (status.bucket === "scheduled_later") {
    return status.lane === "close"
      ? "EOD completion check is scheduled for later."
      : "Opening automation is scheduled for later.";
  }

  if (status.bucket === "needs_review" && status.lane === "close") {
    return "EOD Review needs manager review.";
  }

  if (status.bucket === "policy_skipped" && status.lane === "close") {
    return "EOD automation did not change the workflow. Review EOD manually.";
  }

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
    if (status.bucket === "scheduled_later") {
      return false;
    }

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

function DailyOperationsTopBandShell({
  children,
  icon,
  title,
}: {
  children: ReactNode;
  icon: ReactNode;
  title: string;
}) {
  return (
    <section className="px-layout-md py-layout-sm">
      <div className="flex flex-col gap-layout-md">
        <h3 className="flex shrink-0 items-center gap-layout-xs text-sm font-medium text-foreground">
          {icon}
          {title}
        </h3>
        {children}
      </div>
    </section>
  );
}

function AutomationStatusPanel({
  carryForwardCount,
  completedClose,
  orgUrlSlug,
  showStatuses = true,
  snapshot,
  storeUrlSlug,
  variant = "default",
}: {
  carryForwardCount?: number | null;
  completedClose?: DailyOperationsCompletedCloseAttribution | null;
  orgUrlSlug: string;
  showStatuses?: boolean;
  snapshot: DailyOperationsSnapshot;
  storeUrlSlug: string;
  variant?: "compact" | "default";
}) {
  const statuses = showStatuses ? getVisibleAutomationStatuses(snapshot) : [];
  const hasCompletionAttribution = completedClose?.actorType === "automation";
  const updates: DailyOperationsAutomationUpdate[] = statuses.map((status) => ({
    id: status.id,
    occurredAt: status.occurredAt,
    status,
    type: "status",
  }));

  if (hasCompletionAttribution) {
    updates.push({
      completedClose,
      id: `completion-${completedClose.completedAt ?? "unknown"}`,
      occurredAt: completedClose.completedAt,
      type: "completion",
    });
  }

  updates.sort(
    (left, right) =>
      (right.occurredAt ?? Number.NEGATIVE_INFINITY) -
      (left.occurredAt ?? Number.NEGATIVE_INFINITY),
  );

  if (updates.length === 0) return null;

  if (variant === "compact") {
    return (
      <DailyOperationsTopBandShell
        icon={
          <Bot aria-hidden="true" className="h-4 w-4 text-muted-foreground" />
        }
        title="Athena automation"
      >
        <div className="flex min-w-0 flex-col divide-y divide-border/70">
          {updates.map((update) => {
            if (update.type === "completion") {
              return (
                <article
                  className="py-layout-sm first:pt-0 last:pb-0"
                  key={update.id}
                >
                  <p className="text-sm font-medium leading-5 text-success">
                    Athena completed EOD Review under store policy.
                  </p>
                  <p className="mt-1 text-sm leading-5 text-muted-foreground">
                    {getDailyOperationsCompletionAttributionDetail(
                      update.completedClose,
                      carryForwardCount ??
                        update.completedClose.carryForwardCount ??
                        0,
                    )}
                  </p>
                  {update.occurredAt ? (
                    <p className="mt-1.5 font-numeric text-xs tabular-nums text-muted-foreground">
                      {formatEventTime(update.occurredAt)}
                    </p>
                  ) : null}
                </article>
              );
            }

            const status = update.status;
            const label = getAutomationLaneLabel(status.lane);
            const link = status.sourceLink;

            return (
              <article
                className="flex min-w-0 flex-col gap-layout-xs py-layout-sm first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between"
                key={update.id}
              >
                <div className="min-w-0">
                  <p className="break-words text-sm leading-5 text-foreground">
                    {getAutomationStatusMessage(status)}
                  </p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-layout-xs">
                    {status.occurredAt ? (
                      <p className="font-numeric text-xs tabular-nums text-muted-foreground">
                        {formatEventTime(status.occurredAt)}
                      </p>
                    ) : null}
                  </div>
                </div>
                {link?.to ? (
                  <Button
                    asChild
                    className="h-7 shrink-0 self-start px-2 text-xs sm:ml-layout-md"
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
                      <ArrowUpRight
                        aria-hidden="true"
                        className="h-3.5 w-3.5"
                      />
                    </Link>
                  </Button>
                ) : null}
              </article>
            );
          })}
        </div>
      </DailyOperationsTopBandShell>
    );
  }

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
                    params={buildParams(orgUrlSlug, storeUrlSlug, link.params)}
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

function getDailyOperationsCompletionAttributionDetail(
  completedClose?: DailyOperationsCompletedCloseAttribution | null,
  carryForwardCount = completedClose?.carryForwardCount ?? 0,
) {
  if (completedClose?.actorType !== "automation") {
    return null;
  }

  if (completedClose.restrictedDetailsRedacted) {
    return "Restricted close evidence is hidden for this account.";
  }

  const hasCarryForward = carryForwardCount > 0;
  if (
    completedClose.policyReviewedItemKeys?.length ||
    completedClose.automationDecisionReason
      ?.toLowerCase()
      .includes("low-risk review")
  ) {
    return hasCarryForward
      ? "Policy checked low-risk review evidence and preserved carry-forward work for Opening."
      : "Policy checked low-risk review evidence before completion.";
  }

  return hasCarryForward
    ? "Policy checked the close and preserved carry-forward work for Opening."
    : "Policy checked the close before completion.";
}

function DailyOperationsCompletionAttributionNotice({
  carryForwardCount,
  completedClose,
}: {
  carryForwardCount?: number | null;
  completedClose?: DailyOperationsCompletedCloseAttribution | null;
}) {
  if (completedClose?.actorType !== "automation") {
    return null;
  }

  return (
    <DailyOperationsTopBandShell
      icon={
        <Bot aria-hidden="true" className="h-4 w-4 text-muted-foreground" />
      }
      title="Athena automation"
    >
      <div className="text-sm leading-6">
        <p className="font-medium text-success">
          Athena completed EOD Review under store policy.
        </p>
        <p className="mt-1 text-muted-foreground">
          {getDailyOperationsCompletionAttributionDetail(
            completedClose,
            carryForwardCount ?? completedClose.carryForwardCount ?? 0,
          )}
        </p>
      </div>
    </DailyOperationsTopBandShell>
  );
}

function formatScheduledRunLabel(cronFamily: string) {
  switch (cronFamily) {
    case "auto-verify-payments":
      return "Payment verification";
    case "clear-abandoned-sessions":
      return "Abandoned checkout cleanup";
    case "complete-checkout-sessions":
      return "Checkout completion";
    case "release-checkout-items":
      return "Checkout item release";
    case "release-pos-session-items":
      return "POS item release";
    default:
      return cronFamily.replaceAll("-", " ");
  }
}

function getScheduledRunMessage(run: DailyOperationsScheduledRunSummary) {
  const label = formatScheduledRunLabel(run.cronFamily);

  if (run.outcome === "partial_failure") {
    return `${label} partially ran. ${run.succeededCount} applied, ${run.failedCount} ${
      run.failedCount === 1 ? "needs" : "need"
    } review.`;
  }

  if (run.outcome === "no_candidates") {
    return `${label} ran. No eligible work found.`;
  }

  return `${label} ran. ${run.succeededCount} applied.`;
}

export function ScheduledRunEvidencePanel({
  snapshot,
}: {
  snapshot: DailyOperationsSnapshot;
}) {
  const runs = snapshot.scheduledRunSummaries ?? [];

  if (runs.length === 0) return null;

  return (
    <section className="rounded-md border border-border bg-surface-raised px-layout-md py-layout-sm shadow-surface">
      <div className="flex flex-col gap-layout-sm">
        <h3 className="flex shrink-0 items-center gap-layout-xs text-sm font-medium text-foreground">
          <Clock3
            aria-hidden="true"
            className="h-4 w-4 text-muted-foreground"
          />
          Scheduled runs
        </h3>
        <div className="flex min-w-0 flex-col gap-layout-xs">
          {runs.map((run) => (
            <article
              className="flex min-w-0 flex-col gap-layout-xs"
              key={run.id}
            >
              <p className="text-sm text-foreground">
                {getScheduledRunMessage(run)}
              </p>
              <p className="mt-1.5 font-numeric text-xs tabular-nums text-muted-foreground">
                {formatEventTime(run.completedAt)}
                {run.outcome === "partial_failure"
                  ? ` · ${run.processedCount} checked`
                  : null}
              </p>
            </article>
          ))}
        </div>
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

  const pendingCheckoutCount = evidenceItems.filter(
    isPendingCheckoutReview,
  ).length;
  const otherReviewCount = evidenceItems.length - pendingCheckoutCount;
  const primaryBucketLabel =
    pendingCheckoutCount > 0 ? "Pending checkout" : "Manager review";
  const primaryBucketCount =
    pendingCheckoutCount > 0 ? pendingCheckoutCount : otherReviewCount;

  return (
    <section
      aria-labelledby="daily-operations-opening-review-title"
      className="rounded-lg border border-warning/25 bg-surface-raised p-layout-md shadow-surface"
    >
      <div className="flex items-start justify-between gap-layout-sm">
        <div className="min-w-0 space-y-layout-xs">
          <h3
            className="flex items-center gap-layout-xs text-sm font-medium text-foreground"
            id="daily-operations-opening-review-title"
          >
            <CircleAlert aria-hidden="true" className="h-4 w-4 text-warning" />
            Opening review
          </h3>
          <p className="text-xs leading-5 text-muted-foreground">
            Opening Handoff has carry-forward review items.
          </p>
        </div>
        <Badge
          className="shrink-0 border-warning/30 bg-warning/10 text-warning-foreground shadow-sm"
          variant="outline"
        >
          {formatReviewEvidenceCount(evidenceItems.length)}
        </Badge>
      </div>

      <div className="mt-layout-md rounded-md border border-border/70 bg-background/60 px-layout-sm py-layout-xs">
        <div className="flex items-baseline justify-between gap-layout-sm">
          <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
            {primaryBucketLabel}
          </p>
          <p className="text-base font-medium tabular-nums text-foreground">
            {primaryBucketCount}
          </p>
        </div>
        {pendingCheckoutCount > 0 && otherReviewCount > 0 ? (
          <p className="mt-1 text-xs text-muted-foreground">
            {otherReviewCount} other manager review{" "}
            {otherReviewCount === 1 ? "item" : "items"}
          </p>
        ) : null}
      </div>

      <Button
        asChild
        className="mt-layout-md w-full"
        size="sm"
        variant="outline"
      >
        <Link
          aria-label="Review all Opening Handoff review items"
          params={buildParams(orgUrlSlug, storeUrlSlug)}
          search={
            getWorkflowSearch(
              "/$orgUrlSlug/store/$storeUrlSlug/operations/opening",
              snapshot.operatingDate,
            ) as never
          }
          to="/$orgUrlSlug/store/$storeUrlSlug/operations/opening"
        >
          Review in Opening Handoff
          <ArrowUpRight aria-hidden="true" className="h-3.5 w-3.5" />
        </Link>
      </Button>
    </section>
  );
}

const PENDING_CHECKOUT_REVIEW_PREFIX = "Review pending checkout item:";

function formatReviewEvidenceCount(count: number) {
  return count === 1 ? "1 item to review" : `${count} items to review`;
}

function isPendingCheckoutReview(item: DailyOperationsReviewEvidence) {
  return item.label.startsWith(PENDING_CHECKOUT_REVIEW_PREFIX);
}

function HistoricalWorkflowPanel({
  snapshot,
}: {
  snapshot: DailyOperationsSnapshot;
}) {
  const isClosed = snapshot.lifecycle.status === "closed";
  const isIncompleteStoreDay = shouldShowHistoricalEodReviewAction(snapshot);

  if (isClosed || !isIncompleteStoreDay) return null;

  return (
    <DailyOperationsTopBandShell
      icon={
        <Clock3 aria-hidden="true" className="h-4 w-4 text-muted-foreground" />
      }
      title="Incomplete store-day close"
    >
      <div>
        <p className="text-sm leading-6 text-foreground">
          This historical store day does not have a completed close.
        </p>
        <p className="mt-layout-xs text-sm leading-6 text-muted-foreground">
          Review EOD before treating this date as a closed store-day record.
        </p>
      </div>
    </DailyOperationsTopBandShell>
  );
}

function getTopItemsTitle(operatingDate: string) {
  return operatingDate === getLocalOperatingDate()
    ? "Today's top items"
    : "Top items";
}

function DailyOperationsStorePulsePanel({
  currency,
  hasFullAdminAccess,
  snapshot,
}: {
  currency: string;
  hasFullAdminAccess: boolean;
  snapshot: DailyOperationsSnapshot;
}) {
  const storePulseSummary = buildWeekToDateStorePulseSummary(snapshot);
  const emptyStateTimeContext =
    snapshot.operatingDate === getLocalOperatingDate()
      ? "current"
      : "historical";

  return (
    <section className="space-y-layout-md">
      {storePulseSummary ? (
        <StorePulseSummaryView
          canViewFinancialDetails={hasFullAdminAccess}
          chartAnimationKey={snapshot.operatingDate}
          currencyFormatter={currencyFormatter(currency)}
          onPulseWindowChange={() => undefined}
          pulseWindow="this_week"
          showPulseWindowFilter={false}
          showSummaryMetrics={false}
          summary={storePulseSummary}
          detailVariant="canvas"
          emptyStateTimeContext={emptyStateTimeContext}
          timelineVariant="canvas"
          topItemsTitle={getTopItemsTitle(snapshot.operatingDate)}
        />
      ) : (
        <div className="rounded-lg border border-border bg-surface p-layout-md shadow-surface">
          <EmptyState
            description="Store pulse is not available for this view. Financially restricted or historical snapshots can omit POS pulse details."
            title="Store pulse unavailable"
          />
        </div>
      )}
    </section>
  );
}

function buildWeekToDateStorePulseSummary(
  snapshot: DailyOperationsSnapshot,
): StorePulseSummary | null | undefined {
  const summary = snapshot.storePulse;
  const operatorSnapshot = summary?.operatorSnapshot;

  if (!summary || !operatorSnapshot) return summary;

  const knownTrendByDate = new Map(
    operatorSnapshot.trend.map((day) => [day.date, day]),
  );
  const weekToDateTrend = snapshot.weekMetrics
    .filter((metric) => metric.operatingDate <= snapshot.operatingDate)
    .map((metric): StorePulseTrendDay => {
      return buildStorePulseTrendDayFromMetric(
        metric,
        knownTrendByDate.get(metric.operatingDate),
      );
    });

  if (weekToDateTrend.length === 0) return summary;

  return {
    ...summary,
    operatorSnapshot: {
      ...operatorSnapshot,
      historyDays: Math.max(
        operatorSnapshot.historyDays,
        weekToDateTrend.length,
      ),
      trend: weekToDateTrend,
      usableHistoryDays: Math.max(
        operatorSnapshot.usableHistoryDays,
        weekToDateTrend.filter((day) => day.transactionCount > 0).length,
      ),
    },
  };
}

function buildCachedWeekStorePulseSummary(
  snapshot: DailyOperationsSnapshot,
): StorePulseSummary | null | undefined {
  const summary = snapshot.storePulse;
  const operatorSnapshot = summary?.operatorSnapshot;
  if (!summary || !operatorSnapshot) {
    return buildWeekMetricStorePulseSummary(snapshot);
  }

  const knownTrendByDate = new Map(
    operatorSnapshot.trend.map((day) => [day.date, day]),
  );
  const weekTrend = snapshot.weekMetrics.map((metric): StorePulseTrendDay => {
    return buildStorePulseTrendDayFromMetric(
      metric,
      knownTrendByDate.get(metric.operatingDate),
    );
  });

  if (weekTrend.length === 0) return summary;

  return {
    ...summary,
    operatorSnapshot: {
      ...operatorSnapshot,
      historyDays: Math.max(operatorSnapshot.historyDays, weekTrend.length),
      trend: weekTrend,
      usableHistoryDays: Math.max(
        operatorSnapshot.usableHistoryDays,
        weekTrend.filter((day) => day.transactionCount > 0).length,
      ),
    },
  };
}

function buildWeekMetricStorePulseSummary(
  snapshot: DailyOperationsSnapshot,
): StorePulseSummary | null {
  const trend = snapshot.weekMetrics.map((metric): StorePulseTrendDay => {
    return buildStorePulseTrendDayFromMetric(metric);
  });
  const selectedMetric =
    snapshot.weekMetrics.find(
      (metric) => metric.operatingDate === snapshot.operatingDate,
    ) ?? snapshot.weekMetrics.at(-1);

  if (!trend.length || !selectedMetric) return null;

  const selectedAverageTransaction =
    selectedMetric.transactionCount > 0
      ? selectedMetric.salesTotal / selectedMetric.transactionCount
      : 0;

  return {
    averageTransaction: selectedAverageTransaction,
    date: snapshot.operatingDate,
    operatorSnapshot: {
      busiestHour: null,
      comparison: {
        averageTransactionDeltaPercent: 0,
        currentAverageTransaction: selectedAverageTransaction,
        currentItemsSold: 0,
        currentSales: selectedMetric.salesTotal,
        currentTransactions: selectedMetric.transactionCount,
        itemsSoldDeltaPercent: 0,
        salesDeltaPercent: 0,
        transactionDeltaPercent: 0,
        yesterdayAverageTransaction: 0,
        yesterdayItemsSold: 0,
        yesterdaySales: 0,
        yesterdayTransactions: 0,
      },
      historyDays: trend.length,
      isLimited: false,
      paymentMix: [],
      topItems: [],
      trend,
      usableHistoryDays: trend.filter((day) => day.transactionCount > 0).length,
    },
    totalItemsSold: 0,
    totalSales: selectedMetric.salesTotal,
    totalTransactions: selectedMetric.transactionCount,
  };
}

function buildStorePulseTrendDayFromMetric(
  metric: DailyOperationsSnapshot["weekMetrics"][number],
  knownTrendDay?: StorePulseTrendDay,
): StorePulseTrendDay {
  return {
    averageTransaction:
      metric.transactionCount > 0
        ? metric.salesTotal / metric.transactionCount
        : 0,
    date: metric.operatingDate,
    hasKnownItemCount: false,
    label: knownTrendDay?.label ?? formatOperatingDate(metric.operatingDate),
    totalItemsSold: 0,
    totalSales: metric.salesTotal,
    transactionCount: metric.transactionCount,
  };
}

function buildCachedStorePulseForOperatingDate({
  operatingDate,
  selectedDayStorePulse,
  weekStorePulse,
}: {
  operatingDate: string;
  selectedDayStorePulse?: StorePulseSummary | null;
  weekStorePulse?: StorePulseSummary | null;
}): StorePulseSummary | null | undefined {
  const baseSummary = selectedDayStorePulse ?? weekStorePulse;
  const weekOperatorSnapshot = weekStorePulse?.operatorSnapshot;
  const selectedDayOperatorSnapshot = selectedDayStorePulse?.operatorSnapshot;

  if (!baseSummary) return baseSummary;

  const combinedSummary =
    weekOperatorSnapshot && selectedDayOperatorSnapshot
      ? {
          ...baseSummary,
          operatorSnapshot: {
            ...selectedDayOperatorSnapshot,
            historyDays: weekOperatorSnapshot.historyDays,
            trend: mergeSelectedStorePulseTrend(
              weekOperatorSnapshot.trend,
              selectedDayOperatorSnapshot.trend,
            ),
            usableHistoryDays: weekOperatorSnapshot.usableHistoryDays,
          },
        }
      : baseSummary;

  return selectStorePulseTrendThroughOperatingDate(
    combinedSummary,
    operatingDate,
  );
}

function mergeSelectedStorePulseTrend(
  weekTrend: StorePulseTrendDay[],
  selectedDayTrend: StorePulseTrendDay[],
) {
  const selectedTrendByDate = new Map(
    selectedDayTrend.map((day) => [day.date, day]),
  );

  return weekTrend.map((weekDay) => {
    const selectedDay = selectedTrendByDate.get(weekDay.date);
    if (!selectedDay) return weekDay;

    return {
      ...weekDay,
      hasKnownItemCount: false,
      totalItemsSold: 0,
    };
  });
}

function selectStorePulseTrendThroughOperatingDate(
  summary: StorePulseSummary | null | undefined,
  operatingDate: string,
): StorePulseSummary | null | undefined {
  const operatorSnapshot = summary?.operatorSnapshot;

  if (!summary || !operatorSnapshot) return summary;

  const trend = operatorSnapshot.trend.filter(
    (day) => day.date <= operatingDate,
  );

  if (trend.length === operatorSnapshot.trend.length) return summary;

  return {
    ...summary,
    operatorSnapshot: {
      ...operatorSnapshot,
      historyDays: trend.length,
      trend,
      usableHistoryDays: trend.filter((day) => day.transactionCount > 0).length,
    },
  };
}

function mergeDailyOperationsSnapshots(
  baseSnapshot: DailyOperationsSnapshot,
  detailSnapshot: DailyOperationsSnapshot,
): DailyOperationsSnapshot {
  return {
    ...baseSnapshot,
    ...detailSnapshot,
    scheduledRunSummaries:
      detailSnapshot.scheduledRunSummaries?.length === 0
        ? baseSnapshot.scheduledRunSummaries
        : detailSnapshot.scheduledRunSummaries,
    timeline:
      detailSnapshot.timeline.length === 0
        ? baseSnapshot.timeline
        : detailSnapshot.timeline,
    timelineHasMore:
      detailSnapshot.timeline.length === 0
        ? baseSnapshot.timelineHasMore
        : detailSnapshot.timelineHasMore,
  };
}

function areTimelinePreviewSnapshotsEqual(
  left: DailyOperationsTimelinePreviewSnapshot | undefined,
  right: DailyOperationsTimelinePreviewSnapshot,
) {
  if (!left) return false;
  if (left.operatingDate !== right.operatingDate) return false;
  if (left.timelineHasMore !== right.timelineHasMore) return false;
  if (left.timeline.length !== right.timeline.length) return false;

  return left.timeline.every(
    (event, index) =>
      event.id === right.timeline[index]?.id &&
      event.createdAt === right.timeline[index]?.createdAt,
  );
}

function normalizeDailyOperationsSnapshotWithWeekMetric(
  snapshot: DailyOperationsSnapshot,
  metric: DailyOperationsSnapshot["weekMetrics"][number],
  weekMetrics: DailyOperationsSnapshot["weekMetrics"],
): DailyOperationsSnapshot {
  const selectedWeekMetrics = selectWeekMetricsForOperatingDate(
    weekMetrics,
    snapshot.operatingDate,
  );

  return {
    ...snapshot,
    closeSummary: {
      ...snapshot.closeSummary,
      currentDayCashTotal: metric.currentDayCashTotal,
      currentDayCashTransactionCount: metric.currentDayCashTransactionCount,
      expenseTotal: metric.expenseTotal,
      expenseTransactionCount: metric.expenseTransactionCount,
      paymentTotals:
        metric.paymentTotals?.map((paymentTotal) => ({
          ...paymentTotal,
          transactionCount: paymentTotal.transactionCount ?? undefined,
        })) ?? [],
      salesTotal: metric.salesTotal,
      transactionCount: metric.transactionCount,
    },
    priorDayMetric: selectedWeekMetrics.find(
      (weekMetric) =>
        weekMetric.operatingDate ===
        getPreviousOperatingDate(snapshot.operatingDate),
    ),
    weekMetrics: selectedWeekMetrics,
  };
}

const WEEK_METRICS_PREVIEW_HEIGHT = 28;
const WEEKDAY_PREVIEW_LABELS = [
  "Sun",
  "Mon",
  "Tue",
  "Wed",
  "Thu",
  "Fri",
  "Sat",
];

function handleDeferredAnalyticsKeyDown(
  event: KeyboardEvent<HTMLElement>,
  onRequest: () => void,
) {
  if (event.key !== "Enter" && event.key !== " ") return;

  event.preventDefault();
  onRequest();
}

function DailyOperationsWeekMetricsPreview({
  isLoading,
  metrics,
  onRequest,
  operatingDate,
}: {
  isLoading?: boolean;
  metrics: DailyOperationsSnapshot["weekMetrics"];
  onRequest: () => void;
  operatingDate: string;
}) {
  const previewWeekStart = getSundayWeekStartOperatingDate(operatingDate);
  const previewMetrics =
    metrics.length > 0
      ? metrics
      : WEEKDAY_PREVIEW_LABELS.map((_, index) => ({
          isClosed: index < 3,
          isReopened: false,
          isSelected: false,
          operatingDate: shiftLocalOperatingDate(previewWeekStart, index),
          transactionCount: 0,
        }));
  const weekEndOperatingDate = metrics.at(-1)?.operatingDate;

  return (
    <section className="space-y-layout-sm">
      <div className="flex flex-col gap-layout-xs sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h3 className="text-base font-medium text-foreground">
            Week at a glance
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {weekEndOperatingDate
              ? `Seven days ending ${formatOperatingDate(weekEndOperatingDate)}.`
              : "Seven-day sales and close status."}
          </p>
        </div>
        <div className="flex flex-col gap-layout-sm sm:flex-row sm:items-center">
          <p className="flex items-baseline justify-between gap-2 text-sm text-muted-foreground sm:justify-start">
            <span>Week sales</span>
            <span className="font-numeric text-base font-semibold tabular-nums text-muted-foreground">
              -
            </span>
          </p>
          <Button
            className="w-full shrink-0 transition-[background-color,border-color,color,transform] duration-150 ease-out active:scale-[0.98] sm:w-auto"
            disabled={isLoading}
            onClick={onRequest}
            size="sm"
            type="button"
            variant="outline"
          >
            {isLoading ? "Loading analytics" : "Load analytics"}
          </Button>
        </div>
      </div>
      <div
        aria-label="Load analytics for week at a glance"
        className="group relative cursor-pointer overflow-x-auto rounded-lg border border-border bg-surface-raised p-layout-sm shadow-surface transition-[box-shadow] duration-200 ease-out hover:shadow-sm focus:outline-none focus-visible:border-primary-border focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-within:border-primary-border focus-within:shadow-sm"
        onClick={() => {
          if (!isLoading) onRequest();
        }}
        onKeyDown={(event) => {
          if (!isLoading) handleDeferredAnalyticsKeyDown(event, onRequest);
        }}
        role="button"
        tabIndex={isLoading ? -1 : 0}
      >
        <DailyOperationsDeferredAnalyticsAction
          className="absolute right-layout-sm top-layout-sm z-10"
          isLoading={isLoading}
        />
        <div className="flex min-w-max snap-x gap-layout-xs md:grid md:min-w-[42rem] md:grid-cols-7">
          {previewMetrics.map((metric, index) => (
            <article
              className={cn(
                "w-[10.5rem] shrink-0 snap-start rounded-md border px-layout-sm py-layout-sm text-left text-muted-foreground md:w-auto",
                metric.isSelected
                  ? "border-primary-border bg-primary-soft ring-1 ring-inset ring-primary-border"
                  : "border-transparent",
              )}
              key={metric.operatingDate || index}
            >
              <div className="flex items-center justify-between gap-layout-xs">
                <span className="text-xs font-medium uppercase tracking-wide">
                  {metric.operatingDate
                    ? formatWeekdayLabel(metric.operatingDate)
                    : WEEKDAY_PREVIEW_LABELS[index]}
                </span>
              </div>
              {metric.operatingDate ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  {formatWeekdayDate(metric.operatingDate)}
                </p>
              ) : null}
              <div className="mt-layout-sm h-12">
                <span
                  aria-hidden="true"
                  className="block w-full rounded-sm bg-muted"
                  style={{ height: WEEK_METRICS_PREVIEW_HEIGHT }}
                />
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function DailyOperationsStorePulsePreview({
  cachedSelectedStorePulse,
  cachedStorePulse,
  currency,
  hasFullAdminAccess,
  isLoading,
  onRequest,
  operatingDate,
}: {
  cachedSelectedStorePulse?: StorePulseSummary | null;
  cachedStorePulse?: StorePulseSummary | null;
  currency: string;
  hasFullAdminAccess: boolean;
  isLoading?: boolean;
  onRequest: () => void;
  operatingDate: string;
}) {
  const topItemsTitle = getTopItemsTitle(operatingDate);
  const emptyStateTimeContext =
    operatingDate === getLocalOperatingDate() ? "current" : "historical";
  const selectedCachedStorePulse = buildCachedStorePulseForOperatingDate({
    operatingDate,
    selectedDayStorePulse: cachedSelectedStorePulse,
    weekStorePulse: cachedStorePulse,
  });
  const selectedCachedStorePulseTrend =
    selectStorePulseTrendThroughOperatingDate(cachedStorePulse, operatingDate);
  const hasCachedPulseTrendChart = Boolean(
    selectedCachedStorePulseTrend?.operatorSnapshot?.trend.length,
  );
  const detailSnapshot = cachedSelectedStorePulse?.operatorSnapshot
    ? selectedCachedStorePulse?.operatorSnapshot
    : undefined;

  return (
    <section
      aria-label="Store pulse"
      className="space-y-layout-xl md:space-y-layout-2xl"
    >
      <section className="space-y-layout-2xl">
        {hasCachedPulseTrendChart ? (
          <StorePulseTimeline
            animationKey={operatingDate}
            canViewFinancialDetails={hasFullAdminAccess}
            description="Synced sales trend through the selected day."
            currencyFormatter={currencyFormatter(currency)}
            pulseWindow="this_week"
            snapshot={selectedCachedStorePulseTrend!.operatorSnapshot!}
            variant="canvas"
          />
        ) : (
          <section
            aria-label="Sales trend preview"
            className="space-y-layout-sm"
          >
            <div className="flex flex-col gap-layout-xs sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h3 className="text-base font-medium text-foreground">
                  Sales trend
                </h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  Store pulse detail loads with analytics.
                </p>
              </div>
              <span className="rounded-md border border-border bg-background px-2 py-1 text-xs font-medium text-muted-foreground">
                Paused
              </span>
            </div>
            <div
              aria-label="Load analytics for sales trend"
              className="group relative cursor-pointer py-8 transition-[background-color] duration-200 ease-out hover:bg-surface/45 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              onClick={() => {
                if (!isLoading) onRequest();
              }}
              onKeyDown={(event) => {
                if (!isLoading)
                  handleDeferredAnalyticsKeyDown(event, onRequest);
              }}
              role="button"
              tabIndex={isLoading ? -1 : 0}
            >
              <DailyOperationsDeferredAnalyticsAction
                className="absolute right-layout-md top-layout-md z-10"
                isLoading={isLoading}
              />
              <div className="relative h-[22rem] w-full">
                <div className="absolute inset-y-0 left-0 flex w-16 flex-col justify-between py-1">
                  {Array.from({ length: 5 }).map((_, index) => (
                    <span
                      aria-hidden="true"
                      className="h-3 w-12 rounded-sm bg-muted"
                      key={index}
                    />
                  ))}
                </div>
                <div
                  className="absolute inset-y-0 left-20 right-0 flex flex-col justify-between"
                  data-testid="sales-trend-preview-grid"
                >
                  {Array.from({ length: 5 }).map((_, index) => (
                    <span
                      aria-hidden="true"
                      className="h-px w-full rounded-sm bg-muted"
                      key={index}
                    />
                  ))}
                </div>
              </div>
            </div>
          </section>
        )}
      </section>

      <PageWorkspaceGrid className="xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <PageWorkspaceMain>
          {detailSnapshot ? (
            <TopItemsPanel
              canViewFinancialDetails={hasFullAdminAccess}
              currencyFormatter={currencyFormatter(currency)}
              emptyStateTimeContext={emptyStateTimeContext}
              variant="canvas"
              snapshot={detailSnapshot}
              title={topItemsTitle}
            />
          ) : (
            <DailyOperationsStorePulsePreviewList
              description="Highest-volume items for the selected day."
              isLoading={isLoading}
              onRequest={onRequest}
              rowCount={5}
              title={topItemsTitle}
              variant="canvas"
            />
          )}
        </PageWorkspaceMain>
        <PageWorkspaceRail>
          {detailSnapshot ? (
            <PaymentMethodsPanel
              emptyStateTimeContext={emptyStateTimeContext}
              variant="canvas"
              snapshot={detailSnapshot}
            />
          ) : (
            <DailyOperationsStorePulsePreviewList
              description="Share of synced POS sales by payment method."
              isLoading={isLoading}
              onRequest={onRequest}
              rowCount={3}
              title="How customers paid"
              variant="canvas"
            />
          )}
        </PageWorkspaceRail>
      </PageWorkspaceGrid>
    </section>
  );
}

function DailyOperationsStorePulsePreviewList({
  description,
  isLoading,
  onRequest,
  rowCount,
  title,
  variant = "card",
}: {
  description: string;
  isLoading?: boolean;
  onRequest: () => void;
  rowCount: number;
  title: string;
  variant?: "card" | "canvas";
}) {
  const panelClassName =
    variant === "canvas"
      ? "group relative cursor-pointer transition-[background-color] duration-200 ease-out hover:bg-surface/45 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-within:bg-surface/45"
      : "group relative cursor-pointer rounded-lg border border-border bg-surface-raised shadow-surface transition-[box-shadow] duration-200 ease-out hover:shadow-sm focus:outline-none focus-visible:border-primary-border focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-within:border-primary-border focus-within:shadow-sm";
  const rowClassName =
    variant === "canvas"
      ? "grid gap-2 py-layout-sm sm:grid-cols-[auto_minmax(0,1fr)] sm:items-center"
      : "grid gap-2 px-layout-md py-layout-sm sm:grid-cols-[auto_minmax(0,1fr)] sm:items-center";

  return (
    <section aria-label={`${title} preview`} className="space-y-layout-md">
      <div>
        <h3 className="text-base font-medium text-foreground">{title}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      <div
        aria-label={`Load analytics for ${title}`}
        className={panelClassName}
        onClick={() => {
          if (!isLoading) onRequest();
        }}
        onKeyDown={(event) => {
          if (!isLoading) handleDeferredAnalyticsKeyDown(event, onRequest);
        }}
        role="button"
        tabIndex={isLoading ? -1 : 0}
      >
        <DailyOperationsDeferredAnalyticsAction
          className="absolute right-layout-sm top-layout-sm z-10"
          isLoading={isLoading}
        />
        <div className="divide-y divide-border/70">
          {Array.from({ length: rowCount }).map((_, index) => (
            <div className={rowClassName} key={index}>
              <span
                aria-hidden="true"
                className="h-6 w-6 rounded-sm bg-muted"
              />
              <div className="min-w-0">
                <span
                  aria-hidden="true"
                  className="block h-4 w-32 rounded-sm bg-muted"
                />
                <span
                  aria-hidden="true"
                  className="mt-2 block h-3 w-44 max-w-full rounded-sm bg-muted"
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function DailyOperationsDeferredAnalyticsAction({
  className,
  isLoading,
}: {
  className?: string;
  isLoading?: boolean;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex h-9 translate-y-1 items-center justify-center gap-2 whitespace-nowrap rounded-md border border-border bg-background px-3 text-sm font-medium text-foreground opacity-0 shadow-surface transition-[opacity,transform] duration-200 ease-out group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:translate-y-0 group-focus-within:opacity-100",
        className,
      )}
    >
      {isLoading ? "Loading analytics" : "Load analytics"}
    </span>
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
      className="mt-layout-md px-layout-sm py-2"
    >
      <h4 className="sr-only" id="supporting-workspaces-heading">
        Supporting workspaces
      </h4>
      <div className="grid gap-layout-xs md:grid-cols-3">
        {SUPPORTING_OPERATIONS_WORKSPACE_LINKS.map((workspace) => {
          const Icon = workspace.icon;

          return (
            <Link
              aria-label={`Open ${workspace.label} workspace`}
              className="group flex min-w-0 items-center gap-2 rounded-md border border-transparent px-2 py-1.5 text-left transition-colors hover:border-border/60 hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              key={workspace.label}
              params={buildParams(orgUrlSlug, storeUrlSlug)}
              search={getWorkflowSearch(workspace.to, operatingDate) as never}
              to={workspace.to}
            >
              <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-border/70 bg-surface text-muted-foreground transition-colors group-hover:text-foreground">
                <Icon aria-hidden="true" className="h-3.5 w-3.5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-medium text-foreground">
                  {workspace.label}
                </span>
              </span>
              <ArrowUpRight
                aria-hidden="true"
                className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground"
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
          defaultMonth={selectedDate ?? latestSelectableDate}
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
  analyticsFetchedAt,
  currency,
  hasFinancialDetailsAccess,
  isRefreshingToday,
  metrics,
  onRefreshToday,
  orgUrlSlug,
  storePulseWindow,
  storeUrlSlug,
  todayRefreshedAt,
}: {
  analyticsFetchedAt?: number;
  currency: string;
  hasFinancialDetailsAccess: boolean;
  isRefreshingToday?: boolean;
  metrics: DailyOperationsSnapshot["weekMetrics"];
  onRefreshToday?: () => void;
  orgUrlSlug: string;
  storePulseWindow: StorePulseWindow;
  storeUrlSlug: string;
  todayRefreshedAt?: number;
}) {
  const scrollSelectedDayIntoView = useCallback(
    (element: HTMLElement | null) => {
      element?.scrollIntoView({
        behavior: "auto",
        block: "nearest",
        inline: "center",
      });
    },
    [],
  );

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
  const selectedMetric = metrics.find((metric) => metric.isSelected);
  const canRefreshToday = Boolean(
    onRefreshToday &&
    selectedMetric?.operatingDate === currentOperatingDate &&
    selectedMetric.operatingDate <= currentOperatingDate,
  );
  const refreshedAt = todayRefreshedAt ?? analyticsFetchedAt;

  return (
    <section className="space-y-layout-sm">
      <div className="flex flex-col gap-layout-xs sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h3 className="text-base font-medium text-foreground">
            Week at a glance
          </h3>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
            <span className="basis-full sm:basis-auto">
              Seven days ending {formatOperatingDate(weekEndOperatingDate)}
            </span>
            {refreshedAt ? (
              <span aria-hidden="true" className="hidden sm:inline">
                ·
              </span>
            ) : null}
            {refreshedAt ? (
              <span className="whitespace-nowrap">
                Data refreshed at {formatAnalyticsCacheTimestamp(refreshedAt)}
              </span>
            ) : null}
            {canRefreshToday ? (
              <Button
                aria-label="Refresh"
                className="h-7 w-7"
                disabled={isRefreshingToday}
                onClick={onRefreshToday}
                size="icon"
                type="button"
                variant="outline"
              >
                <RefreshCw
                  aria-hidden="true"
                  className={cn(
                    "h-3.5 w-3.5",
                    isRefreshingToday ? "animate-spin" : undefined,
                  )}
                />
              </Button>
            ) : null}
          </div>
        </div>
        <div className="flex flex-col gap-layout-sm sm:flex-row sm:items-center">
          <p className="flex items-baseline justify-between gap-2 text-sm text-muted-foreground sm:justify-start">
            <span>Week sales</span>
            <span className="font-numeric text-base font-semibold tabular-nums text-foreground">
              <FinancialValue
                canView={hasFinancialDetailsAccess}
                label="Week sales"
              >
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
                  storePulseWindow,
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
                    storePulseWindow,
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
      <div className="overflow-x-auto">
        <div className="flex min-w-max snap-x gap-layout-xs md:grid md:min-w-[42rem] md:grid-cols-7">
          {metrics.map((metric) => {
            const isFutureDate = metric.operatingDate > currentOperatingDate;
            const cardClassName = cn(
              "w-[10.5rem] shrink-0 snap-start rounded-md border px-layout-sm py-layout-sm text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:w-auto",
              metric.isSelected
                ? "border-primary-border bg-primary-soft text-foreground ring-1 ring-inset ring-primary-border"
                : "border-transparent text-muted-foreground",
              isFutureDate
                ? "cursor-not-allowed opacity-60"
                : metric.isSelected
                  ? "hover:bg-primary-soft"
                  : "hover:bg-background",
            );
            const content = (
              <>
                <div className="flex items-center justify-between gap-layout-xs">
                  <span className="text-xs font-medium uppercase tracking-wide">
                    {formatWeekdayLabel(metric.operatingDate)}
                  </span>
                  {metric.isReopened ? (
                    <span className="rounded-full bg-warning/10 px-1.5 py-0.5 text-[10px] font-medium text-warning">
                      Reopened
                    </span>
                  ) : metric.isClosed ? (
                    <span className="inline-flex items-center gap-1 text-[10px] font-medium text-muted-foreground">
                      <span
                        aria-hidden="true"
                        className="h-1 w-1 rounded-full bg-success/70"
                      />
                      Closed
                    </span>
                  ) : null}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {formatWeekdayDate(metric.operatingDate)}
                </p>
                <p className="mt-layout-sm font-numeric text-lg tabular-nums text-foreground">
                  {isFutureDate ? (
                    "-"
                  ) : (
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
                  data-week-metric-selected={
                    metric.isSelected ? "true" : undefined
                  }
                  key={metric.operatingDate}
                  ref={
                    metric.isSelected ? scrollSelectedDayIntoView : undefined
                  }
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
                data-week-metric-selected={
                  metric.isSelected ? "true" : undefined
                }
                key={metric.operatingDate}
                params={buildParams(orgUrlSlug, storeUrlSlug)}
                ref={metric.isSelected ? scrollSelectedDayIntoView : undefined}
                search={buildDailyOperationsSearch({
                  operatingDate: metric.operatingDate,
                  storePulseWindow,
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
  cachedPriorWeekBoundaryMetric,
  cachedWeekAnalyticsFetchedAt,
  cachedWeekMetrics,
  cachedWeekStorePulse,
  canViewAutomationStatuses,
  currency,
  hasDetailSnapshot,
  hasFullAdminAccess,
  hasFinancialDetailsAccess,
  isLoadingDetailSnapshot,
  isLoadingStorePulseSnapshot,
  isLoadingTimelinePreviewSnapshot,
  isLoadingTimelineSnapshot,
  isTimelineSheetOpen: controlledTimelineSheetOpen,
  isRefreshingToday,
  isAuthenticated,
  isLoadingAccess,
  isLoadingSnapshot,
  onRequestDetailSnapshot,
  onRefreshToday,
  onRequestStorePulseSnapshot,
  onRequestTimelineSnapshot,
  onTimelineSheetOpenChange,
  onOperatingDateChange,
  openRegisterSessionsSnapshot,
  orgUrlSlug,
  snapshot,
  storePulseWindow,
  storeUrlSlug,
  storePulseSnapshot,
  storeRequestsSnapshot,
  todayRefreshedAt,
  timelinePreviewSnapshot,
  timelineSnapshot,
}: DailyOperationsViewContentProps) {
  const [localTimelineSheetOpen, setLocalTimelineSheetOpen] = useState(false);
  const shouldShowAutomationStatuses =
    canViewAutomationStatuses ?? hasFullAdminAccess;
  const isMobile = useIsMobile();
  const isTimelineSheetOpen =
    controlledTimelineSheetOpen ?? localTimelineSheetOpen;
  const setTimelineSheetOpen = (open: boolean) => {
    setLocalTimelineSheetOpen(open);
    onTimelineSheetOpenChange?.(open);
  };

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

  const timelinePreview =
    snapshot &&
    timelinePreviewSnapshot?.operatingDate === snapshot.operatingDate
      ? timelinePreviewSnapshot
      : undefined;
  const previewTimeline = timelinePreview?.timeline;
  const hasMoreTimelineEvents = timelinePreview?.timelineHasMore ?? false;
  const fullTimelineEvents =
    snapshot && timelineSnapshot?.operatingDate === snapshot.operatingDate
      ? timelineSnapshot.timeline
      : undefined;
  const metricLabels = snapshot
    ? getDailyOperationsMetricLabels(snapshot.operatingDate)
    : undefined;
  const otherPaymentTotals = snapshot
    ? getOtherPaymentTotals(snapshot.closeSummary)
    : [];
  const priorComparisonMetric = snapshot
    ? getPriorComparisonMetric(
        snapshot,
        cachedWeekMetrics,
        cachedPriorWeekBoundaryMetric,
      )
    : undefined;
  const priorWindowLabel = snapshot
    ? getPriorWindowLabel(snapshot.operatingDate)
    : "yesterday";
  const showPrimaryAction = snapshot
    ? shouldShowPrimaryAction(snapshot)
    : false;
  const showHistoricalEodReviewAction = snapshot
    ? shouldShowHistoricalEodReviewAction(snapshot)
    : false;
  const isHistoricalDate = snapshot
    ? isHistoricalOperatingDate(snapshot.operatingDate)
    : false;
  const shouldShowHistoricalWorkflowPanel =
    isHistoricalDate && showHistoricalEodReviewAction;
  const hasAutomationCompletion =
    snapshot?.completedClose?.actorType === "automation";
  const shouldShowCurrentAutomationBand = Boolean(
    !isHistoricalDate &&
    ((shouldShowAutomationStatuses &&
      snapshot &&
      getVisibleAutomationStatuses(snapshot).length > 0) ||
      hasAutomationCompletion),
  );
  const shouldShowHistoricalAutomationCompletion = Boolean(
    hasAutomationCompletion && !shouldShowCurrentAutomationBand,
  );
  const primaryActionEmphasisStatus = snapshot
    ? getPrimaryActionEmphasisStatus({
        isHistoricalDate,
        status: snapshot.lifecycle.status,
      })
    : undefined;
  const primaryActionEmphasis = primaryActionEmphasisStatus
    ? getPrimaryActionEmphasis(primaryActionEmphasisStatus)
    : null;
  const PrimaryActionIcon = primaryActionEmphasis?.Icon;
  const showPrimaryActionStatusIcon =
    primaryActionEmphasisStatus === "close_blocked";
  const storeRequestsApprovalsLane =
    snapshot && storeRequestsSnapshot?.operatingDate === snapshot.operatingDate
      ? storeRequestsSnapshot.approvalsLane
      : undefined;
  const operationLanes = snapshot
    ? replaceApprovalsLane(snapshot.lanes, storeRequestsApprovalsLane)
    : [];
  const pendingApprovalsLane = getPendingApprovalsLaneFromLanes(operationLanes);
  const snapshotOpenRegisterSessions = !isHistoricalDate
    ? (snapshot?.attentionItems.filter(
        (item) =>
          item.source.type === "register_session" &&
          item.registerSession?.isOpenedForOperatingDate === true &&
          item.params?.sessionId !== undefined &&
          item.to !== undefined,
      ) ?? [])
    : [];
  const openRegisterSessions =
    openRegisterSessionsSnapshot &&
    snapshot &&
    Array.isArray(openRegisterSessionsSnapshot.sessions) &&
    openRegisterSessionsSnapshot.operatingDate === snapshot.operatingDate
      ? openRegisterSessionsSnapshot.sessions.map((session) => ({
          id: session.id,
          label: "Register session is still open",
          message: "",
          owner: "daily_close" as const,
          params: { sessionId: session.id },
          registerSession: {
            displayLabel: session.displayLabel,
            isOpenedForOperatingDate: true,
          },
          severity: "critical" as const,
          source: { id: session.id, type: "register_session" },
          to: "/$orgUrlSlug/store/$storeUrlSlug/cash-controls/registers/$sessionId",
        }))
      : snapshotOpenRegisterSessions;
  const actionableLanes = operationLanes.filter(isActionableLane);
  const hasAutomationReviewEvidence = Boolean(
    snapshot?.automationStatuses?.some(
      (status) =>
        status.lane === "opening" &&
        status.outcome === "applied" &&
        (status.reviewEvidence?.length ?? 0) > 0,
    ),
  );
  const weekMetricsForDisplay = cachedWeekMetrics ?? snapshot?.weekMetrics;
  const hasHydratedWeekAnalytics =
    cachedWeekMetrics !== undefined ||
    (hasDetailSnapshot && Boolean(snapshot?.weekMetrics.length));
  const weekAnalyticsFetchedAt = hasHydratedWeekAnalytics
    ? cachedWeekAnalyticsFetchedAt
    : undefined;
  const selectedWeekOperatingDate =
    cachedWeekMetrics?.find((metric) => metric.isSelected)?.operatingDate ??
    snapshot?.operatingDate;
  const loadedStorePulse =
    snapshot && storePulseSnapshot?.operatingDate === snapshot.operatingDate
      ? storePulseSnapshot.storePulse
      : snapshot?.storePulse;
  const storePulseDetailSnapshot =
    snapshot && loadedStorePulse !== undefined
      ? {
          ...snapshot,
          storePulse: loadedStorePulse,
        }
      : undefined;
  const requestStorePulseSnapshot =
    onRequestStorePulseSnapshot ?? onRequestDetailSnapshot;
  const storePulsePreviewSummary =
    cachedWeekStorePulse ?? storePulseDetailSnapshot?.storePulse;

  return (
    <View hideBorder hideHeaderBottomBorder scrollMode="page">
      <FadeIn className="container mx-auto w-full py-layout-lg md:py-layout-xl">
        <PageWorkspace className="md:space-y-layout-3xl">
          <PageLevelHeader
            eyebrow="Store Ops"
            title="Daily Operations"
            description="Review the store day, see what needs attention, and move into the workflow that owns the next action."
          />

          {isLoadingSnapshot || !snapshot ? null : (
            <PageWorkspace className="space-y-layout-2xl md:space-y-layout-3xl">
              <section className="space-y-layout-2xl md:space-y-layout-3xl">
                <div className="flex flex-col gap-layout-sm lg:flex-row lg:items-center lg:justify-between">
                  {pendingApprovalsLane ? (
                    <div className="flex flex-col gap-layout-sm sm:flex-row sm:items-center">
                      <Button
                        asChild
                        className="w-full sm:w-auto"
                        variant="outline"
                      >
                        <Link
                          aria-label={`Open ${formatPendingApprovalsLabel(
                            pendingApprovalsLane,
                          )}`}
                          params={buildParams(orgUrlSlug, storeUrlSlug)}
                          search={
                            getWorkflowSearch(
                              pendingApprovalsLane.to,
                              snapshot.operatingDate,
                            ) as never
                          }
                          to={pendingApprovalsLane.to}
                        >
                          <span className="font-numeric font-semibold tabular-nums text-foreground">
                            {getPendingApprovalsCountLabel(
                              pendingApprovalsLane,
                            )}
                          </span>
                          <span className="text-muted-foreground">
                            pending approval
                            {pendingApprovalsLane.count === 1 ? "" : "s"}
                          </span>
                          <ArrowUpRight
                            aria-hidden="true"
                            className="ml-2 h-4 w-4"
                          />
                        </Link>
                      </Button>
                    </div>
                  ) : (
                    <div className="hidden lg:block" />
                  )}
                  <div className="flex flex-col gap-layout-sm sm:flex-row sm:items-center">
                    <OperatingDatePicker
                      operatingDate={snapshot.operatingDate}
                      onChange={onOperatingDateChange}
                    />
                    {showHistoricalEodReviewAction ? (
                      <Button
                        asChild
                        className={cn(
                          "w-full sm:w-auto",
                          primaryActionEmphasis?.className,
                        )}
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
                          {showPrimaryActionStatusIcon && PrimaryActionIcon ? (
                            <PrimaryActionIcon
                              aria-hidden="true"
                              className={cn(
                                "h-3.5 w-3.5",
                                primaryActionEmphasis.iconClassName,
                              )}
                            />
                          ) : null}
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
                        className={cn(
                          "w-full sm:w-auto",
                          primaryActionEmphasis?.className,
                        )}
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
                          {showPrimaryActionStatusIcon && PrimaryActionIcon ? (
                            <PrimaryActionIcon
                              aria-hidden="true"
                              className={cn(
                                "h-3.5 w-3.5",
                                primaryActionEmphasis.iconClassName,
                              )}
                            />
                          ) : null}
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

                {shouldShowCurrentAutomationBand ? (
                  <>
                    <AutomationStatusPanel
                      carryForwardCount={
                        snapshot.completedClose?.carryForwardCount
                      }
                      completedClose={snapshot.completedClose}
                      orgUrlSlug={orgUrlSlug}
                      showStatuses={shouldShowAutomationStatuses}
                      snapshot={snapshot}
                      storeUrlSlug={storeUrlSlug}
                      variant="compact"
                    />
                    {isMobile ? (
                      <AutomationReviewEvidencePanel
                        orgUrlSlug={orgUrlSlug}
                        snapshot={snapshot}
                        storeUrlSlug={storeUrlSlug}
                      />
                    ) : null}
                  </>
                ) : null}

                {shouldShowHistoricalWorkflowPanel ||
                shouldShowHistoricalAutomationCompletion ? (
                  <section className="space-y-layout-md">
                    {shouldShowHistoricalWorkflowPanel ? (
                      <HistoricalWorkflowPanel snapshot={snapshot} />
                    ) : null}
                    {shouldShowHistoricalAutomationCompletion ? (
                      <DailyOperationsCompletionAttributionNotice
                        carryForwardCount={
                          snapshot.completedClose?.carryForwardCount
                        }
                        completedClose={snapshot.completedClose}
                      />
                    ) : null}
                  </section>
                ) : null}

                <OpenRegisterSessionsPanel
                  operatingDate={snapshot.operatingDate}
                  orgUrlSlug={orgUrlSlug}
                  sessions={openRegisterSessions}
                  showTopRule={
                    shouldShowCurrentAutomationBand ||
                    shouldShowHistoricalWorkflowPanel ||
                    shouldShowHistoricalAutomationCompletion
                  }
                  storeUrlSlug={storeUrlSlug}
                />

                <div className="grid gap-layout-md [grid-template-columns:repeat(auto-fit,minmax(min(14rem,100%),1fr))] md:gap-layout-lg">
                  <OperationsSummaryMetric
                    helper={formatOperationsMetricHelper({
                      currentValue: snapshot.closeSummary.salesTotal,
                      detail: formatEntityCount(
                        snapshot.closeSummary.transactionCount,
                        "transaction",
                      ),
                      priorValue: priorComparisonMetric?.salesTotal,
                      priorWindowLabel,
                      showComparison: hasFinancialDetailsAccess,
                    })}
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
                    helper={formatOperationsMetricHelper({
                      currentValue: snapshot.closeSummary.currentDayCashTotal,
                      detail: formatTodayCashTransactionCount(
                        snapshot.closeSummary.currentDayCashTransactionCount,
                      ),
                      missingComparisonLabel:
                        formatMissingTenderComparisonLabel(priorWindowLabel),
                      priorValue: priorComparisonMetric?.currentDayCashTotal,
                      priorWindowLabel,
                      showComparison: hasFinancialDetailsAccess,
                    })}
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
                        helper={formatOperationsMetricHelper({
                          currentValue: paymentTotal.amount,
                          detail: formatPaymentCount(
                            paymentTotal.transactionCount,
                          ),
                          missingComparisonLabel:
                            formatMissingTenderComparisonLabel(
                              priorWindowLabel,
                            ),
                          priorValue: getPaymentTotalAmount(
                            priorComparisonMetric,
                            paymentTotal.method,
                          ),
                          priorWindowLabel,
                          showComparison: hasFinancialDetailsAccess,
                        })}
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

                {hasHydratedWeekAnalytics && weekMetricsForDisplay ? (
                  <WeekMetricsStrip
                    analyticsFetchedAt={weekAnalyticsFetchedAt}
                    currency={snapshot.currency ?? currency}
                    hasFinancialDetailsAccess={hasFinancialDetailsAccess}
                    isRefreshingToday={isRefreshingToday}
                    metrics={weekMetricsForDisplay}
                    onRefreshToday={onRefreshToday}
                    orgUrlSlug={orgUrlSlug}
                    storePulseWindow={storePulseWindow}
                    storeUrlSlug={storeUrlSlug}
                    todayRefreshedAt={todayRefreshedAt}
                  />
                ) : onRequestDetailSnapshot ? (
                  <DailyOperationsWeekMetricsPreview
                    isLoading={isLoadingDetailSnapshot}
                    metrics={snapshot.weekMetrics}
                    onRequest={onRequestDetailSnapshot}
                    operatingDate={
                      selectedWeekOperatingDate ?? snapshot.operatingDate
                    }
                  />
                ) : null}
              </section>

              <PageWorkspaceGrid className="gap-layout-2xl lg:gap-layout-3xl">
                <PageWorkspaceMain className="xl:col-start-1 xl:row-start-1">
                  {requestStorePulseSnapshot ? (
                    <DailyOperationsStorePulsePreview
                      cachedSelectedStorePulse={loadedStorePulse}
                      cachedStorePulse={storePulsePreviewSummary}
                      currency={snapshot.currency ?? currency}
                      hasFullAdminAccess={hasFullAdminAccess}
                      isLoading={
                        isLoadingStorePulseSnapshot || isLoadingDetailSnapshot
                      }
                      onRequest={requestStorePulseSnapshot}
                      operatingDate={
                        selectedWeekOperatingDate ?? snapshot.operatingDate
                      }
                    />
                  ) : storePulseDetailSnapshot ? (
                    <DailyOperationsStorePulsePanel
                      currency={snapshot.currency ?? currency}
                      hasFullAdminAccess={hasFullAdminAccess}
                      snapshot={storePulseDetailSnapshot}
                    />
                  ) : null}
                </PageWorkspaceMain>

                <PageWorkspaceRail className="xl:col-start-2 xl:row-span-2 xl:row-start-1">
                  <StoreDayActivityPanel
                    hasMoreTimelineEvents={hasMoreTimelineEvents}
                    isLoadingTimelinePreviewSnapshot={
                      isLoadingTimelinePreviewSnapshot ?? false
                    }
                    isLoadingTimelineSnapshot={
                      isLoadingTimelineSnapshot ?? false
                    }
                    onRequestTimelineSnapshot={onRequestTimelineSnapshot}
                    onShowMore={() => setTimelineSheetOpen(true)}
                    operatingDate={snapshot.operatingDate}
                    orgUrlSlug={orgUrlSlug}
                    storeUrlSlug={storeUrlSlug}
                    timeline={previewTimeline}
                  />
                  {!isMobile && hasAutomationReviewEvidence ? (
                    <AutomationReviewEvidencePanel
                      orgUrlSlug={orgUrlSlug}
                      snapshot={snapshot}
                      storeUrlSlug={storeUrlSlug}
                    />
                  ) : null}
                </PageWorkspaceRail>

                {!isHistoricalDate ? (
                  <PageWorkspaceMain className="xl:col-start-1 xl:row-start-2">
                    <section className="space-y-layout-sm">
                      <div>
                        <h3 className="text-sm font-medium text-foreground">
                          Store-day follow-up
                        </h3>
                      </div>
                      <div>
                        <div className="grid gap-layout-xs md:grid-cols-2 xl:grid-cols-3">
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
                  </PageWorkspaceMain>
                ) : null}
              </PageWorkspaceGrid>

              <Sheet
                open={isTimelineSheetOpen}
                onOpenChange={setTimelineSheetOpen}
              >
                <SheetContent
                  className="flex w-[min(100vw,30rem)] max-w-[calc(100vw-1rem)] flex-col overflow-hidden border-border bg-surface-raised p-0 shadow-overlay sm:max-w-md"
                  side="right"
                >
                  <SheetHeader className="border-b border-border px-layout-lg py-layout-md">
                    <SheetTitle>
                      {getActivityLabel(snapshot.operatingDate)}
                    </SheetTitle>
                    <SheetDescription>
                      All recorded events for{" "}
                      {formatOperatingDateWithWeekday(snapshot.operatingDate)}.
                    </SheetDescription>
                  </SheetHeader>
                  <div className="min-h-0 flex-1 overflow-y-auto px-layout-lg py-layout-md">
                    {isLoadingTimelineSnapshot ? (
                      <div className="space-y-layout-md">
                        {Array.from({ length: 5 }).map((_, index) => (
                          <div className="space-y-2" key={index}>
                            <span className="block h-3 w-16 rounded-sm bg-muted" />
                            <span className="block h-4 w-full rounded-sm bg-muted" />
                            <span className="block h-4 w-2/3 rounded-sm bg-muted" />
                          </div>
                        ))}
                      </div>
                    ) : fullTimelineEvents && fullTimelineEvents.length > 0 ? (
                      <div className="space-y-layout-md">
                        {fullTimelineEvents.map((event) => (
                          <TimelineEventItem
                            event={event}
                            key={event.id}
                            orgUrlSlug={orgUrlSlug}
                            storeUrlSlug={storeUrlSlug}
                          />
                        ))}
                      </div>
                    ) : (
                      <EmptyState
                        description="Timeline detail is not loaded yet."
                        title="Timeline loading"
                      />
                    )}
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
  getDailyOperationsAutomationSnapshot,
  getDailyOperationsDetailSnapshot,
  getDailyOperationsOpenRegisterSessionsSnapshot,
  getDailyOperationsSnapshot,
  getDailyOperationsStorePulseSnapshot,
  getDailyOperationsStoreRequestsSnapshot,
  getDailyOperationsTodayRefreshSnapshot,
  getDailyOperationsTimelinePreviewSnapshot,
  getDailyOperationsTimelineSnapshot,
  getDailyOperationsWeekAnalyticsSnapshot,
}: {
  getDailyOperationsAutomationSnapshot?: unknown;
  getDailyOperationsDetailSnapshot?: unknown;
  getDailyOperationsOpenRegisterSessionsSnapshot?: unknown;
  getDailyOperationsSnapshot: unknown;
  getDailyOperationsStorePulseSnapshot?: unknown;
  getDailyOperationsStoreRequestsSnapshot?: unknown;
  getDailyOperationsTodayRefreshSnapshot?: unknown;
  getDailyOperationsTimelinePreviewSnapshot?: unknown;
  getDailyOperationsTimelineSnapshot?: unknown;
  getDailyOperationsWeekAnalyticsSnapshot?: unknown;
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
    timeline?: unknown;
    weekEndOperatingDate?: unknown;
  };
  const isTimelineSearchOpen = search.timeline === "open";
  const operatingDateRange = useMemo(
    () => getLocalOperatingDateRangeFromSearch(search.operatingDate),
    [search.operatingDate],
  );
  const weekEndOperatingDate = useMemo(
    () => getWeekEndOperatingDateFromSearch(search.weekEndOperatingDate),
    [search.weekEndOperatingDate],
  );
  const storePulseWindow: StorePulseWindow = "today";
  const snapshotArgs = canQueryProtectedData
    ? {
        ...operatingDateRange,
        operatingTimezoneOffsetMinutes: getOperatingTimezoneOffsetMinutes(
          operatingDateRange.operatingDate,
        ),
        storeId: activeStore!._id,
        storePulseWindow,
        weekEndOperatingDate,
      }
    : "skip";
  const snapshotRequestKey =
    snapshotArgs === "skip"
      ? "skip"
      : `${String(snapshotArgs.storeId)}:${snapshotArgs.operatingDate}:${snapshotArgs.startAt ?? ""}:${snapshotArgs.endAt ?? ""}:${snapshotArgs.weekEndOperatingDate ?? ""}:${snapshotArgs.storePulseWindow}`;
  const weekAnalyticsCacheKey =
    snapshotArgs === "skip"
      ? "skip"
      : `${String(snapshotArgs.storeId)}:${snapshotArgs.weekEndOperatingDate}:${snapshotArgs.storePulseWindow}`;
  const [requestedDetailSnapshotKey, setRequestedDetailSnapshotKey] = useState<
    string | null
  >(null);
  const [requestedTimelineSnapshotKey, setRequestedTimelineSnapshotKey] =
    useState<string | null>(null);
  const [requestedStorePulseSnapshotKey, setRequestedStorePulseSnapshotKey] =
    useState<string | null>(null);
  const [todayRefreshRequest, setTodayRefreshRequest] = useState<{
    requestedAt: number;
    snapshotRequestKey: string;
  } | null>(null);
  const [weekAnalyticsCache, setWeekAnalyticsCache] = useState<
    Record<string, CachedWeekAnalytics>
  >({});
  const [storePulseCache, setStorePulseCache] = useState<
    Record<string, DailyOperationsStorePulseSnapshot>
  >({});
  const [todayRefreshCache, setTodayRefreshCache] = useState<
    Record<string, DailyOperationsTodayRefreshSnapshot>
  >({});
  const [timelinePreviewCache, setTimelinePreviewCache] = useState<
    Record<string, DailyOperationsTimelinePreviewSnapshot>
  >({});
  const isDetailSnapshotRequested =
    snapshotRequestKey !== "skip" &&
    requestedDetailSnapshotKey === snapshotRequestKey;
  const isTimelineSnapshotRequested =
    snapshotRequestKey !== "skip" &&
    (requestedTimelineSnapshotKey === snapshotRequestKey ||
      isTimelineSearchOpen);
  const cachedWeekAnalytics =
    weekAnalyticsCacheKey === "skip"
      ? undefined
      : weekAnalyticsCache[weekAnalyticsCacheKey];
  const shouldQueryWeekAnalytics =
    Boolean(getDailyOperationsWeekAnalyticsSnapshot) &&
    canQueryProtectedData &&
    weekAnalyticsCacheKey !== "skip" &&
    cachedWeekAnalytics === undefined;
  const cachedDaySnapshotEntry =
    cachedWeekAnalytics && snapshotArgs !== "skip"
      ? cachedWeekAnalytics.daySnapshots[snapshotArgs.operatingDate]
      : undefined;
  const hasCachedDetailSnapshot = cachedDaySnapshotEntry?.hasDetail === true;
  const shouldQueryDetailSnapshot =
    Boolean(getDailyOperationsDetailSnapshot) &&
    canQueryProtectedData &&
    isDetailSnapshotRequested &&
    !hasCachedDetailSnapshot;
  const cachedStorePulseSnapshot =
    snapshotRequestKey === "skip"
      ? undefined
      : storePulseCache[snapshotRequestKey];
  const isStorePulseSnapshotRequested =
    snapshotRequestKey !== "skip" &&
    requestedStorePulseSnapshotKey === snapshotRequestKey;
  const shouldQueryStorePulseSnapshot =
    Boolean(getDailyOperationsStorePulseSnapshot) &&
    canQueryProtectedData &&
    isStorePulseSnapshotRequested &&
    cachedStorePulseSnapshot === undefined;
  const isTodayRefreshRequested =
    snapshotRequestKey !== "skip" &&
    todayRefreshRequest?.snapshotRequestKey === snapshotRequestKey;
  const shouldQueryTodayRefreshSnapshot =
    Boolean(getDailyOperationsTodayRefreshSnapshot) &&
    canQueryProtectedData &&
    isTodayRefreshRequested;
  const todayRefreshArgs =
    shouldQueryTodayRefreshSnapshot &&
    snapshotArgs !== "skip" &&
    todayRefreshRequest
      ? {
          ...snapshotArgs,
          refreshRequestedAt: todayRefreshRequest.requestedAt,
        }
      : "skip";

  const compactSnapshot = useExpectedDailyOperationsQuery(
    getDailyOperationsSnapshot,
    cachedDaySnapshotEntry ? "skip" : snapshotArgs,
  ) as DailyOperationsSnapshot | undefined;
  const detailSnapshot = useExpectedDailyOperationsQuery(
    getDailyOperationsDetailSnapshot ?? getDailyOperationsSnapshot,
    shouldQueryDetailSnapshot ? snapshotArgs : "skip",
  ) as DailyOperationsSnapshot | undefined;
  const queriedWeekAnalyticsSnapshot = useExpectedDailyOperationsQuery(
    getDailyOperationsWeekAnalyticsSnapshot ?? getDailyOperationsSnapshot,
    shouldQueryWeekAnalytics ? snapshotArgs : "skip",
  ) as DailyOperationsWeekAnalyticsSnapshot | undefined;
  const queriedStorePulseSnapshot = useExpectedDailyOperationsQuery(
    getDailyOperationsStorePulseSnapshot ?? getDailyOperationsSnapshot,
    shouldQueryStorePulseSnapshot ? snapshotArgs : "skip",
  ) as DailyOperationsStorePulseSnapshot | undefined;
  const storeRequestsSnapshot = useExpectedDailyOperationsQuery(
    getDailyOperationsStoreRequestsSnapshot ?? getDailyOperationsSnapshot,
    getDailyOperationsStoreRequestsSnapshot && canQueryProtectedData
      ? snapshotArgs
      : "skip",
  ) as DailyOperationsStoreRequestsSnapshot | undefined;
  const automationSnapshot = useExpectedDailyOperationsQuery(
    getDailyOperationsAutomationSnapshot ?? getDailyOperationsSnapshot,
    getDailyOperationsAutomationSnapshot &&
      canQueryProtectedData &&
      hasFullAdminAccess
      ? snapshotArgs
      : "skip",
  ) as DailyOperationsAutomationSnapshot | undefined;
  const openRegisterSessionsSnapshot = useExpectedDailyOperationsQuery(
    getDailyOperationsOpenRegisterSessionsSnapshot ??
      getDailyOperationsSnapshot,
    getDailyOperationsOpenRegisterSessionsSnapshot && canQueryProtectedData
      ? snapshotArgs
      : "skip",
  ) as DailyOperationsOpenRegisterSessionsSnapshot | undefined;
  const queriedTodayRefreshSnapshot = useExpectedDailyOperationsQuery(
    getDailyOperationsTodayRefreshSnapshot ?? getDailyOperationsSnapshot,
    todayRefreshArgs,
  ) as DailyOperationsTodayRefreshSnapshot | undefined;
  const queriedTimelinePreviewSnapshot = useExpectedDailyOperationsQuery(
    getDailyOperationsTimelinePreviewSnapshot ?? getDailyOperationsSnapshot,
    getDailyOperationsTimelinePreviewSnapshot && canQueryProtectedData
      ? snapshotArgs
      : "skip",
  ) as DailyOperationsTimelinePreviewSnapshot | undefined;
  const timelineSnapshot = useExpectedDailyOperationsQuery(
    getDailyOperationsTimelineSnapshot ?? getDailyOperationsSnapshot,
    getDailyOperationsTimelineSnapshot &&
      canQueryProtectedData &&
      isTimelineSnapshotRequested
      ? snapshotArgs
      : "skip",
  ) as DailyOperationsTimelineSnapshot | undefined;
  const detailSnapshotMetric = detailSnapshot?.weekMetrics.find(
    (metric) => metric.operatingDate === detailSnapshot.operatingDate,
  );
  const normalizedDetailSnapshot =
    detailSnapshot && detailSnapshotMetric
      ? normalizeDailyOperationsSnapshotWithWeekMetric(
          detailSnapshot,
          detailSnapshotMetric,
          detailSnapshot.weekMetrics,
        )
      : detailSnapshot;
  const baseSnapshot = compactSnapshot ?? cachedDaySnapshotEntry?.snapshot;
  const mergedSnapshot = baseSnapshot
    ? normalizedDetailSnapshot
      ? mergeDailyOperationsSnapshots(baseSnapshot, normalizedDetailSnapshot)
      : baseSnapshot
    : normalizedDetailSnapshot;
  const cachedTodayRefreshSnapshot =
    snapshotRequestKey === "skip"
      ? undefined
      : todayRefreshCache[snapshotRequestKey];
  const snapshot = applyAutomationSnapshot(
    applyTodayRefreshSnapshot(mergedSnapshot, cachedTodayRefreshSnapshot),
    automationSnapshot,
  );
  const cachedTimelinePreviewSnapshot =
    snapshotRequestKey === "skip"
      ? undefined
      : timelinePreviewCache[snapshotRequestKey];
  const timelinePreviewSnapshot =
    queriedTimelinePreviewSnapshot ?? cachedTimelinePreviewSnapshot;
  const refreshedStorePulseSnapshot =
    snapshotArgs !== "skip" && cachedTodayRefreshSnapshot
      ? {
          operatingDate: cachedTodayRefreshSnapshot.operatingDate,
          storePulse: cachedTodayRefreshSnapshot.storePulse ?? null,
        }
      : undefined;
  const storePulseSnapshot =
    refreshedStorePulseSnapshot ??
    queriedStorePulseSnapshot ??
    cachedStorePulseSnapshot;
  const rawCachedWeekMetrics =
    cachedWeekAnalytics && snapshotArgs !== "skip"
      ? selectWeekMetricsForOperatingDate(
          cachedWeekAnalytics.metrics,
          snapshotArgs.operatingDate,
        )
      : undefined;
  const cachedWeekMetrics =
    snapshotArgs !== "skip"
      ? replaceWeekMetricForOperatingDate(
          rawCachedWeekMetrics,
          cachedTodayRefreshSnapshot?.weekMetric,
          snapshotArgs.operatingDate,
        )
      : rawCachedWeekMetrics;
  const cachedWeekStorePulse =
    cachedTodayRefreshSnapshot?.storePulse && snapshot
      ? buildCachedWeekStorePulseSummary({
          ...snapshot,
          storePulse: cachedTodayRefreshSnapshot.storePulse,
          weekMetrics: cachedWeekMetrics ?? snapshot.weekMetrics,
        })
      : (cachedWeekAnalytics?.storePulse ??
        (snapshot && cachedWeekMetrics
          ? buildWeekMetricStorePulseSummary({
              ...snapshot,
              weekMetrics: cachedWeekMetrics,
            })
          : undefined));

  useEffect(() => {
    if (weekAnalyticsCacheKey === "skip" || !queriedWeekAnalyticsSnapshot) {
      return;
    }

    setWeekAnalyticsCache((current) => {
      const existingWeekAnalytics = current[weekAnalyticsCacheKey];

      if (
        existingWeekAnalytics?.metrics ===
        queriedWeekAnalyticsSnapshot.weekMetrics
      ) {
        return current;
      }

      return {
        ...current,
        [weekAnalyticsCacheKey]: {
          daySnapshots: existingWeekAnalytics?.daySnapshots ?? {},
          fetchedAt: Date.now(),
          metrics: queriedWeekAnalyticsSnapshot.weekMetrics,
          priorWeekBoundaryMetric:
            queriedWeekAnalyticsSnapshot.priorWeekBoundaryMetric,
          storePulse: existingWeekAnalytics?.storePulse,
        },
      };
    });
  }, [queriedWeekAnalyticsSnapshot, weekAnalyticsCacheKey]);

  useEffect(() => {
    if (weekAnalyticsCacheKey === "skip" || !detailSnapshot) {
      return;
    }

    setWeekAnalyticsCache((current) => {
      const existingWeekAnalytics = current[weekAnalyticsCacheKey];

      if (
        existingWeekAnalytics?.daySnapshots[detailSnapshot.operatingDate]
          ?.hasDetail
      ) {
        return current;
      }

      return {
        ...current,
        [weekAnalyticsCacheKey]: {
          daySnapshots: {
            ...existingWeekAnalytics?.daySnapshots,
            [detailSnapshot.operatingDate]: {
              hasDetail: true,
              snapshot: detailSnapshot,
            },
          },
          fetchedAt: existingWeekAnalytics?.fetchedAt ?? Date.now(),
          metrics: existingWeekAnalytics?.metrics ?? [],
          priorWeekBoundaryMetric:
            existingWeekAnalytics?.priorWeekBoundaryMetric,
          storePulse: existingWeekAnalytics?.storePulse,
        },
      };
    });
  }, [detailSnapshot, weekAnalyticsCacheKey]);

  useEffect(() => {
    if (
      snapshotRequestKey === "skip" ||
      queriedStorePulseSnapshot === undefined
    ) {
      return;
    }

    setStorePulseCache((current) => {
      if (current[snapshotRequestKey] === queriedStorePulseSnapshot) {
        return current;
      }

      return {
        ...current,
        [snapshotRequestKey]: queriedStorePulseSnapshot,
      };
    });
  }, [queriedStorePulseSnapshot, snapshotRequestKey]);

  useEffect(() => {
    if (
      snapshotRequestKey === "skip" ||
      queriedTodayRefreshSnapshot === undefined ||
      !todayRefreshRequest ||
      todayRefreshRequest.snapshotRequestKey !== snapshotRequestKey ||
      queriedTodayRefreshSnapshot.refreshRequestedAt !==
        todayRefreshRequest.requestedAt
    ) {
      return;
    }

    setTodayRefreshCache((current) => {
      if (current[snapshotRequestKey] === queriedTodayRefreshSnapshot) {
        return current;
      }

      return {
        ...current,
        [snapshotRequestKey]: queriedTodayRefreshSnapshot,
      };
    });
    setTodayRefreshRequest(null);
  }, [queriedTodayRefreshSnapshot, snapshotRequestKey, todayRefreshRequest]);

  useEffect(() => {
    if (
      snapshotRequestKey === "skip" ||
      queriedTimelinePreviewSnapshot === undefined
    ) {
      return;
    }

    setTimelinePreviewCache((current) => {
      if (
        areTimelinePreviewSnapshotsEqual(
          current[snapshotRequestKey],
          queriedTimelinePreviewSnapshot,
        )
      ) {
        return current;
      }

      return {
        ...current,
        [snapshotRequestKey]: queriedTimelinePreviewSnapshot,
      };
    });
  }, [queriedTimelinePreviewSnapshot, snapshotRequestKey]);

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
  const handleTimelineSheetOpenChange = (open: boolean) => {
    void navigate({
      replace: true,
      search: ((current: Record<string, unknown>) => ({
        ...current,
        timeline: open ? "open" : undefined,
      })) as never,
    });
  };
  const canRefreshToday =
    Boolean(getDailyOperationsTodayRefreshSnapshot) &&
    canQueryProtectedData &&
    snapshotArgs !== "skip" &&
    snapshotArgs.operatingDate === getLocalOperatingDate();
  const requestTodayRefresh = useCallback(() => {
    if (!canRefreshToday || snapshotRequestKey === "skip") return;

    setTodayRefreshRequest((current) => {
      if (current?.snapshotRequestKey === snapshotRequestKey) {
        return current;
      }

      return {
        requestedAt: Date.now(),
        snapshotRequestKey,
      };
    });
  }, [canRefreshToday, snapshotRequestKey]);
  const todayRefreshLastFetchedAt =
    cachedTodayRefreshSnapshot?.refreshedAt ?? cachedWeekAnalytics?.fetchedAt;

  useEffect(() => {
    if (
      !canRefreshToday ||
      isTodayRefreshRequested ||
      todayRefreshLastFetchedAt === undefined
    ) {
      return;
    }

    const staleDelayMs = Math.max(
      todayRefreshLastFetchedAt + TODAY_REFRESH_STALE_MS - Date.now(),
      0,
    );
    const timeoutId = window.setTimeout(requestTodayRefresh, staleDelayMs);

    return () => window.clearTimeout(timeoutId);
  }, [
    canRefreshToday,
    isTodayRefreshRequested,
    requestTodayRefresh,
    todayRefreshLastFetchedAt,
  ]);

  return (
    <DailyOperationsViewContent
      currency={activeStore?.currency ?? "GHS"}
      cachedPriorWeekBoundaryMetric={
        cachedWeekAnalytics?.priorWeekBoundaryMetric
      }
      cachedWeekAnalyticsFetchedAt={cachedWeekAnalytics?.fetchedAt}
      cachedWeekMetrics={cachedWeekMetrics}
      cachedWeekStorePulse={cachedWeekStorePulse}
      hasDetailSnapshot={
        detailSnapshot !== undefined ||
        cachedDaySnapshotEntry?.hasDetail === true
      }
      hasFullAdminAccess={canAccessSurface}
      canViewAutomationStatuses={hasFullAdminAccess}
      hasFinancialDetailsAccess={hasFinancialDetailsAccess}
      isAuthenticated={isAuthenticated}
      isLoadingAccess={isLoadingAccess}
      isLoadingDetailSnapshot={
        shouldQueryDetailSnapshot && detailSnapshot === undefined
      }
      isLoadingStorePulseSnapshot={
        shouldQueryStorePulseSnapshot && queriedStorePulseSnapshot === undefined
      }
      isLoadingTimelinePreviewSnapshot={
        Boolean(getDailyOperationsTimelinePreviewSnapshot) &&
        canQueryProtectedData &&
        queriedTimelinePreviewSnapshot === undefined &&
        cachedTimelinePreviewSnapshot === undefined
      }
      isLoadingTimelineSnapshot={
        isTimelineSnapshotRequested && timelineSnapshot === undefined
      }
      isTimelineSheetOpen={isTimelineSearchOpen}
      isLoadingSnapshot={snapshot === undefined}
      isRefreshingToday={isTodayRefreshRequested}
      onRequestDetailSnapshot={() =>
        setRequestedDetailSnapshotKey(
          snapshotRequestKey === "skip" ? null : snapshotRequestKey,
        )
      }
      onRequestStorePulseSnapshot={() =>
        setRequestedStorePulseSnapshotKey(
          snapshotRequestKey === "skip" ? null : snapshotRequestKey,
        )
      }
      onRequestTimelineSnapshot={() =>
        setRequestedTimelineSnapshotKey(
          snapshotRequestKey === "skip" ? null : snapshotRequestKey,
        )
      }
      onTimelineSheetOpenChange={handleTimelineSheetOpenChange}
      onOperatingDateChange={handleOperatingDateChange}
      openRegisterSessionsSnapshot={openRegisterSessionsSnapshot}
      onRefreshToday={canRefreshToday ? requestTodayRefresh : undefined}
      orgUrlSlug={params?.orgUrlSlug ?? ""}
      snapshot={snapshot}
      storePulseWindow={storePulseWindow}
      storeUrlSlug={params?.storeUrlSlug ?? ""}
      storePulseSnapshot={storePulseSnapshot}
      storeRequestsSnapshot={storeRequestsSnapshot}
      todayRefreshedAt={cachedTodayRefreshSnapshot?.refreshedAt}
      timelinePreviewSnapshot={timelinePreviewSnapshot}
      timelineSnapshot={timelineSnapshot}
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
      getDailyOperationsAutomationSnapshot={
        dailyOperationsApi.getDailyOperationsAutomationSnapshot
      }
      getDailyOperationsDetailSnapshot={
        dailyOperationsApi.getDailyOperationsDetailSnapshot
      }
      getDailyOperationsOpenRegisterSessionsSnapshot={
        dailyOperationsApi.getDailyOperationsOpenRegisterSessionsSnapshot
      }
      getDailyOperationsSnapshot={dailyOperationsApi.getDailyOperationsSnapshot}
      getDailyOperationsStorePulseSnapshot={
        dailyOperationsApi.getDailyOperationsStorePulseSnapshot
      }
      getDailyOperationsStoreRequestsSnapshot={
        dailyOperationsApi.getDailyOperationsStoreRequestsSnapshot
      }
      getDailyOperationsTodayRefreshSnapshot={
        dailyOperationsApi.getDailyOperationsTodayRefreshSnapshot
      }
      getDailyOperationsTimelinePreviewSnapshot={
        dailyOperationsApi.getDailyOperationsTimelinePreviewSnapshot
      }
      getDailyOperationsTimelineSnapshot={
        dailyOperationsApi.getDailyOperationsTimelineSnapshot
      }
      getDailyOperationsWeekAnalyticsSnapshot={
        dailyOperationsApi.getDailyOperationsWeekAnalyticsSnapshot
      }
    />
  );
}
