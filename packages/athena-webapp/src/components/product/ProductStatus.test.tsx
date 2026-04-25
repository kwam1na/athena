import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ProductStatus } from "./ProductStatus";

const visibleProduct = {
  _id: "product-1",
  _creationTime: 0,
  inventoryCount: 12,
  isVisible: true,
  skus: [],
} as const;

describe("ProductStatus", () => {
  it("shows hidden when the product is hidden", () => {
    render(
      <ProductStatus
        product={{ ...visibleProduct, isVisible: false }}
        productVariant={{ id: "variant-1", isVisible: true } as any}
      />,
    );

    expect(screen.getByText("Hidden")).toBeInTheDocument();
  });

  it("shows hidden when the variant is hidden", () => {
    render(
      <ProductStatus
        product={visibleProduct as any}
        productVariant={{
          id: "variant-2",
          isVisible: false,
          stock: 12,
          quantityAvailable: 12,
        } as any}
      />,
    );

    expect(screen.getByText("Hidden")).toBeInTheDocument();
  });

  it("shows live when both product and variant are visible", () => {
    render(
      <ProductStatus
        product={visibleProduct as any}
        productVariant={{
          id: "variant-3",
          isVisible: true,
          stock: 12,
          quantityAvailable: 12,
        } as any}
      />,
    );

    expect(screen.getByText("Live")).toBeInTheDocument();
  });
});
