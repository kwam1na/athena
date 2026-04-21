import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OperationsQueueViewContent } from "./OperationsQueueView";
import type { Id } from "~/convex/_generated/dataModel";

const baseProps = {
  approvalRequests: [] as {
    _id: Id<"approvalRequest">;
    requestedByStaffName?: string | null;
    requestType: string;
    status: string;
    workItemTitle?: string | null;
  }[],
  hasFullAdminAccess: true,
  inventoryItems: [
    {
      _id: "sku-1" as Id<"productSku">,
      inventoryCount: 8,
      productName: "Closure wig",
      quantityAvailable: 6,
      sku: "CW-18",
    },
  ],
  isDecidingApprovalRequestId: null,
  isLoadingPermissions: false,
  isLoadingQueue: false,
  isSubmittingStockBatch: false,
  onDecideApprovalRequest: vi.fn().mockResolvedValue(undefined),
  onSubmitStockBatch: vi.fn(),
  storeId: "store-1" as Id<"store">,
  userId: "user-1" as Id<"athenaUser">,
  workItems: [] as {
    _id: Id<"operationalWorkItem">;
    approvalState: string;
    assignedStaffName?: string | null;
    customerName?: string | null;
    priority: string;
    status: string;
    title: string;
  }[],
};

describe("OperationsQueueViewContent", () => {
  beforeEach(() => {
    window.scrollTo = vi.fn();
  });

  it("shows a loading state while permissions are resolving", () => {
    render(
      <OperationsQueueViewContent
        {...baseProps}
        isLoadingPermissions
      />,
    );

    expect(screen.getByText("Loading operations queue...")).toBeInTheDocument();
  });

  it("renders the denied state for users without operations access", () => {
    render(
      <OperationsQueueViewContent
        {...baseProps}
        hasFullAdminAccess={false}
      />,
    );

    expect(screen.getByText("Access Denied")).toBeInTheDocument();
  });

  it("renders the empty state when no work items or approvals are open", () => {
    render(<OperationsQueueViewContent {...baseProps} />);

    expect(
      screen.getByText("Adjust stock without losing the audit trail.")
    ).toBeInTheDocument();
    expect(screen.getByText("No open work items")).toBeInTheDocument();
    expect(
      screen.getByText(
        "New service intakes and approval-driven stock reviews will appear here."
      ),
    ).toBeInTheDocument();
  });

  it("renders open work items and pending approvals", () => {
    render(
      <OperationsQueueViewContent
        {...baseProps}
        approvalRequests={[
          {
            _id: "approval-1" as Id<"approvalRequest">,
            requestedByStaffName: "Mary Aidoo",
            requestType: "service_deposit",
            status: "pending",
            workItemTitle: "Closure wig wash and style",
          },
        ]}
        workItems={[
          {
            _id: "work-item-1" as Id<"operationalWorkItem">,
            approvalState: "pending",
            assignedStaffName: "Adjoa Tetteh",
            customerName: "Ama Mensah",
            priority: "urgent",
            status: "intake_created",
            title: "Closure wig wash and style",
          },
        ]}
      />,
    );

    expect(screen.getAllByText("Closure wig wash and style")).toHaveLength(2);
    expect(screen.getByText("Ama Mensah · Adjoa Tetteh")).toBeInTheDocument();
    expect(screen.getByText("Mary Aidoo")).toBeInTheDocument();
    expect(screen.getByText("pending")).toBeInTheDocument();
  });

  it("renders stock approval actions and routes decisions through the provided handler", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();

    render(
      <OperationsQueueViewContent
        {...baseProps}
        approvalRequests={[
          {
            _id: "approval-1" as Id<"approvalRequest">,
            requestType: "inventory_adjustment_review",
            status: "pending",
            workItemTitle: "Cycle count review · 1 SKU",
          },
        ]}
      />
    );

    expect(
      screen.getByText(/manager approval applies the queued inventory movement/i)
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /approve batch/i }));

    expect(baseProps.onDecideApprovalRequest).toHaveBeenCalledWith({
      approvalRequestId: "approval-1",
      decision: "approved",
    });
  });
});
