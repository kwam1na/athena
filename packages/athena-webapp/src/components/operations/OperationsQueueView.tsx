import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link, useParams, useSearch } from "@tanstack/react-router";
import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import {
  ArrowUpRight,
  CalendarClock,
  ClipboardCheck,
  Lock,
  LockOpen,
  PackageCheck,
  PackageSearch,
  ReceiptText,
  Scissors,
  ShoppingCart,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { FadeIn } from "../common/FadeIn";
import {
  PageLevelHeader,
  PageWorkspace,
  PageWorkspaceGrid,
  PageWorkspaceMain,
  PageWorkspaceRail,
} from "../common/PageLevelHeader";
import { ListPagination } from "../common/ListPagination";
import { EmptyState } from "../states/empty/empty-state";
import { NoPermissionView } from "../states/no-permission/NoPermissionView";
import { ProtectedAdminSignInView } from "../states/signed-out/ProtectedAdminSignInView";
import { useProtectedAdminPageState } from "@/hooks/useProtectedAdminPageState";
import { formatReviewReason } from "@/components/cash-controls/formatReviewReason";
import {
  StaffAuthenticationDialog,
  type StaffAuthenticationResult,
} from "@/components/staff-auth/StaffAuthenticationDialog";
import { api } from "~/convex/_generated/api";
import type { Id } from "~/convex/_generated/dataModel";
import { presentCommandToast } from "@/lib/errors/presentCommandToast";
import { formatStoredAmount } from "@/lib/pos/displayAmounts";
import {
  runCommand,
  type NormalizedApprovalCommandResult,
  type NormalizedCommandResult,
} from "@/lib/errors/runCommand";
import { getOrigin } from "@/lib/navigationUtils";
import { normalizeSkuSearchQuery } from "@/lib/stockOps/skuSearch";
import type { CommandResult } from "~/shared/commandResult";
import { currencyFormatter } from "~/shared/currencyFormatter";
import { capitalizeWords, cn, getRelativeTime } from "@/lib/utils";
import { StockAdjustmentWorkspaceContent } from "./StockAdjustmentWorkspace";
import type {
  CycleCountDraftSummary,
  CycleCountDraftState,
  InventorySnapshotItem,
  InventoryUnitSummary,
  StockAdjustmentSearchPatch,
  StockAdjustmentSearchState,
  SubmitStockAdjustmentArgs,
} from "./StockAdjustmentWorkspace";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { LoadingButton } from "../ui/loading-button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import {
  OperationReviewItemCard,
  type OperationReviewMetadataEntry,
} from "./OperationReviewItemCard";
import { OperationsSummaryMetric } from "./OperationsSummaryMetric";

const operationsApi = api.operations;
const stockOpsApi = api.stockOps;
const ghsCurrencyFormatter = currencyFormatter("GHS");
const APPROVAL_DECISION_ACTION_KEY = "operations.approval_request.decide";
const REGISTER_SESSION_SYNC_REVIEW_APPROVAL_ACTION_KEY =
  "cash_controls.register_session.resolve_sync_review";
const REGISTER_VARIANCE_REVIEW_ACTION_KEY =
  "cash_controls.register_session.review_variance";
const APPROVAL_PAGE_UNLOCK_TTL_MS = 5 * 60 * 1000;
const OPEN_WORK_ITEMS_PER_PAGE = 5;
const UNCATEGORIZED_COUNT_SCOPE_KEY = "__uncategorized";
const openWorkActionLinkClassName =
  "inline-flex items-center gap-1.5 text-sm font-medium text-foreground underline-offset-4 transition-colors hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

type ProductSkuSearchResponse = {
  results: Array<{
    productSkuId: Id<"productSku">;
  }>;
};

type QueueWorkItem = {
  _id: Id<"operationalWorkItem">;
  approvalRequestId?: Id<"approvalRequest">;
  approvalState: string;
  assignedStaffName?: string | null;
  completedAt?: number | null;
  createdAt: number;
  customerName?: string | null;
  details?: {
    businessDate?: string | null;
    displayNumber?: string | null;
    followUpReason?: string | null;
    inventoryReviewLineCount?: number | null;
    itemCount?: number | null;
    localRegisterSessionId?: string | null;
    localTransactionId?: string | null;
    lookupCode?: string | null;
    price?: number | null;
    primaryProductSkuId?: string | null;
    productId?: string | null;
    productName?: string | null;
    productSkuId?: string | null;
    provisionalProductId?: string | null;
    provisionalProductSkuId?: string | null;
    purchaseOrderNumber?: string | null;
    quantitySold?: number | null;
    reasonLabel?: string | null;
    receiptNumber?: string | null;
    registerSessionId?: string | null;
    sku?: string | null;
    sourceId?: string | null;
    terminalId?: string | null;
    totalQuantitySold?: number | null;
    vendorName?: string | null;
  } | null;
  dueAt?: number | null;
  logicalGroup?: {
    completeness: "complete" | "incomplete";
    key: string;
    memberIds: Id<"operationalWorkItem">[];
    members: QueueWorkItem[];
    oldestActionableAt?: number;
    resolutionAvailability:
      | "available"
      | "budget_exceeded"
      | "remediation_in_progress"
      | "source_incomplete";
  };
  priority: string;
  sourceIdentity?: string;
  startedAt?: number | null;
  status: string;
  title: string;
  type: string;
};

const LOGICAL_GROUP_CHANGED_MESSAGE =
  "This work changed. Review the refreshed group before marking it reviewed.";

function logicalGroupObservationFingerprint(
  group: NonNullable<QueueWorkItem["logicalGroup"]>,
) {
  return [
    group.key,
    group.completeness,
    group.resolutionAvailability,
    [...group.memberIds].map(String).sort().join(","),
  ].join("|");
}

type QueueWorkItemMixEntry = {
  completeness: "complete" | "incomplete";
  count: number;
  label: string;
  percent: number;
  type: string;
};

type QueueWorkItemSummary = {
  byType: Array<{
    completeness: "complete" | "incomplete";
    count: number;
    overflow: boolean;
    type: string;
  }>;
  completeness: "complete" | "incomplete";
  count: number;
};

type LogicalGroupConflictObservation = {
  fingerprint: string;
  refreshNonce: number;
};

type QueueOverflow = {
  approvalRequests: boolean;
  workItems: {
    inProgress: boolean;
    open: boolean;
  };
};

type QueueApprovalRequest = {
  _id: string;
  metadata?: {
    amount?: number;
    adjustmentType?: string;
    conflictCount?: number;
    largestAbsoluteDelta?: number;
    lineItems?: Array<{
      adjustedQuantity?: number;
      countedQuantity?: number;
      originalQuantity?: number;
      productName?: string;
      productSkuId?: Id<"productSku">;
      quantityDelta?: number;
      sku?: string;
      systemQuantity?: number;
      totalDelta?: number;
      unitPrice?: number;
    }>;
    netQuantityDelta?: number;
    paymentMethod?: string;
    previousPaymentMethod?: string;
    reasonCode?: string;
    settlementAmount?: number;
    settlementDirection?: string;
    settlementMethod?: string;
    adjustedTotal?: number;
    originalTotal?: number;
    reviewItems?: Array<{
      id?: string;
      localEventId?: string;
      sequence?: number;
      summary?: string;
      type?: string;
    }>;
    totalDelta?: number;
    transactionId?: Id<"posTransaction">;
    countedCash?: number;
    expectedCash?: number;
    variance?: number;
  } | null;
  notes?: string | null;
  requestedByStaffName?: string | null;
  createdAt?: number;
  requestType: string;
  reason?: string | null;
  registerSessionSummary?: {
    countedCash?: number | null;
    expectedCash: number;
    registerNumber?: string | null;
    registerSessionId: Id<"registerSession">;
    status: string;
    terminalName?: string | null;
    variance?: number | null;
  } | null;
  status: string;
  transactionSummary?: {
    completedAt?: number;
    paymentMethod?: string | null;
    total: number;
    totalPaid: number;
    transactionId: Id<"posTransaction">;
    transactionNumber: string;
  } | null;
  workItemTitle?: string | null;
};

export type OperationsWorkflow = "stock" | "queue" | "approvals";
export type OpenWorkSearchState = {
  page?: number;
  workType?: string;
};
export type OpenWorkSearchPatch = Partial<OpenWorkSearchState>;

type QueueApprovalLineItem = NonNullable<
  NonNullable<QueueApprovalRequest["metadata"]>["lineItems"]
>[number];

function getDefaultWorkflow(args: {
  approvalRequests: QueueApprovalRequest[];
  workItems: QueueWorkItem[];
}): OperationsWorkflow {
  if (args.approvalRequests.length > 0) return "approvals";
  if (args.workItems.length > 0) return "queue";
  return "stock";
}

function formatOpenWorkHeaderTitle(
  count: number,
  workType?: string,
  isLowerBound = false,
) {
  const displayCount = `${count.toLocaleString()}${isLowerBound ? "+" : ""}`;
  if (!workType) {
    return `${displayCount} open work ${count === 1 ? "item" : "items"}`;
  }

  const sentenceCaseWorkTypeLabel = getSentenceCaseWorkTypeLabel(workType);

  return `${displayCount} open ${sentenceCaseWorkTypeLabel} work ${count === 1 ? "item" : "items"}`;
}

function getSentenceCaseWorkTypeLabel(workType: string) {
  const workTypeLabel = getQueueWorkItemTypeLabel(workType);
  return /^[A-Z]{2,}\b/.test(workTypeLabel)
    ? workTypeLabel
    : workTypeLabel.toLocaleLowerCase();
}

function formatApprovalsHeaderTitle(count: number) {
  if (count === 0) return "No pending approvals";

  return `${count.toLocaleString()} pending ${count === 1 ? "approval" : "approvals"}`;
}

function formatQueueWorkItemValue(value: string) {
  return capitalizeWords(value.replace(/_/g, " "));
}

function preserveOperationalAcronyms(value: string) {
  return value.replace(/\bSku\b/g, "SKU").replace(/\bPos\b/g, "POS");
}

function formatWorkItemTitle(title: string) {
  const prefixes = ["Review inventory for ", "Review pending checkout item: "];

  for (const prefix of prefixes) {
    if (title.startsWith(prefix)) {
      const subject = title.slice(prefix.length).trim();

      if (subject) {
        return `${prefix}${preserveOperationalAcronyms(capitalizeWords(subject))}`;
      }
    }
  }

  return preserveOperationalAcronyms(capitalizeWords(title));
}

function getWorkItemTitleSubject(title: string, prefix: string) {
  if (!title.startsWith(prefix)) return null;

  const subject = title.slice(prefix.length).trim();

  return subject ? preserveOperationalAcronyms(capitalizeWords(subject)) : null;
}

function formatCatalogSetupProductName(item: QueueWorkItem) {
  const productName = getQueueWorkItemStringDetail(item, "productName");
  if (productName) {
    return preserveOperationalAcronyms(capitalizeWords(productName));
  }

  return (
    getQueueWorkItemStringDetail(item, "productId") ?? "Product not recorded"
  );
}

function getQueueWorkItemTypeLabel(type: string) {
  if (type === "pos_pending_checkout_item_review") {
    return "POS pending checkout";
  }

  if (type === "catalog_taxonomy_setup") {
    return "Catalog setup";
  }

  if (type === "synced_sale_inventory_review") {
    return "Synced sale inventory";
  }

  if (type === "service_case") {
    return "Service case";
  }

  if (type === "service_appointment") {
    return "Service appointment";
  }

  if (type === "service_intake") {
    return "Service intake";
  }

  if (type === "purchase_order") {
    return "Purchase order";
  }

  if (type === "stock_adjustment_review") {
    return "Stock adjustment approval";
  }

  if (type === "daily_close_carry_forward") {
    return "Daily close follow-up";
  }

  if (type === "service_deposit_review") {
    return "Unsupported work type";
  }

  return formatQueueWorkItemValue(type);
}

function getOpenWorkMixEntries(
  workItems: QueueWorkItem[],
  summary?: QueueWorkItemSummary | null,
): QueueWorkItemMixEntry[] {
  if (summary) {
    return summary.byType
      .filter((entry) => entry.count > 0)
      .map((entry) => ({
        completeness: entry.completeness,
        count: entry.count,
        label: getQueueWorkItemTypeLabel(entry.type),
        percent:
          summary.count > 0
            ? Math.round((entry.count / summary.count) * 100)
            : 0,
        type: entry.type,
      }))
      .sort((left, right) => {
        if (right.count !== left.count) return right.count - left.count;
        return left.label.localeCompare(right.label);
      });
  }
  const displayGroups = groupOpenWorkItems(workItems);
  const countsByType = new Map<string, number>();

  for (const group of displayGroups) {
    const type = group.items[0].type;
    countsByType.set(type, (countsByType.get(type) ?? 0) + 1);
  }

  return Array.from(countsByType.entries())
    .map(([type, count]) => ({
      completeness: "complete" as const,
      count,
      label: getQueueWorkItemTypeLabel(type),
      percent: Math.round((count / displayGroups.length) * 100),
      type,
    }))
    .sort((left, right) => {
      if (right.count !== left.count) return right.count - left.count;

      return left.label.localeCompare(right.label);
    });
}

function groupOpenWorkItems(workItems: QueueWorkItem[]) {
  return workItems.map((item) => ({
    items: item.logicalGroup
      ? [
          item,
          ...item.logicalGroup.members.filter(
            (member) => member._id !== item._id,
          ),
        ]
      : [item],
    key: item.logicalGroup?.key ?? item._id,
  }));
}

function formatOpenWorkMixCount(
  count: number,
  completeness: "complete" | "incomplete" = "complete",
) {
  return `${count.toLocaleString()}${completeness === "incomplete" ? "+" : ""} ${count === 1 ? "item" : "items"}`;
}

function hasOpenWorkOverflow(overflow?: QueueOverflow | null) {
  return Boolean(overflow?.workItems.open || overflow?.workItems.inProgress);
}

function CappedQueueNotice({
  children,
  title,
}: {
  children: ReactNode;
  title: string;
}) {
  return (
    <div
      className="rounded-lg border border-warning/30 bg-warning/10 p-layout-sm text-sm leading-6 text-warning-foreground"
      role="status"
    >
      <p className="font-medium text-foreground">{title}</p>
      <p className="mt-1 text-muted-foreground">{children}</p>
    </div>
  );
}

function hasSyncedSaleInventoryResolverDetails(item: QueueWorkItem) {
  return Boolean(getQueueWorkItemStringDetail(item, "primaryProductSkuId"));
}

function getQueueWorkItemContextPresentation(type: string) {
  if (type === "pos_pending_checkout_item_review") {
    return {
      cardClassName: "bg-surface-raised hover:border-border",
      Icon: ShoppingCart,
      iconClassName:
        "border-action-workflow-border bg-action-workflow-soft text-action-workflow",
      contextLabelClassName: "text-action-workflow",
    };
  }

  if (type === "catalog_taxonomy_setup") {
    return {
      cardClassName: "bg-surface-raised hover:border-border",
      Icon: PackageSearch,
      iconClassName:
        "border-action-workflow-border bg-action-workflow-soft text-action-workflow",
      contextLabelClassName: "text-action-workflow",
    };
  }

  if (type === "synced_sale_inventory_review") {
    return {
      cardClassName: "bg-surface-raised hover:border-border",
      Icon: ReceiptText,
      iconClassName: "border-warning-border bg-warning-soft text-warning",
      contextLabelClassName: "text-warning",
    };
  }

  if (
    type === "service_case" ||
    type === "service_appointment" ||
    type === "service_intake"
  ) {
    return {
      cardClassName: "bg-surface-raised hover:border-border",
      Icon: Scissors,
      iconClassName: "border-success/25 bg-success/10 text-success",
      contextLabelClassName: "text-success",
    };
  }

  if (type === "purchase_order") {
    return {
      cardClassName: "bg-surface-raised hover:border-border",
      Icon: PackageCheck,
      iconClassName:
        "border-action-workflow-border bg-action-workflow-soft text-action-workflow",
      contextLabelClassName: "text-action-workflow",
    };
  }

  if (type === "daily_close_carry_forward") {
    return {
      cardClassName: "bg-surface-raised hover:border-border",
      Icon: CalendarClock,
      iconClassName: "border-warning-border bg-warning-soft text-warning",
      contextLabelClassName: "text-warning",
    };
  }

  return {
    cardClassName: "bg-surface-raised hover:border-border",
    Icon: ClipboardCheck,
    iconClassName:
      "border-action-workflow-border bg-action-workflow-soft text-action-workflow",
    contextLabelClassName: "text-action-workflow",
  };
}

