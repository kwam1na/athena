import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ok, userError } from "~/shared/commandResult";

import {
  RegisterSessionActivityViewContent,
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
    const resolvedParams =
      typeof params === "function"
        ? params({
            orgUrlSlug: "org",
            sessionId: "session-1",
            storeUrlSlug: "store",
            transactionId: "transaction-1",
          })
        : params;
    const resolvedTo =
      to && resolvedParams && typeof resolvedParams === "object"
        ? Object.entries(resolvedParams as Record<string, string>).reduce(
            (path, [key, value]) => path.replace(`$${key}`, value),
            to,
          )
        : to;
    const searchParams = search ? `?${new URLSearchParams(search)}` : "";

    return (
      <a href={`${resolvedTo ?? "#"}${searchParams}`} {...props}>
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
  useSearch: () => ({}),
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

const activeSnapshot = {
  ...baseSnapshot,
  closeoutReview: null,
  registerSession: {
    ...baseSnapshot.registerSession,
    countedCash: undefined,
    status: "active",
    variance: undefined,
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
          financialPosition: {
            averageTransaction: 15200,
            paymentMix: [
              {
                method: "cash",
                share: 100,
                total: 15200,
                transactionCount: 1,
              },
            ],
            totalSales: 15200,
            transactionCount: 1,
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
        storeUrlSlug="wigclub"
      />,
    );

    const header = screen.getByTestId("register-session-page-header");
    expect(header).toHaveTextContent(
      /Register 3\s*\/\s*Front counter\s*synced\s*Closing/,
    );
    expect(header).toHaveTextContent("Closing");
    expect(header).toHaveTextContent("synced");
    expect(within(header).getByText("synced").parentElement).toHaveClass(
      "text-success",
    );
    expect(screen.getAllByText("Register 3").length).toBeGreaterThan(0);
    expect(screen.getByText("Session")).toBeInTheDocument();
    expect(screen.getByText("Code")).toBeInTheDocument();
    expect(screen.getAllByText("SION-1").length).toBeGreaterThan(0);
    expect(screen.getByText("Cash position")).toBeInTheDocument();
    expect(screen.getByText("Sales summary")).toBeInTheDocument();
    expect(screen.getByText("Total sales")).toBeInTheDocument();
    expect(screen.getByText("Completed sales")).toBeInTheDocument();
    expect(screen.getByText("Average sale")).toBeInTheDocument();
    expect(screen.getByText("Completed sales")).toHaveClass(
      "text-[10px]",
      "text-muted-foreground/80",
    );
    expect(screen.getByText("Average sale")).toHaveClass(
      "text-[10px]",
      "text-muted-foreground/80",
    );
    expect(screen.getByText("Payment mix")).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: "Cash: 100% of session sales" }),
    ).toBeInTheDocument();
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
    expect(screen.getAllByText("Counted").length).toBeGreaterThan(0);
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
    expect(
      screen.getAllByText(/3 items - Esi Boateng/i).length,
    ).toBeGreaterThan(0);
    expect(screen.getAllByText("Ama M.").length).toBeGreaterThan(0);
    expect(screen.getByText("Variance review required.")).toBeInTheDocument();
    expect(screen.getByText("Closeout workflow")).toBeInTheDocument();
    expect(screen.getByText("Counted cash ($)")).toBeInTheDocument();
    expect(screen.getByLabelText("Closeout counted cash")).toHaveValue("171");
    expect(screen.getByRole("button", { name: "Submit closeout" })).toHaveClass(
      "bg-action-workflow",
    );
    expect(screen.queryByText("Deposit history")).not.toBeInTheDocument();
    expect(screen.queryByText("Record cash deposit")).not.toBeInTheDocument();
    expect(screen.queryByText("BANK-339")).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "View trace" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("register-session-page-header")).toHaveClass(
      "h-auto",
      "min-h-16",
      "items-start",
      "border-b",
      "py-3",
      "sm:py-4",
    );
    expect(screen.getByTestId("register-session-page-header")).not.toHaveClass(
      "bg-background",
    );
    expect(screen.getByRole("link", { name: "View trace" })).not.toHaveClass(
      "w-full",
    );
  });

  it("hides register cash details while keeping closeout input available to non-manager staff", () => {
    render(
      <RegisterSessionViewContent
        actorStaffProfileId="staff-1"
        actorUserId="user-1"
        canViewFinancialDetails={false}
        currency="GHS"
        isLoading={false}
        onRecordDeposit={vi.fn()}
        {...closeoutHandlers}
        orgUrlSlug="wigclub"
        registerSessionSnapshot={{
          ...baseSnapshot,
          registerSession: {
            ...baseSnapshot.registerSession,
            countedCash: undefined,
            expectedCash: 148500,
            netExpectedCash: 148500,
            openingFloat: 15000,
            totalDeposited: 0,
            variance: 0,
            workflowTraceId: "register_session:reg-3",
          },
        }}
        storeId="store-1"
        storeUrlSlug="wigclub"
      />,
    );

    expect(screen.getByText("Cash position")).toBeInTheDocument();
    expect(screen.getAllByText("Manager only").length).toBeGreaterThan(0);
    expect(screen.queryByText("GH₵1,485")).not.toBeInTheDocument();
    expect(screen.getByText("GH₵150")).toBeInTheDocument();
    expect(screen.getByText("Pending")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Correct opening float" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Closeout workflow")).toBeInTheDocument();
    expect(screen.getByText("Count and close drawer")).toBeInTheDocument();
    expect(screen.getByLabelText("Closeout counted cash")).toBeInTheDocument();
    expect(screen.queryByText("Draft variance")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Submit closeout" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "POS activity" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "View trace" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Deposit history")).not.toBeInTheDocument();
    expect(screen.queryByText("Record cash deposit")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Deposit amount")).not.toBeInTheDocument();
  });

  it("links to POS activity without rendering the activity log inline", () => {
    render(
      <RegisterSessionViewContent
        actorStaffProfileId="staff-1"
        actorUserId="user-1"
        currency="USD"
        isLoading={false}
        onRecordDeposit={vi.fn()}
        {...closeoutHandlers}
        registerSessionSnapshot={baseSnapshot}
        orgUrlSlug="wigclub"
        storeUrlSlug="wigclub"
      />,
    );

    const activityLink = screen.getByRole("link", {
      name: "POS activity",
    });
    expect(activityLink).toHaveAttribute(
      "href",
      "/wigclub/store/wigclub/cash-controls/registers/session-1/activity?o=%252F",
    );
    expect(screen.getByText("Linked transactions")).toBeInTheDocument();
    expect(screen.queryByText("Reported through")).not.toBeInTheDocument();
  });

  it("renders POS activity coverage, attention, filters, and uncertainty copy on the activity route", async () => {
    const user = userEvent.setup();

    render(
      <RegisterSessionActivityViewContent
        isLoading={false}
        activity={{
          continueCursor: "",
          integration: {
            activityReadModelAvailable: false,
            source: "pos_sync_evidence",
          },
          isDone: true,
          page: [
            {
              _id: "activity-1",
              actorStaffName: "Ama Mensah",
              category: "sale",
              evidenceLinks: [
                {
                  id: "txn-1",
                  label: "Transaction",
                  type: "transaction",
                },
              ],
              label: "Sale completed",
              localEventId: "local-event-1",
              localRegisterSessionId: "local-session-1",
              occurredAt: new Date("2026-04-21T17:30:00.000Z").getTime(),
              reportedAt: new Date("2026-04-21T17:31:00.000Z").getTime(),
              sequence: 12,
              source: "pos_sync_evidence",
              status: {
                kind: "projected",
                label: "Projected",
                tone: "success",
              },
              summary: "Receipt R-12 - 1 item(s) - 1 payment(s)",
              terminalName: "Front counter",
            },
            {
              _id: "activity-2",
              actorStaffName: "Kojo Mensimah",
              category: "closeout",
              evidenceLinks: [],
              label: "Closeout started",
              localEventId: "local-event-2",
              localRegisterSessionId: "local-session-1",
              occurredAt: new Date("2026-04-21T18:00:00.000Z").getTime(),
              reportedAt: new Date("2026-04-21T18:01:00.000Z").getTime(),
              sequence: 13,
              source: "pos_sync_evidence",
              status: {
                kind: "held",
                label: "Waiting for earlier POS history",
                tone: "warning",
              },
              summary: "Counted cash submitted",
              terminalName: "Front counter",
            },
            ...Array.from({ length: 9 }, (_, index) => ({
              _id: `activity-extra-${index + 1}`,
              actorStaffName: "Ama Mensah",
              category: "cart" as const,
              evidenceLinks: [],
              label: index === 8 ? "Later cart activity" : "Cart item added",
              localEventId: `local-extra-${index + 1}`,
              localRegisterSessionId: "local-session-1",
              occurredAt:
                new Date("2026-04-21T18:05:00.000Z").getTime() + index,
              reportedAt:
                new Date("2026-04-21T18:06:00.000Z").getTime() + index,
              sequence: 14 + index,
              source: "pos_sync_evidence" as const,
              status: {
                kind: "terminal_reported" as const,
                label: "Reported by terminal",
                tone: "default" as const,
              },
              summary: null,
              terminalName: "Front counter",
            })),
          ],
          summary: {
            attentionCounts: {
              activity_patch_failed: 0,
              conflicted: 0,
              held: 1,
              manager_applied: 0,
              manager_rejected: 0,
              mapping_pending: 0,
              rejected: 0,
            },
            categoryCounts: {
              cart: 0,
              cash: 0,
              closeout: 1,
              expense: 0,
              payment: 0,
              register: 0,
              reopen: 0,
              review: 0,
              sale: 1,
              service: 0,
              session: 0,
              sync: 0,
            },
            coverageState: "unknown_terminal_state",
            latestCloudStatusAt: new Date("2026-04-21T18:01:00.000Z").getTime(),
            lastActivityReportedAt: new Date(
              "2026-04-21T17:31:00.000Z",
            ).getTime(),
            reportedThroughSequence: 12,
            rowCount: 2,
          },
        }}
        orgUrlSlug="wigclub"
        sessionId="reg-3"
        storeUrlSlug="wigclub"
      />,
    );

    expect(screen.getAllByText("POS activity").length).toBeGreaterThan(0);
    expect(
      screen.getByText(
        "This terminal has not reported later local activity to the cloud. The log shows only evidence the cloud has received.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("1 sale")).not.toBeInTheDocument();
    expect(screen.queryByText("0 cart")).not.toBeInTheDocument();
    expect(
      screen.getByText("Terminal reporting uncertain"),
    ).toBeInTheDocument();
    expect(screen.getByText("Sequence 12")).toBeInTheDocument();
    expect(screen.getByText("1 need attention")).toBeInTheDocument();
    expect(screen.getByText("Sale completed")).toBeInTheDocument();
    const receiptLink = screen.getByRole("link", { name: "#R-12" });
    expect(receiptLink).toHaveAttribute(
      "href",
      expect.stringContaining("/wigclub/store/wigclub/pos/transactions/txn-1"),
    );
    expect(receiptLink).toHaveAttribute("href", expect.stringContaining("o="));
    expect(receiptLink.closest("p")).toHaveTextContent(
      "Receipt #R-12 - 1 item(s) - 1 payment(s)",
    );
    expect(screen.getByText("Closeout started")).toBeInTheDocument();
    expect(screen.getByText("Showing 1-10 of 11")).toBeInTheDocument();
    expect(screen.queryByText("Later cart activity")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Go to next page" }));

    expect(screen.getByText("Showing 11-11 of 11")).toBeInTheDocument();
    expect(screen.getByText("Later cart activity")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Needs attention" }));

    expect(screen.queryByText("Sale completed")).not.toBeInTheDocument();
    expect(screen.queryByText("Later cart activity")).not.toBeInTheDocument();
    expect(screen.getByText("Closeout started")).toBeInTheDocument();
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
      screen.getByTestId("register-session-page-header"),
    ).toHaveTextContent(
      /Register 3\s*\/\s*Front counter\s*pending reconciliation/,
    );
    expect(
      within(screen.getByTestId("register-session-page-header")).getByText(
        "pending reconciliation",
      ).parentElement,
    ).toHaveClass("text-warning");
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

    expect(
      screen.getByTestId("register-session-page-header"),
    ).toHaveTextContent(/Register 3\s*\/\s*Front counter\s*pending sync/);
    expect(screen.queryByText("Support evidence")).not.toBeInTheDocument();
    expect(
      within(screen.getByTestId("register-session-page-header")).getByText(
        "pending sync",
      ).parentElement,
    ).toHaveClass("text-warning");
    expect(
      screen.getByRole("link", { name: /view trace/i }),
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
    expect(screen.getByText("Reconciliation review.")).toBeInTheDocument();
    expect(
      screen.getByText("Review synced register activity."),
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
        "Manager sign-in applies the rejected local activity to this register session and records the override for audit.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText("1 review item rejected by the server."),
    ).toBeInTheDocument();
    expect(screen.getByText("#10")).toBeInTheDocument();
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
                  notes: "Short drawer",
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
    expect(screen.getAllByText("GH₵161")).toHaveLength(3);
    expect(screen.queryByText("Pending review")).not.toBeInTheDocument();
    expect(screen.getAllByText("GH₵-15")).toHaveLength(3);
    expect(screen.getAllByText("GH₵-15")[2]).toHaveClass("text-destructive");
    expect(screen.getByText("Closeout needs review")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Synced register closeout has a variance. Review it before this closeout can be applied.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getAllByText("Closeout variance review").length,
    ).toBeGreaterThan(0);
    expect(
      screen.getByText(
        "Review the synced count before applying this closeout to the drawer.",
      ),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Expected")).toHaveLength(2);
    expect(screen.getAllByText("Counted")).toHaveLength(3);
    expect(screen.getAllByText("Variance")).toHaveLength(3);
    expect(screen.getByText("Short drawer")).toBeInTheDocument();
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
      screen.getByRole("button", { name: "Apply synced closeout" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Reject synced closeout" }),
    ).toBeInTheDocument();
  });

  it("surfaces mixed review items and scopes each decision to its conflict", async () => {
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
        ok({ action: "resolved", projectedCount: 0, resolvedCount: 1 }),
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
            countedCash: undefined,
            status: "active",
            variance: undefined,
            localSyncStatus: {
              status: "needs_review",
              reconciliationItems: [
                {
                  countedCash: 16100,
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
                {
                  id: "sync_conflict_sale",
                  sequence: 8,
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
      screen.getByText("Review queue needs attention"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "2 review items need manager review before this drawer can be settled.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getAllByText("Closeout variance review").length,
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByText(
        "Service customer attribution is missing. Reject this item, then recreate the service work with a customer if needed.",
      ).length,
    ).toBeGreaterThan(0);
    expect(
      screen.queryByRole("button", { name: "Apply reviewed activity" }),
    ).not.toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Apply synced closeout" }),
    );
    await user.click(
      screen.getByRole("button", {
        name: "Confirm staff for Apply synced closeout",
      }),
    );

    expect(onResolveSyncReview).toHaveBeenCalledWith({
      actorStaffProfileId: "manager-1",
      decision: "approved",
      registerSessionId: "session-1",
      reviewConflictIds: ["sync_conflict_closeout"],
    });

    await user.click(
      screen.getByRole("button", { name: "Reject review item" }),
    );
    await user.click(
      screen.getByRole("button", {
        name: "Confirm staff for Reject review item",
      }),
    );

    expect(onResolveSyncReview).toHaveBeenLastCalledWith({
      actorStaffProfileId: "manager-1",
      decision: "rejected",
      registerSessionId: "session-1",
      reviewConflictIds: ["sync_conflict_sale"],
    });
  });

  it("communicates synced closeouts that cannot be applied as reject-only", async () => {
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
      screen.queryByRole("button", { name: "Apply reviewed sale activity" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Apply synced closeout" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Reject synced closeout" }),
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Reject synced closeout" }),
    );
    await user.click(
      screen.getByRole("button", {
        name: "Confirm staff for Reject synced closeout",
      }),
    );

    expect(onResolveSyncReview).toHaveBeenCalledWith({
      actorStaffProfileId: "manager-1",
      decision: "rejected",
      registerSessionId: "session-1",
      reviewConflictIds: ["sync_conflict_closed_closeout"],
    });
  });

  it("does not keep rejected duplicate closeout evidence in the active review surface", () => {
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
                  reviewKind: "duplicate_register_closeout",
                  sequence: 2,
                  status: "rejected",
                  summary:
                    "Register session is not open for synced POS closeout.",
                  type: "register_closeout",
                },
              ],
            },
          },
        }}
      />,
    );

    expect(
      screen.queryByText("Synced closeout cannot be applied"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Duplicate closeout")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Reject synced closeout" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("Closeout review pending"),
    ).not.toBeInTheDocument();
  });

  it("combines synced register review items with safe event evidence", async () => {
    const user = userEvent.setup();

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
                  sale: {
                    cashAmount: 2200000,
                    itemCount: 2,
                    items: [
                      {
                        name: "Lace front wig",
                        quantity: 2,
                        sku: "WIG-001",
                        total: 1200000,
                      },
                      {
                        name: "Wig care kit",
                        quantity: 1,
                        sku: "CARE-001",
                        total: 1000000,
                      },
                    ],
                    localReceiptNumber: "local-receipt-1",
                    localTransactionId: "local-transaction-1",
                    occurredAt: createdAt,
                    paymentMethods: ["cash"],
                    receiptNumber: "R-1001",
                    staffName: "Skank H.",
                    total: 2200000,
                    totalPaid: 2200000,
                    transactionId: "transaction-1001",
                  },
                  sequence: 12,
                  status: "needs_review",
                  summary: "Register was not open before this sale synced.",
                  type: "permission",
                },
                {
                  createdAt: createdAt + 60_000,
                  id: "sync_conflict_payment",
                  localEventId: "event-payment-1",
                  sale: {
                    cashAmount: 2200000,
                    itemCount: 2,
                    items: [
                      {
                        name: "Lace front wig",
                        quantity: 2,
                        sku: "WIG-001",
                        total: 1200000,
                      },
                      {
                        name: "Wig care kit",
                        quantity: 1,
                        sku: "CARE-001",
                        total: 1000000,
                      },
                    ],
                    localReceiptNumber: "local-receipt-1",
                    localTransactionId: "local-transaction-1",
                    occurredAt: createdAt,
                    paymentMethods: ["cash"],
                    receiptNumber: "R-1001",
                    staffName: "Skank H.",
                    total: 2200000,
                    totalPaid: 2200000,
                  },
                  sequence: 13,
                  status: "needs_review",
                  summary: "Payment allocation needs manager review.",
                  type: "payment",
                },
              ],
            },
          },
        }}
        orgUrlSlug="wigclub"
        storeUrlSlug="wigclub"
      />,
    );

    expect(
      screen.getByText("2 review items need manager review."),
    ).toBeInTheDocument();
    expect(screen.getByText("Review details")).toBeInTheDocument();
    expect(screen.getAllByText("Items").length).toBeGreaterThan(0);
    expect(screen.getByText("Reasons")).toBeInTheDocument();
    expect(screen.getByText("Categories")).toBeInTheDocument();
    expect(screen.getByText("Sync timeline")).toBeInTheDocument();
    expect(screen.getByText("2 reports")).toBeInTheDocument();
    expect(screen.getByText("First reported")).toBeInTheDocument();
    expect(screen.getByText("Latest report")).toBeInTheDocument();
    expect(screen.getByText("Upload order")).toBeInTheDocument();
    expect(
      screen.getAllByText(
        "Register was not open before this sale synced; Payment allocation needs manager review.",
      ).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getByText("Permission review and Payment review."),
    ).toBeInTheDocument();
    expect(screen.getByText("#12 and #13")).toBeInTheDocument();
    expect(screen.getAllByText(/2026/).length).toBeGreaterThan(0);
    expect(screen.getByText("Sales under review")).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /Open transaction/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/Cashier Skank H\./)).toBeInTheDocument();
    expect(screen.getAllByText("GH₵22,000").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Cash").length).toBeGreaterThan(0);
    expect(screen.queryByText("Lace Front Wig")).not.toBeInTheDocument();

    await user.click(
      screen.getByRole("button", {
        name: /Receipt #R-1001/i,
      }),
    );

    expect(
      screen.getByRole("link", { name: /Open transaction/i }),
    ).toHaveAttribute(
      "href",
      "/wigclub/store/wigclub/pos/transactions/transaction-1001?o=%252F",
    );
    expect(screen.getByText("Lace Front Wig")).toBeInTheDocument();
    expect(screen.getByText("Wig Care Kit")).toBeInTheDocument();
    expect(screen.getByText("WIG-001")).toBeInTheDocument();
    expect(screen.getByText("Qty 2")).toBeInTheDocument();
    expect(screen.getByText("Items total")).toBeInTheDocument();
    expect(screen.queryByText("2 x GH₵12,000")).not.toBeInTheDocument();
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
      screen.queryByRole("button", { name: "Apply reviewed sale activity" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Reject reviewed activity" }),
    ).toBeInTheDocument();
  });

  it("keeps inventory sale reviews applyable so managers can retain the sale", async () => {
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
        orgUrlSlug="wigclub"
        registerSessionSnapshot={{
          ...baseSnapshot,
          registerSession: {
            ...baseSnapshot.registerSession,
            localSyncStatus: {
              status: "needs_review",
              reconciliationItems: [
                {
                  actionPolicy: "apply_or_reject",
                  id: "sync_conflict_inventory",
                  inventoryReview: {
                    activeHeldQuantity: 1,
                    availableInventoryCount: 1,
                    productSkuId: "sku-hair-dryer",
                    quantityAvailable: 2,
                    quantityAvailableAfterHolds: 1,
                    requestedQuantity: 2,
                  },
                  reviewKind: "inventory_review",
                  sale: {
                    cashAmount: null,
                    itemCount: 12,
                    items: [
                      {
                        name: "Promaxgold 3000w Hair Dryer",
                        productSkuId: "sku-hair-dryer",
                        quantity: 2,
                        sku: "KK38-E2Z-E9V",
                        total: 36000,
                      },
                      {
                        name: "Ebin Skin Protector Enhanced",
                        quantity: 5,
                        sku: "KK38-3NA-5QK",
                        total: 60000,
                      },
                      {
                        name: "Nab Lace Tint Mousse 120ml",
                        quantity: 5,
                        sku: "KK38-DGB-W6V",
                        total: 20000,
                      },
                    ],
                    occurredAt: Date.parse("2026-06-17T06:59:00Z"),
                    paymentMethods: ["mobile_money"],
                    receiptNumber: "939540",
                    staffName: "P O.",
                    total: 116000,
                    totalPaid: 116000,
                  },
                  sequence: 3,
                  status: "needs_review",
                  summary:
                    "Inventory needs manager review for a synced offline sale.",
                  type: "inventory",
                },
              ],
            },
          },
        }}
        storeId="store-1"
        storeUrlSlug="wigclub"
      />,
    );

    expect(
      screen.getByText(
        "Manager sign-in reviews the inventory details and applies the synced sale activity to this register session.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Apply reviewed sale activity" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: /Receipt #939540/i,
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("Mobile Money")).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", {
        name: /Receipt #939540/i,
      }),
    );

    expect(screen.getByText("None recorded")).toBeInTheDocument();
    expect(screen.getAllByText("Inventory review").length).toBeGreaterThan(0);
    expect(screen.getByText("Requested 2")).toBeInTheDocument();
    expect(screen.getByText("Available after holds 1")).toBeInTheDocument();
    expect(screen.getByText("Active holds 1")).toBeInTheDocument();
    const stockAdjustmentsHref = new URL(
      screen
        .getByRole("link", { name: "Open stock adjustments" })
        .getAttribute("href") ?? "",
      "http://localhost",
    );
    expect(stockAdjustmentsHref.pathname).toBe(
      "/wigclub/store/wigclub/operations/stock-adjustments",
    );
    expect(stockAdjustmentsHref.searchParams.get("mode")).toBe("manual");
    expect(stockAdjustmentsHref.searchParams.get("sku")).toBe("sku-hair-dryer");
    expect(stockAdjustmentsHref.searchParams.get("o")).toBe("%2F");

    const skuActivityHref = new URL(
      screen
        .getByRole("link", { name: "View SKU activity" })
        .getAttribute("href") ?? "",
      "http://localhost",
    );
    expect(skuActivityHref.pathname).toBe(
      "/wigclub/store/wigclub/operations/sku-activity",
    );
    expect(skuActivityHref.searchParams.get("productSkuId")).toBe(
      "sku-hair-dryer",
    );
    expect(skuActivityHref.searchParams.get("sku")).toBe("KK38-E2Z-E9V");
    expect(skuActivityHref.searchParams.get("o")).toBe("%2F");
    expect(
      screen.queryByText(
        "This synced activity needs correction before it can be applied. Reject it to clear this review, then correct the sale from the appropriate workflow if needed.",
      ),
    ).not.toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Apply reviewed sale activity" }),
    );
    await user.click(
      screen.getByRole("button", {
        name: "Confirm staff for Apply reviewed sale activity",
      }),
    );

    expect(onResolveSyncReview).toHaveBeenCalledWith({
      actorStaffProfileId: "manager-1",
      decision: "approved",
      registerSessionId: "session-1",
      reviewConflictIds: ["sync_conflict_inventory"],
    });
  });

  it("shows repair copy for completed sale register mapping reviews", async () => {
    const user = userEvent.setup();
    const onAuthenticateStaff = vi.fn().mockResolvedValue(
      ok({
        activeRoles: ["manager"],
        staffProfile: { fullName: "Ato Kofi" },
        staffProfileId: "manager-1",
      }),
    );
    const onAuthenticateForApproval = vi.fn().mockResolvedValue(
      ok({
        approvalProofId: "approval-proof-1",
        approvedByStaffProfileId: "manager-1",
        expiresAt: Date.now() + 60_000,
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
        onAuthenticateForApproval={onAuthenticateForApproval}
        onAuthenticateStaff={onAuthenticateStaff}
        onResolveSyncReview={onResolveSyncReview}
        orgUrlSlug="wigclub"
        registerSessionSnapshot={{
          ...baseSnapshot,
          registerSession: {
            ...baseSnapshot.registerSession,
            localSyncStatus: {
              status: "needs_review",
              reconciliationItems: [
                {
                  actionPolicy: "apply_or_reject",
                  id: "sync_conflict_missing_mapping",
                  localEventId: "event_sale_1",
                  reviewKind: "missing_register_session_mapping",
                  sale: {
                    cashAmount: 3500,
                    itemCount: 1,
                    occurredAt: Date.parse("2026-06-23T03:38:00Z"),
                    paymentMethods: ["cash"],
                    receiptNumber: "003078",
                    staffName: "Ato K.",
                    total: 3500,
                    totalPaid: 3500,
                  },
                  sequence: 2,
                  status: "needs_review",
                  summary:
                    "Register session mapping is missing for synced POS history.",
                  type: "permission",
                },
              ],
            },
          },
        }}
        storeId="store-1"
        storeUrlSlug="wigclub"
      />,
    );

    expect(
      screen.getByText(
        "Manager sign-in repairs the completed sale link to this register session so the drawer can be settled.",
      ),
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", {
        name: /Receipt #003078/i,
      }),
    );

    expect(screen.getByText("Repair sale mapping")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Completed sale needs its register-session link repaired before this drawer can be settled.",
      ),
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Repair sale mapping" }),
    );
    await user.click(
      screen.getByRole("button", {
        name: "Confirm staff for Repair sale mapping",
      }),
    );

    await waitFor(() =>
      expect(onAuthenticateForApproval).toHaveBeenCalledWith({
        actionKey: "cash_controls.register_session.resolve_sync_review",
        pinHash: "hashed-pin",
        requiredRole: "manager",
        requestedByStaffProfileId: undefined,
        storeId: "store-1",
        subject: {
          id: "session-1",
          label: "Register 3",
          type: "register_session",
        },
        username: "ato",
      }),
    );
    expect(onAuthenticateStaff).not.toHaveBeenCalled();
    expect(onResolveSyncReview).toHaveBeenNthCalledWith(1, {
      actorStaffProfileId: "manager-1",
      approvalProofId: "approval-proof-1",
      decision: "approved",
      registerSessionId: "session-1",
      requestedByStaffProfileId: undefined,
      reviewConflictIds: ["sync_conflict_missing_mapping"],
    });

    await user.click(
      screen.getByRole("button", { name: "Reject sale mapping review" }),
    );
    await user.click(
      screen.getByRole("button", {
        name: "Confirm staff for Reject sale mapping review",
      }),
    );

    expect(onResolveSyncReview).toHaveBeenNthCalledWith(2, {
      actorStaffProfileId: "manager-1",
      approvalProofId: "approval-proof-1",
      decision: "rejected",
      registerSessionId: "session-1",
      requestedByStaffProfileId: undefined,
      reviewConflictIds: ["sync_conflict_missing_mapping"],
    });
  });

  it("offers a preserve decision for duplicate POS-session sale reviews", async () => {
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
                  actionPolicy: "apply_or_reject",
                  id: "sync_conflict_inventory",
                  inventoryReview: {
                    availableInventoryCount: 1,
                    productSkuId: "sku-hair-dryer",
                    quantityAvailable: 1,
                    quantityAvailableAfterHolds: 1,
                    requestedQuantity: 2,
                  },
                  reviewKind: "inventory_review",
                  sale: {
                    itemCount: 8,
                    items: [
                      {
                        name: "Promaxgold 3000w Hair Dryer",
                        productSkuId: "sku-hair-dryer",
                        quantity: 2,
                        sku: "KK38-E2Z-E9V",
                        total: 36000,
                      },
                    ],
                    occurredAt: Date.parse("2026-06-19T10:52:00Z"),
                    paymentMethods: ["mobile_money"],
                    receiptNumber: "8707507",
                    staffName: "Joyce O.",
                    total: 18500,
                    totalPaid: 18500,
                  },
                  sequence: 26,
                  status: "needs_review",
                  summary:
                    "Inventory needs manager review for a synced offline sale.",
                  type: "inventory",
                },
                {
                  actionPolicy: "apply_or_reject",
                  id: "sync_conflict_duplicate",
                  localEventId: "event-duplicate-sale",
                  reviewKind: "duplicate_pos_session_sale",
                  sale: {
                    itemCount: 8,
                    items: [
                      {
                        name: "Promaxgold 3000w Hair Dryer",
                        productSkuId: "sku-hair-dryer",
                        quantity: 2,
                        sku: "KK38-E2Z-E9V",
                        total: 36000,
                      },
                    ],
                    occurredAt: Date.parse("2026-06-19T10:52:00Z"),
                    paymentMethods: ["mobile_money"],
                    receiptNumber: "8707507",
                    staffName: "Joyce O.",
                    total: 18500,
                    totalPaid: 18500,
                  },
                  sequence: 10,
                  status: "needs_review",
                  summary:
                    "Local POS session id was reused by a different synced sale.",
                  type: "duplicate_local_id",
                },
              ],
            },
          },
        }}
      />,
    );

    await user.click(
      screen.getByRole("button", {
        name: /Receipt #8707507/i,
      }),
    );

    expect(screen.getByText("Review decisions")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Reject reviewed sale activity" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Apply inventory review item" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Reject inventory review item" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Preserve synced sale" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "Reject duplicate sale evidence",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Inventory review and Synced sale preservation."),
    ).toBeInTheDocument();
    expect(screen.getByText("Synced sale preservation")).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", {
        name: "Preserve synced sale",
      }),
    );
    await user.click(
      screen.getByRole("button", {
        name: "Confirm staff for Preserve synced sale",
      }),
    );

    await waitFor(() =>
      expect(onResolveSyncReview).toHaveBeenNthCalledWith(1, {
        actorStaffProfileId: "manager-1",
        decision: "approved",
        registerSessionId: "session-1",
        reviewConflictIds: [
          "sync_conflict_inventory",
          "sync_conflict_duplicate",
        ],
      }),
    );
  });

  it("rejects duplicate POS-session sale evidence without clearing sibling sale reviews", async () => {
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
                  actionPolicy: "apply_or_reject",
                  id: "sync_conflict_inventory",
                  inventoryReview: {
                    availableInventoryCount: 1,
                    productSkuId: "sku-hair-dryer",
                    quantityAvailable: 1,
                    quantityAvailableAfterHolds: 1,
                    requestedQuantity: 2,
                  },
                  reviewKind: "inventory_review",
                  sale: {
                    itemCount: 8,
                    items: [
                      {
                        name: "Promaxgold 3000w Hair Dryer",
                        productSkuId: "sku-hair-dryer",
                        quantity: 2,
                        sku: "KK38-E2Z-E9V",
                        total: 36000,
                      },
                    ],
                    occurredAt: Date.parse("2026-06-19T10:52:00Z"),
                    paymentMethods: ["mobile_money"],
                    receiptNumber: "8707507",
                    staffName: "Joyce O.",
                    total: 18500,
                    totalPaid: 18500,
                  },
                  sequence: 26,
                  status: "needs_review",
                  summary:
                    "Inventory needs manager review for a synced offline sale.",
                  type: "inventory",
                },
                {
                  actionPolicy: "apply_or_reject",
                  id: "sync_conflict_duplicate",
                  localEventId: "event-duplicate-sale",
                  reviewKind: "duplicate_pos_session_sale",
                  sale: {
                    itemCount: 8,
                    items: [
                      {
                        name: "Promaxgold 3000w Hair Dryer",
                        productSkuId: "sku-hair-dryer",
                        quantity: 2,
                        sku: "KK38-E2Z-E9V",
                        total: 36000,
                      },
                    ],
                    occurredAt: Date.parse("2026-06-19T10:52:00Z"),
                    paymentMethods: ["mobile_money"],
                    receiptNumber: "8707507",
                    staffName: "Joyce O.",
                    total: 18500,
                    totalPaid: 18500,
                  },
                  sequence: 10,
                  status: "needs_review",
                  summary:
                    "Local POS session id was reused by a different synced sale.",
                  type: "duplicate_local_id",
                },
              ],
            },
          },
        }}
      />,
    );

    await user.click(
      screen.getByRole("button", {
        name: /Receipt #8707507/i,
      }),
    );
    await user.click(
      screen.getByRole("button", {
        name: "Reject duplicate sale evidence",
      }),
    );
    await user.click(
      screen.getByRole("button", {
        name: "Confirm staff for Reject duplicate sale evidence",
      }),
    );

    await waitFor(() =>
      expect(onResolveSyncReview).toHaveBeenNthCalledWith(1, {
        actorStaffProfileId: "manager-1",
        decision: "rejected",
        registerSessionId: "session-1",
        reviewConflictIds: ["sync_conflict_duplicate"],
      }),
    );
  });

  it("separates duplicate register-opening decisions from sale evidence", async () => {
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
                  actionPolicy: "reject_only",
                  id: "sync_conflict_duplicate",
                  localEventId: "event-duplicate-sale",
                  reviewKind: "duplicate_register_open",
                  sale: {
                    itemCount: 3,
                    items: [
                      {
                        name: "Melt Band",
                        quantity: 2,
                        sku: "KK38-61G-ZW8",
                        total: 5000,
                      },
                      {
                        name: "Romantic Rain Lip Oil",
                        quantity: 1,
                        sku: "KK38-9KB-VPS",
                        total: 3000,
                      },
                    ],
                    occurredAt: Date.parse("2026-06-30T08:28:00Z"),
                    paymentMethods: ["mobile_money"],
                    receiptNumber: "224763",
                    staffName: "Gertrude A.",
                    total: 8000,
                    totalPaid: 8000,
                  },
                  sequence: 13,
                  status: "needs_review",
                  summary:
                    "Local register session id was reused by a different synced register open.",
                  type: "duplicate_local_id",
                },
              ],
            },
          },
        }}
      />,
    );

    expect(
      screen.getByText(
        "Reject the duplicate register-opening evidence to keep the current register session. Any sale details shown below are evidence only.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Synced sale evidence")).toBeInTheDocument();
    expect(
      screen.getByText(
        "These synced sale details were reported with the duplicate register-opening evidence.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Resolve duplicate-opening evidence without clearing the synced sale details shown below.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getAllByRole("button", {
        name: "Reject duplicate register opening",
      }),
    ).toHaveLength(1);

    await user.click(
      screen.getByRole("button", {
        name: /Receipt #224763/i,
      }),
    );

    expect(screen.getByText("Melt Band")).toBeInTheDocument();
    expect(screen.getByText("Romantic Rain Lip Oil")).toBeInTheDocument();
    expect(
      screen.getByText(
        "This sale is shown as evidence for the duplicate register-opening review.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getAllByRole("button", {
        name: "Reject duplicate register opening",
      }),
    ).toHaveLength(1);

    await user.click(
      screen.getByRole("button", {
        name: "Reject duplicate register opening",
      }),
    );
    await user.click(
      screen.getByRole("button", {
        name: "Confirm staff for Reject duplicate register opening",
      }),
    );

    expect(onResolveSyncReview).toHaveBeenCalledWith({
      actorStaffProfileId: "manager-1",
      decision: "rejected",
      registerSessionId: "session-1",
      reviewConflictIds: ["sync_conflict_duplicate"],
    });
  });

  it("offers a batch reject action for duplicate synced register openings", () => {
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
                  actionPolicy: "reject_only",
                  id: "sync_conflict_duplicate_open",
                  localEventId: "event-register-opened-2",
                  reviewKind: "duplicate_register_open",
                  sequence: 2,
                  status: "needs_review",
                  summary:
                    "A register session is already open for this terminal.",
                  type: "permission",
                },
                {
                  actionPolicy: "reject_only",
                  id: "sync_conflict_reused_open",
                  localEventId: "event-register-opened-3",
                  reviewKind: "duplicate_register_open",
                  sequence: 3,
                  status: "needs_review",
                  summary:
                    "Local register session id was reused by a different synced register open.",
                  type: "duplicate_local_id",
                },
              ],
            },
          },
        }}
      />,
    );

    expect(
      screen.getByText(
        "Reject the duplicate register-opening evidence to keep the current register session. Any sale details shown below are evidence only.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Duplicate register opening.")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", {
        name: "Apply duplicate register openings",
      }),
    ).not.toBeInTheDocument();
    expect(
      screen.getAllByRole("button", {
        name: "Reject duplicate register opening",
      }),
    ).toHaveLength(2);
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
                  actionPolicy: "apply_or_reject",
                  id: "sync_conflict_1",
                  localEventId: "event_sale_1",
                  reviewKind: "missing_register_session_mapping",
                  sale: {
                    cashAmount: 2200000,
                    itemCount: 1,
                    items: [
                      {
                        name: "Lace front wig",
                        quantity: 1,
                        sku: "WIG-001",
                        total: 2200000,
                      },
                    ],
                    occurredAt: Date.parse("2026-05-20T10:30:00Z"),
                    paymentMethods: ["cash"],
                    receiptNumber: "R-1001",
                    staffName: "Skank H.",
                    total: 2200000,
                    totalPaid: 2200000,
                  },
                  status: "needs_review",
                  summary:
                    "Register session mapping is missing for synced POS history.",
                  type: "permission",
                },
                {
                  actionPolicy: "apply_or_reject",
                  id: "sync_conflict_closeout_mapping",
                  localEventId: "event_closeout_1",
                  reviewKind: "missing_register_session_mapping",
                  sequence: 2,
                  status: "needs_review",
                  summary:
                    "Register session mapping is missing for synced POS history.",
                  type: "permission",
                },
              ],
            },
          },
        }}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "Apply reviewed sale activity" }),
    );
    await user.click(
      screen.getByRole("button", {
        name: "Confirm staff for Apply reviewed sale activity",
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
      reviewConflictIds: ["sync_conflict_1"],
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
                  sale: {
                    itemCount: 4,
                    items: [
                      {
                        name: "Cluster Lashes",
                        quantity: 1,
                        sku: "KK38-G60-8DV",
                        total: 10000,
                      },
                      {
                        name: "One Step Round Brush Hot Air Brush",
                        quantity: 1,
                        sku: "KK38-8HZ-CZ0",
                        total: 19000,
                      },
                      {
                        name: "Best Beauty Eye Pencil",
                        quantity: 2,
                        sku: "KK38-6RR-VV5",
                        total: 4000,
                      },
                    ],
                    occurredAt: Date.parse("2026-06-20T10:40:00-04:00"),
                    paymentMethods: ["mobile_money"],
                    receiptNumber: "664153",
                    staffName: "Gertrude A.",
                    total: 33000,
                    totalPaid: 66000,
                  },
                  sequence: 4,
                  status: "rejected",
                  summary:
                    "POS sale non-cash payments cannot exceed the sale total.",
                  type: "server_rejected",
                },
              ],
            },
          },
        }}
      />,
    );

    expect(
      screen.getByText(
        "Collected GH₵660 by Mobile Money against expected total GH₵330.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Manager sign-in applies the expected sale total as the collected amount and records the override for audit.",
      ),
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", {
        name: /Receipt #664153/i,
      }),
    );

    expect(
      screen.getByText(
        /Payment mismatch: collected GH₵660 by Mobile Money against expected total GH₵330/,
      ),
    ).toBeInTheDocument();

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
      reviewConflictIds: ["sync_event_1"],
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

    await user.click(
      screen.getByRole("button", { name: "Apply reviewed activity" }),
    );
    await user.click(
      screen.getByRole("button", {
        name: "Confirm staff for Apply reviewed activity",
      }),
    );

    expect(onResolveSyncReview).toHaveBeenCalledWith({
      actorStaffProfileId: "manager-1",
      decision: "approved",
      registerSessionId: "session-1",
      reviewConflictIds: ["sync_conflict_1"],
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
      screen.getByRole("button", { name: "Reject reviewed activity" }),
    );
    await user.click(
      screen.getByRole("button", {
        name: "Confirm staff for Reject reviewed activity",
      }),
    );

    expect(onResolveSyncReview).toHaveBeenCalledWith({
      actorStaffProfileId: "manager-1",
      decision: "rejected",
      registerSessionId: "session-1",
      reviewConflictIds: ["sync_conflict_1"],
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

  it("hides closed closeout metrics from non-manager staff", () => {
    render(
      <RegisterSessionViewContent
        actorUserId="user-1"
        canViewFinancialDetails={false}
        currency="GHS"
        isLoading={false}
        onRecordDeposit={vi.fn()}
        {...closeoutHandlers}
        registerSessionSnapshot={{
          ...baseSnapshot,
          registerSession: {
            ...baseSnapshot.registerSession,
            closedAt: new Date("2026-07-06T01:54:00.000Z").getTime(),
            closedByStaffName: "Kwamina Mensah",
            countedCash: 100000,
            expectedCash: 94200,
            netExpectedCash: 94200,
            status: "closed",
            variance: 5800,
          },
        }}
        storeId="store-1"
      />,
    );

    const closedCloseoutPanel = screen
      .getByText("Closeout complete")
      .closest("div");

    expect(closedCloseoutPanel).toBeInTheDocument();
    expect(
      within(closedCloseoutPanel as HTMLElement).queryByText("GH₵942"),
    ).not.toBeInTheDocument();
    expect(
      within(closedCloseoutPanel as HTMLElement).queryByText("GH₵1,000"),
    ).not.toBeInTheDocument();
    expect(
      within(closedCloseoutPanel as HTMLElement).queryByText("GH₵58"),
    ).not.toBeInTheDocument();
    expect(
      within(closedCloseoutPanel as HTMLElement).queryByText("Variance"),
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
        label: "Register 3 closeout correction",
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
            status: "closeout_rejected",
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

    expect(screen.getAllByText("Closeout rejected").length).toBeGreaterThan(0);
    expect(
      screen.queryByText("Manager approval pending"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(
        "Manager approval is required to reopen this rejected closeout before a corrected count can be submitted.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Reopen closeout" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Submit closeout" }),
    ).not.toBeInTheDocument();
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
        staffPinHash: "hashed-pin",
        staffUsername: "ato",
      }),
    );
  });

  it("finalizes a submitted closeout through staff authentication", async () => {
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
    const onFinalizeCloseout = vi
      .fn()
      .mockResolvedValue(ok({ action: "closed" }));

    render(
      <RegisterSessionViewContent
        actorUserId="user-1"
        currency="GHS"
        isLoading={false}
        onAuthenticateForApproval={onAuthenticateForApproval}
        onAuthenticateStaff={onAuthenticateStaff}
        onFinalizeCloseout={onFinalizeCloseout}
        onRecordDeposit={vi.fn()}
        onReviewCloseout={vi.fn()}
        onSubmitCloseout={vi.fn()}
        registerSessionSnapshot={baseSnapshot}
        storeId="store-1"
      />,
    );

    expect(
      screen.getByRole("button", { name: "Finalize closeout" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Submit closeout" }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Finalize closeout" }));
    await user.click(
      screen.getByRole("button", {
        name: "Confirm staff for Finalize closeout",
      }),
    );

    expect(onAuthenticateStaff).toHaveBeenCalledWith({
      allowedRoles: ["manager"],
      pinHash: "hashed-pin",
      username: "ato",
    });
    await waitFor(() =>
      expect(onFinalizeCloseout).toHaveBeenCalledWith({
        actorStaffProfileId: "staff-1",
        approvalProofId: undefined,
        registerSessionId: "session-1",
        staffPinHash: "hashed-pin",
        staffUsername: "ato",
      }),
    );
    expect(onAuthenticateForApproval).not.toHaveBeenCalled();
  });

  it("holds pending-void closeouts without submit, finalize, or deposit actions", () => {
    render(
      <RegisterSessionViewContent
        actorUserId="user-1"
        currency="GHS"
        isLoading={false}
        onAuthenticateStaff={vi.fn()}
        onFinalizeCloseout={vi.fn()}
        onRecordDeposit={vi.fn()}
        onReviewCloseout={vi.fn()}
        onSubmitCloseout={vi.fn()}
        orgUrlSlug="wigclub"
        registerSessionSnapshot={{
          ...baseSnapshot,
          registerSession: {
            ...baseSnapshot.registerSession,
            expectedCash: 610000,
            netExpectedCash: 610000,
            pendingVoidApprovals: {
              cashAffectingCount: 1,
              cashAmount: 8000,
              count: 1,
              items: [
                {
                  approvalRequestId: "void-approval-1",
                  cashAmount: 8000,
                  requestedAt: new Date("2026-04-21T18:30:00.000Z").getTime(),
                  transactionId: "transaction-1",
                  transactionNumber: "TXN-0031",
                },
              ],
            },
          },
        }}
        storeId="store-1"
        storeUrlSlug="wigclub"
      />,
    );

    expect(
      screen.getByText("Register corrections pending"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Register corrections block final closeout"),
    ).toBeInTheDocument();
    expect(screen.getAllByText(/Expected now/).length).toBeGreaterThan(0);
    expect(
      screen.getAllByText(/After adjustments applies 1 pending cash void/)[0],
    ).toHaveTextContent("GH₵80");
    expect(screen.getAllByText("After adjustments").length).toBeGreaterThan(0);
    expect(screen.getAllByText("GH₵6,020").length).toBeGreaterThan(0);
    expect(
      screen.getByRole("link", { name: "Review approvals" }),
    ).toHaveAttribute(
      "href",
      "/wigclub/store/wigclub/operations/approvals?o=%252F",
    );
    expect(
      screen.queryByRole("button", { name: "Submit closeout" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Finalize closeout" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Deposit amount")).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText("Deposit reference"),
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Deposit notes")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Record deposit" }),
    ).not.toBeInTheDocument();
  });

  it("holds cash item-adjustment closeouts without finalize or deposit actions", () => {
    render(
      <RegisterSessionViewContent
        actorUserId="user-1"
        currency="GHS"
        isLoading={false}
        onAuthenticateStaff={vi.fn()}
        onFinalizeCloseout={vi.fn()}
        onRecordDeposit={vi.fn()}
        onReviewCloseout={vi.fn()}
        onSubmitCloseout={vi.fn()}
        orgUrlSlug="wigclub"
        registerSessionSnapshot={{
          ...baseSnapshot,
          registerSession: {
            ...baseSnapshot.registerSession,
            expectedCash: 610000,
            netExpectedCash: 610000,
            pendingVoidApprovals: {
              cashAdjustmentCount: 1,
              cashAdjustmentDelta: -5000,
              cashAmount: 0,
              count: 0,
              items: [],
            },
          },
        }}
        storeId="store-1"
        storeUrlSlug="wigclub"
      />,
    );

    expect(
      screen.getByText("Register corrections pending"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Register corrections block final closeout"),
    ).toBeInTheDocument();
    expect(
      screen.getAllByText(/1 pending cash item adjustment reducing cash/)[0],
    ).toHaveTextContent("GH₵50");
    expect(
      screen.queryByRole("button", { name: "Finalize closeout" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Deposit amount")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Record deposit" }),
    ).not.toBeInTheDocument();
  });

  it("wraps submitted closeout metrics when after-adjustment context is shown", () => {
    render(
      <RegisterSessionViewContent
        actorUserId="user-1"
        currency="GHS"
        isLoading={false}
        onAuthenticateStaff={vi.fn()}
        onFinalizeCloseout={vi.fn()}
        onRecordDeposit={vi.fn()}
        onReviewCloseout={vi.fn()}
        onSubmitCloseout={vi.fn()}
        orgUrlSlug="wigclub"
        registerSessionSnapshot={{
          ...baseSnapshot,
          closeoutReview: {
            hasVariance: true,
            requiresApproval: true,
            variance: -307000,
          },
          registerSession: {
            ...baseSnapshot.registerSession,
            countedCash: 1583000,
            expectedCash: 1583000,
            netExpectedCash: 1583000,
            pendingVoidApprovals: {
              cashAffectingCount: 2,
              cashAmount: 307000,
              count: 2,
              items: [],
            },
            variance: -307000,
          },
        }}
        storeId="store-1"
        storeUrlSlug="wigclub"
      />,
    );

    const submittedCloseout = screen
      .getByText("Submitted closeout")
      .closest("div");
    const metrics = submittedCloseout?.querySelector("dl");

    expect(metrics).toHaveClass("flex", "flex-wrap");
    expect(
      within(metrics as HTMLElement).getByText("Expected now"),
    ).toBeInTheDocument();
    expect(
      within(metrics as HTMLElement).getByText("After adjustments"),
    ).toBeInTheDocument();
    expect(
      within(metrics as HTMLElement).getByText("Counted"),
    ).toBeInTheDocument();
    expect(
      within(metrics as HTMLElement).getByText("Variance"),
    ).toBeInTheDocument();
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
        label: "Register 3 closeout correction",
        type: "register_session",
      },
      username: "manager",
    });
    await waitFor(() =>
      expect(onSubmitCloseout).toHaveBeenCalledWith({
        actorStaffProfileId: "staff-1",
        closeoutModificationApprovalProofId: "approval-proof-2",
        countedCash: 17600,
        notes: undefined,
        registerSessionId: "session-1",
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
        registerSessionSnapshot={activeSnapshot}
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
        staffPinHash: "hashed-pin",
        staffUsername: "ato",
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
        registerSessionSnapshot={activeSnapshot}
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
        staffPinHash: "hashed-pin",
        staffUsername: "ato",
      }),
    );
  });

  it("uses a decimal text input for closeout counted cash", async () => {
    const user = userEvent.setup();

    render(
      <RegisterSessionViewContent
        actorUserId="user-1"
        currency="GHS"
        isLoading={false}
        onAuthenticateStaff={vi.fn()}
        onRecordDeposit={vi.fn()}
        onReviewCloseout={vi.fn()}
        onSubmitCloseout={vi.fn()}
        registerSessionSnapshot={activeSnapshot}
        storeId="store-1"
      />,
    );

    const input = screen.getByLabelText("Closeout counted cash");

    expect(input).toHaveAttribute("type", "text");
    expect(input).toHaveAttribute("inputmode", "decimal");
    expect(input).toHaveAttribute("pattern", "[0-9]*[.]?[0-9]*");

    await user.type(input, "30");

    expect(input).toHaveValue("30");
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
        staffPinHash: "hashed-pin",
        staffUsername: "ato",
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
    expect(screen.getByText("Corrected amount ($)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Submit" })).toHaveClass(
      "bg-action-workflow",
    );
    expect(
      screen
        .getByRole("heading", { name: "Opening float correction" })
        .compareDocumentPosition(screen.getByText("Linked transactions")) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
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
        label: "Register 3 opening float correction",
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
        "Opening float corrections are unavailable after closeout starts.",
      ),
    ).toBeInTheDocument();
  });

  it("keeps prior submitted closeout data visible while showing the reopened correction form", () => {
    render(
      <RegisterSessionViewContent
        actorStaffProfileId="staff-1"
        actorUserId="user-1"
        currency="GHS"
        isLoading={false}
        onRecordDeposit={vi.fn()}
        {...closeoutHandlers}
        registerSessionSnapshot={{
          ...baseSnapshot,
          closeoutReview: {
            hasVariance: false,
            reason: null,
            requiresApproval: false,
            variance: 0,
          },
          registerSession: {
            ...baseSnapshot.registerSession,
            closeoutRecords: [
              {
                actorStaffProfileId: "staff-1",
                countedCash: 17100,
                expectedCash: 17600,
                occurredAt: 1,
                type: "closed",
                variance: -500,
              },
              {
                actorStaffProfileId: "manager-1",
                countedCash: 17100,
                expectedCash: 17600,
                occurredAt: 2,
                type: "reopened",
                variance: -500,
              },
            ],
            countedCash: 17100,
            status: "closing",
            variance: -500,
          },
        }}
        storeId="store-1"
      />,
    );

    expect(screen.getByText("Previous submitted closeout")).toBeInTheDocument();
    expect(screen.getAllByText("GH₵171").length).toBeGreaterThan(0);
    expect(screen.getAllByText("GH₵176").length).toBeGreaterThan(0);
    expect(screen.getByLabelText("Closeout counted cash")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Submit closeout" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Ready for final closeout"),
    ).not.toBeInTheDocument();
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
    const approveVarianceButton = screen.getByRole("button", {
      name: "Approve variance",
    });
    expect(approveVarianceButton).toHaveClass("bg-action-workflow");
    await user.click(approveVarianceButton);
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
      "/wigclub/store/wigclub/pos/transactions?o=%252F&registerSessionId=session-1",
    );
  });

  it("uses manager elevation financial access for register detail visibility", () => {
    protectedPageMocks.useProtectedAdminPageState.mockReturnValue({
      activeStore: {
        _id: "store-1",
        currency: "USD",
      },
      canAccessProtectedSurface: true,
      canQueryProtectedData: true,
      hasFinancialDetailsAccess: true,
      hasFullAdminAccess: false,
      isAuthenticated: true,
      isLoadingAccess: false,
    });
    authMocks.useAuth.mockReturnValue({
      user: { _id: "user-1" },
    });
    convexMocks.useMutation.mockReturnValue(vi.fn());
    convexMocks.useQuery.mockImplementation((_query, args) => {
      if (args === "skip") {
        return undefined;
      }

      if ("registerSessionId" in args) {
        return activeSnapshot;
      }

      return [
        {
          _id: "staff-1",
          linkedUserId: "user-1",
          roles: ["cashier"],
          status: "active",
          storeId: "store-1",
        },
      ];
    });

    render(<RegisterSessionView />);

    expect(screen.getAllByText("$176").length).toBeGreaterThan(0);
    expect(screen.queryByText("Manager only")).not.toBeInTheDocument();
  });
});
