import { type ReactNode, useMemo, useState } from "react";
import {
  Link,
  useNavigate,
  useParams,
  useSearch,
} from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { useSharedDemoContext } from "@/hooks/useSharedDemoContext";
import {
  ArrowUpRight,
  Ban,
  Bot,
  Calendar as CalendarIcon,
  Check,
  CheckCircle2,
  ClipboardCheck,
  ListChecks,
  RotateCcw,
} from "lucide-react";

import { useProtectedAdminPageState } from "@/hooks/useProtectedAdminPageState";
import { capitalizeFirstLetter, capitalizeWords, cn } from "@/lib/utils";
import { toOperatorMessage } from "@/lib/errors/operatorMessages";
import {
  runCommand,
  type NormalizedCommandResult,
} from "@/lib/errors/runCommand";
import { getOrigin } from "@/lib/navigationUtils";
import {
  getLocalDateFromOperatingDate,
  getLocalOperatingDateRange,
  getLocalOperatingDateRangeFromSearch,
  getOperatingClockNow,
} from "@/lib/operations/operatingDate";
import { api } from "~/convex/_generated/api";
import type { Id } from "~/convex/_generated/dataModel";
import type {
  ApprovalRequesterBinding,
  ApprovalRequirement,
} from "~/shared/approvalPolicy";
import type { CommandResult } from "~/shared/commandResult";
import View from "../View";
import { FadeIn } from "../common/FadeIn";
import { ListPagination } from "../common/ListPagination";
import {
  PageLevelHeader,
  PageWorkspace,
  PageWorkspaceRail,
} from "../common/PageLevelHeader";
import { EmptyState } from "../states/empty/empty-state";
import type { CommandApprovalDialogProps } from "./CommandApprovalDialog";
import { toApprovalRequesterBindingArg } from "./approvalRequesterBinding";
import { NoPermissionView } from "../states/no-permission/NoPermissionView";
import { ProtectedAdminSignInView } from "../states/signed-out/ProtectedAdminSignInView";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Calendar } from "../ui/calendar";
import { Checkbox } from "../ui/checkbox";
import { Label } from "../ui/label";
import { LoadingButton } from "../ui/loading-button";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { Tabs, TabsContent } from "../ui/tabs";
import {
  OperationReviewBucketBody,
  OperationReviewBucketHeader,
  OperationReviewBucketShell,
  OperationReviewBucketTabsList,
  OperationReviewBucketTabTrigger,
  OperationReviewRailShell,
  OperationReviewWorkspace,
} from "./OperationReviewWorkspace";
import { OperationReviewItemCard } from "./OperationReviewItemCard";
import { OperationsSummaryMetric } from "./OperationsSummaryMetric";
import {
  StaffAuthenticationDialog,
  type StaffAuthenticationResult,
} from "../staff-auth/StaffAuthenticationDialog";

type DailyOpeningApi = {
  getDailyOpeningSnapshot?: unknown;
  startStoreDay?: unknown;
};

const useExpectedDailyOpeningQuery = useQuery as unknown as (
  query: unknown,
  args: unknown,
) => unknown;
const useExpectedDailyOpeningMutation = useMutation as unknown as (
  mutation: unknown,
) => (args: Record<string, unknown>) => Promise<unknown>;

type DailyOpeningStatus = "blocked" | "needs_attention" | "ready" | "started";

type DailyOpeningAutomationStatus = {
  bucket?:
    | "failed"
    | "action_taken"
    | "needs_review"
    | "policy_skipped"
    | "scheduled_later";
  id: string;
  occurredAt?: number | null;
  outcome:
    "applied" | "prepared" | "skipped" | "failed" | "dry_run" | "disabled";
  reviewEvidence?: DailyOpeningItem[];
};

export type DailyOpeningItemLink = {
  href?: string;
  label?: string;
  params?: Record<string, string>;
  search?: Record<string, string>;
  to?: string;
};

export type DailyOpeningItem = {
  category?: string;
  description?: string | null;
  id?: string;
  key?: string;
  link?: DailyOpeningItemLink | null;
  metadata?:
    | Array<{
        label: string;
        value: ReactNode;
      }>
    | Record<string, unknown>;
  message?: string | null;
  severity?: "blocker" | "review" | "carry_forward" | "ready";
  statusLabel?: string | null;
  subject?: {
    id: string;
    label?: string;
    type: string;
  };
  title: string;
};

export type DailyOpeningSnapshot = {
  automationStatus?: DailyOpeningAutomationStatus | null;
  blockers: DailyOpeningItem[];
  carryForwardItems: DailyOpeningItem[];
  endAt: number;
  operatingDate: string;
  priorClose?: {
    completedAt?: number | null;
    completedByStaffName?: string | null;
    notes?: string | null;
    operatingDate?: string | null;
  } | null;
  readyItems: DailyOpeningItem[];
  readiness?: {
    blockerCount: number;
    carryForwardCount: number;
    readyCount: number;
    reviewCount: number;
    status: "blocked" | "needs_attention" | "ready";
  };
  reviewItems: DailyOpeningItem[];
  startAt: number;
  startedOpening?: {
    actorType?: "human" | "automation";
    notes?: string | null;
    reviewEvidence?: DailyOpeningItem[];
    startedAt?: number | null;
    startedByStaffName?: string | null;
  } | null;
  status?: DailyOpeningStatus;
  summary?: {
    blockerCount?: number | null;
    carryForwardCount?: number | null;
    readyCount?: number | null;
    reviewCount?: number | null;
  };
};

type StartDayArgs = {
  acknowledgedItemKeys: string[];
  actorStaffProfileId?: Id<"staffProfile">;
  approvalProofId?: Id<"approvalProof">;
  endAt: number;
  notes: string;
  operatingDate: string;
  startAt: number;
};

type BucketStatus = "blocked" | "carry-forward" | "ready" | "review";

export type DailyOpeningViewContentProps = {
  currency: string;
  hasFullAdminAccess: boolean;
  isAuthenticated: boolean;
  isLoadingAccess: boolean;
  isLoadingSnapshot: boolean;
  isStarting: boolean;
  onAuthenticateStaff?: (args: {
    pinHash: string;
    username: string;
  }) => Promise<NormalizedCommandResult<StaffAuthenticationResult>>;
  onAuthenticateForApproval?: CommandApprovalDialogProps["onAuthenticateForApproval"];
  onOperatingDateChange?: (date: Date) => void;
  onStartDay: (args: StartDayArgs) => Promise<NormalizedCommandResult<unknown>>;
  orgUrlSlug: string;
  snapshot?: DailyOpeningSnapshot;
  storeId?: Id<"store">;
  storeUrlSlug: string;
};

type BucketConfig = {
  ariaLabel: string;
  description: string;
  emptyText: string;
  items: DailyOpeningItem[];
  status: BucketStatus;
  title: string;
  value: BucketStatus;
};

const bucketTabValues: BucketStatus[] = [
  "blocked",
  "review",
  "carry-forward",
  "ready",
];
const OPENING_REVIEW_ITEMS_PER_PAGE = 5;

const statusCopy: Record<
  DailyOpeningStatus,
  {
    badge: string;
    description: string;
    title: string;
  }
> = {
  blocked: {
    badge: "Blocked",
    description:
      "Resolve blocker items before marking the store day ready to trade.",
    title: "Opening blocked",
  },
  needs_attention: {
    badge: "Needs attention",
    description:
      "Acknowledge review and carry-forward items before starting the store day.",
    title: "Ready with attention",
  },
  ready: {
    badge: "Ready",
    description: "Prior close handoff is clear. The store day can start.",
    title: "Ready to start",
  },
  started: {
    badge: "Started",
    description: "Opening handoff is complete. The store day is ready to run.",
    title: "Store day started",
  },
};

