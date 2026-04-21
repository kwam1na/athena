import type { ReactNode } from "react";
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import View from "../View";
import { FadeIn } from "../common/FadeIn";
import { RegisterCloseoutView } from "../cash-controls/RegisterCloseoutView";
import { EmptyState } from "../states/empty/empty-state";
import { NoPermissionView } from "../states/no-permission/NoPermissionView";
import { useAuth } from "@/hooks/useAuth";
import useGetActiveStore from "@/hooks/useGetActiveStore";
import { usePermissions } from "@/hooks/usePermissions";
import { api } from "~/convex/_generated/api";
import type { Id } from "~/convex/_generated/dataModel";
import {
  InventorySnapshotItem,
  StockAdjustmentWorkspaceContent,
  SubmitStockAdjustmentArgs,
} from "./StockAdjustmentWorkspace";
import { Button } from "../ui/button";
import { LoadingButton } from "../ui/loading-button";

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

type OperationsQueueViewContentProps = {
  approvalRequests: QueueApprovalRequest[];
  hasFullAdminAccess: boolean;
  inventoryItems: InventorySnapshotItem[];
  isDecidingApprovalRequestId?: Id<"approvalRequest"> | null;
  isLoadingPermissions: boolean;
  isLoadingQueue: boolean;
  isSubmittingStockBatch: boolean;
  onDecideApprovalRequest: (args: {
    approvalRequestId: Id<"approvalRequest">;
    decision: "approved" | "rejected";
  }) => Promise<void>;
  onSubmitStockBatch: (args: SubmitStockAdjustmentArgs) => Promise<void>;
  registerCloseoutSection?: ReactNode;
  storeId?: Id<"store">;
  userId?: Id<"athenaUser">;
  workItems: QueueWorkItem[];
};

