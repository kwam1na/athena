import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getFunctionName } from "convex/server";

const state = vi.hoisted(() => ({
  activeResponse: undefined as unknown,
  /** `null` = a real store; see `useReportsSharedDemoMode`. */
  sharedDemoContext: null as { kind: string; storeId?: string } | null | undefined,
  /** Every push into another route's search (the SKU-detail drill-down). */
  detailNavigations: [] as Array<Record<string, unknown>>,
  /** The units-sheet ensure mutation; swapped per test, stable per render. */
  ensureMutation: undefined as unknown,
  /** Completed movement fixture; `null` keeps the sheet un-admitted. */
  movement: null as null | { header: unknown; pages: Record<number, unknown> },
  navigationOptions: [] as Array<{ replace?: boolean; to?: string }>,
  /** Simulates the first paint, before any Convex result has arrived. */
  pending: false,
  liveDayQueryArgs: [] as unknown[],
  queryArgs: [] as unknown[],
  search: {} as Record<string, unknown>,
}));

vi.mock("@tanstack/react-router", () => ({
  // The demo briefing carries `ownerRoutes`, so the view renders real links.
  // The sheet's SKU links additionally carry their U6 seam props through.
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
    to?: string;
  }) => (
    <a
      data-params={params ? JSON.stringify(params) : undefined}
      data-search={search ? JSON.stringify(search) : undefined}
      href={typeof to === "string" ? to : undefined}
      {...props}
    >
      {children}
    </a>
  ),
  createFileRoute: () => (options: Record<string, unknown>) => ({
    ...options,
    useNavigate:
      () =>
        ({
          params,
          replace,
          search,
          to,
        }: {
          params?: unknown;
          replace?: boolean;
          search?:
            | Record<string, unknown>
            | ((current: Record<string, unknown>) => Record<string, unknown>);
          to?: string;
        }) => {
          state.navigationOptions.push({ replace, to });
          if (typeof search === "function") {
            state.search = search(state.search);
          } else if (search && typeof search === "object") {
            state.detailNavigations.push({
              params: params as Record<string, unknown>,
              search,
              to,
            });
          }
        },
    useSearch: () => state.search,
  }),
  useParams: () => ({ orgUrlSlug: "org", storeUrlSlug: "store" }),
}));

const stubEnsureMutation = async () => ({
  requestKey: null,
  lifecycle: { state: "not_available" },
});

/**
 * The shared demo's live current-day read is a standing subscription on every
 * Reports surface, not part of the weekly lifecycle these assertions measure.
 * It is recorded separately so "no weekly subscription" keeps meaning exactly
 * that; `liveDayQueryArgs` is asserted on its own below.
 */
const SHARED_DEMO_STANDING_READS = new Set([
  "reports/liveDay:getLiveOperatingDay",
  "reports/liveDay:listLiveSkuStock",
]);

/**
 * Discriminated by FUNCTION, not by argument shape: the stock read takes
 * `{storeId}`, which is also the weekly briefing's shape, so a shape test
 * would silently reclassify the very subscription these assertions measure.
 */
function isSharedDemoStandingRead(reference: unknown) {
  try {
    return SHARED_DEMO_STANDING_READS.has(getFunctionName(reference as never));
  } catch {
    return false;
  }
}

vi.mock("convex/react", () => ({
  useQuery: (_reference: unknown, args: unknown) => {
    if (args !== "skip") {
      if (isSharedDemoStandingRead(_reference)) {
        state.liveDayQueryArgs.push(args);
      } else {
        state.queryArgs.push(args);
      }
    }
    if (args === "skip" || state.pending) return undefined;
    if (typeof args === "object" && args !== null && "requestKey" in args) {
      if (!state.movement) return undefined;
      return "page" in args
        ? state.movement.pages[(args as { page: number }).page]
        : state.movement.header;
    }
    if (typeof args === "object" && args !== null && "paginationOpts" in args) {
      return {
        page: [
          {
            ...report,
            reportId: "week:2026-07-06",
          },
        ],
        continueCursor: "next-history-page",
        isDone: false,
      };
    }
    if (typeof args === "object" && args !== null && "reportId" in args) {
      return { ...report, reportId: (args as { reportId: string }).reportId };
    }
    if (state.activeResponse !== undefined) return state.activeResponse;
    return { status: "available", current: report, acceptedBaseline: null };
  },
  // The units sheet's ensure mutation. The returned function must be
  // referentially stable, like the real hook's.
  useMutation: () => state.ensureMutation as () => Promise<unknown>,
}));

