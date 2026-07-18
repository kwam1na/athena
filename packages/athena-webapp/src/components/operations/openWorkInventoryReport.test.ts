import { describe, expect, it, vi } from "vitest";
import type { Id } from "~/convex/_generated/dataModel";
import {
  OPEN_WORK_INVENTORY_REPORT_COLUMN_HEADERS,
  OPEN_WORK_INVENTORY_REPORT_PRODUCT_NAME_FONT_SIZE,
  OPEN_WORK_INVENTORY_REPORT_IDENTIFIER_HEADER,
  OPEN_WORK_INVENTORY_REPORT_PAGE_ORIENTATION,
  OPEN_WORK_INVENTORY_REPORT_ROW_HEIGHT,
  OPEN_WORK_INVENTORY_REPORT_ROWS_PER_PAGE,
  buildOpenWorkInventoryReportRows,
  formatOpenWorkInventoryReportProductName,
  formatOpenWorkInventoryReportEyebrow,
  formatOpenWorkInventoryReportItemCount,
  formatOpenWorkInventoryReportPrice,
  registerOpenWorkInventoryReportFonts,
} from "./openWorkInventoryReport";

describe("buildOpenWorkInventoryReportRows", () => {
  it("keeps the requested queue order and projects floor-identification details", () => {
    const rows = buildOpenWorkInventoryReportRows(
      ["sku-2", "sku-1"] as Id<"productSku">[],
      [
        {
          _id: "sku-1" as Id<"productSku">,
          barcode: "603443001827",
          colorName: "Black",
          imageUrl: "https://cdn.invalid/vibes.webp",
          inventoryCount: 4,
          netPrice: null,
          price: 45000,
          productCategory: "Wigs",
          productName: "Vibes",
          quantityAvailable: 4,
          size: "Standard",
          sku: "WIG-VIBES-01",
        },
        {
          _id: "sku-2" as Id<"productSku">,
          barcode: "603443009762",
          colorName: "Sage",
          inventoryCount: 2,
          netPrice: 17250,
          price: 18500,
          productCategory: "Footwear",
          productName: "Clogs",
          quantityAvailable: 2,
          size: "39",
          sku: "SHOE-CLG-SG-39",
        },
      ],
    );

    expect(rows).toEqual([
      expect.objectContaining({
        barcode: "603443009762",
        category: "Footwear",
        name: "Clogs",
        price: 17250,
        variant: "Size 39 · Sage",
      }),
      expect.objectContaining({
        barcode: "603443001827",
        category: "Wigs",
        name: "Vibes",
        variant: "Size Standard · Black",
      }),
    ]);
    expect(rows[0]).not.toHaveProperty("imageUrl");
    expect(rows[0]).not.toHaveProperty("sku");
    expect(rows[1]).not.toHaveProperty("imageUrl");
    expect(rows[1]).not.toHaveProperty("sku");
    expect(rows[1].price).toBeUndefined();
  });

  it("omits stale SKU ids that are absent from the trusted inventory snapshot", () => {
    expect(
      buildOpenWorkInventoryReportRows(
        ["missing-sku"] as Id<"productSku">[],
        [],
      ),
    ).toEqual([]);
  });

  it("omits null-like variant values from product details", () => {
    const rows = buildOpenWorkInventoryReportRows(
      ["sku-1"] as Id<"productSku">[],
      [
        {
          _id: "sku-1" as Id<"productSku">,
          inventoryCount: 1,
          productCategory: "Hair Care",
          productName: "JEBA HAIR DEODORIZER",
          quantityAvailable: 1,
          size: "NULL",
        },
      ],
    );

    expect(rows[0]?.variant).toBeUndefined();
  });
});

describe("registerOpenWorkInventoryReportFonts", () => {
  it("registers Athena's Inter faces for normal and emphasized report text", async () => {
    const document = {
      addFileToVFS: vi.fn(),
      addFont: vi.fn(),
      setFont: vi.fn(),
    };
    const loadFont = vi.fn(async (url: string) => `encoded:${url}`);

    await registerOpenWorkInventoryReportFonts(document, loadFont);

    expect(document.addFont).toHaveBeenCalledWith(
      "Inter-Regular.ttf",
      "Inter",
      "normal",
    );
    expect(document.addFont).toHaveBeenCalledWith(
      "Inter-SemiBold.ttf",
      "Inter",
      "bold",
    );
    expect(document.setFont).toHaveBeenLastCalledWith("Inter", "normal");
  });
});

describe("open work inventory report presentation", () => {
  it("combines net price with product details instead of using a separate price column", () => {
    expect(OPEN_WORK_INVENTORY_REPORT_COLUMN_HEADERS).toEqual([
      "PRODUCT",
      "BARCODE",
    ]);
    expect(formatOpenWorkInventoryReportPrice(13000)).toBe("GH₵130");
    expect(formatOpenWorkInventoryReportPrice(undefined)).toBe(
      "Price not recorded",
    );
  });

  it("uses compact pages and capitalized product names", () => {
    expect(OPEN_WORK_INVENTORY_REPORT_PAGE_ORIENTATION).toBe("portrait");
    expect(OPEN_WORK_INVENTORY_REPORT_ROWS_PER_PAGE).toBe(16);
    expect(OPEN_WORK_INVENTORY_REPORT_ROW_HEIGHT).toBe(14);
    expect(OPEN_WORK_INVENTORY_REPORT_PRODUCT_NAME_FONT_SIZE).toBe(6.6);
    expect(formatOpenWorkInventoryReportProductName("JEBA HAIR DEODORIZER"))
      .toBe("Jeba Hair Deodorizer");
  });

  it("uses a restrained report header without the digital-report label", () => {
    expect(formatOpenWorkInventoryReportEyebrow("Wigclub"))
      .toBe("WIGCLUB · STORE OPS");
    expect(formatOpenWorkInventoryReportItemCount(17)).toBe("17 open items");
    expect(formatOpenWorkInventoryReportItemCount(1)).toBe("1 open item");
  });

  it("treats the barcode as the floor-facing identifier", () => {
    expect(OPEN_WORK_INVENTORY_REPORT_IDENTIFIER_HEADER).toBe("BARCODE");
  });
});
