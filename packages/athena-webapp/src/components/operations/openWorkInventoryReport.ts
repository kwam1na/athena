import JsBarcode from "jsbarcode";
import type { jsPDF } from "jspdf";
import type { Id } from "~/convex/_generated/dataModel";
import { currencyFormatter } from "~/shared/currencyFormatter";
import { formatStoredAmount } from "@/lib/pos/displayAmounts";
import interRegularUrl from "@/assets/fonts/inter/Inter-Regular.ttf?url";
import interSemiBoldUrl from "@/assets/fonts/inter/Inter-SemiBold.ttf?url";
import type { InventorySnapshotItem } from "./StockAdjustmentWorkspace";

export type OpenWorkInventoryReportRow = {
  barcode?: string;
  category?: string;
  name: string;
  price?: number;
  productSkuId: Id<"productSku">;
  variant?: string;
};

const reportCurrencyFormatter = currencyFormatter("GHS");
export const OPEN_WORK_INVENTORY_REPORT_PAGE_ORIENTATION = "portrait";
export const OPEN_WORK_INVENTORY_REPORT_ROWS_PER_PAGE = 16;
export const OPEN_WORK_INVENTORY_REPORT_ROW_HEIGHT = 14;
export const OPEN_WORK_INVENTORY_REPORT_PRODUCT_NAME_FONT_SIZE = 6.6;
export const OPEN_WORK_INVENTORY_REPORT_COLUMN_HEADERS = [
  "PRODUCT",
  "BARCODE",
] as const;
export const OPEN_WORK_INVENTORY_REPORT_IDENTIFIER_HEADER =
  OPEN_WORK_INVENTORY_REPORT_COLUMN_HEADERS[1];

export function formatOpenWorkInventoryReportProductName(name: string) {
  return name.trim().toLocaleLowerCase("en-US").replace(
    /(^|[\s/-])(\p{L})/gu,
    (_match, prefix: string, letter: string) =>
      `${prefix}${letter.toLocaleUpperCase("en-US")}`,
  );
}

export function formatOpenWorkInventoryReportEyebrow(storeName?: string) {
  return `${(storeName?.trim() || "STORE").toLocaleUpperCase("en-US")} · STORE OPS`;
}

export function formatOpenWorkInventoryReportItemCount(itemCount: number) {
  return `${itemCount.toLocaleString()} open ${itemCount === 1 ? "item" : "items"}`;
}

export function formatOpenWorkInventoryReportPrice(price?: number) {
  return price === undefined
    ? "Price not recorded"
    : formatStoredAmount(reportCurrencyFormatter, price);
}

type ReportFontDocument = {
  addFileToVFS(filename: string, filecontent: string): unknown;
  addFont(
    postScriptName: string,
    id: string,
    fontStyle: string,
  ): unknown;
  setFont(fontName: string, fontStyle?: string): unknown;
};

type ReportFontLoader = (url: string) => Promise<string>;

async function loadFontAsBase64(url: string) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Unable to load report font (${response.status})`);
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  const chunkSize = 0x8000;
  let binary = "";
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

export async function registerOpenWorkInventoryReportFonts(
  document: ReportFontDocument,
  loadFont: ReportFontLoader = loadFontAsBase64,
) {
  const [regular, semiBold] = await Promise.all([
    loadFont(interRegularUrl),
    loadFont(interSemiBoldUrl),
  ]);

  document.addFileToVFS("Inter-Regular.ttf", regular);
  document.addFont("Inter-Regular.ttf", "Inter", "normal");
  document.addFileToVFS("Inter-SemiBold.ttf", semiBold);
  document.addFont("Inter-SemiBold.ttf", "Inter", "bold");
  document.setFont("Inter", "normal");
}

function cleanValue(value: string | null | undefined) {
  const normalized = value?.trim();
  if (/^(null|undefined|n\/a|none)$/i.test(normalized || "")) {
    return undefined;
  }
  return normalized || undefined;
}

function formatVariant(item: InventorySnapshotItem) {
  return [
    item.length ? `${item.length}"` : undefined,
    cleanValue(item.size) ? `Size ${item.size}` : undefined,
    cleanValue(item.colorName),
  ]
    .filter(Boolean)
    .join(" · ");
}