export function OperationsQueueViewContent({
  approvalRequests,
  hasFullAdminAccess,
  inventoryItems,
  isDecidingApprovalRequestId,
  isLoadingPermissions,
  isLoadingQueue,
  isSubmittingStockBatch,
  onDecideApprovalRequest,
  onSubmitStockBatch,
  registerCloseoutSection,
  storeId,
  userId,
  workItems,
}: OperationsQueueViewContentProps) {
  if (isLoadingPermissions) {
    return (
      <View>
        <div className="container mx-auto py-10 text-sm text-muted-foreground">
          Loading operations queue...
        </div>
      </View>
    );
  }

  if (!hasFullAdminAccess) {
    return <NoPermissionView />;
  }

  if (isLoadingQueue) {
    return (
      <View>
        <div className="container mx-auto py-10 text-sm text-muted-foreground">
          Loading operations workspace...
        </div>
      </View>
    );
  }

  if (!storeId) {
    return (
      <View>
        <div className="container mx-auto py-8">
          <EmptyState
            description="Select a store before opening stock adjustments or approval work."
            title="No active store"
          />
        </div>
      </View>
    );
  }

  return (
    <View
      hideBorder
      hideHeaderBottomBorder
      header={
        <div className="container mx-auto flex h-[40px] items-center">
          <p className="text-xl font-medium">Operations workspace</p>
        </div>
      }
    >
      <FadeIn className="container mx-auto grid gap-6 py-8 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.85fr)]">
        <StockAdjustmentWorkspaceContent
          inventoryItems={inventoryItems}
          isSubmitting={isSubmittingStockBatch}
          onSubmitBatch={onSubmitStockBatch}
          storeId={storeId}
          userId={userId}
        />

        <div className="space-y-6">
          <section className="space-y-3 rounded-2xl border border-border/80 bg-background p-4">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                Queue
              </p>
              <h3 className="mt-1 text-base font-medium">Open work items</h3>
              <p className="text-sm text-muted-foreground">
                Service intake and stock review work that still needs progress or
                completion.
              </p>
            </div>
            {workItems.length === 0 ? (
              <EmptyState
                description="New service intakes and approval-driven stock reviews will appear here."
                title="No open work items"
              />
            ) : (
              workItems.map((item) => (
                <article className="rounded-xl border border-border/80 p-3" key={item._id}>
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="font-medium">{item.title}</p>
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

          <section className="space-y-3 rounded-2xl border border-border/80 bg-background p-4">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                Approvals
              </p>
              <h3 className="mt-1 text-base font-medium">Pending requests</h3>
              <p className="text-sm text-muted-foreground">
                Approval requests raised by the operations workspace.
              </p>
            </div>
            {approvalRequests.length === 0 ? (
              <EmptyState
                description="High-variance deposits and stock reviews will surface here."
                title="No pending approvals"
              />
            ) : (
              approvalRequests.map((request) => (
                <article className="rounded-xl border border-border/80 p-3" key={request._id}>
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="font-medium">
                        {request.workItemTitle ?? request.requestType}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {request.requestedByStaffName ?? "Requested by admin flow"}
                      </p>
                    </div>
                    <p className="text-xs uppercase text-muted-foreground">
                      {request.status}
                    </p>
                  </div>
                  {request.requestType === "inventory_adjustment_review" ? (
                    <div className="mt-3 space-y-3 rounded-xl border border-amber-200/80 bg-amber-50/70 px-3 py-3">
                      <p className="text-sm text-amber-950">
                        Manager approval applies the queued inventory movement. Reject
                        it to keep stock unchanged.
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <LoadingButton
                          className="bg-amber-500 text-amber-950 hover:bg-amber-500/90"
                          disabled={Boolean(
                            isDecidingApprovalRequestId &&
                              isDecidingApprovalRequestId !== request._id
                          )}
                          isLoading={isDecidingApprovalRequestId === request._id}
                          onClick={() =>
                            onDecideApprovalRequest({
                              approvalRequestId: request._id,
                              decision: "approved",
                            })
                          }
                          size="sm"
                        >
                          Approve batch
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
                          Reject batch
                        </Button>
                      </div>
                    </div>
                  ) : null}
                </article>
              ))
            )}
          </section>

          {registerCloseoutSection}
        </div>
      </FadeIn>
    </View>
  );
}

export function OperationsQueueView() {
  const { activeStore } = useGetActiveStore();
  const { user } = useAuth();
  const { canAccessOperations, isLoading } = usePermissions();
  const [isSubmittingStockBatch, setIsSubmittingStockBatch] = useState(false);
  const [decisioningApprovalRequestId, setDecisioningApprovalRequestId] =
    useState<Id<"approvalRequest"> | null>(null);

  const queue = useQuery(
    operationsApi.operationalWorkItems.getQueueSnapshot,
    activeStore?._id ? { storeId: activeStore._id } : "skip"
  ) as
    | {
        approvalRequests: QueueApprovalRequest[];
        workItems: QueueWorkItem[];
      }
    | undefined;
  const inventoryItems = useQuery(
    stockOpsApi.adjustments.listInventorySnapshot,
    activeStore?._id ? { storeId: activeStore._id } : "skip"
  ) as InventorySnapshotItem[] | undefined;
  const submitStockAdjustmentBatch = useMutation(
    stockOpsApi.adjustments.submitStockAdjustmentBatch
  );
  const decideApprovalRequest = useMutation(
    operationsApi.approvalRequests.decideApprovalRequest
  );

  const handleSubmitStockBatch = async (args: SubmitStockAdjustmentArgs) => {
    setIsSubmittingStockBatch(true);

    try {
      await submitStockAdjustmentBatch(args);
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
      await decideApprovalRequest({
        approvalRequestId: args.approvalRequestId,
        decision: args.decision,
        reviewedByUserId: user?._id,
      });

      toast.success(
        args.decision === "approved"
          ? "Stock adjustment approved"
          : "Stock adjustment rejected"
      );
    } catch (error) {
      toast.error("Failed to resolve approval request", {
        description: (error as Error).message,
      });
    } finally {
      setDecisioningApprovalRequestId(null);
    }
  };

  return (
    <OperationsQueueViewContent
      approvalRequests={queue?.approvalRequests ?? []}
      hasFullAdminAccess={canAccessOperations()}
      inventoryItems={inventoryItems ?? []}
      isDecidingApprovalRequestId={decisioningApprovalRequestId}
      isLoadingPermissions={isLoading}
      isLoadingQueue={!!activeStore && (queue === undefined || inventoryItems === undefined)}
      onDecideApprovalRequest={handleDecideApprovalRequest}
      isSubmittingStockBatch={isSubmittingStockBatch}
      onSubmitStockBatch={handleSubmitStockBatch}
      registerCloseoutSection={<RegisterCloseoutView />}
      storeId={activeStore?._id}
      userId={user?._id}
      workItems={queue?.workItems ?? []}
    />
  );
}
