import { useQuery } from "convex/react";
import View from "../View";
import { FadeIn } from "../common/FadeIn";
import { EmptyState } from "../states/empty/empty-state";
import { NoPermissionView } from "../states/no-permission/NoPermissionView";
import useGetActiveStore from "@/hooks/useGetActiveStore";
import { usePermissions } from "@/hooks/usePermissions";
import { api } from "~/convex/_generated/api";

const operationsApi = api.operations;

type QueueWorkItem = {
  _id: string;
  approvalState: string;
  assignedStaffName?: string | null;
  customerName?: string | null;
  priority: string;
  status: string;
  title: string;
};

type QueueApprovalRequest = {
  _id: string;
  requestedByStaffName?: string | null;
  requestType: string;
  status: string;
  workItemTitle?: string | null;
};

type OperationsQueueViewContentProps = {
  approvalRequests: QueueApprovalRequest[];
  hasFullAdminAccess: boolean;
  isLoadingPermissions: boolean;
  isLoadingQueue: boolean;
  workItems: QueueWorkItem[];
};

export function OperationsQueueViewContent({
  approvalRequests,
  hasFullAdminAccess,
  isLoadingPermissions,
  isLoadingQueue,
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
          Loading operations queue...
        </div>
      </View>
    );
  }

  if (workItems.length === 0 && approvalRequests.length === 0) {
    return (
      <View>
        <div className="container mx-auto py-8">
          <EmptyState
            description="New service intakes and approval requests will appear here."
            title="No active operations"
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
          <p className="text-xl font-medium">Operations queue</p>
        </div>
      }
    >
      <FadeIn className="container mx-auto grid gap-6 py-8 lg:grid-cols-2">
        <section className="space-y-3 rounded-lg border p-4">
          <div>
            <h3 className="text-base font-medium">Open work items</h3>
            <p className="text-sm text-muted-foreground">
              Service intake work that still needs progress or completion.
            </p>
          </div>
          {workItems.map((item) => (
            <article className="rounded-md border p-3" key={item._id}>
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
          ))}
        </section>

        <section className="space-y-3 rounded-lg border p-4">
          <div>
            <h3 className="text-base font-medium">Approval requests</h3>
            <p className="text-sm text-muted-foreground">
              Pending approvals created by the proving-path intake flow.
            </p>
          </div>
          {approvalRequests.length === 0 ? (
            <EmptyState
              description="Deposits that need review will surface here."
              title="No pending approvals"
            />
          ) : (
            approvalRequests.map((request) => (
              <article className="rounded-md border p-3" key={request._id}>
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="font-medium">{request.workItemTitle ?? request.requestType}</p>
                    <p className="text-sm text-muted-foreground">
                      {request.requestedByStaffName ?? "Requested by admin flow"}
                    </p>
                  </div>
                  <p className="text-xs uppercase text-muted-foreground">
                    {request.status}
                  </p>
                </div>
              </article>
            ))
          )}
        </section>
      </FadeIn>
    </View>
  );
}

export function OperationsQueueView() {
  const { activeStore } = useGetActiveStore();
  const { canAccessOperations, isLoading } = usePermissions();

  const queue = useQuery(
    operationsApi.operationalWorkItems.getQueueSnapshot,
    activeStore?._id ? { storeId: activeStore._id } : "skip"
  ) as
    | {
        approvalRequests: QueueApprovalRequest[];
        workItems: QueueWorkItem[];
      }
    | undefined;

  return (
    <OperationsQueueViewContent
      approvalRequests={queue?.approvalRequests ?? []}
      hasFullAdminAccess={canAccessOperations()}
      isLoadingPermissions={isLoading}
      isLoadingQueue={!!activeStore && queue === undefined}
      workItems={queue?.workItems ?? []}
    />
  );
}
