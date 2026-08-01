import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

const useQuery = vi.fn();
const navigateBackMock = vi.fn();
const search = { current: {} as Record<string, unknown> };
const renderedLinkSearches: unknown[] = [];
vi.mock("convex/react", () => ({
  useQuery: (...args: unknown[]) => useQuery(...args),
}));
vi.mock("@/hooks/useGetActiveStore", () => ({
  default: () => ({
    activeStore: { _id: "store-1", currency: "USD" },
    isLoadingStores: false,
  }),
}));
vi.mock("@/hooks/use-navigate-back", () => ({
  useNavigateBack: () => navigateBackMock,
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    search: linkSearch,
    to,
    ...props
  }: {
    children?: React.ReactNode;
    search?: unknown;
    to: string;
  }) => {
    delete (props as Record<string, unknown>).params;
    renderedLinkSearches.push(linkSearch);
    return (
      <a href={to} {...props}>
        {children}
      </a>
    );
  },
  useParams: () => ({ orgUrlSlug: "acme", storeUrlSlug: "downtown" }),
  useSearch: () => search.current,
}));

import { ReportsItemsView } from "./ReportsItemsView";

const baseProps = {
  periodType: "day" as const,
  periodDate: "2026-07-28",
  sortBy: "revenue" as const,
  cursor: undefined,
  cursorTrail: [],
  onPeriodTypeChange: vi.fn(),
  onPeriodDateChange: vi.fn(),
  onSortByChange: vi.fn(),
  onCursorChange: vi.fn(),
};

