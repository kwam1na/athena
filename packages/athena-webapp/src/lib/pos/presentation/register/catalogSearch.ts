import {
  createFuzzySearchEntry,
  searchFuzzyEntries,
  type FuzzySearchEntry,
} from "@/lib/search/fuzzySearch";
import type {
  PosServiceCatalogCheckoutReadiness,
  PosServiceCatalogDepositType,
  PosServiceCatalogPricingModel,
} from "@/lib/pos/application/dto";
import type { PosServiceMode } from "@/lib/pos/domain";

export interface RegisterCatalogSearchRow {
  id?: string;
  catalogRowKey?: string | null;
  productId: string;
  productSkuId: string;
  name: string;
  sku?: string | null;
  barcode?: string | null;
  category?: string | null;
  description?: string | null;
  price?: number | null;
  size?: string | null;
  length?: number | string | null;
  color?: string | null;
  image?: string | null;
  areProcessingFeesAbsorbed?: boolean | null;
  availabilityPolicy?:
    | "trusted_inventory"
    | "active_provisional_import"
    | "pending_checkout";
  inventoryImportProvisionalSkuId?: string | null;
  pendingCheckoutItemId?: string | null;
  pendingCheckoutAliasState?: "linked_to_catalog" | null;
  pendingCheckoutAliasLookupCode?: string | null;
  pendingCheckoutAliasName?: string | null;
  pendingCheckoutAliasPrice?: number | null;
  pendingCheckoutAliasTrustedName?: string | null;
  pendingCheckoutAliasTrustedSku?: string | null;
  pendingCheckoutAliasTrustedCategory?: string | null;
  pendingCheckoutAliasTrustedDescription?: string | null;
  linkedPendingCheckoutItemIds?: string[] | null;
  linkedPendingCheckoutLocalEventIds?: string[] | null;
  suppressedPendingCheckoutItemIds?: string[] | null;
  suppressedPendingCheckoutLocalEventIds?: string[] | null;
  suppressFromRegisterSearch?: true | null;
}

export type RegisterCatalogSearchResult =
  | {
      intent: "empty";
      query: "";
      results: [];
      exactMatch: null;
      canAutoAdd: false;
    }
  | {
      intent: "exact";
      query: string;
      results: RegisterCatalogSearchRow[];
      exactMatch: RegisterCatalogSearchRow | null;
      canAutoAdd: boolean;
    }
  | {
      intent: "text";
      query: string;
      results: RegisterCatalogSearchRow[];
      exactMatch: null;
      canAutoAdd: false;
    };

export interface RegisterCatalogIndex {
  rows: RegisterCatalogSearchRow[];
  byBarcode: Map<string, RegisterCatalogSearchRow[]>;
  bySku: Map<string, RegisterCatalogSearchRow[]>;
  byProductSkuId: Map<string, RegisterCatalogSearchRow[]>;
  byProductId: Map<string, RegisterCatalogSearchRow[]>;
  searchableRows: Array<FuzzySearchEntry<RegisterCatalogSearchRow>>;
}

export interface RegisterServiceCatalogSearchRow {
  serviceCatalogId: string;
  name: string;
  description?: string | null;
  serviceMode: PosServiceMode;
  pricingModel: PosServiceCatalogPricingModel;
  basePrice?: number | null;
  depositType: PosServiceCatalogDepositType;
  depositValue?: number | null;
  requiresManagerApproval: boolean;
  checkoutReadiness: PosServiceCatalogCheckoutReadiness;
}

export type RegisterServiceCatalogSearchResult =
  | {
      intent: "empty";
      query: "";
      results: [];
      exactMatch: null;
      canAutoAdd: false;
    }
  | {
      intent: "exact";
      query: string;
      results: RegisterServiceCatalogSearchRow[];
      exactMatch: RegisterServiceCatalogSearchRow | null;
      canAutoAdd: false;
    }
  | {
      intent: "text";
      query: string;
      results: RegisterServiceCatalogSearchRow[];
      exactMatch: null;
      canAutoAdd: false;
    };

export interface RegisterServiceCatalogIndex {
  rows: RegisterServiceCatalogSearchRow[];
  byServiceCatalogId: Map<string, RegisterServiceCatalogSearchRow[]>;
  searchableRows: Array<FuzzySearchEntry<RegisterServiceCatalogSearchRow>>;
}

