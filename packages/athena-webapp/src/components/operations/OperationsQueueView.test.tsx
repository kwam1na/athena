import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  OperationsQueueView,
  OperationsQueueViewContent,
} from "./OperationsQueueView";
import type { Id } from "~/convex/_generated/dataModel";
import { ok } from "~/shared/commandResult";

const mockedHooks = vi.hoisted(() => ({
  useAuth: vi.fn(),
  useConvexAuth: vi.fn(),
  useConvexAuthIdentity: vi.fn(),
  useGetAuthedUser: vi.fn(),
  useGetActiveStore: vi.fn(),
  useMutation: vi.fn(),
  usePermissions: vi.fn(),
  useQuery: vi.fn(),
}));

const mockedToast = vi.hoisted(() => ({
  error: vi.fn(),
  success: vi.fn(),
}));

vi.mock("convex/react", () => ({
  useConvexAuth: mockedHooks.useConvexAuth,
  useMutation: mockedHooks.useMutation,
  useQuery: mockedHooks.useQuery,
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: mockedHooks.useAuth,
}));

vi.mock("@/hooks/useGetActiveStore", () => ({
  default: mockedHooks.useGetActiveStore,
}));

vi.mock("@/hooks/useConvexAuthIdentity", () => ({
  useConvexAuthIdentity: mockedHooks.useConvexAuthIdentity,
}));

vi.mock("@/hooks/useGetAuthedUser", () => ({
  useGetAuthedUser: mockedHooks.useGetAuthedUser,
}));

vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: mockedHooks.usePermissions,
}));

