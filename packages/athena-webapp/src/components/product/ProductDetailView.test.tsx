import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ProductDetailViewHeader } from "./ProductDetailView";
import type { Product, Store } from "~/types";

const mockedProductDetail = vi.hoisted(() => ({
  activeProduct: {
    _id: "product-1",
    name: "Amla Gold Oil",
    availability: "archived",
    inventoryCount: 0,
    quantityAvailable: 0,
  } as unknown as Product,
  activeStore: {
    _id: "store-1",
  } as unknown as Store,
  hasFullAdminAccess: true,
}));

vi.mock("@tanstack/react-router", () => ({
  useSearch: () => ({
    o: "/wigclub/store/wigclub/products/archived",
  }),
}));

vi.mock("convex/react", () => ({
  useMutation: () => vi.fn(),
}));

vi.mock("~/src/hooks/useGetActiveProduct", () => ({
  default: () => ({
    activeProduct: mockedProductDetail.activeProduct,
  }),
}));

vi.mock("~/src/hooks/useGetActiveStore", () => ({
  default: () => ({
    activeStore: mockedProductDetail.activeStore,
  }),
}));

vi.mock("~/src/hooks/use-navigate-back", () => ({
  useNavigateBack: () => vi.fn(),
}));

vi.mock("~/src/hooks/usePermissions", () => ({
  usePermissions: () => ({
    hasFullAdminAccess: mockedProductDetail.hasFullAdminAccess,
  }),
}));

describe("ProductDetailViewHeader", () => {
  beforeEach(() => {
    mockedProductDetail.hasFullAdminAccess = true;
  });

  it("shows the unarchive action to full admins", () => {
    render(<ProductDetailViewHeader />);

    expect(
      screen.getByRole("button", { name: "Unarchive" }),
    ).toBeInTheDocument();
  });

  it("hides the unarchive action from non-admin users", () => {
    mockedProductDetail.hasFullAdminAccess = false;

    render(<ProductDetailViewHeader />);

    expect(
      screen.queryByRole("button", { name: "Unarchive" }),
    ).not.toBeInTheDocument();
  });
});
