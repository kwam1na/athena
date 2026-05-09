import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TransactionsView } from "./TransactionsView";

const useQueryMock = vi.fn();
const getActiveStoreMock = vi.fn();
const useSearchMock = vi.fn();

vi.mock("@tanstack/react-router", () => ({
  useSearch: () => useSearchMock(),
}));

vi.mock("convex/react", () => ({
  useQuery: (...args: unknown[]) => useQueryMock(...args),
}));

vi.mock("@/hooks/useGetActiveStore", () => ({
  default: () => getActiveStoreMock(),
}));

vi.mock("~/src/hooks/use-navigate-back", () => ({
  useNavigateBack: () => vi.fn(),
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
  NavigateBackButton: () => <button aria-label="Go back" type="button" />,
  SimplePageHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
}));

vi.mock("../../base/table/data-table", () => ({
  GenericDataTable: ({
    data,
  }: {
    data: Array<{
      transactionNumber: string;
      sessionTraceId: string | null;
    }>;
  }) => (
    <div>
      {data.map((row) => (
        <div key={row.transactionNumber}>
          <span>{row.transactionNumber}</span>
          {row.sessionTraceId ? (
            <span data-testid={`session-trace-${row.transactionNumber}`}>
              trace
            </span>
          ) : null}
        </div>
      ))}
    </div>
  ),
}));

vi.mock("@/components/ui/tabs", () => ({
  Tabs: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  TabsList: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  TabsTrigger: ({ children }: { children?: React.ReactNode }) => (
    <button type="button">{children}</button>
  ),
}));

