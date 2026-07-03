import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ArchivedProducts } from "./ArchivedProducts";
import type { Product } from "~/types";

const mockedArchivedProducts = vi.hoisted(() => ({
  products: undefined as Product[] | undefined,
  routeSearch: {
    o: "/wigclub/store/wigclub/products",
  },
}));

vi.mock("@tanstack/react-router", () => ({
  useSearch: () => mockedArchivedProducts.routeSearch,
}));

vi.mock("~/src/hooks/useGetProducts", () => ({
  useGetArchivedProducts: () => mockedArchivedProducts.products,
}));

vi.mock("~/src/hooks/use-navigate-back", () => ({
  useNavigateBack: () => vi.fn(),
}));

vi.mock("../base/table/data-table", () => ({
  GenericDataTable: ({ data }: { data: Product[] }) => (
    <div data-testid="archived-products-table">{data.length} archived</div>
  ),
}));

const archivedProduct = {
  _id: "product-1",
  name: "Amla Gold Oil",
  skus: [
    {
      sku: "AMLA-001",
      images: [],
      price: 1200,
    },
  ],
} as unknown as Product;

describe("ArchivedProducts", () => {
  beforeEach(() => {
    mockedArchivedProducts.products = [archivedProduct];
    mockedArchivedProducts.routeSearch = {
      o: "/wigclub/store/wigclub/products",
    };
    window.scrollTo = vi.fn();
  });

  it("uses the category page layout landmarks without active-products navigation", () => {
    render(<ArchivedProducts />);

    expect(screen.getByText("Catalog Ops")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Archived Products" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "Archived product controls" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("textbox", { name: "Filter archived products" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("archived-products-table")).toHaveTextContent(
      "1 archived",
    );
    expect(
      screen.queryByRole("button", { name: "Active products" }),
    ).not.toBeInTheDocument();
  });
});
