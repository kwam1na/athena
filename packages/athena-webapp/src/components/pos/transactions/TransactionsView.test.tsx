import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TransactionsView } from "./TransactionsView";

const useQueryMock = vi.fn();
const getActiveStoreMock = vi.fn();
const navigateMock = vi.fn();
const useSearchMock = vi.fn();
let tabsOnValueChange:
  | ((value: "today" | "fromDate" | "all") => void)
  | undefined;

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    "aria-label": ariaLabel,
    className,
  }: {
    children?: React.ReactNode;
    "aria-label"?: string;
    className?: string;
  }) => (
    <a aria-label={ariaLabel} className={className} href="#">
      {children}
    </a>
  ),
  useNavigate: () => navigateMock,
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
    onPageIndexChange,
    pageIndex,
    renderMobileCard,
  }: {
    data: Array<{
      _id?: string;
      itemCount?: number;
      transactionNumber: string;
      sessionTraceId: string | null;
      status?: string;
    }>;
    onPageIndexChange?: (pageIndex: number) => void;
    pageIndex?: number;
    renderMobileCard?: (row: {
      _id?: string;
      itemCount?: number;
      transactionNumber: string;
      sessionTraceId: string | null;
      status?: string;
    }) => React.ReactNode;
  }) => (
    <div>
      <div data-testid="transaction-table-page-index">
        {pageIndex ?? "local"}
      </div>
      {renderMobileCard ? (
        <div data-testid="transaction-mobile-cards">
          {data.map((row) => (
            <div key={`mobile-${row._id ?? row.transactionNumber}`}>
              {renderMobileCard(row)}
            </div>
          ))}
        </div>
      ) : null}
      {data.map((row) => (
        <div key={row.transactionNumber}>
          <span>{row.transactionNumber}</span>
          {row.itemCount !== undefined ? (
            <span>
              {row.itemCount} {row.itemCount === 1 ? "item" : "items"}
            </span>
          ) : null}
          {row.sessionTraceId ? (
            <span data-testid={`session-trace-${row.transactionNumber}`}>
              trace
            </span>
          ) : null}
          {row.status === "void" ? <span>Voided</span> : null}
        </div>
      ))}
      <button type="button" onClick={() => onPageIndexChange?.(1)}>
        Go to table page 2
      </button>
    </div>
  ),
}));

vi.mock("@/components/ui/tabs", () => ({
  Tabs: ({
    children,
    onValueChange,
  }: {
    children?: React.ReactNode;
    onValueChange?: (value: "today" | "fromDate" | "all") => void;
  }) => {
    tabsOnValueChange = onValueChange;

    return <div>{children}</div>;
  },
  TabsList: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  TabsTrigger: ({
    children,
    value,
  }: {
    children?: React.ReactNode;
    value: "today" | "fromDate" | "all";
  }) => (
    <button type="button" onClick={() => tabsOnValueChange?.(value)}>
      {children}
    </button>
  ),
}));

