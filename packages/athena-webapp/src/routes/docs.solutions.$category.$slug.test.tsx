import { describe, expect, it } from "vitest";

import { SECURITY_SOLUTION_CATEGORY } from "@/lib/docs/access";
import { listSolutionDocs } from "@/lib/docs/content";
import { loadSolutionDocPageData } from "@/lib/docs/solutionPage";

describe("solution doc route access", () => {
  it("does not load a security solution body before authentication", async () => {
    const doc = listSolutionDocs().find(
      (candidate) => candidate.category === SECURITY_SOLUTION_CATEGORY,
    );
    expect(doc).toBeDefined();

    const result = await loadSolutionDocPageData({
      category: doc!.category,
      slug: doc!.slug,
    });

    expect(result).toMatchObject({
      doc,
      body: null,
      requiresAuthentication: true,
    });
  });

  it("continues to load public solution bodies", async () => {
    const doc = listSolutionDocs().find(
      (candidate) => candidate.category !== SECURITY_SOLUTION_CATEGORY,
    );
    expect(doc).toBeDefined();

    const result = await loadSolutionDocPageData({
      category: doc!.category,
      slug: doc!.slug,
    });

    expect(result.requiresAuthentication).toBe(false);
    expect(result.body).not.toBeNull();
  });
});
