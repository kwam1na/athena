import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TransactionView } from "./TransactionView";

const useQueryMock = vi.fn();
const useParamsMock = vi.fn();
const useGetActiveStoreMock = vi.fn();

vi.mock("convex/react", () => ({
  useQuery: (...args: unknown[]) => useQueryMock(...args),
}));

vi.mock("@tanstack/react-router", () => ({
  useParams: (...args: unknown[]) => useParamsMock(...args),
}));

vi.mock("@/hooks/useGetActiveStore", () => ({
  default: () => useGetActiveStoreMock(),
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
  Badge: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("../../ui/card", () => ({
  Card: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  CardContent: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  CardHeader: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  CardTitle: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("../OrderSummary", () => ({
  OrderSummary: () => <div data-testid="order-summary" />,
}));

vi.mock("../CartItems", () => ({
  CartItems: () => <div data-testid="cart-items" />,
}));

vi.mock("./WorkflowTraceLink", () => ({
  WorkflowTraceLink: ({
    transactionNumber,
  }: {
    transactionNumber: string;
  }) => <span data-testid="trace-link">{transactionNumber}</span>,
}));

describe("TransactionView", () => {
  it("renders the workflow trace link when the transaction has a trace", () => {
    useParamsMock.mockReturnValue({ transactionId: "txn_1" });
    useGetActiveStoreMock.mockReturnValue({
      activeStore: { currency: "GHS" },
    });
    useQueryMock.mockReturnValue({
      _id: "txn_1",
      transactionNumber: "POS-123456",
      subtotal: 1000,
      tax: 0,
      total: 1000,
      hasTrace: true,
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

    expect(screen.getByTestId("trace-link")).toHaveTextContent("POS-123456");
  });

  it("hides the workflow trace link when the transaction does not have a trace", () => {
    useParamsMock.mockReturnValue({ transactionId: "txn_2" });
    useGetActiveStoreMock.mockReturnValue({
      activeStore: { currency: "GHS" },
    });
    useQueryMock.mockReturnValue({
      _id: "txn_2",
      transactionNumber: "POS-654321",
      subtotal: 1000,
      tax: 0,
      total: 1000,
      hasTrace: false,
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

    expect(screen.queryByTestId("trace-link")).not.toBeInTheDocument();
  });
});
