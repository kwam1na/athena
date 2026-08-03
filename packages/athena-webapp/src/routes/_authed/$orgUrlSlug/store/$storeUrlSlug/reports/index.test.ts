import { createElement } from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const routerState = vi.hoisted(() => ({
  /** Every Convex query reference the Overview route tree subscribes to. */
  queryReferences: [] as unknown[],
  overviewResult: undefined as unknown,
  /** `null` = a real store; see `useReportsSharedDemoMode`. */
  sharedDemoContext: null as { kind: string } | null | undefined,
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: Record<string, unknown>) => ({
    ...options,
    useNavigate: () => () => undefined,
    useSearch: () => ({}),
  }),
  Link: ({ children }: { children?: React.ReactNode }) =>
    createElement("a", null, children),
  useLocation: () => ({ pathname: "/acme/store/downtown/reports", search: {} }),
  useNavigate: () => () => undefined,
  useRouter: () => ({ navigate: () => undefined }),
  useSearch: () => ({}),
  useParams: () => ({ orgUrlSlug: "acme", storeUrlSlug: "downtown" }),
}));

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

import { Route, reportsOverviewSearchSchema } from "./index";

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
    };
    expect(reportsOverviewSearchSchema.parse(value)).toEqual(value);
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
    routerState.sharedDemoContext = { kind: "shared_demo" };
    render(
      createElement(
        (Route as unknown as { component: () => JSX.Element }).component,
      ),
    );

    // The day panel painted from the fixture, so this really is the mounted
    // subtree and not an unrendered route shell.
    expect(screen.getByTestId("report-days-panel")).toBeInTheDocument();
    expect(routerState.queryReferences).toEqual([]);
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
