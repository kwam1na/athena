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
            reason: "Variance of -6100 exceeded the closeout approval threshold.",
            requiresApproval: true,
            variance: -6100,
          },
          registerSession: {
            ...baseSnapshot.registerSession,
            pendingApprovalRequest: {
              _id: "approval-1",
              reason: "Variance of -6100 exceeded the closeout approval threshold.",
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
    const onSubmitCloseout = vi.fn().mockResolvedValue(ok({ action: "closed" }));

    render(
      <RegisterSessionViewContent
        actorUserId="user-1"
        currency="GHS"
        isLoading={false}
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

    await waitFor(() =>
      expect(onSubmitCloseout).toHaveBeenCalledWith({
        countedCash: 18000,
        notes: "Final count after second safe drop.",
        registerSessionId: "session-1",
      }),
    );
  });

  it("reviews a pending closeout approval from the register detail page", async () => {
    const user = userEvent.setup();
    const onReviewCloseout = vi
      .fn()
      .mockResolvedValue(ok({ action: "approved" }));

    render(
      <RegisterSessionViewContent
        actorUserId="user-1"
        currency="GHS"
        isLoading={false}
        onRecordDeposit={vi.fn()}
        onReviewCloseout={onReviewCloseout}
        onSubmitCloseout={vi.fn()}
        registerSessionSnapshot={{
          ...baseSnapshot,
          closeoutReview: {
            hasVariance: true,
            reason: "Variance of -500 exceeded the closeout approval threshold.",
            requiresApproval: true,
            variance: -500,
          },
          registerSession: {
            ...baseSnapshot.registerSession,
            pendingApprovalRequest: {
              _id: "approval-1",
              reason: "Variance of -500 exceeded the closeout approval threshold.",
              requestedByStaffName: "Ama Mensah",
              status: "pending",
            },
          },
        }}
        storeId="store-1"
      />,
    );

    expect(screen.getByText("Manager review required")).toBeInTheDocument();
    expect(screen.getAllByText("Expected").length).toBeGreaterThan(0);
    expect(screen.getAllByText("GH₵176").length).toBeGreaterThan(1);

    await user.type(
      screen.getByLabelText("Manager closeout notes"),
      "Deposit variance approved.",
    );
    await user.click(screen.getByRole("button", { name: "Approve variance" }));

    await waitFor(() =>
      expect(onReviewCloseout).toHaveBeenCalledWith({
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
