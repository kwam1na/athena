import { render, screen } from "@testing-library/react";
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
  SimplePageHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
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

vi.mock("~/src/hooks/useProtectedAdminPageState", () => ({
  useProtectedAdminPageState: () => useProtectedAdminPageStateMock(),
}));

vi.mock("../../staff-auth/StaffAuthenticationDialog", () => ({
  StaffAuthenticationDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="staff-auth-dialog" /> : null,
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
    useMutationMock.mockReturnValue(vi.fn());
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

    expect(screen.getByTestId("session-trace-link")).toHaveTextContent(
      "pos_session:ses-001:Session trace",
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

    await user.click(screen.getByRole("button", { name: "Correct" }));

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

    expect(screen.getByText("Customer correction")).toBeInTheDocument();
    expect(
      screen.getByLabelText("Customer correction reason"),
    ).toBeInTheDocument();
  });

  it("routes high-risk transaction corrections to safe guidance", async () => {
    const user = userEvent.setup();
    useParamsMock.mockReturnValue({ transactionId: "txn_7" });
    useQueryMock.mockReturnValue(baseTransaction);

    render(<TransactionView />);

    await user.click(screen.getByRole("button", { name: "Correct" }));
    await user.click(screen.getByRole("button", { name: "Amounts or totals" }));

    expect(
      screen.getByText(
        "Use refund, exchange, or manager review for item, amount, total, or discount corrections.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByLabelText("Payment method correction reason"),
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
          message: "Customer attribution corrected",
          reason: "Customer called with receipt.",
        },
      ],
    });

    render(<TransactionView />);

    expect(screen.getByText("Correction history")).toBeInTheDocument();
    expect(
      screen.getByText("Customer attribution corrected"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Customer called with receipt."),
    ).toBeInTheDocument();
    expect(screen.getByText(/by Ama M\./)).toBeInTheDocument();
  });

  it("omits correction history when no events are present", () => {
    useParamsMock.mockReturnValue({ transactionId: "txn_9" });
    useQueryMock.mockReturnValue(baseTransaction);

    render(<TransactionView />);

    expect(screen.queryByText("Correction history")).not.toBeInTheDocument();
  });
});