describe("TransactionsView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    tabsOnValueChange = undefined;
    useSearchMock.mockReturnValue({});
  });

  it("keeps the workspace header visible while completed transactions load", () => {
    getActiveStoreMock.mockReturnValue({
      activeStore: {
        _id: "store-1",
        currency: "GHS",
      },
    });
    useQueryMock.mockReturnValue(undefined);

    render(<TransactionsView />);

    expect(
      screen.getByRole("heading", { name: "Completed Transactions" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Today" })).toBeInTheDocument();
    expect(
      screen.queryByText("No completed transactions today"),
    ).not.toBeInTheDocument();
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

  it("marks voided completed rows in the completed transactions table", () => {
    getActiveStoreMock.mockReturnValue({
      activeStore: {
        _id: "store-1",
        currency: "GHS",
      },
    });
    useQueryMock.mockReturnValue([
      {
        _id: "txn-void",
        transactionNumber: "POS-VOID",
        total: 1000,
        paymentMethod: "cash",
        paymentMethods: ["cash"],
        cashierName: "Ada L.",
        customerName: null,
        itemCount: 1,
        completedAt: Date.now(),
        hasTrace: false,
        sessionTraceId: null,
        status: "void",
        voidedAt: Date.now(),
        voidReason: "Duplicate sale.",
      },
    ]);

    render(<TransactionsView />);

    expect(screen.getByText("POS-VOID")).toBeInTheDocument();
    expect(screen.getAllByText("Voided").length).toBeGreaterThan(0);
  });

  it("renders completed transactions as scan-friendly mobile cards", () => {
    getActiveStoreMock.mockReturnValue({
      activeStore: {
        _id: "store-1",
        currency: "GHS",
      },
    });
    useQueryMock.mockReturnValue([
      {
        _id: "txn-mobile",
        transactionNumber: "POS-MOBILE",
        total: 1000,
        paymentMethod: "cash",
        paymentMethods: ["cash"],
        cashierName: "Ada L.",
        customerName: "Walk-in",
        itemCount: 1,
        completedAt: Date.now(),
        hasTrace: false,
        sessionTraceId: null,
      },
    ]);

    render(<TransactionsView />);

    const card = screen.getByRole("link", {
      name: "Open transaction #POS-MOBILE",
    });

    expect(card).toHaveClass("rounded-lg", "p-layout-md");
    expect(within(card).getByText("#POS-MOBILE")).toBeInTheDocument();
    expect(within(card).getByText("1 item - Walk-in")).toBeInTheDocument();
    expect(within(card).getByText("Payment")).toHaveClass(
      "text-xs",
      "tracking-[0.12em]",
    );
    expect(within(card).getByText("Cash")).toHaveClass("text-sm");
    expect(within(card).getByText("Cashier")).toHaveClass(
      "text-xs",
      "tracking-[0.12em]",
    );
    expect(within(card).getByText("Ada L.")).toHaveClass("text-sm");
  });

  it("includes service lines in completed transaction item counts", () => {
    getActiveStoreMock.mockReturnValue({
      activeStore: {
        _id: "store-1",
        currency: "GHS",
      },
    });
    useQueryMock.mockReturnValue([
      {
        _id: "txn-service-count",
        transactionNumber: "POS-SERVICE-COUNT",
        total: 1000,
        paymentMethod: "cash",
        paymentMethods: ["cash"],
        cashierName: "Ada L.",
        customerName: null,
        itemCount: 2,
        serviceLineCount: 1,
        completedAt: Date.now(),
        hasTrace: false,
        sessionTraceId: null,
      },
    ]);

    render(<TransactionsView />);

    expect(screen.getByText("POS-SERVICE-COUNT")).toBeInTheDocument();
    expect(screen.getAllByText("3 items").length).toBeGreaterThan(0);
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
        terminalName: "Front counter",
      },
    });

    render(<TransactionsView />);

    expect(useQueryMock.mock.calls[0]?.[1]).toEqual({
      limit: 100,
      storeId: "store-1",
      registerSessionId: "session-1",
    });
    expect(
      screen.getByText(
        "Showing transactions linked to Front counter / Register 3 / SION-1",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "No transactions for Front counter / Register 3 / SION-1",
      ),
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
      screen.queryByText("Showing Cash transactions"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("POS-CASH-SPLIT")).toBeInTheDocument();
    expect(screen.queryByText("POS-CARD-ONLY")).not.toBeInTheDocument();
  });

  it("writes icon-only payment filter changes to route search", async () => {
    const user = userEvent.setup();
    useSearchMock.mockReturnValue({
      o: "/wigclub/store/wigclub/pos",
      page: 3,
      paymentMethod: "cash",
    });
    getActiveStoreMock.mockReturnValue({
      activeStore: {
        _id: "store-1",
        currency: "GHS",
      },
    });
    useQueryMock.mockReturnValue([]);

    render(<TransactionsView />);

    expect(
      screen.getByRole("radio", { name: "All payments" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("radio", { name: "Cash payments" }),
    ).toHaveAttribute("aria-checked", "true");
    const cardPaymentFilter = screen.getByRole("radio", {
      name: "Card payments",
    });
    expect(cardPaymentFilter).not.toHaveAttribute("title");
    expect(
      screen.getByRole("radio", { name: "Mobile money payments" }),
    ).toBeInTheDocument();

    await user.hover(cardPaymentFilter);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();

    await user.click(cardPaymentFilter);

    const [navigateOptions] = navigateMock.mock.calls.at(-1) ?? [];
    const updateSearch = navigateOptions?.search as
      | ((current: Record<string, unknown>) => Record<string, unknown>)
      | undefined;

    expect(
      updateSearch?.({
        o: "/wigclub/store/wigclub/pos",
        page: 3,
        paymentMethod: "cash",
      }),
    ).toEqual({
      o: "/wigclub/store/wigclub/pos",
      paymentMethod: "card",
    });

    await user.click(screen.getByRole("radio", { name: "All payments" }));

    const [clearNavigateOptions] = navigateMock.mock.calls.at(-1) ?? [];
    const clearSearch = clearNavigateOptions?.search as
      | ((current: Record<string, unknown>) => Record<string, unknown>)
      | undefined;

    expect(
      clearSearch?.({
        o: "/wigclub/store/wigclub/pos",
        page: 2,
        paymentMethod: "cash",
      }),
    ).toEqual({
      o: "/wigclub/store/wigclub/pos",
    });
  });

  it("uses the selected payment type in the empty state", () => {
    useSearchMock.mockReturnValue({ paymentMethod: "card" });
    getActiveStoreMock.mockReturnValue({
      activeStore: {
        _id: "store-1",
        currency: "GHS",
      },
    });
    useQueryMock.mockReturnValue([]);

    render(<TransactionsView />);

    expect(screen.getByText("No card transactions today")).toBeInTheDocument();
    expect(document.querySelector(".lucide-credit-card")).toBeInTheDocument();
    expect(document.querySelector(".lucide-receipt")).not.toBeInTheDocument();
  });

  it("uses the all-payments icon for the unfiltered empty state", () => {
    getActiveStoreMock.mockReturnValue({
      activeStore: {
        _id: "store-1",
        currency: "GHS",
      },
    });
    useQueryMock.mockReturnValue([]);

    render(<TransactionsView />);

    const walletIcons = document.querySelectorAll(".lucide-wallet-cards");

    expect(walletIcons).toHaveLength(2);
    expect(
      screen
        .getByRole("radio", { name: "All payments" })
        .querySelector(".lucide-wallet-cards"),
    ).toBeInTheDocument();
  });

  it("visually highlights the selected mobile money filter", () => {
    useSearchMock.mockReturnValue({ paymentMethod: "mobile_money" });
    getActiveStoreMock.mockReturnValue({
      activeStore: {
        _id: "store-1",
        currency: "GHS",
      },
    });
    useQueryMock.mockReturnValue([]);

    render(<TransactionsView />);

    const mobileMoneyFilter = screen.getByRole("radio", {
      name: "Mobile money payments",
    });
    expect(mobileMoneyFilter).toHaveAttribute("aria-checked", "true");
    expect(mobileMoneyFilter).toHaveClass(
      "data-[state=on]:!bg-background",
      "data-[state=on]:ring-1",
      "data-[state=on]:ring-border",
    );
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

    expect(useQueryMock.mock.calls[0]?.[1]).toEqual({
      storeId: "store-1",
      completedFrom: new Date(2026, 4, 8).getTime(),
      limit: 100,
    });
    expect(
      screen.queryByText("Showing transactions from May 8, 2026"),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "From May 8, 2026" }))
      .toBeInTheDocument();
    expect(screen.getByText("POS-MAY-08")).toBeInTheDocument();
  });

  it("uses the time range search param as the selected transaction range", () => {
    useSearchMock.mockReturnValue({
      operatingDate: "2026-05-08",
      timeRange: "all",
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
        transactionNumber: "POS-ALL-TIME",
        total: 1000,
        paymentMethod: "cash",
        paymentMethods: ["cash"],
        hasMultiplePaymentMethods: false,
        cashierName: "Ada L.",
        customerName: null,
        itemCount: 1,
        completedAt: new Date(2026, 4, 7, 10).getTime(),
        hasTrace: false,
        sessionTraceId: null,
      },
    ]);

    render(<TransactionsView />);

    expect(useQueryMock.mock.calls[0]?.[1]).toEqual({
      limit: 100,
      storeId: "store-1",
    });
    expect(screen.queryByText("Showing transactions from May 8, 2026"))
      .not.toBeInTheDocument();
    expect(screen.getByText("POS-ALL-TIME")).toBeInTheDocument();
  });

  it("does not show a filter summary on the standalone transactions view", () => {
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
      screen.queryByText("Showing Cash transactions from May 8, 2026"),
    ).not.toBeInTheDocument();
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

  it("requests an explicit bounded transaction batch for today's history", () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-06-20T15:30:00.000Z"));
    getActiveStoreMock.mockReturnValue({
      activeStore: {
        _id: "store-1",
        currency: "GHS",
      },
    });
    useQueryMock.mockReturnValue([]);

    render(<TransactionsView />);

    expect(useQueryMock.mock.calls[0]?.[1]).toEqual({
      completedFrom: new Date(2026, 5, 20).getTime(),
      limit: 100,
      storeId: "store-1",
    });
    vi.useRealTimers();
  });

  it("lets operators load another bounded transaction batch", async () => {
    const user = userEvent.setup();
    getActiveStoreMock.mockReturnValue({
      activeStore: {
        _id: "store-1",
        currency: "GHS",
      },
    });
    useQueryMock.mockReturnValue(
      Array.from({ length: 100 }, (_, index) => ({
        _id: `txn-${index}`,
        transactionNumber: `POS-${index}`,
        total: 1000,
        paymentMethod: "cash",
        paymentMethods: ["cash"],
        hasMultiplePaymentMethods: false,
        cashierName: "Ada L.",
        customerName: null,
        itemCount: 1,
        completedAt: Date.now(),
        hasTrace: false,
        sessionTraceId: null,
      })),
    );

    render(<TransactionsView />);

    expect(
      screen.getByText("Showing latest 100 completed transactions."),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Load more history" }));

    expect(useQueryMock.mock.calls.some(([, args]) => {
      return (
        typeof args === "object" &&
        args !== null &&
        "limit" in args &&
        args.limit === 200 &&
        "storeId" in args &&
        args.storeId === "store-1"
      );
    })).toBe(true);
  });

  it("uses the page search param as the completed transactions table page", () => {
    useSearchMock.mockReturnValue({ page: 2 });
    getActiveStoreMock.mockReturnValue({
      activeStore: {
        _id: "store-1",
        currency: "GHS",
      },
    });
    useQueryMock.mockReturnValue([
      {
        _id: "txn-1",
        transactionNumber: "POS-PAGE-2",
        total: 1000,
        paymentMethod: "cash",
        paymentMethods: ["cash"],
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

    expect(screen.getByTestId("transaction-table-page-index")).toHaveTextContent(
      "1",
    );
  });

  it("loads enough transaction history for the requested route page", () => {
    useSearchMock.mockReturnValue({ page: 13, timeRange: "all" });
    getActiveStoreMock.mockReturnValue({
      activeStore: {
        _id: "store-1",
        currency: "GHS",
      },
    });
    useQueryMock.mockReturnValue(
      Array.from({ length: 200 }, (_, index) => ({
        _id: `txn-${index}`,
        transactionNumber: `POS-${index}`,
        total: 1000,
        paymentMethod: "cash",
        paymentMethods: ["cash"],
        hasMultiplePaymentMethods: false,
        cashierName: "Ada L.",
        customerName: null,
        itemCount: 1,
        completedAt: Date.now(),
        hasTrace: false,
        sessionTraceId: null,
      })),
    );

    render(<TransactionsView />);

    expect(useQueryMock.mock.calls[0]?.[1]).toEqual({
      limit: 200,
      storeId: "store-1",
    });
    expect(screen.getByTestId("transaction-table-page-index")).toHaveTextContent(
      "12",
    );
  });

  it("clamps stale transaction route pages after the final loaded batch", async () => {
    useSearchMock.mockReturnValue({ page: 13, timeRange: "all" });
    getActiveStoreMock.mockReturnValue({
      activeStore: {
        _id: "store-1",
        currency: "GHS",
      },
    });
    useQueryMock.mockReturnValue(
      Array.from({ length: 100 }, (_, index) => ({
        _id: `txn-${index}`,
        transactionNumber: `POS-${index}`,
        total: 1000,
        paymentMethod: "cash",
        paymentMethods: ["cash"],
        hasMultiplePaymentMethods: false,
        cashierName: "Ada L.",
        customerName: null,
        itemCount: 1,
        completedAt: Date.now(),
        hasTrace: false,
        sessionTraceId: null,
      })),
    );

    render(<TransactionsView />);

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith({
        replace: true,
        search: expect.any(Function),
      });
    });

    const [navigateOptions] = navigateMock.mock.calls.at(-1) ?? [];
    const updateSearch = navigateOptions?.search as
      | ((current: Record<string, unknown>) => Record<string, unknown>)
      | undefined;

    expect(updateSearch?.({ page: 13, timeRange: "all" })).toEqual({
      page: 10,
      timeRange: "all",
    });
  });

  it("writes completed transactions table page changes to route search", async () => {
    const user = userEvent.setup();
    useSearchMock.mockReturnValue({ o: "/wigclub/store/wigclub/pos" });
    getActiveStoreMock.mockReturnValue({
      activeStore: {
        _id: "store-1",
        currency: "GHS",
      },
    });
    useQueryMock.mockReturnValue([
      {
        _id: "txn-1",
        transactionNumber: "POS-PAGE-1",
        total: 1000,
        paymentMethod: "cash",
        paymentMethods: ["cash"],
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

    await user.click(screen.getByRole("button", { name: "Go to table page 2" }));

    expect(navigateMock).toHaveBeenCalledWith({
      replace: true,
      search: expect.any(Function),
    });

    const [navigateOptions] = navigateMock.mock.calls.at(-1) ?? [];
    const updateSearch = navigateOptions?.search as
      | ((current: Record<string, unknown>) => Record<string, unknown>)
      | undefined;

    expect(updateSearch?.({ o: "/wigclub/store/wigclub/pos" })).toEqual({
      o: "/wigclub/store/wigclub/pos",
      page: 2,
    });
  });

  it("writes completed transactions time range changes to route search", async () => {
    const user = userEvent.setup();
    useSearchMock.mockReturnValue({
      o: "/wigclub/store/wigclub/pos",
      page: 3,
      timeRange: "today",
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
        transactionNumber: "POS-FILTER-1",
        total: 1000,
        paymentMethod: "cash",
        paymentMethods: ["cash"],
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

    await user.click(screen.getByRole("button", { name: "All Time" }));

    const [navigateOptions] = navigateMock.mock.calls.at(-1) ?? [];
    const updateSearch = navigateOptions?.search as
      | ((current: Record<string, unknown>) => Record<string, unknown>)
      | undefined;

    expect(updateSearch?.({
      o: "/wigclub/store/wigclub/pos",
      page: 3,
      timeRange: "today",
    })).toEqual({
      o: "/wigclub/store/wigclub/pos",
      timeRange: "all",
    });
  });
});
