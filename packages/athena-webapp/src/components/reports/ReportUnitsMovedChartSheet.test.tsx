import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { cloneElement, StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getFunctionName } from "convex/server";

import type { ReportMovementLifecycle } from "~/shared/reportsContract";

const state = vi.hoisted(() => ({
  ensure: vi.fn(),
  retry: vi.fn(),
  useQuery: vi.fn(),
  reducedMotion: false,
  /** `null` = real store; `{kind:"shared_demo"}` = demo. */
  sharedDemoContext: null as { kind: string; storeId?: string } | null | undefined,
}));

vi.mock("convex/react", () => ({
  useQuery: (...args: unknown[]) => state.useQuery(...args),
  useMutation: (reference: unknown) =>
    getFunctionName(reference as never).endsWith("retryMovementRange")
      ? state.retry
      : state.ensure,
}));
vi.mock("@/hooks/useGetActiveStore", () => ({
  default: () => ({ activeStore: { _id: "store-1" } }),
}));
vi.mock("@/hooks/useSharedDemoContext", () => ({
  useSharedDemoContext: () => state.sharedDemoContext,
}));
vi.mock("framer-motion", () => ({
  useReducedMotion: () => state.reducedMotion,
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
    params?: unknown;
    search?: unknown;
    to: string;
  }) => (
    <a
      data-params={params ? JSON.stringify(params) : undefined}
      data-search={search ? JSON.stringify(search) : undefined}
      href={to}
      {...props}
    >
      {children}
    </a>
  ),
}));
vi.mock("recharts", () => ({
  Bar: ({
    children,
    isAnimationActive,
  }: {
    children?: React.ReactNode;
    isAnimationActive?: boolean;
  }) => (
    <div
      data-animation-active={String(Boolean(isAnimationActive))}
      data-testid="units-bar"
    >
      {children}
    </div>
  ),
  BarChart: ({
    children,
    data,
  }: {
    children?: React.ReactNode;
    data: unknown;
  }) => (
    <div data-chart-data={JSON.stringify(data)} data-testid="units-chart">
      {children}
    </div>
  ),
  CartesianGrid: () => null,
  Cell: ({ radius }: { radius?: unknown }) => (
    <div data-radius={JSON.stringify(radius)} data-testid="units-bar-cell" />
  ),
  Legend: () => null,
  ReferenceLine: ({ x }: { x?: number }) => (
    <div data-testid="units-zero-line" data-x={String(x)} />
  ),
  ResponsiveContainer: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  Tooltip: () => null,
  XAxis: ({
    domain,
    tickFormatter,
  }: {
    domain?: unknown;
    tickFormatter?: (value: number) => string;
  }) => (
    <div
      data-domain={JSON.stringify(domain)}
      // What a negative axis position renders as: magnitudes stay unsigned.
      data-tick={tickFormatter ? tickFormatter(-24) : undefined}
      data-testid="units-x-axis"
    />
  ),
  YAxis: ({
    tick,
    width,
  }: {
    tick?: React.ReactElement;
    width?: number;
  }) => (
    <svg data-testid="units-y-axis" data-width={width}>
      {tick
        ? ["sku-1", "sku-2", "sku-3"].map((value) =>
            cloneElement(
              tick as React.ReactElement<{
                payload?: { value?: string };
              }>,
              { key: value, payload: { value } },
            ),
          )
        : null}
    </svg>
  ),
}));

import {
  formatNetUnitsMoved,
  movementBarRadius,
  movementChartDomain,
  ReportUnitsMovedChartSheet,
} from "./ReportUnitsMovedChartSheet";
import { createSharedDemoReportMovementPage } from "@/components/shared-demo/sharedDemoReportsFixture";
import { getLocalOperatingDate } from "@/lib/operations/operatingDate";

const REQUEST_KEY = "movement:abc123";

const baseProps = {
  currency: "USD",
  orgUrlSlug: "acme",
  periodEndDate: "2026-07-12",
  periodStartDate: "2026-07-06",
  scrollContextKey: "test-context",
  storeUrlSlug: "downtown",
};

const totals25 = {
  unitsSold: 400,
  unitsReturned: 120,
  netUnits: 280,
  skuCount: 25,
};

function completedLifecycle(
  totals = totals25,
): Extract<ReportMovementLifecycle, { state: "completed" }> {
  return {
    state: "completed",
    totals,
    completedAt: 1_754_000_000_000,
    pageCount: Math.max(1, Math.ceil(totals.skuCount / 20)),
  };
}

function movementRow(
  rank: number,
  netUnits: number,
  overrides: Record<string, unknown> = {},
) {
  const unitsSold = Math.max(netUnits, 0) + 2;
  return {
    key: `sku-${rank}`,
    productSkuId: `sku-${rank}`,
    label: `SKU-${rank}`,
    unitsSold,
    unitsReturned: unitsSold - netUnits,
    netUnits,
    rank,
    identity: {
      displayName: `Product ${rank}`,
      sku: `SKU-${rank}`,
      netPriceMinor: 4_500,
    },
    ...overrides,
  };
}

type QueryFixture = {
  header?: unknown;
  pages?: Record<number, unknown>;
};

