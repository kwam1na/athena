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

function getStatusBadge(label: string) {
  return screen.getByText(label).parentElement?.parentElement;
}

describe("ProductStatus", () => {
  it("shows product as hidden when product is hidden regardless of variant visibility", () => {
    render(
      <ProductStatus
        product={makeProduct({ isVisible: false })}
        productVariant={makeVariant({ isVisible: true })}
      />,
    );

    expect(screen.getByText("Hidden online")).toBeInTheDocument();
  });

  it("shows variant visibility when product is visible", () => {
    render(
      <ProductStatus
        product={makeProduct({ isVisible: true })}
        productVariant={makeVariant({ isVisible: false })}
      />,
    );

    expect(screen.getByText("Hidden online")).toBeInTheDocument();
  });

  it("shows live status when product and variant are visible", () => {
    render(
      <ProductStatus
        product={makeProduct({ isVisible: true })}
        productVariant={makeVariant({ isVisible: true, stock: 10, quantityAvailable: 10 })}
      />,
    );

    expect(screen.getByText("Live")).toBeInTheDocument();
    expect(getStatusBadge("Live")).toHaveClass(
      "border-success/30",
      "bg-success/10",
      "text-success",
    );
  });

  it("uses the warning tone for low stock", () => {
    render(
      <ProductStatus
        product={makeProduct()}
        productVariant={makeVariant({ stock: 2, quantityAvailable: 2 })}
      />,
    );

    expect(getStatusBadge("Low stock")).toHaveClass(
      "border-warning/30",
      "bg-warning/10",
      "text-warning",
    );
  });

  it("uses the danger tone for out of stock", () => {
    render(
      <ProductStatus
        product={makeProduct()}
        productVariant={makeVariant({ stock: 0, quantityAvailable: 0 })}
      />,
    );

    expect(getStatusBadge("Out of stock")).toHaveClass(
      "border-danger/30",
      "bg-danger/10",
      "text-danger",
    );
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
    expect(getStatusBadge("Archived")).toHaveClass(
      "border-border/80",
      "bg-muted/60",
      "text-muted-foreground",
    );
  });

  it("shows draft status before stock status for provisional products", () => {
    render(
      <ProductStatus
        product={makeProduct({
          availability: "draft",
          inventoryCount: 0,
          isVisible: false,
        })}
        productVariant={makeVariant({ isVisible: false, stock: 0 })}
      />,
    );

    expect(screen.getByText("Draft")).toBeInTheDocument();
    expect(screen.queryByText("Out of stock")).not.toBeInTheDocument();
    expect(getStatusBadge("Draft")).toHaveClass(
      "border-warning/30",
      "bg-warning/10",
      "text-warning",
    );
  });

  it("uses the neutral tone when the product is hidden online", () => {
    render(
      <ProductStatus
        product={makeProduct({ isVisible: false })}
        productVariant={makeVariant()}
      />,
    );

    expect(getStatusBadge("Hidden online")).toHaveClass(
      "border-border/80",
      "bg-muted/60",
      "text-muted-foreground",
    );
  });

  it("accepts contextual styles for use over product images", () => {
    render(
      <ProductStatus
        className="border-shell-foreground/20 bg-shell/90 text-shell-foreground shadow-overlay backdrop-blur-md"
        product={makeProduct()}
        productVariant={makeVariant()}
      />,
    );

    expect(getStatusBadge("Live")).toHaveClass(
      "border-shell-foreground/20",
      "bg-shell/90",
      "text-shell-foreground",
      "shadow-overlay",
      "backdrop-blur-md",
    );
  });
});
