import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  GENERIC_UNEXPECTED_ERROR_MESSAGE,
  ok,
  userError,
} from "~/shared/commandResult";

import {
  RegisterSessionView,
  RegisterSessionViewContent,
} from "./RegisterSessionView";

const routerMocks = vi.hoisted(() => ({
  navigate: vi.fn(),
}));
const convexMocks = vi.hoisted(() => ({
  useMutation: vi.fn(),
  useQuery: vi.fn(),
}));
const authMocks = vi.hoisted(() => ({
  useAuth: vi.fn(),
}));
const protectedPageMocks = vi.hoisted(() => ({
  useProtectedAdminPageState: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    params,
    search,
    to,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & {
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
  useNavigate: () => routerMocks.navigate,
  useParams: () => ({
    orgUrlSlug: "org",
    sessionId: "session-1",
    storeUrlSlug: "store",
  }),
}));

vi.mock("convex/react", () => convexMocks);

vi.mock("@/hooks/useAuth", () => authMocks);

vi.mock("@/hooks/useProtectedAdminPageState", () => protectedPageMocks);

vi.mock("../common/PageHeader", () => ({
  ComposedPageHeader: ({
    className,
    leadingContent,
    trailingContent,
  }: {
    className?: string;
    leadingContent: React.ReactNode;
    trailingContent?: React.ReactNode;
  }) => (
    <div className={className} data-testid="register-session-page-header">
      <div>{leadingContent}</div>
      <div>{trailingContent}</div>
    </div>
  ),
}));

vi.mock("@/components/staff-auth/StaffAuthenticationDialog", () => ({
  StaffAuthenticationDialog: ({
    copy,
    onAuthenticate,
    onAuthenticated,
    open,
  }: {
    copy: { submitLabel: string };
    onAuthenticate: (args: {
      mode: "authenticate";
      pinHash: string;
      username: string;
    }) => Promise<unknown>;
    onAuthenticated: (
      result: {
        activeRoles?: string[];
        approvalProofId?: string;
        staffProfile: { fullName: string };
        staffProfileId: string;
      },
      mode: "authenticate",
      credentials: { pinHash: string; username: string },
    ) => void;
    open: boolean;
  }) =>
    open ? (
      <button
        type="button"
        onClick={async () => {
          const result = await onAuthenticate({
            mode: "authenticate",
            pinHash: "hashed-pin",
            username: "ato",
          });
          const authenticatedResult =
            typeof result === "object" &&
            result !== null &&
            "kind" in result &&
            result.kind === "ok" &&
            "data" in result
              ? (result.data as {
                  activeRoles?: string[];
                  approvalProofId?: string;
                  staffProfile: { fullName: string };
                  staffProfileId: string;
                })
              : {
                  staffProfile: { fullName: "Ato Kofi" },
                  staffProfileId: "staff-1",
                };
          onAuthenticated(authenticatedResult, "authenticate", {
            pinHash: "hashed-pin",
            username: "ato",
          });
        }}
      >
        Confirm staff for {copy.submitLabel}
      </button>
    ) : null,
}));

vi.mock("@/components/operations/CommandApprovalDialog", () => ({
  CommandApprovalDialog: ({
    approval,
    onApproved,
    onAuthenticateForApproval,
    open,
  }: {
    approval: {
      action: { key: string };
      copy: { primaryActionLabel?: string };
      requiredRole: "manager";
      subject: { id: string; label?: string; type: string };
    } | null;
    onApproved: (result: {
      approval: unknown;
      approvalProofId: string;
      approvedByStaffProfileId: string;
      expiresAt: number;
    }) => void;
    onAuthenticateForApproval: (args: {
      actionKey: string;
      pinHash: string;
      requiredRole: "manager";
      storeId: string;
      subject: { id: string; label?: string; type: string };
      username: string;
    }) => Promise<unknown>;
    open: boolean;
  }) =>
    open && approval ? (
      <button
        type="button"
        onClick={async () => {
          const result = await onAuthenticateForApproval({
            actionKey: approval.action.key,
            pinHash: "hashed-pin",
            requiredRole: approval.requiredRole,
            storeId: "store-1",
            subject: approval.subject,
            username: "manager",
          });
          const approvedResult =
            typeof result === "object" &&
            result !== null &&
            "kind" in result &&
            result.kind === "ok" &&
            "data" in result
              ? (result.data as {
                  approvalProofId: string;
                  approvedByStaffProfileId: string;
                  expiresAt: number;
                })
              : {
                  approvalProofId: "approval-proof-1",
                  approvedByStaffProfileId: "manager-1",
                  expiresAt: Date.now() + 60_000,
                };
          onApproved({
            approval,
            approvalProofId: approvedResult.approvalProofId,
            approvedByStaffProfileId: approvedResult.approvedByStaffProfileId,
            expiresAt: approvedResult.expiresAt,
          });
        }}
      >
        {approval.copy.primaryActionLabel ?? "Approve"}
      </button>
    ) : null,
}));

const baseSnapshot = {
  closeoutReview: null as {
    hasVariance: boolean;
    reason?: string | null;
    requiresApproval: boolean;
    variance: number;
  } | null,
  deposits: [] as Array<{
    _id: string;
    amount: number;
    notes?: string | null;
    recordedAt: number;
    recordedByStaffName?: string | null;
    reference?: string | null;
    registerSessionId?: string | null;
  }>,
  transactions: [] as Array<{
    _id: string;
    cashierName?: string | null;
    completedAt: number;
    customerName?: string | null;
    hasMultiplePaymentMethods?: boolean;
    itemCount: number;
    paymentMethod?: string | null;
    status?: "completed" | "void" | string | null;
    total: number;
    transactionNumber: string;
    voidedAt?: number | null;
    workflowTraceId?: string | null;
  }>,
  registerSession: {
    _id: "session-1",
    countedCash: 17100,
    expectedCash: 17600,
    netExpectedCash: 17600,
    openedAt: new Date("2026-04-21T09:15:00.000Z").getTime(),
    openedByStaffName: "Ama Mensah",
    openingFloat: 5000,
    pendingApprovalRequest: null,
    registerNumber: "Register 3",
    status: "closing",
    terminalName: "Front counter",
    totalDeposited: 2400,
    variance: -500,
    workflowTraceId: "register_session:reg-3",
  },
};

describe("RegisterSessionViewContent", () => {
  beforeEach(() => {
    authMocks.useAuth.mockReset();
    convexMocks.useMutation.mockReset();
    convexMocks.useQuery.mockReset();
    protectedPageMocks.useProtectedAdminPageState.mockReset();
    routerMocks.navigate.mockReset();
    window.scrollTo = vi.fn();
  });

  const closeoutHandlers = {
    onAuthenticateCloseoutReviewApproval: vi.fn(),
    onAuthenticateStaff: vi.fn(),
    onCorrectOpeningFloat: vi.fn(),
    onReviewCloseout: vi.fn(),
    onSubmitCloseout: vi.fn(),
  };

  it("renders the register summary, closeout review, and deposits", () => {
    render(
      <RegisterSessionViewContent
        actorStaffProfileId="staff-1"
        actorUserId="user-1"
        currency="USD"
        isLoading={false}
        onRecordDeposit={vi.fn()}
        {...closeoutHandlers}
        registerSessionSnapshot={{
          closeoutReview: {
            hasVariance: true,
            reason: "Variance review required.",
            requiresApproval: true,
            variance: -500,
          },
          deposits: [
            {
              _id: "deposit-1",
              amount: 2400,
              notes: "Evening drop",
              recordedAt: new Date("2026-04-21T18:10:00.000Z").getTime(),
              recordedByStaffName: "Kojo Mensimah",
              reference: "BANK-339",
              registerSessionId: "session-1",
            },
          ],
          transactions: [
            {
              _id: "transaction-1",
              cashierName: "Ama Mensah",
              completedAt: new Date("2026-04-21T17:30:00.000Z").getTime(),
              customerName: "Esi Boateng",
              hasMultiplePaymentMethods: false,
              itemCount: 3,
              paymentMethod: "cash",
              total: 15200,
              transactionNumber: "TXN-0031",
              workflowTraceId: "pos_session:txn-31",
            },
          ],
          registerSession: baseSnapshot.registerSession,
        }}
        orgUrlSlug="wigclub"
        storeId="store-1"
        storeUrlSlug="wigclub"
      />,
    );

    expect(screen.getAllByText("Register 3").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Front counter").length).toBeGreaterThan(0);
    expect(screen.getByText("Session")).toBeInTheDocument();
    expect(screen.getByText("Code")).toBeInTheDocument();
    expect(screen.getAllByText("SION-1").length).toBeGreaterThan(0);
    expect(screen.getByText("Cash position")).toBeInTheDocument();
    expect(screen.getByText("Opened")).toBeInTheDocument();
    expect(
      screen.getByText((_, element) =>
        Boolean(
          element?.tagName === "DD" &&
          element.textContent?.replace(/\s+/g, " ").trim() === "By Ama M.",
        ),
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Activity")).toBeInTheDocument();
    expect(screen.getByText("1 linked sale")).toBeInTheDocument();
    expect(screen.getByText("Closeout")).toBeInTheDocument();
    expect(screen.getByText("Closeout in progress")).toBeInTheDocument();
    expect(screen.getByText("Opening float")).toBeInTheDocument();
    expect(screen.getByText("$50")).toBeInTheDocument();
    expect(screen.getByText("Counted")).toBeInTheDocument();
    expect(screen.getAllByText("$171").length).toBeGreaterThan(0);
    expect(screen.getByText("Linked transactions")).toBeInTheDocument();
    const transactionRow = screen.getAllByRole("link", {
      name: "Open transaction #TXN-0031",
    })[0];
    expect(transactionRow).toBeInTheDocument();
    const transactionDetails = within(transactionRow);
    expect(transactionDetails.getByText("Payment")).toHaveClass(
      "text-xs",
      "tracking-[0.12em]",
    );
    expect(transactionDetails.getByText("Cash")).toHaveClass("text-sm");
    expect(screen.getAllByText(/3 items - Esi Boateng/i).length).toBeGreaterThan(
      0,
    );
    expect(screen.getAllByText("Ama M.").length).toBeGreaterThan(0);
    expect(screen.getByText("Variance review required.")).toBeInTheDocument();
    expect(screen.getByText("Closeout workflow")).toBeInTheDocument();
    expect(screen.getByText("Counted cash ($)")).toBeInTheDocument();
    expect(screen.getByLabelText("Closeout counted cash")).toHaveValue(171);
    expect(screen.getByRole("button", { name: "Submit closeout" })).toHaveClass(
      "bg-action-workflow",
    );
    expect(screen.getByText("Deposit history")).toBeInTheDocument();
    expect(screen.getByText("Record cash deposit")).toBeInTheDocument();
    expect(screen.getAllByText("BANK-339").length).toBeGreaterThan(0);
    expect(
      screen.getByRole("link", { name: "View trace" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("register-session-page-header")).toHaveClass(
      "h-auto",
      "min-h-14",
      "items-start",
      "border-b",
      "py-3",
      "sm:h-[40px]",
    );
    expect(screen.getByRole("link", { name: "View trace" })).not.toHaveClass(
      "w-full",
    );
  });

  it("shows locally closed pending-sync sessions as pending reconciliation", () => {
    render(
      <RegisterSessionViewContent
        currency="GHS"
        isLoading={false}
        onRecordDeposit={vi.fn()}
        {...closeoutHandlers}
        registerSessionSnapshot={{
          ...baseSnapshot,
          registerSession: {
            ...baseSnapshot.registerSession,
            localSyncStatus: {
              status: "locally_closed_pending_sync",
              pendingEventCount: 4,
            },
          },
        }}
      />,
    );

    expect(
      screen.getAllByText("Pending reconciliation")[0],
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "This register was closed locally. Athena will reconcile the closeout after sync.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("4 pending")).toBeInTheDocument();
  });

  it("links support evidence without treating stale terminal status as review work", () => {
    render(
      <RegisterSessionViewContent
        currency="GHS"
        isLoading={false}
        onRecordDeposit={vi.fn()}
        {...closeoutHandlers}
        registerSessionSnapshot={{
          ...baseSnapshot,
          registerSession: {
            ...baseSnapshot.registerSession,
            localSyncStatus: {
              description: "Terminal check-in is waiting for a fresh upload.",
              status: "terminal_stale",
            },
          },
        }}
      />,
    );

    expect(screen.getByText("Support evidence")).toBeInTheDocument();
    expect(screen.getAllByText("Front counter").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Pending sync")[0]).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Open support trace" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Needs review")).not.toBeInTheDocument();
  });

  it("shows reconciliation review with fallback copy for unknown types", () => {
    render(
      <RegisterSessionViewContent
        currency="GHS"
        isLoading={false}
        onRecordDeposit={vi.fn()}
        {...closeoutHandlers}
        registerSessionSnapshot={{
          ...baseSnapshot,
          registerSession: {
            ...baseSnapshot.registerSession,
            localSyncStatus: {
              status: "needs_review",
              reconciliationItems: [
                {
                  summary: "Review synced register activity.",
                  type: "unexpected_reconciliation_kind",
                },
              ],
            },
          },
        }}
      />,
    );

    expect(screen.getAllByText("Needs review")[0]).toBeInTheDocument();
    expect(
      screen.getByText("1 review item needs manager review."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Types: Reconciliation review."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Reasons: Review synced register activity."),
    ).toBeInTheDocument();
  });

  it("surfaces rejected server sync activity with manager override recovery", () => {
    render(
      <RegisterSessionViewContent
        currency="GHS"
        isLoading={false}
        onRecordDeposit={vi.fn()}
        {...closeoutHandlers}
        onResolveSyncReview={vi.fn()}
        orgUrlSlug="org"
        registerSessionSnapshot={{
          ...baseSnapshot,
          registerSession: {
            ...baseSnapshot.registerSession,
            localSyncStatus: {
              status: "needs_review",
              reconciliationItems: [
                {
                  localEventId: "event-rejected-sale",
                  sequence: 10,
                  status: "rejected",
                  summary: "Register was closed before this sale synced.",
                  type: "server_rejected",
                },
              ],
            },
          },
        }}
        storeUrlSlug="store"
      />,
    );

    expect(screen.getByText("Manager override available")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Rejected local activity can be synced from Cash Controls. A manager can override and apply these events without the cashier present.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Manager sign-in applies the rejected local events to this drawer and records the override for audit.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText("1 review item rejected by the server."),
    ).toBeInTheDocument();
    expect(screen.getByText("Local queue #10.")).toBeInTheDocument();
    expect(
      screen.queryByText("Register was closed before this sale synced."),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("Synced activity rejected"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /approve synced sales/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /reject synced activity/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Override and sync events" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Open POS to retry sync" }),
    ).not.toBeInTheDocument();
  });

  it("does not offer closeout review actions for already rejected closeout evidence", () => {
    render(
      <RegisterSessionViewContent
        currency="GHS"
        isLoading={false}
        onRecordDeposit={vi.fn()}
        {...closeoutHandlers}
        onResolveSyncReview={vi.fn()}
        orgUrlSlug="org"
        registerSessionSnapshot={{
          ...baseSnapshot,
          registerSession: {
            ...baseSnapshot.registerSession,
            localSyncStatus: {
              status: "needs_review",
              reconciliationItems: [
                {
                  localEventId: "event-register-closeout-1",
                  sequence: 10,
                  status: "rejected",
                  summary:
                    "Manager rejected synced register activity during cash-controls review.",
                  type: "register_closeout",
                  variance: 2500,
                },
              ],
            },
          },
        }}
        storeUrlSlug="store"
      />,
    );

    expect(screen.getByText("Manager override available")).toBeInTheDocument();
    expect(
      screen.queryByText("Closeout variance review"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText("1 review item rejected by the server."),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /reject synced closeout/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /approve synced closeout/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Override and sync events" }),
    ).toBeInTheDocument();
  });

  it("communicates synced closeout variance review as closeout work", () => {
    render(
      <RegisterSessionViewContent
        currency="GHS"
        isLoading={false}
        onRecordDeposit={vi.fn()}
        {...closeoutHandlers}
        onResolveSyncReview={vi.fn()}
        registerSessionSnapshot={{
          ...baseSnapshot,
          registerSession: {
            ...baseSnapshot.registerSession,
            countedCash: undefined,
            status: "active",
            variance: undefined,
            localSyncStatus: {
              status: "needs_review",
              reconciliationItems: [
                {
                  countedCash: 16100,
                  createdAt: new Date("2026-05-20T14:30:00.000Z").getTime(),
                  expectedCash: 17600,
                  id: "sync_conflict_closeout",
                  localEventId: "event-register-closeout-1",
                  sequence: 7,
                  status: "needs_review",
                  summary:
                    "Register closeout variance requires manager review before synced closeout can be applied.",
                  type: "permission",
                  variance: -1500,
                },
              ],
            },
          },
        }}
      />,
    );

    expect(screen.getAllByText("Closeout review pending")).toHaveLength(3);
    expect(
      within(screen.getByRole("banner")).queryByText("Closeout review"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(
        "Synced closeout not applied yet; manager approval is required.",
      ),
    ).toBeInTheDocument();
    expect(screen.getAllByText("GH₵161")).toHaveLength(2);
    expect(screen.queryByText("Pending review")).not.toBeInTheDocument();
    expect(screen.getAllByText("GH₵-15")).toHaveLength(2);
    expect(screen.getByText("Closeout needs review")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Synced register closeout has a variance. Review it before this closeout can be applied.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Closeout variance review")).toBeInTheDocument();
    expect(screen.getByText("Variance: GH₵-15.")).toBeInTheDocument();
    expect(
      screen.queryByText(
        "Register closeout variance requires manager review before synced closeout can be applied.",
      ),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("1 review item")).not.toBeInTheDocument();
    expect(
      screen.queryByText(
        "Register closeout with variance came from local register activity.",
      ),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(
        "Opening float corrections are unavailable while synced closeout review is pending.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Synced count is waiting for review."),
    ).toBeInTheDocument();
    expect(
      screen.queryByLabelText("Closeout counted cash"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Submit closeout" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Approve synced closeout" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Reject synced closeout" }),
    ).toBeInTheDocument();
  });

  it("communicates synced closeouts that cannot be applied as reject-only", () => {
    render(
      <RegisterSessionViewContent
        currency="GHS"
        isLoading={false}
        onRecordDeposit={vi.fn()}
        {...closeoutHandlers}
        onResolveSyncReview={vi.fn()}
        registerSessionSnapshot={{
          ...baseSnapshot,
          registerSession: {
            ...baseSnapshot.registerSession,
            status: "closed",
            localSyncStatus: {
              status: "needs_review",
              reconciliationItems: [
                {
                  createdAt: new Date("2026-05-20T14:30:00.000Z").getTime(),
                  id: "sync_conflict_closed_closeout",
                  localEventId: "event-register-closed-1",
                  sequence: 2,
                  status: "needs_review",
                  summary:
                    "Register session is not open for synced POS closeout.",
                  type: "permission",
                },
              ],
            },
          },
        }}
      />,
    );

    expect(
      screen.getByText("Synced closeout cannot be applied"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "This register is already closed. Reject the duplicate synced activity to clear the review.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Duplicate closeout")).toBeInTheDocument();
    expect(
      screen.getByText(
        "The synced closeout is from local activity for a register that is already closed.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Approve synced sales" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Approve synced closeout" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Reject synced closeout" }),
    ).toBeInTheDocument();
  });

  it("combines synced register review items with safe event evidence", () => {
    const createdAt = new Date("2026-05-20T14:30:00.000Z").getTime();

    render(
      <RegisterSessionViewContent
        currency="GHS"
        isLoading={false}
        onRecordDeposit={vi.fn()}
        {...closeoutHandlers}
        registerSessionSnapshot={{
          ...baseSnapshot,
          registerSession: {
            ...baseSnapshot.registerSession,
            localSyncStatus: {
              status: "needs_review",
              reconciliationItems: [
                {
                  createdAt,
                  id: "sync_conflict_permission",
                  localEventId: "event-sale-completed-2",
                  sequence: 12,
                  status: "needs_review",
                  summary: "Register was not open before this sale synced.",
                  type: "permission",
                },
                {
                  createdAt,
                  id: "sync_conflict_payment",
                  localEventId: "event-payment-1",
                  sequence: 13,
                  status: "needs_review",
                  summary: "Payment allocation needs manager review.",
                  type: "payment",
                },
              ],
            },
          },
        }}
      />,
    );

    expect(
      screen.getByText("2 review items need manager review."),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Reasons: Register was not open before this sale synced; Payment allocation needs manager review.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Types: Permission review and Payment review."),
    ).toBeInTheDocument();
    expect(screen.getByText("Local queue #12 and #13.")).toBeInTheDocument();
    expect(screen.getByText(/Reported .*2026/)).toBeInTheDocument();
    expect(screen.queryByText("Permission review")).not.toBeInTheDocument();
    expect(
      screen.queryByText("Register was not open before this sale synced."),
    ).not.toBeInTheDocument();
  });

  it("does not offer approval for synced service activity missing customer attribution", () => {
    render(
      <RegisterSessionViewContent
        currency="GHS"
        isLoading={false}
        onRecordDeposit={vi.fn()}
        {...closeoutHandlers}
        onResolveSyncReview={vi.fn()}
        registerSessionSnapshot={{
          ...baseSnapshot,
          registerSession: {
            ...baseSnapshot.registerSession,
            localSyncStatus: {
              status: "needs_review",
              reconciliationItems: [
                {
                  id: "sync_conflict_service_customer",
                  localEventId: "event-service-sale-1",
                  sequence: 2,
                  status: "needs_review",
                  summary: "Service line is missing customer attribution.",
                  type: "permission",
                },
              ],
            },
          },
        }}
      />,
    );

    expect(
      screen.getByText(
        "This synced activity cannot be applied because a service line is missing customer attribution. Reject it to clear this review, then recreate the service work with a customer if needed.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Approve synced sales" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Reject synced activity" }),
    ).toBeInTheDocument();
  });

  it("approves synced register review items after manager sign-in", async () => {
    const user = userEvent.setup();
    const onAuthenticateStaff = vi.fn().mockResolvedValue(
      ok({
        activeRoles: ["manager"],
        staffProfile: { fullName: "Ato Kofi" },
        staffProfileId: "manager-1",
      }),
    );
    const onResolveSyncReview = vi
      .fn()
      .mockResolvedValue(
        ok({ action: "resolved", projectedCount: 1, resolvedCount: 1 }),
      );

    render(
      <RegisterSessionViewContent
        currency="GHS"
        isLoading={false}
        onRecordDeposit={vi.fn()}
        {...closeoutHandlers}
        onAuthenticateStaff={onAuthenticateStaff}
        onResolveSyncReview={onResolveSyncReview}
        registerSessionSnapshot={{
          ...baseSnapshot,
          registerSession: {
            ...baseSnapshot.registerSession,
            localSyncStatus: {
              status: "needs_review",
              reconciliationItems: [
                {
                  id: "sync_conflict_1",
                  status: "needs_review",
                  summary: "Register was not open before this sale synced.",
                  type: "permission",
                },
              ],
            },
          },
        }}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "Approve synced sales" }),
    );
    await user.click(
      screen.getByRole("button", {
        name: "Confirm staff for Approve synced sales",
      }),
    );

    await waitFor(() =>
      expect(onAuthenticateStaff).toHaveBeenCalledWith({
        allowedRoles: ["manager"],
        pinHash: "hashed-pin",
        username: "ato",
      }),
    );
    expect(onResolveSyncReview).toHaveBeenCalledWith({
      actorStaffProfileId: "manager-1",
      decision: "approved",
      registerSessionId: "session-1",
    });
  });

  it("overrides rejected synced activity after manager sign-in", async () => {
    const user = userEvent.setup();
    const onAuthenticateStaff = vi.fn().mockResolvedValue(
      ok({
        activeRoles: ["manager"],
        staffProfile: { fullName: "Ato Kofi" },
        staffProfileId: "manager-1",
      }),
    );
    const onResolveSyncReview = vi
      .fn()
      .mockResolvedValue(
        ok({ action: "resolved", projectedCount: 1, resolvedCount: 1 }),
      );

    render(
      <RegisterSessionViewContent
        currency="GHS"
        isLoading={false}
        onRecordDeposit={vi.fn()}
        {...closeoutHandlers}
        onAuthenticateStaff={onAuthenticateStaff}
        onResolveSyncReview={onResolveSyncReview}
        registerSessionSnapshot={{
          ...baseSnapshot,
          registerSession: {
            ...baseSnapshot.registerSession,
            localSyncStatus: {
              status: "needs_review",
              reconciliationItems: [
                {
                  id: "sync_event_1",
                  sequence: 4,
                  status: "rejected",
                  summary: "Server rejected synced register activity.",
                  type: "server_rejected",
                },
              ],
            },
          },
        }}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "Override and sync events" }),
    );
    await user.click(
      screen.getByRole("button", {
        name: "Confirm staff for Override and sync events",
      }),
    );

    await waitFor(() =>
      expect(onAuthenticateStaff).toHaveBeenCalledWith({
        allowedRoles: ["manager"],
        pinHash: "hashed-pin",
        username: "ato",
      }),
    );
    expect(onResolveSyncReview).toHaveBeenCalledWith({
      actorStaffProfileId: "manager-1",
      decision: "approved",
      registerSessionId: "session-1",
    });
  });

  it("approves proofless staff-access synced activity after manager sign-in", async () => {
    const user = userEvent.setup();
    const onAuthenticateStaff = vi.fn().mockResolvedValue(
      ok({
        activeRoles: ["manager"],
        staffProfile: { fullName: "Ato Kofi" },
        staffProfileId: "manager-1",
      }),
    );
    const onResolveSyncReview = vi
      .fn()
      .mockResolvedValue(
        ok({ action: "resolved", projectedCount: 1, resolvedCount: 3 }),
      );

    render(
      <RegisterSessionViewContent
        currency="GHS"
        isLoading={false}
        onRecordDeposit={vi.fn()}
        {...closeoutHandlers}
        onAuthenticateStaff={onAuthenticateStaff}
        onResolveSyncReview={onResolveSyncReview}
        registerSessionSnapshot={{
          ...baseSnapshot,
          registerSession: {
            ...baseSnapshot.registerSession,
            localSyncStatus: {
              status: "needs_review",
              reconciliationItems: [
                {
                  id: "sync_conflict_1",
                  sequence: 6,
                  status: "needs_review",
                  summary:
                    "Staff access changed before this POS history synced.",
                  type: "permission",
                },
              ],
            },
          },
        }}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Approve synced sales" }));
    await user.click(
      screen.getByRole("button", {
        name: "Confirm staff for Approve synced sales",
      }),
    );

    expect(onResolveSyncReview).toHaveBeenCalledWith({
      actorStaffProfileId: "manager-1",
      decision: "approved",
      registerSessionId: "session-1",
    });
  });

  it("rejects synced register review items after manager sign-in", async () => {
    const user = userEvent.setup();
    const onAuthenticateStaff = vi.fn().mockResolvedValue(
      ok({
        activeRoles: ["manager"],
        staffProfile: { fullName: "Ato Kofi" },
        staffProfileId: "manager-1",
      }),
    );
    const onResolveSyncReview = vi
      .fn()
      .mockResolvedValue(
        ok({ action: "rejected", projectedCount: 0, resolvedCount: 1 }),
      );

    render(
      <RegisterSessionViewContent
        currency="GHS"
        isLoading={false}
        onRecordDeposit={vi.fn()}
        {...closeoutHandlers}
        onAuthenticateStaff={onAuthenticateStaff}
        onResolveSyncReview={onResolveSyncReview}
        registerSessionSnapshot={{
          ...baseSnapshot,
          registerSession: {
            ...baseSnapshot.registerSession,
            localSyncStatus: {
              status: "needs_review",
              reconciliationItems: [
                {
                  id: "sync_conflict_1",
                  status: "needs_review",
                  summary: "Register was not open before this sale synced.",
                  type: "permission",
                },
              ],
            },
          },
        }}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "Reject synced activity" }),
    );
    await user.click(
      screen.getByRole("button", {
        name: "Confirm staff for Reject synced activity",
      }),
    );

    expect(onResolveSyncReview).toHaveBeenCalledWith({
      actorStaffProfileId: "manager-1",
      decision: "rejected",
      registerSessionId: "session-1",
    });
  });

  it("communicates when a register session has closed", () => {
    const closedAt = new Date("2026-04-21T19:45:00.000Z").getTime();
    const expectedClosedAt = new Date(closedAt).toLocaleString("en-US", {
      dateStyle: "medium",
      timeStyle: "short",
    });

    render(
      <RegisterSessionViewContent
        actorUserId="user-1"
        currency="GHS"
        isLoading={false}
        onRecordDeposit={vi.fn()}
        {...closeoutHandlers}
        registerSessionSnapshot={{
          ...baseSnapshot,
          registerSession: {
            ...baseSnapshot.registerSession,
            closedAt,
            closedByStaffName: "Kojo Mensimah",
            status: "closed",
          },
        }}
        orgUrlSlug="wigclub"
        storeId="store-1"
        storeUrlSlug="wigclub"
      />,
    );

    expect(screen.getAllByText("Closed").length).toBeGreaterThan(0);
    expect(screen.getByText(expectedClosedAt)).toBeInTheDocument();
    expect(screen.getByText("By Kojo M.")).toBeInTheDocument();
    expect(
      screen.queryByText(
        "Opening float corrections are available before closeout starts.",
      ),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Reopen closeout/i }),
    ).toBeInTheDocument();
  });

  it("reopens a closed closeout after manager approval", async () => {
    const user = userEvent.setup();
    const onAuthenticateStaff = vi.fn().mockResolvedValue(
      ok({
        activeRoles: ["cashier"],
        staffProfile: { fullName: "Ato Kofi" },
        staffProfileId: "staff-1",
      }),
    );
    const onAuthenticateForApproval = vi.fn().mockResolvedValue(
      ok({
        approvalProofId: "approval-proof-1",
        approvedByStaffProfileId: "manager-1",
        expiresAt: Date.now() + 60_000,
      }),
    );
    const onReopenCloseout = vi
      .fn()
      .mockResolvedValue(ok({ action: "reopened" }));

    render(
      <RegisterSessionViewContent
        actorUserId="user-1"
        currency="GHS"
        isLoading={false}
        {...closeoutHandlers}
        onAuthenticateForApproval={onAuthenticateForApproval}
        onAuthenticateStaff={onAuthenticateStaff}
        onRecordDeposit={vi.fn()}
        onReopenCloseout={onReopenCloseout}
        registerSessionSnapshot={{
          ...baseSnapshot,
          registerSession: {
            ...baseSnapshot.registerSession,
            closedAt: new Date("2026-04-21T19:45:00.000Z").getTime(),
            closedByStaffName: "Kojo Mensimah",
            status: "closed",
          },
        }}
        storeId="store-1"
      />,
    );

    await user.click(screen.getByRole("button", { name: /Reopen closeout/i }));
    let reopenButtons = screen.getAllByRole("button", {
      name: "Reopen closeout",
    });
    await waitFor(() => {
      reopenButtons = screen.getAllByRole("button", {
        name: "Reopen closeout",
      });
      expect(reopenButtons.length).toBeGreaterThan(1);
    });
    await user.click(reopenButtons[0]);

    expect(onAuthenticateStaff).not.toHaveBeenCalled();
    expect(onAuthenticateForApproval).toHaveBeenCalledWith({
      actionKey: "cash_controls.register_session.reopen_closeout",
      pinHash: "hashed-pin",
      requiredRole: "manager",
      storeId: "store-1",
      subject: {
        id: "session-1",
        label: "Register 3",
        type: "register_session",
      },
      username: "manager",
    });
    await waitFor(() =>
      expect(onReopenCloseout).toHaveBeenCalledWith({
        actorStaffProfileId: "manager-1",
        approvalProofId: "approval-proof-1",
        registerSessionId: "session-1",
        requestedByStaffProfileId: undefined,
      }),
    );
  });

  it("keeps closed metadata structured when closer staff is missing", () => {
    const closedAt = new Date("2026-04-21T19:45:00.000Z").getTime();
    const expectedClosedAt = new Date(closedAt).toLocaleString("en-US", {
      dateStyle: "medium",
      timeStyle: "short",
    });

    render(
      <RegisterSessionViewContent
        actorUserId="user-1"
        currency="GHS"
        isLoading={false}
        onRecordDeposit={vi.fn()}
        {...closeoutHandlers}
        registerSessionSnapshot={{
          ...baseSnapshot,
          registerSession: {
            ...baseSnapshot.registerSession,
            closedAt,
            closedByStaffName: null,
            status: "closed",
          },
        }}
        orgUrlSlug="wigclub"
        storeId="store-1"
        storeUrlSlug="wigclub"
      />,
    );

    expect(screen.getByText(expectedClosedAt)).toBeInTheDocument();
    expect(screen.getByText("Staff not recorded")).toBeInTheDocument();
  });

  it("omits closeout metadata while the drawer is open or actively recording sales", () => {
    const { rerender } = render(
      <RegisterSessionViewContent
        actorUserId="user-1"
        currency="GHS"
        isLoading={false}
        onRecordDeposit={vi.fn()}
        {...closeoutHandlers}
        registerSessionSnapshot={{
          ...baseSnapshot,
          registerSession: {
            ...baseSnapshot.registerSession,
            status: "active",
          },
        }}
        orgUrlSlug="wigclub"
        storeId="store-1"
        storeUrlSlug="wigclub"
      />,
    );

    expect(screen.queryByText("Closeout")).not.toBeInTheDocument();
    expect(screen.queryByText("Sales recording")).not.toBeInTheDocument();

    rerender(
      <RegisterSessionViewContent
        actorUserId="user-1"
        currency="GHS"
        isLoading={false}
        onRecordDeposit={vi.fn()}
        {...closeoutHandlers}
        registerSessionSnapshot={{
          ...baseSnapshot,
          registerSession: {
            ...baseSnapshot.registerSession,
            status: "open",
          },
        }}
        orgUrlSlug="wigclub"
        storeId="store-1"
        storeUrlSlug="wigclub"
      />,
    );

    expect(screen.queryByText("Closeout")).not.toBeInTheDocument();
    expect(screen.queryByText("Ready for sales")).not.toBeInTheDocument();
  });

  it("formats variance amounts in manager follow-up copy", () => {
    render(
      <RegisterSessionViewContent
        actorUserId="user-1"
        currency="GHS"
        isLoading={false}
        onRecordDeposit={vi.fn()}
        {...closeoutHandlers}
        registerSessionSnapshot={{
          ...baseSnapshot,
          closeoutReview: {
            hasVariance: true,
            reason:
              "Variance of -6100 exceeded the closeout approval threshold.",
            requiresApproval: true,
            variance: -6100,
          },
          registerSession: {
            ...baseSnapshot.registerSession,
            pendingApprovalRequest: {
              _id: "approval-1",
              reason:
                "Variance of -6100 exceeded the closeout approval threshold.",
              requestedByStaffName: "Ama Mensah",
              status: "pending",
            },
          },
        }}
        orgUrlSlug="wigclub"
        storeId="store-1"
        storeUrlSlug="wigclub"
      />,
    );

    expect(
      screen.getAllByText(
        "Variance of GH₵-61 exceeded the closeout approval threshold",
      ).length,
    ).toBeGreaterThan(0);
  });

  it("communicates rejected closeout approval in the left rail", () => {
    render(
      <RegisterSessionViewContent
        actorUserId="user-1"
        currency="GHS"
        isLoading={false}
        onRecordDeposit={vi.fn()}
        {...closeoutHandlers}
        registerSessionSnapshot={{
          ...baseSnapshot,
          registerSession: {
            ...baseSnapshot.registerSession,
            pendingApprovalRequest: {
              _id: "approval-1",
              reason:
                "Variance of -84500 exceeded the closeout approval threshold.",
              requestedByStaffName: "Kwamina Mensah",
              status: "rejected",
            },
          },
          timeline: [
            {
              _id: "event-1",
              actorStaffName: "Kwamina Mensah",
              createdAt: new Date("2026-05-02T03:41:00.000Z").getTime(),
              eventType: "register_session_closeout_rejected",
              message:
                "Manager rejected the register closeout for recount or correction.",
            },
          ],
        }}
        orgUrlSlug="wigclub"
        storeId="store-1"
        storeUrlSlug="wigclub"
      />,
    );

    expect(screen.getByText("Closeout rejected")).toBeInTheDocument();
    expect(
      screen.queryByText("Manager approval pending"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(
        "Manager rejected this closeout. Recount or correct the drawer before submitting again.",
      ),
    ).toBeInTheDocument();
  });

  it("submits the closeout count from the register detail page", async () => {
    const user = userEvent.setup();
    const onAuthenticateStaff = vi.fn();
    const onSubmitCloseout = vi
      .fn()
      .mockResolvedValue(ok({ action: "closed" }));

    render(
      <RegisterSessionViewContent
        actorUserId="user-1"
        currency="GHS"
        isLoading={false}
        onAuthenticateStaff={onAuthenticateStaff}
        onRecordDeposit={vi.fn()}
        onReviewCloseout={vi.fn()}
        onSubmitCloseout={onSubmitCloseout}
        registerSessionSnapshot={baseSnapshot}
        storeId="store-1"
      />,
    );

    await user.clear(screen.getByLabelText("Closeout counted cash"));
    await user.type(screen.getByLabelText("Closeout counted cash"), "180");
    await user.type(
      screen.getByLabelText("Closeout notes"),
      "Final count after second safe drop.",
    );
    await user.click(screen.getByRole("button", { name: "Submit closeout" }));
    await user.click(
      screen.getByRole("button", { name: "Confirm staff for Submit closeout" }),
    );

    expect(onAuthenticateStaff).toHaveBeenCalledWith({
      allowedRoles: ["cashier", "manager"],
      pinHash: "hashed-pin",
      username: "ato",
    });
    await waitFor(() =>
      expect(onSubmitCloseout).toHaveBeenCalledWith({
        actorStaffProfileId: "staff-1",
        approvalProofId: undefined,
        countedCash: 18000,
        notes: "Final count after second safe drop.",
        registerSessionId: "session-1",
      }),
    );
  });

  it("uses manager approval to submit a reopened closeout correction", async () => {
    const user = userEvent.setup();
    const onAuthenticateStaff = vi.fn();
    const onAuthenticateForApproval = vi.fn().mockResolvedValue(
      ok({
        approvalProofId: "approval-proof-2",
        approvedByStaffProfileId: "manager-1",
        expiresAt: Date.now() + 60_000,
      }),
    );
    const onSubmitCloseout = vi
      .fn()
      .mockResolvedValue(ok({ action: "closed" }));

    render(
      <RegisterSessionViewContent
        actorStaffProfileId="staff-1"
        actorUserId="user-1"
        currency="GHS"
        isLoading={false}
        onAuthenticateForApproval={onAuthenticateForApproval}
        onAuthenticateStaff={onAuthenticateStaff}
        onRecordDeposit={vi.fn()}
        onReviewCloseout={vi.fn()}
        onSubmitCloseout={onSubmitCloseout}
        registerSessionSnapshot={{
          ...baseSnapshot,
          registerSession: {
            ...baseSnapshot.registerSession,
            closeoutRecords: [
              {
                actorStaffProfileId: "cashier-1",
                occurredAt: 1,
                type: "closed",
              },
              {
                actorStaffProfileId: "manager-1",
                occurredAt: 2,
                type: "reopened",
              },
            ],
          },
        }}
        storeId="store-1"
      />,
    );

    await user.clear(screen.getByLabelText("Closeout counted cash"));
    await user.type(screen.getByLabelText("Closeout counted cash"), "176");
    await user.click(screen.getByRole("button", { name: "Submit closeout" }));
    await user.click(screen.getByRole("button", { name: "Submit correction" }));

    expect(onAuthenticateStaff).not.toHaveBeenCalled();
    expect(onAuthenticateForApproval).toHaveBeenCalledWith({
      actionKey: "cash_controls.register_session.submit_reopened_closeout",
      pinHash: "hashed-pin",
      requiredRole: "manager",
      storeId: "store-1",
      subject: {
        id: "session-1",
        label: "Register 3",
        type: "register_session",
      },
      username: "manager",
    });
    await waitFor(() =>
      expect(onSubmitCloseout).toHaveBeenCalledWith({
        actorStaffProfileId: "manager-1",
        closeoutModificationApprovalProofId: "approval-proof-2",
        countedCash: 17600,
        notes: undefined,
        registerSessionId: "session-1",
        requestedByStaffProfileId: "staff-1",
      }),
    );
  });

  it("blocks reopened closeout submission when a different manager approves", async () => {
    const user = userEvent.setup();
    const onAuthenticateForApproval = vi.fn().mockResolvedValue(
      ok({
        approvalProofId: "approval-proof-2",
        approvedByStaffProfileId: "manager-2",
        expiresAt: Date.now() + 60_000,
      }),
    );
    const onSubmitCloseout = vi.fn();

    render(
      <RegisterSessionViewContent
        actorStaffProfileId="staff-1"
        actorUserId="user-1"
        currency="GHS"
        isLoading={false}
        onAuthenticateForApproval={onAuthenticateForApproval}
        onAuthenticateStaff={vi.fn()}
        onRecordDeposit={vi.fn()}
        onReviewCloseout={vi.fn()}
        onSubmitCloseout={onSubmitCloseout}
        registerSessionSnapshot={{
          ...baseSnapshot,
          registerSession: {
            ...baseSnapshot.registerSession,
            closeoutRecords: [
              {
                actorStaffProfileId: "cashier-1",
                occurredAt: 1,
                type: "closed",
              },
              {
                actorStaffProfileId: "manager-1",
                occurredAt: 2,
                type: "reopened",
              },
            ],
          },
        }}
        storeId="store-1"
      />,
    );

    await user.clear(screen.getByLabelText("Closeout counted cash"));
    await user.type(screen.getByLabelText("Closeout counted cash"), "176");
    await user.click(screen.getByRole("button", { name: "Submit closeout" }));
    await user.click(screen.getByRole("button", { name: "Submit correction" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The manager who reopened this closeout must submit the correction.",
    );
    expect(onSubmitCloseout).not.toHaveBeenCalled();
  });

  it("chains inline manager approval when a manager submits a variance closeout", async () => {
    const user = userEvent.setup();
    const onAuthenticateStaff = vi.fn().mockResolvedValue(
      ok({
        activeRoles: ["manager"],
        staffProfile: { fullName: "Ato Kofi" },
        staffProfileId: "staff-1",
      }),
    );
    const onAuthenticateForApproval = vi.fn().mockResolvedValue(
      ok({
        approvalProofId: "approval-proof-1",
        approvedByStaffProfileId: "staff-1",
        expiresAt: Date.now() + 60_000,
      }),
    );
    const onSubmitCloseout = vi
      .fn()
      .mockResolvedValueOnce({
        kind: "approval_required",
        approval: {
          action: {
            key: "cash_controls.register_session.review_variance",
            label: "Review register closeout variance",
          },
          copy: {
            title: "Manager approval required",
            message: "Manager approval is required.",
            primaryActionLabel: "Approve",
          },
          reason: "Manager counted the overage.",
          requiredRole: "manager",
          resolutionModes: [{ kind: "inline_manager_proof" }],
          subject: {
            id: "session-1",
            label: "Register 3",
            type: "register_session",
          },
        },
      })
      .mockResolvedValue(ok({ action: "closed" }));

    render(
      <RegisterSessionViewContent
        actorUserId="user-1"
        currency="GHS"
        isLoading={false}
        onAuthenticateForApproval={onAuthenticateForApproval}
        onAuthenticateStaff={onAuthenticateStaff}
        onRecordDeposit={vi.fn()}
        onReviewCloseout={vi.fn()}
        onSubmitCloseout={onSubmitCloseout}
        registerSessionSnapshot={baseSnapshot}
        storeId="store-1"
      />,
    );

    await user.clear(screen.getByLabelText("Closeout counted cash"));
    await user.type(screen.getByLabelText("Closeout counted cash"), "180");
    await user.type(
      screen.getByLabelText("Closeout notes"),
      "Manager counted the overage.",
    );
    await user.click(screen.getByRole("button", { name: "Submit closeout" }));
    await user.click(
      screen.getByRole("button", { name: "Confirm staff for Submit closeout" }),
    );

    expect(onAuthenticateStaff).toHaveBeenCalledWith({
      allowedRoles: ["cashier", "manager"],
      pinHash: "hashed-pin",
      username: "ato",
    });
    expect(onAuthenticateForApproval).toHaveBeenCalledWith({
      actionKey: "cash_controls.register_session.review_variance",
      pinHash: "hashed-pin",
      reason: "Manager counted the overage.",
      requiredRole: "manager",
      requestedByStaffProfileId: "staff-1",
      storeId: "store-1",
      subject: {
        id: "session-1",
        label: "Register 3",
        type: "register_session",
      },
      username: "ato",
    });
    await waitFor(() =>
      expect(onSubmitCloseout).toHaveBeenLastCalledWith({
        actorStaffProfileId: "staff-1",
        approvalProofId: "approval-proof-1",
        countedCash: 18000,
        notes: "Manager counted the overage.",
        registerSessionId: "session-1",
      }),
    );
  });

  it("allows closeout variance without closeout notes", async () => {
    const user = userEvent.setup();
    const onAuthenticateStaff = vi.fn();
    const onSubmitCloseout = vi
      .fn()
      .mockResolvedValue(ok({ action: "closed" }));

    render(
      <RegisterSessionViewContent
        actorUserId="user-1"
        currency="GHS"
        isLoading={false}
        onAuthenticateStaff={onAuthenticateStaff}
        onRecordDeposit={vi.fn()}
        onReviewCloseout={vi.fn()}
        onSubmitCloseout={onSubmitCloseout}
        registerSessionSnapshot={baseSnapshot}
        storeId="store-1"
      />,
    );

    await user.clear(screen.getByLabelText("Closeout counted cash"));
    await user.type(screen.getByLabelText("Closeout counted cash"), "180");
    expect(screen.getByLabelText("Closeout notes")).not.toBeRequired();
    expect(
      screen.queryByText("Notes are required when the count has variance."),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Submit closeout" }));
    await user.click(
      screen.getByRole("button", { name: "Confirm staff for Submit closeout" }),
    );

    expect(onAuthenticateStaff).toHaveBeenCalledWith({
      allowedRoles: ["cashier", "manager"],
      pinHash: "hashed-pin",
      username: "ato",
    });
    await waitFor(() =>
      expect(onSubmitCloseout).toHaveBeenCalledWith({
        actorStaffProfileId: "staff-1",
        approvalProofId: undefined,
        countedCash: 18000,
        notes: undefined,
        registerSessionId: "session-1",
      }),
    );
  });

  it("allows closeout without notes when counted cash matches expected cash", async () => {
    const user = userEvent.setup();
    const onAuthenticateStaff = vi.fn();
    const onSubmitCloseout = vi
      .fn()
      .mockResolvedValue(ok({ action: "closed" }));

    render(
      <RegisterSessionViewContent
        actorUserId="user-1"
        currency="GHS"
        isLoading={false}
        onAuthenticateStaff={onAuthenticateStaff}
        onRecordDeposit={vi.fn()}
        onReviewCloseout={vi.fn()}
        onSubmitCloseout={onSubmitCloseout}
        registerSessionSnapshot={baseSnapshot}
        storeId="store-1"
      />,
    );

    await user.clear(screen.getByLabelText("Closeout counted cash"));
    await user.type(screen.getByLabelText("Closeout counted cash"), "176");
    await user.click(screen.getByRole("button", { name: "Submit closeout" }));
    await user.click(
      screen.getByRole("button", { name: "Confirm staff for Submit closeout" }),
    );

    await waitFor(() =>
      expect(onSubmitCloseout).toHaveBeenCalledWith({
        actorStaffProfileId: "staff-1",
        approvalProofId: undefined,
        countedCash: 17600,
        notes: undefined,
        registerSessionId: "session-1",
      }),
    );
  });

  it("submits an opening float correction after manager command approval", async () => {
    const user = userEvent.setup();
    const onAuthenticateForApproval = vi.fn().mockResolvedValue(
      ok({
        approvalProofId: "approval-proof-1",
        approvedByStaffProfileId: "manager-1",
        expiresAt: Date.now() + 60_000,
      }),
    );
    const onCorrectOpeningFloat = vi
      .fn()
      .mockResolvedValueOnce({
        kind: "approval_required",
        approval: {
          action: {
            key: "cash_controls.register_session.correct_opening_float",
            label: "Correct opening float",
          },
          copy: {
            title: "Manager approval required",
            message:
              "Authorization is needed from a manager to correct this register opening float.",
            primaryActionLabel: "Approve correction",
            secondaryActionLabel: "Cancel",
          },
          reason:
            "Manager approval is required to correct the register opening float.",
          requiredRole: "manager",
          resolutionModes: [{ kind: "inline_manager_proof" }],
          subject: {
            id: "session-1",
            label: "Register 3",
            type: "register_session",
          },
        },
      })
      .mockResolvedValueOnce(ok({ action: "corrected" }));

    render(
      <RegisterSessionViewContent
        actorStaffProfileId="staff-1"
        actorUserId="user-1"
        currency="USD"
        isLoading={false}
        onAuthenticateForApproval={onAuthenticateForApproval}
        onAuthenticateStaff={vi.fn()}
        onCorrectOpeningFloat={onCorrectOpeningFloat}
        onRecordDeposit={vi.fn()}
        onReviewCloseout={vi.fn()}
        onSubmitCloseout={vi.fn()}
        registerSessionSnapshot={{
          ...baseSnapshot,
          registerSession: {
            ...baseSnapshot.registerSession,
            status: "active",
          },
        }}
        storeId="store-1"
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "Correct opening float" }),
    );
    expect(
      screen.getByRole("button", { name: "Correct opening float" }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    await user.clear(screen.getByLabelText("Corrected opening float"));
    await user.type(screen.getByLabelText("Corrected opening float"), "60");
    await user.type(
      screen.getByLabelText("Opening float correction reason"),
      "Opening cash was recounted.",
    );
    expect(screen.getByText("$10")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Submit" }));
    await user.click(
      screen.getByRole("button", { name: "Approve correction" }),
    );

    expect(onAuthenticateForApproval).toHaveBeenCalledWith({
      actionKey: "cash_controls.register_session.correct_opening_float",
      pinHash: "hashed-pin",
      requiredRole: "manager",
      storeId: "store-1",
      subject: {
        id: "session-1",
        label: "Register 3",
        type: "register_session",
      },
      username: "manager",
    });
    await waitFor(() =>
      expect(onCorrectOpeningFloat).toHaveBeenLastCalledWith({
        approvalProofId: "approval-proof-1",
        correctedOpeningFloat: 6000,
        reason: "Opening cash was recounted.",
        registerSessionId: "session-1",
      }),
    );
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Opening float corrected",
    );
  });

  it("shows an inline note without submitting when the amount is unchanged", async () => {
    const user = userEvent.setup();
    const onCorrectOpeningFloat = vi.fn();

    render(
      <RegisterSessionViewContent
        actorUserId="user-1"
        currency="USD"
        isLoading={false}
        onAuthenticateStaff={vi.fn()}
        onCorrectOpeningFloat={onCorrectOpeningFloat}
        onRecordDeposit={vi.fn()}
        onReviewCloseout={vi.fn()}
        onSubmitCloseout={vi.fn()}
        registerSessionSnapshot={{
          ...baseSnapshot,
          registerSession: {
            ...baseSnapshot.registerSession,
            status: "active",
          },
        }}
        storeId="store-1"
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "Correct opening float" }),
    );
    await user.click(screen.getByRole("button", { name: "Submit" }));

    expect(onCorrectOpeningFloat).not.toHaveBeenCalled();
    expect(
      screen.getByLabelText("Opening float correction reason"),
    ).toBeInTheDocument();
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Corrected amount matches the current opening float. Enter a different amount to submit a correction.",
    );
  });

  it("exits the opening float correction workflow without submitting", async () => {
    const user = userEvent.setup();
    const onCorrectOpeningFloat = vi.fn();

    render(
      <RegisterSessionViewContent
        actorUserId="user-1"
        currency="USD"
        isLoading={false}
        onAuthenticateStaff={vi.fn()}
        onCorrectOpeningFloat={onCorrectOpeningFloat}
        onRecordDeposit={vi.fn()}
        onReviewCloseout={vi.fn()}
        onSubmitCloseout={vi.fn()}
        registerSessionSnapshot={{
          ...baseSnapshot,
          registerSession: {
            ...baseSnapshot.registerSession,
            status: "active",
          },
        }}
        storeId="store-1"
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "Correct opening float" }),
    );
    await user.type(
      screen.getByLabelText("Opening float correction reason"),
      "Wrong till count.",
    );
    expect(
      screen.getByRole("button", { name: "Correct opening float" }),
    ).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(
      screen.queryByLabelText("Opening float correction reason"),
    ).not.toBeInTheDocument();
    expect(onCorrectOpeningFloat).not.toHaveBeenCalled();
  });

  it("does not offer opening float correction once closeout has started", () => {
    render(
      <RegisterSessionViewContent
        actorUserId="user-1"
        currency="USD"
        isLoading={false}
        onRecordDeposit={vi.fn()}
        {...closeoutHandlers}
        registerSessionSnapshot={baseSnapshot}
        storeId="store-1"
      />,
    );

    expect(
      screen.queryByRole("button", { name: "Correct opening float" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(
        "Opening float corrections are available before closeout starts.",
      ),
    ).toBeInTheDocument();
  });

  it("labels closeout rejection history as closeout follow-up", () => {
    render(
      <RegisterSessionViewContent
        actorUserId="user-1"
        currency="USD"
        isLoading={false}
        onRecordDeposit={vi.fn()}
        {...closeoutHandlers}
        registerSessionSnapshot={{
          ...baseSnapshot,
          timeline: [
            {
              _id: "event-1",
              actorStaffName: "Kwamina Mensah",
              createdAt: new Date("2026-05-01T00:44:00.000Z").getTime(),
              eventType: "register_session_closeout_rejected",
              message:
                "Manager rejected the register closeout for recount or correction.",
            },
          ],
        }}
        storeId="store-1"
      />,
    );

    expect(screen.getByText("Closeout correction needed")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Review the rejected closeout, then recount or correct the drawer",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Closeout history")).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Opening float correction" }),
    ).not.toBeInTheDocument();
  });

  it("shows opening float correction before and after amounts", () => {
    render(
      <RegisterSessionViewContent
        actorUserId="user-1"
        currency="USD"
        isLoading={false}
        onRecordDeposit={vi.fn()}
        {...closeoutHandlers}
        registerSessionSnapshot={{
          ...baseSnapshot,
          registerSession: {
            ...baseSnapshot.registerSession,
            openingFloat: 4000,
            status: "active",
          },
          timeline: [
            {
              _id: "event-1",
              actorStaffName: "Kwamina Mensah",
              createdAt: new Date("2026-05-01T00:27:00.000Z").getTime(),
              eventType: "register_session_opening_float_corrected",
              message: "Register session opening float corrected.",
              metadata: {
                correctedOpeningFloat: 4000,
                previousOpeningFloat: 5000,
              },
              reason: "miscounted",
            },
          ],
        }}
        storeId="store-1"
      />,
    );

    expect(screen.getByText("Original float")).toBeInTheDocument();
    expect(screen.getByText("$50")).toBeInTheDocument();
    expect(screen.getByText("Corrected float")).toBeInTheDocument();
    expect(screen.getAllByText("$40").length).toBeGreaterThan(0);
    expect(screen.getByText("Drawer impact")).toBeInTheDocument();
    expect(screen.getByText("-$10")).toBeInTheDocument();
    expect(screen.getAllByText("Notes").length).toBeGreaterThan(0);
    expect(screen.getByText("miscounted")).toBeInTheDocument();
  });

  it("does not present transaction correction events as register closeout follow-up", () => {
    render(
      <RegisterSessionViewContent
        actorUserId="user-1"
        currency="USD"
        isLoading={false}
        onRecordDeposit={vi.fn()}
        {...closeoutHandlers}
        registerSessionSnapshot={{
          ...baseSnapshot,
          timeline: [
            {
              _id: "event-1",
              actorStaffName: "Kwamina Mensah",
              createdAt: new Date("2026-05-01T00:44:00.000Z").getTime(),
              eventType:
                "pos_transaction_payment_method_approval_proof_consumed",
              message:
                "Manager approval proof consumed for Transaction #245072 payment method correction.",
              reason: "mistake at checkout",
            },
          ],
        }}
        storeId="store-1"
      />,
    );

    expect(
      screen.queryByRole("heading", { name: "Closeout correction needed" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Closeout history")).not.toBeInTheDocument();
  });

  it("does not present historical closeout rejection as an active correction after closure", () => {
    render(
      <RegisterSessionViewContent
        actorUserId="user-1"
        currency="USD"
        isLoading={false}
        onRecordDeposit={vi.fn()}
        {...closeoutHandlers}
        registerSessionSnapshot={{
          ...baseSnapshot,
          registerSession: {
            ...baseSnapshot.registerSession,
            closedAt: new Date("2026-05-01T00:50:00.000Z").getTime(),
            closedByStaffName: "Kwamina Mensah",
            status: "closed",
          },
          timeline: [
            {
              _id: "event-1",
              actorStaffName: "Kwamina Mensah",
              createdAt: new Date("2026-05-01T00:44:00.000Z").getTime(),
              eventType: "register_session_closeout_rejected",
              message:
                "Manager rejected the register closeout for recount or correction.",
            },
          ],
        }}
        storeId="store-1"
      />,
    );

    expect(
      screen.queryByRole("heading", { name: "Closeout correction needed" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Closeout history")).not.toBeInTheDocument();
    expect(screen.getAllByText("Closed").length).toBeGreaterThan(0);
  });

  it("shows opening float correction command errors inline", async () => {
    const user = userEvent.setup();
    const onCorrectOpeningFloat = vi.fn().mockResolvedValue(
      userError({
        code: "precondition_failed",
        message:
          "Opening float can only be corrected while the drawer is open.",
      }),
    );

    render(
      <RegisterSessionViewContent
        actorUserId="user-1"
        currency="USD"
        isLoading={false}
        onAuthenticateStaff={vi.fn()}
        onCorrectOpeningFloat={onCorrectOpeningFloat}
        onRecordDeposit={vi.fn()}
        onReviewCloseout={vi.fn()}
        onSubmitCloseout={vi.fn()}
        registerSessionSnapshot={{
          ...baseSnapshot,
          registerSession: {
            ...baseSnapshot.registerSession,
            status: "open",
          },
        }}
        storeId="store-1"
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "Correct opening float" }),
    );
    await user.clear(screen.getByLabelText("Corrected opening float"));
    await user.type(screen.getByLabelText("Corrected opening float"), "60");
    await user.type(
      screen.getByLabelText("Opening float correction reason"),
      "Correction from counted opening cash.",
    );
    await user.click(screen.getByRole("button", { name: "Submit" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Opening float can only be corrected while the drawer is open.",
    );
  });

  it("reviews a pending closeout approval from the register detail page", async () => {
    const user = userEvent.setup();
    const onAuthenticateStaff = vi.fn();
    const onAuthenticateCloseoutReviewApproval = vi.fn().mockResolvedValue(
      ok({
        approvalProofId: "approval-proof-1",
        staffProfile: { fullName: "Ato Kofi" },
        staffProfileId: "staff-1",
      }),
    );
    const onReviewCloseout = vi
      .fn()
      .mockResolvedValue(ok({ action: "approved" }));

    render(
      <RegisterSessionViewContent
        actorUserId="user-1"
        currency="GHS"
        isLoading={false}
        onAuthenticateCloseoutReviewApproval={
          onAuthenticateCloseoutReviewApproval
        }
        onAuthenticateStaff={onAuthenticateStaff}
        onRecordDeposit={vi.fn()}
        onReviewCloseout={onReviewCloseout}
        onSubmitCloseout={vi.fn()}
        registerSessionSnapshot={{
          ...baseSnapshot,
          closeoutReview: {
            hasVariance: true,
            reason:
              "Variance of -500 exceeded the closeout approval threshold.",
            requiresApproval: true,
            variance: -500,
          },
          registerSession: {
            ...baseSnapshot.registerSession,
            pendingApprovalRequest: {
              _id: "approval-1",
              notes: "Counted twice before handoff.",
              reason:
                "Variance of -500 exceeded the closeout approval threshold.",
              requestedByStaffName: "Ama Mensah",
              status: "pending",
            },
          },
        }}
        storeId="store-1"
      />,
    );

    expect(screen.getByText("Manager approval required")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Review closeout variance" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Manager approval pending")).toBeInTheDocument();
    expect(screen.getByText("Request notes")).toBeInTheDocument();
    expect(
      screen.getByText("Counted twice before handoff."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Closeout workflow")).not.toBeInTheDocument();
    expect(
      screen.queryByText(
        "Review the variance in the main workspace before this drawer can be closed.",
      ),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Requested by Ama M.")).toBeInTheDocument();
    expect(screen.getAllByText("Expected").length).toBeGreaterThan(0);
    expect(screen.getAllByText("GH₵176").length).toBeGreaterThan(1);
    expect(
      screen
        .getByText("Review closeout variance")
        .compareDocumentPosition(screen.getByText("Linked transactions")) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    await user.type(
      screen.getByLabelText("Manager closeout notes"),
      "Deposit variance approved.",
    );
    await user.click(screen.getByRole("button", { name: "Approve variance" }));
    await user.click(
      screen.getByRole("button", {
        name: "Confirm staff for Approve variance",
      }),
    );

    expect(onAuthenticateCloseoutReviewApproval).toHaveBeenCalledWith({
      pinHash: "hashed-pin",
      reason: "Deposit variance approved.",
      registerSessionId: "session-1",
      username: "ato",
    });
    expect(onAuthenticateStaff).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(onReviewCloseout).toHaveBeenCalledWith({
        approvalProofId: "approval-proof-1",
        decision: "approved",
        decisionNotes: "Deposit variance approved.",
        registerSessionId: "session-1",
      }),
    );
  });

  it("opens the transaction detail when the linked transaction row is clicked", async () => {
    const user = userEvent.setup();

    render(
      <RegisterSessionViewContent
        actorUserId="user-1"
        currency="USD"
        isLoading={false}
        onRecordDeposit={vi.fn()}
        {...closeoutHandlers}
        registerSessionSnapshot={{
          ...baseSnapshot,
          transactions: [
            {
              _id: "transaction-1",
              cashierName: "Ama Mensah",
              completedAt: new Date("2026-04-21T17:30:00.000Z").getTime(),
              hasMultiplePaymentMethods: false,
              itemCount: 1,
              paymentMethod: "cash",
              status: "void",
              total: 15200,
              transactionNumber: "TXN-0031",
              voidedAt: new Date("2026-04-21T17:45:00.000Z").getTime(),
            },
          ],
        }}
        orgUrlSlug="wigclub"
        storeId="store-1"
        storeUrlSlug="wigclub"
      />,
    );

    expect(screen.getAllByText("Voided").length).toBeGreaterThan(0);

    await user.click(
      screen.getAllByRole("link", { name: "Open transaction #TXN-0031" })[0],
    );

    expect(routerMocks.navigate).toHaveBeenCalledWith({
      params: {
        orgUrlSlug: "wigclub",
        storeUrlSlug: "wigclub",
        transactionId: "transaction-1",
      },
      search: { o: "%2F" },
      to: "/$orgUrlSlug/store/$storeUrlSlug/pos/transactions/$transactionId",
    });
  });

  it("shows the latest five linked transactions with a filtered transactions link", () => {
    const transactions = Array.from({ length: 6 }, (_, index) => ({
      _id: `transaction-${index + 1}`,
      cashierName: "Ama Mensah",
      completedAt: new Date(`2026-04-21T17:${30 - index}:00.000Z`).getTime(),
      hasMultiplePaymentMethods: false,
      itemCount: 1,
      paymentMethod: "cash",
      total: 15200,
      transactionNumber: `TXN-000${index + 1}`,
    }));

    render(
      <RegisterSessionViewContent
        actorUserId="user-1"
        currency="USD"
        isLoading={false}
        onRecordDeposit={vi.fn()}
        {...closeoutHandlers}
        registerSessionSnapshot={{
          ...baseSnapshot,
          transactions,
        }}
        orgUrlSlug="wigclub"
        storeId="store-1"
        storeUrlSlug="wigclub"
      />,
    );

    expect(screen.getByText("6 sales")).toBeInTheDocument();
    expect(screen.getAllByText("#TXN-0001").length).toBeGreaterThan(0);
    expect(screen.getAllByText("#TXN-0005").length).toBeGreaterThan(0);
    expect(screen.queryByText("#TXN-0006")).not.toBeInTheDocument();
    expect(
      screen.getByText("Showing latest 5 of 6 linked sales."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /View all linked transactions/i }),
    ).toHaveAttribute(
      "href",
      "/$orgUrlSlug/store/$storeUrlSlug/pos/transactions?o=%252F&registerSessionId=session-1",
    );
  });

  it("submits a deposit with store, session, and actor context", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1000);

    const user = userEvent.setup();
    const onRecordDeposit = vi.fn().mockResolvedValue(
      ok({
        action: "recorded",
      }),
    );

    render(
      <RegisterSessionViewContent
        actorStaffProfileId="staff-1"
        actorUserId="user-1"
        currency="USD"
        isLoading={false}
        onRecordDeposit={onRecordDeposit}
        {...closeoutHandlers}
        registerSessionSnapshot={baseSnapshot}
        storeId="store-1"
      />,
    );

    await user.type(screen.getByLabelText("Deposit amount"), "2500");
    await user.type(screen.getByLabelText("Deposit reference"), "BANK-440");
    await user.type(
      screen.getByLabelText("Deposit notes"),
      "Safe drop before final closeout.",
    );
    await user.click(screen.getByRole("button", { name: "Record deposit" }));

    await waitFor(() =>
      expect(onRecordDeposit).toHaveBeenCalledWith({
        actorStaffProfileId: "staff-1",
        actorUserId: "user-1",
        amount: 2500,
        notes: "Safe drop before final closeout.",
        reference: "BANK-440",
        registerSessionId: "session-1",
        storeId: "store-1",
        submissionKey: "register-session-deposit-session-1-rs",
      }),
    );
  });

  it("supplies the linked active staff profile from the production container when recording deposits", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1000);

    const user = userEvent.setup();
    const recordDepositMutation = vi.fn().mockResolvedValue(
      ok({
        action: "recorded",
      }),
    );
    protectedPageMocks.useProtectedAdminPageState.mockReturnValue({
      activeStore: {
        _id: "store-1",
        currency: "USD",
      },
      canAccessProtectedSurface: true,
      canQueryProtectedData: true,
      hasFullAdminAccess: false,
      isAuthenticated: true,
      isLoadingAccess: false,
    });
    authMocks.useAuth.mockReturnValue({
      user: { _id: "user-1" },
    });
    convexMocks.useMutation.mockReturnValue(recordDepositMutation);
    convexMocks.useQuery.mockImplementation((_query, args) => {
      if (args === "skip") {
        return undefined;
      }

      if ("registerSessionId" in args) {
        return baseSnapshot;
      }

      return [
        {
          _id: "staff-1",
          linkedUserId: "user-1",
          status: "active",
          storeId: "store-1",
        },
      ];
    });

    render(<RegisterSessionView />);

    await user.type(screen.getByLabelText("Deposit amount"), "2500");
    await user.click(screen.getByRole("button", { name: "Record deposit" }));

    await waitFor(() =>
      expect(recordDepositMutation).toHaveBeenCalledWith(
        expect.objectContaining({
          actorStaffProfileId: "staff-1",
          actorUserId: "user-1",
        }),
      ),
    );
  });

  it("shows safe inline errors for deposit user_error results", async () => {
    const user = userEvent.setup();
    const onRecordDeposit = vi.fn().mockResolvedValue(
      userError({
        code: "precondition_failed",
        message: "Register session is not accepting new deposits.",
      }),
    );

    render(
      <RegisterSessionViewContent
        actorUserId="user-1"
        currency="USD"
        isLoading={false}
        onRecordDeposit={onRecordDeposit}
        {...closeoutHandlers}
        registerSessionSnapshot={baseSnapshot}
        storeId="store-1"
      />,
    );

    await user.type(screen.getByLabelText("Deposit amount"), "2500");
    await user.click(screen.getByRole("button", { name: "Record deposit" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Register session is not accepting new deposits.",
    );
    expect(screen.getByLabelText("Deposit amount")).toHaveValue(2500);
  });

  it("shows generic inline errors for unexpected deposit failures", async () => {
    const user = userEvent.setup();
    const onRecordDeposit = vi.fn().mockResolvedValue({
      kind: "unexpected_error",
      error: {
        title: "Something went wrong",
        message: GENERIC_UNEXPECTED_ERROR_MESSAGE,
      },
    });

    render(
      <RegisterSessionViewContent
        actorUserId="user-1"
        currency="USD"
        isLoading={false}
        onRecordDeposit={onRecordDeposit}
        {...closeoutHandlers}
        registerSessionSnapshot={baseSnapshot}
        storeId="store-1"
      />,
    );

    await user.type(screen.getByLabelText("Deposit amount"), "2500");
    await user.click(screen.getByRole("button", { name: "Record deposit" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      GENERIC_UNEXPECTED_ERROR_MESSAGE,
    );
  });
});
