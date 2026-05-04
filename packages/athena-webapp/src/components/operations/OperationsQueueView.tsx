import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { FadeIn } from "../common/FadeIn";
import { EmptyState } from "../states/empty/empty-state";
import { NoPermissionView } from "../states/no-permission/NoPermissionView";
import { ProtectedAdminSignInView } from "../states/signed-out/ProtectedAdminSignInView";
import { useProtectedAdminPageState } from "@/hooks/useProtectedAdminPageState";
import { api } from "~/convex/_generated/api";
import type { Id } from "~/convex/_generated/dataModel";
import { presentCommandToast } from "@/lib/errors/presentCommandToast";
import {
  runCommand,
  type NormalizedCommandResult,
} from "@/lib/errors/runCommand";
import {
  StockAdjustmentWorkspaceContent,
} from "./StockAdjustmentWorkspace";
import type {
  CycleCountDraftState,
  InventorySnapshotItem,
  StockAdjustmentSearchPatch,
  StockAdjustmentSearchState,
  SubmitStockAdjustmentArgs,
} from "./StockAdjustmentWorkspace";
import { Button } from "../ui/button";
import { LoadingButton } from "../ui/loading-button";
import { Skeleton } from "../ui/skeleton";

const operationsApi = api.operations;
const stockOpsApi = api.stockOps;

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
  requestedByStaffName?: string | null;
  requestType: string;
  status: string;
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

  return null;
}

function OperationsWorkspaceSkeleton() {
  return (
    <FadeIn className="container mx-auto min-h-0 flex-1 overflow-y-auto overscroll-contain py-layout-xl scrollbar-hide">
      <section
        aria-label="Loading operations workspace"
        className="grid gap-layout-xl xl:grid-cols-[minmax(0,1fr)_320px]"
      >
        <section className="min-w-0 space-y-layout-2xl">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-2xl space-y-4">
              <Skeleton className="h-3 w-20" />
              <div className="space-y-2">
                <Skeleton className="h-8 w-80 max-w-full" />
                <Skeleton className="h-4 w-[38rem] max-w-full" />
              </div>
            </div>
            <Skeleton className="h-10 w-64" />
          </div>

          <div className="rounded-md border">
            <div className="grid grid-cols-[minmax(180px,1fr)_120px_120px_180px_80px] gap-4 border-b px-4 py-4">
              <Skeleton className="h-3 w-12" />
              <Skeleton className="ml-auto h-3 w-16" />
              <Skeleton className="ml-auto h-3 w-20" />
              <Skeleton className="ml-auto h-3 w-16" />
              <Skeleton className="ml-auto h-3 w-14" />
            </div>
            {Array.from({ length: 8 }).map((_, index) => (
              <div
                className="grid grid-cols-[minmax(180px,1fr)_120px_120px_180px_80px] items-center gap-4 border-b px-4 py-5 last:border-b-0"
                key={index}
              >
                <div className="space-y-2">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3 w-24" />
                </div>
                <Skeleton className="ml-auto h-4 w-8" />
                <Skeleton className="ml-auto h-4 w-8" />
                <Skeleton className="ml-auto h-10 w-36" />
                <Skeleton className="ml-auto h-4 w-6" />
              </div>
            ))}
          </div>
        </section>

        <aside className="space-y-layout-md">
          <section className="rounded-lg border border-border bg-surface-raised p-layout-md shadow-surface">
            <Skeleton className="h-3 w-28" />
            <div className="mt-layout-lg grid grid-cols-2 gap-layout-md">
              <div className="space-y-2">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-8 w-12" />
              </div>
              <div className="space-y-2">
                <Skeleton className="h-3 w-16" />
                <Skeleton className="h-8 w-12" />
              </div>
            </div>
            <div className="mt-layout-md space-y-2 border-t pt-layout-md">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-8 w-24" />
            </div>
            <Skeleton className="mt-layout-md h-16 w-full rounded-md" />
          </section>

          <section className="rounded-lg border border-border bg-surface-raised p-layout-md shadow-surface">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="mt-layout-md aspect-square w-full rounded-md" />
            <div className="mt-layout-md space-y-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-24" />
            </div>
            <Skeleton className="mt-layout-md h-10 w-full" />
            <Skeleton className="mt-layout-md h-24 w-full" />
            <Skeleton className="mt-layout-md h-10 w-full" />
          </section>
        </aside>
      </section>
    </FadeIn>
  );
}

