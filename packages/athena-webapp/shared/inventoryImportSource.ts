export const INVENTORY_IMPORT_SOURCE_PROJECTION_VERSION = 1;

export type InventoryImportSourceFormat = "csv" | "json";
export type InventoryImportSourceValue = string | number | boolean | null;

export type InventoryImportSourceColumn = {
  costValidity?: { valid: number; invalid: number };
  id: string;
  label: string;
  normalizedKey: string;
  ordinal: number;
  sourcePath: string;
  sampleValues: InventoryImportSourceValue[];
};

export type InventoryImportSourceCell = {
  columnId: string;
  rawValue: InventoryImportSourceValue;
};

export type InventoryImportSourceRow = {
  id: string;
  rowNumber: number;
  sourcePath: string;
  cells: InventoryImportSourceCell[];
};

export type InventoryImportSourceProjection = {
  version: typeof INVENTORY_IMPORT_SOURCE_PROJECTION_VERSION;
  errors: string[];
  format: InventoryImportSourceFormat;
  columns: InventoryImportSourceColumn[];
  rows: InventoryImportSourceRow[];
};

export function boundInventoryImportSourceColumns(
  columns: InventoryImportSourceColumn[],
) {
  return columns.map((column) => ({
    ...column,
    sampleValues: column.sampleValues
      .slice(0, 3)
      .map((sample) =>
        typeof sample === "string" && sample.length > 160
          ? sample.slice(0, 160)
          : sample,
      ),
  }));
}

export type InventoryImportCostOutcome =
  | { kind: "missing" }
  | { kind: "valid"; minorUnits: number }
  | { kind: "invalid" }
  | { kind: "negative" }
  | { kind: "excess_precision" }
  | { kind: "out_of_range" };

type JsonRecord = Record<string, unknown>;

const INVENTORY_IMPORT_PRODUCT_NAME_KEYS = [
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
const INVENTORY_IMPORT_SKU_KEYS = [
  "sku",
  "product_sku",
  "item_code",
  "code",
  "stock_code",
];
const INVENTORY_IMPORT_PRODUCT_ID_KEYS = [
  "product_id",
  "legacy_id",
  "item_id",
  "id",
];
const INVENTORY_IMPORT_BARCODE_KEYS = [
  "barcode",
  "bar_code",
  "bcode",
  "upc",
  "ean",
  "lookup_code",
];

type JsonSourceRow = {
  actualPath: string;
  fields: JsonSourceField[];
};

type JsonSourceField = {
  canonicalPath: string;
  label: string;
  rawValue: InventoryImportSourceValue;
};

export function projectInventoryImportSource(args: {
  content: string;
  fileName?: string;
}): InventoryImportSourceProjection {
  const content = args.content;
  const trimmedContent = content.trim();
  const format = detectInventoryImportSourceFormat(
    trimmedContent,
    args.fileName,
  );

  if (!trimmedContent) {
    return emptyProjection(format, [
      "Choose a CSV or JSON file with inventory rows.",
    ]);
  }

  return format === "json"
    ? projectJsonSource(content)
    : projectCsvSource(content);
}

export function inventoryImportSourceRowToRecord(
  projection: Pick<InventoryImportSourceProjection, "columns">,
  row: InventoryImportSourceRow,
): Record<string, InventoryImportSourceValue> {
  const columnsById = new Map(
    projection.columns.map((column) => [column.id, column]),
  );
  const record: Record<string, InventoryImportSourceValue> = {};

  for (const cell of row.cells) {
    const column = columnsById.get(cell.columnId);
    if (column) record[column.normalizedKey] = cell.rawValue;
  }

  return record;
}

export function buildInventoryImportSourceRowIdentity(
  record: Record<string, unknown>,
  rowNumber: number,
) {
  const sku =
    readInventoryImportIdentityString(record, INVENTORY_IMPORT_SKU_KEYS) ||
    readInventoryImportIdentityString(record, INVENTORY_IMPORT_PRODUCT_ID_KEYS);
  const barcode = readInventoryImportIdentityString(
    record,
    INVENTORY_IMPORT_BARCODE_KEYS,
  );
  const productName =
    readInventoryImportIdentityLabel(
      record,
      INVENTORY_IMPORT_PRODUCT_NAME_KEYS,
    ) ||
    inferInventoryImportIdentityName(record, {
      barcode,
      rowNumber,
      sku,
    });

  return {
    rowNumber,
    productName,
    sku: sku || undefined,
    barcode: barcode || undefined,
    rowKey: [rowNumber, sku, barcode, productName]
      .join(":")
      .trim()
      .replace(/\s+/g, " "),
  };
}

function readInventoryImportIdentityValue(
  record: Record<string, unknown>,
  keys: string[],
) {
  const normalizedEntries = new Map(
    Object.entries(record).map(([key, value]) => [
      normalizeInventoryImportSourceKey(key),
      value,
    ]),
  );
  for (const key of keys) {
    const value = normalizedEntries.get(normalizeInventoryImportSourceKey(key));
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return value;
    }
  }
  return undefined;
}

