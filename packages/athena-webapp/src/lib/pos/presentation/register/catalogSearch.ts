export interface RegisterCatalogSearchRow {
  productId: string;
  productSkuId: string;
  name: string;
  sku?: string | null;
  barcode?: string | null;
  category?: string | null;
  description?: string | null;
  quantityAvailable?: number | null;
  price?: number | null;
  size?: string | null;
  length?: number | string | null;
  color?: string | null;
  image?: string | null;
  areProcessingFeesAbsorbed?: boolean | null;
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
  searchableRows: Array<{
    row: RegisterCatalogSearchRow;
    tokens: Set<string>;
    normalizedFields: {
      name: string;
      sku: string;
      barcode: string;
      category: string;
      description: string;
      attributes: string;
    };
  }>;
}

type ParsedCatalogSearchInput =
  | { type: "empty"; value: "" }
  | { type: "identifier"; value: string }
  | { type: "text"; value: string };

export function buildRegisterCatalogIndex(
  rows: readonly RegisterCatalogSearchRow[],
): RegisterCatalogIndex {
  const byBarcode = new Map<string, RegisterCatalogSearchRow[]>();
  const bySku = new Map<string, RegisterCatalogSearchRow[]>();
  const byProductSkuId = new Map<string, RegisterCatalogSearchRow[]>();
  const byProductId = new Map<string, RegisterCatalogSearchRow[]>();

  const indexedRows = rows.map((row) => {
    addKey(byBarcode, normalizeIdentifier(row.barcode), row);
    addKey(bySku, normalizeIdentifier(row.sku), row);
    addKey(byProductSkuId, normalizeIdentifier(row.productSkuId), row);
    addKey(byProductId, normalizeIdentifier(row.productId), row);

    const normalizedFields = {
      name: normalizeSearchText(row.name),
      sku: normalizeSearchText(row.sku),
      barcode: normalizeSearchText(row.barcode),
      category: normalizeSearchText(row.category),
      description: normalizeSearchText(row.description),
      attributes: normalizeSearchText([
        row.size,
        row.length == null ? "" : String(row.length),
        row.color,
      ]),
    };

    return {
      row,
      tokens: tokenizeSearchText(Object.values(normalizedFields)),
      normalizedFields,
    };
  });

  return {
    rows: [...rows],
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
    const exactMatch = exactResults.length === 1 ? exactResults[0] : null;

    return {
      intent: "exact",
      query,
      results: exactResults,
      exactMatch,
      canAutoAdd: !!exactMatch && isRowAvailable(exactMatch),
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

  return { type: "text", value: trimmed };
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

    const productPathMatch = url.pathname.match(/\/(?:shop\/)?product\/([^/?#]+)/);

    return productPathMatch?.[1] ? decodeURIComponent(productPathMatch[1]) : null;
  } catch {
    return null;
  }
}

function searchByText(
  index: RegisterCatalogIndex,
  input: string,
  limit = 20,
): RegisterCatalogSearchRow[] {
  const queryTokens = [...tokenizeSearchText([input])];

  if (queryTokens.length === 0) {
    return [];
  }

  return index.searchableRows
    .map((entry, position) => ({
      row: entry.row,
      position,
      score: scoreSearchRow(entry, queryTokens),
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return left.position - right.position;
    })
    .slice(0, limit)
    .map((entry) => entry.row);
}

function scoreSearchRow(
  entry: RegisterCatalogIndex["searchableRows"][number],
  queryTokens: string[],
): number {
  let score = 0;

  for (const token of queryTokens) {
    const tokenScore = scoreQueryTokenForEntry(entry, token);

    if (tokenScore === 0) {
      continue;
    }

    score += tokenScore;
  }

  return score;
}

function scoreQueryTokenForEntry(
  entry: RegisterCatalogIndex["searchableRows"][number],
  token: string,
): number {
  if (entry.tokens.has(token)) {
    return (
      1 +
      scoreFieldContains(entry.normalizedFields.name, token, 8) +
      scoreFieldContains(entry.normalizedFields.sku, token, 6) +
      scoreFieldContains(entry.normalizedFields.barcode, token, 6) +
      scoreFieldContains(entry.normalizedFields.category, token, 4) +
      scoreFieldContains(entry.normalizedFields.attributes, token, 3) +
      scoreFieldContains(entry.normalizedFields.description, token, 2)
    );
  }

  return bestFuzzyTokenScore(entry.tokens, token);
}

function scoreFieldContains(field: string, token: string, score: number): number {
  return field.includes(token) ? score : 0;
}

function bestFuzzyTokenScore(tokens: Set<string>, queryToken: string): number {
  if (queryToken.length < 3) {
    return 0;
  }

  let bestScore = 0;

  for (const candidateToken of tokens) {
    bestScore = Math.max(
      bestScore,
      scoreFuzzyTokenMatch(candidateToken, queryToken),
    );
  }

  return bestScore;
}

function scoreFuzzyTokenMatch(candidateToken: string, queryToken: string): number {
  if (candidateToken.length < 3) {
    return 0;
  }

  if (
    candidateToken.includes(queryToken) ||
    queryToken.includes(candidateToken)
  ) {
    return 5;
  }

  if (!isProbablySameToken(candidateToken, queryToken)) {
    return 0;
  }

  const distance = levenshteinDistance(candidateToken, queryToken);
  const maxLength = Math.max(candidateToken.length, queryToken.length);
  const similarity = 1 - distance / maxLength;

  if (similarity >= 0.78) {
    return 4;
  }

  if (similarity >= 0.68) {
    return 2;
  }

  return 0;
}

function isProbablySameToken(candidateToken: string, queryToken: string): boolean {
  return (
    candidateToken[0] === queryToken[0] ||
    candidateToken.includes(queryToken.slice(0, 2)) ||
    queryToken.includes(candidateToken.slice(0, 2))
  );
}

function levenshteinDistance(left: string, right: string): number {
  if (left === right) {
    return 0;
  }

  if (left.length === 0) {
    return right.length;
  }

  if (right.length === 0) {
    return left.length;
  }

  let previousRow = Array.from({ length: right.length + 1 }, (_, index) => index);

  for (let leftIndex = 0; leftIndex < left.length; leftIndex += 1) {
    const currentRow = [leftIndex + 1];

    for (let rightIndex = 0; rightIndex < right.length; rightIndex += 1) {
      const insertionCost = currentRow[rightIndex] + 1;
      const deletionCost = previousRow[rightIndex + 1] + 1;
      const substitutionCost =
        previousRow[rightIndex] + (left[leftIndex] === right[rightIndex] ? 0 : 1);

      currentRow.push(
        Math.min(insertionCost, deletionCost, substitutionCost),
      );
    }

    previousRow = currentRow;
  }

  return previousRow[right.length];
}

function normalizeIdentifier(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function normalizeSearchText(value: unknown): string {
  const raw = Array.isArray(value) ? value.join(" ") : String(value ?? "");

  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function tokenizeSearchText(values: unknown[]): Set<string> {
  const tokens = new Set<string>();

  for (const value of values) {
    for (const token of normalizeSearchText(value).split(" ")) {
      if (token) {
        tokens.add(token);
      }
    }
  }

  return tokens;
}

function isRowAvailable(row: RegisterCatalogSearchRow): boolean {
  return (row.quantityAvailable ?? 0) > 0;
}

function addKey(
  map: Map<string, RegisterCatalogSearchRow[]>,
  key: string,
  row: RegisterCatalogSearchRow,
): void {
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
