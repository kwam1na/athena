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
    expect(addVariantButton).toHaveClass("bg-primary");
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
    expect(quickAddButton).toHaveClass("bg-primary");
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

  it("keeps a missing-availability result disabled without availability copy", () => {
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
      screen.queryByText(
        "Availability not ready. Reconnect or refresh this terminal before selling this item.",
      ),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Club").closest("[aria-disabled]")).toHaveAttribute(
      "aria-disabled",
      "true",
    );

    fireEvent.click(screen.getByText("Club"));

    expect(onAddProduct).not.toHaveBeenCalled();
  });

  it("replaces a failed product image with the no-image placeholder", () => {
    renderSearchResults({
      products: [
        buildProduct({
          image: "https://example.com/offline-product.jpg",
          name: "Eyeliner Pencil",
        }),
      ],
    });

    fireEvent.error(screen.getByRole("img", { name: "Eyeliner Pencil" }));

    expect(
      screen.getByRole("img", { name: "Eyeliner Pencil" }),
    ).toHaveAttribute("data-image-fallback", "true");
    expect(screen.queryByAltText("Eyeliner Pencil")).not.toBeInTheDocument();
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

  it("does not render availability count labels for trusted product results", () => {
    renderSearchResults({
      products: [
        buildProduct({
          id: "sku-trusted",
          name: "Eco Gel",
          quantityAvailable: 12,
        }),
      ],
    });

    expect(screen.queryByText("12 available")).not.toBeInTheDocument();
  });

  it("emphasizes the product price without using action styling", () => {
    renderSearchResults({
      products: [
        buildProduct({
          id: "sku-priced",
          name: "Eco Gel",
          price: 9500,
        }),
      ],
    });

    const price = screen.getByText(/95\.00/);
    expect(price).toHaveClass("text-xl", "font-semibold", "bg-muted/70");
    expect(price).not.toHaveClass("bg-primary");
  });

  it("uses the soft commit treatment for product add actions", () => {
    renderSearchResults({
      products: [
        buildProduct({
          id: "sku-add-style",
          name: "Eco Gel",
        }),
      ],
    });

    expect(screen.getByRole("button", { name: /^add$/i })).toHaveClass(
      "bg-primary-soft",
      "text-primary",
    );
  });

  it("renders the SKU as plain metadata on the card surface", () => {
    renderSearchResults({
      products: [
        buildProduct({
          id: "sku-plain",
          name: "Eco Gel",
          sku: "6N2Y-G4V-WDG",
        }),
      ],
    });

    const sku = screen.getByText("6N2Y-G4V-WDG");
    expect(sku).toHaveClass("font-mono", "text-xs", "text-muted-foreground");
    expect(sku).not.toHaveClass("bg-muted", "rounded", "px-2", "py-1");
  });

  it("allows provisional import results to be added without count labels", async () => {
    const user = userEvent.setup();
    const product = buildProduct({
      availabilityMessage: "Count pending",
      availabilityPolicy: "active_provisional_import",
      id: "sku-provisional",
      inventoryImportProvisionalSkuId:
        "provisional-1" as Product["inventoryImportProvisionalSkuId"],
      name: "Imported wig",
      quantityAvailable: 0,
    });
    const onAddProduct = vi.fn(async () => true);

    renderSearchResults({
      products: [product],
      onAddProduct,
    });

    expect(screen.queryByText("Count pending")).not.toBeInTheDocument();
    const quantityInput = screen.getByRole("spinbutton", {
      name: /quantity for imported wig/i,
    });
    await user.clear(quantityInput);
    await user.type(quantityInput, "3");
    await user.click(screen.getByRole("button", { name: /add 3/i }));

    expect(onAddProduct).toHaveBeenCalledWith(product, 3);
  });

  it("does not render legacy NULL metadata on provisional import results", () => {
    renderSearchResults({
      products: [
        buildProduct({
          availabilityMessage: "Count pending",
          availabilityPolicy: "active_provisional_import",
          category: "Legacy import",
          color: "NULL",
          id: "sku-provisional",
          inventoryImportProvisionalSkuId:
            "provisional-1" as Product["inventoryImportProvisionalSkuId"],
          name: "Imported wig",
          quantityAvailable: 0,
          size: "NULL",
        }),
      ],
    });

    expect(screen.getByText("Legacy import")).toBeInTheDocument();
    expect(screen.queryByText("NULL")).not.toBeInTheDocument();
  });

  it("allows pending checkout results to be added without count labels", async () => {
    const user = userEvent.setup();
    const product = buildProduct({
      id: "pending-checkout-1",
      name: "Ligali",
      pendingCheckoutItemId:
        "pending-checkout-1" as Product["pendingCheckoutItemId"],
      quantityAvailable: 0,
    });
    const onAddProduct = vi.fn(async () => true);

    renderSearchResults({
      products: [product],
      onAddProduct,
    });

    expect(screen.queryByText("Count pending")).not.toBeInTheDocument();
    expect(screen.queryByText("0 available")).not.toBeInTheDocument();

    const quantityInput = screen.getByRole("spinbutton", {
      name: /quantity for ligali/i,
    });
    await user.clear(quantityInput);
    await user.type(quantityInput, "3");
    await user.click(screen.getByRole("button", { name: /add 3/i }));

    expect(onAddProduct).toHaveBeenCalledWith(product, 3);
  });

  it("allows result quantity entry beyond trusted stock", async () => {
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
    await user.click(screen.getByRole("button", { name: /add 99/i }));

    expect(onAddProduct).toHaveBeenCalledWith(product, 99);
  });

  it("allows known zero-count results to be added for review", async () => {
    const user = userEvent.setup();
    const product = buildProduct({
      availabilityStatus: "out_of_stock",
      id: "sku-zero",
      inStock: false,
      name: "Count mismatch wig",
      quantityAvailable: 0,
    });
    const onAddProduct = vi.fn(async () => true);

    renderSearchResults({
      products: [product],
      onAddProduct,
    });

    expect(screen.queryByText("0 available")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^add$/i }));

    expect(onAddProduct).toHaveBeenCalledWith(product, 1);
  });
});
