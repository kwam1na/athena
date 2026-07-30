import { render, screen, within } from "@testing-library/react";
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
  it("discloses the item rollup refresh cadence and snapshot time", () => {
    const updatedAt = Date.UTC(2026, 6, 29, 15, 30);
    useQuery.mockReturnValue({
      rows: [],
      continueCursor: null,
      updatedAt,
    });

    render(<ReportsItemsView {...baseProps} />);

    const freshness = screen.getByTestId("report-freshness");
    expect(freshness).toHaveTextContent(
      "Report totals update about every 5 minutes",
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

  it("switches sort mode via the revenue/units toggle", async () => {
    const onSortByChange = vi.fn();
    useQuery.mockReturnValue({ rows: [], continueCursor: null });

    render(<ReportsItemsView {...baseProps} onSortByChange={onSortByChange} />);
    await userEvent.click(screen.getByRole("button", { name: "Units" }));

    expect(onSortByChange).toHaveBeenCalledWith("units");
  });

  it("groups the period and ranking controls with clear labels", () => {
    useQuery.mockReturnValue({ rows: [], continueCursor: null });

    render(<ReportsItemsView {...baseProps} />);

    const reportControls = screen.getByTestId("items-report-controls");
    expect(within(reportControls).getByText("Period")).toBeInTheDocument();
    expect(within(reportControls).getByText("Anchor date")).toBeInTheDocument();
    const periodControls = within(reportControls).getByRole("group", {
      name: "Period",
    });
    expect(
      within(periodControls).getByRole("combobox", { name: "Period type" }),
    ).toBeInTheDocument();
    expect(
      within(periodControls).getByRole("button", {
        name: /change anchor date/i,
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
});
