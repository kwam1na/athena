// Browser-side access to the docs corpus. Metadata comes from the
// virtual:athena-docs-index module (built by vite-docs-content-plugin.ts);
// bodies lazy-load per document so the corpus never lands in the main bundle.

import { docsIndex } from "virtual:athena-docs-index";

import {
  compareByDateDesc,
  type DeliveryReportMeta,
  type DocsIndex,
  type SolutionDocMeta,
} from "./parsing";

export { stripFrontmatter } from "./parsing";
export type { DeliveryReportMeta, SolutionDocMeta };

const index: DocsIndex = docsIndex;

const solutionBodies = import.meta.glob<string>(
  "../../../../../docs/solutions/*/*.md",
  { query: "?raw", import: "default" },
);

const reportBodies = import.meta.glob<string>(
  "../../../../../docs/reports/*.html",
  { query: "?raw", import: "default" },
);

export function listSolutionDocs(): SolutionDocMeta[] {
  return index.solutions;
}

export function listDeliveryReports(): DeliveryReportMeta[] {
  return index.reports;
}

export function listSolutionCategories(): { category: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const doc of index.solutions) {
    counts.set(doc.category, (counts.get(doc.category) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => a.category.localeCompare(b.category));
}

export function findSolutionDoc(
  category: string,
  slug: string,
): SolutionDocMeta | undefined {
  return index.solutions.find(
    (doc) => doc.category === category && doc.slug === slug,
  );
}

export function findDeliveryReport(slug: string): DeliveryReportMeta | undefined {
  return index.reports.find((report) => report.slug === slug);
}

export async function loadSolutionDocBody(doc: SolutionDocMeta): Promise<string> {
  const key = `../../../../../docs/solutions/${doc.category}/${doc.fileName}`;
  const loader = solutionBodies[key];
  if (!loader) {
    throw new Error(`Solution doc body not found for ${doc.category}/${doc.fileName}`);
  }
  return loader();
}

export async function loadDeliveryReportHtml(
  report: DeliveryReportMeta,
): Promise<string> {
  const key = `../../../../../docs/reports/${report.fileName}`;
  const loader = reportBodies[key];
  if (!loader) {
    throw new Error(`Delivery report body not found for ${report.fileName}`);
  }
  return loader();
}

export { compareByDateDesc };