describe("ReportsItemsView", () => {
  it("shows total units sold for the selected period", () => {
    useQuery.mockReturnValue({
      rows: [
        {
          productSkuId: "sku-1",
          periodKey: "d:2026-07-28",
          unitsSold: 16,
          unitsReturned: 0,
          grossSalesMinor: 1600,
          netSalesMinor: 1600,
          refundsMinor: 0,
          uncostedRevenueMinor: 0,
          grossProfitMinor: 800,
        },
      ],
      continueCursor: null,
      totalNetSalesMinor: 1600,
      totalUnitsSold: 16,
      totalTransactions: 7,
      updatedAt: null,
    });

    render(<ReportsItemsView {...baseProps} />);

    const total = screen.getByTestId("items-period-units-sold");
    expect(within(total).getByText("Units sold")).toBeInTheDocument();
    expect(
      within(total).getByTestId("items-period-units-number"),
    ).toHaveAttribute("data-value", "16");
    const transactions = screen.getByTestId("items-period-transactions");
    expect(
      within(transactions).getByText("Transactions"),
    ).toBeInTheDocument();
    expect(
      within(transactions).getByTestId("items-period-transactions-number"),
    ).toHaveAttribute("data-value", "7");
    const netSales = screen.getByTestId("items-period-net-sales");
    expect(within(netSales).getByText("Net sales")).toBeInTheDocument();
    expect(within(netSales).getByText("$16")).toBeInTheDocument();
    const workspace = screen.getByTestId("items-report-workspace");
    expect(workspace).toContainElement(total);
    expect(workspace).not.toContainElement(screen.getByRole("table"));
  });

  it("flips both period totals when refreshed values settle", () => {
    let result = {
      rows: [
        {
          productSkuId: "sku-1",
          periodKey: "w:2026-W31",
          unitsSold: 16,
          unitsReturned: 0,
          grossSalesMinor: 1600,
          netSalesMinor: 1600,
          refundsMinor: 0,
          uncostedRevenueMinor: 0,
          grossProfitMinor: 800,
        },
      ],
      continueCursor: null,
      totalUnitsSold: 16,
      totalTransactions: 7,
      updatedAt: null,
    };
    useQuery.mockImplementation(() => result);

    const { rerender } = render(
      <ReportsItemsView {...baseProps} periodType="week" />,
    );

    result = {
      ...result,
      totalUnitsSold: 711,
      totalTransactions: 248,
    };
    rerender(<ReportsItemsView {...baseProps} periodType="month" />);

    expect(screen.getByTestId("items-period-units-number")).toHaveAttribute(
      "data-value",
      "711",
    );
    expect(
      screen.getByTestId("items-period-transactions-number"),
    ).toHaveAttribute("data-value", "248");
  });

  it("does not show the period summary when there is no SKU activity", () => {
    useQuery.mockReturnValue({
      rows: [],
      continueCursor: null,
      totalUnitsSold: 0,
      totalTransactions: 0,
      updatedAt: null,
    });

    render(<ReportsItemsView {...baseProps} />);

    expect(
      screen.queryByTestId("items-period-units-sold"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("items-period-transactions"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("items-period-metrics-reserved")).toHaveClass(
      "invisible",
    );
    expect(screen.getByText("No item sales")).toBeInTheDocument();
  });

  it("discloses the item rollup processing delay and snapshot time", () => {
    const updatedAt = Date.UTC(2026, 6, 29, 15, 30);
    useQuery.mockReturnValue({
      rows: [],
      continueCursor: null,
      updatedAt,
    });

    render(<ReportsItemsView {...baseProps} />);

    const freshness = screen.getByTestId("report-freshness");
    expect(freshness).toHaveTextContent(
      "Day totals update first. Item data may take about 5 minutes to catch up.",
    );
    expect(freshness).not.toHaveTextContent(
      "New activity may take about 5 minutes to appear",
    );
    expect(freshness.querySelector("time")).toHaveAttribute(
      "datetime",
      new Date(updatedAt).toISOString(),
    );
  });

  it("queries listPeriodSkus with a d: period key built via the contract helper", () => {
    useQuery.mockReturnValue({ rows: [], continueCursor: null });
    render(<ReportsItemsView {...baseProps} />);

    expect(useQuery).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ periodKey: "d:2026-07-28", sortBy: "revenue" }),
    );
  });

  it("identifies a SKU by product name with its code beneath", () => {
    useQuery.mockReturnValue({
      rows: [
        {
          productSkuId: "kx70hda5jszy8a9c8eg04wb39188g5g6",
          periodKey: "d:2026-07-28",
          identity: {
            displayName: "bottle water",
            sku: "6N2Y-Y4Q-95V",
            size: "500ml",
          },
          unitsSold: 3,
          unitsReturned: 0,
          grossSalesMinor: 3600,
          netSalesMinor: 3600,
          refundsMinor: 0,
          uncostedRevenueMinor: 0,
          grossProfitMinor: null,
        },
      ],
      continueCursor: null,
    });
    render(<ReportsItemsView {...baseProps} />);

    // Operator-entered names are normalized for display.
    expect(screen.getByText("Bottle Water")).toBeInTheDocument();
    // The code disambiguates same-named SKUs, so it is always shown.
    expect(screen.getByText("6N2Y-Y4Q-95V · 500ml")).toBeInTheDocument();
    expect(
      screen.queryByText("kx70hda5jszy8a9c8eg04wb39188g5g6"),
    ).not.toBeInTheDocument();
  });

  it("carries the selected reporting period into SKU detail links", () => {
    useQuery.mockReturnValue({
      rows: [
        {
          productSkuId: "sku-1",
          periodKey: "d:2026-07-28",
          unitsSold: 1,
          unitsReturned: 0,
          grossSalesMinor: 100,
          netSalesMinor: 100,
          refundsMinor: 0,
          uncostedRevenueMinor: 0,
          grossProfitMinor: 50,
        },
      ],
      continueCursor: null,
    });

    render(<ReportsItemsView {...baseProps} />);

    expect(renderedLinkSearches).toContainEqual(
      expect.objectContaining({
        periodType: "day",
        periodDate: "2026-07-28",
      }),
    );
  });

  it("falls back to the id when the SKU record is gone", () => {
    useQuery.mockReturnValue({
      rows: [
        {
          productSkuId: "sku-deleted",
          periodKey: "d:2026-07-28",
          unitsSold: 1,
          unitsReturned: 0,
          grossSalesMinor: 100,
          netSalesMinor: 100,
          refundsMinor: 0,
          uncostedRevenueMinor: 0,
          grossProfitMinor: null,
        },
      ],
      continueCursor: null,
    });
    render(<ReportsItemsView {...baseProps} />);

    // The row survives: a fact outlives its subject, and dropping it would
    // understate the period.
    expect(screen.getAllByText("sku-deleted").length).toBeGreaterThan(0);
  });

  it("offers a way back only when a caller supplied an origin", async () => {
    const user = userEvent.setup();
    useQuery.mockReturnValue({ rows: [], continueCursor: null });

    search.current = {};
    const { unmount } = render(<ReportsItemsView {...baseProps} />);
    expect(
      screen.queryByRole("button", { name: /back/i }),
    ).not.toBeInTheDocument();
    unmount();

    search.current = { o: encodeURIComponent("/acme/store/downtown/reports") };
    render(<ReportsItemsView {...baseProps} />);
    await user.click(screen.getByRole("button", { name: /back/i }));
    expect(navigateBackMock).toHaveBeenCalled();

    search.current = {};
  });

  it("requests the next cursor when paginating", async () => {
    const onCursorChange = vi.fn();
    useQuery.mockReturnValue({
      rows: [
        {
          productSkuId: "sku-1",
          periodKey: "d:2026-07-28",
          unitsSold: 4,
          unitsReturned: 0,
          grossSalesMinor: 4000,
          netSalesMinor: 3800,
          refundsMinor: 200,
          uncostedRevenueMinor: 0,
          grossProfitMinor: 1200,
        },
      ],
      continueCursor: "cursor-page-2",
    });

    render(<ReportsItemsView {...baseProps} onCursorChange={onCursorChange} />);

    await userEvent.click(
      screen.getByRole("button", { name: "Go to next page" }),
    );

    expect(onCursorChange).toHaveBeenCalledWith("cursor-page-2", []);
  });

  it("uses the cursor trail to return to the previous page", async () => {
    const onCursorChange = vi.fn();
    useQuery.mockReturnValue({
      rows: [
        {
          productSkuId: "sku-21",
          periodKey: "d:2026-07-28",
          unitsSold: 1,
          unitsReturned: 0,
          grossSalesMinor: 100,
          netSalesMinor: 100,
          refundsMinor: 0,
          uncostedRevenueMinor: 0,
          grossProfitMinor: 50,
        },
      ],
      continueCursor: null,
    });

    render(
      <ReportsItemsView
        {...baseProps}
        cursor="cursor-page-3"
        cursorTrail={["cursor-page-2"]}
        onCursorChange={onCursorChange}
      />,
    );

    expect(screen.getByText("Showing 21-21")).toBeInTheDocument();
    expect(screen.getByText("Page 3")).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "Go to previous page" }),
    );

    expect(onCursorChange).toHaveBeenCalledWith("cursor-page-2", []);
  });

  it("switches sort mode via the revenue/units sold toggle", async () => {
    const onSortByChange = vi.fn();
    useQuery.mockReturnValue({ rows: [], continueCursor: null });

    render(<ReportsItemsView {...baseProps} onSortByChange={onSortByChange} />);
    await userEvent.click(
      screen.getByRole("button", { name: "Units sold" }),
    );

    expect(onSortByChange).toHaveBeenCalledWith("units");
  });

  it("groups the period and ranking controls with clear labels", () => {
    useQuery.mockReturnValue({ rows: [], continueCursor: null });

    render(<ReportsItemsView {...baseProps} />);

    const reportControls = screen.getByTestId("items-report-controls");
    expect(within(reportControls).getByText("Period")).toBeInTheDocument();
    expect(within(reportControls).getByText("Date")).toBeInTheDocument();
    const periodControls = within(reportControls).getByRole("group", {
      name: "Period",
    });
    expect(
      within(periodControls).getByRole("combobox", { name: "Period type" }),
    ).toBeInTheDocument();
    expect(
      within(periodControls).getByRole("button", {
        name: /change date/i,
      }),
    ).toBeInTheDocument();

    const rankingControls = within(reportControls).getByRole("group", {
      name: "Rank by",
    });
    const selectedRank = within(rankingControls).getByRole("button", {
      name: "Revenue",
    });
    expect(selectedRank).toHaveAttribute("aria-pressed", "true");
    expect(selectedRank).toHaveClass(
      "border-primary-border",
      "bg-primary-soft",
      "text-primary",
    );
  });

  it("separates period performance from the SKU results table", () => {
    useQuery.mockReturnValue({
      rows: [
        {
          productSkuId: "sku-1",
          periodKey: "d:2026-07-28",
          unitsSold: 1,
          unitsReturned: 0,
          grossSalesMinor: 100,
          netSalesMinor: 100,
          refundsMinor: 0,
          uncostedRevenueMinor: 0,
          grossProfitMinor: 50,
        },
      ],
      continueCursor: null,
      totalUnitsSold: 1,
      totalTransactions: 1,
      updatedAt: Date.UTC(2026, 6, 28, 12),
    });

    render(<ReportsItemsView {...baseProps} />);

    const performance = screen.getByRole("region", {
      name: "Item sales",
    });
    expect(performance).toHaveTextContent(
      "Choose a reporting period and rank items by revenue or units sold.",
    );
    const results = screen.getByRole("region", {
      name: "Item sales results",
    });
    expect(performance).toContainElement(
      screen.getByTestId("items-report-controls"),
    );
    expect(performance).toContainElement(
      screen.getByTestId("items-period-units-sold"),
    );
    expect(performance).toContainElement(screen.getByTestId("report-freshness"));
    expect(performance).not.toContainElement(screen.getByRole("table"));
    expect(results).toContainElement(screen.getByRole("table"));
  });

  it("uses the shared animated data surface for full and empty states", async () => {
    let result = {
      rows: [
        {
          productSkuId: "sku-1",
          periodKey: "d:2026-07-28",
          unitsSold: 1,
          unitsReturned: 0,
          grossSalesMinor: 100,
          netSalesMinor: 100,
          refundsMinor: 0,
          uncostedRevenueMinor: 0,
          grossProfitMinor: 50,
        },
      ],
      continueCursor: null,
      totalUnitsSold: 1,
      totalTransactions: 1,
      updatedAt: null,
    };
    useQuery.mockImplementation(() => result);

    const { rerender } = render(<ReportsItemsView {...baseProps} />);

    const resultsState = screen.getByTestId("items-results-state");
    expect(resultsState).toHaveAttribute("data-state", "data");
    expect(resultsState).toHaveAttribute("data-motion", "data-state");
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(resultsState).toContainElement(screen.getByRole("table"));
    expect(resultsState).not.toContainElement(
      screen.getByTestId("items-period-units-sold"),
    );

    result = {
      ...result,
      rows: [],
      totalUnitsSold: 0,
      totalTransactions: 0,
    };
    rerender(<ReportsItemsView {...baseProps} periodDate="2026-07-24" />);

    expect(resultsState).toHaveAttribute("data-state", "empty");
    await waitFor(() => {
      expect(screen.getByText("No item sales")).toBeInTheDocument();
      expect(
        screen.queryByTestId("items-period-units-sold"),
      ).not.toBeInTheDocument();
      expect(screen.queryByRole("table")).not.toBeInTheDocument();
    });

    result = {
      ...result,
      rows: [
        {
          productSkuId: "sku-1",
          periodKey: "d:2026-07-28",
          unitsSold: 1,
          unitsReturned: 0,
          grossSalesMinor: 100,
          netSalesMinor: 100,
          refundsMinor: 0,
          uncostedRevenueMinor: 0,
          grossProfitMinor: 50,
        },
      ],
      totalUnitsSold: 1,
      totalTransactions: 1,
    };
    rerender(<ReportsItemsView {...baseProps} />);

    expect(resultsState).toHaveAttribute("data-state", "data");
    await waitFor(() => {
      expect(screen.getByRole("table")).toBeInTheDocument();
      expect(screen.queryByText("No item sales")).not.toBeInTheDocument();
    });
  });

  it("communicates the resolved month range near the period controls", () => {
    useQuery.mockReturnValue({ rows: [], continueCursor: null });

    render(
      <ReportsItemsView
        {...baseProps}
        periodDate="2026-07-18"
        periodType="month"
      />,
    );

    expect(screen.getByTestId("items-period-range")).toHaveTextContent(
      "Reporting range Wed, Jul 1–Fri, Jul 31, 2026",
    );
  });

  it("communicates the resolved ISO week range near the period controls", () => {
    useQuery.mockReturnValue({ rows: [], continueCursor: null });

    render(
      <ReportsItemsView
        {...baseProps}
        periodDate="2026-07-18"
        periodType="week"
      />,
    );

    expect(screen.getByTestId("items-period-range")).toHaveTextContent(
      "Reporting range Mon, Jul 13–Sun, Jul 19, 2026",
    );
  });

  it("smoothly reveals and collapses the range outside day periods", () => {
    useQuery.mockReturnValue({ rows: [], continueCursor: null });

    const { rerender } = render(<ReportsItemsView {...baseProps} />);

    const periodRange = screen.getByTestId("items-period-range");
    expect(periodRange).toHaveAttribute("aria-hidden", "true");
    expect(periodRange).toHaveClass("grid-rows-[0fr]", "opacity-0");

    rerender(
      <ReportsItemsView
        {...baseProps}
        periodDate="2026-07-18"
        periodType="week"
      />,
    );

    expect(periodRange).not.toHaveAttribute("aria-hidden");
    expect(periodRange).toHaveClass("grid-rows-[1fr]", "opacity-100");

    rerender(<ReportsItemsView {...baseProps} />);

    expect(periodRange).toHaveAttribute("aria-hidden", "true");
    expect(periodRange).toHaveClass("grid-rows-[0fr]", "opacity-0");
  });
});
