import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearch } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import {
  ArrowUpRight,
  ClipboardCheck,
  Clock3,
  Lock,
  LockOpen,
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
import type { CommandResult } from "~/shared/commandResult";
import { currencyFormatter } from "~/shared/currencyFormatter";
import { capitalizeWords, cn, getRelativeTime } from "@/lib/utils";
import { StockAdjustmentWorkspaceContent } from "./StockAdjustmentWorkspace";
import type {
  CycleCountDraftSummary,
  CycleCountDraftState,
  InventorySnapshotItem,
  StockAdjustmentSearchPatch,
  StockAdjustmentSearchState,
  SubmitStockAdjustmentArgs,
} from "./StockAdjustmentWorkspace";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { LoadingButton } from "../ui/loading-button";
import {
  OperationReviewItemCard,
  type OperationReviewMetadataEntry,
} from "./OperationReviewItemCard";

const operationsApi = api.operations;
const stockOpsApi = api.stockOps;
const ghsCurrencyFormatter = currencyFormatter("GHS");
const APPROVAL_DECISION_ACTION_KEY = "operations.approval_request.decide";
const APPROVAL_PAGE_UNLOCK_TTL_MS = 5 * 60 * 1000;
const UNCATEGORIZED_COUNT_SCOPE_KEY = "__uncategorized";

type QueueWorkItem = {
  _id: Id<"operationalWorkItem">;
  approvalState: string;
  assignedStaffName?: string | null;
  createdAt: number;
  customerName?: string | null;
  dueAt?: number | null;
  priority: string;
  status: string;
  title: string;
  type: string;
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

function formatQueueWorkItemValue(value: string) {
  return capitalizeWords(value.replace(/_/g, " "));
}

function QueueWorkItemCard({ item }: { item: QueueWorkItem }) {
  const collapsedMetadataEntries: OperationReviewMetadataEntry[] = [
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
  const metadataEntries: OperationReviewMetadataEntry[] = [
    ...collapsedMetadataEntries,
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

  return (
    <OperationReviewItemCard
      actionSlot={
        <>
          <Badge
            className="border-border bg-surface text-muted-foreground shadow-sm"
            variant="outline"
          >
            {formatQueueWorkItemValue(item.status)}
          </Badge>
          <Badge
            className="border-warning/30 bg-warning/10 text-warning-foreground shadow-sm"
            variant="outline"
          >
            {formatQueueWorkItemValue(item.priority)}
          </Badge>
        </>
      }
      collapsedMetadataEntries={collapsedMetadataEntries}
      contextLabel={formatQueueWorkItemValue(item.type)}
      description={null}
      itemId={item._id}
      metadataEntries={metadataEntries}
      title={item.title}
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

  if (
    requestType === "pos_item_adjustment" ||
    requestType === "pos_item_adjustment_review"
  ) {
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
    lineItems: request.metadata?.lineItems?.filter(hasItemAdjustmentChange) ?? [],
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

type OperationsQueueViewContentProps = {
  activeWorkflow?: OperationsWorkflow;
  approvalDecisionUnlockExpiresAt?: number;
  approvalDecisionUnlockRequired?: boolean;
  approvalDecisionUnlocked?: boolean;
  approvalRequests: QueueApprovalRequest[];
  cycleCountDraft?: CycleCountDraftState | null;
  cycleCountDraftSummary?: CycleCountDraftSummary | null;
  hasFullAdminAccess: boolean;
  inventoryItems: InventorySnapshotItem[];
  isCycleCountDraftSaving?: boolean;
  isDecidingApprovalRequestId?: string | null;
  isLoadingPermissions: boolean;
  isLoadingQueue: boolean;
  isSubmittingStockBatch: boolean;
  onDecideApprovalRequest: (args: {
    approvalRequestId: string;
    decision: "approved" | "rejected";
    registerSessionId?: Id<"registerSession">;
    requestType?: string;
  }) => Promise<void>;
  onLockApprovalDecisions?: () => void;
  onRequestApprovalDecisionUnlock?: () => void;
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
  showBackButton?: boolean;
  storeId?: Id<"store">;
  storeUrlSlug?: string;
  stockAdjustmentSearch?: StockAdjustmentSearchState;
  workItems: QueueWorkItem[];
};

export function OperationsQueueViewContent({
  activeWorkflow,
  approvalDecisionUnlockExpiresAt,
  approvalDecisionUnlockRequired = false,
  approvalDecisionUnlocked = true,
  approvalRequests,
  cycleCountDraft,
  cycleCountDraftSummary,
  hasFullAdminAccess,
  inventoryItems,
  isCycleCountDraftSaving,
  isDecidingApprovalRequestId,
  isLoadingPermissions,
  isLoadingQueue,
  isSubmittingStockBatch,
  onDecideApprovalRequest,
  onDiscardCycleCountDraft,
  onLockApprovalDecisions,
  onRequestApprovalDecisionUnlock,
  onRefreshCycleCountDraftLineBaseline,
  onSaveCycleCountDraftLine,
  onSubmitStockBatch,
  onSubmitCycleCountDraft,
  onStockAdjustmentSearchChange,
  orgUrlSlug,
  showBackButton = false,
  storeId,
  storeUrlSlug,
  stockAdjustmentSearch,
  workItems,
}: OperationsQueueViewContentProps) {
  const resolvedWorkflow =
    activeWorkflow ?? getDefaultWorkflow({ approvalRequests, workItems });

  if (isLoadingPermissions) {
    return null;
  }

  if (!hasFullAdminAccess) {
    return <NoPermissionView />;
  }

  if (isLoadingQueue) {
    return null;
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
            cycleCountDraft={cycleCountDraft}
            cycleCountDraftSummary={cycleCountDraftSummary}
            inventoryItems={inventoryItems}
            isCycleCountDraftSaving={isCycleCountDraftSaving}
            isSubmitting={isSubmittingStockBatch}
            onDiscardCycleCountDraft={onDiscardCycleCountDraft}
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
              eyebrow="Store Ops"
              title="Open work"
              description="Service intake and stock review work that still needs progress or completion."
              showBackButton
            />

            {workItems.length === 0 ? (
              <div className="flex min-h-[34rem] items-center justify-center">
                <div className="max-w-md text-center">
                  <p className="font-display text-2xl font-medium tracking-tight text-foreground">
                    No open work items
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
                  <div className="rounded-lg border border-border bg-surface-raised p-layout-md shadow-surface">
                    <div className="flex items-start gap-layout-sm">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                        <ClipboardCheck className="h-4 w-4" />
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">
                          Waiting for progress
                        </p>
                        <p className="mt-1 font-numeric text-3xl font-semibold tabular-nums text-foreground">
                          {workItems.length}
                        </p>
                      </div>
                    </div>
                  </div>
                </PageWorkspaceRail>

                <PageWorkspaceMain
                  as="div"
                  className="space-y-0 rounded-lg border border-border bg-surface-raised shadow-surface"
                >
                  <div className="border-b border-border px-layout-md py-layout-md">
                    <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                      Work queue
                    </p>
                    <h2 className="mt-1 text-lg font-medium text-foreground">
                      Open items
                    </h2>
                  </div>

                  <div className="p-layout-md">
                    <div className="space-y-layout-2xl">
                      {workItems.map((item) => (
                        <QueueWorkItemCard item={item} key={item._id} />
                      ))}
                    </div>
                  </div>
                </PageWorkspaceMain>
              </PageWorkspaceGrid>
            )}
          </PageWorkspace>
        ) : null}
        {resolvedWorkflow === "approvals" ? (
          <PageWorkspace>
            <PageLevelHeader
              eyebrow="Store Ops"
              title="Pending approvals"
              description="Review manager approval requests before queued stock and payment changes are applied."
              showBackButton={showBackButton}
            />

            {approvalRequests.length === 0 ? (
              <div className="flex min-h-[34rem] items-center justify-center">
                <div className="max-w-md text-center">
                  <p className="font-display text-2xl font-medium tracking-tight text-foreground">
                    No pending approvals
                  </p>
                  <p className="mt-layout-sm text-sm leading-6 text-muted-foreground">
                    High-variance deposits and stock reviews will surface here.
                  </p>
                </div>
              </div>
            ) : (
              <PageWorkspaceGrid className="xl:grid-cols-[minmax(15rem,0.32fr)_minmax(0,1fr)]">
                <PageWorkspaceRail className="gap-layout-md">
                  <div className="rounded-lg border border-border bg-surface-raised p-layout-md shadow-surface">
                    <div className="flex items-start gap-layout-sm">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-warning/15 text-warning-foreground">
                        <Clock3 className="h-4 w-4" />
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">
                          Waiting for review
                        </p>
                        <p className="mt-1 font-numeric text-3xl font-semibold tabular-nums text-foreground">
                          {approvalRequests.length}
                        </p>
                      </div>
                    </div>
                  </div>

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
                        const requestLabel =
                          request.workItemTitle ??
                          formatApprovalRequestType(request.requestType);
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
                                          <span className="font-numeric font-medium tabular-nums text-foreground">
                                            {lineItem.countedQuantity ?? "-"}
                                          </span>{" "}
                                          counted against{" "}
                                          <span className="font-numeric font-medium tabular-nums text-foreground">
                                            {lineItem.systemQuantity ?? "-"}
                                          </span>{" "}
                                          on hand
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
                                      <Button asChild size="sm" variant="utility">
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
                                      <Button asChild size="sm" variant="utility">
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
                                          "register_sync_review"
                                            ? {
                                                registerSessionId:
                                                  request.registerSessionSummary
                                                    ?.registerSessionId,
                                                requestType: request.requestType,
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
                                          "register_sync_review"
                                            ? {
                                                registerSessionId:
                                                  request.registerSessionSummary
                                                    ?.registerSessionId,
                                                requestType: request.requestType,
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
  onStockAdjustmentSearchChange?: (patch: StockAdjustmentSearchPatch) => void;
  stockAdjustmentSearch?: StockAdjustmentSearchState;
};

type ApprovalDecisionUnlock = {
  expiresAt: number;
  pinHash: string;
  username: string;
};

export function OperationsQueueView({
  activeWorkflow,
  onStockAdjustmentSearchChange,
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
  const [isApprovalUnlockOpen, setIsApprovalUnlockOpen] = useState(false);
  const [approvalDecisionUnlock, setApprovalDecisionUnlock] =
    useState<ApprovalDecisionUnlock | null>(null);

  const queue = useQuery(
    operationsApi.operationalWorkItems.getQueueSnapshot,
    canQueryProtectedData ? { storeId: activeStore!._id } : "skip",
  ) as
    | {
        approvalRequests: QueueApprovalRequest[];
        workItems: QueueWorkItem[];
      }
    | undefined;
  const inventoryItems = useQuery(
    stockOpsApi.adjustments.listInventorySnapshot,
    canQueryProtectedData ? { storeId: activeStore!._id } : "skip",
  ) as InventorySnapshotItem[] | undefined;
  const selectedCycleCountScopeKey = useMemo(() => {
    if (stockAdjustmentSearch?.mode === "manual") return undefined;
    if (!inventoryItems) return undefined;

    const selectedItem =
      stockAdjustmentSearch?.sku !== undefined
        ? inventoryItems.find(
            (item) => String(item._id) === stockAdjustmentSearch.sku,
          )
        : inventoryItems[0];

    return selectedItem
      ? getCountScopeKeyForInventoryItem(selectedItem)
      : undefined;
  }, [inventoryItems, stockAdjustmentSearch?.mode, stockAdjustmentSearch?.sku]);
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
    canQueryProtectedData && activeStore?._id
      ? {
          storeId: activeStore._id,
        }
      : "skip",
  ) as CycleCountDraftSummary | undefined;
  const submitStockAdjustmentBatch = useMutation(
    stockOpsApi.adjustments.submitStockAdjustmentBatch,
  );
  const decideApprovalRequest = useMutation(
    operationsApi.approvalRequests.decideApprovalRequest,
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

    setDecisioningApprovalRequestId(args.approvalRequestId);

    try {
      const request = queue?.approvalRequests.find(
        (approvalRequest) => approvalRequest._id === args.approvalRequestId,
      );
      const approvalProofResult = await runCommand(
        () =>
          authenticateStaffCredentialForApproval({
            actionKey: APPROVAL_DECISION_ACTION_KEY,
            pinHash: activeUnlock.pinHash,
            reason: "Resolve pending approval request.",
            requiredRole: "manager",
            storeId: activeStore._id,
            subject: {
              id: String(args.approvalRequestId),
              label:
                request?.workItemTitle ??
                (request
                  ? formatApprovalRequestType(request.requestType)
                  : undefined),
              type: "approval_request",
            },
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
        if (!args.registerSessionId) {
          result = {
            kind: "user_error",
            error: {
              code: "not_found",
              message:
                "Register session was not available for this synced activity review.",
            },
          };
        } else {
          const registerSessionId = args.registerSessionId;
          result = await runCommand(() =>
            resolveRegisterSessionSyncReview({
              actorStaffProfileId:
                approvalProofResult.data.approvedByStaffProfileId,
              decision: args.decision,
              registerSessionId,
              storeId: activeStore._id,
            }),
          );
        }
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

      toast.success(
        args.decision === "approved"
          ? (approvalCopy?.approvedToast ?? "Approval request approved")
          : (approvalCopy?.rejectedToast ?? "Approval request rejected"),
      );
    } finally {
      setDecisioningApprovalRequestId(null);
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
        cycleCountDraft={cycleCountDraft}
        cycleCountDraftSummary={activeCycleCountDraftSummary ?? null}
        hasFullAdminAccess={canAccessSurface}
        inventoryItems={inventoryItems ?? []}
        isCycleCountDraftSaving={isSavingCycleCountDraft}
        isDecidingApprovalRequestId={decisioningApprovalRequestId}
        isLoadingPermissions={false}
        isLoadingQueue={queue === undefined || inventoryItems === undefined}
        onDiscardCycleCountDraft={handleDiscardCycleCountDraft}
        onDecideApprovalRequest={handleDecideApprovalRequest}
        onLockApprovalDecisions={() => setApprovalDecisionUnlock(null)}
        onRefreshCycleCountDraftLineBaseline={
          handleRefreshCycleCountDraftLineBaseline
        }
        onRequestApprovalDecisionUnlock={() => setIsApprovalUnlockOpen(true)}
        onSaveCycleCountDraftLine={handleSaveCycleCountDraftLine}
        isSubmittingStockBatch={isSubmittingStockBatch}
        onSubmitStockBatch={handleSubmitStockBatch}
        onSubmitCycleCountDraft={handleSubmitCycleCountDraft}
        onStockAdjustmentSearchChange={onStockAdjustmentSearchChange}
        orgUrlSlug={routeParams?.orgUrlSlug}
        showBackButton={typeof search.o === "string" && search.o.length > 0}
        storeId={activeStore._id}
        storeUrlSlug={routeParams?.storeUrlSlug}
        stockAdjustmentSearch={stockAdjustmentSearch}
        workItems={queue?.workItems ?? []}
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
