import { parseDisplayAmountInput } from "@/lib/pos/displayAmounts";

import {
  inventoryImportSourceRowToRecord,
  normalizeInventoryImportSourceKey,
  projectInventoryImportSource,
} from "../../../shared/inventoryImportSource";
import type { InventoryImportSourceFormat } from "../../../shared/inventoryImportSource";

export type { InventoryImportSourceFormat } from "../../../shared/inventoryImportSource";

export type InventoryImportRow = {
  rowNumber: number;
  productName: string;
  category?: string;
  subcategory?: string;
  sku?: string;
  barcode?: string;
  price: number;
  unitCost?: number;
  quantity: number;
  size?: string;
  color?: string;
  length?: number;
  weight?: string;
  status?: "active" | "draft" | "archived";
};

export type InventoryImportParseResult = {
  errors: string[];
  format: InventoryImportSourceFormat;
  rows: InventoryImportRow[];
};

type LegacyRow = Record<string, unknown>;

const PRODUCT_NAME_KEYS = [
  "product_name",
  "product",
  "name",
  "item_name",
  "pname",
  "title",
  "item",
  "description",
  "notes",
  "note",
  "productname",
];
const CATEGORY_KEYS = ["category", "category_name", "department"];
const SUBCATEGORY_KEYS = ["subcategory", "subcategory_name", "type"];
const SKU_KEYS = ["sku", "product_sku", "item_code", "code", "stock_code"];
const PRODUCT_ID_KEYS = ["product_id", "legacy_id", "item_id", "id"];
const BARCODE_KEYS = [
  "barcode",
  "bar_code",
  "bcode",
  "upc",
  "ean",
  "lookup_code",
];
const PRICE_KEYS = [
  "price",
  "selling_price",
  "sale_price",
  "retail_price",
  "unit_price",
];
const COST_KEYS = [
  "cost",
  "unit_cost",
  "cost_price",
  "purchase_price",
  "o_price",
];
const QUANTITY_KEYS = [
  "quantity",
  "quantity_available",
  "qty",
  "stock",
  "stock_qty",
  "stock_quantity",
  "onhand_qty",
  "qty_onhand",
  "inventory_count",
];
const SIZE_KEYS = ["size", "variant_size"];
const COLOR_KEYS = ["color", "colour", "variant_color"];
const LENGTH_KEYS = ["length", "variant_length"];
const WEIGHT_KEYS = ["weight"];
const STATUS_KEYS = ["status", "active", "availability"];

export function parseInventoryImportContent(args: {
  content: string;
  fileName?: string;
}): InventoryImportParseResult {
  const projection = projectInventoryImportSource(args);
  if (projection.errors.length > 0) {
    return {
      errors: projection.errors,
      format: projection.format,
      rows: [],
    };
  }

  const legacyRows = projection.rows.map((row) =>
    inventoryImportSourceRowToRecord(projection, row),
  );

  return normalizeLegacyRows(legacyRows, projection.format);
}

function normalizeLegacyRows(
  legacyRows: LegacyRow[],
  format: InventoryImportSourceFormat,
): InventoryImportParseResult {
  const errors: string[] = [];
  const rows: InventoryImportRow[] = [];

  legacyRows.forEach((legacyRow, index) => {
    const rowNumber = index + 2;
    const normalized = normalizeLegacyRow(legacyRow, rowNumber);

    rows.push(normalized.row);
  });

  return { errors, format, rows };
}

