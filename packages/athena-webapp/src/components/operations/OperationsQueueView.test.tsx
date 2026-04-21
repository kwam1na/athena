import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OperationsQueueViewContent } from "./OperationsQueueView";

const baseProps = {
  approvalRequests: [] as {
    _id: string;
    requestedByStaffName?: string | null;
    requestType: string;
    status: string;
    workItemTitle?: string | null;
  }[],
  hasFullAdminAccess: true,
  isLoadingPermissions: false,
  isLoadingQueue: false,
  workItems: [] as {
    _id: string;
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

    expect(screen.getByText("No active operations")).toBeInTheDocument();
    expect(
      screen.getByText("New service intakes and approval requests will appear here."),
    ).toBeInTheDocument();
  });

  it("renders open work items and pending approvals", () => {
    render(
      <OperationsQueueViewContent
        {...baseProps}
        approvalRequests={[
          {
            _id: "approval-1",
            requestedByStaffName: "Mary Aidoo",
            requestType: "service_deposit",
            status: "pending",
            workItemTitle: "Closure wig wash and style",
          },
        ]}
        workItems={[
          {
            _id: "work-item-1",
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
});
