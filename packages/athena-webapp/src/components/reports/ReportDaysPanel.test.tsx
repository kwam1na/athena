import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getFunctionName } from "convex/server";

const useQuery = vi.fn();
/** `null` = a real store; see `useReportsSharedDemoMode`. */
let sharedDemoContext: { kind: string } | null | undefined = null;
vi.mock("convex/react", () => ({
  useQuery: (...args: unknown[]) => useQuery(...args),
}));
vi.mock("@/hooks/useSharedDemoContext", () => ({
  useSharedDemoContext: () => sharedDemoContext,
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
    params,
    search,
    to,
    ...props
  }: {
    children?: React.ReactNode;
    params?: Record<string, string>;
    search?: Record<string, string>;
    to: string;
  }) => {
    return (
      <a
        data-params={JSON.stringify(params)}
        data-search={JSON.stringify(search)}
        href={to}
        {...props}
      >
        {children}
      </a>
    );
  },
  useParams: () => ({ orgUrlSlug: "acme", storeUrlSlug: "downtown" }),
}));

import { ReportDaysPanel } from "./ReportDaysPanel";
import {
  createSharedDemoReportDays,
  createSharedDemoReportSkuMix,
} from "@/components/shared-demo/sharedDemoReportsFixture";
import { getLocalOperatingDate } from "@/lib/operations/operatingDate";
import { formatOperatingDate } from "./reportFormat";

const baseProps = {
  startDate: "2026-07-15",
  endDate: "2026-07-28",
  tableStartDate: "2026-07-15",
  tableEndDate: "2026-07-28",
  canResetRange: false,
  onRangeChange: vi.fn(),
  onRangeReset: vi.fn(),
  onSelectedDateChange: vi.fn(),
  onPageChange: vi.fn(),
  page: 1,
};

afterEach(() => {
  vi.unstubAllGlobals();
  sharedDemoContext = null;
});

