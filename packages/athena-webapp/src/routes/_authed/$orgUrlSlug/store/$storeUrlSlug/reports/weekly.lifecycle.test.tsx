import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  activeResponse: undefined as unknown,
  navigationOptions: [] as Array<{ replace?: boolean }>,
  queryArgs: [] as unknown[],
  search: {} as Record<string, unknown>,
}));

vi.mock("@tanstack/react-router", () => ({
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
    if (args === "skip") return undefined;
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

import { ReportsWeeklyRoute } from "./weekly";

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

    await user.click(
      screen.getByRole("button", { name: "2026-07-06 – 2026-07-12" }),
    );
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
    await user.click(
      screen.getByRole("button", { name: "2026-07-06 – 2026-07-12" }),
    );
    rerender(<ReportsWeeklyRoute />);

    expect(
      screen.getByText(
        "Showing 2026-07-06 through 2026-07-12. Accepted week.",
      ),
    ).toHaveAttribute("aria-live", "polite");
  });

  it("restores active and selected history state across Back and Forward", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<ReportsWeeklyRoute />);
    await user.click(screen.getByRole("button", { name: "Weekly history" }));
    rerender(<ReportsWeeklyRoute />);
    const activeHistorySearch = { ...state.search };

    await user.click(
      screen.getByRole("button", { name: "2026-07-06 – 2026-07-12" }),
    );
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
