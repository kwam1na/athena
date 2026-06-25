import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Product } from "~/types";
import type { Id } from "~/convex/_generated/dataModel";

import Products from "./Products";

const quickAddProductSkuMock = vi.fn();
const mockedProducts = vi.hoisted(() => ({
  allProducts: [] as Product[],
  categories: [] as Array<{ _id: string; name: string; slug: string }>,
  draftProducts: [] as Product[],
  hiddenDraftProducts: [] as Product[],
  hiddenLiveProducts: [] as Product[],
  skuSearchResults: [] as Array<Record<string, unknown>>,
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
  useSearch: () => ({}),
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
  useGetUnresolvedProducts: () => [],
}));

vi.mock("convex/react", () => ({
  useQuery: (_query: unknown, args: unknown) => {
    if (
      args &&
      typeof args === "object" &&
      "query" in args &&
      "limit" in args
    ) {
      return {
        candidateOverflow: false,
        results: mockedProducts.skuSearchResults,
        truncated: false,
      };
    }

    if (
      args &&
      typeof args === "object" &&
      "storeId" in args &&
      !("id" in args)
    ) {
      return productsToInventoryItems([
        ...mockedProducts.allProducts,
        ...mockedProducts.draftProducts,
        ...mockedProducts.hiddenLiveProducts,
        ...mockedProducts.hiddenDraftProducts,
      ]);
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

describe("Products", () => {
  beforeEach(() => {
    quickAddProductSkuMock.mockReset();
    mockedProducts.allProducts = [];
    mockedProducts.categories = [];
    mockedProducts.draftProducts = [];
    mockedProducts.hiddenDraftProducts = [];
    mockedProducts.hiddenLiveProducts = [];
    mockedProducts.skuSearchResults = [];
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

  it("fuzzy matches product search across product and SKU fields", async () => {
    const user = userEvent.setup();
    mockedProducts.allProducts = [
      {
        _id: "product-1" as Id<"product">,
        _creationTime: 1,
        availability: "live",
        categoryId: "category-1" as Id<"category">,
        categoryName: "Home Care",
        createdByUserId: "user-1" as Id<"athenaUser">,
        currency: "GHS",
        inventoryCount: 12,
        isVisible: true,
        name: "Mahogany Teakwood",
        organizationId: "org-1" as Id<"organization">,
        slug: "mahogany-teakwood",
        skus: [
          {
            _id: "sku-1" as Id<"productSku">,
            _creationTime: 1,
            barcode: "839293889923",
            colorName: "Amber",
            images: [],
            inventoryCount: 12,
            length: undefined,
            price: 2500,
            productCategory: "Home Care",
            productId: "product-1" as Id<"product">,
            productName: "Mahogany Teakwood",
            quantityAvailable: 12,
            size: "Large",
            sku: "6N2Y-9W1-PNN",
            storeId: "store-1" as Id<"store">,
          },
        ],
        storeId: "store-1" as Id<"store">,
        subcategoryId: "subcategory-1" as Id<"subcategory">,
      },
      {
        _id: "product-2" as Id<"product">,
        _creationTime: 1,
        availability: "live",
        categoryId: "category-1" as Id<"category">,
        categoryName: "Hair",
        createdByUserId: "user-1" as Id<"athenaUser">,
        currency: "GHS",
        inventoryCount: 8,
        isVisible: true,
        name: "Closure Wig",
        organizationId: "org-1" as Id<"organization">,
        slug: "closure-wig",
        skus: [
          {
            _id: "sku-2" as Id<"productSku">,
            _creationTime: 1,
            barcode: "1234567890123",
            colorName: "Natural black",
            images: [],
            inventoryCount: 8,
            length: 18,
            price: 4500,
            productCategory: "Hair",
            productId: "product-2" as Id<"product">,
            productName: "Closure Wig",
            quantityAvailable: 8,
            size: "Large",
            sku: "CW-18",
            storeId: "store-1" as Id<"store">,
          },
        ],
        storeId: "store-1" as Id<"store">,
        subcategoryId: "subcategory-1" as Id<"subcategory">,
      },
    ];

    render(<Products />);

    await user.type(screen.getByPlaceholderText(/search products/i), "mahogny");

    expect(screen.getByText("Mahogany Teakwood")).toBeInTheDocument();
    expect(screen.queryByText("Closure Wig")).not.toBeInTheDocument();

    await user.clear(screen.getByPlaceholderText(/search products/i));
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

    await user.type(screen.getByPlaceholderText(/search products/i), "GLOBAL-18");

    expect(screen.getByText("Global Search Wig")).toBeInTheDocument();
    expect(screen.queryByText("Loaded Product")).not.toBeInTheDocument();
    expect(screen.getByText("Showing 1 of 1 product.")).toBeInTheDocument();
  });

  it("keeps local availability when a generic SKU search result overlaps a loaded product", async () => {
    const user = userEvent.setup();
    mockedProducts.allProducts = [
      makeProduct({
        id: "product-local",
        inventoryCount: 0,
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
        match: { kind: "sku", matchedValue: "LOCAL-1", rank: 1 },
        price: 5500,
        productAvailability: "live",
        productId: "product-local",
        productIsVisible: true,
        productName: "Loaded Product",
        productSkuId: "product-local-sku",
        productSlug: "loaded-product",
        quantityAvailable: 6,
        size: "M",
        sku: "LOCAL-1",
        skuIsVisible: true,
        storeId: "store-1",
        subcategoryId: "subcategory-1",
        subcategoryName: "Bundles",
        subcategorySlug: "bundles",
      },
    ];

    render(<Products />);

    await user.type(screen.getByPlaceholderText(/search products/i), "LOCAL-1");
    await user.click(
      screen.getByRole("combobox", { name: /filter by availability/i }),
    );
    await user.click(await screen.findByRole("option", { name: "Available" }));

    expect(screen.queryByText("Loaded Product")).not.toBeInTheDocument();
  });

  it("uses the shared SKU filter bar for product search filters", async () => {
    const user = userEvent.setup();
    mockedProducts.categories = [
      { _id: "category-1", name: "Hair", slug: "hair" },
      { _id: "category-2", name: "Home Care", slug: "home-care" },
    ];
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
      screen.getByRole("combobox", { name: /filter by availability/i }),
    ).toBeInTheDocument();
    expect(screen.getByText("Showing 2 of 2 products.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /hair, 1 product/i }));

    expect(screen.getByText("Closure Wig")).toBeInTheDocument();
    expect(screen.queryByText("Mahogany Teakwood")).not.toBeInTheDocument();
    expect(screen.getByText("Showing 1 of 2 products.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^clear$/i }));

    expect(screen.queryByText("Search results")).not.toBeInTheDocument();
    expect(screen.getAllByText("Categories").length).toBeGreaterThan(1);
  });

  it("filters product search by availability", async () => {
    const user = userEvent.setup();
    mockedProducts.allProducts = [
      makeProduct({
        id: "product-1",
        inventoryCount: 8,
        name: "Closure Wig",
        sku: "CW-18",
      }),
      makeProduct({
        id: "product-2",
        inventoryCount: 0,
        name: "Mahogany Teakwood",
        sku: "CANDLE-1",
      }),
    ];

    render(<Products />);

    await user.click(
      screen.getByRole("combobox", { name: /filter by availability/i }),
    );
    await user.click(
      await screen.findByRole("option", { name: "Out of stock" }),
    );

    expect(screen.getByText("Mahogany Teakwood")).toBeInTheDocument();
    expect(screen.queryByText("Closure Wig")).not.toBeInTheDocument();
    expect(screen.getByText("Showing 1 of 2 products.")).toBeInTheDocument();
  });

  it("searches draft products from the products workspace", async () => {
    const user = userEvent.setup();
    mockedProducts.categories = [
      { _id: "category-legacy", name: "Legacy import", slug: "legacy-import" },
      { _id: "category-books", name: "Books", slug: "books" },
    ];
    mockedProducts.draftProducts = [
      makeProduct({
        availability: "draft",
        categoryId: "category-legacy",
        categoryName: "Legacy import",
        categorySlug: "legacy-import",
        id: "product-legacy",
        inventoryCount: 3,
        isVisible: false,
        name: "Imported Bonnet",
        sku: "OLD-BONNET",
      }),
      makeProduct({
        availability: "draft",
        categoryId: "category-books",
        categoryName: "Books",
        categorySlug: "books",
        id: "product-draft-book",
        inventoryCount: 2,
        name: "Draft Book",
        sku: "BOOK-DRAFT",
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
    expect(screen.getByText("Showing 1 of 2 products.")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /legacy import, 1 product/i }),
    ).toBeInTheDocument();

    await user.clear(
      screen.getByRole("textbox", {
        name: /search products, skus, or barcodes/i,
      }),
    );
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
    mockedProducts.draftProducts = [
      makeProduct({
        availability: "draft",
        categoryId: "category-legacy",
        categoryName: "Legacy import",
        categorySlug: "legacy-import",
        id: "product-hidden-draft",
        inventoryCount: 0,
        isVisible: false,
        name: "Imported Cubic Wig",
        sku: "",
        skus: [],
        subcategoryId: "subcategory-legacy",
        subcategoryName: "Imported accessories",
        subcategorySlug: "imported-accessories",
      }),
    ];
    mockedProducts.hiddenDraftProducts = [
      makeProduct({
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
    expect(screen.getByText("Showing 1 of 1 product.")).toBeInTheDocument();
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

function productsToInventoryItems(products: Product[]) {
  return products.flatMap((product) =>
    product.skus.map((sku) => ({
      _id: sku._id,
      barcode: sku.barcode ?? null,
      colorName: sku.colorName ?? null,
      durableQuantityAvailable: sku.quantityAvailable,
      imageUrl: sku.images[0] ?? null,
      inventoryCount: sku.inventoryCount,
      length: sku.length ?? null,
      netPrice: sku.netPrice,
      price: sku.price,
      productCategory: product.categoryName ?? sku.productCategory ?? null,
      productCategoryId: product.categoryId,
      productCategorySlug: product.categorySlug ?? null,
      productId: product._id,
      productName: product.name,
      productSubcategory: product.subcategoryName ?? null,
      productSubcategoryId: product.subcategoryId,
      productSubcategorySlug: product.subcategorySlug ?? null,
      checkoutReservedQuantity: 0,
      posReservedQuantity: 0,
      quantityAvailable: sku.quantityAvailable,
      reservedQuantity: 0,
      size: sku.size ?? null,
      sku: sku.sku ?? null,
    })),
  );
}
