import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Id } from "~/convex/_generated/dataModel";
import type { ProductSkuSearchResultLike } from "@/lib/skuSearch/productSkuSearchAdapters";

const navigate = vi.fn();
const useQuery = vi.fn();
let activeStoreId = "store-1";
let sharedDemoContext: { kind: string; storeId?: string } | null | undefined =
  null;

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigate,
  useParams: () => ({
    orgUrlSlug: "wigclub",
    storeUrlSlug: "wigclub",
  }),
}));
vi.mock("convex/react", () => ({
  useQuery: (...args: unknown[]) => useQuery(...args),
}));
vi.mock("@/hooks/useGetActiveStore", () => ({
  default: () => ({
    activeStore: activeStoreId
      ? { _id: activeStoreId as Id<"store">, currency: "GHS" }
      : null,
  }),
}));
vi.mock("@/hooks/useDebounce", () => ({
  useDebounce: <T,>(value: T) => value,
}));
vi.mock("@/hooks/useSharedDemoContext", () => ({
  useSharedDemoContext: () => sharedDemoContext,
}));

import { SHARED_DEMO_PRODUCTS } from "~/shared/sharedDemoStory";

import { ReportsCatalogLookup } from "./ReportsCatalogLookup";

function result(
  overrides: Partial<ProductSkuSearchResultLike> = {},
): ProductSkuSearchResultLike {
  return {
    barcode: "123456789012",
    categoryName: "Wigs",
    colorName: "Natural black",
    images: [],
    inventoryCount: 4,
    isVisible: true,
    length: 18,
    match: {
      kind: "sku",
      matchedValue: "BW-18",
      rank: 1,
    },
    netPrice: 120_00,
    price: 120_00,
    productAvailability: "live",
    productId: "product-1" as Id<"product">,
    productIsVisible: true,
    productName: "body wave bundle",
    productSkuId: "sku-1" as Id<"productSku">,
    productSlug: "body-wave-bundle",
    quantityAvailable: 3,
    size: "M",
    sku: "BW-18",
    skuIsVisible: true,
    storeId: "store-1" as Id<"store">,
    subcategoryName: "Bundles",
    ...overrides,
  };
}