/** Dispatch mocked Convex reads by function name, honoring "skip". */
function installQueries(fixture: QueryFixture) {
  state.useQuery.mockImplementation(
    (reference: unknown, args: unknown) => {
      if (args === "skip") return undefined;
      const name = getFunctionName(reference as never);
      if (name === "reports/skuMovementRange:getMovementRange") {
        return fixture.header;
      }
      if (name === "reports/skuMovementRange:getMovementRangePage") {
        return fixture.pages?.[(args as { page: number }).page];
      }
      return undefined;
    },
  );
}

function pageResult(page: number, rows: unknown[], totals = totals25) {
  const lifecycle = completedLifecycle(totals);
  return {
    requestKey: REQUEST_KEY,
    startDate: baseProps.periodStartDate,
    endDate: baseProps.periodEndDate,
    lifecycle,
    page,
    pageCount: lifecycle.pageCount,
    rows,
  };
}

function headerResult(lifecycle: ReportMovementLifecycle) {
  return {
    requestKey: REQUEST_KEY,
    startDate: baseProps.periodStartDate,
    endDate: baseProps.periodEndDate,
    lifecycle,
  };
}

function admitQueued() {
  state.ensure.mockResolvedValue({
    requestKey: REQUEST_KEY,
    lifecycle: { state: "queued_pending" },
  });
}

function expectShell() {
  const dialog = screen.getByRole("dialog", { name: "Item movement" });
  expect(
    within(dialog).getByText(/Net units by item for/),
  ).toBeInTheDocument();
  const tablist = within(dialog).getByRole("tablist", {
    name: "Item movement view",
  });
  expect(tablist).toHaveClass(
    "justify-start",
    "border",
    "bg-surface-raised",
    "shadow-surface",
  );
  const topMoversTab = within(tablist).getByRole("tab", {
    name: "Top movers",
  });
  const granularTab = within(tablist).getByRole("tab", {
    name: "All items",
  });
  expect(topMoversTab).toHaveClass(
    "min-h-8",
    "px-3",
    "data-[state=active]:bg-primary-soft",
  );
  expect(topMoversTab).not.toHaveClass("flex-1");
  expect(granularTab).toHaveClass(
    "min-h-8",
    "px-3",
    "data-[state=active]:bg-primary-soft",
  );
  expect(granularTab).not.toHaveClass("flex-1");
  return dialog;
}

afterEach(() => {
  vi.useRealTimers();
  state.ensure.mockReset();
  state.retry.mockReset();
  state.useQuery.mockReset();
  state.reducedMotion = false;
  state.sharedDemoContext = null;
});

describe("pure chart geometry", () => {
  it("computes symmetric zero-centered domains", () => {
    expect(movementChartDomain([{ units: -24 }, { units: 18 }])).toEqual([
      -24, 24,
    ]);
    expect(movementChartDomain([])).toEqual([-1, 1]);
  });

  it("rounds the outer corners on the direction the bar grows", () => {
    expect(movementBarRadius(12)).toEqual([0, 6, 6, 0]);
    expect(movementBarRadius(0)).toEqual([0, 6, 6, 0]);
    expect(movementBarRadius(-12)).toEqual([6, 0, 0, 6]);
  });

  it("formats net movement with direction words, never a sign", () => {
    expect(formatNetUnitsMoved(1_200)).toBe("1,200 out");
    expect(formatNetUnitsMoved(-24)).toBe("24 returned");
    expect(formatNetUnitsMoved(0)).toBe("0 net");
  });
});

describe("lifecycle state hierarchy", () => {
  it("keeps title, date, and tabs while the request is pending, with a polite status and no partial content", async () => {
    admitQueued();
    installQueries({
      header: headerResult({ state: "queued_pending" }),
    });

    render(<ReportUnitsMovedChartSheet {...baseProps} isOpen />);

    const dialog = expectShell();
    await waitFor(() =>
      expect(
        within(dialog).getByText("Preparing item movement"),
      ).toBeInTheDocument(),
    );
    const pendingStatus = within(dialog).getByTestId("units-moved-status");
    expect(pendingStatus).toHaveAttribute("role", "status");
    expect(pendingStatus).toHaveClass(
      "min-h-[20rem]",
      "items-center",
      "justify-center",
    );
    expect(
      within(pendingStatus).getByText(
        "Organizing item movement for this period.",
      ),
    ).toBeInTheDocument();
    expect(within(dialog).queryByRole("table")).not.toBeInTheDocument();
    expect(
      within(dialog).queryByText(/Showing/),
    ).not.toBeInTheDocument();
    expect(within(dialog).queryByTestId("units-chart")).not.toBeInTheDocument();
  });

  it("shows a calm not-available message with no retry loop", async () => {
    vi.useFakeTimers();
    state.ensure.mockResolvedValue({
      requestKey: null,
      lifecycle: { state: "not_available" },
    });
    installQueries({});

    render(<ReportUnitsMovedChartSheet {...baseProps} isOpen />);
    await act(async () => {});

    const dialog = expectShell();
    expect(
      within(dialog).getByText("Item movement is not available for this store."),
    ).toBeInTheDocument();
    expect(within(dialog).getByTestId("units-moved-status")).toHaveAttribute(
      "role",
      "status",
    );
    expect(
      within(dialog).queryByRole("button", { name: "Retry" }),
    ).not.toBeInTheDocument();

    // Terminal calm: no polling timer may re-invoke ensure.
    const calls = state.ensure.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(state.ensure).toHaveBeenCalledTimes(calls);
  });

  it("announces completed-empty once, politely, in either tab", async () => {
    const user = userEvent.setup();
    const emptyTotals = {
      unitsSold: 0,
      unitsReturned: 0,
      netUnits: 0,
      skuCount: 0,
    };
    admitQueued();
    installQueries({
      header: headerResult(completedLifecycle(emptyTotals)),
      pages: { 1: pageResult(1, [], emptyTotals) },
    });

    render(<ReportUnitsMovedChartSheet {...baseProps} isOpen />);

    const dialog = expectShell();
    await waitFor(() =>
      expect(
        within(dialog).getByText(
          "No SKU movement was recorded in this period.",
        ),
      ).toBeInTheDocument(),
    );
    expect(within(dialog).queryByRole("table")).not.toBeInTheDocument();
    expect(within(dialog).queryByText(/Page 1/)).not.toBeInTheDocument();

    await user.click(within(dialog).getByRole("tab", { name: "All items" }));
    expect(
      within(dialog).getByText("No SKU movement was recorded in this period."),
    ).toBeInTheDocument();
    expect(within(dialog).queryByText(/Page 1/)).not.toBeInTheDocument();
  });

  it("keeps the shell during a worker retry, with no partial rows and no client polling", async () => {
    vi.useFakeTimers();
    admitQueued();
    // A worker in retry_wait derives to queued_pending publicly.
    installQueries({ header: headerResult({ state: "queued_pending" }) });

    render(<ReportUnitsMovedChartSheet {...baseProps} isOpen />);
    await act(async () => {});

    const dialog = expectShell();
    expect(
      within(dialog).getByText("Preparing item movement"),
    ).toBeInTheDocument();
    expect(within(dialog).queryByRole("table")).not.toBeInTheDocument();

    // Admitted requests are watched through the subscription, not ensure polls.
    expect(state.ensure).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000);
    });
    expect(state.ensure).toHaveBeenCalledTimes(1);
  });
});

