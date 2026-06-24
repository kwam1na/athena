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

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}

const useQueryMock = vi.fn();
const useMutationMock = vi.fn();
const useActionMock = vi.fn();
const useParamsMock = vi.fn();
const useProtectedAdminPageStateMock = vi.fn();

vi.mock("convex/react", () => ({
  useAction: (...args: unknown[]) => useActionMock(...args),
  useMutation: (...args: unknown[]) => useMutationMock(...args),
  useQuery: (...args: unknown[]) => useQueryMock(...args),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    params,
    to,
  }: {
    children?: React.ReactNode;
    params?: Record<string, string>;
    to: string;
  }) => {
    const href = Object.entries(params ?? {}).reduce(
      (path, [key, value]) => path.replace(`$${key}`, value),
      to,
    );

    return <a href={href}>{children}</a>;
  },
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
    "aria-label": ariaLabel,
    children,
    onValueChange,
    value,
  }: {
    "aria-label"?: string;
    children?: React.ReactNode;
    onValueChange?: (value: string) => void;
    value?: string;
  }) => (
    <select
      aria-label={ariaLabel ?? "Updated payment method"}
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
        posLocalStaffProof?: { expiresAt: number; token: string };
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
              pinHash: "hashed:1234",
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
                pinHash: "hashed:1234",
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
    onDismiss,
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
    onDismiss: () => void;
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
                pinHash: "hashed:1234",
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
        <button onClick={onDismiss} type="button">
          Cancel
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
  OrderSummary: ({
    completedAdjustmentSummary,
    completedTransactionData,
    onReceiptPrinted,
  }: {
    completedAdjustmentSummary?: {
      originalTotal: number;
      settlementAmount: number;
      settlementDirection: string;
      totalDelta: number;
    } | null;
    completedTransactionData?: { total: number; transactionId?: string } | null;
    onReceiptPrinted?: (transactionId: string) => void | Promise<void>;
  }) => (
    <div data-testid="order-summary">
      {completedTransactionData?.transactionId && onReceiptPrinted ? (
        <button
          onClick={() =>
            void onReceiptPrinted(completedTransactionData.transactionId!)
          }
          type="button"
        >
          Print receipt
        </button>
      ) : null}
      {completedAdjustmentSummary ? (
        <span>
          adjusted summary {completedTransactionData?.total} original{" "}
          {completedAdjustmentSummary.originalTotal} delta{" "}
          {completedAdjustmentSummary.totalDelta}
        </span>
      ) : null}
    </div>
  ),
}));

