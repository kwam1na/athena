import { describe, expect, it } from "vitest";

import {
  findDeliveryReport,
  findSolutionDoc,
  listDeliveryReports,
  listSolutionCategories,
  listSolutionDocs,
  loadDeliveryReportHtml,
  loadSolutionDocBody,
} from "./content";
import { resolveSolutionDocLink } from "./parsing";
import { parseReportDocument } from "./reportContract";

describe("docs content index", () => {
  it("indexes the solution docs corpus with usable metadata", () => {
    const docs = listSolutionDocs();
    expect(docs.length).toBeGreaterThan(100);
    for (const doc of docs) {
      expect(doc.title.length).toBeGreaterThan(0);
      expect(doc.category.length).toBeGreaterThan(0);
      expect(doc.slug.length).toBeGreaterThan(0);
    }
  });

  it("indexes the delivery reports corpus newest first", () => {
    const reports = listDeliveryReports();
    expect(reports.length).toBeGreaterThan(10);
    const dates = reports
      .map((report) => report.date)
      .filter((date): date is string => date !== null);
    expect([...dates].sort().reverse()).toEqual(dates);
  });

  it("groups solution docs into categories that cover the corpus", () => {
    const categories = listSolutionCategories();
    const total = categories.reduce((sum, entry) => sum + entry.count, 0);
    expect(total).toBe(listSolutionDocs().length);
  });

  // The index (virtual module) and the body loaders (import.meta.glob) are
  // built independently; every indexed entry must resolve to a loadable body.
  it("resolves a lazy body for every indexed solution doc", async () => {
    for (const doc of listSolutionDocs()) {
      const body = await loadSolutionDocBody(doc);
      expect(body.length).toBeGreaterThan(0);
    }
  });

  it("resolves a lazy html body for every indexed delivery report", async () => {
    for (const report of listDeliveryReports()) {
      const html = await loadDeliveryReportHtml(report);
      expect(html.length).toBeGreaterThan(0);
    }
  });

  // A resolved ref that the index cannot serve would dead-end on the
  // not-found page, so the renderer checks the index before emitting a Link
  // and degrades the rest to plain text. Two source docs currently need that
  // fallback: both cite athena-open-work-resolution-ownership-2026-07-02 under
  // `architecture`, but it lives under `architecture-patterns`. Pinning them
  // means a NEW broken reference fails here instead of quietly joining them.
  const KNOWN_MISCATEGORIZED_REFERENCES = [
    "architecture-patterns/athena-operations-review-and-cash-closeout-continuity-2026-07-11 -> ../architecture/athena-open-work-resolution-ownership-2026-07-02.md",
    "architecture/athena-pos-sync-projection-policy-boundary-2026-07-06 -> ./athena-open-work-resolution-ownership-2026-07-02.md",
  ];

  it("resolves every cross-reference to a servable doc, bar the known miscategorized pair", async () => {
    const unserviceable: string[] = [];

    for (const doc of listSolutionDocs()) {
      const body = await loadSolutionDocBody(doc);
      for (const match of body.matchAll(/\]\(([^)\s]+\.md)\)/g)) {
        const target = resolveSolutionDocLink(match[1], doc.category);
        if (!target) continue;
        if (!findSolutionDoc(target.category, target.slug)) {
          unserviceable.push(`${doc.category}/${doc.slug} -> ${match[1]}`);
        }
      }
    }

    expect(unserviceable.sort()).toEqual(
      [...KNOWN_MISCATEGORIZED_REFERENCES].sort(),
    );
  });

  it("resolves the bulk of the corpus cross-references to real docs", async () => {
    let resolved = 0;
    for (const doc of listSolutionDocs()) {
      const body = await loadSolutionDocBody(doc);
      for (const match of body.matchAll(/\]\(([^)\s]+\.md)\)/g)) {
        if (resolveSolutionDocLink(match[1], doc.category)) resolved += 1;
      }
    }
    // Guards against a resolver regression that quietly turns every
    // cross-reference into unlinked text.
    expect(resolved).toBeGreaterThan(150);
  });

  // The reports page renders contract-v2 documents inline; a report the
  // parser rejects would fall back to the iframe path, which the presentation
  // sensor is supposed to make unreachable. Parsing the whole corpus keeps
  // the sensor, the parser, and the files agreeing.
  it("parses every delivery report as a contract-v2 document with a quiz", async () => {
    const failures: string[] = [];
    for (const report of listDeliveryReports()) {
      const parsed = parseReportDocument(await loadDeliveryReportHtml(report));
      if (!parsed) {
        failures.push(`${report.slug}: not a v2 report`);
        continue;
      }
      if (parsed.pills.length === 0) {
        failures.push(`${report.slug}: no status pills`);
      }
      if (!parsed.quiz) {
        failures.push(`${report.slug}: quiz failed to parse`);
      } else if (parsed.quiz.questions.length < 1) {
        // The five-question floor applies to newly authored reports and is
        // enforced at delivery time; one 2026-07 revert report shipped three.
        failures.push(`${report.slug}: quiz has no questions`);
      } else if (parsed.quiz.passThreshold > parsed.quiz.questions.length) {
        failures.push(`${report.slug}: threshold exceeds question count`);
      }
      if (parsed.sectionsHtml.length < 500) {
        failures.push(`${report.slug}: suspiciously little section content`);
      }
    }
    expect(failures).toEqual([]);
  });

  it("finds docs and reports by their route params", () => {
    const [doc] = listSolutionDocs();
    expect(findSolutionDoc(doc.category, doc.slug)).toEqual(doc);
    expect(findSolutionDoc(doc.category, "missing-doc")).toBeUndefined();

    const [report] = listDeliveryReports();
    expect(findDeliveryReport(report.slug)).toEqual(report);
    expect(findDeliveryReport("missing-report")).toBeUndefined();
  });
});