describe("admission polling", () => {
  it("re-calls ensure on the server-supplied interval and stops when the sheet closes", async () => {
    vi.useFakeTimers();
    // Fresh result objects per call, exactly like a real mutation round-trip.
    state.ensure.mockImplementation(async () => ({
      requestKey: null,
      lifecycle: { state: "waiting", retryAfterMs: 15_000 },
    }));
    installQueries({});

    const { rerender } = render(
      <ReportUnitsMovedChartSheet {...baseProps} isOpen />,
    );
    await act(async () => {});
    expect(state.ensure).toHaveBeenCalledTimes(1);
    expect(state.ensure).toHaveBeenCalledWith({
      storeId: "store-1",
      startDate: "2026-07-06",
      endDate: "2026-07-12",
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect(state.ensure).toHaveBeenCalledTimes(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect(state.ensure).toHaveBeenCalledTimes(3);

    // The status text stays put; retries are not re-announced.
    expect(screen.getByText("Preparing item movement")).toBeInTheDocument();

    rerender(<ReportUnitsMovedChartSheet {...baseProps} isOpen={false} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(state.ensure).toHaveBeenCalledTimes(3);
  });

  it("collapses to a single polling timer under StrictMode double effects", async () => {
    vi.useFakeTimers();
    state.ensure.mockImplementation(async () => ({
      requestKey: null,
      lifecycle: { state: "backpressure", retryAfterMs: 10_000 },
    }));
    installQueries({});

    render(
      <StrictMode>
        <ReportUnitsMovedChartSheet {...baseProps} isOpen />
      </StrictMode>,
    );
    await act(async () => {});
    // The duplicated mount may call the idempotent ensure once per effect run.
    const initialCalls = state.ensure.mock.calls.length;
    expect(initialCalls).toBeLessThanOrEqual(2);

    // But exactly ONE timer may fire per interval — never a stacked pair.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(state.ensure).toHaveBeenCalledTimes(initialCalls + 1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(state.ensure).toHaveBeenCalledTimes(initialCalls + 2);
  });

  it("stops polling and subscribes once the request is admitted", async () => {
    vi.useFakeTimers();
    state.ensure
      .mockResolvedValueOnce({
        requestKey: null,
        lifecycle: { state: "waiting", retryAfterMs: 15_000 },
      })
      .mockResolvedValue({
        requestKey: REQUEST_KEY,
        lifecycle: { state: "queued_pending" },
      });
    installQueries({ header: headerResult({ state: "queued_pending" }) });

    render(<ReportUnitsMovedChartSheet {...baseProps} isOpen />);
    await act(async () => {});
    expect(state.ensure).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect(state.ensure).toHaveBeenCalledTimes(2);

    // Admitted: the header subscription owns the lifecycle now.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000);
    });
    expect(state.ensure).toHaveBeenCalledTimes(2);
    expect(
      state.useQuery.mock.calls.some(
        (call) =>
          call[1] !== "skip" &&
          getFunctionName(call[0] as never) ===
            "reports/skuMovementRange:getMovementRange",
      ),
    ).toBe(true);
  });
});

describe("top movers", () => {
  const topRows = [
    movementRow(1, -24),
    movementRow(2, 18),
    movementRow(3, 11, { identity: undefined, label: "orphan-sku" }),
  ];

  function installCompleted(rows = topRows, totals = totals25) {
    admitQueued();
    installQueries({
      header: headerResult(completedLifecycle(totals)),
      pages: { 1: pageResult(1, rows, totals) },
    });
  }

  it("renders the ranked subset disclosure, signed chart values, metadata, and links in rank order", async () => {
    installCompleted();
    render(<ReportUnitsMovedChartSheet {...baseProps} isOpen />);

    const dialog = expectShell();
    await waitFor(() =>
      expect(within(dialog).getByTestId("units-chart")).toBeInTheDocument(),
    );

    // Count and subset disclosure: direction words, never a sign.
    expect(within(dialog).getByTestId("units-moved-count")).toHaveTextContent(
      "25 SKUs moved · 400 sold · 120 returned · net 280 out",
    );
    expect(within(dialog).getByTestId("top-movers-subset")).toHaveTextContent(
      "Showing the top 20 of 25 SKUs by absolute net movement.",
    );

    // Signed values reach the chart in rank order.
    const chartData = JSON.parse(
      within(dialog).getByTestId("units-chart").getAttribute(
        "data-chart-data",
      )!,
    ) as Array<{ key: string; units: number }>;
    expect(chartData.map((row) => [row.key, row.units])).toEqual([
      ["sku-1", -24],
      ["sku-2", 18],
      ["sku-3", 11],
    ]);

    // Zero-centered geometry: symmetric domain, zero line, direction-aware
    // corners per bar. Ticks read as unsigned magnitudes; the side labels
    // carry direction.
    expect(
      within(dialog).getByTestId("units-x-axis").getAttribute("data-domain"),
    ).toBe("[-24,24]");
    expect(within(dialog).getByTestId("units-x-axis")).toHaveAttribute(
      "data-tick",
      "24",
    );
    expect(within(dialog).getByTestId("units-zero-line")).toHaveAttribute(
      "data-x",
      "0",
    );
    const axisDirection = within(dialog).getByTestId("units-axis-direction");
    expect(axisDirection).toHaveTextContent(/^returned\s*out$/);
    expect(axisDirection.className).toContain("min-w-0");
    expect(
      within(dialog)
        .getAllByTestId("units-bar-cell")
        .map((cell) => cell.getAttribute("data-radius")),
    ).toEqual(["[6,0,0,6]", "[0,6,6,0]", "[0,6,6,0]"]);

    // Text alternative for the chart, in the same direction words.
    const summary = within(dialog).getByTestId("top-movers-summary");
    expect(summary).toHaveTextContent("the 20 largest of 25 moving SKUs");
    expect(summary).toHaveTextContent("Product 1, 24 units returned");
    expect(summary).toHaveTextContent("Product 2, 18 units out");
    expect(summary).not.toHaveTextContent("+18");
    expect(summary).not.toHaveTextContent("-24");

    // Item rows follow the chart, in the same order, with direction words.
    const rows = within(within(dialog).getByRole("table")).getAllByRole("row");
    expect(rows[1]).toHaveTextContent("Product 1");
    expect(rows[1]).toHaveTextContent("24 returned");
    expect(rows[1]).not.toHaveTextContent("-24");
    expect(rows[2]).toHaveTextContent("Product 2");
    expect(rows[2]).toHaveTextContent("18 out");
    expect(rows[2]).not.toHaveTextContent("+18");
    // Identity-less rows keep their raw label.
    expect(rows[3]).toHaveTextContent("orphan-sku");

    expect(
      within(dialog).getByTestId("unit-metadata-sku-1"),
    ).toHaveTextContent("SKU-1 · $45");

    const link = within(within(dialog).getByRole("table")).getByRole("link", {
      name: /Product 1/,
    });
    expect(JSON.parse(link.getAttribute("data-params") ?? "{}")).toEqual({
      orgUrlSlug: "acme",
      productSkuId: "sku-1",
      storeUrlSlug: "downtown",
    });
    const search = JSON.parse(link.getAttribute("data-search") ?? "{}");
    expect(search.startDate).toBe("2026-07-06");
    expect(search.endDate).toBe("2026-07-12");
    expect(typeof search.o).toBe("string");

    const chartLink = within(dialog).getByRole("link", {
      name: "View Product 1 SKU details from chart",
    });
    expect(JSON.parse(chartLink.getAttribute("data-params") ?? "{}")).toEqual({
      orgUrlSlug: "acme",
      productSkuId: "sku-1",
      storeUrlSlug: "downtown",
    });
    expect(JSON.parse(chartLink.getAttribute("data-search") ?? "{}")).toEqual(
      expect.objectContaining({
        endDate: "2026-07-12",
        startDate: "2026-07-06",
      }),
    );

    // Top movers never paginates.
    expect(within(dialog).queryByText(/Page 1 of/)).not.toBeInTheDocument();
  });

  it("gives long product names enough room without forcing them onto one line", async () => {
    const productName = "Nab Lace Tint Mousse Dark Brown";
    installCompleted([
      movementRow(1, 12, {
        identity: {
          displayName: productName,
          netPriceMinor: 4_500,
          sku: "KK38-DGB-W6V",
        },
      }),
    ]);

    render(<ReportUnitsMovedChartSheet {...baseProps} isOpen />);

    const dialog = expectShell();
    await waitFor(() =>
      expect(within(dialog).getByTestId("units-chart")).toBeInTheDocument(),
    );

    expect(dialog).toHaveClass(
      "w-[min(100vw,42rem)]",
      "sm:max-w-[42rem]",
    );
    expect(within(dialog).getByTestId("units-y-axis")).toHaveAttribute(
      "data-width",
      "184",
    );

    const chartLabel = dialog.querySelector(
      '[data-sheet-return-key="chart:sku-1"] > span',
    );
    expect(chartLabel).toHaveTextContent(productName);
    expect(chartLabel).toHaveClass("line-clamp-2");
    expect(chartLabel).not.toHaveClass("truncate");
  });

  it("omits the subset disclosure when every mover fits on one page", async () => {
    const smallTotals = {
      unitsSold: 30,
      unitsReturned: 12,
      netUnits: 18,
      skuCount: 2,
    };
    installCompleted([movementRow(1, -24), movementRow(2, 18)], smallTotals);
    render(<ReportUnitsMovedChartSheet {...baseProps} isOpen />);

    await waitFor(() =>
      expect(screen.getByTestId("units-chart")).toBeInTheDocument(),
    );
    expect(screen.queryByTestId("top-movers-subset")).not.toBeInTheDocument();
  });
});

describe("granular paging", () => {
  const page1Rows = Array.from({ length: 20 }, (_, index) =>
    movementRow(index + 1, 20 - index),
  );
  const page2Rows = Array.from({ length: 5 }, (_, index) =>
    movementRow(index + 21, -(5 - index)),
  );

  it("requests one 20-row interval, keeps the settled page coherent through a transition, and announces only when settled", async () => {
    const user = userEvent.setup();
    admitQueued();
    const fixture: QueryFixture = {
      header: headerResult(completedLifecycle()),
      pages: { 1: pageResult(1, page1Rows) },
    };
    installQueries(fixture);

    const { rerender } = render(
      <ReportUnitsMovedChartSheet {...baseProps} isOpen />,
    );
    const dialog = expectShell();
    await waitFor(() =>
      expect(within(dialog).getByTestId("units-chart")).toBeInTheDocument(),
    );

    await user.click(within(dialog).getByRole("tab", { name: "All items" }));

    const granularPanel = within(dialog).getByRole("tabpanel");
    expect(within(granularPanel).getByRole("table")).toBeInTheDocument();
    expect(within(granularPanel).getByText("Page 1 of 2")).toBeInTheDocument();
    expect(within(granularPanel).getByRole("status")).toHaveTextContent(
      "Showing 1-20 of 25",
    );
    expect(within(granularPanel).getAllByRole("row")).toHaveLength(21);

    // Only 20-row intervals were ever requested, one at a time.
    const requestedPages = state.useQuery.mock.calls
      .filter(
        (call) =>
          call[1] !== "skip" &&
          getFunctionName(call[0] as never) ===
            "reports/skuMovementRange:getMovementRangePage",
      )
      .map((call) => (call[1] as { page: number }).page);
    expect(new Set(requestedPages)).toEqual(new Set([1]));

    // Page 2 does not settle yet: retained rows keep the settled page label.
    await user.click(
      within(granularPanel).getByRole("button", { name: "Go to next page" }),
    );
    expect(within(granularPanel).getByText("Page 1 of 2")).toBeInTheDocument();
    expect(within(granularPanel).getByText("Product 1")).toBeInTheDocument();
    expect(
      within(dialog).getByRole("tabpanel").querySelector("[aria-busy='true']"),
    ).not.toBeNull();

    // Overlapping page actions are ignored until the new page settles.
    await user.click(
      within(granularPanel).getByRole("button", { name: "Go to next page" }),
    );
    const pagesAfterDoubleClick = state.useQuery.mock.calls
      .filter(
        (call) =>
          call[1] !== "skip" &&
          getFunctionName(call[0] as never) ===
            "reports/skuMovementRange:getMovementRangePage",
      )
      .map((call) => (call[1] as { page: number }).page);
    expect(new Set(pagesAfterDoubleClick)).toEqual(new Set([1, 2]));

    // Page 2 settles: rows, page label, and announcement move together.
    fixture.pages![2] = pageResult(2, page2Rows);
    rerender(<ReportUnitsMovedChartSheet {...baseProps} isOpen />);

    await waitFor(() =>
      expect(
        within(within(dialog).getByRole("tabpanel")).getByText("Page 2 of 2"),
      ).toBeInTheDocument(),
    );
    const settledPanel = within(dialog).getByRole("tabpanel");
    expect(within(settledPanel).getByText("Product 21")).toBeInTheDocument();
    expect(
      within(settledPanel).queryByText("Product 1"),
    ).not.toBeInTheDocument();
    expect(within(settledPanel).getByRole("status")).toHaveTextContent(
      "Showing 21-25 of 25",
    );
    expect(settledPanel.querySelector("[aria-busy='true']")).toBeNull();
    expect(within(settledPanel).getAllByRole("row")).toHaveLength(6);
  });
});

describe("terminal error and manual retry", () => {
  it("shows the generic assertive error with correlation id and an explicit retry action", async () => {
    admitQueued();
    installQueries({
      header: headerResult({
        state: "terminal_error",
        errorCode: "movement_worker_failed",
        correlationId: "corr-7",
      }),
    });

    render(<ReportUnitsMovedChartSheet {...baseProps} isOpen />);

    const dialog = expectShell();
    await waitFor(() =>
      expect(within(dialog).getByRole("alert")).toBeInTheDocument(),
    );
    const alert = within(dialog).getByRole("alert");
    expect(alert).toHaveTextContent("Item movement could not be prepared");
    expect(alert).toHaveTextContent("Reference: corr-7");
    // Never blame range size, never leak internals.
    expect(alert).not.toHaveTextContent(/range|too (large|big|many)/i);
    expect(alert).not.toHaveTextContent(/movement_worker_failed/);
    expect(
      within(alert).getByRole("button", { name: "Retry" }),
    ).toBeInTheDocument();
    expect(within(dialog).queryByRole("table")).not.toBeInTheDocument();
  });

  it("retries through the retry mutation and moves focus to the error heading when the retry fails", async () => {
    const user = userEvent.setup();
    admitQueued();
    installQueries({
      header: headerResult({
        state: "terminal_error",
        errorCode: "movement_worker_failed",
        correlationId: "corr-7",
      }),
    });
    state.retry.mockResolvedValue({
      requestKey: REQUEST_KEY,
      lifecycle: {
        state: "terminal_error",
        errorCode: "movement_worker_failed",
        correlationId: "corr-8",
      },
    });

    render(<ReportUnitsMovedChartSheet {...baseProps} isOpen />);
    const dialog = expectShell();
    await waitFor(() =>
      expect(within(dialog).getByRole("alert")).toBeInTheDocument(),
    );

    await user.click(within(dialog).getByRole("button", { name: "Retry" }));

    expect(state.retry).toHaveBeenCalledWith({
      storeId: "store-1",
      requestKey: REQUEST_KEY,
    });
    const heading = within(dialog).getByRole("heading", {
      name: "Item movement could not be prepared",
    });
    await waitFor(() => expect(heading).toHaveFocus());
  });
});

describe("shared demo", () => {
  it("serves demo pages synchronously without live reads or generation calls", async () => {
    const user = userEvent.setup();
    state.sharedDemoContext = { kind: "shared_demo", storeId: "store-1" };
    state.useQuery.mockReturnValue(undefined);
    const endDate = getLocalOperatingDate();
    const start = new Date(`${endDate}T00:00:00.000Z`);
    start.setUTCDate(start.getUTCDate() - 13);
    const startDate = start.toISOString().slice(0, 10);

    render(
      <ReportUnitsMovedChartSheet
        {...baseProps}
        isOpen
        periodEndDate={endDate}
        periodStartDate={startDate}
      />,
    );

    const dialog = expectShell();
    expect(state.ensure).not.toHaveBeenCalled();
    // Demo mode opens no read the fixture answers. The only live reads are
    // for the current operating day — more than one view may ask, and Convex
    // dedupes identical subscriptions into one.
    const liveReads = state.useQuery.mock.calls.filter((call) => call[1] !== "skip");
    expect(liveReads.length).toBeGreaterThan(0);
    for (const [, args] of liveReads) {
      // Two reads the fixture cannot answer: the current operating day, and
      // current stock. Everything else is answered locally.
      expect(args).toEqual(
        expect.objectContaining({ storeId: "store-1" }),
      );
      expect(Object.keys(args as object).sort()).toEqual(
        (args as { operatingDate?: string }).operatingDate
          ? ["operatingDate", "storeId"]
          : ["storeId"],
      );
    }

    const demo = createSharedDemoReportMovementPage({
      startDate,
      endDate,
    });
    expect(demo.rows.length).toBeGreaterThan(0);
    expect(within(dialog).getByTestId("units-chart")).toBeInTheDocument();
    expect(within(dialog).getByTestId("units-moved-count")).toHaveTextContent(
      `${demo.lifecycle.totals.skuCount} SKU`,
    );

    // The granular tab pages the same fixture: still no movement read, and
    // no read beyond the shared current-day subscription.
    await user.click(within(dialog).getByRole("tab", { name: "All items" }));
    expect(
      within(within(dialog).getByRole("tabpanel")).getByRole("table"),
    ).toBeInTheDocument();
    for (const [, args] of state.useQuery.mock.calls.filter(
      (call) => call[1] !== "skip",
    )) {
      // The operating day and current stock — the two reads the fixture
      // cannot answer.
      expect(args).toEqual(expect.objectContaining({ storeId: "store-1" }));
      expect(Object.keys(args as object).sort()).toEqual(
        (args as { operatingDate?: string }).operatingDate
          ? ["operatingDate", "storeId"]
          : ["storeId"],
      );
    }
    expect(state.ensure).not.toHaveBeenCalled();
  });
});

describe("accessibility and layout", () => {
  function installCompletedSmall() {
    const totals = {
      unitsSold: 30,
      unitsReturned: 12,
      netUnits: 18,
      skuCount: 2,
    };
    admitQueued();
    installQueries({
      header: headerResult(completedLifecycle(totals)),
      pages: {
        1: pageResult(1, [movementRow(1, -24), movementRow(2, 18)], totals),
      },
    });
  }

  it("wires native tab semantics with arrow-key focus movement inside the dialog", async () => {
    const user = userEvent.setup();
    installCompletedSmall();
    render(<ReportUnitsMovedChartSheet {...baseProps} isOpen />);

    const dialog = expectShell();
    await waitFor(() =>
      expect(within(dialog).getByTestId("units-chart")).toBeInTheDocument(),
    );

    const topTab = within(dialog).getByRole("tab", { name: "Top movers" });
    const granularTab = within(dialog).getByRole("tab", { name: "All items" });
    expect(topTab).toHaveAttribute("aria-selected", "true");

    topTab.focus();
    await user.keyboard("{ArrowRight}");
    expect(granularTab).toHaveFocus();
    await waitFor(() =>
      expect(granularTab).toHaveAttribute("aria-selected", "true"),
    );
    expect(
      within(within(dialog).getByRole("tabpanel")).getByRole("table"),
    ).toBeInTheDocument();

    await user.keyboard("{ArrowLeft}");
    expect(topTab).toHaveFocus();
    await waitFor(() =>
      expect(topTab).toHaveAttribute("aria-selected", "true"),
    );

    // Dialog focus order: the tabs come before the tab panel content.
    const tablist = within(dialog).getByRole("tablist");
    const panel = within(dialog).getByRole("tabpanel");
    expect(
      tablist.compareDocumentPosition(panel) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("keeps a full-width sheet and 44px tab targets at narrow widths", async () => {
    installCompletedSmall();
    render(<ReportUnitsMovedChartSheet {...baseProps} isOpen />);

    const dialog = expectShell();
    expect(dialog.className).toContain("w-[min(100vw,42rem)]");
    for (const tab of within(dialog).getAllByRole("tab")) {
      expect(tab.className).toContain("h-11");
    }
    await waitFor(() =>
      expect(within(dialog).getByTestId("units-chart")).toBeInTheDocument(),
    );
    // Secondary identity metadata wraps rather than clipping the SKU.
    expect(within(dialog).getByTestId("unit-metadata-sku-1").className).toContain(
      "break-words",
    );
  });
});

describe("cross-navigation continuity (U6)", () => {
  const totalsSmall = {
    unitsSold: 30,
    unitsReturned: 12,
    netUnits: 18,
    skuCount: 2,
  };

  it("captures the live report scroll offset and delegates drill-down navigation to the route", async () => {
    admitQueued();
    installQueries({
      header: headerResult(completedLifecycle(totalsSmall)),
      pages: {
        1: pageResult(1, [movementRow(1, -24), movementRow(2, 18)], totalsSmall),
      },
    });
    const onSkuLinkNavigate = vi.fn();
    const scrollHeightSpy = vi
      .spyOn(HTMLElement.prototype, "scrollHeight", "get")
      .mockImplementation(function (this: HTMLElement) {
        return this.dataset.testid === "report-scroll-container" ? 2_000 : 0;
      });
    const clientHeightSpy = vi
      .spyOn(HTMLElement.prototype, "clientHeight", "get")
      .mockImplementation(function (this: HTMLElement) {
        return this.dataset.testid === "report-scroll-container" ? 600 : 0;
      });

    try {
      render(
        <div
          data-testid="report-scroll-container"
          style={{ overflowY: "auto" }}
        >
          <ReportUnitsMovedChartSheet
            {...baseProps}
            isOpen
            onSkuLinkNavigate={onSkuLinkNavigate}
          />
        </div>,
      );
      screen.getByTestId("report-scroll-container").scrollTop = 640;

      const dialog = expectShell();
      await waitFor(() =>
        expect(
          within(dialog).getByRole("link", {
            name: "View Product 1 SKU details from chart",
          }),
        ).toBeInTheDocument(),
      );

      fireEvent.click(
        within(dialog).getByRole("link", {
          name: "View Product 1 SKU details from chart",
        }),
      );
      fireEvent.click(
        within(dialog).getByRole("link", {
          name: "View Product 1 SKU details from chart",
        }),
      );

      expect(onSkuLinkNavigate).toHaveBeenCalledTimes(1);
      expect(onSkuLinkNavigate).toHaveBeenCalledWith({
        endDate: baseProps.periodEndDate,
        focusSurface: "chart",
        productSkuId: "sku-1",
        scrollOffset: 640,
        startDate: baseProps.periodStartDate,
      });
    } finally {
      scrollHeightSpy.mockRestore();
      clientHeightSpy.mockRestore();
    }
  });

  it("follows the served payload when the requested Granular page canonicalizes", async () => {
    admitQueued();
    // The server answers an out-of-range page 9 with its canonical page 2.
    installQueries({
      header: headerResult(completedLifecycle()),
      pages: {
        9: pageResult(2, [movementRow(21, -5)]),
      },
    });
    const onGranularPageChange = vi.fn();

    render(
      <ReportUnitsMovedChartSheet
        {...baseProps}
        activeTab="granular"
        granularPage={9}
        isOpen
        onGranularPageChange={onGranularPageChange}
      />,
    );

    await waitFor(() =>
      expect(onGranularPageChange).toHaveBeenCalledWith(2),
    );
  });

  it("completes a restoration with no matching SKU by focusing the Granular tab and announcing", async () => {
    admitQueued();
    installQueries({
      header: headerResult(completedLifecycle(totalsSmall)),
      pages: {
        1: pageResult(1, [movementRow(1, -24), movementRow(2, 18)], totalsSmall),
      },
    });
    const onRestoreComplete = vi.fn();

    render(
      <ReportUnitsMovedChartSheet
        {...baseProps}
        isOpen
        onRestoreComplete={onRestoreComplete}
        restoreFocusSkuId="sku-removed"
      />,
    );

    const dialog = expectShell();
    await waitFor(() =>
      expect(
        within(dialog).getByRole("tab", { name: "All items" }),
      ).toHaveFocus(),
    );
    expect(
      within(dialog).getByTestId("units-moved-restore-status"),
    ).toHaveTextContent(
      "Your previous item is no longer in this view. Showing page 1 of 1.",
    );
    expect(onRestoreComplete).toHaveBeenCalledTimes(1);
  });

  it("restores an axis-origin navigation to the chart label, not the item list", async () => {
    admitQueued();
    installQueries({
      header: headerResult(completedLifecycle(totalsSmall)),
      pages: {
        1: pageResult(1, [movementRow(1, -24), movementRow(2, 18)], totalsSmall),
      },
    });

    render(
      <ReportUnitsMovedChartSheet
        {...baseProps}
        isOpen
        restoreFocusSkuId="sku-1"
        restoreFocusSurface="chart"
      />,
    );

    const dialog = expectShell();
    const chartLink = await within(dialog).findByRole("link", {
      name: "View Product 1 SKU details from chart",
    });
    await waitFor(() => expect(chartLink).toHaveFocus());
    expect(
      within(within(dialog).getByRole("table")).getByRole("link", {
        name: /Product 1/,
      }),
    ).not.toHaveFocus();
  });

  it("does not consume a return token while the originating detail navigation is still pending", async () => {
    admitQueued();
    installQueries({
      header: headerResult(completedLifecycle(totalsSmall)),
      pages: {
        1: pageResult(1, [movementRow(1, -24), movementRow(2, 18)], totalsSmall),
      },
    });
    const onRestoreComplete = vi.fn();
    let rejectNavigation!: (reason?: unknown) => void;
    const navigation = new Promise<void>((_resolve, reject) => {
      rejectNavigation = reject;
    });
    const onSkuLinkNavigate = vi.fn(() => navigation);
    const mounted = render(
      <ReportUnitsMovedChartSheet
        {...baseProps}
        isOpen
        onRestoreComplete={onRestoreComplete}
        onSkuLinkNavigate={onSkuLinkNavigate}
      />,
    );

    const chartLink = await screen.findByRole("link", {
      name: "View Product 1 SKU details from chart",
    });
    fireEvent.click(chartLink);
    expect(onSkuLinkNavigate).toHaveBeenCalledTimes(1);

    mounted.rerender(
      <ReportUnitsMovedChartSheet
        {...baseProps}
        isOpen
        onRestoreComplete={onRestoreComplete}
        onSkuLinkNavigate={onSkuLinkNavigate}
        restoreFocusSkuId="sku-1"
        restoreFocusSurface="chart"
      />,
    );

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(onRestoreComplete).not.toHaveBeenCalled();

    await act(async () => {
      rejectNavigation(new Error("navigation failed"));
      await navigation.catch(() => undefined);
    });
    await waitFor(() => expect(onRestoreComplete).toHaveBeenCalledTimes(1));
    expect(chartLink).toHaveFocus();
  });
});

describe("motion and scroll", () => {
  function installCompletedSmall() {
    const totals = {
      unitsSold: 30,
      unitsReturned: 12,
      netUnits: 18,
      skuCount: 2,
    };
    admitQueued();
    installQueries({
      header: headerResult(completedLifecycle(totals)),
      pages: {
        1: pageResult(1, [movementRow(1, -24), movementRow(2, 18)], totals),
      },
    });
  }

  it("starts the chart animation while the sheet opens", async () => {
    installCompletedSmall();
    render(<ReportUnitsMovedChartSheet {...baseProps} isOpen />);

    const dialog = expectShell();
    await waitFor(() =>
      expect(within(dialog).getByTestId("units-bar")).toBeInTheDocument(),
    );
    expect(within(dialog).getByTestId("units-bar")).toHaveAttribute(
      "data-animation-active",
      "true",
    );
  });

  it("suppresses the chart animation under reduced motion", async () => {
    state.reducedMotion = true;
    installCompletedSmall();
    render(<ReportUnitsMovedChartSheet {...baseProps} isOpen />);

    const dialog = expectShell();
    await waitFor(() =>
      expect(within(dialog).getByTestId("units-bar")).toBeInTheDocument(),
    );
    expect(within(dialog).getByTestId("units-bar")).toHaveAttribute(
      "data-animation-active",
      "false",
    );
  });

  it("restores the underlying report scroll position when an open sheet remounts", async () => {
    installCompletedSmall();
    const user = userEvent.setup();
    const scrollHeightSpy = vi
      .spyOn(HTMLElement.prototype, "scrollHeight", "get")
      .mockImplementation(function (this: HTMLElement) {
        return this.dataset.testid === "report-scroll-container" ? 2_000 : 0;
      });
    const clientHeightSpy = vi
      .spyOn(HTMLElement.prototype, "clientHeight", "get")
      .mockImplementation(function (this: HTMLElement) {
        return this.dataset.testid === "report-scroll-container" ? 600 : 0;
      });
    let mounted: ReturnType<typeof render> | undefined;

    try {
      mounted = render(
        <div data-testid="report-scroll-container" style={{ overflowY: "auto" }}>
          <ReportUnitsMovedChartSheet {...baseProps} />
        </div>,
      );
      screen.getByTestId("report-scroll-container").scrollTop = 640;

      await user.click(
        screen.getByRole("button", { name: "View item movement" }),
      );
      mounted.unmount();

      mounted = render(
        <div data-testid="report-scroll-container" style={{ overflowY: "auto" }}>
          <ReportUnitsMovedChartSheet {...baseProps} isOpen />
        </div>,
      );

      expect(
        screen.getByTestId("report-scroll-container").scrollTop,
      ).toBe(640);
      await user.click(screen.getByRole("button", { name: "Close" }));
    } finally {
      mounted?.unmount();
      scrollHeightSpy.mockRestore();
      clientHeightSpy.mockRestore();
    }
  });
});
