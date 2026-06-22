import { createElement } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  getProductImageUrl,
  HomepagePlacementProductImage,
} from "./HomepagePlacementProductImage";
import type { Product } from "~/types";

describe("getProductImageUrl", () => {
  it("uses the first available image across product SKUs", () => {
    const product = {
      skus: [
        {
          images: [],
        },
        {
          images: ["https://example.com/bone-straight.webp"],
        },
      ],
    } as unknown as Product;

    expect(getProductImageUrl(product)).toBe(
      "https://example.com/bone-straight.webp",
    );
  });

  it("renders the placement placeholder when the image fails to load", () => {
    const product = {
      skus: [
        {
          images: ["https://example.com/broken.webp"],
        },
      ],
    } as unknown as Product;

    render(
      createElement(HomepagePlacementProductImage, {
        alt: "Bone Straight Wig",
        product,
      }),
    );

    fireEvent.error(screen.getByRole("img", { name: "Bone Straight Wig" }));

    expect(
      screen.getByRole("img", { name: "Bone Straight Wig" }),
    ).toBeInTheDocument();
    expect(screen.queryByAltText("Bone Straight Wig")).not.toBeInTheDocument();
  });
});
