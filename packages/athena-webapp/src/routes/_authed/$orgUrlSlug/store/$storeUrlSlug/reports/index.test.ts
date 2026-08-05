import { createElement } from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const routerState = vi.hoisted(() => ({
  /** Every Convex query reference the Overview route tree subscribes to. */
  queryReferences: [] as unknown[],
  overviewResult: undefined as unknown,
  /** `null` = a real store; see `useReportsSharedDemoMode`. */
  sharedDemoContext: null as { kind: string; storeId?: string } | null | undefined,
  /** Every push into another route's search (the SKU-detail drill-down). */
  detailNavigations: [] as Array<Record<string, unknown>>,
  navigationOptions: [] as Array<{ replace?: boolean; to?: string }>,
  search: {} as Record<string, unknown>,
}));

vi.mock("@tanstack/react-router", () => ({
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
          routerState.navigationOptions.push({ replace, to });
          if (typeof search === "function") {
            routerState.search = search(routerState.search);
          } else if (search && typeof search === "object") {
            routerState.detailNavigations.push({
              params: params as Record<string, unknown>,
              search,
              to,
            });
          }
        },
    useSearch: () => routerState.search,
  }),
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
  }) =>
    createElement(
      "a",
      {
        "data-params": params ? JSON.stringify(params) : undefined,
        "data-search": search ? JSON.stringify(search) : undefined,
        href: typeof to === "string" ? to : undefined,
        ...props,
      },
      children,
    ),
  useLocation: () => ({ pathname: "/acme/store/downtown/reports", search: {} }),
  useNavigate: () => () => undefined,
  useRouter: () => ({ navigate: () => undefined }),
  useSearch: () => routerState.search,
  useParams: () => ({ orgUrlSlug: "acme", storeUrlSlug: "downtown" }),
}));

const stubEnsureMutation = async () => ({
  requestKey: null,
  lifecycle: { state: "not_available" },
});

vi.mock("convex/react", () => ({
  useQuery: (reference: unknown, args: unknown) => {
    if (args === "skip") return undefined;
    routerState.queryReferences.push(reference);
    // The route's own gating read runs first. Settling only that one lets the
    // child panels mount so their subscriptions are recorded too, while every
    // other read stays pending.
    return routerState.queryReferences.length === 1
      ? routerState.overviewResult
      : undefined;
  },
  // The units sheet's ensure mutation; never admitted in these tests. The
  // returned function must be referentially stable, like the real hook's.
  useMutation: () => stubEnsureMutation,
  usePaginatedQuery: () => ({
    results: [],
    status: "Exhausted",
    loadMore: () => undefined,
  }),
}));

vi.mock("@/hooks/useGetActiveStore", () => ({
  default: () => ({ activeStore: { _id: "store-1" } }),
}));

vi.mock("@/hooks/useSharedDemoContext", () => ({
  useSharedDemoContext: () => routerState.sharedDemoContext,
}));

/**
 * The overview summary needs a fully shaped projection to render. It reuses
 * the same deduplicated `getOverview` subscription the route already starts,
 * so stubbing it costs no subscription coverage while keeping the catalog
 * lookup and day panel — the other two query owners — real.
 */
vi.mock("@/components/reports/ReportsOverviewView", () => ({
  ReportsOverviewView: () => createElement("div"),
}));

import { getFunctionName } from "convex/server";

import { createSharedDemoReportMovementPage } from "@/components/shared-demo/sharedDemoReportsFixture";

import { Route, reportsOverviewSearchSchema } from "./index";

const RouteComponent = (Route as unknown as { component: () => JSX.Element })
  .component;