function readInventoryImportIdentityString(
  record: Record<string, unknown>,
  keys: string[],
) {
  const value = readInventoryImportIdentityValue(record, keys);
  return value === undefined ? "" : String(value).trim();
}

function readInventoryImportIdentityLabel(
  record: Record<string, unknown>,
  keys: string[],
) {
  for (const key of keys) {
    const value = readInventoryImportIdentityString(record, [key]);
    if (looksLikeInventoryImportLabel(value)) return value;
  }
  return "";
}

function inferInventoryImportIdentityName(
  record: Record<string, unknown>,
  args: { barcode: string; rowNumber: number; sku: string },
) {
  const preferredCandidates = [
    readInventoryImportIdentityString(record, ["code"]),
    readInventoryImportIdentityString(record, ["description"]),
    readInventoryImportIdentityString(record, ["notes", "note"]),
    args.sku,
    args.barcode,
  ];
  const labelCandidate = preferredCandidates.find(
    looksLikeInventoryImportLabel,
  );
  if (labelCandidate) return labelCandidate;

  const anyLabel = Object.values(record)
    .map((value) => String(value ?? "").trim())
    .find(looksLikeInventoryImportLabel);
  if (anyLabel) return anyLabel;

  return args.sku || args.barcode || `Imported row ${args.rowNumber}`;
}

function looksLikeInventoryImportLabel(value: string) {
  return /[A-Za-z]/.test(value);
}

export function interpretInventoryImportCost(
  rawValue: unknown,
  options: { currencyScale: number },
): InventoryImportCostOutcome {
  const { currencyScale } = options;
  if (
    !Number.isInteger(currencyScale) ||
    currencyScale < 0 ||
    currencyScale > 20
  ) {
    throw new RangeError("currencyScale must be an integer from 0 through 20.");
  }

  if (
    rawValue === undefined ||
    rawValue === null ||
    (typeof rawValue === "string" && rawValue.trim() === "")
  ) {
    return { kind: "missing" };
  }

  if (
    (typeof rawValue !== "string" &&
      typeof rawValue !== "number" &&
      typeof rawValue !== "bigint") ||
    (typeof rawValue === "number" && !Number.isFinite(rawValue))
  ) {
    return { kind: "invalid" };
  }

  const text = String(rawValue).trim();
  if (text.includes("-") || (text.startsWith("(") && text.endsWith(")"))) {
    return { kind: "negative" };
  }

  const currencyToken = String.raw`(?:[A-Za-z]{3}|[$€£¥¢₵₦₹])`;
  const amountPattern = String.raw`(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?`;
  const match = new RegExp(
    String.raw`^(?:${currencyToken}\s*)?${amountPattern}(?:\s*${currencyToken})?$`,
    "i",
  ).exec(text);

  if (!match) return { kind: "invalid" };

  const fractionalDigits = match[2] ?? "";
  if (fractionalDigits.length > currencyScale) {
    return { kind: "excess_precision" };
  }

  const majorUnits = BigInt(match[1].replaceAll(",", ""));
  const scaleFactor = 10n ** BigInt(currencyScale);
  const minorFraction = BigInt(
    fractionalDigits.padEnd(currencyScale, "0") || "0",
  );
  const minorUnits = majorUnits * scaleFactor + minorFraction;

  if (minorUnits > BigInt(Number.MAX_SAFE_INTEGER)) {
    return { kind: "out_of_range" };
  }

  return { kind: "valid", minorUnits: Number(minorUnits) };
}

