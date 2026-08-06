// Pure parsing helpers for the in-app docs section. These run in Node inside
// the docs-index Vite plugin and stay browser-safe so tests can exercise them
// without a filesystem.

export type SolutionDocMeta = {
  /** Filename without the .md extension; unique within a category. */
  slug: string;
  /** Directory name under docs/solutions/. */
  category: string;
  fileName: string;
  title: string;
  /** ISO date (YYYY-MM-DD) when present in frontmatter. */
  date: string | null;
  severity: string | null;
  module: string | null;
  tags: string[];
};

export type DeliveryReportMeta = {
  /** Filename without the .html extension, e.g. 2026-07-09-landed-change-report-gate. */
  slug: string;
  fileName: string;
  title: string;
  /** ISO date parsed from the filename prefix. */
  date: string | null;
};

export type DocsIndex = {
  solutions: SolutionDocMeta[];
  reports: DeliveryReportMeta[];
};

const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

function unquote(value: string): string {
  const trimmed = value.trim();
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseInlineList(value: string): string[] {
  return value
    .slice(1, -1)
    .split(",")
    .map((item) => unquote(item))
    .filter((item) => item.length > 0);
}

/**
 * Parses the YAML subset the solution docs actually use: top-level scalar
 * `key: value` pairs, inline `[a, b]` lists, and block lists of `- item`
 * lines. Nested mappings are ignored rather than parsed.
 */
export function parseSolutionFrontmatter(raw: string): Record<string, string | string[]> {
  const match = FRONTMATTER_PATTERN.exec(raw);
  if (!match) return {};

  const result: Record<string, string | string[]> = {};
  let activeListKey: string | null = null;

  for (const line of match[1].split(/\r?\n/)) {
    if (/^\s*#/.test(line) || line.trim().length === 0) continue;

    const listItem = /^\s+-\s+(.*)$/.exec(line);
    if (listItem && activeListKey) {
      (result[activeListKey] as string[]).push(unquote(listItem[1]));
      continue;
    }

    // Indented lines that are not list items belong to nested structures we
    // deliberately skip for the index.
    if (/^\s/.test(line)) {
      activeListKey = null;
      continue;
    }

    const colonIndex = line.indexOf(":");
    if (colonIndex === -1) {
      activeListKey = null;
      continue;
    }

    const key = line.slice(0, colonIndex).trim();
    const value = line.slice(colonIndex + 1).trim();

    if (value.length === 0) {
      result[key] = [];
      activeListKey = key;
    } else if (value.startsWith("[") && value.endsWith("]")) {
      result[key] = parseInlineList(value);
      activeListKey = null;
    } else {
      result[key] = unquote(value);
      activeListKey = null;
    }
  }

  return result;
}

/** Removes the frontmatter block so the markdown body renders cleanly. */
export function stripFrontmatter(raw: string): string {
  return raw.replace(FRONTMATTER_PATTERN, "").replace(/^\s*\n/, "");
}

function firstHeading(raw: string): string | null {
  const match = /^#\s+(.+)$/m.exec(stripFrontmatter(raw));
  return match ? match[1].trim() : null;
}

function titleCaseFromSlug(slug: string): string {
  return slug
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function solutionDocMetaFromFile(
  category: string,
  fileName: string,
  raw: string,
): SolutionDocMeta {
  const frontmatter = parseSolutionFrontmatter(raw);
  const slug = fileName.replace(/\.md$/, "");
  const scalar = (key: string): string | null => {
    const value = frontmatter[key];
    return typeof value === "string" && value.length > 0 ? value : null;
  };
  const tags = Array.isArray(frontmatter.tags) ? frontmatter.tags : [];

  return {
    slug,
    category,
    fileName,
    title: scalar("title") ?? firstHeading(raw) ?? titleCaseFromSlug(slug),
    date: scalar("date"),
    severity: scalar("severity"),
    module: scalar("module"),
    tags,
  };
}

const REPORT_DATE_PATTERN = /^(\d{4}-\d{2}-\d{2})-/;

export function deliveryReportMetaFromFile(
  fileName: string,
  html: string,
): DeliveryReportMeta {
  const slug = fileName.replace(/\.html$/, "");
  const dateMatch = REPORT_DATE_PATTERN.exec(slug);
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const title = titleMatch
    ? titleMatch[1].replace(/\s+/g, " ").trim()
    : titleCaseFromSlug(slug.replace(REPORT_DATE_PATTERN, ""));

  return {
    slug,
    fileName,
    title,
    date: dateMatch ? dateMatch[1] : null,
  };
}

export type SolutionDocRef = {
  category: string;
  slug: string;
};

/**
 * Resolves a markdown link target against the directory holding the doc that
 * contains it (`docs/solutions/<fromCategory>/`).
 *
 * Returns a route ref only when the target lands on a markdown file sitting
 * directly inside a solutions category, which is the only shape the docs
 * routes can address. Anything else — an external URL, an in-page anchor, or
 * a path that climbs out of `docs/solutions/` — returns null so the caller can
 * decide how to render it. Resolution is deliberately strict: a target that
 * escapes the solutions root is a broken reference in the source doc, and
 * silently clamping it would hide that.
 */
export function resolveSolutionDocLink(
  href: string,
  fromCategory: string,
): SolutionDocRef | null {
  const trimmed = href.trim();
  if (trimmed.length === 0) return null;
  // Scheme-qualified (http:, mailto:, …), protocol-relative, in-page anchor,
  // or site-absolute targets are never category-relative doc references.
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return null;
  if (
    trimmed.startsWith("#") ||
    trimmed.startsWith("//") ||
    trimmed.startsWith("/")
  ) {
    return null;
  }

  const [pathPart] = trimmed.split(/[?#]/);
  if (!pathPart.endsWith(".md")) return null;

  // Walk the relative path from the containing category directory.
  const segments: string[] = [fromCategory];
  for (const segment of pathPart.split("/")) {
    if (segment.length === 0 || segment === ".") continue;
    if (segment === "..") {
      if (segments.length === 0) return null;
      segments.pop();
      continue;
    }
    segments.push(segment);
  }

  // Exactly <category>/<file>.md is addressable; anything deeper or shallower
  // is outside the routable shape.
  if (segments.length !== 2) return null;
  const [category, fileName] = segments;
  if (category.length === 0 || fileName === ".md") return null;

  return { category, slug: fileName.slice(0, -".md".length) };
}

/** Newest first; entries without a date sink to the end alphabetically. */
export function compareByDateDesc(
  a: { date: string | null; slug: string },
  b: { date: string | null; slug: string },
): number {
  if (a.date && b.date && a.date !== b.date) return a.date < b.date ? 1 : -1;
  if (a.date && !b.date) return -1;
  if (!a.date && b.date) return 1;
  return a.slug.localeCompare(b.slug);
}
