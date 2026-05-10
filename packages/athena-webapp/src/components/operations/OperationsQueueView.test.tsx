import { render, screen, waitFor, within } from "@testing-library/react";
import type { AnchorHTMLAttributes, ReactNode } from "react";
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

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    params,
    search,
    to,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & {
    children: ReactNode;
    params?: unknown;
    search?: Record<string, string>;
    to?: string;
  }) => {
    void params;
    const searchParams = search ? `?${new URLSearchParams(search)}` : "";

    return (
      <a href={`${to ?? "#"}${searchParams}`} {...props}>
        {children}
      </a>
    );
  },
  useParams: () => ({
    orgUrlSlug: "wigclub",
    storeUrlSlug: "wigclub",
  }),
  useSearch: () => ({}),
}));

vi.mock("convex/react", () => ({
  useConvexAuth: mockedHooks.useConvexAuth,
  useMutation: mockedHooks.useMutation,
  useQuery: mockedHooks.useQuery,
}));

vi.mock("@/hooks/use-navigate-back", () => ({
  useNavigateBack: () => vi.fn(),
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

vi.mock("@/lib/security/pinHash", () => ({
  hashPin: vi.fn(async (pin: string) => `hashed:${pin}`),
}));

vi.mock("@/components/staff-auth/StaffAuthenticationDialog", () => ({
  StaffAuthenticationDialog: ({
    copy,
    onAuthenticate,
    onAuthenticated,
    onDismiss,
    open,
  }: {
    copy: { submitLabel: string; title: string };
    onAuthenticate: (args: {
      mode: "authenticate";
      pinHash: string;
      username: string;
    }) => Promise<{ data?: unknown; kind: string }>;
    onAuthenticated: (
      data: unknown,
      mode: "authenticate",
      credentials: { pinHash: string; username: string },
    ) => void;
    onDismiss: () => void;
    open: boolean;
  }) =>
    open ? (
      <div role="dialog" aria-label={copy.title}>
        <button
          type="button"
          onClick={async () => {
            const credentials = {
              pinHash: "hashed:123456",
              username: "manager",
            };
            const result = await onAuthenticate({
              mode: "authenticate",
              ...credentials,
            });

            if (result.kind === "ok") {
              onAuthenticated(result.data, "authenticate", credentials);
            }
          }}
        >
          {copy.submitLabel}
        </button>
        <button type="button" onClick={onDismiss}>
          Cancel
        </button>
      </div>
    ) : null,
}));

const baseProps = {
  approvalRequests: [] as {
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
    requestType: string;
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
    window.ResizeObserver ??= class ResizeObserver {
      disconnect() {}
      observe() {}
      unobserve() {}
    };
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
    const { container } = render(
      <OperationsQueueViewContent {...baseProps} isLoadingPermissions />,
    );

    expect(container.firstChild).toBeNull();
    expect(
      screen.queryByText("Loading operations queue..."),
    ).not.toBeInTheDocument();
  });

  it("renders the denied state for users without operations access", () => {
    render(
      <OperationsQueueViewContent {...baseProps} hasFullAdminAccess={false} />,
    );

    expect(screen.getByText("Access Denied")).toBeInTheDocument();
  });

  it("renders the open work route content without an in-page workflow rail", () => {
    render(
      <OperationsQueueViewContent {...baseProps} activeWorkflow="queue" />,
    );

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
        orgUrlSlug="wigclub"
        storeUrlSlug="wigclub"
      />,
    );

    expect(screen.getByText("Closure wig wash and style")).toBeInTheDocument();
    expect(screen.getByText("Requested by Mary Aidoo")).toBeInTheDocument();
    expect(screen.queryByText("pending")).not.toBeInTheDocument();

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
        orgUrlSlug="wigclub"
        storeUrlSlug="wigclub"
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
            metadata: {
              largestAbsoluteDelta: 4,
              lineItems: [
                {
                  countedQuantity: 2,
                  productName: "Closure wig",
                  productSkuId: "sku-1" as Id<"productSku">,
                  quantityDelta: -4,
                  sku: "CW-18",
                  systemQuantity: 6,
                },
                {
                  countedQuantity: 9,
                  productName: "lace tint",
                  productSkuId: "sku-2" as Id<"productSku">,
                  quantityDelta: 3,
                  sku: "LT-01",
                  systemQuantity: 6,
                },
              ],
              netQuantityDelta: -1,
            },
            requestType: "inventory_adjustment_review",
            status: "pending",
            workItemTitle: "Cycle count review · 2 SKUs",
          },
        ]}
      />,
    );

    expect(
      screen.getByText(
        /manager approval applies the queued inventory movement/i,
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("SKU review")).toBeInTheDocument();
    expect(screen.getByText("Closure wig")).toBeInTheDocument();
    expect(screen.getByText("CW-18")).toBeInTheDocument();
    expect(screen.getByText("Lace tint")).toBeInTheDocument();
    expect(screen.getByText("LT-01")).toBeInTheDocument();
    expect(screen.getByText("Net -1")).toBeInTheDocument();
    expect(screen.getByText("Max variance 4")).toBeInTheDocument();
    expect(
      screen.getByText(
        (_, element) =>
          element?.textContent?.replace(/\s+/g, " ").trim() ===
          "2 counted against 6 on hand",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        (_, element) =>
          element?.textContent?.replace(/\s+/g, " ").trim() ===
          "9 counted against 6 on hand",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("-4")).toBeInTheDocument();
    expect(screen.getByText("+3")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /approve batch/i }));

    expect(baseProps.onDecideApprovalRequest).toHaveBeenCalledWith({
      approvalRequestId: "approval-1",
      decision: "approved",
    });
  });

  it("renders linked transaction detail for payment correction approvals", () => {
    render(
      <OperationsQueueViewContent
        {...baseProps}
        approvalRequests={[
          {
            _id: "approval-1" as Id<"approvalRequest">,
            metadata: {
              amount: 19500,
              paymentMethod: "card",
              previousPaymentMethod: "cash",
              transactionId: "txn-1" as Id<"posTransaction">,
            },
            notes: "Customer paid by card after mobile money failed.",
            requestedByStaffName: "Ato Kwamina",
            requestType: "payment_method_correction",
            status: "pending",
            transactionSummary: {
              completedAt: 1_714_620_000_000,
              paymentMethod: "cash",
              total: 19500,
              totalPaid: 19500,
              transactionId: "txn-1" as Id<"posTransaction">,
              transactionNumber: "434898",
            },
            workItemTitle: "Payment Method Correction",
          },
        ]}
        orgUrlSlug="wigclub"
        storeUrlSlug="wigclub"
      />,
    );

    expect(screen.getByText("Linked transaction")).toBeInTheDocument();
    expect(screen.getByText("Requested by Ato Kwamina")).toBeInTheDocument();
    expect(screen.getByText("Requester note")).toBeInTheDocument();
    expect(
      screen.getByText("Customer paid by card after mobile money failed."),
    ).toBeInTheDocument();
    expect(screen.getByText("#434898")).toBeInTheDocument();
    expect(screen.getByText("GH₵195")).toBeInTheDocument();
    expect(screen.getByText("Current method")).toBeInTheDocument();
    expect(screen.getByText("Cash")).toBeInTheDocument();
    expect(screen.getByText("Requested method")).toBeInTheDocument();
    expect(screen.getByText("Card")).toBeInTheDocument();
    expect(screen.getByText("Amount")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /view transaction/i }),
    ).toHaveAttribute(
      "href",
      "/$orgUrlSlug/store/$storeUrlSlug/pos/transactions/$transactionId?o=%252F",
    );
  });

  it("renders register closeout detail for variance review approvals", () => {
    render(
      <OperationsQueueViewContent
        {...baseProps}
        approvalRequests={[
          {
            _id: "approval-variance-1" as Id<"approvalRequest">,
            createdAt: 1_714_620_000_000,
            metadata: {
              countedCash: 20000,
              expectedCash: 40000,
              variance: -20000,
            },
            reason:
              "Variance of -20000 exceeded the closeout approval threshold.",
            registerSessionSummary: {
              countedCash: 20000,
              expectedCash: 40000,
              registerNumber: "6",
              registerSessionId: "register-6" as Id<"registerSession">,
              status: "closing",
              terminalName: "Safari QA",
              variance: -20000,
            },
            requestedByStaffName: "Skank Hunt",
            requestType: "variance_review",
            status: "pending",
            workItemTitle: "Variance Review",
          },
        ]}
        orgUrlSlug="wigclub"
        storeUrlSlug="wigclub"
      />,
    );

    expect(screen.getByText("Register closeout")).toBeInTheDocument();
    expect(
      screen.getByText("Closeout variance queued for manager review"),
    ).toBeInTheDocument();
    expect(screen.getByText("Requested by Skank Hunt")).toBeInTheDocument();
    expect(screen.getByText("Terminal")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /safari qa \/ register 6/i }),
    ).toHaveAttribute(
      "href",
      "/$orgUrlSlug/store/$storeUrlSlug/cash-controls/registers/$sessionId?o=%252F",
    );
    expect(screen.getByText("GH₵400")).toBeInTheDocument();
    expect(screen.getByText("GH₵200")).toBeInTheDocument();
    expect(screen.getByText("GH₵-200")).toHaveClass("text-danger");
    expect(screen.getByText("Closing")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Variance of GH₵-200 exceeded the closeout approval threshold",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/variance of -20000/i)).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /approve variance/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /reject variance/i }),
    ).toBeInTheDocument();
  });

  it("renders the live operations page without the register closeout surface", () => {
    render(<OperationsQueueView />);

    expect(screen.getByText("No inventory loaded.")).toBeInTheDocument();
    expect(
      screen.getByText(/inventory appears here once skus are available/i),
    ).toBeInTheDocument();
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
    const authenticateStaffCredential = vi.fn().mockResolvedValue(
      ok({
        activeRoles: ["manager"],
        staffProfile: {},
        staffProfileId: "staff-manager-1",
      }),
    );
    const authenticateStaffCredentialForApproval = vi.fn().mockResolvedValue(
      ok({
        approvalProofId: "proof-1",
        approvedByStaffProfileId: "staff-manager-1",
        expiresAt: Date.now() + 60_000,
      }),
    );

    mockedHooks.useMutation.mockReset();
    mockedHooks.useQuery.mockReset();
    const mutationOrder = [
      submitStockBatch,
      decideApprovalRequest,
      authenticateStaffCredential,
      authenticateStaffCredentialForApproval,
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn(),
    ];
    let mutationCallIndex = 0;
    mockedHooks.useMutation.mockImplementation(
      () => mutationOrder[mutationCallIndex++ % mutationOrder.length],
    );
    const queueSnapshot = {
      approvalRequests: [
        {
          _id: "approval-1",
          requestType: "inventory_adjustment_review",
          status: "pending",
          workItemTitle: "Cycle count review · 1 SKU",
        },
      ],
      workItems: [],
    };
    let queryCallIndex = 0;
    mockedHooks.useQuery.mockImplementation(() => {
      queryCallIndex += 1;

      return queryCallIndex % 2 === 1
        ? queueSnapshot
        : baseProps.inventoryItems;
    });

    render(<OperationsQueueView />);

    expect(
      screen.getByRole("button", { name: /approve batch/i }),
    ).toBeDisabled();

    await user.click(screen.getByRole("button", { name: /unlock approvals/i }));
    await user.click(
      within(
        screen.getByRole("dialog", { name: /unlock approval decisions/i }),
      ).getByRole("button", { name: /unlock approvals/i }),
    );

    await waitFor(() =>
      expect(authenticateStaffCredential).toHaveBeenCalledWith({
        allowedRoles: ["manager"],
        pinHash: "hashed:123456",
        storeId: "store-1",
        username: "manager",
      }),
    );

    await user.click(screen.getByRole("button", { name: /approve batch/i }));

    await waitFor(() =>
      expect(authenticateStaffCredentialForApproval).toHaveBeenCalledWith({
        actionKey: "operations.approval_request.decide",
        pinHash: "hashed:123456",
        reason: "Resolve pending approval request.",
        requiredRole: "manager",
        storeId: "store-1",
        subject: {
          id: "approval-1",
          label: "Cycle count review · 1 SKU",
          type: "approval_request",
        },
        username: "manager",
      }),
    );
    await waitFor(() =>
      expect(decideApprovalRequest).toHaveBeenCalledWith({
        approvalRequestId: "approval-1",
        approvalProofId: "proof-1",
        decision: "approved",
      }),
    );
  });

  it("loads or creates the selected cycle-count draft", async () => {
    const ensureCycleCountDraft = vi.fn().mockResolvedValue(ok({}));

    mockedHooks.useMutation.mockReset();
    mockedHooks.useQuery.mockReset();
    mockedHooks.useMutation.mockReturnValue(vi.fn());
    mockedHooks.useMutation
      .mockReturnValueOnce(vi.fn())
      .mockReturnValueOnce(vi.fn())
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
    const authenticateStaffCredential = vi.fn().mockResolvedValue(
      ok({
        activeRoles: ["manager"],
        staffProfile: {},
        staffProfileId: "staff-manager-1",
      }),
    );
    const authenticateStaffCredentialForApproval = vi.fn().mockResolvedValue(
      ok({
        approvalProofId: "proof-1",
        approvedByStaffProfileId: "staff-manager-1",
        expiresAt: Date.now() + 60_000,
      }),
    );
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    mockedHooks.useMutation.mockReset();
    mockedHooks.useQuery.mockReset();
    const mutationOrder = [
      submitStockBatch,
      decideApprovalRequest,
      authenticateStaffCredential,
      authenticateStaffCredentialForApproval,
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn(),
    ];
    let mutationCallIndex = 0;
    mockedHooks.useMutation.mockImplementation(
      () => mutationOrder[mutationCallIndex++ % mutationOrder.length],
    );
    const queueSnapshot = {
      approvalRequests: [
        {
          _id: "approval-1",
          requestType: "inventory_adjustment_review",
          status: "pending",
          workItemTitle: "Cycle count review · 1 SKU",
        },
      ],
      workItems: [],
    };
    let queryCallIndex = 0;
    mockedHooks.useQuery.mockImplementation(() => {
      queryCallIndex += 1;

      return queryCallIndex % 2 === 1
        ? queueSnapshot
        : baseProps.inventoryItems;
    });

    render(<OperationsQueueView />);

    await user.click(screen.getByRole("button", { name: /unlock approvals/i }));
    await user.click(
      within(
        screen.getByRole("dialog", { name: /unlock approval decisions/i }),
      ).getByRole("button", { name: /unlock approvals/i }),
    );
    await waitFor(() => expect(authenticateStaffCredential).toHaveBeenCalled());

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
