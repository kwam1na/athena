import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { QuickAddProductDialog } from "./QuickAddProductDialog";

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

globalThis.ResizeObserver = ResizeObserverStub;

function renderQuickAddDialog(input?: {
  onSubmit?: ReturnType<typeof vi.fn>;
  onOpenChange?: ReturnType<typeof vi.fn>;
  onAttachBarcode?: ReturnType<typeof vi.fn>;
  initialName?: string;
}) {
  const onSubmit = input?.onSubmit ?? vi.fn(async () => true);
  const onOpenChange = input?.onOpenChange ?? vi.fn();

  render(
    <QuickAddProductDialog
      open
      onOpenChange={onOpenChange}
      onSubmit={onSubmit}
      onAttachBarcode={input?.onAttachBarcode}
      existingSkuOptions={[
        {
          productSkuId: "sku-1",
          name: "Amin Uh",
          sku: "6N2Y-RGV-A54",
          category: "POS quick add",
        },
        {
          productSkuId: "sku-2",
          name: "gelato cookies",
          sku: "6N2Y-D3-4RC",
          category: "POS quick add",
        },
      ]}
      initialName={input?.initialName ?? "Quick item"}
      initialLookupCode="999999999999"
    />,
  );

  return { onOpenChange, onSubmit };
}

describe("QuickAddProductDialog", () => {
  it("does not seed an extra variant when multiple variants are enabled", async () => {
    const user = userEvent.setup();
    renderQuickAddDialog();

    expect(screen.queryByText(/variant 1/i)).not.toBeInTheDocument();

    await user.click(screen.getByLabelText(/add multiple variants/i));

    expect(screen.getByText(/variant 1/i)).toBeInTheDocument();
    expect(screen.queryByText(/variant 2/i)).not.toBeInTheDocument();
  });

  it("submits parsed product and variant rows", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn(async () => true);
    const onOpenChange = vi.fn();
    renderQuickAddDialog({ onOpenChange, onSubmit });

    await user.type(screen.getByLabelText(/selling price/i), "25");
    await user.click(screen.getByLabelText(/add multiple variants/i));
    await user.click(screen.getByRole("button", { name: /add variant/i }));
    await user.type(screen.getAllByLabelText(/selling price/i)[1], "30");
    await user.click(
      screen.getByRole("button", { name: /add product variants/i }),
    );

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        name: "Quick item",
        variants: [
          {
            lookupCode: "999999999999",
            price: 2500,
            quantityAvailable: 1,
          },
          {
            lookupCode: undefined,
            price: 3000,
            quantityAvailable: 1,
          },
        ],
        usesMultipleVariants: true,
      }),
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("attaches a scanned barcode to an existing SKU without requiring product fields", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn(async () => true);
    const onAttachBarcode = vi.fn(async () => true);
    const onOpenChange = vi.fn();
    renderQuickAddDialog({
      initialName: "",
      onAttachBarcode,
      onOpenChange,
      onSubmit,
    });

    await user.type(screen.getByLabelText(/search existing sku/i), "amin");
    await user.click(screen.getByRole("button", { name: /amin uh/i }));
    await user.click(screen.getByRole("button", { name: /attach barcode/i }));

    await waitFor(() =>
      expect(onAttachBarcode).toHaveBeenCalledWith({
        lookupCode: "999999999999",
        productSkuId: "sku-1",
      }),
    );
    expect(onSubmit).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("capitalizes existing SKU product names", async () => {
    const user = userEvent.setup();
    renderQuickAddDialog({
      initialName: "",
      onAttachBarcode: vi.fn(async () => true),
    });

    await user.type(screen.getByLabelText(/search existing sku/i), "gelato");

    expect(screen.getByText("Gelato Cookies")).toBeInTheDocument();
  });
});
