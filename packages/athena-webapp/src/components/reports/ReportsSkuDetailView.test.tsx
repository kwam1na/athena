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
    search,
    ...props
  }: {
    children?: React.ReactNode;
    search?: Record<string, string | undefined>;
    to: string;
  }) => {
    delete (props as Record<string, unknown>).params;
    const searchParams = new URLSearchParams();
    Object.entries(search ?? {}).forEach(([key, value]) => {
      if (value !== undefined) searchParams.set(key, value);
    });
    const href = searchParams.size > 0 ? `${to}?${searchParams}` : to;
    return (
      <a href={href} {...props}>
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
  onTransactionDateChange: vi.fn(),
  page: 1,
};

describe("ReportsSkuDetailView", () => {
  it("lets the product identity stand on its own", () => {
    useQuery.mockReturnValue({
      days: [],
      totals: null,
      identity: {
        displayName: "oshe",
        sku: "6N2Y-JY3-5G6",
        netPriceMinor: 12_500,
        unitCostMinor: 7_250,
        productId: "product-9",
        imageUrl: "https://cdn.example.test/oshe.webp",
      },
    });
    render(<ReportsSkuDetailView {...baseProps} />);

    expect(screen.queryByText("Product report")).not.toBeInTheDocument();
    const periodButton = screen.getByRole("button", {
      name: "Change reporting period, currently Jun 29–Jul 28, 2026",
    });
    const reportSummary = screen.getByTestId("reports-sku-summary");
    expect(
      within(reportSummary).getByRole("button", {
        name: "Change reporting period, currently Jun 29–Jul 28, 2026",
      }),
    ).toBe(periodButton);
    expect(within(reportSummary).getByText("Net sales")).toBeInTheDocument();
    expect(
      within(periodButton).getByText("Reporting period"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /change start date/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 2, name: "Oshe" }),
    ).toBeInTheDocument();
    expect(screen.getByText("SKU")).toBeInTheDocument();
    expect(screen.getByText("Net price")).toBeInTheDocument();
    expect(screen.getByText("$125")).toBeInTheDocument();
    expect(screen.getByText("Unit cost")).toBeInTheDocument();
    expect(screen.getByText("$72.50")).toBeInTheDocument();
    expect(screen.getByText("Unit margin")).toBeInTheDocument();
    expect(screen.getByText("$52.50")).toBeInTheDocument();
    const primaryIdentity = screen.getByTestId("reports-sku-primary-identity");
    expect(
      within(primaryIdentity).getByRole("heading", { name: "Oshe" }),
    ).toBeInTheDocument();
    expect(within(primaryIdentity).queryByText("SKU")).not.toBeInTheDocument();
    expect(within(primaryIdentity).queryByText("Net price")).not.toBeInTheDocument();

    const details = screen.getByTestId("reports-sku-details");
    expect(within(details).getByText("SKU")).toBeInTheDocument();
    expect(within(details).getByText("6N2Y-JY3-5G6")).toBeInTheDocument();
    expect(details).toHaveClass("space-y-layout-xs");

    const pricing = screen.getByRole("group", { name: "Pricing" });
    expect(within(pricing).getByText("Net price")).toBeInTheDocument();
    expect(within(pricing).getByText("Unit cost")).toBeInTheDocument();
    expect(within(pricing).getByText("Unit margin")).toBeInTheDocument();
    expect(within(pricing).queryByText("SKU")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Pricing" }),
    ).not.toBeInTheDocument();
    expect(pricing.querySelector("dl")).toHaveClass("flex");
    expect(pricing.querySelector("dl")).not.toHaveClass("grid");
    expect(pricing.querySelector(".border-l")).not.toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Oshe" })).toHaveAttribute(
      "src",
      "https://cdn.example.test/oshe.webp",
    );
    expect(
      screen.queryByRole("link", { name: "Oshe" }),
    ).not.toBeInTheDocument();

    const identityMedia = screen.getByTestId("reports-sku-identity-media");
    const link = within(identityMedia).getByRole("link", {
      name: "View product",
    });
    const productHref = new URL(
      link.getAttribute("href")!,
      "http://localhost",
    );
    expect(productHref.pathname).toBe(
      "/$orgUrlSlug/store/$storeUrlSlug/products/$productSlug",
    );
    expect(productHref.searchParams.get("variant")).toBe("6N2Y-JY3-5G6");
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
    const identity = screen.getByTestId("reports-sku-identity");
    const unitCost = within(identity).getByText("Unit cost").parentElement;
    expect(unitCost).not.toBeNull();
    expect(within(unitCost!).getByText("—")).toBeInTheDocument();
    const unitMargin = within(identity).getByText("Unit margin").parentElement;
    expect(unitMargin).not.toBeNull();
    expect(within(unitMargin!).getByText("—")).toBeInTheDocument();
    expect(screen.getByLabelText("SKU image unavailable")).toBeInTheDocument();
  });

  it("offers a way back only when the caller supplied an origin", () => {
    useQuery.mockReturnValue({ days: [], totals: null, identity: undefined });

    search.current = {};
    const { unmount } = render(<ReportsSkuDetailView {...baseProps} />);
    expect(
      screen.getByRole("heading", { level: 1, name: "Reports" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Go back" }),
    ).not.toBeInTheDocument();
    unmount();

    search.current = {
      o: encodeURIComponent("/acme/store/downtown/reports/items"),
    };
    render(<ReportsSkuDetailView {...baseProps} />);
    expect(
      screen.getByRole("heading", { level: 1, name: "Reports" }),
    ).toBeInTheDocument();
    const backButton = screen.getByRole("button", { name: "Go back" });
    expect(backButton).toHaveAttribute(
      "data-remote-assist-control",
      "page-header-back",
    );
    expect(within(backButton).queryByText(/back/i)).not.toBeInTheDocument();

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

  it("opens a day sheet with POS and storefront evidence links", async () => {
    const user = userEvent.setup();
    const onTransactionDateChange = vi.fn();
    useQuery.mockImplementation((_query, args) => {
      if (args && typeof args === "object" && "operatingDate" in args) {
        return {
          transactions: [
            {
              sourceDomain: "pos",
              sourceId: "transaction-1",
              reference: "TX-1042",
              occurredAt: 1_753_312_800_000,
              status: "refunded",
              quantity: 1,
              netSalesMinor: 5200,
              costMinor: 2000,
              grossProfitMinor: 3200,
              hasRefunds: false,
              hasAdjustments: false,
            },
            {
              sourceDomain: "storefront",
              sourceId: "order-1",
              reference: "ORD-88",
              occurredAt: 1_753_313_100_000,
              status: "completed",
              quantity: 2,
              netSalesMinor: 8100,
              costMinor: null,
              grossProfitMinor: null,
              hasRefunds: true,
              hasAdjustments: false,
            },
          ],
          truncated: false,
        };
      }
      return {
        days: [
          {
            operatingDate: "2026-07-23",
            unitsSold: 3,
            netSalesMinor: 13_300,
            refundsMinor: 0,
            grossProfitMinor: null,
          },
        ],
        totals: null,
        identity: {
          displayName: "consistency",
          sku: "6N2Y-6A3-CFX",
        },
      };
    });

    const { rerender } = render(
      <ReportsSkuDetailView
        {...baseProps}
        onTransactionDateChange={onTransactionDateChange}
      />,
    );
    const dayButton = screen.getByRole("button", {
      name: "View transactions for Thu, Jul 23, 2026",
    });
    expect(dayButton).not.toHaveClass("hover:underline");
    expect(dayButton.querySelector("svg")).toBeNull();
    await user.click(dayButton);
    expect(onTransactionDateChange).toHaveBeenCalledWith("2026-07-23");

    rerender(
      <ReportsSkuDetailView
        {...baseProps}
        onTransactionDateChange={onTransactionDateChange}
        transactionDate="2026-07-23"
      />,
    );

    const report = screen.getByRole("dialog", {
      name: "Transactions for Thu, Jul 23, 2026",
    });
    const sheetProductName = within(report).getByText("Consistency");
    expect(sheetProductName).toHaveClass("font-medium", "text-foreground");
    expect(sheetProductName.parentElement).toHaveTextContent(
      "2 transactions attached to Consistency on the selected operating day.",
    );
    const reportBody = within(report).getByTestId(
      "sku-transaction-report-body",
    );
    expect(reportBody).toHaveClass("bg-surface-raised");
    const reportTable = within(report).getByTestId(
      "sku-transaction-report-table",
    );
    expect(reportTable).toHaveClass("bg-background/60");
    const reportHeader = within(report).getByTestId(
      "sku-transaction-report-header",
    );
    expect(
      Array.from(reportHeader.children).map((column) => column.textContent),
    ).toEqual([
      "Transaction",
      "Channel",
      "Quantity",
      "Net sale",
      "Performance",
      "Time",
    ]);
    expect(screen.getByText("#TX-1042")).toBeInTheDocument();
    expect(screen.getByText("#ORD-88")).toBeInTheDocument();
    expect(within(report).queryByText("completed")).not.toBeInTheDocument();
    expect(within(report).getByText("refunded")).toHaveClass("capitalize");
    const firstRow = within(report)
      .getByRole("link", { name: /TX-1042/ })
      .closest("[data-sku-transaction-report-row]");
    expect(firstRow).not.toBeNull();
    expect(
      Array.from(firstRow!.children).map((column) =>
        column.getAttribute("data-sku-transaction-report-column"),
      ),
    ).toEqual([
      "transaction",
      "channel",
      "quantity",
      "net-sale",
      "performance",
      "time",
    ]);
    expect(screen.getAllByText("Cost")).toHaveLength(2);
    expect(screen.getByText("$20")).toBeInTheDocument();
    const transactionHref = new URL(
      screen.getByRole("link", { name: /TX-1042/ }).getAttribute("href")!,
      "http://localhost",
    );
    expect(transactionHref.pathname).toBe(
      "/$orgUrlSlug/store/$storeUrlSlug/pos/transactions/$transactionId",
    );
    const orderHref = new URL(
      screen.getByRole("link", { name: /ORD-88/ }).getAttribute("href")!,
      "http://localhost",
    );
    expect(orderHref.pathname).toBe(
      "/$orgUrlSlug/store/$storeUrlSlug/orders/$orderSlug",
    );

    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(onTransactionDateChange).toHaveBeenLastCalledWith(undefined);
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