vi.mock("recharts", () => ({
  Bar: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="units-bar">{children}</div>
  ),
  BarChart: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="units-chart">{children}</div>
  ),
  CartesianGrid: () => null,
  Cell: () => null,
  Legend: () => null,
  ReferenceLine: () => null,
  ResponsiveContainer: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  Tooltip: () => null,
  XAxis: () => null,
  YAxis: () => null,
}));

vi.mock("@/hooks/useGetActiveStore", () => ({
  default: () => ({ activeStore: { _id: "store-1" } }),
}));

vi.mock("@/hooks/useSharedDemoContext", () => ({
  useSharedDemoContext: () => state.sharedDemoContext,
}));

import { ReportsWeeklyRoute, reportsWeeklySearchSchema } from "./weekly";

const report = {
  cycleStartDate: "2026-07-06",
  cycleEndDate: "2026-07-12",
  currency: "USD",
  materializedAt: Date.UTC(2026, 6, 12, 15, 30),
  included: {
    grossSalesMinor: 120_000,
    netSalesMinor: 100_000,
    refundsMinor: 20_000,
    unitsSold: 18,
    unitsReturned: 2,
    uncostedRevenueMinor: 0,
    grossProfitMinor: 40_000,
    paymentsCollectedMinor: 100_000,
    paymentsRefundedMinor: 20_000,
    paymentAllocatedMinor: 100_000,
    paymentUnsettledMinor: 0,
    paymentAllocationCoverage: "complete" as const,
  },
  summary: {
    grossSalesMinor: 120_000,
    merchandiseMarginMinor: 40_000,
    netSalesMinor: 100_000,
    netUnits: 16,
    paymentAllocatedMinor: 100_000,
    paymentAllocationCoverage: "complete" as const,
    paymentUnsettledMinor: 0,
    paymentsCollectedMinor: 100_000,
    paymentsRefundedMinor: 20_000,
    refundsMinor: 20_000,
    unitsReturned: 2,
    unitsSold: 18,
  },
  outsideSchedule: {
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
    paymentUnsettledMinor: 0,
    paymentAllocationCoverage: "complete" as const,
  },
  outsideScheduleSummary: {
    grossSalesMinor: 0,
    merchandiseMarginMinor: 0,
    netSalesMinor: 0,
    netUnits: 0,
    paymentAllocatedMinor: 0,
    paymentAllocationCoverage: "complete" as const,
    paymentUnsettledMinor: 0,
    paymentsCollectedMinor: 0,
    paymentsRefundedMinor: 0,
    refundsMinor: 0,
    unitsReturned: 0,
    unitsSold: 0,
  },
  // Nothing landed outside the schedule, so the total is the scheduled lane.
  total: {
    grossSalesMinor: 120_000,
    merchandiseMarginMinor: 40_000,
    netSalesMinor: 100_000,
    netUnits: 16,
    paymentAllocatedMinor: 100_000,
    paymentAllocationCoverage: "complete" as const,
    paymentUnsettledMinor: 0,
    paymentsCollectedMinor: 100_000,
    paymentsRefundedMinor: 20_000,
    refundsMinor: 20_000,
    unitsReturned: 2,
    unitsSold: 18,
  },
  totalCompleteness: { complete: true, reason: "complete" as const },
  scheduleLineage: [],
  completeness: { complete: true, reason: "complete" as const },
  lifecyclePosture: "accepted" as const,
  amendmentPosture: "none" as const,
  closePosture: {
    status: "accepted" as const,
    acceptedCloseId: "close-1",
    changedAt: 1,
  },
};

