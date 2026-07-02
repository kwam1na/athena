import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { getFunctionName } from "convex/server";
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
  usePaginatedQuery: vi.fn(),
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
  usePaginatedQuery: mockedHooks.usePaginatedQuery,
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
              pinHash: "hashed:1234",
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
    _id: string;
    metadata?: {
      amount?: number;
      adjustmentType?: string;
      conflictCount?: number;
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
      reviewItems?: Array<{
        id?: string;
        localEventId?: string;
        sequence?: number;
        summary?: string;
        type?: string;
      }>;
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
    createdAt: number;
    customerName?: string | null;
    dueAt?: number | null;
    metadata?: Record<string, unknown> | null;
    priority: string;
    status: string;
    title: string;
    type: string;
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
    mockedHooks.usePaginatedQuery.mockReturnValue({
      isLoading: false,
      loadMore: vi.fn(),
      results: [],
      status: "Exhausted",
    });
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
    let queryCallIndex = 0;
    mockedHooks.useQuery.mockImplementation(() => {
      queryCallIndex += 1;

      return queryCallIndex === 1 ? queueSnapshot : undefined;
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
    expect(screen.getByText("0 open work items")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Service intake and stock review work that still needs progress or completion.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("No open work items")).toBeInTheDocument();
    expect(
      screen.getByText(
        "New service intakes and approval-driven stock reviews will appear here",
      ),
    ).toBeInTheDocument();
  });

  it("uses the open work count in the loaded route header", () => {
    render(
      <OperationsQueueViewContent
        {...baseProps}
        activeWorkflow="queue"
        workItems={[
          {
            _id: "work-item-1" as Id<"operationalWorkItem">,
            approvalState: "pending",
            createdAt: Date.now() - 5 * 60 * 1000,
            details: {
              lookupCode: "nahh",
              price: 80000,
              quantitySold: 1,
              totalQuantitySold: 1,
            },
            priority: "normal",
            status: "open",
            title: "Review pending checkout item: ADORE DYE",
            type: "pos_pending_checkout_item_review",
          },
          {
            _id: "work-item-2" as Id<"operationalWorkItem">,
            approvalState: "pending",
            createdAt: Date.now() - 10 * 60 * 1000,
            priority: "high",
            status: "open",
            title: "follow up service intake",
            type: "service_case",
          },
        ]}
      />,
    );

    expect(screen.getByText("2 open work items")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Service intake and stock review work that still needs progress or completion.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "Work type breakdown" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Work type")).toBeInTheDocument();
    expect(screen.getByText("2 work types")).toBeInTheDocument();
    expect(screen.getAllByText("POS pending checkout").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Service case").length).toBeGreaterThan(0);
    expect(screen.getAllByText("1 item")).toHaveLength(2);
    expect(
      screen.getByText("Review pending checkout item: Adore Dye"),
    ).toBeInTheDocument();
    expect(screen.getByText("Item code")).toBeInTheDocument();
    expect(screen.getByText("Quantity sold")).toBeInTheDocument();
    expect(screen.getByText("Total sold")).toBeInTheDocument();
    expect(screen.getByText("Price")).toBeInTheDocument();
    expect(screen.getByText("GH₵800")).toBeInTheDocument();
    expect(screen.queryByText("GH₵80,000")).not.toBeInTheDocument();
    expect(screen.getByText("Follow Up Service Intake")).toBeInTheDocument();
    expect(screen.getByText("Owner")).toBeInTheDocument();
    expect(screen.getByText("Customer")).toBeInTheDocument();
  });

  it("shows when the open work queue is capped by the server", () => {
    render(
      <OperationsQueueViewContent
        {...baseProps}
        activeWorkflow="queue"
        queueOverflow={{
          approvalRequests: false,
          workItems: {
            inProgress: false,
            open: true,
          },
        }}
        workItems={[
          {
            _id: "work-item-1" as Id<"operationalWorkItem">,
            approvalState: "not_required",
            createdAt: Date.now() - 5 * 60 * 1000,
            priority: "normal",
            status: "open",
            title: "Count stock",
            type: "service_case",
          },
        ]}
      />,
    );

    expect(screen.getByText("More open work is available")).toBeInTheDocument();
    expect(
      screen.getByText(
        /Showing the first 1 open work items\. Resolve visible work/i,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/change the sort order/i)).not.toBeInTheDocument();
  });

  it("shows when pending approvals are capped by the server", () => {
    render(
      <OperationsQueueViewContent
        {...baseProps}
        activeWorkflow="approvals"
        approvalRequests={[
          {
            _id: "approval-1" as Id<"approvalRequest">,
            requestType: "variance_review",
            status: "pending",
          },
        ]}
        queueOverflow={{
          approvalRequests: true,
          workItems: {
            inProgress: false,
            open: false,
          },
        }}
      />,
    );

    expect(screen.getByText("More approvals are available")).toBeInTheDocument();
    expect(
      screen.getByText(
        /Showing the first 1 pending approvals\. Resolve visible approvals/i,
      ),
    ).toBeInTheDocument();
  });

  it("shows only the open work header while the queue is loading", () => {
    render(
      <OperationsQueueViewContent
        {...baseProps}
        activeWorkflow="queue"
        isLoadingQueue
      />,
    );

    expect(screen.getByText("Open work")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Service intake and stock review work that still needs progress or completion.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByLabelText("Loading open work summary"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText("Loading open work queue"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Work queue")).not.toBeInTheDocument();
    expect(screen.queryByText("No open work items")).not.toBeInTheDocument();
  });

  it("shows only the stock adjustments header while stock data is loading", () => {
    render(
      <OperationsQueueViewContent
        {...baseProps}
        activeWorkflow="stock"
        isLoadingQueue
      />,
    );

    expect(screen.getByText("Stock adjustments")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Review store inventory, count physical stock, and record corrections before changes are applied.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /cycle count/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("All inventory is available."),
    ).not.toBeInTheDocument();
  });

  it("keeps the loaded stock header when inventory is ready but queue data is still loading", () => {
    render(
      <OperationsQueueViewContent
        {...baseProps}
        activeWorkflow="stock"
        isLoadingQueue
        isLoadingStock={false}
      />,
    );

    const loadedHeading = screen.getByRole("heading", {
      name: "1 SKU has reserved units.",
    });

    expect(loadedHeading).toBeInTheDocument();
    expect(loadedHeading).not.toHaveAttribute("style");
    expect(
      screen.getByText(
        "6 of 8 units are available to sell. Select a SKU, then record physical counts for its category.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(
        "Review store inventory, count physical stock, and record corrections before changes are applied.",
      ),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("tab", { name: /cycle count/i }),
    ).toBeInTheDocument();
  });

  it("shows the approvals header while approval data is loading", () => {
    render(
      <OperationsQueueViewContent
        {...baseProps}
        activeWorkflow="approvals"
        isLoadingQueue
      />,
    );

    expect(screen.getByText("Pending approvals")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Review manager approval requests before queued stock and payment changes are applied.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("No pending approvals")).not.toBeInTheDocument();
  });

  it("uses natural copy for the empty approvals header", () => {
    render(
      <OperationsQueueViewContent
        {...baseProps}
        activeWorkflow="approvals"
        approvalRequests={[]}
      />,
    );

    expect(screen.getAllByText("No pending approvals")).toHaveLength(1);
    expect(screen.queryByText("0 pending approvals")).not.toBeInTheDocument();
    expect(
      screen.getByText("High-variance deposits and stock reviews will surface here."),
    ).toBeInTheDocument();
  });

  it("uses the pending approval count in the loaded approvals header", () => {
    render(
      <OperationsQueueViewContent
        {...baseProps}
        activeWorkflow="approvals"
        approvalRequests={[
          {
            _id: "approval-1" as Id<"approvalRequest">,
            requestType: "inventory_adjustment_review",
            status: "pending",
            workItemTitle: "Cycle count review · 1 SKU",
          },
          {
            _id: "approval-2" as Id<"approvalRequest">,
            requestType: "service_deposit",
            status: "pending",
            workItemTitle: "Service deposit review",
          },
        ]}
      />,
    );

    expect(screen.getByText("2 pending approvals")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Review manager approval requests before queued stock and payment changes are applied.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Cycle Count Review · 1 SKU")).toBeInTheDocument();
    expect(screen.getByText("Service Deposit Review")).toBeInTheDocument();
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
            createdAt: Date.now() - 5 * 60 * 1000,
            customerName: "Ama Mensah",
            dueAt: Date.now() + 2 * 60 * 60 * 1000,
            priority: "urgent",
            status: "intake_created",
            title: "Closure wig wash and style",
            type: "service_intake",
          },
        ]}
        orgUrlSlug="wigclub"
        storeUrlSlug="wigclub"
      />,
    );

    expect(screen.getByText("Closure Wig Wash And Style")).toBeInTheDocument();
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
            createdAt: Date.now() - 5 * 60 * 1000,
            customerName: "Ama Mensah",
            dueAt: Date.now() + 2 * 60 * 60 * 1000,
            priority: "urgent",
            status: "intake_created",
            title: "Closure wig wash and style",
            type: "service_intake",
          },
        ]}
        orgUrlSlug="wigclub"
        storeUrlSlug="wigclub"
      />,
    );

    expect(screen.getByText("Closure Wig Wash And Style")).toBeInTheDocument();
    expect(screen.getAllByText("Service intake").length).toBeGreaterThan(0);
    expect(screen.getByText("Intake Created")).toBeInTheDocument();
    expect(screen.getByText("Urgent")).toBeInTheDocument();
    expect(screen.getByText("Owner")).toBeInTheDocument();
    expect(screen.getByText("Adjoa Tetteh")).toHaveClass(
      "font-medium",
      "text-foreground",
    );
    expect(screen.getByText("Customer")).toBeInTheDocument();
    expect(screen.getByText("Ama Mensah")).toHaveClass(
      "font-medium",
      "text-foreground",
    );
    expect(screen.getByText("Created")).toBeInTheDocument();
    expect(screen.getByText("Due")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /show details/i })).toBeInTheDocument();
  });

  it("paginates open work items five per page with the shared list controls", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    const workItems = Array.from({ length: 12 }, (_, index) => ({
      _id: `work-item-${index + 1}` as Id<"operationalWorkItem">,
      approvalState: "not_required",
      createdAt: Date.now() - index * 60 * 1000,
      customerName: `Customer ${index + 1}`,
      priority: "normal",
      status: "open",
      title: `Open work item ${index + 1}`,
      type: "service_case",
    }));

    render(
      <OperationsQueueViewContent
        {...baseProps}
        activeWorkflow="queue"
        workItems={workItems}
      />,
    );

    expect(screen.getByText("Open Work Item 1")).toBeInTheDocument();
    expect(screen.getByText("Open Work Item 5")).toBeInTheDocument();
    expect(screen.queryByText("Open Work Item 6")).not.toBeInTheDocument();
    expect(screen.getByText("Showing 1-5 of 12")).toBeInTheDocument();
    expect(screen.getByText("Page 1 of 3")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Go to next page" }));

    expect(screen.queryByText("Open Work Item 1")).not.toBeInTheDocument();
    expect(screen.getByText("Open Work Item 6")).toBeInTheDocument();
    expect(screen.getByText("Open Work Item 10")).toBeInTheDocument();
    expect(screen.queryByText("Open Work Item 11")).not.toBeInTheDocument();
    expect(screen.getByText("Showing 6-10 of 12")).toBeInTheDocument();
    expect(screen.getByText("Page 2 of 3")).toBeInTheDocument();
  });

  it("preserves server-prioritized open work order", () => {
    const baseTime = Date.UTC(2026, 5, 28, 12, 0, 0);
    const workItems = Array.from({ length: 6 }, (_, index) => ({
      _id: `work-item-${index + 1}` as Id<"operationalWorkItem">,
      approvalState: "not_required",
      createdAt: baseTime + index * 60 * 1000,
      priority: "normal",
      status: "open",
      title: `Open work item ${index + 1}`,
      type: "service_case",
    }));

    render(
      <OperationsQueueViewContent
        {...baseProps}
        activeWorkflow="queue"
        workItems={workItems}
      />,
    );

    expect(screen.getByText("Open Work Item 1")).toBeInTheDocument();
    expect(screen.queryByText("Open Work Item 6")).not.toBeInTheDocument();
    expect(screen.getByText("Page 1 of 2")).toBeInTheDocument();
  });

  it("routes pending checkout work items to unresolved catalog review first", () => {
    render(
      <OperationsQueueViewContent
        {...baseProps}
        activeWorkflow="queue"
        orgUrlSlug="wigclub"
        storeUrlSlug="wigclub"
        workItems={[
          {
            _id: "work-item-1" as Id<"operationalWorkItem">,
            approvalState: "not_required",
            createdAt: Date.now() - 5 * 60 * 1000,
            details: {},
            priority: "normal",
            status: "open",
            title: "Review pending checkout item: BRUDDAH",
            type: "pos_pending_checkout_item_review",
          },
        ]}
      />,
    );

    expect(
      screen.getByText((_content, element) =>
        element?.tagName.toLowerCase() === "p" &&
        element.textContent === "Review pending checkout item: Bruddah",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Bruddah" })).not.toBeInTheDocument();

    const actionHref = new URL(
      screen
        .getByRole("link", { name: "Review unresolved catalog" })
        .getAttribute("href") ?? "",
      "http://localhost",
    );
    expect(actionHref.pathname).toBe(
      "/$orgUrlSlug/store/$storeUrlSlug/products/unresolved",
    );
    expect(actionHref.searchParams.get("o")).toBeTruthy();
    expect(
      screen.queryByRole("link", { name: "Open stock adjustments" }),
    ).not.toBeInTheDocument();
    expect(actionHref.searchParams.get("sku")).toBeNull();
  });

  it("keeps pending checkout work item titles plain without provisional SKU metadata", () => {
    render(
      <OperationsQueueViewContent
        {...baseProps}
        activeWorkflow="queue"
        orgUrlSlug="wigclub"
        storeUrlSlug="wigclub"
        workItems={[
          {
            _id: "work-item-1" as Id<"operationalWorkItem">,
            approvalState: "not_required",
            createdAt: Date.now() - 5 * 60 * 1000,
            priority: "normal",
            status: "open",
            title: "Review pending checkout item: BRUDDAH",
            type: "pos_pending_checkout_item_review",
          },
        ]}
      />,
    );

    expect(
      screen.getByText("Review pending checkout item: Bruddah"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", {
        name: "Bruddah",
      }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Open stock adjustments" }),
    ).not.toBeInTheDocument();
  });

  it("renders type-specific open work owner and action contracts", () => {
    const createdAt = Date.UTC(2026, 6, 1, 10, 0, 0);

    render(
      <OperationsQueueViewContent
        {...baseProps}
        activeWorkflow="queue"
        orgUrlSlug="wigclub"
        storeUrlSlug="wigclub"
        workItems={[
          {
            _id: "work-service-case" as Id<"operationalWorkItem">,
            approvalState: "not_required",
            assignedStaffName: "Akua Mensah",
            createdAt,
            customerName: "Efua Owusu",
            dueAt: createdAt + 86_400_000,
            priority: "normal",
            status: "open",
            title: "closure wig repair",
            type: "service_case",
          },
          {
            _id: "work-service-appointment" as Id<"operationalWorkItem">,
            approvalState: "not_required",
            assignedStaffName: "Ama Tetteh",
            createdAt: createdAt + 1_000,
            customerName: "Yaw Danso",
            dueAt: createdAt + 3_600_000,
            priority: "normal",
            status: "open",
            title: "install appointment",
            type: "service_appointment",
          },
          {
            _id: "work-purchase-order" as Id<"operationalWorkItem">,
            approvalState: "not_required",
            createdAt: createdAt + 2_000,
            details: {
              itemCount: 4,
              purchaseOrderNumber: "PO-103",
              vendorName: "Salon Supply Co.",
            },
            priority: "normal",
            status: "in_progress",
            title: "restock adhesives",
            type: "purchase_order",
          },
          {
            _id: "work-stock-review" as Id<"operationalWorkItem">,
            approvalState: "pending",
            createdAt: createdAt + 3_000,
            details: {
              reasonLabel: "Cycle count variance",
            },
            priority: "high",
            status: "open",
            title: "cycle count review",
            type: "stock_adjustment_review",
          },
          {
            _id: "work-carry-forward" as Id<"operationalWorkItem">,
            approvalState: "not_required",
            createdAt: createdAt + 4_000,
            details: {
              businessDate: "2026-07-01",
              followUpReason: "Review drawer variance handoff",
            },
            priority: "normal",
            status: "open",
            title: "daily close carry forward",
            type: "daily_close_carry_forward",
          },
        ]}
      />,
    );

    expect(screen.getAllByText("Service case").length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: "Open service case" })).toHaveAttribute(
      "href",
      "/$orgUrlSlug/store/$storeUrlSlug/services/active-cases?o=%252F",
    );
    expect(screen.getAllByText("Service appointment").length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: "Open appointment" })).toHaveAttribute(
      "href",
      "/$orgUrlSlug/store/$storeUrlSlug/services/appointments?o=%252F",
    );
    expect(screen.getAllByText("Purchase order").length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: "Open purchase order" })).toHaveAttribute(
      "href",
      "/$orgUrlSlug/store/$storeUrlSlug/procurement?o=%252F",
    );
    expect(screen.getByText("PO-103")).toBeInTheDocument();
    expect(screen.getByText("Salon Supply Co.")).toBeInTheDocument();
    expect(screen.getByText("4 items")).toBeInTheDocument();
    expect(screen.getAllByText("Stock adjustment approval").length).toBeGreaterThan(0);
    expect(screen.getByText("Approval requests")).toBeInTheDocument();
    expect(screen.getByText("Cycle count variance")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Review approval" })).toHaveAttribute(
      "href",
      "/$orgUrlSlug/store/$storeUrlSlug/operations/approvals?o=%252F",
    );
    expect(screen.getAllByText("Daily close follow-up").length).toBeGreaterThan(0);
    expect(screen.getByText("July 1, 2026")).toBeInTheDocument();
    const dailyCloseHref = new URL(
      screen
        .getByRole("link", { name: "Open Daily Close" })
        .getAttribute("href") ?? "",
      "http://localhost",
    );
    expect(dailyCloseHref.pathname).toBe(
      "/$orgUrlSlug/store/$storeUrlSlug/operations/daily-close",
    );
    expect(dailyCloseHref.searchParams.get("o")).toBe("%2F");
    expect(dailyCloseHref.searchParams.get("operatingDate")).toBe("2026-07-01");
    expect(
      screen.queryByRole("link", { name: "Open stock adjustments" }),
    ).not.toBeInTheDocument();
  });

  it("does not render service deposit review as a supported open work row", () => {
    render(
      <OperationsQueueViewContent
        {...baseProps}
        activeWorkflow="queue"
        orgUrlSlug="wigclub"
        storeUrlSlug="wigclub"
        workItems={[
          {
            _id: "work-service-deposit" as Id<"operationalWorkItem">,
            approvalState: "pending",
            createdAt: Date.now() - 5 * 60 * 1000,
            priority: "high",
            status: "open",
            title: "Service deposit review",
            type: "service_deposit_review",
          },
        ]}
      />,
    );

    expect(screen.getAllByText("Unsupported work type").length).toBeGreaterThan(0);
    expect(
      screen.getByText("Service deposit review is not available in Open Work."),
    ).toBeInTheDocument();
    expect(screen.getByText("Not surfaced here")).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /service deposit/i }),
    ).not.toBeInTheDocument();
  });

  it("keeps raw metadata, proof, and internal payloads out of visible open work rows", () => {
    render(
      <OperationsQueueViewContent
        {...baseProps}
        activeWorkflow="queue"
        orgUrlSlug="wigclub"
        storeUrlSlug="wigclub"
        workItems={[
          {
            _id: "work-item-raw-metadata" as Id<"operationalWorkItem">,
            approvalState: "pending",
            createdAt: Date.now() - 5 * 60 * 1000,
            details: {
              businessDate: "2026-07-01",
            },
            priority: "high",
            status: "open",
            title: "daily close carry forward",
            type: "daily_close_carry_forward",
          },
        ]}
      />,
    );

    expect(screen.getAllByText("Daily close follow-up").length).toBeGreaterThan(0);
    expect(screen.queryByText("proof-visible-if-leaked")).not.toBeInTheDocument();
    expect(
      screen.queryByText("card-token-should-stay-server-side"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("raw-sync-json-should-not-render"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("manager-proof-should-not-render"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("store-other-should-not-render"),
    ).not.toBeInTheDocument();
  });

  it("links synced sale inventory work items to manual stock adjustments and resolution", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    const onResolveSyncedSaleInventoryReview = vi.fn();

    render(
      <OperationsQueueViewContent
        {...baseProps}
        activeWorkflow="queue"
        orgUrlSlug="wigclub"
        onResolveSyncedSaleInventoryReview={onResolveSyncedSaleInventoryReview}
        storeUrlSlug="wigclub"
        workItems={[
          {
            _id: "work-item-1" as Id<"operationalWorkItem">,
            approvalState: "not_required",
            createdAt: Date.now() - 5 * 60 * 1000,
            details: {
              inventoryReviewLineCount: 1,
              localRegisterSessionId: "local-register-session-1",
              localTransactionId: "local-transaction-1",
              primaryProductSkuId: "product-sku-1" as Id<"productSku">,
              receiptNumber: "939540",
              registerSessionId: "register-session-1" as Id<"registerSession">,
              sourceId: "transaction-1",
              terminalId: "terminal-1" as Id<"posTerminal">,
            },
            priority: "high",
            status: "open",
            title: "Review inventory for ADORE DYE",
            type: "synced_sale_inventory_review",
          },
        ]}
      />,
    );

    expect(
      screen.getByText((_content, element) =>
        element?.tagName.toLowerCase() === "p" &&
        element.textContent === "Review inventory for Adore Dye",
      ),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Synced sale inventory").length).toBeGreaterThan(0);
    const titleHref = new URL(
      screen
        .getByRole("link", { name: "Adore Dye" })
        .getAttribute("href") ?? "",
      "http://localhost",
    );
    expect(titleHref.pathname).toBe(
      "/$orgUrlSlug/store/$storeUrlSlug/operations/stock-adjustments",
    );
    expect(titleHref.searchParams.get("mode")).toBe("manual");
    expect(titleHref.searchParams.get("sku")).toBe("product-sku-1");
    expect(screen.getByText("Receipt")).toBeInTheDocument();
    const receiptLink = screen.getByRole("link", {
      name: "Open transaction #939540",
    });
    expect(receiptLink).toBeInTheDocument();
    expect(receiptLink).toHaveAttribute(
      "href",
      "/$orgUrlSlug/store/$storeUrlSlug/pos/transactions/$transactionId?o=%252F",
    );
    expect(screen.queryByText("Primary SKU")).not.toBeInTheDocument();
    expect(screen.queryByText("product-sku-1")).not.toBeInTheDocument();
    expect(screen.getByText("Needs action")).toBeInTheDocument();
    expect(screen.getByText("Check stock count")).toBeInTheDocument();
    expect(screen.queryByText("Why")).not.toBeInTheDocument();
    expect(
      screen.queryByText("Sale synced without reducing stock"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Affected sale lines")).not.toBeInTheDocument();
    expect(screen.queryByText("1 line")).not.toBeInTheDocument();
    expect(screen.getByText("High")).toHaveClass(
      "bg-surface",
      "text-muted-foreground",
    );

    await user.click(screen.getByRole("button", { name: "Show details" }));

    expect(screen.getByText("Affected sale lines")).toBeInTheDocument();
    expect(screen.getByText("1 line")).toBeInTheDocument();

    const stockAdjustmentsHref = new URL(
      screen
        .getByRole("link", { name: "Open stock adjustments" })
        .getAttribute("href") ?? "",
      "http://localhost",
    );
    expect(stockAdjustmentsHref.pathname).toBe(
      "/$orgUrlSlug/store/$storeUrlSlug/operations/stock-adjustments",
    );
    expect(stockAdjustmentsHref.searchParams.get("mode")).toBe("manual");
    expect(stockAdjustmentsHref.searchParams.get("sku")).toBe("product-sku-1");

    await user.click(screen.getByRole("button", { name: "Mark reviewed" }));

    expect(onResolveSyncedSaleInventoryReview).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: "work-item-1",
        details: expect.objectContaining({
          localRegisterSessionId: "local-register-session-1",
          localTransactionId: "local-transaction-1",
          receiptNumber: "939540",
          registerSessionId: "register-session-1",
          sourceId: "transaction-1",
          terminalId: "terminal-1",
        }),
        type: "synced_sale_inventory_review",
      }),
    );
  });

  it("does not render synced sale resolution when resolver details are incomplete", () => {
    const onResolveSyncedSaleInventoryReview = vi.fn();

    render(
      <OperationsQueueViewContent
        {...baseProps}
        activeWorkflow="queue"
        orgUrlSlug="wigclub"
        onResolveSyncedSaleInventoryReview={onResolveSyncedSaleInventoryReview}
        storeUrlSlug="wigclub"
        workItems={[
          {
            _id: "work-item-1" as Id<"operationalWorkItem">,
            approvalState: "not_required",
            createdAt: Date.now() - 5 * 60 * 1000,
            details: {
              inventoryReviewLineCount: 1,
              primaryProductSkuId: "product-sku-1" as Id<"productSku">,
              receiptNumber: "939540",
              sourceId: "transaction-1",
            },
            priority: "high",
            status: "open",
            title: "Review inventory for ADORE DYE",
            type: "synced_sale_inventory_review",
          },
        ]}
      />,
    );

    expect(screen.queryByRole("button", { name: "Mark reviewed" })).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Open stock adjustments" }),
    ).toBeInTheDocument();
  });

  it("disables peer synced sale review buttons while one review is resolving", () => {
    render(
      <OperationsQueueViewContent
        {...baseProps}
        activeWorkflow="queue"
        isResolvingSyncedSaleInventoryReviewId={
          "work-item-active" as Id<"operationalWorkItem">
        }
        orgUrlSlug="wigclub"
        onResolveSyncedSaleInventoryReview={vi.fn()}
        storeUrlSlug="wigclub"
        workItems={[
          {
            _id: "work-item-1" as Id<"operationalWorkItem">,
            approvalState: "not_required",
            createdAt: Date.now() - 5 * 60 * 1000,
            details: {
              inventoryReviewLineCount: 1,
              localRegisterSessionId: "local-register-session-1",
              localTransactionId: "local-transaction-1",
              primaryProductSkuId: "product-sku-1" as Id<"productSku">,
              receiptNumber: "939540",
              registerSessionId: "register-session-1" as Id<"registerSession">,
              sourceId: "transaction-1",
              terminalId: "terminal-1" as Id<"posTerminal">,
            },
            priority: "high",
            status: "open",
            title: "Review inventory for ADORE DYE",
            type: "synced_sale_inventory_review",
          },
          {
            _id: "work-item-2" as Id<"operationalWorkItem">,
            approvalState: "not_required",
            createdAt: Date.now() - 4 * 60 * 1000,
            details: {
              inventoryReviewLineCount: 1,
              localRegisterSessionId: "local-register-session-2",
              localTransactionId: "local-transaction-2",
              primaryProductSkuId: "product-sku-2" as Id<"productSku">,
              receiptNumber: "939541",
              registerSessionId: "register-session-1" as Id<"registerSession">,
              sourceId: "transaction-2",
              terminalId: "terminal-1" as Id<"posTerminal">,
            },
            priority: "normal",
            status: "open",
            title: "Review inventory for Lace tint",
            type: "synced_sale_inventory_review",
          },
        ]}
      />,
    );

    const reviewButtons = screen.getAllByRole("button", {
      name: "Mark reviewed",
    });
    expect(reviewButtons).toHaveLength(2);
    expect(reviewButtons[0]).toBeDisabled();
    expect(reviewButtons[1]).toBeDisabled();
  });

  it("hydrates open work page and sort state from controlled search", () => {
    const baseTime = Date.UTC(2026, 5, 28, 12, 0, 0);
    const workItems = Array.from({ length: 6 }, (_, index) => ({
      _id: `work-item-${index + 1}` as Id<"operationalWorkItem">,
      approvalState: "not_required",
      createdAt: baseTime + index * 60 * 1000,
      priority: "normal",
      status: "open",
      title: `Open work item ${index + 1}`,
      type: "service_case",
    }));

    render(
      <OperationsQueueViewContent
        {...baseProps}
        activeWorkflow="queue"
        openWorkSearch={{
          page: 2,
        }}
        workItems={workItems}
      />,
    );

    expect(screen.getByText("Open Work Item 6")).toBeInTheDocument();
    expect(screen.queryByText("Open Work Item 1")).not.toBeInTheDocument();
    expect(screen.getByText("Page 2 of 2")).toBeInTheDocument();
  });

  it("reports open work page changes for route search state", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    const onOpenWorkSearchChange = vi.fn();
    const workItems = Array.from({ length: 6 }, (_, index) => ({
      _id: `work-item-${index + 1}` as Id<"operationalWorkItem">,
      approvalState: "not_required",
      createdAt: Date.now() - index * 60 * 1000,
      priority: "normal",
      status: "open",
      title: `Open work item ${index + 1}`,
      type: "service_case",
    }));

    render(
      <OperationsQueueViewContent
        {...baseProps}
        activeWorkflow="queue"
        onOpenWorkSearchChange={onOpenWorkSearchChange}
        workItems={workItems}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Go to next page" }));

    expect(onOpenWorkSearchChange).toHaveBeenCalledWith({ page: 2 });
  });

  it("does not link synced sale inventory work items without valid SKU metadata", () => {
    render(
      <OperationsQueueViewContent
        {...baseProps}
        activeWorkflow="queue"
        orgUrlSlug="wigclub"
        storeUrlSlug="wigclub"
        workItems={[
          {
            _id: "work-item-1" as Id<"operationalWorkItem">,
            approvalState: "not_required",
            createdAt: Date.now() - 5 * 60 * 1000,
            details: {
              receiptNumber: "939540",
            },
            priority: "high",
            status: "open",
            title: "Review inventory for Ebin Skin Protector Enhanced",
            type: "synced_sale_inventory_review",
          },
        ]}
      />,
    );

    expect(
      screen.queryByRole("link", { name: "Open stock adjustments" }),
    ).not.toBeInTheDocument();
  });

  it("renders synced sale receipt as text when transaction metadata is unavailable", () => {
    render(
      <OperationsQueueViewContent
        {...baseProps}
        activeWorkflow="queue"
        orgUrlSlug="wigclub"
        storeUrlSlug="wigclub"
        workItems={[
          {
            _id: "work-item-1" as Id<"operationalWorkItem">,
            approvalState: "not_required",
            createdAt: Date.now() - 5 * 60 * 1000,
            details: {
              receiptNumber: "939540",
            },
            priority: "high",
            status: "open",
            title: "Review inventory for ADORE DYE",
            type: "synced_sale_inventory_review",
          },
        ]}
      />,
    );

    expect(screen.getByText("#939540")).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Open transaction #939540" }),
    ).not.toBeInTheDocument();
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

  it("renders unsupported approval rows as retire-only actions", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();

    render(
      <OperationsQueueViewContent
        {...baseProps}
        approvalRequests={[
          {
            _id: "approval-legacy" as Id<"approvalRequest">,
            requestType: "service_deposit_review",
            status: "pending",
            workItemTitle: "Legacy deposit review",
          },
        ]}
      />,
    );

    expect(
      screen.getByText(/legacy service deposit review cannot be approved/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /approve/i }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /retire review/i }));

    expect(baseProps.onDecideApprovalRequest).toHaveBeenCalledWith({
      approvalRequestId: "approval-legacy",
      decision: "rejected",
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

  it("renders completed sale void approvals with transaction context and actions", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();

    render(
      <OperationsQueueViewContent
        {...baseProps}
        approvalRequests={[
          {
            _id: "approval-void-1" as Id<"approvalRequest">,
            createdAt: 1_714_620_000_000,
            requestedByStaffName: "Skank Hunt",
            requestType: "pos_transaction_void",
            registerSessionSummary: {
              countedCash: null,
              expectedCash: 50000,
              registerNumber: "8",
              registerSessionId: "register-session-8" as Id<"registerSession">,
              status: "closed",
              terminalName: "Codex",
              variance: null,
            },
            status: "pending",
            transactionSummary: {
              completedAt: 1_714_610_000_000,
              paymentMethod: "cash",
              total: 396000,
              totalPaid: 396000,
              transactionId: "txn-void-1" as Id<"posTransaction">,
              transactionNumber: "158503",
            },
          },
        ]}
        orgUrlSlug="wigclub"
        storeUrlSlug="wigclub"
      />,
    );

    expect(screen.getByText("Completed sale void")).toBeInTheDocument();
    expect(screen.queryByText("Pos Transaction Void")).not.toBeInTheDocument();
    expect(screen.getByText("Completed sale")).toBeInTheDocument();
    expect(
      screen.getByText("Sale queued for manager-approved void"),
    ).toBeInTheDocument();
    expect(screen.getByText("Requested by Skank Hunt")).toBeInTheDocument();
    expect(screen.getByText("#158503")).toBeInTheDocument();
    expect(screen.getByText("Cash")).toBeInTheDocument();
    expect(screen.getByText("GH₵3,960")).toBeInTheDocument();
    expect(screen.getByText("Register session")).toBeInTheDocument();
    expect(screen.getByText("Codex / Register 8")).toBeInTheDocument();
    expect(
      screen.getByText(/manager approval voids the completed sale/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /view register session/i }),
    ).toHaveAttribute(
      "href",
      "/$orgUrlSlug/store/$storeUrlSlug/cash-controls/registers/$sessionId?o=%252F",
    );
    expect(
      screen.getByRole("link", { name: /view transaction/i }),
    ).toHaveAttribute(
      "href",
      "/$orgUrlSlug/store/$storeUrlSlug/pos/transactions/$transactionId?o=%252F",
    );

    await user.click(screen.getByRole("button", { name: /approve void/i }));

    expect(baseProps.onDecideApprovalRequest).toHaveBeenCalledWith({
      approvalRequestId: "approval-void-1",
      decision: "approved",
    });
  });

  it("renders item adjustment approval context and routes decisions", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();

    render(
      <OperationsQueueViewContent
        {...baseProps}
        approvalRequests={[
          {
            _id: "approval-item-1" as Id<"approvalRequest">,
            metadata: {
              adjustedTotal: 15000,
              lineItems: [
                {
                  adjustedQuantity: 1,
                  originalQuantity: 2,
                  productName: "Closure wig",
                  productSkuId: "sku-1" as Id<"productSku">,
                  quantityDelta: -1,
                  sku: "CW-18",
                },
                {
                  adjustedQuantity: 1,
                  originalQuantity: 1,
                  productName: "Unchanged bundle",
                  productSkuId: "sku-2" as Id<"productSku">,
                  quantityDelta: 0,
                  sku: "UB-18",
                },
              ],
              originalTotal: 20000,
              settlementAmount: 5000,
              settlementDirection: "refund",
              settlementMethod: "mobile_money",
              totalDelta: -5000,
              transactionId: "txn-1" as Id<"posTransaction">,
            },
            notes: "Customer only received one unit.",
            registerSessionSummary: {
              countedCash: null,
              expectedCash: 15_000,
              registerNumber: "3",
              registerSessionId: "register-3" as Id<"registerSession">,
              status: "active",
              terminalName: "Front Counter",
              variance: null,
            },
            requestedByStaffName: "Ato Kwamina",
            requestType: "pos_item_adjustment",
            status: "pending",
            transactionSummary: {
              completedAt: 1_714_620_000_000,
              paymentMethod: "cash",
              total: 20000,
              totalPaid: 20000,
              transactionId: "txn-1" as Id<"posTransaction">,
              transactionNumber: "434898",
            },
            workItemTitle: "Review item adjustment",
          },
        ]}
        orgUrlSlug="wigclub"
        storeUrlSlug="wigclub"
      />,
    );

    expect(screen.getAllByText("Review item adjustment").length).toBeGreaterThan(0);
    expect(screen.getByText("#434898")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "#434898" })).toHaveAttribute(
      "href",
      "/$orgUrlSlug/store/$storeUrlSlug/pos/transactions/$transactionId?o=%252F",
    );
    expect(
      screen.getByRole("link", { name: /view register session/i }),
    ).toHaveAttribute(
      "href",
      "/$orgUrlSlug/store/$storeUrlSlug/cash-controls/registers/$sessionId?o=%252F",
    );
    expect(
      screen.getByRole("link", { name: /front counter \/ register 3/i }),
    ).toHaveAttribute(
      "href",
      "/$orgUrlSlug/store/$storeUrlSlug/cash-controls/registers/$sessionId?o=%252F",
    );
    expect(screen.getByText("Original total")).toBeInTheDocument();
    expect(screen.getByText("Adjusted total")).toBeInTheDocument();
    expect(screen.getByText("Register session")).toBeInTheDocument();
    expect(screen.getByText("Refund due")).toBeInTheDocument();
    expect(screen.getByText("Original payment")).toBeInTheDocument();
    expect(screen.getByText("Cash")).toBeInTheDocument();
    expect(screen.getByText("Refund payout")).toBeInTheDocument();
    expect(screen.getByText("Mobile Money")).toBeInTheDocument();
    expect(screen.getByText("Closure wig")).toBeInTheDocument();
    expect(screen.getByText("CW-18")).toBeInTheDocument();
    expect(screen.queryByText("Unchanged bundle")).not.toBeInTheDocument();
    expect(screen.queryByText("UB-18")).not.toBeInTheDocument();
    expect(
      screen.getByText(
        (_, element) =>
          element?.textContent?.replace(/\s+/g, " ").trim() ===
          "2 original to 1 adjusted",
      ),
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: /approve adjustment/i }),
    );

    expect(baseProps.onDecideApprovalRequest).toHaveBeenCalledWith({
      approvalRequestId: "approval-item-1",
      decision: "approved",
    });
  });

  it("disables approval actions while any approval decision is in flight", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();

    render(
      <OperationsQueueViewContent
        {...baseProps}
        isDecidingApprovalRequestId={"approval-item-1" as Id<"approvalRequest">}
        approvalRequests={[
          {
            _id: "approval-item-1" as Id<"approvalRequest">,
            metadata: {
              adjustedTotal: 15000,
              lineItems: [
                {
                  adjustedQuantity: 1,
                  originalQuantity: 2,
                  productName: "Closure wig",
                  productSkuId: "sku-1" as Id<"productSku">,
                  quantityDelta: -1,
                  sku: "CW-18",
                },
              ],
              originalTotal: 20000,
              settlementAmount: 5000,
              settlementDirection: "refund",
              settlementMethod: "cash",
              totalDelta: -5000,
              transactionId: "txn-1" as Id<"posTransaction">,
            },
            requestType: "pos_item_adjustment",
            status: "pending",
            workItemTitle: "Review item adjustment",
          },
          {
            _id: "approval-payment-1" as Id<"approvalRequest">,
            metadata: {
              amount: 19500,
              paymentMethod: "card",
              previousPaymentMethod: "cash",
              transactionId: "txn-2" as Id<"posTransaction">,
            },
            requestType: "payment_method_correction",
            status: "pending",
            workItemTitle: "Payment Method Correction",
          },
        ]}
        orgUrlSlug="wigclub"
        storeUrlSlug="wigclub"
      />,
    );

    const approveButtons = screen.getAllByRole("button", {
      name: /approve/i,
    });
    for (const button of approveButtons) {
      expect(button).toBeDisabled();
      await user.click(button);
    }

    const rejectButtons = screen.getAllByRole("button", {
      name: /reject/i,
    });
    for (const button of rejectButtons) {
      expect(button).toBeDisabled();
      await user.click(button);
    }

    expect(baseProps.onDecideApprovalRequest).not.toHaveBeenCalled();
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

  it("passes register closeout context when deciding variance approvals", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    const onDecideApprovalRequest = vi.fn().mockResolvedValue(undefined);

    render(
      <OperationsQueueViewContent
        {...baseProps}
        approvalRequests={[
          {
            _id: "approval-variance-1" as Id<"approvalRequest">,
            createdAt: 1_714_620_000_000,
            registerSessionSummary: {
              countedCash: 20000,
              expectedCash: 40000,
              registerNumber: "6",
              registerSessionId: "register-6" as Id<"registerSession">,
              status: "closing",
              terminalName: "Safari QA",
              variance: -20000,
            },
            requestType: "variance_review",
            status: "pending",
            workItemTitle: "Variance Review",
          },
        ]}
        onDecideApprovalRequest={onDecideApprovalRequest}
      />,
    );

    await user.click(screen.getByRole("button", { name: /approve variance/i }));

    expect(onDecideApprovalRequest).toHaveBeenCalledWith({
      approvalRequestId: "approval-variance-1",
      decision: "approved",
      registerSessionId: "register-6",
      requestType: "variance_review",
    });
  });

  it("renders synced register activity reviews in approvals", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();

    render(
      <OperationsQueueViewContent
        {...baseProps}
        approvalRequests={[
          {
            _id: "register-sync-review:register-2",
            createdAt: 1_714_620_000_000,
            metadata: {
              conflictCount: 1,
              reviewItems: [
                {
                  id: "sync-conflict-1",
                  localEventId: "event-sale-completed-1",
                  sequence: 2,
                  summary: "Register was not open before this sale synced.",
                  type: "permission",
                },
              ],
            },
            reason: "Register was not open before this sale synced.",
            registerSessionSummary: {
              countedCash: null,
              expectedCash: 50_000,
              registerNumber: "2",
              registerSessionId: "register-2" as Id<"registerSession">,
              status: "active",
              terminalName: "Wigshop",
              variance: null,
            },
            requestType: "register_sync_review",
            status: "pending",
            workItemTitle: "Synced register activity review",
          },
        ]}
        orgUrlSlug="wigclub"
        storeUrlSlug="wigclub"
      />,
    );

    expect(screen.getByText("Synced register activity")).toBeInTheDocument();
    expect(
      screen.getByText("Review local register activity before it is applied to cash controls."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /wigshop \/ register 2/i }),
    ).toHaveAttribute(
      "href",
      "/$orgUrlSlug/store/$storeUrlSlug/cash-controls/registers/$sessionId?o=%252F",
    );
    expect(
      screen.getByText("Register was not open before this sale synced."),
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: /approve synced sales/i }),
    );

    expect(baseProps.onDecideApprovalRequest).toHaveBeenCalledWith({
      approvalRequestId: "register-sync-review:register-2",
      decision: "approved",
      registerSessionId: "register-2",
      requestType: "register_sync_review",
    });
  });

  it("renders the live operations page without the register closeout surface", () => {
    render(<OperationsQueueView activeWorkflow="stock" />);

    expect(screen.getByText("No inventory loaded.")).toBeInTheDocument();
    expect(
      screen.getByText(/inventory appears here once skus are available/i),
    ).toBeInTheDocument();
    expect(screen.queryByText("Operations workspace")).not.toBeInTheDocument();
    expect(screen.queryByText(/register closeouts/i)).not.toBeInTheDocument();
  });

  it("hydrates generic SKU search candidates into the stock adjustment workspace", () => {
    const remoteInventoryItem = {
      _id: "sku-global" as Id<"productSku">,
      inventoryCount: 4,
      productName: "Global Search Wig",
      quantityAvailable: 4,
      sku: "GLOBAL-18",
    };

    mockedHooks.useQuery.mockReset();
    mockedHooks.useQuery
      .mockReturnValueOnce({
        approvalRequests: [],
        workItems: [],
      })
      .mockReturnValueOnce({
        results: [
          {
            productSkuId: remoteInventoryItem._id,
          },
        ],
      })
      .mockReturnValueOnce([remoteInventoryItem])
      .mockReturnValueOnce(undefined)
      .mockReturnValueOnce("skip")
      .mockReturnValueOnce("skip");
    mockedHooks.usePaginatedQuery.mockReturnValue({
      isLoading: false,
      loadMore: vi.fn(),
      results: baseProps.inventoryItems,
      status: "Exhausted",
    });

    render(
      <OperationsQueueView
        activeWorkflow="stock"
        stockAdjustmentSearch={{
          mode: "manual",
          query: "GLOBAL-18",
        }}
      />,
    );

    expect(mockedHooks.useQuery.mock.calls[1]?.[1]).toEqual({
      limit: 75,
      query: "GLOBAL-18",
      storeId: "store-1",
    });
    expect(mockedHooks.useQuery.mock.calls[2]?.[1]).toEqual({
      productSkuIds: ["sku-global"],
      storeId: "store-1",
    });
    expect(screen.getAllByText("Global Search Wig").length).toBeGreaterThan(0);
  });

  it("hydrates a stock-adjustment route SKU even when it is not in the first inventory page", async () => {
    const linkedInventoryItem = {
      _id: "sku-linked" as Id<"productSku">,
      inventoryCount: 7,
      productName: "Linked Register SKU",
      quantityAvailable: 7,
      sku: "LINKED-7",
    };

    mockedHooks.useQuery.mockReset();
    mockedHooks.useQuery.mockImplementation((_query: unknown, args: unknown) => {
      if (args === "skip") return undefined;
      if (
        args &&
        typeof args === "object" &&
        "productSkuIds" in args
      ) {
        return [linkedInventoryItem];
      }
      if (
        args &&
        typeof args === "object" &&
        "query" in args &&
        "limit" in args
      ) {
        return {
          candidateOverflow: false,
          results: [],
          truncated: false,
        };
      }
      if (args && typeof args === "object" && "storeId" in args) {
        return {
          approvalRequests: [],
          availableUnits: 7,
          checkoutReservedUnits: 0,
          fallbackReservedUnits: 0,
          hasMoreSkus: false,
          onHandUnits: 7,
          posReservedUnits: 0,
          reservedUnits: 0,
          skuCount: 1,
          unavailableSkuCount: 0,
          unavailableUnits: 0,
          workItems: [],
        };
      }

      return undefined;
    });
    mockedHooks.usePaginatedQuery.mockReturnValue({
      isLoading: false,
      loadMore: vi.fn(),
      results: [],
      status: "Exhausted",
    });

    render(
      <OperationsQueueView
        activeWorkflow="stock"
        stockAdjustmentSearch={{
          mode: "manual",
          sku: "sku-linked",
        }}
      />,
    );

    expect(mockedHooks.useQuery.mock.calls[1]?.[1]).toBe("skip");
    expect(mockedHooks.useQuery.mock.calls[2]?.[1]).toEqual({
      productSkuIds: ["sku-linked"],
      storeId: "store-1",
    });
    cleanup();

    render(
      <OperationsQueueViewContent
        {...baseProps}
        activeWorkflow="stock"
        inventoryItems={[linkedInventoryItem]}
        inventoryUnitSummary={{
          availableUnits: 7,
          checkoutReservedUnits: 0,
          fallbackReservedUnits: 0,
          hasMoreSkus: false,
          onHandUnits: 7,
          posReservedUnits: 0,
          reservedUnits: 0,
          skuCount: 1,
          unavailableSkuCount: 0,
          unavailableUnits: 0,
        }}
        stockAdjustmentSearch={{
          mode: "manual",
          sku: "sku-linked",
        }}
      />,
    );
    expect(screen.getAllByText("Linked Register Sku").length).toBeGreaterThan(
      0,
    );
    expect(
      screen.getByRole("spinbutton", {
        name: /adjustment delta for linked register sku/i,
      }),
    ).toBeInTheDocument();
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
    mockedHooks.useMutation.mockImplementation(
      () => async (args: Record<string, unknown>) => {
        if ("actionKey" in args) {
          return authenticateStaffCredentialForApproval(args);
        }
        if ("approvalRequestId" in args) {
          return decideApprovalRequest(args);
        }
        if ("username" in args) {
          return authenticateStaffCredential(args);
        }
        return submitStockBatch(args);
      },
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
        pinHash: "hashed:1234",
        storeId: "store-1",
        username: "manager",
      }),
    );

    await user.click(screen.getByRole("button", { name: /approve batch/i }));

    await waitFor(() =>
      expect(authenticateStaffCredentialForApproval).toHaveBeenCalledWith({
        actionKey: "operations.approval_request.decide",
        pinHash: "hashed:1234",
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

  it("loads or creates the default SKU cycle-count draft", async () => {
    const ensureCycleCountDraft = vi.fn().mockResolvedValue(ok({}));

    mockedHooks.useMutation.mockReset();
    mockedHooks.useQuery.mockReset();
    mockedHooks.useMutation.mockReturnValue(vi.fn());
    mockedHooks.useMutation
      .mockReturnValueOnce(vi.fn())
      .mockReturnValueOnce(vi.fn())
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
      .mockReturnValueOnce(undefined)
      .mockReturnValueOnce(undefined)
      .mockReturnValueOnce(undefined)
      .mockReturnValueOnce(null);
    mockedHooks.usePaginatedQuery.mockReturnValue({
      isLoading: false,
      loadMore: vi.fn(),
      results: baseProps.inventoryItems,
      status: "Exhausted",
    });

    render(
      <OperationsQueueView
        stockAdjustmentSearch={{
          mode: "cycle_count",
        }}
      />,
    );

    expect(mockedHooks.useQuery.mock.calls[4]?.[1]).toEqual({
      scopeKey: "__uncategorized",
      storeId: "store-1",
    });
    expect(mockedHooks.useQuery.mock.calls[5]?.[1]).toEqual({
      storeId: "store-1",
    });
    await waitFor(() =>
      expect(ensureCycleCountDraft).toHaveBeenCalledWith({
        scopeKey: "__uncategorized",
        storeId: "store-1",
      }),
    );
  });

  it("infers the cycle-count scope from a selected SKU", async () => {
    const ensureCycleCountDraft = vi.fn().mockResolvedValue(ok({}));
    const inventoryItems = [
      {
        ...baseProps.inventoryItems[0],
        productCategory: "POS quick add",
      },
    ];

    mockedHooks.useMutation.mockReset();
    mockedHooks.useQuery.mockReset();
    mockedHooks.useMutation.mockReturnValue(vi.fn());
    mockedHooks.useMutation
      .mockReturnValueOnce(vi.fn())
      .mockReturnValueOnce(vi.fn())
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
      .mockReturnValueOnce(undefined)
      .mockReturnValueOnce(undefined)
      .mockReturnValueOnce(undefined)
      .mockReturnValueOnce(null);
    mockedHooks.usePaginatedQuery.mockReturnValue({
      isLoading: false,
      loadMore: vi.fn(),
      results: inventoryItems,
      status: "Exhausted",
    });

    render(
      <OperationsQueueView
        stockAdjustmentSearch={{
          mode: "cycle_count",
          sku: "sku-1",
        }}
      />,
    );

    expect(mockedHooks.useQuery.mock.calls[4]?.[1]).toEqual({
      scopeKey: "POS quick add",
      storeId: "store-1",
    });
    await waitFor(() =>
      expect(ensureCycleCountDraft).toHaveBeenCalledWith({
        scopeKey: "POS quick add",
        storeId: "store-1",
      }),
    );
    expect(screen.getAllByText("POS quick add").length).toBeGreaterThan(0);
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
      .mockReturnValueOnce(undefined);
    mockedHooks.usePaginatedQuery.mockReturnValue({
      isLoading: false,
      loadMore: vi.fn(),
      results: baseProps.inventoryItems,
      status: "Exhausted",
    });

    render(
      <OperationsQueueView
        stockAdjustmentSearch={{
          mode: "manual",
        }}
      />,
    );

    expect(mockedHooks.useQuery.mock.calls[4]?.[1]).toBe("skip");
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
    mockedHooks.useMutation.mockImplementation(
      () => async (args: Record<string, unknown>) => {
        if ("actionKey" in args) {
          return authenticateStaffCredentialForApproval(args);
        }
        if ("approvalRequestId" in args) {
          return decideApprovalRequest(args);
        }
        if ("username" in args) {
          return authenticateStaffCredential(args);
        }
        return submitStockBatch(args);
      },
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

    render(<OperationsQueueView activeWorkflow="approvals" />);

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

  it("surfaces approval command user errors from sale adjustments", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    const submitStockBatch = vi.fn();
    const decideApprovalRequest = vi.fn().mockResolvedValue({
      kind: "user_error",
      error: {
        code: "precondition_failed",
        message:
          "This transaction already has an item adjustment waiting for approval.",
      },
    });
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
    mockedHooks.useMutation.mockImplementation(
      () => async (args: Record<string, unknown>) => {
        if ("actionKey" in args) {
          return authenticateStaffCredentialForApproval(args);
        }
        if ("approvalRequestId" in args) {
          return decideApprovalRequest(args);
        }
        if ("username" in args) {
          return authenticateStaffCredential(args);
        }
        return submitStockBatch(args);
      },
    );
    const queueSnapshot = {
      approvalRequests: [
        {
          _id: "approval-1",
          requestType: "pos_item_adjustment",
          status: "pending",
          workItemTitle: "Item adjustment review",
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

    render(<OperationsQueueView activeWorkflow="approvals" />);

    await user.click(screen.getByRole("button", { name: /unlock approvals/i }));
    await user.click(
      within(
        screen.getByRole("dialog", { name: /unlock approval decisions/i }),
      ).getByRole("button", { name: /unlock approvals/i }),
    );
    await waitFor(() => expect(authenticateStaffCredential).toHaveBeenCalled());

    await user.click(
      screen.getByRole("button", { name: /approve adjustment/i }),
    );

    await waitFor(() =>
      expect(mockedToast.error).toHaveBeenCalledWith(
        "This transaction already has an item adjustment waiting for approval.",
      ),
    );
    expect(mockedToast.error).not.toHaveBeenCalledWith("Please try again.");
  });

  it("resolves closeout variance approvals through the register closeout review mutation", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    const decideApprovalRequest = vi.fn().mockResolvedValue(ok({}));
    const reviewRegisterSessionCloseout = vi.fn().mockResolvedValue(ok({}));
    const authenticateStaffCredential = vi.fn().mockResolvedValue(
      ok({
        activeRoles: ["manager"],
        staffProfile: {},
        staffProfileId: "staff-manager-1",
      }),
    );
    const authenticateStaffCredentialForApproval = vi.fn().mockResolvedValue(
      ok({
        approvalProofId: "proof-variance-1",
        approvedByStaffProfileId: "staff-manager-1",
        expiresAt: Date.now() + 60_000,
      }),
    );

    mockedHooks.useMutation.mockReset();
    mockedHooks.useMutation.mockImplementation((functionReference) => {
      const functionName = getFunctionName(functionReference as never);

      if (functionName === "operations/approvalRequests:decideApprovalRequest") {
        return decideApprovalRequest;
      }

      if (
        functionName ===
        "operations/staffCredentials:authenticateStaffCredential"
      ) {
        return authenticateStaffCredential;
      }

      if (
        functionName ===
        "operations/staffCredentials:authenticateStaffCredentialForApproval"
      ) {
        return authenticateStaffCredentialForApproval;
      }

      if (
        functionName ===
        "cashControls/closeouts:reviewRegisterSessionCloseout"
      ) {
        return reviewRegisterSessionCloseout;
      }

      return vi.fn();
    });
    const queueSnapshot = {
      approvalRequests: [
        {
          _id: "approval-variance-1",
          registerSessionSummary: {
            countedCash: 20000,
            expectedCash: 40000,
            registerNumber: "6",
            registerSessionId: "register-6",
            status: "closing",
            terminalName: "Safari QA",
            variance: -20000,
          },
          requestType: "variance_review",
          status: "pending",
          workItemTitle: "Variance Review",
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

    render(<OperationsQueueView activeWorkflow="approvals" />);

    await user.click(screen.getByRole("button", { name: /unlock approvals/i }));
    await user.click(
      within(
        screen.getByRole("dialog", { name: /unlock approval decisions/i }),
      ).getByRole("button", { name: /unlock approvals/i }),
    );
    await waitFor(() => expect(authenticateStaffCredential).toHaveBeenCalled());

    await user.click(screen.getByRole("button", { name: /approve variance/i }));

    await waitFor(() =>
      expect(authenticateStaffCredentialForApproval).toHaveBeenCalledWith({
        actionKey: "cash_controls.register_session.review_variance",
        pinHash: "hashed:1234",
        reason: "Resolve pending approval request.",
        requiredRole: "manager",
        storeId: "store-1",
        subject: {
          id: "register-6",
          label: "6",
          type: "register_session",
        },
        username: "manager",
      }),
    );
    await waitFor(() =>
      expect(reviewRegisterSessionCloseout).toHaveBeenCalledWith({
        approvalProofId: "proof-variance-1",
        decision: "approved",
        registerSessionId: "register-6",
        storeId: "store-1",
      }),
    );
    expect(decideApprovalRequest).not.toHaveBeenCalled();
  });

  it("resolves synced register reviews with the minted approval proof", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    const decideApprovalRequest = vi.fn().mockResolvedValue(ok({}));
    const resolveRegisterSessionSyncReview = vi.fn().mockResolvedValue(ok({}));
    const authenticateStaffCredential = vi.fn().mockResolvedValue(
      ok({
        activeRoles: ["manager"],
        staffProfile: {},
        staffProfileId: "staff-manager-1",
      }),
    );
    const authenticateStaffCredentialForApproval = vi.fn().mockResolvedValue(
      ok({
        approvalProofId: "proof-sync-1",
        approvedByStaffProfileId: "staff-manager-1",
        expiresAt: Date.now() + 60_000,
      }),
    );

    mockedHooks.useMutation.mockReset();
    mockedHooks.useMutation.mockImplementation((functionReference) => {
      const functionName = getFunctionName(functionReference as never);

      if (functionName === "operations/approvalRequests:decideApprovalRequest") {
        return decideApprovalRequest;
      }

      if (
        functionName === "cashControls/deposits:resolveRegisterSessionSyncReview"
      ) {
        return resolveRegisterSessionSyncReview;
      }

      if (
        functionName ===
        "operations/staffCredentials:authenticateStaffCredential"
      ) {
        return authenticateStaffCredential;
      }

      if (
        functionName ===
        "operations/staffCredentials:authenticateStaffCredentialForApproval"
      ) {
        return authenticateStaffCredentialForApproval;
      }

      return vi.fn();
    });
    const queueSnapshot = {
      approvalRequests: [
        {
          _id: "register-sync-review:register-2",
          registerSessionSummary: {
            countedCash: null,
            expectedCash: 50_000,
            registerNumber: "2",
            registerSessionId: "register-2",
            status: "active",
            terminalName: "Wigshop",
            variance: null,
          },
          requestType: "register_sync_review",
          status: "pending",
          workItemTitle: "Synced register activity review",
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

    render(<OperationsQueueView activeWorkflow="approvals" />);

    await user.click(screen.getByRole("button", { name: /unlock approvals/i }));
    await user.click(
      within(
        screen.getByRole("dialog", { name: /unlock approval decisions/i }),
      ).getByRole("button", { name: /unlock approvals/i }),
    );
    await waitFor(() => expect(authenticateStaffCredential).toHaveBeenCalled());

    await user.click(
      screen.getByRole("button", { name: /approve synced sales/i }),
    );

    await waitFor(() =>
      expect(authenticateStaffCredentialForApproval).toHaveBeenCalledWith({
        actionKey: "cash_controls.register_session.resolve_sync_review",
        pinHash: "hashed:1234",
        reason: "Resolve pending approval request.",
        requiredRole: "manager",
        storeId: "store-1",
        subject: {
          id: "register-2",
          label: "2",
          type: "register_session",
        },
        username: "manager",
      }),
    );
    await waitFor(() =>
      expect(resolveRegisterSessionSyncReview).toHaveBeenCalledWith({
        approvalProofId: "proof-sync-1",
        decision: "approved",
        registerSessionId: "register-2",
        storeId: "store-1",
      }),
    );
    expect(decideApprovalRequest).not.toHaveBeenCalled();
  });
});
