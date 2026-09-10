import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "~/convex/_generated/api";
import { AnalyticsInsights } from "./AnalyticsInsights";

const mocks = vi.hoisted(() => ({
  context: undefined as undefined | null | { kind: "shared_demo" },
  product: { _id: "product-1" } as { _id: string } | undefined,
  query: vi.fn(),
}));

vi.mock("convex/react", () => ({ useQuery: mocks.query }));
vi.mock("~/src/hooks/useSharedDemoContext", () => ({
  useSharedDemoContext: () => mocks.context,
}));
vi.mock("~/src/hooks/useGetActiveStore", () => ({
  default: () => ({ activeStore: { _id: "store-1" } }),
}));
vi.mock("~/src/contexts/ProductContext", () => ({
  useProduct: () => ({
    activeProduct: mocks.product,
    activeProductVariant: { sku: "SKU-1" },
  }),
}));

describe("product analytics admission", () => {
  beforeEach(() => {
    mocks.context = null;
    mocks.product = { _id: "product-1" };
    mocks.query.mockReset();
    mocks.query.mockImplementation((_query, args) => {
      if (args === "skip") return undefined;
      if (mocks.context?.kind === "shared_demo") {
        throw new Error("shared_demo_action_denied");
      }
      return [];
    });
  });
  afterEach(cleanup);

  it("renders demo guidance without issuing the denied analytics read", () => {
    mocks.context = { kind: "shared_demo" };
    render(<AnalyticsInsights />);
    expect(mocks.query).toHaveBeenCalledWith(api.storeFront.analytics.getAll, "skip");
    expect(screen.getByText("Storefront analytics are not available in the demo.")).toBeInTheDocument();
    expect(screen.queryByText("Total Views")).not.toBeInTheDocument();
  });

  it("waits for demo context before subscribing, including a cold demo load", () => {
    mocks.context = undefined;
    const view = render(<AnalyticsInsights />);
    expect(mocks.query).toHaveBeenLastCalledWith(api.storeFront.analytics.getAll, "skip");
    mocks.context = { kind: "shared_demo" };
    view.rerender(<AnalyticsInsights />);
    expect(mocks.query).toHaveBeenLastCalledWith(api.storeFront.analytics.getAll, "skip");
  });

  it("keeps the product-scoped analytics read for normal operators", () => {
    render(<AnalyticsInsights />);
    expect(mocks.query).toHaveBeenCalledWith(api.storeFront.analytics.getAll, {
      storeId: "store-1", action: "viewed_product", productId: "product-1",
    });
    expect(screen.getByText("Total Views")).toBeInTheDocument();
  });

  it("does not issue a store-wide read while the product is loading", () => {
    mocks.product = undefined;
    render(<AnalyticsInsights />);
    expect(mocks.query).toHaveBeenCalledWith(api.storeFront.analytics.getAll, "skip");
  });
});
