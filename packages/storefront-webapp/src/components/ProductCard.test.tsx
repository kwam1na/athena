import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ProductSkuCard } from "./ProductCard";

vi.mock("@/hooks/useProductDiscount", () => ({
  useProductDiscount: () => ({
    hasDiscount: false,
    discountedPrice: 0,
    originalPrice: 0,
  }),
  useProductDiscounts: () => ({
    hasDiscount: false,
    discountedPrice: 0,
    originalPrice: 0,
    discountedSkuId: undefined,
  }),
}));

describe("ProductSkuCard", () => {
  it("marks product imagery as lazy-loaded and async decoded", () => {
    render(
      <ProductSkuCard
        sku={{
          _id: "sku_1",
          productName: "Wigclub Bonnets",
          price: 6500,
          quantityAvailable: 4,
          images: ["https://images.example.com/bonnet.webp"],
        } as any}
        currencyFormatter={new Intl.NumberFormat("en-US")}
      />,
    );

    const image = screen.getByAltText("Wigclub Bonnets image");

    expect(image).toHaveAttribute("loading", "lazy");
    expect(image).toHaveAttribute("decoding", "async");
    expect(image).toHaveAttribute(
      "sizes",
      "(max-width: 768px) 50vw, (max-width: 1280px) 33vw, 25vw",
    );
  });
});
