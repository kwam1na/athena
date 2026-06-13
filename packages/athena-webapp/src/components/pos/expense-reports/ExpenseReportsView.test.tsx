import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ExpenseReportsView } from "./ExpenseReportsView";

const getActiveStoreMock = vi.fn();
const useQueryMock = vi.fn();

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    "aria-label": ariaLabel,
    className,
    params: _params,
    search: _search,
    to: _to,
    ...props
  }: {
    children?: React.ReactNode;
    "aria-label"?: string;
    className?: string;
    params?: unknown;
    search?: unknown;
    to?: unknown;
    [key: string]: unknown;
  }) => {
    void _params;
    void _search;
    void _to;

    return (
      <a aria-label={ariaLabel} className={className} href="#" {...props}>
        {children}
      </a>
    );
  },
}));

vi.mock("convex/react", () => ({
  useQuery: (...args: unknown[]) => useQueryMock(...args),
}));

vi.mock("@/hooks/useGetActiveStore", () => ({
  default: () => getActiveStoreMock(),
}));

vi.mock("../../View", () => ({
  default: ({
    children,
  }: {
    children?: React.ReactNode;
    header?: React.ReactNode;
  }) => <div>{children}</div>,
}));

vi.mock("../../common/FadeIn", () => ({
  FadeIn: ({
    children,
    className,
  }: {
    children?: React.ReactNode;
    className?: string;
  }) => <div className={className}>{children}</div>,
}));

vi.mock("../../common/PageHeader", () => ({
  NavigateBackButton: () => <button aria-label="Go back" type="button" />,
}));

vi.mock("../../base/table/data-table", () => ({
  GenericDataTable: ({
    data,
  }: {
    data: Array<{
      transactionNumber: string;
    }>;
  }) => (
    <div>
      {data.map((row) => (
        <span key={row.transactionNumber}>{row.transactionNumber}</span>
      ))}
    </div>
  ),
}));

vi.mock("@/components/ui/tabs", () => ({
  Tabs: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  TabsList: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  TabsTrigger: ({
    children,
    ...props
  }: {
    children?: React.ReactNode;
    [key: string]: unknown;
  }) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
}));

describe("ExpenseReportsView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getActiveStoreMock.mockReturnValue({
      activeStore: {
        _id: "store-1",
        currency: "GHS",
      },
    });
  });

  it("renders expense reports in the workspace frame with back navigation", () => {
    useQueryMock.mockReturnValue([
      {
        _id: "expense-1",
        transactionNumber: "EXP-123456",
        totalValue: 19800,
        staffProfileName: "Ada L.",
        itemCount: 2,
        completedAt: Date.now(),
        notes: null,
      },
    ]);

    render(<ExpenseReportsView />);

    expect(
      screen.getByRole("heading", { name: "Expense Reports" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Point of sale")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Go back" })).toBeInTheDocument();
    expect(screen.getByText("EXP-123456")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Today" })).toHaveAttribute(
      "data-remote-assist-control-id",
      "pos-expense-reports-filter-today",
    );
    expect(screen.getByRole("button", { name: "All Time" })).toHaveAttribute(
      "data-remote-assist-control-id",
      "pos-expense-reports-filter-all",
    );
  });

  it("renders expense reports as scan-friendly mobile cards", () => {
    useQueryMock.mockReturnValue([
      {
        _id: "expense-mobile",
        transactionNumber: "EXP-MOBILE",
        totalValue: 19800,
        staffProfileName: "Ada L.",
        itemCount: 2,
        completedAt: Date.now(),
        notes: "Restock drawer supplies.",
      },
    ]);

    render(<ExpenseReportsView />);

    const card = screen.getByRole("link", {
      name: "Open expense report #EXP-MOBILE",
    });

    expect(card).toHaveAttribute(
      "data-remote-assist-control-id",
      "pos-expense-report-expense-mobile",
    );
    expect(card).toHaveAttribute(
      "data-remote-assist-control-label",
      "Open expense report #EXP-MOBILE",
    );
    expect(card).toHaveClass("rounded-lg", "p-layout-md");
    expect(within(card).getByText("#EXP-MOBILE")).toBeInTheDocument();
    expect(within(card).getByText("2 items")).toBeInTheDocument();
    expect(within(card).getByText("Cashier")).toHaveClass(
      "text-xs",
      "tracking-[0.12em]",
    );
    expect(within(card).getByText("Ada L.")).toHaveClass("text-sm");
    expect(within(card).getByText("Notes")).toHaveClass(
      "text-xs",
      "tracking-[0.12em]",
    );
    expect(within(card).getByText("Restock drawer supplies.")).toHaveClass(
      "text-sm",
    );
  });
});
