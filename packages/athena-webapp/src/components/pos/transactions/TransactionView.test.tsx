import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  formatCorrectionEventType,
  formatCorrectionHistoryChange,
  formatCorrectionHistoryTitle,
  formatPaymentMethodLabel,
  getCorrectionHistoryChangeParts,
  TransactionView,
} from "./TransactionView";

const useQueryMock = vi.fn();
const useMutationMock = vi.fn();
const useParamsMock = vi.fn();
const useProtectedAdminPageStateMock = vi.fn();

vi.mock("convex/react", () => ({
  useMutation: (...args: unknown[]) => useMutationMock(...args),
  useQuery: (...args: unknown[]) => useQueryMock(...args),
}));

vi.mock("@tanstack/react-router", () => ({
  useParams: (...args: unknown[]) => useParamsMock(...args),
}));

vi.mock("../../View", () => ({
  default: ({
    children,
    header,
  }: {
    children?: React.ReactNode;
    header?: React.ReactNode;
  }) => (
    <div>
      {header}
      {children}
    </div>
  ),
}));

vi.mock("../../common/FadeIn", () => ({
  FadeIn: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));

vi.mock("../../common/PageHeader", () => ({
  ComposedPageHeader: ({
    leadingContent,
    trailingContent,
  }: {
    leadingContent: React.ReactNode;
    trailingContent?: React.ReactNode;
  }) => (
    <header>
      {leadingContent}
      <div data-testid="header-trailing">{trailingContent}</div>
    </header>
  ),
}));

vi.mock("../../ui/badge", () => ({
  Badge: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

vi.mock("../../ui/card", () => ({
  Card: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  CardContent: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  CardHeader: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  CardTitle: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

vi.mock("../../ui/input", () => ({
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => (
    <input {...props} />
  ),
}));

vi.mock("../../ui/select", () => ({
  Select: ({
    children,
    onValueChange,
    value,
  }: {
    children?: React.ReactNode;
    onValueChange?: (value: string) => void;
    value?: string;
  }) => (
    <select
      aria-label="Updated payment method"
      onChange={(event) => onValueChange?.(event.target.value)}
      value={value}
    >
      {children}
    </select>
  ),
  SelectContent: ({ children }: { children?: React.ReactNode }) => (
    <>{children}</>
  ),
  SelectItem: ({
    children,
    value,
  }: {
    children?: React.ReactNode;
    value: string;
  }) => <option value={value}>{children}</option>,
  SelectTrigger: ({ children }: { children?: React.ReactNode }) => (
    <>{children}</>
  ),
  SelectValue: ({ placeholder }: { placeholder?: string }) => (
    <option value="">{placeholder}</option>
  ),
}));

vi.mock("~/src/hooks/useProtectedAdminPageState", () => ({
  useProtectedAdminPageState: () => useProtectedAdminPageStateMock(),
}));

vi.mock("../../staff-auth/StaffAuthenticationDialog", () => ({
  StaffAuthenticationDialog: ({
    copy,
    onAuthenticate,
    onAuthenticated,
    open,
  }: {
    copy: {
      description: string;
      submitLabel: string;
      title: string;
    };
    onAuthenticate: (args: {
      pinHash: string;
      username: string;
    }) => Promise<unknown>;
    onAuthenticated: (
      result: {
        activeRoles?: string[];
        approvalProofId?: string;
        approvedByStaffProfileId?: string;
        expiresAt?: number;
        staffProfile: { firstName: string; lastName: string };
        staffProfileId: string;
      },
      mode: "authenticate",
      credentials: { pinHash: string; username: string },
    ) => void;
    open: boolean;
  }) =>
    open ? (
      <div data-testid="staff-auth-dialog">
        <h2>{copy.title}</h2>
        <p>{copy.description}</p>
        <button
          onClick={async () => {
            const result = await onAuthenticate({
              pinHash: "123456",
              username: "manager",
            });
            if (
              result &&
              typeof result === "object" &&
              "kind" in result &&
              result.kind === "ok" &&
              "data" in result
            ) {
              onAuthenticated(result.data as never, "authenticate", {
                pinHash: "123456",
                username: "manager",
              });
            }
          }}
          type="button"
        >
          {copy.submitLabel}
        </button>
      </div>
    ) : null,
}));

vi.mock("../../operations/CommandApprovalDialog", () => ({
  CommandApprovalDialog: ({
    approval,
    onAuthenticateForApproval,
    onApproved,
    open,
    requestedByStaffProfileId,
  }: {
    approval: {
      action: { key: string };
      copy: { message: string; primaryActionLabel?: string; title: string };
      reason: string;
      requiredRole: "manager";
      resolutionModes: Array<{
        kind: string;
        approvalRequestId?: string;
        requestType?: string;
      }>;
      subject: { id: string; label?: string; type: string };
    } | null;
    onAuthenticateForApproval: (args: {
      actionKey: string;
      pinHash: string;
      reason?: string;
      requiredRole: "manager";
      requestedByStaffProfileId?: string;
      storeId: string;
      subject: { id: string; label?: string; type: string };
      username: string;
    }) => Promise<{
      kind: "ok" | "user_error";
      data?: {
        approvalProofId: string;
        approvedByStaffProfileId: string;
        expiresAt: number;
      };
    }>;
    onApproved: (result: {
      approvalProofId: string;
      approvedByStaffProfileId: string;
      expiresAt: number;
    }) => void;
    open: boolean;
    requestedByStaffProfileId?: string;
  }) =>
    open && approval ? (
      <div data-testid="command-approval-dialog">
        <h2>{approval.copy.title}</h2>
        <p>{approval.copy.message}</p>
        {approval.resolutionModes.some(
          (mode) => mode.kind === "inline_manager_proof",
        ) ? (
          <button
            onClick={async () => {
              const result = await onAuthenticateForApproval({
                actionKey: approval.action.key,
                pinHash: "123456",
                reason: approval.reason,
                requiredRole: approval.requiredRole,
                requestedByStaffProfileId,
                storeId: "store_1",
                subject: approval.subject,
                username: "manager",
              });

              if (result.kind === "ok" && result.data) {
                onApproved({
                  approvalProofId: result.data.approvalProofId,
                  approvedByStaffProfileId: result.data.approvedByStaffProfileId,
                  expiresAt: result.data.expiresAt,
                });
              }
            }}
            type="button"
          >
            {approval.copy.primaryActionLabel ?? "Approve update"}
          </button>
        ) : (
          <p>
            Approval request{" "}
            {approval.resolutionModes.find(
              (mode) => mode.kind === "async_request",
            )?.approvalRequestId ?? "approval-1"}{" "}
            is pending in the review queue.
          </p>
        )}
      </div>
    ) : null,
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
  },
}));

vi.mock("../OrderSummary", () => ({
  OrderSummary: () => <div data-testid="order-summary" />,
}));

vi.mock("../CartItems", () => ({
  CartItems: () => <div data-testid="cart-items" />,
}));

vi.mock("../../traces/WorkflowTraceRouteLink", () => ({
  WorkflowTraceRouteLink: ({
    traceId,
    children,
  }: {
    traceId: string;
    children?: React.ReactNode;
  }) => (
    <span data-testid="session-trace-link">
      {traceId}
      {children ? `:${children}` : ""}
    </span>
  ),
}));

vi.mock("../../ui/button", () => ({
  Button: ({
    asChild,
    children,
    ...props
  }: {
    asChild?: boolean;
    children?: React.ReactNode;
  } & React.ButtonHTMLAttributes<HTMLButtonElement>) =>
    asChild ? (
      <>{children}</>
    ) : (
      <button type="button" {...props}>
        {children}
      </button>
    ),
}));

describe("TransactionView", () => {
  const baseTransaction = {
    _id: "txn_1",
    transactionNumber: "POS-123456",
    subtotal: 1000,
    tax: 0,
    total: 1000,
    hasTrace: false,
    sessionTraceId: null,
    paymentMethod: "cash",
    payments: [{ method: "cash", amount: 1000, timestamp: 123 }],
    totalPaid: 1000,
    status: "completed",
    completedAt: 100,
    cashier: null,
    customer: null,
    customerInfo: undefined,
    items: [],
  };

  function paymentApprovalRequirement(transactionId = "txn_19") {
    return {
      action: { key: "pos.transaction.correct_payment_method" },
      copy: {
        title: "Manager approval required",
        message:
          "A manager needs to review this completed transaction payment method update before it is applied.",
        primaryActionLabel: "Approve update",
      },
      reason:
        "Manager approval is required to correct a completed transaction payment method.",
      requiredRole: "manager" as const,
      resolutionModes: [
        { kind: "inline_manager_proof" },
        {
          approvalRequestId: "approval-1",
          kind: "async_request",
          requestType: "payment_method_correction",
        },
      ],
      subject: {
        id: transactionId,
        label: "Transaction #POS-123456",
        type: "pos_transaction",
      },
    };
  }

  beforeEach(() => {
    useMutationMock.mockReset();
    useMutationMock.mockReturnValue(vi.fn());
    useQueryMock.mockReset();
    useParamsMock.mockReset();
    useProtectedAdminPageStateMock.mockReturnValue({
      activeStore: { _id: "store_1" },
      isAuthenticated: true,
    });
  });

  function mockTransactionMutations(
    authMutation: ReturnType<typeof vi.fn>,
    customerMutation: ReturnType<typeof vi.fn>,
    paymentMutation: ReturnType<typeof vi.fn>,
    approvalMutation: ReturnType<typeof vi.fn> = vi.fn(),
  ) {
    const mutations = [
      authMutation,
      approvalMutation,
      paymentMutation,
      customerMutation,
    ];
    let mutationIndex = 0;
    useMutationMock.mockImplementation(
      () => mutations[mutationIndex++ % mutations.length],
    );
  }

  it("renders nothing until the route provides a transaction id", () => {
    useParamsMock.mockReturnValue({});

    const { container } = render(<TransactionView />);

    expect(container.innerHTML).toBe("");
  });

  it("renders the loading shell while the transaction is unresolved", () => {
    useParamsMock.mockReturnValue({ transactionId: "txn_loading" });
    useQueryMock.mockReturnValue(undefined);

    const { container } = render(<TransactionView />);

    expect(container.querySelector(".min-h-\\[50vh\\]")).toBeInTheDocument();
  });

  it("renders the session trace link when the transaction has a session trace", () => {
    useParamsMock.mockReturnValue({ transactionId: "txn_1" });
    useQueryMock.mockReturnValue({
      _id: "txn_1",
      transactionNumber: "POS-123456",
      subtotal: 1000,
      tax: 0,
      total: 1000,
      hasTrace: true,
      sessionTraceId: "pos_session:ses-001",
      paymentMethod: "cash",
      payments: [],
      totalPaid: 1000,
      status: "completed",
      completedAt: 100,
      cashier: null,
      customer: null,
      customerInfo: undefined,
      items: [],
    });

    render(<TransactionView />);

    expect(screen.getByTestId("header-trailing")).toContainElement(
      screen.getByTestId("session-trace-link"),
    );
    expect(screen.getByTestId("session-trace-link")).toHaveTextContent(
      "pos_session:ses-001:View trace",
    );
  });

  it("hides the workflow trace link when the transaction does not have a trace", () => {
    useParamsMock.mockReturnValue({ transactionId: "txn_2" });
    useQueryMock.mockReturnValue({
      _id: "txn_2",
      transactionNumber: "POS-654321",
      subtotal: 1000,
      tax: 0,
      total: 1000,
      hasTrace: false,
      sessionTraceId: null,
      paymentMethod: "cash",
      payments: [],
      totalPaid: 1000,
      status: "completed",
      completedAt: 100,
      cashier: null,
      customer: null,
      customerInfo: undefined,
      items: [],
    });

    render(<TransactionView />);

    expect(screen.queryByTestId("session-trace-link")).not.toBeInTheDocument();
  });

  it("renders completed transaction customer contact details", () => {
    useParamsMock.mockReturnValue({ transactionId: "txn_customer" });
    useQueryMock.mockReturnValue({
      ...baseTransaction,
      _id: "txn_customer",
      customer: {
        email: "ama@example.com",
        name: "Ama Mensah",
        phone: "0240000000",
      },
    });

    render(<TransactionView />);

    expect(screen.getByText("Customer")).toBeInTheDocument();
    expect(screen.getByText("Ama Mensah")).toBeInTheDocument();
    expect(screen.getByText("ama@example.com • 0240000000")).toBeInTheDocument();
  });

  it("renders fallback customer info without an email and phone separator", () => {
    useParamsMock.mockReturnValue({ transactionId: "txn_customer_info" });
    useQueryMock.mockReturnValue({
      ...baseTransaction,
      _id: "txn_customer_info",
      customerInfo: {
        name: "Walk-in pickup",
        phone: "0550000000",
      },
    });

    render(<TransactionView />);

    expect(screen.getByText("Walk-in pickup")).toBeInTheDocument();
    expect(screen.getByText("0550000000")).toBeInTheDocument();
    expect(screen.queryByText(/ • /)).not.toBeInTheDocument();
  });

  it("displays only the payment method type for completed transactions", () => {
    useParamsMock.mockReturnValue({ transactionId: "txn_3" });
    useQueryMock.mockReturnValue({
      _id: "txn_3",
      transactionNumber: "POS-777777",
      subtotal: 1200,
      tax: 0,
      total: 1000,
      hasTrace: false,
      sessionTraceId: null,
      paymentMethod: "cash",
      payments: [{ method: "cash", amount: 1000, timestamp: 123 }],
      totalPaid: 1300,
      changeGiven: 300,
      status: "completed",
      completedAt: 100,
      cashier: null,
      customer: null,
      customerInfo: undefined,
      items: [],
    });

    render(<TransactionView />);

    expect(screen.getByText("cash")).toBeInTheDocument();
    expect(screen.queryByText(/Amount paid:/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Change given:/)).not.toBeInTheDocument();
  });

  it("displays multiple payment methods when more than one payment method is used", () => {
    useParamsMock.mockReturnValue({ transactionId: "txn_4" });
    useQueryMock.mockReturnValue({
      _id: "txn_4",
      transactionNumber: "POS-888888",
      subtotal: 1200,
      tax: 0,
      total: 1000,
      hasTrace: false,
      sessionTraceId: null,
      paymentMethod: "cash",
      payments: [
        { method: "cash", amount: 500, timestamp: 1 },
        { method: "card", amount: 500, timestamp: 2 },
      ],
      totalPaid: 1000,
      changeGiven: 0,
      status: "completed",
      completedAt: 100,
      cashier: null,
      customer: null,
      customerInfo: undefined,
      items: [],
    });

    const { container } = render(<TransactionView />);

    expect(screen.getByText("Multiple payment methods")).toBeInTheDocument();
    expect(container.querySelector(".lucide-wallet-cards")).toBeInTheDocument();
  });

  it("shows the matching single payment method icon for single-method transactions", () => {
    useParamsMock.mockReturnValue({ transactionId: "txn_5" });
    useQueryMock.mockReturnValue({
      _id: "txn_5",
      transactionNumber: "POS-999999",
      subtotal: 1200,
      tax: 0,
      total: 1000,
      hasTrace: false,
      sessionTraceId: null,
      paymentMethod: "cash",
      payments: [{ method: "cash", amount: 1000, timestamp: 1 }],
      totalPaid: 1000,
      changeGiven: 0,
      status: "completed",
      completedAt: 100,
      cashier: null,
      customer: null,
      customerInfo: undefined,
      items: [],
    });

    const { container } = render(<TransactionView />);

    expect(screen.getByText(/cash/i)).toBeInTheDocument();
    expect(
      container.querySelector(".lucide-wallet-cards"),
    ).not.toBeInTheDocument();
    expect(container.querySelector(".lucide-banknote")).toBeInTheDocument();
  });

  it("renders exposed correction categories for completed transactions", async () => {
    const user = userEvent.setup();
    useParamsMock.mockReturnValue({ transactionId: "txn_6" });
    useQueryMock.mockReturnValue(baseTransaction);

    render(<TransactionView />);

    await user.click(screen.getByRole("button", { name: "Update" }));

    expect(
      screen.getByRole("button", { name: "Customer attribution" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Payment method" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Items or quantities" }),
    ).toBeInTheDocument();
  });

  it("routes high-risk transaction corrections to safe guidance", async () => {
    const user = userEvent.setup();
    useParamsMock.mockReturnValue({ transactionId: "txn_7" });
    useQueryMock.mockReturnValue(baseTransaction);

    render(<TransactionView />);

    await user.click(screen.getByRole("button", { name: "Update" }));
    await user.click(screen.getByRole("button", { name: "Amounts or totals" }));

    expect(
      screen.getByText(
        "Use refund, exchange, or manager review for item, amount, total, or discount updates.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByLabelText("Payment method update reason"),
    ).not.toBeInTheDocument();
  });

  it("clears correction errors when closing the correction workflow", async () => {
    const user = userEvent.setup();
    useParamsMock.mockReturnValue({ transactionId: "txn_16" });
    useQueryMock.mockReturnValue(baseTransaction);

    render(<TransactionView />);

    await user.click(screen.getByRole("button", { name: "Update" }));
    await user.click(screen.getByRole("button", { name: "Payment method" }));
    await user.selectOptions(
      screen.getByLabelText("Updated payment method"),
      "card",
    );
    await user.click(
      screen.getByRole("button", { name: "Submit payment update" }),
    );

    expect(
      screen.getByText("Add a reason for this update"),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Update" }));
    await user.click(screen.getByRole("button", { name: "Update" }));

    expect(
      screen.queryByText("Add a reason for this update"),
    ).not.toBeInTheDocument();
  });

  it("places payment method reason errors under the reason input", async () => {
    const user = userEvent.setup();
    useParamsMock.mockReturnValue({ transactionId: "txn_17" });
    useQueryMock.mockReturnValue(baseTransaction);

    render(<TransactionView />);

    await user.click(screen.getByRole("button", { name: "Update" }));
    await user.click(screen.getByRole("button", { name: "Payment method" }));
    await user.selectOptions(
      screen.getByLabelText("Updated payment method"),
      "card",
    );
    await user.click(
      screen.getByRole("button", { name: "Submit payment update" }),
    );

    const reasonInput = screen.getByLabelText("Payment method update reason");
    const reasonError = screen.getByText("Add a reason for this update");
    const formChildren = Array.from(reasonInput.parentElement?.children ?? []);

    expect(formChildren.indexOf(reasonError)).toBe(
      formChildren.indexOf(reasonInput) + 1,
    );
  });

  it("places customer reason errors under the customer reason input", async () => {
    const user = userEvent.setup();
    useParamsMock.mockReturnValue({ transactionId: "txn_20" });
    useQueryMock.mockReturnValue(baseTransaction);

    render(<TransactionView />);

    await user.click(screen.getByRole("button", { name: "Update" }));
    await user.click(
      screen.getByRole("button", { name: "Customer attribution" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Submit customer update" }),
    );

    const reasonInput = screen.getByLabelText("Customer update reason");
    const reasonError = screen.getByText("Add a reason for this update");
    const formChildren = Array.from(reasonInput.parentElement?.children ?? []);

    expect(formChildren.indexOf(reasonError)).toBe(
      formChildren.indexOf(reasonInput) + 1,
    );
  });

  it("keeps payment method selection errors with the payment method form", async () => {
    const user = userEvent.setup();
    useParamsMock.mockReturnValue({ transactionId: "txn_21" });
    useQueryMock.mockReturnValue(baseTransaction);

    render(<TransactionView />);

    await user.click(screen.getByRole("button", { name: "Update" }));
    await user.click(screen.getByRole("button", { name: "Payment method" }));
    await user.type(
      screen.getByLabelText("Payment method update reason"),
      "Wrong tender selected",
    );
    await user.click(
      screen.getByRole("button", { name: "Submit payment update" }),
    );

    expect(
      screen.getByText("Choose the updated payment method"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Add a reason for this update")).not.toBeInTheDocument();
    expect(screen.getByText("Same-amount payment method update")).toBeInTheDocument();
  });

  it("disables payment method correction when the transaction is not same-amount eligible", async () => {
    const user = userEvent.setup();
    useParamsMock.mockReturnValue({ transactionId: "txn_14" });
    useQueryMock.mockReturnValue({
      ...baseTransaction,
      payments: [
        { method: "cash", amount: 800, timestamp: 1 },
        { method: "card", amount: 200, timestamp: 2 },
      ],
    });

    render(<TransactionView />);

    await user.click(screen.getByRole("button", { name: "Update" }));

    expect(
      screen.getByRole("button", { name: "Payment method" }),
    ).toBeDisabled();
    expect(
      screen.getByText(
        "Only same-amount payment method updates are supported",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByLabelText("Payment method update reason"),
    ).not.toBeInTheDocument();
  });

  it("disables payment method correction when change was given", async () => {
    const user = userEvent.setup();
    useParamsMock.mockReturnValue({ transactionId: "txn_15" });
    useQueryMock.mockReturnValue({
      ...baseTransaction,
      changeGiven: 100,
      totalPaid: 1100,
    });

    render(<TransactionView />);

    await user.click(screen.getByRole("button", { name: "Update" }));

    expect(
      screen.getByRole("button", { name: "Payment method" }),
    ).toBeDisabled();
    expect(
      screen.getByText(
        "Only same-amount payment method updates are supported",
      ),
    ).toBeInTheDocument();
  });

  it("disables payment method correction while the register session is closing", async () => {
    const user = userEvent.setup();
    useParamsMock.mockReturnValue({ transactionId: "txn_18" });
    useQueryMock.mockReturnValue({
      ...baseTransaction,
      registerNumber: "3",
      registerSessionStatus: "closing",
    });

    render(<TransactionView />);

    await user.click(screen.getByRole("button", { name: "Update" }));

    expect(
      screen.getByRole("button", { name: "Payment method" }),
    ).toBeDisabled();
    expect(
      screen.getByText(
        "Reopen Register 3 to update payment details",
      ),
    ).toBeInTheDocument();
  });

  it("uses a generic reopen message when a closing register has no number", async () => {
    const user = userEvent.setup();
    useParamsMock.mockReturnValue({ transactionId: "txn_22" });
    useQueryMock.mockReturnValue({
      ...baseTransaction,
      registerNumber: undefined,
      registerSessionStatus: "closing",
    });

    render(<TransactionView />);

    await user.click(screen.getByRole("button", { name: "Update" }));

    expect(
      screen.getByRole("button", { name: "Payment method" }),
    ).toBeDisabled();
    expect(
      screen.getByText(
        "Reopen this transaction's register to update payment details",
      ),
    ).toBeInTheDocument();
  });

  it("uses a select for same-amount payment method corrections", async () => {
    const user = userEvent.setup();
    useParamsMock.mockReturnValue({ transactionId: "txn_8" });
    useQueryMock.mockReturnValue(baseTransaction);

    render(<TransactionView />);

    await user.click(screen.getByRole("button", { name: "Update" }));
    await user.click(screen.getByRole("button", { name: "Payment method" }));

    const paymentMethodSelect = screen.getByLabelText(
      "Updated payment method",
    );
    expect(paymentMethodSelect.tagName).toBe("SELECT");

    await user.selectOptions(paymentMethodSelect, "card");

    expect(paymentMethodSelect).toHaveValue("card");
    expect(
      screen.queryByPlaceholderText("cash, card, mobile_money..."),
    ).not.toBeInTheDocument();
  });

  it("filters the current payment method from correction options", async () => {
    const user = userEvent.setup();
    useParamsMock.mockReturnValue({ transactionId: "txn_17" });
    useQueryMock.mockReturnValue({
      ...baseTransaction,
      paymentMethod: "card",
      payments: [{ method: "card", amount: 1000, timestamp: 123 }],
    });

    render(<TransactionView />);

    await user.click(screen.getByRole("button", { name: "Update" }));
    await user.click(screen.getByRole("button", { name: "Payment method" }));

    const paymentMethodSelect = screen.getByLabelText(
      "Updated payment method",
    );
    expect(paymentMethodSelect).not.toHaveTextContent("Card");
    expect(paymentMethodSelect).toHaveTextContent("Cash");
    expect(paymentMethodSelect).toHaveTextContent("Mobile Money");
  });

  it("queues async manager approval for payment corrections", async () => {
    const user = userEvent.setup();
    const authMutation = vi.fn().mockResolvedValue({
      kind: "ok",
      data: {
        activeRoles: ["cashier"],
        staffProfile: { firstName: "Kwamina", lastName: "Mensah" },
        staffProfileId: "staff_1",
      },
    });
    const approvalMutation = vi.fn().mockResolvedValue({
      kind: "ok",
      data: {
        approvalProofId: "proof-1",
        approvedByStaffProfileId: "staff_1",
        expiresAt: 2,
      },
    });
    const customerMutation = vi.fn();
    const paymentMutation = vi.fn().mockResolvedValue({
      kind: "approval_required",
      approval: {
        action: { key: "pos.transaction.correct_payment_method" },
        copy: {
          title: "Manager approval required",
          message:
            "A manager needs to review this completed transaction payment method update before it is applied.",
          primaryActionLabel: "Request approval",
        },
        reason:
          "Manager approval is required to correct a completed transaction payment method.",
        requiredRole: "manager",
        resolutionModes: [
          {
            kind: "async_request",
            requestType: "payment_method_correction",
            approvalRequestId: "approval-1",
          },
        ],
        subject: {
          id: "txn_13",
          label: "Transaction #754489",
          type: "pos_transaction",
        },
      },
    });
    mockTransactionMutations(
      authMutation,
      customerMutation,
      paymentMutation,
      approvalMutation,
    );
    useParamsMock.mockReturnValue({ transactionId: "txn_13" });
    useQueryMock.mockReturnValue(baseTransaction);

    render(<TransactionView />);

    await user.click(screen.getByRole("button", { name: "Update" }));
    await user.click(screen.getByRole("button", { name: "Payment method" }));
    await user.selectOptions(
      screen.getByLabelText("Updated payment method"),
      "card",
    );
    await user.type(
      screen.getByLabelText("Payment method update reason"),
      "Wrong tender selected.",
    );
    await user.click(
      screen.getByRole("button", { name: "Submit payment update" }),
    );
    await user.click(screen.getByRole("button", { name: "Confirm" }));

    expect(
      screen.queryByText("Manager approval required"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(
        "A manager needs to review this completed transaction payment method update before it is applied.",
      ),
    ).not.toBeInTheDocument();
    expect(approvalMutation).not.toHaveBeenCalled();
    expect(authMutation).toHaveBeenCalledWith({
      allowedRoles: ["cashier", "manager"],
      pinHash: "123456",
      storeId: "store_1",
      username: "manager",
    });
    expect(paymentMutation).toHaveBeenCalledWith({
      actorStaffProfileId: "staff_1",
      approvalProofId: undefined,
      paymentMethod: "card",
      reason: "Wrong tender selected.",
      transactionId: "txn_13",
    });
  });

  it("chains inline manager approval when the requester is a manager", async () => {
    const user = userEvent.setup();
    const authMutation = vi.fn().mockResolvedValue({
      kind: "ok",
      data: {
        activeRoles: ["manager"],
        staffProfile: { firstName: "Kwamina", lastName: "Mensah" },
        staffProfileId: "staff_1",
      },
    });
    const approvalMutation = vi.fn().mockResolvedValue({
      kind: "ok",
      data: {
        approvalProofId: "proof-1",
        approvedByStaffProfileId: "staff_1",
        expiresAt: 2,
      },
    });
    const customerMutation = vi.fn();
    const paymentMutation = vi
      .fn()
      .mockResolvedValueOnce({
        kind: "approval_required",
        approval: paymentApprovalRequirement("txn_19"),
      })
      .mockResolvedValueOnce({ kind: "ok" });
    mockTransactionMutations(
      authMutation,
      customerMutation,
      paymentMutation,
      approvalMutation,
    );
    useParamsMock.mockReturnValue({ transactionId: "txn_19" });
    useQueryMock.mockReturnValue(baseTransaction);

    render(<TransactionView />);

    await user.click(screen.getByRole("button", { name: "Update" }));
    await user.click(screen.getByRole("button", { name: "Payment method" }));
    await user.selectOptions(
      screen.getByLabelText("Updated payment method"),
      "card",
    );
    await user.type(
      screen.getByLabelText("Payment method update reason"),
      "Wrong tender selected.",
    );
    await user.click(
      screen.getByRole("button", { name: "Submit payment update" }),
    );
    await user.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() => {
      expect(approvalMutation).toHaveBeenCalledWith({
        actionKey: "pos.transaction.correct_payment_method",
        pinHash: "123456",
        reason:
          "Manager approval is required to correct a completed transaction payment method.",
        requiredRole: "manager",
        requestedByStaffProfileId: "staff_1",
        storeId: "store_1",
        subject: {
          id: "txn_19",
          label: "Transaction #POS-123456",
          type: "pos_transaction",
        },
        username: "manager",
      });
      expect(paymentMutation).toHaveBeenCalledWith({
        actorStaffProfileId: "staff_1",
        approvalProofId: "proof-1",
        paymentMethod: "card",
        reason: "Wrong tender selected.",
        transactionId: "txn_19",
      });
    });
    expect(
      screen.queryByText("Manager approval required"),
    ).not.toBeInTheDocument();
  });

  it("exits the correction workflow after an async payment correction request is queued", async () => {
    const user = userEvent.setup();
    const authMutation = vi.fn().mockResolvedValue({
      kind: "ok",
      data: {
        activeRoles: ["cashier"],
        staffProfile: { firstName: "Kwamina", lastName: "Mensah" },
        staffProfileId: "staff_1",
      },
    });
    const approvalMutation = vi.fn().mockResolvedValue({
      kind: "ok",
      data: {
        approvalProofId: "proof-1",
        approvedByStaffProfileId: "staff_1",
        expiresAt: 2,
      },
    });
    const customerMutation = vi.fn();
    const paymentMutation = vi
      .fn()
      .mockResolvedValueOnce({
        kind: "approval_required",
        approval: {
          action: { key: "pos.transaction.correct_payment_method" },
          copy: {
            title: "Manager approval required",
            message:
              "A manager needs to review this completed transaction payment method update before it is applied.",
            primaryActionLabel: "Request approval",
          },
          reason:
            "Manager approval is required to correct a completed transaction payment method.",
          requiredRole: "manager",
          resolutionModes: [
            {
              kind: "async_request",
              requestType: "payment_method_correction",
              approvalRequestId: "approval-1",
            },
          ],
          subject: {
            id: "txn_11",
            label: "Transaction #754489",
            type: "pos_transaction",
          },
        },
      });
    mockTransactionMutations(
      authMutation,
      customerMutation,
      paymentMutation,
      approvalMutation,
    );
    useParamsMock.mockReturnValue({ transactionId: "txn_11" });
    useQueryMock.mockReturnValue(baseTransaction);

    render(<TransactionView />);

    await user.click(screen.getByRole("button", { name: "Update" }));
    await user.click(screen.getByRole("button", { name: "Payment method" }));
    await user.selectOptions(
      screen.getByLabelText("Updated payment method"),
      "card",
    );
    await user.type(
      screen.getByLabelText("Payment method update reason"),
      "Wrong tender selected.",
    );
    await user.click(
      screen.getByRole("button", { name: "Submit payment update" }),
    );
    await user.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() => {
      expect(approvalMutation).not.toHaveBeenCalled();
      expect(paymentMutation).toHaveBeenNthCalledWith(1, {
        actorStaffProfileId: "staff_1",
        approvalProofId: undefined,
        paymentMethod: "card",
        reason: "Wrong tender selected.",
        transactionId: "txn_11",
      });
    });
    expect(
      screen.queryByText("Transaction updates"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Manager approval required")).not.toBeInTheDocument();
  });

  it("renders correction history when operational events are present", () => {
    useParamsMock.mockReturnValue({ transactionId: "txn_8" });
    useQueryMock.mockReturnValue({
      ...baseTransaction,
      correctionHistory: [
        {
          _id: "event-1",
          actorStaffName: "Ama Mensah",
          createdAt: Date.now() - 60_000,
          eventType: "transaction_customer_corrected",
          message: "Customer attribution updated",
          reason: "Customer called with receipt.",
        },
      ],
    });

    render(<TransactionView />);

    expect(screen.getByText("Update history")).toBeInTheDocument();
    expect(
      screen.getByText("Customer attribution updated"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Customer called with receipt."),
    ).toBeInTheDocument();
    expect(screen.getByText(/by Ama M\./)).toBeInTheDocument();
  });

  it("shows two correction history entries before expanding newest-first history", async () => {
    const user = userEvent.setup();
    useParamsMock.mockReturnValue({ transactionId: "txn_12" });
    useQueryMock.mockReturnValue({
      ...baseTransaction,
      correctionHistory: [
        {
          _id: "event-old",
          actorStaffName: "Ama Mensah",
          createdAt: 100,
          eventType: "pos_transaction_payment_method_corrected",
          metadata: {
            paymentMethod: "cash",
            previousPaymentMethod: "mobile_money",
          },
          reason: "Old update.",
        },
        {
          _id: "event-new",
          actorStaffName: "Kwamina Mensah",
          createdAt: 300,
          eventType: "pos_transaction_payment_method_corrected",
          metadata: {
            paymentMethod: "cash",
            previousPaymentMethod: "card",
          },
          reason: "New update.",
        },
        {
          _id: "event-middle",
          actorStaffName: "Boy Wonder",
          createdAt: 200,
          eventType: "pos_transaction_payment_method_corrected",
          metadata: {
            paymentMethod: "mobile_money",
            previousPaymentMethod: "cash",
          },
          reason: "Middle update.",
        },
      ],
    });

    render(<TransactionView />);

    expect(screen.getByText("New update.")).toBeInTheDocument();
    expect(
      screen.getByLabelText("Changed from Card to Cash"),
    ).toBeInTheDocument();
    expect(screen.getByText("Middle update.")).toBeInTheDocument();
    expect(
      screen.getByLabelText("Changed from Cash to Mobile Money"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Old update.")).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText("Changed from Mobile Money to Cash"),
    ).not.toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Show 1 more update" }),
    );

    const updateReasons = screen
      .getAllByText(/update\./)
      .map((element) => element.textContent);

    expect(updateReasons).toEqual([
      "New update.",
      "Middle update.",
      "Old update.",
    ]);
    expect(
      screen.getByLabelText("Changed from Mobile Money to Cash"),
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Show fewer updates" }),
    );

    expect(screen.queryByText("Old update.")).not.toBeInTheDocument();
  });

  it("tightens payment correction history labels", () => {
    useParamsMock.mockReturnValue({ transactionId: "txn_10" });
    useQueryMock.mockReturnValue({
      ...baseTransaction,
      correctionHistory: [
        {
          _id: "event-1",
          actorStaffName: "Kwamina Mensah",
          createdAt: Date.now() - 60_000,
          eventType: "pos_transaction_payment_method_corrected",
          message: "Updated payment method for Transaction #754489.",
          metadata: {
            paymentMethod: "card",
            previousPaymentMethod: "cash",
          },
          reason: "Wrong method selected.",
        },
      ],
    });

    render(<TransactionView />);

    expect(screen.getByText("Payment method updated")).toBeInTheDocument();
    expect(
      screen.queryByText("Updated payment method for Transaction #754489."),
    ).not.toBeInTheDocument();
    expect(
      screen.getByLabelText("Changed from Cash to Card"),
    ).toBeInTheDocument();
    expect(screen.getByText(/by Kwamina M\./)).toBeInTheDocument();
  });

  it("omits correction history when no events are present", () => {
    useParamsMock.mockReturnValue({ transactionId: "txn_9" });
    useQueryMock.mockReturnValue(baseTransaction);

    render(<TransactionView />);

    expect(screen.queryByText("Update history")).not.toBeInTheDocument();
  });

  it("formats correction history labels for fallback and partial payment changes", () => {
    expect(formatCorrectionEventType("inventory_count_adjusted")).toBe(
      "Inventory Count Adjusted",
    );
    expect(
      formatCorrectionHistoryTitle({
        _id: "fallback",
        createdAt: 100,
        eventType: "manual_payment_reviewed",
      }),
    ).toBe("Manual Payment Reviewed");
    expect(
      formatCorrectionHistoryTitle({
        _id: "message",
        createdAt: 100,
        eventType: "unknown_backend_event",
        message: "Operator note recorded",
      }),
    ).toBe("Operator note recorded");
    expect(formatPaymentMethodLabel("mobile_money")).toBe("Mobile Money");
    expect(formatPaymentMethodLabel("")).toBeNull();
    expect(formatPaymentMethodLabel(null)).toBeNull();

    expect(
      formatCorrectionHistoryChange({
        _id: "current-only",
        createdAt: 100,
        eventType: "pos_transaction_payment_method_corrected",
        metadata: {
          paymentMethod: "mobile_money",
        },
      }),
    ).toBe("Changed to Mobile Money");
    expect(
      formatCorrectionHistoryChange({
        _id: "missing-current",
        createdAt: 100,
        eventType: "pos_transaction_payment_method_corrected",
        metadata: {
          previousPaymentMethod: "cash",
        },
      }),
    ).toBeNull();
    expect(
      formatCorrectionHistoryChange({
        _id: "customer",
        createdAt: 100,
        eventType: "pos_transaction_customer_corrected",
      }),
    ).toBeNull();

    expect(
      getCorrectionHistoryChangeParts({
        _id: "both",
        createdAt: 100,
        eventType: "pos_transaction_payment_method_corrected",
        metadata: {
          paymentMethod: "card",
          previousPaymentMethod: "cash",
        },
      }),
    ).toEqual({
      paymentMethod: "Card",
      previousPaymentMethod: "Cash",
    });
    expect(
      getCorrectionHistoryChangeParts({
        _id: "missing-current",
        createdAt: 100,
        eventType: "pos_transaction_payment_method_corrected",
        metadata: {
          previousPaymentMethod: "cash",
        },
      }),
    ).toBeNull();
  });
});
