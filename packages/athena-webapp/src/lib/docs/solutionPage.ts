import { canAccessSolutionCategory } from "./access";
import {
  findSolutionDoc,
  loadSolutionDocBody,
  stripFrontmatter,
  type SolutionDocMeta,
} from "./content";

export type SolutionDocPageData = {
  doc: SolutionDocMeta | null;
  body: string | null;
  requiresAuthentication: boolean;
};

export async function loadSolutionDocPageData({
  category,
  slug,
}: {
  category: string;
  slug: string;
}): Promise<SolutionDocPageData> {
  const doc = findSolutionDoc(category, slug);
  if (!doc) {
    return { doc: null, body: null, requiresAuthentication: false };
  }
  const requiresAuthentication = !canAccessSolutionCategory(
    doc.category,
    false,
  );
  if (requiresAuthentication) {
    return { doc, body: null, requiresAuthentication };
  }
  const raw = await loadSolutionDocBody(doc);
  return {
    doc,
    body: stripSolutionDocHeading(raw),
    requiresAuthentication,
  };
}

export function stripSolutionDocHeading(raw: string): string {
  // The page header already shows the title, so drop a leading H1 that
  // repeats it.
  return stripFrontmatter(raw).replace(/^\s*#\s[^\n]+\n+/, "");
}
