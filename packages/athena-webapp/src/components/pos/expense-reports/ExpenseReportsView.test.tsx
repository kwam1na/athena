import {
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ExpenseReportsView } from "./ExpenseReportsView";

const getActiveStoreMock = vi.fn();
const getTerminalMock = vi.fn();
const navigateMock = vi.fn();
const useExpenseLocalRuntimeMock = vi.fn();
const useQueryMock = vi.fn();
const useSearchMock = vi.fn();

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
  useNavigate: () => navigateMock,
  useSearch: () => useSearchMock(),
}));

vi.mock("convex/react", () => ({
  useQuery: (...args: unknown[]) => useQueryMock(...args),
}));

vi.mock("@/hooks/useGetActiveStore", () => ({
  default: () => getActiveStoreMock(),
}));

vi.mock("@/hooks/useGetTerminal", () => ({
  useGetTerminal: () => getTerminalMock(),
}));

vi.mock("@/hooks/useExpenseLocalRuntime", () => ({
  useExpenseLocalRuntime: (...args: unknown[]) =>
    useExpenseLocalRuntimeMock(...args),
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
    onPageIndexChange,
    pageIndex,
    renderMobileCard,
  }: {
    data: Array<{
      _id?: string;
      transactionNumber: string;
    }>;
    onPageIndexChange?: (pageIndex: number) => void;
    pageIndex?: number;
    renderMobileCard?: (row: {
      _id?: string;
      transactionNumber: string;
    }) => React.ReactNode;
  }) => (
    <div>
      <div data-testid="expense-reports-table-page-index">
        {pageIndex ?? "local"}
      </div>
      {renderMobileCard ? (
        <div data-testid="expense-report-mobile-cards">
          {data.map((row) => (
            <div key={`mobile-${row._id ?? row.transactionNumber}`}>
              {renderMobileCard(row)}
            </div>
          ))}
        </div>
      ) : null}
      {data.map((row) => (
        <span key={row.transactionNumber}>{row.transactionNumber}</span>
      ))}
      <button type="button" onClick={() => onPageIndexChange?.(2)}>
        Go to expense report page 3
      </button>
    </div>
  ),
}));

