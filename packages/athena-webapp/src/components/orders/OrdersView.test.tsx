import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AnchorHTMLAttributes } from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getActiveStoreMock = vi.fn();

vi.mock("@/hooks/useGetActiveStore", () => ({
  default: () => getActiveStoreMock(),
}));

vi.mock("~/src/hooks/useSharedDemoContext", () => ({
  useSharedDemoContext: () => null,
}));

vi.mock("~/src/hooks/usePermissions", () => ({
  usePermissions: () => ({
    hasFinancialDetailsAccess: true,
    isLoading: false,
    role: "full_admin",
  }),
}));

// The metrics panel runs its own Convex query and renders a different money
// surface; the list totals are what this file covers.
vi.mock("./OrderMetricsPanel", () => ({
  default: () => null,
}));

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@tanstack/react-router")>();

  return {
    ...actual,
    Link: ({
      children,
      to,
    }: AnchorHTMLAttributes<HTMLAnchorElement> & {
      params?: unknown;
      search?: unknown;
      to: string;
    }) => <a href={to}>{children}</a>,
  };
});

import { useQuery } from "convex/react";

import OrdersView from "./OrdersView";

const source = readFileSync(
  join(process.cwd(), "src/components/orders/OrdersView.tsx"),
  "utf8",
);

describe("OrdersView status workspaces", () => {
  it("shows each status workspace across the full order history by default", () => {
    expect(source).toContain('const initialTimeRange: TimeRange = "all";');
  });
});

describe("OrdersView row totals", () => {
  const order = (overrides: Record<string, unknown>) => ({
    _creationTime: 1_700_000_000_000,
    _id: "order_1",
    amount: 150000,
    customerDetails: { email: "customer@osustudio.com" },
    deliveryFee: 0,
    deliveryMethod: "pickup",
    hasVerifiedPayment: true,
    items: [{ price: 150000, productSkuId: "sku_1", quantity: 1 }],
    orderNumber: "1001",
    paymentMethod: { channel: "card", type: "card" },
    status: "open",
    storeFrontUserId: "user_1",
    ...overrides,
  });

  const renderOrders = (orders: Array<Record<string, unknown>>) => {
    getActiveStoreMock.mockReturnValue({
      activeStore: { _id: "store_1", currency: "GHS" },
    });
    vi.mocked(useQuery).mockReturnValue(orders);

    return render(<OrdersView status="all" />);
  };

  beforeEach(() => {
    getActiveStoreMock.mockReset();
    vi.mocked(useQuery).mockReset();
    window.history.replaceState({}, "", "/org/store/store/orders/all");
  });

  // The table body only mounts once the faceted filters report loaded, which
  // they do from a `setTimeout(0)`, so the first assertion has to wait.
  it("renders the gross total for an order with no discount", async () => {
    renderOrders([order({})]);

    expect(await screen.findByText("GH₵1,500")).toBeVisible();
  });

  it("renders the discounted net total in the row for a discounted order", async () => {
    // The list column is `getAmountPaidForOrder` divided by 100 and formatted:
    // GH₵1,500 less a 10% discount is GH₵1,350. A row showing the gross
    // GH₵1,500, or the 100x-inflated discount the old local helper produced,
    // fails here.
    renderOrders([
      order({
        discount: {
          code: "SAVE10",
          span: "entire-order",
          type: "percentage",
          value: 10,
        },
      }),
    ]);

    expect(await screen.findByText("GH₵1,350")).toBeVisible();
    expect(screen.queryByText("GH₵1,500")).toBeNull();
  });
});
