import { describe, expect, it } from "vitest";

import { formatTaxonomySelectOptionLabel } from "./taxonomySelectLabels";

describe("formatTaxonomySelectOptionLabel", () => {
  it("capitalizes taxonomy select options without flattening acronyms", () => {
    expect(formatTaxonomySelectOptionLabel("hair care")).toBe("Hair Care");
    expect(formatTaxonomySelectOptionLabel("legacy import")).toBe(
      "Legacy Import",
    );
    expect(formatTaxonomySelectOptionLabel("POS quick add")).toBe(
      "POS Quick Add",
    );
    expect(formatTaxonomySelectOptionLabel("hair ties & scrunchies")).toBe(
      "Hair Ties & Scrunchies",
    );
  });
});
