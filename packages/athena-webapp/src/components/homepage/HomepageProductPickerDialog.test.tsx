import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { HomepageProductPickerDialog } from "./HomepageProductPickerDialog";
import type { Product } from "~/types";

const products = [
  {
    _id: "product-1",
    name: "Lace Front Wig",
    categoryName: "Hair",
    categorySlug: "hair",
    skus: [
      {
        _id: "sku-1",
        productName: "Lace Front Wig",
        sku: "LACE-1",
        images: [],
        price: 12_500,
        quantityAvailable: 5,
      },
    ],
  },
  {
    _id: "product-2",
    name: "Closure Unit",
    categoryName: "Closures",
    categorySlug: "closures",
    skus: [
      {
        _id: "sku-2",
        productName: "Closure Unit",
        sku: "CLOSURE-1",
        images: [],
        price: 10_000,
        quantityAvailable: 4,
      },
    ],
  },
] as unknown as Product[];

function PickerHarness() {
  const [open, setOpen] = useState(true);

  return (
    <>
      <button onClick={() => setOpen(true)} type="button">
        Open picker
      </button>
      <button onClick={() => setOpen(false)} type="button">
        Close picker
      </button>
      <HomepageProductPickerDialog
        currency="GHS"
        description="Select a product"
        onOpenChange={setOpen}
        onSelectProduct={vi.fn(async () => {
          throw new Error("Nope");
        })}
        open={open}
        products={products}
        searchId="homepage-picker-test"
        selectLabel="Add"
        title="Add product"
      />
    </>
  );
}

describe("HomepageProductPickerDialog", () => {
  it("resets search filters and selection errors after parent-driven close and reopen", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    render(<PickerHarness />);

    const search = screen.getByPlaceholderText("Search product, SKU, or barcode");
    fireEvent.change(search, { target: { value: "lace" } });
    fireEvent.click(screen.getByRole("button", { name: "Hair" }));

    expect(screen.getByText("Lace Front Wig")).toBeInTheDocument();
    expect(screen.queryByText("Closure Unit")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("Lace Front Wig"));
    expect(
      await screen.findByText(
        "Homepage placement was not saved. Check the item and try again.",
      ),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByText("Close picker"));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );

    fireEvent.click(screen.getByText("Open picker"));

    expect(
      screen.queryByText(
        "Homepage placement was not saved. Check the item and try again.",
      ),
    ).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText("Search product, SKU, or barcode")).toHaveValue("");
    expect(screen.getByText("Lace Front Wig")).toBeInTheDocument();
    expect(screen.getByText("Closure Unit")).toBeInTheDocument();

    consoleError.mockRestore();
  });
});
