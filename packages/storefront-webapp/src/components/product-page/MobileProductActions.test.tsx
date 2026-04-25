import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { HTMLAttributes, ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { MobileProductActions } from "./MobileProductActions";

vi.mock("framer-motion", () => ({
  AnimatePresence: ({ children }: { children: ReactNode }) => children,
  motion: {
    div: ({ children, ...props }: HTMLAttributes<HTMLDivElement>) => (
      <div {...props}>{children}</div>
    ),
  },
}));

const blackEightSku = {
  _id: "sku-black-8",
  sku: "BLACK-8",
  productId: "product-1",
  productCategory: "Hair",
  colorName: "black",
  length: 8,
  size: "13x4",
  price: 999,
  images: [],
};

const blondeTenSku = {
  ...blackEightSku,
  _id: "sku-blonde-10",
  sku: "BLONDE-10",
  colorName: "blonde",
  length: 10,
};

const product = {
  _id: "product-1",
  skus: [blackEightSku, blondeTenSku],
} as any;

describe("MobileProductActions", () => {
  it("collects product details before adding to bag", async () => {
    const handleUpdateBag = vi.fn(async () => {});

    render(
      <MobileProductActions
        product={product}
        selectedSku={blackEightSku as any}
        setSelectedSku={vi.fn()}
        handleUpdateBag={handleUpdateBag}
        handleUpdateSavedBag={vi.fn(async () => {})}
        isUpdatingBag={false}
        isSoldOut={false}
        addedItemSuccessfully={null}
      />,
    );

    fireEvent.click(screen.getByTestId("storefront-product-add-to-bag"));

    expect(handleUpdateBag).not.toHaveBeenCalled();
    expect(screen.getByText("Color")).toBeInTheDocument();
    expect(screen.getByText("Length")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Add selection" }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Add selection" }));

    await waitFor(
      () => expect(handleUpdateBag).toHaveBeenCalledTimes(1),
      { timeout: 12_000 },
    );
  });
});
