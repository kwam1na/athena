import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Product } from "~/types";
import { ProductVariant } from "../add-product/ProductStock";
import { ProductStatus } from "./ProductStatus";

const makeProduct = (overrides: Partial<Product> = {}) =>
  ({
    _id: "product-id",
    name: "Product",
    sku: "PROD-1",
    isVisible: true,
    inventoryCount: 12,
    ...overrides,
  }) as unknown as Product;

const makeVariant = (overrides: Partial<ProductVariant> = {}) =>
  ({
    id: "variant-id",
    images: [],
    isVisible: true,
    stock: 12,
    quantityAvailable: 12,
    ...overrides,
  }) as unknown as ProductVariant;

describe("ProductStatus", () => {
  it("shows product as hidden when product is hidden regardless of variant visibility", () => {
    render(
      <ProductStatus
        product={makeProduct({ isVisible: false })}
        productVariant={makeVariant({ isVisible: true })}
      />,
    );

    expect(screen.getByText("Hidden")).toBeInTheDocument();
  });

  it("shows variant visibility when product is visible", () => {
    render(
      <ProductStatus
        product={makeProduct({ isVisible: true })}
        productVariant={makeVariant({ isVisible: false })}
      />,
    );

    expect(screen.getByText("Hidden")).toBeInTheDocument();
  });

  it("shows live status when product and variant are visible", () => {
    render(
      <ProductStatus
        product={makeProduct({ isVisible: true })}
        productVariant={makeVariant({ isVisible: true, stock: 10, quantityAvailable: 10 })}
      />,
    );

    expect(screen.getByText("Live")).toBeInTheDocument();
  });

  it("shows archived status before stock or visibility status", () => {
    render(
      <ProductStatus
        product={makeProduct({
          availability: "archived",
          inventoryCount: 0,
          isVisible: false,
        })}
        productVariant={makeVariant({ isVisible: false, stock: 0 })}
      />,
    );

    expect(screen.getByText("Archived")).toBeInTheDocument();
  });
});
