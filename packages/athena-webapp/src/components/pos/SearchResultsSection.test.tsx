import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { SearchResultsSection } from "./SearchResultsSection";
import type { Product } from "./types";

const formatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "GHS",
});

function buildProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: "sku-1",
    name: "Club",
    barcode: "",
    price: 3000,
    category: "Beverages",
    description: "",
    inStock: true,
    quantityAvailable: 12,
    productId: "product-1" as Product["productId"],
    ...overrides,
  };
}

function renderSearchResults(
  overrides: Partial<React.ComponentProps<typeof SearchResultsSection>> = {},
) {
  const onQuickAddProduct = vi.fn();
  const products = [
    buildProduct({ id: "sku-1" }),
    buildProduct({ id: "sku-2", price: 4500 }),
  ];

  render(
    <SearchResultsSection
      isLoading={false}
      products={products}
      onAddProduct={vi.fn()}
      formatter={formatter}
      onClearSearch={vi.fn()}
      onQuickAddProduct={onQuickAddProduct}
      {...overrides}
    />,
  );

  return { onQuickAddProduct, products };
}

describe("SearchResultsSection", () => {
  it("opens the add-variant action with the keyboard shortcut", () => {
    const { onQuickAddProduct, products } = renderSearchResults();

    fireEvent.keyDown(document, { key: "Enter", metaKey: true });

    expect(onQuickAddProduct).toHaveBeenCalledWith(products[0]);
  });

  it("shows the shortcut hint on the add-variant action", () => {
    renderSearchResults();

    const addVariantButton = screen.getByRole("button", {
      name: /add variant for this product/i,
    });

    expect(addVariantButton).toHaveAttribute(
      "aria-keyshortcuts",
      "Meta+Enter Control+Enter",
    );
    expect(addVariantButton).toHaveClass("bg-action-workflow");
    expect(screen.getByText("⌘+↵")).toBeInTheDocument();
  });

  it("opens the quick-add product action with the keyboard shortcut", () => {
    const { onQuickAddProduct } = renderSearchResults({
      products: [],
    });

    fireEvent.keyDown(document, { key: "Enter", metaKey: true });

    expect(onQuickAddProduct).toHaveBeenCalledWith();
  });

  it("shows the shortcut hint on the quick-add product action", () => {
    renderSearchResults({
      products: [],
    });

    const quickAddButton = screen.getByRole("button", {
      name: /quick add product/i,
    });

    expect(quickAddButton).toHaveAttribute(
      "aria-keyshortcuts",
      "Meta+Enter Control+Enter",
    );
    expect(quickAddButton).toHaveClass("bg-action-workflow");
    expect(screen.getByText("⌘+↵")).toBeInTheDocument();
  });

  it("ignores the shortcut when the results are not variants of the same product", () => {
    const { onQuickAddProduct } = renderSearchResults({
      products: [
        buildProduct({ id: "sku-1", productId: "product-1" as Product["productId"] }),
        buildProduct({ id: "sku-2", productId: "product-2" as Product["productId"] }),
      ],
    });

    fireEvent.keyDown(document, { key: "Enter", metaKey: true });

    expect(onQuickAddProduct).not.toHaveBeenCalled();
  });

  it("ignores the shortcut while quick add is already open", () => {
    const { onQuickAddProduct } = renderSearchResults({
      quickAddShortcutDisabled: true,
    });

    fireEvent.keyDown(document, { key: "Enter", ctrlKey: true });

    expect(onQuickAddProduct).not.toHaveBeenCalled();
  });

  it("ignores the quick-add product shortcut while quick add is already open", () => {
    const { onQuickAddProduct } = renderSearchResults({
      products: [],
      quickAddShortcutDisabled: true,
    });

    fireEvent.keyDown(document, { key: "Enter", ctrlKey: true });

    expect(onQuickAddProduct).not.toHaveBeenCalled();
  });

  it("ignores the shortcut while results are loading", () => {
    const { onQuickAddProduct } = renderSearchResults({
      isLoading: true,
    });

    fireEvent.keyDown(document, { key: "Enter", metaKey: true });

    expect(onQuickAddProduct).not.toHaveBeenCalled();
  });

  it("keeps a missing-availability result visible with readiness copy but does not add it", () => {
    const onAddProduct = vi.fn();
    renderSearchResults({
      onAddProduct,
      products: [
        buildProduct({
          availabilityMessage:
            "Availability not ready. Reconnect or refresh this terminal before selling this item.",
          availabilityStatus: "unknown",
          inStock: false,
          quantityAvailable: undefined,
        }),
      ],
    });

    expect(
      screen.getByText(
        "Availability not ready. Reconnect or refresh this terminal before selling this item.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Club").closest("[aria-disabled]")).toHaveAttribute(
      "aria-disabled",
      "true",
    );

    fireEvent.click(screen.getByText("Club"));

    expect(onAddProduct).not.toHaveBeenCalled();
  });

  it("adds the selected quantity from a product result", async () => {
    const user = userEvent.setup();
    const product = buildProduct({
      id: "sku-quantity",
      name: "Nicca",
      quantityAvailable: 12,
    });
    const onAddProduct = vi.fn(async () => true);
    const onClearSearch = vi.fn();

    renderSearchResults({
      products: [product],
      onAddProduct,
      onClearSearch,
    });

    const quantityInput = screen.getByRole("spinbutton", {
      name: /quantity for nicca/i,
    });
    expect(quantityInput).toHaveClass("h-11", "w-14");
    await user.clear(quantityInput);
    await user.type(quantityInput, "3");
    await user.click(screen.getByRole("button", { name: /add 3/i }));

    expect(onAddProduct).toHaveBeenCalledWith(product, 3);
    expect(onClearSearch).toHaveBeenCalled();
  });

  it("clamps result quantity entry to available stock", async () => {
    const user = userEvent.setup();
    const product = buildProduct({
      id: "sku-limited",
      name: "Limited wig",
      quantityAvailable: 4,
    });
    const onAddProduct = vi.fn(async () => true);

    renderSearchResults({
      products: [product],
      onAddProduct,
    });

    const quantityInput = screen.getByRole("spinbutton", {
      name: /quantity for limited wig/i,
    });
    await user.clear(quantityInput);
    await user.type(quantityInput, "99");
    await user.click(screen.getByRole("button", { name: /add 4/i }));

    expect(onAddProduct).toHaveBeenCalledWith(product, 4);
  });
});
