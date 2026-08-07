// Joins a solution note to the landed-change report it shipped with.
//
// Both artifacts are stamped with the same value: `delivery_diff_fingerprint`
// in a solution note's frontmatter and `data-athena-report-diff-fingerprint`
// on a contract-v2 report's root element. Both come from
// scripts/delivery-diff-fingerprint.ts, which hashes the deliverable source
// diff and deliberately excludes docs/solutions and docs/reports — so the note
// and the report generated on the same branch carry the same fingerprint.
//
// The join is exact-match only. A note whose fingerprint is missing or stale
// (regenerated on one side but not the other) simply shows no companion rather
// than guessing from dates or slugs, which would sooner or later link a reader
// to the wrong delivery.

import type { DeliveryReportMeta, SolutionDocMeta } from "./parsing";

function fingerprintOf(entry: {
  deliveryFingerprint: string | null;
}): string | null {
  const value = entry.deliveryFingerprint?.trim();
  return value ? value : null;
}

/**
 * Reports generated from the same deliverable diff as `doc`. Normally one; a
 * delivery that produced two reports off one diff yields both.
 */
export function reportsDeliveredWithSolutionDoc(
  doc: Pick<SolutionDocMeta, "deliveryFingerprint">,
  reports: readonly DeliveryReportMeta[],
): DeliveryReportMeta[] {
  const fingerprint = fingerprintOf(doc);
  if (!fingerprint) return [];
  return reports.filter((report) => fingerprintOf(report) === fingerprint);
}

/**
 * Solution notes written for the same deliverable diff as `report`. A single
 * delivery routinely produces several notes across categories.
 */
export function solutionDocsDeliveredWithReport(
  report: Pick<DeliveryReportMeta, "deliveryFingerprint">,
  solutions: readonly SolutionDocMeta[],
): SolutionDocMeta[] {
  const fingerprint = fingerprintOf(report);
  if (!fingerprint) return [];
  return solutions.filter((doc) => fingerprintOf(doc) === fingerprint);
}