const MOVEMENT_REQUEST_KEY = "movement:weekly-route";

function movementRow(rank: number, netUnits: number) {
  const unitsSold = Math.max(netUnits, 0) + 2;
  return {
    key: `sku-${rank}`,
    productSkuId: `sku-${rank}`,
    label: `SKU-${rank}`,
    unitsSold,
    unitsReturned: unitsSold - netUnits,
    netUnits,
    rank,
    identity: { displayName: `Product ${rank}`, sku: `SKU-${rank}` },
  };
}

/** A completed 25-SKU movement snapshot: page 1 holds 20 rows, page 2 five. */
function installCompletedMovement() {
  const lifecycle = {
    state: "completed" as const,
    totals: { unitsSold: 400, unitsReturned: 120, netUnits: 280, skuCount: 25 },
    completedAt: 1_754_000_000_000,
    pageCount: 2,
  };
  const pageEnvelope = (page: number, rows: unknown[]) => ({
    requestKey: MOVEMENT_REQUEST_KEY,
    startDate: report.cycleStartDate,
    endDate: report.cycleEndDate,
    lifecycle,
    page,
    pageCount: 2,
    rows,
  });
  state.movement = {
    header: {
      requestKey: MOVEMENT_REQUEST_KEY,
      startDate: report.cycleStartDate,
      endDate: report.cycleEndDate,
      lifecycle,
    },
    pages: {
      1: pageEnvelope(
        1,
        Array.from({ length: 20 }, (_, index) =>
          movementRow(index + 1, 20 - index),
        ),
      ),
      2: pageEnvelope(
        2,
        Array.from({ length: 5 }, (_, index) =>
          movementRow(index + 21, -(5 - index)),
        ),
      ),
    },
  };
  state.ensureMutation = async () => ({
    requestKey: MOVEMENT_REQUEST_KEY,
    lifecycle: { state: "queued_pending" },
  });
}

