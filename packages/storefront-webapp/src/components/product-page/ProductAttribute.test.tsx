import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ProductAttribute } from "./ProductAttribute";

describe("ProductAttribute", () => {
  it("names each option group and exposes selected state", () => {
    const selectedSku = {
      _id: "sku_black_18",
      colorName: "black",
      length: "18",
      productCategory: "Hair",
      size: "",
    };
    const setSelectedSku = vi.fn();

    render(
      <ProductAttribute
        product={{
          _id: "product_1",
          skus: [
            selectedSku,
            {
              ...selectedSku,
              _id: "sku_brown_18",
              colorName: "brown",
            },
          ],
        } as any}
        selectedSku={selectedSku as any}
        setSelectedSku={setSelectedSku}
      />,
    );

    expect(screen.getByRole("group", { name: "Color" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Black" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    fireEvent.click(screen.getByRole("button", { name: "Brown" }));

    expect(setSelectedSku).toHaveBeenCalledWith(
      expect.objectContaining({ _id: "sku_brown_18" }),
    );
  });
});
