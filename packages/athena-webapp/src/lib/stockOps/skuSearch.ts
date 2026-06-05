import {
  createFuzzySearchEntry,
  scoreFuzzySearchEntry,
  tokenizeFuzzySearchText,
} from "@/lib/search/fuzzySearch";

export function normalizeSkuSearchQuery(value?: string | null) {
  return value?.trim() ?? "";
}

export function matchesSkuSearchTerms(
  terms: Array<string | number | null | undefined>,
  query: string,
) {
  return scoreSkuSearchTerms(terms, query) > 0;
}

export function scoreSkuSearchTerms(
  terms: Array<string | number | null | undefined>,
  query: string,
) {
  if (!query) return 1;

  if (isBarcodeShapedSearchQuery(query)) {
    const normalizedQuery = normalizeIdentifier(query);

    return terms.some((term) => normalizeIdentifier(term) === normalizedQuery)
      ? 100
      : 0;
  }

  const searchableText = terms
    .filter(
      (term): term is string | number => term !== null && term !== undefined,
    )
    .join(" ");
  const queryTokens = [...tokenizeFuzzySearchText([query])];

  if (!searchableText || queryTokens.length === 0) return 0;

  const fuzzyScore = scoreFuzzySearchEntry(
    createFuzzySearchEntry(searchableText, { searchableText }),
    queryTokens,
  );

  return fuzzyScore;
}

function isBarcodeShapedSearchQuery(input: string): boolean {
  return /^[\d\s-]+$/.test(input);
}

function normalizeIdentifier(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}