function projectCsvSource(content: string): InventoryImportSourceProjection {
  const parsedRows = parseCsv(content);
  if (parsedRows.length < 2) {
    return emptyProjection("csv", [
      "CSV file must include a header row and at least one inventory row.",
    ]);
  }

  const duplicateCounts = new Map<string, number>();
  const columns = parsedRows[0].map(
    (rawLabel, index): InventoryImportSourceColumn => {
      const label = rawLabel;
      const normalizedKey = normalizeInventoryImportSourceKey(label);
      const ordinal = (duplicateCounts.get(normalizedKey) ?? 0) + 1;
      duplicateCounts.set(normalizedKey, ordinal);

      return {
        id: `csv:${normalizedKey}:${ordinal}`,
        label,
        normalizedKey,
        ordinal,
        sourcePath: `$[${index}]`,
        sampleValues: [],
        costValidity: { invalid: 0, valid: 0 },
      };
    },
  );

  const rows = parsedRows
    .slice(1)
    .map((values, index): InventoryImportSourceRow => {
      const cells = columns.map((column, columnIndex) => ({
        columnId: column.id,
        rawValue: values[columnIndex] ?? "",
      }));
      addColumnSamples(columns, cells);
      const sourcePath = `$[${index + 1}]`;

      return {
        id: `csv:${sourcePath}`,
        rowNumber: index + 2,
        sourcePath,
        cells,
      };
    });

  return completeProjection("csv", columns, rows);
}

function projectJsonSource(content: string): InventoryImportSourceProjection {
  try {
    const parsed = JSON.parse(content) as unknown;
    const sourceRows = extractJsonSourceRows(parsed);
    const columns: InventoryImportSourceColumn[] = [];
    const columnsByPath = new Map<string, InventoryImportSourceColumn>();
    const keyCounts = new Map<string, number>();

    const rows = sourceRows.map(
      (sourceRow, index): InventoryImportSourceRow => {
        const cells = sourceRow.fields.map((field) => {
          let column = columnsByPath.get(field.canonicalPath);
          if (!column) {
            const normalizedKey = normalizeInventoryImportSourceKey(
              field.label,
            );
            const ordinal = (keyCounts.get(normalizedKey) ?? 0) + 1;
            keyCounts.set(normalizedKey, ordinal);
            column = {
              id: `json:${field.canonicalPath}`,
              label: field.label,
              normalizedKey,
              ordinal,
              sourcePath: field.canonicalPath,
              sampleValues: [],
              costValidity: { invalid: 0, valid: 0 },
            };
            columnsByPath.set(field.canonicalPath, column);
            columns.push(column);
          }

          return { columnId: column.id, rawValue: field.rawValue };
        });
        addColumnSamples(columns, cells);

        return {
          id: `json:${sourceRow.actualPath}`,
          rowNumber: index + 2,
          sourcePath: sourceRow.actualPath,
          cells,
        };
      },
    );

    return completeProjection("json", columns, rows);
  } catch {
    return emptyProjection("json", ["JSON file could not be parsed."]);
  }
}

function extractJsonSourceRows(value: unknown): JsonSourceRow[] {
  if (Array.isArray(value)) {
    return flattenJsonSourceRows(value, "$[]", "$");
  }
  if (!isJsonRecord(value)) return [];

  for (const key of ["rows", "items", "products", "inventory", "data"]) {
    const nested = value[key];
    if (Array.isArray(nested)) {
      return flattenJsonSourceRows(
        nested,
        `${appendJsonProperty("$", key)}[]`,
        appendJsonProperty("$", key),
      );
    }
  }

  return flattenJsonSourceRows([value], "$", "$");
}

