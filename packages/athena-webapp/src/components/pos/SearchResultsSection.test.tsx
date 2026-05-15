import { fireEvent, render, screen } from "@testing-library/react";
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

    expect(
      screen.getByRole("button", { name: /add variant for this product/i }),
    ).toHaveAttribute("aria-keyshortcuts", "Meta+Enter Control+Enter");
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

    expect(
      screen.getByRole("button", { name: /quick add product/i }),
    ).toHaveAttribute("aria-keyshortcuts", "Meta+Enter Control+Enter");
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
});
