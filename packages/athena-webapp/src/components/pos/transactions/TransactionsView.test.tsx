import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TransactionsView } from "./TransactionsView";

const useQueryMock = vi.fn();
const useGetActiveStoreMock = vi.fn();

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
            <span data-testid={`session-trace-${row.transactionNumber}`}>trace</span>
          ) : null}
        </div>
      ))}
    </div>
  ),
}));

vi.mock("@/components/ui/tabs", () => ({
  Tabs: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  TabsList: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  TabsTrigger: ({ children }: { children?: React.ReactNode }) => (
    <button type="button">{children}</button>
  ),
}));

describe("TransactionsView", () => {
  it("maps the trace availability flag into the rendered completed-transactions surface", () => {
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

    expect(screen.getByTestId("session-trace-POS-123456")).toBeInTheDocument();
    expect(screen.queryByTestId("session-trace-POS-654321")).not.toBeInTheDocument();
  });
});