function flattenJsonSourceRows(
  values: unknown[],
  canonicalBasePath: string,
  actualBasePath: string,
): JsonSourceRow[] {
  return values.flatMap((value, rowIndex) => {
    if (!isJsonRecord(value)) return [];

    const actualRowPath =
      canonicalBasePath === "$"
        ? actualBasePath
        : `${actualBasePath}[${rowIndex}]`;
    const parentFields = scalarJsonFields(value, canonicalBasePath);
    const nestedEntry = ["skus", "variants", "items"]
      .map((key) => [key, value[key]] as const)
      .find((entry) => Array.isArray(entry[1]));

    if (!nestedEntry || !Array.isArray(nestedEntry[1])) {
      return [{ actualPath: actualRowPath, fields: parentFields }];
    }

    const [nestedKey, nestedValues] = nestedEntry;
    const canonicalNestedPath = `${appendJsonProperty(canonicalBasePath, nestedKey)}[]`;
    const actualNestedPath = appendJsonProperty(actualRowPath, nestedKey);

    return nestedValues.flatMap((nestedValue, nestedIndex) => {
      if (!isJsonRecord(nestedValue)) return [];
      return [
        {
          actualPath: `${actualNestedPath}[${nestedIndex}]`,
          fields: [
            ...parentFields,
            ...scalarJsonFields(nestedValue, canonicalNestedPath),
          ],
        },
      ];
    });
  });
}

function scalarJsonFields(
  value: JsonRecord,
  basePath: string,
): JsonSourceField[] {
  return Object.entries(value).flatMap(([key, rawValue]) => {
    if (!isInventoryImportSourceValue(rawValue)) return [];
    return [
      {
        canonicalPath: appendJsonProperty(basePath, key),
        label: key,
        rawValue,
      },
    ];
  });
}

function appendJsonProperty(path: string, key: string) {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key)
    ? `${path}.${key}`
    : `${path}[${JSON.stringify(key)}]`;
}

function addColumnSamples(
  columns: InventoryImportSourceColumn[],
  cells: InventoryImportSourceCell[],
) {
  const columnsById = new Map(columns.map((column) => [column.id, column]));
  for (const cell of cells) {
    const column = columnsById.get(cell.columnId);
    if (column?.costValidity) {
      const outcome = interpretInventoryImportCost(cell.rawValue, {
        currencyScale: 2,
      });
      if (outcome.kind === "valid") column.costValidity.valid += 1;
      else column.costValidity.invalid += 1;
    }
    if (
      !column ||
      column.sampleValues.length >= 3 ||
      cell.rawValue === null ||
      (typeof cell.rawValue === "string" && cell.rawValue.trim() === "")
    ) {
      continue;
    }
    column.sampleValues.push(cell.rawValue);
  }
}

function parseCsv(content: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    const next = content[index + 1];

    if (char === '"' && inQuotes && next === '"') {
      field += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(field);
      field = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(field);
      if (row.some((value) => value.trim().length > 0)) rows.push(row);
      row = [];
      field = "";
      continue;
    }

    field += char;
  }

  row.push(field);
  if (row.some((value) => value.trim().length > 0)) rows.push(row);

  return rows;
}

function detectInventoryImportSourceFormat(
  content: string,
  fileName?: string,
): InventoryImportSourceFormat {
  const lowerName = fileName?.toLowerCase() ?? "";
  if (lowerName.endsWith(".json")) return "json";
  if (lowerName.endsWith(".csv")) return "csv";
  return content.startsWith("{") || content.startsWith("[") ? "json" : "csv";
}

export function normalizeInventoryImportSourceKey(key: string) {
  return key
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

function isInventoryImportSourceValue(
  value: unknown,
): value is InventoryImportSourceValue {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function completeProjection(
  format: InventoryImportSourceFormat,
  columns: InventoryImportSourceColumn[],
  rows: InventoryImportSourceRow[],
): InventoryImportSourceProjection {
  return {
    version: INVENTORY_IMPORT_SOURCE_PROJECTION_VERSION,
    errors: [],
    format,
    columns,
    rows,
  };
}

function emptyProjection(
  format: InventoryImportSourceFormat,
  errors: string[],
): InventoryImportSourceProjection {
  return {
    version: INVENTORY_IMPORT_SOURCE_PROJECTION_VERSION,
    errors,
    format,
    columns: [],
    rows: [],
  };
}