function WorkItemContextIcon({
  className,
  Icon,
}: {
  className: string;
  Icon: LucideIcon;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex h-5 w-5 shrink-0 items-center justify-center rounded border",
        className,
      )}
    >
      <Icon className="h-3 w-3" strokeWidth={2} />
    </span>
  );
}

function getQueueWorkItemStringDetail(
  item: QueueWorkItem,
  key: keyof NonNullable<QueueWorkItem["details"]>,
): string | undefined {
  const value = item.details?.[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function getQueueWorkItemNumberDetail(
  item: QueueWorkItem,
  key: keyof NonNullable<QueueWorkItem["details"]>,
): number | undefined {
  const value = item.details?.[key];
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function getQueueWorkItemInventoryReviewLineCount(item: QueueWorkItem) {
  return getQueueWorkItemNumberDetail(item, "inventoryReviewLineCount");
}

function getQueueWorkItemStockAdjustmentSkuId(item: QueueWorkItem) {
  if (item.type === "synced_sale_inventory_review") {
    return getQueueWorkItemStringDetail(item, "primaryProductSkuId") as
      Id<"productSku"> | undefined;
  }

  return undefined;
}

function formatOptionalQuantity(value: number | undefined) {
  return typeof value === "number" ? value.toLocaleString() : "Unknown";
}

function formatOptionalLineCount(value: number | undefined) {
  if (typeof value !== "number") {
    return "Not recorded";
  }

  return `${value.toLocaleString()} ${value === 1 ? "line" : "lines"}`;
}

function formatOptionalItemCount(value: number | undefined) {
  if (typeof value !== "number") {
    return "Not recorded";
  }

  return `${value.toLocaleString()} ${value === 1 ? "item" : "items"}`;
}

function formatOptionalMoney(value: number | undefined) {
  return typeof value === "number"
    ? formatStoredAmount(ghsCurrencyFormatter, value)
    : "Unknown";
}

function formatReceiptNumber(value: string | undefined) {
  return value ? `#${value}` : "Unknown";
}

function formatBusinessDate(value: string | undefined) {
  if (!value) return "Not recorded";

  const date = new Date(`${value}T00:00:00`);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "long",
  }).format(date);
}

function getQueueWorkItemTransactionId(item: QueueWorkItem) {
  const sourceId = getQueueWorkItemStringDetail(item, "sourceId");

  return sourceId ? (sourceId as Id<"posTransaction">) : undefined;
}

function ReceiptReferenceLink({
  orgUrlSlug,
  receiptNumber,
  storeUrlSlug,
  transactionId,
}: {
  orgUrlSlug?: string;
  receiptNumber?: string;
  storeUrlSlug?: string;
  transactionId?: Id<"posTransaction">;
}) {
  const receiptLabel = formatReceiptNumber(receiptNumber);

  if (!orgUrlSlug || !storeUrlSlug || !transactionId) {
    return <span>{receiptLabel}</span>;
  }

  return (
    <Link
      aria-label={`Open transaction ${receiptLabel}`}
      className="inline-flex items-center gap-1 text-foreground underline-offset-4 transition-colors hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      params={{
        orgUrlSlug,
        storeUrlSlug,
        transactionId,
      }}
      search={{ o: getOrigin() }}
      to="/$orgUrlSlug/store/$storeUrlSlug/pos/transactions/$transactionId"
    >
      {receiptLabel}
      <ArrowUpRight aria-hidden="true" className="h-3 w-3" />
    </Link>
  );
}

function StockAdjustmentReferenceLink({
  children,
  orgUrlSlug,
  skuId,
  storeUrlSlug,
}: {
  children: ReactNode;
  orgUrlSlug?: string;
  skuId?: Id<"productSku">;
  storeUrlSlug?: string;
}) {
  if (!orgUrlSlug || !storeUrlSlug || !skuId) {
    return <>{children}</>;
  }

  return (
    <Link
      className="inline-flex items-center gap-1 text-foreground underline-offset-4 transition-colors hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      params={{
        orgUrlSlug,
        storeUrlSlug,
      }}
      search={{
        mode: "manual",
        o: getOrigin(),
        sku: skuId,
      }}
      to="/$orgUrlSlug/store/$storeUrlSlug/operations/stock-adjustments"
    >
      {children}
      <ArrowUpRight aria-hidden="true" className="h-3 w-3" />
    </Link>
  );
}

function QueueWorkItemActionSlot({
  item,
  orgUrlSlug,
  stockAdjustmentSkuId,
  storeUrlSlug,
}: {
  item: QueueWorkItem;
  orgUrlSlug?: string;
  stockAdjustmentSkuId?: Id<"productSku">;
  storeUrlSlug?: string;
}) {
  if (!orgUrlSlug || !storeUrlSlug) return null;

  if (item.type === "pos_pending_checkout_item_review") {
    if (
      item.details?.provisionalProductId &&
      item.details.provisionalProductSkuId
    ) {
      return (
        <Link
          className={openWorkActionLinkClassName}
          from="/$orgUrlSlug/store/$storeUrlSlug/operations/open-work"
          params={{
            orgUrlSlug,
            storeUrlSlug,
            productSlug: item.details!.provisionalProductId!,
          }}
          search={{
            o: getOrigin(),
            variant: item.details.provisionalProductSkuId,
          }}
          to="/$orgUrlSlug/store/$storeUrlSlug/products/$productSlug/edit"
        >
          Review POS pending checkout
          <ArrowUpRight aria-hidden="true" className="h-3.5 w-3.5" />
        </Link>
      );
    }

    return (
      <Link
        className={openWorkActionLinkClassName}
        params={{ orgUrlSlug, storeUrlSlug }}
        search={{ categorySlug: "pos-pending-checkout", o: getOrigin() }}
        to="/$orgUrlSlug/store/$storeUrlSlug/products"
      >
        Review POS pending checkout
        <ArrowUpRight aria-hidden="true" className="h-3.5 w-3.5" />
      </Link>
    );
  }

  if (item.type === "catalog_taxonomy_setup") {
    const productId = getQueueWorkItemStringDetail(item, "productId");
    const productSkuId = getQueueWorkItemStringDetail(item, "productSkuId");

    if (productId) {
      return (
        <Link
          className={openWorkActionLinkClassName}
          from="/$orgUrlSlug/store/$storeUrlSlug/operations/open-work"
          params={{
            orgUrlSlug,
            productSlug: productId,
            storeUrlSlug,
          }}
          search={{
            o: getOrigin(),
            ...(productSkuId ? { variant: productSkuId } : {}),
          }}
          to="/$orgUrlSlug/store/$storeUrlSlug/products/$productSlug/edit"
        >
          Assign category
          <ArrowUpRight aria-hidden="true" className="h-3.5 w-3.5" />
        </Link>
      );
    }
  }

  if (item.type === "synced_sale_inventory_review") {
    return (
      <div className="flex flex-wrap items-center gap-3">
        {stockAdjustmentSkuId ? (
          <Link
            className={openWorkActionLinkClassName}
            params={{ orgUrlSlug, storeUrlSlug }}
            search={{
              mode: "manual",
              o: getOrigin(),
              sku: stockAdjustmentSkuId,
            }}
            to="/$orgUrlSlug/store/$storeUrlSlug/operations/stock-adjustments"
          >
            Open stock adjustments
            <ArrowUpRight aria-hidden="true" className="h-3.5 w-3.5" />
          </Link>
        ) : null}
      </div>
    );
  }

  if (item.type === "service_case" || item.type === "service_intake") {
    return (
      <Link
        className={openWorkActionLinkClassName}
        params={{ orgUrlSlug, storeUrlSlug }}
        search={{ o: getOrigin() }}
        to="/$orgUrlSlug/store/$storeUrlSlug/services/active-cases"
      >
        Open service case
        <ArrowUpRight aria-hidden="true" className="h-3.5 w-3.5" />
      </Link>
    );
  }

  if (item.type === "service_appointment") {
    return (
      <Link
        className={openWorkActionLinkClassName}
        params={{ orgUrlSlug, storeUrlSlug }}
        search={{ o: getOrigin() }}
        to="/$orgUrlSlug/store/$storeUrlSlug/services/appointments"
      >
        Open appointment
        <ArrowUpRight aria-hidden="true" className="h-3.5 w-3.5" />
      </Link>
    );
  }

  if (item.type === "purchase_order") {
    return (
      <Link
        className={openWorkActionLinkClassName}
        params={{ orgUrlSlug, storeUrlSlug }}
        search={{ o: getOrigin() }}
        to="/$orgUrlSlug/store/$storeUrlSlug/procurement"
      >
        Open purchase order
        <ArrowUpRight aria-hidden="true" className="h-3.5 w-3.5" />
      </Link>
    );
  }

  if (item.type === "stock_adjustment_review") {
    return (
      <Link
        className={openWorkActionLinkClassName}
        params={{ orgUrlSlug, storeUrlSlug }}
        search={{ o: getOrigin() }}
        to="/$orgUrlSlug/store/$storeUrlSlug/operations/approvals"
      >
        Review approval
        <ArrowUpRight aria-hidden="true" className="h-3.5 w-3.5" />
      </Link>
    );
  }

  if (item.type === "daily_close_carry_forward") {
    const businessDate = getQueueWorkItemStringDetail(item, "businessDate");

    return (
      <Link
        className={openWorkActionLinkClassName}
        params={{ orgUrlSlug, storeUrlSlug }}
        search={{
          o: getOrigin(),
          ...(businessDate ? { operatingDate: businessDate } : {}),
        }}
        to="/$orgUrlSlug/store/$storeUrlSlug/operations/daily-close"
      >
        Open Daily Close
        <ArrowUpRight aria-hidden="true" className="h-3.5 w-3.5" />
      </Link>
    );
  }

  return null;
}

