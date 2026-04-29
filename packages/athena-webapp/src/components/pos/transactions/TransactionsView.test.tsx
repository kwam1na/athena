import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TransactionsView } from "./TransactionsView";

const useQueryMock = vi.fn();
const useGetActiveStoreMock = vi.fn();
const useSearchMock = vi.fn();

vi.mock("@tanstack/react-router", () => ({
  useSearch: () => useSearchMock(),
}));

vi.mock("convex/react", () => ({
  useQuery: (...args: unknown[]) => useQueryMock(...args),
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
    useGetActiveStoreMock.mockReturnValue({
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
      screen.queryByTestId("session-trace-POS-123456"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("session-trace-POS-654321"),
    ).not.toBeInTheDocument();
  });

  it("passes the register session filter to the completed transactions query", () => {
    useSearchMock.mockReturnValue({ registerSessionId: "session-1" });
    useGetActiveStoreMock.mockReturnValue({
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
});
