import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

const useQuery = vi.fn();
const useMutation = vi.fn();
vi.mock("convex/react", () => ({
  useQuery: (...args: unknown[]) => useQuery(...args),
  useMutation: (...args: unknown[]) => useMutation(...args),
}));
vi.mock("@/hooks/useGetActiveStore", () => ({
  default: () => ({ activeStore: { _id: "store-1", currency: "USD" }, isLoadingStores: false }),
}));

import { ReportCustomRangePanel } from "./ReportCustomRangePanel";

const baseProps = {
  startDate: "2026-06-01",
  endDate: "2026-07-01",
  requestKey: undefined,
  onStartDateChange: vi.fn(),
  onEndDateChange: vi.fn(),
  onRequestKeyChange: vi.fn(),
};

describe("ReportCustomRangePanel", () => {
  it("requests a range then subscribes to getRangeResult by the returned requestKey — no polling", async () => {
    const requestRange = vi.fn().mockResolvedValue({ requestKey: "req-123" });
    useMutation.mockReturnValue(requestRange);
    useQuery.mockReturnValue(undefined);
    const onRequestKeyChange = vi.fn();

    render(<ReportCustomRangePanel {...baseProps} onRequestKeyChange={onRequestKeyChange} />);
    await userEvent.click(screen.getByRole("button", { name: "Build report" }));

    expect(requestRange).toHaveBeenCalledWith({
      storeId: "store-1",
      startDate: "2026-06-01",
      endDate: "2026-07-01",
    });
    expect(onRequestKeyChange).toHaveBeenCalledWith("req-123");
  });

  it("skips getRangeResult until a requestKey exists", () => {
    useMutation.mockReturnValue(vi.fn());
    useQuery.mockReturnValue(undefined);
    render(<ReportCustomRangePanel {...baseProps} />);
    expect(useQuery).toHaveBeenCalledWith(expect.anything(), "skip");
  });

  it("renders the pending state", () => {
    useMutation.mockReturnValue(vi.fn());
    useQuery.mockReturnValue({
      requestKey: "req-123",
      startDate: "2026-06-01",
      endDate: "2026-07-01",
      status: "pending",
      expiresAt: 0,
    });
    render(<ReportCustomRangePanel {...baseProps} requestKey="req-123" />);
    expect(screen.getByRole("status")).toHaveTextContent("Building report");
  });

  it("renders the failed state", () => {
    useMutation.mockReturnValue(vi.fn());
    useQuery.mockReturnValue({
      requestKey: "req-123",
      startDate: "2026-06-01",
      endDate: "2026-07-01",
      status: "failed",
      failureReason: "Range too large",
      expiresAt: 0,
    });
    render(<ReportCustomRangePanel {...baseProps} requestKey="req-123" />);
    expect(screen.getByRole("alert")).toHaveTextContent("Range too large");
  });

  it("renders totals and top SKUs on completion", () => {
    useMutation.mockReturnValue(vi.fn());
    useQuery.mockReturnValue({
      requestKey: "req-123",
      startDate: "2026-06-01",
      endDate: "2026-07-01",
      status: "completed",
      expiresAt: 0,
      totals: {
        grossSalesMinor: 10000,
        netSalesMinor: 9000,
        refundsMinor: 1000,
        unitsSold: 42,
        unitsReturned: 1,
        uncostedRevenueMinor: 0,
        grossProfitMinor: null,
        paymentsCollectedMinor: 9000,
        paymentsRefundedMinor: 1000,
        paymentAllocatedMinor: 9000,
        dayCount: 30,
        unsettledDayCount: 0,
      },
      topSkus: [
        {
          productSkuId: "sku-1",
          periodKey: "custom",
          unitsSold: 10,
          unitsReturned: 0,
          grossSalesMinor: 5000,
          netSalesMinor: 4500,
          refundsMinor: 500,
          uncostedRevenueMinor: 0,
          grossProfitMinor: 1200,
        },
      ],
    });
    render(<ReportCustomRangePanel {...baseProps} requestKey="req-123" />);

    expect(screen.getByTestId("report-custom-range-completed")).toHaveTextContent("$90");
    // Value slot holds an em dash; the reason is not repeated per row.
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
    expect(screen.getByText("sku-1")).toBeInTheDocument();
  });
});
