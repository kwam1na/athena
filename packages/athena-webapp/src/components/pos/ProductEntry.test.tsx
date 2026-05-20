import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { ProductEntry } from "./ProductEntry";
import type { Product } from "./types";

const quickAddProductSkuMock = vi.fn();

vi.mock("@/hooks/usePOSProducts", () => ({
  usePOSQuickAddProductSku: () => quickAddProductSkuMock,
}));

vi.mock("@/hooks/useGetActiveStore", () => ({
  default: () => ({
    activeStore: {
      _id: "store-1",
      currency: "GHS",
    },
  }),
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: {
      _id: "user-1",
    },
  }),
}));

function buildQuickAddedProduct(): Product {
  return {
    id: "sku-1",
    barcode: "999999999999",
    category: "POS quick add",
    description: "",
    inStock: true,
    name: "Quick item",
    price: 2500,
    productId: "product-1" as Product["productId"],
    quantityAvailable: 1,
    sku: "TEMP-1",
    skuId: "sku-1" as Product["skuId"],
  };
}

function renderProductEntry(input: {
  onAddProduct: (product: Product) => boolean | Promise<boolean>;
  setProductSearchQuery: (query: string) => void;
}) {
  function Harness() {
    const [productSearchQuery, setProductSearchQuery] =
      useState("999999999999");

    return (
      <ProductEntry
        canQuickAddProduct
        isSearchLoading={false}
        isSearchReady
        onAddProduct={input.onAddProduct}
        onBarcodeSubmit={vi.fn()}
        productSearchQuery={productSearchQuery}
        searchResults={[]}
        setProductSearchQuery={(query) => {
          input.setProductSearchQuery(query);
          setProductSearchQuery(query);
        }}
        setShowProductLookup={vi.fn()}
        showProductLookup
      />
    );
  }

  render(<Harness />);
}

describe("ProductEntry", () => {
  it("clears the active search before adding a newly quick-added product to the cart", async () => {
    const user = userEvent.setup();
    const quickAddedProduct = buildQuickAddedProduct();
    const onAddProduct = vi.fn(async () => true);
    const setProductSearchQuery = vi.fn();
    quickAddProductSkuMock.mockResolvedValueOnce(quickAddedProduct);

    renderProductEntry({ onAddProduct, setProductSearchQuery });

    await user.click(
      screen.getByRole("button", { name: /quick add product/i }),
    );
    await user.type(screen.getByLabelText(/product name/i), "Quick item");
    await user.type(screen.getByLabelText(/selling price/i), "25");
    await user.click(screen.getByRole("button", { name: /add product/i }));

    await waitFor(() =>
      expect(onAddProduct).toHaveBeenCalledWith(quickAddedProduct),
    );
    expect(setProductSearchQuery).toHaveBeenCalledWith("");
    expect(
      setProductSearchQuery.mock.invocationCallOrder.at(-1),
    ).toBeLessThan(onAddProduct.mock.invocationCallOrder[0]);
  });
});
