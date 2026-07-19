import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Product } from "~/types";
import type { Id } from "~/convex/_generated/dataModel";
import type { ProductSkuSearchResultLike } from "~/src/lib/skuSearch/productSkuSearchAdapters";

import Products from "./Products";

const quickAddProductSkuMock = vi.fn();
const repairCatalogSummaryMock = vi.fn();
const mockedProducts = vi.hoisted(() => ({
  allProducts: [] as Product[],
  categories: [] as Array<{ _id: string; name: string; slug: string }>,
  draftProducts: [] as Product[],
  hiddenDraftProducts: [] as Product[],
  hiddenLiveProducts: [] as Product[],
  catalogSummary: {
    categoryCount: 0,
    missingInfoProductCount: 0,
    outOfStockProductCount: 0,
    productCount: 0,
  } as {
    categoryCount: number;
    missingInfoProductCount: number;
    needsRefresh?: boolean;
    outOfStockProductCount: number;
    productCount: number;
    updatedAt?: number;
  },
  skuSearchResults: [] as unknown[] | undefined,
}));
const routerMocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  search: {} as Record<string, unknown>,
}));
const sharedDemoMocks = vi.hoisted(() => ({
  context: null as null | { kind: "shared_demo" },
}));

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

globalThis.ResizeObserver = ResizeObserverStub;

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: React.ReactNode }) => (
    <a href="#products">{children}</a>
  ),
  useNavigate: () => routerMocks.navigate,
  useSearch: () => routerMocks.search,
}));

vi.mock("~/src/hooks/useGetCategories", () => ({
  useGetCategories: () => mockedProducts.categories,
}));

vi.mock("~/src/hooks/useGetProducts", () => ({
  useGetProducts: (args?: { availability?: string; isVisible?: boolean }) => {
    if (args?.availability === "draft" && args.isVisible === false) {
      return mockedProducts.hiddenDraftProducts;
    }
    if (args?.availability === "live" && args.isVisible === false) {
      return mockedProducts.hiddenLiveProducts;
    }
    if (args?.availability === "draft") {
      return mockedProducts.draftProducts;
    }

    return mockedProducts.allProducts;
  },
}));

vi.mock("convex/react", () => ({
  useMutation: () => repairCatalogSummaryMock,
  useQuery: (_query: unknown, args: unknown) => {
    if (
      args &&
      typeof args === "object" &&
      "storeId" in args &&
      !("query" in args) &&
      !("id" in args)
    ) {
      return mockedProducts.catalogSummary;
    }

    if (
      args &&
      typeof args === "object" &&
      "query" in args &&
      "limit" in args
    ) {
      if (mockedProducts.skuSearchResults === undefined) {
        return undefined;
      }

      return {
        candidateOverflow: false,
        results: mockedProducts.skuSearchResults,
        truncated: false,
      };
    }

    if (
      args &&
      typeof args === "object" &&
      "id" in args &&
      args.id === "subcategory-legacy"
    ) {
      return { name: "Imported accessories" };
    }

    return { name: "Home Care" };
  },
}));

vi.mock("~/src/hooks/usePermissions", () => ({
  usePermissions: () => ({
    hasFullAdminAccess: true,
  }),
}));

vi.mock("~/src/hooks/useGetActiveStore", () => ({
  default: () => ({
    activeStore: {
      _id: "store-1",
    },
  }),
}));

vi.mock("~/src/hooks/useAuth", () => ({
  useAuth: () => ({
    user: {
      _id: "user-1",
    },
  }),
}));

vi.mock("~/src/hooks/usePOSProducts", () => ({
  usePOSQuickAddProductSku: () => quickAddProductSkuMock,
}));

vi.mock("~/src/hooks/useSharedDemoContext", () => ({
  useSharedDemoContext: () => sharedDemoMocks.context,
}));

