import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ProductsListView from "./ProductsListView";
import type { Product } from "~/types";

const mockedProducts = vi.hoisted(() => ({
  categories: [] as Array<{
    _id: string;
    name: string;
    showOnStorefront?: boolean;
    slug: string;
  }>,
  products: undefined as Product[] | undefined,
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: React.ReactNode }) => (
    <a href="#products">{children}</a>
  ),
  useNavigate: () => vi.fn(),
  useSearch: () => ({
    categorySlug: "beverages",
    o: "/wigclub/store/wigclub/products",
  }),
}));

vi.mock("~/src/hooks/useGetProducts", () => ({
  useGetProducts: () => mockedProducts.products,
}));

vi.mock("~/src/hooks/useGetCategories", () => ({
  useGetCategories: () => mockedProducts.categories,
}));

vi.mock("~/src/hooks/usePermissions", () => ({
  usePermissions: () => ({
    hasFullAdminAccess: true,
  }),
}));

vi.mock("~/src/hooks/useGetActiveStore", () => ({
  default: () => ({
    activeStore: {
      slug: "wigclub",
    },
  }),
}));

vi.mock("~/src/hooks/useGetOrganizations", () => ({
  useGetActiveOrganization: () => ({
    activeOrganization: {
      slug: "wigclub",
    },
  }),
}));

vi.mock("convex/react", () => ({
  useAction: () => vi.fn(),
  useMutation: () => vi.fn(),
  useQuery: () => undefined,
}));

describe("ProductsListView", () => {
  beforeEach(() => {
    mockedProducts.categories = [];
    mockedProducts.products = undefined;
    window.scrollTo = vi.fn();
  });

  it("keeps the category page header visible while products load", () => {
    render(<ProductsListView />);

    expect(screen.getByText("Catalog Ops")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Beverages" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: "Category controls" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("No beverages")).not.toBeInTheDocument();
  });
});