vi.mock("sonner", () => ({
  toast: mockedToast,
}));

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
    vi.clearAllMocks();
    mockedToast.error.mockReset();
    mockedToast.success.mockReset();
    mockedHooks.useAuth.mockReturnValue({
      user: { _id: "user-1" },
    });
    mockedHooks.useConvexAuth.mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
    });
    mockedHooks.useConvexAuthIdentity.mockReturnValue({
      email: "manager@example.com",
    });
    mockedHooks.useGetAuthedUser.mockReturnValue({ _id: "auth-user-1" });
    mockedHooks.useGetActiveStore.mockReturnValue({
      activeStore: { _id: "store-1" },
    });
    mockedHooks.usePermissions.mockReturnValue({
      canAccessOperations: () => true,
      isLoading: false,
    });
    mockedHooks.useMutation.mockReturnValue(vi.fn());
    const queueSnapshot = {
      approvalRequests: [],
      workItems: [],
    };
    const inventorySnapshot: typeof baseProps.inventoryItems = [];
    let queryCallIndex = 0;
    mockedHooks.useQuery.mockImplementation(() => {
      queryCallIndex += 1;

      return queryCallIndex % 2 === 1 ? queueSnapshot : inventorySnapshot;
    });
  });

  it("shows a loading state while permissions are resolving", () => {
    render(<OperationsQueueViewContent {...baseProps} isLoadingPermissions />);

    expect(
      screen.getByLabelText("Loading operations workspace"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Loading operations queue...")).not.toBeInTheDocument();
  });

  it("renders the denied state for users without operations access", () => {
    render(
      <OperationsQueueViewContent {...baseProps} hasFullAdminAccess={false} />,
    );

    expect(screen.getByText("Access Denied")).toBeInTheDocument();
  });

  it("renders the open work route content without an in-page workflow rail", () => {
    render(<OperationsQueueViewContent {...baseProps} activeWorkflow="queue" />);

    expect(screen.queryByText("Operations lanes")).not.toBeInTheDocument();
    expect(screen.getByText("No open work items")).toBeInTheDocument();
    expect(
      screen.getByText(
        "New service intakes and approval-driven stock reviews will appear here",
      ),
    ).toBeInTheDocument();
  });

  it("separates open work items from pending approvals", () => {
    const { rerender } = render(
      <OperationsQueueViewContent
        {...baseProps}
        activeWorkflow="approvals"
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

    expect(screen.getByText("Closure wig wash and style")).toBeInTheDocument();
    expect(screen.getByText("Mary Aidoo")).toBeInTheDocument();
    expect(screen.getByText("pending")).toBeInTheDocument();

    rerender(
      <OperationsQueueViewContent
        {...baseProps}
        activeWorkflow="queue"
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

    expect(screen.getByText("Closure wig wash and style")).toBeInTheDocument();
    expect(screen.getByText("Ama Mensah · Adjoa Tetteh")).toBeInTheDocument();
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
      />,
    );

    expect(
      screen.getByText(
        /manager approval applies the queued inventory movement/i,
      ),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /approve batch/i }));

    expect(baseProps.onDecideApprovalRequest).toHaveBeenCalledWith({
      approvalRequestId: "approval-1",
      decision: "approved",
    });
  });

  it("renders the live operations page without the register closeout surface", () => {
    render(<OperationsQueueView />);

    expect(screen.getByText("No inventory loaded.")).toBeInTheDocument();
    expect(screen.queryByText("Operations workspace")).not.toBeInTheDocument();
    expect(screen.queryByText(/register closeouts/i)).not.toBeInTheDocument();
  });

  it("routes approval decisions without sending a raw Athena user id from the client", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    const submitStockBatch = vi.fn();
    const decideApprovalRequest = vi
      .fn()
      .mockResolvedValue(ok({ _id: "approval-1" }));

    mockedHooks.useMutation.mockReset();
    mockedHooks.useQuery.mockReset();
    mockedHooks.useMutation
      .mockReturnValueOnce(submitStockBatch)
      .mockReturnValueOnce(decideApprovalRequest);
    mockedHooks.useQuery
      .mockReturnValueOnce({
        approvalRequests: [
          {
            _id: "approval-1",
            requestType: "inventory_adjustment_review",
            status: "pending",
            workItemTitle: "Cycle count review · 1 SKU",
          },
        ],
        workItems: [],
      })
      .mockReturnValueOnce(baseProps.inventoryItems);

    render(<OperationsQueueView />);

    await user.click(screen.getByRole("button", { name: /approve batch/i }));

    await waitFor(() =>
      expect(decideApprovalRequest).toHaveBeenCalledWith({
        approvalRequestId: "approval-1",
        decision: "approved",
      }),
    );
  });

  it("loads or creates the selected cycle-count draft", async () => {
    const ensureCycleCountDraft = vi.fn().mockResolvedValue(ok({}));

    mockedHooks.useMutation.mockReset();
    mockedHooks.useQuery.mockReset();
    mockedHooks.useMutation
      .mockReturnValueOnce(vi.fn())
      .mockReturnValueOnce(vi.fn())
      .mockReturnValueOnce(ensureCycleCountDraft)
      .mockReturnValueOnce(vi.fn())
      .mockReturnValueOnce(vi.fn())
      .mockReturnValueOnce(vi.fn());
    mockedHooks.useQuery
      .mockReturnValueOnce({
        approvalRequests: [],
        workItems: [],
      })
      .mockReturnValueOnce(baseProps.inventoryItems)
      .mockReturnValueOnce(null);

    render(
      <OperationsQueueView
        stockAdjustmentSearch={{
          mode: "cycle_count",
          scope: "Hair",
        }}
      />,
    );

    expect(mockedHooks.useQuery.mock.calls[2]?.[1]).toEqual({
      scopeKey: "Hair",
      storeId: "store-1",
    });
    expect(mockedHooks.useQuery.mock.calls[3]?.[1]).toEqual({
      storeId: "store-1",
    });
    await waitFor(() =>
      expect(ensureCycleCountDraft).toHaveBeenCalledWith({
        scopeKey: "Hair",
        storeId: "store-1",
      }),
    );
  });

  it("skips cycle-count draft loading in manual mode", () => {
    mockedHooks.useMutation.mockReset();
    mockedHooks.useQuery.mockReset();
    mockedHooks.useMutation.mockReturnValue(vi.fn());
    mockedHooks.useQuery
      .mockReturnValueOnce({
        approvalRequests: [],
        workItems: [],
      })
      .mockReturnValueOnce(baseProps.inventoryItems)
      .mockReturnValueOnce(undefined);

    render(
      <OperationsQueueView
        stockAdjustmentSearch={{
          mode: "manual",
          scope: "Hair",
        }}
      />,
    );

    expect(mockedHooks.useQuery.mock.calls[2]?.[1]).toBe("skip");
    expect(mockedHooks.useQuery.mock.calls[3]?.[1]).toEqual({
      storeId: "store-1",
    });
  });

  it("collapses unexpected approval failures to the shared fallback toast", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    const submitStockBatch = vi.fn();
    const decideApprovalRequest = vi
      .fn()
      .mockRejectedValue(new Error("Leaked backend approval detail"));
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    mockedHooks.useMutation.mockReset();
    mockedHooks.useQuery.mockReset();
    mockedHooks.useMutation
      .mockReturnValueOnce(submitStockBatch)
      .mockReturnValueOnce(decideApprovalRequest);
    mockedHooks.useQuery
      .mockReturnValueOnce({
        approvalRequests: [
          {
            _id: "approval-1",
            requestType: "inventory_adjustment_review",
            status: "pending",
            workItemTitle: "Cycle count review · 1 SKU",
          },
        ],
        workItems: [],
      })
      .mockReturnValueOnce(baseProps.inventoryItems);

    render(<OperationsQueueView />);

    await user.click(screen.getByRole("button", { name: /approve batch/i }));

    await waitFor(() =>
      expect(mockedToast.error).toHaveBeenCalledWith("Please try again."),
    );
    expect(mockedToast.error).not.toHaveBeenCalledWith(
      "Leaked backend approval detail",
    );

    consoleErrorSpy.mockRestore();
  });
});