function normalizeLegacyRow(
  legacyRow: LegacyRow,
  rowNumber: number,
): { errors: string[]; row: InventoryImportRow } {
  const errors: string[] = [];
  const sku =
    readString(legacyRow, SKU_KEYS) || readString(legacyRow, PRODUCT_ID_KEYS);
  const barcode = readString(legacyRow, BARCODE_KEYS);
  const productName =
    readLabelString(legacyRow, PRODUCT_NAME_KEYS) ||
    inferProductName(legacyRow, {
      barcode,
      rowNumber,
      sku,
    });
  const price = readMoney(legacyRow, PRICE_KEYS) ?? 0;
  const unitCost = readOptionalMoney(legacyRow, COST_KEYS);
  const quantity = readInteger(legacyRow, QUANTITY_KEYS) ?? 0;
  const length = readOptionalNumber(legacyRow, LENGTH_KEYS);
  const status = readStatus(legacyRow, STATUS_KEYS);

  return {
    errors,
    row: {
      rowNumber,
      productName,
      category: readString(legacyRow, CATEGORY_KEYS) || undefined,
      subcategory: readString(legacyRow, SUBCATEGORY_KEYS) || undefined,
      sku: sku || undefined,
      barcode: barcode || undefined,
      price,
      unitCost,
      quantity,
      size: readString(legacyRow, SIZE_KEYS) || undefined,
      color: readString(legacyRow, COLOR_KEYS) || undefined,
      length,
      weight: readString(legacyRow, WEIGHT_KEYS) || undefined,
      status,
    },
  };
}

function readString(row: LegacyRow, keys: string[]) {
  const value = readValue(row, keys);
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function readLabelString(row: LegacyRow, keys: string[]) {
  for (const key of keys) {
    const value = readString(row, [key]);
    if (looksLikeLabel(value)) return value;
  }

  return "";
}

function inferProductName(
  row: LegacyRow,
  args: {
    barcode: string;
    rowNumber: number;
    sku: string;
  },
) {
  const preferredCandidates = [
    readString(row, ["code"]),
    readString(row, ["description"]),
    readString(row, ["notes", "note"]),
    args.sku,
    args.barcode,
  ];
  const labelCandidate = preferredCandidates.find(looksLikeLabel);
  if (labelCandidate) return labelCandidate;

  const anyLabel = Object.values(row)
    .map((value) => String(value ?? "").trim())
    .find(looksLikeLabel);
  if (anyLabel) return anyLabel;

  return args.sku || args.barcode || `Imported row ${args.rowNumber}`;
}

function readValue(row: LegacyRow, keys: string[]) {
  const normalizedEntries = new Map(
    Object.entries(row).map(([key, value]) => [normalizeKey(key), value]),
  );

  for (const key of keys) {
    const value = normalizedEntries.get(normalizeKey(key));
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return value;
    }
  }

  return undefined;
}

function readMoney(row: LegacyRow, keys: string[]) {
  const value = readValue(row, keys);
  if (value === undefined) return undefined;
  return parseDisplayAmountInput(String(value));
}

function readOptionalMoney(row: LegacyRow, keys: string[]) {
  const value = readValue(row, keys);
  if (value === undefined) return undefined;
  return parseDisplayAmountInput(String(value));
}

function readInteger(row: LegacyRow, keys: string[]) {
  const value = readValue(row, keys);
  if (value === undefined) return undefined;
  const numeric = Number(String(value).replace(/,/g, ""));
  if (!Number.isInteger(numeric) || numeric < 0) return undefined;
  return numeric;
}

function readOptionalNumber(row: LegacyRow, keys: string[]) {
  const value = readValue(row, keys);
  if (value === undefined) return undefined;
  const numeric = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(numeric) ? numeric : undefined;
}

function readStatus(
  row: LegacyRow,
  keys: string[],
): InventoryImportRow["status"] {
  const value = readValue(row, keys);
  if (value === undefined) return undefined;
  const normalized = String(value).trim().toLowerCase();

  if (["1", "true", "active", "live", "enabled"].includes(normalized)) {
    return "active";
  }

  if (["draft", "pending"].includes(normalized)) {
    return "draft";
  }

  if (["0", "false", "archived", "inactive", "disabled"].includes(normalized)) {
    return "archived";
  }

  return undefined;
}

function normalizeKey(key: string) {
  return normalizeInventoryImportSourceKey(key);
}

function looksLikeLabel(value: string) {
  return /[A-Za-z]/.test(value);
}