describe("reports overview search schema", () => {
  it("round-trips an empty search (all defaults computed in the component)", () => {
    expect(reportsOverviewSearchSchema.parse({})).toEqual({});
  });

  it("round-trips a fully populated search", () => {
    const value = {
      window: "weekToDate" as const,
      daysStart: "2026-07-01",
      daysEnd: "2026-07-28",
      daysTableStart: "2026-06-01",
      daysTableEnd: "2026-07-31",
      daysPage: 2,
      selectedDay: "2026-07-16",
      units: true,
      unitsTab: "granular" as const,
      unitsPage: 4,
      unitsFocus: "sku-61",
      unitsScroll: 640,
    };
    expect(reportsOverviewSearchSchema.parse(value)).toEqual(value);
  });

  it("opens Top movers from `units=true` alone with no redundant keys", () => {
    expect(reportsOverviewSearchSchema.parse({ units: true })).toEqual({
      units: true,
    });
    // The default tab never serializes; only "granular" is a legal value.
    expect(() =>
      reportsOverviewSearchSchema.parse({ unitsTab: "top" }),
    ).toThrow();
    expect(() =>
      reportsOverviewSearchSchema.parse({ unitsPage: 0 }),
    ).toThrow();
    expect(() =>
      reportsOverviewSearchSchema.parse({ unitsScroll: -1 }),
    ).toThrow();
  });

  it("drops legacy custom-range search state from the overview route", () => {
    expect(
      reportsOverviewSearchSchema.parse({
        rangeStart: "2026-06-01",
        rangeEnd: "2026-06-30",
        requestKey: "req-abc",
      }),
    ).toEqual({});
  });

  it("rejects malformed dates", () => {
    expect(() =>
      reportsOverviewSearchSchema.parse({ daysStart: "07/01/2026" }),
    ).toThrow();
    expect(() =>
      reportsOverviewSearchSchema.parse({ selectedDay: "07/16/2026" }),
    ).toThrow();
  });

  it("rejects an unknown overview window", () => {
    expect(() =>
      reportsOverviewSearchSchema.parse({ window: "quarter" }),
    ).toThrow();
  });

  it("rejects invalid day-list pages", () => {
    expect(() => reportsOverviewSearchSchema.parse({ daysPage: 0 })).toThrow();
    expect(() =>
      reportsOverviewSearchSchema.parse({ daysPage: 1.5 }),
    ).toThrow();
  });
});

describe("reports overview route query lifecycle (AE19)", () => {
  beforeEach(() => {
    routerState.queryReferences = [];
    routerState.overviewResult = { dailyTrend: [] };
    routerState.sharedDemoContext = null;
    routerState.detailNavigations = [];
    routerState.navigationOptions = [];
    routerState.search = {};
  });

  it("starts no weekly query while Overview is the active route", () => {
    render(
      createElement(
        (Route as unknown as { component: () => JSX.Element }).component,
      ),
    );

    // The generated api is a proxy that hands back a fresh object per access,
    // so subscriptions are identified by their resolved function name.
    const mounted = routerState.queryReferences.map((reference) =>
      getFunctionName(reference as never),
    );

    expect(mounted).toContain("reports/queries:getOverview");
    // Guards the fixture itself: the child panels really did mount, so their
    // subscriptions are part of what this assertion covers.
    expect(mounted.length).toBeGreaterThan(1);
    expect(mounted.filter((name) => /[Ww]eekly/.test(name))).toEqual([]);
  });

  it("skips every Reports read in the shared demo and still starts no weekly query", () => {
    routerState.sharedDemoContext = { kind: "shared_demo", storeId: "store-1" };
    render(
      createElement(
        (Route as unknown as { component: () => JSX.Element }).component,
      ),
    );

    // The day panel painted from the fixture, so this really is the mounted
    // subtree and not an unrendered route shell.
    expect(screen.getByTestId("report-days-panel")).toBeInTheDocument();
    // Every Reports read the fixture can answer stays skipped. The one live
    // subscription is the current operating day, which the fixture cannot
    // know: it holds the visitor's own sales.
    const mounted = routerState.queryReferences.map((reference) =>
      getFunctionName(reference as never),
    );
    expect(mounted.length).toBeGreaterThan(0);
    expect([...new Set(mounted)].sort()).toEqual([
      "reports/liveDay:getLiveOperatingDay",
      "reports/liveDay:listLiveSkuStock",
    ]);
  });

  it("opens no Reports read while the shared demo context is loading", () => {
    routerState.sharedDemoContext = undefined;
    render(
      createElement(
        (Route as unknown as { component: () => JSX.Element }).component,
      ),
    );

    expect(routerState.queryReferences).toEqual([]);
  });
});