describe("ReportsWeeklyRoute query lifecycle", () => {
  beforeEach(() => {
    state.activeResponse = undefined;
    state.sharedDemoContext = null;
    state.detailNavigations = [];
    state.ensureMutation = stubEnsureMutation;
    state.movement = null;
    state.pending = false;
    state.navigationOptions = [];
    state.queryArgs = [];
    state.liveDayQueryArgs = [];
    state.search = {};
  });

  it("keeps the units sheet open state in route search with replaced history entries", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<ReportsWeeklyRoute />);

    await user.click(
      screen.getByRole("button", { name: "View item movement" }),
    );
    expect(state.search.units).toBe(true);
    // Open never adds a history entry (unified U6 convention).
    expect(state.navigationOptions).toEqual([{ replace: true, to: undefined }]);

    rerender(<ReportsWeeklyRoute />);
    expect(
      screen.getByRole("dialog", { name: "Item movement" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Close" }));
    // Close replaces too and clears every sheet-owned key.
    expect(state.search.units).toBeUndefined();
    expect(state.search.unitsTab).toBeUndefined();
    expect(state.search.unitsPage).toBeUndefined();
    expect(state.search.sheetReturn).toBeUndefined();
    expect(
      state.navigationOptions.every(({ replace }) => replace === true),
    ).toBe(true);
  });

  it("replaces history for tab and page changes and serializes only non-defaults", async () => {
    const user = userEvent.setup();
    installCompletedMovement();
    state.search = { units: true };
    const { rerender } = render(<ReportsWeeklyRoute />);

    const dialog = await screen.findByRole("dialog", { name: "Item movement" });
    await waitFor(() =>
      expect(within(dialog).getByTestId("units-chart")).toBeInTheDocument(),
    );

    // Default state serializes nothing beyond the open flag.
    expect(state.search).toEqual({ units: true });

    await user.click(within(dialog).getByRole("tab", { name: "All items" }));
    expect(state.search).toEqual({ units: true, unitsTab: "granular" });
    rerender(<ReportsWeeklyRoute />);

    await user.click(
      screen.getByRole("button", { name: "Go to next page" }),
    );
    expect(state.search).toEqual({
      units: true,
      unitsTab: "granular",
      unitsPage: 2,
    });
    rerender(<ReportsWeeklyRoute />);
    await waitFor(() =>
      expect(screen.getByText("Page 2 of 2")).toBeInTheDocument(),
    );

    // Returning to page one drops the page key rather than writing 1.
    await user.click(
      screen.getByRole("button", { name: "Go to previous page" }),
    );
    expect(state.search).toEqual({ units: true, unitsTab: "granular" });
    rerender(<ReportsWeeklyRoute />);

    // Returning to Top movers clears the tab (and any page) keys.
    await user.click(screen.getByRole("tab", { name: "Top movers" }));
    expect(state.search).toEqual({ units: true });

    // Every intra-sheet change replaced the current history entry.
    expect(
      state.navigationOptions.every(({ replace }) => replace === true),
    ).toBe(true);
  });

  it("persists focus and scroll continuity when drilling into SKU detail, then pushes one real entry", async () => {
    const user = userEvent.setup();
    installCompletedMovement();
    state.search = { units: true, unitsTab: "granular" };
    render(<ReportsWeeklyRoute />);

    const dialog = await screen.findByRole("dialog", { name: "Item movement" });
    await waitFor(() =>
      expect(
        within(dialog).getByRole("link", { name: /Product 1 SKU-1\b/ }),
      ).toBeInTheDocument(),
    );
    state.navigationOptions = [];

    await user.click(
      within(dialog).getByRole("link", { name: /Product 1 SKU-1\b/ }),
    );

    // The continuity write replaces the reports entry...
    expect(state.search).toMatchObject({
      units: true,
      unitsTab: "granular",
      sheetReturn: "sku-1~",
    });
    // ...and the drill-down itself is the only push.
    expect(state.navigationOptions).toEqual([
      { replace: true, to: undefined },
      {
        replace: undefined,
        to: "/$orgUrlSlug/store/$storeUrlSlug/reports/items/$productSkuId",
      },
    ]);
    expect(state.detailNavigations).toHaveLength(1);
    const detail = state.detailNavigations[0] as {
      params: Record<string, unknown>;
      search: Record<string, unknown>;
    };
    expect(detail.params).toEqual({
      orgUrlSlug: "org",
      productSkuId: "sku-1",
      storeUrlSlug: "store",
    });
    expect(detail.search.startDate).toBe("2026-07-06");
    expect(detail.search.endDate).toBe("2026-07-12");
    expect(typeof detail.search.o).toBe("string");
  });

  it("restores page, scroll, and the originating SKU link when returning from SKU detail", async () => {
    installCompletedMovement();
    state.search = {
      units: true,
      unitsTab: "granular",
      unitsPage: 2,
      sheetReturn: "sku-21~640",
    };
    const scrollHeightSpy = vi
      .spyOn(HTMLElement.prototype, "scrollHeight", "get")
      .mockImplementation(function (this: HTMLElement) {
        return this.dataset.testid === "weekly-scroll-container" ? 2_000 : 0;
      });
    const clientHeightSpy = vi
      .spyOn(HTMLElement.prototype, "clientHeight", "get")
      .mockImplementation(function (this: HTMLElement) {
        return this.dataset.testid === "weekly-scroll-container" ? 600 : 0;
      });

    try {
      render(
        <div
          data-testid="weekly-scroll-container"
          style={{ overflowY: "auto" }}
        >
          <ReportsWeeklyRoute />
        </div>,
      );

      const dialog = await screen.findByRole("dialog", {
        name: "Item movement",
      });
      await waitFor(() =>
        expect(screen.getByText("Page 2 of 2")).toBeInTheDocument(),
      );

      // The captured report offset is reapplied under the sheet.
      await waitFor(() =>
        expect(
          screen.getByTestId("weekly-scroll-container").scrollTop,
        ).toBe(640),
      );
      // Keyboard context returns to the very link that was drilled through.
      await waitFor(() =>
        expect(document.activeElement).toBe(
          within(dialog).getByRole("link", { name: /Product 21/ }),
        ),
      );
      // The one-shot keys are cleared (replace) so refresh cannot re-restore.
      await waitFor(() => {
        expect(state.search.sheetReturn).toBeUndefined();
      });
      expect(state.search).toMatchObject({
        units: true,
        unitsTab: "granular",
        unitsPage: 2,
      });
      expect(
        state.navigationOptions.every(({ replace }) => replace === true),
      ).toBe(true);
    } finally {
      scrollHeightSpy.mockRestore();
      clientHeightSpy.mockRestore();
    }
  });

  it("falls back to the Granular heading with an announcement when the originating SKU is gone", async () => {
    installCompletedMovement();
    state.search = {
      units: true,
      unitsTab: "granular",
      unitsPage: 2,
      sheetReturn: "sku-999~",
    };
    render(<ReportsWeeklyRoute />);

    const dialog = await screen.findByRole("dialog", { name: "Item movement" });
    await waitFor(() =>
      expect(screen.getByText("Page 2 of 2")).toBeInTheDocument(),
    );

    await waitFor(() =>
      expect(document.activeElement).toBe(
        within(dialog).getByRole("tab", { name: "All items" }),
      ),
    );
    expect(
      within(dialog).getByTestId("units-moved-restore-status"),
    ).toHaveTextContent(
      "Your previous item is no longer in this view. Showing page 2 of 2.",
    );
    await waitFor(() => expect(state.search.sheetReturn).toBeUndefined());
  });

  it("degrades a missing scroll container silently and still clears the keys", async () => {
    installCompletedMovement();
    state.search = { units: true, sheetReturn: "~640" };
    render(<ReportsWeeklyRoute />);

    await screen.findByRole("dialog", { name: "Item movement" });
    // jsdom's zero-height layout means no scrollable container ever appears;
    // the bounded retry gives up quietly and releases the key.
    await waitFor(
      () => expect(state.search.sheetReturn).toBeUndefined(),
      { timeout: 4_000 },
    );
    expect(state.search).toEqual({ units: true });
  });

  it("resets sheet continuity keys when a different accepted week is selected", async () => {
    const user = userEvent.setup();
    // A pasted or stale URL can carry continuity keys for a closed sheet;
    // choosing a different accepted week names a different period, so they
    // must not survive into it.
    state.search = {
      unitsTab: "granular",
      unitsPage: 4,
      sheetReturn: "sku-61~640",
    };
    const { rerender } = render(<ReportsWeeklyRoute />);
    await user.click(screen.getByRole("button", { name: "Weekly history" }));
    rerender(<ReportsWeeklyRoute />);

    await user.click(screen.getByRole("button", { name: "Jul 6–12, 2026" }));

    expect(state.search).toMatchObject({ reportId: "week:2026-07-06" });
    expect(state.search.unitsTab).toBeUndefined();
    expect(state.search.unitsPage).toBeUndefined();
    expect(state.search.sheetReturn).toBeUndefined();
  });

  it("uses one active query, adds history only on demand, and replaces active with detail", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<ReportsWeeklyRoute />);

    expect(state.queryArgs).toEqual([{ storeId: "store-1" }]);

    await user.click(screen.getByRole("button", { name: "Weekly history" }));
    state.queryArgs = [];
    rerender(<ReportsWeeklyRoute />);

    expect(state.queryArgs).toEqual([
      { storeId: "store-1" },
      {
        storeId: "store-1",
        paginationOpts: { cursor: null, numItems: 12 },
      },
    ]);

    await user.click(screen.getByRole("button", { name: "Jul 6–12, 2026" }));
    state.queryArgs = [];
    rerender(<ReportsWeeklyRoute />);

    expect(state.queryArgs).toEqual([
      { storeId: "store-1", reportId: "week:2026-07-06" },
      {
        storeId: "store-1",
        paginationOpts: { cursor: null, numItems: 12 },
      },
    ]);

    await user.click(screen.getByRole("button", { name: "Close history" }));
    state.queryArgs = [];
    rerender(<ReportsWeeklyRoute />);

    expect(state.queryArgs).toEqual([
      { storeId: "store-1", reportId: "week:2026-07-06" },
    ]);
    expect(
      state.navigationOptions.every(({ replace }) => replace !== true),
    ).toBe(true);
  });

  it("moves accepted history through the validated cursor without adding a third subscription", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<ReportsWeeklyRoute />);
    await user.click(screen.getByRole("button", { name: "Weekly history" }));
    rerender(<ReportsWeeklyRoute />);

    await user.click(
      screen.getByRole("button", { name: "Older accepted weeks" }),
    );
    state.queryArgs = [];
    rerender(<ReportsWeeklyRoute />);

    expect(state.queryArgs).toEqual([
      { storeId: "store-1" },
      {
        storeId: "store-1",
        paginationOpts: { cursor: "next-history-page", numItems: 12 },
      },
    ]);
    expect(state.search).toMatchObject({
      historyCursor: "next-history-page",
      historyCursorTrail: [null],
    });

    await user.click(
      screen.getByRole("button", { name: "Newer accepted weeks" }),
    );
    state.queryArgs = [];
    rerender(<ReportsWeeklyRoute />);

    expect(state.queryArgs).toEqual([
      { storeId: "store-1" },
      {
        storeId: "store-1",
        paginationOpts: { cursor: null, numItems: 12 },
      },
    ]);
    expect(state.search.historyCursor).toBeUndefined();
    expect(state.search.historyCursorTrail).toBeUndefined();
    expect(
      state.navigationOptions.every(({ replace }) => replace !== true),
    ).toBe(true);
  });

  it("announces the selected dates and lifecycle after history settles", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<ReportsWeeklyRoute />);
    await user.click(screen.getByRole("button", { name: "Weekly history" }));
    rerender(<ReportsWeeklyRoute />);
    await user.click(screen.getByRole("button", { name: "Jul 6–12, 2026" }));
    rerender(<ReportsWeeklyRoute />);

    const status = screen.getByTestId("weekly-status");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status).toHaveTextContent(
      "Reporting week Mon, Jul 6–Sun, Jul 12, 2026. Final Daily Close accepted.",
    );
    expect(status).toHaveTextContent("Last updated");
    expect(status.querySelector("time")).toHaveAttribute(
      "datetime",
      new Date(report.materializedAt).toISOString(),
    );
    // The visible briefing already prints the plain range; the polite region
    // must not read the same string back.
    expect(status).not.toHaveTextContent("Jul 6–12, 2026.");
  });

  it("mounts the polite status region before the first result settles", () => {
    state.pending = true;
    render(<ReportsWeeklyRoute />);

    const status = screen.getByTestId("weekly-status");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status).toHaveTextContent("Loading reporting week...");
  });

  it("reveals freshness only after the reporting summary flip settles", async () => {
    state.pending = true;
    const { rerender } = render(<ReportsWeeklyRoute />);
    const status = screen.getByTestId("weekly-status");

    state.pending = false;
    rerender(<ReportsWeeklyRoute />);

    expect(status).not.toHaveTextContent("Last updated");

    expect(screen.getByTestId("weekly-summary-entry")).toHaveAttribute(
      "data-motion",
      "flip",
    );
    expect(screen.getByTestId("weekly-status-value")).toHaveAttribute(
      "data-variant",
      "text",
    );
    expect(screen.getByTestId("weekly-status-value")).toHaveAttribute(
      "data-switch-delay",
      "200",
    );
    expect(screen.getByTestId("weekly-status")).toBe(status);
    await waitFor(() => expect(status).toHaveTextContent("Last updated"));
    expect(status).toHaveClass("flex", "gap-x-1.5");
    expect(screen.getByTestId("weekly-last-updated")).toHaveClass(
      "gap-x-1.5",
    );
  });

  it("renders user-facing reporting dates through the shared formatter", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<ReportsWeeklyRoute />);
    await user.click(screen.getByRole("button", { name: "Weekly history" }));
    rerender(<ReportsWeeklyRoute />);

    expect(screen.queryByText(/2026-07-06/)).not.toBeInTheDocument();
    expect(screen.queryByText(/2026-07-12/)).not.toBeInTheDocument();
  });

  it("keeps history controls at the repo touch-target height", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<ReportsWeeklyRoute />);
    const toggle = screen.getByRole("button", { name: "Weekly history" });
    expect(toggle).toHaveClass("h-control-standard");

    await user.click(toggle);
    rerender(<ReportsWeeklyRoute />);

    for (const name of [
      "Jul 6–12, 2026",
      "Older accepted weeks",
      "Close history",
    ]) {
      expect(screen.getByRole("button", { name })).toHaveClass(
        "h-control-standard",
      );
    }
  });

  it("keeps focus on the selector that changed the history selection", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<ReportsWeeklyRoute />);
    await user.click(screen.getByRole("button", { name: "Weekly history" }));
    rerender(<ReportsWeeklyRoute />);

    const weekButton = screen.getByRole("button", { name: "Jul 6–12, 2026" });
    await user.click(weekButton);
    rerender(<ReportsWeeklyRoute />);

    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Jul 6–12, 2026" }),
    );
  });

  it("contains the history surface for entry and exit motion", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<ReportsWeeklyRoute />);

    await user.click(screen.getByRole("button", { name: "Weekly history" }));
    rerender(<ReportsWeeklyRoute />);

    const motionRegion = screen.getByTestId("weekly-history-motion-region");
    expect(motionRegion).toHaveClass("grid");
    expect(screen.getByTestId("weekly-history-motion-content")).toHaveClass(
      "min-h-0",
      "overflow-hidden",
    );
    expect(screen.getByLabelText("Weekly report history")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Close history" }));
    rerender(<ReportsWeeklyRoute />);

    expect(state.search.history).toBeUndefined();
    expect(
      screen.queryByTestId("weekly-history-motion-region"),
    ).not.toBeInTheDocument();
  });

  it("stacks the briefing without a horizontal scroll container at narrow widths", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<ReportsWeeklyRoute />);
    await user.click(screen.getByRole("button", { name: "Weekly history" }));
    rerender(<ReportsWeeklyRoute />);

    // jsdom has no layout, so this asserts the structural contract that keeps
    // narrow viewports from scrolling sideways: history controls wrap, and no
    // element in the Weekly subtree opts into horizontal overflow. Visual
    // confirmation at 375px stays a browser check.
    const historySection = screen.getByLabelText("Weekly report history");
    expect(historySection.querySelector(".flex.flex-wrap")).not.toBeNull();
    for (const element of Array.from(document.querySelectorAll("*"))) {
      expect(element.getAttribute("class") ?? "").not.toMatch(
        /overflow-x-(auto|scroll)/,
      );
    }
  });

  it("rejects a malformed pasted search before the route renders", () => {
    // Documents the existing Reports convention (deviation D2): the bare Zod
    // schema throws into the router error boundary rather than silently
    // rewriting a pasted URL. Overview behaves the same way.
    expect(() =>
      reportsWeeklySearchSchema.parse({ reportId: "week:not-a-date" }),
    ).toThrow();
    expect(() =>
      reportsWeeklySearchSchema.parse({ historyCursorTrail: "cursor" }),
    ).toThrow();
  });

  it("restores active and selected history state across Back and Forward", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<ReportsWeeklyRoute />);
    await user.click(screen.getByRole("button", { name: "Weekly history" }));
    rerender(<ReportsWeeklyRoute />);
    const activeHistorySearch = { ...state.search };

    await user.click(screen.getByRole("button", { name: "Jul 6–12, 2026" }));
    const selectedSearch = { ...state.search };
    rerender(<ReportsWeeklyRoute />);
    expect(state.queryArgs.at(-2)).toEqual({
      storeId: "store-1",
      reportId: "week:2026-07-06",
    });

    state.queryArgs = [];
    state.search = activeHistorySearch;
    rerender(<ReportsWeeklyRoute />);
    expect(state.queryArgs[0]).toEqual({ storeId: "store-1" });

    state.queryArgs = [];
    state.search = selectedSearch;
    rerender(<ReportsWeeklyRoute />);
    expect(state.queryArgs[0]).toEqual({
      storeId: "store-1",
      reportId: "week:2026-07-06",
    });
  });

  it("answers the shared demo from the fixture with no weekly subscription", async () => {
    const user = userEvent.setup();
    state.sharedDemoContext = { kind: "shared_demo", storeId: "store-1" };
    const { rerender } = render(<ReportsWeeklyRoute />);

    // Fewer subscriptions than the live path, which opens one immediately.
    // The weekly briefing itself is answered by the fixture; the only read is
    // the current operating day folded onto that fixture history.
    expect(state.queryArgs).toEqual([]);
    expect(state.liveDayQueryArgs.length).toBeGreaterThan(0);
    for (const args of state.liveDayQueryArgs) {
      expect(args).toEqual(expect.objectContaining({ storeId: "store-1" }));
      expect(Object.keys(args as object).sort()).toEqual(
        (args as { operatingDate?: string }).operatingDate
          ? ["operatingDate", "storeId"]
          : ["storeId"],
      );
    }
    expect(screen.getByTestId("weekly-status")).toHaveTextContent(
      /^Reporting week /,
    );

    // The drawer settles on the honest empty state rather than a spinner,
    // and no cursor page is ever requested.
    await user.click(screen.getByRole("button", { name: "Weekly history" }));
    rerender(<ReportsWeeklyRoute />);

    expect(screen.getByText("No accepted weeks yet.")).toBeInTheDocument();
    expect(
      screen.queryByText("Loading weekly history."),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Older accepted weeks" }),
    ).not.toBeInTheDocument();
    expect(state.queryArgs).toEqual([]);
  });

  it("settles a pasted accepted week as unavailable in the shared demo", () => {
    state.sharedDemoContext = { kind: "shared_demo", storeId: "store-1" };
    state.search = { reportId: "week:2026-07-06" };
    render(<ReportsWeeklyRoute />);

    expect(state.queryArgs).toEqual([]);
    expect(screen.getByText("Accepted week unavailable")).toBeInTheDocument();
    expect(
      screen.queryByText("Loading reporting week..."),
    ).not.toBeInTheDocument();
  });

  it("opens no weekly subscription while the shared demo context is loading", () => {
    state.sharedDemoContext = undefined;
    render(<ReportsWeeklyRoute />);

    expect(state.queryArgs).toEqual([]);
    expect(screen.getByTestId("weekly-status")).toHaveTextContent(
      "Loading reporting week...",
    );
  });

  it.each([
    [
      "capability_disabled",
      "Weekly report unavailable",
      "Weekly reporting has not been enabled for this store.",
    ],
    [
      "missing_projection",
      "Weekly report is materializing",
      "Athena is preparing the store's first weekly projection. Check again after reporting activity finishes materializing.",
    ],
    [
      "missing_schedule",
      "Store hours needed",
      "Add a Store hours schedule before Athena can determine this reporting week.",
    ],
    [
      "missing_timezone",
      "Store time zone needed",
      "Set the Store hours time zone before Athena can determine this reporting week.",
    ],
    [
      "no_scheduled_dates",
      "No scheduled dates",
      "This reporting week has no operational dates. Review Store hours to make a date operational.",
    ],
  ] as const)(
    "renders reason-specific unavailable guidance for %s",
    (reason, title, description) => {
      state.activeResponse = { status: "unavailable", reason };
      render(<ReportsWeeklyRoute />);

      expect(screen.getByText(title)).toBeInTheDocument();
      expect(screen.getByText(description)).toBeInTheDocument();
    },
  );
});
