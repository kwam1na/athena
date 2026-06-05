export type FuzzySearchFieldWeights = Record<string, number>;

export interface FuzzySearchEntry<TItem> {
  item: TItem;
  tokens: Set<string>;
  normalizedFields: Record<string, string>;
}

export function createFuzzySearchEntry<TItem>(
  item: TItem,
  fields: Record<string, unknown>,
): FuzzySearchEntry<TItem> {
  const normalizedFields = Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [
      key,
      normalizeFuzzySearchText(value),
    ]),
  );

  return {
    item,
    tokens: tokenizeFuzzySearchText(Object.values(normalizedFields)),
    normalizedFields,
  };
}

export function searchFuzzyEntries<TItem>(
  entries: Array<FuzzySearchEntry<TItem>>,
  input: string,
  options: {
    fieldWeights?: FuzzySearchFieldWeights;
    limit?: number;
  } = {},
): TItem[] {
  const queryTokens = [...tokenizeFuzzySearchText([input])];

  if (queryTokens.length === 0) {
    return [];
  }

  return entries
    .map((entry, position) => ({
      item: entry.item,
      position,
      score: scoreFuzzySearchEntry(entry, queryTokens, options.fieldWeights),
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return left.position - right.position;
    })
    .slice(0, options.limit)
    .map((entry) => entry.item);
}

export function scoreFuzzySearchEntry<TItem>(
  entry: FuzzySearchEntry<TItem>,
  queryTokens: string[],
  fieldWeights: FuzzySearchFieldWeights = {},
): number {
  let score = 0;

  for (const token of queryTokens) {
    const tokenScore = scoreQueryTokenForEntry(entry, token, fieldWeights);

    if (tokenScore === 0) {
      return 0;
    }

    score += tokenScore;
  }

  return score;
}

export function normalizeFuzzySearchText(value: unknown): string {
  const raw = Array.isArray(value) ? value.join(" ") : String(value ?? "");

  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function tokenizeFuzzySearchText(values: unknown[]): Set<string> {
  const tokens = new Set<string>();

  for (const value of values) {
    for (const token of normalizeFuzzySearchText(value).split(" ")) {
      if (token) {
        tokens.add(token);
      }
    }
  }

  return tokens;
}

function scoreQueryTokenForEntry<TItem>(
  entry: FuzzySearchEntry<TItem>,
  token: string,
  fieldWeights: FuzzySearchFieldWeights,
): number {
  const compactFieldScore = scoreCompactFieldContains(
    entry.normalizedFields,
    token,
    fieldWeights,
  );

  if (entry.tokens.has(token)) {
    return (
      1 +
      Object.entries(fieldWeights).reduce((score, [field, weight]) => {
        return (
          score +
          scoreFieldContains(entry.normalizedFields[field] ?? "", token, weight)
        );
      }, 0) +
      compactFieldScore
    );
  }

  return Math.max(bestFuzzyTokenScore(entry.tokens, token), compactFieldScore);
}

function scoreFieldContains(field: string, token: string, score: number): number {
  return field.includes(token) ? score : 0;
}

function scoreCompactFieldContains(
  normalizedFields: Record<string, string>,
  token: string,
  fieldWeights: FuzzySearchFieldWeights,
): number {
  const compactToken = compactSearchText(token);

  if (compactToken.length < 3) return 0;

  let bestScore = 0;

  for (const [field, value] of Object.entries(normalizedFields)) {
    const compactField = compactSearchText(value);

    if (!compactField) continue;

    const fieldWeight = fieldWeights[field] ?? 1;

    if (compactField === compactToken) {
      bestScore = Math.max(bestScore, 40 + fieldWeight * 10);
    } else if (compactField.includes(compactToken)) {
      bestScore = Math.max(bestScore, 24 + fieldWeight * 8);
    } else if (
      compactToken.includes(compactField) &&
      compactField.length >= Math.max(3, compactToken.length - 2)
    ) {
      bestScore = Math.max(bestScore, 16 + fieldWeight * 6);
    }
  }

  return bestScore;
}

function compactSearchText(value: string) {
  return normalizeFuzzySearchText(value).replace(/\s+/g, "");
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
