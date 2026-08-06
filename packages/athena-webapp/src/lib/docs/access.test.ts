import { describe, expect, it } from "vitest";

import {
  canAccessSolutionCategory,
  filterAccessibleSolutionDocs,
  SECURITY_SOLUTION_CATEGORY,
} from "./access";

const docs = [
  { category: "architecture-patterns", slug: "public-doc" },
  { category: SECURITY_SOLUTION_CATEGORY, slug: "restricted-doc" },
];

describe("docs access policy", () => {
  it("keeps ordinary solution categories public", () => {
    expect(canAccessSolutionCategory("architecture-patterns", false)).toBe(true);
  });

  it("requires authentication for the security solution category", () => {
    expect(canAccessSolutionCategory(SECURITY_SOLUTION_CATEGORY, false)).toBe(false);
    expect(canAccessSolutionCategory(SECURITY_SOLUTION_CATEGORY, true)).toBe(true);
  });

  it("removes security solution metadata from public listings", () => {
    expect(filterAccessibleSolutionDocs(docs, false)).toEqual([docs[0]]);
    expect(filterAccessibleSolutionDocs(docs, true)).toEqual(docs);
  });
});