/**
 * U6 continuity, exercised through the shared demo: the fixture serves a
 * completed movement snapshot synchronously, so the sheet reaches its settled
 * state with no live subscriptions to stub.
 */
describe("reports overview units sheet continuity (U6)", () => {
  function isoDateOffset(days: number): string {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
  }

  const demoRange = {
    startDate: isoDateOffset(-13),
    endDate: isoDateOffset(0),
  };

  beforeEach(() => {
    routerState.queryReferences = [];
    routerState.overviewResult = { dailyTrend: [] };
    routerState.sharedDemoContext = { kind: "shared_demo", storeId: "store-1" };
    routerState.detailNavigations = [];
    routerState.navigationOptions = [];
    routerState.search = {};
  });

  it("replaces history for open, tab switch, and close, cleaning sheet-owned keys", async () => {
    const user = userEvent.setup();
    const { rerender } = render(createElement(RouteComponent));

    await user.click(
      screen.getByRole("button", { name: "View item movement" }),
    );
    expect(routerState.search).toEqual({ units: true });
    rerender(createElement(RouteComponent));

    const dialog = screen.getByRole("dialog", { name: "Item movement" });
    await user.click(within(dialog).getByRole("tab", { name: "All items" }));
    expect(routerState.search).toEqual({ units: true, unitsTab: "granular" });
    rerender(createElement(RouteComponent));

    await user.click(screen.getByRole("tab", { name: "Top movers" }));
    expect(routerState.search).toEqual({ units: true });
    rerender(createElement(RouteComponent));

    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(routerState.search).toEqual({
      units: undefined,
      unitsTab: undefined,
      unitsPage: undefined,
      unitsFocus: undefined,
      unitsScroll: undefined,
    });
    // Same convention as Weekly: no sheet interaction adds a history entry.
    expect(
      routerState.navigationOptions.every(({ replace }) => replace === true),
    ).toBe(true);
  });

  it("persists focus continuity when drilling into SKU detail, then pushes one real entry", async () => {
    const user = userEvent.setup();
    const demoPage = createSharedDemoReportMovementPage(demoRange);
    expect(demoPage.rows.length).toBeGreaterThan(0);
    const firstSkuId = demoPage.rows[0].productSkuId;

    routerState.search = { units: true };
    render(createElement(RouteComponent));

    const dialog = screen.getByRole("dialog", { name: "Item movement" });
    const link = await waitFor(() => {
      const found = dialog.ownerDocument.querySelector<HTMLElement>(
        `[data-sku-link="${firstSkuId}"]`,
      );
      expect(found).not.toBeNull();
      return found!;
    });
    routerState.navigationOptions = [];

    await user.click(link);

    expect(routerState.search).toMatchObject({
      units: true,
      unitsFocus: firstSkuId,
    });
    expect(routerState.navigationOptions).toEqual([
      { replace: true, to: undefined },
      {
        replace: undefined,
        to: "/$orgUrlSlug/store/$storeUrlSlug/reports/items/$productSkuId",
      },
    ]);
    const detail = routerState.detailNavigations[0] as {
      params: Record<string, unknown>;
      search: Record<string, unknown>;
    };
    expect(detail.params).toEqual({
      orgUrlSlug: "acme",
      productSkuId: firstSkuId,
      storeUrlSlug: "downtown",
    });
    expect(detail.search.startDate).toBe(demoRange.startDate);
    expect(detail.search.endDate).toBe(demoRange.endDate);
    expect(typeof detail.search.o).toBe("string");
  });

  it("persists chart-origin focus so return restoration stays on the axis", async () => {
    const user = userEvent.setup();
    const demoPage = createSharedDemoReportMovementPage(demoRange);
    const firstSkuId = demoPage.rows[0].productSkuId;
    routerState.search = { units: true };
    render(createElement(RouteComponent));

    const chartLink = await waitFor(() => {
      const found = document.querySelector<HTMLElement>(
        `[data-chart-sku-link="${firstSkuId}"]`,
      );
      expect(found).not.toBeNull();
      return found!;
    });
    await user.click(chartLink);

    expect(routerState.search).toMatchObject({
      units: true,
      unitsFocus: `chart:${firstSkuId}`,
    });
  });

  it("restores scroll and the originating SKU link on return, then clears the keys", async () => {
    const demoPage = createSharedDemoReportMovementPage(demoRange);
    const firstSkuId = demoPage.rows[0].productSkuId;
    routerState.search = {
      units: true,
      unitsFocus: firstSkuId,
      unitsScroll: 640,
    };
    const scrollHeightSpy = vi
      .spyOn(HTMLElement.prototype, "scrollHeight", "get")
      .mockImplementation(function (this: HTMLElement) {
        return this.dataset.testid === "overview-scroll-container" ? 2_000 : 0;
      });
    const clientHeightSpy = vi
      .spyOn(HTMLElement.prototype, "clientHeight", "get")
      .mockImplementation(function (this: HTMLElement) {
        return this.dataset.testid === "overview-scroll-container" ? 600 : 0;
      });

    try {
      render(
        createElement(
          "div",
          {
            "data-testid": "overview-scroll-container",
            style: { overflowY: "auto" },
          },
          createElement(RouteComponent),
        ),
      );

      screen.getByRole("dialog", { name: "Item movement" });
      await waitFor(() =>
        expect(
          screen.getByTestId("overview-scroll-container").scrollTop,
        ).toBe(640),
      );
      await waitFor(() =>
        expect(document.activeElement).toBe(
          document.querySelector(`[data-sku-link="${firstSkuId}"]`),
        ),
      );
      await waitFor(() => {
        expect(routerState.search.unitsFocus).toBeUndefined();
        expect(routerState.search.unitsScroll).toBeUndefined();
      });
      expect(
        routerState.navigationOptions.every(
          ({ replace }) => replace === true,
        ),
      ).toBe(true);
    } finally {
      scrollHeightSpy.mockRestore();
      clientHeightSpy.mockRestore();
    }
  });

  it("falls back to the Granular heading with an announcement when the SKU is gone", async () => {
    routerState.search = {
      units: true,
      unitsTab: "granular",
      unitsFocus: "sku-that-no-longer-exists",
    };
    render(createElement(RouteComponent));

    const dialog = screen.getByRole("dialog", { name: "Item movement" });
    await waitFor(() =>
      expect(document.activeElement).toBe(
        within(dialog).getByRole("tab", { name: "All items" }),
      ),
    );
    expect(
      within(dialog).getByTestId("units-moved-restore-status"),
    ).toHaveTextContent(/Your previous item is no longer in this view\./);
    await waitFor(() =>
      expect(routerState.search.unitsFocus).toBeUndefined(),
    );
  });

  it("resets sheet continuity keys when the operating-day selection changes", async () => {
    const user = userEvent.setup();
    // A stale pasted URL can carry continuity keys for a closed sheet; a
    // different day selection names a different sheet period.
    routerState.search = {
      unitsTab: "granular",
      unitsPage: 4,
      unitsFocus: "sku-61",
      unitsScroll: 640,
    };
    render(createElement(RouteComponent));

    const dayRows = screen.getAllByRole("button", {
      name: /Show products sold for/,
    });
    await user.click(dayRows[0]);

    expect(routerState.search.selectedDay).toBeDefined();
    expect(routerState.search.unitsTab).toBeUndefined();
    expect(routerState.search.unitsPage).toBeUndefined();
    expect(routerState.search.unitsFocus).toBeUndefined();
    expect(routerState.search.unitsScroll).toBeUndefined();
  });
});