describe("ReportsCatalogLookup", () => {
  it("keeps the search container focus ring transparent", () => {
    render(
      <ReportsCatalogLookup endDate="2026-07-29" startDate="2026-06-30" />,
    );

    expect(
      screen.getByTestId("reports-catalog-lookup").firstElementChild,
    ).toHaveClass("focus-within:ring-transparent");
  });

  beforeEach(() => {
    activeStoreId = "store-1";
    sharedDemoContext = null;
    navigate.mockReset();
    useQuery.mockReset();
    window.history.replaceState(
      {},
      "",
      "/wigclub/store/wigclub/reports?window=weekToDate",
    );
  });

  it("groups variants and navigates to the selected SKU with period and origin", async () => {
    const user = userEvent.setup();
    useQuery.mockReturnValue({
      candidateOverflow: false,
      limit: 25,
      truncated: false,
      results: [
        result(),
        result({
          barcode: null,
          colorName: "Brown",
          match: { kind: "text", matchedValue: "body", rank: 4 },
          productSkuId: "sku-2" as Id<"productSku">,
          size: "L",
          sku: "BW-20",
        }),
      ],
    });

    render(
      <ReportsCatalogLookup endDate="2026-07-29" startDate="2026-07-27" />,
    );

    expect(
      screen.getByTestId("reports-search-results-overlay"),
    ).not.toHaveClass("border-b");

    await user.type(
      screen.getByRole("searchbox", { name: "Search products" }),
      "body",
    );

    expect(screen.getByTestId("reports-search-results-overlay")).toHaveClass(
      "absolute",
      "bg-background",
      "left-0",
      "right-0",
      "z-50",
    );
    expect(
      screen.getByTestId("reports-search-results-overlay"),
    ).not.toHaveClass("bg-surface-raised");
    expect(
      screen.getByTestId("reports-search-results-overlay"),
    ).not.toHaveClass("shadow-sm", "shadow-md", "shadow-lg");
    expect(
      screen.getByTestId("reports-search-results-overlay"),
    ).toHaveAttribute("data-motion", "height");

    expect(
      screen.getByRole("heading", { name: "Body Wave Bundle" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /BW-18/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /BW-20/ })).toBeInTheDocument();
    expect(screen.getAllByText("GH₵120")).toHaveLength(2);

    await user.click(screen.getByRole("button", { name: /BW-18/ }));

    expect(navigate).toHaveBeenCalledWith({
      params: {
        orgUrlSlug: "wigclub",
        productSkuId: "sku-1",
        storeUrlSlug: "wigclub",
      },
      search: {
        endDate: "2026-07-29",
        o: encodeURIComponent(
          "/wigclub/store/wigclub/reports?window=weekToDate",
        ),
        startDate: "2026-07-27",
      },
      to: "/$orgUrlSlug/store/$storeUrlSlug/reports/items/$productSkuId",
    });
    expect(
      screen.getByRole("searchbox", { name: "Search products" }),
    ).toHaveValue("");
  });

  it("collapses product-search guidance into the input placeholder", () => {
    useQuery.mockReturnValue(undefined);

    render(
      <ReportsCatalogLookup endDate="2026-07-29" startDate="2026-07-29" />,
    );

    expect(
      screen.getByRole("searchbox", { name: "Search products" }),
    ).toHaveAttribute("placeholder", "Search by product name, SKU, or barcode");
    expect(
      screen.queryByRole("heading", { name: "Find a product" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "Find a product" }),
    ).toBeInTheDocument();
  });

  it("renders uniformly uppercased product names in title case", async () => {
    const user = userEvent.setup();
    useQuery.mockReturnValue({
      candidateOverflow: false,
      limit: 25,
      truncated: false,
      results: [
        {
          ...result({
            productName: "FRESH LOOK CONTACT SOLUTION",
            sku: "6N2Y-SZX-1D4",
          }),
          netPrice: 95_00,
        },
      ],
    });

    render(
      <ReportsCatalogLookup endDate="2026-07-29" startDate="2026-07-29" />,
    );
    await user.type(
      screen.getByRole("searchbox", { name: "Search products" }),
      "fresh",
    );

    expect(
      screen.getByRole("heading", { name: "Fresh Look Contact Solution" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "View report for Fresh Look Contact Solution, 6N2Y-SZX-1D4, net price GH₵95",
      }),
    ).toBeInTheDocument();
  });

  it("keeps archived exact matches selectable and explains limited results", async () => {
    const user = userEvent.setup();
    useQuery.mockReturnValue({
      candidateOverflow: true,
      limit: 25,
      truncated: true,
      results: [
        result({
          match: { kind: "text", matchedValue: "123456789012", rank: 4 },
          productId: "product-2" as Id<"product">,
          productName: "Text match",
          productSkuId: "sku-2" as Id<"productSku">,
          sku: "TEXT-1",
        }),
        result({
          match: { kind: "barcode", matchedValue: "123456789012", rank: 2 },
          productAvailability: "archived",
          productIsVisible: false,
        }),
      ],
    });

    render(
      <ReportsCatalogLookup endDate="2026-07-29" startDate="2026-06-30" />,
    );
    await user.type(
      screen.getByRole("searchbox", { name: "Search products" }),
      "123456789012",
    );

    expect(screen.getByLabelText("Archived product")).toHaveClass(
      "opacity-45",
    );
    expect(
      screen
        .getByRole("heading", { name: "Body Wave Bundle" })
        .parentElement?.parentElement?.parentElement,
    ).toHaveClass("[&_span]:opacity-45");
    expect(screen.getByText(/Refine your search/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /BW-18/ })).toBeEnabled();
    expect(
      screen
        .getAllByRole("heading", { level: 3 })
        .map((heading) => heading.textContent),
    ).toEqual(["Body Wave Bundle", "Text match"]);
  });

  it("clears the transient query with Escape", async () => {
    const user = userEvent.setup();
    useQuery.mockReturnValue({
      candidateOverflow: false,
      limit: 25,
      truncated: false,
      results: [result()],
    });

    render(
      <ReportsCatalogLookup endDate="2026-07-29" startDate="2026-07-29" />,
    );
    const searchbox = screen.getByRole("searchbox", {
      name: "Search products",
    });
    await user.type(searchbox, "body");
    await user.keyboard("{Escape}");

    expect(searchbox).toHaveValue("");
    expect(
      screen.queryByRole("heading", { name: "Body Wave Bundle" }),
    ).not.toBeInTheDocument();
  });

  it("clears from the anchored control and returns focus to search", async () => {
    const user = userEvent.setup();
    useQuery.mockReturnValue({
      candidateOverflow: false,
      limit: 25,
      truncated: false,
      results: [result()],
    });

    render(
      <ReportsCatalogLookup endDate="2026-07-29" startDate="2026-07-29" />,
    );
    const searchbox = screen.getByRole("searchbox", {
      name: "Search products",
    });
    await user.type(searchbox, "body");
    await user.click(
      screen.getByRole("button", { name: "Clear product search" }),
    );

    expect(searchbox).toHaveValue("");
    expect(searchbox).toHaveFocus();
  });

  it("distinguishes loading and no-match states and skips blank input", async () => {
    const user = userEvent.setup();
    useQuery.mockReturnValue(undefined);

    const { rerender } = render(
      <ReportsCatalogLookup endDate="2026-07-29" startDate="2026-07-29" />,
    );

    expect(useQuery.mock.calls.at(-1)?.[1]).toBe("skip");
    await user.type(
      screen.getByRole("searchbox", { name: "Search products" }),
      "missing",
    );
    expect(screen.getByRole("status")).toHaveTextContent("Searching");

    useQuery.mockReturnValue({
      candidateOverflow: false,
      limit: 25,
      truncated: false,
      results: [],
    });
    rerender(
      <ReportsCatalogLookup endDate="2026-07-29" startDate="2026-07-29" />,
    );
    expect(screen.getByText("No matching products")).toBeInTheDocument();
  });

  it("searches the shared demo's real catalogue, re-keyed to its story ids", async () => {
    // The demo searches live rows like any other store, so its provisioned
    // products are found by the server — but a hit navigates to the reports
    // detail route, which is addressed in fixture id space.
    const user = userEvent.setup();
    sharedDemoContext = { kind: "shared_demo", storeId: "store-1" };
    const kente = SHARED_DEMO_PRODUCTS.find(
      (product) => product.slug === "demo-kente-scarf",
    )!;
    useQuery.mockReturnValue({
      candidateOverflow: false,
      limit: 25,
      truncated: false,
      results: [
        result({
          productName: kente.name,
          productSkuId: "kg2realconvexid" as Id<"productSku">,
          productSlug: kente.slug,
          sku: kente.sku,
        }),
      ],
    });

    render(
      <ReportsCatalogLookup endDate="2026-07-29" startDate="2026-07-29" />,
    );
    await user.type(
      screen.getByRole("searchbox", { name: "Search products" }),
      "kente",
    );

    expect(useQuery.mock.calls.at(-1)?.[1]).toMatchObject({
      query: "kente",
      storeId: "store-1",
    });
    await user.click(
      screen.getByRole("button", { name: new RegExp(kente.sku) }),
    );

    expect(navigate).toHaveBeenCalledWith(
      expect.objectContaining({
        params: expect.objectContaining({
          productSkuId: "shared-demo-sku-demo-kente-scarf",
        }),
      }),
    );
  });

  it("finds a sku created at the register and routes to its live id", async () => {
    // The gap this closes: a quick-added SKU exists only in the store's real
    // rows, so a local story fixture could never return it at all.
    const user = userEvent.setup();
    sharedDemoContext = { kind: "shared_demo", storeId: "store-1" };
    useQuery.mockReturnValue({
      candidateOverflow: false,
      limit: 25,
      truncated: false,
      results: [
        result({
          productName: "bottled water",
          productSkuId: "kg2quickadd" as Id<"productSku">,
          sku: "FM5W-QCK-ADD",
        }),
      ],
    });

    render(
      <ReportsCatalogLookup endDate="2026-07-29" startDate="2026-07-29" />,
    );
    await user.type(
      screen.getByRole("searchbox", { name: "Search products" }),
      "water",
    );

    expect(
      screen.getByRole("heading", { name: "Bottled Water" }),
    ).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: /FM5W-QCK-ADD/ }),
    );

    expect(navigate).toHaveBeenCalledWith(
      expect.objectContaining({
        params: expect.objectContaining({
          productSkuId: "shared-demo-live-sku-kg2quickadd",
        }),
      }),
    );
  });

  it("keeps the live search subscription for a real store", async () => {
    const user = userEvent.setup();
    useQuery.mockReturnValue({
      candidateOverflow: false,
      limit: 25,
      truncated: false,
      results: [result()],
    });

    render(
      <ReportsCatalogLookup endDate="2026-07-29" startDate="2026-07-29" />,
    );
    await user.type(
      screen.getByRole("searchbox", { name: "Search products" }),
      "body",
    );

    expect(useQuery.mock.calls.at(-1)?.[1]).toEqual({
      limit: 25,
      query: "body",
      storeId: "store-1",
    });
  });

  it("holds the live search while the shared demo context is loading", async () => {
    const user = userEvent.setup();
    sharedDemoContext = undefined;
    useQuery.mockReturnValue(undefined);

    render(
      <ReportsCatalogLookup endDate="2026-07-29" startDate="2026-07-29" />,
    );
    await user.type(
      screen.getByRole("searchbox", { name: "Search products" }),
      "body",
    );

    expect(useQuery.mock.calls.at(-1)?.[1]).toBe("skip");
    expect(screen.getByRole("status")).toHaveTextContent("Searching");
  });

  it("clears a query when the active store changes", async () => {
    const user = userEvent.setup();
    useQuery.mockReturnValue({
      candidateOverflow: false,
      limit: 25,
      truncated: false,
      results: [result()],
    });

    const { rerender } = render(
      <ReportsCatalogLookup endDate="2026-07-29" startDate="2026-07-29" />,
    );
    await user.type(
      screen.getByRole("searchbox", { name: "Search products" }),
      "body",
    );

    activeStoreId = "store-2";
    rerender(
      <ReportsCatalogLookup endDate="2026-07-29" startDate="2026-07-29" />,
    );

    expect(
      screen.queryByRole("heading", { name: "Body Wave Bundle" }),
    ).not.toBeInTheDocument();
    await waitFor(() =>
      expect(
        screen.getByRole("searchbox", { name: "Search products" }),
      ).toHaveValue(""),
    );
  });
});
