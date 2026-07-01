import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const projectRoot = process.cwd();
const readProjectFile = (...segments: string[]) =>
  readFileSync(join(projectRoot, ...segments), "utf8");

describe("createConvexLocalSyncRepository", () => {
  it("does not use paginated reads while syncing service-case financials", () => {
    const source = readProjectFile(
      "convex",
      "pos",
      "infrastructure",
      "repositories",
      "localSyncRepository.ts",
    );
    const financialSyncSource = source.slice(
      source.indexOf("async syncServiceCaseFinancials(serviceCaseId)"),
      source.indexOf("async createTransaction(input)"),
    );

    expect(financialSyncSource).toContain(".collect()");
    expect(financialSyncSource).not.toContain(".paginate(");
  });

  it("queries pending register variance reviews through the exact duplicate-prevention index", () => {
    const source = readProjectFile(
      "convex",
      "pos",
      "infrastructure",
      "repositories",
      "localSyncRepository.ts",
    );
    const varianceReviewSource = source.slice(
      source.indexOf("async createOrReuseRegisterSessionVarianceReview(input)"),
      source.indexOf("async createPosSession(input)"),
    );

    expect(varianceReviewSource).toContain(
      '.withIndex("by_registerSessionId_status_requestType"',
    );
    expect(varianceReviewSource).toContain('.eq("registerSessionId", input.registerSessionId)');
    expect(varianceReviewSource).toContain('.eq("status", "pending")');
    expect(varianceReviewSource).toContain('.eq("requestType", "variance_review")');
    expect(varianceReviewSource).toContain(".take(2)");
    expect(varianceReviewSource).not.toContain(".collect()");
    expect(varianceReviewSource).not.toContain(".take(20)");
  });
});
