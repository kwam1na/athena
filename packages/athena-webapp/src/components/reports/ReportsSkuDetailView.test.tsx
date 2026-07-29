import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const useQuery = vi.fn();
const navigateBackMock = vi.fn();
const search = { current: {} as Record<string, unknown> };
vi.mock("convex/react", () => ({
  useQuery: (...args: unknown[]) => useQuery(...args),
}));
vi.mock("@/hooks/useGetActiveStore", () => ({
  default: () => ({ activeStore: { _id: "store-1", currency: "USD" }, isLoadingStores: false }),
}));
vi.mock("@/hooks/use-navigate-back", () => ({
  useNavigateBack: () => navigateBackMock,
}));
vi.mock("@tanstack/react-router", () => ({
  useSearch: () => search.current,
  useParams: () => ({ orgUrlSlug: "acme", storeUrlSlug: "downtown" }),
  Link: ({ children, to, ...props }: { children?: React.ReactNode; to: string }) => {
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
  onStartDateChange: vi.fn(),
  onEndDateChange: vi.fn(),
};

describe("ReportsSkuDetailView", () => {
  it("links the product name out to its product page, carrying the origin", () => {
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

    const link = screen.getByRole("link", { name: /oshe/i });
    expect(link).toHaveAttribute(
      "href",
      "/$orgUrlSlug/store/$storeUrlSlug/products/$productSlug",
    );
  });

  it("leaves the name unlinked when the owning product is unknown", () => {
    useQuery.mockReturnValue({
      days: [],
      totals: null,
      identity: { displayName: "oshe", sku: "6N2Y-JY3-5G6" },
    });
    render(<ReportsSkuDetailView {...baseProps} />);

    expect(screen.queryByRole("link", { name: /oshe/i })).not.toBeInTheDocument();
    expect(screen.getByTestId("reports-sku-detail-name")).toHaveTextContent("Oshe");
  });

  it("offers a way back only when the caller supplied an origin", () => {
    useQuery.mockReturnValue({ days: [], totals: null, identity: undefined });

    search.current = {};
    const { unmount } = render(<ReportsSkuDetailView {...baseProps} />);
    expect(
      screen.queryByRole("button", { name: /back to items/i }),
    ).not.toBeInTheDocument();
    unmount();

    search.current = { o: encodeURIComponent("/acme/store/downtown/reports/items") };
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
