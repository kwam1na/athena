import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import {
  ArrowUpRight,
  ClipboardCheck,
  Clock3,
  ExternalLink,
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
  type NormalizedCommandResult,
} from "@/lib/errors/runCommand";
import { getOrigin } from "@/lib/navigationUtils";
import type { CommandResult } from "~/shared/commandResult";
import { currencyFormatter } from "~/shared/currencyFormatter";
import { cn } from "@/lib/utils";
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

const operationsApi = api.operations;
const stockOpsApi = api.stockOps;
const ghsCurrencyFormatter = currencyFormatter("GHS");
const APPROVAL_DECISION_ACTION_KEY = "operations.approval_request.decide";
const APPROVAL_PAGE_UNLOCK_TTL_MS = 5 * 60 * 1000;

type QueueWorkItem = {
  _id: Id<"operationalWorkItem">;
  approvalState: string;
  assignedStaffName?: string | null;
  customerName?: string | null;
  priority: string;
  status: string;
  title: string;
};

type QueueApprovalRequest = {
  _id: Id<"approvalRequest">;
  metadata?: {
    amount?: number;
    adjustmentType?: string;
    largestAbsoluteDelta?: number;
    lineItems?: Array<{
      countedQuantity?: number;
      productName?: string;
      productSkuId?: Id<"productSku">;
      quantityDelta?: number;
      sku?: string;
      systemQuantity?: number;
    }>;
    netQuantityDelta?: number;
    paymentMethod?: string;
    previousPaymentMethod?: string;
    reasonCode?: string;
    transactionId?: Id<"posTransaction">;
    countedCash?: number;
    expectedCash?: number;
    variance?: number;
  } | null;
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

function getDefaultWorkflow(args: {
  approvalRequests: QueueApprovalRequest[];
  workItems: QueueWorkItem[];
}): OperationsWorkflow {
  if (args.approvalRequests.length > 0) return "approvals";
  if (args.workItems.length > 0) return "queue";
  return "stock";
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

  return null;
}

function formatApprovalRequestType(requestType: string) {
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
  isDecidingApprovalRequestId?: Id<"approvalRequest"> | null;
  isLoadingPermissions: boolean;
  isLoadingQueue: boolean;
  isSubmittingStockBatch: boolean;
  onDecideApprovalRequest: (args: {
    approvalRequestId: Id<"approvalRequest">;
    decision: "approved" | "rejected";
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
            storeId={storeId}
          />
        ) : null}
        {resolvedWorkflow === "queue" ? (
          <PageWorkspace>
            <PageLevelHeader
              eyebrow="Store Ops"
              title="Open work"
              description="Service intake and stock review work that still needs progress or completion."
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
                        <article
                          className="overflow-hidden rounded-lg border border-border bg-background"
                          key={item._id}
                        >
                          <div className="flex flex-col gap-layout-sm px-layout-md py-layout-md md:flex-row md:items-start md:justify-between">
                            <div className="min-w-0">
                              <p className="font-medium text-foreground">
                                {item.title}
                              </p>
                              <p className="mt-1 text-sm text-muted-foreground">
                                {[item.customerName, item.assignedStaffName]
                                  .filter(Boolean)
                                  .join(" · ")}
                              </p>
                            </div>
                            <div className="flex flex-wrap gap-2 md:justify-end">
                              <Badge
                                className="border-border bg-surface text-muted-foreground shadow-sm"
                                variant="outline"
                              >
                                {item.status}
                              </Badge>
                              <Badge
                                className="border-warning/30 bg-warning/10 text-warning-foreground shadow-sm"
                                variant="outline"
                              >
                                {item.priority}
                              </Badge>
                            </div>
                          </div>
                        </article>
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
                        const varianceReviewSummary =
                          getVarianceReviewSummary(request);

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
                                          <ExternalLink aria-hidden="true" />
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
                                      {paymentCorrectionSummary.transaction
                                        ? `#${paymentCorrectionSummary.transaction.transactionNumber}`
                                        : "Transaction unavailable"}
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

                            {approvalCopy ? (
                              <div className="border-t border-border/70 bg-surface px-layout-md py-layout-md">
                                <div className="flex flex-col gap-layout-md lg:flex-row lg:items-center lg:justify-between">
                                  <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
                                    {approvalCopy.description}
                                  </p>
                                  <div className="flex shrink-0 flex-wrap gap-2">
                                    <LoadingButton
                                      disabled={Boolean(
                                        (isDecidingApprovalRequestId &&
                                          isDecidingApprovalRequestId !==
                                            request._id) ||
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
  const {
    activeStore,
    canQueryProtectedData,
    hasFullAdminAccess,
    isAuthenticated,
    isLoadingAccess,
  } = useProtectedAdminPageState();
  const [isSubmittingStockBatch, setIsSubmittingStockBatch] = useState(false);
  const [isSavingCycleCountDraft, setIsSavingCycleCountDraft] = useState(false);
  const [decisioningApprovalRequestId, setDecisioningApprovalRequestId] =
    useState<Id<"approvalRequest"> | null>(null);
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
  const selectedCycleCountScopeKey =
    stockAdjustmentSearch?.mode === "manual"
      ? undefined
      : stockAdjustmentSearch?.scope?.split(",")[0]?.trim();
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
        "Select a count scope before saving a draft.",
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
        "Select a count scope before discarding a draft.",
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
    approvalRequestId: Id<"approvalRequest">;
    decision: "approved" | "rejected";
  }) => {
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

      const result = await runCommand(() =>
        decideApprovalRequest({
          approvalRequestId: args.approvalRequestId,
          approvalProofId: approvalProofResult.data.approvalProofId,
          decision: args.decision,
        }),
      );

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

  if (!hasFullAdminAccess) {
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
        hasFullAdminAccess={hasFullAdminAccess}
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
