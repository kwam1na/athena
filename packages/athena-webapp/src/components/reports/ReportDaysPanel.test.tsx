import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getFunctionName } from "convex/server";

const useQuery = vi.fn();
const ensureMovementRange = vi.fn();
const ensureMixRange = vi.fn();
const retryMixRange = vi.fn();
/** `null` = a real store; see `useReportsSharedDemoMode`. */
let sharedDemoContext: { kind: string } | null | undefined = null;
vi.mock("convex/react", () => ({
  useQuery: (...args: unknown[]) => {
    const result = useQuery(...args);
    // A skipped subscription can never produce data, whatever blanket
    // mockReturnValue a test installed for the panel's own reads.
    return args[1] === "skip" ? undefined : result;
  },
  useMutation: (reference: unknown) => {
    const name = getFunctionName(reference as never);
    if (name === "reports/skuMixRange:ensureMixRange") return ensureMixRange;
    if (name === "reports/skuMixRange:retryMixRange") return retryMixRange;
    return ensureMovementRange;
  },
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
import { formatOperatingDate, formatReportDateRange } from "./reportFormat";

/**
 * Day rows spanning `[startDate, endDate]`, each publishing the exact number
 * of `reportSkuDay` rows its fold wrote. `skuDayRowCount: undefined` models
 * the pre-U8 generation, which the mix probe must treat as unknown.
 */
function daysWithSkuRowCounts(
  startDate: string,
  endDate: string,
  skuDayRowCount: number | undefined,
) {
  const rows = [];
  for (let date = startDate; date <= endDate; date = isoDateOffset(date, 1)) {
    rows.push({
      operatingDate: date,
      status: "reconciled" as const,
      currency: "USD",
      flags: {},
      factCount: skuDayRowCount ?? 0,
      ...(skuDayRowCount === undefined ? {} : { skuDayRowCount }),
      grossSalesMinor: 0,
      netSalesMinor: 0,
      refundsMinor: 0,
      unitsSold: 0,
      unitsReturned: 0,
      uncostedRevenueMinor: 0,
      grossProfitMinor: 0,
      paymentsCollectedMinor: 0,
      paymentsRefundedMinor: 0,
      paymentAllocatedMinor: 0,
    });
  }
  return rows;
}

/** Route every read but `listDays` to `undefined`, so only routing is under test. */
function onlyDaysRead(days: unknown) {
  return (functionReference: unknown, args: unknown) => {
    if (args === "skip") return undefined;
    return getFunctionName(functionReference as never) ===
      "reports/queries:listDays"
      ? days
      : undefined;
  };
}

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

beforeEach(() => {
  // Never-settling by default: a multi-day mount may admit its mix request,
  // but no lifecycle progresses unless a test asks for one, so unrelated
  // tests see no async state updates.
  ensureMixRange.mockImplementation(() => new Promise(() => {}));
  retryMixRange.mockImplementation(() => new Promise(() => {}));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  sharedDemoContext = null;
  ensureMovementRange.mockReset();
  ensureMixRange.mockReset();
  retryMixRange.mockReset();
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
    // Demo mode never consumes async admission: the multi-day demo mix is
    // answered synchronously by the fixture, not by the ensure mutation
    // (which the server independently denies for shared-demo actors).
    expect(ensureMixRange).not.toHaveBeenCalled();

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

  it("keeps the days read live and admits the multi-day mix for a real store", () => {
    // 14 days at 400 folded SKU rows each = 5,600, past the sync budget, so
    // this range genuinely needs the snapshot.
    useQuery.mockImplementation(
      onlyDaysRead(daysWithSkuRowCounts(startDate, endDate, 400)),
    );

    render(<ReportDaysPanel {...demoProps} />);

    // Mix routes through admission, not the sync reader, so the only live
    // subscription on mount is the days table.
    expect(
      useQuery.mock.calls.map((call) => call[1]).filter((a) => a !== "skip"),
    ).toEqual([{ storeId: "store-1", startDate, endDate }]);
    expect(ensureMixRange).toHaveBeenCalledWith({
      storeId: "store-1",
      startDate,
      endDate,
    });
  });

  /**
   * U8 routing. The span rule alone sent every range over two days to
   * admission; the probe keeps the ones the reader can provably serve on the
   * synchronous path, and falls back to the span rule whenever it cannot
   * prove the size.
   */
  describe("sku mix row probe", () => {
    const syncMixCalls = () =>
      useQuery.mock.calls.filter(
        ([reference, args]) =>
          args !== "skip" &&
          getFunctionName(reference as never) ===
            "reports/queries:listRangeSkuMix",
      );

    it("keeps a multi-day range synchronous when the folded rows clear the budget", () => {
      // 14 days at 30 rows each = 420 rows: what wigclub's median day folds,
      // and two orders of magnitude inside the 5,000-row reader cap.
      useQuery.mockImplementation(
        onlyDaysRead(daysWithSkuRowCounts(startDate, endDate, 30)),
      );

      render(<ReportDaysPanel {...demoProps} />);

      expect(syncMixCalls().map(([, args]) => args)).toEqual([
        { storeId: "store-1", startDate, endDate },
      ]);
      // The whole point: no admission, no polling, no snapshot build.
      expect(ensureMixRange).not.toHaveBeenCalled();
    });

    it("admits the snapshot when the folded rows exceed the budget", () => {
      useQuery.mockImplementation(
        onlyDaysRead(daysWithSkuRowCounts(startDate, endDate, 300)),
      );

      render(<ReportDaysPanel {...demoProps} />);

      expect(syncMixCalls()).toHaveLength(0);
      expect(ensureMixRange).toHaveBeenCalledWith({
        storeId: "store-1",
        startDate,
        endDate,
      });
    });

    it("falls back to the span rule when any day predates the row count", () => {
      // One unmeasurable day makes the whole range unprovable — the total is
      // unknown, not "the rest of the days", so this must not route sync.
      const days = daysWithSkuRowCounts(startDate, endDate, 10);
      delete (days[3] as { skuDayRowCount?: number }).skuDayRowCount;
      useQuery.mockImplementation(onlyDaysRead(days));

      render(<ReportDaysPanel {...demoProps} />);

      expect(syncMixCalls()).toHaveLength(0);
      expect(ensureMixRange).toHaveBeenCalled();
    });

    it("holds admission until the days read settles, then routes on the verdict", () => {
      // Firing ensure on the span rule while the probe is unresolved would
      // consume admission budget for a range the probe may prove cheap a
      // moment later — the exact spend this feature exists to prevent.
      useQuery.mockImplementation(onlyDaysRead(undefined));

      const { rerender } = render(<ReportDaysPanel {...demoProps} />);

      expect(syncMixCalls()).toHaveLength(0);
      expect(ensureMixRange).not.toHaveBeenCalled();

      // The days rail settles cheap: the range routes sync, and the deferral
      // means no admission was ever spent on it.
      useQuery.mockImplementation(
        onlyDaysRead(daysWithSkuRowCounts(startDate, endDate, 30)),
      );
      rerender(<ReportDaysPanel {...demoProps} />);

      expect(syncMixCalls().map(([, args]) => args)).toContainEqual({
        storeId: "store-1",
        startDate,
        endDate,
      });
      expect(ensureMixRange).not.toHaveBeenCalled();
    });

    it("still routes a single day synchronously with no probe at all", () => {
      // The span floor is independent of loaded data: a day click cannot
      // regress just because the days rail has not answered yet.
      useQuery.mockImplementation(onlyDaysRead(undefined));

      render(
        <ReportDaysPanel {...demoProps} selectedDate={endDate} />,
      );

      expect(syncMixCalls().map(([, args]) => args)).toEqual([
        { storeId: "store-1", startDate: endDate, endDate },
      ]);
      expect(ensureMixRange).not.toHaveBeenCalled();
    });
  });

  it("opens neither read while the shared demo context is loading", () => {
    sharedDemoContext = undefined;
    useQuery.mockReturnValue(undefined);

    render(<ReportDaysPanel {...demoProps} />);

    expect(useQuery.mock.calls.every((call) => call[1] === "skip")).toBe(true);
  });
});

describe("ReportDaysPanel", () => {
  it("places the units chart action with Products sold and uses the same selected period", async () => {
    const user = userEvent.setup();
    const movementTotals = {
      unitsSold: 7,
      unitsReturned: 2,
      netUnits: 5,
      skuCount: 1,
    };
    const movementLifecycle = {
      state: "completed" as const,
      totals: movementTotals,
      completedAt: 1_754_000_000_000,
      pageCount: 1,
    };
    ensureMovementRange.mockResolvedValue({
      requestKey: "movement:days-panel",
      lifecycle: { state: "queued_pending" },
    });
    useQuery.mockImplementation((functionReference: unknown, args: unknown) => {
      if (args === "skip") return undefined;
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
              shareBasisPoints: 10_000,
              identity: { displayName: "Oshe", sku: "WIG-A" },
            },
          ],
        };
      }
      if (functionName === "reports/skuMovementRange:getMovementRange") {
        return {
          requestKey: "movement:days-panel",
          startDate: "2026-07-28",
          endDate: "2026-07-28",
          lifecycle: movementLifecycle,
        };
      }
      if (functionName === "reports/skuMovementRange:getMovementRangePage") {
        return {
          requestKey: "movement:days-panel",
          startDate: "2026-07-28",
          endDate: "2026-07-28",
          lifecycle: movementLifecycle,
          page: 1,
          pageCount: 1,
          rows: [
            {
              key: "sku-1",
              productSkuId: "sku-1",
              label: "WIG-A",
              netUnits: 5,
              rank: 1,
              unitsReturned: 2,
              unitsSold: 7,
              identity: {
                displayName: "Oshe",
                netPriceMinor: 4_500,
                sku: "WIG-A",
              },
            },
          ],
        };
      }
      return [
        {
          operatingDate: "2026-07-28",
          status: "provisional",
          currency: "USD",
          netSalesMinor: 1_200,
          unitsSold: 7,
        },
      ];
    });

    render(<ReportDaysPanel {...baseProps} selectedDate="2026-07-28" />);

    const productsHeader = screen.getByTestId("report-products-sold-header");
    expect(
      within(productsHeader).getByRole("heading", { name: "Products sold" }),
    ).toBeInTheDocument();
    const trigger = within(productsHeader).getByRole("button", {
      name: "View item movement",
    });

    await user.click(trigger);

    const dialog = screen.getByRole("dialog", { name: "Item movement" });
    // The sheet admits its movement request over the same selected period.
    await waitFor(() =>
      expect(ensureMovementRange).toHaveBeenCalledWith({
        endDate: "2026-07-28",
        startDate: "2026-07-28",
        storeId: "store-1",
      }),
    );
    await waitFor(() =>
      expect(
        within(dialog).getAllByRole("link", { name: /Oshe/ }),
      ).not.toHaveLength(0),
    );
  });

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

    const { rerender } = render(<ReportDaysPanel {...baseProps} page={2} />);
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
    expect(daysQuery?.[1]).toMatchObject({
      startDate: "2026-07-01",
      endDate: "2026-07-28",
    });
    // A six-day selection is past the sync threshold: the synchronous mix
    // reader stays skipped and the range is admitted instead.
    expect(
      useQuery.mock.calls.some(
        ([functionReference, args]) =>
          args !== "skip" &&
          getFunctionName(functionReference as never) ===
            "reports/queries:listRangeSkuMix",
      ),
    ).toBe(false);
    expect(ensureMixRange).toHaveBeenCalledWith({
      storeId: "store-1",
      startDate: "2026-07-15",
      endDate: "2026-07-20",
    });
  });

  it("shows the building affordance over settled rows while a multi-day snapshot builds", async () => {
    ensureMixRange.mockResolvedValue({
      requestKey: MIX_REQUEST_KEY,
      lifecycle: { state: "queued_pending" },
    });
    useQuery.mockImplementation((functionReference: unknown, args: unknown) => {
      if (args === "skip") return undefined;
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
              shareBasisPoints: 10_000,
              identity: { displayName: "Oshe", sku: "WIG-A" },
            },
          ],
        };
      }
      if (functionName === "reports/queries:listDays") {
        return [
          {
            operatingDate: "2026-07-28",
            status: "reconciled",
            currency: "USD",
            netSalesMinor: 1_200,
            unitsSold: 7,
          },
        ];
      }
      return undefined;
    });

    // A selected day settles through the sync reader: no admission, no
    // building affordance.
    const { rerender } = render(
      <ReportDaysPanel {...baseProps} selectedDate="2026-07-28" />,
    );
    expect(screen.getByText("Oshe")).toBeInTheDocument();
    expect(ensureMixRange).not.toHaveBeenCalled();
    expect(
      screen.queryByTestId("report-sku-mix-building"),
    ).not.toBeInTheDocument();

    // Clearing the selection widens to the 14-day async span; the ensure
    // never settles (default mock), so the panel is mid-build.
    rerender(<ReportDaysPanel {...baseProps} />);

    expect(ensureMixRange).toHaveBeenCalledWith({
      storeId: "store-1",
      startDate: "2026-07-15",
      endDate: "2026-07-28",
    });
    // The settled rows hold — muted in place, never replaced by a skeleton —
    // while a visually hidden polite region names the incoming range.
    expect(screen.getByText("Oshe")).toBeInTheDocument();
    const status = screen.getByTestId("report-sku-mix-building");
    expect(status).toHaveAttribute("role", "status");
    expect(status).toHaveClass("sr-only");
    await waitFor(() =>
      expect(status).toHaveTextContent(
        `Updating product mix for ${formatReportDateRange("2026-07-15", "2026-07-28")}`,
      ),
    );
    expect(screen.getByTestId("report-sku-mix-graphic")).toHaveClass(
      "saturate-50",
    );
    expect(screen.getByTestId("report-sku-mix-total")).not.toHaveClass(
      "invisible",
    );
    expect(
      screen.getByTestId("report-sku-mix-building-label"),
    ).toHaveTextContent("Updating…");
    expect(screen.getByTestId("report-sku-mix-chart")).toHaveAttribute(
      "aria-busy",
      "true",
    );
    expect(
      screen.queryByTestId("report-sku-mix-pending"),
    ).not.toBeInTheDocument();
  });

  it("never shows the building affordance on sync-path day clicks", () => {
    useQuery.mockImplementation((functionReference: unknown, args: unknown) => {
      if (args === "skip") return undefined;
      const functionName = getFunctionName(functionReference as never);
      if (functionName === "reports/queries:listRangeSkuMix") {
        return {
          totalUnitsSold: 3,
          skuCount: 1,
          rows: [
            {
              key: "sku-1",
              productSkuId: "sku-1",
              label: "WIG-A",
              unitsSold: 3,
              shareBasisPoints: 10_000,
              identity: { displayName: "Oshe", sku: "WIG-A" },
            },
          ],
        };
      }
      return [
        {
          operatingDate: "2026-07-28",
          status: "reconciled",
          currency: "USD",
          netSalesMinor: 1_200,
          unitsSold: 3,
        },
      ];
    });

    const syncProps = {
      ...baseProps,
      endDate: "2026-07-28",
      startDate: "2026-07-27",
    };
    const { rerender } = render(
      <ReportDaysPanel {...syncProps} selectedDate="2026-07-28" />,
    );
    // Day-to-day sync swaps resolve instantly; a building treatment here
    // would flash on every click.
    rerender(<ReportDaysPanel {...syncProps} selectedDate="2026-07-27" />);

    expect(ensureMixRange).not.toHaveBeenCalled();
    expect(
      screen.queryByTestId("report-sku-mix-building"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("report-sku-mix-chart")).toHaveAttribute(
      "data-building",
      "false",
    );
    expect(screen.getByTestId("report-sku-mix-graphic")).not.toHaveClass(
      "saturate-50",
    );
    expect(screen.getByTestId("report-sku-mix-total")).not.toHaveClass(
      "invisible",
    );
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

    // A two-day selection is the widest span that stays on the synchronous
    // reader (REPORT_SKU_MIX_SYNC_MAX_DAYS); this test pins that path.
    render(
      <ReportDaysPanel
        {...baseProps}
        endDate="2026-07-28"
        startDate="2026-07-27"
      />,
    );

    expect(ensureMixRange).not.toHaveBeenCalled();
    const daysCard = screen.getByTestId("report-days-table-card");
    const skuMixCard = screen.getByTestId("report-sku-mix-chart");
    expect(skuMixCard).toHaveAttribute("data-animation-active", "false");
    expect(screen.getByTestId("report-sku-mix-graphic")).toHaveClass(
      "invisible",
    );
    expect(observe).toHaveBeenCalledWith(skuMixCard);
    expect(screen.getByTestId("report-days-heading")).toBeInTheDocument();
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
      startDate: "2026-07-27",
    });
    expect(screen.getByText("Other SKUs").closest("a")).not.toBeInTheDocument();
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

    render(<ReportDaysPanel {...baseProps} selectedDate="2026-07-28" />);

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

    render(
      <ReportDaysPanel
        {...baseProps}
        endDate="2026-07-16"
        startDate="2026-07-15"
      />,
    );

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
    expect(screen.getByTestId("report-sku-mix-total")).toHaveClass("invisible");
    expect(
      screen.getByText("No product sales were recorded in this date range."),
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

    render(<ReportDaysPanel {...baseProps} selectedDate="2026-07-14" />);

    expect(
      screen.getByText("No product sales were recorded on Tue, Jul 14, 2026."),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("No product sales were recorded in this date range."),
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
      <ReportDaysPanel {...baseProps} selectedDate="2026-07-25" />,
    );
    const settledChartSurface = screen.getByTestId("report-sku-mix-graphic");
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
    rerender(<ReportDaysPanel {...baseProps} selectedDate="2026-07-29" />);

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
    expect(screen.getByTestId("report-sku-mix-number")).toHaveTextContent("1");
    expect(screen.getByTestId("report-sku-mix-total")).toHaveAccessibleName(
      "1 unit across products",
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
      <ReportDaysPanel {...baseProps} selectedDate="2026-07-29" />,
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
    rerender(<ReportDaysPanel {...baseProps} selectedDate="2026-07-28" />);
    expect(screen.getByTestId("report-sku-mix-chart")).toHaveAttribute(
      "data-exiting",
      "false",
    );

    skuMix = {
      totalUnitsSold: 0,
      skuCount: 0,
      rows: [],
    };
    rerender(<ReportDaysPanel {...baseProps} selectedDate="2026-07-25" />);

    expect(screen.getByTestId("report-sku-mix-chart")).toHaveAttribute(
      "data-exiting",
      "true",
    );
    expect(screen.getByLabelText("Product sales legend")).toHaveAttribute(
      "data-exiting",
      "true",
    );
    expect(screen.getByTestId("report-sku-mix-total")).toHaveAccessibleName(
      "12 units across products",
    );
    expect(
      screen.queryByTestId("report-sku-mix-empty"),
    ).not.toBeInTheDocument();

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

    const twoDayProps = {
      ...baseProps,
      endDate: "2026-07-16",
      startDate: "2026-07-15",
    };
    const { rerender } = render(<ReportDaysPanel {...twoDayProps} />);

    expect(screen.getByTestId("report-sku-mix-total")).toHaveAccessibleName(
      "10 units across products",
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
    rerender(<ReportDaysPanel {...twoDayProps} />);

    expect(screen.getByTestId("report-sku-mix-total")).toHaveAccessibleName(
      "7 units across products",
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

// ---------------------------------------------------------------------------
// Span-routed SKU mix (U5): <=2 inclusive days stays on the synchronous
// reader forever; longer spans use the admitted snapshot lifecycle.
// ---------------------------------------------------------------------------

const MIX_REQUEST_KEY = "mix:days-panel";

const dayRows = [
  {
    operatingDate: "2026-07-28",
    status: "provisional",
    currency: "USD",
    netSalesMinor: 1_200,
    unitsSold: 10,
  },
];

const rangeMixData = {
  totalUnitsSold: 10,
  skuCount: 7,
  rows: [
    {
      key: "sku-1",
      productSkuId: "sku-1",
      label: "WIG-A",
      unitsSold: 6,
      shareBasisPoints: 6_000,
      identity: { displayName: "Range Product", sku: "WIG-A" },
    },
    {
      key: "other",
      label: "Other SKUs",
      unitsSold: 4,
      shareBasisPoints: 4_000,
    },
  ],
};

const dayMixData = {
  totalUnitsSold: 5,
  skuCount: 1,
  rows: [
    {
      key: "sku-9",
      productSkuId: "sku-9",
      label: "WIG-D",
      unitsSold: 5,
      shareBasisPoints: 10_000,
      identity: { displayName: "Day Product", sku: "WIG-D" },
    },
  ],
};

const completedMixLifecycle = {
  state: "completed" as const,
  totals: { totalUnitsSold: 10, skuCount: 7 },
  completedAt: 1_754_000_000_000,
};

function mixVisibleResult(
  lifecycle: unknown,
  data: unknown,
  range: { startDate: string; endDate: string },
) {
  return {
    requestKey: MIX_REQUEST_KEY,
    startDate: range.startDate,
    endDate: range.endDate,
    lifecycle,
    data,
  };
}

/** Dispatch mocked Convex reads by function name, honoring "skip". */
function installMixQueries(fixture: {
  syncMix?: unknown;
  mixVisible?: unknown;
}) {
  useQuery.mockImplementation((reference: unknown, args: unknown) => {
    if (args === "skip") return undefined;
    const name = getFunctionName(reference as never);
    if (name === "reports/queries:listRangeSkuMix") return fixture.syncMix;
    if (name === "reports/skuMixRange:getMixRangeVisible") {
      return fixture.mixVisible;
    }
    if (name === "reports/queries:listDays") return dayRows;
    return undefined;
  });
}

function liveMixReaderCalls() {
  return useQuery.mock.calls.filter(
    ([reference, args]) =>
      args !== "skip" &&
      getFunctionName(reference as never) === "reports/queries:listRangeSkuMix",
  );
}

describe("ReportDaysPanel SKU mix span routing", () => {
  it("keeps one- and two-day selections synchronous with zero admission", () => {
    installMixQueries({ syncMix: dayMixData });

    // Single day (the ambient day click).
    const { rerender } = render(
      <ReportDaysPanel {...baseProps} selectedDate="2026-07-28" />,
    );
    expect(liveMixReaderCalls().map(([, args]) => args)).toContainEqual({
      storeId: "store-1",
      startDate: "2026-07-28",
      endDate: "2026-07-28",
    });

    // Two-day range: still provably under the sync reader's row cap.
    useQuery.mockClear();
    rerender(
      <ReportDaysPanel
        {...baseProps}
        endDate="2026-07-28"
        startDate="2026-07-27"
      />,
    );
    expect(liveMixReaderCalls().map(([, args]) => args)).toContainEqual({
      storeId: "store-1",
      startDate: "2026-07-27",
      endDate: "2026-07-28",
    });

    // Day-clicking through many days consumes zero admission budget.
    for (let offset = 0; offset < 10; offset += 1) {
      rerender(
        <ReportDaysPanel
          {...baseProps}
          selectedDate={isoDateOffset("2026-07-15", offset)}
        />,
      );
    }
    expect(ensureMixRange).not.toHaveBeenCalled();
    expect(
      useQuery.mock.calls.some(
        ([reference, args]) =>
          args !== "skip" &&
          getFunctionName(reference as never) ===
            "reports/skuMixRange:getMixRangeVisible",
      ),
    ).toBe(false);
  });

  it("routes a three-day range through the lifecycle and renders completed data", async () => {
    ensureMixRange.mockResolvedValue({
      requestKey: MIX_REQUEST_KEY,
      lifecycle: { state: "queued_pending" },
    });
    installMixQueries({
      mixVisible: mixVisibleResult(completedMixLifecycle, rangeMixData, {
        startDate: "2026-07-26",
        endDate: "2026-07-28",
      }),
    });

    render(
      <ReportDaysPanel
        {...baseProps}
        endDate="2026-07-28"
        startDate="2026-07-26"
      />,
    );

    expect(liveMixReaderCalls()).toHaveLength(0);
    await waitFor(() =>
      expect(screen.getByText("Range Product")).toBeInTheDocument(),
    );
    expect(ensureMixRange).toHaveBeenCalledTimes(1);
    expect(ensureMixRange).toHaveBeenCalledWith({
      storeId: "store-1",
      startDate: "2026-07-26",
      endDate: "2026-07-28",
    });

    // Rows, shares, and detail links all describe the settled range.
    expect(screen.getByText("60%")).toBeInTheDocument();
    const detailLink = screen.getByRole("link", { name: /Range Product/ });
    expect(JSON.parse(detailLink.dataset.search ?? "{}")).toEqual({
      endDate: "2026-07-28",
      o: expect.any(String),
      startDate: "2026-07-26",
    });
    // The Other bucket renders without a detail link, as today.
    expect(screen.getByText("Other SKUs").closest("a")).toBeNull();
    expect(
      screen.queryByTestId("report-sku-mix-pending"),
    ).not.toBeInTheDocument();
  });

  it("shows the calm pending state while queued, never partial data", async () => {
    ensureMixRange.mockResolvedValue({
      requestKey: MIX_REQUEST_KEY,
      lifecycle: { state: "queued_pending" },
    });
    installMixQueries({
      mixVisible: mixVisibleResult({ state: "queued_pending" }, null, {
        startDate: "2026-07-26",
        endDate: "2026-07-28",
      }),
    });

    render(
      <ReportDaysPanel
        {...baseProps}
        endDate="2026-07-28"
        startDate="2026-07-26"
      />,
    );

    await waitFor(() =>
      expect(screen.getByTestId("report-sku-mix-pending")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("report-sku-mix-pending")).toHaveAttribute(
      "role",
      "status",
    );
    expect(screen.getByText("Preparing product mix")).toBeInTheDocument();
    expect(
      screen.queryByLabelText("Product sales legend"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("report-sku-mix-total"),
    ).not.toBeInTheDocument();
  });

  it("surfaces a sanitized terminal error with a reference and retry", async () => {
    const user = userEvent.setup();
    ensureMixRange.mockResolvedValue({
      requestKey: MIX_REQUEST_KEY,
      lifecycle: { state: "queued_pending" },
    });
    retryMixRange.mockResolvedValue({
      requestKey: MIX_REQUEST_KEY,
      lifecycle: { state: "queued_pending" },
    });
    installMixQueries({
      mixVisible: mixVisibleResult(
        {
          state: "terminal_error",
          errorCode: "mix_worker_failed",
          correlationId: "corr-77",
        },
        null,
        { startDate: "2026-07-26", endDate: "2026-07-28" },
      ),
    });

    render(
      <ReportDaysPanel
        {...baseProps}
        endDate="2026-07-28"
        startDate="2026-07-26"
      />,
    );

    await waitFor(() =>
      expect(screen.getByTestId("report-sku-mix-error")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("report-sku-mix-error")).toHaveAttribute(
      "role",
      "alert",
    );
    expect(screen.getByText("Reference: corr-77")).toBeInTheDocument();
    // Internal error codes never reach the surface.
    expect(screen.queryByText(/mix_worker_failed/)).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText("Product sales legend"),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(retryMixRange).toHaveBeenCalledWith({
      storeId: "store-1",
      requestKey: MIX_REQUEST_KEY,
    });
  });

  it("re-calls ensure on the server interval and stops on unmount", async () => {
    vi.useFakeTimers();
    ensureMixRange.mockImplementation(async () => ({
      requestKey: null,
      lifecycle: { state: "waiting", retryAfterMs: 15_000 },
    }));
    installMixQueries({});

    const { unmount } = render(
      <ReportDaysPanel
        {...baseProps}
        endDate="2026-07-28"
        startDate="2026-07-26"
      />,
    );
    await act(async () => {});
    expect(ensureMixRange).toHaveBeenCalledTimes(1);
    expect(ensureMixRange).toHaveBeenCalledWith({
      storeId: "store-1",
      startDate: "2026-07-26",
      endDate: "2026-07-28",
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect(ensureMixRange).toHaveBeenCalledTimes(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect(ensureMixRange).toHaveBeenCalledTimes(3);

    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(ensureMixRange).toHaveBeenCalledTimes(3);
  });

  it("collapses to a single polling timer under StrictMode double effects", async () => {
    vi.useFakeTimers();
    ensureMixRange.mockImplementation(async () => ({
      requestKey: null,
      lifecycle: { state: "backpressure", retryAfterMs: 10_000 },
    }));
    installMixQueries({});

    render(
      <StrictMode>
        <ReportDaysPanel
          {...baseProps}
          endDate="2026-07-28"
          startDate="2026-07-26"
        />
      </StrictMode>,
    );
    await act(async () => {});
    expect(screen.getByText("Taking a little longer")).toBeInTheDocument();
    expect(screen.queryByText(/capacity/i)).not.toBeInTheDocument();
    // The duplicated mount may call the idempotent ensure once per effect run.
    const initialCalls = ensureMixRange.mock.calls.length;
    expect(initialCalls).toBeLessThanOrEqual(2);

    // But exactly ONE timer may fire per interval — never a stacked pair.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(ensureMixRange).toHaveBeenCalledTimes(initialCalls + 1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(ensureMixRange).toHaveBeenCalledTimes(initialCalls + 2);
  });

  it("keeps settled rows, links, and the units sheet range coherent across path transitions", async () => {
    const user = userEvent.setup();
    ensureMovementRange.mockResolvedValue({
      requestKey: null,
      lifecycle: { state: "waiting", retryAfterMs: 60_000 },
    });
    installMixQueries({ syncMix: dayMixData });

    // Settle the synchronous single-day path first.
    const { rerender } = render(
      <ReportDaysPanel {...baseProps} selectedDate="2026-07-28" />,
    );
    expect(screen.getByText("Day Product")).toBeInTheDocument();
    expect(
      JSON.parse(
        screen.getByRole("link", { name: /Day Product/ }).dataset.search ??
          "{}",
      ),
    ).toEqual({
      o: expect.any(String),
      periodDate: "2026-07-28",
      periodType: "day",
    });

    // Switch to a multi-day range whose snapshot never completes: the
    // settled day data stays on screen and every label still describes it.
    rerender(<ReportDaysPanel {...baseProps} />);
    expect(screen.getByText("Day Product")).toBeInTheDocument();
    expect(
      JSON.parse(
        screen.getByRole("link", { name: /Day Product/ }).dataset.search ??
          "{}",
      ),
    ).toEqual({
      o: expect.any(String),
      periodDate: "2026-07-28",
      periodType: "day",
    });
    // No competing pending skeleton while settled data is on screen.
    expect(
      screen.queryByTestId("report-sku-mix-pending"),
    ).not.toBeInTheDocument();

    // The Units moved sheet sources its range from the SAME settled pair.
    await user.click(
      screen.getByRole("button", { name: "View item movement" }),
    );
    await waitFor(() =>
      expect(ensureMovementRange).toHaveBeenCalledWith({
        storeId: "store-1",
        startDate: "2026-07-28",
        endDate: "2026-07-28",
      }),
    );
  });

  it("renders a revisited completed range without a pending state", async () => {
    ensureMixRange.mockResolvedValue({
      requestKey: MIX_REQUEST_KEY,
      lifecycle: completedMixLifecycle,
    });
    installMixQueries({
      syncMix: dayMixData,
      mixVisible: mixVisibleResult(completedMixLifecycle, rangeMixData, {
        startDate: "2026-07-26",
        endDate: "2026-07-28",
      }),
    });

    const threeDayProps = {
      ...baseProps,
      endDate: "2026-07-28",
      startDate: "2026-07-26",
    };
    const { rerender } = render(<ReportDaysPanel {...threeDayProps} />);
    await waitFor(() =>
      expect(screen.getByText("Range Product")).toBeInTheDocument(),
    );

    // Detour through a day selection (sync), then revisit the same range.
    rerender(<ReportDaysPanel {...threeDayProps} selectedDate="2026-07-28" />);
    expect(screen.getByText("Day Product")).toBeInTheDocument();

    rerender(<ReportDaysPanel {...threeDayProps} />);
    // The settled day data holds until the deduped snapshot answers — the
    // pending state never appears on a revisit.
    expect(
      screen.queryByTestId("report-sku-mix-pending"),
    ).not.toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByText("Range Product")).toBeInTheDocument(),
    );
    expect(
      screen.queryByTestId("report-sku-mix-pending"),
    ).not.toBeInTheDocument();
  });
});
