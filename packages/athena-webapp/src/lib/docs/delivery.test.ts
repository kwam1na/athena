import { describe, expect, it } from "vitest";

import {
  reportsDeliveredWithSolutionDoc,
  solutionDocsDeliveredWithReport,
} from "./delivery";
import type { DeliveryReportMeta, SolutionDocMeta } from "./parsing";

const FINGERPRINT = "a".repeat(64);
const OTHER_FINGERPRINT = "b".repeat(64);

function solutionDoc(
  slug: string,
  deliveryFingerprint: string | null,
  category = "architecture-patterns",
): SolutionDocMeta {
  return {
    slug,
    category,
    fileName: `${slug}.md`,
    title: slug,
    date: "2026-08-05",
    severity: null,
    module: null,
    tags: [],
    deliveryFingerprint,
  };
}

function report(
  slug: string,
  deliveryFingerprint: string | null,
): DeliveryReportMeta {
  return {
    slug,
    fileName: `${slug}.html`,
    title: slug,
    date: "2026-08-05",
    deliveryFingerprint,
  };
}

describe("delivery companions", () => {
  it("links a solution note to the report sharing its fingerprint", () => {
    const reports = [
      report("2026-08-05-docs-viewer-report", FINGERPRINT),
      report("2026-08-05-unrelated-report", OTHER_FINGERPRINT),
    ];

    expect(
      reportsDeliveredWithSolutionDoc(solutionDoc("docs-viewer", FINGERPRINT), reports),
    ).toEqual([reports[0]]);
  });

  it("links a report to every solution note from the same delivery", () => {
    const solutions = [
      solutionDoc("read-model-boundary", FINGERPRINT),
      solutionDoc("env-leak", FINGERPRINT, "workflow-issues"),
      solutionDoc("other-delivery", OTHER_FINGERPRINT),
    ];

    expect(
      solutionDocsDeliveredWithReport(report("docs-viewer-report", FINGERPRINT), solutions),
    ).toEqual([solutions[0], solutions[1]]);
  });

  it("returns both reports when one deliverable diff produced two", () => {
    const reports = [
      report("demo-experience-report", FINGERPRINT),
      report("validation-routing-report", FINGERPRINT),
    ];

    expect(
      reportsDeliveredWithSolutionDoc(solutionDoc("note", FINGERPRINT), reports),
    ).toEqual(reports);
  });

  it("links nothing when either side carries no fingerprint", () => {
    expect(
      reportsDeliveredWithSolutionDoc(solutionDoc("note", null), [
        report("report", null),
      ]),
    ).toEqual([]);
    expect(
      solutionDocsDeliveredWithReport(report("report", null), [
        solutionDoc("note", null),
      ]),
    ).toEqual([]);
  });

  it("links nothing when a fingerprint went stale on one side only", () => {
    expect(
      reportsDeliveredWithSolutionDoc(solutionDoc("note", FINGERPRINT), [
        report("report", OTHER_FINGERPRINT),
      ]),
    ).toEqual([]);
  });
});
