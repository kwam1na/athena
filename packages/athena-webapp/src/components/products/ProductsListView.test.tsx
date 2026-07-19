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
  sharedDemoContext: null as null | { kind: "shared_demo" },
  routeSearch: {
    categorySlug: "beverages",
    o: "/wigclub/store/wigclub/products",
  },
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: React.ReactNode }) => (
    <a href="#products">{children}</a>
  ),
  useNavigate: () => vi.fn(),
  useSearch: () => mockedProducts.routeSearch,
}));

vi.mock("~/src/hooks/useGetProducts", () => ({
  useGetProducts: () => mockedProducts.products,
}));

vi.mock("~/src/hooks/useGetCategories", () => ({
  useGetCategories: () => mockedProducts.categories,
}));

vi.mock("~/src/hooks/useSharedDemoContext", () => ({
  useSharedDemoContext: () => mockedProducts.sharedDemoContext,
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
    mockedProducts.sharedDemoContext = null;
    mockedProducts.routeSearch = {
      categorySlug: "beverages",
      o: "/wigclub/store/wigclub/products",
    };
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

  it("renders POS pending checkout as a standard product category page", () => {
    mockedProducts.routeSearch = {
      categorySlug: "pos-pending-checkout",
      o: "/wigclub/store/wigclub/products",
    };
    mockedProducts.products = [];

    render(<ProductsListView />);

    expect(
      screen.getByRole("heading", { name: "Pos Pending Checkout" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: "Pending checkout review" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Choose SKU")).not.toBeInTheDocument();
    expect(screen.getByText("No pos pending checkout")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Add product" }),
    ).toBeInTheDocument();
  });

  it("keeps pending checkout review off other product category pages", () => {
    mockedProducts.products = [];

    render(<ProductsListView />);

    expect(
      screen.queryByRole("region", { name: "Pending checkout review" }),
    ).not.toBeInTheDocument();
  });

  it("restricts category management controls in the shared demo", () => {
    mockedProducts.categories = [
      {
        _id: "category-1",
        name: "Beverages",
        slug: "beverages",
      },
    ];
    mockedProducts.products = [
      {
        _id: "product-1",
        _creationTime: 1,
        availability: "live",
        categoryId: "category-1",
        createdByUserId: "user-1",
        currency: "GHS",
        inventoryCount: 1,
        name: "Batik Tote Bag",
        organizationId: "organization-1",
        quantityAvailable: 1,
        slug: "batik-tote-bag",
        skus: [],
        storeId: "store-1",
        subcategoryId: "subcategory-1",
      } as Product,
    ];
    mockedProducts.sharedDemoContext = { kind: "shared_demo" };

    render(<ProductsListView />);

    expect(
      screen.getByRole("switch", { name: "Show category on storefront" }),
    ).toBeDisabled();
    expect(
      screen.queryByRole("button", { name: "Clear cache" }),
    ).not.toBeInTheDocument();
  });

  it("keeps category management controls available outside the shared demo", () => {
    mockedProducts.categories = [
      {
        _id: "category-1",
        name: "Beverages",
        slug: "beverages",
      },
    ];
    mockedProducts.products = [
      {
        _id: "product-1",
        _creationTime: 1,
        availability: "live",
        categoryId: "category-1",
        createdByUserId: "user-1",
        currency: "GHS",
        inventoryCount: 1,
        name: "Batik Tote Bag",
        organizationId: "organization-1",
        quantityAvailable: 1,
        slug: "batik-tote-bag",
        skus: [],
        storeId: "store-1",
        subcategoryId: "subcategory-1",
      } as Product,
    ];

    render(<ProductsListView />);

    expect(
      screen.getByRole("switch", { name: "Show category on storefront" }),
    ).toBeEnabled();
    expect(
      screen.getByRole("button", { name: "Clear cache" }),
    ).toBeInTheDocument();
  });
});