type ParsedCatalogSearchInput =
  | { type: "empty"; value: "" }
  | { type: "identifier"; value: string }
  | { type: "text"; value: string };

export function buildRegisterCatalogIndex(
  rows: readonly RegisterCatalogSearchRow[],
): RegisterCatalogIndex {
  const searchableCatalogRows = rows.filter(
    (row) => row.suppressFromRegisterSearch !== true,
  );
  const byBarcode = new Map<string, RegisterCatalogSearchRow[]>();
  const bySku = new Map<string, RegisterCatalogSearchRow[]>();
  const byProductSkuId = new Map<string, RegisterCatalogSearchRow[]>();
  const byProductId = new Map<string, RegisterCatalogSearchRow[]>();

  const indexedRows = searchableCatalogRows.map((row) => {
    addKey(byBarcode, normalizeIdentifier(row.barcode), row);
    addKey(bySku, normalizeIdentifier(row.sku), row);
    const aliasLookupCode = normalizeIdentifier(
      row.pendingCheckoutAliasLookupCode,
    );
    if (
      aliasLookupCode &&
      aliasLookupCode !== normalizeIdentifier(row.barcode)
    ) {
      addKey(byBarcode, aliasLookupCode, row);
    }
    if (aliasLookupCode && aliasLookupCode !== normalizeIdentifier(row.sku)) {
      addKey(bySku, aliasLookupCode, row);
    }
    const aliasTrustedSku = normalizeIdentifier(
      row.pendingCheckoutAliasTrustedSku,
    );
    if (aliasTrustedSku && aliasTrustedSku !== normalizeIdentifier(row.sku)) {
      addKey(bySku, aliasTrustedSku, row);
    }
    addKey(byProductSkuId, normalizeIdentifier(row.productSkuId), row);
    addKey(byProductId, normalizeIdentifier(row.productId), row);

    return createFuzzySearchEntry(row, {
      name: row.name,
      sku: row.sku,
      aliasName: row.pendingCheckoutAliasName,
      aliasLookupCode: row.pendingCheckoutAliasLookupCode,
      aliasTrustedName: row.pendingCheckoutAliasTrustedName,
      aliasTrustedSku: row.pendingCheckoutAliasTrustedSku,
      aliasTrustedCategory: row.pendingCheckoutAliasTrustedCategory,
      aliasTrustedDescription: row.pendingCheckoutAliasTrustedDescription,
      category: row.category,
      description: row.description,
      attributes: normalizeSearchText([
        row.size,
        row.length == null ? "" : String(row.length),
        row.color,
      ]),
    });
  });

  return {
    rows: searchableCatalogRows,
    byBarcode,
    bySku,
    byProductSkuId,
    byProductId,
    searchableRows: indexedRows,
  };
}

export function searchRegisterCatalog(
  index: RegisterCatalogIndex,
  input: string,
  options: { limit?: number } = {},
): RegisterCatalogSearchResult {
  const query = input.trim();

  if (!query) {
    return {
      intent: "empty",
      query: "",
      results: [],
      exactMatch: null,
      canAutoAdd: false,
    };
  }

  const parsed = parseCatalogSearchInput(query);
  const exactResults = findExactMatches(index, parsed.value);

  if (exactResults.length > 0) {
    const results = applyLinkedPendingAliasDisplay(exactResults, parsed.value);
    const exactMatch = results.length === 1 ? results[0] : null;

    return {
      intent: "exact",
      query,
      results,
      exactMatch,
      canAutoAdd: false,
    };
  }

  if (parsed.type === "identifier") {
    return {
      intent: "exact",
      query,
      results: [],
      exactMatch: null,
      canAutoAdd: false,
    };
  }

  const results = searchByText(index, parsed.value, options.limit);

  return {
    intent: "text",
    query,
    results,
    exactMatch: null,
    canAutoAdd: false,
  };
}

export function buildRegisterServiceCatalogIndex(
  rows: readonly RegisterServiceCatalogSearchRow[],
): RegisterServiceCatalogIndex {
  const byServiceCatalogId = new Map<
    string,
    RegisterServiceCatalogSearchRow[]
  >();
  const indexedRows = rows.map((row) => {
    addKey(byServiceCatalogId, normalizeIdentifier(row.serviceCatalogId), row);

    return createFuzzySearchEntry(row, {
      name: row.name,
      category: normalizeSearchText([
        row.serviceMode,
        row.pricingModel,
        row.requiresManagerApproval ? "manager approval" : "",
      ]),
      description: row.description,
      attributes: normalizeSearchText([
        row.depositType,
        row.depositValue == null ? "" : String(row.depositValue),
        row.basePrice == null ? "" : String(row.basePrice),
        row.checkoutReadiness.status,
      ]),
    });
  });

  return {
    rows: [...rows],
    byServiceCatalogId,
    searchableRows: indexedRows,
  };
}

