import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { HomepageProductPickerDialog } from "./HomepageProductPickerDialog";
import type { ProductSkuSearchResultLike } from "~/src/lib/skuSearch/productSkuSearchAdapters";
import type { Category, Product, Subcategory } from "~/types";

const products = [
  {
    _id: "product-1",
    categoryId: "category-hair",
    name: "Lace Front Wig",
    subcategoryId: "subcategory-closures",
    categoryName: "Hair",
    categorySlug: "hair",
    skus: [
      {
        _id: "sku-1",
        productName: "Lace Front Wig",
        sku: "LACE-1",
        images: [],
        price: 12_500,
        quantityAvailable: 5,
      },
    ],
  },
  {
    _id: "product-2",
    categoryId: "category-closures",
    name: "Closure Unit",
    subcategoryId: "subcategory-closures",
    categoryName: "Closures",
    categorySlug: "closures",
    skus: [
      {
        _id: "sku-2",
        productName: "Closure Unit",
        sku: "CLOSURE-1",
        images: [],
        price: 10_000,
        quantityAvailable: 4,
      },
    ],
  },
  {
    _id: "product-3",
    categoryId: "category-hair-care",
    name: "enzo treatment",
    subcategoryId: "subcategory-deep-conditioners",
    categoryName: "Hair Care",
    categorySlug: "hair-care",
    skus: [
      {
        _id: "sku-3",
        productName: "enzo treatment",
        sku: "ENZO-1",
        images: [],
        price: 6_100,
        quantityAvailable: 38,
      },
    ],
  },
] as unknown as Product[];

const categories = [
  {
    _id: "category-hair",
    name: "Hair",
    slug: "hair",
  },
] as unknown as Category[];

const subcategories = [
  {
    _id: "subcategory-closures",
    categoryId: "category-hair",
    name: "Closures",
    slug: "closures",
  },
] as unknown as Subcategory[];

function buildSkuSearchResult(
  overrides: Partial<ProductSkuSearchResultLike> = {},
): ProductSkuSearchResultLike {
  return {
    barcode: "777000111222",
    categoryName: "Hair",
    categoryId: "category-hair" as ProductSkuSearchResultLike["categoryId"],
    categorySlug: "hair",
    colorName: "Natural black",
    images: [],
    inventoryCount: 6,
    isVisible: true,
    length: 22,
    match: {
      kind: "text",
      matchedValue: "deep wave",
      rank: 1,
    },
    price: 19_500,
    productAvailability: "live",
    productId: "product-async" as ProductSkuSearchResultLike["productId"],
    productIsVisible: true,
    productName: "Deep Wave Bundle",
    productSkuId: "sku-async" as ProductSkuSearchResultLike["productSkuId"],
    productSlug: "deep-wave-bundle",
    quantityAvailable: 6,
    size: "Medium",
    sku: "DWB-22",
    skuIsVisible: true,
    storeId: "store-1" as ProductSkuSearchResultLike["storeId"],
    subcategoryName: "Closures",
    subcategoryId: "subcategory-closures" as ProductSkuSearchResultLike["subcategoryId"],
    subcategorySlug: "closures",
    ...overrides,
  };
}

function PickerHarness() {
  const [open, setOpen] = useState(true);

  return (
    <>
      <button onClick={() => setOpen(true)} type="button">
        Open picker
      </button>
      <button onClick={() => setOpen(false)} type="button">
        Close picker
      </button>
      <HomepageProductPickerDialog
        currency="GHS"
        description="Select a product"
        onOpenChange={setOpen}
        onSelectProduct={vi.fn(async () => {
          throw new Error("Nope");
        })}
        open={open}
        products={products}
        searchId="homepage-picker-test"
        selectLabel="Add"
        title="Add product"
      />
    </>
  );
}

