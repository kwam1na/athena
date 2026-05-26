import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ProductEntry } from "./ProductEntry";
import type { Product } from "./types";

const quickAddProductSkuMock = vi.fn();
const registerCatalogMock = vi.fn();

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

globalThis.ResizeObserver = ResizeObserverStub;

vi.mock("@/hooks/usePOSProducts", () => ({
  usePOSQuickAddProductSku: () => quickAddProductSkuMock,
  usePOSRegisterCatalog: () => registerCatalogMock(),
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
  beforeEach(() => {
    quickAddProductSkuMock.mockReset();
    registerCatalogMock.mockReset();
    registerCatalogMock.mockReturnValue([]);
  });

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

  it("creates additional SKU variants before adding the primary quick-add product to the cart", async () => {
    const user = userEvent.setup();
    const quickAddedProduct = buildQuickAddedProduct();
    const extraVariantProduct = {
      ...quickAddedProduct,
      id: "sku-2",
      barcode: "",
      price: 3000,
      skuId: "sku-2" as Product["skuId"],
    };
    const onAddProduct = vi.fn(async () => true);
    const setProductSearchQuery = vi.fn();
    quickAddProductSkuMock
      .mockResolvedValueOnce(quickAddedProduct)
      .mockResolvedValueOnce(extraVariantProduct);

    renderProductEntry({ onAddProduct, setProductSearchQuery });

    await user.click(
      screen.getByRole("button", { name: /quick add product/i }),
    );
    await user.type(screen.getByLabelText(/product name/i), "Quick item");
    await user.type(screen.getByLabelText(/selling price/i), "25");
    await user.click(screen.getByLabelText(/add multiple variants/i));
    await user.click(screen.getByRole("button", { name: /add variant/i }));
    await user.type(screen.getAllByLabelText(/selling price/i)[1], "30");
    await user.click(
      screen.getByRole("button", { name: /add product variants/i }),
    );

    await waitFor(() => expect(quickAddProductSkuMock).toHaveBeenCalledTimes(2));
    expect(quickAddProductSkuMock).toHaveBeenNthCalledWith(1, {
      storeId: "store-1",
      createdByUserId: "user-1",
      name: "Quick item",
      lookupCode: "999999999999",
      price: 2500,
      quantityAvailable: 1,
      productId: undefined,
    });
    expect(quickAddProductSkuMock).toHaveBeenNthCalledWith(2, {
      storeId: "store-1",
      createdByUserId: "user-1",
      name: "Quick item",
      lookupCode: undefined,
      price: 3000,
      quantityAvailable: 1,
      productId: "product-1",
    });
    expect(onAddProduct).toHaveBeenCalledWith(quickAddedProduct);
  });

  it("attaches a scanned barcode to an existing SKU from quick add", async () => {
    const user = userEvent.setup();
    const attachedProduct = {
      ...buildQuickAddedProduct(),
      id: "sku-existing",
      barcode: "999999999999",
      name: "Existing wig",
      sku: "EXISTING-SKU",
      skuId: "sku-existing" as Product["skuId"],
    };
    const onAddProduct = vi.fn(async () => true);
    const setProductSearchQuery = vi.fn();
    quickAddProductSkuMock.mockResolvedValueOnce(attachedProduct);
    registerCatalogMock.mockReturnValue([
      {
        id: "sku-existing",
        productSkuId: "sku-existing",
        skuId: "sku-existing",
        productId: "product-existing",
        name: "Existing wig",
        sku: "EXISTING-SKU",
        barcode: "",
        price: 2500,
        category: "Wigs",
        description: "",
        image: null,
        size: "",
        length: null,
        color: "",
        areProcessingFeesAbsorbed: false,
      },
    ]);

    renderProductEntry({ onAddProduct, setProductSearchQuery });

    await user.click(
      screen.getByRole("button", { name: /quick add product/i }),
    );
    await user.type(screen.getByLabelText(/search existing sku/i), "existing");
    await user.click(screen.getByRole("button", { name: /existing wig/i }));
    await user.click(screen.getByRole("button", { name: /attach barcode/i }));

    await waitFor(() =>
      expect(quickAddProductSkuMock).toHaveBeenCalledWith({
        storeId: "store-1",
        createdByUserId: "user-1",
        name: "",
        lookupCode: "999999999999",
        price: 0,
        quantityAvailable: 0,
        productSkuId: "sku-existing",
      }),
    );
    expect(setProductSearchQuery).toHaveBeenCalledWith("");
    expect(onAddProduct).toHaveBeenCalledWith(
      expect.objectContaining({
        ...attachedProduct,
        availabilityStatus: "available",
        quantityAvailable: 1,
      }),
    );
  });
});
