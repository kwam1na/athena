import { describe, expect, it } from "vitest";

import {
  compareByDateDesc,
  deliveryReportMetaFromFile,
  parseSolutionFrontmatter,
  resolveSolutionDocLink,
  solutionDocMetaFromFile,
  stripFrontmatter,
} from "./parsing";

const SAMPLE_DOC = `---
title: Orphaned Harness Grandchildren Squat Scenario Ports
date: 2026-07-24
category: workflow-issues
module: scripts
severity: high
applies_when:
  - A harness:behavior scenario times out under pr:athena
  - lsof shows a vite server with PPID 1
tags: [harness-behavior, process-groups, "port-isolation"]
---

# Orphaned Harness Grandchildren Squat Scenario Ports

## Problem

Body text.
`;

describe("parseSolutionFrontmatter", () => {
  it("parses scalars, block lists, and inline lists", () => {
    const frontmatter = parseSolutionFrontmatter(SAMPLE_DOC);

    expect(frontmatter.title).toBe(
      "Orphaned Harness Grandchildren Squat Scenario Ports",
    );
    expect(frontmatter.date).toBe("2026-07-24");
    expect(frontmatter.severity).toBe("high");
    expect(frontmatter.applies_when).toEqual([
      "A harness:behavior scenario times out under pr:athena",
      "lsof shows a vite server with PPID 1",
    ]);
    expect(frontmatter.tags).toEqual([
      "harness-behavior",
      "process-groups",
      "port-isolation",
    ]);
  });

  it("keeps values containing colons intact", () => {
    const frontmatter = parseSolutionFrontmatter(
      "---\ntitle: Before: after\n---\nbody",
    );
    expect(frontmatter.title).toBe("Before: after");
  });

  it("returns an empty object when there is no frontmatter", () => {
    expect(parseSolutionFrontmatter("# Just a heading\n")).toEqual({});
  });
});

describe("stripFrontmatter", () => {
  it("removes only the frontmatter block", () => {
    const body = stripFrontmatter(SAMPLE_DOC);
    expect(body.startsWith("# Orphaned")).toBe(true);
    expect(body).toContain("Body text.");
  });

  it("leaves documents without frontmatter untouched", () => {
    expect(stripFrontmatter("# Heading\n")).toBe("# Heading\n");
  });
});

describe("solutionDocMetaFromFile", () => {
  it("builds metadata from frontmatter", () => {
    const meta = solutionDocMetaFromFile(
      "workflow-issues",
      "orphaned-harness-grandchildren.md",
      SAMPLE_DOC,
    );

    expect(meta).toMatchObject({
      slug: "orphaned-harness-grandchildren",
      category: "workflow-issues",
      fileName: "orphaned-harness-grandchildren.md",
      title: "Orphaned Harness Grandchildren Squat Scenario Ports",
      date: "2026-07-24",
      severity: "high",
      module: "scripts",
    });
  });

  it("falls back to the first heading, then the slug, for the title", () => {
    expect(
      solutionDocMetaFromFile("architecture", "some-doc.md", "# Heading Title\n")
        .title,
    ).toBe("Heading Title");
    expect(
      solutionDocMetaFromFile("architecture", "some-doc.md", "plain text").title,
    ).toBe("Some Doc");
  });

  it("carries the delivery fingerprint when the note declares one", () => {
    expect(
      solutionDocMetaFromFile("architecture", "some-doc.md", SAMPLE_DOC)
        .deliveryFingerprint,
    ).toBeNull();
    expect(
      solutionDocMetaFromFile(
        "architecture",
        "some-doc.md",
        "---\ntitle: Note\ndelivery_diff_fingerprint: 557f87faf1ff\n---\n\nBody.\n",
      ).deliveryFingerprint,
    ).toBe("557f87faf1ff");
  });
});