function getDailyOpeningApi(): DailyOpeningApi {
  return (
    (
      api.operations as typeof api.operations & {
        dailyOpening?: DailyOpeningApi;
      }
    ).dailyOpening ?? {}
  );
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

function formatTimestamp(timestamp?: number | null) {
  if (!timestamp) return "Time unavailable";

  return new Date(timestamp).toLocaleString([], {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function humanizeMetadataLabel(label: string) {
  return label
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function normalizeMetadataLabel(label: string) {
  return label.replace(/[_\s-]+/g, "").toLowerCase();
}

function formatOpeningItemTitle(title: string) {
  const trimmedTitle = title.trim();

  if (!trimmedTitle) return title;

  const inventoryReviewMatch = trimmedTitle.match(
    /^(Review inventory for )(.+)$/i,
  );
  const pendingCheckoutReviewMatch = trimmedTitle.match(
    /^(Review pending checkout item: )(.+)$/i,
  );
  const catalogCategoryMatch = trimmedTitle.match(
    /^(Assign catalog category: )(.+)$/i,
  );

  if (inventoryReviewMatch) {
    return `${inventoryReviewMatch[1]}${capitalizeWords(inventoryReviewMatch[2])}`;
  }

  if (pendingCheckoutReviewMatch) {
    return `${pendingCheckoutReviewMatch[1]}${capitalizeWords(pendingCheckoutReviewMatch[2])}`;
  }

  if (catalogCategoryMatch) {
    return `${catalogCategoryMatch[1]}${capitalizeWords(catalogCategoryMatch[2])}`;
  }

  return trimmedTitle === trimmedTitle.toLowerCase()
    ? capitalizeFirstLetter(trimmedTitle)
    : title;
}

function formatOperationalWorkTypeLabel(type: string) {
  switch (type) {
    case "pos_pending_checkout_item_review":
      return "POS pending checkout";
    case "synced_sale_inventory_review":
      return "Synced sale inventory";
    case "service_case":
      return "Service case";
    case "service_appointment":
      return "Service appointment";
    case "service_intake":
      return "Service intake";
    case "purchase_order":
      return "Purchase order";
    case "stock_adjustment_review":
      return "Stock adjustment approval";
    case "daily_close_carry_forward":
      return "Daily close follow-up";
    case "service_deposit_review":
      return "Unsupported work type";
    default:
      return humanizeMetadataLabel(type);
  }
}

function getOpeningStatus(snapshot: DailyOpeningSnapshot): DailyOpeningStatus {
  if (snapshot.startedOpening) return "started";
  if (snapshot.status) return snapshot.status;
  if (snapshot.readiness?.status) return snapshot.readiness.status;
  if (snapshot.blockers.length > 0) return "blocked";
  if (
    snapshot.reviewItems.length > 0 ||
    snapshot.carryForwardItems.length > 0
  ) {
    return "needs_attention";
  }
  return "ready";
}

function getItemId(item: DailyOpeningItem) {
  return (
    item.id ??
    item.key ??
    `${item.subject?.type ?? "opening-item"}:${item.subject?.id ?? item.title}`
  );
}

function getAcknowledgementKey(item: DailyOpeningItem) {
  return item.key ?? getItemId(item);
}

function getRequiredAcknowledgementKeys(snapshot?: DailyOpeningSnapshot) {
  return [
    ...(snapshot?.reviewItems ?? []),
    ...(snapshot?.carryForwardItems ?? []),
  ].map(getAcknowledgementKey);
}

function getItemDescription(item: DailyOpeningItem) {
  return item.description ?? item.message;
}

function getItemContextLabel(item: DailyOpeningItem) {
  return item.category
    ? humanizeMetadataLabel(item.category)
    : item.subject?.type
      ? humanizeMetadataLabel(item.subject.type)
      : "Opening item";
}

function formatMetadataValue(value: ReactNode, currency: string) {
  if (typeof value === "number") {
    return new Intl.NumberFormat([], {
      currency,
      style: "currency",
    }).format(value / 100);
  }

  if (typeof value === "boolean") return String(value);

  return value;
}

function getMetadataLabel(item: DailyOpeningItem, label: string) {
  if (label === "operatingDate") {
    if (item.key === "daily_close:prior:missing") {
      return "Store day being opened";
    }

    return "Store day";
  }

  return humanizeMetadataLabel(label);
}

function getMetadataValue(label: string, value: ReactNode, currency: string) {
  const normalizedLabel = normalizeMetadataLabel(label);

  if (label === "operatingDate" && typeof value === "string") {
    return formatOperatingDate(value);
  }

  if (normalizedLabel === "type" && typeof value === "string") {
    return formatOperationalWorkTypeLabel(value);
  }

  if (
    (normalizedLabel === "status" || normalizedLabel === "priority") &&
    typeof value === "string"
  ) {
    return capitalizeFirstLetter(value);
  }

  if (label.endsWith("At") && typeof value === "number") {
    return formatTimestamp(value);
  }

  return formatMetadataValue(value, currency);
}

function getArrayMetadataStringValue(
  metadata: DailyOpeningItem["metadata"],
  label: string,
) {
  if (!Array.isArray(metadata)) return undefined;

  const entry = metadata.find((candidate) => candidate.label === label);
  const value = entry?.value;

  return typeof value === "string" && value.trim() !== ""
    ? value.trim()
    : undefined;
}

function formatMetadataDisplayValue({
  currency,
  item,
  label,
  orgUrlSlug,
  storeUrlSlug,
  value,
}: {
  currency: string;
  item: DailyOpeningItem;
  label: string;
  orgUrlSlug: string;
  storeUrlSlug: string;
  value: ReactNode;
}) {
  const formattedValue = getMetadataValue(label, value, currency);
  const transactionId = getArrayMetadataStringValue(
    item.metadata,
    "transactionId",
  );

  if (label === "Transaction" && transactionId) {
    return (
      <Link
        className="inline-flex items-center gap-1 text-foreground underline-offset-4 transition-colors hover:text-primary hover:underline"
        params={
          {
            orgUrlSlug,
            storeUrlSlug,
            transactionId,
          } as never
        }
        search={{ o: getOrigin() } as never}
        to="/$orgUrlSlug/store/$storeUrlSlug/pos/transactions/$transactionId"
      >
        {typeof formattedValue === "string" && !formattedValue.startsWith("#")
          ? `#${formattedValue}`
          : formattedValue}
        <ArrowUpRight aria-hidden="true" className="h-3 w-3" />
      </Link>
    );
  }

  return formattedValue;
}

const technicalOpeningMetadataLabels = new Set([
  "frozenmembercount",
  // Logical work-group internals: not operator-facing, and they render as bogus currency
  // in the numeric metadata formatter. EOD Review already omits these from carry-forward
  // rows; keep Opening Handoff consistent.
  "membercount",
  "sourcecount",
  "unresolvedmembercount",
]);

function isOperatorFacingOpeningMetadata(label: string) {
  return !technicalOpeningMetadataLabels.has(normalizeMetadataLabel(label));
}

function getMetadataEntries(
  item: DailyOpeningItem,
  currency: string,
  orgUrlSlug: string,
  storeUrlSlug: string,
) {
  if (!item.metadata) return [];

  if (Array.isArray(item.metadata)) {
    return item.metadata
      .filter(
        (entry) =>
          entry.label !== "transactionId" &&
          isOperatorFacingOpeningMetadata(entry.label),
      )
      .map((entry) => ({
        label: entry.label,
        value: formatMetadataDisplayValue({
          currency,
          item,
          label: entry.label,
          orgUrlSlug,
          storeUrlSlug,
          value: entry.value,
        }),
      }));
  }

  return Object.entries(item.metadata)
    .filter(
      ([label, value]) =>
        isOperatorFacingOpeningMetadata(label) &&
        value !== null &&
        value !== undefined &&
        value !== "",
    )
    .map(([label, value]) => ({
      label: getMetadataLabel(item, label),
      value: getMetadataValue(label, value as ReactNode, currency),
    }));
}

function normalizeCommandMessage(
  result: Exclude<NormalizedCommandResult<unknown>, { kind: "ok" }>,
) {
  if (result.kind === "user_error") {
    const normalized = toOperatorMessage(result.error.message);

    if (
      /^Open the cash drawer before starting the store day\.?$/i.test(
        normalized,
      )
    ) {
      return "Drawer closed. Open the drawer before starting the store day.";
    }

    return normalized;
  }

  return result.error.message;
}

function getStatusSignatureClassName(status: DailyOpeningStatus) {
  return cn(
    "inline-flex min-h-10 w-fit items-center gap-layout-sm",
    status === "blocked" && "text-danger",
    status === "needs_attention" && "text-warning-foreground",
    (status === "ready" || status === "started") && "text-success",
  );
}

function getStatusSignatureIconClassName(status: DailyOpeningStatus) {
  return cn(
    "inline-flex size-5 shrink-0 items-center justify-center",
    status === "blocked" && "text-danger",
    status === "needs_attention" && "text-warning-foreground",
    (status === "ready" || status === "started") && "text-success",
  );
}

function SuccessCheckIcon({
  className,
  label,
}: {
  className?: string;
  label?: string;
}) {
  return (
    <span
      aria-hidden={label ? undefined : "true"}
      aria-label={label}
      className={cn(
        "inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-success text-surface",
        className,
      )}
      role={label ? "img" : undefined}
    >
      <Check aria-hidden="true" className="h-3 w-3 stroke-[3]" />
    </span>
  );
}

function DailyOpeningStatusTitle({
  status,
  title,
}: {
  status: DailyOpeningStatus;
  title: string;
}) {
  const Icon =
    status === "blocked"
      ? Ban
      : status === "needs_attention"
        ? ClipboardCheck
        : status === "started"
          ? CheckCircle2
          : Check;

  return (
    <div
      className={getStatusSignatureClassName(status)}
      data-status={status}
      data-testid="daily-opening-status-signature"
    >
      <span
        className={getStatusSignatureIconClassName(status)}
        data-testid="daily-opening-status-icon"
      >
        <Icon aria-hidden="true" className="size-4" />
      </span>
      <h2 className="text-base font-semibold leading-tight tracking-[-0.01em] text-foreground">
        {title}
      </h2>
    </div>
  );
}

function getOpeningAutomationMessage(status: DailyOpeningAutomationStatus) {
  if (status.bucket === "scheduled_later") {
    return "Opening automation is scheduled for later.";
  }

  if (status.bucket === "needs_review") {
    return "Opening Handoff needs manager review.";
  }

  if (status.bucket === "policy_skipped") {
    return "Opening automation did not change the workflow. Review Opening Handoff manually.";
  }

  if (status.outcome === "applied") {
    return "Athena started Opening Handoff.";
  }

  if (status.outcome === "failed") {
    return "Athena could not finish the Opening Handoff automation check. Review the handoff before starting the store day.";
  }

  if (status.outcome === "dry_run") {
    return "Athena checked Opening Handoff in dry run. No workflow changes were made.";
  }

  if (status.outcome === "disabled") {
    return "Opening Handoff automation is off for this store day.";
  }

  if (status.outcome === "prepared") {
    return "Athena prepared Opening Handoff for review.";
  }

  return "Athena checked Opening Handoff. No change was made.";
}

function getVisibleOpeningAutomationStatus(
  snapshot: DailyOpeningSnapshot,
  status: DailyOpeningStatus,
) {
  const automationStatus = snapshot.automationStatus;

  if (!automationStatus) return null;

  if (automationStatus.bucket === "scheduled_later") return null;

  if (status === "started" && automationStatus.outcome !== "applied") {
    return null;
  }

  return automationStatus;
}

function OpeningAutomationStatusPanel({
  automationStatus,
}: {
  automationStatus: DailyOpeningAutomationStatus | null;
}) {
  if (!automationStatus) return null;

  return (
    <section className="px-layout-md py-layout-sm">
      <h3 className="flex items-center gap-layout-xs text-base font-medium text-foreground">
        <Bot aria-hidden="true" className="h-4 w-4" />
        Athena automation
      </h3>
      <p className="mt-layout-sm text-sm leading-6 text-foreground">
        {getOpeningAutomationMessage(automationStatus)}
      </p>
      {automationStatus.occurredAt ? (
        <p className="mt-1 text-xs text-muted-foreground">
          {formatTimestamp(automationStatus.occurredAt)}
        </p>
      ) : null}
    </section>
  );
}

function getOpeningReviewEvidence(snapshot: DailyOpeningSnapshot) {
  return (
    snapshot.startedOpening?.reviewEvidence ??
    snapshot.automationStatus?.reviewEvidence ??
    []
  );
}

function getOpeningStartedByLabel(
  startedOpening: NonNullable<DailyOpeningSnapshot["startedOpening"]>,
) {
  if (startedOpening.startedByStaffName) {
    return startedOpening.startedByStaffName;
  }

  if (startedOpening.actorType === "automation") {
    return "Athena";
  }

  return "Staff unavailable";
}

function OpeningAutomationReviewPanel({
  currency,
  items,
  orgUrlSlug,
  storeUrlSlug,
}: {
  currency: string;
  items: DailyOpeningItem[];
  orgUrlSlug: string;
  storeUrlSlug: string;
}) {
  const [page, setPage] = useState(1);
  const pageCount = Math.max(
    Math.ceil(items.length / OPENING_REVIEW_ITEMS_PER_PAGE),
    1,
  );
  const clampedPage = Math.min(page, pageCount);
  const paginatedItems = items.slice(
    (clampedPage - 1) * OPENING_REVIEW_ITEMS_PER_PAGE,
    clampedPage * OPENING_REVIEW_ITEMS_PER_PAGE,
  );
  const handlePageChange = (nextPage: number) => {
    setPage(Math.min(Math.max(nextPage, 1), pageCount));
  };

  if (items.length === 0) return null;

  return (
    <section className="rounded-lg border border-warning/25 bg-surface-raised p-layout-md shadow-surface">
      <div className="flex flex-col gap-layout-sm sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h3 className="flex items-center gap-layout-xs text-base font-medium text-foreground">
            <ClipboardCheck
              aria-hidden="true"
              className="h-4 w-4 text-warning"
            />
            Opening review
          </h3>
          <p className="mt-layout-xs text-sm leading-6 text-foreground">
            Store day started. Review the carried-forward items when a manager
            is available.
          </p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            These items stayed visible from the opening check and were not
            resolved by automation.
          </p>
        </div>
        <Badge
          className="border-warning/30 bg-warning/10 text-warning-foreground shadow-sm"
          variant="outline"
        >
          {items.length} to review
        </Badge>
      </div>
      <div className="mt-layout-md space-y-layout-xs">
        {paginatedItems.map((item) => (
          <OpeningItemCard
            currency={currency}
            item={item}
            key={getItemId(item)}
            orgUrlSlug={orgUrlSlug}
            showCollapsedDescription={false}
            storeUrlSlug={storeUrlSlug}
          />
        ))}
      </div>
      {items.length > OPENING_REVIEW_ITEMS_PER_PAGE ? (
        <ListPagination
          onPageChange={handlePageChange}
          page={clampedPage}
          pageCount={pageCount}
          pageSize={OPENING_REVIEW_ITEMS_PER_PAGE}
          totalItems={items.length}
        />
      ) : null}
    </section>
  );
}

function getStatusRailIconClassName(status: DailyOpeningStatus) {
  return cn(
    status === "blocked" && "bg-danger/10 text-danger",
    status === "needs_attention" && "bg-warning/15 text-warning-foreground",
    (status === "ready" || status === "started") &&
      "bg-success/10 text-success",
  );
}

function getStatusRailBadgeClassName(status: DailyOpeningStatus) {
  return cn(
    status === "blocked" && "text-danger",
    status === "needs_attention" && "text-warning",
    (status === "ready" || status === "started") && "text-success",
  );
}

function getBucketCountClassName(status: BucketStatus) {
  return cn(
    "shadow-sm",
    status === "blocked" && "border-danger/20 bg-danger/10 text-danger",
    status === "review" &&
      "border-warning/30 bg-warning/15 text-warning-foreground",
    status === "carry-forward" &&
      "border-primary/20 bg-primary-soft text-primary",
    status === "ready" && "border-success/20 bg-success/10 text-success",
  );
}

function formatCount(
  value: number,
  singular: string,
  zeroLabel: string,
  plural = `${singular}s`,
) {
  if (value === 0) return zeroLabel;
  if (value === 1) return `1 ${singular}`;
  return `${value} ${plural}`;
}

function getDefaultBucketValue(
  snapshot: DailyOpeningSnapshot,
  status: DailyOpeningStatus,
): BucketStatus {
  if (status === "started") return "ready";
  if (snapshot.blockers.length > 0) return "blocked";
  if (status === "needs_attention" && snapshot.reviewItems.length > 0) {
    return "review";
  }
  if (status === "needs_attention") return "carry-forward";
  return "ready";
}

function getDisplaySnapshot(
  snapshot: DailyOpeningSnapshot,
  status: DailyOpeningStatus,
): DailyOpeningSnapshot {
  if (status !== "started") return snapshot;

  return {
    ...snapshot,
    blockers: [],
    readiness: snapshot.readiness
      ? {
          ...snapshot.readiness,
          blockerCount: 0,
          status: "ready",
        }
      : undefined,
    summary: {
      ...snapshot.summary,
      blockerCount: 0,
    },
  };
}

function normalizeBucketTab(value: unknown): BucketStatus | null {
  return typeof value === "string" &&
    bucketTabValues.includes(value as BucketStatus)
    ? (value as BucketStatus)
    : null;
}

function normalizeBucketPage(value: unknown) {
  const page =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number.parseInt(value, 10)
        : 1;

  return Number.isFinite(page) && page > 0 ? page : 1;
}

function getBucketConfigs(snapshot: DailyOpeningSnapshot): BucketConfig[] {
  return [
    {
      ariaLabel: "Blocked opening items",
      description: "These items keep the store day from starting cleanly.",
      emptyText: "No hard blockers are currently reported.",
      items: snapshot.blockers,
      status: "blocked",
      title: "Blocked",
      value: "blocked",
    },
    {
      ariaLabel: "Review before opening",
      description: "These prior close details must be acknowledged.",
      emptyText: "No review items are currently reported.",
      items: snapshot.reviewItems,
      status: "review",
      title: "Needs review",
      value: "review",
    },
    {
      ariaLabel: "Carry-forward items",
      description:
        "These open work items remain unresolved after acknowledgement.",
      emptyText: "No carry-forward items are currently reported.",
      items: snapshot.carryForwardItems,
      status: "carry-forward",
      title: "Carry forward",
      value: "carry-forward",
    },
    {
      ariaLabel: "Ready opening items",
      description:
        "Completed handoff checks that support starting the store day.",
      emptyText: "Ready items will appear after the handoff is checked.",
      items: snapshot.readyItems,
      status: "ready",
      title: "Ready",
      value: "ready",
    },
  ];
}

function getVisibleBucketConfigs(
  snapshot: DailyOpeningSnapshot,
  status: DailyOpeningStatus,
) {
  const buckets = getBucketConfigs(snapshot);

  if (status !== "started") return buckets;

  return buckets.filter((bucket) => bucket.value !== "blocked");
}

function getSelectedBucketValue(
  requestedValue: BucketStatus | null,
  defaultValue: BucketStatus,
  buckets: BucketConfig[],
) {
  if (
    requestedValue &&
    buckets.some((bucket) => bucket.value === requestedValue)
  ) {
    return requestedValue;
  }

  return defaultValue;
}

function ItemLink({
  link,
  orgUrlSlug,
  storeUrlSlug,
}: {
  link?: DailyOpeningItemLink | null;
  orgUrlSlug: string;
  storeUrlSlug: string;
}) {
  if (!link) return null;

  const label = link.label ?? "Open source";

  if (link.href) {
    return (
      <Button asChild size="sm" variant="utility">
        <a href={link.href}>
          <ArrowUpRight aria-hidden="true" />
          {label}
        </a>
      </Button>
    );
  }

  if (link.to) {
    return (
      <Button asChild size="sm" variant="utility">
        <Link
          params={
            {
              orgUrlSlug,
              storeUrlSlug,
              ...(link.params ?? {}),
            } as never
          }
          search={
            {
              o: getOrigin(),
              ...(link.search ?? {}),
            } as never
          }
          to={link.to as never}
        >
          <ArrowUpRight aria-hidden="true" />
          {label}
        </Link>
      </Button>
    );
  }

  return null;
}

function OpeningItemCard({
  currency,
  item,
  orgUrlSlug,
  requiresAcknowledgement,
  selected,
  showCollapsedDescription = true,
  storeUrlSlug,
  onSelectedChange,
}: {
  currency: string;
  item: DailyOpeningItem;
  onSelectedChange?: (selected: boolean) => void;
  orgUrlSlug: string;
  requiresAcknowledgement?: boolean;
  selected?: boolean;
  showCollapsedDescription?: boolean;
  storeUrlSlug: string;
}) {
  const itemId = getItemId(item);
  const contextLabel = getItemContextLabel(item);
  const description = getItemDescription(item);
  const title = formatOpeningItemTitle(item.title);
  const metadataEntries = getMetadataEntries(
    item,
    currency,
    orgUrlSlug,
    storeUrlSlug,
  );

  return (
    <OperationReviewItemCard
      headerActionSlot={
        <ItemLink
          link={item.link}
          orgUrlSlug={orgUrlSlug}
          storeUrlSlug={storeUrlSlug}
        />
      }
      badgeSlot={
        item.statusLabel ? (
          <Badge variant="outline">{item.statusLabel}</Badge>
        ) : null
      }
      combinedHeading={title}
      contextLabel={contextLabel}
      collapsedMetadataEntries={metadataEntries}
      description={description}
      itemId={itemId}
      presentation="list"
      selectionSlot={
        requiresAcknowledgement ? (
          <input
            aria-label={`Acknowledge ${title}`}
            checked={Boolean(selected)}
            className="mt-1 h-4 w-4 rounded border-border text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            onChange={(event) => onSelectedChange?.(event.target.checked)}
            type="checkbox"
          />
        ) : null
      }
      showCollapsedDescription={showCollapsedDescription}
      stackDescription
      title={title}
    />
  );
}

function BucketSection({
  acknowledgedKeys,
  ariaLabel,
  currency,
  description,
  emptyText,
  items,
  onPageChange,
  orgUrlSlug,
  page,
  requiresAcknowledgement,
  status,
  storeUrlSlug,
  title,
  onAcknowledgedKeysChange,
}: {
  acknowledgedKeys: string[];
  ariaLabel: string;
  currency: string;
  description: string;
  emptyText: string;
  items: DailyOpeningItem[];
  onAcknowledgedKeysChange: (keys: string[]) => void;
  onPageChange: (page: number) => void;
  orgUrlSlug: string;
  page: number;
  requiresAcknowledgement?: boolean;
  status: BucketStatus;
  storeUrlSlug: string;
  title: string;
}) {
  const pageCount = Math.max(
    Math.ceil(items.length / OPENING_REVIEW_ITEMS_PER_PAGE),
    1,
  );
  const clampedPage = Math.min(page, pageCount);
  const visibleItems = items.slice(
    (clampedPage - 1) * OPENING_REVIEW_ITEMS_PER_PAGE,
    clampedPage * OPENING_REVIEW_ITEMS_PER_PAGE,
  );
  const handlePageChange = (nextPage: number) => {
    onPageChange(Math.min(Math.max(nextPage, 1), pageCount));
  };
  const iconClassName = cn(
    "flex h-10 w-10 shrink-0 items-center justify-center rounded-md",
    status === "blocked" && "bg-danger/10 text-danger",
    status === "review" && "bg-warning/15 text-warning-foreground",
    status === "carry-forward" && "bg-primary-soft text-primary",
    status === "ready" && "bg-success/10 text-success",
  );
  const Icon =
    status === "blocked"
      ? Ban
      : status === "review"
        ? ClipboardCheck
        : status === "carry-forward"
          ? RotateCcw
          : CheckCircle2;

  return (
    <OperationReviewBucketShell aria-label={ariaLabel}>
      <OperationReviewBucketHeader>
        <div className="flex items-center gap-layout-sm">
          <div className={iconClassName}>
            <Icon className="h-4 w-4" />
          </div>
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
              {title}
            </p>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              {description}
            </p>
          </div>
        </div>
        <Badge className={getBucketCountClassName(status)} variant="outline">
          {items.length}
        </Badge>
      </OperationReviewBucketHeader>

      <OperationReviewBucketBody hasItems={items.length > 0}>
        {items.length === 0 ? (
          <p className="px-layout-md text-sm leading-6 text-muted-foreground">
            {emptyText}
          </p>
        ) : (
          visibleItems.map((item) => {
            const acknowledgementKey = getAcknowledgementKey(item);

            return (
              <OpeningItemCard
                currency={currency}
                item={item}
                key={getItemId(item)}
                onSelectedChange={(isSelected) => {
                  onAcknowledgedKeysChange(
                    isSelected
                      ? [...acknowledgedKeys, acknowledgementKey]
                      : acknowledgedKeys.filter(
                          (key) => key !== acknowledgementKey,
                        ),
                  );
                }}
                orgUrlSlug={orgUrlSlug}
                requiresAcknowledgement={requiresAcknowledgement}
                selected={acknowledgedKeys.includes(acknowledgementKey)}
                storeUrlSlug={storeUrlSlug}
              />
            );
          })
        )}
      </OperationReviewBucketBody>
      {items.length > OPENING_REVIEW_ITEMS_PER_PAGE ? (
        <ListPagination
          onPageChange={handlePageChange}
          page={clampedPage}
          pageCount={pageCount}
          pageSize={OPENING_REVIEW_ITEMS_PER_PAGE}
          totalItems={items.length}
        />
      ) : null}
    </OperationReviewBucketShell>
  );
}

function BucketTabs({
  acknowledgedKeys,
  buckets,
  currency,
  onAcknowledgedKeysChange,
  onPageChange,
  onValueChange,
  orgUrlSlug,
  page,
  storeUrlSlug,
  value,
}: {
  acknowledgedKeys: string[];
  buckets: BucketConfig[];
  currency: string;
  onAcknowledgedKeysChange: (keys: string[]) => void;
  onPageChange: (page: number) => void;
  onValueChange: (value: BucketStatus) => void;
  orgUrlSlug: string;
  page: number;
  storeUrlSlug: string;
  value: BucketStatus;
}) {
  return (
    <Tabs
      className="space-y-layout-md"
      onValueChange={(nextValue) => {
        const nextBucket = normalizeBucketTab(nextValue);
        if (nextBucket) {
          onValueChange(nextBucket);
        }
      }}
      value={value}
    >
      <OperationReviewBucketTabsList aria-label="Opening Handoff buckets">
        {buckets.map((bucket) => (
          <OperationReviewBucketTabTrigger
            key={bucket.value}
            value={bucket.value}
          >
            <span>{bucket.title}</span>
            <span
              className={cn(
                "inline-flex min-w-5 items-center justify-center rounded-full border px-1.5 py-0.5 font-numeric text-[11px] font-semibold leading-none tabular-nums",
                getBucketCountClassName(bucket.status),
              )}
            >
              {bucket.items.length}
            </span>
          </OperationReviewBucketTabTrigger>
        ))}
      </OperationReviewBucketTabsList>

      {buckets.map((bucket) => (
        <TabsContent className="mt-0" key={bucket.value} value={bucket.value}>
          <BucketSection
            acknowledgedKeys={acknowledgedKeys}
            ariaLabel={bucket.ariaLabel}
            currency={currency}
            description={bucket.description}
            emptyText={bucket.emptyText}
            items={bucket.items}
            onAcknowledgedKeysChange={onAcknowledgedKeysChange}
            onPageChange={onPageChange}
            orgUrlSlug={orgUrlSlug}
            page={bucket.value === value ? page : 1}
            requiresAcknowledgement={false}
            status={bucket.status}
            storeUrlSlug={storeUrlSlug}
            title={bucket.title}
          />
        </TabsContent>
      ))}
    </Tabs>
  );
}

function OpeningRail({
  acknowledgedKeys,
  acknowledgedCount,
  acknowledgementItems,
  commandMessage,
  isBlocked,
  isStarted,
  isStarting,
  notes,
  onAcknowledgedKeysChange,
  onNotesChange,
  onStartDay,
  requiredAcknowledgementCount,
  snapshot,
  status,
}: {
  acknowledgedKeys: string[];
  acknowledgedCount: number;
  acknowledgementItems: DailyOpeningItem[];
  commandMessage?: {
    kind: "error" | "success";
    message: string;
  } | null;
  isBlocked: boolean;
  isStarted: boolean;
  isStarting: boolean;
  notes: string;
  onAcknowledgedKeysChange: (keys: string[]) => void;
  onNotesChange: (notes: string) => void;
  onStartDay: () => void;
  requiredAcknowledgementCount: number;
  snapshot: DailyOpeningSnapshot;
  status: DailyOpeningStatus;
}) {
  const copy = statusCopy[status];
  const acknowledgementComplete =
    acknowledgedCount >= requiredAcknowledgementCount;
  const boundedAcknowledgedCount = Math.min(
    acknowledgedCount,
    requiredAcknowledgementCount,
  );
  const acknowledgementProgress =
    requiredAcknowledgementCount > 0
      ? (boundedAcknowledgedCount / requiredAcknowledgementCount) * 100
      : 100;
  const acknowledgementKeys = acknowledgementItems.map(getAcknowledgementKey);
  const toggleAllAcknowledgements = () => {
    const acknowledgementKeySet = new Set(acknowledgementKeys);

    onAcknowledgedKeysChange(
      acknowledgementComplete
        ? acknowledgedKeys.filter((key) => !acknowledgementKeySet.has(key))
        : Array.from(new Set([...acknowledgedKeys, ...acknowledgementKeys])),
    );
  };
  const checklistItems = [
    {
      isClear: snapshot.blockers.length === 0,
      label: "Resolve blockers",
      tone: snapshot.blockers.length > 0 ? "danger" : "success",
      value: formatCount(snapshot.blockers.length, "blocker", "Clear"),
      valueTone: snapshot.blockers.length > 0 ? "danger" : "plain",
    },
    {
      isClear: snapshot.reviewItems.length === 0,
      label: "Review handoff",
      tone: "warning",
      value: formatCount(snapshot.reviewItems.length, "item", "Clear"),
      valueTone: snapshot.reviewItems.length > 0 ? "warning" : "plain",
    },
    {
      isClear: snapshot.carryForwardItems.length === 0,
      label: "Carry forward",
      tone: "primary",
      value: formatCount(snapshot.carryForwardItems.length, "item", "None"),
      valueTone: snapshot.carryForwardItems.length > 0 ? "primary" : "plain",
    },
  ];

  return (
    <PageWorkspaceRail>
      <OperationReviewRailShell>
        <div className="flex items-center justify-between gap-layout-md">
          <div className="flex min-w-0 items-center gap-layout-sm">
            <div
              className={cn(
                "flex h-9 w-9 shrink-0 items-center justify-center rounded-md",
                getStatusRailIconClassName(status),
              )}
            >
              {isBlocked ? (
                <Ban className="h-4 w-4" />
              ) : (
                <ListChecks className="h-4 w-4" />
              )}
            </div>
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
              Opening status
            </p>
          </div>
          <p
            className={cn(
              "shrink-0 text-sm font-semibold",
              getStatusRailBadgeClassName(status),
            )}
          >
            {copy.badge}
          </p>
        </div>
        <p className="mt-layout-sm text-sm leading-6 text-muted-foreground">
          {copy.description}
        </p>

        <div className="mt-layout-md border-t border-border pt-layout-md">
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
            Operating date
          </p>
          <p className="mt-1 text-sm font-medium text-foreground">
            {formatOperatingDateWithWeekday(snapshot.operatingDate)}
          </p>
        </div>

        <div className="mt-layout-md border-t border-border pt-layout-md">
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
            Opening checklist
          </p>
          <dl className="mt-layout-sm space-y-layout-sm text-sm">
            {checklistItems.map((item) => (
              <div
                className="flex items-center justify-between gap-layout-md"
                key={item.label}
              >
                <dt className="flex min-w-0 items-center gap-2 text-muted-foreground">
                  <span
                    aria-hidden="true"
                    className={cn(
                      "h-2 w-2 shrink-0 rounded-full",
                      item.tone === "danger" && "bg-danger",
                      item.tone === "warning" && "bg-warning",
                      item.tone === "primary" && "bg-primary",
                      item.tone === "success" && "bg-success",
                    )}
                  />
                  <span>{item.label}</span>
                </dt>
                <dd
                  className={cn(
                    "shrink-0 text-right font-medium text-foreground",
                    item.valueTone === "danger" && "text-danger",
                    item.valueTone === "warning" && "text-warning",
                    item.valueTone === "primary" && "text-primary",
                  )}
                >
                  {item.isClear ? (
                    <SuccessCheckIcon
                      className="ml-auto"
                      label={`${item.label} clear`}
                    />
                  ) : (
                    item.value
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </div>

        {requiredAcknowledgementCount > 0 && !isStarted ? (
          <section
            aria-labelledby="opening-handoff-acknowledgements-title"
            className={cn(
              "mt-layout-md overflow-hidden rounded-lg border bg-muted/15",
              acknowledgementComplete
                ? "border-success/30"
                : "border-warning/30",
            )}
          >
            <div className="flex items-start justify-between gap-layout-sm px-layout-sm py-layout-sm">
              <div className="min-w-0">
                <h3
                  className="text-sm font-semibold leading-5 text-foreground"
                  id="opening-handoff-acknowledgements-title"
                >
                  Handoff acknowledgements
                </h3>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  Review each item before starting the store day.
                </p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <span
                  className={cn(
                    "rounded-full border px-2 py-0.5 font-numeric text-xs font-semibold tabular-nums",
                    acknowledgementComplete
                      ? "border-success/30 bg-success/10 text-success"
                      : "border-warning/30 bg-warning/10 text-warning-foreground",
                  )}
                >
                  {boundedAcknowledgedCount} of {requiredAcknowledgementCount}
                </span>
                <Button
                  aria-label={`${acknowledgementComplete ? "Clear" : "Select"} all ${requiredAcknowledgementCount} handoff ${requiredAcknowledgementCount === 1 ? "item" : "items"}`}
                  className="h-auto px-2 py-1 text-xs text-muted-foreground transition-[color,background-color,transform] duration-fast ease-standard active:scale-[0.97] hover:text-foreground motion-reduce:transform-none motion-reduce:transition-none"
                  onClick={toggleAllAcknowledgements}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  {acknowledgementComplete ? "Clear all" : "Select all"}
                </Button>
              </div>
            </div>
            <div
              aria-label="Handoff acknowledgement progress"
              aria-valuemax={requiredAcknowledgementCount}
              aria-valuemin={0}
              aria-valuenow={boundedAcknowledgedCount}
              className="h-1 bg-muted"
              role="progressbar"
            >
              <div
                className={cn(
                  "h-full transition-[width,background-color] duration-standard ease-standard motion-reduce:transition-none",
                  acknowledgementComplete ? "bg-success" : "bg-warning",
                )}
                style={{ width: `${acknowledgementProgress}%` }}
              />
            </div>
            <div className="max-h-[min(42rem,calc(100vh-24rem))] overflow-y-auto overscroll-contain border-t border-border/60">
              {acknowledgementItems.map((item) => {
                const acknowledgementKey = getAcknowledgementKey(item);
                const checkboxId = `daily-opening-acknowledgement-${acknowledgementKey.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
                const displayTitle = formatOpeningItemTitle(item.title);
                const isAcknowledged =
                  acknowledgedKeys.includes(acknowledgementKey);

                return (
                  <div
                    className={cn(
                      "flex items-start gap-layout-sm border-b border-border/60 px-layout-sm transition-[background-color,transform] duration-fast ease-standard last:border-b-0 active:scale-[0.99] motion-reduce:transform-none motion-reduce:transition-none",
                      isAcknowledged
                        ? "bg-primary/10"
                        : "bg-transparent hover:bg-muted/35",
                    )}
                    key={acknowledgementKey}
                  >
                    <Checkbox
                      aria-label={`Acknowledge ${displayTitle}`}
                      checked={isAcknowledged}
                      className="mt-[0.875rem]"
                      id={checkboxId}
                      onCheckedChange={(checked) => {
                        onAcknowledgedKeysChange(
                          checked === true
                            ? [...acknowledgedKeys, acknowledgementKey]
                            : acknowledgedKeys.filter(
                                (key) => key !== acknowledgementKey,
                              ),
                        );
                      }}
                    />
                    <Label
                      className="min-w-0 flex-1 cursor-pointer py-layout-sm pr-layout-sm text-sm font-medium leading-5"
                      htmlFor={checkboxId}
                    >
                      {displayTitle}
                    </Label>
                  </div>
                );
              })}
            </div>
          </section>
        ) : null}

        {isStarted && snapshot.startedOpening ? (
          <div className="mt-layout-lg rounded-lg border border-success/30 bg-success/10 p-layout-sm">
            <p className="text-sm font-medium text-success">
              Opening handoff complete
            </p>
            <dl className="mt-layout-sm space-y-layout-xs text-sm">
              <div className="flex items-start justify-between gap-layout-md">
                <dt className="text-muted-foreground">Started by</dt>
                <dd className="text-right font-medium text-foreground">
                  {getOpeningStartedByLabel(snapshot.startedOpening)}
                </dd>
              </div>
              <div className="flex items-start justify-between gap-layout-md">
                <dt className="text-muted-foreground">Started at</dt>
                <dd className="text-right font-medium text-foreground">
                  {formatTimestamp(snapshot.startedOpening.startedAt)}
                </dd>
              </div>
            </dl>
            {snapshot.startedOpening.notes ? (
              <p className="mt-layout-sm text-sm leading-6 text-foreground">
                {snapshot.startedOpening.notes}
              </p>
            ) : null}
          </div>
        ) : (
          <div className="mt-layout-md space-y-layout-sm">
            <label
              className="text-sm font-medium text-foreground"
              htmlFor="daily-opening-notes"
            >
              Opening notes
            </label>
            <textarea
              className="min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              id="daily-opening-notes"
              onChange={(event) => onNotesChange(event.target.value)}
              placeholder="Add a short note for the opening record."
              value={notes}
            />
            <LoadingButton
              className="w-full"
              disabled={!acknowledgementComplete}
              isLoading={isStarting}
              onClick={onStartDay}
              type="button"
              variant="default"
            >
              Start Day
            </LoadingButton>
          </div>
        )}

        {commandMessage ? (
          <div
            className={cn(
              "mt-layout-md rounded-lg border p-layout-sm text-sm leading-6",
              commandMessage.kind === "error"
                ? "border-danger/30 bg-danger/10 text-danger"
                : "border-success/30 bg-success/10 text-success",
            )}
            role={commandMessage.kind === "error" ? "alert" : "status"}
          >
            {commandMessage.message}
          </div>
        ) : null}
      </OperationReviewRailShell>
    </PageWorkspaceRail>
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

    const today = getOperatingClockNow();

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
          defaultMonth={selectedDate ?? undefined}
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

export function DailyOpeningViewContent({
  currency,
  hasFullAdminAccess,
  isAuthenticated,
  isLoadingAccess,
  isLoadingSnapshot,
  isStarting,
  onAuthenticateStaff,
  onOperatingDateChange,
  onStartDay,
  orgUrlSlug,
  snapshot,
  storeId,
  storeUrlSlug,
}: DailyOpeningViewContentProps) {
  const [acknowledgedKeys, setAcknowledgedKeys] = useState<string[]>([]);
  const [notes, setNotes] = useState("");
  const [commandMessage, setCommandMessage] = useState<{
    kind: "error" | "success";
    message: string;
  } | null>(null);
  const [pendingStaffStartArgs, setPendingStaffStartArgs] =
    useState<StartDayArgs | null>(null);
  const [isStaffAuthOpen, setIsStaffAuthOpen] = useState(false);
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as {
    page?: unknown;
    tab?: unknown;
  };
  const requiredAcknowledgementKeys = useMemo(
    () => getRequiredAcknowledgementKeys(snapshot),
    [snapshot],
  );
  const acknowledgementItems = useMemo(
    () => [
      ...(snapshot?.reviewItems ?? []),
      ...(snapshot?.carryForwardItems ?? []),
    ],
    [snapshot],
  );
  if (isLoadingAccess) {
    return null;
  }

  if (!isAuthenticated) {
    return (
      <ProtectedAdminSignInView description="Your Athena session needs to reconnect before Opening Handoff can load protected store-day data" />
    );
  }

  if (!hasFullAdminAccess) {
    return <NoPermissionView />;
  }

  if (!storeId) {
    return (
      <div className="container mx-auto py-8">
        <EmptyState
          description="Select a store before opening Opening Handoff."
          title="No active store"
        />
      </div>
    );
  }

  const status = snapshot ? getOpeningStatus(snapshot) : "ready";
  const isBlocked = status === "blocked";
  const isStarted = status === "started";
  const displayCopy = statusCopy[status];
  const displaySnapshot = snapshot
    ? getDisplaySnapshot(snapshot, status)
    : null;
  const automationStatus = snapshot
    ? getVisibleOpeningAutomationStatus(snapshot, status)
    : null;
  const reviewEvidence = snapshot ? getOpeningReviewEvidence(snapshot) : [];
  const buckets = displaySnapshot
    ? getVisibleBucketConfigs(displaySnapshot, status)
    : [];
  const defaultBucketValue = displaySnapshot
    ? getDefaultBucketValue(displaySnapshot, status)
    : "ready";
  const selectedBucketValue = getSelectedBucketValue(
    normalizeBucketTab(search.tab),
    defaultBucketValue,
    buckets,
  );
  const selectedBucketPage = normalizeBucketPage(search.page);
  const acknowledgedRequiredCount = requiredAcknowledgementKeys.filter((key) =>
    acknowledgedKeys.includes(key),
  ).length;

  const startDayWithArgs = async (args: StartDayArgs) => {
    const result = await onStartDay(args);

    if (result.kind === "ok") {
      setPendingStaffStartArgs(null);
      setIsStaffAuthOpen(false);
      setCommandMessage({
        kind: "success",
        message: "Store day started.",
      });
      return;
    }

    setCommandMessage({
      kind: "error",
      message: normalizeCommandMessage(result),
    });
  };

  const submitStartDay = async (approval?: {
    approvalProofId: Id<"approvalProof">;
    approvedByStaffProfileId: Id<"staffProfile">;
  }) => {
    if (!snapshot || isStarted) return;

    const acknowledgementComplete =
      acknowledgedRequiredCount >= requiredAcknowledgementKeys.length;

    if (!acknowledgementComplete) return;

    setCommandMessage(null);

    const startArgs = {
      acknowledgedItemKeys: requiredAcknowledgementKeys,
      ...(approval
        ? {
            actorStaffProfileId: approval.approvedByStaffProfileId,
            approvalProofId: approval.approvalProofId,
          }
        : {}),
      endAt: snapshot.endAt,
      notes,
      operatingDate: snapshot.operatingDate,
      startAt: snapshot.startAt,
    };

    if (approval || !onAuthenticateStaff) {
      await startDayWithArgs(startArgs);
      return;
    }

    setPendingStaffStartArgs(startArgs);
    setIsStaffAuthOpen(true);
  };

  const handleStartDay = () => {
    void submitStartDay();
  };

  const handleStaffAuthenticatedForStart = (
    result: StaffAuthenticationResult,
  ) => {
    if (!pendingStaffStartArgs) {
      setIsStaffAuthOpen(false);
      return;
    }

    void startDayWithArgs({
      ...pendingStaffStartArgs,
      actorStaffProfileId: result.staffProfileId,
    });
  };

  const handleBucketValueChange = (value: BucketStatus) => {
    void navigate({
      search: ((current: Record<string, unknown>) => ({
        ...current,
        page: undefined,
        tab: value,
      })) as never,
    });
  };
  const handleBucketPageChange = (page: number) => {
    void navigate({
      search: ((current: Record<string, unknown>) => ({
        ...current,
        page: page === 1 ? undefined : page,
        tab: selectedBucketValue,
      })) as never,
    });
  };

  return (
    <>
      <OperationReviewWorkspace
        actions={
          snapshot ? (
            <OperatingDatePicker
              operatingDate={snapshot.operatingDate}
              onChange={onOperatingDateChange}
            />
          ) : null
        }
        afterGrid={null}
        beforeMetrics={
          snapshot ? (
            <OpeningAutomationStatusPanel automationStatus={automationStatus} />
          ) : null
        }
        description="Review prior close handoff, acknowledge carry-forward work, and confirm whether the store day can start."
        eyebrow="Store Ops"
        isLoading={isLoadingSnapshot || !snapshot}
        loadingContent={null}
        showBackButton
        main={
          snapshot ? (
            <div className="space-y-layout-lg">
              {isStarted ? (
                <OpeningAutomationReviewPanel
                  currency={currency}
                  items={reviewEvidence}
                  orgUrlSlug={orgUrlSlug}
                  storeUrlSlug={storeUrlSlug}
                />
              ) : null}
              <BucketTabs
                acknowledgedKeys={acknowledgedKeys}
                buckets={buckets}
                currency={currency}
                onAcknowledgedKeysChange={setAcknowledgedKeys}
                onPageChange={handleBucketPageChange}
                onValueChange={handleBucketValueChange}
                orgUrlSlug={orgUrlSlug}
                page={selectedBucketPage}
                storeUrlSlug={storeUrlSlug}
                value={selectedBucketValue}
              />
            </div>
          ) : null
        }
        metrics={
          snapshot ? (
            <>
              <OperationsSummaryMetric
                label="Prior close"
                tone="quiet"
                value={
                  snapshot.priorClose
                    ? formatOperatingDate(snapshot.priorClose.operatingDate)
                    : "Not found"
                }
              />
              <OperationsSummaryMetric
                label="Blockers"
                tone="quiet"
                value={formatCount(
                  displaySnapshot?.summary?.blockerCount ??
                    displaySnapshot?.blockers.length ??
                    0,
                  "blocker",
                  "No hard blockers",
                )}
              />
              <OperationsSummaryMetric
                label="Needs review"
                tone="quiet"
                value={formatCount(
                  snapshot.summary?.reviewCount ?? snapshot.reviewItems.length,
                  "item",
                  "No review items",
                )}
              />
              <OperationsSummaryMetric
                label="Carry forward"
                tone="quiet"
                value={formatCount(
                  snapshot.summary?.carryForwardCount ??
                    snapshot.carryForwardItems.length,
                  "item",
                  "No carry-forward items",
                )}
              />
            </>
          ) : null
        }
        rail={
          snapshot ? (
            <OpeningRail
              acknowledgedKeys={acknowledgedKeys}
              acknowledgedCount={acknowledgedRequiredCount}
              acknowledgementItems={acknowledgementItems}
              commandMessage={commandMessage}
              isBlocked={isBlocked}
              isStarted={isStarted}
              isStarting={isStarting}
              notes={notes}
              onAcknowledgedKeysChange={setAcknowledgedKeys}
              onNotesChange={setNotes}
              onStartDay={handleStartDay}
              requiredAcknowledgementCount={requiredAcknowledgementKeys.length}
              snapshot={displaySnapshot ?? snapshot}
              status={status}
            />
          ) : null
        }
        statusDescription={displayCopy.description}
        statusTitle={
          <DailyOpeningStatusTitle status={status} title={displayCopy.title} />
        }
        title="Opening Handoff"
      />
      {onAuthenticateStaff ? (
        <StaffAuthenticationDialog
          copy={{
            description: "Start the store day with your staff sign-in.",
            submitLabel: "Start day",
            title: "Confirm staff credentials",
          }}
          hideAlternateAction
          onAuthenticate={(args) => onAuthenticateStaff(args)}
          onAuthenticated={handleStaffAuthenticatedForStart}
          onDismiss={() => {
            setIsStaffAuthOpen(false);
            setPendingStaffStartArgs(null);
          }}
          open={isStaffAuthOpen}
        />
      ) : null}
    </>
  );
}

function DailyOpeningApiPendingView() {
  return (
    <View hideBorder hideHeaderBottomBorder scrollMode="page">
      <FadeIn className="container mx-auto py-layout-xl">
        <PageWorkspace>
          <PageLevelHeader
            eyebrow="Store Ops"
            title="Opening Handoff"
            description="Opening Handoff is waiting for the server readiness snapshot and start-day command."
            showBackButton
          />
          <EmptyState
            description="The frontend is wired to api.operations.dailyOpening.getDailyOpeningSnapshot and startStoreDay."
            title="Opening Handoff server API pending"
          />
        </PageWorkspace>
      </FadeIn>
    </View>
  );
}

type DailyOpeningConnectedViewProps = {
  getDailyOpeningSnapshot: unknown;
  startStoreDay: unknown;
};

function DailyOpeningConnectedView({
  getDailyOpeningSnapshot,
  startStoreDay,
}: DailyOpeningConnectedViewProps) {
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
  const [isStarting, setIsStarting] = useState(false);
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as {
    operatingDate?: unknown;
  };
  const operatingDateRange = useMemo(
    () => getLocalOperatingDateRangeFromSearch(search.operatingDate),
    [search.operatingDate],
  );
  const snapshot = useExpectedDailyOpeningQuery(
    getDailyOpeningSnapshot,
    canQueryProtectedData
      ? { ...operatingDateRange, storeId: activeStore!._id }
      : "skip",
  ) as DailyOpeningSnapshot | undefined;
  const sharedDemoContext = useSharedDemoContext();
  const startStoreDayMutation = useExpectedDailyOpeningMutation(startStoreDay);
  const authenticateStaffCredential = useMutation(
    api.operations.staffCredentials.authenticateStaffCredential,
  );
  const authenticateStaffCredentialForApproval = useMutation(
    api.operations.staffCredentials.authenticateStaffCredentialForApproval,
  );

  async function handleAuthenticateStaff(args: {
    pinHash: string;
    username: string;
  }): Promise<NormalizedCommandResult<StaffAuthenticationResult>> {
    if (!activeStore?._id) {
      return {
        kind: "user_error",
        error: {
          code: "authentication_failed",
          message: "Select a store before confirming staff credentials.",
        },
      };
    }

    return runCommand(
      () =>
        authenticateStaffCredential({
          allowedRoles: ["cashier", "manager"],
          pinHash: args.pinHash,
          storeId: activeStore._id,
          username: args.username,
        }) as Promise<CommandResult<StaffAuthenticationResult>>,
    );
  }

  async function handleAuthenticateForApproval(args: {
    actionKey: string;
    pinHash: string;
    reason?: string;
    requiredRole: ApprovalRequirement["requiredRole"];
    requesterBinding?: ApprovalRequesterBinding;
    requestedByStaffProfileId?: Id<"staffProfile">;
    storeId: Id<"store">;
    subject: ApprovalRequirement["subject"];
    username: string;
  }) {
    if (!activeStore?._id) {
      return {
        kind: "user_error",
        error: {
          code: "authentication_failed",
          message: "Select a store before confirming manager credentials.",
        },
      } as NormalizedCommandResult<{
        approvalProofId: Id<"approvalProof">;
        approvedByStaffProfileId: Id<"staffProfile">;
        expiresAt: number;
        requestedByStaffProfileId?: Id<"staffProfile">;
      }>;
    }

    return runCommand(() =>
      authenticateStaffCredentialForApproval({
        actionKey: args.actionKey,
        pinHash: args.pinHash,
        reason: args.reason,
        requiredRole: args.requiredRole,
        requesterBinding: toApprovalRequesterBindingArg(args.requesterBinding),
        requestedByStaffProfileId: args.requestedByStaffProfileId,
        storeId: args.storeId,
        subject: args.subject,
        username: args.username,
      }),
    );
  }

  const handleStartDay = async (args: StartDayArgs) => {
    if (!activeStore?._id) {
      return {
        kind: "user_error",
        error: {
          code: "validation_failed",
          message: "Select a store before starting the store day.",
        },
      } as NormalizedCommandResult<unknown>;
    }

    setIsStarting(true);

    try {
      return await runCommand(
        () =>
          startStoreDayMutation({
            acknowledgedItemKeys: args.acknowledgedItemKeys,
            actorStaffProfileId: args.actorStaffProfileId,
            approvalProofId: args.approvalProofId,
            endAt: args.endAt,
            notes: args.notes || undefined,
            operatingDate: args.operatingDate,
            startAt: args.startAt,
            storeId: activeStore._id,
          }) as Promise<CommandResult<unknown>>,
      );
    } finally {
      setIsStarting(false);
    }
  };

  const handleOperatingDateChange = (date: Date) => {
    const nextRange = getLocalOperatingDateRange(date);

    void navigate({
      search: ((current: Record<string, unknown>) => ({
        ...current,
        operatingDate: nextRange.operatingDate,
        tab: undefined,
      })) as never,
    });
  };

  return (
    <DailyOpeningViewContent
      currency={activeStore?.currency || "USD"}
      hasFullAdminAccess={canAccessSurface}
      isAuthenticated={isAuthenticated}
      isLoadingAccess={isLoadingAccess}
      isLoadingSnapshot={snapshot === undefined}
      isStarting={isStarting}
      onAuthenticateStaff={
        sharedDemoContext?.kind === "shared_demo"
          ? undefined
          : handleAuthenticateStaff
      }
      onAuthenticateForApproval={handleAuthenticateForApproval}
      onOperatingDateChange={handleOperatingDateChange}
      onStartDay={handleStartDay}
      orgUrlSlug={params?.orgUrlSlug ?? ""}
      snapshot={snapshot}
      storeId={activeStore?._id}
      storeUrlSlug={params?.storeUrlSlug ?? ""}
    />
  );
}

export function DailyOpeningView({
  fixture,
}: {
  /**
   * Renders the workspace from a supplied prop bag instead of Convex, for screenshot
   * fixtures. When set, no snapshot query runs. Development only — see
   * `src/stories/operations`.
   */
  fixture?: DailyOpeningViewContentProps;
} = {}) {
  const dailyOpeningApi = getDailyOpeningApi();

  if (fixture) {
    return <DailyOpeningViewContent {...fixture} />;
  }

  if (
    !dailyOpeningApi.getDailyOpeningSnapshot ||
    !dailyOpeningApi.startStoreDay
  ) {
    return <DailyOpeningApiPendingView />;
  }

  return (
    <DailyOpeningConnectedView
      getDailyOpeningSnapshot={dailyOpeningApi.getDailyOpeningSnapshot}
      startStoreDay={dailyOpeningApi.startStoreDay}
    />
  );
}
