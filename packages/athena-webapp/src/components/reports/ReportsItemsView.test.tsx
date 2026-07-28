import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

const useQuery = vi.fn();
vi.mock("convex/react", () => ({
  useQuery: (...args: unknown[]) => useQuery(...args),
}));
vi.mock("@/hooks/useGetActiveStore", () => ({
  default: () => ({ activeStore: { _id: "store-1", currency: "USD" }, isLoadingStores: false }),
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to, ...props }: { children?: React.ReactNode; to: string }) => {
    delete (props as Record<string, unknown>).params;
    return (
      <a href={to} {...props}>
        {children}
      </a>
    );
  },
  useParams: () => ({ orgUrlSlug: "acme", storeUrlSlug: "downtown" }),
}));

import { ReportsItemsView } from "./ReportsItemsView";

const baseProps = {
  periodType: "day" as const,
  periodDate: "2026-07-28",
  sortBy: "revenue" as const,
  cursor: undefined,
  onPeriodTypeChange: vi.fn(),
  onPeriodDateChange: vi.fn(),
  onSortByChange: vi.fn(),
  onCursorChange: vi.fn(),
};

describe("ReportsItemsView", () => {
  it("queries listPeriodSkus with a d: period key built via the contract helper", () => {
    useQuery.mockReturnValue({ rows: [], continueCursor: null });
    render(<ReportsItemsView {...baseProps} />);

    expect(useQuery).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ periodKey: "d:2026-07-28", sortBy: "revenue" }),
    );
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

    await userEvent.click(screen.getByRole("button", { name: "Next page" }));

    expect(onCursorChange).toHaveBeenCalledWith("cursor-page-2");
  });

  it("switches sort mode via the revenue/units toggle", async () => {
    const onSortByChange = vi.fn();
    useQuery.mockReturnValue({ rows: [], continueCursor: null });

    render(<ReportsItemsView {...baseProps} onSortByChange={onSortByChange} />);
    await userEvent.click(screen.getByRole("button", { name: "Units" }));

    expect(onSortByChange).toHaveBeenCalledWith("units");
  });
});