describe("deliveryReportMetaFromFile", () => {
  it("extracts the date from the filename and the title from the html", () => {
    const meta = deliveryReportMetaFromFile(
      "2026-07-09-landed-change-report-gate.html",
      "<html><head><title>\n  Landed Change Report Gate\n</title></head></html>",
    );

    expect(meta).toEqual({
      slug: "2026-07-09-landed-change-report-gate",
      fileName: "2026-07-09-landed-change-report-gate.html",
      title: "Landed Change Report Gate",
      date: "2026-07-09",
      deliveryFingerprint: null,
    });
  });

  it("falls back to a slug-derived title without a title tag", () => {
    const meta = deliveryReportMetaFromFile(
      "2026-07-09-landed-change-report-gate.html",
      "<html></html>",
    );
    expect(meta.title).toBe("Landed Change Report Gate");
  });

  it("reads the delivery fingerprint off the contract-v2 root element", () => {
    const meta = deliveryReportMetaFromFile(
      "2026-07-09-landed-change-report-gate.html",
      '<article data-athena-landed-change-report="v2" data-athena-report-diff-fingerprint="6d2d87fccf98"></article>',
    );
    expect(meta.deliveryFingerprint).toBe("6d2d87fccf98");
  });

  it("treats an empty fingerprint attribute as absent", () => {
    const meta = deliveryReportMetaFromFile(
      "2026-07-09-landed-change-report-gate.html",
      '<article data-athena-report-diff-fingerprint=""></article>',
    );
    expect(meta.deliveryFingerprint).toBeNull();
  });
});

describe("resolveSolutionDocLink", () => {
  // The three shapes that account for every in-corpus cross-reference.
  it("resolves same-category targets, bare or dot-prefixed", () => {
    expect(resolveSolutionDocLink("./athena-pos-sync.md", "architecture")).toEqual(
      { category: "architecture", slug: "athena-pos-sync" },
    );
    expect(resolveSolutionDocLink("athena-pos-sync.md", "architecture")).toEqual({
      category: "architecture",
      slug: "athena-pos-sync",
    });
  });

  it("resolves sibling-category targets", () => {
    expect(
      resolveSolutionDocLink("../logic-errors/athena-stale-sale.md", "architecture"),
    ).toEqual({ category: "logic-errors", slug: "athena-stale-sale" });
  });

  it("refuses targets that climb out of docs/solutions/", () => {
    // Real shapes in the corpus: authoring typos (an extra `..`) and genuine
    // references to docs outside the solutions tree. Neither is routable, and
    // clamping the climb would silently turn a typo into a wrong destination.
    expect(
      resolveSolutionDocLink("../../architecture/athena-reporting.md", "architecture-patterns"),
    ).toBeNull();
    expect(resolveSolutionDocLink("../../harness.md", "architecture")).toBeNull();
    expect(
      resolveSolutionDocLink("../../plans/2026-07-21-001-feat-rail-plan.md", "harness"),
    ).toBeNull();
  });

  it("ignores links that are not category-relative markdown", () => {
    expect(resolveSolutionDocLink("https://example.com/a.md", "architecture")).toBeNull();
    expect(resolveSolutionDocLink("mailto:someone@example.com", "architecture")).toBeNull();
    expect(resolveSolutionDocLink("//example.com/a.md", "architecture")).toBeNull();
    expect(resolveSolutionDocLink("/docs/solutions/a/b.md", "architecture")).toBeNull();
    expect(resolveSolutionDocLink("#problem", "architecture")).toBeNull();
    expect(resolveSolutionDocLink("../reports/some-report.html", "architecture")).toBeNull();
    expect(resolveSolutionDocLink("", "architecture")).toBeNull();
    expect(resolveSolutionDocLink(".md", "architecture")).toBeNull();
  });

  it("strips a trailing fragment or query from the target", () => {
    expect(
      resolveSolutionDocLink("./athena-pos-sync.md#root-cause", "architecture"),
    ).toEqual({ category: "architecture", slug: "athena-pos-sync" });
  });

  it("tolerates surrounding whitespace", () => {
    expect(resolveSolutionDocLink("  ./athena-pos-sync.md  ", "architecture")).toEqual({
      category: "architecture",
      slug: "athena-pos-sync",
    });
  });
});

describe("compareByDateDesc", () => {
  it("sorts newest first with undated entries last", () => {
    const entries = [
      { date: null, slug: "b" },
      { date: "2026-07-10", slug: "older" },
      { date: null, slug: "a" },
      { date: "2026-07-24", slug: "newer" },
    ];
    expect(entries.sort(compareByDateDesc).map((entry) => entry.slug)).toEqual([
      "newer",
      "older",
      "a",
      "b",
    ]);
  });
});
