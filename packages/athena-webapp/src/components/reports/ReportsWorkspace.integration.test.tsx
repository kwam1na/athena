import { render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import React from "react";
import { describe, expect, it, vi } from "vitest";

const currentSearch = {
  classification: "low_cover",
  comparison: "prior_period",
  cursor: "opaque-page",
  end: "2026-07-11",
  itemSort: "cover",
  preset: "custom",
  runId: "range-run",
  start: "2026-07-01",
};

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    search,
    to,
    ...props
  }: React.ComponentProps<"a"> & {
    params?: unknown;
    search?:
      | boolean
      | Record<string, unknown>
      | ((current: typeof currentSearch) => Record<string, unknown>);
    to: string;
  }) => {
    delete props.params;
    const nextSearch =
      typeof search === "function"
        ? search(currentSearch)
        : search === true
          ? currentSearch
          : (search ?? {});
    return (
      <a data-search={JSON.stringify(nextSearch)} href={to} {...props}>
        {children}
      </a>
    );
  },
  Outlet: () => <div>Nested report</div>,
  useLocation: () => ({ pathname: "/acme/store/downtown/reports" }),
  useNavigate: () => vi.fn(),
  useParams: () => ({ orgUrlSlug: "acme", storeUrlSlug: "downtown" }),
  useSearch: () => currentSearch,
}));
vi.mock("convex/react", () => ({
  useAction: () => vi.fn(),
  useMutation: () => vi.fn(),
}));
vi.mock("@/hooks/useGetActiveStore", () => ({
  default: () => ({ activeStore: { _id: "store-1" } }),
}));
vi.mock("~/convex/_generated/api", () => ({
  api: {
    reporting: {
      customRangeRequests: {
        getCustomRangeStatus: "status",
        requestCustomRange: "request",
      },
    },
  },
}));
vi.mock("@/components/View", () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <main>{children}</main>
  ),
}));
vi.mock("@/components/common/FadeIn", () => ({
  FadeIn: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

import { ReportsLayout } from "./ReportsLayout";

describe("Reports workspace integration seams", () => {
  it("preserves the selected period across views and clears view-specific continuation state", () => {
    render(<ReportsLayout />);
    for (const name of ["Overview", "Items", "Inventory"]) {
      const search = JSON.parse(
        screen.getByRole("link", { name }).getAttribute("data-search") ?? "{}",
      );
      expect(search).toEqual({
        comparison: "prior_period",
        end: "2026-07-11",
        preset: "custom",
        runId: "range-run",
        start: "2026-07-01",
      });
      expect(search).not.toHaveProperty("cursor");
      expect(search.runId).toBe("range-run");
      expect(search).not.toHaveProperty("classification");
      expect(search).not.toHaveProperty("itemSort");
    }
    const storefrontSearch = JSON.parse(
      screen
        .getByRole("link", { name: "Storefront" })
        .getAttribute("data-search") ?? "{}",
    );
    expect(storefrontSearch).toEqual({
      comparison: "prior_period",
      end: "2026-07-11",
      preset: "custom",
      start: "2026-07-01",
    });
    expect(storefrontSearch).not.toHaveProperty("runId");
  });

  it("keeps SKU detail navigation in the selected-period context", () => {
    const source = readFileSync(
      join(
        process.cwd(),
        "src/routes/_authed/$orgUrlSlug/store/$storeUrlSlug/reports/items/index.tsx",
      ),
      "utf8",
    );
    expect(source).toContain(
      'to: "/$orgUrlSlug/store/$storeUrlSlug/reports/items/$productSkuId"',
    );
    expect(source).toMatch(/onOpenItem[\s\S]*search: true/);
  });

  it("uses the generation-bound custom presentation contract on every financial surface", () => {
    for (const path of [
      "src/components/reports/ReportsOverviewView.tsx",
      "src/routes/_authed/$orgUrlSlug/store/$storeUrlSlug/reports/items/index.tsx",
      "src/routes/_authed/$orgUrlSlug/store/$storeUrlSlug/reports/inventory.tsx",
      "src/routes/_authed/$orgUrlSlug/store/$storeUrlSlug/reports/items/$productSkuId.tsx",
    ]) {
      const source = readFileSync(join(process.cwd(), path), "utf8");
      expect(source).toContain("getReportsCustomRangePresentation");
    }
  });

  it("binds item evidence to authoritative period bounds and resets between periods", () => {
    const source = readFileSync(
      join(
        process.cwd(),
        "src/routes/_authed/$orgUrlSlug/store/$storeUrlSlug/reports/items/$productSkuId.tsx",
      ),
      "utf8",
    );
    expect(source).toContain("periodStart: detailResult.data.periodStart");
    expect(source).toContain("periodEnd: detailResult.data.periodEnd");
    expect(source).toContain("setEvidence(undefined)");
  });

  it("sends custom item sort and classification to the server presentation", () => {
    const source = readFileSync(
      join(
        process.cwd(),
        "src/routes/_authed/$orgUrlSlug/store/$storeUrlSlug/reports/items/index.tsx",
      ),
      "utf8",
    );
    expect(source).toMatch(
      /getReportsCustomRangePresentation[\s\S]*classification,[\s\S]*sort,/,
    );
  });

  it("keeps Storefront independent from financial reporting queries", () => {
    const source = readFileSync(
      join(
        process.cwd(),
        "src/routes/_authed/$orgUrlSlug/store/$storeUrlSlug/reports/storefront.tsx",
      ),
      "utf8",
    );
    expect(source).toContain(
      'import AnalyticsView from "@/components/analytics/AnalyticsView"',
    );
    expect(source).not.toContain("api.reporting");
    expect(source).not.toContain("getReportsOverview");
  });
});