export function searchRegisterServiceCatalog(
  index: RegisterServiceCatalogIndex,
  input: string,
  options: { limit?: number } = {},
): RegisterServiceCatalogSearchResult {
  const query = input.trim();

  if (!query) {
    return {
      intent: "empty",
      query: "",
      results: [],
      exactMatch: null,
      canAutoAdd: false,
    };
  }

  const exactResults =
    index.byServiceCatalogId.get(normalizeIdentifier(query)) ?? [];

  if (exactResults.length > 0) {
    return {
      intent: "exact",
      query,
      results: exactResults,
      exactMatch: exactResults.length === 1 ? exactResults[0] : null,
      canAutoAdd: false,
    };
  }

  return {
    intent: "text",
    query,
    results: searchRegisterServiceCatalogByText(index, query, options.limit),
    exactMatch: null,
    canAutoAdd: false,
  };
}

function findExactMatches(
  index: RegisterCatalogIndex,
  rawValue: string,
): RegisterCatalogSearchRow[] {
  const key = normalizeIdentifier(rawValue);

  if (!key) {
    return [];
  }

  return firstNonEmpty([
    index.byBarcode.get(key),
    index.bySku.get(key),
    index.byProductSkuId.get(key),
    index.byProductId.get(key),
  ]);
}

function parseCatalogSearchInput(input: string): ParsedCatalogSearchInput {
  const trimmed = input.trim();

  if (!trimmed) {
    return { type: "empty", value: "" };
  }

  const urlIdentifier = extractIdentifierFromUrl(trimmed);

  if (urlIdentifier) {
    return { type: "identifier", value: urlIdentifier };
  }

  if (isBarcodeShapedInput(trimmed)) {
    return { type: "identifier", value: trimmed };
  }

  return { type: "text", value: trimmed };
}

function isBarcodeShapedInput(input: string): boolean {
  return /^[\d\s-]+$/.test(input);
}