describe("TransactionsView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSearchMock.mockReturnValue({});
  });

  it("does not render session traces on the completed transactions surface", () => {
    getActiveStoreMock.mockReturnValue({
      activeStore: {
        _id: "store-1",
        currency: "GHS",
      },
    });
    useQueryMock.mockReturnValue([
      {
        _id: "txn-1",
        transactionNumber: "POS-123456",
        total: 1000,
        paymentMethod: "cash",
        paymentMethods: ["cash"],
        cashierName: "Ada L.",
        customerName: null,
        itemCount: 1,
        completedAt: Date.now(),
        hasTrace: true,
        sessionTraceId: "pos_session:ses-001",
      },
      {
        _id: "txn-2",
        transactionNumber: "POS-654321",
        total: 1000,
        paymentMethod: "cash",
        paymentMethods: ["cash"],
        cashierName: "Ada L.",
        customerName: null,
        itemCount: 1,
        completedAt: Date.now(),
        hasTrace: false,
        sessionTraceId: null,
      },
    ]);

    render(<TransactionsView />);

    expect(
      screen.getByRole("heading", { name: "Completed Transactions" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("session-trace-POS-123456"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("session-trace-POS-654321"),
    ).not.toBeInTheDocument();
  });

  it("passes the register session filter to the completed transactions query", () => {
    useSearchMock.mockReturnValue({ registerSessionId: "session-1" });
    getActiveStoreMock.mockReturnValue({
      activeStore: {
        _id: "store-1",
        currency: "GHS",
      },
    });
    useQueryMock.mockReturnValueOnce([]).mockReturnValueOnce({
      registerSession: {
        registerNumber: "3",
      },
    });

    render(<TransactionsView />);

    expect(useQueryMock).toHaveBeenNthCalledWith(1, expect.anything(), {
      storeId: "store-1",
      registerSessionId: "session-1",
    });
    expect(
      screen.getByText("Showing transactions linked to Register 3"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("No transactions for Register 3"),
    ).toBeInTheDocument();
  });

  it("filters cash-paid transactions across split payment methods", () => {
    useSearchMock.mockReturnValue({ paymentMethod: "cash" });
    getActiveStoreMock.mockReturnValue({
      activeStore: {
        _id: "store-1",
        currency: "GHS",
      },
    });
    useQueryMock.mockReturnValue([
      {
        _id: "txn-1",
        transactionNumber: "POS-CASH-SPLIT",
        total: 1000,
        paymentMethod: "card",
        paymentMethods: ["card", "cash"],
        hasMultiplePaymentMethods: true,
        cashierName: "Ada L.",
        customerName: null,
        itemCount: 1,
        completedAt: Date.now(),
        hasTrace: false,
        sessionTraceId: null,
      },
      {
        _id: "txn-2",
        transactionNumber: "POS-CARD-ONLY",
        total: 1000,
        paymentMethod: "card",
        paymentMethods: ["card"],
        hasMultiplePaymentMethods: false,
        cashierName: "Ada L.",
        customerName: null,
        itemCount: 1,
        completedAt: Date.now(),
        hasTrace: false,
        sessionTraceId: null,
      },
    ]);

    render(<TransactionsView />);

    expect(
      screen.getByText("Showing Cash transactions"),
    ).toBeInTheDocument();
    expect(screen.getByText("POS-CASH-SPLIT")).toBeInTheDocument();
    expect(screen.queryByText("POS-CARD-ONLY")).not.toBeInTheDocument();
  });

  it("uses the operating date search param as the completed-from filter", () => {
    useSearchMock.mockReturnValue({ operatingDate: "2026-05-08" });
    getActiveStoreMock.mockReturnValue({
      activeStore: {
        _id: "store-1",
        currency: "GHS",
      },
    });
    useQueryMock.mockReturnValue([
      {
        _id: "txn-1",
        transactionNumber: "POS-MAY-08",
        total: 1000,
        paymentMethod: "cash",
        paymentMethods: ["cash"],
        hasMultiplePaymentMethods: false,
        cashierName: "Ada L.",
        customerName: null,
        itemCount: 1,
        completedAt: new Date(2026, 4, 8, 10).getTime(),
        hasTrace: false,
        sessionTraceId: null,
      },
    ]);

    render(<TransactionsView />);

    expect(useQueryMock).toHaveBeenNthCalledWith(1, expect.anything(), {
      storeId: "store-1",
      completedFrom: new Date(2026, 4, 8).getTime(),
    });
    expect(
      screen.getByText("Showing transactions from May 8, 2026"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "From May 8, 2026" }))
      .toBeInTheDocument();
    expect(screen.getByText("POS-MAY-08")).toBeInTheDocument();
  });

  it("combines active payment and operating date filters into one summary", () => {
    useSearchMock.mockReturnValue({
      operatingDate: "2026-05-08",
      paymentMethod: "cash",
    });
    getActiveStoreMock.mockReturnValue({
      activeStore: {
        _id: "store-1",
        currency: "GHS",
      },
    });
    useQueryMock.mockReturnValue([
      {
        _id: "txn-1",
        transactionNumber: "POS-CASH-MAY-08",
        total: 1000,
        paymentMethod: "cash",
        paymentMethods: ["cash"],
        hasMultiplePaymentMethods: false,
        cashierName: "Ada L.",
        customerName: null,
        itemCount: 1,
        completedAt: new Date(2026, 4, 8, 10).getTime(),
        hasTrace: false,
        sessionTraceId: null,
      },
    ]);

    render(<TransactionsView />);

    expect(
      screen.getByText("Showing Cash transactions from May 8, 2026"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Showing Cash transactions"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("Showing from May 8, 2026"),
    ).not.toBeInTheDocument();
  });

  it("shows the origin-aware back button when transactions open from another workspace", () => {
    useSearchMock.mockReturnValue({ o: "%2Fwigclub%2Fstore%2Fosu%2Foperations" });
    getActiveStoreMock.mockReturnValue({
      activeStore: {
        _id: "store-1",
        currency: "GHS",
      },
    });
    useQueryMock.mockReturnValue([]);

    render(<TransactionsView />);

    expect(screen.getByRole("button", { name: "Go back" })).toBeInTheDocument();
  });
});