function isoDateOffset(from: string, days: number): string {
  const date = new Date(`${from}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

describe("ReportDaysPanel shared demo", () => {
  const endDate = getLocalOperatingDate();
  const startDate = isoDateOffset(endDate, -13);
  const demoProps = {
    ...baseProps,
    endDate,
    startDate,
    tableEndDate: endDate,
    tableStartDate: startDate,
  };

  it("renders demo days and product mix without either live read", () => {
    sharedDemoContext = { kind: "shared_demo" };
    useQuery.mockReturnValue(undefined);

    render(<ReportDaysPanel {...demoProps} />);

    expect(useQuery.mock.calls.every((call) => call[1] === "skip")).toBe(true);

    const days = createSharedDemoReportDays({ endDate, startDate });
    expect(days.length).toBeGreaterThan(0);
    expect(
      screen.getByRole("link", {
        name: formatOperatingDate(days.at(-1)!.operatingDate),
      }),
    ).toBeInTheDocument();

    // The mix panel is fed from the same demo range, not left pending.
    const mix = createSharedDemoReportSkuMix({ endDate, startDate });
    expect(mix.rows.length).toBeGreaterThan(0);
    expect(screen.queryByText("No products sold")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Product sales legend")).toBeInTheDocument();
  });

  it("keeps both live reads for a real store", () => {
    useQuery.mockReturnValue([]);

    render(<ReportDaysPanel {...demoProps} />);

    expect(
      useQuery.mock.calls.map((call) => call[1]).filter(Boolean),
    ).toEqual([
      { storeId: "store-1", startDate, endDate },
      { storeId: "store-1", startDate, endDate },
    ]);
  });

  it("opens neither read while the shared demo context is loading", () => {
    sharedDemoContext = undefined;
    useQuery.mockReturnValue(undefined);

    render(<ReportDaysPanel {...demoProps} />);

    expect(useQuery.mock.calls.every((call) => call[1] === "skip")).toBe(true);
  });
});

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

  it("keeps the settled page paired with stale rows during a range refresh", () => {
    const initialDays = Array.from({ length: 15 }, (_, index) => ({
      operatingDate: `2026-07-${String(index + 1).padStart(2, "0")}`,
      status: "reconciled",
      currency: "USD",
      netSalesMinor: 1000,
      unitsSold: 1,
      closeVarianceMinor: 0,
    }));
    useQuery.mockReturnValue(initialDays);

    const { rerender } = render(
      <ReportDaysPanel {...baseProps} page={2} />,
    );
    expect(
      within(screen.getByRole("table")).getByText("Wed, Jul 1, 2026"),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole("table")).queryByText("Wed, Jul 15, 2026"),
    ).not.toBeInTheDocument();

    useQuery.mockReturnValue(undefined);
    rerender(
      <ReportDaysPanel
        {...baseProps}
        canResetRange
        endDate="2026-07-01"
        page={1}
        startDate="2026-07-01"
      />,
    );

    expect(screen.getByTestId("report-days-table-card")).toHaveAttribute(
      "data-refreshing",
      "true",
    );
    expect(
      within(screen.getByRole("table")).getByText("Wed, Jul 1, 2026"),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole("table")).queryByText("Wed, Jul 15, 2026"),
    ).not.toBeInTheDocument();

    useQuery.mockReturnValue([initialDays[0]]);
    rerender(
      <ReportDaysPanel
        {...baseProps}
        canResetRange
        endDate="2026-07-01"
        page={1}
        startDate="2026-07-01"
      />,
    );
    expect(
      within(screen.getByRole("table")).getByText("Wed, Jul 1, 2026"),
    ).toBeInTheDocument();
    expect(screen.getByText("Showing 1-1 of 1")).toBeInTheDocument();
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

  it("targets the page containing the first date of a newly selected range", async () => {
    const user = userEvent.setup();
    const onRangeChange = vi.fn();
    const omittedDates = new Set(["2026-07-10", "2026-07-21"]);
    useQuery.mockReturnValue(
      Array.from({ length: 29 }, (_, index) => {
        const date = new Date(Date.UTC(2026, 6, 31 - index));
        return {
          operatingDate: date.toISOString().slice(0, 10),
          status: "reconciled",
          currency: "USD",
          netSalesMinor: 1000,
          unitsSold: 1,
          closeVarianceMinor: 0,
        };
      }).filter((day) => !omittedDates.has(day.operatingDate)),
    );

    render(
      <ReportDaysPanel
        {...baseProps}
        onRangeChange={onRangeChange}
        tableEndDate="2026-07-31"
        tableStartDate="2026-07-03"
      />,
    );

    await user.click(
      screen.getByRole("button", {
        name: "Change date range, currently Jul 15–28, 2026",
      }),
    );
    await user.click(
      screen.getByRole("button", { name: /Friday, July 3rd, 2026/i }),
    );

    expect(onRangeChange).toHaveBeenCalledWith(
      { startDate: "2026-07-03", endDate: "2026-07-28" },
      2,
    );
  });

  it("targets the selected start date after an expanded table range loads", async () => {
    const user = userEvent.setup();
    const onRangeChange = vi.fn();
    const onPageChange = vi.fn();
    const initialDays = Array.from({ length: 14 }, (_, index) => {
      const date = new Date(Date.UTC(2026, 6, 28 - index));
      return {
        operatingDate: date.toISOString().slice(0, 10),
        status: "reconciled",
        currency: "USD",
        netSalesMinor: 1000,
        unitsSold: 1,
        closeVarianceMinor: 0,
      };
    });
    useQuery.mockReturnValue(initialDays);

    const { rerender } = render(
      <ReportDaysPanel
        {...baseProps}
        onPageChange={onPageChange}
        onRangeChange={onRangeChange}
      />,
    );

    await user.click(
      screen.getByRole("button", {
        name: "Change date range, currently Jul 15–28, 2026",
      }),
    );
    await user.click(
      screen.getByRole("button", { name: /Friday, July 3rd, 2026/i }),
    );

    expect(onRangeChange).toHaveBeenCalledWith(
      { startDate: "2026-07-03", endDate: "2026-07-28" },
      1,
    );
    expect(onPageChange).not.toHaveBeenCalled();

    useQuery.mockReturnValue(
      Array.from({ length: 26 }, (_, index) => {
        const date = new Date(Date.UTC(2026, 6, 28 - index));
        return {
          operatingDate: date.toISOString().slice(0, 10),
          status: "reconciled",
          currency: "USD",
          netSalesMinor: 1000,
          unitsSold: 1,
          closeVarianceMinor: 0,
        };
      }),
    );
    rerender(
      <ReportDaysPanel
        {...baseProps}
        onPageChange={onPageChange}
        onRangeChange={onRangeChange}
        startDate="2026-07-03"
        tableStartDate="2026-07-03"
      />,
    );

    await waitFor(() => expect(onPageChange).toHaveBeenCalledWith(2));
  });

  it("selects a day row while preserving the date drill-down", async () => {
    const user = userEvent.setup();
    const onRangeChange = vi.fn();
    const onSelectedDateChange = vi.fn();
    useQuery.mockClear();
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
        onRangeChange={onRangeChange}
        onSelectedDateChange={onSelectedDateChange}
      />,
    );

    const dayRow = screen.getByRole("button", {
      name: "Show products sold for Tue, Jul 28, 2026",
    });
    expect(screen.getAllByTestId("report-day-placeholder-row")).toHaveLength(
      13,
    );
    expect(screen.getByText("Showing 1-1 of 1")).toBeInTheDocument();
    await user.click(within(dayRow).getByText("$12"));
    expect(onSelectedDateChange).toHaveBeenLastCalledWith("2026-07-28");
    expect(onRangeChange).not.toHaveBeenCalled();

    onSelectedDateChange.mockClear();
    const dateLink = within(dayRow).getByRole("link", {
      name: "Tue, Jul 28, 2026",
    });
    dateLink.addEventListener("click", (event) => event.preventDefault(), {
      once: true,
    });
    await user.click(dateLink);
    expect(onSelectedDateChange).not.toHaveBeenCalled();

    dayRow.focus();
    await user.keyboard("{Enter}");
    expect(onSelectedDateChange).toHaveBeenLastCalledWith("2026-07-28");
  });

  it("clears the selection when the selected day row is activated again", async () => {
    const user = userEvent.setup();
    const onRangeChange = vi.fn();
    const onRangeReset = vi.fn();
    const onSelectedDateChange = vi.fn();
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
        onRangeChange={onRangeChange}
        onRangeReset={onRangeReset}
        onSelectedDateChange={onSelectedDateChange}
        selectedDate="2026-07-28"
      />,
    );

    const selectedDayRow = screen.getByRole("button", {
      name: "Clear day selection for Tue, Jul 28, 2026",
    });
    expect(selectedDayRow).not.toHaveAttribute("data-state");
    expect(
      within(selectedDayRow).getByRole("link", {
        name: "Tue, Jul 28, 2026",
      }),
    ).toHaveClass("font-medium");
    await user.click(within(selectedDayRow).getByText("$12"));
    expect(onSelectedDateChange).toHaveBeenCalledWith(undefined);
    expect(onRangeReset).not.toHaveBeenCalled();
    expect(onRangeChange).not.toHaveBeenCalled();
  });

  it("keeps range rows visible and deemphasizes unselected days in single-day mode", async () => {
    const user = userEvent.setup();
    const onRangeChange = vi.fn();
    const onSelectedDateChange = vi.fn();
    useQuery.mockReturnValue([
      {
        operatingDate: "2026-07-16",
        status: "reconciled",
        currency: "USD",
        netSalesMinor: 5600,
        unitsSold: 8,
      },
      {
        operatingDate: "2026-07-15",
        status: "reconciled",
        currency: "USD",
        netSalesMinor: 4200,
        unitsSold: 6,
      },
    ]);

    render(
      <ReportDaysPanel
        {...baseProps}
        onRangeChange={onRangeChange}
        onSelectedDateChange={onSelectedDateChange}
        selectedDate="2026-07-16"
      />,
    );

    const selectedRow = screen.getByRole("button", {
      name: "Clear day selection for Thu, Jul 16, 2026",
    });
    const otherRow = screen.getByRole("button", {
      name: "Show products sold for Wed, Jul 15, 2026",
    });
    expect(selectedRow).not.toHaveAttribute("data-state");
    expect(
      within(selectedRow).getByRole("link", {
        name: "Thu, Jul 16, 2026",
      }),
    ).toHaveClass("font-medium");
    expect(
      within(otherRow).getByRole("link", {
        name: "Wed, Jul 15, 2026",
      }),
    ).not.toHaveClass("font-medium");
    expect(otherRow).toHaveAttribute("data-deemphasized", "true");
    const daysQuery = useQuery.mock.calls.find(
      ([functionReference]) =>
        getFunctionName(functionReference as never) ===
        "reports/queries:listDays",
    );
    const skuMixQuery = useQuery.mock.calls.find(
      ([functionReference]) =>
        getFunctionName(functionReference as never) ===
        "reports/queries:listRangeSkuMix",
    );
    expect(daysQuery?.[1]).toMatchObject({
      startDate: "2026-07-15",
      endDate: "2026-07-28",
    });
    expect(skuMixQuery?.[1]).toMatchObject({
      startDate: "2026-07-16",
      endDate: "2026-07-16",
    });

    await user.click(within(otherRow).getByText("$42"));
    expect(onSelectedDateChange).toHaveBeenCalledWith("2026-07-15");
    expect(onRangeChange).not.toHaveBeenCalled();
  });

  it("keeps the table scope visible while emphasizing only the selected range", () => {
    useQuery.mockReturnValue([
      {
        operatingDate: "2026-07-20",
        status: "reconciled",
        currency: "USD",
        netSalesMinor: 5600,
        unitsSold: 8,
      },
      {
        operatingDate: "2026-07-14",
        status: "reconciled",
        currency: "USD",
        netSalesMinor: 4200,
        unitsSold: 6,
      },
    ]);

    render(
      <ReportDaysPanel
        {...baseProps}
        endDate="2026-07-20"
        startDate="2026-07-15"
        tableEndDate="2026-07-28"
        tableStartDate="2026-07-01"
      />,
    );

    const selectedRangeRow = screen.getByRole("button", {
      name: "Show products sold for Mon, Jul 20, 2026",
    });
    const outsideRangeRow = screen.getByRole("button", {
      name: "Show products sold for Tue, Jul 14, 2026",
    });
    expect(selectedRangeRow).toHaveAttribute("data-highlighted", "true");
    expect(selectedRangeRow).not.toHaveAttribute("data-deemphasized");
    expect(outsideRangeRow).toHaveAttribute("data-deemphasized", "true");

    const daysQuery = useQuery.mock.calls.find(
      ([functionReference]) =>
        getFunctionName(functionReference as never) ===
        "reports/queries:listDays",
    );
    const skuMixQuery = useQuery.mock.calls.find(
      ([functionReference]) =>
        getFunctionName(functionReference as never) ===
        "reports/queries:listRangeSkuMix",
    );
    expect(daysQuery?.[1]).toMatchObject({
      startDate: "2026-07-01",
      endDate: "2026-07-28",
    });
    expect(skuMixQuery?.[1]).toMatchObject({
      startDate: "2026-07-15",
      endDate: "2026-07-20",
    });
  });

  it("returns from a selected day to the current selected range", async () => {
    const user = userEvent.setup();
    const onSelectedDateChange = vi.fn();
    useQuery.mockReturnValue([
      {
        operatingDate: "2026-07-20",
        status: "reconciled",
        currency: "USD",
        netSalesMinor: 5600,
        unitsSold: 8,
      },
      {
        operatingDate: "2026-07-19",
        status: "reconciled",
        currency: "USD",
        netSalesMinor: 4200,
        unitsSold: 6,
      },
      {
        operatingDate: "2026-07-14",
        status: "reconciled",
        currency: "USD",
        netSalesMinor: 2100,
        unitsSold: 3,
      },
    ]);

    const { rerender } = render(
      <ReportDaysPanel
        {...baseProps}
        endDate="2026-07-20"
        onSelectedDateChange={onSelectedDateChange}
        selectedDate="2026-07-20"
        startDate="2026-07-19"
        tableEndDate="2026-07-28"
        tableStartDate="2026-07-01"
      />,
    );

    expect(
      screen.getByRole("button", {
        name: "Show products sold for Sun, Jul 19, 2026",
      }),
    ).toHaveAttribute("data-deemphasized", "true");

    await user.click(
      within(
        screen.getByRole("button", {
          name: "Clear day selection for Mon, Jul 20, 2026",
        }),
      ).getByText("$56"),
    );
    expect(onSelectedDateChange).toHaveBeenCalledWith(undefined);

    rerender(
      <ReportDaysPanel
        {...baseProps}
        endDate="2026-07-20"
        onSelectedDateChange={onSelectedDateChange}
        startDate="2026-07-19"
        tableEndDate="2026-07-28"
        tableStartDate="2026-07-01"
      />,
    );

    expect(
      screen.getByRole("button", {
        name: "Show products sold for Sun, Jul 19, 2026",
      }),
    ).toHaveAttribute("data-highlighted", "true");
    expect(
      screen.getByRole("button", {
        name: "Show products sold for Tue, Jul 14, 2026",
      }),
    ).toHaveAttribute("data-deemphasized", "true");
  });

  it("clears single-day mode without changing the range or page", async () => {
    const user = userEvent.setup();
    const onRangeChange = vi.fn();
    const onRangeReset = vi.fn();
    const onPageChange = vi.fn();
    const onSelectedDateChange = vi.fn();
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
        endDate="2026-07-24"
        onPageChange={onPageChange}
        onRangeChange={onRangeChange}
        onRangeReset={onRangeReset}
        onSelectedDateChange={onSelectedDateChange}
        page={2}
        selectedDate="2026-07-28"
        startDate="2026-07-01"
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "Return to selected date range" }),
    );
    expect(onSelectedDateChange).toHaveBeenCalledWith(undefined);
    expect(onRangeChange).not.toHaveBeenCalled();
    expect(onPageChange).not.toHaveBeenCalled();
    expect(onRangeReset).not.toHaveBeenCalled();
  });

  it("pairs the day table with the current range's product sales", async () => {
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
    const osheLink = screen.getByRole("link", { name: /Oshe.*WIG-A.*70%/ });
    expect(osheLink).toHaveAttribute(
      "href",
      "/$orgUrlSlug/store/$storeUrlSlug/reports/items/$productSkuId",
    );
    expect(JSON.parse(osheLink.dataset.params ?? "{}")).toEqual({
      orgUrlSlug: "acme",
      productSkuId: "sku-1",
      storeUrlSlug: "downtown",
    });
    expect(JSON.parse(osheLink.dataset.search ?? "{}")).toEqual({
      endDate: "2026-07-28",
      o: expect.any(String),
      startDate: "2026-07-15",
    });
    expect(
      screen.getByText("Other SKUs").closest("a"),
    ).not.toBeInTheDocument();
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
    expect(document.querySelectorAll(".recharts-sector")).toHaveLength(0);
    expect(screen.getByTestId("report-sku-mix-content")).toHaveClass(
      "grid-cols-1",
      "gap-layout-xl",
    );
    expect(screen.getByLabelText("Product sales legend")).toHaveClass(
      "min-h-[18.75rem]",
      "grid-rows-6",
      "sm:min-h-36",
      "sm:grid-cols-2",
      "sm:grid-rows-3",
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
    expect(document.querySelectorAll(".recharts-sector")).toHaveLength(0);
    await waitFor(
      () => {
        const segments = Array.from(
          document.querySelectorAll(".recharts-sector"),
        );
        expect(segments.length).toBeGreaterThan(0);
        expect(
          segments.every((segment) =>
            segment.getAttribute("d")?.includes("A6,6"),
          ),
        ).toBe(true);
      },
      { timeout: 1_500 },
    );
    expect(disconnect).toHaveBeenCalled();
  });

  it("scopes SKU legend drill-downs to the selected operating day", () => {
    useQuery.mockImplementation((functionReference: unknown) => {
      const functionName = getFunctionName(functionReference as never);
      if (functionName === "reports/queries:listRangeSkuMix") {
        return {
          totalUnitsSold: 7,
          skuCount: 1,
          rows: [
            {
              key: "sku-1",
              productSkuId: "sku-1",
              label: "WIG-A",
              unitsSold: 7,
              shareBasisPoints: 10000,
              identity: { displayName: "Oshe", sku: "WIG-A" },
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
          unitsSold: 7,
        },
      ];
    });

    render(
      <ReportDaysPanel {...baseProps} selectedDate="2026-07-28" />,
    );

    const osheLink = screen.getByRole("link", { name: /Oshe.*WIG-A.*100%/ });
    expect(JSON.parse(osheLink.dataset.search ?? "{}")).toEqual({
      o: expect.any(String),
      periodDate: "2026-07-28",
      periodType: "day",
    });
  });

  it("centers the product empty state within the chart card", () => {
    useQuery.mockImplementation((functionReference: unknown) => {
      const functionName = getFunctionName(functionReference as never);
      if (functionName === "reports/queries:listRangeSkuMix") {
        return {
          totalUnitsSold: 0,
          skuCount: 0,
          rows: [],
        };
      }
      return [
        {
          operatingDate: "2026-07-14",
          status: "reconciled",
          currency: "USD",
          netSalesMinor: 0,
          unitsSold: 0,
        },
      ];
    });

    render(<ReportDaysPanel {...baseProps} />);

    expect(screen.getByTestId("report-sku-mix-empty")).toHaveClass(
      "absolute",
      "inset-0",
      "items-center",
      "justify-center",
    );
    expect(screen.getByTestId("report-sku-mix-empty")).toHaveAttribute(
      "data-motion",
      "enter",
    );
    expect(screen.getByTestId("report-sku-mix-empty")).toHaveAttribute(
      "data-transition-duration",
      "180",
    );
    expect(screen.getByTestId("report-sku-mix-total")).toHaveClass(
      "invisible",
    );
    expect(
      screen.getByText(
        "No product sales were recorded in this date range.",
      ),
    ).toBeInTheDocument();
  });

  it("describes an empty product mix using the selected day", () => {
    useQuery.mockImplementation((functionReference: unknown) => {
      const functionName = getFunctionName(functionReference as never);
      if (functionName === "reports/queries:listRangeSkuMix") {
        return {
          totalUnitsSold: 0,
          skuCount: 0,
          rows: [],
        };
      }
      return [
        {
          operatingDate: "2026-07-14",
          status: "reconciled",
          currency: "USD",
          netSalesMinor: 0,
          unitsSold: 0,
        },
      ];
    });

    render(
      <ReportDaysPanel
        {...baseProps}
        selectedDate="2026-07-14"
      />,
    );

    expect(
      screen.getByText(
        "No product sales were recorded on Tue, Jul 14, 2026.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(
        "No product sales were recorded in this date range.",
      ),
    ).not.toBeInTheDocument();
  });

  it("re-arms the pie animation when product sales follow an empty day", () => {
    let intersectionCallback: IntersectionObserverCallback | undefined;
    let skuMix = {
      totalUnitsSold: 0,
      skuCount: 0,
      rows: [] as Array<{
        key: string;
        productSkuId: string;
        label: string;
        unitsSold: number;
        shareBasisPoints: number;
        identity: { displayName: string; sku: string };
      }>,
    };
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(callback: IntersectionObserverCallback) {
          intersectionCallback = callback;
        }

        disconnect = vi.fn();
        observe = vi.fn();
        takeRecords = vi.fn(() => []);
        unobserve = vi.fn();
      },
    );
    useQuery.mockImplementation((functionReference: unknown) => {
      const functionName = getFunctionName(functionReference as never);
      if (functionName === "reports/queries:listRangeSkuMix") {
        return skuMix;
      }
      return [
        {
          operatingDate: "2026-07-29",
          status: "reconciled",
          currency: "USD",
          netSalesMinor: 1000,
          unitsSold: 1,
        },
      ];
    });

    const { rerender } = render(
      <ReportDaysPanel
        {...baseProps}
        selectedDate="2026-07-25"
      />,
    );
    const settledChartSurface = screen.getByTestId(
      "report-sku-mix-graphic",
    );
    expect(settledChartSurface).toHaveClass("invisible");

    act(() => {
      intersectionCallback?.(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );
    });
    expect(screen.getByTestId("report-sku-mix-chart")).toHaveAttribute(
      "data-animation-active",
      "false",
    );

    skuMix = {
      totalUnitsSold: 1,
      skuCount: 1,
      rows: [
        {
          key: "sku-1",
          productSkuId: "sku-1",
          label: "WIG-A",
          unitsSold: 1,
          shareBasisPoints: 10000,
          identity: { displayName: "Oshe", sku: "WIG-A" },
        },
      ],
    };
    rerender(
      <ReportDaysPanel
        {...baseProps}
        selectedDate="2026-07-29"
      />,
    );

    expect(screen.getByTestId("report-sku-mix-chart")).toHaveAttribute(
      "data-animation-active",
      "true",
    );
    expect(screen.getByTestId("report-sku-mix-graphic")).not.toHaveClass(
      "invisible",
    );
    expect(screen.getByTestId("report-sku-mix-graphic")).toBe(
      settledChartSurface,
    );
    expect(screen.getByTestId("report-sku-mix-number")).toHaveTextContent(
      "1",
    );
    expect(screen.getByTestId("report-sku-mix-total")).toHaveAccessibleName(
      "1 unit sold",
    );
  });

  it("animates the populated chart out only when the next day has no sales", async () => {
    let intersectionCallback: IntersectionObserverCallback | undefined;
    let skuMix = {
      totalUnitsSold: 10,
      skuCount: 1,
      rows: [
        {
          key: "sku-1",
          productSkuId: "sku-1",
          label: "WIG-A",
          unitsSold: 10,
          shareBasisPoints: 10000,
          identity: { displayName: "Oshe", sku: "WIG-A" },
        },
      ],
    };
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(callback: IntersectionObserverCallback) {
          intersectionCallback = callback;
        }

        disconnect = vi.fn();
        observe = vi.fn();
        takeRecords = vi.fn(() => []);
        unobserve = vi.fn();
      },
    );
    useQuery.mockImplementation((functionReference: unknown) => {
      const functionName = getFunctionName(functionReference as never);
      if (functionName === "reports/queries:listRangeSkuMix") {
        return skuMix;
      }
      return [
        {
          operatingDate: "2026-07-29",
          status: "reconciled",
          currency: "USD",
          netSalesMinor: 1000,
          unitsSold: 10,
        },
      ];
    });

    const { rerender } = render(
      <ReportDaysPanel
        {...baseProps}
        selectedDate="2026-07-29"
      />,
    );
    act(() => {
      intersectionCallback?.(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );
    });

    skuMix = {
      ...skuMix,
      totalUnitsSold: 12,
      rows: [{ ...skuMix.rows[0], unitsSold: 12 }],
    };
    rerender(
      <ReportDaysPanel
        {...baseProps}
        selectedDate="2026-07-28"
      />,
    );
    expect(screen.getByTestId("report-sku-mix-chart")).toHaveAttribute(
      "data-exiting",
      "false",
    );

    skuMix = {
      totalUnitsSold: 0,
      skuCount: 0,
      rows: [],
    };
    rerender(
      <ReportDaysPanel
        {...baseProps}
        selectedDate="2026-07-25"
      />,
    );

    expect(screen.getByTestId("report-sku-mix-chart")).toHaveAttribute(
      "data-exiting",
      "true",
    );
    expect(screen.getByLabelText("Product sales legend")).toHaveAttribute(
      "data-exiting",
      "true",
    );
    expect(screen.getByTestId("report-sku-mix-total")).toHaveAccessibleName(
      "12 units sold",
    );
    expect(screen.queryByTestId("report-sku-mix-empty")).not.toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByTestId("report-sku-mix-chart")).toHaveAttribute(
        "data-exiting",
        "false",
      );
      expect(screen.getByLabelText("Product sales legend")).toHaveAttribute(
        "data-exiting",
        "false",
      );
      expect(screen.getByTestId("report-sku-mix-empty")).toBeInTheDocument();
    });
  });

  it("updates the chart total through an accessible flip-number surface", () => {
    let totalUnitsSold = 10;
    useQuery.mockImplementation((functionReference: unknown) => {
      const functionName = getFunctionName(functionReference as never);
      if (functionName === "reports/queries:listRangeSkuMix") {
        return {
          totalUnitsSold,
          skuCount: 1,
          rows: [
            {
              key: "sku-1",
              productSkuId: "sku-1",
              label: "WIG-A",
              unitsSold: totalUnitsSold,
              shareBasisPoints: 10000,
              identity: { displayName: "Oshe", sku: "WIG-A" },
            },
          ],
        };
      }
      return [
        {
          operatingDate: "2026-07-14",
          status: "reconciled",
          currency: "USD",
          netSalesMinor: 1000,
          unitsSold: totalUnitsSold,
        },
      ];
    });

    const { rerender } = render(<ReportDaysPanel {...baseProps} />);

    expect(screen.getByTestId("report-sku-mix-total")).toHaveAccessibleName(
      "10 units sold",
    );
    expect(screen.getByTestId("report-sku-mix-number")).toHaveAttribute(
      "data-motion",
      "flip",
    );
    expect(screen.getByTestId("report-sku-mix-number")).toHaveAttribute(
      "data-transition-delay",
      "120",
    );
    expect(screen.getByTestId("report-sku-mix-number")).toHaveAttribute(
      "data-transition-duration",
      "650",
    );
    expect(screen.getByTestId("report-sku-mix-number")).toHaveAttribute(
      "data-transition-easing",
      "ease",
    );
    expect(screen.getByTestId("report-sku-mix-number")).toHaveAttribute(
      "data-transition-from-zero",
      "fade",
    );

    totalUnitsSold = 7;
    rerender(<ReportDaysPanel {...baseProps} />);

    expect(screen.getByTestId("report-sku-mix-total")).toHaveAccessibleName(
      "7 units sold",
    );
    expect(screen.getByTestId("report-sku-mix-number")).toHaveAttribute(
      "data-value",
      "7",
    );
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
