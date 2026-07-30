import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { getFunctionName } from "convex/server";

const useQuery = vi.fn();
vi.mock("convex/react", () => ({
  useQuery: (...args: unknown[]) => useQuery(...args),
}));
vi.mock("@/hooks/useGetActiveStore", () => ({
  default: () => ({
    activeStore: { _id: "store-1", currency: "USD" },
    isLoadingStores: false,
  }),
}));
vi.mock("@tanstack/react-router", () => ({
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
  useParams: () => ({ orgUrlSlug: "acme", storeUrlSlug: "downtown" }),
}));

import { ReportDaysPanel } from "./ReportDaysPanel";

const baseProps = {
  startDate: "2026-07-15",
  endDate: "2026-07-28",
  canResetRange: false,
  onRangeChange: vi.fn(),
  onRangeReset: vi.fn(),
  onPageChange: vi.fn(),
  page: 1,
};

describe("ReportDaysPanel", () => {
  it("paginates longer ranges in two-week slices with the shared controls", async () => {
    const user = userEvent.setup();
    const onPageChange = vi.fn();
    useQuery.mockReturnValue(
      Array.from({ length: 15 }, (_, index) => ({
        operatingDate: `2026-07-${String(index + 1).padStart(2, "0")}`,
        status: "reconciled",
        currency: "USD",
        netSalesMinor: 1000,
        unitsSold: 1,
        closeVarianceMinor: 0,
      })),
    );

    const { rerender } = render(
      <ReportDaysPanel {...baseProps} onPageChange={onPageChange} />,
    );

    expect(screen.getByText("Showing 1-14 of 15")).toBeInTheDocument();
    expect(screen.getByText("Page 1 of 2")).toBeInTheDocument();
    expect(screen.getByText("Wed, Jul 15, 2026")).toBeInTheDocument();
    expect(screen.queryByText("Wed, Jul 1, 2026")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Go to next page" }));
    expect(onPageChange).toHaveBeenCalledWith(2);

    rerender(
      <ReportDaysPanel {...baseProps} onPageChange={onPageChange} page={2} />,
    );
    expect(screen.getByText("Showing 15-15 of 15")).toBeInTheDocument();
    expect(screen.getByText("Page 2 of 2")).toBeInTheDocument();
    expect(screen.getByText("Wed, Jul 1, 2026")).toBeInTheDocument();
    expect(screen.queryByText("Wed, Jul 15, 2026")).not.toBeInTheDocument();
  });

  it("presents the filter as one date range and states the fixed table order", () => {
    useQuery.mockReturnValue([
      {
        operatingDate: "2026-07-28",
        status: "provisional",
        currency: "USD",
        netSalesMinor: 1200,
        unitsSold: 7,
      },
    ]);

    render(<ReportDaysPanel {...baseProps} />);

    expect(
      screen.getByRole("button", {
        name: "Change date range, currently Jul 15–28, 2026",
      }),
    ).toBeInTheDocument();
    expect(screen.queryByText("From")).not.toBeInTheDocument();
    expect(screen.queryByText("To")).not.toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Date" })).toHaveAttribute(
      "aria-sort",
      "descending",
    );
    expect(
      screen.queryByRole("columnheader", { name: "Against close" }),
    ).not.toBeInTheDocument();
  });

  it("offers a restrained reset only when the range differs from default", async () => {
    const user = userEvent.setup();
    const onRangeReset = vi.fn();
    useQuery.mockReturnValue([
      {
        operatingDate: "2026-07-28",
        status: "provisional",
        currency: "USD",
        netSalesMinor: 1200,
        unitsSold: 7,
      },
    ]);

    const { rerender } = render(
      <ReportDaysPanel
        {...baseProps}
        canResetRange
        onRangeReset={onRangeReset}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "Reset date range to default" }),
    );
    expect(onRangeReset).toHaveBeenCalledOnce();

    rerender(
      <ReportDaysPanel
        {...baseProps}
        canResetRange={false}
        onRangeReset={onRangeReset}
      />,
    );
    expect(
      screen.queryByRole("button", { name: "Reset date range to default" }),
    ).not.toBeInTheDocument();
  });

  it("sets the range from a day row while preserving the date drill-down", async () => {
    const user = userEvent.setup();
    const onRangeChange = vi.fn();
    useQuery.mockReturnValue([
      {
        operatingDate: "2026-07-28",
        status: "provisional",
        currency: "USD",
        netSalesMinor: 1200,
        unitsSold: 7,
      },
    ]);

    render(
      <ReportDaysPanel {...baseProps} onRangeChange={onRangeChange} />,
    );

    const dayRow = screen.getByRole("button", {
      name: "Show reports for Tue, Jul 28, 2026",
    });
    expect(screen.getAllByTestId("report-day-placeholder-row")).toHaveLength(
      13,
    );
    expect(screen.getByText("Showing 1-1 of 1")).toBeInTheDocument();
    await user.click(within(dayRow).getByText("$12"));
    expect(onRangeChange).toHaveBeenLastCalledWith({
      startDate: "2026-07-28",
      endDate: "2026-07-28",
    });

    onRangeChange.mockClear();
    const dateLink = within(dayRow).getByRole("link", {
      name: "Tue, Jul 28, 2026",
    });
    dateLink.addEventListener("click", (event) => event.preventDefault(), {
      once: true,
    });
    await user.click(dateLink);
    expect(onRangeChange).not.toHaveBeenCalled();

    dayRow.focus();
    await user.keyboard("{Enter}");
    expect(onRangeChange).toHaveBeenLastCalledWith({
      startDate: "2026-07-28",
      endDate: "2026-07-28",
    });
  });

  it("resets the range when the selected day row is activated again", async () => {
    const user = userEvent.setup();
    const onRangeChange = vi.fn();
    const onRangeReset = vi.fn();
    useQuery.mockReturnValue([
      {
        operatingDate: "2026-07-28",
        status: "provisional",
        currency: "USD",
        netSalesMinor: 1200,
        unitsSold: 7,
      },
    ]);

    render(
      <ReportDaysPanel
        {...baseProps}
        canResetRange
        endDate="2026-07-28"
        onRangeChange={onRangeChange}
        onRangeReset={onRangeReset}
        startDate="2026-07-28"
      />,
    );

    const selectedDayRow = screen.getByRole("button", {
      name: "Reset date range from Tue, Jul 28, 2026",
    });
    expect(selectedDayRow).toHaveAttribute("data-state", "selected");
    await user.click(within(selectedDayRow).getByText("$12"));
    expect(onRangeReset).toHaveBeenCalledOnce();
    expect(onRangeChange).not.toHaveBeenCalled();
  });

  it("pairs the day table with the current range's product sales", () => {
    let intersectionCallback: IntersectionObserverCallback | undefined;
    const disconnect = vi.fn();
    const observe = vi.fn();
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(callback: IntersectionObserverCallback) {
          intersectionCallback = callback;
        }

        disconnect = disconnect;
        observe = observe;
        takeRecords = vi.fn(() => []);
        unobserve = vi.fn();
      },
    );
    useQuery.mockImplementation((functionReference: unknown) => {
      const functionName = getFunctionName(functionReference as never);
      if (functionName === "reports/queries:listRangeSkuMix") {
        return {
          totalUnitsSold: 10,
          skuCount: 3,
          rows: [
            {
              key: "sku-1",
              productSkuId: "sku-1",
              label: "WIG-A",
              unitsSold: 7,
              shareBasisPoints: 7000,
              identity: { displayName: "oshe", sku: "WIG-A" },
            },
            {
              key: "sku-2",
              productSkuId: "sku-2",
              label: "WIG-B",
              unitsSold: 2,
              shareBasisPoints: 2000,
              identity: {
                displayName: "FRAGRANT AND SMOOTH OIL",
                sku: "WIG-B",
              },
            },
            {
              key: "other",
              label: "Other SKUs",
              unitsSold: 1,
              shareBasisPoints: 1000,
            },
          ],
        };
      }
      return [
        {
          operatingDate: "2026-07-28",
          status: "provisional",
          currency: "USD",
          netSalesMinor: 1200,
          unitsSold: 10,
        },
      ];
    });

    render(<ReportDaysPanel {...baseProps} />);

    const daysCard = screen.getByTestId("report-days-table-card");
    const skuMixCard = screen.getByTestId("report-sku-mix-chart");
    expect(skuMixCard).toHaveAttribute("data-animation-active", "false");
    expect(screen.getByTestId("report-sku-mix-graphic")).toHaveClass(
      "invisible",
    );
    expect(observe).toHaveBeenCalledWith(skuMixCard);
    expect(
      screen.getByTestId("report-days-heading"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Net sales and units sold by operating date"),
    ).toBeInTheDocument();
    expect(
      within(daysCard).queryByRole("heading", { name: "Days" }),
    ).not.toBeInTheDocument();
    expect(
      within(skuMixCard).queryByRole("heading", { name: "Products sold" }),
    ).not.toBeInTheDocument();
    expect(
      within(daysCard).queryByRole("button", { name: /Change date range/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Products sold" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Share of units sold by product in this date range"),
    ).toBeInTheDocument();
    expect(screen.getByText("Oshe")).toBeInTheDocument();
    expect(screen.getByText("70%")).toBeInTheDocument();
    expect(screen.getByText("Fragrant And Smooth Oil")).toBeInTheDocument();
    expect(screen.getByText("20%")).toBeInTheDocument();
    expect(screen.getByText("Other SKUs")).toBeInTheDocument();
    expect(screen.getByText("10%")).toBeInTheDocument();
    expect(screen.queryByText("oshe")).not.toBeInTheDocument();
    expect(screen.getByTestId("sku-mix-swatch-other")).toHaveStyle({
      backgroundColor: "hsl(var(--muted-foreground) / 0.15)",
    });

    expect(screen.getByTestId("report-days-content-grid")).toHaveClass(
      "items-stretch",
    );
    expect(screen.getByTestId("report-sku-mix-chart")).toHaveClass("h-full");
    expect(screen.getByTestId("report-sku-mix-graphic")).toHaveClass(
      "max-h-96",
    );
    expect(screen.getByTestId("report-sku-mix-graphic")).toHaveClass("z-10");
    expect(screen.getByTestId("report-sku-mix-total")).toHaveClass("z-0");
    const chartSegments = document.querySelectorAll(".recharts-sector");
    expect(chartSegments.length).toBeGreaterThan(0);
    chartSegments.forEach((segment) => {
      expect(segment.getAttribute("d")).toContain("A6,6");
    });
    expect(screen.getByTestId("report-sku-mix-content")).toHaveClass(
      "grid-cols-1",
      "gap-layout-xl",
    );
    expect(screen.getByLabelText("Product sales legend")).toHaveClass(
      "sm:grid-cols-2",
    );
    act(() => {
      intersectionCallback?.(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );
    });
    expect(skuMixCard).toHaveAttribute("data-animation-active", "true");
    expect(screen.getByTestId("report-sku-mix-graphic")).not.toHaveClass(
      "invisible",
    );
    expect(disconnect).toHaveBeenCalled();
  });

  it("shows the most recent operating day first", () => {
    useQuery.mockReturnValue([
      {
        operatingDate: "2026-07-27",
        status: "reconciled",
        currency: "USD",
        netSalesMinor: 900,
        unitsSold: 5,
        closeVarianceMinor: 0,
      },
      {
        operatingDate: "2026-07-28",
        status: "provisional",
        currency: "USD",
        netSalesMinor: 1200,
        unitsSold: 7,
      },
    ]);

    render(<ReportDaysPanel {...baseProps} />);

    const table = screen.getByRole("table");
    const recentDay = within(table).getByText("Tue, Jul 28, 2026");
    const olderDay = within(table).getByText("Mon, Jul 27, 2026");
    expect(
      recentDay.compareDocumentPosition(olderDay) &
      Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("renders no results block until the first result settles", () => {
    // A skeleton would appear and vanish as a flash of its own on these
    // fast queries; refreshes keep prior data on screen instead.
    useQuery.mockReturnValue(undefined);
    render(<ReportDaysPanel {...baseProps} />);
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByTestId("report-days-loading")).not.toBeInTheDocument();
    // The panel's own controls stay put, so nothing jumps when data lands.
    expect(screen.getByTestId("report-days-panel")).toBeInTheDocument();
  });
});