vi.mock("../CartItems", () => ({
  CartItems: ({
    cartItems,
    className,
    serviceItems = [],
  }: {
    cartItems: Array<{ name: string; price: number; quantity: number }>;
    className?: string;
    serviceItems?: Array<{ name: string; price: number; quantity: number }>;
  }) => (
    <div className={className} data-testid="cart-items">
      {cartItems.map((item) => (
        <span key={item.name}>
          {item.name} qty {item.quantity} total {item.price * item.quantity}
        </span>
      ))}
      {serviceItems.map((item) => (
        <span key={`service-${item.name}`}>
          {item.name} service qty {item.quantity} total{" "}
          {item.price * item.quantity}
        </span>
      ))}
    </div>
  ),
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
    terminalId: "terminal_1",
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

  function voidApprovalRequirement(
    transactionId = "txn_void",
    options: { includeAsyncRequest?: boolean } = {},
  ) {
    return {
      action: { key: "pos.transaction.void" },
      copy: {
        title: "Manager approval required",
        message:
          "A manager needs to review this completed sale void before it is applied.",
        primaryActionLabel: "Approve void",
      },
      reason: "Manager approval is required to void a completed POS sale.",
      requiredRole: "manager" as const,
      resolutionModes: options.includeAsyncRequest
        ? [
            { kind: "inline_manager_proof" },
            {
              approvalRequestId: "approval-void-1",
              kind: "async_request",
              requestType: "pos_transaction_void",
            },
          ]
        : [{ kind: "inline_manager_proof" }],
      subject: {
        id: transactionId,
        label: "Transaction #POS-123456",
        type: "pos_transaction",
      },
    };
  }

  beforeEach(() => {
    useActionMock.mockReset();
    useActionMock.mockReturnValue(vi.fn());
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
    itemAdjustmentMutation: ReturnType<typeof vi.fn> = vi.fn(),
    terminalAuthMutation: ReturnType<typeof vi.fn> = authMutation,
    receiptPrintedMutation: ReturnType<typeof vi.fn> = vi.fn(),
    voidMutation: ReturnType<typeof vi.fn> = vi.fn(),
  ) {
    const mutations = [
      authMutation,
      terminalAuthMutation,
      approvalMutation,
      paymentMutation,
      customerMutation,
      itemAdjustmentMutation,
      receiptPrintedMutation,
      voidMutation,
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

  it("records receipt print clicks for the displayed transaction", async () => {
    const user = userEvent.setup();
    const receiptPrintedMutation = vi.fn().mockResolvedValue({
      kind: "ok",
      data: null,
    });
    mockTransactionMutations(
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn(),
      receiptPrintedMutation,
    );
    useParamsMock.mockReturnValue({ transactionId: "txn_printed" });
    useQueryMock.mockReturnValue({
      ...baseTransaction,
      _id: "txn_printed",
      transactionNumber: "POS-PRINTED",
      items: [
        {
          productName: "Wig Cap",
          productSku: "CAP-1",
          quantity: 1,
          unitPrice: 1000,
          totalPrice: 1000,
        },
      ],
    });

    render(<TransactionView />);

    await user.click(screen.getByRole("button", { name: /Print receipt/i }));

    await waitFor(() => {
      expect(receiptPrintedMutation).toHaveBeenCalledWith({
        transactionId: "txn_printed",
      });
    });
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

  it("renders service lines in the main transaction items list", () => {
    useParamsMock.mockReturnValue({ transactionId: "txn_service_items" });
    useQueryMock.mockReturnValue({
      ...baseTransaction,
      _id: "txn_service_items",
      items: [
        {
          _id: "item_1",
          productId: "product_1",
          productName: "Bacca",
          productSku: "6N2Y-D3-4RC",
          productSkuId: "sku_1",
          quantity: 1,
          totalPrice: 150,
          unitPrice: 150,
        },
      ],
      serviceLines: [
        {
          id: "service_line_1",
          name: "tokin",
          quantity: 2,
          serviceMode: "revamp",
          servicePaymentStatus: "paid",
          totalPrice: 800,
          unitPrice: 400,
        },
      ],
    });

    render(<TransactionView />);

    expect(screen.getByTestId("cart-items")).toHaveTextContent(
      "Bacca qty 1 total 150",
    );
    expect(screen.getByTestId("cart-items")).toHaveTextContent(
      "tokin service qty 2 total 800",
    );
    expect(screen.queryByText("Service lines")).not.toBeInTheDocument();
  });

  it("promotes transaction items before the detail rail on mobile", () => {
    useParamsMock.mockReturnValue({ transactionId: "txn_mobile_items" });
    useQueryMock.mockReturnValue({
      ...baseTransaction,
      _id: "txn_mobile_items",
      items: [
        {
          _id: "item_1",
          productId: "product_1",
          productName: "Bacca",
          productSku: "6N2Y-D3-4RC",
          productSkuId: "sku_1",
          quantity: 1,
          totalPrice: 150,
          unitPrice: 150,
        },
      ],
    });

    render(<TransactionView />);

    expect(screen.getByTestId("cart-items")).toHaveClass(
      "order-1",
      "min-h-[22rem]",
      "xl:order-2",
      "xl:h-full",
    );
    expect(screen.getByTestId("cart-items")).toHaveTextContent(
      "Bacca qty 1 total 150",
    );
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

  it("opens manager approval for completed sale voids", async () => {
    const user = userEvent.setup();
    const authMutation = vi.fn().mockResolvedValue({
      kind: "ok",
      data: {
        activeRoles: ["cashier"],
        posLocalStaffProof: { expiresAt: 2, token: "proof-token-1" },
        staffProfile: { firstName: "Kwamina", lastName: "Mensah" },
        staffProfileId: "staff_1",
      },
    });
    const voidMutation = vi.fn().mockResolvedValue({
      kind: "approval_required",
      approval: voidApprovalRequirement("txn_void"),
    });
    mockTransactionMutations(
      authMutation,
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn(),
      authMutation,
      vi.fn(),
      voidMutation,
    );
    useParamsMock.mockReturnValue({ transactionId: "txn_void" });
    useQueryMock.mockReturnValue(baseTransaction);

    render(<TransactionView />);

    await user.click(screen.getByRole("button", { name: "Void sale" }));
    await user.type(
      screen.getByLabelText("Void reason"),
      "Duplicate sale recorded.",
    );
    await user.click(screen.getByRole("button", { name: "Submit void" }));
    await user.click(screen.getByRole("button", { name: "Confirm" }));

    expect(screen.getByText("Manager approval required")).toBeInTheDocument();
    expect(
      screen.getByText(
        "A manager needs to review this completed sale void before it is applied.",
      ),
    ).toBeInTheDocument();
    expect(voidMutation).toHaveBeenCalledWith({
      actorStaffProfileId: "staff_1",
      approvalProofId: undefined,
      approvalRequestId: undefined,
      reason: "Duplicate sale recorded.",
      staffProofToken: "proof-token-1",
      transactionId: "txn_void",
    });
  });

  it("disables completed sale voids while a void approval request is pending", async () => {
    const user = userEvent.setup();
    const voidMutation = vi.fn();
    mockTransactionMutations(
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn(),
      voidMutation,
    );
    useParamsMock.mockReturnValue({ transactionId: "txn_void_pending" });
    useQueryMock.mockReturnValue({
      ...baseTransaction,
      _id: "txn_void_pending",
      pendingVoidApprovalRequest: {
        _id: "approval-request-1",
        createdAt: 100,
        requestedByStaffProfileId: "staff_1",
      },
    });

    render(<TransactionView />);

    const voidButton = screen.getByRole("button", {
      name: "Void requested",
    });

    expect(voidButton).toBeDisabled();
    await user.click(voidButton);
    expect(voidMutation).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("heading", { name: "Void completed sale" }),
    ).not.toBeInTheDocument();
  });

  it("links full admins to approvals when a void request is pending", () => {
    mockTransactionMutations(vi.fn(), vi.fn(), vi.fn());
    useProtectedAdminPageStateMock.mockReturnValue({
      activeStore: { _id: "store_1" },
      hasFullAdminAccess: true,
      isAuthenticated: true,
    });
    useParamsMock.mockReturnValue({
      orgUrlSlug: "wigclub",
      storeUrlSlug: "wigclub",
      transactionId: "txn_void_pending",
    });
    useQueryMock.mockReturnValue({
      ...baseTransaction,
      _id: "txn_void_pending",
      pendingVoidApprovalRequest: {
        _id: "approval-request-1",
        createdAt: 100,
        requestedByStaffProfileId: "staff_1",
      },
    });

    render(<TransactionView />);

    expect(screen.getByText("Void approval pending")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Review this request in Approvals before the sale can be voided.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Review/ })).toHaveAttribute(
      "href",
      "/wigclub/store/wigclub/operations/approvals",
    );
  });

  it("does not link non-admins to approvals when a void request is pending", () => {
    mockTransactionMutations(vi.fn(), vi.fn(), vi.fn());
    useProtectedAdminPageStateMock.mockReturnValue({
      activeStore: { _id: "store_1" },
      hasFullAdminAccess: false,
      isAuthenticated: true,
    });
    useParamsMock.mockReturnValue({
      orgUrlSlug: "wigclub",
      storeUrlSlug: "wigclub",
      transactionId: "txn_void_pending",
    });
    useQueryMock.mockReturnValue({
      ...baseTransaction,
      _id: "txn_void_pending",
      pendingVoidApprovalRequest: {
        _id: "approval-request-1",
        createdAt: 100,
        requestedByStaffProfileId: "staff_1",
      },
    });

    render(<TransactionView />);

    expect(
      screen.queryByText("Void approval pending"),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Review/ })).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Void requested" }),
    ).toBeDisabled();
  });

  it("requires a reason before submitting completed sale voids", async () => {
    const user = userEvent.setup();
    const authMutation = vi.fn().mockResolvedValue({
      kind: "ok",
      data: {
        activeRoles: ["manager"],
        staffProfile: { firstName: "Kwamina", lastName: "Mensah" },
        staffProfileId: "staff_generic",
      },
    });
    const terminalAuthMutation = vi.fn().mockResolvedValue({
      kind: "ok",
      data: {
        activeRoles: ["cashier"],
        posLocalStaffProof: { expiresAt: 2, token: "proof-token-void" },
        staffProfile: { firstName: "Kwamina", lastName: "Mensah" },
        staffProfileId: "staff_terminal",
      },
    });
    const voidMutation = vi.fn().mockResolvedValue({
      kind: "approval_required",
      approval: voidApprovalRequirement("txn_void_terminal"),
    });
    mockTransactionMutations(
      authMutation,
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn(),
      terminalAuthMutation,
      vi.fn(),
      voidMutation,
    );
    useParamsMock.mockReturnValue({ transactionId: "txn_void_terminal" });
    useQueryMock.mockReturnValue(baseTransaction);

    render(<TransactionView />);

    await user.click(screen.getByRole("button", { name: "Void sale" }));
    await user.click(screen.getByRole("button", { name: "Submit void" }));

    expect(authMutation).not.toHaveBeenCalled();
    expect(terminalAuthMutation).not.toHaveBeenCalled();
    expect(voidMutation).not.toHaveBeenCalled();
    expect(
      screen.getByText("Reason is required before voiding this sale"),
    ).toBeInTheDocument();
  });

  it("queues completed sale voids when the approval response includes an async request", async () => {
    const user = userEvent.setup();
    const authMutation = vi.fn().mockResolvedValue({
      kind: "ok",
      data: {
        activeRoles: ["cashier"],
        posLocalStaffProof: { expiresAt: 2, token: "proof-token-1" },
        staffProfile: { firstName: "Kwamina", lastName: "Mensah" },
        staffProfileId: "staff_1",
      },
    });
    const voidMutation = vi.fn().mockResolvedValue({
      kind: "approval_required",
      approval: voidApprovalRequirement("txn_void_async", {
        includeAsyncRequest: true,
      }),
    });
    mockTransactionMutations(
      authMutation,
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn(),
      authMutation,
      vi.fn(),
      voidMutation,
    );
    useParamsMock.mockReturnValue({ transactionId: "txn_void_async" });
    useQueryMock.mockReturnValue(baseTransaction);

    render(<TransactionView />);

    await user.click(screen.getByRole("button", { name: "Void sale" }));
    await user.type(screen.getByLabelText("Void reason"), "Duplicate sale.");
    await user.click(screen.getByRole("button", { name: "Submit void" }));
    await user.click(screen.getByRole("button", { name: "Confirm" }));

    expect(screen.queryByText("Manager approval required")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Void reason")).not.toBeInTheDocument();
  });

  it("does not retry the void command when manager approval is cancelled", async () => {
    const user = userEvent.setup();
    const authMutation = vi.fn().mockResolvedValue({
      kind: "ok",
      data: {
        activeRoles: ["cashier"],
        posLocalStaffProof: { expiresAt: 2, token: "proof-token-1" },
        staffProfile: { firstName: "Kwamina", lastName: "Mensah" },
        staffProfileId: "staff_1",
      },
    });
    const voidMutation = vi.fn().mockResolvedValue({
      kind: "approval_required",
      approval: voidApprovalRequirement("txn_void_cancel"),
    });
    mockTransactionMutations(
      authMutation,
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn(),
      authMutation,
      vi.fn(),
      voidMutation,
    );
    useParamsMock.mockReturnValue({ transactionId: "txn_void_cancel" });
    useQueryMock.mockReturnValue(baseTransaction);

    render(<TransactionView />);

    await user.click(screen.getByRole("button", { name: "Void sale" }));
    await user.type(screen.getByLabelText("Void reason"), "Duplicate sale.");
    await user.click(screen.getByRole("button", { name: "Submit void" }));
    await user.click(screen.getByRole("button", { name: "Confirm" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(voidMutation).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByText("Manager approval required"),
    ).not.toBeInTheDocument();
  });

  it("shows a voided state after a manager-approved void succeeds", async () => {
    const user = userEvent.setup();
    const authMutation = vi.fn().mockResolvedValue({
      kind: "ok",
      data: {
        activeRoles: ["manager"],
        posLocalStaffProof: { expiresAt: 2, token: "proof-token-1" },
        staffProfile: { firstName: "Kwamina", lastName: "Mensah" },
        staffProfileId: "staff_1",
      },
    });
    const approvalMutation = vi.fn().mockResolvedValue({
      kind: "ok",
      data: {
        approvalProofId: "proof-void-1",
        approvedByStaffProfileId: "staff_manager",
        expiresAt: 2,
      },
    });
    const voidMutation = vi
      .fn()
      .mockResolvedValueOnce({
        kind: "approval_required",
        approval: voidApprovalRequirement("txn_void_success", {
          includeAsyncRequest: true,
        }),
      })
      .mockResolvedValueOnce({
        kind: "ok",
        data: {
          transactionId: "txn_void_success",
          transactionNumber: "POS-123456",
          voidedAt: 456,
          paymentAllocationIds: ["allocation_1"],
          inventoryMovementIds: ["movement_1"],
          approvalProofId: "proof-void-1",
          approverStaffProfileId: "staff_manager",
        },
      });
    mockTransactionMutations(
      authMutation,
      vi.fn(),
      vi.fn(),
      approvalMutation,
      vi.fn(),
      authMutation,
      vi.fn(),
      voidMutation,
    );
    useParamsMock.mockReturnValue({ transactionId: "txn_void_success" });
    useQueryMock.mockReturnValue(baseTransaction);

    render(<TransactionView />);

    await user.click(screen.getByRole("button", { name: "Void sale" }));
    await user.type(
      screen.getByLabelText("Void reason"),
      "Duplicate sale recorded.",
    );
    await user.click(screen.getByRole("button", { name: "Submit void" }));
    await user.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() => {
      expect(screen.getAllByText("Voided").length).toBeGreaterThan(0);
      expect(screen.getByText("Sale voided")).toBeInTheDocument();
    });
    expect(screen.getByText("Duplicate sale recorded.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Void sale" })).not.toBeInTheDocument();
    expect(voidMutation).toHaveBeenLastCalledWith({
      actorStaffProfileId: "staff_1",
      approvalProofId: "proof-void-1",
      approvalRequestId: "approval-void-1",
      reason: "Duplicate sale recorded.",
      staffProofToken: "proof-token-1",
      transactionId: "txn_void_success",
    });
  });

  it("renders normalized backend blocking copy for void failures", async () => {
    const user = userEvent.setup();
    const authMutation = vi.fn().mockResolvedValue({
      kind: "ok",
      data: {
        activeRoles: ["manager"],
        posLocalStaffProof: { expiresAt: 2, token: "proof-token-1" },
        staffProfile: { firstName: "Kwamina", lastName: "Mensah" },
        staffProfileId: "staff_1",
      },
    });
    const voidMutation = vi.fn().mockResolvedValue({
      kind: "user_error",
      error: {
        code: "precondition_failed",
        message:
          "Register session is already closed for this completed transaction.",
      },
    });
    mockTransactionMutations(
      authMutation,
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn(),
      authMutation,
      vi.fn(),
      voidMutation,
    );
    useParamsMock.mockReturnValue({ transactionId: "txn_void_blocked" });
    useQueryMock.mockReturnValue(baseTransaction);

    render(<TransactionView />);

    await user.click(screen.getByRole("button", { name: "Void sale" }));
    await user.type(screen.getByLabelText("Void reason"), "Duplicate sale.");
    await user.click(screen.getByRole("button", { name: "Submit void" }));
    await user.click(screen.getByRole("button", { name: "Confirm" }));

    expect(
      await screen.findByText(
        "Register closed. Reopen the register before voiding this sale.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(
        "Register session is already closed for this completed transaction.",
      ),
    ).not.toBeInTheDocument();
  });

  it("renders normalized daily-close copy for void failures", async () => {
    const user = userEvent.setup();
    const authMutation = vi.fn().mockResolvedValue({
      kind: "ok",
      data: {
        activeRoles: ["manager"],
        posLocalStaffProof: { expiresAt: 2, token: "proof-token-1" },
        staffProfile: { firstName: "Kwamina", lastName: "Mensah" },
        staffProfileId: "staff_1",
      },
    });
    const voidMutation = vi.fn().mockResolvedValue({
      kind: "user_error",
      error: {
        code: "precondition_failed",
        message: "Daily close is complete for this operating day.",
      },
    });
    mockTransactionMutations(
      authMutation,
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn(),
      authMutation,
      vi.fn(),
      voidMutation,
    );
    useParamsMock.mockReturnValue({ transactionId: "txn_void_daily_close" });
    useQueryMock.mockReturnValue(baseTransaction);

    render(<TransactionView />);

    await user.click(screen.getByRole("button", { name: "Void sale" }));
    await user.type(screen.getByLabelText("Void reason"), "Duplicate sale.");
    await user.click(screen.getByRole("button", { name: "Submit void" }));
    await user.click(screen.getByRole("button", { name: "Confirm" }));

    expect(
      await screen.findByText(
        "Daily close completed. Reopen the day before voiding this sale.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Daily close is complete for this operating day."),
    ).not.toBeInTheDocument();
  });

  it("does not render unmapped backend void failure copy", async () => {
    const user = userEvent.setup();
    const authMutation = vi.fn().mockResolvedValue({
      kind: "ok",
      data: {
        activeRoles: ["manager"],
        posLocalStaffProof: { expiresAt: 2, token: "proof-token-1" },
        staffProfile: { firstName: "Kwamina", lastName: "Mensah" },
        staffProfileId: "staff_1",
      },
    });
    const voidMutation = vi.fn().mockResolvedValue({
      kind: "user_error",
      error: {
        code: "authorization_failed",
        message: "You cannot void this transaction.",
      },
    });
    mockTransactionMutations(
      authMutation,
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn(),
      authMutation,
      vi.fn(),
      voidMutation,
    );
    useParamsMock.mockReturnValue({ transactionId: "txn_void_auth" });
    useQueryMock.mockReturnValue(baseTransaction);

    render(<TransactionView />);

    await user.click(screen.getByRole("button", { name: "Void sale" }));
    await user.type(screen.getByLabelText("Void reason"), "Duplicate sale.");
    await user.click(screen.getByRole("button", { name: "Submit void" }));
    await user.click(screen.getByRole("button", { name: "Confirm" }));

    expect(
      await screen.findByText(
        "Sale could not be voided. Check the transaction state and try again.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("You cannot void this transaction."),
    ).not.toBeInTheDocument();
  });

  it("hides the void submission path when the read model marks the sale blocked", () => {
    useParamsMock.mockReturnValue({ transactionId: "txn_void_blocked_model" });
    useQueryMock.mockReturnValue({
      ...baseTransaction,
      voidEligibility: { eligible: false },
    });

    render(<TransactionView />);

    expect(screen.queryByRole("button", { name: "Void sale" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Submit void" })).not.toBeInTheDocument();
  });

  it("hides the void submission path for already voided transactions", () => {
    useParamsMock.mockReturnValue({ transactionId: "txn_voided" });
    useQueryMock.mockReturnValue({
      ...baseTransaction,
      status: "void",
      voidReason: "Duplicate sale.",
      voidedAt: 456,
    });

    render(<TransactionView />);

    expect(screen.getAllByText("Voided").length).toBeGreaterThan(0);
    expect(screen.getByText("Sale voided")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Void sale" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Submit void" })).not.toBeInTheDocument();
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
      pinHash: "hashed:1234",
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
        pinHash: "hashed:1234",
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
        approvalRequestId: "approval-1",
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

  it("keeps no-adjustment transactions on the original sale presentation", () => {
    useParamsMock.mockReturnValue({ transactionId: "txn_no_adjustment" });
    useQueryMock.mockReturnValue({
      ...baseTransaction,
      adjustmentSummary: {
        appliedCount: 0,
        effectiveNetTotal: 1000,
        hasAdjustments: false,
        originalTotal: 1000,
        pendingCount: 0,
        totalAppliedAdjustmentDelta: 0,
      },
      adjustments: [],
    });

    render(<TransactionView />);

    expect(screen.queryByText("Adjustment state")).not.toBeInTheDocument();
    expect(screen.queryByText("Adjusted sale")).not.toBeInTheDocument();
    expect(screen.getByText("Completed")).toBeInTheDocument();
  });

  it("renders pending and applied item adjustment state separately from the original total", () => {
    useParamsMock.mockReturnValue({ transactionId: "txn_adjusted" });
    useQueryMock.mockReturnValue({
      ...baseTransaction,
      total: 2000,
      subtotal: 2000,
      items: [
        {
          _id: "item_1",
          productId: "product_1",
          productName: "Closure wig",
          productSku: "CW-18",
          productSkuId: "sku_1",
          quantity: 2,
          totalPrice: 2000,
          unitPrice: 1000,
        },
      ],
      adjustmentSummary: {
        appliedCount: 1,
        effectiveNetTotal: 1000,
        hasAdjustments: true,
        originalTotal: 2000,
        pendingCount: 1,
        totalAppliedAdjustmentDelta: -1000,
      },
      adjustments: [
        {
          _id: "approval-1",
          actorStaffName: "Ato Kwamina",
          adjustedTotal: 1000,
          createdAt: 200,
          lineItems: [],
          originalTotal: 1500,
          settlementAmount: 500,
          settlementDirection: "refund",
          status: "pending_approval",
        },
        {
          _id: "event-1",
          actorStaffName: "Ama Mensah",
          adjustedTotal: 1000,
          appliedAt: 150,
          createdAt: 150,
          lineItems: [
            {
              adjustedQuantity: 1,
              originalQuantity: 2,
              productName: "closure wig",
              productSku: "CW-18",
              quantityDelta: -1,
              totalDelta: -1000,
              unitPrice: 1000,
            },
            {
              adjustedQuantity: 1,
              originalQuantity: 1,
              productName: "Unchanged wig",
              productSku: "UW-18",
              quantityDelta: 0,
              totalDelta: 0,
              unitPrice: 2000,
            },
          ],
          originalTotal: 2000,
          settlementAmount: 1000,
          settlementDirection: "refund",
          status: "applied",
        },
      ],
    });

    render(<TransactionView />);

    expect(screen.getByText("Adjusted sale")).toBeInTheDocument();
    expect(screen.getByText("Applied sale total")).toBeInTheDocument();
    expect(screen.getByText("Pending sale total")).toBeInTheDocument();
    expect(screen.getByText("Original sale total")).toBeInTheDocument();
    expect(screen.getByText("Item adjustment")).toBeInTheDocument();
    expect(screen.getByText("Item adjustment pending approval")).toBeInTheDocument();
    expect(screen.getByText("Item adjustment applied")).toBeInTheDocument();
    expect(screen.getByText("Closure Wig")).toBeInTheDocument();
    expect(screen.getByText(/2 original to 1 adjusted/)).toBeInTheDocument();
    expect(screen.queryByText("Unchanged wig")).not.toBeInTheDocument();
    expect(screen.getAllByText("Refund due").length).toBeGreaterThan(0);
    expect(screen.getByTestId("cart-items")).toHaveTextContent(
      "Closure wig qty 1 total 1000",
    );
    expect(screen.getByTestId("order-summary")).toHaveTextContent(
      "adjusted summary 1000 original 2000 delta -1000",
    );
  });

  it("shows pending item adjustment totals as projected instead of applied", () => {
    useParamsMock.mockReturnValue({ transactionId: "txn_pending_adjustment" });
    useQueryMock.mockReturnValue({
      ...baseTransaction,
      total: 604396,
      subtotal: 604396,
      adjustmentSummary: {
        appliedCount: 0,
        effectiveNetTotal: 604396,
        hasAdjustments: true,
        originalTotal: 604396,
        pendingCount: 1,
        totalAppliedAdjustmentDelta: 0,
      },
      adjustments: [
        {
          _id: "approval-1",
          actorStaffName: "Ato Kwamina",
          adjustedTotal: 504396,
          createdAt: 200,
          lineItems: [
            {
              adjustedQuantity: 9,
              originalQuantity: 11,
              productName: "Vibes",
              productSku: "6N2Y-YFV-HFQ",
              quantityDelta: -2,
              totalDelta: -100000,
              unitPrice: 50000,
            },
          ],
          originalTotal: 604396,
          settlementAmount: 100000,
          settlementDirection: "refund",
          status: "pending_approval",
        },
      ],
    });

    render(<TransactionView />);

    expect(screen.getByText("Adjustment state")).toBeInTheDocument();
    expect(screen.getByText("Original sale total")).toBeInTheDocument();
    expect(screen.getByText("GH₵6,043.96")).toBeInTheDocument();
    expect(screen.getByText("Pending sale total")).toBeInTheDocument();
    expect(screen.getByText("GH₵5,043.96")).toBeInTheDocument();
    expect(screen.queryByText("Applied sale total")).not.toBeInTheDocument();
    expect(screen.queryByText("Adjusted sale total")).not.toBeInTheDocument();
  });

  it("opens the item adjustment workflow and requires a settlement method for refunds", async () => {
    const user = userEvent.setup();
    const authMutation = vi.fn().mockResolvedValue({
      kind: "ok",
      data: {
        activeRoles: ["cashier"],
        staffProfile: { firstName: "Kwamina", lastName: "Mensah" },
        staffProfileId: "staff_1",
      },
    });
    const itemAdjustmentMutation = vi.fn();
    mockTransactionMutations(
      authMutation,
      vi.fn(),
      vi.fn(),
      vi.fn(),
      itemAdjustmentMutation,
    );
    useParamsMock.mockReturnValue({ transactionId: "txn_items" });
    useQueryMock.mockReturnValue({
      ...baseTransaction,
      total: 2000,
      items: [
        {
          _id: "item_1",
          productId: "product_1",
          productName: "Closure wig",
          productSku: "CW-18",
          productSkuId: "sku_1",
          quantity: 2,
          totalPrice: 2000,
          unitPrice: 1000,
        },
      ],
    });

    render(<TransactionView />);

    await user.click(screen.getByRole("button", { name: "Update" }));
    await user.click(
      screen.getByRole("button", { name: "Items or quantities" }),
    );
    expect(screen.getByText("Review item adjustment")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /decrease closure wig/i }));
    expect(screen.getByText("Refund due")).toBeInTheDocument();
    await user.type(
      screen.getByLabelText("Item adjustment reason"),
      "Customer received one unit.",
    );
    await user.click(
      screen.getByRole("button", { name: "Submit item adjustment" }),
    );

    expect(
      screen.getByText("Choose a settlement method before submitting"),
    ).toBeInTheDocument();
    expect(itemAdjustmentMutation).not.toHaveBeenCalled();
  });

  it("cancels the item adjustment workflow and clears the draft", async () => {
    const user = userEvent.setup();
    mockTransactionMutations(vi.fn(), vi.fn(), vi.fn(), vi.fn(), vi.fn());
    useParamsMock.mockReturnValue({ transactionId: "txn_items" });
    useQueryMock.mockReturnValue({
      ...baseTransaction,
      total: 2000,
      items: [
        {
          _id: "item_1",
          productId: "product_1",
          productName: "Closure wig",
          productSku: "CW-18",
          productSkuId: "sku_1",
          quantity: 2,
          totalPrice: 2000,
          unitPrice: 1000,
        },
      ],
    });

    render(<TransactionView />);

    await user.click(screen.getByRole("button", { name: "Update" }));
    await user.click(
      screen.getByRole("button", { name: "Items or quantities" }),
    );
    await user.click(screen.getByRole("button", { name: /decrease closure wig/i }));
    await user.type(
      screen.getByLabelText("Item adjustment reason"),
      "Customer received one unit.",
    );
    await user.click(screen.getByRole("button", { name: "Cancel item adjustment" }));

    expect(screen.queryByText("Review item adjustment")).not.toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Items or quantities" }),
    );

    expect(
      screen.getByLabelText("Adjusted quantity for Closure wig"),
    ).toHaveValue(2);
    expect(screen.getByLabelText("Item adjustment reason")).toHaveValue("");
    expect(screen.queryByText("Refund due")).not.toBeInTheDocument();
  });

  it("submits item adjustments through the shared approval runner", async () => {
    const user = userEvent.setup();
    const authMutation = vi.fn();
    const terminalAuthMutation = vi.fn().mockResolvedValue({
      kind: "ok",
      data: {
        activeRoles: ["manager"],
        posLocalStaffProof: {
          expiresAt: Date.now() + 60_000,
          token: "proof-token-1",
        },
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
    const itemAdjustmentMutation = vi
      .fn()
      .mockResolvedValueOnce({
        kind: "approval_required",
        approval: {
          action: { key: "pos.transaction.adjust_items" },
          copy: {
            title: "Manager approval required",
            message:
              "A manager needs to review this item adjustment before it is applied.",
            primaryActionLabel: "Approve adjustment",
          },
          reason:
            "Manager approval is required to adjust completed transaction items.",
          requiredRole: "manager",
          resolutionModes: [
            { kind: "inline_manager_proof" },
            {
              approvalRequestId: "approval-1",
              kind: "async_request",
              requestType: "pos_item_adjustment",
            },
          ],
          subject: {
            id: "txn_items",
            label: "Transaction #POS-123456",
            type: "pos_transaction",
          },
        },
      })
      .mockResolvedValueOnce({ kind: "ok" });
    mockTransactionMutations(
      authMutation,
      vi.fn(),
      vi.fn(),
      approvalMutation,
      itemAdjustmentMutation,
      terminalAuthMutation,
    );
    useParamsMock.mockReturnValue({ transactionId: "txn_items" });
    useQueryMock.mockReturnValue({
      ...baseTransaction,
      total: 2000,
      items: [
        {
          _id: "item_1",
          productId: "product_1",
          productName: "Closure wig",
          productSku: "CW-18",
          productSkuId: "sku_1",
          quantity: 2,
          totalPrice: 2000,
          unitPrice: 1000,
        },
      ],
    });

    render(<TransactionView />);

    await user.click(screen.getByRole("button", { name: "Update" }));
    await user.click(
      screen.getByRole("button", { name: "Items or quantities" }),
    );
    await user.click(screen.getByRole("button", { name: /increase closure wig/i }));
    expect(screen.getByText("Balance due")).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Settlement method"), "cash");
    await user.type(
      screen.getByLabelText("Item adjustment reason"),
      "One unit was missed at checkout.",
    );
    await user.click(
      screen.getByRole("button", { name: "Submit item adjustment" }),
    );
    await user.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() => {
      expect(authMutation).not.toHaveBeenCalled();
      expect(terminalAuthMutation).toHaveBeenCalledWith({
        allowedRoles: ["cashier", "manager"],
        allowActiveSessionsOnOtherTerminals: true,
        pinHash: "hashed:1234",
        storeId: "store_1",
        terminalId: "terminal_1",
        username: "manager",
      });
      expect(approvalMutation).toHaveBeenCalledWith({
        actionKey: "pos.transaction.adjust_items",
        pinHash: "hashed:1234",
        reason:
          "Manager approval is required to adjust completed transaction items.",
        requiredRole: "manager",
        requestedByStaffProfileId: "staff_1",
        storeId: "store_1",
        subject: {
          id: "txn_items",
          label: "Transaction #POS-123456",
          type: "pos_transaction",
        },
        username: "manager",
      });
      expect(itemAdjustmentMutation).toHaveBeenCalledWith({
        actorStaffProfileId: "staff_1",
        approvalRequestId: "approval-1",
        approvalProofId: "proof-1",
        payload: {
          correctedTotal: 3000,
          lines: [
            {
              adjustedQuantity: 3,
              inventoryDelta: -1,
              originalQuantity: 2,
              originalTransactionItemId: "item_1",
              productId: "product_1",
              productName: "Closure wig",
              productSku: "CW-18",
              productSkuId: "sku_1",
              unitPrice: 1000,
            },
          ],
          originalTotal: 2000,
          settlementAmount: 1000,
          settlementDirection: "collect",
          settlementMethod: "cash",
        },
        reason: "One unit was missed at checkout.",
        staffProofToken: "proof-token-1",
        transactionId: "txn_items",
      });
    });
  });

  it("keeps item adjustment submit disabled while inline approval proof is minting", async () => {
    const user = userEvent.setup();
    const approvalDeferred = deferred<{
      data: {
        approvalProofId: string;
        approvedByStaffProfileId: string;
        expiresAt: number;
      };
      kind: "ok";
    }>();
    const authMutation = vi.fn();
    const terminalAuthMutation = vi.fn().mockResolvedValue({
      kind: "ok",
      data: {
        activeRoles: ["manager"],
        posLocalStaffProof: {
          expiresAt: Date.now() + 60_000,
          token: "proof-token-1",
        },
        staffProfile: { firstName: "Kwamina", lastName: "Mensah" },
        staffProfileId: "staff_1",
      },
    });
    const approvalMutation = vi.fn(() => approvalDeferred.promise);
    const itemAdjustmentMutation = vi
      .fn()
      .mockResolvedValueOnce({
        kind: "approval_required",
        approval: {
          action: { key: "pos.transaction.adjust_items" },
          copy: {
            title: "Manager approval required",
            message:
              "A manager needs to review this item adjustment before it is applied.",
            primaryActionLabel: "Approve adjustment",
          },
          reason:
            "Manager approval is required to adjust completed transaction items.",
          requiredRole: "manager",
          resolutionModes: [{ kind: "inline_manager_proof" }],
          subject: {
            id: "txn_items",
            label: "Transaction #POS-123456",
            type: "pos_transaction",
          },
        },
      })
      .mockResolvedValueOnce({ kind: "ok" });
    mockTransactionMutations(
      authMutation,
      vi.fn(),
      vi.fn(),
      approvalMutation,
      itemAdjustmentMutation,
      terminalAuthMutation,
    );
    useParamsMock.mockReturnValue({ transactionId: "txn_items" });
    useQueryMock.mockReturnValue({
      ...baseTransaction,
      total: 2000,
      items: [
        {
          _id: "item_1",
          productId: "product_1",
          productName: "Closure wig",
          productSku: "CW-18",
          productSkuId: "sku_1",
          quantity: 2,
          totalPrice: 2000,
          unitPrice: 1000,
        },
      ],
    });

    render(<TransactionView />);

    await user.click(screen.getByRole("button", { name: "Update" }));
    await user.click(
      screen.getByRole("button", { name: "Items or quantities" }),
    );
    await user.click(screen.getByRole("button", { name: /increase closure wig/i }));
    await user.selectOptions(screen.getByLabelText("Settlement method"), "cash");
    await user.type(
      screen.getByLabelText("Item adjustment reason"),
      "One unit was missed at checkout.",
    );
    const submitButton = screen.getByRole("button", {
      name: "Submit item adjustment",
    });
    await user.click(submitButton);
    await user.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() => expect(approvalMutation).toHaveBeenCalledTimes(1));
    expect(submitButton).toBeDisabled();
    await user.click(submitButton);
    expect(itemAdjustmentMutation).toHaveBeenCalledTimes(1);

    approvalDeferred.resolve({
      kind: "ok",
      data: {
        approvalProofId: "proof-1",
        approvedByStaffProfileId: "staff_1",
        expiresAt: 2,
      },
    });

    await waitFor(() => expect(itemAdjustmentMutation).toHaveBeenCalledTimes(2));
  });

  it("allows equal-total item adjustments without a settlement method", async () => {
    const user = userEvent.setup();
    const authMutation = vi.fn();
    const terminalAuthMutation = vi.fn().mockResolvedValue({
      kind: "ok",
      data: {
        activeRoles: ["cashier"],
        posLocalStaffProof: {
          expiresAt: Date.now() + 60_000,
          token: "proof-token-1",
        },
        staffProfile: { firstName: "Kwamina", lastName: "Mensah" },
        staffProfileId: "staff_1",
      },
    });
    const itemAdjustmentMutation = vi.fn().mockResolvedValue({ kind: "ok" });
    mockTransactionMutations(
      authMutation,
      vi.fn(),
      vi.fn(),
      vi.fn(),
      itemAdjustmentMutation,
      terminalAuthMutation,
    );
    useParamsMock.mockReturnValue({ transactionId: "txn_equal" });
    useQueryMock.mockReturnValue({
      ...baseTransaction,
      total: 2000,
      items: [
        {
          _id: "item_1",
          productId: "product_1",
          productName: "Closure wig",
          productSku: "CW-18",
          productSkuId: "sku_1",
          quantity: 1,
          totalPrice: 1000,
          unitPrice: 1000,
        },
        {
          _id: "item_2",
          productId: "product_2",
          productName: "Lace tint",
          productSku: "LT-01",
          productSkuId: "sku_2",
          quantity: 1,
          totalPrice: 1000,
          unitPrice: 1000,
        },
      ],
    });

    render(<TransactionView />);

    await user.click(screen.getByRole("button", { name: "Update" }));
    await user.click(
      screen.getByRole("button", { name: "Items or quantities" }),
    );
    await user.click(screen.getByRole("button", { name: /increase closure wig/i }));
    await user.click(screen.getByRole("button", { name: /decrease lace tint/i }));
    expect(screen.getAllByText("No payment movement").length).toBeGreaterThan(0);
    expect(screen.queryByLabelText("Settlement method")).not.toBeInTheDocument();
    await user.type(
      screen.getByLabelText("Item adjustment reason"),
      "Swapped one equal-price item.",
    );
    await user.click(
      screen.getByRole("button", { name: "Submit item adjustment" }),
    );
    await user.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() =>
      expect(itemAdjustmentMutation).toHaveBeenCalledWith({
        actorStaffProfileId: "staff_1",
        approvalProofId: undefined,
        payload: {
          correctedTotal: 2000,
          lines: [
            {
              adjustedQuantity: 2,
              inventoryDelta: -1,
              originalQuantity: 1,
              originalTransactionItemId: "item_1",
              productId: "product_1",
              productName: "Closure wig",
              productSku: "CW-18",
              productSkuId: "sku_1",
              unitPrice: 1000,
            },
            {
              adjustedQuantity: 0,
              inventoryDelta: 1,
              originalQuantity: 1,
              originalTransactionItemId: "item_2",
              productId: "product_2",
              productName: "Lace tint",
              productSku: "LT-01",
              productSkuId: "sku_2",
              unitPrice: 1000,
            },
          ],
          originalTotal: 2000,
          settlementAmount: 0,
          settlementDirection: "none",
          settlementMethod: undefined,
        },
        reason: "Swapped one equal-price item.",
        staffProofToken: "proof-token-1",
        transactionId: "txn_equal",
      }),
    );
  });

  it("renders item adjustment command errors returned by the backend", async () => {
    const user = userEvent.setup();
    const authMutation = vi.fn();
    const terminalAuthMutation = vi.fn().mockResolvedValue({
      kind: "ok",
      data: {
        activeRoles: ["cashier"],
        posLocalStaffProof: {
          expiresAt: Date.now() + 60_000,
          token: "proof-token-1",
        },
        staffProfile: { firstName: "Kwamina", lastName: "Mensah" },
        staffProfileId: "staff_1",
      },
    });
    const itemAdjustmentMutation = vi.fn().mockResolvedValue({
      kind: "user_error",
      error: {
        code: "precondition_failed",
        message: "Register session expected cash cannot be negative.",
      },
    });
    mockTransactionMutations(
      authMutation,
      vi.fn(),
      vi.fn(),
      vi.fn(),
      itemAdjustmentMutation,
      terminalAuthMutation,
    );
    useParamsMock.mockReturnValue({
      orgUrlSlug: "wigclub",
      storeUrlSlug: "osu",
      transactionId: "txn_cash_refund",
    });
    useQueryMock.mockReturnValue({
      ...baseTransaction,
      paymentMethod: "mobile_money",
      payments: [{ method: "mobile_money", amount: 2000, timestamp: 123 }],
      registerSessionId: "session_1",
      total: 2000,
      totalPaid: 2000,
      items: [
        {
          _id: "item_1",
          productId: "product_1",
          productName: "Closure wig",
          productSku: "CW-18",
          productSkuId: "sku_1",
          quantity: 2,
          totalPrice: 2000,
          unitPrice: 1000,
        },
      ],
    });

    render(<TransactionView />);

    await user.click(screen.getByRole("button", { name: "Update" }));
    await user.click(
      screen.getByRole("button", { name: "Items or quantities" }),
    );
    await user.click(screen.getByRole("button", { name: /decrease closure wig/i }));
    await user.selectOptions(screen.getByLabelText("Settlement method"), "cash");
    await user.type(
      screen.getByLabelText("Item adjustment reason"),
      "Customer was charged for two instead of one.",
    );
    await user.click(
      screen.getByRole("button", { name: "Submit item adjustment" }),
    );
    await user.click(screen.getByRole("button", { name: "Confirm" }));

    expect(
      await screen.findByText("Drawer expected cash is below this refund."),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Correct the register session opening float so expected cash can cover the cash refund, then submit the item adjustment again.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("Register session expected cash cannot be negative.")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /review register session/i })).toHaveAttribute(
      "href",
      "/wigclub/store/osu/cash-controls/registers/session_1",
    );
    expect(screen.queryByText("Please try again.")).not.toBeInTheDocument();
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
