import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { BulkOperationsPreview } from "./BulkOperationsPreview";
import type { PreviewRow } from "~/src/hooks/useBulkOperations";

// Mock the currency formatter hook
vi.mock("~/src/hooks/useGetCurrencyFormatter", () => ({
  useGetCurrencyFormatter: () =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "GHS",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }),
}));

// Mock getProductName to return productName directly for test simplicity
vi.mock("~/src/lib/productUtils", () => ({
  getProductName: (item: any) => item.productName || "",
}));

const makeRow = (overrides: Partial<PreviewRow> = {}): PreviewRow => ({
  skuId: "sku-1" as any,
  productName: "Test Product",
  sku: "SKU-001",
  currentPricePesewas: 10000,
  currentNetPricePesewas: 10000,
  areProcessingFeesAbsorbed: true,
  newNetPricePesewas: 20000,
  newPricePesewas: 20000,
  hasWarning: false,
  ...overrides,
});

const defaultProps = {
  excludedSkuIds: new Set<string>(),
  selectedCount: 1,
  validSelectedCount: 1,
  isApplying: false,
  onToggleExclusion: vi.fn(),
  onSelectAll: vi.fn(),
  onDeselectAll: vi.fn(),
  onApply: vi.fn(),
};

describe("BulkOperationsPreview", () => {
  it("renders correct number of data rows", () => {
    const rows = [
      makeRow({ skuId: "sku-1" as any, productName: "Product A" }),
      makeRow({ skuId: "sku-2" as any, productName: "Product B" }),
      makeRow({ skuId: "sku-3" as any, productName: "Product C" }),
    ];

    render(
      <BulkOperationsPreview
        {...defaultProps}
        previewRows={rows}
        selectedCount={3}
        validSelectedCount={3}
      />
    );

    expect(screen.getByText("Product A")).toBeInTheDocument();
    expect(screen.getByText("Product B")).toBeInTheDocument();
    expect(screen.getByText("Product C")).toBeInTheDocument();
  });

  it("renders nothing when previewRows is empty", () => {
    const { container } = render(
      <BulkOperationsPreview {...defaultProps} previewRows={[]} />
    );
    expect(container.innerHTML).toBe("");
  });

  it("shows warning icon for rows with hasWarning", () => {
    const rows = [
      makeRow({
        hasWarning: true,
        newNetPricePesewas: -500,
        newPricePesewas: -500,
      }),
    ];

    render(<BulkOperationsPreview {...defaultProps} previewRows={rows} />);

    // The warning count text should appear
    expect(screen.getByText(/1 with invalid price/)).toBeInTheDocument();
  });

  it("disables Apply button when validSelectedCount is 0", () => {
    const rows = [makeRow({ hasWarning: true })];

    render(
      <BulkOperationsPreview
        {...defaultProps}
        previewRows={rows}
        selectedCount={0}
        validSelectedCount={0}
      />
    );

    const applyButton = screen.getByRole("button", {
      name: /Apply Changes/,
    });
    expect(applyButton).toBeDisabled();
  });

  it("enables Apply button when there are valid selected rows", () => {
    const rows = [makeRow()];

    render(
      <BulkOperationsPreview
        {...defaultProps}
        previewRows={rows}
        selectedCount={1}
        validSelectedCount={1}
      />
    );

    const applyButton = screen.getByRole("button", {
      name: /Apply Changes/,
    });
    expect(applyButton).not.toBeDisabled();
  });

  it("shows correct selected count in summary bar", () => {
    const rows = [
      makeRow({ skuId: "sku-1" as any }),
      makeRow({ skuId: "sku-2" as any }),
      makeRow({ skuId: "sku-3" as any }),
    ];

    render(
      <BulkOperationsPreview
        {...defaultProps}
        previewRows={rows}
        selectedCount={2}
        validSelectedCount={2}
      />
    );

    expect(screen.getByText("2 of 3 SKUs selected")).toBeInTheDocument();
  });

  it("calls onToggleExclusion when checkbox is clicked", async () => {
    const onToggle = vi.fn();
    const rows = [makeRow({ skuId: "sku-1" as any })];

    render(
      <BulkOperationsPreview
        {...defaultProps}
        previewRows={rows}
        onToggleExclusion={onToggle}
      />
    );

    const checkboxes = screen.getAllByRole("checkbox");
    // First checkbox is "select all", second is the row checkbox
    await userEvent.click(checkboxes[1]);
    expect(onToggle).toHaveBeenCalledWith("sku-1");
  });

  it("calls onApply when Apply button is clicked", async () => {
    const onApply = vi.fn();
    const rows = [makeRow()];

    render(
      <BulkOperationsPreview
        {...defaultProps}
        previewRows={rows}
        onApply={onApply}
      />
    );

    const applyButton = screen.getByRole("button", {
      name: /Apply Changes/,
    });
    await userEvent.click(applyButton);
    expect(onApply).toHaveBeenCalled();
  });

  it("shows loading state when isApplying is true", () => {
    const rows = [makeRow()];

    render(
      <BulkOperationsPreview
        {...defaultProps}
        previewRows={rows}
        isApplying={true}
      />
    );

    expect(screen.getByText("Applying...")).toBeInTheDocument();
  });

  it("displays current and new prices correctly", () => {
    const rows = [
      makeRow({
        currentNetPricePesewas: 10000,
        newNetPricePesewas: 20000,
      }),
    ];

    render(<BulkOperationsPreview {...defaultProps} previewRows={rows} />);

    // 10000 pesewas = GHS 100, 20000 pesewas = GHS 200
    // Use regex to match currency-formatted output flexibly
    expect(screen.getByText(/100\.00/)).toBeInTheDocument();
    expect(screen.getByText(/200\.00/)).toBeInTheDocument();
  });

  it("dims excluded rows", () => {
    const rows = [makeRow({ skuId: "sku-1" as any })];

    const { container } = render(
      <BulkOperationsPreview
        {...defaultProps}
        previewRows={rows}
        excludedSkuIds={new Set(["sku-1"])}
      />
    );

    const tableRows = container.querySelectorAll("tbody tr");
    expect(tableRows[0]).toHaveClass("opacity-50");
  });
});