export function buildOpenWorkInventoryReportRows(
  productSkuIds: Id<"productSku">[],
  inventoryItems: InventorySnapshotItem[],
): OpenWorkInventoryReportRow[] {
  const inventoryBySkuId = new Map(
    inventoryItems.map((item) => [item._id, item]),
  );

  return Array.from(new Set(productSkuIds)).flatMap((productSkuId) => {
    const item = inventoryBySkuId.get(productSkuId);
    if (!item) return [];

    return [
      {
        barcode: cleanValue(item.barcode),
        category: cleanValue(item.productCategory),
        name: item.productName,
        price: item.netPrice ?? undefined,
        productSkuId,
        variant: formatVariant(item) || undefined,
      },
    ];
  });
}

function toReportDate(value: Date) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(value);
}

function toFilenameDate(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function createBarcodeDataUrl(value: string) {
  try {
    const canvas = document.createElement("canvas");
    JsBarcode(canvas, value, {
      background: "#ffffff",
      displayValue: false,
      height: 34,
      margin: 0,
      width: 1.25,
    });
    return canvas.toDataURL("image/png");
  } catch {
    return undefined;
  }
}

function drawReportHeader(args: {
  document: jsPDF;
  generatedAt: Date;
  itemCount: number;
  storeName?: string;
}) {
  const { document, generatedAt, itemCount, storeName } = args;
  const pageWidth = document.internal.pageSize.getWidth();
  const right = pageWidth - 12;

  document.setTextColor(115, 119, 129);
  document.setFont("Inter", "bold");
  document.setFontSize(5.2);
  document.text(formatOpenWorkInventoryReportEyebrow(storeName), 12, 8.5);

  document.setTextColor(23, 25, 29);
  document.setFontSize(13.5);
  document.text("Inventory review", 12, 17);
  document.setFont("Inter", "normal");
  document.setFontSize(6.5);
  document.text(
    "Synced sale products requiring a stock check",
    12,
    22.5,
  );

  document.setTextColor(23, 25, 29);
  document.setFont("Inter", "bold");
  document.setFontSize(8);
  document.text(formatOpenWorkInventoryReportItemCount(itemCount), right, 13, {
    align: "right",
  });
  document.setFont("Inter", "normal");
  document.setTextColor(112, 117, 126);
  document.setFontSize(5.6);
  document.text(`Generated ${toReportDate(generatedAt)}`, right, 20, {
    align: "right",
  });
}

function drawColumnHeaders(document: jsPDF, y: number) {
  document.setFont("Inter", "bold");
  document.setFontSize(6.2);
  document.setTextColor(115, 119, 129);
  document.text(OPEN_WORK_INVENTORY_REPORT_COLUMN_HEADERS[0], 12, y);
  document.text(OPEN_WORK_INVENTORY_REPORT_IDENTIFIER_HEADER, 96, y);
}

function drawReportFooter(document: jsPDF, page: number, pageCount: number) {
  const pageHeight = document.internal.pageSize.getHeight();
  const pageWidth = document.internal.pageSize.getWidth();
  document.setDrawColor(225, 226, 228);
  document.line(14, pageHeight - 10, pageWidth - 14, pageHeight - 10);
  document.setTextColor(133, 137, 147);
  document.setFont("Inter", "normal");
  document.setFontSize(6);
  document.text(`Page ${page} of ${pageCount}`, pageWidth - 14, pageHeight - 5, {
    align: "right",
  });
}

function drawReportRow(args: {
  barcodeDataUrl?: string;
  document: jsPDF;
  row: OpenWorkInventoryReportRow;
  y: number;
}) {
  const { barcodeDataUrl, document, row, y } = args;
  const pageWidth = document.internal.pageSize.getWidth();
  const right = pageWidth - 12;
  const rowHeight = OPEN_WORK_INVENTORY_REPORT_ROW_HEIGHT;

  document.setDrawColor(229, 230, 232);
  document.setLineWidth(0.2);
  document.line(12, y + rowHeight, right, y + rowHeight);

  document.setTextColor(23, 25, 29);
  document.setFont("Inter", "bold");
  document.setFontSize(OPEN_WORK_INVENTORY_REPORT_PRODUCT_NAME_FONT_SIZE);
  document.text(formatOpenWorkInventoryReportProductName(row.name), 12, y + 5.2, {
    maxWidth: 76,
  });
  const productDetails =
    [row.category, row.variant].filter(Boolean).join(" · ") || "Product";
  const priceLabel = formatOpenWorkInventoryReportPrice(row.price);
  const priceTextColor =
    row.price === undefined
      ? ([112, 117, 126] as const)
      : ([23, 25, 29] as const);
  document.setFont("Inter", "bold");
  document.setFontSize(5.8);
  document.setTextColor(
    priceTextColor[0],
    priceTextColor[1],
    priceTextColor[2],
  );
  document.text(priceLabel, 12, y + 10.2);

  const productDetailsX = 12 + document.getTextWidth(priceLabel) + 2.2;
  document.setFont("Inter", "normal");
  document.setFontSize(5.4);
  document.setTextColor(112, 117, 126);
  document.text(`· ${productDetails}`, productDetailsX, y + 10.2, {
    maxWidth: Math.max(8, 88 - productDetailsX),
  });

  if (barcodeDataUrl && row.barcode) {
    document.setTextColor(23, 25, 29);
    document.setFont("Inter", "bold");
    document.setFontSize(6.2);
    document.text(row.barcode, 96, y + 4.8);
    document.addImage(barcodeDataUrl, "PNG", 96, y + 6.3, 30, 4.2);
  } else {
    document.setFont("Inter", "normal");
    document.setTextColor(112, 117, 126);
    document.setFontSize(6);
    document.text("Barcode not recorded", 96, y + 7.4);
  }
}

export async function exportOpenWorkInventoryPdf(args: {
  generatedAt?: Date;
  rows: OpenWorkInventoryReportRow[];
  storeName?: string;
}) {
  const { jsPDF } = await import("jspdf");
  const generatedAt = args.generatedAt ?? new Date();
  const document = new jsPDF({
    format: "a4",
    orientation: OPEN_WORK_INVENTORY_REPORT_PAGE_ORIENTATION,
    unit: "mm",
  });
  await registerOpenWorkInventoryReportFonts(document);
  const rowsPerPage = OPEN_WORK_INVENTORY_REPORT_ROWS_PER_PAGE;
  const pageCount = Math.max(1, Math.ceil(args.rows.length / rowsPerPage));
  const barcodeDataUrls = args.rows.map((row) =>
    row.barcode ? createBarcodeDataUrl(row.barcode) : undefined,
  );

  for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
    if (pageIndex > 0) {
      document.addPage("a4", OPEN_WORK_INVENTORY_REPORT_PAGE_ORIENTATION);
    }

    drawReportHeader({
      document,
      generatedAt,
      itemCount: args.rows.length,
      storeName: args.storeName,
    });
    drawColumnHeaders(document, 30);

    const start = pageIndex * rowsPerPage;
    args.rows.slice(start, start + rowsPerPage).forEach((row, rowIndex) => {
      const absoluteIndex = start + rowIndex;
      drawReportRow({
        barcodeDataUrl: barcodeDataUrls[absoluteIndex],
        document,
        row,
        y: 33 + rowIndex * 14.8,
      });
    });

    drawReportFooter(document, pageIndex + 1, pageCount);
  }

  document.save(`inventory-review-${toFilenameDate(generatedAt)}.pdf`);
}