function extractIdentifierFromUrl(input: string): string | null {
  try {
    const url = new URL(input);
    const barcode = url.searchParams.get("barcode");
    const productSkuId = url.searchParams.get("productSkuId");
    const sku = url.searchParams.get("sku");
    const productId = url.searchParams.get("productId");

    if (barcode) return barcode;
    if (productSkuId) return productSkuId;
    if (sku) return sku;
    if (productId) return productId;

    const productPathMatch = url.pathname.match(
      /\/(?:shop\/)?product\/([^/?#]+)/,
    );

    return productPathMatch?.[1]
      ? decodeURIComponent(productPathMatch[1])
      : null;
  } catch {
    return null;
  }
}

function searchByText(
  index: RegisterCatalogIndex,
  input: string,
  limit = 20,
): RegisterCatalogSearchRow[] {
  const linkedPendingAliasMatches = searchLinkedPendingAliasesByText(
    index.rows,
    input,
    limit,
  );
  const fuzzyMatches = searchFuzzyEntries(index.searchableRows, input, {
    fieldWeights: {
      name: 8,
      sku: 6,
      aliasName: 5,
      aliasLookupCode: 5,
      aliasTrustedName: 8,
      aliasTrustedSku: 6,
      aliasTrustedCategory: 4,
      aliasTrustedDescription: 2,
      category: 4,
      attributes: 3,
      description: 2,
    },
    limit,
  });

  return applyLinkedPendingAliasDisplay(
    dedupeRegisterCatalogRows([
      ...linkedPendingAliasMatches,
      ...fuzzyMatches,
    ]).slice(0, limit),
    input,
  );
}

function applyLinkedPendingAliasDisplay(
  rows: RegisterCatalogSearchRow[],
  input: string,
): RegisterCatalogSearchRow[] {
  return rows.map((row) => {
    const trustedName = row.pendingCheckoutAliasTrustedName?.trim();

    if (row.pendingCheckoutAliasState !== "linked_to_catalog" || !trustedName) {
      return row;
    }

    const trustedIdentityMatches = searchTextIncludesQuery(
      [
        row.pendingCheckoutAliasTrustedName,
        row.pendingCheckoutAliasTrustedSku,
        row.pendingCheckoutAliasTrustedCategory,
        row.pendingCheckoutAliasTrustedDescription,
      ],
      input,
    );
    const aliasIdentityMatches = searchTextIncludesQuery(
      [
        row.pendingCheckoutAliasName,
        row.pendingCheckoutAliasLookupCode,
        row.name,
        row.sku,
        row.barcode,
      ],
      input,
    );

    if (!trustedIdentityMatches || aliasIdentityMatches) {
      return row;
    }

    return {
      ...row,
      name: trustedName,
    };
  });
}

function searchTextIncludesQuery(
  values: Array<string | null | undefined>,
  input: string,
): boolean {
  const normalizedQuery = normalizeSearchText(input);
  const compactQuery = compactSearchText(normalizedQuery);

  if (!normalizedQuery || compactQuery.length < 2) {
    return false;
  }

  return values
    .map((value) => normalizeSearchText(value))
    .some((value) => {
      if (!value) {
        return false;
      }
      return (
        value.includes(normalizedQuery) ||
        compactSearchText(value).includes(compactQuery)
      );
    });
}

function dedupeRegisterCatalogRows(
  rows: RegisterCatalogSearchRow[],
): RegisterCatalogSearchRow[] {
  const seenKeys = new Set<string>();
  const deduped: RegisterCatalogSearchRow[] = [];

  for (const row of rows) {
    const key = registerCatalogRowSearchKey(row);
    if (seenKeys.has(key)) {
      continue;
    }
    seenKeys.add(key);
    deduped.push(row);
  }

  return deduped;
}

function searchLinkedPendingAliasesByText(
  rows: readonly RegisterCatalogSearchRow[],
  input: string,
  limit: number,
): RegisterCatalogSearchRow[] {
  const normalizedQuery = normalizeSearchText(input);
  const compactQuery = compactSearchText(normalizedQuery);

  if (compactQuery.length < 2) {
    return [];
  }

  return rows
    .filter((row) => {
      if (row.pendingCheckoutAliasState !== "linked_to_catalog") {
        return false;
      }

      return [
        row.pendingCheckoutAliasName,
        row.pendingCheckoutAliasLookupCode,
        row.pendingCheckoutAliasTrustedName,
        row.pendingCheckoutAliasTrustedSku,
        row.pendingCheckoutAliasTrustedCategory,
        row.pendingCheckoutAliasTrustedDescription,
        row.name,
        row.sku,
        row.barcode,
      ]
        .map((value) => normalizeSearchText(value))
        .some((value) => {
          if (!value) {
            return false;
          }
          return (
            value.includes(normalizedQuery) ||
            compactSearchText(value).includes(compactQuery)
          );
        });
    })
    .slice(0, limit);
}

function registerCatalogRowSearchKey(row: RegisterCatalogSearchRow) {
  return (
    [
      row.catalogRowKey,
      row.inventoryImportProvisionalSkuId,
      row.pendingCheckoutItemId,
      row.id,
      row.productSkuId,
    ]
      .find((value) => value)
      ?.toString() ?? row.productSkuId
  );
}

function searchRegisterServiceCatalogByText(
  index: RegisterServiceCatalogIndex,
  input: string,
  limit = 20,
): RegisterServiceCatalogSearchRow[] {
  return searchFuzzyEntries(index.searchableRows, input, {
    fieldWeights: {
      name: 8,
      category: 4,
      attributes: 3,
      description: 2,
    },
    limit,
  });
}

function normalizeIdentifier(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

function normalizeSearchText(value: unknown): string {
  const raw = Array.isArray(value) ? value.join(" ") : String(value ?? "");

  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function compactSearchText(value: string) {
  return normalizeSearchText(value).replace(/\s+/g, "");
}

function addKey<T>(map: Map<string, T[]>, key: string, row: T): void {
  if (!key) {
    return;
  }

  const current = map.get(key);

  if (current) {
    current.push(row);
  } else {
    map.set(key, [row]);
  }
}

function firstNonEmpty<T>(values: Array<T[] | undefined>): T[] {
  return values.find((value) => value && value.length > 0) ?? [];
}