function OpenWorkMixSummary({
  summary,
  workItems,
}: {
  summary?: QueueWorkItemSummary | null;
  workItems: QueueWorkItem[];
}) {
  const mixEntries = getOpenWorkMixEntries(workItems, summary);
  const headline =
    mixEntries.length === 1
      ? `All ${mixEntries[0].label}`
      : `${mixEntries.length} work types`;

  return (
    <section
      aria-label="Work type breakdown"
      className="rounded-lg border border-border bg-surface px-layout-md py-layout-md shadow-surface"
    >
      <div className="flex items-start justify-between gap-layout-sm">
        <div className="min-w-0">
          <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
            Work type
          </p>
          <h2 className="mt-1 text-base font-medium leading-6 text-foreground">
            {headline}
          </h2>
        </div>
        <span className="-mr-1 -mt-1 h-7 w-7 shrink-0" aria-hidden="true" />
      </div>

      <div className="mt-layout-md space-y-layout-md">
        {mixEntries.map((entry) => (
          <div className="space-y-2" key={entry.type}>
            <div className="flex min-w-0 items-center justify-between gap-layout-md text-sm">
              <span className="min-w-0 truncate text-foreground">
                {entry.label}
              </span>
              <span className="shrink-0 tabular-nums text-muted-foreground">
                {formatOpenWorkMixCount(entry.count, entry.completeness)}
              </span>
            </div>
            <div
              aria-label={`${entry.label}: ${formatOpenWorkMixCount(entry.count, entry.completeness)}, ${entry.percent}%`}
              className="h-1.5 overflow-hidden rounded-full bg-action-workflow-soft"
              role="img"
            >
              <div
                className="h-full rounded-full bg-action-workflow"
                style={{ width: `${entry.percent}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function OpenWorkTypeFilter({
  onWorkTypeChange,
  selectedWorkType,
  summary,
  workItems,
}: {
  onWorkTypeChange: (workType?: string) => void;
  selectedWorkType?: string;
  summary?: QueueWorkItemSummary | null;
  workItems: QueueWorkItem[];
}) {
  const mixEntries = getOpenWorkMixEntries(workItems, summary);

  return (
    <div className="w-full sm:w-56">
      <label
        className="mb-1.5 block text-xs font-medium text-muted-foreground"
        htmlFor="open-work-type-filter"
      >
        Work type
      </label>
      <Select
        onValueChange={(value) =>
          onWorkTypeChange(value === "all" ? undefined : value)
        }
        value={selectedWorkType ?? "all"}
      >
        <SelectTrigger
          aria-label="Filter work queue by work type"
          className="w-full bg-background active:scale-[0.98]"
          id="open-work-type-filter"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All work types</SelectItem>
          {mixEntries.map((entry) => (
            <SelectItem key={entry.type} value={entry.type}>
              {entry.label} · {entry.count.toLocaleString()}
              {entry.completeness === "incomplete" ? "+" : ""}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function QueueWorkItemCard({
  isSyncedSaleInventoryReviewResolutionDisabled,
  isResolvingSyncedSaleInventoryReview,
  item,
  onResolveSyncedSaleInventoryReview,
  orgUrlSlug,
  storeUrlSlug,
}: {
  isSyncedSaleInventoryReviewResolutionDisabled?: boolean;
  isResolvingSyncedSaleInventoryReview?: boolean;
  item: QueueWorkItem;
  onResolveSyncedSaleInventoryReview?: (item: QueueWorkItem) => void;
  orgUrlSlug?: string;
  storeUrlSlug?: string;
}) {
  const stockAdjustmentSkuId = getQueueWorkItemStockAdjustmentSkuId(item);
  const receiptNumber = getQueueWorkItemStringDetail(item, "receiptNumber");
  const receiptTransactionId = getQueueWorkItemTransactionId(item);
  const fallbackTitle = formatWorkItemTitle(item.title);
  const pendingCheckoutTitleSubject =
    item.type === "pos_pending_checkout_item_review"
      ? getWorkItemTitleSubject(item.title, "Review pending checkout item: ")
      : null;
  const syncedSaleTitleSubject =
    item.type === "synced_sale_inventory_review"
      ? getWorkItemTitleSubject(item.title, "Review inventory for ")
      : null;
  const contextPresentation = getQueueWorkItemContextPresentation(item.type);
  const serviceCollapsedMetadataEntries: OperationReviewMetadataEntry[] =
    item.type === "service_appointment"
      ? [
          {
            label: "Owner",
            value: item.assignedStaffName ?? "Unassigned",
          },
          {
            label: "Customer",
            value: item.customerName ?? "No customer",
          },
          {
            label: "Scheduled",
            value: item.dueAt ? getRelativeTime(item.dueAt) : "Not scheduled",
          },
          {
            label: "Created",
            value: getRelativeTime(item.createdAt),
          },
        ]
      : [
          {
            label: "Owner",
            value: item.assignedStaffName ?? "Unassigned",
          },
          {
            label: "Customer",
            value: item.customerName ?? "No customer",
          },
          {
            label: "Created",
            value: getRelativeTime(item.createdAt),
          },
          {
            label: "Due",
            value: item.dueAt ? getRelativeTime(item.dueAt) : "Not scheduled",
          },
        ];
  const purchaseOrderCollapsedMetadataEntries: OperationReviewMetadataEntry[] =
    [
      {
        label: "Purchase order",
        value:
          getQueueWorkItemStringDetail(item, "purchaseOrderNumber") ??
          getQueueWorkItemStringDetail(item, "displayNumber") ??
          "Not recorded",
      },
      {
        label: "Vendor",
        value: getQueueWorkItemStringDetail(item, "vendorName") ?? "No vendor",
      },
      {
        label: "Items",
        value: formatOptionalItemCount(
          getQueueWorkItemNumberDetail(item, "itemCount"),
        ),
      },
      {
        label: "Next action",
        value: "Continue procurement",
      },
    ];
  const stockAdjustmentReviewCollapsedMetadataEntries: OperationReviewMetadataEntry[] =
    [
      {
        label: "Owner",
        value: "Approval requests",
      },
      {
        label: "Next action",
        value:
          item.approvalState === "pending"
            ? "Review pending approval"
            : "Check approval status",
      },
      {
        label: "Reason",
        value:
          getQueueWorkItemStringDetail(item, "reasonLabel") ?? "Stock review",
      },
      {
        label: "Created",
        value: getRelativeTime(item.createdAt),
      },
    ];
  const dailyCloseCollapsedMetadataEntries: OperationReviewMetadataEntry[] = [
    {
      label: "Business date",
      value: formatBusinessDate(
        getQueueWorkItemStringDetail(item, "businessDate"),
      ),
    },
    {
      label: "Owner",
      value: "Daily Close",
    },
    {
      label: "Follow-up",
      value:
        getQueueWorkItemStringDetail(item, "followUpReason") ??
        "Review carry-forward work",
    },
    {
      label: "Created",
      value: getRelativeTime(item.createdAt),
    },
  ];
  const unsupportedCollapsedMetadataEntries: OperationReviewMetadataEntry[] = [
    {
      label: "Owner",
      value: "Not surfaced here",
    },
    {
      label: "Next action",
      value: "Wait for supported approval handling",
    },
    {
      label: "Created",
      value: getRelativeTime(item.createdAt),
    },
  ];
  const catalogTaxonomyCollapsedMetadataEntries: OperationReviewMetadataEntry[] =
    [
      {
        label: "Product",
        value: formatCatalogSetupProductName(item),
      },
      {
        label: "SKU",
        value: getQueueWorkItemStringDetail(item, "sku") ?? "Not recorded",
      },
      {
        label: "Next action",
        value: "Assign category and subcategory",
      },
      {
        label: "Created",
        value: getRelativeTime(item.createdAt),
      },
    ];
  const pendingCheckoutCollapsedMetadataEntries: OperationReviewMetadataEntry[] =
    [
      {
        label: "Item code",
        value:
          getQueueWorkItemStringDetail(item, "lookupCode") ?? "Not captured",
      },
      {
        label: "Quantity sold",
        value: formatOptionalQuantity(
          getQueueWorkItemNumberDetail(item, "quantitySold"),
        ),
      },
      {
        label: "Total sold",
        value: formatOptionalQuantity(
          getQueueWorkItemNumberDetail(item, "totalQuantitySold"),
        ),
      },
      {
        label: "Price",
        value: formatOptionalMoney(getQueueWorkItemNumberDetail(item, "price")),
      },
    ];
  const syncedSaleCollapsedMetadataEntries: OperationReviewMetadataEntry[] = [
    {
      label: "Receipt",
      value: (
        <ReceiptReferenceLink
          orgUrlSlug={orgUrlSlug}
          receiptNumber={receiptNumber}
          storeUrlSlug={storeUrlSlug}
          transactionId={receiptTransactionId}
        />
      ),
    },
    {
      label: "Needs action",
      value: "Check stock count",
    },
    {
      label: "Created",
      value: getRelativeTime(item.createdAt),
    },
  ];
  const collapsedMetadataEntries =
    item.type === "pos_pending_checkout_item_review"
      ? pendingCheckoutCollapsedMetadataEntries
      : item.type === "catalog_taxonomy_setup"
        ? catalogTaxonomyCollapsedMetadataEntries
        : item.type === "synced_sale_inventory_review"
          ? syncedSaleCollapsedMetadataEntries
          : item.type === "purchase_order"
            ? purchaseOrderCollapsedMetadataEntries
            : item.type === "stock_adjustment_review"
              ? stockAdjustmentReviewCollapsedMetadataEntries
              : item.type === "daily_close_carry_forward"
                ? dailyCloseCollapsedMetadataEntries
                : item.type === "service_deposit_review"
                  ? unsupportedCollapsedMetadataEntries
                  : serviceCollapsedMetadataEntries;
  const expandedOnlyMetadataEntries: OperationReviewMetadataEntry[] =
    item.type === "synced_sale_inventory_review"
      ? [
          {
            label: "Affected sale lines",
            value: formatOptionalLineCount(
              getQueueWorkItemInventoryReviewLineCount(item),
            ),
          },
        ]
      : [];
  const metadataEntries: OperationReviewMetadataEntry[] = [
    ...collapsedMetadataEntries,
    ...expandedOnlyMetadataEntries,
    {
      label: "Status",
      value: formatQueueWorkItemValue(item.status),
    },
    {
      label: "Priority",
      value: formatQueueWorkItemValue(item.priority),
    },
    {
      label: "Approval",
      value: formatQueueWorkItemValue(item.approvalState),
    },
  ];
  const title =
    item.type === "service_deposit_review"
      ? "Service deposit review is not available in Open Work."
      : item.type === "daily_close_carry_forward"
        ? "Daily close carry-forward follow-up"
        : fallbackTitle;

  return (
    <OperationReviewItemCard
      actionSlot={
        <QueueWorkItemActionSlot
          item={item}
          orgUrlSlug={orgUrlSlug}
          stockAdjustmentSkuId={stockAdjustmentSkuId}
          storeUrlSlug={storeUrlSlug}
        />
      }
      badgeSlot={
        <>
          <Badge
            className="border-border bg-surface text-muted-foreground shadow-sm"
            variant="outline"
          >
            {formatQueueWorkItemValue(item.status)}
          </Badge>
          <Badge
            className="border-border bg-surface text-muted-foreground shadow-sm"
            variant="outline"
          >
            {formatQueueWorkItemValue(item.priority)}
          </Badge>
        </>
      }
      className={contextPresentation.cardClassName}
      collapsedMetadataEntries={collapsedMetadataEntries}
      contextIcon={
        <WorkItemContextIcon
          className={contextPresentation.iconClassName}
          Icon={contextPresentation.Icon}
        />
      }
      contextLabel={getQueueWorkItemTypeLabel(item.type)}
      contextLabelClassName={contextPresentation.contextLabelClassName}
      description={null}
      headerActionSlot={
        item.type === "synced_sale_inventory_review" &&
        onResolveSyncedSaleInventoryReview &&
        hasSyncedSaleInventoryResolverDetails(item) ? (
          <LoadingButton
            className="h-8 px-3 text-xs"
            disabled={Boolean(isSyncedSaleInventoryReviewResolutionDisabled)}
            isLoading={Boolean(isResolvingSyncedSaleInventoryReview)}
            onClick={() => onResolveSyncedSaleInventoryReview(item)}
            size="sm"
            type="button"
            variant="ghost"
          >
            Mark reviewed
          </LoadingButton>
        ) : null
      }
      itemId={item._id}
      metadataEntries={metadataEntries}
      title={
        pendingCheckoutTitleSubject ? (
          <>Review pending checkout item: {pendingCheckoutTitleSubject}</>
        ) : syncedSaleTitleSubject ? (
          <>
            Review inventory for{" "}
            <StockAdjustmentReferenceLink
              orgUrlSlug={orgUrlSlug}
              skuId={stockAdjustmentSkuId}
              storeUrlSlug={storeUrlSlug}
            >
              {syncedSaleTitleSubject}
            </StockAdjustmentReferenceLink>
          </>
        ) : (
          title
        )
      }
    />
  );
}

function SyncedSaleInventoryReviewGroupCard({
  conflictMessage,
  isResolutionDisabled,
  isResolving,
  items,
  onRefresh,
  onResolve,
  orgUrlSlug,
  storeUrlSlug,
}: {
  conflictMessage?: string;
  isResolutionDisabled?: boolean;
  isResolving?: boolean;
  items: QueueWorkItem[];
  onRefresh?: () => void;
  onResolve?: (items: QueueWorkItem[]) => void;
  orgUrlSlug?: string;
  storeUrlSlug?: string;
}) {
  const representative = items[0];
  const productSkuId = getQueueWorkItemStockAdjustmentSkuId(representative);
  const titleSubject =
    getWorkItemTitleSubject(representative.title, "Review inventory for ") ??
    "Affected SKU";
  const contextPresentation = getQueueWorkItemContextPresentation(
    representative.type,
  );
  const oldestCreatedAt =
    representative.logicalGroup?.oldestActionableAt ??
    Math.min(...items.map((item) => item.createdAt));
  const collapsedMetadataEntries: OperationReviewMetadataEntry[] = [
    {
      label: "Affected sales",
      value: `${items.length.toLocaleString()} ${items.length === 1 ? "sale" : "sales"}`,
    },
    {
      label: "Needs action",
      value: "Check stock count",
    },
    {
      label: "Oldest",
      value: getRelativeTime(oldestCreatedAt),
    },
  ];
  const highestPriority = items.some((item) => item.priority === "high")
    ? "High"
    : "Normal";
  const resolutionNotice = conflictMessage
    ? conflictMessage
    : representative.logicalGroup?.resolutionAvailability === "budget_exceeded"
      ? "This inventory review group needs support to complete safely."
      : representative.logicalGroup?.resolutionAvailability ===
          "remediation_in_progress"
        ? "Support is completing this inventory review group."
        : representative.logicalGroup?.resolutionAvailability ===
            "source_incomplete"
          ? "Open Work is still loading the complete inventory review set."
          : null;

  return (
    <OperationReviewItemCard
      actionSlot={
        <div className="flex flex-wrap items-center gap-layout-sm">
          <QueueWorkItemActionSlot
            item={representative}
            orgUrlSlug={orgUrlSlug}
            stockAdjustmentSkuId={productSkuId}
            storeUrlSlug={storeUrlSlug}
          />
          {conflictMessage && onRefresh ? (
            <Button onClick={onRefresh} size="sm" type="button" variant="utility">
              Refresh
            </Button>
          ) : null}
        </div>
      }
      badgeSlot={
        <Badge
          className="border-border bg-surface text-muted-foreground shadow-sm"
          variant="outline"
        >
          {highestPriority}
        </Badge>
      }
      className={contextPresentation.cardClassName}
      collapsedMetadataEntries={collapsedMetadataEntries}
      contextIcon={
        <WorkItemContextIcon
          className={contextPresentation.iconClassName}
          Icon={contextPresentation.Icon}
        />
      }
      contextLabel="Synced sale inventory"
      contextLabelClassName={contextPresentation.contextLabelClassName}
      description={resolutionNotice}
      detailsSlot={
        <div>
          <div className="flex items-baseline justify-between gap-layout-md">
            <h3 className="text-sm font-medium text-foreground">
              Affected sales
            </h3>
            <span className="text-xs tabular-nums text-muted-foreground">
              {items.length.toLocaleString()} total
            </span>
          </div>
          <ul className="mt-layout-sm divide-y divide-border/70 overflow-hidden rounded-md border border-border/70">
            {items.map((item) => {
              const lineCount = getQueueWorkItemInventoryReviewLineCount(item);

              return (
                <li
                  className="flex flex-col gap-1 px-layout-sm py-layout-sm sm:flex-row sm:items-center sm:justify-between"
                  key={item._id}
                >
                  <ReceiptReferenceLink
                    orgUrlSlug={orgUrlSlug}
                    receiptNumber={getQueueWorkItemStringDetail(
                      item,
                      "receiptNumber",
                    )}
                    storeUrlSlug={storeUrlSlug}
                    transactionId={getQueueWorkItemTransactionId(item)}
                  />
                  <span className="flex flex-wrap items-center gap-x-layout-md gap-y-1 text-xs text-muted-foreground">
                    {lineCount !== undefined ? (
                      <span>{formatOptionalLineCount(lineCount)} affected</span>
                    ) : null}
                    <span>{getRelativeTime(item.createdAt)}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      }
      headerActionSlot={
        onResolve && productSkuId ? (
          <LoadingButton
            className="h-8 px-3 text-xs"
            disabled={Boolean(isResolutionDisabled)}
            isLoading={Boolean(isResolving)}
            onClick={() => onResolve(items)}
            size="sm"
            type="button"
            variant="ghost"
          >
            {items.length === 1
              ? "Mark reviewed"
              : `Mark ${items.length.toLocaleString()} reviewed`}
          </LoadingButton>
        ) : null
      }
      itemId={`synced-sale-inventory-${productSkuId ?? representative._id}`}
      title={
        <>
          Review inventory for{" "}
          <StockAdjustmentReferenceLink
            orgUrlSlug={orgUrlSlug}
            skuId={productSkuId}
            storeUrlSlug={storeUrlSlug}
          >
            {titleSubject}
          </StockAdjustmentReferenceLink>
        </>
      }
    />
  );
}

function getApprovalRequestCopy(requestType: string) {
  if (requestType === "inventory_adjustment_review") {
    return {
      approveLabel: "Approve batch",
      approvedToast: "Stock adjustment approved",
      description:
        "Manager approval applies the queued inventory movement. Reject it to keep stock unchanged.",
      rejectedToast: "Stock adjustment rejected",
      rejectLabel: "Reject batch",
    };
  }

  if (requestType === "payment_method_correction") {
    return {
      approveLabel: "Approve update",
      approvedToast: "Payment method update approved",
      description:
        "Manager approval applies the queued payment method update. Reject it to leave the completed transaction unchanged.",
      rejectedToast: "Payment method update rejected",
      rejectLabel: "Reject update",
    };
  }

  if (requestType === "pos_item_adjustment") {
    return {
      approveLabel: "Approve adjustment",
      approvedToast: "Item adjustment approved",
      description:
        "Manager approval applies the queued item adjustment. Reject it to leave the completed transaction unchanged.",
      rejectedToast: "Item adjustment rejected",
      rejectLabel: "Reject adjustment",
    };
  }

  if (requestType === "variance_review") {
    return {
      approveLabel: "Approve variance",
      approvedToast: "Variance review approved",
      description:
        "Manager approval accepts the register closeout variance. Reject it to keep the register closeout pending.",
      rejectedToast: "Variance review rejected",
      rejectLabel: "Reject variance",
    };
  }

  if (requestType === "register_sync_review") {
    return {
      approveLabel: "Approve synced sales",
      approvedToast: "Synced register activity approved",
      description:
        "Manager approval applies reviewed synced sales to the register session. Reject it to leave the synced activity unapplied.",
      rejectedToast: "Synced register activity rejected",
      rejectLabel: "Reject synced activity",
    };
  }

  if (requestType === "pos_transaction_void") {
    return {
      approveLabel: "Approve void",
      approvedToast: "Completed sale void approved",
      description:
        "Manager approval voids the completed sale and records the payment, drawer, inventory, and audit reversal.",
      rejectedToast: "Completed sale void rejected",
      rejectLabel: "Reject void",
    };
  }

  return null;
}

function getRetireOnlyApprovalRequestCopy(requestType: string) {
  if (requestType === "service_deposit_review") {
    return {
      description:
        "This legacy service deposit review cannot be approved from Open Work. Reject it to retire the pending approval and clear the linked review.",
      rejectedToast: "Service deposit review retired",
      rejectLabel: "Retire review",
    };
  }

  if (requestType === "online_order_return_review") {
    return {
      description:
        "Online return reviews need a dedicated resolver before approval can apply return changes. Reject it to retire the pending approval.",
      rejectedToast: "Online return review retired",
      rejectLabel: "Retire review",
    };
  }

  if (requestType === "pos_item_adjustment_review") {
    return {
      description:
        "This legacy item adjustment review cannot be approved from Open Work. Reject it to retire the pending approval.",
      rejectedToast: "Item adjustment review retired",
      rejectLabel: "Retire review",
    };
  }

  return null;
}

function formatApprovalRequestType(requestType: string) {
  if (requestType === "register_sync_review") {
    return "Synced register activity";
  }

  if (requestType === "pos_transaction_void") {
    return "Completed sale void";
  }

  return requestType
    .split("_")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function formatQuantityDelta(quantityDelta: number) {
  if (quantityDelta > 0) return `+${quantityDelta}`;
  return String(quantityDelta);
}

function formatInventoryApprovalQuantityReview(
  lineItem: QueueApprovalLineItem,
) {
  const countedQuantity =
    typeof lineItem.countedQuantity === "number"
      ? lineItem.countedQuantity
      : null;
  const systemQuantity =
    typeof lineItem.systemQuantity === "number"
      ? lineItem.systemQuantity
      : null;

  if (countedQuantity !== null && systemQuantity !== null) {
    return `Counted ${countedQuantity} of ${systemQuantity} on hand`;
  }

  if (systemQuantity !== null) {
    return `${systemQuantity} on hand before adjustment`;
  }

  if (countedQuantity !== null) {
    return `Counted ${countedQuantity}`;
  }

  return "Stock quantity not captured";
}

function formatSkuProductName(productName?: string) {
  const normalizedName = productName?.trim();

  if (!normalizedName) {
    return "Unnamed SKU";
  }

  return normalizedName.charAt(0).toUpperCase() + normalizedName.slice(1);
}

function hasItemAdjustmentChange(lineItem: QueueApprovalLineItem) {
  const quantityChanged =
    typeof lineItem.originalQuantity === "number" &&
    typeof lineItem.adjustedQuantity === "number" &&
    lineItem.originalQuantity !== lineItem.adjustedQuantity;
  const deltaChanged =
    typeof lineItem.quantityDelta === "number" && lineItem.quantityDelta !== 0;

  return quantityChanged || deltaChanged;
}

function TransactionReferenceLink({
  orgUrlSlug,
  storeUrlSlug,
  transaction,
}: {
  orgUrlSlug?: string;
  storeUrlSlug?: string;
  transaction: QueueApprovalRequest["transactionSummary"];
}) {
  if (!transaction) {
    return <span>Transaction unavailable</span>;
  }

  const transactionLabel = `#${transaction.transactionNumber}`;

  if (!orgUrlSlug || !storeUrlSlug) {
    return <span>{transactionLabel}</span>;
  }

  return (
    <Link
      className="inline-flex items-center gap-1 text-foreground underline-offset-4 transition-colors hover:text-primary hover:underline"
      params={{
        orgUrlSlug,
        storeUrlSlug,
        transactionId: transaction.transactionId,
      }}
      search={{ o: getOrigin() }}
      to="/$orgUrlSlug/store/$storeUrlSlug/pos/transactions/$transactionId"
    >
      {transactionLabel}
      <ArrowUpRight aria-hidden="true" className="h-3 w-3" />
    </Link>
  );
}

function formatRegisterSessionLabel(
  registerSession: NonNullable<QueueApprovalRequest["registerSessionSummary"]>,
) {
  if (registerSession.terminalName && registerSession.registerNumber) {
    return `${registerSession.terminalName} / Register ${registerSession.registerNumber}`;
  }

  if (registerSession.terminalName) {
    return registerSession.terminalName;
  }

  if (registerSession.registerNumber) {
    return `Register ${registerSession.registerNumber}`;
  }

  return "Register session";
}

function getInventoryApprovalLineItems(request: QueueApprovalRequest) {
  if (request.requestType !== "inventory_adjustment_review") {
    return [];
  }

  return request.metadata?.lineItems ?? [];
}

function getPaymentCorrectionSummary(request: QueueApprovalRequest) {
  if (request.requestType !== "payment_method_correction") {
    return null;
  }

  return {
    amount: request.metadata?.amount,
    nextPaymentMethod: request.metadata?.paymentMethod,
    previousPaymentMethod:
      request.metadata?.previousPaymentMethod ??
      request.transactionSummary?.paymentMethod ??
      undefined,
    transaction: request.transactionSummary ?? null,
  };
}

function getTransactionVoidSummary(request: QueueApprovalRequest) {
  if (request.requestType !== "pos_transaction_void") {
    return null;
  }

  return {
    registerSession: request.registerSessionSummary ?? null,
    requestedAt: request.createdAt,
    transaction: request.transactionSummary ?? null,
  };
}

function getItemAdjustmentSummary(request: QueueApprovalRequest) {
  if (
    request.requestType !== "pos_item_adjustment" &&
    request.requestType !== "pos_item_adjustment_review"
  ) {
    return null;
  }

  return {
    adjustedTotal: request.metadata?.adjustedTotal,
    lineItems:
      request.metadata?.lineItems?.filter(hasItemAdjustmentChange) ?? [],
    originalTotal: request.metadata?.originalTotal,
    registerSession: request.registerSessionSummary ?? null,
    settlementAmount: request.metadata?.settlementAmount,
    settlementDirection: request.metadata?.settlementDirection ?? "none",
    settlementMethod: request.metadata?.settlementMethod,
    totalDelta: request.metadata?.totalDelta,
    transaction: request.transactionSummary ?? null,
  };
}

function getVarianceReviewSummary(request: QueueApprovalRequest) {
  if (request.requestType !== "variance_review") {
    return null;
  }

  const registerSession = request.registerSessionSummary;
  const variance = registerSession?.variance ?? request.metadata?.variance;
  const expectedCash =
    registerSession?.expectedCash ?? request.metadata?.expectedCash;
  const countedCash =
    registerSession?.countedCash ?? request.metadata?.countedCash;

  return {
    countedCash,
    expectedCash,
    reason: request.reason
      ? (formatReviewReason(ghsCurrencyFormatter, request.reason) ??
        request.reason)
      : undefined,
    registerSessionId: registerSession?.registerSessionId,
    requestedAt: request.createdAt,
    status: registerSession?.status,
    terminalLabel:
      registerSession?.terminalName && registerSession.registerNumber
        ? `${registerSession.terminalName} / Register ${registerSession.registerNumber}`
        : (registerSession?.terminalName ??
          (registerSession?.registerNumber
            ? `Register ${registerSession.registerNumber}`
            : "Register")),
    variance,
  };
}

function getRegisterSyncReviewSummary(request: QueueApprovalRequest) {
  if (request.requestType !== "register_sync_review") {
    return null;
  }

  return {
    registerSession: request.registerSessionSummary ?? null,
    reviewItems: request.metadata?.reviewItems ?? [],
  };
}

function formatApprovalDate(timestamp?: number) {
  if (typeof timestamp !== "number") return "Unknown";

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(timestamp));
}

function getVarianceAmountClassName(variance?: number | null) {
  if (typeof variance !== "number" || variance === 0) {
    return "text-foreground";
  }

  return variance > 0 ? "text-success" : "text-danger";
}

function getQuantityDeltaBadgeClass(delta?: number) {
  if (typeof delta !== "number") {
    return "border-border bg-background text-foreground shadow-sm";
  }

  if (delta > 0) {
    return "border-success/30 bg-success/10 text-success shadow-sm";
  }

  if (delta < 0) {
    return "border-danger/30 bg-danger/10 text-danger shadow-sm";
  }

  return "border-border bg-background text-muted-foreground shadow-sm";
}

function getCountScopeKeyForInventoryItem(item: InventorySnapshotItem) {
  return item.productCategory?.trim() || UNCATEGORIZED_COUNT_SCOPE_KEY;
}

function mergeInventorySnapshotItems(
  baseItems: InventorySnapshotItem[],
  searchItems: InventorySnapshotItem[],
) {
  if (searchItems.length === 0) return baseItems;

  const itemsById = new Map<Id<"productSku">, InventorySnapshotItem>();

  for (const item of baseItems) {
    itemsById.set(item._id, item);
  }

  for (const item of searchItems) {
    itemsById.set(item._id, item);
  }

  return Array.from(itemsById.values()).sort((left, right) => {
    const nameCompare = left.productName.localeCompare(right.productName);
    if (nameCompare !== 0) return nameCompare;

    return (left.sku ?? "").localeCompare(right.sku ?? "");
  });
}

type OperationsQueueViewContentProps = {
  activeWorkflow?: OperationsWorkflow;
  approvalDecisionUnlockExpiresAt?: number;
  approvalDecisionUnlockRequired?: boolean;
  approvalDecisionUnlocked?: boolean;
  approvalRequests: QueueApprovalRequest[];
  canLoadMoreInventoryItems?: boolean;
  conflictedLogicalGroupKeys?: ReadonlySet<string>;
  cycleCountDraft?: CycleCountDraftState | null;
  cycleCountDraftSummary?: CycleCountDraftSummary | null;
  hasFullAdminAccess: boolean;
  inventoryItems: InventorySnapshotItem[];
  inventoryUnitSummary?: InventoryUnitSummary | null;
  isCycleCountDraftSaving?: boolean;
  isDecidingApprovalRequestId?: string | null;
  isLoadingMoreInventoryItems?: boolean;
  isLoadingPermissions: boolean;
  isLoadingQueue: boolean;
  isLoadingStock?: boolean;
  isResolvingSyncedSaleInventoryReviewSkuId?: Id<"productSku"> | null;
  isSubmittingStockBatch: boolean;
  onDecideApprovalRequest: (args: {
    approvalRequestId: string;
    decision: "approved" | "rejected";
    registerSessionId?: Id<"registerSession">;
    requestType?: string;
  }) => Promise<void>;
  onLockApprovalDecisions?: () => void;
  onLoadMoreInventoryItems?: () => void;
  onRequestApprovalDecisionUnlock?: () => void;
  onOpenWorkSearchChange?: (patch: OpenWorkSearchPatch) => void;
  onRefreshOpenWork?: () => void;
  onResolveSyncedSaleInventoryReview?: (items: QueueWorkItem[]) => void;
  onDiscardCycleCountDraft?: () => Promise<NormalizedCommandResult<unknown>>;
  onRefreshCycleCountDraftLineBaseline?: (args: {
    productSkuId: Id<"productSku">;
  }) => Promise<NormalizedCommandResult<unknown>>;
  onSaveCycleCountDraftLine?: (args: {
    countedQuantity: number;
    productSkuId: Id<"productSku">;
  }) => Promise<NormalizedCommandResult<unknown>>;
  onSubmitStockBatch: (
    args: SubmitStockAdjustmentArgs,
  ) => Promise<NormalizedCommandResult<unknown>>;
  onSubmitCycleCountDraft?: (args: {
    notes?: string;
  }) => Promise<NormalizedCommandResult<unknown>>;
  onStockAdjustmentSearchChange?: (patch: StockAdjustmentSearchPatch) => void;
  orgUrlSlug?: string;
  queueOverflow?: QueueOverflow | null;
  workItemSummary?: QueueWorkItemSummary | null;
  showBackButton?: boolean;
  storeId?: Id<"store">;
  storeUrlSlug?: string;
  openWorkSearch?: OpenWorkSearchState;
  stockAdjustmentSearch?: StockAdjustmentSearchState;
  workItems: QueueWorkItem[];
};

export function OperationsQueueViewContent({
  activeWorkflow,
  approvalDecisionUnlockExpiresAt,
  approvalDecisionUnlockRequired = false,
  approvalDecisionUnlocked = true,
  approvalRequests,
  canLoadMoreInventoryItems = false,
  conflictedLogicalGroupKeys,
  cycleCountDraft,
  cycleCountDraftSummary,
  hasFullAdminAccess,
  inventoryItems,
  inventoryUnitSummary,
  isCycleCountDraftSaving,
  isDecidingApprovalRequestId,
  isLoadingMoreInventoryItems = false,
  isLoadingPermissions,
  isLoadingQueue,
  isLoadingStock = isLoadingQueue,
  isResolvingSyncedSaleInventoryReviewSkuId,
  isSubmittingStockBatch,
  onDecideApprovalRequest,
  onDiscardCycleCountDraft,
  onLockApprovalDecisions,
  onLoadMoreInventoryItems,
  onOpenWorkSearchChange,
  onRefreshOpenWork,
  onRequestApprovalDecisionUnlock,
  onResolveSyncedSaleInventoryReview,
  onRefreshCycleCountDraftLineBaseline,
  onSaveCycleCountDraftLine,
  onSubmitStockBatch,
  onSubmitCycleCountDraft,
  onStockAdjustmentSearchChange,
  orgUrlSlug,
  queueOverflow,
  showBackButton = false,
  storeId,
  storeUrlSlug,
  openWorkSearch,
  stockAdjustmentSearch,
  workItems,
  workItemSummary,
}: OperationsQueueViewContentProps) {
  const requestedOpenWorkPage = openWorkSearch?.page ?? 1;
  const selectedOpenWorkType = openWorkSearch?.workType;
  const [openWorkPage, setOpenWorkPage] = useState(requestedOpenWorkPage);
  const resolvedWorkflow =
    activeWorkflow ?? getDefaultWorkflow({ approvalRequests, workItems });
  const filteredWorkItems = useMemo(
    () =>
      selectedOpenWorkType
        ? workItems.filter((item) => item.type === selectedOpenWorkType)
        : workItems,
    [selectedOpenWorkType, workItems],
  );
  const displayGroups = useMemo(
    () => groupOpenWorkItems(filteredWorkItems),
    [filteredWorkItems],
  );
  const openWorkPageCount = Math.max(
    1,
    Math.ceil(displayGroups.length / OPEN_WORK_ITEMS_PER_PAGE),
  );
  const clampedOpenWorkPage = Math.min(openWorkPage, openWorkPageCount);
  const openWorkPageStart =
    (clampedOpenWorkPage - 1) * OPEN_WORK_ITEMS_PER_PAGE;
  const visibleWorkItemGroups = displayGroups.slice(
    openWorkPageStart,
    openWorkPageStart + OPEN_WORK_ITEMS_PER_PAGE,
  );
  const selectedWorkTypeSummary = selectedOpenWorkType
    ? workItemSummary?.byType.find(
        (entry) => entry.type === selectedOpenWorkType,
      )
    : undefined;
  const effectiveWorkItemSummary = selectedOpenWorkType
    ? selectedWorkTypeSummary
    : workItemSummary;
  const openWorkCount = effectiveWorkItemSummary?.count ?? displayGroups.length;
  const isOpenWorkCountLowerBound = effectiveWorkItemSummary
    ? effectiveWorkItemSummary.completeness === "incomplete"
    : filteredWorkItems.some(
        (item) => item.logicalGroup?.completeness === "incomplete",
      );
  const openWorkHeaderTitle = isLoadingQueue
    ? "Open work"
    : formatOpenWorkHeaderTitle(
        openWorkCount,
        selectedOpenWorkType,
        isOpenWorkCountLowerBound,
      );
  const openWorkHeaderDescription =
    "Service intake and stock review work that still needs progress or completion.";
  const openWorkHeaderContentKey = isLoadingQueue
    ? "open-work-loading"
    : `open-work-${selectedOpenWorkType ?? "all"}-${openWorkCount}`;
  const hasRenderedOpenWorkLoadingHeaderRef = useRef(false);

  if (resolvedWorkflow === "queue" && isLoadingQueue) {
    hasRenderedOpenWorkLoadingHeaderRef.current = true;
  }

  const shouldAnimateOpenWorkHeader =
    isLoadingQueue || hasRenderedOpenWorkLoadingHeaderRef.current;
  const approvalCount = approvalRequests.length;
  const approvalsHeaderTitle = isLoadingQueue
    ? "Pending approvals"
    : formatApprovalsHeaderTitle(approvalCount);
  const approvalsHeaderDescription =
    "Review manager approval requests before queued stock and payment changes are applied.";
  const approvalsHeaderContentKey = isLoadingQueue
    ? "approvals-loading"
    : `approvals-${approvalCount}`;
  const hasRenderedApprovalsLoadingHeaderRef = useRef(false);

  if (resolvedWorkflow === "approvals" && isLoadingQueue) {
    hasRenderedApprovalsLoadingHeaderRef.current = true;
  }

  const shouldAnimateApprovalsHeader =
    isLoadingQueue || hasRenderedApprovalsLoadingHeaderRef.current;
  const openWorkOverflow = selectedOpenWorkType
    ? (selectedWorkTypeSummary?.overflow ?? hasOpenWorkOverflow(queueOverflow))
    : (workItemSummary?.byType.some((entry) => entry.overflow) ??
      hasOpenWorkOverflow(queueOverflow));
  const approvalsOverflow = Boolean(queueOverflow?.approvalRequests);
  const totalOpenWorkCount = workItemSummary?.count ?? workItems.length;
  const showOpenWorkEmptyState =
    workItems.length === 0 &&
    (Boolean(selectedOpenWorkType) || totalOpenWorkCount === 0);
  const openWorkEmptyTitle = selectedOpenWorkType
    ? `No open ${getSentenceCaseWorkTypeLabel(selectedOpenWorkType)} work items`
    : "No open work items";

  useEffect(() => {
    setOpenWorkPage(requestedOpenWorkPage);
  }, [requestedOpenWorkPage]);

  const handleOpenWorkPageChange = useCallback(
    (page: number) => {
      const nextPage = Math.min(Math.max(1, page), openWorkPageCount);

      setOpenWorkPage(nextPage);
      onOpenWorkSearchChange?.({
        page: nextPage > 1 ? nextPage : undefined,
      });
    },
    [onOpenWorkSearchChange, openWorkPageCount],
  );

  const handleOpenWorkTypeChange = useCallback(
    (workType?: string) => {
      setOpenWorkPage(1);
      onOpenWorkSearchChange?.({ page: undefined, workType });
    },
    [onOpenWorkSearchChange],
  );

  useEffect(() => {
    if (openWorkSearch?.page !== undefined) return;

    setOpenWorkPage(1);
  }, [openWorkSearch?.page, resolvedWorkflow, workItems.length]);

  useEffect(() => {
    if (isLoadingQueue) return;
    if (openWorkPage <= openWorkPageCount) return;

    setOpenWorkPage(openWorkPageCount);
    onOpenWorkSearchChange?.({
      page: openWorkPageCount > 1 ? openWorkPageCount : undefined,
    });
  }, [isLoadingQueue, onOpenWorkSearchChange, openWorkPage, openWorkPageCount]);

  if (isLoadingPermissions) {
    return null;
  }

  if (!hasFullAdminAccess) {
    return <NoPermissionView />;
  }

  if (!storeId) {
    return (
      <div className="container mx-auto py-8">
        <EmptyState
          description="Select a store before opening stock adjustments or approval work"
          title="No active store"
        />
      </div>
    );
  }

  return (
    <FadeIn className="container mx-auto min-h-0 flex-1 overflow-y-auto overscroll-contain py-layout-xl scrollbar-hide">
      <PageWorkspace>
        {resolvedWorkflow === "stock" ? (
          <StockAdjustmentWorkspaceContent
            canLoadMoreInventoryItems={canLoadMoreInventoryItems}
            cycleCountDraft={cycleCountDraft}
            cycleCountDraftSummary={cycleCountDraftSummary}
            inventoryItems={inventoryItems}
            inventoryUnitSummary={inventoryUnitSummary}
            isCycleCountDraftSaving={isCycleCountDraftSaving}
            isLoadingMoreInventoryItems={isLoadingMoreInventoryItems}
            isLoading={isLoadingStock}
            isSubmitting={isSubmittingStockBatch}
            onDiscardCycleCountDraft={onDiscardCycleCountDraft}
            onLoadMoreInventoryItems={onLoadMoreInventoryItems}
            onRefreshCycleCountDraftLineBaseline={
              onRefreshCycleCountDraftLineBaseline
            }
            onSearchStateChange={onStockAdjustmentSearchChange}
            onSaveCycleCountDraftLine={onSaveCycleCountDraftLine}
            onSubmitBatch={onSubmitStockBatch}
            onSubmitCycleCountDraft={onSubmitCycleCountDraft}
            searchState={stockAdjustmentSearch}
            showBackButton={showBackButton}
            storeId={storeId}
          />
        ) : null}
        {resolvedWorkflow === "queue" ? (
          <PageWorkspace>
            <PageLevelHeader
              animateContent={shouldAnimateOpenWorkHeader}
              contentKey={openWorkHeaderContentKey}
              eyebrow="Store Ops"
              title={openWorkHeaderTitle}
              description={openWorkHeaderDescription}
              showBackButton
            />

            {isLoadingQueue ? null : showOpenWorkEmptyState ? (
              <div className="flex min-h-[34rem] items-center justify-center">
                <div className="max-w-md text-center">
                  <p className="font-display text-2xl font-medium tracking-tight text-foreground">
                    {openWorkEmptyTitle}
                  </p>
                  <p className="mt-layout-sm text-sm leading-6 text-muted-foreground">
                    New service intakes and approval-driven stock reviews will
                    appear here
                  </p>
                </div>
              </div>
            ) : (
              <PageWorkspaceGrid className="xl:grid-cols-[minmax(15rem,0.32fr)_minmax(0,1fr)]">
                <PageWorkspaceRail className="gap-layout-md">
                  {openWorkOverflow ? (
                    <CappedQueueNotice title="More open work is available">
                      Showing the first {workItems.length.toLocaleString()} open
                      work items. Resolve visible work to continue through the
                      remaining items.
                    </CappedQueueNotice>
                  ) : null}
                  <OpenWorkMixSummary
                    summary={workItemSummary}
                    workItems={workItems}
                  />
                </PageWorkspaceRail>

                <PageWorkspaceMain
                  as="div"
                  className="space-y-0 rounded-lg border border-border bg-surface-raised shadow-surface"
                >
                  <div className="border-b border-border px-layout-md py-layout-md">
                    <div className="flex flex-col gap-layout-md sm:flex-row sm:items-end sm:justify-between">
                      <div>
                        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                          Work queue
                        </p>
                        <h2 className="mt-1 text-lg font-medium text-foreground">
                          Open items
                        </h2>
                      </div>
                      <OpenWorkTypeFilter
                        onWorkTypeChange={handleOpenWorkTypeChange}
                        selectedWorkType={selectedOpenWorkType}
                        summary={workItemSummary}
                        workItems={workItems}
                      />
                    </div>
                  </div>

                  <div className="p-layout-md">
                    <div className="space-y-layout-2xl">
                      {visibleWorkItemGroups.map((group) => {
                        const representative = group.items[0];
                        const productSkuId =
                          getQueueWorkItemStockAdjustmentSkuId(representative);
                        const logicalGroupConflict =
                          representative.logicalGroup !== undefined &&
                          conflictedLogicalGroupKeys?.has(
                            representative.logicalGroup.key,
                          );

                        return representative.type ===
                          "synced_sale_inventory_review" && productSkuId ? (
                          <SyncedSaleInventoryReviewGroupCard
                            conflictMessage={
                              logicalGroupConflict
                                ? LOGICAL_GROUP_CHANGED_MESSAGE
                                : undefined
                            }
                            isResolutionDisabled={Boolean(
                              isResolvingSyncedSaleInventoryReviewSkuId ||
                                logicalGroupConflict ||
                                (representative.logicalGroup !== undefined &&
                                  representative.logicalGroup
                                    .resolutionAvailability !== "available"),
                            )}
                            isResolving={
                              isResolvingSyncedSaleInventoryReviewSkuId ===
                              productSkuId
                            }
                            items={group.items}
                            key={group.key}
                            onRefresh={onRefreshOpenWork}
                            onResolve={onResolveSyncedSaleInventoryReview}
                            orgUrlSlug={orgUrlSlug}
                            storeUrlSlug={storeUrlSlug}
                          />
                        ) : (
                          <QueueWorkItemCard
                            item={representative}
                            key={group.key}
                            orgUrlSlug={orgUrlSlug}
                            storeUrlSlug={storeUrlSlug}
                          />
                        );
                      })}
                    </div>
                  </div>

                  {displayGroups.length > OPEN_WORK_ITEMS_PER_PAGE ? (
                    <ListPagination
                      onPageChange={handleOpenWorkPageChange}
                      page={clampedOpenWorkPage}
                      pageCount={openWorkPageCount}
                      pageSize={OPEN_WORK_ITEMS_PER_PAGE}
                      totalItems={displayGroups.length}
                    />
                  ) : null}
                </PageWorkspaceMain>
              </PageWorkspaceGrid>
            )}
          </PageWorkspace>
        ) : null}
        {resolvedWorkflow === "approvals" ? (
          <PageWorkspace>
            <PageLevelHeader
              animateContent={shouldAnimateApprovalsHeader}
              contentKey={approvalsHeaderContentKey}
              eyebrow="Store Ops"
              title={approvalsHeaderTitle}
              description={approvalsHeaderDescription}
              showBackButton={showBackButton}
            />

            {isLoadingQueue ? null : approvalRequests.length === 0 ? (
              <div className="flex min-h-[34rem] items-center justify-center">
                <div className="max-w-md text-center">
                  <p className="text-sm leading-6 text-muted-foreground">
                    High-variance deposits and stock reviews will surface here.
                  </p>
                </div>
              </div>
            ) : (
              <PageWorkspaceGrid className="xl:grid-cols-[minmax(15rem,0.32fr)_minmax(0,1fr)]">
                <PageWorkspaceRail className="gap-layout-md">
                  {approvalsOverflow ? (
                    <CappedQueueNotice title="More approvals are available">
                      Showing the first{" "}
                      {approvalRequests.length.toLocaleString()} pending
                      approvals. Resolve visible approvals to continue through
                      the remaining requests.
                    </CappedQueueNotice>
                  ) : null}
                  <OperationsSummaryMetric
                    helper="Pending approvals"
                    label="Waiting for review"
                    value={approvalRequests.length}
                  />

                  {approvalDecisionUnlockRequired ? (
                    <div className="rounded-lg border border-border bg-surface-raised p-layout-md shadow-surface">
                      <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                        Decision access
                      </p>
                      {approvalDecisionUnlocked ? (
                        <div className="mt-layout-sm space-y-layout-sm">
                          <p className="text-sm text-muted-foreground">
                            Manager approval is active
                            {approvalDecisionUnlockExpiresAt
                              ? ` until ${new Date(
                                  approvalDecisionUnlockExpiresAt,
                                ).toLocaleTimeString([], {
                                  hour: "numeric",
                                  minute: "2-digit",
                                })}`
                              : ""}
                            .
                          </p>
                          <Button
                            className="w-full"
                            onClick={onLockApprovalDecisions}
                            size="sm"
                            type="button"
                            variant="utility"
                          >
                            <Lock className="w-2 h-2" />
                            Lock approvals
                          </Button>
                        </div>
                      ) : (
                        <div className="mt-layout-sm space-y-layout-sm">
                          <p className="text-sm text-muted-foreground">
                            Unlock once with manager credentials to approve or
                            reject multiple requests.
                          </p>
                          <Button
                            className="w-full"
                            onClick={onRequestApprovalDecisionUnlock}
                            size="sm"
                            type="button"
                            variant="workflow-soft"
                          >
                            <LockOpen className="w-2 h-2" />
                            Unlock approvals
                          </Button>
                        </div>
                      )}
                    </div>
                  ) : null}
                </PageWorkspaceRail>

                <PageWorkspaceMain
                  as="div"
                  className="space-y-0 rounded-lg border border-border bg-surface-raised shadow-surface"
                >
                  <div className="flex flex-col gap-layout-sm border-b border-border px-layout-md py-layout-md md:flex-row md:items-center md:justify-between">
                    <div>
                      <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                        Approval queue
                      </p>
                      <h2 className="mt-1 text-lg font-medium text-foreground">
                        Pending requests
                      </h2>
                    </div>
                  </div>

                  <div className="p-layout-md">
                    <div className="space-y-layout-2xl">
                      {approvalRequests.map((request) => {
                        const approvalCopy = getApprovalRequestCopy(
                          request.requestType,
                        );
                        const retireOnlyApprovalCopy =
                          getRetireOnlyApprovalRequestCopy(request.requestType);
                        const requestLabel = request.workItemTitle
                          ? formatWorkItemTitle(request.workItemTitle)
                          : formatApprovalRequestType(request.requestType);
                        const inventoryLineItems =
                          getInventoryApprovalLineItems(request);
                        const paymentCorrectionSummary =
                          getPaymentCorrectionSummary(request);
                        const transactionVoidSummary =
                          getTransactionVoidSummary(request);
                        const itemAdjustmentSummary =
                          getItemAdjustmentSummary(request);
                        const varianceReviewSummary =
                          getVarianceReviewSummary(request);
                        const registerSyncReviewSummary =
                          getRegisterSyncReviewSummary(request);

                        return (
                          <article
                            className="overflow-hidden rounded-lg border border-border bg-background"
                            key={request._id}
                          >
                            <div className="flex flex-col gap-layout-sm px-layout-md py-layout-md md:flex-row md:items-start md:justify-between">
                              <div className="flex min-w-0 gap-layout-sm">
                                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                                  <ClipboardCheck className="h-4 w-4" />
                                </div>
                                <div className="min-w-0">
                                  <p className="font-medium text-foreground">
                                    {requestLabel}
                                  </p>
                                  <p className="mt-1 text-sm text-muted-foreground">
                                    Requested by{" "}
                                    {request.requestedByStaffName ??
                                      "admin flow"}
                                  </p>
                                  {request.notes ? (
                                    <div className="mt-layout-sm rounded-md border border-border/70 bg-surface px-layout-sm py-layout-xs">
                                      <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                                        Requester note
                                      </p>
                                      <p className="mt-1 text-sm leading-6 text-foreground">
                                        {request.notes}
                                      </p>
                                    </div>
                                  ) : null}
                                </div>
                              </div>
                            </div>

                            {inventoryLineItems.length > 0 ? (
                              <div className="border-t border-border/70 bg-surface px-layout-md py-layout-md">
                                <div className="flex flex-col gap-layout-xs md:flex-row md:items-center md:justify-between">
                                  <div>
                                    <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                                      SKU review
                                    </p>
                                    <p className="mt-1 text-sm text-muted-foreground">
                                      {inventoryLineItems.length} SKU
                                      {inventoryLineItems.length === 1
                                        ? ""
                                        : "s"}{" "}
                                      queued for approval
                                    </p>
                                  </div>
                                  <div className="flex flex-wrap gap-2">
                                    {typeof request.metadata
                                      ?.netQuantityDelta === "number" ? (
                                      <Badge
                                        className={getQuantityDeltaBadgeClass(
                                          request.metadata.netQuantityDelta,
                                        )}
                                        variant="outline"
                                      >
                                        Net{" "}
                                        {formatQuantityDelta(
                                          request.metadata.netQuantityDelta,
                                        )}
                                      </Badge>
                                    ) : null}
                                    {typeof request.metadata
                                      ?.largestAbsoluteDelta === "number" ? (
                                      <Badge
                                        className="border-action-workflow-border bg-action-workflow-soft text-action-workflow shadow-sm"
                                        variant="outline"
                                      >
                                        Max variance{" "}
                                        {request.metadata.largestAbsoluteDelta}
                                      </Badge>
                                    ) : null}
                                  </div>
                                </div>

                                <div className="mt-layout-sm divide-y divide-border/70 rounded-lg border border-border bg-background">
                                  {inventoryLineItems.map((lineItem, index) => (
                                    <div
                                      className="grid gap-layout-sm px-layout-sm py-layout-sm md:grid-cols-[minmax(0,1fr)_auto]"
                                      key={`${lineItem.productSkuId ?? "sku"}-${index}`}
                                    >
                                      <div className="min-w-0">
                                        <p className="truncate text-sm font-medium text-foreground">
                                          {formatSkuProductName(
                                            lineItem.productName,
                                          )}
                                        </p>
                                        <p className="mt-1 truncate text-xs text-muted-foreground">
                                          {lineItem.sku ?? "No SKU code"}
                                        </p>
                                      </div>
                                      <div className="flex shrink-0 flex-col items-start gap-2 text-sm md:items-end">
                                        <p className="text-muted-foreground">
                                          {formatInventoryApprovalQuantityReview(
                                            lineItem,
                                          )}
                                        </p>
                                        <Badge
                                          className={getQuantityDeltaBadgeClass(
                                            lineItem.quantityDelta,
                                          )}
                                          size="sm"
                                          variant="outline"
                                        >
                                          <span>Stock</span>
                                          <span>
                                            {typeof lineItem.quantityDelta ===
                                            "number"
                                              ? formatQuantityDelta(
                                                  lineItem.quantityDelta,
                                                )
                                              : "-"}
                                          </span>
                                        </Badge>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            ) : null}

                            {paymentCorrectionSummary ? (
                              <div className="border-t border-border/70 bg-surface px-layout-md py-layout-md">
                                <div className="flex flex-col gap-layout-xs md:flex-row md:items-center md:justify-between">
                                  <div>
                                    <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                                      Linked transaction
                                    </p>
                                    <p className="mt-1 text-sm text-muted-foreground">
                                      Completed sale queued for payment method
                                      correction
                                    </p>
                                  </div>
                                  <div className="flex flex-wrap items-center gap-2">
                                    {paymentCorrectionSummary.transaction &&
                                    orgUrlSlug &&
                                    storeUrlSlug ? (
                                      <Button
                                        asChild
                                        size="sm"
                                        variant="utility"
                                      >
                                        <Link
                                          params={{
                                            orgUrlSlug,
                                            storeUrlSlug,
                                            transactionId:
                                              paymentCorrectionSummary
                                                .transaction.transactionId,
                                          }}
                                          search={{ o: getOrigin() }}
                                          to="/$orgUrlSlug/store/$storeUrlSlug/pos/transactions/$transactionId"
                                        >
                                          <ArrowUpRight aria-hidden="true" />
                                          View transaction
                                        </Link>
                                      </Button>
                                    ) : null}
                                  </div>
                                </div>

                                <dl className="mt-layout-sm grid gap-layout-sm rounded-lg border border-border bg-background p-layout-sm text-sm md:grid-cols-3 xl:grid-cols-6">
                                  <div>
                                    <dt className="text-xs text-muted-foreground">
                                      Transaction
                                    </dt>
                                    <dd className="mt-1 font-medium text-foreground">
                                      <TransactionReferenceLink
                                        orgUrlSlug={orgUrlSlug}
                                        storeUrlSlug={storeUrlSlug}
                                        transaction={
                                          paymentCorrectionSummary.transaction
                                        }
                                      />
                                    </dd>
                                  </div>
                                  <div>
                                    <dt className="text-xs text-muted-foreground">
                                      Current method
                                    </dt>
                                    <dd className="mt-1 font-medium text-foreground">
                                      {paymentCorrectionSummary.previousPaymentMethod
                                        ? formatApprovalRequestType(
                                            paymentCorrectionSummary.previousPaymentMethod,
                                          )
                                        : "Unknown"}
                                    </dd>
                                  </div>
                                  <div>
                                    <dt className="text-xs text-muted-foreground">
                                      Requested method
                                    </dt>
                                    <dd className="mt-1 font-medium text-foreground">
                                      {paymentCorrectionSummary.nextPaymentMethod
                                        ? formatApprovalRequestType(
                                            paymentCorrectionSummary.nextPaymentMethod,
                                          )
                                        : "Unknown"}
                                    </dd>
                                  </div>
                                  {typeof paymentCorrectionSummary.amount ===
                                  "number" ? (
                                    <div>
                                      <dt className="text-xs text-muted-foreground">
                                        Amount
                                      </dt>
                                      <dd className="mt-1 font-medium text-foreground">
                                        {formatStoredAmount(
                                          ghsCurrencyFormatter,
                                          paymentCorrectionSummary.amount,
                                        )}
                                      </dd>
                                    </div>
                                  ) : null}
                                </dl>
                              </div>
                            ) : null}

                            {transactionVoidSummary ? (
                              <div className="border-t border-border/70 bg-surface px-layout-md py-layout-md">
                                <div className="flex flex-col gap-layout-xs md:flex-row md:items-center md:justify-between">
                                  <div>
                                    <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                                      Completed sale
                                    </p>
                                    <p className="mt-1 text-sm text-muted-foreground">
                                      Sale queued for manager-approved void
                                    </p>
                                  </div>
                                  <div className="flex flex-wrap items-center gap-2">
                                    {transactionVoidSummary.registerSession &&
                                    orgUrlSlug &&
                                    storeUrlSlug ? (
                                      <Button
                                        asChild
                                        size="sm"
                                        variant="utility"
                                      >
                                        <Link
                                          params={{
                                            orgUrlSlug,
                                            sessionId:
                                              transactionVoidSummary
                                                .registerSession
                                                .registerSessionId,
                                            storeUrlSlug,
                                          }}
                                          search={{ o: getOrigin() }}
                                          to="/$orgUrlSlug/store/$storeUrlSlug/cash-controls/registers/$sessionId"
                                        >
                                          <ArrowUpRight aria-hidden="true" />
                                          View register session
                                        </Link>
                                      </Button>
                                    ) : null}
                                    {transactionVoidSummary.transaction &&
                                    orgUrlSlug &&
                                    storeUrlSlug ? (
                                      <Button
                                        asChild
                                        size="sm"
                                        variant="utility"
                                      >
                                        <Link
                                          params={{
                                            orgUrlSlug,
                                            storeUrlSlug,
                                            transactionId:
                                              transactionVoidSummary.transaction
                                                .transactionId,
                                          }}
                                          search={{ o: getOrigin() }}
                                          to="/$orgUrlSlug/store/$storeUrlSlug/pos/transactions/$transactionId"
                                        >
                                          <ArrowUpRight aria-hidden="true" />
                                          View transaction
                                        </Link>
                                      </Button>
                                    ) : null}
                                  </div>
                                </div>

                                <dl className="mt-layout-sm grid gap-layout-sm rounded-lg border border-border bg-background p-layout-sm text-sm md:grid-cols-3 xl:grid-cols-6">
                                  <div>
                                    <dt className="text-xs text-muted-foreground">
                                      Transaction
                                    </dt>
                                    <dd className="mt-1 font-medium text-foreground">
                                      <TransactionReferenceLink
                                        orgUrlSlug={orgUrlSlug}
                                        storeUrlSlug={storeUrlSlug}
                                        transaction={
                                          transactionVoidSummary.transaction
                                        }
                                      />
                                    </dd>
                                  </div>
                                  <div>
                                    <dt className="text-xs text-muted-foreground">
                                      Payment
                                    </dt>
                                    <dd className="mt-1 font-medium text-foreground">
                                      {transactionVoidSummary.transaction
                                        ?.paymentMethod
                                        ? formatApprovalRequestType(
                                            transactionVoidSummary.transaction
                                              .paymentMethod,
                                          )
                                        : "Unknown"}
                                    </dd>
                                  </div>
                                  <div>
                                    <dt className="text-xs text-muted-foreground">
                                      Total
                                    </dt>
                                    <dd className="mt-1 font-medium text-foreground">
                                      {transactionVoidSummary.transaction
                                        ? formatStoredAmount(
                                            ghsCurrencyFormatter,
                                            transactionVoidSummary.transaction
                                              .total,
                                          )
                                        : "Unknown"}
                                    </dd>
                                  </div>
                                  {transactionVoidSummary.registerSession ? (
                                    <div>
                                      <dt className="text-xs text-muted-foreground">
                                        Register session
                                      </dt>
                                      <dd className="mt-1 font-medium text-foreground">
                                        {orgUrlSlug && storeUrlSlug ? (
                                          <Link
                                            className="inline-flex items-center gap-1 underline-offset-4 hover:underline"
                                            params={{
                                              orgUrlSlug,
                                              sessionId:
                                                transactionVoidSummary
                                                  .registerSession
                                                  .registerSessionId,
                                              storeUrlSlug,
                                            }}
                                            search={{ o: getOrigin() }}
                                            to="/$orgUrlSlug/store/$storeUrlSlug/cash-controls/registers/$sessionId"
                                          >
                                            {formatRegisterSessionLabel(
                                              transactionVoidSummary.registerSession,
                                            )}
                                            <ArrowUpRight
                                              aria-hidden="true"
                                              className="h-3 w-3"
                                            />
                                          </Link>
                                        ) : (
                                          formatRegisterSessionLabel(
                                            transactionVoidSummary.registerSession,
                                          )
                                        )}
                                      </dd>
                                    </div>
                                  ) : null}
                                  <div>
                                    <dt className="text-xs text-muted-foreground">
                                      Requested at
                                    </dt>
                                    <dd className="mt-1 font-medium text-foreground">
                                      {formatApprovalDate(
                                        transactionVoidSummary.requestedAt,
                                      )}
                                    </dd>
                                  </div>
                                </dl>
                              </div>
                            ) : null}

                            {itemAdjustmentSummary ? (
                              <div className="border-t border-border/70 bg-surface px-layout-md py-layout-md">
                                <div className="flex flex-col gap-layout-xs md:flex-row md:items-center md:justify-between">
                                  <div>
                                    <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                                      Review item adjustment
                                    </p>
                                    <p className="mt-1 text-sm text-muted-foreground">
                                      Completed sale queued for item or quantity
                                      correction
                                    </p>
                                  </div>
                                  <div className="flex flex-wrap items-center gap-2">
                                    {itemAdjustmentSummary.registerSession &&
                                    orgUrlSlug &&
                                    storeUrlSlug ? (
                                      <Button
                                        asChild
                                        size="sm"
                                        variant="utility"
                                      >
                                        <Link
                                          params={{
                                            orgUrlSlug,
                                            sessionId:
                                              itemAdjustmentSummary
                                                .registerSession
                                                .registerSessionId,
                                            storeUrlSlug,
                                          }}
                                          search={{ o: getOrigin() }}
                                          to="/$orgUrlSlug/store/$storeUrlSlug/cash-controls/registers/$sessionId"
                                        >
                                          <ArrowUpRight aria-hidden="true" />
                                          View register session
                                        </Link>
                                      </Button>
                                    ) : null}
                                    {itemAdjustmentSummary.transaction &&
                                    orgUrlSlug &&
                                    storeUrlSlug ? (
                                      <Button
                                        asChild
                                        size="sm"
                                        variant="utility"
                                      >
                                        <Link
                                          params={{
                                            orgUrlSlug,
                                            storeUrlSlug,
                                            transactionId:
                                              itemAdjustmentSummary.transaction
                                                .transactionId,
                                          }}
                                          search={{ o: getOrigin() }}
                                          to="/$orgUrlSlug/store/$storeUrlSlug/pos/transactions/$transactionId"
                                        >
                                          <ArrowUpRight aria-hidden="true" />
                                          View transaction
                                        </Link>
                                      </Button>
                                    ) : null}
                                  </div>
                                </div>

                                <dl className="mt-layout-sm grid gap-layout-sm rounded-lg border border-border bg-background p-layout-sm text-sm md:grid-cols-4">
                                  <div>
                                    <dt className="text-xs text-muted-foreground">
                                      Transaction
                                    </dt>
                                    <dd className="mt-1 font-medium text-foreground">
                                      <TransactionReferenceLink
                                        orgUrlSlug={orgUrlSlug}
                                        storeUrlSlug={storeUrlSlug}
                                        transaction={
                                          itemAdjustmentSummary.transaction
                                        }
                                      />
                                    </dd>
                                  </div>
                                  <div>
                                    <dt className="text-xs text-muted-foreground">
                                      Original total
                                    </dt>
                                    <dd className="mt-1 font-medium text-foreground">
                                      {typeof itemAdjustmentSummary.originalTotal ===
                                      "number"
                                        ? formatStoredAmount(
                                            ghsCurrencyFormatter,
                                            itemAdjustmentSummary.originalTotal,
                                          )
                                        : "Unknown"}
                                    </dd>
                                  </div>
                                  <div>
                                    <dt className="text-xs text-muted-foreground">
                                      Adjusted total
                                    </dt>
                                    <dd className="mt-1 font-medium text-foreground">
                                      {typeof itemAdjustmentSummary.adjustedTotal ===
                                      "number"
                                        ? formatStoredAmount(
                                            ghsCurrencyFormatter,
                                            itemAdjustmentSummary.adjustedTotal,
                                          )
                                        : "Unknown"}
                                    </dd>
                                  </div>
                                  <div>
                                    <dt className="text-xs text-muted-foreground">
                                      Original payment
                                    </dt>
                                    <dd className="mt-1 font-medium text-foreground">
                                      {itemAdjustmentSummary.transaction
                                        ?.paymentMethod
                                        ? formatApprovalRequestType(
                                            itemAdjustmentSummary.transaction
                                              .paymentMethod,
                                          )
                                        : "Unknown"}
                                    </dd>
                                  </div>
                                  {itemAdjustmentSummary.registerSession ? (
                                    <div>
                                      <dt className="text-xs text-muted-foreground">
                                        Register session
                                      </dt>
                                      <dd className="mt-1 font-medium text-foreground">
                                        {orgUrlSlug && storeUrlSlug ? (
                                          <Link
                                            className="inline-flex items-center gap-1 underline-offset-4 hover:underline"
                                            params={{
                                              orgUrlSlug,
                                              sessionId:
                                                itemAdjustmentSummary
                                                  .registerSession
                                                  .registerSessionId,
                                              storeUrlSlug,
                                            }}
                                            search={{ o: getOrigin() }}
                                            to="/$orgUrlSlug/store/$storeUrlSlug/cash-controls/registers/$sessionId"
                                          >
                                            {formatRegisterSessionLabel(
                                              itemAdjustmentSummary.registerSession,
                                            )}
                                            <ArrowUpRight
                                              aria-hidden="true"
                                              className="h-3 w-3"
                                            />
                                          </Link>
                                        ) : (
                                          formatRegisterSessionLabel(
                                            itemAdjustmentSummary.registerSession,
                                          )
                                        )}
                                      </dd>
                                    </div>
                                  ) : null}
                                  <div>
                                    <dt className="text-xs text-muted-foreground">
                                      {itemAdjustmentSummary.settlementDirection ===
                                      "refund"
                                        ? "Refund due"
                                        : itemAdjustmentSummary.settlementDirection ===
                                              "collection" ||
                                            itemAdjustmentSummary.settlementDirection ===
                                              "collect"
                                          ? "Balance due"
                                          : "No payment movement"}
                                    </dt>
                                    <dd className="mt-1 font-medium text-foreground">
                                      {itemAdjustmentSummary.settlementDirection ===
                                      "none"
                                        ? "No payment movement"
                                        : typeof itemAdjustmentSummary.settlementAmount ===
                                            "number"
                                          ? formatStoredAmount(
                                              ghsCurrencyFormatter,
                                              itemAdjustmentSummary.settlementAmount,
                                            )
                                          : "Unknown"}
                                    </dd>
                                  </div>
                                  {itemAdjustmentSummary.settlementDirection !==
                                  "none" ? (
                                    <div>
                                      <dt className="text-xs text-muted-foreground">
                                        {itemAdjustmentSummary.settlementDirection ===
                                        "refund"
                                          ? "Refund payout"
                                          : "Collection method"}
                                      </dt>
                                      <dd className="mt-1 font-medium text-foreground">
                                        {itemAdjustmentSummary.settlementMethod
                                          ? formatApprovalRequestType(
                                              itemAdjustmentSummary.settlementMethod,
                                            )
                                          : "Unknown"}
                                      </dd>
                                    </div>
                                  ) : null}
                                </dl>

                                {itemAdjustmentSummary.lineItems.length > 0 ? (
                                  <div className="mt-layout-sm divide-y divide-border/70 rounded-lg border border-border bg-background">
                                    {itemAdjustmentSummary.lineItems.map(
                                      (lineItem, index) => (
                                        <div
                                          className="grid gap-layout-sm px-layout-sm py-layout-sm md:grid-cols-[minmax(0,1fr)_auto]"
                                          key={`${lineItem.productSkuId ?? "sku"}-${index}`}
                                        >
                                          <div className="min-w-0">
                                            <p className="truncate text-sm font-medium text-foreground">
                                              {formatSkuProductName(
                                                lineItem.productName,
                                              )}
                                            </p>
                                            <p className="mt-1 truncate text-xs text-muted-foreground">
                                              {lineItem.sku ?? "No SKU code"}
                                            </p>
                                          </div>
                                          <div className="flex shrink-0 flex-col items-start gap-2 text-sm md:items-end">
                                            <p className="text-muted-foreground">
                                              <span className="font-numeric font-medium tabular-nums text-foreground">
                                                {lineItem.originalQuantity ??
                                                  "-"}
                                              </span>{" "}
                                              original to{" "}
                                              <span className="font-numeric font-medium tabular-nums text-foreground">
                                                {lineItem.adjustedQuantity ??
                                                  "-"}
                                              </span>{" "}
                                              adjusted
                                            </p>
                                            <Badge
                                              className={getQuantityDeltaBadgeClass(
                                                lineItem.quantityDelta,
                                              )}
                                              size="sm"
                                              variant="outline"
                                            >
                                              Qty{" "}
                                              {typeof lineItem.quantityDelta ===
                                              "number"
                                                ? formatQuantityDelta(
                                                    lineItem.quantityDelta,
                                                  )
                                                : "-"}
                                            </Badge>
                                          </div>
                                        </div>
                                      ),
                                    )}
                                  </div>
                                ) : null}
                              </div>
                            ) : null}

                            {varianceReviewSummary ? (
                              <div className="border-t border-border/70 bg-surface px-layout-md py-layout-md">
                                <div>
                                  <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                                    Register closeout
                                  </p>
                                  <p className="mt-1 text-sm text-muted-foreground">
                                    Closeout variance queued for manager review
                                  </p>
                                </div>

                                <dl className="mt-layout-sm grid gap-layout-sm rounded-lg border border-border bg-background p-layout-sm text-sm md:grid-cols-3">
                                  <div>
                                    <dt className="text-xs text-muted-foreground">
                                      Terminal
                                    </dt>
                                    <dd className="mt-1 font-medium text-foreground">
                                      {varianceReviewSummary.registerSessionId &&
                                      orgUrlSlug &&
                                      storeUrlSlug ? (
                                        <Link
                                          className="inline-flex items-center gap-1 underline-offset-4 hover:underline"
                                          params={{
                                            orgUrlSlug,
                                            sessionId:
                                              varianceReviewSummary.registerSessionId,
                                            storeUrlSlug,
                                          }}
                                          search={{ o: getOrigin() }}
                                          to="/$orgUrlSlug/store/$storeUrlSlug/cash-controls/registers/$sessionId"
                                        >
                                          {varianceReviewSummary.terminalLabel}
                                          <ArrowUpRight
                                            aria-hidden="true"
                                            className="h-3 w-3"
                                          />
                                        </Link>
                                      ) : (
                                        varianceReviewSummary.terminalLabel
                                      )}
                                    </dd>
                                  </div>
                                  <div>
                                    <dt className="text-xs text-muted-foreground">
                                      Expected cash
                                    </dt>
                                    <dd className="mt-1 font-medium text-foreground">
                                      {typeof varianceReviewSummary.expectedCash ===
                                      "number"
                                        ? formatStoredAmount(
                                            ghsCurrencyFormatter,
                                            varianceReviewSummary.expectedCash,
                                          )
                                        : "Unknown"}
                                    </dd>
                                  </div>
                                  <div>
                                    <dt className="text-xs text-muted-foreground">
                                      Counted cash
                                    </dt>
                                    <dd className="mt-1 font-medium text-foreground">
                                      {typeof varianceReviewSummary.countedCash ===
                                      "number"
                                        ? formatStoredAmount(
                                            ghsCurrencyFormatter,
                                            varianceReviewSummary.countedCash,
                                          )
                                        : "Not recorded"}
                                    </dd>
                                  </div>
                                  <div>
                                    <dt className="text-xs text-muted-foreground">
                                      Variance
                                    </dt>
                                    <dd
                                      className={cn(
                                        "mt-1 font-medium",
                                        getVarianceAmountClassName(
                                          varianceReviewSummary.variance,
                                        ),
                                      )}
                                    >
                                      {typeof varianceReviewSummary.variance ===
                                      "number"
                                        ? formatStoredAmount(
                                            ghsCurrencyFormatter,
                                            varianceReviewSummary.variance,
                                          )
                                        : "Unknown"}
                                    </dd>
                                  </div>
                                  <div>
                                    <dt className="text-xs text-muted-foreground">
                                      Requested at
                                    </dt>
                                    <dd className="mt-1 font-medium text-foreground">
                                      {formatApprovalDate(
                                        varianceReviewSummary.requestedAt,
                                      )}
                                    </dd>
                                  </div>
                                  <div>
                                    <dt className="text-xs text-muted-foreground">
                                      Register status
                                    </dt>
                                    <dd className="mt-1 font-medium text-foreground">
                                      {varianceReviewSummary.status
                                        ? formatApprovalRequestType(
                                            varianceReviewSummary.status,
                                          )
                                        : "Unknown"}
                                    </dd>
                                  </div>
                                  {varianceReviewSummary.reason ? (
                                    <div className="md:col-span-3">
                                      <dt className="text-xs text-muted-foreground">
                                        Reason
                                      </dt>
                                      <dd className="mt-1 font-medium text-foreground">
                                        {varianceReviewSummary.reason}
                                      </dd>
                                    </div>
                                  ) : null}
                                </dl>
                              </div>
                            ) : null}

                            {registerSyncReviewSummary ? (
                              <div className="border-t border-border/70 bg-surface px-layout-md py-layout-md">
                                <div>
                                  <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                                    Synced register activity
                                  </p>
                                  <p className="mt-1 text-sm text-muted-foreground">
                                    Review local register activity before it is
                                    applied to cash controls.
                                  </p>
                                </div>

                                <dl className="mt-layout-sm grid gap-layout-sm rounded-lg border border-border bg-background p-layout-sm text-sm md:grid-cols-3">
                                  <div>
                                    <dt className="text-xs text-muted-foreground">
                                      Register session
                                    </dt>
                                    <dd className="mt-1 font-medium text-foreground">
                                      {registerSyncReviewSummary.registerSession &&
                                      orgUrlSlug &&
                                      storeUrlSlug ? (
                                        <Link
                                          className="inline-flex items-center gap-1 underline-offset-4 hover:underline"
                                          params={{
                                            orgUrlSlug,
                                            sessionId:
                                              registerSyncReviewSummary
                                                .registerSession
                                                .registerSessionId,
                                            storeUrlSlug,
                                          }}
                                          search={{ o: getOrigin() }}
                                          to="/$orgUrlSlug/store/$storeUrlSlug/cash-controls/registers/$sessionId"
                                        >
                                          {formatRegisterSessionLabel(
                                            registerSyncReviewSummary.registerSession,
                                          )}
                                          <ArrowUpRight
                                            aria-hidden="true"
                                            className="h-3 w-3"
                                          />
                                        </Link>
                                      ) : registerSyncReviewSummary.registerSession ? (
                                        formatRegisterSessionLabel(
                                          registerSyncReviewSummary.registerSession,
                                        )
                                      ) : (
                                        "Register session"
                                      )}
                                    </dd>
                                  </div>
                                  <div>
                                    <dt className="text-xs text-muted-foreground">
                                      Review items
                                    </dt>
                                    <dd className="mt-1 font-medium text-foreground">
                                      {registerSyncReviewSummary.reviewItems
                                        .length || 1}
                                    </dd>
                                  </div>
                                  <div>
                                    <dt className="text-xs text-muted-foreground">
                                      Latest issue
                                    </dt>
                                    <dd className="mt-1 font-medium text-foreground">
                                      {registerSyncReviewSummary.reviewItems[0]
                                        ?.summary ?? request.reason}
                                    </dd>
                                  </div>
                                </dl>
                              </div>
                            ) : null}

                            {approvalCopy ? (
                              <div className="border-t border-border/70 bg-surface px-layout-md py-layout-md">
                                <div className="flex flex-col gap-layout-md lg:flex-row lg:items-center lg:justify-between">
                                  <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
                                    {approvalCopy.description}
                                  </p>
                                  <div className="flex shrink-0 flex-wrap gap-2">
                                    <LoadingButton
                                      disabled={Boolean(
                                        isDecidingApprovalRequestId ||
                                        (approvalDecisionUnlockRequired &&
                                          !approvalDecisionUnlocked),
                                      )}
                                      isLoading={
                                        isDecidingApprovalRequestId ===
                                        request._id
                                      }
                                      onClick={() =>
                                        onDecideApprovalRequest({
                                          approvalRequestId: request._id,
                                          decision: "approved",
                                          ...(request.requestType ===
                                            "register_sync_review" ||
                                          request.requestType ===
                                            "variance_review"
                                            ? {
                                                registerSessionId:
                                                  request.registerSessionSummary
                                                    ?.registerSessionId,
                                                requestType:
                                                  request.requestType,
                                              }
                                            : {}),
                                        })
                                      }
                                      size="sm"
                                      variant="workflow-soft"
                                    >
                                      {approvalCopy.approveLabel}
                                    </LoadingButton>
                                    <Button
                                      disabled={Boolean(
                                        isDecidingApprovalRequestId ||
                                        (approvalDecisionUnlockRequired &&
                                          !approvalDecisionUnlocked),
                                      )}
                                      onClick={() =>
                                        onDecideApprovalRequest({
                                          approvalRequestId: request._id,
                                          decision: "rejected",
                                          ...(request.requestType ===
                                            "register_sync_review" ||
                                          request.requestType ===
                                            "variance_review"
                                            ? {
                                                registerSessionId:
                                                  request.registerSessionSummary
                                                    ?.registerSessionId,
                                                requestType:
                                                  request.requestType,
                                              }
                                            : {}),
                                        })
                                      }
                                      size="sm"
                                      variant="outline"
                                    >
                                      {approvalCopy.rejectLabel}
                                    </Button>
                                  </div>
                                </div>
                              </div>
                            ) : null}

                            {retireOnlyApprovalCopy ? (
                              <div className="border-t border-border/70 bg-surface px-layout-md py-layout-md">
                                <div className="flex flex-col gap-layout-md lg:flex-row lg:items-center lg:justify-between">
                                  <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
                                    {retireOnlyApprovalCopy.description}
                                  </p>
                                  <div className="flex shrink-0 flex-wrap gap-2">
                                    <Button
                                      disabled={Boolean(
                                        isDecidingApprovalRequestId ||
                                        (approvalDecisionUnlockRequired &&
                                          !approvalDecisionUnlocked),
                                      )}
                                      onClick={() =>
                                        onDecideApprovalRequest({
                                          approvalRequestId: request._id,
                                          decision: "rejected",
                                        })
                                      }
                                      size="sm"
                                      variant="outline"
                                    >
                                      {retireOnlyApprovalCopy.rejectLabel}
                                    </Button>
                                  </div>
                                </div>
                              </div>
                            ) : null}
                          </article>
                        );
                      })}
                    </div>
                  </div>
                </PageWorkspaceMain>
              </PageWorkspaceGrid>
            )}
          </PageWorkspace>
        ) : null}
      </PageWorkspace>
    </FadeIn>
  );
}

type OperationsQueueViewProps = {
  activeWorkflow?: OperationsWorkflow;
  onOpenWorkSearchChange?: (patch: OpenWorkSearchPatch) => void;
  onStockAdjustmentSearchChange?: (patch: StockAdjustmentSearchPatch) => void;
  openWorkSearch?: OpenWorkSearchState;
  stockAdjustmentSearch?: StockAdjustmentSearchState;
};

type ApprovalDecisionUnlock = {
  expiresAt: number;
  pinHash: string;
  username: string;
};

export function OperationsQueueView({
  activeWorkflow,
  onOpenWorkSearchChange,
  onStockAdjustmentSearchChange,
  openWorkSearch,
  stockAdjustmentSearch,
}: OperationsQueueViewProps = {}) {
  const routeParams = useParams({ strict: false }) as
    | {
        orgUrlSlug?: string;
        storeUrlSlug?: string;
      }
    | undefined;
  const search = useSearch({ strict: false }) as { o?: unknown };
  const {
    activeStore,
    canAccessProtectedSurface,
    canQueryProtectedData,
    hasFullAdminAccess,
    isAuthenticated,
    isLoadingAccess,
  } = useProtectedAdminPageState({ surface: "store_day" });
  const canAccessSurface = canAccessProtectedSurface ?? hasFullAdminAccess;
  const [isSubmittingStockBatch, setIsSubmittingStockBatch] = useState(false);
  const [isSavingCycleCountDraft, setIsSavingCycleCountDraft] = useState(false);
  const [decisioningApprovalRequestId, setDecisioningApprovalRequestId] =
    useState<string | null>(null);
  const [
    resolvingSyncedSaleInventoryReviewSkuId,
    setResolvingSyncedSaleInventoryReviewSkuId,
  ] = useState<Id<"productSku"> | null>(null);
  const [isApprovalUnlockOpen, setIsApprovalUnlockOpen] = useState(false);
  const [approvalDecisionUnlock, setApprovalDecisionUnlock] =
    useState<ApprovalDecisionUnlock | null>(null);
  const [conflictedLogicalGroups, setConflictedLogicalGroups] = useState<
    Map<string, LogicalGroupConflictObservation>
  >(() => new Map());
  const [openWorkRefreshNonce, setOpenWorkRefreshNonce] = useState(0);

  const queue = useQuery(
    operationsApi.operationalWorkItems.getQueueSnapshot,
    canQueryProtectedData
      ? {
          storeId: activeStore!._id,
          ...(openWorkSearch?.workType
            ? { workType: openWorkSearch.workType }
            : {}),
          ...(openWorkRefreshNonce > 0
            ? { refreshNonce: openWorkRefreshNonce }
            : {}),
        }
      : "skip",
  ) as
    | {
        approvalRequests: QueueApprovalRequest[];
        overflow?: QueueOverflow;
        workItemSummary?: QueueWorkItemSummary;
        workItems: QueueWorkItem[];
      }
    | undefined;
  const conflictedLogicalGroupKeys = useMemo(
    () => new Set(conflictedLogicalGroups.keys()),
    [conflictedLogicalGroups],
  );
  const latestQueueWorkItemsRef = useRef(queue?.workItems ?? []);
  latestQueueWorkItemsRef.current = queue?.workItems ?? [];

  useEffect(() => {
    if (!queue) return;

    setConflictedLogicalGroups((current) => {
      const next = new Map(current);
      let changed = false;

      for (const [groupKey, observation] of current) {
        const refreshedGroup = queue.workItems.find(
          (item) => item.logicalGroup?.key === groupKey,
        )?.logicalGroup;

        if (
          refreshedGroup?.completeness === "complete" &&
          (logicalGroupObservationFingerprint(refreshedGroup) !==
            observation.fingerprint ||
            openWorkRefreshNonce > observation.refreshNonce)
        ) {
          next.delete(groupKey);
          changed = true;
        }
      }

      return changed ? next : current;
    });
  }, [openWorkRefreshNonce, queue]);
  const shouldLoadStockWorkspace =
    canQueryProtectedData &&
    Boolean(activeStore?._id) &&
    activeWorkflow !== "queue" &&
    activeWorkflow !== "approvals";
  const inventorySnapshotPage = usePaginatedQuery(
    stockOpsApi.adjustments.listInventorySnapshotPage,
    shouldLoadStockWorkspace ? { storeId: activeStore!._id } : "skip",
    { initialNumItems: 100 },
  );
  const inventoryItems =
    inventorySnapshotPage.results as InventorySnapshotItem[];
  const normalizedStockSearchQuery = normalizeSkuSearchQuery(
    stockAdjustmentSearch?.query ?? "",
  );
  const stockSkuSearchResults = useQuery(
    api.inventory.skuSearch.searchProductSkus,
    shouldLoadStockWorkspace && normalizedStockSearchQuery
      ? {
          limit: 75,
          query: stockAdjustmentSearch?.query ?? "",
          storeId: activeStore!._id,
        }
      : "skip",
  ) as ProductSkuSearchResponse | undefined;
  const stockSearchProductSkuIds = useMemo(
    () =>
      Array.from(
        new Set(
          [
            ...(stockSkuSearchResults?.results ?? []).map(
              (result) => result.productSkuId,
            ),
            stockAdjustmentSearch?.sku,
          ].filter(Boolean),
        ),
      ) as Id<"productSku">[],
    [stockAdjustmentSearch?.sku, stockSkuSearchResults?.results],
  );
  const stockSearchInventoryItems = useQuery(
    stockOpsApi.adjustments.listInventorySnapshotForProductSkus,
    shouldLoadStockWorkspace && stockSearchProductSkuIds.length > 0
      ? {
          productSkuIds: stockSearchProductSkuIds,
          storeId: activeStore!._id,
        }
      : "skip",
  ) as InventorySnapshotItem[] | undefined;
  const inventoryItemsForStockAdjustment = useMemo(
    () =>
      mergeInventorySnapshotItems(
        inventoryItems,
        Array.isArray(stockSearchInventoryItems)
          ? stockSearchInventoryItems
          : [],
      ),
    [inventoryItems, stockSearchInventoryItems],
  );
  const inventoryUnitSummary = useQuery(
    stockOpsApi.adjustments.getInventoryUnitSummary,
    shouldLoadStockWorkspace
      ? {
          storeId: activeStore!._id,
        }
      : "skip",
  ) as InventoryUnitSummary | undefined;
  const isInventorySnapshotLoadingFirstPage =
    shouldLoadStockWorkspace &&
    inventorySnapshotPage.status === "LoadingFirstPage";
  const isInventorySnapshotLoadingMore =
    shouldLoadStockWorkspace && inventorySnapshotPage.status === "LoadingMore";
  const canLoadMoreInventoryItems =
    shouldLoadStockWorkspace && inventorySnapshotPage.status === "CanLoadMore";
  const selectedCycleCountScopeKey = useMemo(() => {
    if (stockAdjustmentSearch?.mode === "manual") return undefined;

    const selectedItem =
      stockAdjustmentSearch?.sku !== undefined
        ? inventoryItemsForStockAdjustment.find(
            (item) => String(item._id) === stockAdjustmentSearch.sku,
          )
        : inventoryItemsForStockAdjustment[0];

    return selectedItem
      ? getCountScopeKeyForInventoryItem(selectedItem)
      : undefined;
  }, [
    inventoryItemsForStockAdjustment,
    stockAdjustmentSearch?.mode,
    stockAdjustmentSearch?.sku,
  ]);
  const canUseCycleCountDraft =
    canQueryProtectedData &&
    Boolean(activeStore?._id) &&
    Boolean(selectedCycleCountScopeKey);
  const activeCycleCountDraft = useQuery(
    stockOpsApi.cycleCountDrafts.getActiveCycleCountDraft,
    canUseCycleCountDraft
      ? {
          scopeKey: selectedCycleCountScopeKey!,
          storeId: activeStore!._id,
        }
      : "skip",
  ) as
    | {
        draft: Omit<CycleCountDraftState, "lines">;
        lines: CycleCountDraftState["lines"];
      }
    | null
    | undefined;
  const activeCycleCountDraftSummary = useQuery(
    stockOpsApi.cycleCountDrafts.getActiveCycleCountDraftSummary,
    shouldLoadStockWorkspace
      ? {
          storeId: activeStore!._id,
        }
      : "skip",
  ) as CycleCountDraftSummary | undefined;
  const submitStockAdjustmentBatch = useMutation(
    stockOpsApi.adjustments.submitStockAdjustmentBatch,
  );
  const decideApprovalRequest = useMutation(
    operationsApi.approvalRequests.decideApprovalRequest,
  );
  const resolveSyncedSaleInventoryReview = useMutation(
    (
      operationsApi.openWorkInventoryReviews as unknown as {
        resolveSyncedSaleInventoryReviewGroup: Parameters<typeof useMutation>[0];
      }
    ).resolveSyncedSaleInventoryReviewGroup,
  );
  const resolveRegisterSessionSyncReview = useMutation(
    api.cashControls.deposits.resolveRegisterSessionSyncReview,
  );
  const authenticateStaffCredential = useMutation(
    operationsApi.staffCredentials.authenticateStaffCredential,
  );
  const authenticateStaffCredentialForApproval = useMutation(
    operationsApi.staffCredentials.authenticateStaffCredentialForApproval,
  );
  const ensureCycleCountDraft = useMutation(
    stockOpsApi.cycleCountDrafts.ensureCycleCountDraft,
  );
  const saveCycleCountDraftLine = useMutation(
    stockOpsApi.cycleCountDrafts.saveCycleCountDraftLine,
  );
  const discardCycleCountDraft = useMutation(
    stockOpsApi.cycleCountDrafts.discardCycleCountDraft,
  );
  const refreshCycleCountDraftLineBaseline = useMutation(
    stockOpsApi.cycleCountDrafts.refreshCycleCountDraftLineBaseline,
  );
  const submitCycleCountDraft = useMutation(
    stockOpsApi.cycleCountDrafts.submitActiveCycleCountDrafts,
  );
  const reviewRegisterSessionCloseout = useMutation(
    api.cashControls.closeouts.reviewRegisterSessionCloseout,
  );
  const cycleCountDraft = useMemo<CycleCountDraftState | null>(() => {
    if (!activeCycleCountDraft?.draft) return null;

    return {
      ...activeCycleCountDraft.draft,
      lines: activeCycleCountDraft.lines,
    };
  }, [activeCycleCountDraft]);
  const activeApprovalDecisionUnlock =
    approvalDecisionUnlock && approvalDecisionUnlock.expiresAt > Date.now()
      ? approvalDecisionUnlock
      : null;

  useEffect(() => {
    if (!approvalDecisionUnlock) return;

    const remainingMs = approvalDecisionUnlock.expiresAt - Date.now();

    if (remainingMs <= 0) {
      setApprovalDecisionUnlock(null);
      return;
    }

    const timeout = window.setTimeout(() => {
      setApprovalDecisionUnlock(null);
    }, remainingMs);

    return () => window.clearTimeout(timeout);
  }, [approvalDecisionUnlock]);

  useEffect(() => {
    if (!canUseCycleCountDraft || activeCycleCountDraft !== null) return;

    void runCommand(() =>
      ensureCycleCountDraft({
        scopeKey: selectedCycleCountScopeKey!,
        storeId: activeStore!._id,
      }),
    ).then((result) => {
      if (result.kind !== "ok") {
        presentCommandToast(result);
      }
    });
  }, [
    activeCycleCountDraft,
    activeStore,
    canUseCycleCountDraft,
    ensureCycleCountDraft,
    selectedCycleCountScopeKey,
  ]);

  const handleSubmitStockBatch = async (args: SubmitStockAdjustmentArgs) => {
    setIsSubmittingStockBatch(true);

    try {
      return await runCommand(() => submitStockAdjustmentBatch(args));
    } finally {
      setIsSubmittingStockBatch(false);
    }
  };

  const buildMissingDraftResult = (message: string) =>
    ({
      kind: "user_error",
      error: {
        code: "validation_failed",
        message,
      },
    }) as NormalizedCommandResult<unknown>;

  const handleSaveCycleCountDraftLine = async (args: {
    countedQuantity: number;
    productSkuId: Id<"productSku">;
  }) => {
    if (!cycleCountDraft) {
      return buildMissingDraftResult(
        "Select a SKU before saving a count draft.",
      );
    }

    setIsSavingCycleCountDraft(true);

    try {
      return await runCommand(() =>
        saveCycleCountDraftLine({
          countedQuantity: args.countedQuantity,
          draftId: cycleCountDraft._id,
          productSkuId: args.productSkuId,
        }),
      );
    } finally {
      setIsSavingCycleCountDraft(false);
    }
  };

  const handleDiscardCycleCountDraft = async () => {
    if (!cycleCountDraft) {
      return buildMissingDraftResult(
        "Select a SKU before discarding a count draft.",
      );
    }

    setIsSavingCycleCountDraft(true);

    try {
      return await runCommand(() =>
        discardCycleCountDraft({ draftId: cycleCountDraft._id }),
      );
    } finally {
      setIsSavingCycleCountDraft(false);
    }
  };

  const handleSubmitCycleCountDraft = async (args: { notes?: string }) => {
    if (!activeStore?._id) {
      return buildMissingDraftResult(
        "Select a store before submitting a count.",
      );
    }

    setIsSubmittingStockBatch(true);

    try {
      return await runCommand(() =>
        submitCycleCountDraft({
          notes: args.notes,
          storeId: activeStore._id,
        }),
      );
    } finally {
      setIsSubmittingStockBatch(false);
    }
  };

  const handleRefreshCycleCountDraftLineBaseline = async (args: {
    productSkuId: Id<"productSku">;
  }) => {
    if (!activeStore?._id) {
      return buildMissingDraftResult("Select a store before refreshing stock.");
    }

    setIsSavingCycleCountDraft(true);

    try {
      return await runCommand(() =>
        refreshCycleCountDraftLineBaseline({
          productSkuId: args.productSkuId,
          storeId: activeStore._id,
        }),
      );
    } finally {
      setIsSavingCycleCountDraft(false);
    }
  };

  const handleDecideApprovalRequest = async (args: {
    approvalRequestId: string;
    decision: "approved" | "rejected";
    registerSessionId?: Id<"registerSession">;
    requestType?: string;
  }) => {
    if (decisioningApprovalRequestId) {
      return;
    }

    const activeUnlock =
      approvalDecisionUnlock && approvalDecisionUnlock.expiresAt > Date.now()
        ? approvalDecisionUnlock
        : null;

    if (!activeUnlock) {
      setApprovalDecisionUnlock(null);
      setIsApprovalUnlockOpen(true);
      return;
    }

    if (!activeStore?._id) {
      presentCommandToast({
        kind: "user_error",
        error: {
          code: "authentication_failed",
          message: "Select a store before resolving approval requests.",
        },
      });
      return;
    }

    if (
      (args.requestType === "register_sync_review" ||
        args.requestType === "variance_review") &&
      !args.registerSessionId
    ) {
      presentCommandToast({
        kind: "user_error",
        error: {
          code: "not_found",
          message:
            args.requestType === "variance_review"
              ? "Register session was not available for this closeout review."
              : "Register session was not available for this synced activity review.",
        },
      });
      return;
    }

    setDecisioningApprovalRequestId(args.approvalRequestId);

    try {
      const request = queue?.approvalRequests.find(
        (approvalRequest) => approvalRequest._id === args.approvalRequestId,
      );
      const approvalActionKey =
        args.requestType === "variance_review"
          ? REGISTER_VARIANCE_REVIEW_ACTION_KEY
          : args.requestType === "register_sync_review"
            ? REGISTER_SESSION_SYNC_REVIEW_APPROVAL_ACTION_KEY
            : APPROVAL_DECISION_ACTION_KEY;
      const approvalSubject =
        args.registerSessionId &&
        (args.requestType === "register_sync_review" ||
          args.requestType === "variance_review")
          ? {
              id: String(args.registerSessionId),
              label:
                request?.registerSessionSummary?.registerNumber ??
                request?.workItemTitle ??
                undefined,
              type: "register_session",
            }
          : {
              id: String(args.approvalRequestId),
              label:
                request?.workItemTitle ??
                (request
                  ? formatApprovalRequestType(request.requestType)
                  : undefined),
              type: "approval_request",
            };
      const approvalProofResult = await runCommand(
        () =>
          authenticateStaffCredentialForApproval({
            actionKey: approvalActionKey,
            pinHash: activeUnlock.pinHash,
            reason: "Resolve pending approval request.",
            requiredRole: "manager",
            storeId: activeStore._id,
            subject: approvalSubject,
            username: activeUnlock.username,
          }) as Promise<
            CommandResult<{
              approvalProofId: Id<"approvalProof">;
              approvedByStaffProfileId: Id<"staffProfile">;
              expiresAt: number;
              requestedByStaffProfileId?: Id<"staffProfile">;
            }>
          >,
      );

      if (approvalProofResult.kind !== "ok") {
        setApprovalDecisionUnlock(null);
        presentCommandToast(approvalProofResult);
        return;
      }

      let result: NormalizedApprovalCommandResult<unknown>;

      if (args.requestType === "register_sync_review") {
        const registerSessionId =
          args.registerSessionId as Id<"registerSession">;
        result = await runCommand(() =>
          resolveRegisterSessionSyncReview({
            approvalProofId: approvalProofResult.data.approvalProofId,
            decision: args.decision,
            registerSessionId,
            storeId: activeStore._id,
          }),
        );
      } else if (args.requestType === "variance_review") {
        const registerSessionId =
          args.registerSessionId as Id<"registerSession">;
        result = await runCommand(() =>
          reviewRegisterSessionCloseout({
            approvalProofId: approvalProofResult.data.approvalProofId,
            decision: args.decision,
            registerSessionId,
            storeId: activeStore._id,
          }),
        );
      } else {
        result = await runCommand(() =>
          decideApprovalRequest({
            approvalRequestId: args.approvalRequestId as Id<"approvalRequest">,
            approvalProofId: approvalProofResult.data.approvalProofId,
            decision: args.decision,
          }),
        );
      }

      if (result.kind !== "ok") {
        presentCommandToast(result);
        return;
      }

      const approvalCopy = request
        ? getApprovalRequestCopy(request.requestType)
        : null;
      const retireOnlyApprovalCopy = request
        ? getRetireOnlyApprovalRequestCopy(request.requestType)
        : null;

      toast.success(
        args.decision === "approved"
          ? (approvalCopy?.approvedToast ?? "Approval request approved")
          : (approvalCopy?.rejectedToast ??
              retireOnlyApprovalCopy?.rejectedToast ??
              "Approval request rejected"),
      );
    } finally {
      setDecisioningApprovalRequestId(null);
    }
  };

  const handleResolveSyncedSaleInventoryReview = async (
    items: QueueWorkItem[],
  ) => {
    if (resolvingSyncedSaleInventoryReviewSkuId) return;

    if (!activeStore?._id) {
      presentCommandToast({
        kind: "user_error",
        error: {
          code: "authentication_failed",
          message: "Select a store before resolving inventory review work.",
        },
      });
      return;
    }

    const productSkuId = getQueueWorkItemStockAdjustmentSkuId(items[0]);
    const logicalGroup = items[0].logicalGroup;
    if (
      !productSkuId ||
      !logicalGroup ||
      logicalGroup.completeness !== "complete" ||
      logicalGroup.resolutionAvailability !== "available"
    ) {
      return;
    }

    setResolvingSyncedSaleInventoryReviewSkuId(productSkuId);

    try {
      const result = await runCommand(() =>
        resolveSyncedSaleInventoryReview({
          expectedMemberIds: logicalGroup.memberIds,
          groupKey: logicalGroup.key,
          outcome: "completed",
          reason: "Inventory review handled from Open Work.",
          storeId: activeStore._id,
        }),
      );

      if (result.kind !== "ok") {
        if (
          result.kind === "user_error" &&
          result.error.code === "conflict" &&
          result.error.message === LOGICAL_GROUP_CHANGED_MESSAGE
        ) {
          setConflictedLogicalGroups((current) => {
            const refreshedGroup = latestQueueWorkItemsRef.current.find(
              (item) => item.logicalGroup?.key === logicalGroup.key,
            )?.logicalGroup;
            if (
              refreshedGroup?.completeness === "complete" &&
              logicalGroupObservationFingerprint(refreshedGroup) !==
                logicalGroupObservationFingerprint(logicalGroup)
            ) {
              return current;
            }

            const next = new Map(current);
            next.set(logicalGroup.key, {
              fingerprint: logicalGroupObservationFingerprint(logicalGroup),
              refreshNonce: openWorkRefreshNonce,
            });
            return next;
          });
        }
        presentCommandToast(result);
        return;
      }

      toast.success(
        items.length === 1
          ? "Inventory review marked complete"
          : `${items.length.toLocaleString()} inventory reviews marked complete`,
      );
    } finally {
      setResolvingSyncedSaleInventoryReviewSkuId(null);
    }
  };

  const handleAuthenticateApprovalUnlock = async (args: {
    pinHash: string;
    username: string;
  }) => {
    if (!activeStore?._id) {
      return {
        kind: "user_error" as const,
        error: {
          code: "authentication_failed" as const,
          message: "Select a store before unlocking approval decisions.",
        },
      };
    }

    return runCommand(() =>
      authenticateStaffCredential({
        allowedRoles: ["manager"],
        pinHash: args.pinHash,
        storeId: activeStore._id,
        username: args.username,
      }),
    );
  };

  if (isLoadingAccess) {
    return null;
  }

  if (!isAuthenticated) {
    return (
      <ProtectedAdminSignInView description="Your Athena session needs to reconnect before the operations workspace can load protected stock-ops and cash-controls data" />
    );
  }

  if (!canAccessSurface) {
    return <NoPermissionView />;
  }

  if (!activeStore) {
    return (
      <div className="container mx-auto py-8">
        <EmptyState
          description="Select a store before opening stock adjustments or approval work"
          title="No active store"
        />
      </div>
    );
  }

  return (
    <>
      <OperationsQueueViewContent
        activeWorkflow={activeWorkflow}
        approvalDecisionUnlockExpiresAt={
          activeApprovalDecisionUnlock?.expiresAt
        }
        approvalDecisionUnlockRequired
        approvalDecisionUnlocked={Boolean(activeApprovalDecisionUnlock)}
        approvalRequests={queue?.approvalRequests ?? []}
        canLoadMoreInventoryItems={canLoadMoreInventoryItems}
        conflictedLogicalGroupKeys={conflictedLogicalGroupKeys}
        cycleCountDraft={cycleCountDraft}
        cycleCountDraftSummary={activeCycleCountDraftSummary ?? null}
        hasFullAdminAccess={canAccessSurface}
        inventoryItems={inventoryItemsForStockAdjustment}
        inventoryUnitSummary={inventoryUnitSummary ?? null}
        isCycleCountDraftSaving={isSavingCycleCountDraft}
        isDecidingApprovalRequestId={decisioningApprovalRequestId}
        isLoadingMoreInventoryItems={isInventorySnapshotLoadingMore}
        isLoadingPermissions={false}
        isLoadingQueue={
          queue === undefined || isInventorySnapshotLoadingFirstPage
        }
        isLoadingStock={isInventorySnapshotLoadingFirstPage}
        isResolvingSyncedSaleInventoryReviewSkuId={
          resolvingSyncedSaleInventoryReviewSkuId
        }
        onDiscardCycleCountDraft={handleDiscardCycleCountDraft}
        onDecideApprovalRequest={handleDecideApprovalRequest}
        onLoadMoreInventoryItems={() => inventorySnapshotPage.loadMore(100)}
        onLockApprovalDecisions={() => setApprovalDecisionUnlock(null)}
        onOpenWorkSearchChange={onOpenWorkSearchChange}
        onRefreshOpenWork={() =>
          setOpenWorkRefreshNonce((current) => current + 1)
        }
        onRefreshCycleCountDraftLineBaseline={
          handleRefreshCycleCountDraftLineBaseline
        }
        onRequestApprovalDecisionUnlock={() => setIsApprovalUnlockOpen(true)}
        onResolveSyncedSaleInventoryReview={
          handleResolveSyncedSaleInventoryReview
        }
        onSaveCycleCountDraftLine={handleSaveCycleCountDraftLine}
        isSubmittingStockBatch={isSubmittingStockBatch}
        onSubmitStockBatch={handleSubmitStockBatch}
        onSubmitCycleCountDraft={handleSubmitCycleCountDraft}
        onStockAdjustmentSearchChange={onStockAdjustmentSearchChange}
        orgUrlSlug={routeParams?.orgUrlSlug}
        queueOverflow={queue?.overflow ?? null}
        showBackButton={typeof search.o === "string" && search.o.length > 0}
        storeId={activeStore._id}
        storeUrlSlug={routeParams?.storeUrlSlug}
        openWorkSearch={openWorkSearch}
        stockAdjustmentSearch={stockAdjustmentSearch}
        workItems={queue?.workItems ?? []}
        workItemSummary={queue?.workItemSummary ?? null}
      />
      <StaffAuthenticationDialog
        copy={{
          title: "Unlock approval decisions",
          description:
            "Use manager credentials once to approve or reject requests for the next few minutes.",
          submitLabel: "Unlock approvals",
        }}
        getSuccessMessage={() => "Approval decisions unlocked"}
        onAuthenticate={(args) =>
          handleAuthenticateApprovalUnlock({
            pinHash: args.pinHash,
            username: args.username,
          }) as Promise<NormalizedCommandResult<StaffAuthenticationResult>>
        }
        onAuthenticated={(_result, _mode, credentials) => {
          setApprovalDecisionUnlock({
            expiresAt: Date.now() + APPROVAL_PAGE_UNLOCK_TTL_MS,
            pinHash: credentials.pinHash,
            username: credentials.username,
          });
          setIsApprovalUnlockOpen(false);
        }}
        onDismiss={() => setIsApprovalUnlockOpen(false)}
        open={isApprovalUnlockOpen}
      />
    </>
  );
}
