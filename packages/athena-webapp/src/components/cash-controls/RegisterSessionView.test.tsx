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

  it("shows a loading state while the register session is loading", () => {
    render(
      <RegisterSessionViewContent
        actorUserId="user-1"
        currency="USD"
        isLoading
        onRecordDeposit={vi.fn()}
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
    expect(
      screen.getByText((_, element) =>
        Boolean(
          element?.tagName === "DD" &&
          element.textContent?.replace(/\s+/g, " ").trim() === "By Ama M.",
        ),
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Linked transactions")).toBeInTheDocument();
    const transactionRow = screen.getByRole("link", {
      name: "Open transaction #TXN-0031",
    });
    expect(transactionRow).toBeInTheDocument();
    expect(screen.getByText(/3 items - Esi Boateng/i)).toBeInTheDocument();
    expect(screen.getAllByText("Ama M.").length).toBeGreaterThan(0);
    expect(screen.getByText("Variance review required.")).toBeInTheDocument();
    expect(screen.getByText("Deposit history")).toBeInTheDocument();
    expect(screen.getByText("Record cash deposit")).toBeInTheDocument();
    expect(screen.getByText("BANK-339")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "View trace" }),
    ).toBeInTheDocument();
  });

  it("opens the transaction detail when the linked transaction row is clicked", async () => {
    const user = userEvent.setup();

    render(
      <RegisterSessionViewContent
        actorUserId="user-1"
        currency="USD"
        isLoading={false}
        onRecordDeposit={vi.fn()}
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