vi.mock("@/components/ui/tabs", () => ({
  Tabs: ({
    children,
    onValueChange,
    value,
  }: {
    children?: React.ReactNode;
    onValueChange?: (value: string) => void;
    value?: string;
  }) => (
    <div>
      <div data-testid="expense-reports-filter-value">{value}</div>
      <button type="button" onClick={() => onValueChange?.("all")}>
        Select all expense reports
      </button>
      {children}
    </div>
  ),
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
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 4, 10, 12));
    vi.clearAllMocks();
    useSearchMock.mockReturnValue({});
    getActiveStoreMock.mockReturnValue({
      activeStore: {
        _id: "store-1",
        currency: "GHS",
      },
    });
    getTerminalMock.mockReturnValue({ _id: "terminal-1" });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps the workspace header visible while expense reports load", () => {
    useQueryMock.mockReturnValue(undefined);

    render(<ExpenseReportsView />);

    expect(
      screen.getByRole("heading", { name: "Expense Reports" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Today" })).toBeInTheDocument();
    expect(
      screen.queryByText("No expense reports today"),
    ).not.toBeInTheDocument();
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
    expect(useExpenseLocalRuntimeMock).toHaveBeenCalledWith({
      staffProfileId: null,
      storeId: "store-1",
      terminalId: "terminal-1",
    });
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

  it("opens operating-date links on the selected day report list", () => {
    useSearchMock.mockReturnValue({ operatingDate: "2026-05-08" });
    useQueryMock.mockReturnValue([
      {
        _id: "expense-selected",
        transactionNumber: "EXP-SELECTED",
        totalValue: 19800,
        staffProfileName: "Ada L.",
        itemCount: 2,
        completedAt: new Date(2026, 4, 8, 10).getTime(),
        notes: null,
      },
      {
        _id: "expense-today",
        transactionNumber: "EXP-TODAY",
        totalValue: 4200,
        staffProfileName: "Ada L.",
        itemCount: 1,
        completedAt: new Date(2026, 4, 10, 10).getTime(),
        notes: null,
      },
    ]);

    render(<ExpenseReportsView />);

    expect(
      screen.getByRole("button", { name: "Selected day" }),
    ).toHaveAttribute(
      "data-remote-assist-control-id",
      "pos-expense-reports-filter-operating-date",
    );
    expect(screen.getByText("EXP-SELECTED")).toBeInTheDocument();
    expect(screen.queryByText("EXP-TODAY")).not.toBeInTheDocument();
  });

  it("restores expense report table pagination from the URL page", () => {
    useSearchMock.mockReturnValue({ page: 3 });
    useQueryMock.mockReturnValue([
      {
        _id: "expense-page",
        transactionNumber: "EXP-PAGE",
        totalValue: 19800,
        staffProfileName: "Ada L.",
        itemCount: 2,
        completedAt: Date.now(),
        notes: null,
      },
    ]);

    render(<ExpenseReportsView />);

    expect(
      screen.getByTestId("expense-reports-table-page-index"),
    ).toHaveTextContent("2");
  });

  it("clamps stale expense report route pages after filtering", async () => {
    useSearchMock.mockReturnValue({ page: 3, timeRange: "all" });
    useQueryMock.mockReturnValue([
      {
        _id: "expense-page",
        transactionNumber: "EXP-PAGE",
        totalValue: 19800,
        staffProfileName: "Ada L.",
        itemCount: 2,
        completedAt: Date.now(),
        notes: null,
      },
    ]);

    render(<ExpenseReportsView />);

    expect(navigateMock).toHaveBeenCalledWith({
      replace: true,
      search: expect.any(Function),
    });
    const [navigateOptions] = navigateMock.mock.calls.at(-1) ?? [];
    const updateSearch = navigateOptions?.search as
      | ((current: Record<string, unknown>) => Record<string, unknown>)
      | undefined;

    expect(updateSearch?.({ page: 3, timeRange: "all" })).toEqual({
      timeRange: "all",
    });
  });

  it("restores the expense report filter from the URL time range", () => {
    useSearchMock.mockReturnValue({ timeRange: "all" });
    useQueryMock.mockReturnValue([
      {
        _id: "expense-all",
        transactionNumber: "EXP-ALL",
        totalValue: 19800,
        staffProfileName: "Ada L.",
        itemCount: 2,
        completedAt: new Date(2026, 4, 8, 10).getTime(),
        notes: null,
      },
    ]);

    render(<ExpenseReportsView />);

    expect(screen.getByTestId("expense-reports-filter-value")).toHaveTextContent(
      "all",
    );
    expect(screen.getByText("EXP-ALL")).toBeInTheDocument();
  });

  it("writes expense report table pagination changes to route search", () => {
    useSearchMock.mockReturnValue({ o: "/return" });
    useQueryMock.mockReturnValue([
      {
        _id: "expense-page",
        transactionNumber: "EXP-PAGE",
        totalValue: 19800,
        staffProfileName: "Ada L.",
        itemCount: 2,
        completedAt: Date.now(),
        notes: null,
      },
    ]);

    render(<ExpenseReportsView />);

    screen.getByRole("button", { name: "Go to expense report page 3" }).click();

    expect(navigateMock).toHaveBeenCalledWith({
      replace: true,
      search: expect.any(Function),
    });
    const [navigateOptions] = navigateMock.mock.calls.at(-1) ?? [];
    const updateSearch = navigateOptions?.search as
      | ((current: Record<string, unknown>) => Record<string, unknown>)
      | undefined;

    expect(updateSearch?.({ o: "/return" })).toEqual({
      o: "/return",
      page: 3,
    });
  });

  it("writes expense report filter changes to route search and resets pagination", () => {
    useSearchMock.mockReturnValue({ o: "/return", page: 3 });
    useQueryMock.mockReturnValue([
      {
        _id: "expense-filter",
        transactionNumber: "EXP-FILTER",
        totalValue: 19800,
        staffProfileName: "Ada L.",
        itemCount: 2,
        completedAt: Date.now(),
        notes: null,
      },
    ]);

    render(<ExpenseReportsView />);

    fireEvent.click(
      screen.getByRole("button", { name: "Select all expense reports" }),
    );

    expect(navigateMock).toHaveBeenCalledWith({
      replace: true,
      search: expect.any(Function),
    });
    const [navigateOptions] = navigateMock.mock.calls.at(-1) ?? [];
    const updateSearch = navigateOptions?.search as
      | ((current: Record<string, unknown>) => Record<string, unknown>)
      | undefined;

    expect(updateSearch?.({ o: "/return", page: 3 })).toEqual({
      o: "/return",
      timeRange: "all",
    });
  });
});