describe("HomepageProductPickerDialog", () => {
  it("resets search filters and selection errors after parent-driven close and reopen", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    render(<PickerHarness />);

    const search = screen.getByPlaceholderText("Search product, SKU, or barcode");
    fireEvent.change(search, { target: { value: "lace" } });
    fireEvent.click(screen.getByRole("button", { name: "Hair" }));

    expect(screen.getByText("Lace Front Wig")).toBeInTheDocument();
    expect(screen.queryByText("Closure Unit")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("Lace Front Wig"));
    expect(
      await screen.findByText(
        "Homepage placement was not saved. Check the item and try again.",
      ),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByText("Close picker"));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );

    fireEvent.click(screen.getByText("Open picker"));

    expect(
      screen.queryByText(
        "Homepage placement was not saved. Check the item and try again.",
      ),
    ).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText("Search product, SKU, or barcode")).toHaveValue("");
    expect(screen.getByText("Lace Front Wig")).toBeInTheDocument();
    expect(screen.getByText("Closure Unit")).toBeInTheDocument();

    consoleError.mockRestore();
  });

  it("capitalizes catalog product names in product selection rows", () => {
    render(
      <HomepageProductPickerDialog
        currency="GHS"
        description="Select a product"
        onOpenChange={vi.fn()}
        onSelectProduct={vi.fn()}
        open
        products={products}
        searchId="homepage-picker-product-name-test"
        selectLabel="Add"
        title="Add product"
      />,
    );

    expect(screen.getByText("Enzo Treatment")).toBeInTheDocument();
    expect(screen.queryByText("enzo treatment")).not.toBeInTheDocument();
  });

  it("resolves product taxonomy labels from category and subcategory ids", () => {
    const productsWithoutDenormalizedTaxonomy = [
      {
        _id: "product-raw-taxonomy",
        categoryId: "category-hair",
        name: '8" Closure',
        subcategoryId: "subcategory-closures",
        skus: [
          {
            _id: "sku-raw-taxonomy",
            productId: "product-raw-taxonomy",
            productName: '8" Closure',
            sku: "CLOSURE-8",
            images: [],
            price: 99_900,
            quantityAvailable: 43,
          },
        ],
      },
      {
        _id: "product-other-taxonomy",
        categoryId: "category-books",
        name: "Operating Manual",
        subcategoryId: "subcategory-systems",
        skus: [
          {
            _id: "sku-other-taxonomy",
            productId: "product-other-taxonomy",
            productName: "Operating Manual",
            sku: "BOOK-1",
            images: [],
            price: 90_000,
            quantityAvailable: 4,
          },
        ],
      },
    ] as unknown as Product[];
    const categoriesForDerivedTaxonomy = [
      ...categories,
      {
        _id: "category-books",
        name: "Books",
        slug: "books",
      },
    ] as unknown as Category[];
    const subcategoriesForDerivedTaxonomy = [
      ...subcategories,
      {
        _id: "subcategory-systems",
        categoryId: "category-books",
        name: "Systems",
        slug: "systems",
      },
    ] as unknown as Subcategory[];

    render(
      <HomepageProductPickerDialog
        categories={categoriesForDerivedTaxonomy}
        currency="GHS"
        description="Select a SKU"
        onOpenChange={vi.fn()}
        onSelectSku={vi.fn()}
        open
        products={productsWithoutDenormalizedTaxonomy}
        searchId="homepage-picker-taxonomy-test"
        selectLabel="Add SKU"
        subcategories={subcategoriesForDerivedTaxonomy}
        title="Add best seller"
      />,
    );

    expect(screen.getByText('8" Closure')).toBeInTheDocument();
    expect(screen.getByText("Hair / Closures")).toBeInTheDocument();
    expect(screen.queryByText("Uncategorized")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Hair" }));

    expect(screen.getByText('8" Closure')).toBeInTheDocument();
    expect(screen.queryByText("Operating Manual")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Hair" }));
    fireEvent.change(screen.getByPlaceholderText("Search product, SKU, or barcode"), {
      target: { value: "systems" },
    });

    expect(screen.queryByText('8" Closure')).not.toBeInTheDocument();
    expect(screen.getByText("Operating Manual")).toBeInTheDocument();
  });

  it("renders and selects async generic SKU search results outside the local snapshot", async () => {
    const onSelectSku = vi.fn();

    render(
      <HomepageProductPickerDialog
        categories={categories}
        currency="GHS"
        description="Select a SKU"
        onOpenChange={vi.fn()}
        onSelectSku={onSelectSku}
        open
        products={products.slice(0, 1)}
        searchId="homepage-picker-generic-sku-test"
        selectLabel="Add SKU"
        skuSearchResults={[buildSkuSearchResult()]}
        subcategories={subcategories}
        title="Add best seller"
      />,
    );

    fireEvent.change(screen.getByPlaceholderText("Search product, SKU, or barcode"), {
      target: { value: "deep wave" },
    });

    expect(screen.queryByText("Lace Front Wig")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /deep wave bundle/i }),
    ).toBeInTheDocument();
    expect(screen.getByText("SKU DWB-22")).toBeInTheDocument();
    expect(screen.getByText("Barcode 777000111222")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /deep wave bundle/i }));

    await waitFor(() =>
      expect(onSelectSku).toHaveBeenCalledWith(
        expect.objectContaining({
          _id: "sku-async",
          barcode: "777000111222",
          sku: "DWB-22",
        }),
      ),
    );
  });

  it("does not show hidden or non-live generic SKU search results for homepage placement", () => {
    render(
      <HomepageProductPickerDialog
        categories={categories}
        currency="GHS"
        description="Select a SKU"
        onOpenChange={vi.fn()}
        onSelectSku={vi.fn()}
        open
        products={products.slice(0, 1)}
        searchId="homepage-picker-generic-sku-visibility-test"
        selectLabel="Add SKU"
        skuSearchResults={[
          buildSkuSearchResult({
            productName: "Hidden Search Wig",
            productId: "product-hidden" as ProductSkuSearchResultLike["productId"],
            productIsVisible: false,
            productSkuId: "sku-hidden" as ProductSkuSearchResultLike["productSkuId"],
            sku: "HIDDEN-1",
          }),
          buildSkuSearchResult({
            productAvailability: "draft",
            productName: "Draft Search Wig",
            productId: "product-draft" as ProductSkuSearchResultLike["productId"],
            productSkuId: "sku-draft" as ProductSkuSearchResultLike["productSkuId"],
            sku: "DRAFT-1",
          }),
        ]}
        subcategories={subcategories}
        title="Add best seller"
      />,
    );

    fireEvent.change(screen.getByPlaceholderText("Search product, SKU, or barcode"), {
      target: { value: "search wig" },
    });

    expect(screen.queryByText("Hidden Search Wig")).not.toBeInTheDocument();
    expect(screen.queryByText("Draft Search Wig")).not.toBeInTheDocument();
  });

  it("keeps local availability when generic SKU search overlaps a loaded product", async () => {
    const user = userEvent.setup();
    const localProducts = [
      {
        _id: "product-stale",
        categoryId: "category-hair",
        name: "Stale Search Wig",
        subcategoryId: "subcategory-closures",
        categoryName: "Hair",
        categorySlug: "hair",
        skus: [
          {
            _id: "sku-stale",
            productId: "product-stale",
            productName: "Stale Search Wig",
            sku: "STALE-1",
            images: [],
            price: 12_500,
            quantityAvailable: 0,
          },
        ],
      },
    ] as unknown as Product[];

    render(
      <HomepageProductPickerDialog
        categories={categories}
        currency="GHS"
        description="Select a SKU"
        onOpenChange={vi.fn()}
        onSelectSku={vi.fn()}
        open
        products={localProducts}
        searchId="homepage-picker-generic-sku-stale-availability-test"
        selectLabel="Add SKU"
        skuSearchResults={[
          buildSkuSearchResult({
            productId: "product-stale" as ProductSkuSearchResultLike["productId"],
            productName: "Stale Search Wig",
            productSkuId: "sku-stale" as ProductSkuSearchResultLike["productSkuId"],
            quantityAvailable: 6,
            sku: "STALE-1",
          }),
        ]}
        subcategories={subcategories}
        title="Add best seller"
      />,
    );

    fireEvent.change(screen.getByPlaceholderText("Search product, SKU, or barcode"), {
      target: { value: "STALE-1" },
    });
    await user.click(
      screen.getByRole("combobox", { name: /filter by availability/i }),
    );
    await user.click(await screen.findByRole("option", { name: "Available" }));

    expect(screen.queryByText("Stale Search Wig")).not.toBeInTheDocument();
  });

  it("keeps using local product snapshots when generic SKU search is not provided", () => {
    render(
      <HomepageProductPickerDialog
        currency="GHS"
        description="Select a SKU"
        onOpenChange={vi.fn()}
        onSelectSku={vi.fn()}
        open
        products={products}
        searchId="homepage-picker-local-snapshot-test"
        selectLabel="Add SKU"
        title="Add best seller"
      />,
    );

    fireEvent.change(screen.getByPlaceholderText("Search product, SKU, or barcode"), {
      target: { value: "lace" },
    });

    expect(screen.getByText("Lace Front Wig")).toBeInTheDocument();
    expect(screen.queryByText("Deep Wave Bundle")).not.toBeInTheDocument();
  });
});
