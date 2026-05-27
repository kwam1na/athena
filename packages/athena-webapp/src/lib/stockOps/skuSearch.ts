import {
  createFuzzySearchEntry,
  searchFuzzyEntries,
} from "@/lib/search/fuzzySearch";

export function normalizeSkuSearchQuery(value?: string | null) {
  return value?.trim() ?? "";
}

export function matchesSkuSearchTerms(
  terms: Array<string | number | null | undefined>,
  query: string,
) {
  if (!query) return true;

  if (isBarcodeShapedSearchQuery(query)) {
    const normalizedQuery = normalizeIdentifier(query);

    return terms.some((term) => normalizeIdentifier(term) === normalizedQuery);
  }

  const searchableText = terms
    .filter(
      (term): term is string | number => term !== null && term !== undefined,
    )
    .join(" ");

  return (
    searchFuzzyEntries(
      [createFuzzySearchEntry(searchableText, { searchableText })],
      query,
      { limit: 1 },
    ).length > 0
  );
}

function isBarcodeShapedSearchQuery(input: string): boolean {
  return /^[\d\s-]+$/.test(input);
}

function normalizeIdentifier(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}