type OperationsQueueViewContentProps = {
  activeWorkflow?: OperationsWorkflow;
  approvalRequests: QueueApprovalRequest[];
  cycleCountDraft?: CycleCountDraftState | null;
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
  onDiscardCycleCountDraft?: () => Promise<NormalizedCommandResult<unknown>>;
  onSaveCycleCountDraftLine?: (args: {
    countedQuantity: number;
    productSkuId: Id<"productSku">;
  }) => Promise<NormalizedCommandResult<unknown>>;
  onSubmitStockBatch: (
    args: SubmitStockAdjustmentArgs,
  ) => Promise<NormalizedCommandResult<unknown>>;
  onSubmitCycleCountDraft?: (
    args: { notes?: string },
  ) => Promise<NormalizedCommandResult<unknown>>;
  onStockAdjustmentSearchChange?: (patch: StockAdjustmentSearchPatch) => void;
  storeId?: Id<"store">;
  stockAdjustmentSearch?: StockAdjustmentSearchState;
  workItems: QueueWorkItem[];
};

export function OperationsQueueViewContent({
  activeWorkflow,
  approvalRequests,
  cycleCountDraft,
  hasFullAdminAccess,
  inventoryItems,
  isCycleCountDraftSaving,
  isDecidingApprovalRequestId,
  isLoadingPermissions,
  isLoadingQueue,
  isSubmittingStockBatch,
  onDecideApprovalRequest,
  onDiscardCycleCountDraft,
  onSaveCycleCountDraftLine,
  onSubmitStockBatch,
  onSubmitCycleCountDraft,
  onStockAdjustmentSearchChange,
  storeId,
  stockAdjustmentSearch,
  workItems,
}: OperationsQueueViewContentProps) {
  const resolvedWorkflow =
    activeWorkflow ?? getDefaultWorkflow({ approvalRequests, workItems });

  if (isLoadingPermissions) {
    return <OperationsWorkspaceSkeleton />;
  }

  if (!hasFullAdminAccess) {
    return <NoPermissionView />;
  }

  if (isLoadingQueue) {
    return <OperationsWorkspaceSkeleton />;
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
      <section className="min-w-0">
        {resolvedWorkflow === "stock" ? (
          <StockAdjustmentWorkspaceContent
            cycleCountDraft={cycleCountDraft}
            inventoryItems={inventoryItems}
            isCycleCountDraftSaving={isCycleCountDraftSaving}
            isSubmitting={isSubmittingStockBatch}
            onDiscardCycleCountDraft={onDiscardCycleCountDraft}
            onSearchStateChange={onStockAdjustmentSearchChange}
            onSaveCycleCountDraftLine={onSaveCycleCountDraftLine}
            onSubmitBatch={onSubmitStockBatch}
            onSubmitCycleCountDraft={onSubmitCycleCountDraft}
            searchState={stockAdjustmentSearch}
            storeId={storeId}
          />
        ) : null}
        {resolvedWorkflow === "queue" ? (
          <section className="space-y-layout-md rounded-lg border border-border bg-surface-raised p-layout-md shadow-surface">
            <div>
              <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                Queue
              </p>
              <h3 className="mt-1 text-base font-medium text-foreground">
                Open work items
              </h3>
              <p className="text-sm text-muted-foreground">
                Service intake and stock review work that still needs progress
                or completion.
              </p>
            </div>
            {workItems.length === 0 ? (
              <EmptyState
                description="New service intakes and approval-driven stock reviews will appear here"
                title="No open work items"
              />
            ) : (
              workItems.map((item) => (
                <article
                  className="rounded-lg border border-border bg-background p-layout-sm"
                  key={item._id}
                >
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="font-medium text-foreground">
                        {item.title}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {[item.customerName, item.assignedStaffName]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    </div>
                    <div className="text-right text-xs text-muted-foreground">
                      <p>{item.status}</p>
                      <p>{item.priority}</p>
                    </div>
                  </div>
                </article>
              ))
            )}
          </section>
        ) : null}
        {resolvedWorkflow === "approvals" ? (
          <section className="space-y-layout-md rounded-lg border border-border bg-surface-raised p-layout-md shadow-surface">
            <div>
              <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                Approvals
              </p>
              <h3 className="mt-1 text-base font-medium text-foreground">
                Pending requests
              </h3>
              <p className="text-sm text-muted-foreground">
                Approval requests raised by the operations workspace.
              </p>
            </div>
            {approvalRequests.length === 0 ? (
              <EmptyState
                description="High-variance deposits and stock reviews will surface here"
                title="No pending approvals"
              />
            ) : (
              approvalRequests.map((request) => {
                const approvalCopy = getApprovalRequestCopy(
                  request.requestType,
                );

                return (
                  <article
                    className="rounded-lg border border-border bg-background p-layout-sm"
                    key={request._id}
                  >
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <p className="font-medium text-foreground">
                          {request.workItemTitle ?? request.requestType}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {request.requestedByStaffName ??
                            "Requested by admin flow"}
                        </p>
                      </div>
                      <p className="text-xs uppercase text-muted-foreground">
                        {request.status}
                      </p>
                    </div>
                    {approvalCopy ? (
                      <div className="mt-layout-sm space-y-layout-sm rounded-md border border-warning/30 bg-warning/10 px-layout-sm py-layout-sm">
                        <p className="text-sm text-foreground">
                          {approvalCopy.description}
                        </p>
                        <div className="flex flex-wrap gap-2">
                          <LoadingButton
                            disabled={Boolean(
                              isDecidingApprovalRequestId &&
                              isDecidingApprovalRequestId !== request._id,
                            )}
                            isLoading={
                              isDecidingApprovalRequestId === request._id
                            }
                            onClick={() =>
                              onDecideApprovalRequest({
                                approvalRequestId: request._id,
                                decision: "approved",
                              })
                            }
                            size="sm"
                          >
                            {approvalCopy.approveLabel}
                          </LoadingButton>
                          <Button
                            disabled={Boolean(isDecidingApprovalRequestId)}
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
                    ) : null}
                  </article>
                );
              })
            )}
          </section>
        ) : null}
      </section>
    </FadeIn>
  );
}

type OperationsQueueViewProps = {
  activeWorkflow?: OperationsWorkflow;
  onStockAdjustmentSearchChange?: (patch: StockAdjustmentSearchPatch) => void;
  stockAdjustmentSearch?: StockAdjustmentSearchState;
};

export function OperationsQueueView({
  activeWorkflow,
  onStockAdjustmentSearchChange,
  stockAdjustmentSearch,
}: OperationsQueueViewProps = {}) {
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
  const submitStockAdjustmentBatch = useMutation(
    stockOpsApi.adjustments.submitStockAdjustmentBatch,
  );
  const decideApprovalRequest = useMutation(
    operationsApi.approvalRequests.decideApprovalRequest,
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
  const submitCycleCountDraft = useMutation(
    stockOpsApi.cycleCountDrafts.submitCycleCountDraft,
  );
  const cycleCountDraft = useMemo<CycleCountDraftState | null>(() => {
    if (!activeCycleCountDraft?.draft) return null;

    return {
      ...activeCycleCountDraft.draft,
      lines: activeCycleCountDraft.lines,
    };
  }, [activeCycleCountDraft]);

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
      return buildMissingDraftResult("Select a count scope before saving a draft.");
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
      return buildMissingDraftResult("Select a count scope before discarding a draft.");
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
    if (!cycleCountDraft) {
      return buildMissingDraftResult("Select a count scope before submitting a count.");
    }

    setIsSubmittingStockBatch(true);

    try {
      return await runCommand(() =>
        submitCycleCountDraft({
          draftId: cycleCountDraft._id,
          notes: args.notes,
        }),
      );
    } finally {
      setIsSubmittingStockBatch(false);
    }
  };

  const handleDecideApprovalRequest = async (args: {
    approvalRequestId: Id<"approvalRequest">;
    decision: "approved" | "rejected";
  }) => {
    setDecisioningApprovalRequestId(args.approvalRequestId);

    try {
      const result = await runCommand(() =>
        decideApprovalRequest({
          approvalRequestId: args.approvalRequestId,
          decision: args.decision,
        }),
      );

      if (result.kind !== "ok") {
        presentCommandToast(result);
        return;
      }

      const request = queue?.approvalRequests.find(
        (approvalRequest) => approvalRequest._id === args.approvalRequestId,
      );
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

  if (isLoadingAccess) {
    return <OperationsWorkspaceSkeleton />;
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
    <OperationsQueueViewContent
      activeWorkflow={activeWorkflow}
      approvalRequests={queue?.approvalRequests ?? []}
      cycleCountDraft={cycleCountDraft}
      hasFullAdminAccess={hasFullAdminAccess}
      inventoryItems={inventoryItems ?? []}
      isCycleCountDraftSaving={isSavingCycleCountDraft}
      isDecidingApprovalRequestId={decisioningApprovalRequestId}
      isLoadingPermissions={false}
      isLoadingQueue={queue === undefined || inventoryItems === undefined}
      onDiscardCycleCountDraft={handleDiscardCycleCountDraft}
      onDecideApprovalRequest={handleDecideApprovalRequest}
      onSaveCycleCountDraftLine={handleSaveCycleCountDraftLine}
      isSubmittingStockBatch={isSubmittingStockBatch}
      onSubmitStockBatch={handleSubmitStockBatch}
      onSubmitCycleCountDraft={handleSubmitCycleCountDraft}
      onStockAdjustmentSearchChange={onStockAdjustmentSearchChange}
      storeId={activeStore._id}
      stockAdjustmentSearch={stockAdjustmentSearch}
      workItems={queue?.workItems ?? []}
    />
  );
}
