import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  GENERIC_UNEXPECTED_ERROR_MESSAGE,
  ok,
  userError,
} from "~/shared/commandResult";

import { RegisterSessionViewContent } from "./RegisterSessionView";

const routerMocks = vi.hoisted(() => ({
  navigate: vi.fn(),
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
}));

vi.mock("../common/PageHeader", () => ({
  ComposedPageHeader: ({
    leadingContent,
    trailingContent,
  }: {
    leadingContent: React.ReactNode;
    trailingContent?: React.ReactNode;
  }) => (
    <div>
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
    onAuthenticated: (result: {
      approvalProofId?: string;
      staffProfile: { fullName: string };
      staffProfileId: string;
    }) => void;
    open: boolean;
  }) =>
    open ? (
      <button
        type="button"
        onClick={async () => {
          await onAuthenticate({
            mode: "authenticate",
            pinHash: "hashed-pin",
            username: "ato",
          });
          onAuthenticated({
            approvalProofId: "approval-proof-1",
            staffProfile: { fullName: "Ato Kofi" },
            staffProfileId: "staff-1",
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
          await onAuthenticateForApproval({
            actionKey: "cash_controls.register_session.correct_opening_float",
            pinHash: "hashed-pin",
            requiredRole: approval.requiredRole,
            storeId: "store-1",
            subject: approval.subject,
            username: "manager",
          });
          onApproved({
            approval,
            approvalProofId: "approval-proof-1",
            approvedByStaffProfileId: "manager-1",
            expiresAt: Date.now() + 60_000,
          });
        }}
      >
        Approve correction
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
    total: number;
    transactionNumber: string;
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

  it("shows a loading state while the register session is loading", () => {
    render(
      <RegisterSessionViewContent
        actorUserId="user-1"
        currency="USD"
        isLoading
        onRecordDeposit={vi.fn()}
        {...closeoutHandlers}
        registerSessionSnapshot={baseSnapshot}
        storeId="store-1"
      />,
    );

    expect(screen.getByText("Loading register session...")).toBeInTheDocument();
  });

  it("renders the register summary, closeout review, and deposits", () => {
    render(
      <RegisterSessionViewContent
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
    expect(screen.getByText("Front counter")).toBeInTheDocument();
    expect(screen.getByText("Session")).toBeInTheDocument();
    expect(screen.getByText("Code")).toBeInTheDocument();
    expect(screen.getByText("SION-1")).toBeInTheDocument();
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
    const transactionRow = screen.getByRole("link", {
      name: "Open transaction #TXN-0031",
    });
    expect(transactionRow).toBeInTheDocument();
    expect(screen.getByText(/3 items - Esi Boateng/i)).toBeInTheDocument();
    expect(screen.getAllByText("Ama M.").length).toBeGreaterThan(0);
    expect(screen.getByText("Variance review required.")).toBeInTheDocument();
    expect(screen.getByText("Closeout workflow")).toBeInTheDocument();
    expect(screen.getByLabelText("Closeout counted cash")).toHaveValue(171);
    expect(
      screen.getByRole("button", { name: "Submit closeout" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Deposit history")).toBeInTheDocument();
    expect(screen.getByText("Record cash deposit")).toBeInTheDocument();
    expect(screen.getByText("BANK-339")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "View trace" }),
    ).toBeInTheDocument();
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
        "Variance of GH₵-61 exceeded the closeout approval threshold.",
      ).length,
    ).toBeGreaterThan(0);
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
        countedCash: 18000,
        notes: "Final count after second safe drop.",
        registerSessionId: "session-1",
      }),
    );
  });

  it("submits an opening float correction after manager command approval", async () => {
    const user = userEvent.setup();
    const onAuthenticateForApproval = vi
      .fn()
      .mockResolvedValue(
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
      "Opening float corrected.",
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
        "Review the rejected closeout, then recount or correct the drawer.",
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
              eventType: "pos_transaction_payment_method_approval_proof_consumed",
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
    const onAuthenticateCloseoutReviewApproval = vi
      .fn()
      .mockResolvedValue(
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
              total: 15200,
              transactionNumber: "TXN-0031",
            },
          ],
        }}
        orgUrlSlug="wigclub"
        storeId="store-1"
        storeUrlSlug="wigclub"
      />,
    );

    await user.click(
      screen.getByRole("link", { name: "Open transaction #TXN-0031" }),
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
    expect(screen.getByText("#TXN-0001")).toBeInTheDocument();
    expect(screen.getByText("#TXN-0005")).toBeInTheDocument();
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
        actorStaffProfileId: undefined,
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
