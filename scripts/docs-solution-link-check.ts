import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import path from "node:path";

// Cross-reference sensor for docs/solutions/**/*.md — the "Related" sections
// and any inline .md reference.
//
// Addressability is decided by the viewer's own resolver, imported rather than
// reimplemented: a second copy of that logic would drift, and the whole point
// of this sensor is to agree with what a reader gets. resolveSolutionDocLink is
// pure and browser-safe by design (it also runs inside the docs-index Vite
// plugin), so importing it here costs nothing.
import { resolveSolutionDocLink } from "../packages/athena-webapp/src/lib/docs/parsing";

export type DocsLinkFinding = {
  docPath: string;
  line: number;
  message: string;
};

/** A link's fate once the docs viewer renders it. */
export type LinkVerdict =
  | "routed" // becomes an in-app Link to a doc that exists
  | "broken" // routable shape, but no such doc — would dead-end
  | "dangling" // not routable and not a real file either
  | "plain-text" // not routable, but names a real repo file outside docs/solutions
  | "external"
  | "anchor";

const MARKDOWN_LINK_PATTERN = /\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

export function solutionsRoot(rootDir: string) {
  return path.join(rootDir, "docs", "solutions");
}

/** Every `<category>/<slug>` the docs routes can serve. */
export function collectSolutionSlugs(rootDir: string): Set<string> {
  const root = solutionsRoot(rootDir);
  const slugs = new Set<string>();
  for (const category of readdirSync(root)) {
    if (!statSync(path.join(root, category)).isDirectory()) continue;
    for (const file of readdirSync(path.join(root, category))) {
      if (!file.endsWith(".md")) continue;
      slugs.add(`${category}/${file.replace(/\.md$/, "")}`);
    }
  }
  return slugs;
}

export function classifyLink({
  href,
  category,
  rootDir,
  knownSlugs,
}: {
  href: string;
  category: string;
  rootDir: string;
  knownSlugs: Set<string>;
}): { verdict: LinkVerdict; target: string } {
  const trimmed = href.trim();
  if (/^https?:\/\//i.test(trimmed)) return { verdict: "external", target: trimmed };
  if (trimmed.startsWith("#")) return { verdict: "anchor", target: trimmed };

  const routed = resolveSolutionDocLink(trimmed, category);
  if (routed) {
    const target = `${routed.category}/${routed.slug}`;
    return {
      verdict: knownSlugs.has(target) ? "routed" : "broken",
      target,
    };
  }

  // Not addressable by the docs routes. The viewer degrades these to plain
  // text, which is fine for an honest pointer at a file outside
  // docs/solutions/ — but a path that names nothing is a typo either way, and
  // the plain-text fallback is exactly what hides it from a reader.
  const [pathPart] = trimmed.split(/[?#]/);
  const absolute = path.resolve(solutionsRoot(rootDir), category, pathPart);
  return {
    verdict: existsSync(absolute) ? "plain-text" : "dangling",
    target: path.relative(rootDir, absolute),
  };
}

export function collectDocsLinkFindings(rootDir: string): {
  findings: DocsLinkFinding[];
  counts: Record<LinkVerdict, number>;
  docCount: number;
} {
  const knownSlugs = collectSolutionSlugs(rootDir);
  const findings: DocsLinkFinding[] = [];
  const counts: Record<LinkVerdict, number> = {
    routed: 0,
    broken: 0,
    dangling: 0,
    "plain-text": 0,
    external: 0,
    anchor: 0,
  };
  let docCount = 0;

  const root = solutionsRoot(rootDir);
  for (const category of readdirSync(root).sort()) {
    if (!statSync(path.join(root, category)).isDirectory()) continue;
    for (const file of readdirSync(path.join(root, category)).sort()) {
      if (!file.endsWith(".md")) continue;
      docCount += 1;
      const docPath = path.join("docs", "solutions", category, file);
      const raw = readFileSync(path.join(root, category, file), "utf8");

      raw.split(/\r?\n/).forEach((text, index) => {
        for (const match of text.matchAll(MARKDOWN_LINK_PATTERN)) {
          const href = match[2];
          // Image and non-doc targets are not this sensor's business.
          if (!href.includes(".md") && !href.startsWith("#") && !/^https?:/i.test(href)) {
            continue;
          }
          const { verdict, target } = classifyLink({
            href,
            category,
            rootDir,
            knownSlugs,
          });
          counts[verdict] += 1;

          if (verdict === "broken") {
            findings.push({
              docPath,
              line: index + 1,
              message: `[${match[1]}](${href}) resolves to ${target}, which does not exist — the reader gets plain text instead of a link`,
            });
          }
          if (verdict === "dangling") {
            findings.push({
              docPath,
              line: index + 1,
              message: `[${match[1]}](${href}) points at ${target}, which is not a file in this repo`,
            });
          }
        }
      });
    }
  }

  return { findings, counts, docCount };
}

export function assertDocsLinks(rootDir: string) {
  const { findings, counts, docCount } = collectDocsLinkFindings(rootDir);

  if (findings.length > 0) {
    const grouped = new Map<string, string[]>();
    for (const finding of findings) {
      const existing = grouped.get(finding.docPath) ?? [];
      existing.push(`line ${finding.line}: ${finding.message}`);
      grouped.set(finding.docPath, existing);
    }
    const detail = [...grouped.entries()]
      .map(
        ([docPath, messages]) =>
          `${docPath}\n${messages.map((message) => `  - ${message}`).join("\n")}`,
      )
      .join("\n");
    throw new Error(
      `Docs cross-reference check failed for ${grouped.size} of ${docCount} solution docs:\n${detail}\n\nA reference is addressable only as <category>/<file>.md inside docs/solutions/. Check the category and the number of ../ segments.`,
    );
  }

  return { docCount, counts };
}

if (import.meta.main) {
  try {
    const rootDir = path.resolve(import.meta.dirname, "..");
    const { docCount, counts } = assertDocsLinks(rootDir);
    console.log(
      `Docs cross-reference check passed for ${docCount} solution doc(s): ` +
        `${counts.routed} in-app links, ${counts["plain-text"]} references outside docs/solutions, ` +
        `${counts.external} external, ${counts.anchor} in-page.`,
    );
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