describe("Products", () => {
  beforeEach(() => {
    quickAddProductSkuMock.mockReset();
    repairCatalogSummaryMock.mockReset();
    repairCatalogSummaryMock.mockResolvedValue(undefined);
    mockedProducts.allProducts = [];
    mockedProducts.categories = [];
    mockedProducts.draftProducts = [];
    mockedProducts.hiddenDraftProducts = [];
    mockedProducts.hiddenLiveProducts = [];
    mockedProducts.catalogSummary = {
      categoryCount: 0,
      missingInfoProductCount: 0,
      outOfStockProductCount: 0,
      productCount: 0,
    };
    mockedProducts.skuSearchResults = [];
    sharedDemoMocks.context = null;
    routerMocks.navigate.mockReset();
    routerMocks.search = {};
  });

  it("hides full product creation and archived products in the shared demo", () => {
    sharedDemoMocks.context = { kind: "shared_demo" };

    render(<Products />);

    expect(
      screen.queryByRole("button", { name: "New Product" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Archived products" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /quick add/i })).toBeVisible();
  });

  it("keeps product creation and archived products outside the shared demo", () => {
    render(<Products />);

    expect(screen.getByRole("button", { name: "New Product" })).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Archived products" }),
    ).toBeVisible();
  });

  it("quick adds a product with variants from the products workspace", async () => {
    const user = userEvent.setup();
    quickAddProductSkuMock
      .mockResolvedValueOnce({
        productId: "product-1",
        skuId: "sku-1",
      })
      .mockResolvedValueOnce({
        productId: "product-1",
        skuId: "sku-2",
      });

    render(<Products />);

    await user.click(screen.getByRole("button", { name: /quick add/i }));
    const dialog = screen.getByRole("dialog");
    await user.type(
      within(dialog).getByLabelText(/product name/i),
      "Restock item",
    );
    await user.type(within(dialog).getByLabelText(/barcode/i), "123456789");
    await user.type(within(dialog).getByLabelText(/selling price/i), "45");
    await user.click(within(dialog).getByLabelText(/add multiple variants/i));
    await user.click(screen.getByRole("button", { name: /add variant/i }));
    await user.type(
      within(dialog).getAllByLabelText(/barcode/i)[1],
      "987654321",
    );
    await user.type(
      within(dialog).getAllByLabelText(/selling price/i)[1],
      "50",
    );

    await user.click(
      screen.getByRole("button", { name: /add product variants/i }),
    );

    await waitFor(() =>
      expect(quickAddProductSkuMock).toHaveBeenCalledTimes(2),
    );
    expect(quickAddProductSkuMock).toHaveBeenNthCalledWith(1, {
      storeId: "store-1",
      createdByUserId: "user-1",
      name: "Restock item",
      lookupCode: "123456789",
      price: 4500,
      quantityAvailable: 1,
    });
    expect(quickAddProductSkuMock).toHaveBeenNthCalledWith(2, {
      storeId: "store-1",
      createdByUserId: "user-1",
      name: "Restock item",
      lookupCode: "987654321",
      price: 5000,
      quantityAvailable: 1,
      productId: "product-1",
    });
  });

  it("prefills quick add barcode from a numeric product search", async () => {
    const user = userEvent.setup();

    render(<Products />);

    await user.type(
      screen.getByPlaceholderText(/search products/i),
      "075724640412",
    );
    await user.click(screen.getByRole("button", { name: /quick add/i }));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByLabelText(/product name/i)).toHaveValue("");
    expect(within(dialog).getByLabelText(/barcode/i)).toHaveValue(
      "075724640412",
    );
  });

  it("prefills quick add product name from a text product search", async () => {
    const user = userEvent.setup();

    render(<Products />);

    await user.type(
      screen.getByPlaceholderText(/search products/i),
      "Mahogany Teakwood",
    );
    await user.click(screen.getByRole("button", { name: /quick add/i }));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByLabelText(/product name/i)).toHaveValue(
      "Mahogany Teakwood",
    );
    expect(within(dialog).getByLabelText(/barcode/i)).toHaveValue("");
  });

  it("renders fuzzy product matches returned by foundation search", async () => {
    const user = userEvent.setup();
    const mahogany = makeProduct({
      categoryName: "Home Care",
      id: "product-1",
      inventoryCount: 12,
      name: "Mahogany Teakwood",
      sku: "6N2Y-9W1-PNN",
    });
    const closure = makeProduct({
      categoryName: "Hair",
      id: "product-2",
      inventoryCount: 8,
      name: "Closure Wig",
      sku: "CW-18",
    });
    mockedProducts.skuSearchResults = [
      makeSkuSearchResult(mahogany, {
        match: { kind: "text", matchedValue: "Mahogany Teakwood", rank: 1 },
      }),
    ];

    render(<Products />);

    await user.type(screen.getByPlaceholderText(/search products/i), "mahogny");

    expect(screen.getByText("Mahogany Teakwood")).toBeInTheDocument();
    expect(screen.queryByText("Closure Wig")).not.toBeInTheDocument();

    await user.clear(screen.getByPlaceholderText(/search products/i));
    mockedProducts.skuSearchResults = [
      makeSkuSearchResult(closure, {
        colorName: "Natural black",
        match: { kind: "text", matchedValue: "Natural black", rank: 1 },
      }),
    ];
    await user.type(screen.getByPlaceholderText(/search products/i), "natrual");

    expect(screen.getByText("Closure Wig")).toBeInTheDocument();
    expect(screen.queryByText("Mahogany Teakwood")).not.toBeInTheDocument();
  });

  it("shows product groups returned by generic SKU search outside the loaded snapshot", async () => {
    const user = userEvent.setup();
    mockedProducts.allProducts = [
      makeProduct({
        id: "product-local",
        inventoryCount: 4,
        name: "Loaded Product",
        sku: "LOCAL-1",
      }),
    ];
    mockedProducts.skuSearchResults = [
      {
        barcode: "123456789012",
        categoryId: "category-1",
        categoryName: "Hair",
        categorySlug: "hair",
        colorName: "Natural black",
        images: [],
        inventoryCount: 6,
        isVisible: true,
        length: 18,
        match: { kind: "sku", matchedValue: "GLOBAL-18", rank: 1 },
        price: 5500,
        productAvailability: "live",
        productId: "product-global",
        productIsVisible: true,
        productName: "Global Search Wig",
        productSkuId: "sku-global",
        productSlug: "global-search-wig",
        quantityAvailable: 6,
        size: "M",
        sku: "GLOBAL-18",
        skuIsVisible: true,
        storeId: "store-1",
        subcategoryId: "subcategory-1",
        subcategoryName: "Bundles",
        subcategorySlug: "bundles",
      },
    ];

    render(<Products />);

    await user.type(
      screen.getByPlaceholderText(/search products/i),
      "GLOBAL-18",
    );

    expect(screen.getByText("Global Search Wig")).toBeInTheDocument();
    expect(screen.queryByText("Loaded Product")).not.toBeInTheDocument();
    expect(screen.getByText("Search results")).toBeInTheDocument();
  });

  it("orders product search results by foundation SKU search rank", async () => {
    const user = userEvent.setup();
    mockedProducts.allProducts = [
      makeProduct({
        id: "product-ampro",
        inventoryCount: 0,
        name: "Ampro Gel Bucket",
        sku: "AMPRO-352",
      }),
      makeProduct({
        id: "product-angeli",
        inventoryCount: 0,
        name: "Angeli",
        sku: "ANGELI-1",
      }),
    ];
    mockedProducts.skuSearchResults = [
      {
        barcode: "",
        categoryId: "category-1",
        categoryName: "Hair",
        categorySlug: "hair",
        colorName: "",
        images: [],
        inventoryCount: 0,
        isVisible: true,
        length: null,
        match: { kind: "text", matchedValue: "Angeli", rank: 1 },
        price: 2500,
        productAvailability: "live",
        productId: "product-angeli",
        productIsVisible: true,
        productName: "Angeli",
        productSkuId: "product-angeli-sku",
        productSlug: "angeli",
        quantityAvailable: 0,
        size: "",
        sku: "ANGELI-1",
        skuIsVisible: true,
        storeId: "store-1",
        subcategoryId: "subcategory-1",
        subcategoryName: "Wigs",
        subcategorySlug: "wigs",
      },
      {
        barcode: "",
        categoryId: "category-1",
        categoryName: "Hair",
        categorySlug: "hair",
        colorName: "",
        images: [],
        inventoryCount: 0,
        isVisible: true,
        length: null,
        match: { kind: "text", matchedValue: "Ampro Gel Bucket", rank: 2 },
        price: 2500,
        productAvailability: "live",
        productId: "product-ampro",
        productIsVisible: true,
        productName: "Ampro Gel Bucket",
        productSkuId: "product-ampro-sku",
        productSlug: "ampro-gel-bucket",
        quantityAvailable: 0,
        size: "",
        sku: "AMPRO-352",
        skuIsVisible: true,
        storeId: "store-1",
        subcategoryId: "subcategory-1",
        subcategoryName: "Wigs",
        subcategorySlug: "wigs",
      },
    ];

    render(<Products />);

    await user.type(screen.getByPlaceholderText(/search products/i), "angeli");

    const angeli = screen.getByText("Angeli");
    const ampro = screen.getByText("Ampro Gel Bucket");

    expect(
      angeli.compareDocumentPosition(ampro) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("uses the shared SKU search bar without secondary filters", () => {
    mockedProducts.categories = [
      { _id: "category-1", name: "Hair", slug: "hair" },
      { _id: "category-2", name: "Home Care", slug: "home-care" },
    ];
    mockedProducts.catalogSummary = {
      categoryCount: 12,
      missingInfoProductCount: 9,
      outOfStockProductCount: 4,
      productCount: 445,
    };
    mockedProducts.allProducts = [
      makeProduct({
        id: "product-1",
        categoryId: "category-1",
        categoryName: "Hair",
        categorySlug: "hair",
        inventoryCount: 8,
        name: "Closure Wig",
        sku: "CW-18",
      }),
      makeProduct({
        id: "product-2",
        categoryId: "category-2",
        categoryName: "Home Care",
        categorySlug: "home-care",
        inventoryCount: 0,
        name: "Mahogany Teakwood",
        sku: "CANDLE-1",
      }),
    ];

    render(<Products />);

    expect(
      screen.getByRole("textbox", {
        name: /search products, skus, or barcodes/i,
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("combobox", { name: /filter by availability/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText("Filter by category"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("2 products in catalog."),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("Showing 2 of 2 products."),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Search results")).not.toBeInTheDocument();
    expect(screen.getByText("Browse categories")).toBeInTheDocument();

    expect(screen.getByText("445")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByText("9")).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(repairCatalogSummaryMock).not.toHaveBeenCalled();
  });

  it("restores product search from the URL query", () => {
    routerMocks.search = { query: "angeli" };
    mockedProducts.skuSearchResults = [
      makeSkuSearchResult(
        makeProduct({
          id: "product-angeli",
          inventoryCount: 0,
          name: "Angeli",
          sku: "ANGELI-1",
        }),
      ),
    ];

    render(<Products />);

    expect(
      screen.getByRole("textbox", {
        name: /search products, skus, or barcodes/i,
      }),
    ).toHaveValue("angeli");
    expect(screen.getByText("Angeli")).toBeInTheDocument();
  });

  it("keeps product search changes in the URL", async () => {
    const user = userEvent.setup();

    render(<Products />);

    await user.type(
      screen.getByRole("textbox", {
        name: /search products, skus, or barcodes/i,
      }),
      "bonnet",
    );

    expect(routerMocks.navigate).toHaveBeenLastCalledWith({
      replace: true,
      search: expect.any(Function),
    });
    const writeQuerySearch = routerMocks.navigate.mock.calls.at(-1)?.[0]
      .search as (current: Record<string, unknown>) => Record<string, unknown>;
    expect(writeQuerySearch({ o: "/return", page: 3 })).toEqual({
      o: "/return",
      query: "bonnet",
    });

    await user.clear(
      screen.getByRole("textbox", {
        name: /search products, skus, or barcodes/i,
      }),
    );

    const clearQuerySearch = routerMocks.navigate.mock.calls.at(-1)?.[0]
      .search as (current: Record<string, unknown>) => Record<string, unknown>;
    expect(clearQuerySearch({ o: "/return", query: "bonnet" })).toEqual({
      o: "/return",
    });
  });

  it("restores product search pagination from the URL page", () => {
    routerMocks.search = { page: 3, query: "mizani" };
    mockedProducts.skuSearchResults = Array.from({ length: 25 }, (_, index) =>
      makeSkuSearchResult(
        makeProduct({
          id: `product-mizani-${index + 1}`,
          inventoryCount: 0,
          name: `Mizani ${String(index + 1).padStart(2, "0")}`,
          sku: `MIZANI-${index + 1}`,
        }),
      ),
    );

    render(<Products />);

    expect(screen.getByText("Page 3 of 3")).toBeInTheDocument();
    expect(screen.getByText("Mizani 21")).toBeInTheDocument();
    expect(screen.queryByText("Mizani 01")).not.toBeInTheDocument();
  });

  it("clamps out-of-range product search pages from the URL", async () => {
    routerMocks.search = { page: 999, query: "mizani" };
    mockedProducts.skuSearchResults = Array.from({ length: 25 }, (_, index) =>
      makeSkuSearchResult(
        makeProduct({
          id: `product-mizani-${index + 1}`,
          inventoryCount: 0,
          name: `Mizani ${String(index + 1).padStart(2, "0")}`,
          sku: `MIZANI-${index + 1}`,
        }),
      ),
    );

    render(<Products />);

    expect(screen.getByText("Page 3 of 3")).toBeInTheDocument();
    expect(screen.getByText("Mizani 21")).toBeInTheDocument();
    expect(screen.queryByText("Mizani 01")).not.toBeInTheDocument();

    await waitFor(() => expect(routerMocks.navigate).toHaveBeenCalled());
    const normalizePageSearch = routerMocks.navigate.mock.calls.at(-1)?.[0]
      .search as (current: Record<string, unknown>) => Record<string, unknown>;
    expect(normalizePageSearch({ query: "mizani", page: 999 })).toEqual({
      query: "mizani",
      page: 3,
    });
  });

  it("preserves product search page URLs while search results are loading", () => {
    routerMocks.search = { page: 3, query: "mizani" };
    mockedProducts.skuSearchResults = undefined;

    render(<Products />);

    expect(
      screen.getByRole("textbox", {
        name: /search products, skus, or barcodes/i,
      }),
    ).toHaveValue("mizani");
    expect(routerMocks.navigate).not.toHaveBeenCalled();
  });

  it("keeps product search pending while URL-restored results are loading", () => {
    routerMocks.search = { query: "kii" };
    mockedProducts.skuSearchResults = undefined;

    render(<Products />);

    expect(screen.getByText("Searching product catalog")).toBeInTheDocument();
    expect(
      screen.getByText("Checking matching products before showing final results."),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("No products match your search"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("...")).toBeInTheDocument();
  });

  it("keeps product search pagination changes in the URL", async () => {
    const user = userEvent.setup();
    routerMocks.search = { query: "mizani" };
    mockedProducts.skuSearchResults = Array.from({ length: 11 }, (_, index) =>
      makeSkuSearchResult(
        makeProduct({
          id: `product-mizani-${index + 1}`,
          inventoryCount: 0,
          name: `Mizani ${index + 1}`,
          sku: `MIZANI-${index + 1}`,
        }),
      ),
    );

    render(<Products />);

    await user.click(
      screen.getByRole("button", { name: /go to next page/i }),
    );

    expect(routerMocks.navigate).toHaveBeenLastCalledWith({
      replace: true,
      search: expect.any(Function),
    });
    const writePageSearch = routerMocks.navigate.mock.calls.at(-1)?.[0]
      .search as (current: Record<string, unknown>) => Record<string, unknown>;
    expect(writePageSearch({ query: "mizani" })).toEqual({
      page: 2,
      query: "mizani",
    });
  });

  it("repairs an unbackfilled catalog summary instead of leaving metrics permanently pending", async () => {
    mockedProducts.catalogSummary = {
      categoryCount: 0,
      missingInfoProductCount: 0,
      outOfStockProductCount: 0,
      productCount: 0,
      updatedAt: 0,
    };

    render(<Products />);

    expect(
      screen.getByRole("heading", { level: 1, name: "Products" }),
    ).toBeInTheDocument();
    expect(screen.getAllByText("...")).toHaveLength(4);
    await waitFor(() =>
      expect(repairCatalogSummaryMock).toHaveBeenCalledWith({
        storeId: "store-1",
      }),
    );
  });

  it("searches draft products from the products workspace", async () => {
    const user = userEvent.setup();
    mockedProducts.categories = [
      { _id: "category-legacy", name: "Legacy import", slug: "legacy-import" },
      { _id: "category-books", name: "Books", slug: "books" },
    ];
    const importedBonnet = makeProduct({
      availability: "draft",
      categoryId: "category-legacy",
      categoryName: "Legacy import",
      categorySlug: "legacy-import",
      id: "product-legacy",
      inventoryCount: 3,
      isVisible: false,
      name: "Imported Bonnet",
      sku: "OLD-BONNET",
    });
    const draftBook = makeProduct({
      availability: "draft",
      categoryId: "category-books",
      categoryName: "Books",
      categorySlug: "books",
      id: "product-draft-book",
      inventoryCount: 2,
      name: "Draft Book",
      sku: "BOOK-DRAFT",
    });
    mockedProducts.skuSearchResults = [
      makeSkuSearchResult(importedBonnet, {
        match: { kind: "text", matchedValue: "bonnet", rank: 1 },
      }),
    ];

    render(<Products />);

    await user.type(
      screen.getByRole("textbox", {
        name: /search products, skus, or barcodes/i,
      }),
      "bonnet",
    );

    expect(screen.getByText("Imported Bonnet")).toBeInTheDocument();
    expect(screen.getByText("Search results")).toBeInTheDocument();

    await user.clear(
      screen.getByRole("textbox", {
        name: /search products, skus, or barcodes/i,
      }),
    );
    mockedProducts.skuSearchResults = [
      makeSkuSearchResult(draftBook, {
        match: { kind: "text", matchedValue: "draft", rank: 1 },
      }),
    ];
    await user.type(
      screen.getByRole("textbox", {
        name: /search products, skus, or barcodes/i,
      }),
      "draft",
    );

    expect(screen.getByText("Draft Book")).toBeInTheDocument();
  });

  it("searches hidden SKUs for hidden draft products", async () => {
    const user = userEvent.setup();
    mockedProducts.categories = [
      { _id: "category-legacy", name: "Legacy import", slug: "legacy-import" },
    ];
    const hiddenDraftProduct = makeProduct({
      availability: "draft",
      categoryId: "category-legacy",
      categoryName: "Legacy import",
      categorySlug: "legacy-import",
      id: "product-hidden-draft",
      inventoryCount: 4,
      isVisible: false,
      name: "Imported Cubic Wig",
      sku: "CUBIC-LEGACY",
      skuIsVisible: false,
      subcategoryId: "subcategory-legacy",
      subcategoryName: "Imported accessories",
      subcategorySlug: "imported-accessories",
    });
    mockedProducts.skuSearchResults = [
      makeSkuSearchResult(hiddenDraftProduct, {
        match: { kind: "text", matchedValue: "cubic", rank: 1 },
        productIsVisible: false,
        skuIsVisible: false,
      }),
    ];

    render(<Products />);

    await user.type(
      screen.getByRole("textbox", {
        name: /search products, skus, or barcodes/i,
      }),
      "cubic",
    );

    expect(screen.getByText("Imported Cubic Wig")).toBeInTheDocument();
    expect(screen.getByText("Imported accessories")).toBeInTheDocument();
    expect(screen.getByText("Search results")).toBeInTheDocument();
  });
});

function makeProduct({
  availability = "live",
  categoryId = "category-1",
  categoryName = "Hair",
  categorySlug = "hair",
  id,
  inventoryCount,
  isVisible = true,
  name,
  sku,
  skuIsVisible = true,
  skus,
  subcategoryId = "subcategory-1",
  subcategoryName = "Wigs",
  subcategorySlug = "wigs",
}: {
  availability?: Product["availability"];
  categoryId?: string;
  categoryName?: string;
  categorySlug?: string;
  id: string;
  inventoryCount: number;
  isVisible?: boolean;
  name: string;
  sku: string;
  skuIsVisible?: boolean;
  skus?: Product["skus"];
  subcategoryId?: string;
  subcategoryName?: string;
  subcategorySlug?: string;
}): Product {
  return {
    _id: id as Id<"product">,
    _creationTime: 1,
    availability,
    categoryId: categoryId as Id<"category">,
    categoryName,
    categorySlug,
    createdByUserId: "user-1" as Id<"athenaUser">,
    currency: "GHS",
    inventoryCount,
    isVisible,
    name,
    organizationId: "org-1" as Id<"organization">,
    quantityAvailable: inventoryCount,
    slug: name.toLowerCase().replace(/\s+/g, "-"),
    skus: skus ?? [
      {
        _id: `${id}-sku` as Id<"productSku">,
        _creationTime: 1,
        barcode: "",
        colorName: "",
        images: [],
        inventoryCount,
        length: undefined,
        price: 2500,
        productCategory: categoryName,
        productId: id as Id<"product">,
        productName: name,
        quantityAvailable: inventoryCount,
        size: "",
        sku,
        isVisible: skuIsVisible,
        storeId: "store-1" as Id<"store">,
      },
    ],
    storeId: "store-1" as Id<"store">,
    subcategoryId: subcategoryId as Id<"subcategory">,
    subcategoryName,
    subcategorySlug,
  };
}

function makeSkuSearchResult(
  product: Product,
  overrides: Partial<ProductSkuSearchResultLike> = {},
): ProductSkuSearchResultLike {
  const sku = product.skus[0];

  return {
    barcode: sku.barcode ?? null,
    categoryId: product.categoryId,
    categoryName: product.categoryName ?? null,
    categorySlug: product.categorySlug ?? null,
    colorName: sku.colorName ?? null,
    images: sku.images,
    inventoryCount: sku.inventoryCount,
    isVisible: sku.isVisible ?? null,
    length: sku.length ?? null,
    match: { kind: "text", matchedValue: product.name, rank: 1 },
    price: sku.price,
    productAvailability: product.availability,
    productId: product._id,
    productIsVisible: product.isVisible ?? null,
    productName: product.name,
    productSkuId: sku._id,
    productSlug: product.slug ?? null,
    quantityAvailable: sku.quantityAvailable,
    size: sku.size ?? null,
    sku: sku.sku ?? null,
    skuIsVisible: sku.isVisible ?? true,
    storeId: sku.storeId,
    subcategoryId: product.subcategoryId,
    subcategoryName: product.subcategoryName ?? null,
    subcategorySlug: product.subcategorySlug ?? null,
    ...overrides,
  };
}
