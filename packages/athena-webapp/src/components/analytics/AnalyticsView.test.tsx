import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ activeStore: { _id: "store-1", name: "Wigclub" }, summary: undefined as unknown }));
vi.mock("convex/react", () => ({ useQuery: () => mocks.summary }));
vi.mock("@/hooks/useGetActiveStore", () => ({ default: () => ({ activeStore: mocks.activeStore }) }));
vi.mock("~/convex/_generated/api", () => ({ api: { storeFront: { analytics: { getWorkspaceSummary: "summary" } } } }));
vi.mock("../View", () => ({ default: ({ children }: { children: React.ReactNode }) => <main>{children}</main> }));
vi.mock("./StoreInsights", () => ({ default: () => <section>Store insights</section> }));
vi.mock("./AnalyticsCombinedUsers", () => ({ default: () => <section>Shopper detail</section> }));
vi.mock("./AnalyticsProducts", () => ({ default: () => <section>Product detail</section> }));

import AnalyticsView from "./AnalyticsView";

describe("AnalyticsView storefront report", () => {
  beforeEach(() => { mocks.summary = undefined; });

  it("announces loading instead of rendering a blank workspace", () => {
    render(<AnalyticsView />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading storefront activity");
  });

  it("explains when live engagement is unavailable", () => {
    mocks.summary = null;
    render(<AnalyticsView />);
    expect(screen.getByRole("heading", { name: "Storefront activity unavailable" })).toBeInTheDocument();
  });

  it("labels storefront activity as independent from financial reporting", () => {
    mocks.summary = {
      overview: { activeCheckoutSessions: 0, knownShoppers: 0, productViews: 0, visitorsToday: 0 },
      recentEvents: [], topProducts: [], topUsers: [],
    };
    render(<AnalyticsView />);
    expect(screen.getByText(/own timeframe and does not change financial report totals/i)).toBeInTheDocument();
    expect(screen.getByText("No storefront activity has been recorded yet.")).toBeInTheDocument();
  });
});
