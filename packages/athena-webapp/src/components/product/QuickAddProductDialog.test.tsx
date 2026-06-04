import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { QuickAddProductDialog } from "./QuickAddProductDialog";

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

globalThis.ResizeObserver = ResizeObserverStub;

const mockedScanner = vi.hoisted(() => ({
  BrowserMultiFormatReader: vi.fn(),
  decodeFromConstraints: vi.fn(),
  stop: vi.fn(),
}));

vi.mock("@zxing/browser", () => ({
  BrowserMultiFormatReader: mockedScanner.BrowserMultiFormatReader,
}));

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
          variantAttributes: ["Green", "2 oz"],
        },
        {
          productSkuId: "sku-3",
          name: "Closure Wig",
          sku: "CW-18",
          category: "Wigs",
          variantAttributes: ["Natural black", "Large", "18"],
        },
        {
          productSkuId: "sku-4",
          name: "Body Wave Bundle",
          sku: "111222333444",
          category: "Wigs",
          variantAttributes: ["Natural black", "20"],
        },
      ]}
      initialName={input?.initialName ?? "Quick item"}
      initialLookupCode="999999999999"
    />,
  );

  return { onOpenChange, onSubmit };
}

describe("QuickAddProductDialog", () => {
  beforeEach(() => {
    mockedScanner.BrowserMultiFormatReader.mockReset();
    mockedScanner.decodeFromConstraints.mockReset();
    mockedScanner.stop.mockReset();
    mockedScanner.BrowserMultiFormatReader.mockImplementation(() => ({
      decodeFromConstraints: mockedScanner.decodeFromConstraints,
    }));
  });

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

  it("fills the barcode field from the shared scanner trigger", async () => {
    const user = userEvent.setup();

    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn() },
    });
    mockedScanner.decodeFromConstraints.mockImplementation(
      async (_constraints, _videoElement, onResult) => {
        onResult(
          { getText: () => "1234567890123" },
          undefined,
          { stop: mockedScanner.stop },
        );

        return { stop: mockedScanner.stop };
      },
    );

    renderQuickAddDialog();

    await user.click(screen.getByRole("button", { name: /scan with camera/i }));

    await waitFor(() =>
      expect(screen.getByLabelText(/^barcode$/i)).toHaveValue("1234567890123"),
    );
    expect(mockedScanner.decodeFromConstraints).toHaveBeenCalled();
    expect(mockedScanner.stop).toHaveBeenCalled();
  });

  it("closes the shared scanner dialog while quick add remains open", async () => {
    const user = userEvent.setup();

    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn() },
    });
    mockedScanner.decodeFromConstraints.mockImplementation(
      () => new Promise(() => {}),
    );

    const { onOpenChange } = renderQuickAddDialog();

    await user.click(screen.getByRole("button", { name: /scan with camera/i }));

    expect(
      screen.getByRole("heading", { name: /scan barcode/i }),
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: /close barcode scanner/i }),
    );

    await waitFor(() =>
      expect(
        screen.queryByRole("heading", { name: /scan barcode/i }),
      ).not.toBeInTheDocument(),
    );
    expect(
      screen.getByRole("heading", { name: /quick add product/i }),
    ).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
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
    expect(
      screen.getByText("6N2Y-D3-4RC - POS quick add - Green - 2 oz"),
    ).toBeInTheDocument();
  });

  it("uses the shared fuzzy SKU matcher for existing SKU barcode recovery", async () => {
    const user = userEvent.setup();
    renderQuickAddDialog({
      initialName: "",
      onAttachBarcode: vi.fn(async () => true),
    });

    await user.type(
      screen.getByLabelText(/search existing sku/i),
      "natrual blak",
    );

    expect(
      screen.getByRole("button", { name: /closure wig/i }),
    ).toBeInTheDocument();
  });

  it("keeps barcode-shaped existing SKU searches exact", async () => {
    const user = userEvent.setup();
    renderQuickAddDialog({
      initialName: "",
      onAttachBarcode: vi.fn(async () => true),
    });

    await user.type(
      screen.getByLabelText(/search existing sku/i),
      "111222333445",
    );

    expect(screen.getByText("No matching SKUs.")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /body wave bundle/i }),
    ).not.toBeInTheDocument();
  });
});
