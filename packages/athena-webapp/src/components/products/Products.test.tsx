import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Product } from "~/types";
import type { Id } from "~/convex/_generated/dataModel";

import Products from "./Products";

const quickAddProductSkuMock = vi.fn();
const mockedProducts = vi.hoisted(() => ({
  allProducts: [] as Product[],
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
  useGetCategories: () => [],
}));

vi.mock("~/src/hooks/useGetProducts", () => ({
  useGetProducts: () => mockedProducts.allProducts,
  useGetUnresolvedProducts: () => [],
}));

vi.mock("convex/react", () => ({
  useQuery: () => ({ name: "Home Care" }),
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
    await user.type(screen.getByLabelText(/product name/i), "Restock item");
    await user.type(screen.getByLabelText(/barcode/i), "123456789");
    await user.type(screen.getByLabelText(/selling price/i), "45");
    await user.click(screen.getByLabelText(/add multiple variants/i));
    await user.click(screen.getByRole("button", { name: /add variant/i }));
    await user.type(screen.getAllByLabelText(/barcode/i)[1], "987654321");
    await user.type(screen.getAllByLabelText(/selling price/i)[1], "50");

    await user.click(
      screen.getByRole("button", { name: /add product variants/i }),
    );

    await waitFor(() => expect(quickAddProductSkuMock).toHaveBeenCalledTimes(2));
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

    expect(screen.getByLabelText(/product name/i)).toHaveValue("");
    expect(screen.getByLabelText(/barcode/i)).toHaveValue("075724640412");
  });

  it("prefills quick add product name from a text product search", async () => {
    const user = userEvent.setup();

    render(<Products />);

    await user.type(
      screen.getByPlaceholderText(/search products/i),
      "Mahogany Teakwood",
    );
    await user.click(screen.getByRole("button", { name: /quick add/i }));

    expect(screen.getByLabelText(/product name/i)).toHaveValue(
      "Mahogany Teakwood",
    );
    expect(screen.getByLabelText(/barcode/i)).toHaveValue("");
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
});
