import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const useQuery = vi.fn();
vi.mock("convex/react", () => ({
  useQuery: (...args: unknown[]) => useQuery(...args),
}));
vi.mock("@/hooks/useGetActiveStore", () => ({
  default: () => ({ activeStore: { _id: "store-1", currency: "USD" }, isLoadingStores: false }),
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

    expect(screen.getByText("profit unavailable (uncosted)")).toBeInTheDocument();
    expect(screen.getByText("$28")).toBeInTheDocument();
  });

  it("shows a loading skeleton while pending", () => {
    useQuery.mockReturnValue(undefined);
    render(<ReportsSkuDetailView {...baseProps} />);
    expect(screen.getByTestId("reports-sku-detail-loading")).toBeInTheDocument();
  });

  it("shows an empty state when the SKU has no activity in range", () => {
    useQuery.mockReturnValue(null);
    render(<ReportsSkuDetailView {...baseProps} />);
    expect(screen.getByText("No activity")).toBeInTheDocument();
  });
});
