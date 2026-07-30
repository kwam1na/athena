import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

const useQuery = vi.fn();
const navigateBackMock = vi.fn();
const search = { current: {} as Record<string, unknown> };
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
  useSearch: () => search.current,
  useParams: () => ({ orgUrlSlug: "acme", storeUrlSlug: "downtown" }),
  Link: ({
    children,
    to,
    ...props
  }: {
    children?: React.ReactNode;
    to: string;
  }) => {
    delete (props as Record<string, unknown>).params;
    delete (props as Record<string, unknown>).search;
    return (
      <a href={to} {...props}>
        {children}
      </a>
    );
  },
}));

import { ReportsSkuDetailView } from "./ReportsSkuDetailView";

const baseProps = {
  productSkuId: "sku-1",
  startDate: "2026-06-29",
  endDate: "2026-07-28",
  onRangeChange: vi.fn(),
  onPageChange: vi.fn(),
  page: 1,
};

describe("ReportsSkuDetailView", () => {
  it("separates report identity from the explicit product action", () => {
    useQuery.mockReturnValue({
      days: [],
      totals: null,
      identity: {
        displayName: "oshe",
        sku: "6N2Y-JY3-5G6",
        productId: "product-9",
      },
    });
    render(<ReportsSkuDetailView {...baseProps} />);

    expect(screen.getByText("Product report")).toBeInTheDocument();
    const periodButton = screen.getByRole("button", {
      name: "Change reporting period, currently Jun 29–Jul 28, 2026",
    });
    expect(
      within(periodButton).getByText("Reporting period"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /change start date/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 2, name: "Oshe" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Oshe" }),
    ).not.toBeInTheDocument();

    const link = screen.getByRole("link", { name: "View product" });
    expect(link).toHaveAttribute(
      "href",
      "/$orgUrlSlug/store/$storeUrlSlug/products/$productSlug",
    );
  });

  it("includes the weekday in a single-day reporting period", () => {
    useQuery.mockReturnValue({
      days: [],
      totals: null,
      identity: {
        displayName: "forgiveness",
        sku: "6N2Y-PP9-DY",
      },
    });

    render(
      <ReportsSkuDetailView
        {...baseProps}
        startDate="2026-07-29"
        endDate="2026-07-29"
      />,
    );

    expect(
      screen.getByRole("button", {
        name: "Change reporting period, currently Wed, Jul 29, 2026",
      }),
    ).toBeInTheDocument();
  });

  it("omits the product action when the owning product is unknown", () => {
    useQuery.mockReturnValue({
      days: [],
      totals: null,
      identity: { displayName: "oshe", sku: "6N2Y-JY3-5G6" },
    });
    render(<ReportsSkuDetailView {...baseProps} />);

    expect(
      screen.queryByRole("link", { name: "View product" }),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("reports-sku-detail-name")).toHaveTextContent(
      "Oshe",
    );
  });

  it("offers a way back only when the caller supplied an origin", () => {
    useQuery.mockReturnValue({ days: [], totals: null, identity: undefined });

    search.current = {};
    const { unmount } = render(<ReportsSkuDetailView {...baseProps} />);
    expect(
      screen.queryByRole("button", { name: /back to items/i }),
    ).not.toBeInTheDocument();
    unmount();

    search.current = {
      o: encodeURIComponent("/acme/store/downtown/reports/items"),
    };
    render(<ReportsSkuDetailView {...baseProps} />);
    expect(
      screen.getByRole("button", { name: /back to items/i }),
    ).toBeInTheDocument();

    search.current = {};
  });

  it("names the SKU in the header, normalized, with its code beneath", () => {
    useQuery.mockReturnValue({
      days: [],
      totals: null,
      identity: { displayName: "oshe", sku: "6N2Y-JY3-5G6", size: "500ml" },
    });
    render(<ReportsSkuDetailView {...baseProps} />);

    expect(screen.getByTestId("reports-sku-detail-name")).toHaveTextContent(
      "Oshe",
    );
    expect(screen.getByText("6N2Y-JY3-5G6 · 500ml")).toBeInTheDocument();
  });

  it("renders day rows and totals", () => {
    useQuery.mockReturnValue({
      days: [
        {
          operatingDate: "2026-07-27",
          productSkuId: "sku-1",
          periodKey: "d:2026-07-27",
          unitsSold: 3,
          unitsReturned: 0,
          grossSalesMinor: 2000,
          netSalesMinor: 1900,
          refundsMinor: 100,
          uncostedRevenueMinor: 0,
          grossProfitMinor: 900,
        },
      ],
      totals: {
        productSkuId: "sku-1",
        periodKey: "d:2026-07-27",
        unitsSold: 3,
        unitsReturned: 0,
        grossSalesMinor: 3000,
        netSalesMinor: 2800,
        refundsMinor: 200,
        uncostedRevenueMinor: 0,
        grossProfitMinor: null,
      },
    });

    render(<ReportsSkuDetailView {...baseProps} />);

    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
    expect(screen.getByText("$28")).toBeInTheDocument();
  });

  it("sorts daily activity newest first before paginating in ten-row pages", async () => {
    const user = userEvent.setup();
    const onPageChange = vi.fn();
    useQuery.mockReturnValue({
      days: Array.from({ length: 12 }, (_, index) => ({
        operatingDate: `2026-07-${String(index + 1).padStart(2, "0")}`,
        unitsSold: 1,
        netSalesMinor: 100,
        refundsMinor: 0,
        grossProfitMinor: null,
      })),
      totals: null,
      identity: undefined,
    });

    const { rerender } = render(
      <ReportsSkuDetailView {...baseProps} onPageChange={onPageChange} />,
    );

    expect(screen.getByText("Showing 1-10 of 12")).toBeInTheDocument();
    expect(screen.getByText("Page 1 of 2")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Date" })).toHaveAttribute(
      "aria-sort",
      "descending",
    );
    expect(screen.getByText("Sun, Jul 12, 2026")).toBeInTheDocument();
    expect(screen.queryByText("Thu, Jul 2, 2026")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Go to next page" }));
    expect(onPageChange).toHaveBeenCalledWith(2);

    rerender(
      <ReportsSkuDetailView
        {...baseProps}
        onPageChange={onPageChange}
        page={2}
      />,
    );
    expect(screen.getByText("Showing 11-12 of 12")).toBeInTheDocument();
    expect(screen.getByText("Page 2 of 2")).toBeInTheDocument();
    expect(screen.getByText("Thu, Jul 2, 2026")).toBeInTheDocument();
    expect(screen.getByText("Wed, Jul 1, 2026")).toBeInTheDocument();
    expect(screen.queryByText("Sun, Jul 12, 2026")).not.toBeInTheDocument();
  });

  it("renders nothing until the first result settles", () => {
    useQuery.mockReturnValue(undefined);
    render(<ReportsSkuDetailView {...baseProps} />);
    expect(
      screen.queryByTestId("reports-sku-detail-loading"),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("shows an empty state when the SKU has no activity in range", () => {
    useQuery.mockReturnValue(null);
    render(<ReportsSkuDetailView {...baseProps} />);
    expect(screen.getByText("No activity")).toBeInTheDocument();
  });
});
