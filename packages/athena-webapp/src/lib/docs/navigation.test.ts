import { describe, expect, it } from "vitest";

import { optionalSearchString, parseDocsLocation } from "./navigation";

describe("parseDocsLocation", () => {
  it("maps the section's index routes", () => {
    expect(parseDocsLocation("/docs")).toEqual({ kind: "overview" });
    expect(parseDocsLocation("/docs/solutions")).toEqual({
      kind: "solutions",
      category: null,
    });
    expect(parseDocsLocation("/docs/reports")).toEqual({ kind: "reports" });
  });

  it("carries the category filter on the solutions list", () => {
    expect(parseDocsLocation("/docs/solutions", "logic-errors")).toEqual({
      kind: "solutions",
      category: "logic-errors",
    });
    // An empty param is the unfiltered list, not a category named "".
    expect(parseDocsLocation("/docs/solutions", "")).toEqual({
      kind: "solutions",
      category: null,
    });
  });

  it("maps detail routes to their params", () => {
    expect(
      parseDocsLocation("/docs/solutions/logic-errors/athena-fold-version"),
    ).toEqual({
      kind: "solutionDoc",
      category: "logic-errors",
      slug: "athena-fold-version",
    });
    expect(parseDocsLocation("/docs/reports/2026-08-05-shared-demo")).toEqual({
      kind: "report",
      slug: "2026-08-05-shared-demo",
    });
  });

  it("ignores a trailing slash", () => {
    expect(parseDocsLocation("/docs/")).toEqual({ kind: "overview" });
    expect(parseDocsLocation("/docs/solutions/")).toEqual({
      kind: "solutions",
      category: null,
    });
  });

  it("returns null outside the docs section or for unserved shapes", () => {
    expect(parseDocsLocation("/")).toBeNull();
    expect(parseDocsLocation("/app/store")).toBeNull();
    expect(parseDocsLocation("/documentation")).toBeNull();
    expect(parseDocsLocation("/docs/solutions/logic-errors")).toBeNull();
    expect(parseDocsLocation("/docs/solutions/a/b/c")).toBeNull();
    expect(parseDocsLocation("/docs/reports/a/b")).toBeNull();
    expect(parseDocsLocation("/docs/unknown")).toBeNull();
  });

  it("decodes percent-encoded segments", () => {
    expect(
      parseDocsLocation("/docs/solutions/logic%2Derrors/some%2Ddoc"),
    ).toEqual({
      kind: "solutionDoc",
      category: "logic-errors",
      slug: "some-doc",
    });
  });
});

describe("optionalSearchString", () => {
  it("keeps a real query so it survives in the URL", () => {
    expect(optionalSearchString("intell")).toBe("intell");
  });

  it("collapses absent, blank, and non-string values to undefined", () => {
    // Otherwise clearing the box would leave a bare `?q=` behind.
    expect(optionalSearchString("")).toBeUndefined();
    expect(optionalSearchString("   ")).toBeUndefined();
    expect(optionalSearchString(undefined)).toBeUndefined();
    expect(optionalSearchString(null)).toBeUndefined();
    expect(optionalSearchString(42)).toBeUndefined();
    expect(optionalSearchString(["a"])).toBeUndefined();
  });

  it("preserves interior and trailing spaces of a real query", () => {
    // A trailing space is mid-typing, not an empty query.
    expect(optionalSearchString("shared demo ")).toBe("shared demo ");
  });
});
