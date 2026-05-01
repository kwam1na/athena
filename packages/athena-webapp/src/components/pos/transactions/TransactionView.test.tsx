import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TransactionView } from "./TransactionView";

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
    onAuthenticated: (result: {
      staffProfile: { firstName: string; lastName: string };
      staffProfileId: string;
    }) => void;
    open: boolean;
  }) =>
    open ? (
      <div data-testid="staff-auth-dialog">
        <h2>{copy.title}</h2>
        <p>{copy.description}</p>
        <button
          onClick={async () => {
            await onAuthenticate({
              pinHash: "123456",
              username: "manager",
            });
            onAuthenticated({
              staffProfile: { firstName: "Kwamina", lastName: "Mensah" },
              staffProfileId: "staff_1",
            });
          }}
          type="button"
        >
          {copy.submitLabel}
        </button>
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

  it("renders correction categories for completed transactions", async () => {
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

    await user.click(
      screen.getByRole("button", { name: "Customer attribution" }),
    );

    expect(screen.getByText("Customer attribution update")).toBeInTheDocument();
    expect(
      screen.getByLabelText("Customer update reason"),
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
    await user.click(
      screen.getByRole("button", { name: "Customer attribution" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Submit customer update" }),
    );

    expect(
      screen.getByText("Add a reason for this update."),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Update" }));
    await user.click(screen.getByRole("button", { name: "Update" }));

    expect(
      screen.queryByText("Add a reason for this update."),
    ).not.toBeInTheDocument();
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
        "Only same-amount payment method updates are supported.",
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
        "Only same-amount payment method updates are supported.",
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
        "Reopen Register 3 to update payment details.",
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

  it("communicates manager approval before authenticating payment corrections", async () => {
    const user = userEvent.setup();
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

    expect(screen.getByText("Manager approval required")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Enter manager username and PIN to update this payment method.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Confirm" }),
    ).toBeInTheDocument();
  });

  it("exits the correction workflow after a payment correction succeeds", async () => {
    const user = userEvent.setup();
    const commandMutation = vi.fn().mockResolvedValue({ kind: "ok" });
    useMutationMock.mockReturnValue(commandMutation);
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
      expect(commandMutation).toHaveBeenCalledWith({
        allowedRoles: ["manager"],
        pinHash: "123456",
        storeId: "store_1",
        username: "manager",
      });
      expect(commandMutation).toHaveBeenCalledWith({
        actorStaffProfileId: "staff_1",
        paymentMethod: "card",
        reason: "Wrong tender selected.",
        transactionId: "txn_11",
      });
    });
    expect(
      screen.queryByText("Transaction updates"),
    ).not.toBeInTheDocument();
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
});
