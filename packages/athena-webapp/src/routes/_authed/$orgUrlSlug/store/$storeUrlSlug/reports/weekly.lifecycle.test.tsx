import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  activeResponse: undefined as unknown,
  /** `null` = a real store; see `useReportsSharedDemoMode`. */
  sharedDemoContext: null as { kind: string } | null | undefined,
  navigationOptions: [] as Array<{ replace?: boolean }>,
  /** Simulates the first paint, before any Convex result has arrived. */
  pending: false,
  queryArgs: [] as unknown[],
  search: {} as Record<string, unknown>,
}));

vi.mock("@tanstack/react-router", () => ({
  // The demo briefing carries `ownerRoutes`, so the view renders real links.
  Link: ({ children }: { children?: React.ReactNode }) => <a>{children}</a>,
  createFileRoute: () => (options: Record<string, unknown>) => ({
    ...options,
    useNavigate:
      () =>
        ({
          replace,
          search,
        }: {
          replace?: boolean;
          search: (current: Record<string, unknown>) => Record<string, unknown>;
        }) => {
          state.navigationOptions.push({ replace });
          state.search = search(state.search);
        },
    useSearch: () => state.search,
  }),
  useParams: () => ({ orgUrlSlug: "org", storeUrlSlug: "store" }),
}));

vi.mock("convex/react", () => ({
  useQuery: (_reference: unknown, args: unknown) => {
    if (args !== "skip") state.queryArgs.push(args);
    if (args === "skip" || state.pending) return undefined;
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

describe("ReportsWeeklyRoute query lifecycle", () => {
  beforeEach(() => {
    state.activeResponse = undefined;
    state.sharedDemoContext = null;
    state.pending = false;
    state.navigationOptions = [];
    state.queryArgs = [];
    state.search = {};
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

  it("keeps one live region while the reporting summary flips", () => {
    state.pending = true;
    const { rerender } = render(<ReportsWeeklyRoute />);
    const status = screen.getByTestId("weekly-status");

    state.pending = false;
    rerender(<ReportsWeeklyRoute />);

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
    state.sharedDemoContext = { kind: "shared_demo" };
    const { rerender } = render(<ReportsWeeklyRoute />);

    // Fewer subscriptions than the live path, which opens one immediately.
    expect(state.queryArgs).toEqual([]);
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
    state.sharedDemoContext = { kind: "shared_demo" };
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
