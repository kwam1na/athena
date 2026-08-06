// Location parsing for the docs section. Kept free of React and of the docs
// index so the route shapes can be tested directly.

export type DocsTarget =
  | { kind: "overview" }
  | { kind: "solutions"; category: string | null }
  | { kind: "reports" }
  | { kind: "solutionDoc"; category: string; slug: string }
  | { kind: "report"; slug: string };

const DOCS_ROOT = "/docs";

/**
 * Normalizes an optional string search param. An absent, blank, or non-string
 * value collapses to undefined so the param drops out of the URL entirely
 * rather than lingering as `?q=`.
 */
export function optionalSearchString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/**
 * Maps a docs pathname (plus the `category` search param, which only the
 * solutions list uses) onto the route it addresses. Returns null for anything
 * outside the docs section or for a shape no docs route serves, so callers can
 * skip it rather than record a destination they cannot link to.
 */
export function parseDocsLocation(
  pathname: string,
  categorySearch?: string | null,
): DocsTarget | null {
  const normalized = pathname.replace(/\/+$/, "");
  if (normalized === DOCS_ROOT) return { kind: "overview" };
  if (!normalized.startsWith(`${DOCS_ROOT}/`)) return null;

  const segments = normalized
    .slice(DOCS_ROOT.length + 1)
    .split("/")
    .map(decodeSegment);

  if (segments[0] === "solutions") {
    if (segments.length === 1) {
      return { kind: "solutions", category: categorySearch || null };
    }
    if (segments.length === 3 && segments[1] && segments[2]) {
      return { kind: "solutionDoc", category: segments[1], slug: segments[2] };
    }
    return null;
  }

  if (segments[0] === "reports") {
    if (segments.length === 1) return { kind: "reports" };
    if (segments.length === 2 && segments[1]) {
      return { kind: "report", slug: segments[1] };
    }
    return null;
  }

  return null;
}
