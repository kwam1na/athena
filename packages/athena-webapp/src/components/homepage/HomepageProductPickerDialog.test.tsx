import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { HomepageProductPickerDialog } from "./HomepageProductPickerDialog";
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
});
