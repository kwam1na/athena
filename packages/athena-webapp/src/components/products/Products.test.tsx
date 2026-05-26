import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import Products from "./Products";

const quickAddProductSkuMock = vi.fn();

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
  useGetProducts: () => [],
  useGetUnresolvedProducts: () => [],
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
});
