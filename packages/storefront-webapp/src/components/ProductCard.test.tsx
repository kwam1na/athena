import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ProductCard, ProductSkuCard } from "./ProductCard";
import { currencyFormatter } from "@/lib/utils";

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

vi.mock("@/contexts/StoreContext", () => ({
  useStoreContext: () => ({ store: undefined }),
}));

describe("ProductCard", () => {
  it("does not show sold out when any sibling SKU has sellable availability", () => {
    render(
      <ProductCard
        product={{
          _id: "product_1",
          name: "5x5 Glueless Closure Wig",
          skus: [
            {
              _id: "sku_sold_out",
              productName: "5x5 Glueless Closure Wig",
              price: 178400,
              quantityAvailable: 0,
              images: ["https://images.example.com/sold-out.webp"],
              sku: "SOLD-OUT",
            },
            {
              _id: "sku_in_stock",
              productName: "5x5 Glueless Closure Wig",
              price: 178400,
              quantityAvailable: 2,
              images: ["https://images.example.com/in-stock.webp"],
              sku: "IN-STOCK",
            },
          ],
        } as any}
        currencyFormatter={currencyFormatter("GHS")}
      />,
    );

    expect(screen.queryByText("Sold Out")).not.toBeInTheDocument();
    expect(screen.getByAltText("5x5 Glueless Closure Wig image")).toHaveAttribute(
      "src",
      "https://images.example.com/in-stock.webp",
    );
  });
});

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

  it("renders stored GHS prices with the Athena cedi symbol", () => {
    render(
      <ProductSkuCard
        sku={{
          _id: "sku_1",
          productName: "Wigclub Bonnets",
          price: 6500,
          quantityAvailable: 4,
          images: ["https://images.example.com/bonnet.webp"],
        } as any}
        currencyFormatter={currencyFormatter("GHS")}
      />,
    );

    expect(screen.getByText("GH₵65")).toBeInTheDocument();
  });

  it("shows the storefront placeholder when product imagery fails", () => {
    render(
      <ProductSkuCard
        sku={{
          _id: "sku_1",
          productName: "Banana",
          price: 2000,
          quantityAvailable: 0,
          images: ["https://images.example.com/missing-banana.webp"],
        } as any}
        currencyFormatter={currencyFormatter("GHS")}
      />,
    );

    const image = screen.getByAltText("Banana image");
    fireEvent.error(image);

    expect(image).toHaveAttribute(
      "src",
      expect.stringContaining("placeholder"),
    );
  });
});
